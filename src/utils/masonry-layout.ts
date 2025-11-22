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

export interface MasonryLayoutResult {
  positions: MasonryPosition[];
  columnHeights: number[];
  containerHeight: number;
  cardWidth: number;
  columns: number;
}

/**
 * Calculate masonry layout positions for cards
 * Pure function - no side effects
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
  const cardWidth = (containerWidth - gap * (columns - 1)) / columns;

  // Initialize column heights
  const columnHeights: number[] = new Array(columns).fill(0) as number[];
  const positions: MasonryPosition[] = [];

  cards.forEach((card) => {
    // Find shortest column
    const shortestColumn = columnHeights.indexOf(Math.min(...columnHeights));

    // Calculate position
    const left = shortestColumn * (cardWidth + gap);
    const top = columnHeights[shortestColumn];

    positions.push({ left, top });

    // Update column height using card's current height
    const cardHeight = card.offsetHeight;
    columnHeights[shortestColumn] += cardHeight + gap;
  });

  // Calculate container height
  const containerHeight = Math.max(...columnHeights);

  return {
    positions,
    columnHeights,
    containerHeight,
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
