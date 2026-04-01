import { describe, it, expect } from 'vitest';
import { canFlushImageRelayout } from '../../src/bases/masonry-view';

const idle = {
  pendingImageRelayout: true,
  postResizeScrollActive: false,
  resizeCorrectionActive: false,
  inMountRemeasure: false,
  batchLayoutPending: false,
};

describe('canFlushImageRelayout', () => {
  it('returns true when pending and no guards active', () => {
    expect(canFlushImageRelayout(idle)).toBe(true);
  });

  it('returns false when no pending relayout', () => {
    expect(canFlushImageRelayout({ ...idle, pendingImageRelayout: false })).toBe(
      false,
    );
  });

  it.each([
    ['postResizeScrollActive', { postResizeScrollActive: true }],
    ['resizeCorrectionActive', { resizeCorrectionActive: true }],
    ['inMountRemeasure', { inMountRemeasure: true }],
    ['batchLayoutPending', { batchLayoutPending: true }],
  ] as const)('returns false when %s is true', (_name, override) => {
    expect(canFlushImageRelayout({ ...idle, ...override })).toBe(false);
  });

  it('returns false when multiple guards active', () => {
    expect(
      canFlushImageRelayout({
        ...idle,
        postResizeScrollActive: true,
        batchLayoutPending: true,
      }),
    ).toBe(false);
  });
});
