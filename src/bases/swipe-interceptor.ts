/**
 * Touch swipe interceptor for mobile
 * Prevents Obsidian sidebar gestures from triggering when interacting with Bases views
 */

/** Minimum horizontal movement to consider it a horizontal swipe */
const HORIZONTAL_THRESHOLD = 10;

/**
 * Setup touch event interception for a container
 * Intercepts horizontal swipes to prevent sidebar gestures
 *
 * @param container - The container element to intercept swipes on
 * @param signal - AbortSignal for cleanup
 * @param interceptAll - If true, intercept all touch gestures (horizontal + vertical)
 */
export function setupSwipeInterception(
  container: HTMLElement,
  signal: AbortSignal,
  interceptAll = false,
): void {
  let touchStartX = 0;
  let touchStartY = 0;

  const handleTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;

    if (interceptAll) {
      // Intercept all touch gestures (for zoomed images)
      // But don't block touch on images - let panzoom handle pinch gestures
      const target = e.target as HTMLElement;
      if (target.tagName !== "IMG") {
        e.stopPropagation();
      }
      return;
    }

    const touch = e.touches[0];
    const deltaX = Math.abs(touch.clientX - touchStartX);
    const deltaY = Math.abs(touch.clientY - touchStartY);

    // Only intercept if horizontal movement dominates
    if (deltaX > HORIZONTAL_THRESHOLD && deltaX > deltaY) {
      e.stopPropagation();
    }
  };

  container.addEventListener("touchstart", handleTouchStart, {
    passive: true,
    signal,
  });
  container.addEventListener("touchmove", handleTouchMove, {
    passive: false,
    signal,
  });
}
