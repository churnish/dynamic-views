/**
 * Shared property type helpers
 * Used by both Bases (shared-renderer.ts) and Datacore (card-renderer.tsx) renderers
 */

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
