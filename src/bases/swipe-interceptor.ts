/**
 * Touch interception for image viewer panzoom on mobile
 * Blocks all touch propagation so panzoom gets exclusive control
 */

/**
 * Intercept all touch gestures on a container (for zoomed images)
 * Blocks touch propagation on non-IMG elements so panzoom handles pinch gestures
 */
export function setupTouchInterceptAll(
  container: HTMLElement,
  signal: AbortSignal,
): void {
  container.addEventListener(
    "touchmove",
    (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const target = e.target as HTMLElement;
      if (target.tagName !== "IMG") {
        e.stopPropagation();
      }
    },
    { passive: false, signal },
  );
}
