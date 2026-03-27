/**
 * Full screen mobile scrolling — hides navigation bars on scroll-down,
 * shows on scroll-up. Uses a bridge architecture (margin-top on container)
 * to prevent visual jumps during bar hide/show transitions. margin-top
 * adjusts scrollHeight in sync with visual displacement — no false
 * top/bottom at scroll boundaries.
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
  FULL_SCREEN_ANIM_MS,
} from '../shared/constants';

/** Shared WAAPI options for Android bar animations */
const WAAPI_OPTS: KeyframeAnimationOptions = {
  duration: FULL_SCREEN_ANIM_MS,
  easing: 'ease-out',
  fill: 'forwards' as FillMode,
};

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

export class FullScreenController {
  private readonly scrollEl: HTMLElement;
  private readonly container: HTMLElement;
  private readonly viewContent: HTMLElement;
  private readonly navbarEl: HTMLElement;
  private readonly viewHeaderEl: HTMLElement | null;
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

  // WAAPI animation handles (Android) — cancel before starting new ones
  private headerAnim: Animation | null = null;
  private navbarAnim: Animation | null = null;

  // Touch tracking for tap-to-reveal
  private touchStartY = 0;
  private touchStartTime = 0;

  constructor(elements: FullScreenElements) {
    this.scrollEl = elements.scrollEl;
    this.container = elements.container;
    this.viewContent = elements.viewContent;
    this.navbarEl = elements.navbarEl;
    this.viewHeaderEl =
      elements.viewContent.parentElement?.querySelector<HTMLElement>(
        '.view-header'
      ) ?? null;
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

    // Pre-promote navbar to compositor layer (Android only).
    // Eliminates first-transform layer promotion stall during animation.
    // Header is promoted via CSS (will-change on .full-screen-active rule).
    if (this.isAndroid) {
      setStyle(this.navbarEl, 'will-change', 'transform, opacity');
    }

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

  /** Cancel and discard WAAPI animation handles (Android) */
  private cancelAnimations(): void {
    this.navbarAnim?.cancel();
    this.headerAnim?.cancel();
    this.navbarAnim = null;
    this.headerAnim = null;
  }

  /** Clear navbar inline styles set during hide/show */
  private clearNavbarInlines(): void {
    this.navbarEl.style.removeProperty('transform');
    this.navbarEl.style.removeProperty('opacity');
    this.navbarEl.style.removeProperty('pointer-events');
    this.navbarEl.style.removeProperty('transition');
  }

  /** Clear header inline styles set during hide/show */
  private clearHeaderInlines(): void {
    if (!this.viewHeaderEl) return;
    this.viewHeaderEl.style.removeProperty('transform');
    this.viewHeaderEl.style.removeProperty('opacity');
    this.viewHeaderEl.style.removeProperty('pointer-events');
    this.viewHeaderEl.style.removeProperty('transition');
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
    this.container.style.removeProperty('margin-top');
    this.container.style.removeProperty('transition');
    this.scrollEl.style.removeProperty('height');

    // Cancel WAAPI animations (Android)
    this.cancelAnimations();

    // Restore navbar + header
    this.clearNavbarInlines();
    this.navbarEl.style.removeProperty('will-change');
    this.clearHeaderInlines();

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

    // Auto-show near top — expanded zone while bridge is active AND user is
    // scrolling upward. During downward scroll, use normal zone to avoid
    // hide→auto-show cycling (bars hide at ~80px, well below totalShift).
    // accumulatedDelta reflects previous events (checked before update).
    const autoShowZone =
      !this.settled && this.barsHidden && this.accumulatedDelta < 0
        ? this.totalShift
        : FULL_SCREEN_TOP_ZONE;
    if (currentTop <= autoShowZone) {
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

    // Evaluate hide guard only when accumulated delta exceeds dead zone
    let canSettle = true;
    if (
      this.accumulatedDelta > FULL_SCREEN_HIDE_DEAD_ZONE &&
      !this.barsHidden
    ) {
      // Ensure totalShift is measured (mount-time getBoundingClientRect
      // returns 0 when CSS selectors don't match at construction time)
      this.measureTotalShift();

      // Skip hide on short views — pre-hide range must be ≥ 3× totalShift.
      // Hiding bars increases viewport by totalShift, shrinking the range
      // by the same amount. 3× ensures post-hide range (2× totalShift)
      // leaves meaningful scroll distance.
      const scrollableRange =
        this.scrollEl.scrollHeight - this.scrollEl.clientHeight;
      canSettle = scrollableRange >= 3 * this.totalShift;
    }

    if (
      this.accumulatedDelta > FULL_SCREEN_HIDE_DEAD_ZONE &&
      !this.barsHidden &&
      sustainMet &&
      canSettle
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
  // Measurement
  // ---------------------------------------------------------------------------

  /** Re-measure totalShift from live DOM. Only valid when full-screen-active
   *  is NOT on body (otherwise margin-top reads as 0 from the class rule). */
  private measureTotalShift(): void {
    if (this.body.classList.contains('full-screen-active')) return;
    this.originalMarginTop =
      parseFloat(getComputedStyle(this.viewContent).marginTop) || 0;
    const toolbar = this.viewContent
      .closest('.workspace-leaf-content')
      ?.querySelector<HTMLElement>('.bases-header');
    this.totalShift = this.originalMarginTop + (toolbar?.offsetHeight ?? 0);
  }

  // ---------------------------------------------------------------------------
  // Hide / Show logic
  // ---------------------------------------------------------------------------

  /** HIDE — immediate, momentum-safe */
  private hideBarsUI(): void {
    this.isActiveHider = true;

    // Remove full-screen-showing if rapid show→hide before idle
    this.body.classList.remove('full-screen-showing');

    // Cancel running WAAPI animations (rapid show→hide before finish)
    this.cancelAnimations();

    // Clear show-path inlines (rapid show→hide before idle)
    this.clearNavbarInlines();
    this.container.style.removeProperty('margin-top');
    this.container.style.removeProperty('transition');
    this.clearHeaderInlines();

    // Re-measure ONLY in clean state (no full screen classes).
    // During rapid show→hide, full-screen-active is still on body —
    // getComputedStyle would read margin-top: 0 (class rule) instead of ~99px.
    this.measureTotalShift();

    void capacitorStatusBar?.hide();

    // Navbar: animated hide via inline transform + opacity
    const navbarHeight = this.getNavbarHeight();
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

    if (this.isAndroid) {
      // Android: bridge-less — class + scrollTop in same synchronous tick.
      // Chromium's compositor-based scrolling is resilient to scrollTop
      // writes during active scroll (unlike iOS WebKit where they are fatal).
      // No bridge, no deferred settle, no false-bottom artifact.

      // Pin header at visible position via inline styles BEFORE class change.
      // CSS `transition: none !important` on .view-header prevents Obsidian's
      // native 0.3s transition from firing during the class change.
      if (this.viewHeaderEl) {
        setStyle(this.viewHeaderEl, 'transform', 'translateY(0)', 'important');
        setStyle(this.viewHeaderEl, 'opacity', '1', 'important');
      }

      const before = this.scrollEl.scrollTop;
      this.programmaticScroll = true;
      this.scrollEl.style.removeProperty('height');
      this.body.classList.add('full-screen-active');
      if (before >= this.totalShift) {
        this.scrollEl.scrollTop = before - this.totalShift;
      }
      this.settled = true;
      // Height relock deferred to idle — offsetHeight forces layout that
      // janks mid-animation if done during the 300ms animation window.
      this.pendingLayout = () => {
        this.lockedScrollHeight = this.scrollEl.offsetHeight;
        setStyle(this.scrollEl, 'height', `${this.lockedScrollHeight}px`);
        this.pendingLayout = null;
      };

      // WAAPI animations — compositor-promoted on Chromium. Unlike CSS
      // transitions (main-thread style recalc every frame), WAAPI creates
      // compositor-side KeyframeModels that interpolate on the GPU thread,
      // freeing the main thread for scroll event processing.
      const headerShift = this.getHeaderShift();
      this.pendingRafId = requestAnimationFrame(() => {
        this.programmaticScroll = false;
        this.prevScrollTop = this.scrollEl.scrollTop;

        // Cancel any running show animations
        this.navbarAnim?.cancel();
        this.headerAnim?.cancel();

        // Remove header pin — WAAPI overrides CSS from this frame.
        // Inline !important would beat WAAPI, so must be removed first.
        this.clearHeaderInlines();

        // Navbar WAAPI hide — fill: forwards holds final frame,
        // onfinish sets persistent inline state for post-animation CSS cascade
        this.navbarAnim = this.navbarEl.animate(
          [
            { transform: 'translateY(0)', opacity: 1 },
            { transform: `translateY(${navbarHeight}px)`, opacity: 0 },
          ],
          WAAPI_OPTS
        );
        setStyle(this.navbarEl, 'pointer-events', 'none', 'important');
        this.navbarAnim.onfinish = () => {
          applyNavbarHide();
        };

        // Header WAAPI hide
        if (this.viewHeaderEl) {
          const hEl = this.viewHeaderEl;
          this.headerAnim = hEl.animate(
            [
              { transform: 'translateY(0)', opacity: 1 },
              { transform: `translateY(-${headerShift}px)`, opacity: 0 },
            ],
            WAAPI_OPTS
          );
          setStyle(hEl, 'pointer-events', 'none', 'important');
          this.headerAnim.onfinish = () => {
            setStyle(
              hEl,
              'transform',
              `translateY(-${headerShift}px)`,
              'important'
            );
            setStyle(hEl, 'opacity', '0', 'important');
          };
        }
      });
      return;
    }

    // iOS: bridge + deferred settle (scrollTop writes kill momentum)
    setStyle(this.container, 'margin-top', `${this.totalShift}px`);
    setStyle(this.container, 'transition', 'none');
    this.body.classList.add('full-screen-active');
    this.settled = false;

    // WebKit needs double-rAF — passive scroll listener optimization
    // collapses transition+target into one style recalc if set in same frame.
    const iosNavTransition = `transform ${FULL_SCREEN_ANIM_MS}ms ease-out, opacity 200ms ease-out`;
    this.pendingRafId = requestAnimationFrame(() => {
      setStyle(this.navbarEl, 'transition', iosNavTransition, 'important');
      this.pendingRafId = requestAnimationFrame(applyNavbarHide);
    });

    // Idle settle: remove bridge + scrollTop -= totalShift
    this.pendingLayout = () => {
      const before = this.scrollEl.scrollTop;

      this.programmaticScroll = true;

      // Unlock → measure → relock. The 2s settle delay outlasts the iOS
      // scroll indicator fade, so the unlock-relock is invisible.
      this.scrollEl.style.removeProperty('height');
      this.container.style.removeProperty('margin-top');
      this.container.style.removeProperty('transition');
      // Clamp to 0 — near top, scrollTop can't fully compensate for
      // totalShift, but margin must still be removed.
      this.scrollEl.scrollTop = Math.max(0, before - this.totalShift);
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

    void capacitorStatusBar?.show();

    if (this.isAndroid) {
      // Android show: reverse bridge instead of scrollTop write.
      // scrollTop += totalShift forces synchronous layout (~25ms on Pixel,
      // >1 frame budget) which jank the reveal animation. Reverse bridge
      // (margin-top: -totalShift on scroll child) compensates visually
      // without forced layout. Same pattern as iOS settled show path.
      this.body.classList.add('full-screen-showing');

      this.programmaticScroll = true;
      if (this.settled) {
        setStyle(this.container, 'margin-top', `-${this.totalShift}px`);
        setStyle(this.container, 'transition', 'none');
      }

      // WAAPI animations — compositor-promoted on Chromium (same as hide).
      const navbarFrom =
        this.navbarEl.style.getPropertyValue('transform') ||
        `translateY(${this.getNavbarHeight()}px)`;
      const headerFrom =
        this.viewHeaderEl?.style.getPropertyValue('transform') ||
        `translateY(-${this.getHeaderShift()}px)`;

      this.pendingRafId = requestAnimationFrame(() => {
        this.programmaticScroll = false;
        this.prevScrollTop = this.scrollEl.scrollTop;

        // Cancel any running hide animations — removes fill: forwards hold
        this.navbarAnim?.cancel();
        this.headerAnim?.cancel();

        // Clear hide-path persistent inlines so WAAPI can override
        this.clearNavbarInlines();
        this.clearHeaderInlines();

        // Navbar WAAPI show
        this.navbarAnim = this.navbarEl.animate(
          [
            { transform: navbarFrom, opacity: 0 },
            { transform: 'translateY(0)', opacity: 1 },
          ],
          WAAPI_OPTS
        );
        this.navbarAnim.onfinish = () => {
          setStyle(this.navbarEl, 'transform', 'translateY(0)', 'important');
          setStyle(this.navbarEl, 'opacity', '1', 'important');
          this.navbarEl.style.removeProperty('pointer-events');
        };

        // Header WAAPI show
        if (this.viewHeaderEl) {
          const hEl = this.viewHeaderEl;
          this.headerAnim = hEl.animate(
            [
              { transform: headerFrom, opacity: 0 },
              { transform: 'translateY(0)', opacity: 1 },
            ],
            WAAPI_OPTS
          );
          this.headerAnim.onfinish = () => {
            setStyle(hEl, 'transform', 'translateY(0)', 'important');
            setStyle(hEl, 'opacity', '1', 'important');
            setStyle(hEl, 'pointer-events', 'auto', 'important');
          };
        }
      });

      // Idle: remove bridge + scrollTop adjust + class cleanup
      this.pendingLayout = () => {
        this.programmaticScroll = true;

        // Cancel WAAPI animations before removing classes
        this.cancelAnimations();

        this.scrollEl.style.removeProperty('height');
        this.container.style.removeProperty('margin-top');
        this.container.style.removeProperty('transition');
        if (this.settled) {
          this.scrollEl.scrollTop += this.totalShift;
        }
        this.body.classList.remove('full-screen-active', 'full-screen-showing');
        this.isActiveHider = false;
        this.settled = false;

        this.clearNavbarInlines();
        this.clearHeaderInlines();

        this.pendingRafId = requestAnimationFrame(() => {
          this.programmaticScroll = false;
          this.prevScrollTop = this.scrollEl.scrollTop;
          this.accumulatedDelta = 0;
          this.lockedScrollHeight = this.scrollEl.offsetHeight;
          setStyle(this.scrollEl, 'height', `${this.lockedScrollHeight}px`);
        });
      };
      return;
    }

    // iOS: bridge + deferred settle (scrollTop writes kill momentum)

    // Single class op — higher specificity overrides full-screen-active
    this.body.classList.add('full-screen-showing');

    // Bridge compensation — settled vs unsettled
    if (!this.settled) {
      // Hide bridge still active — remove it (bars returning, shift no longer needed).
      // Bridge removal + bar restoration cancel geometrically (zero net shift).
      this.container.style.removeProperty('margin-top');
      this.container.style.removeProperty('transition');
    }
    // Settled: no reverse bridge — content shifts down naturally as bars
    // appear (same as Safari address bar). Settle adjusts scrollTop at idle.

    // Navbar restore (inline — navbar is shared, not scoped to [data-type='bases'])
    setStyle(this.navbarEl, 'transform', 'translateY(0)', 'important');
    setStyle(this.navbarEl, 'opacity', '1', 'important');
    this.navbarEl.style.removeProperty('pointer-events');

    // Idle: remove classes + unlock → measure → relock height
    this.pendingLayout = () => {
      // Block all scroll events during settle — class removal and height
      // changes produce layout-induced scroll deltas on WebKit
      this.programmaticScroll = true;

      this.container.style.removeProperty('margin-top');
      this.container.style.removeProperty('transition');

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
      this.clearNavbarInlines();

      this.settled = false;

      this.pendingRafId = requestAnimationFrame(() => {
        this.programmaticScroll = false;
        this.prevScrollTop = this.scrollEl.scrollTop;
        this.accumulatedDelta = 0;
        this.lockedScrollHeight = this.scrollEl.offsetHeight;
        setStyle(this.scrollEl, 'height', `${this.lockedScrollHeight}px`);
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

    const isCard = target.closest('.card') != null;
    const isImage =
      target.closest('.card-cover') != null ||
      target.closest('.card-thumbnail') != null;
    const isOpenOnTitle = this.body.classList.contains(
      'dynamic-views-open-on-title'
    );
    const isTitleLink = target.closest('.card-title a') != null;

    // Don't reveal bars when tapping a card image — let image viewer handle it.
    // Exception: reveal if image viewer disabled via Style Settings AND
    // open file action is 'press on title' (image tap is non-interactive).
    if (isImage) {
      const viewerDisabled = this.body.classList.contains(
        'dynamic-views-image-viewer-disabled'
      );
      if (!viewerDisabled || !isOpenOnTitle) return;
    }

    // Poster cards with images: tap toggles poster-revealed — never reveal bars
    if (target.closest('.image-format-poster.has-poster')) return;

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

  /** Header + safe area height — used for Android header hide animation */
  private getHeaderShift(): number {
    const bodyCS = getComputedStyle(this.body);
    return (
      (parseFloat(bodyCS.getPropertyValue('--view-header-height')) || 44) +
      (parseFloat(bodyCS.getPropertyValue('--safe-area-inset-top')) || 47)
    );
  }
}
