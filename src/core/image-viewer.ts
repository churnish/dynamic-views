/**
 * Shared image viewer handler - eliminates code duplication across card renderers
 */

import { Notice, Platform, TFile, setIcon, type App } from 'obsidian';

import { GESTURE_TIMEOUT_MS } from './constants';
import { getZoomSensitivityDesktop } from '../utils/style-settings';
import {
  getImageDisplayName,
  getVaultPathFromResourceUrl,
  isExternalUrl,
} from './image';
import { brokenImageUrls, markImageBroken } from './image-loader';
import { getCachedBlobUrl } from './slideshow';
import { deferContainerHoverDrop } from './hover-and-touch';
import { getNextImageIndex } from './viewer-navigation';
import { getOwnerWindow } from '../utils/owner-window';

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
/** Zoom sensitivity that reproduces native exactly; other values scale from it */
const NATIVE_ZOOM_SENSITIVITY = 0.08;

type GestureMode = 'mobile' | 'desktop';

/**
 * `Platform.hasPhysicalKeyboard` is undocumented and absent from the typings,
 * which declare `Platform` as a const object literal — not an interface, so it
 * cannot be reached by module augmentation. Resolved asynchronously from
 * Capacitor at startup and **false on desktop**: it is a mobile-only signal, so
 * it may only widen a mobile case, never gate a desktop one. `emulateMobile()`
 * forces it false, so it cannot be exercised through desktop mobile emulation.
 */
function hasPhysicalKeyboard(): boolean {
  return (
    (Platform as unknown as { hasPhysicalKeyboard?: boolean })
      .hasPhysicalKeyboard === true
  );
}

// Store cleanup functions for event listeners (Map for explicit lifecycle control)
const viewerListenerCleanups = new Map<HTMLElement, () => void>();

// Map for wheel handlers (keyed by container element, uses explicit lifecycle control)
const containerWheelHandlers = new Map<HTMLElement, (e: WheelEvent) => void>();

/** The set of images the viewer can arrow through for one card embed. */
export interface ViewerImageSet {
  urls: string[];
  format: 'slideshow' | 'thumbnail';
}

// DOM-keyed, so entries are collected when cards unmount — no explicit cleanup
const viewerImageSets = new WeakMap<HTMLElement, ViewerImageSet>();

/**
 * Registers the navigable image set for a card embed.
 * Stores a snapshot: the renderer's arrays are spliced in place by broken-URL
 * recovery, which would otherwise shift indices while the viewer is open.
 */
export function setViewerImageSet(
  embedEl: HTMLElement,
  set: ViewerImageSet
): void {
  viewerImageSets.set(embedEl, { urls: [...set.urls], format: set.format });
}

/**
 * Force cleanup all viewers - call on view destruction
 * Removes clones from DOM, runs cleanup functions, clears all maps
 */
export function cleanupAllViewers(
  viewerCleanupFns: Map<HTMLElement, () => void>,
  viewerClones: Map<HTMLElement, HTMLElement>
): void {
  // Remove clones from DOM and run gesture cleanup
  viewerClones.forEach((clone) => {
    clone.remove();
  });
  viewerClones.clear();

  viewerCleanupFns.forEach((cleanup) => {
    cleanup();
  });
  viewerCleanupFns.clear();

  // Also cleanup listeners (keyboard, click, touch, ResizeObserver)
  viewerListenerCleanups.forEach((cleanup) => {
    cleanup();
  });
  viewerListenerCleanups.clear();
}

/** Extended clone element type with original embed reference */
type CloneElement = HTMLElement & { __originalEmbed?: HTMLElement };

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
    setTimeout(() => delete sourceCard.dataset.viewerDismissing, 300);
    sourceCard.classList.remove('viewer-active');
  }

  cloneEl.remove();

  // Remove body zoom class when no viewers remain
  const doc = cloneEl.ownerDocument;
  if (doc && !doc.querySelector('.dynamic-views-image-embed.is-zoomed')) {
    doc.body.classList.remove('dynamic-views-image-zoomed');
  }

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
      const cardEl = original.closest<HTMLElement>('.card');
      if (cardEl && original.dataset.viewerX) {
        const cx = Number(original.dataset.viewerX);
        const cy = Number(original.dataset.viewerY);
        const cardRect = cardEl.getBoundingClientRect();
        if (
          cx >= cardRect.left &&
          cx <= cardRect.right &&
          cy >= cardRect.top &&
          cy <= cardRect.bottom
        ) {
          // Cursor is over the card — restore without re-triggering transitions
          cardEl.classList.add('interact-restore');
          cardEl.classList.add('interact');
          cardEl
            .closest('.masonry-container, .bases-cards-group')
            ?.classList.add('has-hover-card');
          void cardEl.offsetHeight;
          cardEl.classList.remove('interact-restore');
        } else {
          // Cursor outside card — remove hover state that was preserved
          // during viewer open (pointerleave was suppressed by viewer-active)
          cardEl.classList.remove('interact');
          cardEl.classList.remove('poster-hover-active');
          deferContainerHoverDrop(cardEl);
        }
      }

      // Resume thumbnail scrubbing at last cursor position, or reset if cursor
      // is outside the thumbnail (e.g. dismissed via keyboard or moved away)
      const thumbnailEl = original.closest<HTMLElement>(
        '.card-thumbnail.multi-image'
      );
      if (thumbnailEl && original.dataset.viewerX) {
        const x = Number(original.dataset.viewerX);
        const y = Number(original.dataset.viewerY);
        const rect = thumbnailEl.getBoundingClientRect();
        if (
          x >= rect.left &&
          x <= rect.right &&
          y >= rect.top &&
          y <= rect.bottom
        ) {
          // Recalculate scrub position for current cursor coordinates
          thumbnailEl.dispatchEvent(
            new MouseEvent('mousemove', {
              clientX: x,
              clientY: y,
              bubbles: false,
            })
          );
          // Preact re-renders overwrite img.src via microtask reconciliation.
          // Re-apply the scrubbed src (updated by the handler above) after
          // Preact finishes.
          if (thumbnailEl.dataset.scrubbedSrc) {
            getOwnerWindow(thumbnailEl).requestAnimationFrame(() => {
              const img =
                thumbnailEl.querySelector<HTMLImageElement>(
                  '.slideshow-img-current'
                ) ?? thumbnailEl.querySelector<HTMLImageElement>('img');
              if (img?.isConnected && thumbnailEl.dataset.scrubbedSrc) {
                img.src = thumbnailEl.dataset.scrubbedSrc;
              }
            });
          }
        } else {
          // Cursor outside thumbnail — trigger reset to first image
          thumbnailEl.dispatchEvent(
            new MouseEvent('mouseleave', { bubbles: false })
          );
        }
      }
      delete original.dataset.viewerX;
      delete original.dataset.viewerY;
    }
  }

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
 * @param openFileAction - How card clicks should open files ("card" or "title")
 */
export function handleImageViewerTrigger(
  e: MouseEvent,
  cardPath: string,
  app: App,
  viewerCleanupFns: Map<HTMLElement, () => void>,
  viewerClones: Map<HTMLElement, HTMLElement>,
  openFileAction: 'card' | 'title'
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
    // When viewer disabled, only open file if openFileAction is "card"
    if (openFileAction === 'card') {
      const newLeaf = e.metaKey || e.ctrlKey;
      void app.workspace.openLinkText(cardPath, '', newLeaf);
    }
    // If openFileAction is "title", do nothing (image click has no action)
    return;
  }
  const embedEl = e.currentTarget as HTMLElement;

  // Check if this element already has a viewer clone
  const existingClone = viewerClones.get(embedEl);
  if (existingClone) {
    closeImageViewer(existingClone, viewerCleanupFns, viewerClones);
  } else {
    // Store click coordinates for scrub resume on viewer close
    embedEl.dataset.viewerX = String(e.clientX);
    embedEl.dataset.viewerY = String(e.clientY);
    // Suppress hover deactivation while viewer is open — the overlay's
    // pointer-events: auto triggers pointerleave on the card
    cardEl?.classList.add('viewer-active');
    openImageViewer(embedEl, app, viewerCleanupFns, viewerClones);
  }
}

interface ViewerGestureControls {
  cleanup: () => void;
  /** Suspend pointer-drag panning so native drag can proceed. */
  setAltDragMode: (enabled: boolean) => void;
  /** Drop zoom/pan instantly so a newly navigated image starts at 1x. */
  resetZoom: () => void;
  /** Attach gestures that initial load never got (first image was broken). */
  ensureGestures: () => void;
}

/** Constrained viewer: returns true when the key event should be ignored (viewer's leaf is not active). */
function isConstrainedViewerInactive(el: CloneElement, doc: Document): boolean {
  if (!el.classList.contains('dynamic-views-viewer-fixed')) return false;
  const orig = el.__originalEmbed;
  const activeLeaf = doc.activeElement?.closest('.workspace-leaf');
  return (
    doc.activeElement !== el &&
    !orig?.closest('.workspace-leaf.mod-active') &&
    !!activeLeaf &&
    activeLeaf !== orig?.closest('.workspace-leaf')
  );
}

/**
 * Setup zoom and pan gestures for an image in the viewer
 * @param imgEl - The image element
 * @param container - The container element (overlay or embed)
 * @param mode - 'mobile' for phone/tablet fullscreen, 'desktop' for desktop and tablet constrained
 */
function setupImageViewerGestures(
  imgEl: HTMLImageElement,
  container: HTMLElement,
  mode: GestureMode
): ViewerGestureControls {
  const isMobileMode = mode === 'mobile';
  let errorHandler: (() => void) | null = null;
  // The desktop backend keeps its transform state in `attachDesktopGestures`'s
  // closure; these bridges expose it to the returned controls, mirroring the
  // `mobileResetTransform` pattern below
  let desktopAttached = false;
  let desktopResetTransform: (() => void) | null = null;
  let desktopSetAltDrag: ((enabled: boolean) => void) | null = null;
  let desktopCleanup: (() => void) | null = null;
  let mobileTouchHandler: ((e: TouchEvent) => void) | null = null;
  let mobileAnimFrame = 0;
  let mobileLoadHandler: (() => void) | null = null;
  let mobileResetTransform: (() => void) | null = null;
  const gestureDoc = container.ownerDocument;
  const gestureWin = gestureDoc.defaultView ?? window;

  /**
   * Desktop gesture backend — wheel zoom/pan plus pointer-drag panning, written
   * against native's transform order: `translate(Ppx) scale(z)`, so the pan is
   * in **screen** pixels. The mobile backend below deliberately keeps the
   * opposite order (`scale(s) translate(x, y)`, pre-scale pan).
   */
  function attachDesktopGestures(): void {
    const zoomSensitivity = getZoomSensitivityDesktop();

    let scale = 1;
    let panX = 0;
    let panY = 0;
    let rafId = 0;
    let wasPannable = false;
    let altDragMode = false;
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
        }
      });
    };

    desktopResetTransform = () => {
      scale = 1;
      panX = 0;
      panY = 0;
      applyDesktopTransform();
    };

    desktopSetAltDrag = (enabled: boolean) => {
      altDragMode = enabled;
      imgEl.draggable = enabled;
    };

    const pointerController = new AbortController();

    // Native's three-branch wheel model (`handleWheelZoom`, app.js:95651):
    // Ctrl/Cmd zooms about the cursor, a plain wheel pans once zoomed, and a
    // plain wheel at 1x is ignored outright — not even preventDefault, so the
    // page keeps its normal scroll. Native binds this to the whole viewer with
    // no target check, so hovering the backdrop behaves the same as the image.
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
        // The plugin keeps a sensitivity setting native lacks; scale relative to
        // the value that reproduces native so the default stays faithful
        step *= zoomSensitivity / NATIVE_ZOOM_SENSITIVITY;

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
    containerWheelHandlers.set(container, wheelHandler);

    // Armed the moment anything is registered — a throw further down would
    // otherwise make `cleanup()` skip desktop teardown and leak the wheel
    // listener along with its `containerWheelHandlers` entry
    desktopAttached = true;
    desktopCleanup = () => {
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
      if (e.button !== 0 || scale <= 1 || altDragMode) return;
      activePointerId = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      imgEl.setPointerCapture(e.pointerId);
      // Obsidian's own `is-grabbing` body class carries `cursor: grabbing
      // !important` app-wide; the native lightbox drives it the same way, so
      // the plugin needs no CSS of its own
      gestureDoc.body.classList.add('is-grabbing');
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
      gestureDoc.body.classList.remove('is-grabbing');
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
      cancelAnimationFrame(mobileAnimFrame);
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
      cancelAnimationFrame(mobileAnimFrame);
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
      cancelAnimationFrame(mobileAnimFrame);
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
    const initialLoadHandler = () => {
      if (isMobileMode) attachMobileGestures();
      else attachDesktopGestures();
    };
    imgEl.addEventListener('load', initialLoadHandler, { once: true });

    errorHandler = () => {
      console.warn('Image failed to load, viewer gestures not attached');
      imgEl.removeEventListener('load', initialLoadHandler);
    };
    imgEl.addEventListener('error', errorHandler, { once: true });
  }

  return {
    cleanup: () => {
      if (desktopAttached) {
        const wheelHandler = containerWheelHandlers.get(container);
        if (wheelHandler) {
          container.removeEventListener('wheel', wheelHandler, WHEEL_OPTIONS);
          containerWheelHandlers.delete(container);
        }
        desktopCleanup?.();
      }
      if (errorHandler) {
        imgEl.removeEventListener('error', errorHandler);
      }
      // Never leave the app-wide grabbing cursor behind if the viewer is torn
      // down mid-drag — pointerup would not fire
      gestureDoc.body.classList.remove('is-grabbing');
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
        cancelAnimationFrame(mobileAnimFrame);
      }
      if (mobileLoadHandler) {
        imgEl.removeEventListener('load', mobileLoadHandler);
      }
    },
    setAltDragMode: (enabled: boolean) => {
      desktopSetAltDrag?.(enabled);
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
    return;
  }

  // Remove non-current slideshow image from clone (prevents duplicate display)
  const nextImg = cloneEl.querySelector<HTMLImageElement>(
    'img.slideshow-img-next'
  );
  if (nextImg) {
    nextImg.remove();
  }

  // Resolve the titlebar name before the blob swap below — blob: URLs have no basename
  const displayName =
    imgEl.title || imgEl.alt || getImageDisplayName(imgEl.src);

  // Locate the opened image within the card's navigable set. Cards render raw
  // src values, but a slideshow/scrub step may already have swapped in a blob:
  // URL, and imgEl.src returns the percent-encoded form — match all four.
  const imageSet = viewerImageSets.get(embedEl);
  const rawSrc = imgEl.getAttribute('src') ?? '';
  let currentIndex = imageSet
    ? imageSet.urls.findIndex(
        (u) =>
          u === imgEl.src ||
          u === rawSrc ||
          getCachedBlobUrl(u) === imgEl.src ||
          getCachedBlobUrl(u) === rawSrc
      )
    : -1;
  if (currentIndex < 0) currentIndex = 0;

  // Use cached blob URL for external images to avoid re-fetching
  if (isExternalUrl(imgEl.src)) {
    imgEl.src = getCachedBlobUrl(imgEl.src);
  }

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

  // For constrained mode, extract opacity from theme's cover color
  if (!isFullscreen) {
    const coverColor = getComputedStyle(viewerDoc.body)
      .getPropertyValue('--background-modifier-cover')
      .trim();
    const match = coverColor.match(/[\d.]+(?=\s*\)$)/); // Extract last number (alpha)
    if (match) {
      const opacity = parseFloat(match[0]);
      if (opacity >= 0 && opacity <= 1) {
        cloneEl.style.setProperty('--overlay-opacity', String(opacity));
      }
    }
  }

  // Wrap ALL setup in try-catch to prevent orphaned clone on error
  let resizeObserver: ResizeObserver | null = null;
  let modalObserver: MutationObserver | null = null;

  try {
    if (!isFullscreen) {
      // Use workspace-leaf (stable across React re-renders) as observer target
      const workspaceLeaf = embedEl.closest('.workspace-leaf');
      if (workspaceLeaf) {
        const updateBounds = () => {
          const rect = workspaceLeaf.getBoundingClientRect();
          cloneEl.style.top = `${rect.top}px`;
          cloneEl.style.left = `${rect.left}px`;
          cloneEl.style.width = `${rect.width}px`;
          cloneEl.style.height = `${rect.height}px`;
        };

        // Set fixed positioning with bounds matching the container
        cloneEl.addClass('dynamic-views-viewer-fixed');
        updateBounds();
        // Append to body (not view-content) to survive React re-renders
        viewerDoc.body.appendChild(cloneEl);

        // Update bounds when leaf resizes (stable element)
        resizeObserver = new viewerWin.ResizeObserver(updateBounds);
        resizeObserver.observe(workspaceLeaf);
      } else {
        viewerDoc.body.appendChild(cloneEl);
      }
    } else {
      viewerDoc.body.appendChild(cloneEl);
    }

    // Watch for Obsidian modals opening (command palette, settings, etc.)
    // Note: MutationObserver callbacks are async, so viewerClones.set() at end of try block
    // will always complete before any callback fires - no race condition possible
    modalObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (
            node instanceof HTMLElement &&
            node.matches('.modal-container, .prompt')
          ) {
            if (isFullscreen) {
              closeImageViewer(cloneEl, viewerCleanupFns, viewerClones);
            } else {
              cloneEl.addClass('dynamic-views-viewer-behind-modal');
            }
            return;
          }
        }
      }
    });
    modalObserver.observe(viewerDoc.body, { childList: true });

    // Only setup pinch/gesture zoom if not disabled
    const isPinchZoomDisabled = viewerDoc.body.classList.contains(
      'dynamic-views-zoom-disabled'
    );

    // Track gesture controls for Alt+drag coordination (set when gestures active)
    let gestureControls: ViewerGestureControls | null = null;

    if (!isPinchZoomDisabled) {
      const gestureMode: GestureMode = isMobile ? 'mobile' : 'desktop';
      gestureControls = setupImageViewerGestures(imgEl, cloneEl, gestureMode);

      // On mobile, block single-finger touch propagation on non-IMG elements so the
      // mobile gesture handler gets exclusive control (prevents sidebar swipe + pull-down)
      if (isMobile) {
        cloneEl.dataset.ignoreSwipe = 'true';
        const swipeController = new AbortController();
        setupTouchInterceptAll(cloneEl, swipeController.signal);
        viewerCleanupFns.set(cloneEl, () => {
          gestureControls!.cleanup();
          swipeController.abort();
        });
      } else {
        viewerCleanupFns.set(cloneEl, gestureControls.cleanup);
      }
    } else if (!isMobile) {
      // Image is always draggable when zoom is off (no pan to conflict with)
      imgEl.draggable = true;

      const onZoomDisabledDragStart = (e: DragEvent) => {
        const src = imgEl.src;
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

      imgEl.addEventListener('dragstart', onZoomDisabledDragStart);

      const existingGestureCleanup = viewerCleanupFns.get(cloneEl);
      viewerCleanupFns.set(cloneEl, () => {
        existingGestureCleanup?.();
        imgEl.removeEventListener('dragstart', onZoomDisabledDragStart);
      });
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

    // Desktop only: Escape or Space to close (native mobile viewer has no keys — tap to dismiss only)
    let onEscape: ((e: KeyboardEvent) => void) | null = null;
    if (!isMobile) {
      onEscape = (e: KeyboardEvent) => {
        if (e.key !== 'Escape' && e.code !== 'Space') return;
        if (isConstrainedViewerInactive(cloneEl, viewerDoc)) return;
        // Space would otherwise scroll the pane or re-activate the card underneath
        e.preventDefault();
        e.stopPropagation();
        closeImageViewer(cloneEl, viewerCleanupFns, viewerClones);
      };
    }

    // Arrow keys step through the card's navigable image set. The viewer index
    // is independent — the card underneath never advances. Desktop always, plus
    // tablets with a hardware keyboard; phones are excluded even when one is
    // attached.
    const canArrowNavigate =
      !isMobile || (Platform.isTablet && hasPhysicalKeyboard());
    let onArrowNav: ((e: KeyboardEvent) => void) | null = null;
    let pendingNavError: (() => void) | null = null;

    if (canArrowNavigate && imageSet && imageSet.urls.length > 1) {
      const set = imageSet;

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
        const url = set.urls[index];

        const onNavError = (): void => {
          pendingNavError = null;
          if (!imgEl.isConnected) return; // Viewer closed mid-flight
          markImageBroken(url);
          if (attempts >= set.urls.length) return;
          const retry = getNextImageIndex(index, direction, set.urls, (u) =>
            brokenImageUrls.has(u)
          );
          if (retry !== -1) showIndex(retry, direction, attempts + 1);
        };
        const onNavLoad = (): void => {
          clearPendingNavError();
          gestureControls?.ensureGestures();
        };

        pendingNavError = onNavError;
        imgEl.addEventListener('error', onNavError, { once: true });
        imgEl.addEventListener('load', onNavLoad, { once: true });
        gestureControls?.resetZoom();
        imgEl.src = getCachedBlobUrl(url);
        // title/alt belong to the initially embedded image — never reapply them
        titlebarTextEl.setText(getImageDisplayName(url));
      };

      onArrowNav = (e: KeyboardEvent) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        if (isConstrainedViewerInactive(cloneEl, viewerDoc)) return;
        e.preventDefault();
        e.stopPropagation();
        const direction = e.key === 'ArrowRight' ? 1 : -1;
        const next = getNextImageIndex(
          currentIndex,
          direction,
          set.urls,
          (url) => brokenImageUrls.has(url)
        );
        if (next === -1) return;
        showIndex(next, direction);
      };
      viewerDoc.addEventListener('keydown', onArrowNav, true);
    }

    // Desktop only: ⌘+C to copy image
    let onCopy: ((e: KeyboardEvent) => void) | null = null;
    if (!isMobile) {
      onCopy = (e: KeyboardEvent) => {
        const isCopyShortcut = (e.metaKey || e.ctrlKey) && e.key === 'c';
        if (!isCopyShortcut) return;
        if (isConstrainedViewerInactive(cloneEl, viewerDoc)) return;

        e.preventDefault();
        e.stopPropagation();

        void (async () => {
          try {
            if (!viewerDoc.hasFocus()) {
              viewerWin.focus();
              await new Promise((r) => setTimeout(r, 50));
            }

            // For external images, reload with crossOrigin to avoid tainted canvas
            const isExternal = /^https?:\/\//i.test(imgEl.src);
            let sourceImg: HTMLImageElement = imgEl;

            if (isExternal) {
              sourceImg = await new Promise<HTMLImageElement>(
                (resolve, reject) => {
                  const img = new Image();
                  img.crossOrigin = 'anonymous';
                  img.onload = () => resolve(img);
                  img.onerror = () => reject(new Error('Failed to load image'));
                  img.src = imgEl.src;
                }
              );
            }

            if (!sourceImg.naturalWidth || !sourceImg.naturalHeight) {
              throw new Error('Image not loaded');
            }

            // Clipboard API only supports PNG - convert via canvas
            const canvas = viewerDoc.createElement('canvas');
            canvas.width = sourceImg.naturalWidth;
            canvas.height = sourceImg.naturalHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Failed to get canvas context');
            ctx.drawImage(sourceImg, 0, 0);

            const blob = await new Promise<Blob>((resolve, reject) => {
              canvas.toBlob((b) => {
                if (b) resolve(b);
                else reject(new Error('Failed to create blob'));
              }, 'image/png');
            });

            await navigator.clipboard.write([
              new ClipboardItem({ 'image/png': blob }),
            ]);
            new Notice('Copied to your clipboard');
          } catch (error) {
            console.error('Failed to copy image:', error);
            new Notice('Failed to copy image');
          }
        })();
      };
    }

    // Desktop only: Enter to open the image's file
    let onEnter: ((e: KeyboardEvent) => void) | null = null;
    if (!isMobile) {
      onEnter = (e: KeyboardEvent) => {
        if (e.key !== 'Enter') return;
        if (isConstrainedViewerInactive(cloneEl, viewerDoc)) return;
        const src = imgEl.src;
        const vaultPath = getVaultPathFromResourceUrl(src);
        if (!vaultPath) return;
        const file = app.vault.getAbstractFileByPath(vaultPath);
        if (!(file instanceof TFile)) return;
        e.preventDefault();
        closeImageViewer(cloneEl, viewerCleanupFns, viewerClones);
        void app.workspace.getLeaf(false).openFile(file);
      };
    }

    // Mobile: block desktop hotkeys so Obsidian doesn't activate underlying card/link
    let onBlockKeys: ((e: KeyboardEvent) => void) | null = null;
    if (isMobile) {
      onBlockKeys = (e: KeyboardEvent) => {
        if (
          e.code === 'Space' ||
          e.key === 'Enter' ||
          e.key === 'Escape' ||
          e.key === 'r' ||
          e.key === 'R' ||
          e.key === 'ArrowDown'
        ) {
          e.preventDefault();
          e.stopPropagation();
        }
      };
    }

    // Add all listeners synchronously (isOpening flag prevents immediate trigger)
    if (onEscape) viewerDoc.addEventListener('keydown', onEscape, true);
    if (onEnter) viewerDoc.addEventListener('keydown', onEnter, true);
    if (onBlockKeys) viewerDoc.addEventListener('keydown', onBlockKeys, true);
    if (onCopy) viewerDoc.addEventListener('keydown', onCopy, true);
    cloneEl.addEventListener('click', onOverlayClick);

    // stopPropagation keeps the click off the overlay-dismiss path
    const onCloseClick = (e: MouseEvent) => {
      e.stopPropagation();
      closeImageViewer(cloneEl, viewerCleanupFns, viewerClones);
    };
    closeEl.addEventListener('click', onCloseClick);

    // Desktop-only: Alt+drag to drag image out of viewer
    let onAltKeyDown: ((e: KeyboardEvent) => void) | null = null;
    let onAltKeyUp: ((e: KeyboardEvent) => void) | null = null;
    let onAltBlur: (() => void) | null = null;
    let onDragStart: ((e: DragEvent) => void) | null = null;
    let onDragEnd: (() => void) | null = null;

    if (!isMobile && gestureControls) {
      let altHeld = false;

      const enableAltDrag = () => {
        altHeld = true;
        gestureControls.setAltDragMode(true);
        imgEl.draggable = true;
        cloneEl.classList.add('is-alt-drag');
      };

      const disableAltDrag = () => {
        altHeld = false;
        gestureControls.setAltDragMode(false);
        imgEl.draggable = false;
        cloneEl.classList.remove('is-alt-drag');
      };

      onAltKeyDown = (e: KeyboardEvent) => {
        if (e.key !== 'Alt' || altHeld) return;
        if (isConstrainedViewerInactive(cloneEl, viewerDoc)) return;
        enableAltDrag();
      };

      onAltKeyUp = (e: KeyboardEvent) => {
        if (e.key !== 'Alt' || !altHeld) return;
        disableAltDrag();
      };

      // Reset on window blur (handles Alt+Tab leaving Alt stuck)
      onAltBlur = () => {
        if (altHeld) disableAltDrag();
      };

      onDragStart = (e: DragEvent) => {
        if (!altHeld) {
          e.preventDefault();
          return;
        }

        const src = imgEl.src;
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

      onDragEnd = () => {
        // Clean up even if user releases Alt during drag
        disableAltDrag();
      };

      viewerDoc.addEventListener('keydown', onAltKeyDown, true);
      viewerDoc.addEventListener('keyup', onAltKeyUp, true);
      viewerWin.addEventListener('blur', onAltBlur);
      imgEl.addEventListener('dragstart', onDragStart);
      imgEl.addEventListener('dragend', onDragEnd);
    }

    // Cleanup removes all listeners (removeEventListener is no-op if never added)
    viewerListenerCleanups.set(cloneEl, () => {
      if (onEscape) viewerDoc.removeEventListener('keydown', onEscape, true);
      if (onEnter) viewerDoc.removeEventListener('keydown', onEnter, true);
      if (onBlockKeys)
        viewerDoc.removeEventListener('keydown', onBlockKeys, true);
      if (onCopy) viewerDoc.removeEventListener('keydown', onCopy, true);
      if (onArrowNav)
        viewerDoc.removeEventListener('keydown', onArrowNav, true);
      if (pendingNavError) imgEl.removeEventListener('error', pendingNavError);
      cloneEl.removeEventListener('click', onOverlayClick);
      closeEl.removeEventListener('click', onCloseClick);
      if (isMobile) {
        cloneEl.removeEventListener('touchstart', onTouchStart);
        cloneEl.removeEventListener('touchend', onTouchEnd);
      }
      if (onAltKeyDown) {
        viewerDoc.removeEventListener('keydown', onAltKeyDown, true);
      }
      if (onAltKeyUp) {
        viewerDoc.removeEventListener('keyup', onAltKeyUp, true);
      }
      if (onAltBlur) {
        viewerWin.removeEventListener('blur', onAltBlur);
      }
      if (onDragStart) {
        imgEl.removeEventListener('dragstart', onDragStart);
      }
      if (onDragEnd) {
        imgEl.removeEventListener('dragend', onDragEnd);
      }
      // Clear pending gesture timeout to prevent dangling callbacks
      if (gestureTimeoutId !== null) {
        clearTimeout(gestureTimeoutId);
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      modalObserver?.disconnect();
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

    // Track cursor position over overlay so closeImageViewer has fresh coordinates
    // for the synthetic mousemove that resumes thumbnail scrubbing
    cloneEl.addEventListener('mousemove', (e: MouseEvent) => {
      embedEl.dataset.viewerX = String(e.clientX);
      embedEl.dataset.viewerY = String(e.clientY);
    });

    // Register in tracking map AFTER all setup succeeds (prevents partial state)
    viewerClones.set(embedEl, cloneEl);
  } catch (error) {
    // Comprehensive cleanup in reverse order of allocation
    console.error('Failed to setup image viewer', error);

    // 1. Call and remove gesture cleanup (may have been partially set up)
    const gestureCleanup = viewerCleanupFns.get(cloneEl);
    if (gestureCleanup) {
      gestureCleanup();
    }
    viewerCleanupFns.delete(cloneEl);

    // 2. Call and remove listener cleanup (may have been partially set up)
    const listenerCleanup = viewerListenerCleanups.get(cloneEl);
    if (listenerCleanup) {
      listenerCleanup();
    }
    viewerListenerCleanups.delete(cloneEl);

    // 3. Disconnect observers (may be null if error was early)
    modalObserver?.disconnect();
    resizeObserver?.disconnect();

    // 4. Remove DOM element last
    cloneEl.remove();
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
    { passive: false, signal }
  );
}
