/**
 * Image zoom/pan gestures using panzoom library
 */

import Panzoom, { PanzoomObject } from "@panzoom/panzoom";
import { App } from "obsidian";
import { getZoomSensitivity } from "../utils/style-settings";

/**
 * Setup zoom and pan gestures for an enlarged image
 * @param imgEl - The image element
 * @param container - The container element (overlay or embed)
 * @param app - Obsidian app instance (optional, for mobile detection)
 * @returns Cleanup function
 */
export function setupImageZoomGestures(
  imgEl: HTMLImageElement,
  container: HTMLElement,
  app?: App,
): () => void {
  let panzoomInstance: PanzoomObject | null = null;
  let clickHandler: ((e: MouseEvent) => void) | null = null;
  let dblclickHandler: ((e: MouseEvent) => void) | null = null;
  let contextmenuHandler: ((e: MouseEvent) => void) | null = null;
  let loadHandler: (() => void) | null = null;

  function attachPanzoom(): void {
    const zoomSensitivity = getZoomSensitivity();

    // Mobile-specific behavior: fit to viewport width while showing full height
    const isMobile = app?.isMobile ?? false;
    let startScale = 1;
    let minScale = 0.1;

    if (isMobile) {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const naturalWidth = imgEl.naturalWidth;
      const naturalHeight = imgEl.naturalHeight;

      // Calculate scale to fit viewport width OR maintain full height, whichever is smaller
      const widthScale = viewportWidth / naturalWidth;
      const heightScale = viewportHeight / naturalHeight;

      // Use smaller of: 1 (original size), width scale, or height scale
      startScale = Math.min(1, widthScale, heightScale);

      // Prevent zooming out beyond initial size
      minScale = startScale;
    }

    panzoomInstance = Panzoom(imgEl, {
      maxScale: 4,
      minScale,
      startScale,
      step: isMobile ? zoomSensitivity * 2 : zoomSensitivity,
      canvas: false,
      cursor: "move",
    });

    // Enable wheel zoom on container
    container.addEventListener("wheel", panzoomInstance.zoomWithWheel, {
      passive: false,
    });

    // Prevent clicks on image from bubbling to close handlers
    clickHandler = (e: MouseEvent) => {
      e.stopPropagation();
    };
    imgEl.addEventListener("click", clickHandler);

    // Double-click to reset to original position
    dblclickHandler = (e: MouseEvent) => {
      e.stopPropagation();
      panzoomInstance?.reset();
    };
    imgEl.addEventListener("dblclick", dblclickHandler);

    // Right-click resets to initial size
    contextmenuHandler = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      panzoomInstance?.reset();
    };
    imgEl.addEventListener("contextmenu", contextmenuHandler);
  }

  // Check if image already loaded
  if (imgEl.complete && imgEl.naturalWidth > 0) {
    attachPanzoom();
  } else {
    loadHandler = () => {
      attachPanzoom();
    };
    imgEl.addEventListener("load", loadHandler, { once: true });
  }

  // Return cleanup function
  return () => {
    if (panzoomInstance) {
      container.removeEventListener("wheel", panzoomInstance.zoomWithWheel, {
        passive: false,
      } as EventListenerOptions);
      panzoomInstance.destroy();
    }
    if (clickHandler) {
      imgEl.removeEventListener("click", clickHandler);
    }
    if (dblclickHandler) {
      imgEl.removeEventListener("dblclick", dblclickHandler);
    }
    if (contextmenuHandler) {
      imgEl.removeEventListener("contextmenu", contextmenuHandler);
    }
    if (loadHandler) {
      imgEl.removeEventListener("load", loadHandler);
    }
  };
}
