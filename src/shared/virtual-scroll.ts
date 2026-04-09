/**
 * Virtual scrolling for card views
 * Only renders cards within pane + buffer; unmounted cards are lightweight JS objects
 */

import type { BasesEntry } from 'obsidian';
import type { CardData } from './card-data';
import type { CardHandle } from '../bases/shared-renderer';
import {
  UNMEASURED_CARD_HEIGHT,
  FIXED_COVER_HEIGHT_MASONRY,
  FIXED_COVER_HEIGHT_BOTH,
  FIXED_COVER_HEIGHT_NONE,
} from './constants';

/** Lightweight representation of a card's position and data when unmounted */
export interface VirtualItem {
  /** Position in the flat card list (grid caches via rebuildGroupIndex) */
  index: number;
  /** X offset within group container */
  x: number;
  /** Y offset within group container */
  y: number;
  /** Card width */
  width: number;
  /** Current height (may be proportionally scaled or row-stretched for grid) */
  height: number;
  /** Height at original measurement width (or estimated height for unmounted items after resize) */
  measuredHeight: number;
  /** Card width when height was DOM-measured (not scaled) */
  measuredAtWidth: number;
  /** Height of scalable portion (top/bottom cover) at measurement width */
  scalableHeight: number;
  /** Height of fixed portion (header, properties, text preview) at measurement width */
  fixedHeight: number;
  /** Normalized card data for rendering */
  cardData: CardData;
  /** Bases entry for rendering */
  entry: BasesEntry;
  /** Column index (masonry: stable across same-column-count resize; grid: unused) */
  col: number;
  /** Group key (undefined for ungrouped) */
  groupKey: string | undefined;
  /** Cached compact-stacked state — persists across virtual scroll mount/unmount to avoid forced layout from wrapping detection during momentum scroll */
  compactStacked: boolean;
  /** True after the card has been mounted at least once (distinguishes remount from first mount) */
  hasBeenMounted: boolean;
  /** DOM element when mounted, null when unmounted */
  el: HTMLElement | null;
  /** Cleanup handle when mounted, null when unmounted */
  handle: CardHandle | null;
}

export interface ScrollAnchor {
  // cardData.path — file identity
  path: string;
  // scrollTop - cardAbsoluteTop (px above pane top)
  offset: number;
  // position in virtualItems (for count expansion)
  index: number;
}

// Find topmost-leftmost mounted card with >=1px visible
export function getScrollAnchor(
  virtualItems: VirtualItem[],
  cachedGroupOffsets: Map<string | undefined, number>,
  scrollTop: number,
  paneHeight: number
): ScrollAnchor | null {
  const bottom = scrollTop + paneHeight;
  let bestY = Infinity;
  let bestX = Infinity;
  let bestItem: VirtualItem | null = null;

  for (const item of virtualItems) {
    if (item.el === null) continue;
    const absoluteY = (cachedGroupOffsets.get(item.groupKey) ?? 0) + item.y;
    // Card is visible if at least 1px overlaps the pane
    if (absoluteY + item.height <= scrollTop || absoluteY >= bottom) continue;
    if (absoluteY < bestY || (absoluteY === bestY && item.x < bestX)) {
      bestY = absoluteY;
      bestX = item.x;
      bestItem = item;
    }
  }

  if (!bestItem) return null;
  return {
    path: bestItem.cardData.path,
    offset: scrollTop - bestY,
    index: bestItem.index,
  };
}

// Find anchor card's current absolute Y by path
export function getAnchorTop(
  anchorPath: string,
  virtualItems: VirtualItem[],
  cachedGroupOffsets: Map<string | undefined, number>
): number | null {
  for (const item of virtualItems) {
    if (item.cardData.path === anchorPath) {
      return (cachedGroupOffsets.get(item.groupKey) ?? 0) + item.y;
    }
  }
  return null;
}

/** Check if fixed cover height is active for this card's view context.
 *  Masonry: explicit opt-in (-masonry or -both).
 *  Grid: default on — off only when -masonry or -none is explicit.
 *  Matches CSS :not(-masonry, -none) fallback (no class = fixed height on). */
function isFixedCoverHeight(cardEl: HTMLElement): boolean {
  const body = cardEl.ownerDocument.body;
  const isMasonry = !!cardEl.closest('.dynamic-views-masonry');
  if (isMasonry) {
    return (
      body.classList.contains(FIXED_COVER_HEIGHT_MASONRY) ||
      body.classList.contains(FIXED_COVER_HEIGHT_BOTH)
    );
  }
  // Grid: fixed height is OFF only when -masonry or -none is explicitly set
  return (
    !body.classList.contains(FIXED_COVER_HEIGHT_MASONRY) &&
    !body.classList.contains(FIXED_COVER_HEIGHT_NONE)
  );
}

/**
 * Measure the scalable portion of a card's height.
 * Only top/bottom covers scale linearly with card width (aspect ratio preserved).
 * Side covers, thumbnails, and backdrop are non-scalable. Poster cards with images
 * are fully scalable (CSS aspect-ratio determines entire height).
 */
export function measureScalableHeight(cardEl: HTMLElement): number {
  // Poster cards with images: entire height is scalable (CSS aspect-ratio).
  // No isFixedPosterHeight check needed — unlike covers (which use height:0 + padding-top
  // that doesn't scale), poster cards use aspect-ratio in both fixed and dynamic modes,
  // so height always scales linearly with card width.
  if (
    cardEl.classList.contains('image-format-poster') &&
    cardEl.querySelector('.card-poster')
  ) {
    return cardEl.offsetHeight;
  }
  if (
    !cardEl.classList.contains('card-cover-top') &&
    !cardEl.classList.contains('card-cover-bottom')
  ) {
    return 0;
  }
  // Fixed cover height: CSS-determined, doesn't scale with width
  if (isFixedCoverHeight(cardEl)) {
    return 0;
  }
  const wrapper = cardEl.querySelector<HTMLElement>(
    ':scope > .card-cover-wrapper'
  );
  return wrapper ? wrapper.offsetHeight : 0;
}

/**
 * Estimate the height of an unmounted card using split proportional scaling.
 * Cover area scales linearly with card width (aspect ratio preserved).
 * Text content (header, properties, text preview) scales as sqrt(widthRatio).
 * k=0.5 minimizes average absolute error empirically — text reflow is discrete
 * (lines wrap at specific thresholds), so lower k avoids overpredicting growth
 * for items that don't reflow at a given width change.
 */
export function estimateUnmountedHeight(
  item: Pick<
    VirtualItem,
    'scalableHeight' | 'fixedHeight' | 'measuredAtWidth' | 'height'
  >,
  cardWidth: number
): number {
  if (item.measuredAtWidth > 0 && cardWidth > 0) {
    // Cover area scales linearly with width (aspect ratio preserved).
    // Text content (header, properties, text preview) wraps more at narrower
    // widths and less at wider widths — approximate as sqrt(widthRatio).
    // k=0.5 minimizes average absolute error empirically: text reflow is discrete
    // (lines either wrap or don't), so lower k avoids overpredicting growth for
    // items that don't actually reflow at a given width change.
    const widthRatio = item.measuredAtWidth / cardWidth;
    return (
      item.scalableHeight * (cardWidth / item.measuredAtWidth) +
      item.fixedHeight * Math.sqrt(widthRatio)
    );
  }
  return item.height > 0 ? item.height : UNMEASURED_CARD_HEIGHT;
}
