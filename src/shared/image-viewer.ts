/**
 * Shared image viewer handler - eliminates code duplication across card renderers
 */

import type { App } from "obsidian";
import Panzoom, { PanzoomObject } from "@panzoom/panzoom";
import { setupSwipeInterception } from "../bases/swipe-interceptor";
import {
  getZoomSensitivity,
  getZoomSensitivityMobile,
} from "../utils/style-settings";

/** Long-press detection threshold in ms */
const LONG_PRESS_THRESHOLD = 500;

/** Double-press detection threshold in ms (desktop: mouse/trackpad) */
const DOUBLE_PRESS_THRESHOLD = 300;

/** Mobile vertical pan ratio - ~26% viewport visible at pan limit (matches Obsidian native) */
const MOBILE_VERTICAL_PAN_RATIO = 3.85;

/** Wheel event listener options (stored for proper cleanup) */
const WHEEL_OPTIONS: AddEventListenerOptions = { passive: false };

// Store cleanup functions for event listeners (Map for explicit lifecycle control)
const viewerListenerCleanups = new Map<HTMLElement, () => void>();

// WeakMap for wheel handlers (keyed by container element)
const containerWheelHandlers = new WeakMap<
  HTMLElement,
  (e: WheelEvent) => void
>();

/**
 * Force cleanup all viewers - call on view destruction
 * Removes clones from DOM, runs cleanup functions, clears all maps
 */
export function cleanupAllViewers(
  viewerCleanupFns: Map<HTMLElement, () => void>,
  viewerClones: Map<HTMLElement, HTMLElement>,
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
): void {
  cloneEl.remove();

  // O(1) lookup using stored reference instead of iterating map
  const original = cloneEl.__originalEmbed;
  if (original) {
    viewerClones.delete(original);
    delete cloneEl.__originalEmbed;
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
export function handleImageViewerClick(
  e: MouseEvent,
  cardPath: string,
  app: App,
  viewerCleanupFns: Map<HTMLElement, () => void>,
  viewerClones: Map<HTMLElement, HTMLElement>,
  openFileAction: "card" | "title",
): void {
  // Always stop propagation to prevent third-party plugins (e.g. Image Toolkit)
  e.stopPropagation();

  const isViewerDisabled = document.body.classList.contains(
    "dynamic-views-image-viewer-disabled",
  );
  if (isViewerDisabled) {
    // When viewer disabled, only open file if openFileAction is "card"
    if (openFileAction === "card") {
      const newLeaf = e.metaKey || e.ctrlKey;
      void app.workspace.openLinkText(cardPath, "", newLeaf);
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
    openImageViewer(embedEl, cardPath, app, viewerCleanupFns, viewerClones);
  }
}

/**
 * Setup zoom and pan gestures for an image in the viewer
 * @param imgEl - The image element
 * @param container - The container element (overlay or embed)
 * @param isMobile - Whether running on mobile device
 * @returns Cleanup function
 */
function setupImageViewerGestures(
  imgEl: HTMLImageElement,
  container: HTMLElement,
  isMobile: boolean,
): () => void {
  let panzoomInstance: PanzoomObject | null = null;
  let doublePressHandler: ((e: MouseEvent) => void) | null = null;
  let contextmenuHandler: ((e: MouseEvent) => void) | null = null;
  let loadHandler: (() => void) | null = null;
  let errorHandler: (() => void) | null = null;
  let pointerdownHandler: ((e: PointerEvent) => void) | null = null;
  let pointermoveHandler: (() => void) | null = null;
  let pointerupHandler: (() => void) | null = null;
  let resizeHandler: (() => void) | null = null;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let isMaximized = false;
  let containerResizeObserver: ResizeObserver | null = null;

  // Cache viewport dimensions (updated on resize for mobile)
  let cachedViewportWidth = window.innerWidth;
  let cachedViewportHeight = window.innerHeight;

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

  /** Reset desktop pan tracking (called when entering/exiting maximized) */
  function resetDesktopPan(): void {
    desktopPanX = 0;
    desktopPanY = 0;
    desktopLastScale = 1;
    desktopLastX = undefined;
    desktopLastY = undefined;
  }

  function attachPanzoom(): void {
    const zoomSensitivity = isMobile
      ? getZoomSensitivityMobile()
      : getZoomSensitivity();

    // Setup resize handling for cached dimensions
    if (isMobile) {
      // Mobile: update viewport dimensions on resize
      resizeHandler = () => {
        cachedViewportWidth = window.innerWidth;
        cachedViewportHeight = window.innerHeight;
      };
      window.addEventListener("resize", resizeHandler);
    } else {
      // Desktop: update container dimensions via ResizeObserver (avoids stale bounds in maximized mode)
      containerResizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          cachedContainerWidth = entry.contentRect.width;
          cachedContainerHeight = entry.contentRect.height;
        }
      });
      containerResizeObserver.observe(container);
    }

    // Desktop: custom transform that applies edge-gluing when maximized
    const desktopSetTransform = !isMobile
      ? (
          elem: HTMLElement,
          { scale, x, y }: { scale: number; x: number; y: number },
        ) => {
          // Non-maximized: default panzoom behavior
          if (!isMaximized) {
            elem.style.transform = `scale(${scale}) translate(${x}px, ${y}px)`;
            return;
          }

          // Maximized: clamp pan so edges stay at container boundaries
          // Use cached dimensions (updated via ResizeObserver) to avoid stale bounds
          const imgWidth = elem.offsetWidth;
          const imgHeight = elem.offsetHeight;

          const scaledWidth = imgWidth * scale;
          const scaledHeight = imgHeight * scale;

          // Max pan: image edges stay at container edges (no empty space on glued axis)
          const maxPanX = Math.max(
            0,
            (scaledWidth - cachedContainerWidth) / 2 / scale,
          );
          const maxPanY = Math.max(
            0,
            (scaledHeight - cachedContainerHeight) / 2 / scale,
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
          desktopPanX = Math.max(
            -maxPanX,
            Math.min(maxPanX, desktopPanX + deltaX),
          );
          desktopPanY = Math.max(
            -maxPanY,
            Math.min(maxPanY, desktopPanY + deltaY),
          );

          elem.style.transform = `scale(${scale}) translate(${desktopPanX}px, ${desktopPanY}px)`;
        }
      : undefined;

    // Mobile: custom transform with pan clamping (IIFE to encapsulate state)
    const mobileSetTransform = isMobile
      ? (() => {
          let panX = 0;
          let panY = 0;
          let lastScale = 1;
          let cachedImgWidth = 0;
          let cachedImgHeight = 0;
          // Delta tracking (closure-scoped for clean GC when viewer closes)
          let lastX: number | undefined;
          let lastY: number | undefined;

          return (
            elem: HTMLElement,
            { scale, x, y }: { scale: number; x: number; y: number },
          ) => {
            // Cache image dimensions on first call or scale change (avoid reflow on every transform)
            if (cachedImgWidth === 0 || scale !== lastScale) {
              cachedImgWidth = elem.offsetWidth;
              cachedImgHeight = elem.offsetHeight;
            }

            // Scaled dimensions
            const scaledWidth = cachedImgWidth * scale;
            const scaledHeight = cachedImgHeight * scale;

            // Max pan in pre-scale coordinates
            // Horizontal: image edges stay at viewport edges (no empty space)
            const maxPanX = Math.max(
              0,
              (scaledWidth - cachedViewportWidth) / 2 / scale,
            );
            // Vertical: ~26% viewport visible at pan limit (matches Obsidian native)
            const maxPanY = Math.max(
              0,
              (scaledHeight -
                cachedViewportHeight / MOBILE_VERTICAL_PAN_RATIO) /
                2 /
                scale,
            );

            // On scale change, clamp pan to new bounds (intentional: prevents image going offscreen)
            if (scale !== lastScale) {
              panX = Math.max(-maxPanX, Math.min(maxPanX, panX));
              panY = Math.max(-maxPanY, Math.min(maxPanY, panY));
              lastScale = scale;
            }

            // Calculate delta from panzoom's accumulated values
            // We track our own pan to avoid focal point offset issues
            const deltaX = x - (lastX ?? x);
            const deltaY = y - (lastY ?? y);
            lastX = x;
            lastY = y;

            // Apply delta to our tracked pan, then clamp
            panX = Math.max(-maxPanX, Math.min(maxPanX, panX + deltaX));
            panY = Math.max(-maxPanY, Math.min(maxPanY, panY + deltaY));

            elem.style.transform = `scale(${scale}) translate(${panX}px, ${panY}px)`;
          };
        })()
      : undefined;

    // Use platform-specific setTransform (mobile: viewport clamping, desktop: maximized edge-gluing)
    const customSetTransform = mobileSetTransform ?? desktopSetTransform;

    panzoomInstance = Panzoom(imgEl, {
      maxScale: isMobile ? 9 : 4,
      minScale: 1,
      startScale: 1,
      step: zoomSensitivity,
      canvas: false,
      cursor: isMobile ? "default" : "move",
      ...(customSetTransform && { setTransform: customSetTransform }),
    });

    // Enable wheel zoom on container
    // Desktop: only zoom when cursor is over the image (not the overlay)
    const wheelHandler = (e: WheelEvent) => {
      if (!isMobile && e.target !== imgEl) return;
      panzoomInstance!.zoomWithWheel(e);
    };
    container.addEventListener("wheel", wheelHandler, WHEEL_OPTIONS);
    containerWheelHandlers.set(container, wheelHandler);

    // Helper to update maximized state and class (desktop-only)
    function setMaximized(value: boolean, containScale?: number): void {
      if (isMobile) return; // Defensive guard
      isMaximized = value;
      container.classList.toggle("is-maximized", value);
      // Reset desktop pan tracking for fresh start in new mode
      resetDesktopPan();
      // When maximized, prevent zooming out below contain scale
      if (value && containScale) {
        panzoomInstance?.setOptions({ minScale: containScale });
      } else {
        panzoomInstance?.setOptions({ minScale: 1 });
      }
    }

    // Right-click: prevent default context menu, no action
    contextmenuHandler = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    imgEl.addEventListener("contextmenu", contextmenuHandler);

    // Clear long-press timer helper
    const clearLongPress = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    // Desktop-only: double-press maximize, long-press reset
    // Mobile uses standard pinch-zoom + pan (no maximize/long-press features)
    if (!isMobile) {
      // Calculate scale to fill container without cropping
      function getContainScale(): number {
        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;
        const imgWidth = imgEl.clientWidth;
        const imgHeight = imgEl.clientHeight;
        return Math.min(containerWidth / imgWidth, containerHeight / imgHeight);
      }

      // Double-press detection via click timing (more reliable than native dblclick)
      let lastPressTime = 0;
      doublePressHandler = (e: MouseEvent) => {
        if (e.target !== imgEl) return;
        e.stopPropagation();
        const now = Date.now();
        if (now - lastPressTime < DOUBLE_PRESS_THRESHOLD) {
          lastPressTime = 0; // Reset to prevent triple-press triggering
          if (isMaximized) {
            setMaximized(false);
            panzoomInstance?.reset();
          } else {
            const containScale = getContainScale();
            setMaximized(true, containScale);
            panzoomInstance?.zoom(containScale, { animate: true });
          }
        } else {
          lastPressTime = now;
        }
      };
      container.addEventListener("click", doublePressHandler, true);

      // Long-press via pointer events on container (panzoom stops propagation on imgEl)
      pointerdownHandler = (e: PointerEvent) => {
        // Only primary pointer, left mouse button, and target is the image
        if (!e.isPrimary || e.button !== 0 || e.target !== imgEl) return;
        longPressTimer = setTimeout(() => {
          if (isMaximized) {
            // Reset to initial maximized position (containScale, centered)
            resetDesktopPan();
            panzoomInstance?.zoom(getContainScale(), { animate: true });
          } else {
            panzoomInstance?.reset();
          }
          longPressTimer = null;
        }, LONG_PRESS_THRESHOLD);
      };
      container.addEventListener("pointerdown", pointerdownHandler, true);

      // Cancel long-press on move (user is panning, not long-pressing)
      pointermoveHandler = clearLongPress;
      container.addEventListener("pointermove", pointermoveHandler, true);

      pointerupHandler = clearLongPress;
      container.addEventListener("pointerup", pointerupHandler, true);
    }
  }

  // Check if image already loaded
  if (imgEl.complete && imgEl.naturalWidth > 0) {
    attachPanzoom();
  } else {
    loadHandler = () => {
      attachPanzoom();
    };
    imgEl.addEventListener("load", loadHandler, { once: true });

    // Handle image load errors - cleanup load listener, log warning
    errorHandler = () => {
      console.warn("Image failed to load, viewer gestures not attached");
      // Remove load listener since error occurred (defensive cleanup)
      if (loadHandler) {
        imgEl.removeEventListener("load", loadHandler);
        loadHandler = null;
      }
    };
    imgEl.addEventListener("error", errorHandler, { once: true });
  }

  // Return cleanup function
  return () => {
    if (panzoomInstance) {
      const wheelHandler = containerWheelHandlers.get(container);
      if (wheelHandler) {
        container.removeEventListener("wheel", wheelHandler, WHEEL_OPTIONS);
        containerWheelHandlers.delete(container);
      }
      panzoomInstance.destroy();
    }
    if (doublePressHandler) {
      container.removeEventListener("click", doublePressHandler, true);
    }
    if (contextmenuHandler) {
      imgEl.removeEventListener("contextmenu", contextmenuHandler);
    }
    if (longPressTimer) {
      clearTimeout(longPressTimer);
    }
    if (pointerdownHandler) {
      container.removeEventListener("pointerdown", pointerdownHandler, true);
    }
    if (pointermoveHandler) {
      container.removeEventListener("pointermove", pointermoveHandler, true);
    }
    if (pointerupHandler) {
      container.removeEventListener("pointerup", pointerupHandler, true);
    }
    if (loadHandler) {
      imgEl.removeEventListener("load", loadHandler);
    }
    if (errorHandler) {
      imgEl.removeEventListener("error", errorHandler);
    }
    if (resizeHandler) {
      window.removeEventListener("resize", resizeHandler);
    }
    if (containerResizeObserver) {
      containerResizeObserver.disconnect();
    }
  };
}

/**
 * Opens image viewer with gesture support and close handlers
 */
function openImageViewer(
  embedEl: HTMLElement,
  cardPath: string,
  app: App,
  viewerCleanupFns: Map<HTMLElement, () => void>,
  viewerClones: Map<HTMLElement, HTMLElement>,
): void {
  // Validate embed has an image before proceeding
  const sourceImg = embedEl.querySelector("img");
  if (!sourceImg) {
    console.warn("Cannot open viewer - no img element found");
    return;
  }

  // Close other open viewers (clone array to avoid mutation during iteration)
  for (const clone of Array.from(viewerClones.values())) {
    closeImageViewer(clone, viewerCleanupFns, viewerClones);
  }

  // Clone the embed element for viewing (original stays on card)
  const cloneEl = embedEl.cloneNode(true) as CloneElement;
  cloneEl.classList.add("is-zoomed");

  // Store reference to original for O(1) cleanup lookup
  cloneEl.__originalEmbed = embedEl;

  // For slideshows, get the current visible image; for regular embeds, get the only img
  const imgEl =
    cloneEl.querySelector<HTMLImageElement>("img.slideshow-img-current") ||
    cloneEl.querySelector<HTMLImageElement>("img");
  if (!imgEl) {
    console.warn("Cannot open viewer - cloned img element missing");
    return;
  }

  // Append clone to appropriate container based on fullscreen setting
  // Mobile: always fullscreen. Desktop: fullscreen if toggle is on
  const isMobile = app.isMobile;
  const isFullscreen =
    isMobile ||
    document.body.classList.contains("dynamic-views-image-viewer-fullscreen");
  let resizeObserver: ResizeObserver | null = null;
  if (!isFullscreen) {
    // Use workspace-leaf (stable across React re-renders) as observer target
    const workspaceLeaf = embedEl.closest(".workspace-leaf");
    if (workspaceLeaf) {
      const updateBounds = () => {
        const rect = workspaceLeaf.getBoundingClientRect();
        cloneEl.style.top = `${rect.top}px`;
        cloneEl.style.left = `${rect.left}px`;
        cloneEl.style.width = `${rect.width}px`;
        cloneEl.style.height = `${rect.height}px`;
      };

      // Set fixed positioning with bounds matching the container
      cloneEl.style.inset = "auto"; // Reset inset first
      cloneEl.style.position = "fixed";
      updateBounds();
      // Append to body (not view-content) to survive React re-renders
      document.body.appendChild(cloneEl);

      // Update bounds when leaf resizes (stable element)
      resizeObserver = new ResizeObserver(updateBounds);
      resizeObserver.observe(workspaceLeaf);
    } else {
      document.body.appendChild(cloneEl);
    }
  } else {
    document.body.appendChild(cloneEl);
  }

  viewerClones.set(embedEl, cloneEl);

  // Watch for Obsidian modals opening (command palette, settings, etc.)
  const modalObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (
          node instanceof HTMLElement &&
          node.matches(".modal-container, .prompt")
        ) {
          if (isFullscreen) {
            closeImageViewer(cloneEl, viewerCleanupFns, viewerClones);
          } else {
            cloneEl.style.zIndex = "0";
          }
          return;
        }
      }
    }
  });
  modalObserver.observe(document.body, { childList: true });

  // Only setup pinch/gesture zoom if not disabled
  const isPinchZoomDisabled = document.body.classList.contains(
    "dynamic-views-zoom-disabled",
  );

  // Wrap gesture setup in try-catch to prevent orphaned clone on error
  try {
    if (!isPinchZoomDisabled) {
      const gestureCleanup = setupImageViewerGestures(imgEl, cloneEl, isMobile);

      // On mobile, disable all touch gestures (sidebar swipes + pull-down) while panning
      // Desktop uses simpler cleanup since swipe interception not needed
      if (isMobile) {
        const swipeController = new AbortController();
        setupSwipeInterception(cloneEl, swipeController.signal, true);
        viewerCleanupFns.set(cloneEl, () => {
          gestureCleanup();
          swipeController.abort();
        });
      } else {
        viewerCleanupFns.set(cloneEl, gestureCleanup);
      }
    } else {
      // When panzoom disabled, still allow clicking image to close
      const onImageClick = (e: MouseEvent) => {
        e.stopPropagation();
        closeImageViewer(cloneEl, viewerCleanupFns, viewerClones);
      };
      // Prevent context menu when panzoom disabled
      const onContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
      };
      imgEl.addEventListener("click", onImageClick);
      imgEl.addEventListener("contextmenu", onContextMenu);
      viewerCleanupFns.set(cloneEl, () => {
        imgEl.removeEventListener("click", onImageClick);
        imgEl.removeEventListener("contextmenu", onContextMenu);
      });
    }
  } catch (error) {
    console.error("Failed to setup image viewer", error);
    modalObserver.disconnect();
    cloneEl.remove();
    viewerClones.delete(embedEl);
    return;
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
      }, 50);
    }
  };

  if (isMobile) {
    cloneEl.addEventListener("touchstart", onTouchStart, { passive: true });
    cloneEl.addEventListener("touchend", onTouchEnd, { passive: true });
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
    if (isMobile && gestureInProgress) {
      return;
    }
    if (e.target === cloneEl) {
      closeImageViewer(cloneEl, viewerCleanupFns, viewerClones);
    }
  };

  // Document-level click closes viewer only if close-on-click enabled (desktop only)
  const onClickOutside = (e: Event) => {
    if (isOpening) return;
    if (
      isMobile ||
      !document.body.classList.contains(
        "dynamic-views-image-viewer-close-on-click",
      )
    ) {
      return;
    }
    const target = e.target as HTMLElement;
    if (target !== imgEl && target !== cloneEl) {
      closeImageViewer(cloneEl, viewerCleanupFns, viewerClones);
    }
  };

  const onEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      closeImageViewer(cloneEl, viewerCleanupFns, viewerClones);
    }
  };

  // Add all listeners synchronously (isOpening flag prevents immediate trigger)
  document.addEventListener("keydown", onEscape);
  cloneEl.addEventListener("click", onOverlayClick);
  document.addEventListener("click", onClickOutside);

  // Cleanup always removes all listeners (removeEventListener is no-op if never added)
  // Call existing cleanup first to prevent leak if map entry is overwritten
  viewerListenerCleanups.get(cloneEl)?.();
  viewerListenerCleanups.set(cloneEl, () => {
    document.removeEventListener("keydown", onEscape);
    cloneEl.removeEventListener("click", onOverlayClick);
    document.removeEventListener("click", onClickOutside);
    if (isMobile) {
      cloneEl.removeEventListener("touchstart", onTouchStart);
      cloneEl.removeEventListener("touchend", onTouchEnd);
    }
    // Clear pending gesture timeout to prevent dangling callbacks
    if (gestureTimeoutId !== null) {
      clearTimeout(gestureTimeoutId);
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
    }
    modalObserver.disconnect();
  });
}
