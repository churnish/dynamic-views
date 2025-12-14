/**
 * Shared utility for measuring side-by-side property field widths
 */

import { updateScrollGradient } from "./scroll-gradient-manager";

/**
 * Measures and applies optimal widths for a side-by-side property row
 */
export function measureSideBySideRow(
  row: HTMLElement,
  field1: HTMLElement,
  field2: HTMLElement,
): void {
  try {
    const cardProperties = row.closest(".card-properties");
    if (!row.closest(".card") || !cardProperties) return;

    // Skip if already measured
    if (row.classList.contains("property-measured")) return;

    // Enter measuring state to remove constraints
    row.classList.add("property-measuring");

    // Force reflow
    void row.offsetWidth;

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

    // Measure inline labels if present
    const inlineLabel1 = field1.querySelector(
      ".property-label-inline",
    ) as HTMLElement;
    const inlineLabel2 = field2.querySelector(
      ".property-label-inline",
    ) as HTMLElement;

    // Measure above labels if present (need max of label vs content width)
    const aboveLabel1 = field1.querySelector(".property-label") as HTMLElement;
    const aboveLabel2 = field2.querySelector(".property-label") as HTMLElement;

    // Total width = content width + inline label width + gap (if inline label exists)
    // For above labels, use max of label width vs content width
    let width1 = content1 ? content1.scrollWidth : 0;
    let width2 = content2 ? content2.scrollWidth : 0;

    // Account for above labels - field must fit the wider of label or content
    if (aboveLabel1) {
      width1 = Math.max(width1, aboveLabel1.scrollWidth);
    }
    if (aboveLabel2) {
      width2 = Math.max(width2, aboveLabel2.scrollWidth);
    }

    // Add inline label width + gap between label and wrapper
    // Read gap from CSS variable (var(--size-4-1), typically 4px)
    const inlineLabelGap = parseFloat(getComputedStyle(field1).gap) || 4;
    if (inlineLabel1) {
      width1 += inlineLabel1.scrollWidth + inlineLabelGap;
    }
    if (inlineLabel2) {
      width2 += inlineLabel2.scrollWidth + inlineLabelGap;
    }

    // Use cardProperties.clientWidth directly - it already accounts for
    // card padding and side cover constraints
    const containerWidth = cardProperties.clientWidth;

    // Guard against negative or zero width (edge case: very narrow cards or misconfiguration)
    if (containerWidth <= 0) {
      return;
    }

    // Read field gap from CSS variable (var(--dynamic-views-element-spacing, 8px))
    const fieldGap = parseFloat(getComputedStyle(row).gap) || 8;
    const availableWidth = containerWidth - fieldGap;

    // Guard against zero/negative available width (edge case: gap >= container)
    if (availableWidth <= 0) {
      return;
    }

    const percent1 = (width1 / availableWidth) * 100;
    const percent2 = (width2 / availableWidth) * 100;

    // Calculate optimal widths using smart strategy
    let field1Width: string;
    let field2Width: string;

    if (width1 === 0 && width2 === 0) {
      // Both empty: split 50-50
      const half = availableWidth / 2;
      field1Width = `${half}px`;
      field2Width = `${half}px`;
    } else if (percent1 <= 50) {
      // Field1 fits: field1 exact, field2 fills remainder
      field1Width = `${width1}px`;
      field2Width = `${availableWidth - width1}px`;
    } else if (percent2 <= 50) {
      // Field2 fits: field2 exact, field1 fills remainder
      field1Width = `${availableWidth - width2}px`;
      field2Width = `${width2}px`;
    } else {
      // Both > 50%: split 50-50
      const half = availableWidth / 2;
      field1Width = `${half}px`;
      field2Width = `${half}px`;
    }

    // Apply calculated values
    row.style.setProperty("--field1-width", field1Width);
    row.style.setProperty("--field2-width", field2Width);
    row.classList.add("property-measured");

    // Reset scroll position to 0 for both wrappers (reuse variables from measurement)
    if (wrapper1) wrapper1.scrollLeft = 0;
    if (wrapper2) wrapper2.scrollLeft = 0;

    // Update scroll gradients after layout settles
    // Use double RAF to ensure CSS variables are fully applied before checking scrollability
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        updateScrollGradient(field1);
        updateScrollGradient(field2);
      });
    });
  } finally {
    // Always exit measuring state, even if error occurs
    row.classList.remove("property-measuring");
  }
}

/**
 * Resets measurement state and re-measures all side-by-side rows in a container
 * Call this when property label mode changes
 */
export function remeasurePropertyFields(container: HTMLElement): void {
  if (document.body.classList.contains("dynamic-views-property-width-50-50")) {
    return;
  }

  const rows = container.querySelectorAll(".property-row-sidebyside");
  rows.forEach((row) => {
    const rowEl = row as HTMLElement;
    // Clear measured state to allow re-measurement
    rowEl.classList.remove("property-measured");
    rowEl.style.removeProperty("--field1-width");
    rowEl.style.removeProperty("--field2-width");

    const field1 = rowEl.querySelector(
      ".property-field-1, .property-field-3, .property-field-5, .property-field-7, .property-field-9, .property-field-11, .property-field-13",
    ) as HTMLElement;
    const field2 = rowEl.querySelector(
      ".property-field-2, .property-field-4, .property-field-6, .property-field-8, .property-field-10, .property-field-12, .property-field-14",
    ) as HTMLElement;

    if (field1 && field2) {
      requestAnimationFrame(() => {
        measureSideBySideRow(rowEl, field1, field2);
      });
    }
  });
}

/**
 * Measures all side-by-side property rows in a container
 * Returns ResizeObservers for cleanup
 */
export function measurePropertyFields(
  container: HTMLElement,
): (ResizeObserver | IntersectionObserver)[] {
  // Skip measurement if 50-50 mode - default CSS is already 50-50
  if (document.body.classList.contains("dynamic-views-property-width-50-50")) {
    return [];
  }

  const observers: (ResizeObserver | IntersectionObserver)[] = [];
  const rows = container.querySelectorAll(".property-row-sidebyside");

  rows.forEach((row) => {
    const rowEl = row as HTMLElement;

    const field1 = rowEl.querySelector(
      ".property-field-1, .property-field-3, .property-field-5, .property-field-7, .property-field-9, .property-field-11, .property-field-13",
    ) as HTMLElement;
    const field2 = rowEl.querySelector(
      ".property-field-2, .property-field-4, .property-field-6, .property-field-8, .property-field-10, .property-field-12, .property-field-14",
    ) as HTMLElement;

    if (field1 && field2) {
      const card = rowEl.closest(".card") as HTMLElement;
      const cardProps = rowEl.closest(".card-properties") as HTMLElement;

      // Observe card for resize (handles card width changes)
      const cardObserver = new ResizeObserver(() => {
        requestAnimationFrame(() => {
          // Clear measured state to allow re-measurement for new card width
          rowEl.classList.remove("property-measured");
          measureSideBySideRow(rowEl, field1, field2);
        });
      });
      cardObserver.observe(card);
      observers.push(cardObserver);

      // Observe card-properties for visibility (handles hidden tabs becoming visible)
      const visibilityObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting && cardProps.clientWidth > 0) {
              requestAnimationFrame(() => {
                // Clear measured state to allow re-measurement (width may have changed while hidden)
                rowEl.classList.remove("property-measured");
                measureSideBySideRow(rowEl, field1, field2);
              });
            }
          }
        },
        { threshold: 0 },
      );
      visibilityObserver.observe(cardProps);
      observers.push(visibilityObserver);
    }
  });

  return observers;
}
