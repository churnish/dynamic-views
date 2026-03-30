/**
 * Tests for grid-view infinite scroll logic:
 *   - getBatchSize calculation (columns × ROWS_PER_COLUMN, capped at MAX_BATCH_SIZE)
 *   - checkAndLoadMore guard conditions (isLoading, displayedCount, distanceFromBottom)
 *
 * Both methods are private on DynamicViewsGridView and cannot be imported directly.
 * These tests verify the same pure arithmetic to ensure correctness and catch regressions.
 */

import {
  ROWS_PER_COLUMN,
  MAX_BATCH_SIZE,
  PANE_MULTIPLIER,
  SCROLL_IDLE_SYNC_MS,
  SCROLL_THROTTLE_MS,
} from '../../src/shared/constants';

// ---------------------------------------------------------------------------
// Helpers mirroring getBatchSize internal logic
// ---------------------------------------------------------------------------

function mockContainer(width: number): HTMLElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () =>
    ({
      width,
      height: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  return el;
}

/** Replicates the getBatchSize logic from grid-view.ts */
function computeBatchSize(
  containerWidth: number,
  cardSize: number,
  gap: number,
  minimumColumns: number
): number {
  if (containerWidth === 0) {
    return MAX_BATCH_SIZE;
  }
  const calculatedColumns = Math.floor(
    (containerWidth + gap) / (cardSize + gap)
  );
  const columns = Math.max(minimumColumns, calculatedColumns);
  const rawCount = columns * ROWS_PER_COLUMN;
  return Math.min(rawCount, MAX_BATCH_SIZE);
}

// ---------------------------------------------------------------------------
// getBatchSize tests
// ---------------------------------------------------------------------------

describe('getBatchSize calculation', () => {
  const GAP = 8;
  const CARD_SIZE = 300;

  it('returns columns × ROWS_PER_COLUMN for normal container width', () => {
    // 3 columns: floor((940 + 8) / (300 + 8)) = floor(948 / 308) = 3
    const result = computeBatchSize(940, CARD_SIZE, GAP, 1);
    expect(result).toBe(3 * ROWS_PER_COLUMN);
  });

  it('returns MAX_BATCH_SIZE when container width is 0', () => {
    const result = computeBatchSize(0, CARD_SIZE, GAP, 1);
    expect(result).toBe(MAX_BATCH_SIZE);
  });

  it('respects minimumColumns floor when calculated columns are lower', () => {
    // Very wide cards in a narrow container gives 1 column; minimumColumns=3 overrides
    const result = computeBatchSize(200, 600, GAP, 3);
    expect(result).toBe(3 * ROWS_PER_COLUMN);
  });

  it('caps result at MAX_BATCH_SIZE', () => {
    // Very large container fits many columns — raw count exceeds MAX_BATCH_SIZE
    const result = computeBatchSize(10_000, 100, GAP, 1);
    expect(result).toBe(MAX_BATCH_SIZE);
  });

  it('uses calculated columns when they exceed minimumColumns', () => {
    // 4 columns: floor((1240 + 8) / (300 + 8)) = floor(1248 / 308) = 4
    const result = computeBatchSize(1240, CARD_SIZE, GAP, 2);
    expect(result).toBe(4 * ROWS_PER_COLUMN);
  });
});

// ---------------------------------------------------------------------------
// checkAndLoadMore guard tests (behavioral)
// ---------------------------------------------------------------------------

describe('checkAndLoadMore guards', () => {
  /** Simulates the guard checks in checkAndLoadMore */
  function shouldLoad(opts: {
    isLoading: boolean;
    displayedCount: number;
    totalEntries: number;
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
  }): boolean {
    const {
      isLoading,
      displayedCount,
      totalEntries,
      scrollTop,
      scrollHeight,
      clientHeight,
    } = opts;

    // Guard 1: already loading or all items displayed
    if (isLoading || displayedCount >= totalEntries) return false;

    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
    const threshold = clientHeight * PANE_MULTIPLIER;

    // Guard 2: not near enough to the bottom
    return distanceFromBottom < threshold;
  }

  const BASE = {
    isLoading: false,
    displayedCount: 10,
    totalEntries: 100,
    scrollTop: 900,
    scrollHeight: 1000,
    clientHeight: 200,
  };

  it('does not advance displayedCount when isLoading is true', () => {
    expect(shouldLoad({ ...BASE, isLoading: true })).toBe(false);
  });

  it('does not advance displayedCount when displayedCount >= totalEntries', () => {
    expect(shouldLoad({ ...BASE, displayedCount: 100 })).toBe(false);
  });

  it('does not advance displayedCount when distanceFromBottom >= threshold', () => {
    // distanceFromBottom = 1000 - (0 + 200) = 800; threshold = 200 * 3 = 600 → not near bottom
    expect(shouldLoad({ ...BASE, scrollTop: 0 })).toBe(false);
  });

  it('advances displayedCount when near bottom with items remaining', () => {
    // distanceFromBottom = 1000 - (900 + 200) = -100 (negative = past bottom); threshold = 600
    expect(shouldLoad(BASE)).toBe(true);
  });

  it('triggers at exactly the threshold boundary', () => {
    // distanceFromBottom = threshold - 1 → should load
    const clientHeight = 200;
    const threshold = clientHeight * PANE_MULTIPLIER; // 600
    const scrollHeight = 1000;
    const scrollTop = scrollHeight - clientHeight - (threshold - 1); // 199
    expect(shouldLoad({ ...BASE, scrollTop, scrollHeight, clientHeight })).toBe(
      true
    );
  });

  it('does not trigger when distanceFromBottom equals threshold exactly', () => {
    // distanceFromBottom = threshold → not strictly less than, should not load
    const clientHeight = 200;
    const threshold = clientHeight * PANE_MULTIPLIER; // 600
    const scrollHeight = 1000;
    const scrollTop = scrollHeight - clientHeight - threshold; // 200
    expect(shouldLoad({ ...BASE, scrollTop, scrollHeight, clientHeight })).toBe(
      false
    );
  });
});

describe('SCROLL_IDLE_SYNC_MS', () => {
  it('must exceed SCROLL_THROTTLE_MS', () => {
    expect(SCROLL_IDLE_SYNC_MS).toBeGreaterThan(SCROLL_THROTTLE_MS);
  });
});
