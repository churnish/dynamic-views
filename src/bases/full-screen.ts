/**
 * Full screen mobile scrolling — hides navigation bars on scroll-down,
 * shows on scroll-up. Android uses an in-flow spacer with overflow-anchor
 * for scroll-safe height changes + WAAPI animations. iOS uses a margin-top
 * offset to defer layout mutations until scroll-idle.
 *
 * All bar animations (header, navbar slide/fade) match native Obsidian
 * full screen behavior in Markdown views.
 *
 * Guards: Platform.isPhone && body.has('auto-full-screen') && settings.fullScreen
 *
 * TODO: when Safari ships overflow-anchor, replace the iOS bridge with
 * the spacer approach — symmetric show/hide via overflow-anchor.
 */

import { OPEN_ON_TITLE_CLASS } from '../core/open-file-action';
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
  FULL_SCREEN_SPACER_RESOLVE_DELAY_MS,
  FULL_SCREEN_REVEAL_DEFER_MS,
  FULL_SCREEN_REVEAL_CANCEL_DELTA,
  FULL_SCREEN_REVEAL_RECENCY_MS,
  FULL_SCREEN_TAP_MAX_DISTANCE,
  FULL_SCREEN_TAP_MAX_DURATION_MS,
} from '../core/constants';

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

/** Static keyframe arrays — hoisted to module scope to avoid per-call allocation */
const OPACITY_HIDE_FRAMES: Keyframe[] = [{ opacity: 1 }, { opacity: 0 }];
const OPACITY_SHOW_FRAMES: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];

/** Fully-opaque mask gradient — keeps compositor render surface allocated during hide. */
const OPAQUE_MASK = 'linear-gradient(rgb(0,0,0),rgb(0,0,0))';

export interface FullScreenElements {
  scrollEl: HTMLElement; // .bases-view
  container: HTMLElement; // .dynamic-views-bases-container
  viewContent: HTMLElement; // .view-content
  navbarEl: HTMLElement; // .mobile-navbar
}

// Capacitor StatusBar plugin — hides/shows iOS system status bar elements
const capacitorStatusBar = (
  window as {
    Capacitor?: {
      Plugins?: {
        StatusBar?: { show(): Promise<void>; hide(): Promise<void> };
      };
    };
  }
).Capacitor?.Plugins?.StatusBar;

// ---------------------------------------------------------------------------
// Inline style helpers for dynamic values (computed heights, transforms,
// CSS variables). Static values use CSS classes instead.
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
  private readonly body: HTMLElement;
  private readonly isAndroid: boolean;
  private readonly toolbarEl: HTMLElement | null;
  private readonly searchRowEl: HTMLElement | null;
  private readonly workspaceSplitEl: HTMLElement | null;
  private readonly appContainerEl: HTMLElement | null;
  private readonly workspaceEl: HTMLElement | null;
  private readonly classTarget: HTMLElement;
  private readonly cachedMaskImage: string;

  // State
  private mounted = false;
  private barsHidden = false;
  private settled = false;
  private totalShift = 0;
  private totalShiftMeasured = false;
  private originalMarginTop = 0;
  private prevScrollTop = 0;
  private accumulatedDelta = 0;
  private programmaticScroll = false;
  private navbarHeight = 0;
  private headerShift = 0;
  // Constant gap between header bottom and viewContent start (empirically
  // 8px). Invariant across orientations — origMT tracks safeArea linearly.
  // Used in CSS calc() for toolbar positioning so it tracks CSS variable
  // changes at paint time instead of stale JS-measured pixels.
  private headerToContentGap = 0;
  // Cached --dynamic-views-bases-view-padding (stable post-mount, default 12px).
  // Chromium applies sticky top AFTER scroll container padding-top, so heading
  // position must subtract viewPadding to land at the correct viewport offset.
  private viewPadding = 12;
  private pendingLayout: (() => void) | null = null;
  private scrollIdleTimer: number | null = null;
  private spacerResolveTimer: number | null = null;
  private isActiveHider = false;
  private pendingRafId: number | null = null;
  private searchSyncRafId: number | null = null;
  private lastToggleTime = 0;
  private directionChangeTime = 0;
  private lockedScrollHeight = 0;
  private resizeDebounceTimer: number | null = null;
  private resizeVerifyTimer: number | null = null;
  // True during orientation change debounce — suppresses show/hide decisions
  // in the scroll handler to prevent transitions with stale CSS var values.
  private safeAreaSettling = false;

  // Bound handlers for add/removeEventListener
  private readonly onScrollBound: () => void;
  private readonly onTouchStartBound: (e: TouchEvent) => void;
  private readonly onTouchEndBound: (e: TouchEvent) => void;
  private readonly onHeaderTapBound: (e: TouchEvent) => void;
  private readonly onResizeBound: () => void;
  private readonly onDropBound: (e: Event) => void;

  // WAAPI animation handles (Android) — cancel before starting new ones.
  // Array instead of named fields — per-property animations (transform vs
  // opacity) double the handle count; an array simplifies lifecycle.
  private barAnims: Animation[] = [];
  private capacitorRafId: number | null = null;

  // In-flow spacer inside scrollEl — replaces transform-based offset on Android.
  // Height changes absorbed by overflow-anchor (container is the anchor target).
  private spacerEl: HTMLElement | null = null;
  private spacerActive = false;
  // Opaque background behind toolbar/search during spacer show — prevents
  // content showing through during the WAAPI opacity fade-in.
  private toolbarBgEl: HTMLElement | null = null;
  // Observes search row size changes — prevSearchRowHeight tracks previous
  // height for iOS scrollTop compensation; syncShowLayoutForSearch re-syncs
  // spacer/heading/toolbarBg during Android show mode.
  private searchRowRO: ResizeObserver | null = null;
  private prevSearchRowHeight = 0;
  // Cached toolbar height — populated by computeEffectiveShift() (runs at
  // the top of hideBarsUI), reused in showBarsUI iOS path to avoid a forced
  // layout read (offsetHeight) that kills UIScrollView momentum.
  private cachedToolbarH = 0;
  // Touch tracking — touchActive distinguishes active finger from momentum.
  // true from touchstart until touchend (finger lifted → momentum begins).
  private touchActive = false;
  private touchStartY = 0;
  private touchStartTime = 0;
  private pendingRevealTimer: number | null = null;
  private lastFastScrollTime = 0;

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
    // Android: class is never used — show-state is applied via absolute
    // overlay inlines to avoid style invalidation that exceeds the
    // single-threaded WebView compositor's frame budget.
    this.leafContent = elements.viewContent.parentElement!;
    const ownerDoc = this.scrollEl.ownerDocument;
    this.body = ownerDoc.body;
    this.isAndroid = this.body.classList.contains('is-android');
    this.toolbarEl =
      this.leafContent.querySelector<HTMLElement>('.bases-header');
    this.searchRowEl =
      this.leafContent.querySelector<HTMLElement>('.bases-search-row');
    this.workspaceSplitEl = this.body.querySelector<HTMLElement>(
      '.workspace-split.mod-root'
    );
    this.appContainerEl =
      this.body.querySelector<HTMLElement>('.app-container');
    this.workspaceEl = this.body.querySelector<HTMLElement>('.workspace');
    this.classTarget = this.leafContent;
    // Cache Obsidian's mask-image gradient before any inline overrides.
    // Used by gradient swap (hide sets opaque, show restores cached) to
    // keep the render surface allocated — avoids cross-subtree rasterization
    // from mask-image: none → gradient structural compositor change.
    const cs = this.workspaceSplitEl
      ? getComputedStyle(this.workspaceSplitEl)
      : null;
    this.cachedMaskImage =
      cs?.getPropertyValue('-webkit-mask-image') ||
      cs?.getPropertyValue('mask-image') ||
      '';

    this.onScrollBound = (): void => this.onScroll();
    this.onTouchStartBound = (e: TouchEvent): void => this.onTouchStart(e);
    this.onTouchEndBound = (e: TouchEvent): void => this.onTouchEnd(e);
    this.onHeaderTapBound = (e: TouchEvent): void => this.onHeaderTap(e);
    this.onResizeBound = (): void => this.onResize();
    this.onDropBound = (e: Event): void => {
      if (this.barsHidden) e.preventDefault();
    };
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

    // Cache navbar/header heights — initial values, re-measured on resize.
    // DOM measurement avoids CSS safe area variable oscillation during
    // Android rotation and the falsy-zero bug (parseFloat('0px') || N = N).
    this.navbarHeight = this.navbarEl.offsetHeight || 86;
    this.headerShift = this.viewHeaderEl?.offsetHeight || 91;

    // Compute constant offset: origMT = headerH + safeArea + offset.
    // Invariant across orientations (verified: 8.0 for portrait/landscape/transient).
    const safeAreaAtMount =
      parseFloat(
        getComputedStyle(this.body).getPropertyValue('--safe-area-inset-top')
      ) || 0;
    this.headerToContentGap =
      this.originalMarginTop - this.headerShift - safeAreaAtMount;

    // Measure totalShift: toggle full-screen-active, read scrollEl rect delta
    const beforeTop = this.scrollEl.getBoundingClientRect().top;
    this.classTarget.classList.add('full-screen-active');
    const afterTop = this.scrollEl.getBoundingClientRect().top;
    this.classTarget.classList.remove('full-screen-active');
    this.totalShift = beforeTop - afterTop;
    if (this.totalShift > 0) this.totalShiftMeasured = true;

    // Lock scroll container height — decouples clientHeight from flex layout
    // changes during full screen transitions (prevents scroll indicator teleport)
    this.lockedScrollHeight = this.scrollEl.offsetHeight;
    // Batch clientHeight read with offsetHeight — both before any writes
    const scrollPadding = Math.round(this.scrollEl.clientHeight * 0.5);

    setStyle(this.scrollEl, 'height', `${this.lockedScrollHeight}px`);

    // Scroll range padding — mirrors native CM6 scrollPastEnd (~50% pane).
    // Set as CSS variable so the margin-bottom calc in _container.scss adapts
    // to actual pane height instead of fixed ~200px.
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
    this.lastFastScrollTime = 0;
    this.programmaticScroll = false;
    this.pendingLayout = null;
    this.isActiveHider = false;
    this.safeAreaSettling = false;

    // Pre-promote navbar to compositor layer (Android only).
    // Eliminates first-transform layer promotion stall during animation.
    // Header is promoted via CSS (will-change on .full-screen-active rule).
    if (this.isAndroid) {
      this.navbarEl.classList.add('dynamic-views-navbar-animated');
    }

    // Attach listeners
    this.scrollEl.addEventListener('scroll', this.onScrollBound, {
      passive: true,
    });
    addEventListener('resize', this.onResizeBound);
    this.scrollEl.addEventListener('touchstart', this.onTouchStartBound, {
      passive: true,
    });
    this.scrollEl.addEventListener('touchend', this.onTouchEndBound, {
      passive: true,
    });
    if (this.viewHeaderEl) {
      // Non-passive — onHeaderTap calls preventDefault() to suppress click
      // synthesis on header children (title, triple-dot button).
      this.viewHeaderEl.addEventListener('touchend', this.onHeaderTapBound);
      // Block drop events on the tap shield header — pointer-events: auto
      // makes it a valid drop target, and Obsidian's workspace handleDrop
      // opens the file when drop target is inside headerEl.
      this.viewHeaderEl.addEventListener('drop', this.onDropBound);
    }

    // Observe search row size — when user opens/closes search during show
    // mode, heading tops and spacer need re-syncing to clear the search bar.
    if (this.searchRowEl && !this.searchRowRO) {
      const win = this.scrollEl.ownerDocument.defaultView;
      if (win) {
        this.prevSearchRowHeight = this.searchRowEl.offsetHeight;
        this.searchRowRO = new win.ResizeObserver((entries) => {
          // compensate must run first — syncShowLayout sets
          // programmaticScroll=true, which would suppress compensation.
          this.compensateSearchRowResize(entries);
          this.syncShowLayoutForSearch();
        });
        this.searchRowRO.observe(this.searchRowEl);
      }
    }
  }

  /** Resize handler — deferred remeasure for spacer/heading recalculation.
   *  Toolbar positioning uses CSS calc() with live CSS variables (set in
   *  applyShowOverlays), so it needs no JS remeasure during rotation.
   *  The debounced remeasure updates originalMarginTop and totalShift
   *  for spacer height and heading top calculations only. */
  private onResize(): void {
    if (!this.mounted) return;
    if (this.resizeDebounceTimer != null)
      window.clearTimeout(this.resizeDebounceTimer);
    if (this.resizeVerifyTimer != null)
      window.clearTimeout(this.resizeVerifyTimer);
    this.safeAreaSettling = true;

    // Cancel pending settle — stale totalShift/originalMarginTop would
    // produce wrong scroll compensation. Re-settles after remeasure.
    if (this.scrollIdleTimer != null) {
      window.clearTimeout(this.scrollIdleTimer);
      this.scrollIdleTimer = null;
    }
    this.pendingLayout = null;

    // Batch all reads before the write to avoid interleaved layout flushes.
    // headerShift + navbarHeight settle instantly (headerH=44 across all
    // landscape readings, navbarH=52 constant). Do NOT update
    // originalMarginTop or totalShift here — CSS safe area variables
    // transiently overshoot to 0px, producing wrong values.
    this.lockedScrollHeight = this.scrollEl.offsetHeight;
    this.headerShift = this.viewHeaderEl?.offsetHeight || 91;
    this.navbarHeight = this.navbarEl.offsetHeight || 86;
    // Single write after all reads
    setStyle(this.scrollEl, 'height', `${this.lockedScrollHeight}px`);

    this.resizeDebounceTimer = window.setTimeout(() => {
      this.resizeDebounceTimer = null;
      this.safeAreaSettling = false;
      if (!this.mounted) return;
      this.remeasureAfterResize();

      // Verification pass: CSS safe area variables can oscillate back after
      // initial settling (0→28 at ~800ms). Re-measure at 2.5s total.
      this.resizeVerifyTimer = window.setTimeout(() => {
        this.resizeVerifyTimer = null;
        if (!this.mounted) return;
        this.remeasureAfterResize();
      }, 2000);
    }, 500);
  }

  /** Re-measure orientation-dependent cached values. Uses the same GBR
   *  (getBoundingClientRect) technique as mount for totalShift — more
   *  reliable than component-based computation during CSS transitions. */
  private remeasureAfterResize(): void {
    // Navbar is outside the view hierarchy — unaffected by full-screen-active
    this.navbarHeight = this.navbarEl.offsetHeight || 86;

    // GBR approach (same as mount): measure scrollEl top delta when toggling
    // full-screen-active. Directly captures the shift regardless of which CSS
    // properties contribute. overflow-anchor is async — synchronous class
    // toggle won't trigger it.
    const hadClass = this.classTarget.classList.contains('full-screen-active');
    if (hadClass) {
      // visibility:hidden holds the hidden visual state while the class is off,
      // preventing a one-frame flash when WAAPI is cancelled but settle hasn't
      // applied. GBR reads layout geometry regardless of visibility.
      setStyle(this.classTarget, 'visibility', 'hidden');
      this.classTarget.classList.remove('full-screen-active');
    }

    this.headerShift = this.viewHeaderEl?.offsetHeight || 91;
    this.originalMarginTop =
      parseFloat(getComputedStyle(this.viewContent).marginTop) || 0;
    const beforeTop = this.scrollEl.getBoundingClientRect().top;

    this.classTarget.classList.add('full-screen-active');
    if (hadClass) clearStyles(this.classTarget, ['visibility']);

    const afterTop = this.scrollEl.getBoundingClientRect().top;

    // Restore original class state
    if (!hadClass) this.classTarget.classList.remove('full-screen-active');

    const newTotalShift = beforeTop - afterTop;
    if (newTotalShift > 0) {
      this.totalShift = newTotalShift;
      this.totalShiftMeasured = true;
    }

    // Re-lock scroll height (may have changed since immediate lock)
    this.lockedScrollHeight = this.scrollEl.offsetHeight;
    setStyle(this.scrollEl, 'height', `${this.lockedScrollHeight}px`);

    // Re-sync spacer + overlays if bars are shown with spacer active
    if (this.spacerActive && !this.barsHidden) {
      const { shift: effectiveShift } = this.computeEffectiveShift();
      if (this.spacerEl) {
        setStyle(this.spacerEl, 'height', `${effectiveShift}px`);
      }
      // Remove stale toolbarBgEl — its position is baked from pre-rotation
      this.toolbarBgEl?.remove();
      this.toolbarBgEl = null;
      this.clearBarInlines();
      this.applyShowOverlays();
      this.applySpacerHeadingTops(effectiveShift);
    }

    // Re-queue cancelled settle if bars are hidden but not yet settled.
    // onResize clears pendingLayout to prevent stale-value settle; now that
    // totalShift/originalMarginTop are fresh, re-queue so the settle
    // completes with correct values on next scroll idle. Android only —
    // iOS settle closure captures state that must be re-created by the
    // scroll handler's hide path; it self-heals on next scroll event.
    if (
      this.isAndroid &&
      this.barsHidden &&
      !this.settled &&
      !this.pendingLayout
    ) {
      this.pendingLayout = (): void => this.settleAndroidSpacerHide();
    }
  }

  /** Cancel and discard all WAAPI animation handles (Android) */
  private cancelAnimations(): void {
    for (const a of this.barAnims) a.cancel();
    this.barAnims = [];
  }

  /** Clear navbar state classes and inline styles set during hide/show */
  private clearNavbarInlines(): void {
    this.navbarEl.classList.remove(
      'dynamic-views-navbar-show',
      'dynamic-views-navbar-hidden'
    );
    clearStyles(this.navbarEl, [
      'transform',
      'opacity',
      'pointer-events',
      'transition',
    ]);
  }

  /** Restore cached mask-image gradient via inline swap (not property removal).
   * Swapping gradient values keeps the compositor render surface allocated —
   * the mask texture updates without cross-subtree tile re-rasterization.
   * Removing the property (none → CSS gradient) destroys and recreates the
   * render surface (~66MB), forcing full subtree rasterization that exceeds
   * Chrome/146's single-threaded compositor frame budget. */
  private restoreMaskImage(): void {
    if (!this.workspaceSplitEl) return;
    if (!this.cachedMaskImage) {
      this.clearMaskImageInline();
      return;
    }
    setStyle(
      this.workspaceSplitEl,
      '-webkit-mask-image',
      this.cachedMaskImage,
      'important'
    );
    setStyle(
      this.workspaceSplitEl,
      'mask-image',
      this.cachedMaskImage,
      'important'
    );
  }

  /** Fully remove mask-image inline — only safe during unmount (not scroll-concurrent) */
  private clearMaskImageInline(): void {
    if (!this.workspaceSplitEl) return;
    this.workspaceSplitEl.style.removeProperty('-webkit-mask-image');
    this.workspaceSplitEl.style.removeProperty('mask-image');
  }

  /** Clear header inline styles set during hide/show */
  private clearHeaderInlines(): void {
    if (!this.viewHeaderEl) return;
    this.viewHeaderEl.classList.remove(
      'dynamic-views-tap-shield',
      'dynamic-views-header-show'
    );
    clearStyles(this.viewHeaderEl, [
      'transform',
      'opacity',
      'pointer-events',
      'transition',
      'z-index',
      'margin-top',
      'min-height',
      'background',
    ]);
  }

  /** Apply background-color inlines on body/app-container/workspace. These elements are above the leaf — unreachable from the leaf-scoped full-screen-active class. Variable defined on body (_variables.scss). */
  private applyBackgroundInlines(): void {
    const bg = 'var(--dynamic-views-background-primary)';
    setStyle(this.body, 'background-color', bg, 'important');
    if (this.appContainerEl)
      setStyle(this.appContainerEl, 'background-color', bg, 'important');
    if (this.workspaceEl)
      setStyle(this.workspaceEl, 'background-color', bg, 'important');
  }

  /** Remove background-color inlines from body/app-container/workspace */
  private clearBackgroundInlines(): void {
    this.body.style.removeProperty('background-color');
    this.appContainerEl?.style.removeProperty('background-color');
    this.workspaceEl?.style.removeProperty('background-color');
  }

  // ---------------------------------------------------------------------------
  // Android spacer — in-flow element inside scrollEl whose height
  // changes are absorbed by overflow-anchor. Replaces the transform-based offset.
  // ---------------------------------------------------------------------------

  private ensureSpacerChrome(): void {
    if (this.spacerEl) return;
    const doc = this.scrollEl.ownerDocument;
    // Detached creation — the spacer is inserted before the container, not
    // appended, so createDiv() (which always appends) cannot be used.
    this.spacerEl = doc.createElement('div');
    this.spacerEl.className = 'dynamic-views-spacer';
    this.scrollEl.insertBefore(this.spacerEl, this.container);
  }

  private clearSpacerChrome(): void {
    this.spacerEl?.remove();
    this.spacerEl = null;
    this.spacerActive = false;
  }

  // ---------------------------------------------------------------------------
  // Android spacer overlay helpers — toolbar/search as absolute overlays
  // on leafContent (does NOT restore margin-top or toolbar layout —
  // keeps full-screen-active CSS).
  // ---------------------------------------------------------------------------

  private applyShowOverlays(): void {
    this.leafContent.setAttribute('data-dynamic-views-show', '');

    // Read heights BEFORE writing styles — avoids forced layout between
    // write and read on Android's single-threaded compositor.
    const toolbarH = this.toolbarEl?.offsetHeight ?? 0;

    // CSS calc expression for toolbar top — resolves at paint time using
    // live CSS variable values. Eliminates the JS/CSS mismatch during
    // Android orientation changes where env(safe-area-inset-top) oscillates:
    // the scrim ::before (CSS-driven) and toolbar (inline-driven) now use
    // the same variable, oscillating in lockstep with zero visual gap.
    // headerToContentGap is the constant gap between header bottom and
    // viewContent start (empirically 8px, computed once at mount).
    const safeAreaExpr =
      'var(--safe-area-inset-top, env(safe-area-inset-top, 0px))';
    const headerHExpr = 'var(--view-header-height, 44px)';
    const toolbarTopCalc = `calc(${safeAreaExpr} + ${headerHExpr} + ${this.headerToContentGap}px)`;
    const searchTopCalc = `calc(${safeAreaExpr} + ${headerHExpr} + ${this.headerToContentGap + toolbarH}px)`;

    if (this.toolbarEl) {
      // Inline opacity:1 provides the post-WAAPI fallback. During the 300ms
      // fade, WAAPI (higher cascade priority) overrides this with 0→1.
      // After idle cancelAnimations(), WAAPI is removed and inline takes over.
      this.toolbarEl.classList.add('dynamic-views-show-overlay');
      setStyle(this.toolbarEl, 'opacity', '1');
      setStyle(this.toolbarEl, 'top', toolbarTopCalc, 'important');
    }

    if (this.searchRowEl) {
      this.searchRowEl.classList.add('dynamic-views-show-overlay');
      setStyle(this.searchRowEl, 'opacity', '1');
      setStyle(this.searchRowEl, 'top', searchTopCalc, 'important');
    }

    // Opaque background behind toolbar/search — prevents content showing
    // through during the WAAPI opacity 0→1 fade. z-index 28 sits below
    // the toolbar (29) and header (30). Guard prevents double-create on
    // rapid show→hide→show re-entry before clearShowOverlays fires.
    if (!this.toolbarBgEl) {
      this.toolbarBgEl = this.leafContent.createDiv({
        cls: 'dynamic-views-toolbar-bg',
      });
      setStyles(this.toolbarBgEl, [
        ['top', toolbarTopCalc],
        ['height', `${toolbarH}px`],
      ]);
    }

    this.viewHeaderEl?.classList.add('dynamic-views-header-show');
  }

  /** Clear toolbar/search inline positioning and header-show class. Shared by clearShowOverlays() and clearOverlayBars(). */
  private clearBarInlines(): void {
    if (this.toolbarEl) {
      this.toolbarEl.classList.remove('dynamic-views-show-overlay');
      clearStyles(this.toolbarEl, ['opacity', 'top']);
    }
    if (this.searchRowEl) {
      this.searchRowEl.classList.remove('dynamic-views-show-overlay');
      clearStyles(this.searchRowEl, ['opacity', 'top']);
    }
    this.viewHeaderEl?.classList.remove('dynamic-views-header-show');
  }

  private clearShowOverlays(): void {
    this.clearBarInlines();
    this.toolbarBgEl?.remove();
    this.toolbarBgEl = null;
    this.leafContent.removeAttribute('data-dynamic-views-show');
    // Heading tops are applied in applySpacerHeadingTops (show path) and
    // must be rolled back atomically with the overlay cleanup.
    this.clearSpacerHeadingTops();
  }

  /** Clear temporary overlay bar positioning (toolbar/search absolute + header-show class). Does NOT touch the persistent spacer cover chrome (toolbarBgEl, data attributes, heading tops). */
  private clearOverlayBars(): void {
    this.clearBarInlines();
  }

  /** Apply persistent opaque cover over spacer area during hidden state. The spacer gets a background color so content below isn't visible through it. The scrim ::before (on leafContent, outside the scroll container) paints above the spacer naturally. No toolbarBgEl needed — its z-index 28 would paint above the scrim (z-index 10/25), hiding the gradient. */
  private applyHideSpacerCover(): void {
    this.leafContent.removeAttribute('data-dynamic-views-show');
    // Remove toolbarBgEl — it would paint above the scrim
    this.toolbarBgEl?.remove();
    this.toolbarBgEl = null;

    if (this.spacerEl) {
      this.spacerEl.classList.add('dynamic-views-spacer-cover');
    }
  }

  /** Remove the persistent hide-spacer cover chrome. Called by show path and resolve/unmount. */
  private clearHideSpacerCover(): void {
    if (this.spacerEl) {
      this.spacerEl.classList.remove('dynamic-views-spacer-cover');
    }
    this.clearSpacerHeadingTops();
  }

  /** Settle the Android spacer-preserved hide: cancel animations, drop temporary overlays, apply persistent hidden state (top cover + navbar inlines + tap shield). */
  private settleAndroidSpacerHide(): void {
    this.cancelAnimations();
    this.clearOverlayBars();
    this.applyHideSpacerCover();
    this.clearSpacerHeadingTops();

    // Persist navbar hidden state via inlines (WAAPI cancelled above).
    // Inline opacity: navbar-hidden class is added during WAAPI — !important CSS would override animation (invariant #10).
    setStyles(this.navbarEl, [
      ['transform', `translateY(${this.navbarHeight}px)`, 'important'],
      ['opacity', '0', 'important'],
      ['pointer-events', 'none', 'important'],
    ]);
    this.navbarEl.classList.add('dynamic-views-navbar-hidden');

    this.clearHeaderInlines();
    this.viewHeaderEl?.classList.add('dynamic-views-tap-shield');
  }

  // ---------------------------------------------------------------------------
  // Heading top inline styles for spacer show state — inline styles instead
  // of CSS rules to avoid violating the [data-dynamic-views-show] descendant
  // combinator invariant (see INVARIANT comment on [data-dynamic-views-show] in _full-screen.scss).
  // ---------------------------------------------------------------------------

  private applySpacerHeadingTops(effectiveShift?: number): void {
    const headingTop = (effectiveShift ?? this.totalShift) - this.viewPadding;
    const sentinelTop = headingTop + 1;
    for (const el of this.container.querySelectorAll<HTMLElement>(
      '.dynamic-views-group-section > :is(.bases-group-heading:not(.collapsed), .dynamic-views-sticky-sentinel)'
    )) {
      if (el.classList.contains('dynamic-views-sticky-sentinel')) {
        setStyle(el, 'top', `${sentinelTop}px`, 'important');
      } else {
        setStyle(el, 'top', `${headingTop}px`, 'important');
        // Must match .bases-group-heading.stuck z-index in _grid-masonry-shared.scss
        // Inline: already iterating for dynamic top — class change per heading triggers selector matching.
        setStyle(el, 'z-index', '24', 'important');
      }
    }
  }

  /** Compensate scrollTop when search row resizes during iOS idle or show state. Prevents content shift from flex reflow. Called by searchRowRO — ResizeObserver delivers after layout, before paint. */
  private compensateSearchRowResize(entries: ResizeObserverEntry[]): void {
    if (!this.searchRowEl) return;

    const currentHeight = entries[0].borderBoxSize[0].blockSize;
    const delta = currentHeight - this.prevSearchRowHeight;
    this.prevSearchRowHeight = currentHeight;

    if (delta === 0) return;

    // RO fires at two moments during a hide/show cycle: when full-screen-active
    // is added (CSS collapses search to 0 — suppressed by barsHidden guard) and
    // removed (show-settle restores height — suppressed by programmaticScroll,
    // which settle sets true before class removal).
    if (
      this.isAndroid ||
      !this.mounted ||
      this.barsHidden ||
      this.programmaticScroll
    )
      return;
    // Block during hide state (search collapsed to height:0 by CSS). During
    // show state (full-screen-active + full-screen-showing), CSS restores
    // search row to normal flow — compensation is needed.
    if (
      this.classTarget.classList.contains('full-screen-active') &&
      !this.leafContent.classList.contains('full-screen-showing')
    )
      return;

    // Search row grew → content pushed down → add delta.
    // Search row shrank → content pulled up → subtract delta.
    this.programmaticScroll = true;
    this.scrollEl.scrollTop = Math.max(0, this.scrollEl.scrollTop + delta);
    this.prevScrollTop = this.scrollEl.scrollTop;
    this.programmaticScroll = false;
  }

  /** Re-sync spacer, heading tops, and toolbar background when search row visibility changes during active show mode. Called by the searchRowRO ResizeObserver. Coalesced via rAF — programmaticScroll set synchronously for immediate scroll suppression. */
  private syncShowLayoutForSearch(): void {
    if (!this.spacerActive || this.barsHidden) return;

    // Suppress scroll handler synchronously — spacer resize triggers
    // overflow-anchor scrollTop adjustment that the scroll handler would
    // misread as downward user scroll and trigger hide.
    this.programmaticScroll = true;

    if (this.searchSyncRafId != null)
      cancelAnimationFrame(this.searchSyncRafId);
    this.searchSyncRafId = window.requestAnimationFrame(() => {
      this.searchSyncRafId = null;
      if (!this.mounted || !this.spacerActive || this.barsHidden) return;

      const {
        shift: effectiveShift,
        toolbarH,
        searchH,
      } = this.computeEffectiveShift();
      if (this.spacerEl) {
        setStyle(this.spacerEl, 'height', `${effectiveShift}px`);
      }
      this.syncToolbarBgHeight(toolbarH, searchH);
      this.applySpacerHeadingTops(effectiveShift);

      this.prevScrollTop = this.scrollEl.scrollTop;
      this.programmaticScroll = false;
    });
  }

  private clearSpacerHeadingTops(): void {
    for (const el of this.container.querySelectorAll<HTMLElement>(
      '.dynamic-views-group-section > :is(.bases-group-heading, .dynamic-views-sticky-sentinel)'
    )) {
      el.style.removeProperty('top');
      if (!el.classList.contains('dynamic-views-sticky-sentinel')) {
        el.style.removeProperty('z-index');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Android spacer resolve — collapses spacer + removes class in one
  // synchronous block. Spacer removal (content moves up) is canceled by
  // class removal (margin+toolbar restore, scrollEl moves down). Net zero.
  // ---------------------------------------------------------------------------

  private commitSpacerResolve(): void {
    if (this.spacerResolveTimer != null) {
      window.clearTimeout(this.spacerResolveTimer);
      this.spacerResolveTimer = null;
    }
    this.programmaticScroll = true;
    this.cancelAnimations();
    this.clearShowOverlays();
    this.clearHideSpacerCover();
    this.clearNavbarInlines();
    this.clearHeaderInlines();

    // Synchronous: collapse spacer + remove class.
    // Spacer (totalShift) removed = content moves up by totalShift.
    // Class removal restores margin+toolbar = scrollEl moves down by totalShift.
    // Net visual effect: zero.
    if (this.spacerEl) setStyle(this.spacerEl, 'height', '0');
    this.scrollEl.style.removeProperty('height');
    this.classTarget.classList.remove('full-screen-active');
    this.clearBackgroundInlines();
    this.clearMaskImageInline();
    this.clearSpacerChrome();
    this.spacerActive = false;
    this.isActiveHider = false;
    this.settled = false;
    this.barsHidden = false;

    this.pendingRafId = window.requestAnimationFrame(() => {
      this.programmaticScroll = false;
      this.prevScrollTop = this.scrollEl.scrollTop;
      this.accumulatedDelta = 0;
      this.lockedScrollHeight = this.scrollEl.offsetHeight;
      setStyle(this.scrollEl, 'height', `${this.lockedScrollHeight}px`);
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
    removeEventListener('resize', this.onResizeBound);
    if (this.viewHeaderEl) {
      this.viewHeaderEl.removeEventListener('touchend', this.onHeaderTapBound);
      this.viewHeaderEl.removeEventListener('drop', this.onDropBound);
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
    if (this.searchSyncRafId != null) {
      cancelAnimationFrame(this.searchSyncRafId);
      this.searchSyncRafId = null;
    }

    // Clear timers
    if (this.scrollIdleTimer != null) {
      window.clearTimeout(this.scrollIdleTimer);
      this.scrollIdleTimer = null;
    }
    if (this.spacerResolveTimer != null) {
      window.clearTimeout(this.spacerResolveTimer);
      this.spacerResolveTimer = null;
    }
    if (this.pendingRevealTimer != null) {
      window.clearTimeout(this.pendingRevealTimer);
      this.pendingRevealTimer = null;
    }
    if (this.resizeDebounceTimer != null) {
      window.clearTimeout(this.resizeDebounceTimer);
      this.resizeDebounceTimer = null;
    }
    if (this.resizeVerifyTimer != null) {
      window.clearTimeout(this.resizeVerifyTimer);
      this.resizeVerifyTimer = null;
    }
    // Remove full screen state only if this instance set it
    if (this.isActiveHider) {
      if (this.isAndroid) {
        this.clearShowOverlays();
        this.clearHideSpacerCover();
      } else {
        this.clearBarInlines();
        this.leafContent.classList.remove('full-screen-showing');
      }
      this.clearMaskImageInline();
      this.classTarget.classList.remove('full-screen-active');
      this.clearBackgroundInlines();
      void capacitorStatusBar?.show();
      this.isActiveHider = false;
    }
    // Clean up spacer + locked height + padding class
    this.container.classList.remove('dynamic-views-full-screen-enabled');
    this.container.style.removeProperty('margin-top');
    this.container.style.removeProperty('transition');
    this.container.style.removeProperty('--dynamic-views-scroll-past-end');
    this.container.style.removeProperty('transform');
    this.clearSpacerChrome();
    this.scrollEl.style.removeProperty('height');

    // Disconnect search row observer
    if (this.searchRowRO) {
      this.searchRowRO.disconnect();
      this.searchRowRO = null;
    }

    // Cancel WAAPI animations (Android)
    this.cancelAnimations();

    // Restore navbar + header
    this.clearNavbarInlines();
    this.navbarEl.classList.remove('dynamic-views-navbar-animated');
    this.clearHeaderInlines();

    this.pendingLayout = null;
    this.barsHidden = false;
    this.settled = false;
    this.safeAreaSettling = false;
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

    // During orientation change, CSS safe area variables are transitioning —
    // suppress show/hide decisions to prevent transitions with stale values.
    // prevScrollTop still tracks position to avoid false delta on resume.
    if (this.safeAreaSettling) return;

    // Cancel pending header-tap reveal during active downward scroll.
    // Fast momentum (delta > threshold) cancels; dying momentum allows reveal.
    if (delta > FULL_SCREEN_REVEAL_CANCEL_DELTA) {
      this.lastFastScrollTime = now;
      if (this.pendingRevealTimer != null) {
        window.clearTimeout(this.pendingRevealTimer);
        this.pendingRevealTimer = null;
      }
    }

    // Idle settle for pending layout (hide settle or show class removal)
    if (this.scrollIdleTimer != null) window.clearTimeout(this.scrollIdleTimer);
    if (this.pendingLayout) {
      this.scrollIdleTimer = window.setTimeout(
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

    // Spacer resolve: no unwind needed (no transform), just resolve at top
    if (this.isAndroid && this.spacerActive && !this.barsHidden) {
      if (currentTop <= 1) {
        if (this.spacerResolveTimer == null) {
          this.spacerResolveTimer = window.setTimeout(() => {
            this.spacerResolveTimer = null;
            if (this.scrollEl.scrollTop > 1) return;
            this.pendingLayout = null;
            if (this.scrollIdleTimer != null) {
              window.clearTimeout(this.scrollIdleTimer);
              this.scrollIdleTimer = null;
            }
            this.commitSpacerResolve();
          }, FULL_SCREEN_SPACER_RESOLVE_DELAY_MS);
        }
      } else if (this.spacerResolveTimer != null) {
        window.clearTimeout(this.spacerResolveTimer);
        this.spacerResolveTimer = null;
      }
    }

    // Cooldown prevents rapid cycling (deceleration bounce, layout-induced deltas).
    // Checked BEFORE auto-show — on short views, Android spacer-based hide adjusts
    // scrollTop to 0, which would trigger auto-show on the very next event.
    if (now - this.lastToggleTime < FULL_SCREEN_TOGGLE_COOLDOWN_MS) {
      this.accumulatedDelta = 0;
      return;
    }

    // Auto-show near top — expanded zone while unsettled AND user is
    // scrolling upward. During downward scroll, use normal zone to avoid
    // hide→auto-show cycling (bars hide at ~80px, well below totalShift).
    // accumulatedDelta reflects previous events (checked before update).
    const autoShowZone =
      !this.settled && this.barsHidden && this.accumulatedDelta < 0
        ? this.totalShift
        : FULL_SCREEN_TOP_ZONE;
    if (currentTop <= autoShowZone) {
      // Only auto-show when user is scrolling UP or stationary — not during
      // active downward scroll. Android spacer-based hide can land scrollTop
      // at 0 (Math.max clamp), which would trigger auto-show on the next
      // event if the user is still scrolling down post-hide.
      if (this.barsHidden && delta <= 0) {
        if (!this.isAndroid && !this.touchActive) return;
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
      if (!this.isAndroid && !this.touchActive) return;
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
      if (!this.isAndroid && !this.touchActive) return;
      this.barsHidden = false;
      this.lastToggleTime = now;
      this.showBarsUI();
      this.accumulatedDelta = 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Measurement
  // ---------------------------------------------------------------------------

  /** Re-measure totalShift from live DOM. Skips if already measured successfully (totalShift is stable after first valid measurement — the startup race where mount-time GBR returns 0 is the only scenario requiring remeasurement). Only valid when full-screen-active is NOT on the class target — otherwise margin-top reads as 0 from the class rule. */
  private measureTotalShift(): void {
    if (this.totalShiftMeasured) return;
    if (this.classTarget.classList.contains('full-screen-active')) return;
    const cs = getComputedStyle(this.viewContent);
    this.originalMarginTop = parseFloat(cs.marginTop) || 0;
    this.totalShift =
      this.originalMarginTop +
      (this.toolbarEl?.offsetHeight ?? 0) +
      (this.searchRowEl?.offsetHeight ?? 0);
    this.viewPadding =
      parseFloat(
        getComputedStyle(this.scrollEl).getPropertyValue(
          '--dynamic-views-bases-view-padding'
        )
      ) || 12;
    if (this.totalShift > 0) this.totalShiftMeasured = true;
  }

  /** Compute live effective shift from current toolbar + search row heights. Forces one layout read. Returns component heights so callers can reuse them without a second forced layout. */
  private computeEffectiveShift(): {
    shift: number;
    toolbarH: number;
    searchH: number;
  } {
    const toolbarH = this.toolbarEl?.offsetHeight ?? 0;
    this.cachedToolbarH = toolbarH;
    const searchH = this.searchRowEl?.offsetHeight ?? 0;
    return {
      shift: this.originalMarginTop + toolbarH + searchH,
      toolbarH,
      searchH,
    };
  }

  /** Sync toolbarBgEl height to pre-read toolbar + search row heights. */
  private syncToolbarBgHeight(toolbarH: number, searchH: number): void {
    if (!this.toolbarBgEl) return;
    setStyle(this.toolbarBgEl, 'height', `${toolbarH + searchH}px`);
  }

  // ---------------------------------------------------------------------------
  // Hide / Show logic
  // ---------------------------------------------------------------------------

  /** HIDE — immediate, momentum-safe */
  private hideBarsUI(): void {
    // Capture live bar heights before blur — Obsidian auto-collapses
    // the search row when the search input loses focus, making
    // offsetHeight 0 by the time the iOS bridge reads it.
    const { shift: preBlurShift } = this.computeEffectiveShift();

    this.isActiveHider = true;

    if (this.spacerResolveTimer != null) {
      window.clearTimeout(this.spacerResolveTimer);
      this.spacerResolveTimer = null;
    }

    // Dismiss soft keyboard — search input may be focused.
    const active = this.scrollEl.ownerDocument.activeElement;
    if (active instanceof HTMLElement) active.blur();

    // Cancel pending show rAF (rapid show→hide before rAF fires)
    if (this.pendingRafId != null) {
      cancelAnimationFrame(this.pendingRafId);
      this.pendingRafId = null;
    }

    const wasSpacerActive = this.spacerActive;

    // Remove show-state if rapid show→hide before idle
    if (!this.isAndroid) {
      this.leafContent.classList.remove('full-screen-showing');
    }

    // Cancel deferred capacitor status bar (rapid show→hide)
    if (this.capacitorRafId != null) {
      cancelAnimationFrame(this.capacitorRafId);
      this.capacitorRafId = null;
    }

    // Android re-hide (spacer already active) skips shared cleanup —
    // overlay/WAAPI state is still live and torn down in rAF + idle.
    if (!this.isAndroid || !wasSpacerActive) {
      // Cancel WAAPI animations — must be AFTER clearShowOverlays so
      // fill:forwards removal doesn't flash elements visible before
      // overlays are cleared.
      this.cancelAnimations();

      // Clear show-path inlines (rapid show→hide before idle)
      this.clearNavbarInlines();
      this.container.style.removeProperty('margin-top');
      this.container.style.removeProperty('transform');
      this.container.style.removeProperty('transition');
      this.clearHeaderInlines();
      // Clean up iOS search row overlay from show path
      if (this.searchRowEl) {
        this.searchRowEl.classList.remove('dynamic-views-show-overlay');
        clearStyles(this.searchRowEl, ['top', 'opacity']);
      }

      // Re-measure ONLY in clean state (no full screen classes).
      // During rapid show→hide, full-screen-active is still on the class target —
      // getComputedStyle would read margin-top: 0 (class rule) instead of ~99px.
      this.measureTotalShift();
    }

    void capacitorStatusBar?.hide();

    const navbarHeight = this.navbarHeight;

    if (this.isAndroid) {
      if (wasSpacerActive) return this.hideAndroidAgain(navbarHeight);
      return this.hideAndroidFirst(navbarHeight);
    }
    this.hideIos(preBlurShift, navbarHeight);
  }

  /** Android subsequent hide — spacer already active. */
  private hideAndroidAgain(navbarHeight: number): void {
    // Re-hide from show mode. Spacer and full-screen-active already in
    // place — no layout change needed. WAAPI-fade bars out, clean up
    // overlays at idle.

    // Swap mask-image to opaque immediately — show gradient stays
    // visible as white strip if deferred to idle.
    // Inline: class change on .workspace-split.mod-root triggers broader style recalc than targeted property set.
    if (this.workspaceSplitEl) {
      setStyle(
        this.workspaceSplitEl,
        '-webkit-mask-image',
        OPAQUE_MASK,
        'important'
      );
      setStyle(this.workspaceSplitEl, 'mask-image', OPAQUE_MASK, 'important');
    }

    this.programmaticScroll = true;

    // Read WAAPI "from" values — overlays still visible
    const headerFrom =
      this.viewHeaderEl?.style.getPropertyValue('transform') || 'translateY(0)';

    this.pendingRafId = window.requestAnimationFrame(() => {
      this.programmaticScroll = false;
      this.prevScrollTop = this.scrollEl.scrollTop;

      // Don't cancelAnimations() — hide WAAPI wins over show WAAPI
      // by composite ordering (newer wins, WAAPI §4.6). Cancelling
      // show WAAPI first removes fill:forwards, flashing navbar/header
      // to CSS initial state for one frame before hide WAAPI starts.
      const oldAnims = [...this.barAnims];
      this.barAnims = [];

      // WAAPI hide header — transform + opacity
      if (this.viewHeaderEl) {
        const hEl = this.viewHeaderEl;
        this.barAnims.push(
          hEl.animate(
            [
              { transform: headerFrom },
              { transform: `translateY(-${this.headerShift}px)` },
            ],
            HEADER_SLIDE_OPTS
          ),
          hEl.animate(OPACITY_HIDE_FRAMES, BAR_FADE_OPTS)
        );
      }

      // WAAPI hide navbar
      // Inline opacity: navbar-hidden class is added during WAAPI — !important CSS would override animation (invariant #10).
      this.barAnims.push(
        this.navbarEl.animate(
          [
            { transform: 'translateY(0)' },
            { transform: `translateY(${navbarHeight}px)` },
          ],
          NAVBAR_SLIDE_OPTS
        ),
        this.navbarEl.animate(OPACITY_HIDE_FRAMES, BAR_FADE_OPTS)
      );
      this.navbarEl.classList.add('dynamic-views-navbar-hidden');

      // Cancel old show animations AFTER hide WAAPI started —
      // hide fill:forwards is already holding, so cancel is safe.
      for (const a of oldAnims) a.cancel();

      // Instantly clear toolbar/search overlays and switch to spacer
      // background cover. No WAAPI fade on toolbar/search — they
      // vanish immediately, scrim becomes visible.
      this.clearOverlayBars();
      this.applyHideSpacerCover();
      this.clearSpacerHeadingTops();
    });

    this.settled = true;
    this.pendingLayout = () => {
      this.settleAndroidSpacerHide();
      this.lockedScrollHeight = this.scrollEl.offsetHeight;
      setStyle(this.scrollEl, 'height', `${this.lockedScrollHeight}px`);
      this.pendingLayout = null;
    };
  }

  /** Android initial hide — no spacer yet. Two-frame spacer expansion. */
  private hideAndroidFirst(navbarHeight: number): void {
    // First hide (no spacer). Two-frame approach:
    // Frame 1 (now): expand spacer. Overflow-anchor fires between frames.
    // Frame 2 (rAF): class + collapse spacer (net zero) + WAAPI hide.

    // Pin header + toolbar + search at visible position via inline styles
    // BEFORE class change.
    // Inline: transient pin — cleared in next rAF by clearHeaderInlines().
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

    // Frame 1: insert spacer and expand — anchor fires between frames
    this.ensureSpacerChrome();
    this.programmaticScroll = true;
    this.scrollEl.style.removeProperty('height');
    if (this.spacerEl) {
      setStyle(this.spacerEl, 'height', `${this.totalShift}px`);
    }

    // Frame 2: anchor has inflated scrollTop. Add class + collapse spacer
    // (net zero), then WAAPI-fade bars out.
    const headerShift = this.headerShift;
    this.pendingRafId = window.requestAnimationFrame(() => {
      // Add full-screen-active. External margin collapses (~totalShift),
      // but spacer (totalShift) inside scrollEl replaces it. Anchor
      // already inflated scrollTop between frames. Net visual: zero.
      // Spacer persists during hidden state (same end state as re-hide).
      this.classTarget.classList.add('full-screen-active');
      this.spacerActive = true;

      // Position toolbar/search as absolute overlays covering the spacer
      // area. They WAAPI-fade out, covering the spacer so no white strip
      // appears during the transition. Same overlay setup as show path.
      this.applyShowOverlays();

      // Compute effective shift for heading tops + toolbarBg
      const {
        shift: effectiveShift,
        toolbarH,
        searchH,
      } = this.computeEffectiveShift();
      if (this.spacerEl) {
        setStyle(this.spacerEl, 'height', `${effectiveShift}px`);
      }
      this.syncToolbarBgHeight(toolbarH, searchH);
      this.applyBackgroundInlines();

      // Mask-image swap
      // Inline: class change on .workspace-split.mod-root triggers broader style recalc than targeted property set.
      if (this.workspaceSplitEl) {
        setStyle(
          this.workspaceSplitEl,
          '-webkit-mask-image',
          OPAQUE_MASK,
          'important'
        );
        setStyle(this.workspaceSplitEl, 'mask-image', OPAQUE_MASK, 'important');
      }

      this.programmaticScroll = false;
      this.prevScrollTop = this.scrollEl.scrollTop;
      this.settled = true;

      // Start hide WAAPI BEFORE cancelling old anims. Hide wins by
      // composite ordering (newer wins, WAAPI sec 4.6). Cancelling first
      // removes fill:forwards, flashing to CSS initial state.
      const oldAnims = [...this.barAnims];
      this.barAnims = [];

      this.clearHeaderInlines();

      // Header WAAPI hide
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
          hEl.animate(OPACITY_HIDE_FRAMES, BAR_FADE_OPTS)
        );
      }

      // Navbar WAAPI hide
      this.barAnims.push(
        this.navbarEl.animate(
          [
            { transform: 'translateY(0)' },
            { transform: `translateY(${navbarHeight}px)` },
          ],
          NAVBAR_SLIDE_OPTS
        ),
        this.navbarEl.animate(OPACITY_HIDE_FRAMES, BAR_FADE_OPTS)
      );
      this.navbarEl.classList.add('dynamic-views-navbar-hidden');

      // Cancel old anims AFTER hide WAAPI started
      for (const a of oldAnims) a.cancel();

      // Instantly clear toolbar/search overlays and switch to spacer
      // background cover. No WAAPI fade — they vanish immediately.
      this.clearOverlayBars();
      this.applyHideSpacerCover();
      this.clearSpacerHeadingTops();

      this.pendingLayout = () => {
        this.settleAndroidSpacerHide();
        this.lockedScrollHeight = this.scrollEl.offsetHeight;
        setStyle(this.scrollEl, 'height', `${this.lockedScrollHeight}px`);
        this.pendingLayout = null;
      };
    });
  }

  /** iOS hide — margin bridge + deferred settle. */
  private hideIos(preBlurShift: number, navbarHeight: number): void {
    const applyNavbarHide = (): void => {
      setStyles(this.navbarEl, [
        ['transform', `translateY(${navbarHeight}px)`, 'important'],
        ['opacity', '0', 'important'],
        ['pointer-events', 'none', 'important'],
      ]);
    };

    // Swap mask-image to fully-opaque gradient (no visual masking).
    // Using an opaque gradient instead of 'none' keeps the compositor render
    // surface allocated — show path swaps back to cached gradient without
    // the expensive surface recreation + cross-subtree rasterization.
    // Inline: class change on .workspace-split.mod-root triggers broader style recalc than targeted property set.
    if (this.workspaceSplitEl) {
      setStyle(
        this.workspaceSplitEl,
        '-webkit-mask-image',
        OPAQUE_MASK,
        'important'
      );
      setStyle(this.workspaceSplitEl, 'mask-image', OPAQUE_MASK, 'important');
    }

    // Use pre-blur shift — search row may have been visible before blur
    // dismissed it. Android handles this via computeEffectiveShift() in
    // show overlays; iOS uses totalShift for bridge + settle compensation.
    if (preBlurShift > 0) this.totalShift = preBlurShift;

    // iOS: bridge + deferred settle (scrollTop writes kill momentum)
    setStyle(this.container, 'margin-top', `${this.totalShift}px`);
    // Inline: paired with dynamic margin-top above, applied/removed together.
    setStyle(this.container, 'transition', 'none');
    this.leafContent.classList.add('full-screen-active');
    this.applyBackgroundInlines();
    this.settled = false;

    // WebKit needs double-rAF — passive scroll listener optimization
    // collapses transition+target into one style recalc if set in same frame.
    const iosNavTransition = `transform ${FULL_SCREEN_ANIM_MS}ms ease-out, opacity ${FULL_SCREEN_FADE_MS}ms ease-in-out`;
    this.pendingRafId = window.requestAnimationFrame(() => {
      // Inline: iOS double-rAF timing — transient, cleared by clearNavbarInlines().
      setStyle(this.navbarEl, 'transition', iosNavTransition, 'important');
      this.pendingRafId = window.requestAnimationFrame(applyNavbarHide);
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
      // in the status bar zone. CSS class sets transform, opacity,
      // margin-top, z-index, and pointer-events.
      this.viewHeaderEl?.classList.add('dynamic-views-tap-shield');

      this.pendingRafId = window.requestAnimationFrame(() => {
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
      // Android show: spacer absorbs the scroll shift (overflow-anchor),
      // toolbar/search rendered as absolute overlays, WAAPI header + navbar.
      // No scrollTop write in the show rAF — Chrome/146 WebView's
      // single-threaded compositor budget makes scrollTop writes fatal
      // (triggers scroll layer repaint that flashes .workspace background).
      this.programmaticScroll = true;

      // Replace tap-shield class with inline equivalents that maintain the hidden visual state. Without this, removing the class after settle (WAAPI cancelled, no fill:forwards) exposes the header at opacity:1 for one frame before the show rAF starts WAAPI. Inline transform uses the hide position (not tap-shield's translateY(0)) so WAAPI reads the correct "from" value for the slide-in.
      // Inline: transient — one-frame bridge until WAAPI starts.
      if (this.viewHeaderEl) {
        setStyle(this.viewHeaderEl, 'opacity', '0', 'important');
        setStyle(
          this.viewHeaderEl,
          'transform',
          `translateY(-${this.headerShift}px)`,
          'important'
        );
      }
      this.viewHeaderEl?.classList.remove('dynamic-views-tap-shield');

      // Read WAAPI "from" values BEFORE rAF — fill:forwards still active
      const navbarFrom =
        this.navbarEl.style.getPropertyValue('transform') ||
        `translateY(${this.navbarHeight}px)`;
      const headerFrom =
        this.viewHeaderEl?.style.getPropertyValue('transform') ||
        `translateY(-${this.headerShift}px)`;

      this.pendingRafId = window.requestAnimationFrame(() => {
        // 0. Clear persistent hide-spacer cover before applying show overlays
        this.clearHideSpacerCover();

        // 1. Toolbar/search as absolute overlays first — makes search row
        // measurable (inline height:auto overrides CSS height:0).
        this.applyShowOverlays();

        // 2. Compute effective bars height — totalShift may exclude search
        // row height if search was opened after measureTotalShift(). One
        // forced layout read (offsetHeight) flushes applyShowOverlays
        // inlines; acceptable in show rAF (single paint at frame end).
        const {
          shift: effectiveShift,
          toolbarH,
          searchH,
        } = this.computeEffectiveShift();

        // 3. Spacer + scroll anchoring — uses effective shift so spacer
        // accounts for live search row height.
        this.ensureSpacerChrome();
        if (this.spacerEl) {
          setStyle(this.spacerEl, 'height', `${effectiveShift}px`);
        }
        this.spacerActive = true;

        // Update toolbarBgEl to cover full bars area (toolbar + search).
        this.syncToolbarBgHeight(toolbarH, searchH);

        // 4. Heading sticky top (inline styles, not CSS — invariant)
        this.applySpacerHeadingTops(effectiveShift);

        // 5. Restore mask-image gradient — gradient swap (opaque → cached)
        // keeps the compositor render surface allocated, so only the mask
        // texture updates. No cross-subtree rasterization.
        this.restoreMaskImage();

        this.programmaticScroll = false;
        this.prevScrollTop = this.scrollEl.scrollTop;

        // 6. WAAPI header/navbar/toolbar — same composite priority ordering
        const oldAnims = [...this.barAnims];
        this.barAnims = [];

        if (this.viewHeaderEl) {
          this.barAnims.push(
            this.viewHeaderEl.animate(
              [{ transform: headerFrom }, { transform: 'translateY(0)' }],
              HEADER_SLIDE_OPTS
            ),
            this.viewHeaderEl.animate(OPACITY_SHOW_FRAMES, BAR_FADE_OPTS)
          );
        }

        for (const a of oldAnims) a.cancel();
        this.clearHeaderInlines();
        // Re-set header show state cleared by clearHeaderInlines —
        // min-height:0 collapses the tap shield so it doesn't cover
        // the toolbar overlay (z-index 30 > 29, 90px overlap).
        this.viewHeaderEl?.classList.add('dynamic-views-header-show');
        // Opaque header bg during show slide — prevents content visible
        // through the transparent header area. Set AFTER clearHeaderInlines
        // (which clears background). Removed at idle by clearHeaderInlines.
        // Inline: Android-only — adding to shared header-show CSS class would affect iOS.
        if (this.viewHeaderEl) {
          setStyle(
            this.viewHeaderEl,
            'background',
            'var(--dynamic-views-background-primary)',
            'important'
          );
        }

        this.barAnims.push(
          this.navbarEl.animate(
            [{ transform: navbarFrom }, { transform: 'translateY(0)' }],
            NAVBAR_SLIDE_OPTS
          ),
          this.navbarEl.animate(OPACITY_SHOW_FRAMES, BAR_FADE_OPTS)
        );
        this.clearNavbarInlines();

        // Toolbar/search WAAPI fade — 300ms ease-in-out. CSS
        // full-screen-active sets opacity:0 (no !important), WAAPI overrides
        // it. Opaque toolbarBgEl (z-index 28) behind them prevents content
        // showing through during the fade.
        if (this.toolbarEl) {
          this.barAnims.push(
            this.toolbarEl.animate(OPACITY_SHOW_FRAMES, UI_FADE_OPTS)
          );
        }
        if (this.searchRowEl) {
          this.barAnims.push(
            this.searchRowEl.animate(OPACITY_SHOW_FRAMES, UI_FADE_OPTS)
          );
        }

        this.capacitorRafId = window.requestAnimationFrame(() => {
          this.capacitorRafId = null;
          void capacitorStatusBar?.show();
        });
      });

      // Idle: spacer persists until next hide or until user scrolls to top.
      // No unwind needed (no transform) — just resolve at top.
      this.pendingLayout = () => {
        if (this.scrollEl.scrollTop <= 1) {
          if (this.spacerResolveTimer != null) {
            window.clearTimeout(this.spacerResolveTimer);
            this.spacerResolveTimer = null;
          }
          this.commitSpacerResolve();
          return;
        }
        // Cancel WAAPI fill:forwards — holds final frame indefinitely and
        // blocks CSS transitions on those elements until cancelled.
        this.cancelAnimations();
      };
      return;
    }

    // iOS: synchronous layout + rAF animation + deferred settle.
    // Layout MUST be synchronous (same frame as scroll event) — deferring
    // to rAF creates two consecutive compositor pauses that kill momentum.
    // The hide path follows the same pattern: synchronous layout, rAF animation.
    void capacitorStatusBar?.show();

    // Clear tap-shield class + inlines BEFORE adding show class — the
    // tap-shield CSS (opacity:0, transform) would block the full-screen-showing
    // CSS that restores the header.
    this.clearHeaderInlines();
    // Collapse header during show — standard rule sets min-height: ~91px for
    // tap shield, but during show the inflated header overlaps the toolbar.
    // CSS class sets min-height:0, z-index:30, pointer-events:auto.
    if (this.viewHeaderEl) {
      this.viewHeaderEl.classList.add('dynamic-views-header-show');
      // No forced recalc — batching header-show + full-screen-showing into
      // a single style recalc eliminates the intermediate paint frame that
      // caused a white flash on WebKit (children not composited for 1 frame).
      // Trade-off: header entrance transition may not animate (browser sees
      // start=end state), but the header is behind the toolbar anyway.
    }

    // Synchronous layout — single compositor pause, UIScrollView resumes
    this.leafContent.classList.add('full-screen-showing');

    // Position search row as absolute overlay — the in-flow height:0→auto
    // reflow kills WebKit UIScrollView momentum. Absolute positioning
    // avoids reflow entirely (same pattern as Android show overlays).
    if (this.searchRowEl) {
      const toolbarH = this.cachedToolbarH;
      this.searchRowEl.classList.add('dynamic-views-show-overlay');
      setStyle(this.searchRowEl, 'top', `${toolbarH}px`, 'important');
      setStyle(this.searchRowEl, 'opacity', '1');
    }

    // iOS margin-top compensation — settled vs unsettled
    if (!this.settled) {
      // Hide offset still active — remove it (bars returning, shift no longer needed).
      // Offset removal + bar restoration cancel geometrically (zero net shift).
      this.container.style.removeProperty('margin-top');
      this.container.style.removeProperty('transition');
    }
    // Settled: no reverse offset — content shifts down naturally as bars
    // appear (same as Safari address bar). Settle adjusts scrollTop at idle.

    // Navbar restore — clear hide-path inlines that block the CSS class
    // (inline !important beats rule !important). Keep transition — it
    // persists from hide, producing an animated reveal (slide up + fade in).
    this.navbarEl.style.removeProperty('transform');
    this.navbarEl.style.removeProperty('opacity');
    this.navbarEl.style.removeProperty('pointer-events');
    this.navbarEl.classList.add('dynamic-views-navbar-show');

    // Restore mask-image gradient — gradient swap (opaque → cached) keeps the compositor render surface allocated (same as Android show rAF).
    this.restoreMaskImage();

    // Toolbar + search WAAPI fade-in — deferred to rAF.
    // WAAPI is compositor-driven (no continuous main-thread work).
    this.pendingRafId = window.requestAnimationFrame(() => {
      if (this.toolbarEl) {
        this.barAnims.push(
          this.toolbarEl.animate(OPACITY_SHOW_FRAMES, UI_FADE_OPTS)
        );
      }
      if (this.searchRowEl) {
        this.barAnims.push(
          this.searchRowEl.animate(OPACITY_SHOW_FRAMES, UI_FADE_OPTS)
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
        // Re-measure totalShift — search row overlay keeps natural height
        // (position:absolute, height:auto), so computeEffectiveShift()
        // returns the correct live value including search.
        const { shift: liveShift } = this.computeEffectiveShift();
        if (liveShift > 0) this.totalShift = liveShift;

        // Compensate for geometry shift when inlines are cleared and classes
        // removed (Obsidian margins push scroll container down). Skip near
        // top — bars appeared naturally, and adding totalShift scrolls the
        // first cards off-screen.
        const before = this.scrollEl.scrollTop;
        if (before >= this.totalShift) {
          this.scrollEl.scrollTop = before + this.totalShift;
        }
      }

      // Unlock → remove classes → flex recalculates → measure → relock.
      // The 2s settle delay outlasts the iOS scroll indicator fade,
      // so the unlock-relock is invisible.
      this.scrollEl.style.removeProperty('height');
      // Cancel WAAPI before class removal — same reason as hide path
      this.cancelAnimations();
      // Clear search row overlay before class removal — batched into
      // the same style recalc so the search row transitions directly
      // from overlay to natural state (no intermediate hidden frame).
      if (this.searchRowEl) {
        this.searchRowEl.classList.remove('dynamic-views-show-overlay');
        clearStyles(this.searchRowEl, ['top', 'opacity']);
      }
      this.leafContent.classList.remove('full-screen-showing');
      this.clearHeaderInlines();
      this.leafContent.classList.remove('full-screen-active');
      this.clearBackgroundInlines();
      this.isActiveHider = false;

      this.clearMaskImageInline();

      // Navbar cleanup
      this.clearNavbarInlines();

      this.settled = false;

      this.pendingRafId = window.requestAnimationFrame(() => {
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
    this.touchActive = true;
    this.accumulatedDelta = 0;
    this.touchStartY = e.touches[0].clientY;
    this.touchStartTime = Date.now();
  }

  private onTouchEnd(e: TouchEvent): void {
    this.touchActive = false;
    if (!this.barsHidden) return;

    const dy = Math.abs(
      (e.changedTouches[0]?.clientY ?? this.touchStartY) - this.touchStartY
    );
    const dt = Date.now() - this.touchStartTime;

    // Only treat as tap if minimal movement and short duration
    if (
      dy >= FULL_SCREEN_TAP_MAX_DISTANCE ||
      dt >= FULL_SCREEN_TAP_MAX_DURATION_MS
    )
      return;

    const target = e.target as HTMLElement | null;
    if (!target) return;

    // Group collapse region: chevron + property + value trigger fold/unfold
    if (target.closest('.bases-group-collapse-region')) return;

    const isCard = target.closest('.card') != null;

    // Tapped outside a card — reveal bars immediately (skip further closest() traversals)
    if (!isCard) {
      this.barsHidden = false;
      this.lastToggleTime = Date.now();
      this.showBarsUI();
      return;
    }

    const isOpenOnTitle = this.body.classList.contains(OPEN_ON_TITLE_CLASS);

    // Don't reveal bars when tapping a card image — let image viewer handle it.
    // Exception: reveal if image viewer disabled via Style Settings AND
    // open file action is 'press on title' (image tap is non-interactive).
    const isImage =
      target.closest('.card-cover') != null ||
      target.closest('.card-thumbnail') != null;
    if (isImage) {
      const viewerDisabled = this.body.classList.contains(
        'dynamic-views-image-viewer-disabled'
      );
      if (!viewerDisabled || !isOpenOnTitle) return;
    }

    // Poster cards with images: tap toggles poster-revealed — never reveal bars
    if (target.closest('.image-format-poster.has-poster')) return;

    // Card in open-on-title mode: body tap reveals bars, title link opens file
    if (isOpenOnTitle && !target.closest('.card-title a')) {
      this.barsHidden = false;
      this.lastToggleTime = Date.now();
      this.showBarsUI();
    }
    // Default mode (tap card to open): no reveal — navigation handles it
  }

  /** Tap on invisible view-header (status bar zone) — deferred reveal.
   *  Two-layer momentum guard:
   *  1. Recency check — if fast scroll events occurred within
   *     REVEAL_RECENCY_MS, the tap landed during active momentum and
   *     is rejected outright. Needed because mobile browsers kill fling
   *     momentum on touch contact, zeroing the delta the timer would see.
   *  2. Deferred timer — queues a 100ms timer. If downward scroll events
   *     exceed REVEAL_CANCEL_DELTA within this window (e.g., desktop or
   *     platforms that preserve momentum), onScroll cancels the timer.
   *  Matches native Obsidian's emergent behavior where fast momentum
   *  suppresses reveal but slow/dying momentum allows it. */
  private onHeaderTap(e: TouchEvent): void {
    if (!this.barsHidden) return;

    // Suppress click synthesis — without this, the browser fires a click
    // ~300ms after touchend on the header child (title, triple-dot button).
    // The heading-forward path returns early without the click-eater timeout,
    // so preventDefault is the only reliable way to block it on all paths.
    e.preventDefault();

    // The view-header acts as a tap shield when bars are hidden — it covers the status bar zone with pointer-events active to intercept reveals. Stuck group headings straddle this zone, so their collapse/tag/folder taps are swallowed. Temporarily lower pointer-events, hit-test the real target, and forward the click before the deferred reveal timer fires.
    const touch = e.changedTouches[0];
    if (touch && this.viewHeaderEl) {
      // Temporarily disable pointer-events to hit-test behind the header.
      // !important needed to override settle inline (also !important).
      // Inline: transient hit-test — set and restored in 2 lines.
      setStyle(this.viewHeaderEl, 'pointer-events', 'none', 'important');
      const target = this.scrollEl.ownerDocument.elementFromPoint(
        touch.clientX,
        touch.clientY
      );
      setStyle(this.viewHeaderEl, 'pointer-events', 'auto', 'important');
      if (target && target.closest('.bases-group-heading')) {
        (target as HTMLElement).click();
        return;
      }
    }

    // Mobile browsers kill fling momentum on touch contact, so the
    // deferred timer's scroll-delta check sees ~0 and can't detect the
    // fling. Guard against this by checking whether fast scroll events
    // occurred recently — if so, the tap landed during active momentum.
    if (Date.now() - this.lastFastScrollTime < FULL_SCREEN_REVEAL_RECENCY_MS) {
      // Eat synthesized click — preventDefault on touchend alone doesn't
      // reliably suppress it on Android WebView. Without this, the click
      // fires ~300ms later on an invisible header child (title, back button).
      this.viewHeaderEl?.addEventListener(
        'click',
        (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
        },
        { capture: true, once: true }
      );
      return;
    }

    if (this.pendingRevealTimer != null)
      window.clearTimeout(this.pendingRevealTimer);
    this.pendingRevealTimer = window.setTimeout(() => {
      this.pendingRevealTimer = null;
      if (!this.barsHidden) return;
      // Eat the synthesized click from the touch that triggered this
      // reveal — without this, the click lands on an invisible header
      // child (e.g., triple-dot button) and opens it concurrently.
      this.viewHeaderEl?.addEventListener(
        'click',
        (e) => {
          e.stopPropagation();
          e.preventDefault();
        },
        { capture: true, once: true }
      );
      this.barsHidden = false;
      this.lastToggleTime = Date.now();
      this.showBarsUI();
    }, FULL_SCREEN_REVEAL_DEFER_MS);
  }
}

/** Lazy-init full screen controller. Returns null if DOM elements are missing (Android: .mobile-navbar may not exist at construction time due to FUSE filesystem delays). */
export function createFullScreenController(
  scrollEl: HTMLElement,
  containerEl: HTMLElement,
  plugin: {
    persistenceManager: {
      getPluginSettings(): { fullScreen: boolean };
    };
  },
  register: (cleanup: () => void) => void
): FullScreenController | null {
  const ownerDoc = scrollEl.ownerDocument;
  const viewContent = scrollEl.closest<HTMLElement>('.view-content');
  const navbarEl = ownerDoc.querySelector<HTMLElement>('.mobile-navbar');
  if (!viewContent || !navbarEl) return null;

  const controller = new FullScreenController({
    scrollEl,
    container: containerEl,
    viewContent,
    navbarEl,
  });
  if (plugin.persistenceManager.getPluginSettings().fullScreen) {
    controller.mount();
  }
  register(() => controller.unmount());
  return controller;
}
