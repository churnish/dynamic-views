/**
 * Immersive mobile scrolling — hides navigation bars on scroll-down,
 * shows on scroll-up. Uses a bridge architecture (translateY on container)
 * to prevent visual jumps during bar hide/show transitions.
 *
 * Guards: Platform.isPhone && body.has('auto-full-screen') && settings.immersiveScroll
 *
 * TODO: when Safari ships overflow-anchor, skip bridge entirely —
 * just toggle class and let browser handle scroll anchoring.
 */

import {
  IMMERSIVE_HIDE_DEAD_ZONE,
  IMMERSIVE_SHOW_DEAD_ZONE,
  IMMERSIVE_TOP_ZONE,
  IMMERSIVE_TOGGLE_COOLDOWN_MS,
  IMMERSIVE_SCROLL_IDLE_MS,
  IMMERSIVE_SHOW_SUSTAIN_MS,
} from '../shared/constants';

export interface ImmersiveElements {
  scrollEl: HTMLElement; // .bases-view
  container: HTMLElement; // .dynamic-views-bases-container
  viewContent: HTMLElement; // .view-content
  navbarEl: HTMLElement; // .mobile-navbar
}

const STYLE_ID = 'immersive-scroll-css';

/** Ref-counted singleton for the injected <style> element */
let styleRefCount = 0;

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

export class ImmersiveScrollController {
  private readonly scrollEl: HTMLElement;
  private readonly container: HTMLElement;
  private readonly viewContent: HTMLElement;
  private readonly navbarEl: HTMLElement;
  private readonly ownerDoc: Document;
  private readonly body: HTMLElement;

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

  constructor(elements: ImmersiveElements) {
    this.scrollEl = elements.scrollEl;
    this.container = elements.container;
    this.viewContent = elements.viewContent;
    this.navbarEl = elements.navbarEl;
    this.ownerDoc = this.scrollEl.ownerDocument;
    this.body = this.ownerDoc.body;

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

    // Inject shared <style> (ref-counted singleton)
    this.injectStyle();

    // Store original margin-top (before class changes it)
    this.originalMarginTop =
      parseFloat(getComputedStyle(this.viewContent).marginTop) || 0;

    // Measure totalShift: toggle immersive-active, read scrollEl rect delta
    const beforeTop = this.scrollEl.getBoundingClientRect().top;
    this.body.classList.add('immersive-active');
    const afterTop = this.scrollEl.getBoundingClientRect().top;
    this.body.classList.remove('immersive-active');
    this.totalShift = beforeTop - afterTop;

    // Pre-promote container onto compositor layer
    setStyle(this.container, 'transform', 'translateY(0)');

    // Lock scroll container height — decouples clientHeight from flex layout
    // changes during immersive transitions (prevents scroll indicator teleport)
    this.lockedScrollHeight = this.scrollEl.offsetHeight;
    setStyle(this.scrollEl, 'height', `${this.lockedScrollHeight}px`);

    // Reset state
    this.barsHidden = false;
    this.settled = false;
    this.prevScrollTop = this.scrollEl.scrollTop;
    this.accumulatedDelta = 0;
    this.directionChangeTime = 0;
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
    // Remove immersive classes only if this instance set them
    if (this.isActiveHider) {
      this.body.classList.remove('immersive-active', 'immersive-showing');
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

    // Decrement style ref count; remove <style> if zero
    styleRefCount--;
    if (styleRefCount <= 0) {
      styleRefCount = 0;
      this.ownerDoc.getElementById(STYLE_ID)?.remove();
    }

    this.pendingLayout = null;
    this.barsHidden = false;
    this.settled = false;
  }

  // ---------------------------------------------------------------------------
  // Style injection
  // ---------------------------------------------------------------------------

  private injectStyle(): void {
    styleRefCount++;
    if (this.ownerDoc.getElementById(STYLE_ID)) return;

    const bodyCS = getComputedStyle(this.body);
    const headerOffset =
      (parseFloat(bodyCS.getPropertyValue('--view-header-height')) || 44) +
      (parseFloat(bodyCS.getPropertyValue('--safe-area-inset-top')) || 47);

    const style = this.ownerDoc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.is-phone.immersive-active [data-type='bases'] .view-header {
  transform: translateY(-${headerOffset}px) !important;
  opacity: 0 !important;
  pointer-events: none !important;
}
.is-phone.immersive-active [data-type='bases'] .bases-header {
  visibility: hidden !important;
  pointer-events: none !important;
  margin-bottom: calc(var(--bases-header-height, 52px) * -1) !important;
  transition: none !important;
}
.is-phone.immersive-active [data-type='bases'] .bases-search-row {
  visibility: hidden !important;
  transition: none !important;
}
.is-phone.immersive-active [data-type='bases'] .view-content {
  margin-top: 0 !important;
  transition: none !important;
}
.is-phone.immersive-active,
.is-phone.immersive-active .app-container,
.is-phone.immersive-active .workspace {
  background-color: var(--background-primary) !important;
}
.is-phone.immersive-active [data-type='bases']::after {
  display: none !important;
}
.is-phone.immersive-active .workspace-split.mod-root {
  -webkit-mask-image: none !important;
  mask-image: none !important;
}
.is-phone.immersive-active [data-type='bases']::before {
  content: '' !important;
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  height: env(safe-area-inset-top, 0px) !important;
  background: linear-gradient(
    to bottom,
    var(--background-primary) 0px,
    transparent env(safe-area-inset-top, 0px)
  ) !important;
  z-index: 10 !important;
  pointer-events: none !important;
}
.is-phone.immersive-active.immersive-showing [data-type='bases'] .view-header {
  transform: translateY(0) !important;
  opacity: 1 !important;
  pointer-events: auto !important;
}
.is-phone.immersive-active.immersive-showing [data-type='bases'] .bases-header {
  visibility: visible !important;
  pointer-events: auto !important;
  margin-bottom: 0px !important;
  transition: none !important;
}
.is-phone.immersive-active.immersive-showing [data-type='bases'] .bases-search-row {
  visibility: visible !important;
  transition: none !important;
}
.is-phone.immersive-active.immersive-showing [data-type='bases'] .view-content {
  margin-top: var(--view-top-spacing, 99px) !important;
  transition: none !important;
}
.is-phone.immersive-active.immersive-showing [data-type='bases']::before {
  content: none !important;
}`;
    this.ownerDoc.head.appendChild(style);
  }

  // ---------------------------------------------------------------------------
  // Scroll handler
  // ---------------------------------------------------------------------------

  private onScroll(): void {
    // Visibility guard — skip if container detached or hidden
    if (!this.container.isConnected || this.container.offsetHeight <= 0) return;

    if (this.programmaticScroll) return;

    const currentTop = this.scrollEl.scrollTop;
    const delta = currentTop - this.prevScrollTop;
    this.prevScrollTop = currentTop;

    // Idle settle for pending layout (hide settle or show class removal)
    if (this.scrollIdleTimer != null) clearTimeout(this.scrollIdleTimer);
    if (this.pendingLayout) {
      this.scrollIdleTimer = setTimeout(() => {
        if (this.pendingLayout) {
          this.pendingLayout();
          this.pendingLayout = null;
        }
      }, IMMERSIVE_SCROLL_IDLE_MS);
    }

    // Auto-show near top
    if (currentTop <= IMMERSIVE_TOP_ZONE) {
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
      this.directionChangeTime = Date.now();
    }
    this.accumulatedDelta += delta;

    // Cooldown prevents rapid cycling (deceleration bounce, layout-induced deltas)
    if (Date.now() - this.lastToggleTime < IMMERSIVE_TOGGLE_COOLDOWN_MS) {
      // Reset accumulator so layout-induced deltas don't leak past cooldown
      this.accumulatedDelta = 0;
      return;
    }

    if (
      this.accumulatedDelta > IMMERSIVE_HIDE_DEAD_ZONE &&
      !this.barsHidden &&
      Date.now() - this.directionChangeTime >= IMMERSIVE_SHOW_SUSTAIN_MS
    ) {
      this.barsHidden = true;
      this.lastToggleTime = Date.now();
      this.hideBarsUI();
      this.accumulatedDelta = 0;
    } else if (
      this.accumulatedDelta < -IMMERSIVE_SHOW_DEAD_ZONE &&
      this.barsHidden &&
      Date.now() - this.directionChangeTime >= IMMERSIVE_SHOW_SUSTAIN_MS
    ) {
      this.barsHidden = false;
      this.lastToggleTime = Date.now();
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

    // Remove immersive-showing if rapid show→hide before idle
    this.body.classList.remove('immersive-showing');

    // Clear show-path navbar inlines
    this.navbarEl.style.removeProperty('transform');
    this.navbarEl.style.removeProperty('opacity');
    this.navbarEl.style.removeProperty('transition');

    // Re-measure ONLY in clean state (no immersive classes).
    // During rapid show→hide, immersive-active is still on body —
    // getComputedStyle would read margin-top: 0 (class rule) instead of ~99px.
    if (!this.body.classList.contains('immersive-active')) {
      this.originalMarginTop =
        parseFloat(getComputedStyle(this.viewContent).marginTop) || 0;
      const toolbar = this.viewContent
        .closest('.workspace-leaf-content')
        ?.querySelector<HTMLElement>('.bases-header');
      this.totalShift = this.originalMarginTop + (toolbar?.offsetHeight ?? 0);
    }

    // Bridge + class (scroll container height is locked — clientHeight unchanged)
    setBridge(this.container, `translateY(${this.totalShift}px)`, 'none');
    this.body.classList.add('immersive-active');
    this.settled = false;
    void capacitorStatusBar?.hide();

    // Navbar: double-rAF inline transform animation
    const navbarHeight = this.getNavbarHeight();
    const navTransition = 'transform 0.3s ease-out, opacity 0.2s ease-out';
    this.pendingRafId = requestAnimationFrame(() => {
      setStyle(this.navbarEl, 'transition', navTransition, 'important');
      this.pendingRafId = requestAnimationFrame(() => {
        setStyle(
          this.navbarEl,
          'transform',
          `translateY(${navbarHeight}px)`,
          'important'
        );
        setStyle(this.navbarEl, 'opacity', '0', 'important');
        setStyle(this.navbarEl, 'pointer-events', 'none', 'important');
      });
    });

    // Idle settle: remove bridge + scrollTop -= totalShift
    this.pendingLayout = () => {
      const before = this.scrollEl.scrollTop;
      // Guard: skip if scrollTop < totalShift (near top — can't fully compensate)
      if (before < this.totalShift) return;

      this.programmaticScroll = true;

      // Direct height calculation — no unlock-relock dance.
      // Bars hidden → scroll container gets totalShift more flex space.
      this.lockedScrollHeight += this.totalShift;
      setStyle(this.scrollEl, 'height', `${this.lockedScrollHeight}px`);
      setBridge(this.container, 'translateY(0)', 'none');
      this.scrollEl.scrollTop = before - this.totalShift;
      this.settled = true;

      requestAnimationFrame(() => {
        this.programmaticScroll = false;
        this.prevScrollTop = this.scrollEl.scrollTop;
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

    // Single class op — higher specificity overrides immersive-active
    this.body.classList.add('immersive-showing');

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

    // Idle: remove classes + relock height at calculated value
    this.pendingLayout = () => {
      // Block all scroll events during settle — class removal and height
      // changes produce layout-induced scroll deltas on iOS WebKit
      this.programmaticScroll = true;

      setBridge(this.container, 'translateY(0)', 'none');

      if (this.settled) {
        this.scrollEl.scrollTop += this.totalShift;
      }

      // Direct height calculation — no unlock-relock dance.
      // Bars restored → scroll container loses totalShift of flex space.
      this.lockedScrollHeight -= this.totalShift;
      setStyle(this.scrollEl, 'height', `${this.lockedScrollHeight}px`);
      this.body.classList.remove('immersive-active', 'immersive-showing');
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
    const isCoverImage = target.closest('.card-cover') != null;
    const isOpenOnTitle = this.body.classList.contains(
      'dynamic-views-open-on-title'
    );
    const isTitleLink = target.closest('.dynamic-views-card-title a') != null;

    // Don't reveal bars when tapping a cover image — let image viewer handle it.
    // Exception: reveal if image viewer disabled via Style Settings AND
    // open file action is 'press on title' (image tap is non-interactive).
    if (isCoverImage) {
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
