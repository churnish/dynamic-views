/**
 * Full screen mobile scrolling — hides navigation bars on scroll-down,
 * shows on scroll-up. iOS uses a bridge architecture (margin-top on
 * scroll child) to defer layout mutations until scroll-idle. Android
 * uses direct scrollTop compensation + WAAPI animations (no bridge).
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

  // Bound handlers for add/removeEventListener
  private readonly onScrollBound: () => void;
  private readonly onTouchStartBound: (e: TouchEvent) => void;
  private readonly onTouchEndBound: (e: TouchEvent) => void;
  private readonly onHeaderTapBound: () => void;

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
    this.onHeaderTapBound = (): void => this.onHeaderTap();
  }

  /** Idempotent — no-op if already mounted */
  mount(): void {
    if (this.mounted) return;

    // Guard: requires auto-full-screen (Obsidian mobile full-screen setting)
    if (!this.body.classList.contains('auto-full-screen')) return;

    this.mounted = true;
    this.container.classList.add('dynamic-views-full-screen-enabled');

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

    // Scroll range padding — mirrors native CM6 scrollPastEnd (~50% pane).
    // Set as CSS variable so the margin-bottom calc in _container.scss adapts
    // to actual pane height instead of fixed ~200px.
    const scrollPadding = Math.round(this.scrollEl.clientHeight * 0.5);
    setStyle(
      this.container,
      '--dynamic-views-scroll-past-end',
      `${scrollPadding}px`
    );

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
    if (this.viewHeaderEl) {
      this.viewHeaderEl.addEventListener('touchend', this.onHeaderTapBound, {
        passive: true,
      });
    }
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

  /** Restore mask-image gradient on workspace split — remove inline override */
  private restoreMaskImage(): void {
    if (!this.workspaceSplitEl) return;
    this.workspaceSplitEl.style.removeProperty('-webkit-mask-image');
    this.workspaceSplitEl.style.removeProperty('mask-image');
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
      'margin-top',
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
    // ::before scrim + ::after scroll gradient: data attribute triggers CSS
    // rules that expand the scrim and show the gradient. Attribute changes
    // only recalc selectors containing [data-dynamic-views-show] (::before/::after
    // pseudos) — no descendant invalidation. Custom properties on leafContent
    // would inherit to every card, triggering subtree-wide style recalc that
    // exceeds the single-threaded WebView compositor's frame budget.
    this.leafContent.setAttribute('data-dynamic-views-show', '');

    // viewContent: restore margin-top (overrides full-screen-active's margin-top: 0)
    setStyle(
      this.viewContent,
      'margin-top',
      'var(--dynamic-views-view-top-spacing)',
      'important'
    );
    setStyle(this.viewContent, 'transition', 'none', 'important');

    // Toolbar: restore layout + opacity. Inline opacity (no !important) overrides
    // CSS opacity:0 in the cascade (inline > author). WAAPI animates on top —
    // first keyframe (0) overrides the inline during animation, fill:forwards
    // holds final value. Inline opacity:1 is the durable fallback after WAAPI
    // completes — Android WebView's compositor doesn't reliably hold fill:forwards
    // against CSS opacity:0 + will-change:opacity.
    if (this.toolbarEl) {
      setStyle(this.toolbarEl, 'opacity', '1');
      setStyles(this.toolbarEl, [
        ['pointer-events', 'auto', 'important'],
        ['margin-bottom', '0px', 'important'],
        ['transition', 'none', 'important'],
      ]);
    }

    // Search row: same opacity pattern as toolbar
    if (this.searchRowEl) {
      setStyle(this.searchRowEl, 'opacity', '1');
      setStyles(this.searchRowEl, [
        ['pointer-events', 'auto', 'important'],
        ['transition', 'none', 'important'],
        ['height', 'auto', 'important'],
        ['overflow', 'visible', 'important'],
        ['margin', 'unset', 'important'],
        ['padding', 'unset', 'important'],
      ]);
    }

    // Header: pointer-events + z-index above ::before scrim (z-index 25 on
    // grouped). z-index 30 ensures header WAAPI slides above the scrim without
    // needing a --dynamic-views-scrim-z custom property (which would inherit to
    // all descendants, adding style recalc overhead that exceeds the Android
    // WebView compositor frame budget — see §7.1.38).
    if (this.viewHeaderEl) {
      setStyle(this.viewHeaderEl, 'pointer-events', 'auto', 'important');
      setStyle(this.viewHeaderEl, 'z-index', '30', 'important');
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

    // ::before scrim + ::after scroll gradient: revert to CSS defaults
    this.leafContent.removeAttribute('data-dynamic-views-show');
  }

  /** Idempotent — no-op if already unmounted */
  unmount(): void {
    if (!this.mounted) return;
    this.mounted = false;

    // Remove listeners
    this.scrollEl.removeEventListener('scroll', this.onScrollBound);
    this.scrollEl.removeEventListener('touchstart', this.onTouchStartBound);
    this.scrollEl.removeEventListener('touchend', this.onTouchEndBound);
    if (this.viewHeaderEl) {
      this.viewHeaderEl.removeEventListener('touchend', this.onHeaderTapBound);
    }
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
      } else {
        this.leafContent.classList.remove('full-screen-showing');
      }
      this.restoreMaskImage();
      this.body.classList.remove('full-screen-active');
      void capacitorStatusBar?.show();
      this.isActiveHider = false;
    }
    // Clean up bridge + locked height + padding class
    this.container.classList.remove('dynamic-views-full-screen-enabled');
    this.container.style.removeProperty('margin-top');
    this.container.style.removeProperty('transition');
    this.container.style.removeProperty('--dynamic-views-scroll-past-end');
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

    // Cooldown prevents rapid cycling (deceleration bounce, layout-induced deltas).
    // Checked BEFORE auto-show — on short views, Android bridge-less hide adjusts
    // scrollTop to 0, which would trigger auto-show on the very next event.
    if (now - this.lastToggleTime < FULL_SCREEN_TOGGLE_COOLDOWN_MS) {
      this.accumulatedDelta = 0;
      return;
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
      // Only auto-show when user is scrolling UP or stationary — not during
      // active downward scroll. Android bridge-less hide can land scrollTop
      // at 0 (Math.max clamp), which would trigger auto-show on the next
      // event if the user is still scrolling down post-hide.
      if (this.barsHidden && delta <= 0) {
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
      // Ensure totalShift is measured (mount-time getBoundingClientRect
      // returns 0 when CSS selectors don't match at construction time)
      this.measureTotalShift();
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

    // Cancel WAAPI animations — must be AFTER clearShowInlines so
    // fill:forwards removal doesn't flash elements visible before
    // inlines are cleared.
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

    // Remove mask-image gradient on workspace split. Inline styles instead
    // of CSS — :has() upward invalidation kills iOS momentum scroll.
    // Show path removes inline → Obsidian's normal CSS takes over.
    if (this.workspaceSplitEl) {
      setStyle(
        this.workspaceSplitEl,
        '-webkit-mask-image',
        'none',
        'important'
      );
      setStyle(this.workspaceSplitEl, 'mask-image', 'none', 'important');
    }

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

      // Pin header + toolbar + search at visible position via inline styles
      // BEFORE class change. Inline !important overrides CSS, keeping elements
      // visible until WAAPI takes over in the next rAF.
      if (this.viewHeaderEl) {
        setStyle(this.viewHeaderEl, 'transform', 'translateY(0)', 'important');
        setStyle(this.viewHeaderEl, 'opacity', '1', 'important');
      }
      if (this.toolbarEl) {
        setStyle(this.toolbarEl, 'opacity', '1', 'important');
      }
      if (this.searchRowEl) {
        setStyle(this.searchRowEl, 'opacity', '1', 'important');
      }

      const before = this.scrollEl.scrollTop;
      this.programmaticScroll = true;
      this.scrollEl.style.removeProperty('height');
      this.body.classList.add('full-screen-active');
      // Clamp to 0 when near top — the skip guard (before >= totalShift)
      // left scrollTop unchanged, making the first totalShift px of content
      // inaccessible after hide. The auto-show delta<=0 check prevents the
      // scrollTop=0 landing from triggering auto-show on the next event.
      this.scrollEl.scrollTop = Math.max(0, before - this.totalShift);
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

        // Remove header + toolbar + search pins — WAAPI overrides CSS
        // from this frame. Inline !important would beat WAAPI, so must
        // be removed first.
        this.clearHeaderInlines();
        if (this.toolbarEl) this.toolbarEl.style.removeProperty('opacity');
        if (this.searchRowEl) this.searchRowEl.style.removeProperty('opacity');

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
          const headerTransformAnim = hEl.animate(
            [
              { transform: 'translateY(0)' },
              { transform: `translateY(-${headerShift}px)` },
            ],
            HEADER_SLIDE_OPTS
          );
          this.barAnims.push(
            headerTransformAnim,
            hEl.animate([{ opacity: 1 }, { opacity: 0 }], BAR_FADE_OPTS)
          );
          headerTransformAnim.onfinish = () => {
            // Snap header back to natural position — invisible tap shield
            // matching native Obsidian full-screen. fill:forwards held the
            // header off-screen; clearing transform returns it to the top
            // ~90px zone where it absorbs taps without content interaction.
            // margin-top:0 overrides Obsidian's safe-area-inset-top margin
            // so the shield covers the full zone from y=0.
            setStyle(hEl, 'transform', 'translateY(0)', 'important');
            setStyle(hEl, 'opacity', '0', 'important');
            setStyle(hEl, 'margin-top', '0', 'important');
          };
        }

        // Toolbar + search WAAPI hide — opacity only. WAAPI fill:forwards
        // is required so show WAAPI wins by composite ordering (newer wins,
        // WAAPI §4.6). Without a hide WAAPI, show's fill:forwards competes
        // with CSS opacity:0 + will-change:opacity — Android WebView's
        // compositor collapses back to CSS after animation completes.
        if (this.toolbarEl) {
          this.barAnims.push(
            this.toolbarEl.animate(
              [{ opacity: 1 }, { opacity: 0 }],
              UI_FADE_OPTS
            )
          );
        }
        if (this.searchRowEl) {
          this.barAnims.push(
            this.searchRowEl.animate(
              [{ opacity: 1 }, { opacity: 0 }],
              UI_FADE_OPTS
            )
          );
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

      // Snap header to tap-shield position — invisible but absorbing taps
      // in the status bar zone. CSS transform animated it off-screen;
      // inline override returns it to natural position after settle.
      // margin-top:0 overrides Obsidian's safe-area-inset-top margin
      // so the shield covers the full zone from y=0.
      if (this.viewHeaderEl) {
        setStyle(this.viewHeaderEl, 'transform', 'translateY(0)', 'important');
        setStyle(this.viewHeaderEl, 'opacity', '0', 'important');
        setStyle(this.viewHeaderEl, 'margin-top', '0', 'important');
      }

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
      // Android show: WAAPI header + navbar, ::before scrim, direct scrollTop.
      //
      // applyShowInlines restores margin-top + toolbar + search. The ::before
      // scrim (solid background, full height) covers the gap while the header
      // WAAPI slides in. scrollTop += totalShift compensates the layout shift
      // directly — no reverse bridge needed. This kills any active compositor
      // fling, but the previous reverse bridge approach also killed flings
      // (via its scrollTop write near the top) AND created a false ceiling.
      // Direct compensation trades potential show-time jank (~1 frame) for
      // no false top at all.
      this.programmaticScroll = true;

      // Clear tap-shield inlines before reading "from" values — onfinish
      // sets transform:translateY(0) + opacity:0 + margin-top:0 which would
      // be read as the animation start, producing a fade-only (no slide).
      if (this.viewHeaderEl) {
        this.viewHeaderEl.style.removeProperty('transform');
        this.viewHeaderEl.style.removeProperty('opacity');
        this.viewHeaderEl.style.removeProperty('margin-top');
      }

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

        // Direct scrollTop compensation — shifts scroll position to match
        // the layout shift from margin-top restoration. Kills the compositor
        // fling but eliminates the false ceiling entirely.
        if (this.settled) {
          this.scrollEl.scrollTop += this.totalShift;
        }

        // Unlock height lock — bars-hidden height is now stale.
        this.scrollEl.style.removeProperty('height');

        // Restore mask-image gradient on workspace split — safe in show rAF
        // now that the reverse bridge is eliminated (no budget constraint).
        // Previously deferred to idle, causing ~1s delay for the navbar
        // gradient to appear.
        this.restoreMaskImage();

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
        // Restore z-index — clearHeaderInlines removes it but header must stay
        // above ::before scrim (z-index 25 on grouped) during show animation.
        if (this.viewHeaderEl) {
          setStyle(this.viewHeaderEl, 'z-index', '30', 'important');
        }

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

      // Idle: remove inlines/classes + relock. Inline styles already restored
      // all layout (margin, toolbar, search) and scrollTop was compensated
      // in the show rAF. Removal is a visual no-op — defaults match showing
      // state. No bridge to remove.
      this.pendingLayout = () => {
        this.programmaticScroll = true;

        this.cancelAnimations();

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

    // iOS: synchronous layout + rAF animation + deferred settle.
    // Layout MUST be synchronous (same frame as scroll event) — deferring
    // to rAF creates two consecutive compositor pauses that kill momentum.
    // The hide path follows the same pattern: synchronous layout, rAF animation.
    void capacitorStatusBar?.show();

    // Synchronous layout — single compositor pause, UIScrollView resumes
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

    // mask-image restore deferred to idle — removing the inline on
    // .workspace-split.mod-root triggers subtree repaint that kills momentum.

    // Toolbar + search WAAPI fade-in — deferred to rAF.
    // WAAPI is compositor-driven (no continuous main-thread work).
    this.pendingRafId = requestAnimationFrame(() => {
      if (this.toolbarEl) {
        this.barAnims.push(
          this.toolbarEl.animate([{ opacity: 0 }, { opacity: 1 }], UI_FADE_OPTS)
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

      this.restoreMaskImage();

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

    // Group collapse region: chevron + property + value trigger fold/unfold
    if (target.closest('.bases-group-collapse-region')) return;

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
      this.lastToggleTime = Date.now();
      this.showBarsUI();
    }
  }

  /** Tap on invisible view-header (status bar zone) — reveal bars */
  private onHeaderTap(): void {
    if (!this.barsHidden) return;
    this.barsHidden = false;
    this.lastToggleTime = Date.now();
    this.showBarsUI();
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
