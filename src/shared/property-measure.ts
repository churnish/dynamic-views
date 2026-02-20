/**
 * Shared utility for measuring side-by-side property field widths
 */

import { CONTENT_HIDDEN_CLASS } from "./content-visibility";
import { updateScrollGradient } from "./scroll-gradient";

/** Cache of last measured container width per card (auto-cleans via WeakMap) */
const cardWidthCache = new WeakMap<HTMLElement, number>();

/** Cache for getComputedStyle gap values */
let cachedFieldGap: number | null = null;
let cachedLabelGap: number | null = null;

/** Reset gap caches when theme/settings change */
export function resetGapCache(): void {
  cachedFieldGap = null;
  cachedLabelGap = null;
}

/** Track visible cards via IntersectionObserver */
const visibleCards = new Set<HTMLElement>();
const visibilityObservers = new Map<Window & typeof globalThis, IntersectionObserver>();

function getVisibilityObserver(win: Window & typeof globalThis): IntersectionObserver {
  let observer = visibilityObservers.get(win);
  if (!observer) {
    observer = new win.IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const card = entry.target as HTMLElement;
          if (entry.isIntersecting) {
            visibleCards.add(card);
          } else {
            visibleCards.delete(card);
          }
        });
      },
      { rootMargin: "100px" }, // Measure slightly before visible
    );
    visibilityObservers.set(win, observer);
  }
  return observer;
}

/**
 * Cleanup visibility observer and tracked cards.
 * @param win - If provided, cleans up only that window's observer.
 *              If omitted, disconnects all observers (use on plugin unload only).
 */
export function cleanupVisibilityObserver(win?: Window & typeof globalThis): void {
  if (win) {
    const obs = visibilityObservers.get(win);
    if (obs) {
      obs.disconnect();
      visibilityObservers.delete(win);
    }
    visibleCards.forEach((card) => {
      if (card.ownerDocument.defaultView === win) visibleCards.delete(card);
    });
  } else {
    visibilityObservers.forEach((obs) => obs.disconnect());
    visibilityObservers.clear();
    visibleCards.clear();
  }
}

/** Global set queue to prevent frame drops */
interface QueuedSet {
  set: HTMLElement;
  card: HTMLElement;
}
const setQueue: QueuedSet[] = [];
/** Set for O(1) duplicate detection */
const queuedSets = new Set<HTMLElement>();
let isProcessingSets = false;
let pendingFlush = false;
const gradientBatch: HTMLElement[] = [];

/** Track documents that had cards processed this queue cycle */
const processedDocuments = new Set<Document>();

/** Sets to process per frame */
const SETS_PER_FRAME = 5;

/** Maximum queue size to prevent unbounded growth */
const MAX_QUEUE_SIZE = 500;

/** Maximum gradient batch size before early flush */
const MAX_GRADIENT_BATCH_SIZE = 100;

/** Event name for masonry relayout coordination */
export const PROPERTY_MEASURED_EVENT = "dynamic-views:property-measured";

/** Process queued sets in batches per frame */
function processSetQueue(): void {
  if (setQueue.length === 0) {
    isProcessingSets = false;
    queuedSets.clear(); // Clear dedup set when queue empty
    // Flush gradient batch when queue empty, then dispatch event in RAF
    // Set pendingFlush to prevent new queue processing until flush completes
    if (gradientBatch.length > 0) {
      pendingFlush = true;
      requestAnimationFrame(() => {
        // Clear and process batch inside RAF to avoid race condition
        // (new items added between slice and RAF execution would be lost)
        const batch = gradientBatch.slice();
        gradientBatch.length = 0;
        batch.forEach((field) => updateScrollGradient(field));
        pendingFlush = false;
        processedDocuments.forEach((doc) => {
          doc.dispatchEvent(new CustomEvent(PROPERTY_MEASURED_EVENT));
        });
        processedDocuments.clear();
      });
    } else {
      requestAnimationFrame(() => {
        processedDocuments.forEach((doc) => {
          doc.dispatchEvent(new CustomEvent(PROPERTY_MEASURED_EVENT));
        });
        processedDocuments.clear();
      });
    }
    return;
  }

  // Clear stale documents from any interrupted previous cycle
  if (!isProcessingSets) processedDocuments.clear();
  isProcessingSets = true;

  // Process up to SETS_PER_FRAME sets per frame
  for (let i = 0; i < SETS_PER_FRAME && setQueue.length > 0; i++) {
    const item = setQueue.shift();
    if (item) {
      const { set, card } = item;
      queuedSets.delete(set); // Remove from dedup set
      // Check both set AND card are connected
      if (
        set.isConnected &&
        card.isConnected &&
        !card.classList.contains("compact-mode")
      ) {
        set.classList.remove("property-measured");
        measureSideBySideSet(set, gradientBatch);
        processedDocuments.add(set.ownerDocument);
      }
    }
  }

  // Early flush if gradient batch is large (prevents unbounded memory growth)
  // Use RAF to maintain consistent timing and prevent layout thrashing
  // Set pendingFlush to prevent concurrent RAF batches
  if (gradientBatch.length >= MAX_GRADIENT_BATCH_SIZE) {
    pendingFlush = true;
    const batch = gradientBatch.slice();
    gradientBatch.length = 0;
    requestAnimationFrame(() => {
      batch.forEach((field) => updateScrollGradient(field));
      pendingFlush = false;
      // No event dispatch here — processing continues; terminal dispatch fires on queue drain.
    });
  }

  // Continue processing
  requestAnimationFrame(processSetQueue);
}

/** Width cache tolerance to avoid redundant measurements from rounding */
const WIDTH_TOLERANCE = 0.5;

/** Queue all sets from a card for measurement */
function queueCardSets(
  cardEl: HTMLElement,
  sets: NodeListOf<Element>,
  cardProps: HTMLElement,
): void {
  // Only measure visible cards
  if (!visibleCards.has(cardEl)) return;

  // Skip compact mode cards before queuing
  if (cardEl.classList.contains("compact-mode")) return;

  // Skip if column mode — default CSS already handles equal widths
  const viewContainer = cardEl.closest(".dynamic-views");
  if (viewContainer?.classList.contains("dynamic-views-paired-property-column"))
    return;

  // Check width and cache with tolerance
  const currentWidth = cardProps.clientWidth;
  if (currentWidth <= 0) return;

  const lastWidth = cardWidthCache.get(cardEl);
  if (
    lastWidth !== undefined &&
    Math.abs(lastWidth - currentWidth) < WIDTH_TOLERANCE
  ) {
    return;
  }
  cardWidthCache.set(cardEl, currentWidth);

  // Add each set to queue with O(1) dedup and size limit
  sets.forEach((setEl) => {
    const set = setEl as HTMLElement;
    // O(1) duplicate check via Set
    if (!queuedSets.has(set)) {
      // Enforce queue size limit
      if (setQueue.length >= MAX_QUEUE_SIZE) {
        console.warn("[property-measure] Queue overflow, skipping measurement");
        return;
      }
      queuedSets.add(set);
      setQueue.push({ set, card: cardEl });
    }
  });

  // Start processing if not already running and no flush pending
  if (!isProcessingSets && !pendingFlush) {
    requestAnimationFrame(processSetQueue);
  }
}

/** Field selector for left side of pair */
const LEFT_FIELD_SELECTOR = ".pair-left";

/** Field selector for right side of pair */
const RIGHT_FIELD_SELECTOR = ".pair-right";

/**
 * Measures and applies optimal widths for a side-by-side property set
 * @param set - The property set element to measure
 * @param gradientTargets - Optional array to collect fields needing gradient updates (for batching)
 */
export function measureSideBySideSet(
  set: HTMLElement,
  gradientTargets?: HTMLElement[],
): void {
  try {
    const card = set.closest(".card") as HTMLElement;
    const cardProperties = set.closest(".card-properties");
    if (!card || !cardProperties) return;

    // Skip content-hidden cards (dimension reads trigger Chromium warnings)
    if (card.classList.contains(CONTENT_HIDDEN_CLASS)) return;

    // Skip if already measured
    if (set.classList.contains("property-measured")) return;

    // Skip in compact mode - CSS overrides measurement with 100% width
    if (card.classList.contains("compact-mode")) return;

    // Query fields fresh each time (avoids stale references)
    const field1 = set.querySelector(LEFT_FIELD_SELECTOR) as HTMLElement;
    const field2 = set.querySelector(RIGHT_FIELD_SELECTOR) as HTMLElement;
    if (!field1 || !field2) return;

    // Enter measuring state to remove constraints
    set.classList.add("property-measuring");

    // Force reflow
    void set.offsetWidth;

    // Get wrapper references for scroll reset later
    const wrapper1 = field1.querySelector(
      ".property-content-wrapper",
    ) as HTMLElement;
    const wrapper2 = field2.querySelector(
      ".property-content-wrapper",
    ) as HTMLElement;

    // Measure property-content (actual content, not wrapper which may be flex-grown)
    const content1 = field1.querySelector(".property-content") as HTMLElement;
    const content2 = field2.querySelector(".property-content") as HTMLElement;

    // Check if either field is truly empty (no content element or zero width)
    const field1Empty = !content1 || content1.scrollWidth === 0;
    const field2Empty = !content2 || content2.scrollWidth === 0;

    // Use cardProperties.clientWidth directly - it already accounts for
    // card padding and side cover constraints
    const containerWidth = cardProperties.clientWidth;

    // Guard against negative or zero width
    if (containerWidth <= 0) return;

    // Calculate optimal widths
    let field1Width: string;
    let field2Width: string;

    if (field1Empty) {
      // Only field2 has content: field2 gets full width (no gap needed)
      field1Width = "0px";
      field2Width = `${containerWidth}px`;
    } else if (field2Empty) {
      // Only field1 has content: field1 gets full width (no gap needed)
      field1Width = `${containerWidth}px`;
      field2Width = "0px";
    } else {
      // Both fields have content - measure and allocate

      // Measure inline labels if present
      const inlineLabel1 = field1.querySelector(
        ".property-label-inline",
      ) as HTMLElement;
      const inlineLabel2 = field2.querySelector(
        ".property-label-inline",
      ) as HTMLElement;

      // Measure above labels if present (need max of label vs content width)
      const aboveLabel1 = field1.querySelector(
        ".property-label",
      ) as HTMLElement;
      const aboveLabel2 = field2.querySelector(
        ".property-label",
      ) as HTMLElement;

      // Total width = content width + inline label width + gap (if inline label exists)
      let width1 = content1.scrollWidth;
      let width2 = content2.scrollWidth;

      // Account for above labels - field must fit the wider of label or content
      if (aboveLabel1) {
        width1 = Math.max(width1, aboveLabel1.scrollWidth);
      }
      if (aboveLabel2) {
        width2 = Math.max(width2, aboveLabel2.scrollWidth);
      }

      // Add inline label width + gap (use cached value)
      if (cachedLabelGap === null) {
        cachedLabelGap = parseFloat(getComputedStyle(field1).gap) || 4;
      }
      if (inlineLabel1) {
        width1 += inlineLabel1.scrollWidth + cachedLabelGap;
      }
      if (inlineLabel2) {
        width2 += inlineLabel2.scrollWidth + cachedLabelGap;
      }

      // Read field gap from CSS variable (use cached value)
      if (cachedFieldGap === null) {
        cachedFieldGap = parseFloat(getComputedStyle(set).gap) || 8;
      }
      const fieldGap = cachedFieldGap;
      const availableWidth = containerWidth - fieldGap;

      // Guard against zero/negative available width
      if (availableWidth <= 0) return;

      if (width1 + width2 <= availableWidth) {
        // Both fit at natural width: field1 exact, remainder to field2
        field1Width = `${width1}px`;
        field2Width = `${availableWidth - width1}px`;
      } else if (width1 <= availableWidth / 2) {
        // Field1 fits in half: field1 exact, field2 fills remainder
        field1Width = `${width1}px`;
        field2Width = `${availableWidth - width1}px`;
      } else if (width2 <= availableWidth / 2) {
        // Field2 fits in half: field2 exact, field1 fills remainder
        field1Width = `${availableWidth - width2}px`;
        field2Width = `${width2}px`;
      } else {
        // Both > 50%: split 50-50
        const half = availableWidth / 2;
        field1Width = `${half}px`;
        field2Width = `${half}px`;
      }
    }

    // Apply calculated values
    set.style.setProperty("--field1-width", field1Width);
    set.style.setProperty("--field2-width", field2Width);
    set.classList.add("property-measured");

    // Reset scroll position to 0 for both wrappers
    if (wrapper1) wrapper1.scrollLeft = 0;
    if (wrapper2) wrapper2.scrollLeft = 0;

    // Collect gradient targets for batched update, or schedule immediately
    if (gradientTargets) {
      if (!field1Empty) gradientTargets.push(field1);
      if (!field2Empty) gradientTargets.push(field2);
    } else {
      // Fallback: schedule own RAF (for single-set calls)
      requestAnimationFrame(() => {
        if (!field1Empty) updateScrollGradient(field1);
        if (!field2Empty) updateScrollGradient(field2);
      });
    }
  } finally {
    // Always exit measuring state, even if error occurs
    set.classList.remove("property-measuring");
  }
}

/** Chunk size for batched measurements (prevents long frames) */
const MEASUREMENT_CHUNK_SIZE = 5;

/**
 * Resets measurement state and re-measures all side-by-side sets in a container
 * Call this when property label mode changes
 * Uses chunked processing to prevent frame drops with many sets
 */
export function remeasurePropertyFields(container: HTMLElement): void {
  const viewContainer = container.closest(".dynamic-views") ?? container;
  if (
    viewContainer.classList.contains("dynamic-views-paired-property-column")
  ) {
    return;
  }

  const sets = Array.from(
    container.querySelectorAll<HTMLElement>(".property-pair"),
  );
  if (sets.length === 0) return;

  // Clear measured state for all sets first (batch DOM writes)
  sets.forEach((set) => {
    set.classList.remove("property-measured");
    set.style.removeProperty("--field1-width");
    set.style.removeProperty("--field2-width");
  });

  // Process sets in chunks across frames to prevent freeze
  let index = 0;
  const gradientTargets: HTMLElement[] = [];

  function processChunk(): void {
    const end = Math.min(index + MEASUREMENT_CHUNK_SIZE, sets.length);
    while (index < end) {
      measureSideBySideSet(sets[index], gradientTargets);
      index++;
    }

    if (index < sets.length) {
      // More sets to process - schedule next chunk
      requestAnimationFrame(processChunk);
    } else if (gradientTargets.length > 0) {
      // All done - update gradients
      requestAnimationFrame(() => {
        gradientTargets.forEach((field) => updateScrollGradient(field));
      });
    }
  }

  requestAnimationFrame(processChunk);
}

/**
 * Measures all side-by-side property sets in a card element.
 * Uses IntersectionObserver for visibility + ResizeObserver for size changes.
 * Returns observers for cleanup.
 */
export function measurePropertyFields(cardEl: HTMLElement): ResizeObserver[] {
  // Skip measurement if column mode — default CSS is already 50-50
  const viewContainer = cardEl.closest(".dynamic-views");
  if (
    viewContainer?.classList.contains("dynamic-views-paired-property-column")
  ) {
    return [];
  }

  const sets = cardEl.querySelectorAll(".property-pair");
  if (sets.length === 0) return [];

  // Card-properties container is inside the card
  const cardProps = cardEl.querySelector(".card-properties") as HTMLElement;
  if (!cardProps) return [];

  // Derive window from card element for cross-window observer safety
  const cardWindow = cardEl.ownerDocument.defaultView;
  if (!cardWindow) return [];

  // Register with visibility observer
  getVisibilityObserver(cardWindow).observe(cardEl);

  // Track if this is the first resize (initial appearance)
  let isFirstResize = true;

  // ResizeObserver handles size changes
  const observer = new cardWindow.ResizeObserver(() => {
    // Skip content-hidden cards (dimension reads trigger Chromium warnings)
    if (cardEl.classList.contains(CONTENT_HIDDEN_CLASS)) return;
    // Skip in compact mode or if container has no width
    if (cardEl.classList.contains("compact-mode")) return;
    if (cardProps.clientWidth <= 0) return;

    if (isFirstResize) {
      // Initial appearance - mark as visible for immediate measurement
      isFirstResize = false;
      visibleCards.add(cardEl);
    }
    // Width cache in queueCardSets prevents redundant measurements
    queueCardSets(cardEl, sets, cardProps);
  });
  observer.observe(cardEl);

  return [observer];
}
