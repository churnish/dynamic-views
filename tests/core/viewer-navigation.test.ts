import { getNextImageIndex } from '../../src/core/viewer-navigation';

describe('getNextImageIndex', () => {
  const urls = ['a', 'b', 'c', 'd'];
  const noneBroken = () => false;
  const brokenSet = (...broken: string[]) => {
    const set = new Set(broken);
    return (url: string) => set.has(url);
  };

  describe('stepping', () => {
    it('steps forward', () => {
      expect(getNextImageIndex(0, 1, urls, noneBroken)).toBe(1);
    });

    it('steps backward', () => {
      expect(getNextImageIndex(2, -1, urls, noneBroken)).toBe(1);
    });

    it('wraps forward past the end', () => {
      expect(getNextImageIndex(3, 1, urls, noneBroken)).toBe(0);
    });

    it('wraps back past the start', () => {
      expect(getNextImageIndex(0, -1, urls, noneBroken)).toBe(3);
    });
  });

  describe('broken entries', () => {
    it('skips a single broken middle entry', () => {
      expect(getNextImageIndex(0, 1, urls, brokenSet('b'))).toBe(2);
    });

    it('skips a run of broken entries', () => {
      expect(getNextImageIndex(0, 1, urls, brokenSet('b', 'c'))).toBe(3);
    });

    it('skips broken entries backward', () => {
      expect(getNextImageIndex(3, -1, urls, brokenSet('c', 'b'))).toBe(0);
    });

    it('wraps past the end while skipping broken entries', () => {
      expect(getNextImageIndex(1, 1, urls, brokenSet('c', 'd'))).toBe(0);
    });

    it('returns -1 when every entry is broken', () => {
      expect(getNextImageIndex(0, 1, urls, brokenSet('a', 'b', 'c', 'd'))).toBe(
        -1
      );
    });

    it('returns -1 when only the current entry is valid', () => {
      expect(getNextImageIndex(0, 1, urls, brokenSet('b', 'c', 'd'))).toBe(-1);
    });

    it('steps away from a broken current entry', () => {
      expect(getNextImageIndex(1, 1, urls, brokenSet('b'))).toBe(2);
    });

    it('wraps away from a broken current entry at the end', () => {
      expect(getNextImageIndex(3, 1, urls, brokenSet('d'))).toBe(0);
    });
  });

  describe('degenerate input', () => {
    it('returns -1 for a single-entry array', () => {
      expect(getNextImageIndex(0, 1, ['a'], noneBroken)).toBe(-1);
    });

    it('returns -1 for an empty array', () => {
      expect(getNextImageIndex(0, 1, [], noneBroken)).toBe(-1);
    });
  });
});
