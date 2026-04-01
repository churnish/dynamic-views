/**
 * Tests for equalizeRowHeights logic from grid-view.ts.
 *
 * The method is private — these tests replicate the same algorithm as a
 * standalone function, following the grid-scroll.test.ts pattern.
 */

import { describe, it, expect } from 'vitest';
import {
  FIXED_POSTER_HEIGHT_MASONRY,
  FIXED_POSTER_HEIGHT_NONE,
} from '../../src/shared/constants';

// ---------------------------------------------------------------------------
// Mock element factory
// ---------------------------------------------------------------------------

type MockElement = HTMLElement & {
  _classes: Set<string>;
  _cssProps: Map<string, string>;
  _computedProps: Map<string, string>;
};

function mockElement(
  opts: {
    classes?: string[];
    computedProps?: Record<string, string>;
  } = {}
): MockElement {
  const classes = new Set(opts.classes ?? []);
  const cssProps = new Map<string, string>();
  const computedProps = new Map(Object.entries(opts.computedProps ?? {}));
  return {
    isConnected: true,
    classList: {
      contains: (c: string) => classes.has(c),
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
    },
    style: {
      getPropertyValue: (k: string) => cssProps.get(k) ?? '',
      removeProperty: (k: string) => cssProps.delete(k),
      setProperty: (k: string, v: string) => cssProps.set(k, v),
    },
    _classes: classes,
    _cssProps: cssProps,
    _computedProps: computedProps,
  } as unknown as MockElement;
}

// ---------------------------------------------------------------------------
// Replicated equalizeRowHeights logic
// ---------------------------------------------------------------------------

interface VirtualItem {
  el: MockElement | null;
}

interface EqualizeConfig {
  expectedFormat: string;
  matchCard: (el: MockElement) => boolean;
  fixedMasonryClass: string;
  fixedNoneClass: string;
  cssVariable: string;
}

/**
 * Replicates equalizeRowHeights from grid-view.ts.
 * Accepts context instead of reading from `this`.
 */
function equalizeRowHeights(
  ctx: {
    containerConnected: boolean;
    imageFormat: string | undefined;
    bodyClasses: Set<string>;
    virtualItemsByGroup: Map<string, VirtualItem[]>;
    columns: number;
    getComputedStyle: (el: MockElement) => {
      getPropertyValue: (prop: string) => string;
    };
  },
  config: EqualizeConfig
): void {
  if (!ctx.containerConnected) return;
  if (ctx.imageFormat !== config.expectedFormat) return;

  const isFixedHeightActive =
    !ctx.bodyClasses.has(config.fixedMasonryClass) &&
    !ctx.bodyClasses.has(config.fixedNoneClass);

  if (isFixedHeightActive) {
    for (const [, groupItems] of ctx.virtualItemsByGroup) {
      for (const item of groupItems) {
        if (item.el?.isConnected && config.matchCard(item.el)) {
          item.el.style.removeProperty(config.cssVariable);
        }
      }
    }
    return;
  }

  const columns = ctx.columns;
  if (columns <= 0) return;

  for (const [, groupItems] of ctx.virtualItemsByGroup) {
    const indexedCards: { index: number; el: MockElement }[] = [];
    for (let i = 0; i < groupItems.length; i++) {
      const el = groupItems[i].el;
      if (el?.isConnected && config.matchCard(el)) {
        indexedCards.push({ index: i, el });
      }
    }

    // Read phase
    const ratios: { index: number; el: MockElement; ratio: number }[] = [];
    for (const { index, el } of indexedCards) {
      const raw = ctx
        .getComputedStyle(el)
        .getPropertyValue('--actual-aspect-ratio');
      const ratio = parseFloat(raw);
      ratios.push({ index, el, ratio: isNaN(ratio) ? 0 : ratio });
    }

    // Group by row and find max per row
    const rowMaxes = new Map<number, number>();
    for (const { index, ratio } of ratios) {
      const row = Math.floor(index / columns);
      const current = rowMaxes.get(row) ?? 0;
      if (ratio > current) rowMaxes.set(row, ratio);
    }

    // Write phase
    for (const { index, el } of ratios) {
      const row = Math.floor(index / columns);
      const maxRatio = rowMaxes.get(row) ?? 0;
      el.style.setProperty(config.cssVariable, maxRatio.toString());
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('equalizeRowHeights', () => {
  /** Standard poster config matching equalizeRowPosterHeights in grid-view.ts */
  const posterConfig: EqualizeConfig = {
    expectedFormat: 'poster',
    matchCard: (el) =>
      el.classList.contains('image-format-poster') &&
      el.classList.contains('has-poster'),
    fixedMasonryClass: FIXED_POSTER_HEIGHT_MASONRY,
    fixedNoneClass: FIXED_POSTER_HEIGHT_NONE,
    cssVariable: '--row-poster-aspect-ratio',
  };

  /** Default context factory — fixed height OFF (masonry class present) */
  function makeCtx(
    overrides: Partial<Parameters<typeof equalizeRowHeights>[0]> = {}
  ) {
    return {
      containerConnected: true,
      imageFormat: 'poster' as string | undefined,
      bodyClasses: new Set([FIXED_POSTER_HEIGHT_MASONRY]),
      virtualItemsByGroup: new Map<string, VirtualItem[]>(),
      columns: 3,
      getComputedStyle: (el: MockElement) => ({
        getPropertyValue: (prop: string) => el._computedProps.get(prop) ?? '',
      }),
      ...overrides,
    };
  }

  it('format mismatch: early return, no changes', () => {
    const card = mockElement({
      classes: ['image-format-poster', 'has-poster'],
      computedProps: { '--actual-aspect-ratio': '0.8' },
    });

    const ctx = makeCtx({
      imageFormat: 'cover', // Does not match posterConfig.expectedFormat
      virtualItemsByGroup: new Map([['default', [{ el: card }]]]),
    });

    equalizeRowHeights(ctx, posterConfig);

    // No CSS variable written
    expect(card._cssProps.has(posterConfig.cssVariable)).toBe(false);
  });

  it('fixed height active: clears CSS variable on all matching cards', () => {
    const card1 = mockElement({
      classes: ['image-format-poster', 'has-poster'],
    });
    card1.style.setProperty(posterConfig.cssVariable, '1.2');
    const card2 = mockElement({
      classes: ['image-format-poster', 'has-poster'],
    });
    card2.style.setProperty(posterConfig.cssVariable, '0.8');

    // No MASONRY or NONE class → fixed height is active
    const ctx = makeCtx({
      bodyClasses: new Set<string>(),
      virtualItemsByGroup: new Map([
        ['default', [{ el: card1 }, { el: card2 }]],
      ]),
    });

    equalizeRowHeights(ctx, posterConfig);

    expect(card1._cssProps.has(posterConfig.cssVariable)).toBe(false);
    expect(card2._cssProps.has(posterConfig.cssVariable)).toBe(false);
  });

  it('single row equalization: all cards get the max ratio', () => {
    const cards = [
      mockElement({
        classes: ['image-format-poster', 'has-poster'],
        computedProps: { '--actual-aspect-ratio': '0.8' },
      }),
      mockElement({
        classes: ['image-format-poster', 'has-poster'],
        computedProps: { '--actual-aspect-ratio': '1.2' },
      }),
      mockElement({
        classes: ['image-format-poster', 'has-poster'],
        computedProps: { '--actual-aspect-ratio': '0.5' },
      }),
    ];

    const ctx = makeCtx({
      columns: 3,
      virtualItemsByGroup: new Map([['default', cards.map((el) => ({ el }))]]),
    });

    equalizeRowHeights(ctx, posterConfig);

    // All three cards in one row → max is 1.2
    for (const card of cards) {
      expect(card._cssProps.get(posterConfig.cssVariable)).toBe('1.2');
    }
  });

  it('multi-row: each row gets its own max independently', () => {
    // 6 cards, 3 columns → 2 rows
    const cards = [
      // Row 0
      mockElement({
        classes: ['image-format-poster', 'has-poster'],
        computedProps: { '--actual-aspect-ratio': '0.8' },
      }),
      mockElement({
        classes: ['image-format-poster', 'has-poster'],
        computedProps: { '--actual-aspect-ratio': '1.2' },
      }),
      mockElement({
        classes: ['image-format-poster', 'has-poster'],
        computedProps: { '--actual-aspect-ratio': '0.5' },
      }),
      // Row 1
      mockElement({
        classes: ['image-format-poster', 'has-poster'],
        computedProps: { '--actual-aspect-ratio': '2.0' },
      }),
      mockElement({
        classes: ['image-format-poster', 'has-poster'],
        computedProps: { '--actual-aspect-ratio': '1.5' },
      }),
      mockElement({
        classes: ['image-format-poster', 'has-poster'],
        computedProps: { '--actual-aspect-ratio': '1.8' },
      }),
    ];

    const ctx = makeCtx({
      columns: 3,
      virtualItemsByGroup: new Map([['default', cards.map((el) => ({ el }))]]),
    });

    equalizeRowHeights(ctx, posterConfig);

    // Row 0 max = 1.2
    expect(cards[0]._cssProps.get(posterConfig.cssVariable)).toBe('1.2');
    expect(cards[1]._cssProps.get(posterConfig.cssVariable)).toBe('1.2');
    expect(cards[2]._cssProps.get(posterConfig.cssVariable)).toBe('1.2');

    // Row 1 max = 2.0
    expect(cards[3]._cssProps.get(posterConfig.cssVariable)).toBe('2');
    expect(cards[4]._cssProps.get(posterConfig.cssVariable)).toBe('2');
    expect(cards[5]._cssProps.get(posterConfig.cssVariable)).toBe('2');
  });
});
