/**
 * Tests for computePosterStretch — the pure poster row stretch algorithm
 * extracted from grid-view.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  ALIGN_START_CLASS,
  POSTER_STRETCH_CLASS,
  POSTER_ROW_MIN_HEIGHT_VAR,
  POSTER_ASPECT_OVERRIDE_VAR,
} from '../../src/core/constants';
import {
  computePosterStretch,
  type PosterStretchInput,
} from '../../src/core/poster-stretch';

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
// Tests
// ---------------------------------------------------------------------------

describe('computePosterStretch', () => {
  /** Default context factory */
  function makeCtx(
    overrides: Partial<PosterStretchInput> = {}
  ): PosterStretchInput {
    return {
      virtualItemsByGroup: new Map(),
      columns: 3,
      stretchNoopKey: 0,
      imageReadyCount: 0,
      compactStackedCount: 0,
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

    ctx.stretchNoopKey = computePosterStretch(ctx);

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

    ctx.stretchNoopKey = computePosterStretch(ctx);

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

    ctx.stretchNoopKey = computePosterStretch(ctx);

    expect(poster._classes.has(POSTER_STRETCH_CLASS)).toBe(true);
    expect(poster._cssProps.get(POSTER_ROW_MIN_HEIGHT_VAR)).toBe('300px');
    expect(poster._cssProps.get(POSTER_ASPECT_OVERRIDE_VAR)).toBe('auto');
    // Phase 2 cleanup: measurement class removed after read
    expect(imageless._classes.has(ALIGN_START_CLASS)).toBe(false);
    expect(poster._classes.has(ALIGN_START_CLASS)).toBe(false);
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

    ctx.stretchNoopKey = computePosterStretch(ctx);

    expect(poster._classes.has(POSTER_STRETCH_CLASS)).toBe(false);
    expect(poster._cssProps.has(POSTER_ROW_MIN_HEIGHT_VAR)).toBe(false);
  });

  it('stale stretch cleared — natural heights compared', () => {
    const poster = mockElement({
      classes: ['image-format-poster', 'has-poster', POSTER_STRETCH_CLASS],
      height: 200,
      cssProps: {
        [POSTER_ROW_MIN_HEIGHT_VAR]: '500px',
        [POSTER_ASPECT_OVERRIDE_VAR]: 'auto',
      },
    });
    const imageless = mockElement({ height: 300 });

    const ctx = makeCtx({
      columns: 2,
      virtualItemsByGroup: new Map([
        ['default', [{ el: poster }, { el: imageless }]],
      ]),
    });

    ctx.stretchNoopKey = computePosterStretch(ctx);

    // Phase 0 cleared stale 500px stretch. Natural: imageless 300 > poster 200 → stretch to 300px
    expect(poster._classes.has(POSTER_STRETCH_CLASS)).toBe(true);
    expect(poster._cssProps.get(POSTER_ROW_MIN_HEIGHT_VAR)).toBe('300px');
    expect(poster._cssProps.get(POSTER_ASPECT_OVERRIDE_VAR)).toBe('auto');
  });

  it('stale stretch with poster taller — no re-stretch', () => {
    const poster = mockElement({
      classes: ['image-format-poster', 'has-poster', POSTER_STRETCH_CLASS],
      height: 300,
      cssProps: {
        [POSTER_ROW_MIN_HEIGHT_VAR]: '500px',
        [POSTER_ASPECT_OVERRIDE_VAR]: 'auto',
      },
    });
    const imageless = mockElement({ height: 160 });

    const ctx = makeCtx({
      columns: 2,
      virtualItemsByGroup: new Map([
        ['default', [{ el: poster }, { el: imageless }]],
      ]),
    });

    ctx.stretchNoopKey = computePosterStretch(ctx);

    // Phase 0 cleared stale 500px stretch. Natural: poster 300 > imageless 160 → no stretch
    expect(poster._classes.has(POSTER_STRETCH_CLASS)).toBe(false);
    expect(poster._cssProps.has(POSTER_ROW_MIN_HEIGHT_VAR)).toBe(false);
    expect(poster._cssProps.has(POSTER_ASPECT_OVERRIDE_VAR)).toBe(false);
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

    ctx.stretchNoopKey = computePosterStretch(ctx);

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

    ctx.stretchNoopKey = computePosterStretch(ctx);

    // Row 0: both posters stretched to imageless height
    expect(poster0._classes.has(POSTER_STRETCH_CLASS)).toBe(true);
    expect(poster0._cssProps.get(POSTER_ROW_MIN_HEIGHT_VAR)).toBe('280px');
    expect(poster1._classes.has(POSTER_STRETCH_CLASS)).toBe(true);
    expect(poster1._cssProps.get(POSTER_ROW_MIN_HEIGHT_VAR)).toBe('280px');

    // Row 1: all-poster partial row → unstretch
    expect(poster2._classes.has(POSTER_STRETCH_CLASS)).toBe(false);
    expect(poster3._classes.has(POSTER_STRETCH_CLASS)).toBe(false);
  });

  it('consecutive no-op calls with same composition bail out', () => {
    const p1 = mockElement({
      classes: ['image-format-poster', 'has-poster'],
      height: 200,
    });
    const p2 = mockElement({
      classes: ['image-format-poster', 'has-poster'],
      height: 200,
    });

    const ctx = makeCtx({
      columns: 2,
      virtualItemsByGroup: new Map([['default', [{ el: p1 }, { el: p2 }]]]),
    });

    // First run: all-poster row → no stretch applied, no changes
    ctx.stretchNoopKey = computePosterStretch(ctx);
    expect(p1._classes.has(POSTER_STRETCH_CLASS)).toBe(false);
    expect(p2._classes.has(POSTER_STRETCH_CLASS)).toBe(false);
    // Bail-out key should be set (output matched input — both zero stretch)
    expect(ctx.stretchNoopKey).not.toBe(0);

    const keyAfterFirst = ctx.stretchNoopKey;

    // Second run: same composition → should bail out immediately
    ctx.stretchNoopKey = computePosterStretch(ctx);
    expect(ctx.stretchNoopKey).toBe(keyAfterFirst);
    expect(p1._classes.has(POSTER_STRETCH_CLASS)).toBe(false);
    expect(p2._classes.has(POSTER_STRETCH_CLASS)).toBe(false);
  });

  it('bail-out resets when card count changes', () => {
    const p1 = mockElement({
      classes: ['image-format-poster', 'has-poster'],
      height: 200,
    });
    const p2 = mockElement({
      classes: ['image-format-poster', 'has-poster'],
      height: 200,
    });

    const items: { el: MockElement }[] = [{ el: p1 }, { el: p2 }];
    const ctx = makeCtx({
      columns: 2,
      virtualItemsByGroup: new Map([['default', items]]),
    });

    ctx.stretchNoopKey = computePosterStretch(ctx);
    expect(ctx.stretchNoopKey).not.toBe(0);

    // Add a card — totalItems changes, key should no longer match
    const p3 = mockElement({
      classes: ['image-format-poster', 'has-poster'],
      height: 200,
    });
    items.push({ el: p3 });

    const keyBefore = ctx.stretchNoopKey;
    ctx.stretchNoopKey = computePosterStretch(ctx);
    // Key was recalculated (ran fully), not the old key
    expect(ctx.stretchNoopKey).not.toBe(keyBefore);
  });

  it('bail-out resets when stretch result changes', () => {
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

    // First run: stretch applied (imageless taller) — output differs from
    // input (no prior stretch) → key NOT set
    ctx.stretchNoopKey = computePosterStretch(ctx);
    expect(poster._classes.has(POSTER_STRETCH_CLASS)).toBe(true);
    expect(ctx.stretchNoopKey).toBe(0);

    // Second run: same composition, stretch was already applied last time
    // and will be re-applied identically → output matches input → key SET
    ctx.stretchNoopKey = computePosterStretch(ctx);
    expect(poster._classes.has(POSTER_STRETCH_CLASS)).toBe(true);
    expect(ctx.stretchNoopKey).not.toBe(0);

    // Third run: bail out — key matches
    const keyBefore = ctx.stretchNoopKey;
    ctx.stretchNoopKey = computePosterStretch(ctx);
    expect(ctx.stretchNoopKey).toBe(keyBefore);
  });

  it('bail-out resets when image-ready count changes', () => {
    const p1 = mockElement({
      classes: ['image-format-poster', 'has-poster'],
      height: 200,
    });
    const p2 = mockElement({
      classes: ['image-format-poster', 'has-poster'],
      height: 200,
    });

    const ctx = makeCtx({
      columns: 2,
      virtualItemsByGroup: new Map([['default', [{ el: p1 }, { el: p2 }]]]),
    });

    ctx.stretchNoopKey = computePosterStretch(ctx);
    expect(ctx.stretchNoopKey).not.toBe(0);

    // Change imageReadyCount — simulates an image finishing load
    ctx.imageReadyCount = 1;

    const keyBefore = ctx.stretchNoopKey;
    ctx.stretchNoopKey = computePosterStretch(ctx);
    // Ran fully — new key computed, not the old one
    expect(ctx.stretchNoopKey).not.toBe(keyBefore);
  });
});
