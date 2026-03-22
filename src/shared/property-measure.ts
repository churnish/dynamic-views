/**
 * Shared utility for measuring side-by-side property field widths
 */

import { getOwnerWindow } from '../utils/owner-window';
import { CONTENT_HIDDEN_CLASS } from './content-visibility';
import { updateScrollGradient } from './scroll-gradient';

/** Cache of last measured container width per card (auto-cleans via WeakMap) */
const cardWidthCache = new WeakMap<HTMLElement, number>();

interface CachedPairWidths {
  field1: string;
  field2: string;
}

interface CachedCardMeasurement {
  containerWidth: number;
  pairs: CachedPairWidths[];
}

/** Persistent width cache keyed by file path — survives DOM element lifecycle.
 *  Applied on re-mount to skip forced reflows. */
const persistentWidthCache = new Map<string, CachedCardMeasurement>();

/** Cached gap values — Obsidian's --size-* vars are hardcoded constants,
 *  so these are read once on first use and never reset. */
let cachedFieldGap: number | undefined;
let cachedLabelGap: number | undefined;

/** Clear persistent width cache when settings change (label mode, pairing config) */
export function resetPersistentWidthCache(): void {
  persistentWidthCache.clear();
}

/** Event name for masonry relayout coordination */
export const PROPERTY_MEASURED = 'dynamic-views:property-measured';

/** Width cache tolerance to avoid redundant measurements from rounding */
const WIDTH_TOLERANCE = 0.5;

/**
 * Measures all property pairs in a card synchronously.
 * One forced reflow per set via measureSideBySideSet.
 */
function measureCardPairsSynchronous(
  cardEl: HTMLElement,
  sets: NodeListOf<Element>,
  cardProps: HTMLElement
): void {
  // Skip compact mode
  if (cardEl.classList.contains('compact-mode')) return;

  // Skip column mode
  const viewContainer = cardEl.closest('.dynamic-views');
  if (viewContainer?.classList.contains('dynamic-views-paired-property-column'))
    return;

  // Skip content-hidden cards
  if (cardEl.classList.contains(CONTENT_HIDDEN_CLASS)) return;

  // Width cache check
  const currentWidth = cardProps.clientWidth;
  if (currentWidth <= 0) return;
  const lastWidth = cardWidthCache.get(cardEl);
  if (
    lastWidth !== undefined &&
    Math.abs(lastWidth - currentWidth) < WIDTH_TOLERANCE
  ) {
    // Width unchanged — but if any set lacks .property-measured (fresh DOM
    // from re-render), fall through to measure them.
    let allMeasured = true;
    for (let i = 0; i < sets.length; i++) {
      if (!sets[i].classList.contains('property-measured')) {
        allMeasured = false;
        break;
      }
    }
    if (allMeasured) return;
    // Card element reused (in-place update) with fresh DOM — persistent cache
    // may have stale widths from before the property value change.
    // Re-mount (virtual scroll) has lastWidth undefined — cache is trusted.
    const stalePath = cardEl.getAttribute('data-path');
    if (stalePath) persistentWidthCache.delete(stalePath);
  }
  cardWidthCache.set(cardEl, currentWidth);

  // Clear stale measurement state — container width changed (or first mount).
  // Without this, measureSideBySideSet skips sets that still have
  // .property-measured from the old width, leaving stale CSS vars.
  for (let i = 0; i < sets.length; i++) {
    const set = sets[i] as HTMLElement;
    set.classList.remove('property-measured');
    set.style.removeProperty('--field1-width');
    set.style.removeProperty('--field2-width');
  }

  // Try persistent cache — zero forced reflows
  const filePath = cardEl.getAttribute('data-path');
  if (filePath) {
    const cached = persistentWidthCache.get(filePath);
    if (
      cached &&
      cached.pairs.length === sets.length &&
      Math.abs(cached.containerWidth - currentWidth) < WIDTH_TOLERANCE
    ) {
      const gradientTargets: HTMLElement[] = [];
      for (let i = 0; i < sets.length; i++) {
        const set = sets[i] as HTMLElement;
        if (!set.isConnected) continue;
        const pair = cached.pairs[i];
        set.style.setProperty('--field1-width', pair.field1);
        set.style.setProperty('--field2-width', pair.field2);
        set.classList.add('property-measured');

        // Reset scroll position (defensive — fresh DOM has scrollLeft 0)
        const w1 = set.querySelector(
          LEFT_FIELD_SELECTOR + ' .property-content-wrapper'
        ) as HTMLElement;
        const w2 = set.querySelector(
          RIGHT_FIELD_SELECTOR + ' .property-content-wrapper'
        ) as HTMLElement;
        if (w1) w1.scrollLeft = 0;
        if (w2) w2.scrollLeft = 0;

        if (pair.field1 !== '0px') {
          const f = set.querySelector(LEFT_FIELD_SELECTOR) as HTMLElement;
          if (f) gradientTargets.push(f);
        }
        if (pair.field2 !== '0px') {
          const f = set.querySelector(RIGHT_FIELD_SELECTOR) as HTMLElement;
          if (f) gradientTargets.push(f);
        }
      }
      gradientTargets.forEach((field) => updateScrollGradient(field));
      cardEl.ownerDocument.dispatchEvent(new CustomEvent(PROPERTY_MEASURED));
      return;
    }
  }

  // Measure each set synchronously (gradient targets collected inline)
  const gradientTargets: HTMLElement[] = [];
  for (const setEl of sets) {
    const set = setEl as HTMLElement;
    if (!set.isConnected) continue;
    measureSideBySideSet(set, gradientTargets);
  }

  // Store in persistent cache
  if (filePath) {
    const pairs: CachedPairWidths[] = [];
    for (const setEl of sets) {
      const set = setEl as HTMLElement;
      pairs.push({
        field1: set.style.getPropertyValue('--field1-width') || '0px',
        field2: set.style.getPropertyValue('--field2-width') || '0px',
      });
    }
    persistentWidthCache.set(filePath, { containerWidth: currentWidth, pairs });
  }

  // Apply gradients synchronously (cheap — just class toggles)
  gradientTargets.forEach((field) => updateScrollGradient(field));

  // Dispatch PROPERTY_MEASURED for masonry relayout (debounced at 100ms in listener)
  cardEl.ownerDocument.dispatchEvent(new CustomEvent(PROPERTY_MEASURED));
}

/** Field selector for left side of pair */
const LEFT_FIELD_SELECTOR = '.pair-left';

/** Field selector for right side of pair */
const RIGHT_FIELD_SELECTOR = '.pair-right';

/**
 * Measures and applies optimal widths for a side-by-side property set
 * @param set - The property set element to measure
 * @param gradientTargets - Optional array to collect fields needing gradient updates (for batching)
 */
export function measureSideBySideSet(
  set: HTMLElement,
  gradientTargets?: HTMLElement[]
): void {
  try {
    const card = set.closest('.card') as HTMLElement;
    const cardProperties = set.closest('.card-properties');
    if (!card || !cardProperties) return;

    // Skip content-hidden cards (dimension reads trigger Chromium warnings)
    if (card.classList.contains(CONTENT_HIDDEN_CLASS)) return;

    // Skip if already measured
    if (set.classList.contains('property-measured')) return;

    // Skip in compact mode - CSS overrides measurement with 100% width
    if (card.classList.contains('compact-mode')) return;

    // Query fields fresh each time (avoids stale references)
    const field1 = set.querySelector(LEFT_FIELD_SELECTOR) as HTMLElement;
    const field2 = set.querySelector(RIGHT_FIELD_SELECTOR) as HTMLElement;
    if (!field1 || !field2) return;

    // Enter measuring state to remove constraints
    set.classList.add('property-measuring');

    // Force reflow
    void set.offsetWidth;

    // Get wrapper references for scroll reset later
    const wrapper1 = field1.querySelector(
      '.property-content-wrapper'
    ) as HTMLElement;
    const wrapper2 = field2.querySelector(
      '.property-content-wrapper'
    ) as HTMLElement;

    // Measure property-content (actual content, not wrapper which may be flex-grown)
    const content1 = field1.querySelector('.property-content') as HTMLElement;
    const content2 = field2.querySelector('.property-content') as HTMLElement;

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
      field1Width = '0px';
      field2Width = `${containerWidth}px`;
    } else if (field2Empty) {
      // Only field1 has content: field1 gets full width (no gap needed)
      field1Width = `${containerWidth}px`;
      field2Width = '0px';
    } else {
      // Both fields have content - measure and allocate

      // Measure inline labels if present
      const inlineLabel1 = field1.querySelector(
        '.property-label-inline'
      ) as HTMLElement;
      const inlineLabel2 = field2.querySelector(
        '.property-label-inline'
      ) as HTMLElement;

      // Measure above labels if present (need max of label vs content width)
      const aboveLabel1 = field1.querySelector(
        '.property-label'
      ) as HTMLElement;
      const aboveLabel2 = field2.querySelector(
        '.property-label'
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
      if (cachedLabelGap === undefined) {
        cachedLabelGap =
          parseFloat(getOwnerWindow(field1).getComputedStyle(field1).gap) || 4;
      }
      if (inlineLabel1) {
        width1 += inlineLabel1.scrollWidth + cachedLabelGap;
      }
      if (inlineLabel2) {
        width2 += inlineLabel2.scrollWidth + cachedLabelGap;
      }

      // Read field gap from CSS variable (use cached value)
      if (cachedFieldGap === undefined) {
        cachedFieldGap =
          parseFloat(getOwnerWindow(set).getComputedStyle(set).gap) || 8;
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
    set.style.setProperty('--field1-width', field1Width);
    set.style.setProperty('--field2-width', field2Width);
    set.classList.add('property-measured');

    // Reset scroll position to 0 for both wrappers
    if (wrapper1) wrapper1.scrollLeft = 0;
    if (wrapper2) wrapper2.scrollLeft = 0;

    // Collect gradient targets for batched update, or schedule immediately
    if (gradientTargets) {
      if (!field1Empty) gradientTargets.push(field1);
      if (!field2Empty) gradientTargets.push(field2);
    } else {
      // Fallback: schedule own RAF (for single-set calls)
      getOwnerWindow(field1).requestAnimationFrame(() => {
        if (!field1Empty) updateScrollGradient(field1);
        if (!field2Empty) updateScrollGradient(field2);
      });
    }
  } finally {
    // Always exit measuring state, even if error occurs
    set.classList.remove('property-measuring');
  }
}

/**
 * Resets measurement state and re-measures all side-by-side sets in a container.
 * Called when property label mode changes — low frequency, bounded card count
 * due to virtual scrolling.
 */
export function remeasurePropertyFields(container: HTMLElement): void {
  const viewContainer = container.closest('.dynamic-views') ?? container;
  if (
    viewContainer.classList.contains('dynamic-views-paired-property-column')
  ) {
    return;
  }

  const sets = Array.from(
    container.querySelectorAll<HTMLElement>('.property-pair')
  );
  if (sets.length === 0) return;

  // Invalidate persistent cache for affected cards (label mode changed)
  container
    .querySelectorAll<HTMLElement>('.card[data-path]')
    .forEach((card) => {
      const path = card.getAttribute('data-path');
      if (path) persistentWidthCache.delete(path);
    });

  // Clear measured state for all sets first (batch DOM writes)
  sets.forEach((set) => {
    set.classList.remove('property-measured');
    set.style.removeProperty('--field1-width');
    set.style.removeProperty('--field2-width');
  });

  // Re-measure synchronously
  const gradientTargets: HTMLElement[] = [];
  sets.forEach((set) => {
    if (
      set.isConnected &&
      !set.closest('.card')?.classList.contains('compact-mode')
    ) {
      measureSideBySideSet(set, gradientTargets);
    }
  });

  gradientTargets.forEach((field) => updateScrollGradient(field));
  container.ownerDocument.dispatchEvent(new CustomEvent(PROPERTY_MEASURED));
}

/**
 * Measures all side-by-side property sets in a card element.
 * Performs synchronous initial measurement, then sets up a ResizeObserver
 * for resize-triggered remeasurement. Returns observers for cleanup.
 */
export function measurePropertyFields(cardEl: HTMLElement): ResizeObserver[] {
  // Skip measurement if column mode — default CSS is already 50-50
  const viewContainer = cardEl.closest('.dynamic-views');
  if (
    viewContainer?.classList.contains('dynamic-views-paired-property-column')
  ) {
    return [];
  }

  const sets = cardEl.querySelectorAll('.property-pair');
  if (sets.length === 0) return [];

  // Card-properties container is inside the card
  const cardProps = cardEl.querySelector('.card-properties') as HTMLElement;
  if (!cardProps) return [];

  // Derive window from card element for cross-window observer safety
  if (!cardEl.ownerDocument.defaultView) return [];
  const cardWindow = getOwnerWindow(cardEl);

  // Synchronous initial measurement (card is already in DOM with layout)
  if (
    !cardEl.classList.contains(CONTENT_HIDDEN_CLASS) &&
    cardProps.clientWidth > 0
  ) {
    measureCardPairsSynchronous(cardEl, sets, cardProps);
  }

  // ResizeObserver for subsequent resize-triggered remeasurement
  const observer = new cardWindow.ResizeObserver(() => {
    if (cardEl.classList.contains(CONTENT_HIDDEN_CLASS)) return;
    measureCardPairsSynchronous(cardEl, sets, cardProps);
  });
  observer.observe(cardEl);

  return [observer];
}

/**
 * Triggers property measurement on an existing card (e.g., after compact-mode removal).
 * Queries pairs fresh — safe after DOM mutations.
 */
export function remeasureCardPairs(cardEl: HTMLElement): void {
  const sets = cardEl.querySelectorAll('.property-pair');
  if (sets.length === 0) return;
  const cardProps = cardEl.querySelector('.card-properties') as HTMLElement;
  if (!cardProps || cardProps.clientWidth <= 0) return;
  if (!cardEl.ownerDocument.defaultView) return;
  measureCardPairsSynchronous(cardEl, sets, cardProps);
}
