import {
  extractAverageColor,
  calculateLuminance,
  getColorTheme,
} from "../../src/utils/image-color";

describe("image-color", () => {
  describe("extractAverageColor", () => {
    let mockImg: HTMLImageElement;

    beforeEach(() => {
      mockImg = document.createElement("img") as HTMLImageElement;
      mockImg.width = 100;
      mockImg.height = 100;
    });

    it("should extract average color from image", () => {
      const result = extractAverageColor(mockImg);

      // Default mock returns all gray pixels (128, 128, 128)
      expect(result).toBe("rgb(128, 128, 128)");
    });

    it("should return fallback gray when canvas context unavailable", () => {
      // Mock getContext to return null
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = jest.fn(() => null);

      const result = extractAverageColor(mockImg);

      expect(result).toBe("rgb(128, 128, 128)");

      // Restore
      HTMLCanvasElement.prototype.getContext = originalGetContext;
    });

    it("should scale image to target size for performance", () => {
      const mockContext = {
        drawImage: jest.fn(),
        getImageData: jest.fn(() => ({
          data: new Uint8ClampedArray(50 * 50 * 4).fill(128),
        })),
      };

      HTMLCanvasElement.prototype.getContext = jest.fn(
        () => mockContext as any,
      );

      extractAverageColor(mockImg);

      // Should draw to 50x50 canvas
      expect(mockContext.drawImage).toHaveBeenCalledWith(mockImg, 0, 0, 50, 50);
    });

    it("should calculate average of all pixels", () => {
      const pixelData = new Uint8ClampedArray(50 * 50 * 4);

      // First half red (255, 0, 0), second half blue (0, 0, 255)
      for (let i = 0; i < pixelData.length / 2; i += 4) {
        pixelData[i] = 255; // R
        pixelData[i + 1] = 0; // G
        pixelData[i + 2] = 0; // B
        pixelData[i + 3] = 255; // A
      }
      for (let i = pixelData.length / 2; i < pixelData.length; i += 4) {
        pixelData[i] = 0; // R
        pixelData[i + 1] = 0; // G
        pixelData[i + 2] = 255; // B
        pixelData[i + 3] = 255; // A
      }

      const mockContext = {
        drawImage: jest.fn(),
        getImageData: jest.fn(() => ({ data: pixelData })),
      };

      HTMLCanvasElement.prototype.getContext = jest.fn(
        () => mockContext as any,
      );

      const result = extractAverageColor(mockImg);

      // Average should be purple-ish (127, 0, 127)
      expect(result).toBe("rgb(127, 0, 127)");
    });

    it("should ignore alpha channel when calculating average", () => {
      const pixelData = new Uint8ClampedArray(50 * 50 * 4);

      // All pixels white but varying alpha
      for (let i = 0; i < pixelData.length; i += 4) {
        pixelData[i] = 255; // R
        pixelData[i + 1] = 255; // G
        pixelData[i + 2] = 255; // B
        pixelData[i + 3] = Math.random() * 255; // Random alpha
      }

      const mockContext = {
        drawImage: jest.fn(),
        getImageData: jest.fn(() => ({ data: pixelData })),
      };

      HTMLCanvasElement.prototype.getContext = jest.fn(
        () => mockContext as any,
      );

      const result = extractAverageColor(mockImg);

      // Should be white regardless of alpha
      expect(result).toBe("rgb(255, 255, 255)");
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
  });

  describe("getColorTheme", () => {
    it('should return "light" for white', () => {
      expect(getColorTheme("rgb(255, 255, 255)")).toBe("light");
    });

    it('should return "dark" for black', () => {
      expect(getColorTheme("rgb(0, 0, 0)")).toBe("dark");
    });

    it('should return "dark" for mid-gray (luminance ~0.215 < 0.5)', () => {
      expect(getColorTheme("rgb(128, 128, 128)")).toBe("dark");
    });

    it('should return "light" for light gray', () => {
      expect(getColorTheme("rgb(200, 200, 200)")).toBe("light");
    });

    it('should return "light" for green (high luminance)', () => {
      expect(getColorTheme("rgb(0, 255, 0)")).toBe("light");
    });

    it('should return "dark" for red', () => {
      expect(getColorTheme("rgb(255, 0, 0)")).toBe("dark");
    });

    it('should return "dark" for blue (low luminance)', () => {
      expect(getColorTheme("rgb(0, 0, 255)")).toBe("dark");
    });

    it("should use 0.5 as threshold", () => {
      // Just below threshold should be dark
      const darkColor = "rgb(120, 120, 120)"; // Luminance ~0.184
      expect(getColorTheme(darkColor)).toBe("dark");

      // Just above threshold should be light
      const lightColor = "rgb(190, 190, 190)"; // Luminance ~0.527
      expect(getColorTheme(lightColor)).toBe("light");
    });

    it("should handle invalid RGB strings gracefully", () => {
      // Invalid strings return 0.5 luminance fallback
      // 0.5 > 0.3 threshold, so should return 'light'
      expect(getColorTheme("invalid")).toBe("light");
    });

    it("should work with various color combinations", () => {
      expect(getColorTheme("rgb(255, 255, 0)")).toBe("light"); // Yellow (bright)
      expect(getColorTheme("rgb(255, 0, 255)")).toBe("dark"); // Magenta
      expect(getColorTheme("rgb(0, 255, 255)")).toBe("light"); // Cyan (bright)
      expect(getColorTheme("rgb(128, 0, 0)")).toBe("dark"); // Dark red
    });
  });
});
