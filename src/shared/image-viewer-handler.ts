/**
 * Shared image viewer handler - eliminates code duplication across card renderers
 */

import type { App } from "obsidian";
import { setupSwipeInterception } from "../bases/swipe-interceptor";
import { setupImageViewerGestures } from "./image-viewer-gestures";

// Store cleanup functions for event listeners to prevent memory leaks
const viewerListenerCleanups = new WeakMap<HTMLElement, () => void>();

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
 */
export function handleImageViewerClick(
  e: MouseEvent,
  cardPath: string,
  app: App,
  viewerCleanupFns: Map<HTMLElement, () => void>,
  viewerClones: Map<HTMLElement, HTMLElement>,
): void {
  const isViewerDisabled = document.body.classList.contains(
    "dynamic-views-image-zoom-disabled",
  );
  if (isViewerDisabled) return;

  e.stopPropagation();
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

  // Append clone to appropriate container (mobile always fullscreen)
  const isFullscreen =
    app.isMobile ||
    document.body.classList.contains("dynamic-views-zoom-fullscreen");
  if (!isFullscreen) {
    const viewContainer = embedEl.closest(".workspace-leaf-content");
    if (viewContainer) {
      viewContainer.appendChild(cloneEl);
    } else {
      document.body.appendChild(cloneEl);
    }
  } else {
    document.body.appendChild(cloneEl);
  }

  viewerClones.set(embedEl, cloneEl);

  // Only setup pinch/gesture zoom if not disabled
  const isPinchZoomDisabled = document.body.classList.contains(
    "dynamic-views-zoom-disabled",
  );

  // Wrap gesture setup in try-catch to prevent orphaned clone on error
  try {
    if (!isPinchZoomDisabled) {
      const gestureCleanup = setupImageViewerGestures(imgEl, cloneEl);

      // On mobile, disable all touch gestures (sidebar swipes + pull-down) while panning
      // Desktop uses simpler cleanup since swipe interception not needed
      if (app.isMobile) {
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
    cloneEl.remove();
    viewerClones.delete(embedEl);
    return;
  }

  // Track multi-touch gesture state to prevent pinch from triggering close
  let gestureInProgress = false;
  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length > 1) {
      gestureInProgress = true;
    }
  };
  const onTouchEnd = (e: TouchEvent) => {
    // Only clear gesture flag when all fingers lifted
    if (e.touches.length === 0) {
      // Short delay to ensure click event doesn't fire during gesture completion
      setTimeout(() => {
        gestureInProgress = false;
      }, 50);
    }
  };

  const isMobile = document.body.classList.contains("is-mobile");
  if (isMobile) {
    cloneEl.addEventListener("touchstart", onTouchStart, { passive: true });
    cloneEl.addEventListener("touchend", onTouchEnd, { passive: true });
  }

  // Click on overlay (cloneEl background, not image) closes viewer
  const onOverlayClick = (e: MouseEvent) => {
    // On mobile, ignore clicks during or immediately after gesture
    if (isMobile && gestureInProgress) {
      return;
    }
    if (e.target === cloneEl) {
      closeImageViewer(cloneEl, viewerCleanupFns, viewerClones);
    }
  };

  // Document-level click closes viewer only if close-on-click enabled
  const onClickOutside = (e: Event) => {
    if (
      !document.body.classList.contains("dynamic-views-zoom-close-on-click")
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

  // Add escape listener immediately (always want Escape to work)
  document.addEventListener("keydown", onEscape);

  // Delay click listeners to avoid immediate trigger from opening click
  // Use requestAnimationFrame for more reliable timing than setTimeout
  requestAnimationFrame(() => {
    // Only add if clone still in DOM (not already closed)
    if (cloneEl.isConnected) {
      cloneEl.addEventListener("click", onOverlayClick);
      document.addEventListener("click", onClickOutside);
    }
  });

  // Cleanup always removes all listeners (removeEventListener is no-op if never added)
  viewerListenerCleanups.set(cloneEl, () => {
    document.removeEventListener("keydown", onEscape);
    cloneEl.removeEventListener("click", onOverlayClick);
    document.removeEventListener("click", onClickOutside);
    if (isMobile) {
      cloneEl.removeEventListener("touchstart", onTouchStart);
      cloneEl.removeEventListener("touchend", onTouchEnd);
    }
  });
}
