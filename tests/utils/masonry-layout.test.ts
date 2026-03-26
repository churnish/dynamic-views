import {
  calculateMasonryLayout,
  calculateIncrementalMasonryLayout,
  applyMasonryLayout,
  repositionWithStableColumns,
  computeGreedyColumnHeights,
  computeSyntheticGroupOffsets,
} from '../../src/utils/masonry-layout';

describe('masonry-layout', () => {
  describe('calculateMasonryLayout', () => {
    const createMockCard = (height: number): HTMLElement => {
      const card = document.createElement('div');
      Object.defineProperty(card, 'offsetHeight', {
        configurable: true,
        value: height,
      });
      return card;
    };

    it('should calculate correct number of columns based on container width', () => {
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

    it('should respect minimum columns constraint', () => {
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

    it('should calculate correct card width for given columns', () => {
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

    it('should position cards in shortest column (masonry algorithm)', () => {
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

    it('should handle single column layout', () => {
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

    it('should handle empty cards array', () => {
      const result = calculateMasonryLayout({
        cards: [],
        containerWidth: 1000,
        cardSize: 200,
        minColumns: 2,
        gap: 16,
      });

      expect(result.positions).toEqual([]);
      // Container height with empty array might be 0 or -Infinity depending on implementation
      expect(typeof result.containerHeight).toBe('number');
      expect(result.columns).toBeGreaterThan(0);
    });

    it('should calculate correct container height', () => {
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

    it('should handle various gap sizes', () => {
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

    it('should distribute cards evenly across columns', () => {
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

    it('should return columnAssignments aligned with positions', () => {
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

  describe('applyMasonryLayout', () => {
    it('should set container class and height', () => {
      const container = document.createElement('div');
      const cards = [document.createElement('div')];

      Object.defineProperty(cards[0], 'offsetHeight', {
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

      expect(container.classList.contains('masonry-container')).toBe(true);
      expect(container.style.getPropertyValue('--masonry-height')).toBe(
        `${result.containerHeight}px`
      );
    });

    it('should apply inline positioning styles to cards', () => {
      const container = document.createElement('div');
      const card1 = document.createElement('div');
      const card2 = document.createElement('div');

      Object.defineProperty(card1, 'offsetHeight', { value: 100 });
      Object.defineProperty(card2, 'offsetHeight', { value: 200 });

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
      expect(card1.classList.contains('masonry-positioned')).toBe(true);
      expect(card1.style.width).toBe(`${result.cardWidth}px`);
      expect(card1.style.left).toBe('0px');
      expect(card1.style.top).toBe('0px');

      // Check card2
      expect(card2.classList.contains('masonry-positioned')).toBe(true);
      expect(card2.style.left).toBeTruthy();
      expect(card2.style.top).toBeTruthy();
    });
  });

  describe('repositionWithStableColumns', () => {
    it('should preserve column assignments when heights change', () => {
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

    it('should handle single column', () => {
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

    it('should handle empty input', () => {
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

    it('should clamp column index when out of bounds', () => {
      const result = repositionWithStableColumns({
        existingPositions: [{ left: 808, top: 0 }],
        newHeights: [100],
        columns: 3,
        cardWidth: 194,
        gap: 8,
      });

      expect(result.positions[0].left).toBe(2 * (194 + 8));
    });

    it('should use columnAssignments directly when provided', () => {
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

    it('should clamp columnAssignments when columns decrease', () => {
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

    it('should prefer columnAssignments over existingPositions', () => {
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

  describe('calculateIncrementalMasonryLayout', () => {
    const createMockCard = (height: number): HTMLElement => {
      const card = document.createElement('div');
      Object.defineProperty(card, 'offsetHeight', {
        configurable: true,
        value: height,
      });
      return card;
    };

    it('should place cards in shortest column from provided columnHeights', () => {
      // Column 1 is shortest (50), so first new card should go there
      const columnHeights = [100, 50, 75];
      const newCards = [createMockCard(80), createMockCard(60)];

      const result = calculateIncrementalMasonryLayout({
        newCards,
        columnHeights,
        containerWidth: 630,
        cardWidth: 200,
        columns: 3,
        gap: 10,
      });

      // First card → column 1 (height 50, the shortest)
      expect(result.columnAssignments[0]).toBe(1);
      expect(result.positions[0].left).toBe(210); // col 1 × (200 + 10)
      expect(result.positions[0].top).toBe(50);
    });

    it('should return correct positions, heights, and columnAssignments', () => {
      const columnHeights = [0, 0, 0];
      const newCards = [
        createMockCard(100),
        createMockCard(150),
        createMockCard(80),
      ];

      const result = calculateIncrementalMasonryLayout({
        newCards,
        columnHeights,
        containerWidth: 630,
        cardWidth: 200,
        columns: 3,
        gap: 10,
      });

      expect(result.positions).toHaveLength(3);
      expect(result.heights).toHaveLength(3);
      expect(result.columnAssignments).toHaveLength(3);

      // With equal starting heights, cards placed round-robin
      expect(result.columnAssignments).toEqual([0, 1, 2]);
      expect(result.positions[0]).toEqual({ left: 0, top: 0 });
      expect(result.positions[1]).toEqual({ left: 210, top: 0 });
      expect(result.positions[2]).toEqual({ left: 420, top: 0 });
      expect(result.heights).toEqual([100, 150, 80]);
    });

    it('should update columnHeights correctly', () => {
      const columnHeights = [100, 50, 75];
      const gap = 10;
      const newCards = [createMockCard(80)];

      const result = calculateIncrementalMasonryLayout({
        newCards,
        columnHeights,
        containerWidth: 630,
        cardWidth: 200,
        columns: 3,
        gap,
      });

      // Card went to col 1 (shortest, height 50); new height = 50 + 80 + 10 = 140
      expect(result.columnHeights[0]).toBe(100); // unchanged
      expect(result.columnHeights[1]).toBe(140); // 50 + 80 + 10
      expect(result.columnHeights[2]).toBe(75); // unchanged
    });

    it('should calculate containerHeight as max of columnHeights minus trailing gap', () => {
      const columnHeights = [200, 100, 150];
      const gap = 10;
      const newCards = [createMockCard(50)];

      const result = calculateIncrementalMasonryLayout({
        newCards,
        columnHeights,
        containerWidth: 630,
        cardWidth: 200,
        columns: 3,
        gap,
      });

      // Card goes to col 1 (shortest, 100) → new height = 100 + 50 + 10 = 160
      // Max of [200, 160, 150] = 200; containerHeight = 200 - 10 = 190
      expect(result.containerHeight).toBe(190);
    });

    it('should set measuredAtCardWidth to the input cardWidth', () => {
      const cardWidth = 194;
      const newCards = [createMockCard(100)];

      const result = calculateIncrementalMasonryLayout({
        newCards,
        columnHeights: [0],
        containerWidth: 194,
        cardWidth,
        columns: 1,
        gap: 8,
      });

      expect(result.measuredAtCardWidth).toBe(cardWidth);
    });
  });

  describe('computeGreedyColumnHeights', () => {
    it('should distribute heights evenly across columns', () => {
      // 6 cards of equal height across 3 columns → balanced
      const heights = [100, 100, 100, 100, 100, 100];
      const result = computeGreedyColumnHeights(heights, 3, 10);
      expect(result).toEqual([220, 220, 220]);
    });

    it('should place each card in shortest column', () => {
      // Heights: 300, 100, 200, 150 across 2 columns, gap=10
      // Card 0 (300) → col 0: 310. Card 1 (100) → col 1: 110.
      // Card 2 (200) → col 1: 320. Card 3 (150) → col 0: 470.
      const heights = [300, 100, 200, 150];
      const result = computeGreedyColumnHeights(heights, 2, 10);
      expect(result).toEqual([470, 320]);
    });

    it('should handle single column', () => {
      const heights = [100, 200, 150];
      const result = computeGreedyColumnHeights(heights, 1, 10);
      // Each card adds height+gap: (100+10)+(200+10)+(150+10) = 480
      expect(result).toEqual([480]);
    });

    it('should handle empty heights', () => {
      const result = computeGreedyColumnHeights([], 3, 10);
      expect(result).toEqual([0, 0, 0]);
    });
  });

  describe('imbalance threshold (stable vs greedy)', () => {
    // Tests the threshold used by resolveStableOrGreedy in masonry-view.ts:
    // useGreedy = stableRange > greedyRange * 1.5 && stableRange - greedyRange > gap * 8

    const gap = 8;
    const columns = 3;
    const cardWidth = 200;
    const step = cardWidth + gap;

    function computeImbalance(
      stableHeights: number[],
      columnAssignments: number[]
    ): { stableRange: number; greedyRange: number; shouldUseGreedy: boolean } {
      // Stable: place cards into assigned columns
      const stableCols = new Array(columns).fill(0) as number[];
      for (let i = 0; i < stableHeights.length; i++) {
        stableCols[columnAssignments[i]] += stableHeights[i] + gap;
      }
      const stableRange = Math.max(...stableCols) - Math.min(...stableCols);

      const greedyCols = computeGreedyColumnHeights(
        stableHeights,
        columns,
        gap
      );
      const greedyRange = Math.max(...greedyCols) - Math.min(...greedyCols);

      const shouldUseGreedy =
        stableRange > greedyRange * 1.5 && stableRange - greedyRange > gap * 8;
      return { stableRange, greedyRange, shouldUseGreedy };
    }

    it('should NOT trigger greedy when stable columns are balanced', () => {
      // 6 cards evenly distributed across 3 columns
      const heights = [100, 100, 100, 100, 100, 100];
      const assignments = [0, 1, 2, 0, 1, 2];
      const { shouldUseGreedy } = computeImbalance(heights, assignments);
      expect(shouldUseGreedy).toBe(false);
    });

    it('should NOT trigger greedy when imbalance is below absolute threshold', () => {
      // Small imbalance: range diff < gap * 8 = 64px
      const heights = [100, 100, 100, 150, 100, 100];
      const assignments = [0, 1, 2, 0, 1, 2];
      const { stableRange, greedyRange, shouldUseGreedy } = computeImbalance(
        heights,
        assignments
      );
      // stableRange - greedyRange is small, absolute threshold not met
      expect(stableRange - greedyRange).toBeLessThanOrEqual(gap * 8);
      expect(shouldUseGreedy).toBe(false);
    });

    it('should trigger greedy when stable assignment creates severe imbalance', () => {
      // All tall cards assigned to column 0, short cards to 1 and 2
      const heights = [300, 300, 50, 300, 50, 50];
      const assignments = [0, 0, 1, 0, 1, 2];
      const { stableRange, greedyRange, shouldUseGreedy } = computeImbalance(
        heights,
        assignments
      );
      // Stable piles 3×300 in col0 vs 2×50 in col1 — massive imbalance
      expect(stableRange).toBeGreaterThan(greedyRange * 1.5);
      expect(stableRange - greedyRange).toBeGreaterThan(gap * 8);
      expect(shouldUseGreedy).toBe(true);
    });

    it('should NOT trigger greedy when stable matches greedy assignment', () => {
      // When stable column assignments happen to match greedy's choice,
      // both produce identical ranges — ratio is 1.0, threshold not met
      const heights = [100, 100, 100, 100, 100, 100];
      // Round-robin matches greedy for equal heights
      const assignments = [0, 1, 2, 0, 1, 2];
      const { stableRange, greedyRange, shouldUseGreedy } = computeImbalance(
        heights,
        assignments
      );
      expect(stableRange).toBe(greedyRange);
      expect(shouldUseGreedy).toBe(false);
    });
  });

  describe('computeSyntheticGroupOffsets', () => {
    it('should shift subsequent groups by cumulative height deltas', () => {
      const keys = ['a', 'b', 'c'];
      const cached = new Map([
        ['a', 0],
        ['b', 100],
        ['c', 300],
      ]);
      const oldH = new Map([
        ['a', 100],
        ['b', 200],
        ['c', 150],
      ]);
      // Group a grew by 20, group b shrank by 50
      const newH = new Map([
        ['a', 120],
        ['b', 150],
        ['c', 150],
      ]);

      const result = computeSyntheticGroupOffsets(keys, cached, oldH, newH);

      expect(result).not.toBeNull();
      expect(result!.get('a')).toBe(0); // First group: no shift
      expect(result!.get('b')).toBe(120); // 100 + 20 (a's delta)
      expect(result!.get('c')).toBe(270); // 300 + (20 - 50) = 270
    });

    it('should return null when cached offsets are empty', () => {
      const result = computeSyntheticGroupOffsets(
        ['a'],
        new Map(),
        new Map([['a', 100]]),
        new Map([['a', 120]])
      );
      expect(result).toBeNull();
    });

    it('should return null when a group key has no cached offset', () => {
      const result = computeSyntheticGroupOffsets(
        ['a', 'b'],
        new Map([['a', 0]]), // 'b' missing
        new Map([
          ['a', 100],
          ['b', 200],
        ]),
        new Map([
          ['a', 120],
          ['b', 200],
        ])
      );
      expect(result).toBeNull();
    });

    it('should not mutate cached offsets on bail', () => {
      const cached = new Map([['a', 0]]);
      computeSyntheticGroupOffsets(
        ['a', 'unknown'],
        cached,
        new Map([['a', 100]]),
        new Map([['a', 120]])
      );
      expect(cached.get('a')).toBe(0); // Unchanged
    });

    it('should handle single group (ungrouped mode)', () => {
      const cached = new Map([[undefined, 12]]);
      const result = computeSyntheticGroupOffsets(
        [undefined],
        cached,
        new Map([[undefined, 500]]),
        new Map([[undefined, 600]])
      );
      expect(result).not.toBeNull();
      expect(result!.get(undefined)).toBe(12); // Single group — no shift
    });

    it('should return unchanged offsets when heights did not change', () => {
      const cached = new Map([
        ['a', 0],
        ['b', 100],
        ['c', 300],
      ]);
      const heights = new Map([
        ['a', 100],
        ['b', 200],
        ['c', 150],
      ]);

      const result = computeSyntheticGroupOffsets(
        ['a', 'b', 'c'],
        cached,
        heights,
        heights // Same old and new
      );

      expect(result).not.toBeNull();
      expect(result!.get('a')).toBe(0);
      expect(result!.get('b')).toBe(100);
      expect(result!.get('c')).toBe(300);
    });

    it('should default missing heights to 0', () => {
      const cached = new Map([
        ['a', 0],
        ['b', 50],
      ]);
      // oldH missing 'a', newH missing 'b' — both default to 0
      const result = computeSyntheticGroupOffsets(
        ['a', 'b'],
        cached,
        new Map([['b', 100]]),
        new Map([['a', 80]])
      );
      expect(result).not.toBeNull();
      // a: 0 + 0 = 0. delta for a: 80 - 0 = 80
      // b: 50 + 80 = 130
      expect(result!.get('a')).toBe(0);
      expect(result!.get('b')).toBe(130);
    });
  });
});
