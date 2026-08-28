/**
 * Masonry layout logic
 * Pure positioning calculations - no DOM manipulation
 */

export interface MasonryPosition {
  left: number;
  top: number;
}

export interface MasonryLayoutParams {
  cards: HTMLElement[];
  containerWidth: number;
  cardSize: number; // Represents minimum width; actual width may be larger to fill space
  minColumns: number;
  gap: number;
  heights?: number[]; // Pre-measured heights — all production callers provide them; the DOM-read fallback is a safety net
}

export interface IncrementalMasonryParams {
  newCards: HTMLElement[];
  columnHeights: number[]; // From previous layout result
  containerWidth: number; // For result continuity
  cardWidth: number;
  columns: number;
  gap: number;
  heights?: number[]; // Optional pre-measured heights to avoid reflows
}

export interface MasonryLayoutResult {
  positions: MasonryPosition[];
  columnHeights: number[];
  containerHeight: number;
  containerWidth: number;
  cardWidth: number;
  columns: number;
  heights?: number[]; // Card heights used in this layout
  measuredAtCardWidth?: number; // cardWidth when heights were DOM-measured (not scaled)
  columnAssignments: number[]; // Column index for each card — authoritative source during stable resize
}

/**
 * Calculate grid dimensions (columns and card width) without measuring heights
 * Used to pre-set card widths before height measurement
 */
export function calculateMasonryDimensions(params: {
  containerWidth: number;
  cardSize: number;
  minColumns: number;
  gap: number;
}): { columns: number; cardWidth: number } {
  // Validate inputs - clamp negative values to 0
  const containerWidth = Math.max(0, params.containerWidth);
  const cardSize = Math.max(0, params.cardSize);
  const minColumns = Math.max(1, params.minColumns);
  const gap = Math.max(0, params.gap);

  const columns = Math.max(
    minColumns,
    Math.floor((containerWidth + gap) / (cardSize + gap))
  );

  // Clamp: degenerate panes (narrower than the gaps alone) must not yield negative widths
  const cardWidth = Math.max(
    0,
    columns > 0
      ? (containerWidth - gap * (columns - 1)) / columns
      : containerWidth
  );

  return { columns, cardWidth };
}

/** Index of the shortest column — the greedy placement target. */
function findShortestColumn(columnHeights: number[]): number {
  let shortest = 0;
  let minHeight = columnHeights[0];
  for (let i = 1; i < columnHeights.length; i++) {
    if (columnHeights[i] < minHeight) {
      minHeight = columnHeights[i];
      shortest = i;
    }
  }
  return shortest;
}

// Subtract the trailing gap after the last row; guard empty columns; round to avoid float accumulation
function finalizeContainerHeight(columnHeights: number[], gap: number): number {
  const maxHeight = columnHeights.length > 0 ? Math.max(...columnHeights) : 0;
  return Math.round(maxHeight > 0 ? maxHeight - gap : 0);
}

/**
 * Calculate masonry layout positions for cards
 * IMPORTANT: Cards should already have their width set via style.width
 * to ensure accurate height measurements (text wrapping depends on width)
 */
export function calculateMasonryLayout(
  params: MasonryLayoutParams
): MasonryLayoutResult {
  const { cards, heights: preHeights } = params;
  // Validate inputs - clamp negative values to 0 (calculateMasonryDimensions clamps its own inputs)
  const containerWidth = Math.max(0, params.containerWidth);
  const gap = Math.max(0, params.gap);
  const { columns, cardWidth } = calculateMasonryDimensions({
    containerWidth: params.containerWidth,
    cardSize: params.cardSize,
    minColumns: params.minColumns,
    gap: params.gap,
  });

  // Initialize column heights
  const columnHeights: number[] = new Array(columns).fill(0) as number[];
  const positions: MasonryPosition[] = [];
  const columnAssignments: number[] = [];

  // Use pre-measured heights if provided and valid (avoids reflow in grouped mode),
  // otherwise batch read all card heights in single pass
  const heights =
    preHeights && preHeights.length === cards.length
      ? preHeights
      : cards.map((card) => card.offsetHeight);

  for (let index = 0; index < cards.length; index++) {
    const shortestColumn = findShortestColumn(columnHeights);

    // Calculate position
    const left = shortestColumn * (cardWidth + gap);
    const top = columnHeights[shortestColumn];

    positions.push({ left, top });
    columnAssignments.push(shortestColumn);

    // Update column height using pre-measured height
    const cardHeight = heights[index];
    columnHeights[shortestColumn] += cardHeight + gap;
  }

  const containerHeight = finalizeContainerHeight(columnHeights, gap);

  return {
    positions,
    columnHeights,
    containerHeight,
    containerWidth,
    cardWidth,
    columns,
    heights,
    columnAssignments,
  };
}

/**
 * Calculate incremental masonry layout for newly appended cards
 * Continues from previous column heights - existing cards don't move
 */
export function calculateIncrementalMasonryLayout(
  params: IncrementalMasonryParams
): MasonryLayoutResult {
  const {
    newCards,
    columnHeights: prevColumnHeights,
    containerWidth,
    cardWidth,
    columns,
    gap,
    heights: preHeights,
  } = params;

  // Clone column heights to avoid mutating previous state
  const columnHeights = [...prevColumnHeights];
  const positions: MasonryPosition[] = [];
  const columnAssignments: number[] = [];

  // Use pre-measured heights if provided and valid, otherwise batch read
  const heights =
    preHeights && preHeights.length === newCards.length
      ? preHeights
      : newCards.map((card) => card.offsetHeight);

  for (let index = 0; index < newCards.length; index++) {
    const shortestColumn = findShortestColumn(columnHeights);

    // Calculate position
    const left = shortestColumn * (cardWidth + gap);
    const top = columnHeights[shortestColumn];

    positions.push({ left, top });
    columnAssignments.push(shortestColumn);

    // Update column height
    const cardHeight = heights[index];
    columnHeights[shortestColumn] += cardHeight + gap;
  }

  const containerHeight = finalizeContainerHeight(columnHeights, gap);

  return {
    positions,
    columnHeights,
    containerHeight,
    containerWidth,
    cardWidth,
    columns,
    heights,
    measuredAtCardWidth: cardWidth,
    columnAssignments,
  };
}

export interface StableRepositionParams {
  /** Updated heights (DOM-measured for mounted, proportional for unmounted) */
  newHeights: number[];
  columns: number;
  cardWidth: number;
  gap: number;
  /** Authoritative column assignments from prior layout — used directly when
   *  available, bypassing all position-based derivation. */
  columnAssignments?: number[];
  /** Fallback: existing positions for column derivation when columnAssignments
   *  is unavailable (e.g. first layout after upgrade). */
  existingPositions?: MasonryPosition[];
  /** Card width when existingPositions were computed. Only used for position-based
   *  fallback derivation. */
  existingCardWidth?: number;
}

/**
 * Reposition cards with stable column assignment — only vertical positions change.
 * Uses stored column assignments directly when available; falls back to deriving
 * columns from existing positions for backwards compatibility.
 */
export function repositionWithStableColumns(params: StableRepositionParams): {
  positions: MasonryPosition[];
  containerHeight: number;
  columnHeights: number[];
  columnAssignments: number[];
} {
  const {
    newHeights,
    columns,
    cardWidth,
    gap,
    columnAssignments: priorCols,
    existingPositions,
    existingCardWidth,
  } = params;
  const columnHeights = new Array(columns).fill(0) as number[];
  const positions: MasonryPosition[] = [];
  const columnAssignments: number[] = [];

  // Fallback step size for position-based derivation (only when priorCols unavailable)
  const colStep = (existingCardWidth ?? cardWidth) + gap;

  const count = priorCols?.length ?? existingPositions?.length ?? 0;
  const heightCount = Math.min(count, newHeights.length);
  for (let i = 0; i < heightCount; i++) {
    let col: number;
    if (priorCols && i < priorCols.length) {
      // Authoritative: stored column index — immune to width/rounding changes
      col = Math.min(priorCols[i], columns - 1);
    } else if (existingPositions && columns > 1) {
      // Fallback: derive from position (legacy path)
      col = Math.min(
        Math.round(existingPositions[i].left / colStep),
        columns - 1
      );
    } else {
      col = 0;
    }
    const left = col * (cardWidth + gap);
    const top = columnHeights[col];
    positions.push({ left, top });
    columnAssignments.push(col);
    columnHeights[col] += newHeights[i] + gap;
  }

  const containerHeight = finalizeContainerHeight(columnHeights, gap);

  return { positions, containerHeight, columnHeights, columnAssignments };
}

/**
 * Compute greedy shortest-column heights without allocating positions.
 * Used to check if repositionWithStableColumns introduced excessive imbalance.
 */
export function computeGreedyColumnHeights(
  heights: number[],
  columns: number,
  gap: number
): number[] {
  const columnHeights = new Array(columns).fill(0) as number[];
  for (let i = 0; i < heights.length; i++) {
    columnHeights[findShortestColumn(columnHeights)] += heights[i] + gap;
  }
  return columnHeights;
}

/** Compute group offsets from cumulative container height deltas — zero DOM reads.
 *  Returns updated offsets map on success, or null if any group offset is unknown
 *  (caller should fall back to DOM-based offset computation). */
export function computeSyntheticGroupOffsets(
  groupKeys: Iterable<string | undefined>,
  cachedOffsets: ReadonlyMap<string | undefined, number>,
  oldContainerHeights: ReadonlyMap<string | undefined, number>,
  newContainerHeights: ReadonlyMap<string | undefined, number>
): Map<string | undefined, number> | null {
  if (cachedOffsets.size === 0) return null;
  const updated = new Map<string | undefined, number>();
  let cumulativeDelta = 0;
  for (const groupKey of groupKeys) {
    const oldOffset = cachedOffsets.get(groupKey);
    if (oldOffset === undefined) return null;
    updated.set(groupKey, oldOffset + cumulativeDelta);
    const oldH = oldContainerHeights.get(groupKey) ?? 0;
    const newH = newContainerHeights.get(groupKey) ?? 0;
    cumulativeDelta += newH - oldH;
  }
  return updated;
}
