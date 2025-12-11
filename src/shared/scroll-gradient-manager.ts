import { SCROLL_TOLERANCE } from "./constants";

/**
 * Creates a throttled version of a function
 * Uses requestAnimationFrame for smooth 60fps throttling
 */
function throttleRAF<T extends (...args: unknown[]) => void>(
  fn: T,
): (...args: Parameters<T>) => void {
  let scheduled = false;
  return (...args: Parameters<T>) => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      fn(...args);
      scheduled = false;
    });
  };
}

/**
 * Updates scroll gradient classes for a simple scrollable element
 * Used for elements that are both the scrolling container and gradient target
 *
 * @param element - The scrollable element that receives gradient classes
 */
export function updateElementScrollGradient(element: HTMLElement): void {
  const isScrollable = element.scrollWidth > element.clientWidth;

  if (!isScrollable) {
    element.removeClass("scroll-gradient-left");
    element.removeClass("scroll-gradient-right");
    element.removeClass("scroll-gradient-both");
    return;
  }

  const scrollLeft = element.scrollLeft;
  const scrollWidth = element.scrollWidth;
  const clientWidth = element.clientWidth;
  const atStart = scrollLeft <= SCROLL_TOLERANCE;
  const atEnd = scrollLeft + clientWidth >= scrollWidth - SCROLL_TOLERANCE;

  element.removeClass("scroll-gradient-left");
  element.removeClass("scroll-gradient-right");
  element.removeClass("scroll-gradient-both");

  if (atStart && !atEnd) {
    element.addClass("scroll-gradient-right");
  } else if (atEnd && !atStart) {
    element.addClass("scroll-gradient-left");
  } else if (!atStart && !atEnd) {
    element.addClass("scroll-gradient-both");
  }
}

/**
 * Updates scroll gradient classes based on scroll position
 * Adds visual indicators when content extends beyond visible area
 *
 * @param element - The property field element (parent container)
 */
export function updateScrollGradient(element: HTMLElement): void {
  // With wrapper structure: wrapper always scrolls and receives gradients
  const wrapper = element.querySelector(
    ".property-content-wrapper",
  ) as HTMLElement;
  const content = element.querySelector(".property-content") as HTMLElement;

  if (!wrapper || !content) {
    return;
  }

  // Check if content exceeds wrapper space
  const isScrollable = content.scrollWidth > wrapper.clientWidth;

  if (!isScrollable) {
    wrapper.removeClass("scroll-gradient-left");
    wrapper.removeClass("scroll-gradient-right");
    wrapper.removeClass("scroll-gradient-both");
    element.removeClass("is-scrollable");
    return;
  }

  // Mark field as scrollable for conditional alignment
  element.addClass("is-scrollable");

  // Use shared logic for gradient updates
  updateElementScrollGradient(wrapper);
}

/**
 * Sets up scroll gradient for a single element (title/subtitle)
 * Attaches throttled scroll listener with optional cleanup via AbortSignal
 *
 * @param element - The scrollable element
 * @param signal - Optional AbortSignal for listener cleanup
 */
export function setupElementScrollGradient(
  element: HTMLElement,
  signal?: AbortSignal,
): void {
  // Initial gradient update
  requestAnimationFrame(() => {
    updateElementScrollGradient(element);
  });

  // Throttled scroll handler
  const throttledUpdate = throttleRAF(() => {
    updateElementScrollGradient(element);
  });

  element.addEventListener("scroll", throttledUpdate, { signal });
}

/**
 * Sets up scroll gradients for all property fields in a container
 * Attaches scroll listeners for user interaction
 * Note: ResizeObserver not needed - card-level observer triggers gradient updates via measurement
 *
 * @param container - The container element with property fields
 * @param updateGradientFn - Function to call for gradient updates (bound to view instance)
 * @param signal - Optional AbortSignal for listener cleanup
 */
export function setupScrollGradients(
  container: HTMLElement,
  updateGradientFn: (element: HTMLElement) => void,
  signal?: AbortSignal,
): void {
  // Find all property field containers (both side-by-side and full-width)
  const scrollables = container.querySelectorAll(".property-field");

  // Throttle the update function
  const throttledUpdate = throttleRAF(updateGradientFn);

  scrollables.forEach((el) => {
    const element = el as HTMLElement;
    const wrapper = element.querySelector(
      ".property-content-wrapper",
    ) as HTMLElement;

    if (!wrapper) return;

    // Initial gradient update after layout settles (double rAF for CSS to fully apply)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        updateGradientFn(element);
      });
    });

    // Attach scroll listener to wrapper for user scroll interaction
    wrapper.addEventListener(
      "scroll",
      () => {
        throttledUpdate(element);
      },
      { signal },
    );
  });
}
