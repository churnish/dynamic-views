/**
 * Shared property type helpers
 * Used by both Bases (shared-renderer.ts) and Datacore (card-renderer.tsx) renderers
 */

import { CONTENT_HIDDEN_CLASS } from './content-visibility';
import { getOwnerWindow } from '../utils/owner-window';

/**
 * Check if a property is a tag property (tags or file tags)
 */
export function isTagProperty(propertyName: string | undefined): boolean {
  if (!propertyName) return false;
  return (
    propertyName === 'tags' ||
    propertyName === 'note.tags' ||
    propertyName === 'file.tags' ||
    propertyName === 'file tags'
  );
}

/**
 * Check if a property is a file property (intrinsic, cannot be missing)
 */
export function isFileProperty(propertyName: string | undefined): boolean {
  if (!propertyName) return false;
  const normalized = propertyName.toLowerCase();
  return normalized.startsWith('file.') || normalized.startsWith('file ');
}

/**
 * Check if a property is a formula property (computed, cannot be missing)
 */
export function isFormulaProperty(propertyName: string | undefined): boolean {
  if (!propertyName) return false;
  return propertyName.startsWith('formula.');
}

/**
 * Determine if a property field should be collapsed (hidden from layout).
 * Unified logic for both Bases and Datacore renderers.
 *
 * @param value - The resolved property value (string or null if missing)
 * @param propertyName - The property name
 * @param hideMissing - Whether to hide missing (null) properties
 * @param hideEmptyMode - How to handle empty values: "show" | "labels-hidden" | "all"
 * @param propertyLabels - Label display mode: "hide" | "inline" | "above"
 */
export function shouldCollapseField(
  value: string | null,
  propertyName: string,
  hideMissing: boolean,
  hideEmptyMode: 'show' | 'labels-hidden' | 'all',
  propertyLabels: 'hide' | 'inline' | 'above'
): boolean {
  // 1. FIRST: Missing handling (only YAML/note properties can be "missing")
  if (
    value === null &&
    hideMissing &&
    !isFileProperty(propertyName) &&
    !isFormulaProperty(propertyName) &&
    !isTagProperty(propertyName)
  ) {
    return true;
  }

  // 2. THEN: Empty handling - no displayable value
  const isEmpty = !value;
  if (isEmpty) {
    if (hideEmptyMode === 'all') return true;
    if (hideEmptyMode === 'labels-hidden' && propertyLabels === 'hide')
      return true;
  }

  return false;
}

/** Check if any `.property-pair` in a compact card has wrapped (right child below left). */
export function hasWrappedPairs(card: HTMLElement): boolean {
  const pairs = card.querySelectorAll<HTMLElement>('.property-pair');
  for (const pair of pairs) {
    const left = pair.querySelector<HTMLElement>('.pair-left');
    const right = pair.querySelector<HTMLElement>('.pair-right');
    if (
      left &&
      right &&
      right.getBoundingClientRect().top > left.getBoundingClientRect().top + 1
    ) {
      return true;
    }
  }
  return false;
}

// --- Batched compact-stacked detection ---
// Per-document partitioning: main window and popout windows batch independently

const compactWidthCache = new WeakMap<HTMLElement, number>();
const pendingCardsByDoc = new Map<Document, Set<HTMLElement>>();
const batchRafIds = new Map<Document, number>();

/**
 * Queue a compact card for batched wrapping detection.
 * Cache-checks internally — safe to call on every RO fire.
 */
export function queueCompactStackedCheck(
  cardEl: HTMLElement,
  cardWidth: number
): void {
  if (compactWidthCache.get(cardEl) === cardWidth) return;
  compactWidthCache.set(cardEl, cardWidth);

  const doc = cardEl.ownerDocument;
  let docPending = pendingCardsByDoc.get(doc);
  if (!docPending) {
    docPending = new Set();
    pendingCardsByDoc.set(doc, docPending);
  }
  docPending.add(cardEl);

  if (!batchRafIds.has(doc)) {
    const win = getOwnerWindow(cardEl);
    batchRafIds.set(
      doc,
      win.requestAnimationFrame(() => processCompactStackedBatch(doc))
    );
  }
}

/** Pre-seed width cache for a card element. Prevents queueCompactStackedCheck from scheduling a batch when the RO fires on a remounted card at the same width. */
export function preseedCompactStackedCache(
  cardEl: HTMLElement,
  cardWidth: number
): void {
  compactWidthCache.set(cardEl, cardWidth);
}

/** Cancel pending check + remove compact-stacked state + clear cache. */
export function cancelCompactStackedCheck(cardEl: HTMLElement): void {
  pendingCardsByDoc.get(cardEl.ownerDocument)?.delete(cardEl);
  cardEl.classList.remove('compact-stacked');
  compactWidthCache.delete(cardEl);
}

/** Clear cache entry + remove from pending batch (for content-hidden skip). */
export function invalidateCompactStackedCache(cardEl: HTMLElement): void {
  compactWidthCache.delete(cardEl);
  pendingCardsByDoc.get(cardEl.ownerDocument)?.delete(cardEl);
}

function processCompactStackedBatch(doc: Document): void {
  batchRafIds.delete(doc);
  const docPending = pendingCardsByDoc.get(doc);
  if (!docPending || docPending.size === 0) return;

  const cards = [...docPending];
  docPending.clear();
  pendingCardsByDoc.delete(doc);

  // Safety: skip disconnected, non-compact, and content-hidden cards
  const eligible = cards.filter(
    (c) =>
      c.isConnected &&
      c.classList.contains('compact-mode') &&
      !c.classList.contains(CONTENT_HIDDEN_CLASS)
  );
  if (eligible.length === 0) return;

  // Write phase: remove compact-stacked from all pending cards
  for (const cardEl of eligible) {
    cardEl.classList.remove('compact-stacked');
  }

  // Single forced reflow per document (collapses N reflows into 1)
  void eligible[0].offsetHeight;

  // Read phase: collect wrapping state for all cards
  const wrapped: boolean[] = [];
  for (const cardEl of eligible) {
    wrapped.push(hasWrappedPairs(cardEl));
  }

  // Row-level sync for Grid views: if ANY card in a row needs stacking, ALL do
  const gridCards = eligible.filter((c) => c.closest('.dynamic-views-grid'));
  // Single card has no row peers to sync
  if (gridCards.length > 1) {
    const eligibleIndex = new Map(eligible.map((el, i) => [el, i]));
    // Read top positions (no additional reflow — still in read phase)
    const tops = gridCards.map((c) => c.getBoundingClientRect().top);

    // Group by row (1px tolerance for subpixel rounding)
    const ROW_TOLERANCE = 1;
    for (let i = 0; i < gridCards.length; i++) {
      if (!wrapped[eligibleIndex.get(gridCards[i])!]) continue;
      // Propagate stacking to all cards in the same row
      for (let j = 0; j < gridCards.length; j++) {
        if (Math.abs(tops[i] - tops[j]) <= ROW_TOLERANCE) {
          wrapped[eligibleIndex.get(gridCards[j])!] = true;
        }
      }
    }
  }

  // Write phase: apply compact-stacked where needed
  for (let i = 0; i < eligible.length; i++) {
    if (wrapped[i]) {
      eligible[i].classList.add('compact-stacked');
    }
  }
}

/**
 * When pairProperties is OFF, compute which property indices should pair.
 * Single inverted props can trigger pairing (default: pair up).
 */
export function computeInvertPairs(
  props: Array<{ name: string }>,
  invertPairingSet: Set<string>
): Map<number, number> {
  const pairs = new Map<number, number>();
  const claimed = new Set<number>();

  for (let i = 0; i < props.length; i++) {
    if (claimed.has(i)) continue;
    if (!invertPairingSet.has(props[i].name)) continue;

    let partnerIdx: number;
    if (i === 0) {
      partnerIdx = 1;
    } else if (
      i + 1 < props.length &&
      invertPairingSet.has(props[i + 1].name)
    ) {
      partnerIdx = i + 1;
    } else {
      partnerIdx = i - 1;
    }

    if (
      partnerIdx >= 0 &&
      partnerIdx < props.length &&
      !claimed.has(partnerIdx)
    ) {
      const leftIdx = Math.min(i, partnerIdx);
      const rightIdx = Math.max(i, partnerIdx);
      pairs.set(leftIdx, rightIdx);
      claimed.add(leftIdx);
      claimed.add(rightIdx);
    }
  }
  return pairs;
}
