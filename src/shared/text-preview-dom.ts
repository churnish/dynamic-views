import { CONTENT_HIDDEN_CLASS } from './content-visibility';
import { getOwnerWindow } from '../utils/owner-window';

/**
 * Updates the text preview DOM inside a card element.
 *
 * The card DOM structure for previews is:
 *   .card-body
 *     .card-previews            (wrapper, may also hold .card-thumbnail)
 *       .card-text-preview-wrapper
 *         .card-text-preview    (text node lives here)
 *       .card-thumbnail         (optional, sibling of text wrapper)
 *     .card-properties-bottom   (text wrapper is inserted before this)
 *
 * Five cases are handled:
 *  1. Text + existing .card-text-preview  → update textContent in place
 *  2. Text + existing .card-previews (no text el yet, thumbnail present)
 *     → prepend a new text wrapper before the thumbnail
 *  3. Text + no .card-previews at all
 *     → create the full previews wrapper and insert it before
 *       .card-properties-bottom (or append to .card-body)
 *  4. Empty text + .card-previews with thumbnail → remove only the text wrapper
 *  5. Empty text + .card-previews with no thumbnail → remove the whole wrapper
 *
 * Uses plain DOM APIs (no Obsidian-specific createDiv) so it works in both
 * the Obsidian runtime and the jsdom test environment.
 */

/**
 * Sets content on a text preview element.
 * When newline preservation is active, splits text by paragraph breaks (\n\n)
 * into <p> elements. Margins between <p>s provide visual paragraph separation
 * without blank lines that would cause -webkit-line-clamp to place ellipsis
 * on empty lines.
 */
export function setPreviewContent(el: HTMLElement, text: string): void {
  const preserveNewlines = el.ownerDocument.body.classList.contains(
    'dynamic-views-text-preview-keep-newlines'
  );

  if (preserveNewlines && text.includes('\n')) {
    el.textContent = ''; // Clear existing content
    const paragraphs = text.split(/\n\n+/);
    for (const paraText of paragraphs) {
      const p = el.ownerDocument.createElement('p');
      p.textContent = paraText;
      el.appendChild(p);
    }
  } else {
    el.textContent = text;
  }
}

export function updateTextPreviewDOM(
  cardEl: HTMLElement,
  newText: string
): void {
  const previewsEl = cardEl.querySelector<HTMLElement>('.card-previews');
  const previewEl = cardEl.querySelector<HTMLElement>('.card-text-preview');

  if (newText) {
    if (previewEl) {
      // Case 1: update existing text node
      setPreviewContent(previewEl, newText);
    } else if (previewsEl) {
      // Case 2: wrapper exists (thumbnail present) — prepend text wrapper
      const doc = cardEl.ownerDocument;
      const textWrapper = doc.createElement('div');
      textWrapper.className = 'card-text-preview-wrapper';
      const textEl = doc.createElement('div');
      textEl.className = 'card-text-preview';
      setPreviewContent(textEl, newText);
      textWrapper.appendChild(textEl);
      previewsEl.insertBefore(textWrapper, previewsEl.firstChild);
    } else {
      // Case 3: no previews wrapper at all — build from scratch
      const bodyEl = cardEl.querySelector<HTMLElement>('.card-body');
      if (bodyEl) {
        const doc = cardEl.ownerDocument;
        const wrapper = doc.createElement('div');
        wrapper.className = 'card-previews';
        const textWrapper = doc.createElement('div');
        textWrapper.className = 'card-text-preview-wrapper';
        const textEl = doc.createElement('div');
        textEl.className = 'card-text-preview';
        setPreviewContent(textEl, newText);
        textWrapper.appendChild(textEl);
        wrapper.appendChild(textWrapper);
        const bottomProps = bodyEl.querySelector('.card-properties-bottom');
        if (bottomProps) {
          bodyEl.insertBefore(wrapper, bottomProps);
        } else {
          bodyEl.appendChild(wrapper);
        }
      }
    }
  } else if (previewsEl) {
    const hasThumbnail = previewsEl.querySelector('.card-thumbnail');
    if (hasThumbnail) {
      // Case 4: thumbnail must stay — remove only the text wrapper
      previewEl?.closest('.card-text-preview-wrapper')?.remove();
    } else {
      // Case 5: nothing else in the wrapper — remove it entirely
      previewsEl.remove();
    }
  }
  // Implicit case 6: empty text + no previewsEl → nothing to do
}

// ---------------------------------------------------------------------------
// Per-paragraph visual line clamp
//
// When keep-newlines is active, CSS -webkit-line-clamp is disabled (the
// container uses `display: block`). This JS walks <p> children, counts
// visual lines (text lines + 1lh margin gaps), clamps the overflowing <p>,
// and hides the rest.
// ---------------------------------------------------------------------------

const KEEP_NEWLINES_CLASS = 'dynamic-views-text-preview-keep-newlines';
const TEXT_PREVIEW_LINES_VAR = '--dynamic-views-text-preview-lines';
const DEFAULT_LINE_BUDGET = 5;

// Per-paragraph clamp uses CSS classes for static properties (display, box-orient,
// overflow) and setProperty for dynamic -webkit-line-clamp values per <p>.

// Counterparts defined in styles/card/_previews.scss
const PARA_CLAMPED_CLASS = 'dynamic-views-para-clamped';
const PARA_HIDDEN_CLASS = 'dynamic-views-para-hidden';
const TRUNCATION_INDICATOR_CLASS = 'dynamic-views-truncation-indicator';

/** Clear clamp classes, inline clamp value, and truncation indicator from a paragraph. */
function clearParagraphStyles(p: HTMLElement): void {
  p.classList.remove(PARA_CLAMPED_CLASS, PARA_HIDDEN_CLASS);
  p.style.removeProperty('-webkit-line-clamp');
  p.querySelector(`.${TRUNCATION_INDICATOR_CLASS}`)?.remove();
}

/**
 * Force ellipsis on a paragraph that fits within its line budget but has
 * hidden siblings after it. Appends a <span> overflow trigger so
 * -webkit-line-clamp produces `…` even though the text itself fits.
 */
function forceEllipsisOnLastVisible(p: HTMLElement, textLines: number): void {
  p.classList.add(PARA_CLAMPED_CLASS);
  p.style.setProperty('-webkit-line-clamp', String(textLines));
  const indicator = p.ownerDocument.createElement('span');
  indicator.className = TRUNCATION_INDICATOR_CLASS;
  indicator.textContent = '\u2026';
  p.appendChild(indicator);
}

/**
 * Apply clamp from pre-measured heights (write-only — no layout reads).
 * Shared by both single-card and batched variants.
 */
function applyClampFromMeasurements(
  paragraphs: HTMLElement[],
  lineHeight: number,
  budget: number,
  heights: number[]
): void {
  let usedLines = 0;
  let lastVisibleIdx = -1;

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];

    // Margin between paragraphs = 1 visual line
    if (i > 0) usedLines++;

    const textLines = Math.max(1, Math.round(heights[i] / lineHeight));
    const remaining = budget - usedLines;

    if (remaining <= 0) {
      // Margin consumed the budget — hide this paragraph rather than
      // showing it margin-less (which creates inconsistent inter-paragraph
      // spacing that shifts as line count changes).
      hideFrom(paragraphs, i);
      break;
    }

    if (textLines > remaining) {
      // This paragraph overflows — clamp it, hide the rest
      clampParagraph(p, remaining);
      lastVisibleIdx = i;
      hideFrom(paragraphs, i + 1);
      break;
    }

    usedLines += textLines;
    lastVisibleIdx = i;
  }

  // Post-step: if the last visible paragraph has hidden siblings and its text
  // fits within the clamp (so native … won't appear), force-ellipsis on it.
  if (lastVisibleIdx >= 0 && lastVisibleIdx < paragraphs.length - 1) {
    const lastP = paragraphs[lastVisibleIdx];
    const textLines = Math.max(
      1,
      Math.round(heights[lastVisibleIdx] / lineHeight)
    );
    const clampVal =
      parseInt(lastP.style.getPropertyValue('-webkit-line-clamp')) || 0;

    if (clampVal === 0 || clampVal >= textLines) {
      forceEllipsisOnLastVisible(lastP, clampVal || textLines);
    }
  }
}

/** Apply -webkit-line-clamp to a paragraph. */
function clampParagraph(p: HTMLElement, lines: number): void {
  p.classList.add(PARA_CLAMPED_CLASS);
  p.style.setProperty('-webkit-line-clamp', String(lines));
}

/** Hide all paragraphs from index `start` onward. */
function hideFrom(paragraphs: HTMLElement[], start: number): void {
  for (let j = start; j < paragraphs.length; j++) {
    paragraphs[j].classList.add(PARA_HIDDEN_CLASS);
  }
}

/**
 * Per-paragraph line clamp for a single text preview element.
 * Idempotent: clears previous state before re-measuring.
 */
export function applyPerParagraphClamp(previewEl: HTMLElement): void {
  const paragraphs = Array.from(
    previewEl.querySelectorAll<HTMLElement>(':scope > p')
  );
  if (paragraphs.length === 0) return;

  // Clear previous clamp state
  for (const p of paragraphs) {
    clearParagraphStyles(p);
  }

  const style = getOwnerWindow(previewEl).getComputedStyle(previewEl);
  const lineHeight = parseFloat(style.lineHeight);
  if (!lineHeight || lineHeight <= 0) return;

  const budget =
    parseInt(style.getPropertyValue(TEXT_PREVIEW_LINES_VAR)) ||
    DEFAULT_LINE_BUDGET;

  const heights = paragraphs.map((p) => p.offsetHeight);
  applyClampFromMeasurements(paragraphs, lineHeight, budget, heights);
}

// ---------------------------------------------------------------------------
// Batched variants for Bases post-render pipeline
//
// 3-phase read/write separation to avoid layout thrashing when processing
// many cards at once (unlike applyPerParagraphClamp which is acceptable
// for 1–3 cards).
// ---------------------------------------------------------------------------

/** Collect preview elements and their <p> children, filtering content-hidden cards. */
function collectPreviews(
  previews: Iterable<HTMLElement>
): Array<{ el: HTMLElement; paragraphs: HTMLElement[] }> {
  const collected: Array<{ el: HTMLElement; paragraphs: HTMLElement[] }> = [];
  for (const el of previews) {
    // Skip cards hidden by content-visibility (no layout data)
    if (el.closest(`.${CONTENT_HIDDEN_CLASS}`)) continue;
    const paragraphs = Array.from(
      el.querySelectorAll<HTMLElement>(':scope > p')
    );
    if (paragraphs.length > 0) {
      collected.push({ el, paragraphs });
    }
  }
  return collected;
}

/**
 * Shared batched clamp core for Bases post-render pipeline.
 * 3-phase read/write separation avoids layout thrashing across many cards.
 */
function batchApplyClamp(previews: Iterable<HTMLElement>): void {
  const collected = collectPreviews(previews);
  if (collected.length === 0) return;

  // Phase 0: Clear stale inline styles
  for (const { paragraphs } of collected) {
    for (const p of paragraphs) clearParagraphStyles(p);
  }

  // Phase 1: Read measurements (1 reflow for entire batch)
  const measurements: Array<{
    paragraphs: HTMLElement[];
    lineHeight: number;
    budget: number;
    heights: number[];
  }> = [];

  for (const { el, paragraphs } of collected) {
    const style = getOwnerWindow(el).getComputedStyle(el);
    const lineHeight = parseFloat(style.lineHeight);
    if (!lineHeight || lineHeight <= 0) continue;
    const budget =
      parseInt(style.getPropertyValue(TEXT_PREVIEW_LINES_VAR)) ||
      DEFAULT_LINE_BUDGET;
    measurements.push({
      paragraphs,
      lineHeight,
      budget,
      heights: paragraphs.map((p) => p.offsetHeight),
    });
  }

  // Phase 2: Apply clamps (writes only — no layout reads)
  for (const m of measurements) {
    applyClampFromMeasurements(m.paragraphs, m.lineHeight, m.budget, m.heights);
  }
}

/** Container-scoped — scans all text previews in container. */
export function initializeTextPreviewClamp(container: HTMLElement): void {
  if (!container.ownerDocument.body.classList.contains(KEEP_NEWLINES_CLASS)) {
    return;
  }

  const previews =
    container.querySelectorAll<HTMLElement>('.card-text-preview');
  if (previews.length === 0) return;
  batchApplyClamp(previews);
}

/** Card-scoped variant — for appendBatch (avoids re-scanning old content-hidden cards). */
export function initializeTextPreviewClampForCards(cards: HTMLElement[]): void {
  if (cards.length === 0) return;
  if (!cards[0].ownerDocument.body.classList.contains(KEEP_NEWLINES_CLASS)) {
    return;
  }

  const previews: HTMLElement[] = [];
  for (const card of cards) {
    const preview = card.querySelector<HTMLElement>('.card-text-preview');
    if (preview) previews.push(preview);
  }
  batchApplyClamp(previews);
}
