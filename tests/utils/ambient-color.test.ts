import {
  extractDominantColor,
  formatAmbientColor,
  calculateLuminance,
  calculateLuminanceFromTuple,
  LUMINANCE_LIGHT_THRESHOLD,
  rgbTupleToString,
} from "../../src/utils/ambient-color";

// Mock colorthief with configurable behavior
const mockGetColor = jest.fn().mockReturnValue([100, 150, 200]);
jest.mock("colorthief", () => {
  return jest.fn().mockImplementation(() => ({
    getColor: mockGetColor,
  }));
});

describe("ambient-color", () => {
  describe("extractDominantColor", () => {
    let mockImg: HTMLImageElement;

    beforeEach(() => {
      mockImg = document.createElement("img") as HTMLImageElement;
      mockImg.width = 100;
      mockImg.height = 100;
      mockGetColor.mockClear();
      mockGetColor.mockReturnValue([100, 150, 200]);
    });

    it("should extract dominant color and return RGB tuple", () => {
      const result = extractDominantColor(mockImg);
      expect(result).toEqual([100, 150, 200]);
    });

    it("should return null when ColorThief throws CORS error", () => {
      mockGetColor.mockImplementation(() => {
        throw new Error("Unable to access image data: CORS");
      });
      const result = extractDominantColor(mockImg);
      expect(result).toBeNull();
    });

    it("should return null when ColorThief throws canvas error", () => {
      mockGetColor.mockImplementation(() => {
        throw new Error("Canvas is tainted");
      });
      const result = extractDominantColor(mockImg);
      expect(result).toBeNull();
    });

    it("should return null for invalid image", () => {
      mockGetColor.mockImplementation(() => {
        throw new Error("Image is not loaded");
      });
      const result = extractDominantColor(mockImg);
      expect(result).toBeNull();
    });
  });

  describe("rgbTupleToString", () => {
    it("should convert RGB tuple to css string", () => {
      expect(rgbTupleToString([100, 150, 200])).toBe("rgb(100, 150, 200)");
      expect(rgbTupleToString([0, 0, 0])).toBe("rgb(0, 0, 0)");
      expect(rgbTupleToString([255, 255, 255])).toBe("rgb(255, 255, 255)");
    });
  });

  describe("formatAmbientColor", () => {
    it("should format RGB tuple with given alpha", () => {
      expect(formatAmbientColor([100, 150, 200], 0.25)).toBe(
        "rgba(100, 150, 200, 0.25)",
      );
      expect(formatAmbientColor([255, 0, 128], 0.9)).toBe(
        "rgba(255, 0, 128, 0.9)",
      );
    });

    it("should handle edge alpha values", () => {
      expect(formatAmbientColor([100, 100, 100], 0)).toBe(
        "rgba(100, 100, 100, 0)",
      );
      expect(formatAmbientColor([100, 100, 100], 1)).toBe(
        "rgba(100, 100, 100, 1)",
      );
    });
  });

  describe("calculateLuminance", () => {
    it("should calculate luminance for black", () => {
      const result = calculateLuminance("rgb(0, 0, 0)");
      expect(result).toBeCloseTo(0, 5);
    });

    it("should calculate luminance for white", () => {
      const result = calculateLuminance("rgb(255, 255, 255)");
      expect(result).toBeCloseTo(1, 5);
    });

    it("should calculate luminance for gray", () => {
      const result = calculateLuminance("rgb(128, 128, 128)");
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(1);
      expect(result).toBeCloseTo(0.215, 2); // Mid gray ~21.5% luminance
    });

    it("should calculate luminance for red", () => {
      const result = calculateLuminance("rgb(255, 0, 0)");
      // Red has lowest weight in WCAG formula (0.2126)
      expect(result).toBeCloseTo(0.2126, 3);
    });

    it("should calculate luminance for green", () => {
      const result = calculateLuminance("rgb(0, 255, 0)");
      // Green has highest weight in WCAG formula (0.7152)
      expect(result).toBeCloseTo(0.7152, 3);
    });

    it("should calculate luminance for blue", () => {
      const result = calculateLuminance("rgb(0, 0, 255)");
      // Blue has lowest weight in WCAG formula (0.0722)
      expect(result).toBeCloseTo(0.0722, 3);
    });

    it("should handle RGB strings with spaces", () => {
      const result1 = calculateLuminance("rgb(128, 128, 128)");
      const result2 = calculateLuminance("rgb(128,128,128)");
      expect(result1).toBe(result2);
    });

    it("should return 0.5 for invalid RGB strings", () => {
      expect(calculateLuminance("invalid")).toBe(0.5);
      expect(calculateLuminance("rgb()")).toBe(0.5);
      expect(calculateLuminance("rgb(a, b, c)")).toBe(0.5);
      expect(calculateLuminance("#ffffff")).toBe(0.5);
    });

    it("should apply gamma correction correctly", () => {
      // Low values use linear scaling (val / 12.92)
      const lowResult = calculateLuminance("rgb(10, 10, 10)");
      expect(lowResult).toBeGreaterThan(0);

      // High values use power formula
      const highResult = calculateLuminance("rgb(200, 200, 200)");
      expect(highResult).toBeGreaterThan(lowResult);
    });

    it("should use WCAG formula weights (0.2126, 0.7152, 0.0722)", () => {
      // Pure colors should reflect the weights
      const redLum = calculateLuminance("rgb(255, 0, 0)");
      const greenLum = calculateLuminance("rgb(0, 255, 0)");
      const blueLum = calculateLuminance("rgb(0, 0, 255)");

      // Green should have highest luminance
      expect(greenLum).toBeGreaterThan(redLum);
      expect(greenLum).toBeGreaterThan(blueLum);

      // Red should have higher luminance than blue
      expect(redLum).toBeGreaterThan(blueLum);
    });

    it("should clamp RGB values > 255 to 255", () => {
      // Values above 255 should be clamped
      const result = calculateLuminance("rgb(300, 500, 999)");
      const white = calculateLuminance("rgb(255, 255, 255)");
      expect(result).toBeCloseTo(white, 5);
    });

    it("should return fallback for negative RGB values (invalid CSS)", () => {
      // Negative values don't match the regex (invalid CSS), returns 0.5 fallback
      const result = calculateLuminance("rgb(-10, -50, -100)");
      expect(result).toBe(0.5);
    });

    it("should handle rgba format", () => {
      const rgb = calculateLuminance("rgb(128, 128, 128)");
      const rgba = calculateLuminance("rgba(128, 128, 128, 0.5)");
      expect(rgb).toBeCloseTo(rgba, 5);
    });
  });

  describe("calculateLuminanceFromTuple", () => {
    it("should calculate luminance for black", () => {
      const result = calculateLuminanceFromTuple([0, 0, 0]);
      expect(result).toBeCloseTo(0, 5);
    });

    it("should calculate luminance for white", () => {
      const result = calculateLuminanceFromTuple([255, 255, 255]);
      expect(result).toBeCloseTo(1, 5);
    });

    it("should calculate luminance for gray", () => {
      const result = calculateLuminanceFromTuple([128, 128, 128]);
      expect(result).toBeCloseTo(0.215, 2);
    });

    it("should match calculateLuminance for same colors", () => {
      const tuple: [number, number, number] = [100, 150, 200];
      const fromTuple = calculateLuminanceFromTuple(tuple);
      const fromString = calculateLuminance(rgbTupleToString(tuple));
      expect(fromTuple).toBeCloseTo(fromString, 10);
    });

    it("should use WCAG formula weights", () => {
      const redLum = calculateLuminanceFromTuple([255, 0, 0]);
      const greenLum = calculateLuminanceFromTuple([0, 255, 0]);
      const blueLum = calculateLuminanceFromTuple([0, 0, 255]);

      expect(greenLum).toBeGreaterThan(redLum);
      expect(greenLum).toBeGreaterThan(blueLum);
      expect(redLum).toBeGreaterThan(blueLum);
    });
  });

  describe("LUMINANCE_LIGHT_THRESHOLD", () => {
    it("should be 0.333", () => {
      expect(LUMINANCE_LIGHT_THRESHOLD).toBe(0.333);
    });

    it("should correctly classify light vs dark colors", () => {
      // White is light
      expect(calculateLuminanceFromTuple([255, 255, 255])).toBeGreaterThan(
        LUMINANCE_LIGHT_THRESHOLD,
      );

      // Black is dark
      expect(calculateLuminanceFromTuple([0, 0, 0])).toBeLessThan(
        LUMINANCE_LIGHT_THRESHOLD,
      );

      // Mid-gray is dark (~0.215 < 0.333)
      expect(calculateLuminanceFromTuple([128, 128, 128])).toBeLessThan(
        LUMINANCE_LIGHT_THRESHOLD,
      );

      // Light gray is light
      expect(calculateLuminanceFromTuple([200, 200, 200])).toBeGreaterThan(
        LUMINANCE_LIGHT_THRESHOLD,
      );
    });
  });
});
