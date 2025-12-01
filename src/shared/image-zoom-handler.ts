/**
 * Shared image zoom handler - eliminates code duplication across card renderers
 */

import type { App } from "obsidian";
import { TFile } from "obsidian";
import { setupImageZoomGestures } from "./image-zoom-gestures";

// Store cleanup functions for event listeners to prevent memory leaks
const zoomListenerCleanups = new WeakMap<HTMLElement, () => void>();

/**
 * Closes zoomed image and returns it to original position
 */
function closeImageZoom(
  embedEl: HTMLElement,
  zoomCleanupFns: Map<HTMLElement, () => void>,
  zoomedOriginalParents: Map<HTMLElement, HTMLElement>,
): void {
  embedEl.classList.remove("is-zoomed");

  // Return to original parent
  const originalParent = zoomedOriginalParents.get(embedEl);
  if (originalParent && embedEl.parentElement !== originalParent) {
    originalParent.appendChild(embedEl);
    zoomedOriginalParents.delete(embedEl);
  }

  // Cleanup zoom gestures
  const cleanup = zoomCleanupFns.get(embedEl);
  if (cleanup) {
    cleanup();
    zoomCleanupFns.delete(embedEl);
  }

  // Remove event listeners
  const removeListeners = zoomListenerCleanups.get(embedEl);
  if (removeListeners) {
    removeListeners();
    zoomListenerCleanups.delete(embedEl);
  }
}

/**
 * Handles image zoom click events
 * @param e - Mouse event
 * @param cardPath - Path to the card's file
 * @param app - Obsidian app instance
 * @param zoomCleanupFns - Map storing cleanup functions
 * @param zoomedOriginalParents - Map storing original parent elements
 */
export function handleImageZoomClick(
  e: MouseEvent,
  cardPath: string,
  app: App,
  zoomCleanupFns: Map<HTMLElement, () => void>,
  zoomedOriginalParents: Map<HTMLElement, HTMLElement>,
): void {
  const isZoomDisabled = document.body.classList.contains(
    "dynamic-views-image-zoom-disabled",
  );
  if (isZoomDisabled) return;

  e.stopPropagation();
  const embedEl = e.currentTarget as HTMLElement;
  const isZoomed = embedEl.classList.contains("is-zoomed");

  if (isZoomed) {
    closeImageZoom(embedEl, zoomCleanupFns, zoomedOriginalParents);
  } else {
    openImageZoom(
      embedEl,
      cardPath,
      app,
      zoomCleanupFns,
      zoomedOriginalParents,
    );
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
  zoomedOriginalParents: Map<HTMLElement, HTMLElement>,
): void {
  // Close other zoomed images in this view/tab only (not globally)
  const viewContainer = embedEl.closest(".workspace-leaf-content");
  if (viewContainer) {
    viewContainer.querySelectorAll(".image-embed.is-zoomed").forEach((el) => {
      closeImageZoom(el as HTMLElement, zoomCleanupFns, zoomedOriginalParents);
    });
  }

  // Store original parent and teleport to body (only if NOT constrained to tab)
  const isConstrained = document.body.classList.contains(
    "dynamic-views-zoom-constrain-to-editor",
  );
  const originalParent = embedEl.parentElement;
  if (originalParent && !isConstrained) {
    zoomedOriginalParents.set(embedEl, originalParent);
    document.body.appendChild(embedEl);
  }

  // Open this one
  embedEl.classList.add("is-zoomed");

  // Setup zoom gestures
  const imgEl = embedEl.querySelector("img");
  if (!imgEl) {
    console.warn("Dynamic Views: Zoom opened but no img element found");
    return;
  }

  const file = app.vault.getAbstractFileByPath(cardPath);

  // Only setup pinch/gesture zoom if not disabled
  const isPinchZoomDisabled = document.body.classList.contains(
    "dynamic-views-zoom-disabled",
  );
  if (!isPinchZoomDisabled) {
    const cleanup = setupImageZoomGestures(
      imgEl,
      embedEl,
      app,
      file instanceof TFile ? file : undefined,
    );
    zoomCleanupFns.set(embedEl, cleanup);
  }

  // Add listeners for closing
  const onClickOutside = (evt: Event) => {
    const target = evt.target as HTMLElement;
    if (!embedEl.contains(target)) {
      closeImageZoom(embedEl, zoomCleanupFns, zoomedOriginalParents);
    }
  };

  const onEscape = (evt: KeyboardEvent) => {
    if (evt.key === "Escape") {
      closeImageZoom(embedEl, zoomCleanupFns, zoomedOriginalParents);
    }
  };

  // Delay adding listeners to avoid immediate trigger
  setTimeout(() => {
    document.addEventListener("click", onClickOutside);
    document.addEventListener("keydown", onEscape);
  }, 0);

  // Store cleanup function for this zoom instance
  zoomListenerCleanups.set(embedEl, () => {
    document.removeEventListener("click", onClickOutside);
    document.removeEventListener("keydown", onEscape);
  });
}
