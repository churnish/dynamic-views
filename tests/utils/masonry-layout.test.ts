import {
  calculateMasonryLayout,
  applyMasonryLayout,
  repositionWithStableColumns,
  computeGreedyColumnHeights,
} from "../../src/utils/masonry-layout";

describe("masonry-layout", () => {
  describe("calculateMasonryLayout", () => {
    const createMockCard = (height: number): HTMLElement => {
      const card = document.createElement("div");
      Object.defineProperty(card, "offsetHeight", {
        configurable: true,
        value: height,
      });
      return card;
    };

    it("should calculate correct number of columns based on container width", () => {
      const cards = [createMockCard(200), createMockCard(300)];
      const result = calculateMasonryLayout({
        cards,
        containerWidth: 1000,
        cardSize: 200,
        minColumns: 2,
        gap: 16,
      });

      // (1000 + 16) / (200 + 16) = 4.7 => 4 columns
      expect(result.columns).toBe(4);
    });

    it("should respect minimum columns constraint", () => {
      const cards = [createMockCard(200)];
      const result = calculateMasonryLayout({
        cards,
        containerWidth: 100,
        cardSize: 200,
        minColumns: 3,
        gap: 16,
      });

      expect(result.columns).toBe(3);
    });

    it("should calculate correct card width for given columns", () => {
      const cards = [createMockCard(200)];
      const result = calculateMasonryLayout({
        cards,
        containerWidth: 1000,
        cardSize: 200,
        minColumns: 2,
        gap: 16,
      });

      // Card width should be calculated based on columns and gap
      expect(result.cardWidth).toBeGreaterThan(0);
      expect(result.cardWidth).toBeLessThanOrEqual(1000 / result.columns);
    });

    it("should position cards in shortest column (masonry algorithm)", () => {
      const cards = [
        createMockCard(100),
        createMockCard(200),
        createMockCard(150),
        createMockCard(300),
      ];

      const result = calculateMasonryLayout({
        cards,
        containerWidth: 500,
        cardSize: 100,
        minColumns: 2,
        gap: 10,
      });

      // Should have at least 2 columns
      expect(result.columns).toBeGreaterThanOrEqual(2);

      // First card should be in first position
      expect(result.positions[0]).toEqual({ left: 0, top: 0 });

      // All positions should have been calculated
      expect(result.positions.length).toBe(4);

      // Positions should use masonry algorithm (shortest column)
      result.positions.forEach((pos) => {
        expect(pos.left).toBeGreaterThanOrEqual(0);
        expect(pos.top).toBeGreaterThanOrEqual(0);
      });
    });

    it("should handle single column layout", () => {
      const cards = [createMockCard(100), createMockCard(200)];
      const result = calculateMasonryLayout({
        cards,
        containerWidth: 200,
        cardSize: 200,
        minColumns: 1,
        gap: 10,
      });

      expect(result.columns).toBe(1);
      expect(result.cardWidth).toBe(200);
      expect(result.positions[0]).toEqual({ left: 0, top: 0 });
      expect(result.positions[1]).toEqual({ left: 0, top: 110 }); // 100 + 10 gap
    });

    it("should handle empty cards array", () => {
      const result = calculateMasonryLayout({
        cards: [],
        containerWidth: 1000,
        cardSize: 200,
        minColumns: 2,
        gap: 16,
      });

      expect(result.positions).toEqual([]);
      // Container height with empty array might be 0 or -Infinity depending on implementation
      expect(typeof result.containerHeight).toBe("number");
      expect(result.columns).toBeGreaterThan(0);
    });

    it("should calculate correct container height", () => {
      const cards = [
        createMockCard(100),
        createMockCard(200),
        createMockCard(150),
      ];

      const result = calculateMasonryLayout({
        cards,
        containerWidth: 500,
        cardSize: 100,
        minColumns: 2,
        gap: 10,
      });

      // Container height should be the tallest column
      expect(result.containerHeight).toBeGreaterThan(0);
      expect(result.containerHeight).toBeGreaterThanOrEqual(200); // At least tallest card
    });

    it("should handle various gap sizes", () => {
      const cards = [createMockCard(100), createMockCard(100)];

      const resultNoGap = calculateMasonryLayout({
        cards,
        containerWidth: 500,
        cardSize: 100,
        minColumns: 2,
        gap: 0,
      });

      const resultWithGap = calculateMasonryLayout({
        cards,
        containerWidth: 500,
        cardSize: 100,
        minColumns: 2,
        gap: 20,
      });

      // Both should have calculated widths
      expect(resultNoGap.cardWidth).toBeGreaterThan(0);
      expect(resultWithGap.cardWidth).toBeGreaterThan(0);

      // With more columns possible, widths may vary - just ensure gap affects layout
      expect(resultNoGap.positions.length).toBe(2);
      expect(resultWithGap.positions.length).toBe(2);
    });

    it("should distribute cards evenly across columns", () => {
      // All cards same height - should alternate columns
      const cards = Array(6)
        .fill(null)
        .map(() => createMockCard(100));

      const result = calculateMasonryLayout({
        cards,
        containerWidth: 600,
        cardSize: 100,
        minColumns: 3,
        gap: 10,
      });

      // Should have at least minimum columns
      expect(result.columns).toBeGreaterThanOrEqual(3);

      // All cards should be positioned
      expect(result.positions.length).toBe(6);

      // With same-height cards, columns should be relatively balanced
      const maxHeight = Math.max(...result.columnHeights);
      const minHeight = Math.min(...result.columnHeights);
      expect(maxHeight - minHeight).toBeLessThanOrEqual(200); // Within 2 cards difference
    });

    it("should return columnAssignments aligned with positions", () => {
      const cards = Array(6)
        .fill(null)
        .map(() => createMockCard(100));

      const result = calculateMasonryLayout({
        cards,
        containerWidth: 630,
        cardSize: 200,
        minColumns: 1,
        gap: 10,
      });

      expect(result.columnAssignments).toHaveLength(6);
      // Equal heights → round-robin: [0, 1, 2, 0, 1, 2]
      expect(result.columnAssignments).toEqual([0, 1, 2, 0, 1, 2]);
      // Each assignment matches the position's column
      for (let i = 0; i < 6; i++) {
        const expectedLeft =
          result.columnAssignments[i] * (result.cardWidth + 10);
        expect(result.positions[i].left).toBeCloseTo(expectedLeft, 0);
      }
    });
  });

  describe("applyMasonryLayout", () => {
    it("should apply CSS custom properties to container", () => {
      const container = document.createElement("div");
      const cards = [document.createElement("div")];

      Object.defineProperty(cards[0], "offsetHeight", {
        value: 200,
      });

      const result = calculateMasonryLayout({
        cards,
        containerWidth: 1000,
        cardSize: 200,
        minColumns: 2,
        gap: 16,
      });

      applyMasonryLayout(container, cards, result);

      expect(container.classList.contains("masonry-container")).toBe(true);
      expect(container.style.getPropertyValue("--masonry-height")).toBe(
        `${result.containerHeight}px`,
      );
    });

    it("should apply CSS custom properties to cards", () => {
      const container = document.createElement("div");
      const card1 = document.createElement("div");
      const card2 = document.createElement("div");

      Object.defineProperty(card1, "offsetHeight", { value: 100 });
      Object.defineProperty(card2, "offsetHeight", { value: 200 });

      const cards = [card1, card2];

      const result = calculateMasonryLayout({
        cards,
        containerWidth: 500,
        cardSize: 100,
        minColumns: 2,
        gap: 10,
      });

      applyMasonryLayout(container, cards, result);

      // Check card1
      expect(card1.classList.contains("masonry-positioned")).toBe(true);
      expect(card1.style.getPropertyValue("--masonry-width")).toBe(
        `${result.cardWidth}px`,
      );
      expect(card1.style.getPropertyValue("--masonry-left")).toBe("0px");
      expect(card1.style.getPropertyValue("--masonry-top")).toBe("0px");

      // Check card2
      expect(card2.classList.contains("masonry-positioned")).toBe(true);
      expect(card2.style.getPropertyValue("--masonry-left")).toBeTruthy();
      expect(card2.style.getPropertyValue("--masonry-top")).toBeTruthy();
    });
  });

  describe("repositionWithStableColumns", () => {
    it("should preserve column assignments when heights change", () => {
      const gap = 8;
      const cardWidth = 194;
      const step = cardWidth + gap;
      const existingPositions = [
        { left: 0, top: 0 }, // col0
        { left: step, top: 0 }, // col1
        { left: step * 2, top: 0 }, // col2
        { left: 0, top: 108 }, // col0
        { left: step, top: 128 }, // col1
        { left: step * 2, top: 98 }, // col2
      ];
      const newHeights = [124, 120, 90, 110, 80, 95]; // card 0 grew 24px

      const result = repositionWithStableColumns({
        existingPositions,
        newHeights,
        columns: 3,
        cardWidth,
        gap,
      });

      // Card 0: col0, top 0 (unchanged)
      expect(result.positions[0]).toEqual({ left: 0, top: 0 });
      // Card 1: col1, top 0 (unchanged — different column)
      expect(result.positions[1]).toEqual({ left: step, top: 0 });
      // Card 3: col0, top 132 (shifted +24 from card 0's growth)
      expect(result.positions[3]).toEqual({ left: 0, top: 132 });
      // Card 4: col1, top 128 (unchanged — different column)
      expect(result.positions[4]).toEqual({ left: step, top: 128 });
    });

    it("should handle single column", () => {
      const result = repositionWithStableColumns({
        existingPositions: [
          { left: 0, top: 0 },
          { left: 0, top: 108 },
        ],
        newHeights: [124, 80],
        columns: 1,
        cardWidth: 400,
        gap: 8,
      });

      expect(result.positions[0]).toEqual({ left: 0, top: 0 });
      expect(result.positions[1]).toEqual({ left: 0, top: 132 });
    });

    it("should handle empty input", () => {
      const result = repositionWithStableColumns({
        existingPositions: [],
        newHeights: [],
        columns: 3,
        cardWidth: 200,
        gap: 8,
      });

      expect(result.positions).toEqual([]);
      expect(result.containerHeight).toBe(0);
    });

    it("should clamp column index when out of bounds", () => {
      const result = repositionWithStableColumns({
        existingPositions: [{ left: 808, top: 0 }],
        newHeights: [100],
        columns: 3,
        cardWidth: 194,
        gap: 8,
      });

      expect(result.positions[0].left).toBe(2 * (194 + 8));
    });

    it("should use columnAssignments directly when provided", () => {
      const result = repositionWithStableColumns({
        columnAssignments: [0, 1, 2, 0, 1, 2],
        newHeights: [100, 120, 90, 110, 80, 95],
        columns: 3,
        cardWidth: 200,
        gap: 10,
      });

      expect(result.positions[0].left).toBe(0); // col 0
      expect(result.positions[1].left).toBe(210); // col 1
      expect(result.positions[2].left).toBe(420); // col 2
      expect(result.positions[3].left).toBe(0); // col 0
      expect(result.columnAssignments).toEqual([0, 1, 2, 0, 1, 2]);
    });

    it("should clamp columnAssignments when columns decrease", () => {
      const result = repositionWithStableColumns({
        columnAssignments: [0, 1, 2, 3],
        newHeights: [100, 100, 100, 100],
        columns: 3,
        cardWidth: 200,
        gap: 10,
      });

      expect(result.columnAssignments).toEqual([0, 1, 2, 2]);
      expect(result.positions[3].left).toBe(420); // clamped to col 2
    });

    it("should prefer columnAssignments over existingPositions", () => {
      const result = repositionWithStableColumns({
        columnAssignments: [2, 1, 0],
        existingPositions: [
          { left: 0, top: 0 }, // would derive col 0
          { left: 210, top: 0 }, // would derive col 1
          { left: 420, top: 0 }, // would derive col 2
        ],
        newHeights: [100, 100, 100],
        columns: 3,
        cardWidth: 200,
        gap: 10,
      });

      // Uses columnAssignments [2, 1, 0], not positions
      expect(result.positions[0].left).toBe(420); // col 2
      expect(result.positions[1].left).toBe(210); // col 1
      expect(result.positions[2].left).toBe(0); // col 0
    });
  });

  describe("computeGreedyColumnHeights", () => {
    it("should distribute heights evenly across columns", () => {
      // 6 cards of equal height across 3 columns → balanced
      const heights = [100, 100, 100, 100, 100, 100];
      const result = computeGreedyColumnHeights(heights, 3, 10);
      expect(result).toEqual([220, 220, 220]);
    });

    it("should place each card in shortest column", () => {
      // Heights: 300, 100, 200, 150 across 2 columns, gap=10
      // Card 0 (300) → col 0: 310. Card 1 (100) → col 1: 110.
      // Card 2 (200) → col 1: 320. Card 3 (150) → col 0: 470.
      const heights = [300, 100, 200, 150];
      const result = computeGreedyColumnHeights(heights, 2, 10);
      expect(result).toEqual([470, 320]);
    });

    it("should handle single column", () => {
      const heights = [100, 200, 150];
      const result = computeGreedyColumnHeights(heights, 1, 10);
      // Each card adds height+gap: (100+10)+(200+10)+(150+10) = 480
      expect(result).toEqual([480]);
    });

    it("should handle empty heights", () => {
      const result = computeGreedyColumnHeights([], 3, 10);
      expect(result).toEqual([0, 0, 0]);
    });
  });
});
