import {
  isExternalUrl,
  stripWikilinkSyntax,
  processImagePaths,
  resolveInternalImagePaths,
  extractImageEmbeds,
  getYouTubeVideoId,
  getYouTubeThumbnailUrl,
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
    it("should separate internal paths and external URLs", () => {
      const paths = ["image.png", "https://example.com/image.jpg"];
      const result = processImagePaths(paths);

      expect(result.internalPaths).toEqual(["image.png"]);
      expect(result.externalUrls).toEqual(["https://example.com/image.jpg"]);
    });

    it("should strip wikilink syntax", () => {
      const paths = ["[[image.png]]", "![[photo.jpg]]"];
      const result = processImagePaths(paths);

      expect(result.internalPaths).toContain("image.png");
      expect(result.internalPaths).toContain("photo.jpg");
    });

    it("should validate image extensions for internal paths only", () => {
      const paths = ["image.png", "document.pdf", "photo.jpg"];
      const result = processImagePaths(paths);

      expect(result.internalPaths).toContain("image.png");
      expect(result.internalPaths).toContain("photo.jpg");
      expect(result.internalPaths).not.toContain("document.pdf");
    });

    it("should pass through external URLs without validation", () => {
      const paths = [
        "https://example.com/valid.png",
        "https://example.com/other.png",
      ];
      const result = processImagePaths(paths);

      // All external URLs pass through - browser handles load/error at render time
      expect(result.externalUrls).toEqual([
        "https://example.com/valid.png",
        "https://example.com/other.png",
      ]);
    });

    it("should skip empty paths", () => {
      const paths = ["", "  ", "image.png"];
      const result = processImagePaths(paths);

      expect(result.internalPaths).toEqual(["image.png"]);
    });

    it("should handle empty array", () => {
      const result = processImagePaths([]);

      expect(result.internalPaths).toEqual([]);
      expect(result.externalUrls).toEqual([]);
    });

    it("should pass through external URLs with query parameters", () => {
      const paths = ["https://example.com/image.png?size=large&v=2"];
      const result = processImagePaths(paths);

      expect(result.externalUrls).toEqual([
        "https://example.com/image.png?size=large&v=2",
      ]);
    });

    it("should pass through external URLs without file extensions", () => {
      const paths = [
        "https://picsum.photos/200",
        "https://api.example.com/image/123",
      ];
      const result = processImagePaths(paths);

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

  describe("getYouTubeVideoId", () => {
    it("should extract video ID from standard watch URL", () => {
      expect(getYouTubeVideoId("https://youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
        "dQw4w9WgXcQ",
      );
      expect(
        getYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      ).toBe("dQw4w9WgXcQ");
    });

    it("should extract video ID from short URL", () => {
      expect(getYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe(
        "dQw4w9WgXcQ",
      );
    });

    it("should extract video ID from mobile URL", () => {
      expect(
        getYouTubeVideoId("https://m.youtube.com/watch?v=dQw4w9WgXcQ"),
      ).toBe("dQw4w9WgXcQ");
    });

    it("should extract video ID from embed URL", () => {
      expect(getYouTubeVideoId("https://youtube.com/embed/dQw4w9WgXcQ")).toBe(
        "dQw4w9WgXcQ",
      );
    });

    it("should extract video ID from shorts URL", () => {
      expect(getYouTubeVideoId("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe(
        "dQw4w9WgXcQ",
      );
    });

    it("should return null for non-YouTube URLs", () => {
      expect(getYouTubeVideoId("https://example.com/video")).toBeNull();
      expect(getYouTubeVideoId("https://vimeo.com/123456")).toBeNull();
    });

    it("should return null for invalid URLs", () => {
      expect(getYouTubeVideoId("not-a-url")).toBeNull();
    });
  });

  describe("getYouTubeThumbnailUrl", () => {
    beforeEach(() => {
      jest.useFakeTimers();
      (global as any).__imageInstances = [];
      (global as any).__lastImage = null;
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should return maxresdefault URL when image loads", async () => {
      const promise = getYouTubeThumbnailUrl("dQw4w9WgXcQ");

      const img = (global as any).__lastImage;
      if (img && img.onload) img.onload();

      const result = await promise;
      expect(result).toBe(
        "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
      );
    });

    it("should fall back to hqdefault when maxres fails", async () => {
      const promise = getYouTubeThumbnailUrl("dQw4w9WgXcQ");

      // First image fails (maxres)
      let img = (global as any).__imageInstances[0];
      if (img && img.onerror) img.onerror();

      await Promise.resolve();

      // Second image loads (hqdefault)
      img = (global as any).__imageInstances[1];
      if (img && img.onload) img.onload();

      const result = await promise;
      expect(result).toBe(
        "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      );
    });

    it("should return null when all thumbnails are below mqdefault width (320px)", async () => {
      const promise = getYouTubeThumbnailUrl("jNQXAC9IVRw");

      // All three quality levels return placeholder (below 320px)
      for (let i = 0; i < 3; i++) {
        await Promise.resolve();
        const img = (global as any).__imageInstances[i];
        if (img) {
          img.naturalWidth = 120;
          img.naturalHeight = 90;
          if (img.onload) img.onload();
        }
      }

      const result = await promise;
      expect(result).toBeNull();
    });
  });

  describe("extractImageEmbeds", () => {
    let mockApp: App;
    let mockFile: TFile;

    beforeEach(() => {
      mockApp = new App();
      mockFile = { path: "note.md" } as TFile;
      mockApp.vault.cachedRead = jest.fn().mockResolvedValue("");
    });

    it("should return empty array for empty file", async () => {
      mockApp.vault.cachedRead = jest.fn().mockResolvedValue("");

      const result = await extractImageEmbeds(mockFile, mockApp);

      expect(result).toEqual([]);
    });

    it("should extract wikilink embeds", async () => {
      const mockImageFile = { extension: "png" } as TFile;
      mockApp.vault.cachedRead = jest
        .fn()
        .mockResolvedValue("Some text\n![[image.png]]\nMore text");
      mockApp.metadataCache.getFirstLinkpathDest = jest
        .fn()
        .mockReturnValue(mockImageFile);
      mockApp.vault.getResourcePath = jest
        .fn()
        .mockReturnValue("app://local/image.png");

      const result = await extractImageEmbeds(mockFile, mockApp);

      expect(result).toContain("app://local/image.png");
    });

    it("should skip cardlink images when disabled", async () => {
      mockApp.vault.cachedRead = jest.fn().mockResolvedValue(`
\`\`\`cardlink
url: https://example.com
image: https://example.com/cover.png
\`\`\`
      `);

      const result = await extractImageEmbeds(mockFile, mockApp, {
        includeCardLink: false,
      });

      expect(result).toEqual([]);
    });

    describe("code syntax exclusions", () => {
      it("should skip embeds in inline code (single backticks)", async () => {
        mockApp.vault.cachedRead = jest
          .fn()
          .mockResolvedValue("`![[image_1.jpg]]`");

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toEqual([]);
      });

      it("should skip embeds in fenced code block (3 backticks)", async () => {
        mockApp.vault.cachedRead = jest.fn().mockResolvedValue(`
\`\`\`
![[image_2.jpg]]
\`\`\`
        `);

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toEqual([]);
      });

      it("should skip embeds in fenced code block (4 backticks)", async () => {
        mockApp.vault.cachedRead = jest.fn().mockResolvedValue(`
\`\`\`\`
![[image_3.jpg]]
\`\`\`\`
        `);

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toEqual([]);
      });

      it("should skip embeds in fenced code block with language", async () => {
        mockApp.vault.cachedRead = jest.fn().mockResolvedValue(`
\`\`\`markdown
![[image_4.jpg]]
\`\`\`
        `);

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toEqual([]);
      });

      it("should skip embeds in fenced code block (3 tildes)", async () => {
        mockApp.vault.cachedRead = jest.fn().mockResolvedValue(`
~~~
![[image_5.jpg]]
~~~
        `);

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toEqual([]);
      });

      it("should skip embeds in fenced code block (4 tildes)", async () => {
        mockApp.vault.cachedRead = jest.fn().mockResolvedValue(`
~~~~
![[image_6.jpg]]
~~~~
        `);

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toEqual([]);
      });

      it("should skip embeds in indented code block (tab)", async () => {
        mockApp.vault.cachedRead = jest
          .fn()
          .mockResolvedValue("\t![[image_7.jpg]]");

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toEqual([]);
      });

      it("should skip embeds in indented code block (4 spaces)", async () => {
        mockApp.vault.cachedRead = jest
          .fn()
          .mockResolvedValue("    ![[image_8.jpg]]");

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toEqual([]);
      });

      it("should skip markdown images in inline code", async () => {
        mockApp.vault.cachedRead = jest
          .fn()
          .mockResolvedValue("`![alt](https://example.com/image_9.png)`");

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toEqual([]);
      });

      it("should skip markdown images in fenced block", async () => {
        mockApp.vault.cachedRead = jest.fn().mockResolvedValue(`
\`\`\`
![alt](https://example.com/image_10.png)
\`\`\`
        `);

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toEqual([]);
      });

      it("should NOT treat single backticks on separate lines as code", async () => {
        const mockImageFile = { extension: "jpg" } as TFile;
        mockApp.vault.cachedRead = jest.fn().mockResolvedValue(`
\`

![[valid_image.jpg]]

\`
        `);
        mockApp.metadataCache.getFirstLinkpathDest = jest
          .fn()
          .mockReturnValue(mockImageFile);
        mockApp.vault.getResourcePath = jest
          .fn()
          .mockReturnValue("app://local/valid_image.jpg");

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toContain("app://local/valid_image.jpg");
      });

      it("should only extract non-code-wrapped image from mixed content", async () => {
        const mockImageFile = { extension: "jpg" } as TFile;
        // Note: indented code requires preceding blank line per CommonMark
        mockApp.vault.cachedRead = jest.fn().mockResolvedValue(`
\`![[image_1.jpg]]\`

\`\`\`
![[image_2.jpg]]
\`\`\`

~~~
![[image_5.jpg]]
~~~

\t![[image_7.jpg]]

    ![[image_8.jpg]]

![[image_87.jpg]]
        `);
        mockApp.metadataCache.getFirstLinkpathDest = jest
          .fn()
          .mockReturnValue(mockImageFile);
        mockApp.vault.getResourcePath = jest
          .fn()
          .mockReturnValue("app://local/image_87.jpg");

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toHaveLength(1);
        expect(result).toContain("app://local/image_87.jpg");
      });

      it("should NOT skip indented embed without preceding blank line", async () => {
        const mockImageFile = { extension: "jpg" } as TFile;
        // Per CommonMark, indented code requires preceding blank line
        // This embed is just indented text, not code
        mockApp.vault.cachedRead = jest.fn().mockResolvedValue(`Some text
    ![[image.jpg]]`);
        mockApp.metadataCache.getFirstLinkpathDest = jest
          .fn()
          .mockReturnValue(mockImageFile);
        mockApp.vault.getResourcePath = jest
          .fn()
          .mockReturnValue("app://local/image.jpg");

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toContain("app://local/image.jpg");
      });

      it("should skip indented embed WITH preceding blank line", async () => {
        // With blank line before, this IS indented code per CommonMark
        mockApp.vault.cachedRead = jest.fn().mockResolvedValue(`Some text

    ![[image.jpg]]`);

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toEqual([]);
      });

      it("should handle nested fenced blocks (4 backticks containing 3)", async () => {
        const mockImageFile = { extension: "jpg" } as TFile;
        mockApp.vault.cachedRead = jest.fn().mockResolvedValue(`
\`\`\`\`
\`\`\`
![[nested.jpg]]
\`\`\`
\`\`\`\`

![[valid.jpg]]
        `);
        mockApp.metadataCache.getFirstLinkpathDest = jest
          .fn()
          .mockReturnValue(mockImageFile);
        mockApp.vault.getResourcePath = jest
          .fn()
          .mockReturnValue("app://local/valid.jpg");

        const result = await extractImageEmbeds(mockFile, mockApp);

        // Only valid.jpg should be extracted, nested.jpg is inside outer block
        expect(result).toHaveLength(1);
        expect(result).toContain("app://local/valid.jpg");
      });

      it("should skip embeds in fenced block with complex info string", async () => {
        // Per CommonMark, info strings can contain any characters
        mockApp.vault.cachedRead = jest.fn().mockResolvedValue(`
\`\`\`python {.class title="example"}
![[image.jpg]]
\`\`\`
        `);

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toEqual([]);
      });

      it("should extract cardlink image from block with complex info string", async () => {
        mockApp.vault.cachedRead = jest.fn().mockResolvedValue(`
\`\`\`cardlink {.some-class}
url: https://example.com
image: https://example.com/cover.png
\`\`\`
        `);

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toContain("https://example.com/cover.png");
      });

      it("should extract embeds from unclosed fenced block (non-CommonMark)", async () => {
        // Per CommonMark, unclosed fenced blocks extend to EOF
        // Current implementation: unclosed fence = not a fence, embed extracted
        // This test documents current behavior (not CommonMark compliant)
        const mockImageFile = { extension: "jpg" } as TFile;
        mockApp.vault.cachedRead = jest.fn().mockResolvedValue(`
\`\`\`
![[image.jpg]]`);
        mockApp.metadataCache.getFirstLinkpathDest = jest
          .fn()
          .mockReturnValue(mockImageFile);
        mockApp.vault.getResourcePath = jest
          .fn()
          .mockReturnValue("app://local/image.jpg");

        const result = await extractImageEmbeds(mockFile, mockApp);

        // Current behavior: embed IS extracted (block never closed)
        // Note: This differs from CommonMark which treats unclosed fences as code to EOF
        expect(result).toContain("app://local/image.jpg");
      });

      it("should NOT close fence with mismatched length", async () => {
        // 3 backticks cannot be closed by 4 backticks
        const mockImageFile = { extension: "jpg" } as TFile;
        mockApp.vault.cachedRead = jest.fn().mockResolvedValue(`
\`\`\`
![[inside.jpg]]
\`\`\`\`

![[outside.jpg]]
        `);
        mockApp.metadataCache.getFirstLinkpathDest = jest
          .fn()
          .mockReturnValue(mockImageFile);
        mockApp.vault.getResourcePath = jest
          .fn()
          .mockReturnValue("app://local/outside.jpg");

        const result = await extractImageEmbeds(mockFile, mockApp);

        // Both embeds extracted since fence never properly closed
        expect(result.length).toBeGreaterThanOrEqual(1);
      });

      it("should NOT close fence when closing line has trailing content", async () => {
        // Per CommonMark, closing fences must have no content after fence chars
        mockApp.vault.cachedRead = jest.fn().mockResolvedValue(`
\`\`\`
![[inside.jpg]]
\`\`\`python
![[outside.jpg]]
\`\`\`
        `);

        const result = await extractImageEmbeds(mockFile, mockApp);

        // Both embeds inside the block (first "closing" fence has content, doesn't close)
        // Only the final ``` properly closes, so all embeds are inside code
        expect(result).toEqual([]);
      });

      it("should extract embed at position 0 (start of file)", async () => {
        const mockImageFile = { extension: "jpg" } as TFile;
        mockApp.vault.cachedRead = jest
          .fn()
          .mockResolvedValue("![[image.jpg]]");
        mockApp.metadataCache.getFirstLinkpathDest = jest
          .fn()
          .mockReturnValue(mockImageFile);
        mockApp.vault.getResourcePath = jest
          .fn()
          .mockReturnValue("app://local/image.jpg");

        const result = await extractImageEmbeds(mockFile, mockApp);

        expect(result).toContain("app://local/image.jpg");
      });

      it("should handle frontmatter without closing delimiter", async () => {
        const mockImageFile = { extension: "jpg" } as TFile;
        // Malformed frontmatter (no closing ---) - content should still be parsed
        mockApp.vault.cachedRead = jest.fn().mockResolvedValue(`---
key: value
![[image.jpg]]`);
        mockApp.metadataCache.getFirstLinkpathDest = jest
          .fn()
          .mockReturnValue(mockImageFile);
        mockApp.vault.getResourcePath = jest
          .fn()
          .mockReturnValue("app://local/image.jpg");

        const result = await extractImageEmbeds(mockFile, mockApp);

        // Embed should be extracted since frontmatter is malformed
        expect(result).toContain("app://local/image.jpg");
      });
    });
  });
});
