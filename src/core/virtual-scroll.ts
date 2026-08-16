/**
 * Virtual scrolling for card views
 * Only renders cards within pane + buffer; unmounted cards are lightweight JS objects
 */

import type { BasesEntry } from 'obsidian';
import type { CardData, CardHandle } from './card-data';
import type { MountEstimateProfile } from '../types';
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

/** Below this the medians are noise, and a bad profile is worse than the flat
 *  average it replaces. */
const MIN_ESTIMATE_SAMPLES = 3;

/** A card counts as having an image when imageUrl holds at least one URL.
 *  Single definition — the profile builder and the deferred-mount caller must
 *  partition identically or the per-card estimate reads the wrong group. */
export function hasCardImage(cardData: Pick<CardData, 'imageUrl'>): boolean {
  const url = cardData.imageUrl;
  return Array.isArray(url) ? url.length > 0 : !!url;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Build a median height profile from DOM-measured items, split by image presence.
 * Returns null when there is not enough measured data to be worth trusting.
 */
export function buildMountEstimateProfile(
  items: Pick<
    VirtualItem,
    | 'measuredAtWidth'
    | 'measuredHeight'
    | 'scalableHeight'
    | 'fixedHeight'
    | 'cardData'
  >[],
  referenceWidth: number,
  coverWidth: number
): MountEstimateProfile | null {
  if (referenceWidth <= 0) return null;

  const imaged: { scalable: number[]; fixed: number[] } = {
    scalable: [],
    fixed: [],
  };
  const plain: { scalable: number[]; fixed: number[] } = {
    scalable: [],
    fixed: [],
  };

  for (const item of items) {
    if (item.measuredHeight <= 0) continue;
    // Unmounted items keep the width they were last DOM-measured at, so after a
    // resize the population is mixed — blending widths would skew both medians.
    if (Math.abs(item.measuredAtWidth - referenceWidth) > 1) continue;
    const bucket = hasCardImage(item.cardData) ? imaged : plain;
    bucket.scalable.push(item.scalableHeight);
    bucket.fixed.push(item.fixedHeight);
  }

  if (imaged.scalable.length + plain.scalable.length < MIN_ESTIMATE_SAMPLES) {
    return null;
  }

  const withImage = {
    scalable: median(imaged.scalable),
    fixed: median(imaged.fixed),
  };
  const withoutImage = {
    scalable: median(plain.scalable),
    fixed: median(plain.fixed),
  };

  // An empty group borrows the other's text block, which is comparable, but
  // never its cover height. Both groups cannot be empty past the sample gate.
  if (imaged.scalable.length === 0) {
    withImage.scalable = 0;
    withImage.fixed = withoutImage.fixed;
  } else if (plain.scalable.length === 0) {
    withoutImage.scalable = 0;
    withoutImage.fixed = withImage.fixed;
  }

  // Rounded because the profile is JSON-persisted in ephemeral scroll state
  return {
    withImage: {
      scalable: Math.round(withImage.scalable),
      fixed: Math.round(withImage.fixed),
    },
    withoutImage: {
      scalable: Math.round(withoutImage.scalable),
      fixed: Math.round(withoutImage.fixed),
    },
    measuredAtWidth: Math.round(referenceWidth),
    coverWidth: Math.round(Math.max(0, coverWidth)),
  };
}

/**
 * Estimate one card's mount height from a saved profile.
 * Scales the same way estimateUnmountedHeight does — cover linear with width,
 * text as sqrt — but picks the median pair by whether this card has an image.
 * `coverRatio` (contain mode only) replaces the median cover with this card's own.
 */
export function estimateCardHeight(
  profile: MountEstimateProfile,
  hasImage: boolean,
  cardWidth: number,
  coverRatio: number
): number {
  const group = hasImage ? profile.withImage : profile.withoutImage;
  if (profile.measuredAtWidth <= 0 || cardWidth <= 0) {
    return group.fixed || UNMEASURED_CARD_HEIGHT;
  }
  const widthScale = cardWidth / profile.measuredAtWidth;
  const scalable =
    coverRatio > 0 && profile.coverWidth > 0
      ? coverRatio * profile.coverWidth * widthScale
      : group.scalable * widthScale;
  const fixed = group.fixed * Math.sqrt(profile.measuredAtWidth / cardWidth);
  return Math.max(1, scalable + fixed);
}

function isEstimateGroup(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const group = value as { scalable?: unknown; fixed?: unknown };
  return typeof group.scalable === 'number' && typeof group.fixed === 'number';
}

/** Shallow structural check for a restored profile — ephemeral state is JSON
 *  round-tripped by Obsidian, so a stale or malformed shape must be dropped
 *  rather than trusted. */
export function isMountEstimateProfile(
  value: unknown
): value is MountEstimateProfile {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Partial<MountEstimateProfile>;
  return (
    isEstimateGroup(profile.withImage) &&
    isEstimateGroup(profile.withoutImage) &&
    typeof profile.measuredAtWidth === 'number' &&
    typeof profile.coverWidth === 'number'
  );
}
