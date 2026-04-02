import {
  computeHoverScale,
  HOVER_GROWTH_PX,
  MAX_HOVER_SCALE,
} from '../../src/shared/constants';

describe('constants', () => {
  describe('computeHoverScale', () => {
    it('returns empty string for height = 0', () => {
      expect(computeHoverScale(0)).toBe('');
    });

    it('returns empty string for negative height', () => {
      expect(computeHoverScale(-10)).toBe('');
      expect(computeHoverScale(-100)).toBe('');
    });

    it('caps at MAX_HOVER_SCALE for small heights', () => {
      // For very small heights, the formula exceeds MAX_HOVER_SCALE
      expect(computeHoverScale(1)).toBe(String(MAX_HOVER_SCALE));
      expect(computeHoverScale(10)).toBe(String(MAX_HOVER_SCALE));
    });

    it('returns expected value for typical card height (200px)', () => {
      // 1 + (4 * 2) / 200 = 1 + 8/200 = 1.04 (coincides with MAX_HOVER_SCALE)
      expect(computeHoverScale(200)).toBe(String(MAX_HOVER_SCALE));
    });

    it('returns expected value for tall card (400px)', () => {
      // 1 + (4 * 2) / 400 = 1 + 8/400 = 1.02
      const result = computeHoverScale(400);
      expect(Number(result)).toBeCloseTo(1.02, 5);
    });

    it('returns expected value for very tall card (1000px)', () => {
      // 1 + (4 * 2) / 1000 = 1 + 8/1000 = 1.008
      const result = computeHoverScale(1000);
      expect(Number(result)).toBeCloseTo(1.008, 5);
    });
  });

  describe('cached hover scale CSS roundtrip', () => {
    it.each([
      [206, 350], // typical grid card
      [300, 150], // wide short card
      [150, 800], // narrow tall card
    ])(
      'setProperty/getPropertyValue roundtrip for width=%i height=%i',
      (width, height) => {
        const el = document.createElement('div');
        const scaleX = computeHoverScale(width);
        const scaleY = computeHoverScale(height);

        el.style.setProperty('--hover-scale-x', scaleX);
        el.style.setProperty('--hover-scale-y', scaleY);

        expect(el.style.getPropertyValue('--hover-scale-x')).toBe(scaleX);
        expect(el.style.getPropertyValue('--hover-scale-y')).toBe(scaleY);
      }
    );
  });
});
