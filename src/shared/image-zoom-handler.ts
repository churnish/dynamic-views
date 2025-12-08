/**
 * Shared image zoom handler - eliminates code duplication across card renderers
 */

import type { App } from "obsidian";
import { setupSwipeInterception } from "../bases/swipe-interceptor";
import { setupImageZoomGestures } from "./image-zoom-gestures";

// Store cleanup functions for event listeners to prevent memory leaks
const zoomListenerCleanups = new WeakMap<HTMLElement, () => void>();

/**
 * Closes zoomed image clone and removes it from DOM
 */
function closeImageZoom(
  cloneEl: HTMLElement,
  zoomCleanupFns: Map<HTMLElement, () => void>,
  zoomedClones: Map<HTMLElement, HTMLElement>,
): void {
  cloneEl.remove();

  for (const [original, clone] of zoomedClones) {
    if (clone === cloneEl) {
      zoomedClones.delete(original);
      break;
    }
  }

  const cleanup = zoomCleanupFns.get(cloneEl);
  if (cleanup) {
    cleanup();
    zoomCleanupFns.delete(cloneEl);
  }

  const removeListeners = zoomListenerCleanups.get(cloneEl);
  if (removeListeners) {
    removeListeners();
    zoomListenerCleanups.delete(cloneEl);
  }
}

/**
 * Handles image zoom click events
 * @param e - Mouse event
 * @param cardPath - Path to the card's file
 * @param app - Obsidian app instance
 * @param zoomCleanupFns - Map storing cleanup functions
 * @param zoomedClones - Map storing original → clone element mappings
 */
export function handleImageZoomClick(
  e: MouseEvent,
  cardPath: string,
  app: App,
  zoomCleanupFns: Map<HTMLElement, () => void>,
  zoomedClones: Map<HTMLElement, HTMLElement>,
): void {
  const isZoomDisabled = document.body.classList.contains(
    "dynamic-views-image-zoom-disabled",
  );
  if (isZoomDisabled) return;

  e.stopPropagation();
  const embedEl = e.currentTarget as HTMLElement;

  // Check if this element already has a zoomed clone
  const existingClone = zoomedClones.get(embedEl);
  if (existingClone) {
    closeImageZoom(existingClone, zoomCleanupFns, zoomedClones);
  } else {
    openImageZoom(embedEl, cardPath, app, zoomCleanupFns, zoomedClones);
  }
}

/**
 * Opens image zoom with gesture support and close handlers
 */
function openImageZoom(
  embedEl: HTMLElement,
  cardPath: string,
  app: App,
  zoomCleanupFns: Map<HTMLElement, () => void>,
  zoomedClones: Map<HTMLElement, HTMLElement>,
): void {
  // Validate embed has an image before proceeding
  const sourceImg = embedEl.querySelector("img");
  if (!sourceImg) {
    console.warn("Dynamic Views: Cannot zoom - no img element found");
    return;
  }

  // Close other zoomed images (find all existing clones)
  for (const [, clone] of zoomedClones) {
    closeImageZoom(clone, zoomCleanupFns, zoomedClones);
  }

  // Clone the embed element for zooming (original stays on card)
  const cloneEl = embedEl.cloneNode(true) as HTMLElement;
  cloneEl.classList.add("is-zoomed");
  const imgEl = cloneEl.querySelector("img") as HTMLImageElement;

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

  zoomedClones.set(embedEl, cloneEl);

  // Only setup pinch/gesture zoom if not disabled
  const isPinchZoomDisabled = document.body.classList.contains(
    "dynamic-views-zoom-disabled",
  );
  if (!isPinchZoomDisabled) {
    const gestureCleanup = setupImageZoomGestures(imgEl, cloneEl, app);

    // On mobile, disable all touch gestures (sidebar swipes + pull-down) while panning
    if (app.isMobile) {
      const swipeController = new AbortController();
      setupSwipeInterception(cloneEl, swipeController.signal, true);
      zoomCleanupFns.set(cloneEl, () => {
        gestureCleanup();
        swipeController.abort();
      });
    } else {
      zoomCleanupFns.set(cloneEl, gestureCleanup);
    }
  } else {
    // When panzoom disabled, still allow clicking image to close
    const onImageClick = (e: MouseEvent) => {
      e.stopPropagation();
      closeImageZoom(cloneEl, zoomCleanupFns, zoomedClones);
    };
    // Prevent context menu when panzoom disabled
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    imgEl.addEventListener("click", onImageClick);
    imgEl.addEventListener("contextmenu", onContextMenu);
    zoomCleanupFns.set(cloneEl, () => {
      imgEl.removeEventListener("click", onImageClick);
      imgEl.removeEventListener("contextmenu", onContextMenu);
    });
  }

  // Click on overlay (cloneEl background, not image) closes zoom
  const onOverlayClick = (e: MouseEvent) => {
    if (e.target === cloneEl) {
      closeImageZoom(cloneEl, zoomCleanupFns, zoomedClones);
    }
  };

  // Document-level click closes zoom only if close-on-click enabled
  const onClickOutside = (e: Event) => {
    if (
      !document.body.classList.contains("dynamic-views-zoom-close-on-click")
    ) {
      return;
    }
    const target = e.target as HTMLElement;
    if (target !== imgEl && target !== cloneEl) {
      closeImageZoom(cloneEl, zoomCleanupFns, zoomedClones);
    }
  };

  const onEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      closeImageZoom(cloneEl, zoomCleanupFns, zoomedClones);
    }
  };

  // Add escape listener immediately (always want Escape to work)
  document.addEventListener("keydown", onEscape);

  // Delay click listeners to avoid immediate trigger from opening click
  // Use requestAnimationFrame for more reliable timing than setTimeout
  let clickListenersAdded = false;
  requestAnimationFrame(() => {
    // Only add if clone still in DOM (not already closed)
    if (cloneEl.isConnected) {
      cloneEl.addEventListener("click", onOverlayClick);
      document.addEventListener("click", onClickOutside);
      clickListenersAdded = true;
    }
  });

  zoomListenerCleanups.set(cloneEl, () => {
    document.removeEventListener("keydown", onEscape);
    if (clickListenersAdded) {
      cloneEl.removeEventListener("click", onOverlayClick);
      document.removeEventListener("click", onClickOutside);
    }
  });
}
