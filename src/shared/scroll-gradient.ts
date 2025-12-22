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
  const scrollWidth = element.scrollWidth;
  const clientWidth = element.clientWidth;
  const isScrollable = scrollWidth > clientWidth;

  // Determine target class (null if not scrollable)
  let targetClass: string | null = null;
  if (isScrollable) {
    const scrollLeft = element.scrollLeft;
    const atStart = scrollLeft <= SCROLL_TOLERANCE;
    const atEnd = scrollLeft + clientWidth >= scrollWidth - SCROLL_TOLERANCE;

    targetClass =
      atStart && !atEnd
        ? "scroll-gradient-right"
        : atEnd && !atStart
          ? "scroll-gradient-left"
          : !atStart && !atEnd
            ? "scroll-gradient-both"
            : null;
  }

  // Only modify classes if state changed (minimizes DOM mutations)
  const classes = [
    "scroll-gradient-left",
    "scroll-gradient-right",
    "scroll-gradient-both",
  ];
  for (const cls of classes) {
    const hasClass = element.classList.contains(cls);
    if (cls === targetClass && !hasClass) {
      element.addClass(cls);
    } else if (cls !== targetClass && hasClass) {
      element.removeClass(cls);
    }
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

  // Skip if element not visible/measured - don't clear existing gradients with invalid data
  if (wrapper.clientWidth === 0) {
    return;
  }

  // Check if content exceeds wrapper space
  const isScrollable = content.scrollWidth > wrapper.clientWidth;

  if (!isScrollable) {
    // Only remove classes if they exist (minimizes DOM mutations)
    if (wrapper.classList.contains("scroll-gradient-left"))
      wrapper.removeClass("scroll-gradient-left");
    if (wrapper.classList.contains("scroll-gradient-right"))
      wrapper.removeClass("scroll-gradient-right");
    if (wrapper.classList.contains("scroll-gradient-both"))
      wrapper.removeClass("scroll-gradient-both");
    if (element.classList.contains("is-scrollable"))
      element.removeClass("is-scrollable");
    return;
  }

  // Mark field as scrollable for conditional alignment
  if (!element.classList.contains("is-scrollable")) {
    element.addClass("is-scrollable");
  }

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

  scrollables.forEach((el) => {
    const element = el as HTMLElement;
    const wrapper = element.querySelector(
      ".property-content-wrapper",
    ) as HTMLElement;

    if (!wrapper) return;

    // If layout is ready (width > 0), apply gradients sync to avoid flicker.
    // Otherwise use double-RAF to wait for layout to settle.
    if (wrapper.clientWidth > 0) {
      updateGradientFn(element);
    } else {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          updateGradientFn(element);
        });
      });
    }

    // Create per-element throttle to avoid lost updates when multiple fields scroll
    const throttledUpdate = throttleRAF(() => updateGradientFn(element));

    // Attach scroll listener to wrapper for user scroll interaction
    wrapper.addEventListener("scroll", throttledUpdate, { signal });
  });
}
