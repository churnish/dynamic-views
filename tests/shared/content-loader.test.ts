import { TFile, App } from "obsidian";
import {
  loadImageForEntry,
  loadImagesForEntries,
  loadTextPreviewForEntry,
  loadTextPreviewsForEntries,
  clearInFlightLoads,
} from "../../src/shared/content-loader";

// Mock image utilities
jest.mock("../../src/utils/image", () => ({
  processImagePaths: jest.fn(),
  resolveInternalImagePaths: jest.fn(),
  extractImageEmbeds: jest.fn(),
}));

// Mock text-preview utility
jest.mock("../../src/utils/text-preview", () => ({
  loadFilePreview: jest.fn(),
}));

describe("content-loader", () => {
  let mockApp: App;
  let mockFile: TFile;
  let mockImageUtils: {
    processImagePaths: jest.Mock;
    resolveInternalImagePaths: jest.Mock;
    extractImageEmbeds: jest.Mock;
  };
  let mockPreviewUtils: {
    loadFilePreview: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    clearInFlightLoads();

    mockApp = new App();

    mockFile = new TFile();
    mockFile.path = "test/file.md";
    mockFile.basename = "file";
    mockFile.extension = "md";

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mockImageUtils = require("../../src/utils/image");
    mockImageUtils.processImagePaths.mockReturnValue({
      internalPaths: [],
      externalUrls: [],
    });
    mockImageUtils.resolveInternalImagePaths.mockReturnValue([]);
    mockImageUtils.extractImageEmbeds.mockResolvedValue([]);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mockPreviewUtils = require("../../src/utils/text-preview");
    mockPreviewUtils.loadFilePreview.mockResolvedValue("preview text");
  });

  describe("loadImageForEntry", () => {
    it("should skip if path already in cache", async () => {
      const imageCache: Record<string, string | string[]> = {
        "test/file.md": "cached-image.png",
      };
      const hasImageCache: Record<string, boolean> = { "test/file.md": true };

      await loadImageForEntry(
        "test/file.md",
        mockFile,
        mockApp,
        [],
        "never",
        imageCache,
        hasImageCache,
      );

      expect(mockImageUtils.processImagePaths).not.toHaveBeenCalled();
    });

    it("should store single image as string", async () => {
      const imageCache: Record<string, string | string[]> = {};
      const hasImageCache: Record<string, boolean> = {};

      mockImageUtils.processImagePaths.mockReturnValue({
        internalPaths: [],
        externalUrls: ["https://example.com/image.png"],
      });

      await loadImageForEntry(
        "test/file.md",
        mockFile,
        mockApp,
        ["https://example.com/image.png"],
        "never",
        imageCache,
        hasImageCache,
      );

      expect(imageCache["test/file.md"]).toBe("https://example.com/image.png");
      expect(hasImageCache["test/file.md"]).toBe(true);
    });

    it("should store multiple images as array", async () => {
      const imageCache: Record<string, string | string[]> = {};
      const hasImageCache: Record<string, boolean> = {};

      mockImageUtils.processImagePaths.mockReturnValue({
        internalPaths: [],
        externalUrls: ["img1.png", "img2.png"],
      });

      await loadImageForEntry(
        "test/file.md",
        mockFile,
        mockApp,
        ["img1.png", "img2.png"],
        "never",
        imageCache,
        hasImageCache,
      );

      expect(imageCache["test/file.md"]).toEqual(["img1.png", "img2.png"]);
      expect(hasImageCache["test/file.md"]).toBe(true);
    });

    it("should resolve internal image paths", async () => {
      const imageCache: Record<string, string | string[]> = {};
      const hasImageCache: Record<string, boolean> = {};

      mockImageUtils.processImagePaths.mockReturnValue({
        internalPaths: ["assets/image.png"],
        externalUrls: [],
      });
      mockImageUtils.resolveInternalImagePaths.mockReturnValue([
        "app://vault/assets/image.png",
      ]);

      await loadImageForEntry(
        "test/file.md",
        mockFile,
        mockApp,
        ["assets/image.png"],
        "never",
        imageCache,
        hasImageCache,
      );

      expect(mockImageUtils.resolveInternalImagePaths).toHaveBeenCalledWith(
        ["assets/image.png"],
        "test/file.md",
        mockApp,
      );
      expect(imageCache["test/file.md"]).toBe("app://vault/assets/image.png");
      expect(hasImageCache["test/file.md"]).toBe(true);
    });

    it('should append embeds when fallbackToEmbeds is "always"', async () => {
      const imageCache: Record<string, string | string[]> = {};
      const hasImageCache: Record<string, boolean> = {};

      mockImageUtils.processImagePaths.mockReturnValue({
        internalPaths: [],
        externalUrls: ["property.png"],
      });
      mockImageUtils.extractImageEmbeds.mockResolvedValue(["embed.png"]);

      await loadImageForEntry(
        "test/file.md",
        mockFile,
        mockApp,
        ["property.png"],
        "always",
        imageCache,
        hasImageCache,
      );

      expect(imageCache["test/file.md"]).toEqual(["property.png", "embed.png"]);
      expect(mockImageUtils.extractImageEmbeds).toHaveBeenCalledWith(
        mockFile,
        mockApp,
        undefined,
      );
    });

    it('should use embeds only when empty with fallbackToEmbeds "if-empty"', async () => {
      const imageCache: Record<string, string | string[]> = {};
      const hasImageCache: Record<string, boolean> = {};

      mockImageUtils.processImagePaths.mockReturnValue({
        internalPaths: [],
        externalUrls: [],
      });
      mockImageUtils.extractImageEmbeds.mockResolvedValue(["embed.png"]);

      await loadImageForEntry(
        "test/file.md",
        mockFile,
        mockApp,
        [],
        "if-empty",
        imageCache,
        hasImageCache,
      );

      expect(imageCache["test/file.md"]).toBe("embed.png");
    });

    it('should not use embeds when property images exist with "if-empty"', async () => {
      const imageCache: Record<string, string | string[]> = {};
      const hasImageCache: Record<string, boolean> = {};

      mockImageUtils.processImagePaths.mockReturnValue({
        internalPaths: [],
        externalUrls: ["property.png"],
      });

      await loadImageForEntry(
        "test/file.md",
        mockFile,
        mockApp,
        ["property.png"],
        "if-empty",
        imageCache,
        hasImageCache,
      );

      expect(mockImageUtils.extractImageEmbeds).not.toHaveBeenCalled();
      expect(imageCache["test/file.md"]).toBe("property.png");
    });

    it('should ignore embeds completely when fallbackToEmbeds is "never"', async () => {
      const imageCache: Record<string, string | string[]> = {};
      const hasImageCache: Record<string, boolean> = {};

      mockImageUtils.processImagePaths.mockReturnValue({
        internalPaths: [],
        externalUrls: [],
      });

      await loadImageForEntry(
        "test/file.md",
        mockFile,
        mockApp,
        [],
        "never",
        imageCache,
        hasImageCache,
      );

      expect(mockImageUtils.extractImageEmbeds).not.toHaveBeenCalled();
      expect(imageCache["test/file.md"]).toBeUndefined();
    });

    it("should catch errors and not throw", async () => {
      const imageCache: Record<string, string | string[]> = {};
      const hasImageCache: Record<string, boolean> = {};

      mockImageUtils.processImagePaths.mockImplementation(() => {
        throw new Error("Test error");
      });
      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await expect(
        loadImageForEntry(
          "test/file.md",
          mockFile,
          mockApp,
          [],
          "never",
          imageCache,
          hasImageCache,
        ),
      ).resolves.not.toThrow();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("loadImagesForEntries", () => {
    it("should process multiple entries in parallel", async () => {
      const imageCache: Record<string, string | string[]> = {};
      const hasImageCache: Record<string, boolean> = {};

      const file1 = new TFile();
      file1.path = "file1.md";
      file1.extension = "md";

      const file2 = new TFile();
      file2.path = "file2.md";
      file2.extension = "md";

      mockImageUtils.processImagePaths.mockReturnValue({
        internalPaths: [],
        externalUrls: ["image.png"],
      });

      await loadImagesForEntries(
        [
          { path: "file1.md", file: file1, imagePropertyValues: ["img1.png"] },
          { path: "file2.md", file: file2, imagePropertyValues: ["img2.png"] },
        ],
        "never",
        mockApp,
        imageCache,
        hasImageCache,
      );

      expect(mockImageUtils.processImagePaths).toHaveBeenCalledTimes(2);
      expect(imageCache["file1.md"]).toBe("image.png");
      expect(imageCache["file2.md"]).toBe("image.png");
    });
  });

  describe("loadTextPreviewForEntry", () => {
    it("should skip if path already in cache", async () => {
      const textPreviewCache: Record<string, string> = {
        "test/file.md": "cached text preview",
      };

      await loadTextPreviewForEntry(
        "test/file.md",
        mockFile,
        mockApp,
        null,
        true,
        "never",
        textPreviewCache,
      );

      expect(mockPreviewUtils.loadFilePreview).not.toHaveBeenCalled();
    });

    it("should load text preview via loadFilePreview for .md files", async () => {
      const textPreviewCache: Record<string, string> = {};

      await loadTextPreviewForEntry(
        "test/file.md",
        mockFile,
        mockApp,
        "preview property",
        true,
        "never",
        textPreviewCache,
      );

      expect(mockPreviewUtils.loadFilePreview).toHaveBeenCalledWith(
        mockFile,
        mockApp,
        "preview property",
        { fallbackToContent: true, omitFirstLine: "never" },
        undefined,
        undefined,
      );
      expect(textPreviewCache["test/file.md"]).toBe("preview text");
    });

    it("should pass optional fileName and titleString parameters", async () => {
      const textPreviewCache: Record<string, string> = {};

      await loadTextPreviewForEntry(
        "test/file.md",
        mockFile,
        mockApp,
        "preview property",
        true,
        "always",
        textPreviewCache,
        "myFile",
        "My Title",
      );

      expect(mockPreviewUtils.loadFilePreview).toHaveBeenCalledWith(
        mockFile,
        mockApp,
        "preview property",
        { fallbackToContent: true, omitFirstLine: "always" },
        "myFile",
        "My Title",
      );
    });

    it("should return empty string for non-.md files", async () => {
      const textPreviewCache: Record<string, string> = {};

      const pdfFile = new TFile();
      pdfFile.path = "document.pdf";
      pdfFile.extension = "pdf";

      await loadTextPreviewForEntry(
        "document.pdf",
        pdfFile,
        mockApp,
        null,
        true,
        "never",
        textPreviewCache,
      );

      expect(mockPreviewUtils.loadFilePreview).not.toHaveBeenCalled();
      expect(textPreviewCache["document.pdf"]).toBe("");
    });

    it("should catch errors and store empty string", async () => {
      const textPreviewCache: Record<string, string> = {};

      mockPreviewUtils.loadFilePreview.mockRejectedValue(
        new Error("Test error"),
      );
      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await loadTextPreviewForEntry(
        "test/file.md",
        mockFile,
        mockApp,
        null,
        true,
        "never",
        textPreviewCache,
      );

      expect(textPreviewCache["test/file.md"]).toBe("");
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("loadTextPreviewsForEntries", () => {
    it("should process multiple entries in parallel", async () => {
      const textPreviewCache: Record<string, string> = {};

      const file1 = new TFile();
      file1.path = "file1.md";
      file1.extension = "md";

      const file2 = new TFile();
      file2.path = "file2.md";
      file2.extension = "md";

      await loadTextPreviewsForEntries(
        [
          { path: "file1.md", file: file1, textPreviewData: "preview1" },
          { path: "file2.md", file: file2, textPreviewData: "preview2" },
        ],
        true,
        "never",
        mockApp,
        textPreviewCache,
      );

      expect(mockPreviewUtils.loadFilePreview).toHaveBeenCalledTimes(2);
      expect(textPreviewCache["file1.md"]).toBe("preview text");
      expect(textPreviewCache["file2.md"]).toBe("preview text");
    });
  });

  describe("concurrent Promise sharing", () => {
    it("should share Promise for concurrent image loads with same settings", async () => {
      const imageCache1: Record<string, string | string[]> = {};
      const hasImageCache1: Record<string, boolean> = {};
      const imageCache2: Record<string, string | string[]> = {};
      const hasImageCache2: Record<string, boolean> = {};

      mockImageUtils.processImagePaths.mockReturnValue({
        internalPaths: [],
        externalUrls: ["image.png"],
      });

      // Launch concurrent loads with same path and settings
      const promise1 = loadImageForEntry(
        "test/file.md",
        mockFile,
        mockApp,
        ["image.png"],
        "never",
        imageCache1,
        hasImageCache1,
      );
      const promise2 = loadImageForEntry(
        "test/file.md",
        mockFile,
        mockApp,
        ["image.png"],
        "never",
        imageCache2,
        hasImageCache2,
      );

      await Promise.all([promise1, promise2]);

      // processImagePaths should only be called once (shared Promise)
      expect(mockImageUtils.processImagePaths).toHaveBeenCalledTimes(1);
      // Both caches should have the result
      expect(imageCache1["test/file.md"]).toBe("image.png");
      expect(imageCache2["test/file.md"]).toBe("image.png");
    });

    it("should load independently for different fallbackToEmbeds values", async () => {
      const imageCache1: Record<string, string | string[]> = {};
      const hasImageCache1: Record<string, boolean> = {};
      const imageCache2: Record<string, string | string[]> = {};
      const hasImageCache2: Record<string, boolean> = {};

      mockImageUtils.processImagePaths.mockReturnValue({
        internalPaths: [],
        externalUrls: [],
      });
      mockImageUtils.extractImageEmbeds.mockResolvedValue(["embed.png"]);

      // Launch concurrent loads with same path but different fallbackToEmbeds
      const promise1 = loadImageForEntry(
        "test/file.md",
        mockFile,
        mockApp,
        [],
        "never",
        imageCache1,
        hasImageCache1,
      );
      const promise2 = loadImageForEntry(
        "test/file.md",
        mockFile,
        mockApp,
        [],
        "if-empty",
        imageCache2,
        hasImageCache2,
      );

      await Promise.all([promise1, promise2]);

      // processImagePaths should be called twice (different settings)
      expect(mockImageUtils.processImagePaths).toHaveBeenCalledTimes(2);
      // "never" should have no images
      expect(hasImageCache1["test/file.md"]).toBe(false);
      // "if-empty" should have embed
      expect(imageCache2["test/file.md"]).toBe("embed.png");
    });

    it("should load independently for different embedOptions", async () => {
      const imageCache1: Record<string, string | string[]> = {};
      const hasImageCache1: Record<string, boolean> = {};
      const imageCache2: Record<string, string | string[]> = {};
      const hasImageCache2: Record<string, boolean> = {};

      mockImageUtils.processImagePaths.mockReturnValue({
        internalPaths: [],
        externalUrls: [],
      });
      mockImageUtils.extractImageEmbeds.mockResolvedValue(["embed.png"]);

      // Launch concurrent loads with different embedOptions
      const promise1 = loadImageForEntry(
        "test/file.md",
        mockFile,
        mockApp,
        [],
        "always",
        imageCache1,
        hasImageCache1,
        { includeYoutube: true, includeCardLink: false },
      );
      const promise2 = loadImageForEntry(
        "test/file.md",
        mockFile,
        mockApp,
        [],
        "always",
        imageCache2,
        hasImageCache2,
        { includeYoutube: false, includeCardLink: true },
      );

      await Promise.all([promise1, promise2]);

      // extractImageEmbeds should be called twice with different options
      expect(mockImageUtils.extractImageEmbeds).toHaveBeenCalledTimes(2);
      expect(mockImageUtils.extractImageEmbeds).toHaveBeenCalledWith(
        mockFile,
        mockApp,
        { includeYoutube: true, includeCardLink: false },
      );
      expect(mockImageUtils.extractImageEmbeds).toHaveBeenCalledWith(
        mockFile,
        mockApp,
        { includeYoutube: false, includeCardLink: true },
      );
    });

    it("should handle extractImageEmbeds errors gracefully", async () => {
      const imageCache: Record<string, string | string[]> = {};
      const hasImageCache: Record<string, boolean> = {};

      mockImageUtils.processImagePaths.mockReturnValue({
        internalPaths: [],
        externalUrls: [],
      });
      mockImageUtils.extractImageEmbeds.mockRejectedValue(
        new Error("Extract error"),
      );
      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await loadImageForEntry(
        "test/file.md",
        mockFile,
        mockApp,
        [],
        "always",
        imageCache,
        hasImageCache,
      );

      expect(hasImageCache["test/file.md"]).toBe(false);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("should share Promise for concurrent text preview loads with same settings", async () => {
      const textPreviewCache1: Record<string, string> = {};
      const textPreviewCache2: Record<string, string> = {};

      // Launch concurrent loads with same path and settings
      const promise1 = loadTextPreviewForEntry(
        "test/file.md",
        mockFile,
        mockApp,
        null,
        true,
        "never",
        textPreviewCache1,
      );
      const promise2 = loadTextPreviewForEntry(
        "test/file.md",
        mockFile,
        mockApp,
        null,
        true,
        "never",
        textPreviewCache2,
      );

      await Promise.all([promise1, promise2]);

      // loadFilePreview should only be called once (shared Promise)
      expect(mockPreviewUtils.loadFilePreview).toHaveBeenCalledTimes(1);
      // Both caches should have the result
      expect(textPreviewCache1["test/file.md"]).toBe("preview text");
      expect(textPreviewCache2["test/file.md"]).toBe("preview text");
    });

    it("should load independently for different omitFirstLine values", async () => {
      const textPreviewCache1: Record<string, string> = {};
      const textPreviewCache2: Record<string, string> = {};

      mockPreviewUtils.loadFilePreview
        .mockResolvedValueOnce("full preview")
        .mockResolvedValueOnce("omitted preview");

      // Launch concurrent loads with different omitFirstLine
      const promise1 = loadTextPreviewForEntry(
        "test/file.md",
        mockFile,
        mockApp,
        null,
        true,
        "never",
        textPreviewCache1,
      );
      const promise2 = loadTextPreviewForEntry(
        "test/file.md",
        mockFile,
        mockApp,
        null,
        true,
        "always",
        textPreviewCache2,
      );

      await Promise.all([promise1, promise2]);

      // loadFilePreview should be called twice (different settings)
      expect(mockPreviewUtils.loadFilePreview).toHaveBeenCalledTimes(2);
      expect(textPreviewCache1["test/file.md"]).toBe("full preview");
      expect(textPreviewCache2["test/file.md"]).toBe("omitted preview");
    });

    it("should load independently for different titleString with ifMatchesTitle", async () => {
      const textPreviewCache1: Record<string, string> = {};
      const textPreviewCache2: Record<string, string> = {};

      mockPreviewUtils.loadFilePreview
        .mockResolvedValueOnce("preview with title A comparison")
        .mockResolvedValueOnce("preview with title B comparison");

      // Launch concurrent loads with same omitFirstLine="ifMatchesTitle" but different titleStrings
      const promise1 = loadTextPreviewForEntry(
        "test/file.md",
        mockFile,
        mockApp,
        null,
        true,
        "ifMatchesTitle",
        textPreviewCache1,
        "file.md",
        "Title A",
      );
      const promise2 = loadTextPreviewForEntry(
        "test/file.md",
        mockFile,
        mockApp,
        null,
        true,
        "ifMatchesTitle",
        textPreviewCache2,
        "file.md",
        "Title B",
      );

      await Promise.all([promise1, promise2]);

      // loadFilePreview should be called twice (different titleStrings create different cache keys)
      expect(mockPreviewUtils.loadFilePreview).toHaveBeenCalledTimes(2);
      expect(textPreviewCache1["test/file.md"]).toBe(
        "preview with title A comparison",
      );
      expect(textPreviewCache2["test/file.md"]).toBe(
        "preview with title B comparison",
      );
    });

    it("should share Promise when titleString same with ifMatchesTitle", async () => {
      const textPreviewCache1: Record<string, string> = {};
      const textPreviewCache2: Record<string, string> = {};

      mockPreviewUtils.loadFilePreview.mockResolvedValue("shared preview");

      // Launch concurrent loads with same omitFirstLine="ifMatchesTitle" and same titleString
      const promise1 = loadTextPreviewForEntry(
        "test/file.md",
        mockFile,
        mockApp,
        null,
        true,
        "ifMatchesTitle",
        textPreviewCache1,
        "file.md",
        "Same Title",
      );
      const promise2 = loadTextPreviewForEntry(
        "test/file.md",
        mockFile,
        mockApp,
        null,
        true,
        "ifMatchesTitle",
        textPreviewCache2,
        "file.md",
        "Same Title",
      );

      await Promise.all([promise1, promise2]);

      // loadFilePreview should only be called once (same cache key, shared Promise)
      expect(mockPreviewUtils.loadFilePreview).toHaveBeenCalledTimes(1);
      expect(textPreviewCache1["test/file.md"]).toBe("shared preview");
      expect(textPreviewCache2["test/file.md"]).toBe("shared preview");
    });

    it("should not share Promise after first load completes (verifies cleanup)", async () => {
      const imageCache1: Record<string, string | string[]> = {};
      const hasImageCache1: Record<string, boolean> = {};

      mockImageUtils.processImagePaths.mockReturnValue({
        internalPaths: [],
        externalUrls: ["image.png"],
      });

      // First load completes
      await loadImageForEntry(
        "test/file.md",
        mockFile,
        mockApp,
        ["image.png"],
        "never",
        imageCache1,
        hasImageCache1,
      );

      expect(mockImageUtils.processImagePaths).toHaveBeenCalledTimes(1);

      // Second load with fresh caches - should trigger new load, not reuse stale Promise
      const imageCache2: Record<string, string | string[]> = {};
      const hasImageCache2: Record<string, boolean> = {};

      await loadImageForEntry(
        "test/file.md",
        mockFile,
        mockApp,
        ["image.png"],
        "never",
        imageCache2,
        hasImageCache2,
      );

      // If cleanup didn't work, this would still be 1 (reusing old Promise)
      expect(mockImageUtils.processImagePaths).toHaveBeenCalledTimes(2);
      expect(imageCache2["test/file.md"]).toBe("image.png");
    });

    it("should not share Promise after first text preview load completes (verifies cleanup)", async () => {
      const textPreviewCache1: Record<string, string> = {};

      // First load completes
      await loadTextPreviewForEntry(
        "test/file.md",
        mockFile,
        mockApp,
        null,
        true,
        "never",
        textPreviewCache1,
      );

      expect(mockPreviewUtils.loadFilePreview).toHaveBeenCalledTimes(1);

      // Second load with fresh cache - should trigger new load, not reuse stale Promise
      const textPreviewCache2: Record<string, string> = {};

      await loadTextPreviewForEntry(
        "test/file.md",
        mockFile,
        mockApp,
        null,
        true,
        "never",
        textPreviewCache2,
      );

      // If cleanup didn't work, this would still be 1 (reusing old Promise)
      expect(mockPreviewUtils.loadFilePreview).toHaveBeenCalledTimes(2);
      expect(textPreviewCache2["test/file.md"]).toBe("preview text");
    });
  });
});
