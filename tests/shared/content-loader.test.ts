import { TFile, App } from "obsidian";
import {
  loadImageForEntry,
  loadImagesForEntries,
  loadTextPreviewForEntry,
  loadTextPreviewsForEntries,
} from "../../src/shared/content-loader";

// Mock image utilities
jest.mock("../../src/utils/image", () => ({
  processImagePaths: jest.fn(),
  resolveInternalImagePaths: jest.fn(),
  extractEmbedImages: jest.fn(),
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
    extractEmbedImages: jest.Mock;
  };
  let mockPreviewUtils: {
    loadFilePreview: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockApp = new App();

    mockFile = new TFile();
    mockFile.path = "test/file.md";
    mockFile.basename = "file";
    mockFile.extension = "md";

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mockImageUtils = require("../../src/utils/image");
    mockImageUtils.processImagePaths.mockResolvedValue({
      internalPaths: [],
      externalUrls: [],
    });
    mockImageUtils.resolveInternalImagePaths.mockReturnValue([]);
    mockImageUtils.extractEmbedImages.mockResolvedValue([]);

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

      mockImageUtils.processImagePaths.mockResolvedValue({
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

      mockImageUtils.processImagePaths.mockResolvedValue({
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

      mockImageUtils.processImagePaths.mockResolvedValue({
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

      mockImageUtils.processImagePaths.mockResolvedValue({
        internalPaths: [],
        externalUrls: ["property.png"],
      });
      mockImageUtils.extractEmbedImages.mockResolvedValue(["embed.png"]);

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
      expect(mockImageUtils.extractEmbedImages).toHaveBeenCalledWith(
        mockFile,
        mockApp,
      );
    });

    it('should use embeds only when empty with fallbackToEmbeds "if-empty"', async () => {
      const imageCache: Record<string, string | string[]> = {};
      const hasImageCache: Record<string, boolean> = {};

      mockImageUtils.processImagePaths.mockResolvedValue({
        internalPaths: [],
        externalUrls: [],
      });
      mockImageUtils.extractEmbedImages.mockResolvedValue(["embed.png"]);

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

      mockImageUtils.processImagePaths.mockResolvedValue({
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

      expect(mockImageUtils.extractEmbedImages).not.toHaveBeenCalled();
      expect(imageCache["test/file.md"]).toBe("property.png");
    });

    it('should ignore embeds completely when fallbackToEmbeds is "never"', async () => {
      const imageCache: Record<string, string | string[]> = {};
      const hasImageCache: Record<string, boolean> = {};

      mockImageUtils.processImagePaths.mockResolvedValue({
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

      expect(mockImageUtils.extractEmbedImages).not.toHaveBeenCalled();
      expect(imageCache["test/file.md"]).toBeUndefined();
    });

    it("should catch errors and not throw", async () => {
      const imageCache: Record<string, string | string[]> = {};
      const hasImageCache: Record<string, boolean> = {};

      mockImageUtils.processImagePaths.mockRejectedValue(
        new Error("Test error"),
      );
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

      mockImageUtils.processImagePaths.mockResolvedValue({
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
});
