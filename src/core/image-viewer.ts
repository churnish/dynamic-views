/**
 * Image viewer: the enlarged view opened from a card's cover or thumbnail.
 *
 * Owns the clone's lifecycle and its two mount modes — fullscreen appends to
 * `body`, constrained appends to the owning `.workspace-leaf` so the overlay
 * takes part in Obsidian's tab-drop preview — plus two gesture backends with
 * deliberately opposite transform orders, arrow navigation, drag-out, and the
 * keymap `Scope` that carries every viewer key.
 *
 * See docs/arch/image-viewer.md.
 */

import { Platform, Scope, TFile, setIcon, type App } from 'obsidian';

import { GESTURE_TIMEOUT_MS, VIEWER_DISMISS_SUPPRESS_MS } from './constants';
import {
  getImageDisplayName,
  getVaultPathFromResourceUrl,
  isExternalUrl,
} from './image';
import { brokenImageUrls, markImageBroken } from './image-loader';
import { getCachedBlobUrl } from './slideshow';
import { deferContainerHoverDrop } from './hover-and-touch';
import { getNextImageIndex } from './viewer-navigation';
import {
  getVideoIdFromThumbnailUrl,
  getYouTubeThumbnailUrl,
} from './youtube-preview';

/** Wheel event listener options (stored for proper cleanup) */
const WHEEL_OPTIONS: AddEventListenerOptions = { passive: false };

/**
 * Constants replicating the native lightbox's `handleWheelZoom`. Native
 * normalises `deltaY` by `deltaMode`, converts it to an **additive** zoom step,
 * and pans by a flat multiple of the raw delta once zoomed.
 */
const WHEEL_DELTA_LINE_SCALE = 40;
const WHEEL_DELTA_PAGE_SCALE = 800;
const WHEEL_ZOOM_DIVISOR = 150;
const WHEEL_PAN_MULTIPLIER = 1.5;
const VIEWER_MAX_ZOOM = 10;

type GestureMode = 'mobile' | 'desktop';

/**
 * `Platform.hasPhysicalKeyboard` is undocumented and absent from the typings,
 * which declare `Platform` as a const object literal — not an interface, so it
 * cannot be reached by module augmentation. It is **true on desktop** — the
 * desktop boot IIFE sets it alongside `isDesktopApp`/`isDesktop`
 * (app.js:226430) — and `emulateMobile()` forces it false, via the `App`
 * constructor's `emulate-mobile` branch (app.js:223079), so it cannot be
 * exercised through desktop mobile emulation. Only ever used to widen a mobile
 * case, so the desktop value never decides anything on its own.
 *
 * Line numbers read against Obsidian 1.13.6; re-resolve by symbol.
 */
function hasPhysicalKeyboard(): boolean {
  return (
    (Platform as unknown as { hasPhysicalKeyboard?: boolean })
      .hasPhysicalKeyboard === true
  );
}

// Store cleanup functions for event listeners (Map for explicit lifecycle control)
const viewerListenerCleanups = new Map<HTMLElement, () => void>();

// Closes the viewer a clone belongs to, keyed by that clone. `closeImageViewer`
// needs the two view-owned maps, which a caller outside a view — a ribbon
// action, a command — has no way to reach; this is the bridge for them.
const openViewerClosers = new Map<HTMLElement, () => void>();

// Last cursor position over an open viewer, keyed by the card's embed element.
// A WeakMap rather than `dataset`, so the mousemove handler writes one object
// instead of stringifying two numbers into attributes on every move.
const viewerCursorPositions = new WeakMap<
  HTMLElement,
  { x: number; y: number }
>();

// DOM-keyed, so entries are collected when cards unmount — no explicit cleanup
const viewerImageSets = new WeakMap<HTMLElement, string[]>();

/**
 * Registers the navigable image set for a card embed.
 *
 * Stores the renderer's live array, not a copy. The snapshot that keeps indices
 * stable is taken in `openImageViewer` instead, which is both cheaper — cards
 * whose viewer is never opened no longer pay for a copy — and better ordered:
 * URLs at indices 1+ are validated only on hover or first touch, and the
 * broken ones are spliced out of this very array, so a copy taken here is
 * always pre-validation.
 */
export function setViewerImageSet(embedEl: HTMLElement, urls: string[]): void {
  viewerImageSets.set(embedEl, urls);
}

/**
 * Force cleanup all viewers - call on view destruction
 * Removes clones from DOM, runs cleanup functions, clears all maps
 */
export function cleanupAllViewers(
  viewerCleanupFns: Map<HTMLElement, () => void>,
  viewerClones: Map<HTMLElement, HTMLElement>
): void {
  const docs = new Set<Document>();
  // Remove clones from DOM and run gesture cleanup
  const clones = Array.from(viewerClones.values());
  clones.forEach((clone) => {
    docs.add(clone.ownerDocument);
    clone.remove();
  });
  viewerClones.clear();

  viewerCleanupFns.forEach((cleanup) => {
    cleanup();
  });
  viewerCleanupFns.clear();

  // Listeners (keyboard, click, touch, ResizeObserver) and closers, pruned per
  // clone. Both maps are module-scope while the two above are per-view fields,
  // so clearing them outright would tear down a viewer still open in another
  // view — popping its keymap scope and dropping its closer while its clone
  // stays mounted, leaving Escape, the backdrop, the close button and
  // `closeAllViewers` all dead at once.
  for (const clone of clones) {
    viewerListenerCleanups.get(clone)?.();
    viewerListenerCleanups.delete(clone);
    openViewerClosers.delete(clone);
  }

  // Clones are removed directly above rather than through `closeImageViewer`,
  // so the body class it would have dropped has to be dropped here too — it
  // outlives the view otherwise, suppressing card focus rings app-wide
  for (const doc of docs) dropZoomedBodyClass(doc);
}

/**
 * Closes every open viewer, wherever its owning view lives.
 *
 * Each closer captures its own clone, whose `ownerDocument` drives the body
 * class drop, so popouts need no document enumeration here.
 */
export function closeAllViewers(): void {
  // Copied: each closer deletes its own entry as it runs
  for (const close of Array.from(openViewerClosers.values())) close();
}

/**
 * True when any viewer is open, in any window.
 *
 * Lets keyboard handlers skip a document-wide `.is-zoomed` query on the common
 * path. Sound across documents: the registry is keyed by the clone, which is
 * the only element that ever carries `.is-zoomed`, so an empty map means the
 * query would have found nothing wherever it ran.
 */
export function hasOpenViewer(): boolean {
  return openViewerClosers.size > 0;
}

/**
 * Drops the body zoom class once no viewer remains in this document.
 *
 * The fake-target exclusion is load-bearing now that the constrained clone
 * lives inside the leaf: during a tab drag Obsidian deep-clones the drop
 * target, so a copy of this very clone — `.is-zoomed` and all — exists in the
 * preview tree. Without it, closing mid-drag finds the copy and strands the
 * class.
 */
function dropZoomedBodyClass(doc: Document): void {
  if (
    !doc.querySelector(
      '.dynamic-views-image-embed.is-zoomed:not(.workspace-fake-target-container .dynamic-views-image-embed)'
    )
  ) {
    doc.body.classList.remove('dynamic-views-image-zoomed');
  }
}

/**
 * Rolls back the two mutations made before a viewer is known to be open.
 *
 * The trigger sets `viewer-active` on the source card and the body zoom class
 * goes on early, so any exit before setup finishes strands both: the class
 * suppresses card focus rings app-wide and the card keeps hover deactivation
 * suppressed. Shared by the early returns and the setup `catch`, which are the
 * only paths that can leave without a viewer.
 */
function abandonViewerOpen(embedEl: HTMLElement): void {
  dropZoomedBodyClass(embedEl.ownerDocument);
  embedEl.closest('.card')?.classList.remove('viewer-active');
}

/** Extended clone element type with original embed reference */
type CloneElement = HTMLElement & { __originalEmbed?: HTMLElement };

/**
 * The card embed a viewer clone was opened from, or undefined for any other
 * element. Exported so consumers read the expando through this module's own
 * type rather than re-declaring it behind a second cast.
 */
export function getViewerSourceEmbed(el: Element): HTMLElement | undefined {
  return (el as CloneElement).__originalEmbed;
}

/**
 * Closes image viewer clone and removes it from DOM
 */
function closeImageViewer(
  cloneEl: CloneElement,
  viewerCleanupFns: Map<HTMLElement, () => void>,
  viewerClones: Map<HTMLElement, HTMLElement>,
  restoreHoverIntent = true
): void {
  // Mark the source card to suppress touch-press interact from the dismiss tap
  const sourceCard = cloneEl.__originalEmbed?.closest<HTMLElement>('.card');
  if (sourceCard) {
    sourceCard.dataset.viewerDismissing = '1';
    setTimeout(
      () => delete sourceCard.dataset.viewerDismissing,
      VIEWER_DISMISS_SUPPRESS_MS
    );
    sourceCard.classList.remove('viewer-active');
  }

  cloneEl.remove();

  dropZoomedBodyClass(cloneEl.ownerDocument);

  // O(1) lookup using stored reference instead of iterating map
  const original = cloneEl.__originalEmbed;
  if (original) {
    viewerClones.delete(original);
    delete cloneEl.__originalEmbed;

    // Restore hover intent so cursor stays zoom-in/pointer after dismiss.
    // Clone overlay causes pointerleave → hover intent deactivates. After
    // removal, Electron doesn't re-hit-test so :hover and pointerenter are
    // unreliable — restore class directly using last tracked cursor position.
    // Skipped when a new viewer pre-empts this one (mouse is on a different card).
    if (restoreHoverIntent && !Platform.isMobile) {
      const cursor = viewerCursorPositions.get(original);
      // The card and the thumbnail below ask the same question of two rects
      const contains = (rect: DOMRect): boolean =>
        !!cursor &&
        cursor.x >= rect.left &&
        cursor.x <= rect.right &&
        cursor.y >= rect.top &&
        cursor.y <= rect.bottom;

      const cardEl = original.closest<HTMLElement>('.card');
      if (cardEl && cursor) {
        if (contains(cardEl.getBoundingClientRect())) {
          // Cursor is over the card — restore without re-triggering transitions
          cardEl.classList.add('interact-restore');
          // interact-hover rides along with interact everywhere the hover
          // lifecycle moves it, so the zoom that keys on it survives a viewer
          // round trip the same way the rest of the hover styling does.
          cardEl.classList.add('interact', 'interact-hover');
          cardEl
            .closest('.masonry-container, .bases-cards-group')
            ?.classList.add('has-hover-card');
          void cardEl.offsetHeight;
          cardEl.classList.remove('interact-restore');
          // Removing the overlay makes Chromium fire a genuine mouseenter on the
          // card under the stationary cursor, which the hover zoom would read as
          // a fresh hover and animate in again. Covers only — nothing else arms
          // that zoom. Consumed by the enter handler in core/slideshow.ts rather
          // than timed out, because the enter waits on the user's next physical
          // mouse move and may arrive long after any timeout would have lapsed.
          if (original.closest('.card-cover')) cardEl.dataset.zoomResume = '1';
        } else {
          // Cursor outside card — remove hover state that was preserved
          // during viewer open (pointerleave was suppressed by viewer-active).
          // interact-hover must go with interact: the pointer has left, and a
          // stranded one would hold the image zoom open for good — pointerleave
          // already fired under the overlay and will not fire again.
          cardEl.classList.remove('interact', 'interact-hover');
          cardEl.classList.remove('poster-hover-active');
          deferContainerHoverDrop(cardEl);
        }
      }

      // Resume scrubbing at last cursor position, or reset if cursor is outside
      // the cover/thumbnail (e.g. dismissed via keyboard or moved away)
      const scrubEl = original.closest<HTMLElement>(
        '.card-thumbnail.multi-image, .card-cover.multi-image'
      );
      if (scrubEl && cursor) {
        // Both dispatches below must stay PointerEvents: the scrub handlers in
        // shared-renderer.ts bind `pointermove`/`pointerleave`, so a mouse
        // equivalent lands on no listener and does nothing — silently, which is
        // exactly how this regressed unnoticed once the handlers were rebound.
        // `pointerType: 'mouse'` is load-bearing too: both handlers gate on
        // `isHoverPointer(e)`, which rejects touch and pressured pen.
        if (contains(scrubEl.getBoundingClientRect())) {
          // Recalculate scrub position for current cursor coordinates
          scrubEl.dispatchEvent(
            new PointerEvent('pointermove', {
              clientX: cursor.x,
              clientY: cursor.y,
              pointerType: 'mouse',
              bubbles: false,
            })
          );
        } else {
          // Cursor outside the cover/thumbnail — trigger reset to first image
          scrubEl.dispatchEvent(
            new PointerEvent('pointerleave', {
              pointerType: 'mouse',
              bubbles: false,
            })
          );
        }
      }
      // Scoped to one viewer session: the open path always writes a fresh
      // position, so a leftover entry would only ever be stale
      viewerCursorPositions.delete(original);
    }
  }

  openViewerClosers.delete(cloneEl);

  const cleanup = viewerCleanupFns.get(cloneEl);
  if (cleanup) {
    cleanup();
    viewerCleanupFns.delete(cloneEl);
  }

  const removeListeners = viewerListenerCleanups.get(cloneEl);
  if (removeListeners) {
    removeListeners();
    viewerListenerCleanups.delete(cloneEl);
  }
}

/**
 * Handles image viewer click events
 * @param e - Mouse event
 * @param cardPath - Path to the card's file
 * @param app - Obsidian app instance
 * @param viewerCleanupFns - Map storing cleanup functions
 * @param viewerClones - Map storing original → clone element mappings
 * @param openOnTitle - Whether the title, rather than the card, opens the file
 */
export function handleImageViewerTrigger(
  e: MouseEvent,
  cardPath: string,
  app: App,
  viewerCleanupFns: Map<HTMLElement, () => void>,
  viewerClones: Map<HTMLElement, HTMLElement>,
  openOnTitle: boolean
): void {
  // Always stop propagation to prevent third-party plugins (e.g. Image Toolkit)
  e.stopPropagation();

  // Skip viewer when all card images are broken (discovered via preload)
  const cardEl = (e.currentTarget as HTMLElement)?.closest('.card');
  if (cardEl?.classList.contains('no-valid-images')) return;

  const viewerDoc = (e.currentTarget as HTMLElement)?.ownerDocument ?? document;

  const isViewerDisabled = viewerDoc.body.classList.contains(
    'dynamic-views-image-viewer-disabled'
  );
  if (isViewerDisabled) {
    // When viewer disabled, only open-on-card opens the file — with open-on-title
    // an image click has no action
    if (!openOnTitle) {
      const newLeaf = e.metaKey || e.ctrlKey;
      void app.workspace.openLinkText(cardPath, '', newLeaf);
    }
    return;
  }
  const embedEl = e.currentTarget as HTMLElement;

  // Check if this element already has a viewer clone
  const existingClone = viewerClones.get(embedEl);
  if (existingClone) {
    closeImageViewer(existingClone, viewerCleanupFns, viewerClones);
  } else {
    // Store click coordinates for scrub resume on viewer close
    viewerCursorPositions.set(embedEl, { x: e.clientX, y: e.clientY });
    // Suppress hover deactivation while viewer is open — the overlay's
    // pointer-events: auto triggers pointerleave on the card
    cardEl?.classList.add('viewer-active');
    openImageViewer(embedEl, app, viewerCleanupFns, viewerClones);
  }
}

interface ViewerGestureControls {
  cleanup: () => void;
  /** Drop zoom/pan instantly so a newly navigated image starts at 1x. */
  resetZoom: () => void;
  /** Attach gestures that initial load never got (first image was broken). */
  ensureGestures: () => void;
}

/** Constrained viewer: returns true when the key event should be ignored (viewer's leaf is not active). */
function isConstrainedViewerInactive(el: CloneElement, doc: Document): boolean {
  if (!el.classList.contains('dynamic-views-viewer-constrained')) return false;
  const orig = el.__originalEmbed;
  const activeLeaf = doc.activeElement?.closest('.workspace-leaf');
  if (
    doc.activeElement !== el &&
    !orig?.closest('.workspace-leaf.mod-active') &&
    !!activeLeaf &&
    activeLeaf !== orig?.closest('.workspace-leaf')
  ) {
    return true;
  }
  // A hidden viewer never owns keys. Read last, not first: this runs on every
  // keydown while a viewer is open, and `offsetParent` forces style and layout
  // up to date, whereas the focus tests above answer the same question from
  // clean state. The two conditions OR into one result, so the order is free.
  // Safe on this branch only: the clone is `position: absolute` here, so
  // `offsetParent` is its leaf, whereas the fullscreen clone is
  // `position: fixed` and would always report null.
  return el.offsetParent === null;
}

/**
 * Setup zoom and pan gestures for an image in the viewer
 * @param imgEl - The image element
 * @param container - The container element (overlay or embed)
 * @param mode - 'mobile' for touch devices, 'desktop' otherwise. Touch devices run the
 *   mobile backend in both mount modes, so that backend applies the same zoom gate to
 *   `draggable` as the desktop one — tablets get drag-out constrained, at 1x.
 * @param allowDragOut - whether the image may be dragged out into the vault. Constrained only:
 *   fullscreen has nowhere to drop, so it stays inert. Even when allowed it is suppressed while
 *   zoomed, since panning owns the pointer.
 */
function setupImageViewerGestures(
  imgEl: HTMLImageElement,
  container: HTMLElement,
  mode: GestureMode,
  allowDragOut: boolean
): ViewerGestureControls {
  const isMobileMode = mode === 'mobile';
  // Images are draggable by default, so this must be set even when neither
  // backend attaches (a broken first image). Phones never reach here with
  // `allowDragOut` true — they are always fullscreen.
  imgEl.draggable = allowDragOut;
  let errorHandler: (() => void) | null = null;
  let initialLoadHandler: (() => void) | null = null;
  // The desktop backend keeps its transform state in `attachDesktopGestures`'s
  // closure; these bridges expose it to the returned controls, mirroring the
  // `mobileResetTransform` pattern below
  let desktopAttached = false;
  let desktopResetTransform: (() => void) | null = null;
  let desktopCleanup: (() => void) | null = null;
  let mobileTouchHandler: ((e: TouchEvent) => void) | null = null;
  let mobileAnimFrame = 0;
  let mobileLoadHandler: (() => void) | null = null;
  let mobileResetTransform: (() => void) | null = null;
  const gestureDoc = container.ownerDocument;
  const gestureWin = gestureDoc.defaultView ?? window;

  /**
   * Closed-fist cursor while a pointer drag pans the image.
   *
   * Native drives Obsidian's app-wide `is-grabbing` body class from its own pan
   * handler (app.js:95706), and its rule is
   * `body.is-grabbing *:not(.workspace-leaf-resize-handle)` (app.css:3244) — a
   * universal descendant selector, so every toggle invalidates style for the
   * entire document: measured 5.5ms on add and 5.3ms on remove at 60 cards
   * (~7,000 elements), i.e. a dropped frame at each end of every drag. It also
   * wakes the body-class MutationObserver in `style-settings.ts`, which then
   * bails.
   *
   * Only constrained mode needs that reach — a captured pointer can leave the
   * leaf mid-drag, and nothing but the app-wide rule follows it there. A
   * fullscreen clone already covers the viewport, so scoping the same cursor to
   * the clone is visually identical while the selector can only match the
   * clone's handful of descendants.
   *
   * Line numbers read against Obsidian 1.13.6; re-resolve by symbol.
   */
  const usesAppWideGrabCursor = container.classList.contains(
    'dynamic-views-viewer-constrained'
  );
  const setGrabbingCursor = (grabbing: boolean): void => {
    const target = usesAppWideGrabCursor ? gestureDoc.body : container;
    target.classList.toggle('is-grabbing', grabbing);
  };

  /**
   * Desktop gesture backend — wheel zoom/pan plus pointer-drag panning, written
   * against native's transform order: `translate(Ppx) scale(z)`, so the pan is
   * in **screen** pixels. The mobile backend below deliberately keeps the
   * opposite order (`scale(s) translate(x, y)`, pre-scale pan).
   */
  function attachDesktopGestures(): void {
    let scale = 1;
    let panX = 0;
    let panY = 0;
    let rafId = 0;
    let wasPannable = false;
    let activePointerId: number | null = null;
    let lastX = 0;
    let lastY = 0;

    /**
     * Commit the pending transform on the next frame. Native coalesces the same
     * way (`applyZoom`), and a single-slot guard keeps a burst of wheel or
     * pointer events to one write per frame.
     */
    const applyDesktopTransform = () => {
      if (rafId) return;
      rafId = gestureWin.requestAnimationFrame(() => {
        rafId = 0;
        // Clamp against live dimensions, as native's `getMaxPanBounds` does.
        // Caching them would go stale: the container resizes without a `load`
        // event on window resize (fullscreen) and via the `.workspace-leaf`
        // ResizeObserver that rewrites the clone's inline size (constrained).
        // It would also buy nothing — `imgEl.offsetWidth` is read in the same
        // expression, and the clone's `contain: strict` keeps the read cheap.
        const maxPanX = Math.max(
          0,
          (imgEl.offsetWidth * scale - container.offsetWidth) / 2
        );
        const maxPanY = Math.max(
          0,
          (imgEl.offsetHeight * scale - container.offsetHeight) / 2
        );
        panX = Math.max(-maxPanX, Math.min(maxPanX, panX));
        panY = Math.max(-maxPanY, Math.min(maxPanY, panY));
        imgEl.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;

        // Guarded like the mobile backend's `syncPannable` — this runs every
        // gesture frame and the container has `contain: strict`, so a needless
        // class write would invalidate style on each one
        const pannable = scale > 1;
        if (pannable !== wasPannable) {
          wasPannable = pannable;
          container.classList.toggle('is-pannable', pannable);
          // Zoomed, the pointer belongs to panning, so the image must not also
          // start a native drag
          imgEl.draggable = allowDragOut && !pannable;
        }
      });
    };

    desktopResetTransform = () => {
      scale = 1;
      panX = 0;
      panY = 0;
      applyDesktopTransform();
    };

    const pointerController = new AbortController();

    // Native's three-branch wheel model (`handleWheelZoom`, app.js:95656):
    // Ctrl/Cmd zooms about the cursor, a plain wheel pans once zoomed, and a
    // plain wheel at 1x is ignored outright — not even preventDefault, so the
    // page keeps its normal scroll. Native binds this to the whole viewer with
    // no target check, so hovering the backdrop behaves the same as the image.
    // Line numbers read against Obsidian 1.13.6; re-resolve by symbol.
    const wheelHandler = (e: WheelEvent) => {
      // Trackpad pinch synthesises ctrlKey on every platform, so macOS pinch
      // lands here too
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        let delta = e.deltaY;
        if (e.deltaMode === e.DOM_DELTA_LINE) delta *= WHEEL_DELTA_LINE_SCALE;
        else if (e.deltaMode === e.DOM_DELTA_PAGE)
          delta *= WHEEL_DELTA_PAGE_SCALE;

        let step = -delta / WHEEL_ZOOM_DIVISOR;
        // Trackpads emit fractional deltas; native doubles those on macOS only
        if (Platform.isMacOS && !Number.isInteger(e.deltaY)) step *= 2;

        const nextScale = Math.min(VIEWER_MAX_ZOOM, Math.max(1, scale + step));
        if (nextScale === scale) return;

        // Native's focal update, verbatim: the cursor offset from the container
        // centre stays fixed on screen while everything else scales around it
        const rect = container.getBoundingClientRect();
        const focalX = e.clientX - rect.left - rect.width / 2;
        const focalY = e.clientY - rect.top - rect.height / 2;
        const ratio = nextScale / scale;
        panX = (panX - focalX) * ratio + focalX;
        panY = (panY - focalY) * ratio + focalY;
        scale = nextScale;
        // Native drops the pan the moment zoom returns to 1x, so the image is
        // never stranded off-screen at a zoom level that cannot pan it back
        if (scale <= 1) {
          panX = 0;
          panY = 0;
        }
        applyDesktopTransform();
        return;
      }

      if (scale <= 1) return;
      e.preventDefault();
      // Pan is in screen pixels, so native's flat multiplier applies as-is
      panX -= WHEEL_PAN_MULTIPLIER * e.deltaX;
      panY -= WHEEL_PAN_MULTIPLIER * e.deltaY;
      applyDesktopTransform();
    };
    container.addEventListener('wheel', wheelHandler, WHEEL_OPTIONS);

    // Armed the moment anything is registered — a throw further down would
    // otherwise make `cleanup()` skip desktop teardown and leak the wheel
    // listener
    desktopAttached = true;
    desktopCleanup = () => {
      container.removeEventListener('wheel', wheelHandler, WHEEL_OPTIONS);
      pointerController.abort();
      if (rafId) {
        gestureWin.cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };

    // All four listeners live on `imgEl`: `setPointerCapture` retargets the
    // stream to the capture element, so document-level listeners are
    // unnecessary and container-level ones would never fire.
    const onPointerDown = (e: PointerEvent) => {
      // Native's `handleMouseDown` bails on non-primary buttons and at 1x
      if (e.button !== 0 || scale <= 1) return;
      activePointerId = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      imgEl.setPointerCapture(e.pointerId);
      setGrabbingCursor(true);
    };

    // The listeners are permanently attached, so without the id gate merely
    // hovering a zoomed image would pan it
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return;
      panX += e.clientX - lastX;
      panY += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      applyDesktopTransform();
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return;
      if (imgEl.hasPointerCapture(e.pointerId)) {
        imgEl.releasePointerCapture(e.pointerId);
      }
      activePointerId = null;
      setGrabbingCursor(false);
    };

    const pointerOptions = { signal: pointerController.signal };
    imgEl.addEventListener('pointerdown', onPointerDown, pointerOptions);
    imgEl.addEventListener('pointermove', onPointerMove, pointerOptions);
    imgEl.addEventListener('pointerup', onPointerUp, pointerOptions);
    imgEl.addEventListener('pointercancel', onPointerUp, pointerOptions);
  }

  /**
   * Native mobile touch handler — behavior modeled after Obsidian's built-in `mobile-image-viewer`.
   * Direct touch events with focal-point pinch zoom and momentum. Keeps its own
   * `scale(s) translate(x, y)` order, so its pan is pre-scale — the desktop
   * backend above uses native's opposite order.
   */
  function attachMobileGestures(): void {
    let imgWidth = imgEl.width;
    let imgHeight = imgEl.height;
    let maxScale = Math.max(
      1,
      2 *
        Math.max(
          imgEl.naturalWidth / (imgWidth || 1),
          imgEl.naturalHeight / (imgHeight || 1)
        )
    );
    let panX = 0;
    let panY = 0;
    let scale = 1;

    // Mirrors the desktop backend's `.is-pannable` toggle so the zoom-dependent
    // styling (titlebar hide) works on touch too. Guarded — applyTransform runs every
    // gesture frame, and the container has `contain: strict`, so a needless
    // class write would invalidate style on each one.
    let wasPannable = false;
    const syncPannable = () => {
      const pannable = scale > 1;
      if (pannable === wasPannable) return;
      wasPannable = pannable;
      container.classList.toggle('is-pannable', pannable);
      // Zoomed, a one-finger drag is a pan, so the image must not also be
      // draggable — same gate the desktop backend applies in its rAF
      imgEl.draggable = allowDragOut && !pannable;
    };

    /** Apply clamped transform — native formula: maxPan = imgDim * (scale-1)/scale/2 */
    const applyTransform = () => {
      const panFactor = (scale - 1) / scale / 2;
      const maxPanX = Math.max(0, imgWidth * panFactor);
      const maxPanY = Math.max(0, imgHeight * panFactor);
      panX = Math.max(-maxPanX, Math.min(maxPanX, panX));
      panY = Math.max(-maxPanY, Math.min(maxPanY, panY));
      scale = Math.max(1, Math.min(maxScale, scale));
      imgEl.style.transform = `scale(${scale}) translate(${panX}px, ${panY}px)`;
      syncPannable();
    };

    // Momentum state
    let velocity = 0;
    let direction = 0;
    let lastTime = 0;

    const momentumTick = () => {
      gestureWin.cancelAnimationFrame(mobileAnimFrame);
      if (scale <= 1) return; // No momentum at base zoom — pan is clamped to 0
      const now = Date.now();
      const dt = now - lastTime;
      panX += Math.cos(direction) * velocity * dt;
      panY += Math.sin(direction) * velocity * dt;
      applyTransform();
      velocity -= Math.min(0.003 * dt, velocity);
      if (velocity > 0.01) {
        lastTime = now;
        mobileAnimFrame = gestureWin.requestAnimationFrame(momentumTick);
      }
    };

    // Arrow navigation must drop zoom/pan on the mobile backend too — the load
    // handler below refreshes bounds but deliberately preserves scale, so
    // without this a navigated image would inherit the previous zoom
    mobileResetTransform = () => {
      gestureWin.cancelAnimationFrame(mobileAnimFrame);
      velocity = 0;
      scale = 1;
      panX = 0;
      panY = 0;
      applyTransform();
    };

    // Recalculate dimensions on subsequent loads (e.g. src changes)
    mobileLoadHandler = () => {
      imgWidth = imgEl.width;
      imgHeight = imgEl.height;
      maxScale = Math.max(
        1,
        2 *
          Math.max(
            imgEl.naturalWidth / (imgWidth || 1),
            imgEl.naturalHeight / (imgHeight || 1)
          )
      );
      applyTransform();
    };
    imgEl.addEventListener('load', mobileLoadHandler);

    // Touch tracking
    let prevTouch1: Touch | null = null;
    let prevTouch2: Touch | null = null;

    const handleTouch = (e: TouchEvent) => {
      gestureWin.cancelAnimationFrame(mobileAnimFrame);
      const now = Date.now();
      const dt = now - lastTime;
      const touches = Array.from(e.touches);

      // Match existing touches by identifier
      let currTouch1: Touch | null = null;
      let currTouch2: Touch | null = null;
      for (const touch of touches) {
        if (prevTouch1 && touch.identifier === prevTouch1.identifier)
          currTouch1 = touch;
        if (prevTouch2 && touch.identifier === prevTouch2.identifier)
          currTouch2 = touch;
      }

      // If touch2 active but touch1 lifted → promote
      if (currTouch2 && !currTouch1) {
        prevTouch1 = prevTouch2;
        currTouch1 = currTouch2;
        prevTouch2 = null;
        currTouch2 = null;
      }

      // Assign remaining unmatched touches
      if (currTouch1) {
        const idx = touches.indexOf(currTouch1);
        if (idx !== -1) touches.splice(idx, 1);
      } else if (touches.length > 0) {
        currTouch1 = touches[0];
        touches.splice(0, 1);
      }
      if (currTouch2) {
        const idx = touches.indexOf(currTouch2);
        if (idx !== -1) touches.splice(idx, 1);
      } else if (touches.length > 0) {
        currTouch2 = touches[0];
        touches.splice(0, 1);
      }

      if (
        prevTouch1 &&
        currTouch1 &&
        prevTouch1.identifier === currTouch1.identifier
      ) {
        const rect = container.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;

        if (
          prevTouch2 &&
          currTouch2 &&
          prevTouch2.identifier === currTouch2.identifier
        ) {
          // Two-finger: pinch zoom with focal point
          const focalOffsetX =
            -panX +
            ((prevTouch1.clientX + prevTouch2.clientX) / 2 - cx) / scale;
          const focalOffsetY =
            -panY +
            ((prevTouch1.clientY + prevTouch2.clientY) / 2 - cy) / scale;

          const newMidX = (currTouch1.clientX + currTouch2.clientX) / 2;
          const newMidY = (currTouch1.clientY + currTouch2.clientY) / 2;

          const prevDx = prevTouch1.clientX - prevTouch2.clientX;
          const prevDy = prevTouch1.clientY - prevTouch2.clientY;
          const currDx = currTouch1.clientX - currTouch2.clientX;
          const currDy = currTouch1.clientY - currTouch2.clientY;
          const prevDistSq = prevDx * prevDx + prevDy * prevDy;
          const currDistSq = currDx * currDx + currDy * currDy;

          if (prevDistSq !== 0 && currDistSq !== 0) {
            const ratio = Math.sqrt(currDistSq / prevDistSq);
            const newScale = scale * ratio;
            panX = (newMidX - cx) / newScale - focalOffsetX;
            panY = (newMidY - cy) / newScale - focalOffsetY;
            scale = newScale;
            applyTransform();
          }
        } else {
          // One-finger: pan with momentum tracking
          const deltaX = (currTouch1.clientX - prevTouch1.clientX) / scale;
          const deltaY = (currTouch1.clientY - prevTouch1.clientY) / scale;
          panX += deltaX;
          panY += deltaY;
          // Guard dt === 0 (two events in same ms) to prevent Infinity velocity
          velocity =
            dt > 0 ? Math.sqrt(deltaX * deltaX + deltaY * deltaY) / dt : 0;
          direction = Math.atan2(deltaY, deltaX);
          applyTransform();
        }
      }

      prevTouch2 = currTouch2;
      prevTouch1 = currTouch1;

      // Start momentum when all fingers lifted
      if (!prevTouch1 && !prevTouch2) {
        mobileAnimFrame = gestureWin.requestAnimationFrame(momentumTick);
      }
      lastTime = now;
    };

    // Store ref at outer scope for cleanup access
    mobileTouchHandler = handleTouch;

    container.addEventListener('touchstart', handleTouch, { passive: true });
    container.addEventListener('touchend', handleTouch, { passive: true });
    container.addEventListener('touchmove', handleTouch, { passive: true });
    container.addEventListener('touchcancel', handleTouch, { passive: true });
  }

  // Check if image already loaded
  if (imgEl.complete && imgEl.naturalWidth > 0) {
    if (isMobileMode) attachMobileGestures();
    else attachDesktopGestures();
  } else {
    // Both handlers are hoisted so `cleanup()` can remove them: a detached
    // `<img>` still fires `load`, so a viewer closed before its image arrived
    // would otherwise attach gestures to a dead clone after teardown ran — a
    // pending rAF and the app-wide `is-grabbing` class included, neither of
    // which any later cleanup can reach
    initialLoadHandler = () => {
      initialLoadHandler = null;
      if (errorHandler) {
        imgEl.removeEventListener('error', errorHandler);
        errorHandler = null;
      }
      if (isMobileMode) attachMobileGestures();
      else attachDesktopGestures();
    };
    imgEl.addEventListener('load', initialLoadHandler, { once: true });

    errorHandler = () => {
      errorHandler = null;
      console.warn('Image failed to load, viewer gestures not attached');
      if (initialLoadHandler) {
        imgEl.removeEventListener('load', initialLoadHandler);
        initialLoadHandler = null;
      }
    };
    imgEl.addEventListener('error', errorHandler, { once: true });
  }

  return {
    cleanup: () => {
      if (desktopAttached) {
        desktopCleanup?.();
      }
      if (errorHandler) {
        imgEl.removeEventListener('error', errorHandler);
      }
      // Never leave the grabbing cursor behind if the viewer is torn down
      // mid-drag — pointerup would not fire. A viewer only ever writes its own
      // branch, so clearing that one is complete; it matters only for the
      // constrained branch, whose class outlives the clone.
      setGrabbingCursor(false);
      if (mobileTouchHandler) {
        container.removeEventListener(
          'touchstart',
          mobileTouchHandler as EventListener
        );
        container.removeEventListener(
          'touchend',
          mobileTouchHandler as EventListener
        );
        container.removeEventListener(
          'touchmove',
          mobileTouchHandler as EventListener
        );
        container.removeEventListener(
          'touchcancel',
          mobileTouchHandler as EventListener
        );
        gestureWin.cancelAnimationFrame(mobileAnimFrame);
      }
      if (mobileLoadHandler) {
        imgEl.removeEventListener('load', mobileLoadHandler);
      }
      if (initialLoadHandler) {
        imgEl.removeEventListener('load', initialLoadHandler);
        initialLoadHandler = null;
      }
    },
    resetZoom: () => {
      desktopResetTransform?.();
      // Tablets with a keyboard can arrow-navigate while on the mobile backend
      mobileResetTransform?.();
    },
    ensureGestures: () => {
      if (desktopAttached || mobileTouchHandler) return;
      if (!(imgEl.complete && imgEl.naturalWidth > 0)) return;
      if (isMobileMode) attachMobileGestures();
      else attachDesktopGestures();
    },
  };
}

/**
 * Opens image viewer with gesture support and close handlers
 */
function openImageViewer(
  embedEl: HTMLElement,
  app: App,
  viewerCleanupFns: Map<HTMLElement, () => void>,
  viewerClones: Map<HTMLElement, HTMLElement>
): void {
  // Validate embed has an image before proceeding
  const sourceImg = embedEl.querySelector('img');
  if (!sourceImg) {
    console.warn('Cannot open viewer - no img element found');
    abandonViewerOpen(embedEl);
    return;
  }

  const viewerDoc = embedEl.ownerDocument;
  const viewerWin = viewerDoc.defaultView ?? window;

  // Close other open viewers (clone array to avoid mutation during iteration)
  // Don't restore hover intent — mouse is on the new card, not the old one
  for (const clone of Array.from(viewerClones.values())) {
    closeImageViewer(clone, viewerCleanupFns, viewerClones, false);
  }

  // Clone the embed element for viewing (original stays on card)
  const cloneEl = embedEl.cloneNode(true) as CloneElement;
  cloneEl.classList.add('is-zoomed');
  embedEl.ownerDocument.body.classList.add('dynamic-views-image-zoomed');

  // Store reference to original for O(1) cleanup lookup
  cloneEl.__originalEmbed = embedEl;

  // For slideshows, get the current visible image; for regular embeds, get the only img
  const imgEl =
    cloneEl.querySelector<HTMLImageElement>('img.slideshow-img-current') ||
    cloneEl.querySelector<HTMLImageElement>('img');
  if (!imgEl) {
    console.warn('Cannot open viewer - cloned img element missing');
    abandonViewerOpen(embedEl);
    return;
  }

  // Remove non-current slideshow image from clone (prevents duplicate display)
  const nextImg = cloneEl.querySelector<HTMLImageElement>(
    'img.slideshow-img-next'
  );
  if (nextImg) {
    nextImg.remove();
  }

  // Locate the opened image within the card's navigable set. Cards render raw
  // src values, but a slideshow/scrub step may already have swapped in a blob:
  // URL, and imgEl.src returns the percent-encoded form — match all four.
  // Snapshot here rather than at registration: the renderer splices broken URLs
  // out of its array as validation discovers them, so taking the copy at open
  // both freezes indices for this viewer's lifetime and reflects every removal
  // made up to this point.
  const imageSet = viewerImageSets.get(embedEl)?.slice();
  const rawSrc = imgEl.getAttribute('src') ?? '';
  const foundIndex = imageSet
    ? imageSet.findIndex(
        (u) =>
          u === imgEl.src ||
          u === rawSrc ||
          getCachedBlobUrl(u) === imgEl.src ||
          getCachedBlobUrl(u) === rawSrc
      )
    : -1;
  let currentIndex = foundIndex < 0 ? 0 : foundIndex;

  // The original URL, kept across the blob swap below and across navigation.
  // Drag-out and the titlebar need the durable address, and `imgEl.src` is not
  // it: the card's own image is already a blob whenever a slideshow or scrub
  // step ran before the viewer opened, which is why the match above tests the
  // blob forms at all. The matched entry is that image's raw URL by
  // construction; the fallback only serves cards with no navigable set, whose
  // src is never swapped.
  let currentRawUrl =
    foundIndex >= 0 && imageSet ? imageSet[foundIndex] : imgEl.src;

  // Resolve the titlebar name from the durable URL — blob: URLs have no basename
  const displayName =
    imgEl.title || imgEl.alt || getImageDisplayName(currentRawUrl);

  // Use cached blob URL for external images to avoid re-fetching
  if (isExternalUrl(imgEl.src)) {
    imgEl.src = getCachedBlobUrl(imgEl.src);
  }

  /**
   * Swap a card's YouTube thumbnail for its full-resolution rung.
   *
   * Cards deliberately fetch the smallest rung that covers their own display
   * size, so opening one would otherwise fill the screen with a 480px image.
   * The viewer has no video ID to work from — the card only ever holds the
   * thumbnail URL — hence the reverse parse. Omitting a target width asks for
   * the maxres-first ladder.
   *
   * Necessarily late: the open path is synchronous and the probe is a network
   * round trip, so by the time it answers the viewer may have been closed, torn
   * down in bulk, or navigated away from this image. Each of those is a
   * separate guard, and none of them subsumes the others.
   */
  const upgradeYouTubeResolution = (rawUrl: string): void => {
    const videoId = getVideoIdFromThumbnailUrl(rawUrl);
    if (!videoId) return;
    const indexAtStart = currentIndex;
    void getYouTubeThumbnailUrl(videoId).then((fullUrl) => {
      if (!fullUrl || fullUrl === rawUrl) return;
      if (!imgEl.isConnected) return; // Closed, or removed by cleanupAllViewers
      if (currentIndex !== indexAtStart) return; // Arrow-navigated away
      if (currentRawUrl !== rawUrl) return; // Superseded by a later swap
      imgEl.src = getCachedBlobUrl(fullUrl);
      // Drag-out should hand over the image actually on screen. The titlebar
      // deliberately keeps the name it opened with: it is a label, not an
      // address, and rewriting it mid-view to a different rung is visible noise.
      currentRawUrl = fullUrl;
    });
  };

  upgradeYouTubeResolution(currentRawUrl);

  // Overlay chrome — mirrors the native lightbox titlebar and close button
  const titlebarEl = cloneEl.createDiv('dynamic-views-viewer-titlebar');
  const titlebarTextEl = titlebarEl.createDiv({
    cls: 'dynamic-views-viewer-titlebar-text',
    text: displayName,
  });
  // No aria-label — Obsidian derives tooltips from it, and the native close button has none
  const closeEl = cloneEl.createDiv('dynamic-views-viewer-close');
  setIcon(closeEl, 'x');

  // Append clone to appropriate container based on fullscreen setting
  // Phone: always fullscreen. Desktop/tablet: fullscreen unless explicitly disabled
  const isPhone = Platform.isPhone;
  const isMobile = Platform.isMobile; // true for phone + tablet (touch devices)
  const isFullscreen =
    isPhone ||
    !viewerDoc.body.classList.contains(
      'dynamic-views-image-viewer-constrain-to-pane'
    );

  // Wrap ALL setup in try-catch to prevent orphaned clone on error
  let resizeObserver: ResizeObserver | null = null;

  try {
    if (!isFullscreen) {
      const workspaceLeaf = embedEl.closest<HTMLElement>('.workspace-leaf');
      if (workspaceLeaf) {
        // Mounted inside the leaf rather than on `body`, so the overlay takes
        // part in Obsidian's tab-drop preview. A leaf drag has two halves, both
        // inside `Workspace.onDragLeaf`: the drop target's container is set to
        // `opacity: 0` in the real DOM (app.js:166503) and a `cloneNode(true)`
        // of it is rendered at the squeezed rect inside
        // `.workspace-fake-target-overlay` (app.js:166502, 166525-166529). A
        // `body`-level overlay belongs to neither half, so it neither dims with
        // the real pane nor squeezes with the preview; a descendant of the leaf
        // gets both for free.
        //
        // It also removes the #230 divider collision outright. The `.workspace-leaf`
        // rule makes it `position: relative` with `contain: strict` and
        // `overflow: hidden` (app.css:6394-6401), so an absolutely positioned
        // child matches the leaf box exactly and is paint-clipped to it. The
        // split resize handles live outside the leaf, so no arrangement can put
        // the overlay on top of one — previously they had to be measured and
        // dodged every frame.
        //
        // Line numbers read against Obsidian 1.13.6; re-resolve by symbol.
        const updateHeaderInset = () => {
          // The leaf's box starts at the tab title bar, so covering it outright
          // would scrim the file name and the tab actions along with the
          // content. Scoped to the leaf's own header — a bare `.view-header`
          // lookup would match one belonging to an embedded or hover-preview
          // leaf nested inside this one.
          const viewHeader = workspaceLeaf.querySelector<HTMLElement>(
            ':scope > .workspace-leaf-content > .view-header'
          );
          // Not a constant: the header collapses to `display: none` in the
          // sidebars, via the `.workspace-split.mod-left-split .view-header`
          // rule group (app.css:4320-4323 — line numbers read against Obsidian
          // 1.13.6; re-resolve by symbol), where the inset must be zero.
          // Guarded because this runs per ResizeObserver frame while the user
          // drags a split divider, and the height does not change during a drag
          const nextTop = `${viewHeader?.getBoundingClientRect().height ?? 0}px`;
          if (cloneEl.style.top !== nextTop) cloneEl.style.top = nextTop;
        };

        cloneEl.addClass('dynamic-views-viewer-constrained');
        updateHeaderInset();
        workspaceLeaf.appendChild(cloneEl);

        // The leaf resizing is the only thing that can change the header's
        // height without reopening the viewer
        resizeObserver = new viewerWin.ResizeObserver(updateHeaderInset);
        resizeObserver.observe(workspaceLeaf);
      } else {
        viewerDoc.body.appendChild(cloneEl);
      }
    } else {
      viewerDoc.body.appendChild(cloneEl);
    }

    // No modal handling: native's lightbox has no coupling to modals at all
    // (nothing in the renderer links the two), and none is needed. Obsidian's
    // `.modal-container` carries `z-index: var(--layer-modal)` — the same
    // variable the viewer reads — and is appended to `body` after it, so a modal opened over an
    // open viewer already paints on top by DOM order. The previous
    // MutationObserver closed fullscreen viewers outright and left constrained
    // ones permanently behind a `.dynamic-views-viewer-behind-modal` class it
    // never removed, since it only watched `addedNodes`.

    const gestureMode: GestureMode = isMobile ? 'mobile' : 'desktop';
    const gestureControls: ViewerGestureControls = setupImageViewerGestures(
      imgEl,
      cloneEl,
      gestureMode,
      !isFullscreen
    );

    // On mobile, block single-finger touch propagation on non-IMG elements so the
    // mobile gesture handler gets exclusive control (prevents sidebar swipe + pull-down)
    if (isMobile) {
      cloneEl.dataset.ignoreSwipe = 'true';
      const swipeController = new AbortController();
      setupTouchInterceptAll(cloneEl, swipeController.signal);
      viewerCleanupFns.set(cloneEl, () => {
        gestureControls.cleanup();
        swipeController.abort();
      });
    } else {
      viewerCleanupFns.set(cloneEl, gestureControls.cleanup);
    }

    // Prevent context menu on image
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    imgEl.addEventListener('contextmenu', onContextMenu);

    // Pressing the image never dismisses — only the backdrop does, matching the
    // native lightbox, whose media-container click handler skips image targets.
    const existingCleanup = viewerCleanupFns.get(cloneEl);
    viewerCleanupFns.set(cloneEl, () => {
      existingCleanup?.();
      imgEl.removeEventListener('contextmenu', onContextMenu);
    });

    // Track multi-touch gesture state to prevent pinch from triggering close
    let gestureInProgress = false;
    let gestureTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const clearGestureTimeout = () => {
      if (gestureTimeoutId !== null) {
        clearTimeout(gestureTimeoutId);
        gestureTimeoutId = null;
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 1) {
        gestureInProgress = true;
        // Clear any pending reset since gesture is active
        clearGestureTimeout();
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      // Only clear gesture flag when all fingers lifted
      if (e.touches.length === 0 && gestureInProgress) {
        // Clear any existing timeout to prevent double-fire
        clearGestureTimeout();
        // Short delay to ensure click event doesn't fire during gesture completion
        gestureTimeoutId = setTimeout(() => {
          gestureInProgress = false;
          gestureTimeoutId = null;
        }, GESTURE_TIMEOUT_MS);
      }
    };

    if (isMobile) {
      cloneEl.addEventListener('touchstart', onTouchStart, { passive: true });
      cloneEl.addEventListener('touchend', onTouchEnd, { passive: true });
    }

    // Flag to prevent opening click from immediately closing viewer
    let isOpening = true;
    setTimeout(() => {
      isOpening = false;
    }, 0);

    // Click on overlay (cloneEl background, not image) closes viewer
    const onOverlayClick = (e: MouseEvent) => {
      if (isOpening) return;
      // On mobile, ignore clicks during or immediately after gesture
      if (isMobile && gestureInProgress) return;
      if (e.target === cloneEl) {
        closeImageViewer(cloneEl, viewerCleanupFns, viewerClones);
      }
    };

    // Arrow keys step through the card's navigable image set. The viewer index
    // is independent — the card underneath never advances. Desktop always, plus
    // tablets with a hardware keyboard; phones are excluded even when one is
    // attached.
    const canArrowNavigate =
      !isMobile || (Platform.isTablet && hasPhysicalKeyboard());
    let stepImage: ((direction: 1 | -1) => void) | null = null;
    let pendingNavError: (() => void) | null = null;

    if (canArrowNavigate && imageSet && imageSet.length > 1) {
      const urls = imageSet;

      const clearPendingNavError = (): void => {
        if (pendingNavError) {
          imgEl.removeEventListener('error', pendingNavError);
          pendingNavError = null;
        }
      };

      const showIndex = (
        index: number,
        direction: 1 | -1,
        attempts = 0
      ): void => {
        // Supersede the previous step — reassigning src fires no error for the
        // aborted request, so a stale listener would survive and mark a
        // perfectly good URL broken when a later step genuinely fails
        clearPendingNavError();
        currentIndex = index;
        const url = urls[index];

        const onNavError = (): void => {
          pendingNavError = null;
          if (!imgEl.isConnected) return; // Viewer closed mid-flight
          markImageBroken(url);
          if (attempts >= urls.length) return;
          const retry = getNextImageIndex(index, direction, urls, (u) =>
            brokenImageUrls.has(u)
          );
          if (retry !== -1) showIndex(retry, direction, attempts + 1);
        };
        const onNavLoad = (): void => {
          clearPendingNavError();
          gestureControls.ensureGestures();
        };

        pendingNavError = onNavError;
        imgEl.addEventListener('error', onNavError, { once: true });
        imgEl.addEventListener('load', onNavLoad, { once: true });
        gestureControls.resetZoom();
        currentRawUrl = url;
        imgEl.src = getCachedBlobUrl(url);
        // title/alt belong to the initially embedded image — never reapply them
        titlebarTextEl.setText(getImageDisplayName(url));
        // Every index change, not just the open: this re-reads the card's raw
        // URLs, so upgrading only on open would let a single step away and back
        // drop the image to the card's rung permanently
        upgradeYouTubeResolution(url);
      };

      stepImage = (direction: 1 | -1) => {
        const next = getNextImageIndex(currentIndex, direction, urls, (url) =>
          brokenImageUrls.has(url)
        );
        if (next === -1) return;
        showIndex(next, direction);
      };
    }

    // Keyboard runs through Obsidian's keymap stack rather than a document
    // listener, because a document listener cannot win against a modal.
    // Obsidian's own keydown listener is capture-phase on `window`, registered
    // in the `Keymap` constructor (app.js:59501-59504), and the capture path
    // reaches Window before Document whatever the registration order, so every
    // document listener is downstream by construction. `Modal.onEscapeKey`
    // preventDefaults and closes synchronously (app.js:63741), and
    // `Modal.close` detaches `.modal-container` in the same tick on desktop
    // (app.js:63699), so by the time a document handler runs there is no modal
    // left to detect. Checking keymap state instead is worse: `Modal.close`
    // pops its scope first, at app.js:63689, before that detach.
    //
    // A Scope removes the question. `Modal.open` pushes a parentless scope
    // (app.js:63628, :63493) and `Scope.handleKey` only walks `parent`
    // (app.js:59475), so while a modal is up the viewer's scope is never
    // consulted at all — the first Escape closes the modal, the second reaches
    // the viewer. Registered as a catch-all, the shape Obsidian's own
    // `HotkeyManager` constructor uses (app.js:65672): in `Scope.handleKey` an
    // entry bound to a specific key swallows that key even when the callback
    // declines (app.js:59471-59472), which would eat Escape for other panes
    // when the leaf guard bails. Returning `false` makes `Keymap.onKeyEvent`
    // preventDefault + stopPropagation at the window listener
    // (app.js:59570-59571), which also keeps the event off the card's own
    // handler — the job the mobile block list was hand-rolling.
    //
    // Line numbers read against Obsidian 1.13.6; re-resolve by symbol.
    const viewerScope = new Scope(app.scope);

    viewerScope.register(null, null, (e: KeyboardEvent): false | undefined => {
      if (isConstrainedViewerInactive(cloneEl, viewerDoc)) return undefined;

      // Tested before the mobile block list, which would otherwise shadow arrow
      // navigation on keyboard-equipped tablets
      if (stepImage && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        stepImage(e.key === 'ArrowRight' ? 1 : -1);
        return false;
      }

      if (isMobile) {
        return e.code === 'Space' ||
          e.key === 'Enter' ||
          e.key === 'Escape' ||
          e.key === 'r' ||
          e.key === 'R' ||
          e.key === 'ArrowDown'
          ? false
          : undefined;
      }

      // Space would otherwise scroll the pane or re-activate the card underneath
      if (e.key === 'Escape' || e.code === 'Space') {
        closeImageViewer(cloneEl, viewerCleanupFns, viewerClones);
        return false;
      }
      return undefined;
    });

    cloneEl.addEventListener('click', onOverlayClick);

    // stopPropagation keeps the click off the overlay-dismiss path
    const onCloseClick = (e: MouseEvent) => {
      e.stopPropagation();
      closeImageViewer(cloneEl, viewerCleanupFns, viewerClones);
    };
    closeEl.addEventListener('click', onCloseClick);

    // Dragging the image out into the vault. Constrained only: a fullscreen
    // viewer covers everything droppable, so there is nowhere for a drag to
    // land. Within constrained mode it is further gated on being at 1x —
    // `imgEl.draggable` is toggled by the gesture backend as zoom changes, so
    // panning keeps the pointer once zoomed. The listener re-checks rather than
    // trusting `draggable` alone, since the attribute is only refreshed when
    // the pannable state flips.
    let onDragStart: ((e: DragEvent) => void) | null = null;

    if (!isFullscreen) {
      onDragStart = (e: DragEvent) => {
        if (cloneEl.classList.contains('is-pannable')) {
          e.preventDefault();
          return;
        }

        const src = currentRawUrl;
        const vaultPath = getVaultPathFromResourceUrl(src);

        if (vaultPath) {
          const file = app.vault.getAbstractFileByPath(vaultPath);
          if (file instanceof TFile) {
            const dragData = app.dragManager.dragFile(e, file);
            app.dragManager.onDragStart(e, dragData);
          }
        } else if (isExternalUrl(src)) {
          e.dataTransfer?.clearData();
          e.dataTransfer?.setData('text/plain', `![](${src})`);
        }
      };

      imgEl.addEventListener('dragstart', onDragStart);
    }

    // Cleanup removes all listeners (removeEventListener is no-op if never added)
    viewerListenerCleanups.set(cloneEl, () => {
      // `Keymap.popScope` is inert once the scope's window reference is cleared
      // (app.js:59545-59548 — line numbers read against Obsidian 1.13.6;
      // re-resolve by symbol), so the closeImageViewer + cleanupAllViewers
      // double path is safe
      app.keymap.popScope(viewerScope);
      if (pendingNavError) imgEl.removeEventListener('error', pendingNavError);
      cloneEl.removeEventListener('click', onOverlayClick);
      closeEl.removeEventListener('click', onCloseClick);
      if (isMobile) {
        cloneEl.removeEventListener('touchstart', onTouchStart);
        cloneEl.removeEventListener('touchend', onTouchEnd);
      }
      if (onDragStart) {
        imgEl.removeEventListener('dragstart', onDragStart);
      }
      // Clear pending gesture timeout to prevent dangling callbacks
      if (gestureTimeoutId !== null) {
        clearTimeout(gestureTimeoutId);
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    });

    // Focus viewer clone to prevent :focus-visible on cards during keyboard input.
    // Card loses focus → no focus ring while viewer is open or after it closes.
    // Capture-phase pointerdown re-focuses after tab switches. Nothing swallows
    // the event now that the pan handler no longer calls preventDefault, and no
    // document-level listener acts on a body-level clone — text-selection.ts
    // bails when the target has no ancestor card.
    if (!isMobile) {
      cloneEl.addEventListener(
        'pointerdown',
        () => cloneEl.focus({ preventScroll: true }),
        true
      );
      cloneEl.setAttribute('tabindex', '-1');
      cloneEl.focus({ preventScroll: true });
    }

    // Pushed after the focus above so the card's own blur-driven `popScope`
    // (shared-renderer.ts) has already unwound its scope first
    app.keymap.pushScope(viewerScope);

    // Track cursor position over overlay so closeImageViewer has fresh
    // coordinates for the synthetic pointermove that resumes scrubbing on a
    // multi-image cover or thumbnail
    cloneEl.addEventListener('mousemove', (e: MouseEvent) => {
      viewerCursorPositions.set(embedEl, { x: e.clientX, y: e.clientY });
    });

    // Register in tracking maps AFTER all setup succeeds (prevents partial state)
    viewerClones.set(embedEl, cloneEl);
    openViewerClosers.set(cloneEl, () =>
      closeImageViewer(cloneEl, viewerCleanupFns, viewerClones)
    );
  } catch (error) {
    // Comprehensive cleanup in reverse order of allocation
    console.error('Failed to setup image viewer', error);

    // 1. Call and remove gesture cleanup (may have been partially set up)
    const gestureCleanup = viewerCleanupFns.get(cloneEl);
    if (gestureCleanup) {
      gestureCleanup();
    }
    viewerCleanupFns.delete(cloneEl);
    openViewerClosers.delete(cloneEl);

    // 2. Call and remove listener cleanup (may have been partially set up)
    const listenerCleanup = viewerListenerCleanups.get(cloneEl);
    if (listenerCleanup) {
      listenerCleanup();
    }
    viewerListenerCleanups.delete(cloneEl);

    // 3. Disconnect observers (may be null if error was early)
    resizeObserver?.disconnect();

    // 4. Remove DOM element last
    cloneEl.remove();

    // 5. Roll back the two mutations made before the try block
    abandonViewerOpen(embedEl);
  }
}

/**
 * Block single-finger touch propagation on non-IMG elements in the image viewer.
 * Prevents sidebar swipe and pull-down gestures from interfering with pan/pinch.
 */
function setupTouchInterceptAll(
  container: HTMLElement,
  signal: AbortSignal
): void {
  container.addEventListener(
    'touchmove',
    (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const target = e.target as HTMLElement;
      if (target.tagName !== 'IMG') {
        e.stopPropagation();
      }
    },
    // Passive on purpose: the handler only ever calls `stopPropagation`, which
    // needs no opt-out, and a non-passive `touchmove` makes WebKit wait for the
    // main thread on every move — it also silently negated the mobile backend's
    // own `{ passive: true }` registrations on this same element. `passive: true`
    // must be stated: the default-passive intervention covers only
    // window/document/body, not a regular element.
    { passive: true, signal }
  );
}
