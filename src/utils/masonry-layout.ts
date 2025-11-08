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
    cardMinWidth: number;
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
export function calculateMasonryLayout(params: MasonryLayoutParams): MasonryLayoutResult {
    const { cards, containerWidth, cardMinWidth, minColumns, gap } = params;

    // Calculate number of columns
    const columns = Math.max(
        minColumns,
        Math.floor((containerWidth + gap) / (cardMinWidth + gap))
    );

    // Calculate card width based on columns
    const cardWidth = (containerWidth - (gap * (columns - 1))) / columns;

    // Initialize column heights
    const columnHeights: number[] = new Array(columns).fill(0) as number[];
    const positions: MasonryPosition[] = [];

    // Calculate positions for each card
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
        columns
    };
}

/**
 * Apply masonry layout directly to DOM elements
 * Used when bypassing React for performance
 */
export function applyMasonryLayout(
    container: HTMLElement,
    cards: HTMLElement[],
    result: MasonryLayoutResult
): void {
    // Set container properties
    container.style.position = 'relative';
    container.style.height = `${result.containerHeight}px`;

    // Position each card
    cards.forEach((card, index) => {
        const pos = result.positions[index];
        card.style.position = 'absolute';
        card.style.width = `${result.cardWidth}px`;
        card.style.left = `${pos.left}px`;
        card.style.top = `${pos.top}px`;
        card.style.transition = 'none';
    });
}
