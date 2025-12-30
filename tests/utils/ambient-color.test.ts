import {
  extractDominantColor,
  formatAmbientColor,
  calculateLuminanceFromTuple,
  LUMINANCE_LIGHT_THRESHOLD,
} from "../../src/utils/ambient-color";

describe("ambient-color", () => {
  describe("extractDominantColor", () => {
    let mockImg: HTMLImageElement;
    let mockCtx: Partial<CanvasRenderingContext2D>;
    let mockCanvas: Partial<HTMLCanvasElement>;
    let createElementSpy: jest.SpyInstance;

    beforeEach(() => {
      // Create mock image using prototype to avoid spy
      mockImg = Document.prototype.createElement.call(
        document,
        "img",
      ) as HTMLImageElement;
      mockImg.width = 100;
      mockImg.height = 100;

      // Create mock pixel data for 50x50 canvas (2500 pixels * 4 channels = 10000)
      // All pixels set to RGB(100, 150, 200)
      const pixelData = new Uint8ClampedArray(50 * 50 * 4);
      for (let i = 0; i < pixelData.length; i += 4) {
        pixelData[i] = 100; // R
        pixelData[i + 1] = 150; // G
        pixelData[i + 2] = 200; // B
        pixelData[i + 3] = 255; // A
      }

      mockCtx = {
        drawImage: jest.fn(),
        getImageData: jest.fn().mockReturnValue({
          data: pixelData,
        }),
      };

      mockCanvas = {
        width: 0,
        height: 0,
        getContext: jest.fn().mockReturnValue(mockCtx),
      };

      createElementSpy = jest
        .spyOn(document, "createElement")
        .mockImplementation((tagName: string) => {
          if (tagName === "canvas") {
            return mockCanvas as HTMLCanvasElement;
          }
          // Call native implementation for non-canvas elements
          return Document.prototype.createElement.call(document, tagName);
        });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("should extract average color and return RGB tuple", () => {
      const result = extractDominantColor(mockImg);
      expect(result).toEqual([100, 150, 200]);
    });

    it("should return null when getContext returns null", () => {
      mockCanvas.getContext = jest.fn().mockReturnValue(null);
      const result = extractDominantColor(mockImg);
      expect(result).toBeNull();
    });

    it("should return null when getImageData throws CORS error", () => {
      mockCtx.getImageData = jest.fn().mockImplementation(() => {
        throw new Error("Unable to access image data: CORS");
      });
      const result = extractDominantColor(mockImg);
      expect(result).toBeNull();
    });

    it("should return null when canvas is tainted", () => {
      mockCtx.getImageData = jest.fn().mockImplementation(() => {
        throw new Error("Canvas is tainted");
      });
      const result = extractDominantColor(mockImg);
      expect(result).toBeNull();
    });

    it("should calculate average of mixed colors", () => {
      // Create pixel data with varying colors
      const pixelData = new Uint8ClampedArray(50 * 50 * 4);
      // Half pixels are (0, 0, 0), half are (200, 200, 200)
      for (let i = 0; i < pixelData.length; i += 4) {
        const isFirstHalf = i < pixelData.length / 2;
        pixelData[i] = isFirstHalf ? 0 : 200;
        pixelData[i + 1] = isFirstHalf ? 0 : 200;
        pixelData[i + 2] = isFirstHalf ? 0 : 200;
        pixelData[i + 3] = 255;
      }
      mockCtx.getImageData = jest.fn().mockReturnValue({ data: pixelData });

      const result = extractDominantColor(mockImg);
      // Average should be (100, 100, 100)
      expect(result).toEqual([100, 100, 100]);
    });

    it("should use 50x50 canvas for performance", () => {
      extractDominantColor(mockImg);
      expect(mockCanvas.width).toBe(50);
      expect(mockCanvas.height).toBe(50);
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
