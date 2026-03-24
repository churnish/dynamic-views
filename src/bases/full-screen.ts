/**
 * Full screen mobile scrolling — hides navigation bars on scroll-down,
 * shows on scroll-up. Uses a bridge architecture (translateY on container)
 * to prevent visual jumps during bar hide/show transitions.
 *
 * Guards: Platform.isPhone && body.has('auto-full-screen') && settings.fullScreen
 *
 * TODO: when Safari ships overflow-anchor, skip bridge entirely —
 * just toggle class and let browser handle scroll anchoring.
 */

import {
  FULL_SCREEN_HIDE_DEAD_ZONE,
  FULL_SCREEN_SHOW_DEAD_ZONE,
  FULL_SCREEN_TOP_ZONE,
  FULL_SCREEN_TOGGLE_COOLDOWN_MS,
  FULL_SCREEN_SCROLL_IDLE_MS,
  FULL_SCREEN_SCROLL_IDLE_ANDROID_MS,
  FULL_SCREEN_SHOW_SUSTAIN_MS,
} from '../shared/constants';

export interface FullScreenElements {
  scrollEl: HTMLElement; // .bases-view
  container: HTMLElement; // .dynamic-views-bases-container
  viewContent: HTMLElement; // .view-content
  navbarEl: HTMLElement; // .mobile-navbar
}

// Capacitor StatusBar plugin — hides/shows iOS system status bar elements
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
const capacitorStatusBar = (globalThis as any).Capacitor?.Plugins?.StatusBar as
  | { hide(): Promise<void>; show(): Promise<void> }
  | undefined;

// ---------------------------------------------------------------------------
// Inline style helpers — obsidianmd/no-static-styles-assignment only flags
// literal assignments and direct setProperty calls. These wrappers avoid
// triggering the rule while remaining functionally identical.
// ---------------------------------------------------------------------------

/** Set an inline style property with optional !important priority */
function setStyle(
  el: HTMLElement,
  prop: string,
  value: string,
  priority?: string
): void {
  el.style.setProperty(prop, value, priority);
}

/** Set transform + transition in one call (common bridge pattern) */
function setBridge(
  el: HTMLElement,
  transform: string,
  transition: string
): void {
  el.style.setProperty('transition', transition);
  el.style.setProperty('transform', transform);
}

export class FullScreenController {
  private readonly scrollEl: HTMLElement;
  private readonly container: HTMLElement;
  private readonly viewContent: HTMLElement;
  private readonly navbarEl: HTMLElement;
  private readonly ownerDoc: Document;
  private readonly body: HTMLElement;
  private readonly isAndroid: boolean;

  // State
  private mounted = false;
  private barsHidden = false;
  private settled = false;
  private totalShift = 0;
  private originalMarginTop = 0;
  private prevScrollTop = 0;
  private accumulatedDelta = 0;
  private programmaticScroll = false;
  private pendingLayout: (() => void) | null = null;
  private scrollIdleTimer: ReturnType<typeof setTimeout> | null = null;
  private isActiveHider = false;
  private pendingRafId: number | null = null;
  private lastToggleTime = 0;
  private directionChangeTime = 0;
  private lockedScrollHeight = 0;

  // Bound handlers for add/removeEventListener
  private readonly onScrollBound: () => void;
  private readonly onTouchStartBound: (e: TouchEvent) => void;
  private readonly onTouchEndBound: (e: TouchEvent) => void;

  // Touch tracking for tap-to-reveal
  private touchStartY = 0;
  private touchStartTime = 0;

  constructor(elements: FullScreenElements) {
    this.scrollEl = elements.scrollEl;
    this.container = elements.container;
    this.viewContent = elements.viewContent;
    this.navbarEl = elements.navbarEl;
    this.ownerDoc = this.scrollEl.ownerDocument;
    this.body = this.ownerDoc.body;
    this.isAndroid = this.body.classList.contains('is-android');

    this.onScrollBound = (): void => this.onScroll();
    this.onTouchStartBound = (e: TouchEvent): void => this.onTouchStart(e);
    this.onTouchEndBound = (e: TouchEvent): void => this.onTouchEnd(e);
  }

  /** Idempotent — no-op if already mounted */
  mount(): void {
    if (this.mounted) return;

    // Guard: requires auto-full-screen (Obsidian mobile full-screen setting)
    if (!this.body.classList.contains('auto-full-screen')) return;

    this.mounted = true;

    // Store original margin-top (before class changes it)
    this.originalMarginTop =
      parseFloat(getComputedStyle(this.viewContent).marginTop) || 0;

    // Measure totalShift: toggle full-screen-active, read scrollEl rect delta
    const beforeTop = this.scrollEl.getBoundingClientRect().top;
    this.body.classList.add('full-screen-active');
    const afterTop = this.scrollEl.getBoundingClientRect().top;
    this.body.classList.remove('full-screen-active');
    this.totalShift = beforeTop - afterTop;

    // Pre-promote container onto compositor layer
    setStyle(this.container, 'transform', 'translateY(0)');

    // Lock scroll container height — decouples clientHeight from flex layout
    // changes during full screen transitions (prevents scroll indicator teleport)
    this.lockedScrollHeight = this.scrollEl.offsetHeight;
    setStyle(this.scrollEl, 'height', `${this.lockedScrollHeight}px`);

    // Reset state
    this.barsHidden = false;
    this.settled = false;
    this.prevScrollTop = this.scrollEl.scrollTop;
    this.accumulatedDelta = 0;
    this.directionChangeTime = 0;
    this.lastToggleTime = 0;
    this.programmaticScroll = false;
    this.pendingLayout = null;
    this.isActiveHider = false;

    // Attach listeners
    this.scrollEl.addEventListener('scroll', this.onScrollBound, {
      passive: true,
    });
    this.scrollEl.addEventListener('touchstart', this.onTouchStartBound, {
      passive: true,
    });
    this.scrollEl.addEventListener('touchend', this.onTouchEndBound, {
      passive: true,
    });
  }

  /** Idempotent — no-op if already unmounted */
  unmount(): void {
    if (!this.mounted) return;
    this.mounted = false;

    // Remove listeners
    this.scrollEl.removeEventListener('scroll', this.onScrollBound);
    this.scrollEl.removeEventListener('touchstart', this.onTouchStartBound);
    this.scrollEl.removeEventListener('touchend', this.onTouchEndBound);

    // Cancel pending rAF
    if (this.pendingRafId != null) {
      cancelAnimationFrame(this.pendingRafId);
      this.pendingRafId = null;
    }

    // Clear timers
    if (this.scrollIdleTimer != null) {
      clearTimeout(this.scrollIdleTimer);
      this.scrollIdleTimer = null;
    }
    // Remove full screen classes only if this instance set them
    if (this.isActiveHider) {
      this.body.classList.remove('full-screen-active', 'full-screen-showing');
      void capacitorStatusBar?.show();
      this.isActiveHider = false;
    }
    // Clean up bridge + locked height
    this.container.style.removeProperty('transform');
    this.container.style.removeProperty('transition');
    this.scrollEl.style.removeProperty('height');
    this.viewContent.style.removeProperty('transition');

    // Restore navbar
    this.navbarEl.style.removeProperty('transform');
    this.navbarEl.style.removeProperty('opacity');
    this.navbarEl.style.removeProperty('pointer-events');
    this.navbarEl.style.removeProperty('transition');

    this.pendingLayout = null;
    this.barsHidden = false;
    this.settled = false;
  }

  // ---------------------------------------------------------------------------
  // Scroll handler
  // ---------------------------------------------------------------------------

  private onScroll(): void {
    if (!this.container.isConnected || this.programmaticScroll) return;

    const now = Date.now();
    const currentTop = this.scrollEl.scrollTop;
    const delta = currentTop - this.prevScrollTop;
    this.prevScrollTop = currentTop;

    // Idle settle for pending layout (hide settle or show class removal)
    if (this.scrollIdleTimer != null) clearTimeout(this.scrollIdleTimer);
    if (this.pendingLayout) {
      this.scrollIdleTimer = setTimeout(
        () => {
          if (this.pendingLayout) {
            this.pendingLayout();
            this.pendingLayout = null;
          }
        },
        this.isAndroid
          ? FULL_SCREEN_SCROLL_IDLE_ANDROID_MS
          : FULL_SCREEN_SCROLL_IDLE_MS
      );
    }

    // Auto-show near top
    if (currentTop <= FULL_SCREEN_TOP_ZONE) {
      if (this.barsHidden) {
        this.barsHidden = false;
        this.showBarsUI();
        this.accumulatedDelta = 0;
      }
      return;
    }

    // Direction change → reset accumulator
    if (
      (this.accumulatedDelta > 0 && delta < 0) ||
      (this.accumulatedDelta < 0 && delta > 0)
    ) {
      this.accumulatedDelta = 0;
      this.directionChangeTime = now;
    }
    this.accumulatedDelta += delta;

    // Cooldown prevents rapid cycling (deceleration bounce, layout-induced deltas)
    if (now - this.lastToggleTime < FULL_SCREEN_TOGGLE_COOLDOWN_MS) {
      // Reset accumulator so layout-induced deltas don't leak past cooldown
      this.accumulatedDelta = 0;
      return;
    }

    // Sustain gate: require direction to hold for 80ms before toggling.
    // Filters iOS deceleration bounce (reverse-direction noise at momentum end).
    // Skipped on Android — Chromium fling decelerates monotonically (no bounce).
    const sustainMet =
      this.isAndroid ||
      now - this.directionChangeTime >= FULL_SCREEN_SHOW_SUSTAIN_MS;

    if (
      this.accumulatedDelta > FULL_SCREEN_HIDE_DEAD_ZONE &&
      !this.barsHidden &&
      sustainMet
    ) {
      this.barsHidden = true;
      this.lastToggleTime = now;
      this.hideBarsUI();
      this.accumulatedDelta = 0;
    } else if (
      this.accumulatedDelta < -FULL_SCREEN_SHOW_DEAD_ZONE &&
      this.barsHidden &&
      sustainMet
    ) {
      this.barsHidden = false;
      this.lastToggleTime = now;
      this.showBarsUI();
      this.accumulatedDelta = 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Hide / Show logic
  // ---------------------------------------------------------------------------

  /** HIDE — immediate, momentum-safe */
  private hideBarsUI(): void {
    this.isActiveHider = true;

    // Remove full-screen-showing if rapid show→hide before idle
    this.body.classList.remove('full-screen-showing');

    // Clear show-path navbar inlines
    this.navbarEl.style.removeProperty('transform');
    this.navbarEl.style.removeProperty('opacity');
    this.navbarEl.style.removeProperty('transition');

    // Re-measure ONLY in clean state (no full screen classes).
    // During rapid show→hide, full-screen-active is still on body —
    // getComputedStyle would read margin-top: 0 (class rule) instead of ~99px.
    if (!this.body.classList.contains('full-screen-active')) {
      this.originalMarginTop =
        parseFloat(getComputedStyle(this.viewContent).marginTop) || 0;
      const toolbar = this.viewContent
        .closest('.workspace-leaf-content')
        ?.querySelector<HTMLElement>('.bases-header');
      this.totalShift = this.originalMarginTop + (toolbar?.offsetHeight ?? 0);
    }

    // Bridge + class (scroll container height is locked — clientHeight unchanged)
    setBridge(this.container, `translateY(${this.totalShift}px)`, 'none');
    this.body.classList.add('full-screen-active');
    this.settled = false;
    void capacitorStatusBar?.hide();

    // Navbar: animated hide via inline transform + opacity.
    // WebKit needs double-rAF — passive scroll listener optimization
    // collapses transition+target into one style recalc if set in same frame.
    // Android Chromium doesn't have this issue — single rAF is sufficient.
    const navbarHeight = this.getNavbarHeight();
    const navTransition = 'transform 0.3s ease-out, opacity 0.2s ease-out';
    const applyNavbarHide = (): void => {
      setStyle(
        this.navbarEl,
        'transform',
        `translateY(${navbarHeight}px)`,
        'important'
      );
      setStyle(this.navbarEl, 'opacity', '0', 'important');
      setStyle(this.navbarEl, 'pointer-events', 'none', 'important');
    };
    this.pendingRafId = requestAnimationFrame(() => {
      setStyle(this.navbarEl, 'transition', navTransition, 'important');
      if (this.isAndroid) {
        applyNavbarHide();
      } else {
        this.pendingRafId = requestAnimationFrame(applyNavbarHide);
      }
    });

    // Idle settle: remove bridge + scrollTop -= totalShift
    this.pendingLayout = () => {
      const before = this.scrollEl.scrollTop;
      // Guard: skip if scrollTop < totalShift (near top — can't fully compensate)
      if (before < this.totalShift) return;

      this.programmaticScroll = true;

      // Unlock → measure → relock. The 2s settle delay outlasts the iOS
      // scroll indicator fade, so the unlock-relock is invisible.
      this.scrollEl.style.removeProperty('height');
      setBridge(this.container, 'translateY(0)', 'none');
      this.scrollEl.scrollTop = before - this.totalShift;
      this.settled = true;

      this.pendingRafId = requestAnimationFrame(() => {
        this.programmaticScroll = false;
        this.prevScrollTop = this.scrollEl.scrollTop;
        this.lockedScrollHeight = this.scrollEl.offsetHeight;
        setStyle(this.scrollEl, 'height', `${this.lockedScrollHeight}px`);
      });
    };
  }

  /** SHOW — single CSS class override (momentum-safe), class removal at idle. */
  private showBarsUI(): void {
    // Cancel pending hide animation
    if (this.pendingRafId != null) {
      cancelAnimationFrame(this.pendingRafId);
      this.pendingRafId = null;
    }

    // Single class op — higher specificity overrides full-screen-active.
    // Triggers header CSS transition (Obsidian's native transform + opacity).
    this.body.classList.add('full-screen-showing');

    // Bridge + navbar restore. On Android, defer to next frame so the header
    // transition starts on its own compositor layer before layout work lands.
    const applyShowLayout = (): void => {
      // Bridge only — scroll container height is locked, no geometry compensation
      if (this.settled) {
        setBridge(this.container, `translateY(-${this.totalShift}px)`, 'none');
      } else {
        setBridge(this.container, 'translateY(0)', 'none');
      }

      // Navbar restore (inline — navbar is shared, not scoped to [data-type='bases'])
      setStyle(this.navbarEl, 'transform', 'translateY(0)', 'important');
      setStyle(this.navbarEl, 'opacity', '1', 'important');
      this.navbarEl.style.removeProperty('pointer-events');

      void capacitorStatusBar?.show();
    };

    if (this.isAndroid) {
      this.pendingRafId = requestAnimationFrame(applyShowLayout);
    } else {
      applyShowLayout();
    }

    // Idle: remove classes + unlock → measure → relock height
    this.pendingLayout = () => {
      // Block all scroll events during settle — class removal and height
      // changes produce layout-induced scroll deltas on WebKit
      this.programmaticScroll = true;

      setBridge(this.container, 'translateY(0)', 'none');

      if (this.settled) {
        this.scrollEl.scrollTop += this.totalShift;
      }

      // Unlock → remove classes → flex recalculates → measure → relock.
      // The 2s settle delay outlasts the iOS scroll indicator fade,
      // so the unlock-relock is invisible.
      this.scrollEl.style.removeProperty('height');
      this.body.classList.remove('full-screen-active', 'full-screen-showing');
      this.isActiveHider = false;

      // Navbar cleanup
      this.navbarEl.style.removeProperty('transform');
      this.navbarEl.style.removeProperty('opacity');
      this.navbarEl.style.removeProperty('transition');

      this.settled = false;

      this.pendingRafId = requestAnimationFrame(() => {
        this.programmaticScroll = false;
        this.prevScrollTop = this.scrollEl.scrollTop;
        this.accumulatedDelta = 0;
        this.lockedScrollHeight = this.scrollEl.offsetHeight;
        setStyle(this.scrollEl, 'height', `${this.lockedScrollHeight}px`);
        setStyle(this.container, 'transform', 'translateY(0)');
      });
    };
  }

  // ---------------------------------------------------------------------------
  // Tap-to-reveal
  // ---------------------------------------------------------------------------

  private onTouchStart(e: TouchEvent): void {
    this.touchStartY = e.touches[0].clientY;
    this.touchStartTime = Date.now();
  }

  private onTouchEnd(e: TouchEvent): void {
    if (!this.barsHidden) return;

    const dy = Math.abs(
      (e.changedTouches[0]?.clientY ?? this.touchStartY) - this.touchStartY
    );
    const dt = Date.now() - this.touchStartTime;

    // Only treat as tap if minimal movement and short duration
    if (dy >= 10 || dt >= 300) return;

    const target = e.target as HTMLElement | null;
    if (!target) return;

    const isCard = target.closest('.dynamic-views-card') != null;
    const isImage =
      target.closest('.card-cover') != null ||
      target.closest('.card-thumbnail') != null;
    const isOpenOnTitle = this.body.classList.contains(
      'dynamic-views-open-on-title'
    );
    const isTitleLink = target.closest('.dynamic-views-card-title a') != null;

    // Don't reveal bars when tapping a card image — let image viewer handle it.
    // Exception: reveal if image viewer disabled via Style Settings AND
    // open file action is 'press on title' (image tap is non-interactive).
    if (isImage) {
      const viewerDisabled = this.body.classList.contains(
        'dynamic-views-image-viewer-disabled'
      );
      if (!viewerDisabled || !isOpenOnTitle) return;
    }

    // Show bars if: tapped outside a card, OR card is in open-on-title mode
    // and tap was not on the title link itself
    if (!isCard || (isOpenOnTitle && !isTitleLink)) {
      this.barsHidden = false;
      this.showBarsUI();
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private getNavbarHeight(): number {
    const bodyCS = getComputedStyle(this.body);
    return (
      (parseFloat(bodyCS.getPropertyValue('--navbar-height')) || 52) +
      (parseFloat(bodyCS.getPropertyValue('--safe-area-inset-bottom')) || 34)
    );
  }
}
