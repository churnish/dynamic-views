import { SCROLL_TOLERANCE } from "./constants";

/** Gradient class names */
const GRADIENT_CLASSES = [
  "scroll-gradient-left",
  "scroll-gradient-right",
  "scroll-gradient-both",
] as const;

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
 * Determines the appropriate gradient class based on scroll position
 * Returns null if no gradient needed (not scrollable or at both ends)
 */
function getGradientClass(
  scrollLeft: number,
  scrollWidth: number,
  clientWidth: number,
): string | null {
  const atStart = scrollLeft <= SCROLL_TOLERANCE;
  const atEnd = scrollLeft + clientWidth >= scrollWidth - SCROLL_TOLERANCE;

  if (atStart && !atEnd) return "scroll-gradient-right";
  if (atEnd && !atStart) return "scroll-gradient-left";
  if (!atStart && !atEnd) return "scroll-gradient-both";
  return null;
}

/**
 * Sets the appropriate gradient class on an element, removing others
 * Uses classList.toggle(class, force) which handles no-ops efficiently
 */
function setGradientClasses(
  element: HTMLElement,
  targetClass: string | null,
): void {
  for (const cls of GRADIENT_CLASSES) {
    element.classList.toggle(cls, cls === targetClass);
  }
}

/**
 * Updates scroll gradient classes for a simple scrollable element
 * Used for elements that are both the scrolling container and gradient target
 *
 * @param element - The scrollable element that receives gradient classes
 */
export function updateElementScrollGradient(element: HTMLElement): void {
  // Guard: skip if element disconnected or not measured
  if (!element.isConnected || element.clientWidth === 0) {
    return;
  }

  const isScrollable = element.scrollWidth > element.clientWidth;
  const targetClass = isScrollable
    ? getGradientClass(
        element.scrollLeft,
        element.scrollWidth,
        element.clientWidth,
      )
    : null;

  setGradientClasses(element, targetClass);
}

/**
 * Updates scroll gradient classes based on scroll position
 * Adds visual indicators when content extends beyond visible area
 *
 * @param element - The property field element (parent container)
 */
export function updateScrollGradient(element: HTMLElement): void {
  // Guard: skip if element disconnected
  if (!element.isConnected) {
    return;
  }

  // With wrapper structure: wrapper always scrolls and receives gradients
  const wrapper = element.querySelector(
    ".property-content-wrapper",
  ) as HTMLElement;
  const content = element.querySelector(".property-content") as HTMLElement;

  if (!wrapper || !content) {
    return;
  }

  // Skip if elements not visible/measured - don't clear existing gradients with invalid data
  if (wrapper.clientWidth === 0 || content.clientWidth === 0) {
    return;
  }

  // Check if content exceeds wrapper space
  const isScrollable = content.scrollWidth > wrapper.clientWidth;

  if (!isScrollable) {
    setGradientClasses(wrapper, null);
    if (element.classList.contains("is-scrollable")) {
      element.removeClass("is-scrollable");
    }
    return;
  }

  // Mark field as scrollable for conditional alignment
  if (!element.classList.contains("is-scrollable")) {
    element.addClass("is-scrollable");
  }

  // Calculate and apply gradient class
  const targetClass = getGradientClass(
    wrapper.scrollLeft,
    wrapper.scrollWidth,
    wrapper.clientWidth,
  );
  setGradientClasses(wrapper, targetClass);
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

    // Skip initial gradient update for side-by-side fields that haven't been measured -
    // they'll be handled by measureSideBySideRow after width calculation
    const row = element.closest(".property-row");
    const isSideBySide = row?.classList.contains("property-row-sidebyside");
    const isMeasured = row?.classList.contains("property-measured");
    const skipInitialUpdate = isSideBySide && !isMeasured;

    // If layout is ready (width > 0), apply gradients sync to avoid flicker.
    // Otherwise use double-RAF to wait for layout to settle.
    if (!skipInitialUpdate) {
      if (wrapper.clientWidth > 0) {
        updateGradientFn(element);
      } else {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            updateGradientFn(element);
          });
        });
      }
    }

    // Create per-element throttle to avoid lost updates when multiple fields scroll
    const throttledUpdate = throttleRAF(() => updateGradientFn(element));

    // Attach scroll listener to wrapper for user scroll interaction
    wrapper.addEventListener("scroll", throttledUpdate, { signal });
  });
}
