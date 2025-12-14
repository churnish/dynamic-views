/**
 * Shared masonry layout logic for both Bases and Datacore views
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
}

export interface IncrementalMasonryParams {
  newCards: HTMLElement[];
  columnHeights: number[]; // From previous layout result
  containerWidth: number; // For result continuity
  cardWidth: number;
  columns: number;
  gap: number;
}

export interface MasonryLayoutResult {
  positions: MasonryPosition[];
  columnHeights: number[];
  containerHeight: number;
  containerWidth: number;
  cardWidth: number;
  columns: number;
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
  const { containerWidth, cardSize, minColumns, gap } = params;

  const columns = Math.max(
    minColumns,
    Math.floor((containerWidth + gap) / (cardSize + gap)),
  );

  const cardWidth =
    columns > 0
      ? (containerWidth - gap * (columns - 1)) / columns
      : containerWidth;

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
  const { cards, containerWidth, cardSize, minColumns, gap } = params;

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

  // Initialize column heights
  const columnHeights: number[] = new Array(columns).fill(0) as number[];
  const positions: MasonryPosition[] = [];

  // Batch read all card heights in single pass to avoid layout thrashing
  // Reading offsetHeight in a loop forces N reflows; reading all at once forces only 1
  const heights = cards.map((card) => card.offsetHeight);

  cards.forEach((card, index) => {
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
  });

  // Calculate container height
  const containerHeight =
    columnHeights.length > 0 ? Math.max(...columnHeights) : 0;

  return {
    positions,
    columnHeights,
    containerHeight,
    containerWidth,
    cardWidth,
    columns,
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
  } = params;

  // Clone column heights to avoid mutating previous state
  const columnHeights = [...prevColumnHeights];
  const positions: MasonryPosition[] = [];

  // Batch read heights for new cards only
  const heights = newCards.map((card) => card.offsetHeight);

  newCards.forEach((card, index) => {
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
  });

  const containerHeight =
    columnHeights.length > 0 ? Math.max(...columnHeights) : 0;

  return {
    positions,
    columnHeights,
    containerHeight,
    containerWidth,
    cardWidth,
    columns,
  };
}
