import { SCROLL_TOLERANCE } from "./constants";

/** Gradient class names */
const GRADIENT_CLASSES = [
  "scroll-gradient-left",
  "scroll-gradient-right",
  "scroll-gradient-both",
] as const;

/** Cache for wrapper/content element refs (auto-cleans via WeakMap) */
const wrapperCache = new WeakMap<HTMLElement, HTMLElement | null>();
const contentCache = new WeakMap<HTMLElement, HTMLElement | null>();

/** Cache for current gradient class to skip no-op updates */
const gradientClassCache = new WeakMap<HTMLElement, string | null>();

/** Cache for throttled update functions per element */
const throttleCache = new WeakMap<HTMLElement, () => void>();

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
 * Skips update if class unchanged (cached)
 */
function setGradientClasses(
  element: HTMLElement,
  targetClass: string | null,
): void {
  // Skip if class unchanged
  const currentClass = gradientClassCache.get(element);
  if (currentClass === targetClass) return;

  gradientClassCache.set(element, targetClass);
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

  // Get cached refs or query once and cache
  let wrapper = wrapperCache.get(element);
  let content = contentCache.get(element);

  if (wrapper === undefined) {
    wrapper = element.querySelector<HTMLElement>(".property-content-wrapper");
    wrapperCache.set(element, wrapper);
  }
  if (content === undefined) {
    content = element.querySelector<HTMLElement>(".property-content");
    contentCache.set(element, content);
  }

  if (!wrapper || !content) {
    return;
  }

  // Read dimensions once
  const wrapperWidth = wrapper.clientWidth;
  const contentScrollWidth = content.scrollWidth;

  // Skip if elements not visible/measured - don't clear existing gradients with invalid data
  if (wrapperWidth === 0 || content.clientWidth === 0) {
    return;
  }

  // Check if content exceeds wrapper space
  const isScrollable = contentScrollWidth > wrapperWidth;

  if (!isScrollable) {
    setGradientClasses(wrapper, null);
    element.classList.remove("is-scrollable");
    return;
  }

  // Mark field as scrollable for conditional alignment
  element.classList.add("is-scrollable");

  // Calculate and apply gradient class (reuse wrapperWidth)
  const targetClass = getGradientClass(
    wrapper.scrollLeft,
    wrapper.scrollWidth,
    wrapperWidth,
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
 * Gets or creates a throttled update function for an element
 * Reuses existing throttle instances to avoid creating 1400+ closures
 */
function getThrottledUpdate(
  element: HTMLElement,
  updateGradientFn: (element: HTMLElement) => void,
): () => void {
  let throttled = throttleCache.get(element);
  if (!throttled) {
    throttled = throttleRAF(() => updateGradientFn(element));
    throttleCache.set(element, throttled);
  }
  return throttled;
}

/**
 * Sets up scroll listeners for all property fields in a container.
 * Does NOT apply initial gradients - call initializeScrollGradients after render.
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

    // Get cached wrapper or query and cache
    let wrapper = wrapperCache.get(element);
    if (wrapper === undefined) {
      wrapper = element.querySelector<HTMLElement>(".property-content-wrapper");
      wrapperCache.set(element, wrapper);
    }

    if (!wrapper) return;

    // Get or create throttled update (reuses existing instance)
    const throttledUpdate = getThrottledUpdate(element, updateGradientFn);

    // Attach scroll listener to wrapper for user scroll interaction
    wrapper.addEventListener("scroll", throttledUpdate, { signal });
  });
}

/**
 * Batch-initialize scroll gradients for all property fields in a container.
 * Uses read-then-write pattern to avoid layout thrashing:
 * - Phase 1: Read all dimensions (forces ONE layout recalc)
 * - Phase 2: Apply all classes (no layout reads)
 *
 * Call this AFTER all cards are rendered to apply initial gradients efficiently.
 *
 * @param container - The container element with property fields
 */
export function initializeScrollGradients(container: HTMLElement): void {
  const fields = container.querySelectorAll<HTMLElement>(".property-field");

  // Phase 1: Read all dimensions (single forced layout)
  const measurements: Array<{
    field: HTMLElement;
    wrapper: HTMLElement;
    isScrollable: boolean;
    targetClass: string | null;
  }> = [];

  fields.forEach((field) => {
    // Skip side-by-side fields that haven't been measured yet
    // (unless in compact mode where measurement isn't needed)
    const row = field.closest(".property-set");
    const isSideBySide = row?.classList.contains("property-set-sidebyside");
    const isMeasured = row?.classList.contains("property-measured");
    const isCompact = field
      .closest(".card")
      ?.classList.contains("compact-mode");
    if (isSideBySide && !isMeasured && !isCompact) return;

    // Get cached refs or query and cache
    let wrapper = wrapperCache.get(field);
    let content = contentCache.get(field);

    if (wrapper === undefined) {
      wrapper = field.querySelector<HTMLElement>(".property-content-wrapper");
      wrapperCache.set(field, wrapper);
    }
    if (content === undefined) {
      content = field.querySelector<HTMLElement>(".property-content");
      contentCache.set(field, content);
    }

    if (!wrapper || !content) return;

    // Read dimensions
    const wrapperWidth = wrapper.clientWidth;
    const contentScrollWidth = content.scrollWidth;

    // Skip unmeasured elements
    if (wrapperWidth === 0 || content.clientWidth === 0) return;

    const isScrollable = contentScrollWidth > wrapperWidth;
    const targetClass = isScrollable
      ? getGradientClass(wrapper.scrollLeft, wrapper.scrollWidth, wrapperWidth)
      : null;

    measurements.push({ field, wrapper, isScrollable, targetClass });
  });

  // Phase 2: Apply all classes (no layout reads)
  for (const { field, wrapper, isScrollable, targetClass } of measurements) {
    if (isScrollable) {
      field.classList.add("is-scrollable");
    } else {
      field.classList.remove("is-scrollable");
    }
    setGradientClasses(wrapper, targetClass);
  }
}
