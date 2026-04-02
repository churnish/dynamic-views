/**
 * Tests for stretchPosterCardsInMixedRows logic from grid-view.ts.
 *
 * The method is private — these tests replicate the same algorithm as a
 * standalone function, following the grid-scroll.test.ts pattern.
 */

import { describe, it, expect } from 'vitest';
import {
  POSTER_STRETCH_CLASS,
  POSTER_ROW_MIN_HEIGHT_VAR,
  POSTER_ASPECT_OVERRIDE_VAR,
  FIXED_POSTER_HEIGHT_MASONRY,
  FIXED_POSTER_HEIGHT_NONE,
} from '../../src/shared/constants';

// ---------------------------------------------------------------------------
// Mock element factory
// ---------------------------------------------------------------------------

type MockElement = HTMLElement & {
  _classes: Set<string>;
  _cssProps: Map<string, string>;
};

function mockElement(
  opts: {
    classes?: string[];
    height?: number;
    cssProps?: Record<string, string>;
  } = {}
): MockElement {
  const classes = new Set(opts.classes ?? []);
  const cssProps = new Map(Object.entries(opts.cssProps ?? {}));
  return {
    isConnected: true,
    classList: {
      contains: (c: string) => classes.has(c),
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
    },
    getBoundingClientRect: () => ({ height: opts.height ?? 0 }),
    style: {
      getPropertyValue: (k: string) => cssProps.get(k) ?? '',
      removeProperty: (k: string) => cssProps.delete(k),
      setProperty: (k: string, v: string) => cssProps.set(k, v),
    },
    setCssProps: (props: Record<string, string>) => {
      for (const [k, v] of Object.entries(props)) cssProps.set(k, v);
    },
    _classes: classes,
    _cssProps: cssProps,
  } as unknown as MockElement;
}

// ---------------------------------------------------------------------------
// Replicated stretchPosterCardsInMixedRows logic
// ---------------------------------------------------------------------------

interface VirtualItem {
  el: MockElement | null;
}

/**
 * Replicates stretchPosterCardsInMixedRows from grid-view.ts.
 * Accepts context instead of reading from `this`.
 */
function stretchPosterCardsInMixedRows(ctx: {
  containerConnected: boolean;
  imageFormat: string | undefined;
  bodyClasses: Set<string>;
  virtualItemsByGroup: Map<string, VirtualItem[]>;
  columns: number;
}): void {
  if (!ctx.containerConnected) return;
  if (ctx.imageFormat !== 'poster') return;

  // Fixed height active = stretch is a CSS no-op. Clear stale state and exit.
  const isFixedHeightActive =
    !ctx.bodyClasses.has(FIXED_POSTER_HEIGHT_MASONRY) &&
    !ctx.bodyClasses.has(FIXED_POSTER_HEIGHT_NONE);
  if (isFixedHeightActive) {
    for (const [, groupItems] of ctx.virtualItemsByGroup) {
      for (const item of groupItems) {
        if (!item.el?.isConnected) continue;
        if (item.el.classList.contains(POSTER_STRETCH_CLASS)) {
          item.el.style.removeProperty(POSTER_ROW_MIN_HEIGHT_VAR);
          item.el.style.removeProperty(POSTER_ASPECT_OVERRIDE_VAR);
          item.el.classList.remove(POSTER_STRETCH_CLASS);
        }
      }
    }
    return;
  }

  const columns = ctx.columns;
  if (columns <= 0) return;

  // Pre-collect ALL card heights in one pass — forces a single reflow total.
  const heightMap = new Map<MockElement, number>();
  for (const [, groupItems] of ctx.virtualItemsByGroup) {
    for (const item of groupItems) {
      const el = item.el;
      if (!el?.isConnected) continue;
      const isPoster =
        el.classList.contains('image-format-poster') &&
        el.classList.contains('has-poster');
      if (isPoster && el.classList.contains(POSTER_STRETCH_CLASS)) {
        heightMap.set(el, 0);
      } else {
        heightMap.set(el, el.getBoundingClientRect().height);
      }
    }
  }

  // Read phase
  const rowActions: {
    posterEls: MockElement[];
    action: 'stretch' | 'unstretch' | 'skip';
    value: string;
  }[] = [];

  for (const [, groupItems] of ctx.virtualItemsByGroup) {
    for (let rowStart = 0; rowStart < groupItems.length; rowStart += columns) {
      const rowEnd = Math.min(rowStart + columns, groupItems.length);
      const posterEls: MockElement[] = [];
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

      if (posterEls.length === 0 || maxImagelessHeight === 0) {
        rowActions.push({ posterEls, action: 'unstretch', value: '' });
        continue;
      }

      const targetHeight = Math.round(maxImagelessHeight);
      const value = targetHeight + 'px';
      if (
        posterEls.every(
          (el) => el.style.getPropertyValue(POSTER_ROW_MIN_HEIGHT_VAR) === value
        )
      ) {
        rowActions.push({ posterEls, action: 'skip', value });
        continue;
      }

      const posterHeight = heightMap.get(posterEls[0]) ?? 0;

      if (maxImagelessHeight > posterHeight) {
        rowActions.push({ posterEls, action: 'stretch', value });
      } else {
        rowActions.push({ posterEls, action: 'unstretch', value: '' });
      }
    }
  }

  // Write phase
  for (const { posterEls, action, value } of rowActions) {
    if (action === 'skip') continue;
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
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('stretchPosterCardsInMixedRows', () => {
  /** Default context factory — fixed height OFF (masonry class present) */
  function makeCtx(
    overrides: Partial<Parameters<typeof stretchPosterCardsInMixedRows>[0]> = {}
  ) {
    return {
      containerConnected: true,
      imageFormat: 'poster' as string | undefined,
      bodyClasses: new Set([FIXED_POSTER_HEIGHT_MASONRY]),
      virtualItemsByGroup: new Map<string, VirtualItem[]>(),
      columns: 3,
      ...overrides,
    };
  }

  it('all-poster row: no stretch applied, stale stretch cleaned', () => {
    const p1 = mockElement({
      classes: ['image-format-poster', 'has-poster', POSTER_STRETCH_CLASS],
      height: 200,
      cssProps: {
        [POSTER_ROW_MIN_HEIGHT_VAR]: '250px',
        [POSTER_ASPECT_OVERRIDE_VAR]: 'auto',
      },
    });
    const p2 = mockElement({
      classes: ['image-format-poster', 'has-poster'],
      height: 200,
    });

    const ctx = makeCtx({
      columns: 2,
      virtualItemsByGroup: new Map([['default', [{ el: p1 }, { el: p2 }]]]),
    });

    stretchPosterCardsInMixedRows(ctx);

    // All-poster row → unstretch action. p1 had stale stretch → cleaned.
    expect(p1._classes.has(POSTER_STRETCH_CLASS)).toBe(false);
    expect(p1._cssProps.has(POSTER_ROW_MIN_HEIGHT_VAR)).toBe(false);
    expect(p1._cssProps.has(POSTER_ASPECT_OVERRIDE_VAR)).toBe(false);
    // p2 never had stretch — no change
    expect(p2._classes.has(POSTER_STRETCH_CLASS)).toBe(false);
  });

  it('all-imageless row: no action', () => {
    const i1 = mockElement({ height: 300 });
    const i2 = mockElement({ height: 250 });

    const ctx = makeCtx({
      columns: 2,
      virtualItemsByGroup: new Map([['default', [{ el: i1 }, { el: i2 }]]]),
    });

    stretchPosterCardsInMixedRows(ctx);

    // No poster cards → unstretch path, but neither had stretch → no-op
    expect(i1._classes.has(POSTER_STRETCH_CLASS)).toBe(false);
    expect(i2._classes.has(POSTER_STRETCH_CLASS)).toBe(false);
  });

  it('mixed row, imageless taller: stretch applied', () => {
    const poster = mockElement({
      classes: ['image-format-poster', 'has-poster'],
      height: 200,
    });
    const imageless = mockElement({ height: 300 });

    const ctx = makeCtx({
      columns: 2,
      virtualItemsByGroup: new Map([
        ['default', [{ el: poster }, { el: imageless }]],
      ]),
    });

    stretchPosterCardsInMixedRows(ctx);

    expect(poster._classes.has(POSTER_STRETCH_CLASS)).toBe(true);
    expect(poster._cssProps.get(POSTER_ROW_MIN_HEIGHT_VAR)).toBe('300px');
    expect(poster._cssProps.get(POSTER_ASPECT_OVERRIDE_VAR)).toBe('auto');
  });

  it('mixed row, poster taller: no stretch', () => {
    const poster = mockElement({
      classes: ['image-format-poster', 'has-poster'],
      height: 300,
    });
    const imageless = mockElement({ height: 200 });

    const ctx = makeCtx({
      columns: 2,
      virtualItemsByGroup: new Map([
        ['default', [{ el: poster }, { el: imageless }]],
      ]),
    });

    stretchPosterCardsInMixedRows(ctx);

    expect(poster._classes.has(POSTER_STRETCH_CLASS)).toBe(false);
    expect(poster._cssProps.has(POSTER_ROW_MIN_HEIGHT_VAR)).toBe(false);
  });

  it('oscillation guard: matching min-height skips writes', () => {
    const poster = mockElement({
      classes: ['image-format-poster', 'has-poster', POSTER_STRETCH_CLASS],
      height: 300,
      cssProps: { [POSTER_ROW_MIN_HEIGHT_VAR]: '300px' },
    });
    const imageless = mockElement({ height: 300 });

    const ctx = makeCtx({
      columns: 2,
      virtualItemsByGroup: new Map([
        ['default', [{ el: poster }, { el: imageless }]],
      ]),
    });

    // Snapshot CSS props before
    const propsBefore = new Map(poster._cssProps);

    stretchPosterCardsInMixedRows(ctx);

    // Props unchanged — skip action
    expect(poster._cssProps).toEqual(propsBefore);
  });

  it('multi-row: mixed row 0 stretched, all-poster row 1 unstretched', () => {
    // 4 cards, 2 columns
    // Row 0: poster (shorter) + imageless (taller) → stretch
    // Row 1: poster + poster → unstretch
    const poster0 = mockElement({
      classes: ['image-format-poster', 'has-poster'],
      height: 200,
    });
    const imageless0 = mockElement({ height: 300 });
    const poster1 = mockElement({
      classes: ['image-format-poster', 'has-poster'],
      height: 250,
    });
    const poster2 = mockElement({
      classes: ['image-format-poster', 'has-poster'],
      height: 250,
    });

    const ctx = makeCtx({
      columns: 2,
      virtualItemsByGroup: new Map([
        [
          'default',
          [
            { el: poster0 },
            { el: imageless0 },
            { el: poster1 },
            { el: poster2 },
          ],
        ],
      ]),
    });

    stretchPosterCardsInMixedRows(ctx);

    // Row 0: poster stretched to imageless height
    expect(poster0._classes.has(POSTER_STRETCH_CLASS)).toBe(true);
    expect(poster0._cssProps.get(POSTER_ROW_MIN_HEIGHT_VAR)).toBe('300px');
    expect(poster0._cssProps.get(POSTER_ASPECT_OVERRIDE_VAR)).toBe('auto');

    // Row 1: all-poster → unstretch
    expect(poster1._classes.has(POSTER_STRETCH_CLASS)).toBe(false);
    expect(poster2._classes.has(POSTER_STRETCH_CLASS)).toBe(false);
  });

  it('partial row: fewer cards than columns processed without error', () => {
    // 5 cards, 3 columns
    // Row 0: poster + imageless + poster → stretch
    // Row 1: poster + poster (partial) → unstretch
    const poster0 = mockElement({
      classes: ['image-format-poster', 'has-poster'],
      height: 150,
    });
    const imageless0 = mockElement({ height: 280 });
    const poster1 = mockElement({
      classes: ['image-format-poster', 'has-poster'],
      height: 150,
    });
    const poster2 = mockElement({
      classes: ['image-format-poster', 'has-poster'],
      height: 200,
    });
    const poster3 = mockElement({
      classes: ['image-format-poster', 'has-poster'],
      height: 200,
    });

    const ctx = makeCtx({
      columns: 3,
      virtualItemsByGroup: new Map([
        [
          'default',
          [
            { el: poster0 },
            { el: imageless0 },
            { el: poster1 },
            { el: poster2 },
            { el: poster3 },
          ],
        ],
      ]),
    });

    stretchPosterCardsInMixedRows(ctx);

    // Row 0: both posters stretched to imageless height
    expect(poster0._classes.has(POSTER_STRETCH_CLASS)).toBe(true);
    expect(poster0._cssProps.get(POSTER_ROW_MIN_HEIGHT_VAR)).toBe('280px');
    expect(poster1._classes.has(POSTER_STRETCH_CLASS)).toBe(true);
    expect(poster1._cssProps.get(POSTER_ROW_MIN_HEIGHT_VAR)).toBe('280px');

    // Row 1: all-poster partial row → unstretch
    expect(poster2._classes.has(POSTER_STRETCH_CLASS)).toBe(false);
    expect(poster3._classes.has(POSTER_STRETCH_CLASS)).toBe(false);
  });

  it('fixed height active: early exit, stale stretch cleaned', () => {
    const poster = mockElement({
      classes: ['image-format-poster', 'has-poster', POSTER_STRETCH_CLASS],
      height: 200,
      cssProps: {
        [POSTER_ROW_MIN_HEIGHT_VAR]: '300px',
        [POSTER_ASPECT_OVERRIDE_VAR]: 'auto',
      },
    });
    const imageless = mockElement({ height: 300 });

    // No MASONRY or NONE class → fixed height is active
    const ctx = makeCtx({
      bodyClasses: new Set<string>(),
      columns: 2,
      virtualItemsByGroup: new Map([
        ['default', [{ el: poster }, { el: imageless }]],
      ]),
    });

    stretchPosterCardsInMixedRows(ctx);

    // Stale stretch cleaned on poster
    expect(poster._classes.has(POSTER_STRETCH_CLASS)).toBe(false);
    expect(poster._cssProps.has(POSTER_ROW_MIN_HEIGHT_VAR)).toBe(false);
    expect(poster._cssProps.has(POSTER_ASPECT_OVERRIDE_VAR)).toBe(false);
  });
});
