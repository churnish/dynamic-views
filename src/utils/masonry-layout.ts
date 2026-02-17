/**
 * Shared masonry layout logic for both Bases and Datacore views
 * Pure positioning calculations - no DOM manipulation
 */

// Intentional debug toggle — flip to true for masonry layout diagnostics. Do not remove without explicit user instruction.
const DEBUG_MASONRY = false;

const logMasonry = (
  source: string,
  msg: string,
  data?: Record<string, string | number | boolean>,
) => {
  if (!DEBUG_MASONRY) return;
  const dataStr = data
    ? " | " +
      Object.entries(data)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(", ")
    : "";
  // eslint-disable-next-line no-console -- gated by DEBUG_MASONRY
  console.debug(`[masonry:${source}] ${msg}${dataStr}`);
};

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
  heights?: number[]; // Optional pre-measured heights to avoid reflows in grouped mode
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
    Math.floor((containerWidth + gap) / (cardSize + gap)),
  );

  const cardWidth =
    columns > 0
      ? (containerWidth - gap * (columns - 1)) / columns
      : containerWidth;

  logMasonry("dimensions", "calculated", {
    containerWidth,
    cardSize,
    minColumns,
    gap,
    columns,
    cardWidth: Math.round(cardWidth * 100) / 100,
  });

  return { columns, cardWidth };
}

/**
 * Calculate masonry layout positions for cards
 * IMPORTANT: Cards should already have their width set via --masonry-width
 * to ensure accurate height measurements (text wrapping depends on width)
 */
export function calculateMasonryLayout(
  params: MasonryLayoutParams,
): MasonryLayoutResult {
  const { cards, heights: preHeights } = params;
  // Validate inputs - clamp negative values to 0
  const containerWidth = Math.max(0, params.containerWidth);
  const cardSize = Math.max(0, params.cardSize);
  const minColumns = Math.max(1, params.minColumns);
  const gap = Math.max(0, params.gap);

  logMasonry("calc", "FULL LAYOUT START", {
    cardCount: cards.length,
    containerWidth,
    cardSize,
    minColumns,
    gap,
    hasPreHeights: !!preHeights,
  });

  // Calculate number of columns
  const columns = Math.max(
    minColumns,
    Math.floor((containerWidth + gap) / (cardSize + gap)),
  );

  // Calculate card width based on columns
  const cardWidth =
    columns > 0
      ? (containerWidth - gap * (columns - 1)) / columns
      : containerWidth;

  logMasonry("calc", "dimensions", {
    columns,
    cardWidth: Math.round(cardWidth * 100) / 100,
  });

  // Initialize column heights
  const columnHeights: number[] = new Array(columns).fill(0) as number[];
  const positions: MasonryPosition[] = [];

  // Use pre-measured heights if provided and valid (avoids reflow in grouped mode),
  // otherwise batch read all card heights in single pass
  const heights =
    preHeights && preHeights.length === cards.length
      ? preHeights
      : cards.map((card) => card.offsetHeight);

  for (let index = 0; index < cards.length; index++) {
    // Find shortest column - track index during search
    let shortestColumn = 0;
    let minHeight = columnHeights[0];
    for (let i = 1; i < columnHeights.length; i++) {
      if (columnHeights[i] < minHeight) {
        minHeight = columnHeights[i];
        shortestColumn = i;
      }
    }

    // Calculate position
    const left = shortestColumn * (cardWidth + gap);
    const top = columnHeights[shortestColumn];

    positions.push({ left, top });

    // Update column height using pre-measured height
    const cardHeight = heights[index];
    columnHeights[shortestColumn] += cardHeight + gap;

    // Log first 5 cards and any with zero height
    if (index < 5 || cardHeight === 0) {
      logMasonry("calc", `card[${index}]`, {
        height: cardHeight,
        col: shortestColumn,
        left: Math.round(left),
        top: Math.round(top),
        colHeightAfter: Math.round(columnHeights[shortestColumn]),
      });
    }
  }

  // Calculate container height (subtract trailing gap after last row)
  // Guard against negative height when no cards exist
  // Round to nearest pixel to avoid floating point accumulation errors
  const maxHeight = columnHeights.length > 0 ? Math.max(...columnHeights) : 0;
  const containerHeight = Math.round(maxHeight > 0 ? maxHeight - gap : 0);

  logMasonry("calc", "FULL LAYOUT END", {
    containerHeight,
    finalColHeights: columnHeights.map((h) => Math.round(h)).join(","),
  });

  return {
    positions,
    columnHeights,
    containerHeight,
    containerWidth,
    cardWidth,
    columns,
    heights,
  };
}

/**
 * Apply masonry layout directly to DOM elements
 * Used when bypassing React for performance
 */
export function applyMasonryLayout(
  container: HTMLElement,
  cards: HTMLElement[],
  result: MasonryLayoutResult,
): void {
  logMasonry("apply", "applying", {
    cardCount: cards.length,
    containerHeight: Math.round(result.containerHeight),
    cardWidth: Math.round(result.cardWidth * 100) / 100,
    columns: result.columns,
  });

  // Set container properties using CSS custom properties
  container.classList.add("masonry-container");
  container.style.setProperty(
    "--masonry-height",
    `${result.containerHeight}px`,
  );

  // Position each card using CSS custom properties
  cards.forEach((card, index) => {
    const pos = result.positions[index];
    card.classList.add("masonry-positioned");
    card.style.setProperty("--masonry-width", `${result.cardWidth}px`);
    card.style.setProperty("--masonry-left", `${pos.left}px`);
    card.style.setProperty("--masonry-top", `${pos.top}px`);

    // Log first 3 cards applied
    if (index < 3) {
      logMasonry("apply", `card[${index}] positioned`, {
        left: Math.round(pos.left),
        top: Math.round(pos.top),
        width: Math.round(result.cardWidth),
      });
    }
  });
}

/**
 * Calculate incremental masonry layout for newly appended cards
 * Continues from previous column heights - existing cards don't move
 */
export function calculateIncrementalMasonryLayout(
  params: IncrementalMasonryParams,
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

  logMasonry("incr", "INCREMENTAL LAYOUT START", {
    newCardCount: newCards.length,
    containerWidth,
    cardWidth: Math.round(cardWidth * 100) / 100,
    columns,
    gap,
    prevColHeights: prevColumnHeights.map((h) => Math.round(h)).join(","),
  });

  // Clone column heights to avoid mutating previous state
  const columnHeights = [...prevColumnHeights];
  const positions: MasonryPosition[] = [];

  // Use pre-measured heights if provided and valid, otherwise batch read
  const heights =
    preHeights && preHeights.length === newCards.length
      ? preHeights
      : newCards.map((card) => card.offsetHeight);

  for (let index = 0; index < newCards.length; index++) {
    // Find shortest column - track index during search
    let shortestColumn = 0;
    let minHeight = columnHeights[0];
    for (let i = 1; i < columnHeights.length; i++) {
      if (columnHeights[i] < minHeight) {
        minHeight = columnHeights[i];
        shortestColumn = i;
      }
    }

    // Calculate position
    const left = shortestColumn * (cardWidth + gap);
    const top = columnHeights[shortestColumn];

    positions.push({ left, top });

    // Update column height
    const cardHeight = heights[index];
    columnHeights[shortestColumn] += cardHeight + gap;

    // Log first 3 new cards
    if (index < 3) {
      logMasonry("incr", `newCard[${index}]`, {
        height: cardHeight,
        col: shortestColumn,
        left: Math.round(left),
        top: Math.round(top),
      });
    }
  }

  // Subtract trailing gap after last row
  // Guard against negative height when columns are empty
  // Round to nearest pixel to avoid floating point accumulation errors
  const maxHeight = columnHeights.length > 0 ? Math.max(...columnHeights) : 0;
  const containerHeight = Math.round(maxHeight > 0 ? maxHeight - gap : 0);

  logMasonry("incr", "INCREMENTAL LAYOUT END", {
    containerHeight,
    finalColHeights: columnHeights.map((h) => Math.round(h)).join(","),
  });

  return {
    positions,
    columnHeights,
    containerHeight,
    containerWidth,
    cardWidth,
    columns,
    heights,
    measuredAtCardWidth: cardWidth,
  };
}
