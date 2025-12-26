import {
  isExternalUrl,
  hasValidImageExtension,
  validateImageUrl,
  stripWikilinkSyntax,
  processImagePaths,
  resolveInternalImagePaths,
  extractEmbedImages,
  loadImageForFile,
} from "../../src/utils/image";
import { App, TFile } from "obsidian";

describe("image", () => {
  describe("isExternalUrl", () => {
    it("should return true for http URLs", () => {
      expect(isExternalUrl("http://example.com/image.png")).toBe(true);
    });

    it("should return true for https URLs", () => {
      expect(isExternalUrl("https://example.com/image.png")).toBe(true);
    });

    it("should be case-insensitive", () => {
      expect(isExternalUrl("HTTP://example.com/image.png")).toBe(true);
      expect(isExternalUrl("HTTPS://example.com/image.png")).toBe(true);
    });

    it("should return false for relative paths", () => {
      expect(isExternalUrl("images/photo.png")).toBe(false);
      expect(isExternalUrl("./images/photo.png")).toBe(false);
      expect(isExternalUrl("../images/photo.png")).toBe(false);
    });

    it("should return false for absolute paths", () => {
      expect(isExternalUrl("/images/photo.png")).toBe(false);
    });

    it("should return false for wikilinks", () => {
      expect(isExternalUrl("[[image.png]]")).toBe(false);
    });

    it("should return false for other protocols", () => {
      expect(isExternalUrl("ftp://example.com/file.png")).toBe(false);
      expect(isExternalUrl("file:///path/to/file.png")).toBe(false);
    });
  });

  describe("hasValidImageExtension", () => {
    it("should return true for common image extensions", () => {
      expect(hasValidImageExtension("image.png")).toBe(true);
      expect(hasValidImageExtension("image.jpg")).toBe(true);
      expect(hasValidImageExtension("image.jpeg")).toBe(true);
      expect(hasValidImageExtension("image.gif")).toBe(true);
      expect(hasValidImageExtension("image.webp")).toBe(true);
      expect(hasValidImageExtension("image.svg")).toBe(true);
      expect(hasValidImageExtension("image.bmp")).toBe(true);
      expect(hasValidImageExtension("image.avif")).toBe(true);
    });

    it("should be case-insensitive", () => {
      expect(hasValidImageExtension("image.PNG")).toBe(true);
      expect(hasValidImageExtension("image.JPG")).toBe(true);
      expect(hasValidImageExtension("image.GIF")).toBe(true);
    });

    it("should work with full paths", () => {
      expect(hasValidImageExtension("/path/to/image.png")).toBe(true);
      expect(hasValidImageExtension("https://example.com/image.jpg")).toBe(
        true,
      );
    });

    it("should return false for non-image extensions", () => {
      expect(hasValidImageExtension("document.pdf")).toBe(false);
      expect(hasValidImageExtension("file.txt")).toBe(false);
      expect(hasValidImageExtension("video.mp4")).toBe(false);
    });

    it("should return false for files without extensions", () => {
      expect(hasValidImageExtension("filename")).toBe(false);
    });

    it("should handle query parameters", () => {
      expect(hasValidImageExtension("image.png?size=large")).toBe(false);
    });
  });

  describe("validateImageUrl", () => {
    beforeEach(() => {
      jest.useFakeTimers();
      (global as any).__imageInstances = [];
      (global as any).__lastImage = null;
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should resolve true for valid image URL", async () => {
      const promise = validateImageUrl("https://example.com/image.png");

      // Trigger image load
      const img = (global as any).__lastImage;
      if (img.onload) img.onload();

      const result = await promise;
      expect(result).toBe(true);
    });

    it("should resolve false for invalid image URL", async () => {
      const promise = validateImageUrl("https://example.com/invalid.png");

      // Trigger image error
      const img = (global as any).__lastImage;
      if (img.onerror) img.onerror();

      const result = await promise;
      expect(result).toBe(false);
    });

    it("should resolve false on timeout", async () => {
      const promise = validateImageUrl("https://example.com/slow.png");

      // Advance timer to trigger timeout
      jest.advanceTimersByTime(5000);

      const result = await promise;
      expect(result).toBe(false);
    });

    it("should set src on image object", () => {
      validateImageUrl("https://example.com/test.png");

      const img = (global as any).__lastImage;
      expect(img.src).toBe("https://example.com/test.png");
    });
  });

  describe("stripWikilinkSyntax", () => {
    it("should strip basic wikilink syntax", () => {
      expect(stripWikilinkSyntax("[[image.png]]")).toBe("image.png");
    });

    it("should strip embed wikilink syntax", () => {
      expect(stripWikilinkSyntax("![[image.png]]")).toBe("image.png");
    });

    it("should strip wikilink with caption", () => {
      expect(stripWikilinkSyntax("[[image.png|My Caption]]")).toBe("image.png");
    });

    it("should strip embed wikilink with caption", () => {
      expect(stripWikilinkSyntax("![[image.png|Caption]]")).toBe("image.png");
    });

    it("should return unchanged path without wikilink syntax", () => {
      expect(stripWikilinkSyntax("image.png")).toBe("image.png");
      expect(stripWikilinkSyntax("path/to/image.png")).toBe(
        "path/to/image.png",
      );
    });

    it("should trim whitespace from extracted path", () => {
      expect(stripWikilinkSyntax("[[ image.png ]]")).toBe("image.png");
      expect(stripWikilinkSyntax("![[  image.png  |caption]]")).toBe(
        "image.png",
      );
    });

    it("should handle paths with folders", () => {
      expect(stripWikilinkSyntax("[[folder/image.png]]")).toBe(
        "folder/image.png",
      );
    });

    it("should not match partial wikilink syntax", () => {
      expect(stripWikilinkSyntax("[[image.png")).toBe("[[image.png");
      expect(stripWikilinkSyntax("image.png]]")).toBe("image.png]]");
    });
  });

  describe("processImagePaths", () => {
    beforeEach(() => {
      jest.useFakeTimers();
      (global as any).__imageInstances = [];
      (global as any).__lastImage = null;
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should separate internal paths and external URLs", async () => {
      const paths = ["image.png", "https://example.com/image.jpg"];

      const promise = processImagePaths(paths);

      // Validate external URL
      const img = (global as any).__lastImage;
      if (img && img.onload) img.onload();

      const result = await promise;

      expect(result.internalPaths).toEqual(["image.png"]);
      expect(result.externalUrls).toEqual(["https://example.com/image.jpg"]);
    });

    it("should strip wikilink syntax", async () => {
      const paths = ["[[image.png]]", "![[photo.jpg]]"];

      const result = await processImagePaths(paths);

      expect(result.internalPaths).toContain("image.png");
      expect(result.internalPaths).toContain("photo.jpg");
    });

    it("should validate image extensions", async () => {
      const paths = ["image.png", "document.pdf", "photo.jpg"];

      const result = await processImagePaths(paths);

      expect(result.internalPaths).toContain("image.png");
      expect(result.internalPaths).toContain("photo.jpg");
      expect(result.internalPaths).not.toContain("document.pdf");
    });

    it("should validate external URLs asynchronously", async () => {
      const paths = [
        "https://example.com/valid.png",
        "https://example.com/invalid.png",
      ];

      const promise = processImagePaths(paths);

      // First URL loads successfully
      let img = (global as any).__imageInstances[0];
      if (img && img.onload) img.onload();

      // Wait for first promise to resolve
      await Promise.resolve();

      // Second URL fails
      img = (global as any).__imageInstances[1];
      if (img && img.onerror) img.onerror();

      const result = await promise;

      expect(result.externalUrls).toEqual(["https://example.com/valid.png"]);
    });

    it("should skip empty paths", async () => {
      const paths = ["", "  ", "image.png"];

      const result = await processImagePaths(paths);

      expect(result.internalPaths).toEqual(["image.png"]);
    });

    it("should handle empty array", async () => {
      const result = await processImagePaths([]);

      expect(result.internalPaths).toEqual([]);
      expect(result.externalUrls).toEqual([]);
    });

    it("should validate external URLs with query parameters", async () => {
      const paths = ["https://example.com/image.png?size=large&v=2"];

      const promise = processImagePaths(paths);

      // URL should be validated via Image object regardless of query params
      const img = (global as any).__lastImage;
      if (img && img.onload) img.onload();

      const result = await promise;

      expect(result.externalUrls).toEqual([
        "https://example.com/image.png?size=large&v=2",
      ]);
    });

    it("should validate external URLs without file extensions", async () => {
      const paths = [
        "https://picsum.photos/200",
        "https://api.example.com/image/123",
      ];

      const promise = processImagePaths(paths);

      // Both URLs validated via Image object
      const img1 = (global as any).__imageInstances[0];
      if (img1 && img1.onload) img1.onload();
      await Promise.resolve();

      const img2 = (global as any).__imageInstances[1];
      if (img2 && img2.onload) img2.onload();

      const result = await promise;

      expect(result.externalUrls).toContain("https://picsum.photos/200");
      expect(result.externalUrls).toContain(
        "https://api.example.com/image/123",
      );
    });
  });

  describe("resolveInternalImagePaths", () => {
    let mockApp: App;

    beforeEach(() => {
      mockApp = new App();
    });

    it("should resolve internal image paths to resource URLs", () => {
      const mockFile = { extension: "png" } as TFile;
      mockApp.metadataCache.getFirstLinkpathDest = jest
        .fn()
        .mockReturnValue(mockFile);
      mockApp.vault.getResourcePath = jest
        .fn()
        .mockReturnValue("app://local/image.png");

      const result = resolveInternalImagePaths(
        ["image.png"],
        "note.md",
        mockApp,
      );

      expect(result).toEqual(["app://local/image.png"]);
      expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
        "image.png",
        "note.md",
      );
    });

    it("should filter out non-image files", () => {
      const mockFile = { extension: "pdf" } as TFile;
      mockApp.metadataCache.getFirstLinkpathDest = jest
        .fn()
        .mockReturnValue(mockFile);

      const result = resolveInternalImagePaths(
        ["document.pdf"],
        "note.md",
        mockApp,
      );

      expect(result).toEqual([]);
    });

    it("should skip files that cannot be found", () => {
      mockApp.metadataCache.getFirstLinkpathDest = jest
        .fn()
        .mockReturnValue(null);

      const result = resolveInternalImagePaths(
        ["missing.png"],
        "note.md",
        mockApp,
      );

      expect(result).toEqual([]);
    });

    it("should handle multiple paths", () => {
      const mockFile1 = { extension: "png" } as TFile;
      const mockFile2 = { extension: "jpg" } as TFile;

      mockApp.metadataCache.getFirstLinkpathDest = jest
        .fn()
        .mockReturnValueOnce(mockFile1)
        .mockReturnValueOnce(mockFile2);

      mockApp.vault.getResourcePath = jest
        .fn()
        .mockReturnValueOnce("app://local/image1.png")
        .mockReturnValueOnce("app://local/image2.jpg");

      const result = resolveInternalImagePaths(
        ["image1.png", "image2.jpg"],
        "note.md",
        mockApp,
      );

      expect(result).toEqual([
        "app://local/image1.png",
        "app://local/image2.jpg",
      ]);
    });

    it("should accept all valid image extensions", () => {
      const extensions = [
        "avif",
        "bmp",
        "gif",
        "jpeg",
        "jpg",
        "png",
        "svg",
        "webp",
      ];

      extensions.forEach((ext) => {
        const mockFile = { extension: ext } as TFile;
        mockApp.metadataCache.getFirstLinkpathDest = jest
          .fn()
          .mockReturnValue(mockFile);
        mockApp.vault.getResourcePath = jest
          .fn()
          .mockReturnValue(`app://local/image.${ext}`);

        const result = resolveInternalImagePaths(
          [`image.${ext}`],
          "note.md",
          mockApp,
        );

        expect(result.length).toBe(1);
      });
    });
  });

  describe("extractEmbedImages", () => {
    let mockApp: App;
    let mockFile: TFile;

    beforeEach(() => {
      mockApp = new App();
      mockFile = { path: "note.md" } as TFile;
      jest.useFakeTimers();
      (global as any).__imageInstances = [];
      (global as any).__lastImage = null;
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should return empty array when no embeds", async () => {
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({});

      const result = await extractEmbedImages(mockFile, mockApp);

      expect(result).toEqual([]);
    });

    it("should extract internal image embeds", async () => {
      const mockImageFile = { extension: "png" } as TFile;

      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
        embeds: [{ link: "image.png" }],
      });
      mockApp.metadataCache.getFirstLinkpathDest = jest
        .fn()
        .mockReturnValue(mockImageFile);
      mockApp.vault.getResourcePath = jest
        .fn()
        .mockReturnValue("app://local/image.png");

      const result = await extractEmbedImages(mockFile, mockApp);

      expect(result).toEqual(["app://local/image.png"]);
    });

    it("should extract and validate external URL embeds", async () => {
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
        embeds: [{ link: "https://example.com/image.png" }],
      });

      const promise = extractEmbedImages(mockFile, mockApp);

      const img = (global as any).__lastImage;
      if (img && img.onload) img.onload();

      const result = await promise;

      expect(result).toEqual(["https://example.com/image.png"]);
    });

    it("should filter out non-image embeds", async () => {
      const mockPdfFile = { extension: "pdf" } as TFile;

      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
        embeds: [{ link: "document.pdf" }],
      });
      mockApp.metadataCache.getFirstLinkpathDest = jest
        .fn()
        .mockReturnValue(mockPdfFile);

      const result = await extractEmbedImages(mockFile, mockApp);

      expect(result).toEqual([]);
    });

    it("should handle mixed internal and external embeds", async () => {
      const mockImageFile = { extension: "png" } as TFile;

      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
        embeds: [
          { link: "image.png" },
          { link: "https://example.com/photo.jpg" },
        ],
      });
      mockApp.metadataCache.getFirstLinkpathDest = jest
        .fn()
        .mockReturnValue(mockImageFile);
      mockApp.vault.getResourcePath = jest
        .fn()
        .mockReturnValue("app://local/image.png");

      const promise = extractEmbedImages(mockFile, mockApp);

      const img = (global as any).__lastImage;
      if (img && img.onload) img.onload();

      const result = await promise;

      expect(result).toContain("app://local/image.png");
      expect(result).toContain("https://example.com/photo.jpg");
    });

    it("should return empty array when metadata is null", async () => {
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue(null);

      const result = await extractEmbedImages(mockFile, mockApp);

      expect(result).toEqual([]);
    });
  });

  describe("loadImageForFile", () => {
    let mockApp: App;

    beforeEach(() => {
      mockApp = new App();
      jest.useFakeTimers();
      (global as any).__imageInstances = [];
      (global as any).__lastImage = null;
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should return null when file not found", async () => {
      mockApp.vault.getAbstractFileByPath = jest.fn().mockReturnValue(null);

      const result = await loadImageForFile(mockApp, "note.md", "", "balanced");

      expect(result).toBeNull();
    });

    it("should return null when no images available", async () => {
      const mockFile = { path: "note.md" } as TFile;
      mockApp.vault.getAbstractFileByPath = jest.fn().mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({});

      const result = await loadImageForFile(mockApp, "note.md", "", "balanced");

      expect(result).toBeNull();
    });

    it("should prioritize property images over embeds", async () => {
      const mockFile = Object.create(TFile.prototype);
      Object.assign(mockFile, { path: "note.md" });

      const mockPropertyImage = Object.create(TFile.prototype);
      Object.assign(mockPropertyImage, { extension: "png" });

      const mockEmbedImage = Object.create(TFile.prototype);
      Object.assign(mockEmbedImage, { extension: "jpg" });

      mockApp.vault.getAbstractFileByPath = jest.fn().mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
        embeds: [{ link: "embed.jpg" }],
      });
      mockApp.metadataCache.getFirstLinkpathDest = jest
        .fn()
        .mockReturnValueOnce(mockPropertyImage)
        .mockReturnValueOnce(mockEmbedImage);
      mockApp.vault.getResourcePath = jest
        .fn()
        .mockReturnValueOnce("app://local/property.png")
        .mockReturnValueOnce("app://local/embed.jpg");

      const result = await loadImageForFile(
        mockApp,
        "note.md",
        "property.png",
        "balanced",
        true,
        "cover",
      );

      expect(result).toBe("app://local/property.png");
    });

    it("should fall back to embeds when property is empty", async () => {
      const mockFile = Object.create(TFile.prototype);
      Object.assign(mockFile, { path: "note.md" });

      const mockEmbedImage = Object.create(TFile.prototype);
      Object.assign(mockEmbedImage, { extension: "jpg" });

      mockApp.vault.getAbstractFileByPath = jest.fn().mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
        embeds: [{ link: "embed.jpg" }],
      });
      mockApp.metadataCache.getFirstLinkpathDest = jest
        .fn()
        .mockReturnValue(mockEmbedImage);
      mockApp.vault.getResourcePath = jest
        .fn()
        .mockReturnValue("app://local/embed.jpg");

      const result = await loadImageForFile(
        mockApp,
        "note.md",
        "",
        "balanced",
        true,
        "cover",
      );

      expect(result).toBe("app://local/embed.jpg");
    });

    it("should not fall back when fallbackToEmbeds is false", async () => {
      const mockFile = Object.create(TFile.prototype);
      Object.assign(mockFile, { path: "note.md" });

      mockApp.vault.getAbstractFileByPath = jest.fn().mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
        embeds: [{ link: "embed.jpg" }],
      });

      const result = await loadImageForFile(
        mockApp,
        "note.md",
        "",
        "balanced",
        false,
        "cover",
      );

      expect(result).toBeNull();
    });

    it("should return array when multiple images available", async () => {
      const mockFile = Object.create(TFile.prototype);
      Object.assign(mockFile, { path: "note.md" });

      const mockImage1 = Object.create(TFile.prototype);
      Object.assign(mockImage1, { extension: "png" });

      const mockImage2 = Object.create(TFile.prototype);
      Object.assign(mockImage2, { extension: "jpg" });

      mockApp.vault.getAbstractFileByPath = jest.fn().mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({});
      mockApp.metadataCache.getFirstLinkpathDest = jest
        .fn()
        .mockReturnValueOnce(mockImage1)
        .mockReturnValueOnce(mockImage2);
      mockApp.vault.getResourcePath = jest
        .fn()
        .mockReturnValueOnce("app://local/image1.png")
        .mockReturnValueOnce("app://local/image2.jpg");

      const result = await loadImageForFile(
        mockApp,
        "note.md",
        ["image1.png", "image2.jpg"],
        "balanced",
        true,
        "cover",
      );

      expect(Array.isArray(result)).toBe(true);
      expect(result).toContain("app://local/image1.png");
      expect(result).toContain("app://local/image2.jpg");
    });

    it("should use embeds when no image property configured", async () => {
      const mockFile = Object.create(TFile.prototype);
      Object.assign(mockFile, { path: "note.md" });

      const mockEmbedImage = Object.create(TFile.prototype);
      Object.assign(mockEmbedImage, { extension: "png" });

      mockApp.vault.getAbstractFileByPath = jest.fn().mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
        embeds: [{ link: "embed.png" }],
      });
      mockApp.metadataCache.getFirstLinkpathDest = jest
        .fn()
        .mockReturnValue(mockEmbedImage);
      mockApp.vault.getResourcePath = jest
        .fn()
        .mockReturnValue("app://local/embed.png");

      const result = await loadImageForFile(
        mockApp,
        "note.md",
        "",
        "balanced",
        true,
        "",
      );

      expect(result).toBe("app://local/embed.png");
    });
  });
});
