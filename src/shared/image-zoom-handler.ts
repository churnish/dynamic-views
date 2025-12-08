/**
 * Shared image zoom handler - eliminates code duplication across card renderers
 */

import type { App } from "obsidian";
import { TFile } from "obsidian";
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
  // Remove clone from DOM
  cloneEl.remove();

  // Remove from tracking map (find and delete the entry for this clone)
  for (const [original, clone] of zoomedClones) {
    if (clone === cloneEl) {
      zoomedClones.delete(original);
      break;
    }
  }

  // Cleanup zoom gestures
  const cleanup = zoomCleanupFns.get(cloneEl);
  if (cleanup) {
    cleanup();
    zoomCleanupFns.delete(cloneEl);
  }

  // Remove event listeners
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
  // Close other zoomed images (find all existing clones)
  for (const [, clone] of zoomedClones) {
    closeImageZoom(clone, zoomCleanupFns, zoomedClones);
  }

  // Clone the embed element for zooming (original stays on card)
  const cloneEl = embedEl.cloneNode(true) as HTMLElement;
  cloneEl.classList.add("is-zoomed");

  // Append clone to appropriate container
  const isConstrained = document.body.classList.contains(
    "dynamic-views-zoom-constrain-to-editor",
  );
  if (isConstrained) {
    const viewContainer = embedEl.closest(".workspace-leaf-content");
    if (viewContainer) {
      viewContainer.appendChild(cloneEl);
    } else {
      document.body.appendChild(cloneEl);
    }
  } else {
    document.body.appendChild(cloneEl);
  }

  // Track the clone
  zoomedClones.set(embedEl, cloneEl);

  // Setup zoom gestures on clone
  const imgEl = cloneEl.querySelector("img");
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
      cloneEl,
      app,
      file instanceof TFile ? file : undefined,
    );
    zoomCleanupFns.set(cloneEl, cleanup);
  }

  // Add listeners for closing
  // Clicks on img are stopped by panzoom's click handler, so any click reaching here should close
  const onClickOutside = (evt: Event) => {
    // Skip if persistent zoom is enabled
    if (document.body.classList.contains("dynamic-views-zoom-persist")) {
      return;
    }
    const target = evt.target as HTMLElement;
    // Close unless clicking directly on the image (shouldn't reach here due to stopPropagation, but safety check)
    if (target !== imgEl) {
      closeImageZoom(cloneEl, zoomCleanupFns, zoomedClones);
    }
  };

  const onEscape = (evt: KeyboardEvent) => {
    if (evt.key === "Escape") {
      closeImageZoom(cloneEl, zoomCleanupFns, zoomedClones);
    }
  };

  // Delay adding listeners to avoid immediate trigger
  setTimeout(() => {
    document.addEventListener("click", onClickOutside);
    document.addEventListener("keydown", onEscape);
  }, 0);

  // Store cleanup function for this zoom instance
  zoomListenerCleanups.set(cloneEl, () => {
    document.removeEventListener("click", onClickOutside);
    document.removeEventListener("keydown", onEscape);
  });
}
