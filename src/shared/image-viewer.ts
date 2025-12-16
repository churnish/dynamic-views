/**
 * Shared image viewer handler - eliminates code duplication across card renderers
 */

import type { App } from "obsidian";
import { setupSwipeInterception } from "../bases/swipe-interceptor";
import { setupImageViewerGestures } from "./image-viewer-gestures";

// Store cleanup functions for event listeners (Map for explicit lifecycle control)
const viewerListenerCleanups = new Map<HTMLElement, () => void>();

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
    // Use workspace-leaf-content (stable across React re-renders) as observer target
    const workspaceLeaf = embedEl.closest(".workspace-leaf-content");
    if (workspaceLeaf) {
      // Cache viewContainer, re-query only if detached (React re-rendered)
      let viewContainer: Element | null =
        workspaceLeaf.querySelector(".view-content");

      const updateBounds = () => {
        // Re-query if cached element was detached (React re-rendered)
        if (viewContainer && !viewContainer.isConnected) {
          viewContainer = workspaceLeaf.querySelector(".view-content");
        }
        if (viewContainer) {
          const rect = viewContainer.getBoundingClientRect();
          cloneEl.style.top = `${rect.top}px`;
          cloneEl.style.left = `${rect.left}px`;
          cloneEl.style.width = `${rect.width}px`;
          cloneEl.style.height = `${rect.height}px`;
        }
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
    modalObserver.disconnect();
    cloneEl.remove();
    viewerClones.delete(embedEl);
    return;
  }

  // Track multi-touch gesture state to prevent pinch from triggering close
  let gestureInProgress = false;
  let gestureTimeoutId: ReturnType<typeof setTimeout> | null = null;
  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length > 1) {
      gestureInProgress = true;
      // Clear any pending reset since gesture is active
      if (gestureTimeoutId !== null) {
        clearTimeout(gestureTimeoutId);
        gestureTimeoutId = null;
      }
    }
  };
  const onTouchEnd = (e: TouchEvent) => {
    // Only clear gesture flag when all fingers lifted
    if (e.touches.length === 0) {
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
