/**
 * Pure poster row stretch algorithm — extracted from grid-view.ts for testability.
 *
 * In mixed rows (poster + imageless cards), poster cards stay at aspect-ratio
 * height while imageless cards use natural content height. When imageless cards
 * are taller, stretch poster cards to match via min-height. aspect-ratio must
 * be cleared to prevent width expansion (aspect-ratio + min-height = wider card).
 */

import {
  ALIGN_START_CLASS,
  POSTER_STRETCH_CLASS,
  POSTER_ROW_MIN_HEIGHT_VAR,
  POSTER_ASPECT_OVERRIDE_VAR,
} from './constants';

export interface PosterStretchItem {
  el: HTMLElement | null;
}

export interface PosterStretchInput {
  virtualItemsByGroup: Map<string | undefined, PosterStretchItem[]>;
  columns: number;
  stretchNoopKey: number;
  imageReadyCount: number;
  compactStackedCount: number;
}

/** Computes poster stretch for mixed rows and returns the new stretchNoopKey. */
export function computePosterStretch(input: PosterStretchInput): number {
  // Bail out if the last run produced no changes and card composition
  // hasn't changed — prevents RO→stretch→RO feedback from wasting cycles
  let totalItems = 0;
  for (const [, items] of input.virtualItemsByGroup) totalItems += items.length;
  const stretchInputKey =
    totalItems * 1_000_000 +
    input.imageReadyCount * 10_000 +
    input.compactStackedCount * 100 +
    input.columns;
  if (stretchInputKey === input.stretchNoopKey) return input.stretchNoopKey;

  // Phase 0 — write: clear inflation sources so measurements reflect natural
  // heights. Poster stretch inflates poster cards via min-height; CSS Grid row
  // stretch inflates imageless cards to match. Both must be neutralized.
  let prevStretchCount = 0;
  let prevStretchHash = 0;
  const alignResetEls: HTMLElement[] = [];
  for (const [, groupItems] of input.virtualItemsByGroup) {
    for (const item of groupItems) {
      const el = item.el;
      if (!el?.isConnected) continue;
      const isPoster =
        el.classList.contains('image-format-poster') &&
        el.classList.contains('has-poster');
      if (isPoster) {
        if (el.classList.contains(POSTER_STRETCH_CLASS)) {
          prevStretchCount++;
          prevStretchHash =
            prevStretchHash * 31 +
            (parseInt(el.style.getPropertyValue(POSTER_ROW_MIN_HEIGHT_VAR)) ||
              0);
          el.style.removeProperty(POSTER_ROW_MIN_HEIGHT_VAR);
          el.style.removeProperty(POSTER_ASPECT_OVERRIDE_VAR);
          el.classList.remove(POSTER_STRETCH_CLASS);
        }
        // Non-stretched posters need no action — aspect-ratio determines height
      } else {
        el.classList.add(ALIGN_START_CLASS);
        alignResetEls.push(el);
      }
    }
  }

  // Phase 1 — read: collect natural heights in one pass (single reflow).
  // equalizeRowPosterHeights (called before this method) may have dirtied
  // layout; reading heights inside the row loop would re-trigger reflow per row.
  const heightMap = new Map<HTMLElement, number>();
  for (const [, groupItems] of input.virtualItemsByGroup) {
    for (const item of groupItems) {
      const el = item.el;
      if (!el?.isConnected) continue;
      heightMap.set(el, el.getBoundingClientRect().height);
    }
  }

  // Phase 2 — write: restore alignment after measurement
  for (const el of alignResetEls) {
    el.classList.remove(ALIGN_START_CLASS);
  }

  // Phase 3 — read: collect all row decisions without writing styles
  const rowActions: {
    posterEls: HTMLElement[];
    action: 'stretch' | 'unstretch';
    value: string;
  }[] = [];

  for (const [, groupItems] of input.virtualItemsByGroup) {
    for (
      let rowStart = 0;
      rowStart < groupItems.length;
      rowStart += input.columns
    ) {
      const rowEnd = Math.min(rowStart + input.columns, groupItems.length);
      const posterEls: HTMLElement[] = [];
      let maxImagelessHeight = 0;

      for (let i = rowStart; i < rowEnd; i++) {
        const el = groupItems[i].el;
        if (!el?.isConnected) continue;
        if (
          el.classList.contains('image-format-poster') &&
          el.classList.contains('has-poster')
        ) {
          posterEls.push(el);
        } else {
          const h = heightMap.get(el) ?? 0;
          if (h > maxImagelessHeight) maxImagelessHeight = h;
        }
      }

      // All-poster or all-imageless rows: clean up any stale stretch state
      if (posterEls.length === 0 || maxImagelessHeight === 0) {
        rowActions.push({ posterEls, action: 'unstretch', value: '' });
        continue;
      }

      const posterHeight = heightMap.get(posterEls[0]) ?? 0;
      const targetHeight = Math.round(maxImagelessHeight);
      const value = targetHeight + 'px';

      if (maxImagelessHeight > posterHeight) {
        rowActions.push({ posterEls, action: 'stretch', value });
      } else {
        rowActions.push({ posterEls, action: 'unstretch', value: '' });
      }
    }
  }

  // Phase 4 — write: apply all style changes without interleaved reads
  for (const { posterEls, action, value } of rowActions) {
    if (action === 'stretch') {
      for (const el of posterEls) {
        el.setCssProps({
          [POSTER_ROW_MIN_HEIGHT_VAR]: value,
          [POSTER_ASPECT_OVERRIDE_VAR]: 'auto',
        });
        el.classList.add(POSTER_STRETCH_CLASS);
      }
    } else {
      for (const el of posterEls) {
        if (!el.classList.contains(POSTER_STRETCH_CLASS)) continue;
        el.style.removeProperty(POSTER_ROW_MIN_HEIGHT_VAR);
        el.style.removeProperty(POSTER_ASPECT_OVERRIDE_VAR);
        el.classList.remove(POSTER_STRETCH_CLASS);
      }
    }
  }

  // Set bail-out key when output matches input — next call with same
  // composition can skip the full clear-measure-reapply cycle
  let newStretchCount = 0;
  let newStretchHash = 0;
  for (const { posterEls, action, value } of rowActions) {
    if (action === 'stretch') {
      for (let j = 0; j < posterEls.length; j++) {
        newStretchCount++;
        newStretchHash = newStretchHash * 31 + (parseInt(value) || 0);
      }
    }
  }
  return newStretchCount === prevStretchCount &&
    newStretchHash === prevStretchHash
    ? stretchInputKey
    : 0;
}
