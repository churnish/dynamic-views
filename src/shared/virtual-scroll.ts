/**
 * Virtual scrolling for masonry view
 * Only renders cards within viewport + buffer; unmounted cards are lightweight JS objects
 */

import type { BasesEntry } from "obsidian";
import type { CardData } from "./card-renderer";
import type { CardHandle } from "../bases/shared-renderer";

/** Lightweight representation of a card's position and data when unmounted */
export interface VirtualItem {
  /** Position in the flat card list */
  index: number;
  /** --masonry-left value */
  x: number;
  /** --masonry-top value */
  y: number;
  /** --masonry-width value */
  width: number;
  /** Current height (may be proportionally scaled) */
  height: number;
  /** Height at original measurement width */
  measuredHeight: number;
  /** cardWidth when height was DOM-measured (not scaled) */
  measuredAtWidth: number;
  /** Height of scalable portion (top/bottom cover) at measurement width */
  scalableHeight: number;
  /** Height of fixed portion (header, properties, preview) at measurement width */
  fixedHeight: number;
  /** Normalized card data for rendering */
  cardData: CardData;
  /** Bases entry for rendering */
  entry: BasesEntry;
  /** Column index in the masonry grid (stable across same-column-count resize) */
  col: number;
  /** Group key (undefined for ungrouped) */
  groupKey: string | undefined;
  /** DOM element when mounted, null when unmounted */
  el: HTMLElement | null;
  /** Cleanup handle when mounted, null when unmounted */
  handle: CardHandle | null;
}

/**
 * Measure the scalable portion of a card's height.
 * Only top/bottom covers scale linearly with card width (aspect ratio preserved).
 * Side covers, thumbnails, poster/backdrop, and fixed-cover-height are non-scalable.
 */
export function measureScalableHeight(cardEl: HTMLElement): number {
  if (
    !cardEl.classList.contains("card-cover-top") &&
    !cardEl.classList.contains("card-cover-bottom")
  ) {
    return 0;
  }
  // Fixed cover height: CSS-determined, doesn't scale with width
  if (
    document.body.classList.contains("dynamic-views-masonry-fixed-cover-height")
  ) {
    return 0;
  }
  const wrapper = cardEl.querySelector<HTMLElement>(
    ":scope > .card-cover-wrapper",
  );
  return wrapper ? wrapper.offsetHeight : 0;
}

/**
 * Estimate the height of an unmounted card using split proportional scaling.
 * Cover area scales linearly with card width; text content stays fixed.
 */
export function estimateUnmountedHeight(
  item: Pick<
    VirtualItem,
    "scalableHeight" | "fixedHeight" | "measuredAtWidth" | "height"
  >,
  cardWidth: number,
): number {
  if (item.measuredAtWidth > 0) {
    return (
      item.scalableHeight * (cardWidth / item.measuredAtWidth) +
      item.fixedHeight
    );
  }
  return item.height;
}

/**
 * Sync mounted/unmounted state for a list of items based on scroll position.
 * Items within viewport + buffer are mounted; items outside are unmounted.
 *
 * @param containerOffsetY - Position of the items' container top edge within
 *   the scroll container's scrollable area (container.getBoundingClientRect().top
 *   - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop)
 * @public
 */
export function syncVisibleItems(
  items: VirtualItem[],
  scrollTop: number,
  viewportHeight: number,
  containerOffsetY: number,
  bufferPx: number,
  onMount: (item: VirtualItem) => void,
  onUnmount: (item: VirtualItem) => void,
): void {
  const visibleTop = scrollTop - bufferPx;
  const visibleBottom = scrollTop + viewportHeight + bufferPx;

  for (const item of items) {
    const itemTop = containerOffsetY + item.y;
    const itemBottom = itemTop + item.height;
    const inView = itemBottom > visibleTop && itemTop < visibleBottom;

    if (inView && !item.el) {
      onMount(item);
    } else if (!inView && item.el) {
      onUnmount(item);
    }
  }
}
