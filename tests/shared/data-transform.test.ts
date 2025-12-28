import {
  datacoreResultToCardData,
  basesEntryToCardData,
  transformDatacoreResults,
  transformBasesEntries,
  resolveBasesProperty,
  resolveDatacoreProperty,
} from "../../src/shared/data-transform";
import type { Settings } from "../../src/types";
import { App, TFile } from "obsidian";

// Mock dependencies
jest.mock("../../src/utils/property");
jest.mock("../../src/shared/render-utils", () => ({
  formatTimestamp: jest.fn((ts: number) =>
    ts != null ? `formatted-${ts}` : null,
  ),
  extractTimestamp: jest.fn(() => null),
  isDateValue: jest.fn(() => false),
}));

describe("data-transform", () => {
  let mockSettings: Settings;
  let mockApp: App;

  beforeEach(() => {
    mockSettings = {
      titleProperty: "title",
      textPreviewProperty: "description",
      imageProperty: "cover",
      propertyDisplay1: "prop1",
      propertyDisplay2: "prop2",
      propertyDisplay3: "",
      propertyDisplay4: "",
      smartTimestamp: false,
      createdTimeProperty: "",
      modifiedTimeProperty: "",
      fallbackToInNote: true,
      omitFirstLine: "ifMatchesTitle",
    } as Settings;

    mockApp = new App();
  });

  describe("datacoreResultToCardData", () => {
    it("should transform basic Datacore result to CardData", () => {
      const mockResult: any = {
        $path: "test/file.md",
        $name: "file",
        $tags: ["tag1", "tag2"],
        $ctime: { toMillis: () => 1000000 },
        $mtime: { toMillis: () => 2000000 },
        value: jest.fn().mockReturnValue(["yaml-tag"]),
      };

      const mockDC: any = {
        coerce: {
          string: (val: any) => String(val),
        },
      };

      const result = datacoreResultToCardData(
        mockApp,
        mockResult,
        mockDC,
        mockSettings,
        "alphabetical",
        false,
      );

      expect(result.path).toBe("test/file.md");
      expect(result.name).toBe("file");
      expect(result.ctime).toBe(1000000);
      expect(result.mtime).toBe(2000000);
      expect(result.tags).toEqual(["tag1", "tag2"]);
      expect(result.yamlTags).toEqual(["yaml-tag"]);
    });

    it("should extract folder path correctly", () => {
      const mockResult: any = {
        $path: "folder/subfolder/file.md",
        $name: "file",
        $tags: [],
        $ctime: { toMillis: () => 0 },
        $mtime: { toMillis: () => 0 },
        value: jest.fn().mockReturnValue([]),
      };

      const mockDC: any = {
        coerce: { string: (val: any) => String(val) },
      };

      const result = datacoreResultToCardData(
        mockApp,
        mockResult,
        mockDC,
        mockSettings,
        "alphabetical",
        false,
      );

      expect(result.folderPath).toBe("folder/subfolder");
    });

    it("should handle missing timestamps", () => {
      const mockResult: any = {
        $path: "file.md",
        $name: "file",
        $tags: [],
        value: jest.fn().mockReturnValue([]),
      };

      const mockDC: any = {
        coerce: { string: (val: any) => String(val) },
      };

      const result = datacoreResultToCardData(
        mockApp,
        mockResult,
        mockDC,
        mockSettings,
        "alphabetical",
        false,
      );

      expect(result.ctime).toBe(0);
      expect(result.mtime).toBe(0);
    });

    it("should include textPreview and imageUrl when provided", () => {
      const mockResult: any = {
        $path: "file.md",
        $name: "file",
        $tags: [],
        $ctime: { toMillis: () => 0 },
        $mtime: { toMillis: () => 0 },
        value: jest.fn().mockReturnValue([]),
      };

      const mockDC: any = {
        coerce: { string: (val: any) => String(val) },
      };

      const result = datacoreResultToCardData(
        mockApp,
        mockResult,
        mockDC,
        mockSettings,
        "alphabetical",
        false,
        "test textPreview",
        "image.png",
      );

      expect(result.textPreview).toBe("test textPreview");
      expect(result.imageUrl).toBe("image.png");
    });

    it("should handle array title property", () => {
      const mockResult: any = {
        $path: "file.md",
        $name: "file",
        $tags: [],
        $ctime: { toMillis: () => 0 },
        $mtime: { toMillis: () => 0 },
        value: jest.fn().mockReturnValue([]),
      };

      const mockDC: any = {
        coerce: { string: (val: any) => String(val) },
      };

      // Mock getFirstDatacorePropertyValue to return array
      const {
        getFirstDatacorePropertyValue,
      } = require("../../src/utils/property");
      getFirstDatacorePropertyValue.mockReturnValue(["Title 1", "Title 2"]);

      const result = datacoreResultToCardData(
        mockApp,
        mockResult,
        mockDC,
        mockSettings,
        "alphabetical",
        false,
      );

      // Should use first element
      expect(result.title).toBeTruthy();
    });
  });

  describe("basesEntryToCardData", () => {
    it("should transform basic Bases entry to CardData", () => {
      const mockEntry: any = {
        file: {
          path: "test/file.md",
          name: "file.md",
          basename: "file",
          stat: {
            ctime: 1000000,
            mtime: 2000000,
          },
        },
        getValue: jest.fn(),
      };

      const result = basesEntryToCardData(
        mockApp,
        mockEntry,
        mockSettings,
        "alphabetical",
        false,
      );

      expect(result.path).toBe("test/file.md");
      expect(result.name).toBe("file");
      expect(result.ctime).toBe(1000000);
      expect(result.mtime).toBe(2000000);
    });

    it("should extract folder path from file path", () => {
      const mockEntry: any = {
        file: {
          path: "folder/subfolder/file.md",
          basename: "file",
          stat: { ctime: 0, mtime: 0 },
        },
        getValue: jest.fn(),
      };

      const result = basesEntryToCardData(
        mockApp,
        mockEntry,
        mockSettings,
        "alphabetical",
        false,
      );

      expect(result.folderPath).toBe("folder/subfolder");
    });

    it("should handle root folder files", () => {
      const mockEntry: any = {
        file: {
          path: "file.md",
          basename: "file",
          stat: { ctime: 0, mtime: 0 },
        },
        getValue: jest.fn(),
      };

      const result = basesEntryToCardData(
        mockApp,
        mockEntry,
        mockSettings,
        "alphabetical",
        false,
      );

      expect(result.folderPath).toBe("");
    });

    it("should include textPreview and imageUrl when provided", () => {
      const mockEntry: any = {
        file: {
          path: "file.md",
          basename: "file",
          stat: { ctime: 0, mtime: 0 },
        },
        getValue: jest.fn(),
      };

      const result = basesEntryToCardData(
        mockApp,
        mockEntry,
        mockSettings,
        "alphabetical",
        false,
        "test textPreview",
        ["img1.png", "img2.png"],
      );

      expect(result.textPreview).toBe("test textPreview");
      expect(result.imageUrl).toEqual(["img1.png", "img2.png"]);
    });
  });

  describe("transformDatacoreResults", () => {
    it("should transform array of Datacore results", () => {
      const mockResults: any[] = [
        {
          $path: "file1.md",
          $name: "file1",
          $tags: [],
          $ctime: { toMillis: () => 1000 },
          $mtime: { toMillis: () => 2000 },
          value: jest.fn().mockReturnValue([]),
        },
        {
          $path: "file2.md",
          $name: "file2",
          $tags: [],
          $ctime: { toMillis: () => 3000 },
          $mtime: { toMillis: () => 4000 },
          value: jest.fn().mockReturnValue([]),
        },
      ];

      const mockDC: any = {
        coerce: { string: (val: any) => String(val) },
      };

      const textPreviews = {
        "file1.md": "textPreview 1",
        "file2.md": "textPreview 2",
      };

      const images = {
        "file1.md": "img1.png",
        "file2.md": "img2.png",
      };

      const hasImageAvailable = {
        "file1.md": true,
        "file2.md": true,
      };

      const result = transformDatacoreResults(
        mockApp,
        mockResults,
        mockDC,
        mockSettings,
        "alphabetical",
        false,
        textPreviews,
        images,
        hasImageAvailable,
      );

      expect(result).toHaveLength(2);
      expect(result[0].path).toBe("file1.md");
      expect(result[0].textPreview).toBe("textPreview 1");
      expect(result[0].imageUrl).toBe("img1.png");
      expect(result[1].path).toBe("file2.md");
      expect(result[1].textPreview).toBe("textPreview 2");
      expect(result[1].imageUrl).toBe("img2.png");
    });

    it("should handle empty results array", () => {
      const mockDC: any = {
        coerce: { string: (val: any) => String(val) },
      };

      const result = transformDatacoreResults(
        mockApp,
        [],
        mockDC,
        mockSettings,
        "alphabetical",
        false,
      );

      expect(result).toEqual([]);
    });

    it("should work without textPreviews and images maps", () => {
      const mockResults: any[] = [
        {
          $path: "file.md",
          $name: "file",
          $tags: [],
          $ctime: { toMillis: () => 0 },
          $mtime: { toMillis: () => 0 },
          value: jest.fn().mockReturnValue([]),
        },
      ];

      const mockDC: any = {
        coerce: { string: (val: any) => String(val) },
      };

      const result = transformDatacoreResults(
        mockApp,
        mockResults,
        mockDC,
        mockSettings,
        "alphabetical",
        false,
        {},
        {},
        {},
      );

      expect(result).toHaveLength(1);
      expect(result[0].textPreview).toBeUndefined();
      expect(result[0].imageUrl).toBeUndefined();
    });
  });

  describe("transformBasesEntries", () => {
    it("should transform array of Bases entries", () => {
      const mockEntries: any[] = [
        {
          file: {
            path: "file1.md",
            basename: "file1",
            stat: { ctime: 1000, mtime: 2000 },
          },
          getValue: jest.fn(),
        },
        {
          file: {
            path: "file2.md",
            basename: "file2",
            stat: { ctime: 3000, mtime: 4000 },
          },
          getValue: jest.fn(),
        },
      ];

      const textPreviews = {
        "file1.md": "textPreview 1",
        "file2.md": "textPreview 2",
      };

      const images = {
        "file1.md": "img1.png",
        "file2.md": "img2.png",
      };

      const hasImageAvailable = {
        "file1.md": true,
        "file2.md": false,
      };

      const result = transformBasesEntries(
        mockApp,
        mockEntries,
        mockSettings,
        "alphabetical",
        false,
        textPreviews,
        images,
        hasImageAvailable,
      );

      expect(result).toHaveLength(2);
      expect(result[0].path).toBe("file1.md");
      expect(result[0].textPreview).toBe("textPreview 1");
      expect(result[1].path).toBe("file2.md");
      expect(result[1].textPreview).toBe("textPreview 2");
    });

    it("should handle empty entries array", () => {
      const result = transformBasesEntries(
        mockApp,
        [],
        mockSettings,
        "alphabetical",
        false,
        {},
        {},
        {},
      );

      expect(result).toEqual([]);
    });
  });

  describe("resolveBasesProperty", () => {
    it("should resolve file.path property", () => {
      const mockEntry: any = {
        file: { path: "test/folder/file.md" },
      };

      const mockCardData: any = {
        path: "test/folder/file.md",
        folderPath: "test/folder",
        tags: [],
        yamlTags: [],
        ctime: 1000000,
        mtime: 2000000,
      };

      const result = resolveBasesProperty(
        mockApp,
        "file.path",
        mockEntry,
        mockCardData,
        mockSettings,
      );

      expect(result).toBe("test/folder/file.md");
    });

    it("should resolve file path property with space variant", () => {
      const mockEntry: any = {
        file: { path: "test/folder/file.md" },
      };

      const mockCardData: any = {
        path: "test/folder/file.md",
        folderPath: "test/folder",
        tags: [],
        yamlTags: [],
        ctime: 1000000,
        mtime: 2000000,
      };

      const result = resolveBasesProperty(
        mockApp,
        "file path",
        mockEntry,
        mockCardData,
        mockSettings,
      );

      expect(result).toBe("test/folder/file.md");
    });

    it("should return null for empty file.path", () => {
      const mockEntry: any = {
        file: { path: "" },
      };

      const mockCardData: any = {
        path: "",
        folderPath: "",
        tags: [],
        yamlTags: [],
        ctime: 1000000,
        mtime: 2000000,
      };

      const result = resolveBasesProperty(
        mockApp,
        "file.path",
        mockEntry,
        mockCardData,
        mockSettings,
      );

      expect(result).toBeNull();
    });

    it("should resolve file.tags property", () => {
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
        tags: [{ tag: "#tag1" }, { tag: "#tag2" }],
      });

      const mockEntry: any = {
        file: { path: "file.md" },
      };

      const mockCardData: any = {
        folderPath: "",
        tags: ["tag1", "tag2"],
        yamlTags: [],
        ctime: 1000000,
        mtime: 2000000,
      };

      const result = resolveBasesProperty(
        mockApp,
        "file.tags",
        mockEntry,
        mockCardData,
        mockSettings,
      );

      expect(result).toBe("tags");
    });

    it("should handle null/undefined property values", () => {
      const mockEntry: any = {
        file: { path: "file.md" },
        getValue: jest.fn().mockReturnValue(null),
      };

      const mockCardData: any = {
        folderPath: "",
        tags: [],
        yamlTags: [],
        ctime: 1000000,
        mtime: 2000000,
      };

      const result = resolveBasesProperty(
        mockApp,
        "customProp",
        mockEntry,
        mockCardData,
        mockSettings,
      );

      // Should return null for missing property
      expect(result).toBeNull();
    });
  });

  describe("resolveDatacoreProperty", () => {
    // Mock app for all resolveDatacoreProperty tests
    const mockApp: any = {
      vault: {
        getAbstractFileByPath: jest.fn(),
        getResourcePath: jest.fn(),
      },
      metadataCache: {
        getFileCache: jest.fn(),
      },
    };

    it("should resolve file.path property", () => {
      const mockPage: any = {
        $path: "test/folder/file.md",
        value: jest.fn(),
      };

      const mockCardData: any = {
        path: "test/folder/file.md",
        folderPath: "test/folder",
        tags: [],
        yamlTags: [],
        ctime: 1000000,
        mtime: 2000000,
      };

      const mockDC: any = {
        coerce: { string: (val: any) => String(val) },
      };

      const result = resolveDatacoreProperty(
        mockApp,
        "file.path",
        mockPage,
        mockCardData,
        mockSettings,
        mockDC,
      );

      expect(result).toBe("test/folder/file.md");
    });

    it("should resolve file path property with space variant", () => {
      const mockPage: any = {
        $path: "test/folder/file.md",
        value: jest.fn(),
      };

      const mockCardData: any = {
        path: "test/folder/file.md",
        folderPath: "test/folder",
        tags: [],
        yamlTags: [],
        ctime: 1000000,
        mtime: 2000000,
      };

      const mockDC: any = {
        coerce: { string: (val: any) => String(val) },
      };

      const result = resolveDatacoreProperty(
        mockApp,
        "file path",
        mockPage,
        mockCardData,
        mockSettings,
        mockDC,
      );

      expect(result).toBe("test/folder/file.md");
    });

    it("should return null for empty file.path", () => {
      const mockPage: any = {
        $path: "",
        value: jest.fn(),
      };

      const mockCardData: any = {
        path: "",
        folderPath: "",
        tags: [],
        yamlTags: [],
        ctime: 1000000,
        mtime: 2000000,
      };

      const mockDC: any = {
        coerce: { string: (val: any) => String(val) },
      };

      const result = resolveDatacoreProperty(
        mockApp,
        "file.path",
        mockPage,
        mockCardData,
        mockSettings,
        mockDC,
      );

      expect(result).toBeNull();
    });

    it("should resolve tags property", () => {
      const mockPage: any = {
        $tags: ["tag1", "tag2"],
        value: jest.fn(),
      };

      const mockCardData: any = {
        folderPath: "",
        tags: [],
        yamlTags: ["tag1", "tag2"],
        ctime: 1000000,
        mtime: 2000000,
      };

      const mockDC: any = {
        coerce: { string: (val: any) => String(val) },
      };

      const result = resolveDatacoreProperty(
        mockApp,
        "tags",
        mockPage,
        mockCardData,
        mockSettings,
        mockDC,
      );

      expect(result).toBe("tags");
    });

    it("should handle null/undefined property values", () => {
      const mockPage: any = {
        value: jest.fn().mockReturnValue(null),
      };

      const mockCardData: any = {
        folderPath: "",
        tags: [],
        yamlTags: [],
        ctime: 1000000,
        mtime: 2000000,
      };

      const mockDC: any = {
        coerce: { string: (val: any) => String(val) },
      };

      const result = resolveDatacoreProperty(
        mockApp,
        "customProp",
        mockPage,
        mockCardData,
        mockSettings,
        mockDC,
      );

      // Should return null or string for missing property (depends on custom timestamp settings)
      expect(result === null || typeof result === "string").toBe(true);
    });

    describe("file.links property", () => {
      it("should return array of wikilinks from metadataCache", () => {
        const mockFile = Object.assign(new TFile(), { path: "test.md" });
        mockApp.vault.getAbstractFileByPath = jest
          .fn()
          .mockReturnValue(mockFile);
        mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
          links: [{ link: "Page One" }, { link: "Page Two" }],
        });

        const mockPage: any = { value: jest.fn() };
        const mockCardData: any = {
          path: "test.md",
          folderPath: "",
          tags: [],
          yamlTags: [],
          ctime: 1000000,
          mtime: 2000000,
        };
        const mockDC: any = { coerce: { string: (val: any) => String(val) } };

        const result = resolveDatacoreProperty(
          mockApp,
          "file.links",
          mockPage,
          mockCardData,
          mockSettings,
          mockDC,
        );

        expect(result).toBe(
          '{"type":"array","items":["[[Page One]]","[[Page Two]]"]}',
        );
      });

      it("should return null for empty links array", () => {
        const mockFile = Object.assign(new TFile(), { path: "test.md" });
        mockApp.vault.getAbstractFileByPath = jest
          .fn()
          .mockReturnValue(mockFile);
        mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
          links: [],
        });

        const mockPage: any = { value: jest.fn() };
        const mockCardData: any = {
          path: "test.md",
          folderPath: "",
          tags: [],
          yamlTags: [],
          ctime: 1000000,
          mtime: 2000000,
        };
        const mockDC: any = { coerce: { string: (val: any) => String(val) } };

        const result = resolveDatacoreProperty(
          mockApp,
          "file.links",
          mockPage,
          mockCardData,
          mockSettings,
          mockDC,
        );

        expect(result).toBeNull();
      });

      it("should return null when file not found", () => {
        mockApp.vault.getAbstractFileByPath = jest.fn().mockReturnValue(null);

        const mockPage: any = { value: jest.fn() };
        const mockCardData: any = {
          path: "nonexistent.md",
          folderPath: "",
          tags: [],
          yamlTags: [],
          ctime: 1000000,
          mtime: 2000000,
        };
        const mockDC: any = { coerce: { string: (val: any) => String(val) } };

        const result = resolveDatacoreProperty(
          mockApp,
          "file.links",
          mockPage,
          mockCardData,
          mockSettings,
          mockDC,
        );

        expect(result).toBeNull();
      });

      it("should support space variant 'file links'", () => {
        const mockFile = Object.assign(new TFile(), { path: "test.md" });
        mockApp.vault.getAbstractFileByPath = jest
          .fn()
          .mockReturnValue(mockFile);
        mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
          links: [{ link: "Some Page" }],
        });

        const mockPage: any = { value: jest.fn() };
        const mockCardData: any = {
          path: "test.md",
          folderPath: "",
          tags: [],
          yamlTags: [],
          ctime: 1000000,
          mtime: 2000000,
        };
        const mockDC: any = { coerce: { string: (val: any) => String(val) } };

        const result = resolveDatacoreProperty(
          mockApp,
          "file links",
          mockPage,
          mockCardData,
          mockSettings,
          mockDC,
        );

        expect(result).toBe('{"type":"array","items":["[[Some Page]]"]}');
      });
    });

    describe("file.embeds property", () => {
      it("should return array of wikilinks from metadataCache embeds", () => {
        const mockFile = Object.assign(new TFile(), { path: "test.md" });
        mockApp.vault.getAbstractFileByPath = jest
          .fn()
          .mockReturnValue(mockFile);
        mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
          embeds: [{ link: "image.png" }, { link: "attachment.pdf" }],
        });

        const mockPage: any = { value: jest.fn() };
        const mockCardData: any = {
          path: "test.md",
          folderPath: "",
          tags: [],
          yamlTags: [],
          ctime: 1000000,
          mtime: 2000000,
        };
        const mockDC: any = { coerce: { string: (val: any) => String(val) } };

        const result = resolveDatacoreProperty(
          mockApp,
          "file.embeds",
          mockPage,
          mockCardData,
          mockSettings,
          mockDC,
        );

        expect(result).toBe(
          '{"type":"array","items":["[[image.png]]","[[attachment.pdf]]"]}',
        );
      });

      it("should return null for empty embeds array", () => {
        const mockFile = Object.assign(new TFile(), { path: "test.md" });
        mockApp.vault.getAbstractFileByPath = jest
          .fn()
          .mockReturnValue(mockFile);
        mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
          embeds: [],
        });

        const mockPage: any = { value: jest.fn() };
        const mockCardData: any = {
          path: "test.md",
          folderPath: "",
          tags: [],
          yamlTags: [],
          ctime: 1000000,
          mtime: 2000000,
        };
        const mockDC: any = { coerce: { string: (val: any) => String(val) } };

        const result = resolveDatacoreProperty(
          mockApp,
          "file.embeds",
          mockPage,
          mockCardData,
          mockSettings,
          mockDC,
        );

        expect(result).toBeNull();
      });

      it("should support space variant 'file embeds'", () => {
        const mockFile = Object.assign(new TFile(), { path: "test.md" });
        mockApp.vault.getAbstractFileByPath = jest
          .fn()
          .mockReturnValue(mockFile);
        mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
          embeds: [{ link: "doc.pdf" }],
        });

        const mockPage: any = { value: jest.fn() };
        const mockCardData: any = {
          path: "test.md",
          folderPath: "",
          tags: [],
          yamlTags: [],
          ctime: 1000000,
          mtime: 2000000,
        };
        const mockDC: any = { coerce: { string: (val: any) => String(val) } };

        const result = resolveDatacoreProperty(
          mockApp,
          "file embeds",
          mockPage,
          mockCardData,
          mockSettings,
          mockDC,
        );

        expect(result).toBe('{"type":"array","items":["[[doc.pdf]]"]}');
      });

      it("should filter out empty link strings", () => {
        const mockFile = Object.assign(new TFile(), { path: "test.md" });
        mockApp.vault.getAbstractFileByPath = jest
          .fn()
          .mockReturnValue(mockFile);
        mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
          embeds: [
            { link: "valid.png" },
            { link: "" },
            { link: "   " },
            { link: "also-valid.jpg" },
          ],
        });

        const mockPage: any = { value: jest.fn() };
        const mockCardData: any = {
          path: "test.md",
          folderPath: "",
          tags: [],
          yamlTags: [],
          ctime: 1000000,
          mtime: 2000000,
        };
        const mockDC: any = { coerce: { string: (val: any) => String(val) } };

        const result = resolveDatacoreProperty(
          mockApp,
          "file.embeds",
          mockPage,
          mockCardData,
          mockSettings,
          mockDC,
        );

        expect(result).toBe(
          '{"type":"array","items":["[[valid.png]]","[[also-valid.jpg]]"]}',
        );
      });
    });
  });
});
