import { CONTENT_HIDDEN_CLASS } from "./content-visibility";
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

/** Vertical gradient class names */
const VERTICAL_GRADIENT_CLASSES = [
  "scroll-gradient-top",
  "scroll-gradient-bottom",
  "scroll-gradient-vertical-both",
] as const;

/** Separate cache for vertical gradient classes (element can have both horizontal + vertical) */
const verticalGradientClassCache = new WeakMap<HTMLElement, string | null>();

/**
 * Creates a throttled version of a function using requestAnimationFrame.
 * Limits execution to once per animation frame for smooth updates.
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

  // Get cached refs or query once and cache (only cache successful finds)
  let wrapper = wrapperCache.get(element);
  let content = contentCache.get(element);

  if (!wrapper) {
    wrapper = element.querySelector<HTMLElement>(".property-content-wrapper");
    if (wrapper) wrapperCache.set(element, wrapper);
  }
  if (!content) {
    content = element.querySelector<HTMLElement>(".property-content");
    if (content) contentCache.set(element, content);
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

  // Calculate and apply gradient class (use contentScrollWidth for consistency)
  const targetClass = getGradientClass(
    wrapper.scrollLeft,
    contentScrollWidth,
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
 * Creates a throttled update function for an element.
 * No caching - each call creates fresh closure to avoid stale function references.
 * Modern JS engines handle 1400+ closures efficiently.
 */
function createThrottledUpdate(
  element: HTMLElement,
  updateGradientFn: (element: HTMLElement) => void,
): () => void {
  return throttleRAF(() => updateGradientFn(element));
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
  // Find all property containers (both paired and unpaired)
  const scrollables = container.querySelectorAll(".property");

  scrollables.forEach((el) => {
    const element = el as HTMLElement;

    // Get cached wrapper or query and cache (only cache successful finds)
    let wrapper = wrapperCache.get(element);
    if (!wrapper) {
      wrapper = element.querySelector<HTMLElement>(".property-content-wrapper");
      if (wrapper) wrapperCache.set(element, wrapper);
    }

    if (!wrapper) return;

    // Create throttled update (fresh closure each call to avoid stale refs)
    const throttledUpdate = createThrottledUpdate(element, updateGradientFn);

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
/**
 * Core gradient initialization for a set of property fields.
 * Uses read-then-write pattern to avoid layout thrashing.
 */
function initializeGradientFields(
  fields: Iterable<HTMLElement>,
  isColumnMode: boolean,
): void {
  // Phase 1: Read all dimensions (single forced layout)
  const measurements: Array<{
    field: HTMLElement;
    wrapper: HTMLElement;
    isScrollable: boolean;
    targetClass: string | null;
  }> = [];

  for (const field of fields) {
    // Skip paired fields that haven't been measured yet
    // (unless in compact/column mode where JS measurement isn't needed)
    const pair = field.closest(".property-pair");
    const isPaired = !!pair;
    const isMeasured = pair?.classList.contains("property-measured") ?? false;
    const isCompact = field
      .closest(".card")
      ?.classList.contains("compact-mode");
    if (isPaired && !isMeasured && !isCompact && !isColumnMode) continue;

    // Get cached refs or query and cache (only cache successful finds)
    let wrapper = wrapperCache.get(field);
    let content = contentCache.get(field);

    if (!wrapper) {
      wrapper = field.querySelector<HTMLElement>(".property-content-wrapper");
      if (wrapper) wrapperCache.set(field, wrapper);
    }
    if (!content) {
      content = field.querySelector<HTMLElement>(".property-content");
      if (content) contentCache.set(field, content);
    }

    if (!wrapper || !content) continue;

    // Read dimensions
    const wrapperWidth = wrapper.clientWidth;
    const contentScrollWidth = content.scrollWidth;

    // Skip unmeasured elements
    if (wrapperWidth === 0 || content.clientWidth === 0) continue;

    const isScrollable = contentScrollWidth > wrapperWidth;
    const targetClass = isScrollable
      ? getGradientClass(wrapper.scrollLeft, contentScrollWidth, wrapperWidth)
      : null;

    measurements.push({ field, wrapper, isScrollable, targetClass });
  }

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

export function initializeScrollGradients(container: HTMLElement): void {
  const allFields = container.querySelectorAll<HTMLElement>(".property");

  // Column mode skips JS measurement (CSS handles 50% widths),
  // so paired fields never get "property-measured" — allow gradient init directly
  const isColumnMode =
    container
      .closest(".dynamic-views")
      ?.classList.contains("dynamic-views-paired-property-column") ?? false;

  // Skip fields in content-hidden cards (dimension reads trigger
  // Chromium "subtree hidden by content-visibility" warnings)
  const fields = Array.from(allFields).filter(
    (f) => !f.closest(".card")?.classList.contains(CONTENT_HIDDEN_CLASS),
  );

  initializeGradientFields(fields, isColumnMode);
}

/**
 * Card-scoped variant — initializes gradients for specific cards only.
 * Use in appendBatch to avoid re-scanning old hidden cards in the container.
 */
export function initializeScrollGradientsForCards(cards: HTMLElement[]): void {
  if (cards.length === 0) return;

  const isColumnMode =
    cards[0]
      .closest(".dynamic-views")
      ?.classList.contains("dynamic-views-paired-property-column") ?? false;

  const fields: HTMLElement[] = [];
  for (const card of cards) {
    fields.push(...card.querySelectorAll<HTMLElement>(".property"));
  }

  initializeGradientFields(fields, isColumnMode);
}

/**
 * Determines the vertical gradient class based on scroll position.
 * Returns null if not scrollable or scrolled to both ends.
 */
function getVerticalGradientClass(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): string | null {
  const atTop = scrollTop <= SCROLL_TOLERANCE;
  const atBottom = scrollTop + clientHeight >= scrollHeight - SCROLL_TOLERANCE;

  if (atTop && !atBottom) return "scroll-gradient-bottom";
  if (atBottom && !atTop) return "scroll-gradient-top";
  if (!atTop && !atBottom) return "scroll-gradient-vertical-both";
  return null;
}

/**
 * Sets the appropriate vertical gradient class on an element.
 * Uses a separate cache from horizontal gradients.
 */
function setVerticalGradientClasses(
  element: HTMLElement,
  targetClass: string | null,
): void {
  const currentClass = verticalGradientClassCache.get(element);
  if (currentClass === targetClass) return;

  verticalGradientClassCache.set(element, targetClass);
  for (const cls of VERTICAL_GRADIENT_CLASSES) {
    element.classList.toggle(cls, cls === targetClass);
  }
}

/**
 * Updates vertical scroll gradient classes for a scrollable element.
 */
function updateVerticalScrollGradient(element: HTMLElement): void {
  if (!element.isConnected || element.clientHeight === 0) return;

  const isScrollable = element.scrollHeight > element.clientHeight;
  const targetClass = isScrollable
    ? getVerticalGradientClass(
        element.scrollTop,
        element.scrollHeight,
        element.clientHeight,
      )
    : null;

  setVerticalGradientClasses(element, targetClass);
}

/**
 * Sets up vertical scroll gradient for a poster card body.
 * Attaches throttled scroll listener with cleanup via AbortSignal.
 */
export function setupVerticalScrollGradient(
  element: HTMLElement,
  signal: AbortSignal,
): void {
  requestAnimationFrame(() => {
    updateVerticalScrollGradient(element);
  });

  const throttledUpdate = throttleRAF(() => {
    updateVerticalScrollGradient(element);
  });

  element.addEventListener("scroll", throttledUpdate, { signal });
}
