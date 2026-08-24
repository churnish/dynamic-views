import { describe, it, expect } from 'vitest';
import {
  isCorrectionBlocked,
  type CorrectionGuardState,
} from '../../src/bases/masonry-view';

const idle: CorrectionGuardState = {
  connected: true,
  batchLayoutPending: false,
  resizeCorrectionActive: false,
  inMountRemeasure: false,
  postResizeScrollActive: false,
  hasLayout: true,
};

describe('isCorrectionBlocked', () => {
  it('is unblocked when connected with layout and all flags false', () => {
    expect(isCorrectionBlocked(idle)).toBe(false);
  });

  it.each([
    ['batchLayoutPending', { batchLayoutPending: true }],
    ['resizeCorrectionActive', { resizeCorrectionActive: true }],
    ['inMountRemeasure', { inMountRemeasure: true }],
  ] as const)('blocks when %s is true', (_name, override) => {
    expect(isCorrectionBlocked({ ...idle, ...override })).toBe(true);
  });

  it('blocks when disconnected', () => {
    expect(isCorrectionBlocked({ ...idle, connected: false })).toBe(true);
  });

  it('blocks when no layout exists yet', () => {
    expect(isCorrectionBlocked({ ...idle, hasLayout: false })).toBe(true);
  });

  it('blocks when multiple guards active', () => {
    expect(
      isCorrectionBlocked({
        ...idle,
        batchLayoutPending: true,
        inMountRemeasure: true,
      })
    ).toBe(true);
  });

  describe('postResize semantics', () => {
    const postResize = { ...idle, postResizeScrollActive: true };

    it("'block' (default) blocks during the post-resize scroll window", () => {
      expect(isCorrectionBlocked(postResize)).toBe(true);
      expect(isCorrectionBlocked(postResize, 'block')).toBe(true);
    });

    it("'ignore' does not block during the post-resize scroll window", () => {
      expect(isCorrectionBlocked(postResize, 'ignore')).toBe(false);
    });

    it("'require' blocks OUTSIDE the post-resize scroll window", () => {
      expect(isCorrectionBlocked(idle, 'require')).toBe(true);
    });

    it("'require' passes DURING the post-resize scroll window", () => {
      expect(isCorrectionBlocked(postResize, 'require')).toBe(false);
    });

    it('hard guards still block regardless of postResize mode', () => {
      const busy = { ...postResize, batchLayoutPending: true };
      expect(isCorrectionBlocked(busy, 'ignore')).toBe(true);
      expect(isCorrectionBlocked(busy, 'require')).toBe(true);
    });
  });
});
