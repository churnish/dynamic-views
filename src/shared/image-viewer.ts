/**
 * Shared image viewer handler - eliminates code duplication across card renderers
 */

import { Notice, Platform, TFile, type App } from 'obsidian';
import Panzoom, { PanzoomObject } from '@panzoom/panzoom';
import { setupTouchInterceptAll } from '../bases/swipe-interceptor';
import { GESTURE_TIMEOUT_MS } from './constants';
import { getZoomSensitivityDesktop } from '../utils/style-settings';
import { getVaultPathFromResourceUrl, isExternalUrl } from '../utils/image';
import { getCachedBlobUrl } from './slideshow';
import { getOwnerWindow } from '../utils/owner-window';

// dragManager type declared in datacore/types.d.ts

/** Wheel event listener options (stored for proper cleanup) */
const WHEEL_OPTIONS: AddEventListenerOptions = { passive: false };

/** Movement threshold in pixels to distinguish click from pan/drag */
const MOVE_THRESHOLD = 5;

type GestureMode = 'mobile' | 'desktop';

// Store cleanup functions for event listeners (Map for explicit lifecycle control)
const viewerListenerCleanups = new Map<HTMLElement, () => void>();

// Map for wheel handlers (keyed by container element, uses explicit lifecycle control)
const containerWheelHandlers = new Map<HTMLElement, (e: WheelEvent) => void>();

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
  cloneEl.remove();

  // O(1) lookup using stored reference instead of iterating map
  const original = cloneEl.__originalEmbed;
  if (original) {
    viewerClones.delete(original);
    delete cloneEl.__originalEmbed;

    // Restore hover intent so cursor stays zoom-in/pointer after dismiss.
    // Clone overlay causes mouseleave → hover intent deactivates. After
    // removal, Electron doesn't re-hit-test so :hover and mouseenter are
    // unreliable — add class directly instead.
    // Skipped when a new viewer pre-empts this one (mouse is on a different card).
    if (restoreHoverIntent) {
      const cardEl = original.closest<HTMLElement>('.card');
      if (cardEl) {
        cardEl.classList.add('hover-intent-active');
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
              const img = thumbnailEl.querySelector('img');
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
    openImageViewer(embedEl, app, viewerCleanupFns, viewerClones);
  }
}

interface ViewerGestureControls {
  cleanup: () => void;
  /** Exclude image from Panzoom event handling so native drag can proceed. */
  setAltDragMode: (enabled: boolean) => void;
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
  let panzoomInstance: PanzoomObject | null = null;
  let spacebarHandler: ((e: KeyboardEvent) => void) | null = null;
  let errorHandler: (() => void) | null = null;
  let contextmenuHandler: ((e: MouseEvent) => void) | null = null;
  let mobileTouchHandler: ((e: TouchEvent) => void) | null = null;
  let mobileAnimFrame = 0;
  let mobileLoadHandler: (() => void) | null = null;
  let isMaximized = false;
  const gestureDoc = container.ownerDocument;
  const gestureWin = gestureDoc.defaultView ?? window;
  let containerResizeObserver: ResizeObserver | null = null;

  // Cache container dimensions (updated on resize for desktop maximized mode)
  let cachedContainerWidth = container.clientWidth;
  let cachedContainerHeight = container.clientHeight;

  // Desktop maximized mode: pan state for edge-gluing (reset when toggling maximized)
  let desktopPanX = 0;
  let desktopPanY = 0;
  let desktopLastScale = 1;
  // Delta tracking for desktop transform (outer scope so resetDesktopPan can clear it)
  let desktopLastX: number | undefined;
  let desktopLastY: number | undefined;
  // Cached image layout dimensions (avoid forced reflow on every panzoom frame)
  let cachedImgWidth = 0;
  let cachedImgHeight = 0;

  /** Reset desktop pan tracking (called when entering/exiting maximized) */
  function resetDesktopPan(): void {
    desktopPanX = 0;
    desktopPanY = 0;
    desktopLastScale = 1;
    desktopLastX = undefined;
    desktopLastY = undefined;
    cachedImgWidth = 0;
    cachedImgHeight = 0;
  }

  function attachDesktopGestures(): void {
    const zoomSensitivity = getZoomSensitivityDesktop();

    // Update container dimensions via ResizeObserver (avoids stale bounds in maximized mode)
    containerResizeObserver = new gestureWin.ResizeObserver((entries) => {
      for (const entry of entries) {
        cachedContainerWidth = entry.contentRect.width;
        cachedContainerHeight = entry.contentRect.height;
      }
      // Invalidate image dimension cache (layout may change on resize)
      cachedImgWidth = 0;
      cachedImgHeight = 0;
    });
    containerResizeObserver.observe(container);

    // Custom transform that applies edge-gluing when maximized
    const desktopSetTransform = (
      elem: HTMLElement,
      { scale, x, y }: { scale: number; x: number; y: number }
    ) => {
      // Non-maximized: default panzoom behavior
      if (!isMaximized) {
        elem.style.transform = `scale(${scale}) translate(${x}px, ${y}px)`;
        return;
      }

      // Maximized: clamp pan so edges stay at container boundaries
      // Cache image dimensions on first call (avoids forced reflow on every transform)
      if (cachedImgWidth === 0) {
        cachedImgWidth = elem.offsetWidth;
        cachedImgHeight = elem.offsetHeight;
      }
      const imgWidth = cachedImgWidth;
      const imgHeight = cachedImgHeight;

      const scaledWidth = imgWidth * scale;
      const scaledHeight = imgHeight * scale;

      // Max pan: image edges stay at container edges (no empty space on glued axis)
      const maxPanX = Math.max(
        0,
        (scaledWidth - cachedContainerWidth) / 2 / scale
      );
      const maxPanY = Math.max(
        0,
        (scaledHeight - cachedContainerHeight) / 2 / scale
      );

      // On scale change, clamp existing pan to new bounds
      if (scale !== desktopLastScale) {
        desktopPanX = Math.max(-maxPanX, Math.min(maxPanX, desktopPanX));
        desktopPanY = Math.max(-maxPanY, Math.min(maxPanY, desktopPanY));
        desktopLastScale = scale;
      }

      // Calculate delta from panzoom's accumulated values
      const deltaX = x - (desktopLastX ?? x);
      const deltaY = y - (desktopLastY ?? y);
      desktopLastX = x;
      desktopLastY = y;

      // Apply delta with clamping
      desktopPanX = Math.max(-maxPanX, Math.min(maxPanX, desktopPanX + deltaX));
      desktopPanY = Math.max(-maxPanY, Math.min(maxPanY, desktopPanY + deltaY));

      elem.style.transform = `scale(${scale}) translate(${desktopPanX}px, ${desktopPanY}px)`;
    };

    // Panzoom's isAttached walks up to module-scope `document`, which fails
    // for elements in popout windows (separate V8 isolate). Temporarily
    // reparent the container to the main document for the init check —
    // imgEl.parentNode (container) stays correct throughout.
    const inPopout = container.ownerDocument !== document;
    let reparentBack: (() => void) | null = null;
    if (inPopout) {
      const origParent = container.parentElement;
      const origNext = container.nextSibling;
      document.body.appendChild(container);
      reparentBack = () => origParent?.insertBefore(container, origNext);
    }
    panzoomInstance = Panzoom(imgEl, {
      maxScale: 4,
      minScale: 1,
      startScale: 1,
      step: zoomSensitivity,
      canvas: false,
      cursor: 'move',
      setTransform: desktopSetTransform,
    });
    reparentBack?.();

    // Panzoom also binds handleMove/handleUp to module-scope `document`.
    // In popouts, pointer events fire on the popout's document. Rebind.
    if (inPopout) {
      const pz = panzoomInstance;
      document.removeEventListener('pointermove', pz.handleMove);
      document.removeEventListener('pointerup', pz.handleUp);
      document.removeEventListener('pointerleave', pz.handleUp);
      document.removeEventListener('pointercancel', pz.handleUp);
      gestureDoc.addEventListener('pointermove', pz.handleMove, {
        passive: true,
      });
      gestureDoc.addEventListener('pointerup', pz.handleUp, {
        passive: true,
      });
      gestureDoc.addEventListener('pointerleave', pz.handleUp, {
        passive: true,
      });
      gestureDoc.addEventListener('pointercancel', pz.handleUp, {
        passive: true,
      });
    }

    // Only zoom when cursor is over the image (not the overlay)
    const wheelHandler = (e: WheelEvent) => {
      if (e.target !== imgEl) return;
      panzoomInstance!.zoomWithWheel(e);
    };
    container.addEventListener('wheel', wheelHandler, WHEEL_OPTIONS);
    containerWheelHandlers.set(container, wheelHandler);

    // Helper to update maximized state and class
    function setMaximized(value: boolean, containScale?: number): void {
      isMaximized = value;
      container.classList.toggle('is-maximized', value);
      // Reset desktop pan tracking for fresh start in new mode
      resetDesktopPan();
      // When maximized, prevent zooming out below contain scale
      if (value && containScale) {
        panzoomInstance?.setOptions({ minScale: containScale });
      } else {
        panzoomInstance?.setOptions({ minScale: 1 });
      }
    }

    // Calculate scale to fill container without cropping
    function getContainScale(): number {
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;
      const imgWidth = imgEl.clientWidth || 1; // Avoid division by zero
      const imgHeight = imgEl.clientHeight || 1;
      return Math.min(containerWidth / imgWidth, containerHeight / imgHeight);
    }

    // Keyboard shortcuts — desktop only
    spacebarHandler = (e: KeyboardEvent) => {
      // Constrained viewer: only handle keys when the viewer has focus or its leaf is active
      if (container.classList.contains('dynamic-views-viewer-fixed')) {
        const orig = (container as CloneElement).__originalEmbed;
        const activeLeaf = gestureDoc.activeElement?.closest('.workspace-leaf');
        if (
          gestureDoc.activeElement !== container &&
          !orig?.closest('.workspace-leaf.mod-active') &&
          !!activeLeaf &&
          activeLeaf !== orig?.closest('.workspace-leaf')
        )
          return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        if (isMaximized) {
          setMaximized(false);
          panzoomInstance?.reset();
        } else {
          const containScale = getContainScale();
          setMaximized(true, containScale);
          panzoomInstance?.zoom(containScale, { animate: true });
        }
        container.dataset.lastKeyTime = String(Date.now());
      } else if (e.key === 'r' || e.key === 'R' || e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (isMaximized) setMaximized(false);
        panzoomInstance?.reset();
        container.dataset.lastKeyTime = String(Date.now());
      }
    };
    gestureDoc.addEventListener('keydown', spacebarHandler, true);

    // Right-click to reset zoom/pan
    contextmenuHandler = (e: MouseEvent) => {
      if (e.target !== imgEl) return;
      e.preventDefault();

      if (isMaximized) {
        resetDesktopPan();
        panzoomInstance?.zoom(getContainScale(), { animate: true });
      } else {
        panzoomInstance?.reset();
      }
    };
    container.addEventListener('contextmenu', contextmenuHandler, true);
  }

  /**
   * Native mobile touch handler — ported from Obsidian's built-in `mobile-image-viewer`.
   * Deobfuscated source: archive/obsidian-native-image-viewer.js
   * No Panzoom — direct touch events with focal-point pinch zoom and momentum.
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

    /** Apply clamped transform — native formula: maxPan = imgDim * (scale-1)/scale/2 */
    const applyTransform = () => {
      const panFactor = (scale - 1) / scale / 2;
      const maxPanX = Math.max(0, imgWidth * panFactor);
      const maxPanY = Math.max(0, imgHeight * panFactor);
      panX = Math.max(-maxPanX, Math.min(maxPanX, panX));
      panY = Math.max(-maxPanY, Math.min(maxPanY, panY));
      scale = Math.max(1, Math.min(maxScale, scale));
      imgEl.style.transform = `scale(${scale}) translate(${panX}px, ${panY}px)`;
    };

    // Momentum state
    let velocity = 0;
    let direction = 0;
    let lastTime = 0;

    const momentumTick = () => {
      cancelAnimationFrame(mobileAnimFrame);
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
      if (panzoomInstance) {
        const wheelHandler = containerWheelHandlers.get(container);
        if (wheelHandler) {
          container.removeEventListener('wheel', wheelHandler, WHEEL_OPTIONS);
          containerWheelHandlers.delete(container);
        }
        // Remove popout document listeners (destroy() only removes from main document)
        if (gestureDoc !== document) {
          gestureDoc.removeEventListener(
            'pointermove',
            panzoomInstance.handleMove
          );
          gestureDoc.removeEventListener('pointerup', panzoomInstance.handleUp);
          gestureDoc.removeEventListener(
            'pointerleave',
            panzoomInstance.handleUp
          );
          gestureDoc.removeEventListener(
            'pointercancel',
            panzoomInstance.handleUp
          );
        }
        panzoomInstance.destroy();
      }
      if (spacebarHandler) {
        gestureDoc.removeEventListener('keydown', spacebarHandler, true);
      }
      if (contextmenuHandler) {
        container.removeEventListener('contextmenu', contextmenuHandler, true);
      }
      if (errorHandler) {
        imgEl.removeEventListener('error', errorHandler);
      }
      if (containerResizeObserver) {
        containerResizeObserver.disconnect();
      }
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
      panzoomInstance?.setOptions({ exclude: enabled ? [imgEl] : [] });
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

  // Use cached blob URL for external images to avoid re-fetching
  if (isExternalUrl(imgEl.src)) {
    imgEl.src = getCachedBlobUrl(imgEl.src);
  }

  // Append clone to appropriate container based on fullscreen setting
  // Phone: always fullscreen. Desktop/tablet: fullscreen unless explicitly disabled
  const isPhone = Platform.isPhone;
  const isMobile = Platform.isMobile; // true for phone + tablet (touch devices)
  const isFullscreen =
    isPhone ||
    !viewerDoc.body.classList.contains(
      'dynamic-views-image-viewer-disable-fullscreen'
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

    // Check dismiss setting once, applies regardless of panzoom state
    const isDismissDisabled = viewerDoc.body.classList.contains(
      'dynamic-views-image-viewer-disable-dismiss-on-click'
    );
    // Track gesture controls for Alt+drag coordination (set when Panzoom active)
    let gestureControls: ViewerGestureControls | null = null;

    if (!isPinchZoomDisabled) {
      const gestureMode: GestureMode = isMobile ? 'mobile' : 'desktop';
      gestureControls = setupImageViewerGestures(imgEl, cloneEl, gestureMode);

      // On mobile, disable all touch gestures (sidebar swipes + pull-down) while panning
      // Desktop uses simpler cleanup since touch interception not needed
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
      // Desktop/tablet: trackpad pinch to maximize/restore (when panzoom disabled)
      const onPinchWheel = (e: WheelEvent) => {
        if (!e.ctrlKey) return;
        e.preventDefault();

        if (e.deltaY < 0) {
          cloneEl.classList.add('is-maximized');
        } else if (e.deltaY > 0) {
          cloneEl.classList.remove('is-maximized');
        }
      };
      cloneEl.addEventListener('wheel', onPinchWheel, { passive: false });

      // Desktop only: spacebar to toggle maximize, R/ArrowDown to reset (when panzoom disabled)
      const onSpacebar = (e: KeyboardEvent) => {
        // Constrained viewer: only handle keys when the viewer has focus or its leaf is active
        if (cloneEl.classList.contains('dynamic-views-viewer-fixed')) {
          const orig = cloneEl.__originalEmbed;
          const activeLeaf =
            viewerDoc.activeElement?.closest('.workspace-leaf');
          if (
            viewerDoc.activeElement !== cloneEl &&
            !orig?.closest('.workspace-leaf.mod-active') &&
            !!activeLeaf &&
            activeLeaf !== orig?.closest('.workspace-leaf')
          )
            return;
        }
        if (e.code === 'Space') {
          e.preventDefault();
          e.stopPropagation();
          cloneEl.classList.toggle('is-maximized');
          cloneEl.dataset.lastKeyTime = String(Date.now());
        } else if (e.key === 'r' || e.key === 'R' || e.key === 'ArrowDown') {
          e.preventDefault();
          e.stopImmediatePropagation();
          cloneEl.classList.remove('is-maximized');
          cloneEl.dataset.lastKeyTime = String(Date.now());
        }
      };
      viewerDoc.addEventListener('keydown', onSpacebar, true);

      // Image is always draggable when panzoom is off (no pan to conflict with)
      imgEl.draggable = true;

      const onPanzoomOffDragStart = (e: DragEvent) => {
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

      imgEl.addEventListener('dragstart', onPanzoomOffDragStart);

      const existingGestureCleanup = viewerCleanupFns.get(cloneEl);
      viewerCleanupFns.set(cloneEl, () => {
        existingGestureCleanup?.();
        cloneEl.removeEventListener('wheel', onPinchWheel);
        viewerDoc.removeEventListener('keydown', onSpacebar, true);
        imgEl.removeEventListener('dragstart', onPanzoomOffDragStart);
      });
    }

    // Prevent context menu on image
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    imgEl.addEventListener('contextmenu', onContextMenu);

    // Track pointer movement to distinguish click from pan
    let pointerMoved = false;
    let startX = 0;
    let startY = 0;

    const onPointerDown = (e: PointerEvent) => {
      pointerMoved = false;
      startX = e.clientX;
      startY = e.clientY;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (
        Math.abs(e.clientX - startX) > MOVE_THRESHOLD ||
        Math.abs(e.clientY - startY) > MOVE_THRESHOLD
      ) {
        pointerMoved = true;
      }
    };

    // Trackpad ghost clicks arrive up to ~1200ms after keypress (observed range: 179–1162ms)
    // Disabled: monitoring for false dismissals. May re-enable (1500ms) in the future.
    const GHOST_CLICK_WINDOW = 0;

    // Click-to-dismiss (unless disabled) - works with or without panzoom
    if (!isDismissDisabled) {
      imgEl.addEventListener('pointerdown', onPointerDown);
      imgEl.addEventListener('pointermove', onPointerMove);

      const onImageClick = (e: MouseEvent) => {
        if (pointerMoved) return;
        // Ignore trackpad ghost clicks shortly after keyboard events (R, Space, etc.)
        if (
          Date.now() - Number(cloneEl.dataset.lastKeyTime || 0) <
          GHOST_CLICK_WINDOW
        )
          return;
        e.stopPropagation();
        closeImageViewer(cloneEl, viewerCleanupFns, viewerClones);
      };
      imgEl.addEventListener('click', onImageClick);

      const existingCleanup = viewerCleanupFns.get(cloneEl);
      viewerCleanupFns.set(cloneEl, () => {
        existingCleanup?.();
        imgEl.removeEventListener('pointerdown', onPointerDown);
        imgEl.removeEventListener('pointermove', onPointerMove);
        imgEl.removeEventListener('click', onImageClick);
        imgEl.removeEventListener('contextmenu', onContextMenu);
      });
    } else {
      const existingCleanup = viewerCleanupFns.get(cloneEl);
      viewerCleanupFns.set(cloneEl, () => {
        existingCleanup?.();
        imgEl.removeEventListener('contextmenu', onContextMenu);
      });
    }

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
      // Ignore trackpad ghost clicks shortly after keyboard events (R, Space, etc.)
      if (
        Date.now() - Number(cloneEl.dataset.lastKeyTime || 0) <
        GHOST_CLICK_WINDOW
      )
        return;
      if (e.target === cloneEl) {
        closeImageViewer(cloneEl, viewerCleanupFns, viewerClones);
      }
    };

    // Desktop only: Escape to close (native mobile viewer has no Esc — tap to dismiss only)
    let onEscape: ((e: KeyboardEvent) => void) | null = null;
    if (!isMobile) {
      onEscape = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        // Constrained viewer: only handle Escape when the viewer has focus or its leaf is active
        if (cloneEl.classList.contains('dynamic-views-viewer-fixed')) {
          const orig = cloneEl.__originalEmbed;
          const activeLeaf =
            viewerDoc.activeElement?.closest('.workspace-leaf');
          if (
            viewerDoc.activeElement !== cloneEl &&
            !orig?.closest('.workspace-leaf.mod-active') &&
            !!activeLeaf &&
            activeLeaf !== orig?.closest('.workspace-leaf')
          )
            return;
        }
        closeImageViewer(cloneEl, viewerCleanupFns, viewerClones);
      };
    }

    // Desktop only: ⌘+C to copy image
    let onCopy: ((e: KeyboardEvent) => void) | null = null;
    if (!isMobile) {
      onCopy = (e: KeyboardEvent) => {
        const isCopyShortcut = (e.metaKey || e.ctrlKey) && e.key === 'c';
        if (!isCopyShortcut) return;
        // Constrained viewer: only handle copy when the viewer has focus or its leaf is active
        if (cloneEl.classList.contains('dynamic-views-viewer-fixed')) {
          const orig = cloneEl.__originalEmbed;
          const activeLeaf =
            viewerDoc.activeElement?.closest('.workspace-leaf');
          if (
            viewerDoc.activeElement !== cloneEl &&
            !orig?.closest('.workspace-leaf.mod-active') &&
            !!activeLeaf &&
            activeLeaf !== orig?.closest('.workspace-leaf')
          )
            return;
        }

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

    // Mobile: block all hotkeys so Obsidian doesn't activate underlying card/link
    let onBlockKeys: ((e: KeyboardEvent) => void) | null = null;
    if (isMobile) {
      onBlockKeys = (e: KeyboardEvent) => {
        if (e.code === 'Space' || e.key === 'Enter' || e.key === 'Escape') {
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
        // Constrained viewer: only handle Alt when the viewer has focus or its leaf is active
        if (cloneEl.classList.contains('dynamic-views-viewer-fixed')) {
          const orig = cloneEl.__originalEmbed;
          const activeLeaf =
            viewerDoc.activeElement?.closest('.workspace-leaf');
          if (
            viewerDoc.activeElement !== cloneEl &&
            !orig?.closest('.workspace-leaf.mod-active') &&
            !!activeLeaf &&
            activeLeaf !== orig?.closest('.workspace-leaf')
          )
            return;
        }
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
      cloneEl.removeEventListener('click', onOverlayClick);
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
    // Capture-phase pointerdown re-focuses after tab switches (before panzoom stops propagation).
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
