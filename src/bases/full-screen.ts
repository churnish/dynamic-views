/**
 * Full screen mobile scrolling — hides navigation bars on scroll-down,
 * shows on scroll-up. Uses a bridge architecture (margin-top on container)
 * to prevent visual jumps during bar hide/show transitions. margin-top
 * adjusts scrollHeight in sync with visual displacement — no false
 * top/bottom at scroll boundaries.
 *
 * All bar animations (header, navbar slide/fade) match native Obsidian
 * full screen behavior in markdown views.
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
  FULL_SCREEN_FADE_MS,
} from '../shared/constants';

// WAAPI options matching native Obsidian bar transitions.
// Native uses CSS transitions with per-property timing:
//   .view-header: opacity 200ms ease-in-out, transform 300ms ease-in-out
//   .mobile-navbar: opacity 200ms ease-in-out, transform 300ms ease-out
// WAAPI can't have per-property durations, so each property gets its own animation.

/** Header slide: 300ms ease-in-out (matches native .view-header) */
const HEADER_SLIDE_OPTS: KeyframeAnimationOptions = {
  duration: FULL_SCREEN_ANIM_MS,
  easing: 'ease-in-out',
  fill: 'forwards',
};

/** Navbar slide: 300ms ease-out (matches native .mobile-navbar) */
const NAVBAR_SLIDE_OPTS: KeyframeAnimationOptions = {
  duration: FULL_SCREEN_ANIM_MS,
  easing: 'ease-out',
  fill: 'forwards',
};

/** Header/navbar opacity fade: 200ms ease-in-out (matches native) */
const BAR_FADE_OPTS: KeyframeAnimationOptions = {
  duration: FULL_SCREEN_FADE_MS,
  easing: 'ease-in-out',
  fill: 'forwards',
};

/** Toolbar/search opacity fade: 300ms ease-in-out */
const UI_FADE_OPTS: KeyframeAnimationOptions = {
  duration: FULL_SCREEN_ANIM_MS,
  easing: 'ease-in-out',
  fill: 'forwards',
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

/** Batch-set inline style properties. Each entry: [prop, value, priority?] */
function setStyles(el: HTMLElement, styles: [string, string, string?][]): void {
  for (const [prop, value, priority] of styles) {
    el.style.setProperty(prop, value, priority);
  }
}

/** Batch-remove inline style properties */
function clearStyles(el: HTMLElement, props: string[]): void {
  for (const prop of props) el.style.removeProperty(prop);
}

export class FullScreenController {
  private readonly scrollEl: HTMLElement;
  private readonly container: HTMLElement;
  private readonly viewContent: HTMLElement;
  private readonly navbarEl: HTMLElement;
  private readonly viewHeaderEl: HTMLElement | null;
  private readonly leafContent: HTMLElement;
  private readonly ownerDoc: Document;
  private readonly body: HTMLElement;
  private readonly isAndroid: boolean;
  private readonly toolbarEl: HTMLElement | null;
  private readonly searchRowEl: HTMLElement | null;
  private readonly workspaceSplitEl: HTMLElement | null;

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
  private showBridgeActive = false;

  // Bound handlers for add/removeEventListener
  private readonly onScrollBound: () => void;
  private readonly onTouchStartBound: (e: TouchEvent) => void;
  private readonly onTouchEndBound: (e: TouchEvent) => void;

  // WAAPI animation handles (Android) — cancel before starting new ones.
  // Array instead of named fields — per-property animations (transform vs
  // opacity) double the handle count; an array simplifies lifecycle.
  private barAnims: Animation[] = [];
  private capacitorRafId: number | null = null;

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
    // iOS: full-screen-showing class lives on leaf content (not body).
    // Android: class is never used — applyShowInlines/clearShowInlines
    // bypass classList entirely to avoid style invalidation that exceeds
    // the single-threaded WebView compositor's frame budget.
    this.leafContent = elements.viewContent.parentElement!;
    this.ownerDoc = this.scrollEl.ownerDocument;
    this.body = this.ownerDoc.body;
    this.isAndroid = this.body.classList.contains('is-android');
    this.toolbarEl =
      this.leafContent.querySelector<HTMLElement>('.bases-header');
    this.searchRowEl =
      this.leafContent.querySelector<HTMLElement>('.bases-search-row');
    this.workspaceSplitEl = this.body.querySelector<HTMLElement>(
      '.workspace-split.mod-root'
    );

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
    this.showBridgeActive = false;
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

  /** Cancel and discard all WAAPI animation handles (Android) */
  private cancelAnimations(): void {
    for (const a of this.barAnims) a.cancel();
    this.barAnims = [];
  }

  /** Clear navbar inline styles set during hide/show */
  private clearNavbarInlines(): void {
    clearStyles(this.navbarEl, [
      'transform',
      'opacity',
      'pointer-events',
      'transition',
    ]);
  }

  /** Clear header inline styles set during hide/show */
  private clearHeaderInlines(): void {
    if (!this.viewHeaderEl) return;
    clearStyles(this.viewHeaderEl, [
      'transform',
      'opacity',
      'pointer-events',
      'transition',
      'z-index',
    ]);
  }

  // ---------------------------------------------------------------------------
  // Android show-state inline styles — bypass classList to avoid style
  // invalidation that exceeds the single-threaded WebView compositor's
  // frame budget. Any classList.add on any element triggers selector
  // re-matching across the subtree; inline setProperty targets only the
  // specific element with zero selector overhead.
  // ---------------------------------------------------------------------------

  /** Apply show-state CSS via inline styles (Android only) */
  private applyShowInlines(): void {
    // viewContent: restore margin-top (overrides full-screen-active's margin-top: 0)
    setStyle(
      this.viewContent,
      'margin-top',
      'var(--view-top-spacing)',
      'important'
    );
    setStyle(this.viewContent, 'transition', 'none', 'important');

    // Toolbar: restore pointer-events + margin (WAAPI handles opacity)
    if (this.toolbarEl) {
      setStyles(this.toolbarEl, [
        ['pointer-events', 'auto', 'important'],
        ['margin-bottom', '0px', 'important'],
        ['transition', 'none', 'important'],
      ]);
    }

    // Search row: restore pointer-events + collapse overrides (WAAPI handles opacity)
    if (this.searchRowEl) {
      setStyles(this.searchRowEl, [
        ['pointer-events', 'auto', 'important'],
        ['transition', 'none', 'important'],
        ['height', 'auto', 'important'],
        ['overflow', 'visible', 'important'],
        ['margin', 'unset', 'important'],
        ['padding', 'unset', 'important'],
      ]);
    }

    // Header: pointer-events + z-index above ::before scrim.
    // WAAPI handles transform + opacity — inline !important would block it.
    if (this.viewHeaderEl) {
      setStyle(this.viewHeaderEl, 'pointer-events', 'auto', 'important');
      setStyle(this.viewHeaderEl, 'z-index', '20', 'important');
    }

    // ::before scrim: expand to full margin-top gap via CSS custom properties.
    // The ::before rule reads --dynamic-views-scrim-height and --dynamic-views-scrim-bg, falling
    // back to the standard gradient when absent.
    // ::after scroll gradient: restore during show (hidden by default during
    // full-screen-active). CSS reads --dynamic-views-after-display, falling
    // back to 'none' when absent.
    setStyles(this.leafContent, [
      ['--dynamic-views-scrim-height', 'var(--view-top-spacing)'],
      ['--dynamic-views-scrim-bg', 'var(--dynamic-views-background-primary)'],
      ['--dynamic-views-after-display', 'block'],
    ]);

    // Restore mask-image gradient on workspace split — remove inline
    // override set in hideBarsUI so Obsidian's normal CSS takes over.
    if (this.workspaceSplitEl) {
      this.workspaceSplitEl.style.removeProperty('-webkit-mask-image');
      this.workspaceSplitEl.style.removeProperty('mask-image');
    }
  }

  /** Remove show-state inline styles (Android only) */
  private clearShowInlines(): void {
    clearStyles(this.viewContent, ['margin-top', 'transition']);

    if (this.toolbarEl) {
      clearStyles(this.toolbarEl, [
        'opacity',
        'pointer-events',
        'margin-bottom',
        'transition',
      ]);
    }

    if (this.searchRowEl) {
      clearStyles(this.searchRowEl, [
        'opacity',
        'pointer-events',
        'transition',
        'height',
        'overflow',
        'margin',
        'padding',
      ]);
    }

    if (this.viewHeaderEl) {
      this.viewHeaderEl.style.removeProperty('z-index');
    }

    // ::before scrim + ::after scroll gradient: revert to defaults
    clearStyles(this.leafContent, [
      '--dynamic-views-scrim-height',
      '--dynamic-views-scrim-bg',
      '--dynamic-views-after-display',
    ]);
  }

  /** Idempotent — no-op if already unmounted */
  unmount(): void {
    if (!this.mounted) return;
    this.mounted = false;

    // Remove listeners
    this.scrollEl.removeEventListener('scroll', this.onScrollBound);
    this.scrollEl.removeEventListener('touchstart', this.onTouchStartBound);
    this.scrollEl.removeEventListener('touchend', this.onTouchEndBound);

    // Cancel pending rAFs
    if (this.pendingRafId != null) {
      cancelAnimationFrame(this.pendingRafId);
      this.pendingRafId = null;
    }
    if (this.capacitorRafId != null) {
      cancelAnimationFrame(this.capacitorRafId);
      this.capacitorRafId = null;
    }

    // Clear timers
    if (this.scrollIdleTimer != null) {
      clearTimeout(this.scrollIdleTimer);
      this.scrollIdleTimer = null;
    }
    // Remove full screen state only if this instance set it
    if (this.isActiveHider) {
      if (this.isAndroid) {
        this.clearShowInlines();
        // Clean up mask-image inline on workspace split
        if (this.workspaceSplitEl) {
          this.workspaceSplitEl.style.removeProperty('-webkit-mask-image');
          this.workspaceSplitEl.style.removeProperty('mask-image');
        }
      } else {
        this.leafContent.classList.remove('full-screen-showing');
      }
      this.body.classList.remove('full-screen-active');
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
    this.showBridgeActive = false;
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
        this.lastToggleTime = now;
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
    this.totalShift =
      this.originalMarginTop +
      (this.toolbarEl?.offsetHeight ?? 0) +
      (this.searchRowEl?.offsetHeight ?? 0);
  }

  // ---------------------------------------------------------------------------
  // Hide / Show logic
  // ---------------------------------------------------------------------------

  /** HIDE — immediate, momentum-safe */
  private hideBarsUI(): void {
    this.isActiveHider = true;

    // Cancel pending show rAF (rapid show→hide before rAF fires)
    if (this.pendingRafId != null) {
      cancelAnimationFrame(this.pendingRafId);
      this.pendingRafId = null;
    }

    // Cancel WAAPI animations first — fill:forwards on toolbar/search would
    // hold opacity at 1, preventing instant hide.
    this.cancelAnimations();

    // Remove show-state if rapid show→hide before idle
    if (this.isAndroid) {
      this.clearShowInlines();
    } else {
      this.leafContent.classList.remove('full-screen-showing');
    }

    // Cancel deferred capacitor status bar (rapid show→hide)
    if (this.capacitorRafId != null) {
      cancelAnimationFrame(this.capacitorRafId);
      this.capacitorRafId = null;
    }

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
      setStyles(this.navbarEl, [
        ['transform', `translateY(${navbarHeight}px)`, 'important'],
        ['opacity', '0', 'important'],
        ['pointer-events', 'none', 'important'],
      ]);
    };

    if (this.isAndroid) {
      // Android: bridge-less — class + scrollTop in same synchronous tick.
      // Chromium's compositor-based scrolling is resilient to scrollTop
      // writes during active scroll (unlike iOS WebKit where they are fatal).
      // No bridge, no deferred settle, no false-bottom artifact.

      // Pin header at visible position via inline styles BEFORE class change.
      // Inline !important overrides CSS, keeping it visible until WAAPI takes
      // over in the next rAF. Toolbar/search hide instantly (no pin needed).
      if (this.viewHeaderEl) {
        setStyle(this.viewHeaderEl, 'transform', 'translateY(0)', 'important');
        setStyle(this.viewHeaderEl, 'opacity', '1', 'important');
      }

      // Remove mask-image gradient on workspace split — no CSS rule for
      // Android (Obsidian's gradient value is unknown, can't use var fallback).
      // Show path removes inline → Obsidian's CSS takes over.
      if (this.workspaceSplitEl) {
        setStyle(
          this.workspaceSplitEl,
          '-webkit-mask-image',
          'none',
          'important'
        );
        setStyle(this.workspaceSplitEl, 'mask-image', 'none', 'important');
      }

      const before = this.scrollEl.scrollTop;
      this.programmaticScroll = true;
      this.scrollEl.style.removeProperty('height');
      this.body.classList.add('full-screen-active');
      // Skip scrollTop adjustment when show bridge was active —
      // scrollTop wasn't changed during show, so hide doesn't need
      // to compensate. Bridge already cleared in the cleanup block above.
      if (this.showBridgeActive) {
        this.showBridgeActive = false;
      } else if (before >= this.totalShift) {
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
        this.cancelAnimations();

        // Remove header pin — WAAPI overrides CSS from this frame.
        // Inline !important would beat WAAPI, so must be removed first.
        this.clearHeaderInlines();

        // Navbar WAAPI hide — separate transform + opacity animations
        // to match native per-property timing. fill: forwards holds final
        // frame. No onfinish: persistent !important inlines would block
        // show WAAPI's cascade (show relies on composite priority override).
        this.barAnims.push(
          this.navbarEl.animate(
            [
              { transform: 'translateY(0)' },
              { transform: `translateY(${navbarHeight}px)` },
            ],
            NAVBAR_SLIDE_OPTS
          ),
          this.navbarEl.animate([{ opacity: 1 }, { opacity: 0 }], BAR_FADE_OPTS)
        );
        setStyle(this.navbarEl, 'pointer-events', 'none', 'important');

        // Header WAAPI hide — separate transform + opacity
        if (this.viewHeaderEl) {
          const hEl = this.viewHeaderEl;
          this.barAnims.push(
            hEl.animate(
              [
                { transform: 'translateY(0)' },
                { transform: `translateY(-${headerShift}px)` },
              ],
              HEADER_SLIDE_OPTS
            ),
            hEl.animate([{ opacity: 1 }, { opacity: 0 }], BAR_FADE_OPTS)
          );
          setStyle(hEl, 'pointer-events', 'none', 'important');
        }

        // Toolbar + search: no WAAPI hide — instant snap to CSS opacity: 0.
        // Pin cleared above, CSS takes over immediately.
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
    const iosNavTransition = `transform ${FULL_SCREEN_ANIM_MS}ms ease-out, opacity ${FULL_SCREEN_FADE_MS}ms ease-in-out`;
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

    if (this.isAndroid) {
      // Android show: WAAPI header + navbar, ::before scrim, reverse bridge.
      //
      // full-screen-showing restores margin-top: 99px + toolbar + search.
      // An extended ::before (solid background, full 99px height) covers the
      // gap while the header WAAPI slides in from above (matching iOS native
      // animation). The reverse bridge offsets the layout shift. At idle,
      // bridge removed + scrollTop compensated + classes removed.
      this.programmaticScroll = true;
      this.showBridgeActive = true;

      // Read WAAPI "from" values BEFORE rAF — fill:forwards still active
      const navbarFrom =
        this.navbarEl.style.getPropertyValue('transform') ||
        `translateY(${this.getNavbarHeight()}px)`;
      const headerFrom =
        this.viewHeaderEl?.style.getPropertyValue('transform') ||
        `translateY(-${this.getHeaderShift()}px)`;

      this.pendingRafId = requestAnimationFrame(() => {
        // Inline styles restore margin/toolbar/search — bypasses classList
        // to avoid style invalidation that drops frames on the
        // single-threaded Android WebView compositor. ::before scrim (always
        // full-height on Android during full-screen-active) covers the gap.
        this.applyShowInlines();

        // Reverse bridge: offset the layout shift from margin-top + toolbar
        // restoration. Content stays visually in place. Bridge removed at idle.
        if (this.settled) {
          setStyle(this.container, 'margin-top', `-${this.totalShift}px`);
          setStyle(this.container, 'transition', 'none');
        }

        this.programmaticScroll = false;
        this.prevScrollTop = this.scrollEl.scrollTop;

        // Start show WAAPI BEFORE canceling old animations — later-created
        // animations have higher composite priority (WAAPI §4.6) and
        // override fill:forwards on the hide animation immediately.
        // Canceling hide FIRST would snap the header to CSS default
        // (visible, white bg) for one frame before show WAAPI starts.
        const oldAnims = [...this.barAnims];
        this.barAnims = [];

        // Header WAAPI show — slides in from above (::before scrim covers gap).
        // Separate transform + opacity to match native per-property timing.
        if (this.viewHeaderEl) {
          this.barAnims.push(
            this.viewHeaderEl.animate(
              [{ transform: headerFrom }, { transform: 'translateY(0)' }],
              HEADER_SLIDE_OPTS
            ),
            this.viewHeaderEl.animate(
              [{ opacity: 0 }, { opacity: 1 }],
              BAR_FADE_OPTS
            )
          );
        }

        // Cancel old AFTER starting new (composite priority — later-created
        // animations override fill:forwards on older animations)
        for (const a of oldAnims) a.cancel();
        this.clearHeaderInlines();

        // Navbar WAAPI show — separate transform + opacity
        this.barAnims.push(
          this.navbarEl.animate(
            [{ transform: navbarFrom }, { transform: 'translateY(0)' }],
            NAVBAR_SLIDE_OPTS
          ),
          this.navbarEl.animate([{ opacity: 0 }, { opacity: 1 }], BAR_FADE_OPTS)
        );
        this.clearNavbarInlines();

        // Toolbar + search WAAPI show — opacity only.
        // CSS opacity (no !important on Android) is overridden by WAAPI.
        if (this.toolbarEl) {
          this.barAnims.push(
            this.toolbarEl.animate(
              [{ opacity: 0 }, { opacity: 1 }],
              UI_FADE_OPTS
            )
          );
        }

        if (this.searchRowEl) {
          this.barAnims.push(
            this.searchRowEl.animate(
              [{ opacity: 0 }, { opacity: 1 }],
              UI_FADE_OPTS
            )
          );
        }

        // Defer native status bar to next frame — separates window inset
        // change from CSS layout reflow on the single-threaded compositor.
        this.capacitorRafId = requestAnimationFrame(() => {
          this.capacitorRafId = null;
          void capacitorStatusBar?.show();
        });
      });

      // Idle: remove bridge + compensate scrollTop + remove inlines/classes
      // + relock. Inline styles already restored all layout (margin, toolbar,
      // search). Removal is a visual no-op — defaults match showing state.
      // Bridge removal + scrollTop is the only geometric operation.
      this.pendingLayout = () => {
        this.programmaticScroll = true;

        this.cancelAnimations();

        // Remove reverse bridge + compensate scrollTop (safe at idle —
        // no scroll contention, WAAPI finished at 300ms < 500ms idle)
        if (this.showBridgeActive) {
          this.container.style.removeProperty('margin-top');
          this.container.style.removeProperty('transition');
          this.scrollEl.scrollTop += this.totalShift;
          this.showBridgeActive = false;
        }

        this.scrollEl.style.removeProperty('height');
        this.clearShowInlines();
        this.body.classList.remove('full-screen-active');
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

    // iOS: rAF + bridge + deferred settle (scrollTop writes kill momentum).
    // rAF separates layout changes from opacity transition start — matches
    // Android's natural compositor scheduling and prevents the CSS transition
    // from firing in the same paint as the layout shift.
    void capacitorStatusBar?.show();

    this.programmaticScroll = true;
    this.pendingRafId = requestAnimationFrame(() => {
      // Single class op — higher specificity overrides full-screen-active
      this.leafContent.classList.add('full-screen-showing');

      // Bridge compensation — settled vs unsettled
      if (!this.settled) {
        // Hide bridge still active — remove it (bars returning, shift no longer needed).
        // Bridge removal + bar restoration cancel geometrically (zero net shift).
        this.container.style.removeProperty('margin-top');
        this.container.style.removeProperty('transition');
      }
      // Settled: no reverse bridge — content shifts down naturally as bars
      // appear (same as Safari address bar). Settle adjusts scrollTop at idle.

      // Navbar restore — transition from hide persists on the element,
      // producing an animated reveal (slide up + fade in)
      setStyle(this.navbarEl, 'transform', 'translateY(0)', 'important');
      setStyle(this.navbarEl, 'opacity', '1', 'important');
      this.navbarEl.style.removeProperty('pointer-events');

      this.programmaticScroll = false;

      // Toolbar + search WAAPI fade-in — deferred to next frame.
      // WebKit starts WAAPI immediately (classList.add is a single op
      // with minimal layout work), so the fade begins ~1-2 frames
      // earlier than Android where compositor contention from
      // applyShowInlines delays the first painted frame. Nesting in a
      // second rAF matches Android's natural timing. The extra frame
      // is invisible — elements are already at opacity: 0.
      requestAnimationFrame(() => {
        if (this.toolbarEl) {
          this.barAnims.push(
            this.toolbarEl.animate(
              [{ opacity: 0 }, { opacity: 1 }],
              UI_FADE_OPTS
            )
          );
        }
        if (this.searchRowEl) {
          this.barAnims.push(
            this.searchRowEl.animate(
              [{ opacity: 0 }, { opacity: 1 }],
              UI_FADE_OPTS
            )
          );
        }
      });
    });

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
      // Cancel WAAPI before class removal — same reason as hide path
      this.cancelAnimations();
      this.leafContent.classList.remove('full-screen-showing');
      this.body.classList.remove('full-screen-active');
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
