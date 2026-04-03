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
  FULL_SCREEN_BRIDGE_RESOLVE_DELAY_MS,
  FULL_SCREEN_REVEAL_DEFER_MS,
  FULL_SCREEN_REVEAL_CANCEL_DELTA,
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

/** Static keyframe arrays — hoisted to module scope to avoid per-call allocation */
const OPACITY_HIDE_FRAMES: Keyframe[] = [{ opacity: 1 }, { opacity: 0 }];
const OPACITY_SHOW_FRAMES: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];

/** Fully-opaque mask gradient — keeps compositor render surface allocated during hide. */
const OPAQUE_MASK = 'linear-gradient(rgb(0,0,0),rgb(0,0,0))';

type BridgeOverlaySection = {
  heading: HTMLElement;
  top: number;
  bottom: number;
  height: number;
};

type BridgeOverlaySnapshot = {
  anchorTop: number;
  sections: BridgeOverlaySection[];
};

export interface FullScreenElements {
  scrollEl: HTMLElement; // .bases-view
  container: HTMLElement; // .dynamic-views-bases-container
  viewContent: HTMLElement; // .view-content
  navbarEl: HTMLElement; // .mobile-navbar
}

// Capacitor StatusBar plugin — hides/shows iOS system status bar elements
const capacitorStatusBar = globalThis.Capacitor?.Plugins?.StatusBar;

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
  private bridgePhaseActive = false;
  private totalShift = 0;
  private totalShiftMeasured = false;
  private originalMarginTop = 0;
  private prevScrollTop = 0;
  private accumulatedDelta = 0;
  private programmaticScroll = false;
  private navbarHeight = 0;
  private headerShift = 0;
  private pendingLayout: (() => void) | null = null;
  private scrollIdleTimer: ReturnType<typeof setTimeout> | null = null;
  private bridgeResolveTimer: ReturnType<typeof setTimeout> | null = null;
  private lastBridgePx = -1;
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

  // Fixed viewport overlay — single cloned heading on document.body during
  // Android show bridge. Constant anchor position, scroll-space classification.
  private bridgeAnchorTop = 0;
  private bridgeOverlaySections: BridgeOverlaySection[] = [];
  private bridgeOverlayHost: HTMLElement | null = null;
  private bridgeOverlayLane: HTMLElement | null = null;
  private bridgeOverlaySource: HTMLElement | null = null;
  // Touch tracking for tap-to-reveal
  private touchStartY = 0;
  private touchStartTime = 0;
  private pendingRevealTimer: ReturnType<typeof setTimeout> | null = null;

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

    // Cache navbar/header heights — static for the session (safe area insets
    // and bar heights don't change after app launch).
    const bodyCS = getComputedStyle(this.body);
    this.navbarHeight =
      (parseFloat(bodyCS.getPropertyValue('--navbar-height')) || 52) +
      (parseFloat(bodyCS.getPropertyValue('--safe-area-inset-bottom')) || 34);
    this.headerShift =
      (parseFloat(bodyCS.getPropertyValue('--view-header-height')) || 44) +
      (parseFloat(bodyCS.getPropertyValue('--safe-area-inset-top')) || 47);

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
    this.programmaticScroll = false;
    this.pendingLayout = null;
    this.isActiveHider = false;

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
    clearStyles(this.viewHeaderEl, [
      'transform',
      'opacity',
      'pointer-events',
      'transition',
      'z-index',
      'margin-top',
      'min-height',
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

    // Header: pointer-events + z-index above ::before scrim (z-index 25 on grouped) during show animation.
    if (this.viewHeaderEl) {
      setStyle(this.viewHeaderEl, 'pointer-events', 'auto', 'important');
      setStyle(this.viewHeaderEl, 'z-index', '30', 'important');
      setStyle(this.viewHeaderEl, 'min-height', '0', 'important');
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
      clearStyles(this.viewHeaderEl, [
        'z-index',
        'pointer-events',
        'min-height',
      ]);
    }

    // ::before scrim + ::after scroll gradient: revert to CSS defaults
    this.leafContent.removeAttribute('data-dynamic-views-show');
  }

  /** Resolve show bridge at scrollTop=0. All changes in one synchronous
   *  block — classList.remove triggers a massive restyle that subsumes
   *  the content position change. No scrollTop write needed. */
  private resolveBridgeAtTop(): void {
    this.container.style.removeProperty('transform');
    this.container.style.removeProperty('transition');
    this.clearBridgeOverlay();
    this.clearShowInlines();
    this.scrollEl.style.removeProperty('height');
    this.classTarget.classList.remove('full-screen-active');
    this.clearBackgroundInlines();
    this.clearMaskImageInline();
    this.bridgePhaseActive = false;
    this.isActiveHider = false;
    this.settled = false;
    this.barsHidden = false;
    this.lastBridgePx = -1;
  }

  /** Full bridge resolve: clear WAAPI/show-state artifacts, then
   *  resolveBridgeAtTop for class removal + flag reset + height relock. */
  private commitBridgeResolve(): void {
    this.programmaticScroll = true;
    this.cancelAnimations();
    this.leafContent.removeAttribute('data-dynamic-views-show');
    this.clearNavbarInlines();
    this.clearHeaderInlines();
    this.resolveBridgeAtTop();
    this.pendingRafId = requestAnimationFrame(() => {
      this.programmaticScroll = false;
      this.prevScrollTop = this.scrollEl.scrollTop;
      this.accumulatedDelta = 0;
      this.lockedScrollHeight = this.scrollEl.offsetHeight;
      setStyle(this.scrollEl, 'height', `${this.lockedScrollHeight}px`);
    });
  }

  /** Scroll-linked bridge unwind — reduces bridge magnitude as scrollTop
   *  approaches 0. Zone scales with pane height so the non-1:1 motion
   *  is spread across the full visible scroll distance (~1.18× on Pixel 8a).
   *  Transform writes are compositor-only (no layout, no tile invalidation).
   *  Smoothstep easing keeps the rate-of-change gentle at boundaries. */
  private unwindBridge(currentTop: number): void {
    if (this.totalShift <= 0) return;
    const zone = this.lockedScrollHeight || this.totalShift * 3;
    const t = Math.min(1, currentTop / zone);
    const eased = t * t * (3 - 2 * t);
    const bridgePx = Math.round(this.totalShift * eased);
    if (bridgePx !== this.lastBridgePx) {
      this.lastBridgePx = bridgePx;
      setStyle(this.container, 'transform', `translateY(-${bridgePx}px)`);
    }
    this.syncBridgeOverlay(currentTop, bridgePx);
  }

  /** Build overlay data from the pre-show layout snapshot. */
  private snapshotBridgeOverlay(): BridgeOverlaySnapshot | null {
    const headings = Array.from(
      this.container.querySelectorAll<HTMLElement>(
        '.dynamic-views-group-section > .bases-group-heading:not(.collapsed)'
      )
    );
    if (headings.length === 0) return null;

    const win = this.scrollEl.ownerDocument.defaultView;
    if (!win) return null;

    // Anchor = bars-SHOWING stuck position: scroll container top - viewPadding.
    // Matches where the heading naturally sticks after bridge resolution
    // (position: sticky; top: -viewPadding — _grid-masonry-shared.scss:28).
    const scrollCS = win.getComputedStyle(this.scrollEl);
    const viewPadding = parseFloat(
      scrollCS.getPropertyValue('--dynamic-views-bases-view-padding')
    );
    if (!Number.isFinite(viewPadding)) return null;
    const anchorTop = this.totalShift - viewPadding;

    const containerRect = this.container.getBoundingClientRect();
    const sections = headings.map((heading) => {
      const section = heading.closest<HTMLElement>(
        '.dynamic-views-group-section'
      )!;
      const rect = section.getBoundingClientRect();
      // Layout offset within container — BCR difference cancels both
      // scrollTop and the container's bridge transform automatically.
      const top = rect.top - containerRect.top;
      return {
        heading,
        top,
        bottom: top + section.offsetHeight,
        height: heading.getBoundingClientRect().height,
      };
    });

    return { anchorTop, sections };
  }

  /** Capture section geometry and create fixed overlay host on leafContent.
   *  anchorTop: heading screen Y captured before applyShowInlines shifts
   *  the scrollport. Constant through the entire bridge lifecycle. */
  private captureBridgeOverlay(snapshot: BridgeOverlaySnapshot): boolean {
    this.clearBridgeOverlay();
    this.bridgeAnchorTop = snapshot.anchorTop;
    this.bridgeOverlaySections = snapshot.sections;

    if (this.bridgeOverlaySections.length === 0) return false;

    const doc = this.scrollEl.ownerDocument;
    this.bridgeOverlayHost = doc.createElement('div');
    this.bridgeOverlayHost.className = 'dynamic-views-bridge-heading-host';
    this.bridgeOverlayLane = doc.createElement('div');
    this.bridgeOverlayLane.className = 'dynamic-views-bridge-heading-lane';
    this.bridgeOverlayHost.appendChild(this.bridgeOverlayLane);
    // Append to leafContent (not body) — body children may paint behind
    // .app-container's stacking context. leafContent is in the correct
    // stacking context for z-index 26 to work against the scrim (25).
    this.leafContent.appendChild(this.bridgeOverlayHost);

    this.syncBridgeOverlay(this.scrollEl.scrollTop, this.totalShift);
    return true;
  }

  /** Position the overlay heading. Runs per scroll event during bridge.
   *  stickLine determines which heading is active (scroll-space only —
   *  no bridgePx dependency). Overlay Y is the constant anchor, pushed
   *  up only when the next section approaches. */
  private syncBridgeOverlay(currentTop: number, bridgePx: number): void {
    if (!this.bridgeOverlayHost || !this.bridgeOverlayLane) return;

    // stickLine: the scroll-space Y where the anchor sits. A heading
    // whose section spans this line is the active (stuck) heading.
    const stickLine = currentTop + this.bridgeAnchorTop;
    let activeIndex = -1;
    for (let i = 0; i < this.bridgeOverlaySections.length; i++) {
      const s = this.bridgeOverlaySections[i];
      if (stickLine >= s.top && stickLine < s.bottom) {
        activeIndex = i;
        break;
      }
    }

    if (activeIndex === -1) {
      setStyle(this.bridgeOverlayHost, 'display', 'none');
      if (this.bridgeOverlaySource) {
        this.bridgeOverlaySource.style.removeProperty('opacity');
        this.bridgeOverlaySource.style.removeProperty('pointer-events');
        this.bridgeOverlaySource = null;
      }
      return;
    }

    this.bridgeOverlayHost.style.removeProperty('display');

    const active = this.bridgeOverlaySections[activeIndex];
    const scrollRect = this.scrollEl.getBoundingClientRect();

    // Match overlay width to scroll container
    const hostS = this.bridgeOverlayHost.style;
    hostS.left = `${Math.round(scrollRect.left)}px`;
    hostS.width = `${Math.round(scrollRect.width)}px`;

    // Clone heading into lane when active heading changes
    if (this.bridgeOverlaySource !== active.heading) {
      // Unhide previous source
      if (this.bridgeOverlaySource) {
        this.bridgeOverlaySource.style.removeProperty('opacity');
        this.bridgeOverlaySource.style.removeProperty('pointer-events');
      }
      const clone = active.heading.cloneNode(true) as HTMLElement;
      clone.classList.add('stuck');
      // Delegate clicks to matching element in original heading via
      // child-index path traversal (handles collapse, folder, tag clicks).
      clone.addEventListener('click', (e) => {
        if (!this.bridgeOverlaySource) return;
        const target = e.target as HTMLElement;
        const path: number[] = [];
        let el: HTMLElement | null = target;
        while (el && el !== clone) {
          const parent = el.parentElement;
          if (!parent) return;
          path.unshift(Array.from(parent.children).indexOf(el));
          el = parent;
        }
        let orig: Element = this.bridgeOverlaySource;
        for (const idx of path) {
          if (idx < orig.children.length) orig = orig.children[idx];
          else return;
        }
        (orig as HTMLElement).click();
      });
      this.bridgeOverlayLane.replaceChildren(clone);
      this.bridgeOverlaySource = active.heading;
      // Hide original
      setStyle(active.heading, 'opacity', '0', 'important');
      setStyle(active.heading, 'pointer-events', 'none', 'important');
    }

    // Y position: constant anchor, pushed up by next section approaching
    let y = this.bridgeAnchorTop;
    const next = this.bridgeOverlaySections[activeIndex + 1];
    if (next) {
      // Next heading's visual screen Y during bridge
      const nextScreenY = this.totalShift + next.top - currentTop - bridgePx;
      y = Math.min(y, Math.round(nextScreenY - active.height));
    }
    setStyle(this.bridgeOverlayLane, 'transform', `translateY(${y}px)`);
  }

  /** Remove overlay and unhide original heading. */
  private clearBridgeOverlay(): void {
    if (this.bridgeOverlaySource) {
      this.bridgeOverlaySource.style.removeProperty('opacity');
      this.bridgeOverlaySource.style.removeProperty('pointer-events');
      this.bridgeOverlaySource = null;
    }
    this.bridgeOverlayHost?.remove();
    this.bridgeOverlayHost = null;
    this.bridgeOverlayLane = null;
    this.bridgeAnchorTop = 0;
    this.bridgeOverlaySections = [];
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
    if (this.bridgeResolveTimer != null) {
      clearTimeout(this.bridgeResolveTimer);
      this.bridgeResolveTimer = null;
    }
    if (this.pendingRevealTimer != null) {
      clearTimeout(this.pendingRevealTimer);
      this.pendingRevealTimer = null;
    }
    // Remove full screen state only if this instance set it
    if (this.isActiveHider) {
      if (this.isAndroid) {
        this.clearShowInlines();
      } else {
        this.leafContent.classList.remove('full-screen-showing');
      }
      this.clearMaskImageInline();
      this.classTarget.classList.remove('full-screen-active');
      this.clearBackgroundInlines();
      void capacitorStatusBar?.show();
      this.isActiveHider = false;
    }
    // Clean up bridge + locked height + padding class
    this.container.classList.remove('dynamic-views-full-screen-enabled');
    this.container.style.removeProperty('margin-top');
    this.container.style.removeProperty('transition');
    this.container.style.removeProperty('--dynamic-views-scroll-past-end');
    this.container.style.removeProperty('transform');
    this.clearBridgeOverlay();
    this.scrollEl.style.removeProperty('height');

    // Cancel WAAPI animations (Android)
    this.cancelAnimations();

    // Restore navbar + header
    this.clearNavbarInlines();
    this.navbarEl.classList.remove('dynamic-views-navbar-animated');
    this.clearHeaderInlines();

    this.pendingLayout = null;
    this.barsHidden = false;
    this.settled = false;
    this.bridgePhaseActive = false;
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

    // Cancel pending header-tap reveal during active downward scroll.
    // Fast momentum (delta > threshold) cancels; dying momentum allows reveal.
    if (
      this.pendingRevealTimer != null &&
      delta > FULL_SCREEN_REVEAL_CANCEL_DELTA
    ) {
      clearTimeout(this.pendingRevealTimer);
      this.pendingRevealTimer = null;
    }

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

    // Scroll-linked bridge unwind — gradually reduce bridge magnitude
    // as scrollTop approaches 0. Transform is compositor-only (safe
    // during fling). At scrollTop=0, bridge is already 0.
    if (this.isAndroid && this.bridgePhaseActive && !this.barsHidden) {
      this.unwindBridge(currentTop);

      // Bridge fully unwound at top — schedule cleanup at idle (visual no-op
      // since bridge is already at 0). resolveBridgeAtTop handles class
      // removal, show inline cleanup, mask-image, and flag reset.
      if (currentTop <= 1) {
        if (this.bridgeResolveTimer == null) {
          this.bridgeResolveTimer = setTimeout(() => {
            this.bridgeResolveTimer = null;
            if (this.scrollEl.scrollTop > 1) return;
            this.pendingLayout = null;
            if (this.scrollIdleTimer != null) {
              clearTimeout(this.scrollIdleTimer);
              this.scrollIdleTimer = null;
            }
            this.commitBridgeResolve();
          }, FULL_SCREEN_BRIDGE_RESOLVE_DELAY_MS);
        }
      } else if (this.bridgeResolveTimer != null) {
        clearTimeout(this.bridgeResolveTimer);
        this.bridgeResolveTimer = null;
      }
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

    // Suppress hide while search row is open — user is actively filtering.
    // Reads inline style (O(1), no layout forced) set by Obsidian's toggle.
    const searchOpen =
      this.searchRowEl != null && this.searchRowEl.style.display !== 'none';

    if (
      this.accumulatedDelta > FULL_SCREEN_HIDE_DEAD_ZONE &&
      !this.barsHidden &&
      !searchOpen &&
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

  /** Re-measure totalShift from live DOM. Skips if already measured successfully (totalShift is stable after first valid measurement — the startup race where mount-time GBR returns 0 is the only scenario requiring remeasurement). Only valid when full-screen-active is NOT on the class target — otherwise margin-top reads as 0 from the class rule. */
  private measureTotalShift(): void {
    if (this.totalShiftMeasured) return;
    if (this.classTarget.classList.contains('full-screen-active')) return;
    this.originalMarginTop =
      parseFloat(getComputedStyle(this.viewContent).marginTop) || 0;
    this.totalShift =
      this.originalMarginTop +
      (this.toolbarEl?.offsetHeight ?? 0) +
      (this.searchRowEl?.offsetHeight ?? 0);
    if (this.totalShift > 0) this.totalShiftMeasured = true;
  }

  // ---------------------------------------------------------------------------
  // Hide / Show logic
  // ---------------------------------------------------------------------------

  /** HIDE — immediate, momentum-safe */
  private hideBarsUI(): void {
    this.isActiveHider = true;

    if (this.bridgeResolveTimer != null) {
      clearTimeout(this.bridgeResolveTimer);
      this.bridgeResolveTimer = null;
    }

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
    this.container.style.removeProperty('transform');
    this.container.style.removeProperty('transition');
    this.clearBridgeOverlay();
    this.clearHeaderInlines();

    // Re-measure ONLY in clean state (no full screen classes).
    // During rapid show→hide, full-screen-active is still on the class target —
    // getComputedStyle would read margin-top: 0 (class rule) instead of ~99px.
    this.measureTotalShift();

    void capacitorStatusBar?.hide();

    // Swap mask-image to fully-opaque gradient (no visual masking).
    // Using an opaque gradient instead of 'none' keeps the compositor render
    // surface allocated — show path swaps back to cached gradient without
    // the expensive surface recreation + cross-subtree rasterization.
    if (this.workspaceSplitEl) {
      setStyle(
        this.workspaceSplitEl,
        '-webkit-mask-image',
        OPAQUE_MASK,
        'important'
      );
      setStyle(this.workspaceSplitEl, 'mask-image', OPAQUE_MASK, 'important');
    }

    // Navbar: animated hide via inline transform + opacity
    const navbarHeight = this.navbarHeight;
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
      this.classTarget.classList.add('full-screen-active');
      this.applyBackgroundInlines();
      // Skip scrollTop adjustment if show bridge was active — scrollTop was
      // never increased by the show path, so no reversal needed. Bridge
      // transform was already cleared above (container removeProperty).
      if (!this.bridgePhaseActive) {
        // Clamp to 0 when near top — without clamping, before - totalShift
        // goes negative. The auto-show delta<=0 check prevents the scrollTop=0
        // landing from triggering auto-show on the next event.
        this.scrollEl.scrollTop = Math.max(0, before - this.totalShift);
      }
      this.bridgePhaseActive = false;
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
      const headerShift = this.headerShift;
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
          this.navbarEl.animate(OPACITY_HIDE_FRAMES, BAR_FADE_OPTS)
        );
        this.navbarEl.classList.add('dynamic-views-navbar-hidden');

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
            hEl.animate(OPACITY_HIDE_FRAMES, BAR_FADE_OPTS)
          );
          headerTransformAnim.onfinish = () => {
            // Snap header back to natural position — invisible tap shield
            // matching native Obsidian full-screen. fill:forwards held the
            // header off-screen; clearing transform returns it to the top
            // ~90px zone where it absorbs taps without content interaction.
            // margin-top:0 overrides Obsidian's safe-area-inset-top margin
            // so the shield covers the full zone from y=0.
            // z-index:30 above grouped ::before scrim (25) and sticky
            // headings (20) so taps reach the header in grouped views.
            setStyle(hEl, 'transform', 'translateY(0)', 'important');
            setStyle(hEl, 'opacity', '0', 'important');
            setStyle(hEl, 'margin-top', '0', 'important');
            setStyle(hEl, 'z-index', '30', 'important');
          };
        }

        // Toolbar + search WAAPI hide — opacity only. WAAPI fill:forwards
        // is required so show WAAPI wins by composite ordering (newer wins,
        // WAAPI §4.6). Without a hide WAAPI, show's fill:forwards competes
        // with CSS opacity:0 + will-change:opacity — Android WebView's
        // compositor collapses back to CSS after animation completes.
        if (this.toolbarEl) {
          this.barAnims.push(
            this.toolbarEl.animate(OPACITY_HIDE_FRAMES, UI_FADE_OPTS)
          );
        }
        if (this.searchRowEl) {
          this.barAnims.push(
            this.searchRowEl.animate(OPACITY_HIDE_FRAMES, UI_FADE_OPTS)
          );
        }
      });
      return;
    }

    // iOS: bridge + deferred settle (scrollTop writes kill momentum)
    setStyle(this.container, 'margin-top', `${this.totalShift}px`);
    setStyle(this.container, 'transition', 'none');
    this.leafContent.classList.add('full-screen-active');
    this.applyBackgroundInlines();
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
      // z-index:30 above grouped ::before scrim (25) and sticky
      // headings (20) so taps reach the header in grouped views.
      if (this.viewHeaderEl) {
        setStyle(this.viewHeaderEl, 'transform', 'translateY(0)', 'important');
        setStyle(this.viewHeaderEl, 'opacity', '0', 'important');
        setStyle(this.viewHeaderEl, 'margin-top', '0', 'important');
        setStyle(this.viewHeaderEl, 'z-index', '30', 'important');
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
      // Android show: WAAPI header + navbar, ::before scrim, show bridge.
      //
      // applyShowInlines restores margin-top + toolbar + search. The ::before
      // scrim (solid background, full height) covers the gap while the header
      // WAAPI slides in. Show bridge (margin-top: -totalShift on container)
      // cancels the visual shift — no scrollTop write in the show rAF.
      // Chrome/146 WebView tightened the single-threaded compositor frame
      // budget: any scrollTop write triggers a scroll layer repaint that
      // flashes .workspace background for one frame. Bridge
      // defers scrollTop to idle where the CSS background override on
      // .workspace masks the flash (same color as content background).
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
        `translateY(${this.navbarHeight}px)`;
      const headerFrom =
        this.viewHeaderEl?.style.getPropertyValue('transform') ||
        `translateY(-${this.headerShift}px)`;

      this.pendingRafId = requestAnimationFrame(() => {
        // Snapshot the active grouped heading geometry before applyShowInlines
        // changes the scrollport. Using scrollEl CSS variables for the anchor
        // avoids relying on getComputedStyle(heading).top being non-auto.
        const overlaySnapshot = this.snapshotBridgeOverlay();

        // Inline styles restore margin/toolbar/search — bypasses classList
        // to avoid style invalidation that drops frames on the
        // single-threaded Android WebView compositor. ::before scrim (always
        // full-height on Android during full-screen-active) covers the gap.
        this.applyShowInlines();

        // Show bridge: transform on container cancels the visual shift from
        // applyShowInlines (viewContent margin-top + toolbar expansion).
        // Compositor-only — no layout, no raster invalidation. Fixed overlay
        // on leafContent renders the active stuck heading outside the
        // scroll container's overflow clip and transform context.
        if (this.settled) {
          setStyle(
            this.container,
            'transform',
            `translateY(-${this.totalShift}px)`
          );
          if (overlaySnapshot) {
            this.captureBridgeOverlay(overlaySnapshot);
          }
          // Bridge is active regardless of overlay success — the transform
          // compensates for applyShowInlines layout shift. Overlay is cosmetic
          // (heading visibility), not structural (content positioning).
          this.bridgePhaseActive = true;
          this.lastBridgePx = -1;
        }

        // Restore mask-image gradient — gradient swap (opaque → cached)
        // keeps the compositor render surface allocated, so only the mask
        // texture updates. No cross-subtree rasterization.
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
            this.viewHeaderEl.animate(OPACITY_SHOW_FRAMES, BAR_FADE_OPTS)
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
          this.navbarEl.animate(OPACITY_SHOW_FRAMES, BAR_FADE_OPTS)
        );
        this.clearNavbarInlines();

        // Toolbar + search WAAPI show — opacity only.
        // CSS opacity (no !important on Android) is overridden by WAAPI.
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

        // Defer native status bar to next frame — separates window inset
        // change from CSS layout reflow on the single-threaded compositor.
        this.capacitorRafId = requestAnimationFrame(() => {
          this.capacitorRafId = null;
          void capacitorStatusBar?.show();
        });
      });

      // Idle: bridge unwinds scroll-linked (see unwindBridge) when user
      // approaches the top; persists at full magnitude otherwise. Show
      // inlines and full-screen-active stay until the next hide or until
      // the bridge unwinds to 0 at the top.
      this.pendingLayout = () => {
        // If bridge already unwound to 0 (scrollTop near top), do full
        // cleanup — visual no-op since transform is already 0.
        if (this.scrollEl.scrollTop <= 1) {
          if (this.bridgeResolveTimer != null) {
            clearTimeout(this.bridgeResolveTimer);
            this.bridgeResolveTimer = null;
          }
          this.commitBridgeResolve();
          return;
        }

        this.programmaticScroll = true;
        this.cancelAnimations();
        this.leafContent.removeAttribute('data-dynamic-views-show');
        this.clearNavbarInlines();
        this.clearHeaderInlines();

        this.pendingRafId = requestAnimationFrame(() => {
          this.programmaticScroll = false;
          this.prevScrollTop = this.scrollEl.scrollTop;
          this.accumulatedDelta = 0;
        });
      };
      return;
    }

    // iOS: synchronous layout + rAF animation + deferred settle.
    // Layout MUST be synchronous (same frame as scroll event) — deferring
    // to rAF creates two consecutive compositor pauses that kill momentum.
    // The hide path follows the same pattern: synchronous layout, rAF animation.
    void capacitorStatusBar?.show();

    // Clear tap-shield inlines BEFORE adding class — inline !important
    // overrides rule !important in the cascade, so the hide-settle inlines
    // (opacity:0, transform, margin-top) would block the full-screen-showing
    // CSS that restores the header.
    this.clearHeaderInlines();
    // Collapse header during show — base rule sets min-height: ~91px for
    // tap shield, but during show the inflated header overlaps the toolbar.
    // Inline min-height: 0 shrinks the layout box so toolbar taps pass.
    if (this.viewHeaderEl) {
      setStyle(this.viewHeaderEl, 'min-height', '0', 'important');
      // Force style recalc — commit the intermediate state (CSS
      // full-screen-active: translateY(-91px), opacity:0) before the
      // showing class applies (translateY(0), opacity:1). Without this,
      // the browser batches both changes and sees transform 0→0 (from
      // tap-shield inline to showing class), producing no transition.
      void this.viewHeaderEl.offsetHeight;
    }

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
    this.pendingRafId = requestAnimationFrame(() => {
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
      this.leafContent.classList.remove('full-screen-showing');
      this.clearHeaderInlines();
      this.leafContent.classList.remove('full-screen-active');
      this.clearBackgroundInlines();
      this.isActiveHider = false;

      this.clearMaskImageInline();

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

    // Tapped outside a card — reveal bars immediately (skip further closest() traversals)
    if (!isCard) {
      this.barsHidden = false;
      this.lastToggleTime = Date.now();
      this.showBarsUI();
      return;
    }

    const isOpenOnTitle = this.body.classList.contains(
      'dynamic-views-open-on-title'
    );

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
  }

  /** Tap on invisible view-header (status bar zone) — deferred reveal.
   *  Queues a 100ms timer. If downward scroll events continue (fast
   *  momentum), onScroll cancels the timer. If scroll stops or slows
   *  below REVEAL_CANCEL_DELTA, the timer fires and bars appear.
   *  Matches native Obsidian's emergent behavior where fast momentum
   *  suppresses reveal but slow/dying momentum allows it. */
  private onHeaderTap(): void {
    if (!this.barsHidden) return;
    if (this.pendingRevealTimer != null) clearTimeout(this.pendingRevealTimer);
    this.pendingRevealTimer = setTimeout(() => {
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
