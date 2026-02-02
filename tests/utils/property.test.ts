import {
  getFirstBasesPropertyValue,
  getFirstDatacorePropertyValue,
  getFirstBasesDatePropertyValue,
  getFirstDatacoreDatePropertyValue,
  getAllBasesImagePropertyValues,
  getAllDatacoreImagePropertyValues,
  getPropertyLabel,
  getAllVaultProperties,
  stripNotePrefix,
  isCheckboxProperty,
  normalizePropertyName,
  isValidUri,
  buildDisplayToSyntaxMap,
  buildSyntaxToDisplayMap,
  normalizeSettingsPropertyNames,
} from "../../src/utils/property";
import type { BasesViewConfig, BasesPropertyId } from "obsidian";
import { App } from "obsidian";

describe("property", () => {
  describe("getFirstBasesPropertyValue", () => {
    let mockApp: App;
    let mockEntry: any;

    beforeEach(() => {
      mockApp = new App();
      mockEntry = {
        getValue: jest.fn(),
      };
    });

    it("should return null for empty property string", () => {
      expect(getFirstBasesPropertyValue(mockApp, mockEntry, "")).toBeNull();
      expect(getFirstBasesPropertyValue(mockApp, mockEntry, "   ")).toBeNull();
    });

    it("should return first property with valid value", () => {
      mockEntry.getValue = jest
        .fn()
        .mockReturnValueOnce(null) // First property doesn't exist
        .mockReturnValueOnce({ data: "test value" }); // Second property exists

      const result = getFirstBasesPropertyValue(
        mockApp,
        mockEntry,
        "prop1, prop2",
      );
      expect(result).toEqual({ data: "test value" });
    });

    it("should not try formula prefix for bare names", () => {
      mockEntry.getValue = jest.fn().mockReturnValue({ icon: "error" });

      const result = getFirstBasesPropertyValue(
        mockApp,
        mockEntry,
        "customProp",
      );
      expect(mockEntry.getValue).toHaveBeenCalledWith("customProp");
      expect(mockEntry.getValue).not.toHaveBeenCalledWith("formula.customProp");
      expect(result).toBeNull();
    });

    it("should handle comma-separated properties", () => {
      mockEntry.getValue = jest
        .fn()
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce({ data: "third value" });

      const result = getFirstBasesPropertyValue(mockApp, mockEntry, "a, b, c");
      expect(result).toEqual({ data: "third value" });
    });

    it("should return null when no properties have values", () => {
      mockEntry.getValue = jest.fn().mockReturnValue(null);

      const result = getFirstBasesPropertyValue(
        mockApp,
        mockEntry,
        "prop1, prop2, prop3",
      );
      expect(result).toBeNull();
    });

    it("should trim property names", () => {
      mockEntry.getValue = jest.fn().mockReturnValue({ data: "value" });

      getFirstBasesPropertyValue(mockApp, mockEntry, "  prop1  ,  prop2  ");
      expect(mockEntry.getValue).toHaveBeenCalledWith("prop1");
    });
  });

  describe("getFirstDatacorePropertyValue", () => {
    let mockPage: any;

    beforeEach(() => {
      mockPage = {
        value: jest.fn(),
      };
    });

    it("should return null for empty property string", () => {
      expect(getFirstDatacorePropertyValue(mockPage, "")).toBeNull();
      expect(getFirstDatacorePropertyValue(mockPage, "   ")).toBeNull();
    });

    it("should return first property with valid value", () => {
      mockPage.value = jest
        .fn()
        .mockReturnValueOnce(null)
        .mockReturnValueOnce("test value");

      const result = getFirstDatacorePropertyValue(mockPage, "prop1, prop2");
      expect(result).toBe("test value");
    });

    it("should skip null/undefined values", () => {
      mockPage.value = jest
        .fn()
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce("valid value");

      const result = getFirstDatacorePropertyValue(mockPage, "a, b, c");
      expect(result).toBe("valid value");
    });

    it("should return null when no properties exist", () => {
      mockPage.value = jest.fn().mockReturnValue(null);

      const result = getFirstDatacorePropertyValue(mockPage, "prop1, prop2");
      expect(result).toBeNull();
    });

    it("should handle different value types", () => {
      mockPage.value = jest.fn().mockReturnValue(42);

      const result = getFirstDatacorePropertyValue(mockPage, "numProp");
      expect(result).toBe(42);
    });
  });

  describe("getFirstBasesDatePropertyValue", () => {
    let mockApp: App;
    let mockEntry: any;

    beforeEach(() => {
      mockApp = new App();
      mockEntry = {
        getValue: jest.fn(),
      };
    });

    it("should return null for empty property string", () => {
      expect(getFirstBasesDatePropertyValue(mockApp, mockEntry, "")).toBeNull();
    });

    it("should return first date property", () => {
      const mockDate = new Date("2024-01-01");
      mockEntry.getValue = jest
        .fn()
        .mockReturnValueOnce(null)
        .mockReturnValueOnce({ date: mockDate });

      const result = getFirstBasesDatePropertyValue(
        mockApp,
        mockEntry,
        "prop1, prop2",
      );
      expect(result).toEqual({ date: mockDate });
    });

    it("should validate date object has Date instance", () => {
      mockEntry.getValue = jest
        .fn()
        .mockReturnValueOnce({ date: "not a date" }) // Invalid
        .mockReturnValueOnce({ date: new Date() }); // Valid

      const result = getFirstBasesDatePropertyValue(mockApp, mockEntry, "a, b");
      expect(result).toHaveProperty("date");
      expect(result.date).toBeInstanceOf(Date);
    });

    it("should not try formula prefix for bare names", () => {
      mockEntry.getValue = jest.fn().mockReturnValue({ icon: "error" });

      const result = getFirstBasesDatePropertyValue(
        mockApp,
        mockEntry,
        "dateProp",
      );
      expect(mockEntry.getValue).toHaveBeenCalledWith("dateProp");
      expect(mockEntry.getValue).not.toHaveBeenCalledWith("formula.dateProp");
      expect(result).toBeNull();
    });
  });

  describe("getFirstDatacoreDatePropertyValue", () => {
    let mockPage: any;

    beforeEach(() => {
      mockPage = {
        value: jest.fn(),
      };
    });

    it("should return null for empty property string", () => {
      expect(getFirstDatacoreDatePropertyValue(mockPage, "")).toBeNull();
    });

    it("should return DateTime objects with toMillis method", () => {
      const mockDateTime = { toMillis: () => 1234567890 };
      mockPage.value = jest
        .fn()
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(mockDateTime);

      const result = getFirstDatacoreDatePropertyValue(
        mockPage,
        "prop1, prop2",
      );
      expect(result).toBe(mockDateTime);
    });

    it("should skip non-DateTime objects", () => {
      mockPage.value = jest
        .fn()
        .mockReturnValueOnce("string")
        .mockReturnValueOnce(123)
        .mockReturnValueOnce({ toMillis: () => 999 });

      const result = getFirstDatacoreDatePropertyValue(mockPage, "a, b, c");
      expect(result).toHaveProperty("toMillis");
    });

    it("should return null when no DateTime found", () => {
      mockPage.value = jest.fn().mockReturnValue("not a date");

      const result = getFirstDatacoreDatePropertyValue(mockPage, "prop");
      expect(result).toBeNull();
    });
  });

  describe("getAllBasesImagePropertyValues", () => {
    let mockApp: App;
    let mockEntry: any;

    beforeEach(() => {
      mockApp = new App();
      mockEntry = {
        getValue: jest.fn(),
      };
    });

    it("should return empty array for empty property string", () => {
      expect(getAllBasesImagePropertyValues(mockApp, mockEntry, "")).toEqual(
        [],
      );
    });

    it("should collect string values", () => {
      mockEntry.getValue = jest.fn().mockReturnValue({ data: "image.png" });

      const result = getAllBasesImagePropertyValues(mockApp, mockEntry, "img");
      expect(result).toEqual(["image.png"]);
    });

    it("should collect array values", () => {
      mockEntry.getValue = jest.fn().mockReturnValue({
        data: ["img1.png", "img2.jpg", "img3.gif"],
      });

      const result = getAllBasesImagePropertyValues(
        mockApp,
        mockEntry,
        "images",
      );
      expect(result).toEqual(["img1.png", "img2.jpg", "img3.gif"]);
    });

    it("should collect from multiple properties", () => {
      mockEntry.getValue = jest
        .fn()
        .mockReturnValueOnce({ data: "img1.png" })
        .mockReturnValueOnce({ data: "img2.png" });

      const result = getAllBasesImagePropertyValues(
        mockApp,
        mockEntry,
        "prop1, prop2",
      );
      expect(result).toEqual(["img1.png", "img2.png"]);
    });

    it("should skip null/empty values", () => {
      mockEntry.getValue = jest
        .fn()
        .mockReturnValueOnce({ data: null })
        .mockReturnValueOnce({ data: "" })
        .mockReturnValueOnce({ data: "valid.png" });

      const result = getAllBasesImagePropertyValues(
        mockApp,
        mockEntry,
        "a, b, c",
      );
      expect(result).toEqual(["valid.png"]);
    });

    it("should convert numbers to strings", () => {
      mockEntry.getValue = jest.fn().mockReturnValue({ data: 123 });

      const result = getAllBasesImagePropertyValues(mockApp, mockEntry, "num");
      expect(result).toEqual(["123"]);
    });

    it("should handle mixed arrays", () => {
      mockEntry.getValue = jest.fn().mockReturnValue({
        data: ["img1.png", 42, "img2.jpg"],
      });

      const result = getAllBasesImagePropertyValues(
        mockApp,
        mockEntry,
        "mixed",
      );
      expect(result).toEqual(["img1.png", "42", "img2.jpg"]);
    });

    it("should not try formula prefix for bare names", () => {
      mockEntry.getValue = jest.fn().mockReturnValue({ icon: "error" });

      const result = getAllBasesImagePropertyValues(mockApp, mockEntry, "img");
      expect(mockEntry.getValue).toHaveBeenCalledWith("img");
      expect(mockEntry.getValue).not.toHaveBeenCalledWith("formula.img");
      expect(result).toEqual([]);
    });
  });

  describe("getAllDatacoreImagePropertyValues", () => {
    let mockPage: any;

    beforeEach(() => {
      mockPage = {
        value: jest.fn(),
      };
    });

    it("should return empty array for empty property string", () => {
      expect(getAllDatacoreImagePropertyValues(mockPage, "")).toEqual([]);
    });

    it("should collect string values", () => {
      mockPage.value = jest.fn().mockReturnValue("image.png");

      const result = getAllDatacoreImagePropertyValues(mockPage, "img");
      expect(result).toEqual(["image.png"]);
    });

    it("should collect array values", () => {
      mockPage.value = jest.fn().mockReturnValue(["img1.png", "img2.jpg"]);

      const result = getAllDatacoreImagePropertyValues(mockPage, "images");
      expect(result).toEqual(["img1.png", "img2.jpg"]);
    });

    it("should handle Link objects with path property", () => {
      mockPage.value = jest.fn().mockReturnValue({ path: "linked-image.png" });

      const result = getAllDatacoreImagePropertyValues(mockPage, "link");
      expect(result).toEqual(["linked-image.png"]);
    });

    it("should handle arrays of Link objects", () => {
      mockPage.value = jest
        .fn()
        .mockReturnValue([{ path: "img1.png" }, { path: "img2.png" }]);

      const result = getAllDatacoreImagePropertyValues(mockPage, "links");
      expect(result).toEqual(["img1.png", "img2.png"]);
    });

    it("should skip null/undefined", () => {
      mockPage.value = jest
        .fn()
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce("valid.png");

      const result = getAllDatacoreImagePropertyValues(mockPage, "a, b, c");
      expect(result).toEqual(["valid.png"]);
    });

    it("should convert numbers to strings", () => {
      mockPage.value = jest.fn().mockReturnValue(42);

      const result = getAllDatacoreImagePropertyValues(mockPage, "num");
      expect(result).toEqual(["42"]);
    });

    it("should trim whitespace", () => {
      mockPage.value = jest.fn().mockReturnValue("  img.png  ");

      const result = getAllDatacoreImagePropertyValues(mockPage, "img");
      expect(result).toEqual(["img.png"]);
    });
  });

  describe("getPropertyLabel", () => {
    it("should return empty string for empty input", () => {
      expect(getPropertyLabel("")).toBe("");
    });

    it('should map file.path to "file path"', () => {
      expect(getPropertyLabel("file.path")).toBe("file path");
      expect(getPropertyLabel("path")).toBe("file path");
    });

    it('should map file.tags to "file tags"', () => {
      expect(getPropertyLabel("file.tags")).toBe("file tags");
    });

    it("should map ctime/mtime to human-readable names", () => {
      expect(getPropertyLabel("file.ctime")).toBe("created time");
      expect(getPropertyLabel("file.mtime")).toBe("modified time");
    });

    it("should handle case-insensitive mapping", () => {
      expect(getPropertyLabel("FILE.PATH")).toBe("file path");
      expect(getPropertyLabel("File.Tags")).toBe("file tags");
    });

    it("should strip note. prefix", () => {
      expect(getPropertyLabel("note.customProp")).toBe("customProp");
      expect(getPropertyLabel("note.title")).toBe("title");
    });

    it("should strip formula. prefix", () => {
      expect(getPropertyLabel("formula.myCalc")).toBe("myCalc");
    });

    it("should preserve custom property names as-is", () => {
      expect(getPropertyLabel("MyCustomProperty")).toBe("MyCustomProperty");
      expect(getPropertyLabel("some_property")).toBe("some_property");
    });

    it("should map all file properties correctly", () => {
      expect(getPropertyLabel("file.name")).toBe("file name");
      expect(getPropertyLabel("file.basename")).toBe("file base name");
      expect(getPropertyLabel("file.extension")).toBe("file extension");
      expect(getPropertyLabel("file.size")).toBe("file size");
      expect(getPropertyLabel("folder")).toBe("folder");
    });

    it("should use displayNameMap when provided", () => {
      const displayNameMap = {
        "formula.Untitled": "smile more",
        "file.name": "filename123",
        "note.prop123": "display-name",
      };
      expect(getPropertyLabel("formula.Untitled", displayNameMap)).toBe(
        "smile more",
      );
      expect(getPropertyLabel("file.name", displayNameMap)).toBe("filename123");
      expect(getPropertyLabel("note.prop123", displayNameMap)).toBe(
        "display-name",
      );
    });

    it("should fall back to default behavior when property not in displayNameMap", () => {
      const displayNameMap = { "formula.Untitled": "smile more" };
      // file.path not in map → falls back to PROPERTY_LABEL_MAP
      expect(getPropertyLabel("file.path", displayNameMap)).toBe("file path");
      // note.title not in map → falls back to prefix stripping
      expect(getPropertyLabel("note.title", displayNameMap)).toBe("title");
    });

    it("should fall back to default behavior when displayNameMap is undefined", () => {
      expect(getPropertyLabel("formula.Untitled", undefined)).toBe("Untitled");
      expect(getPropertyLabel("file.name", undefined)).toBe("file name");
    });
  });

  describe("getAllVaultProperties", () => {
    let mockApp: App;

    beforeEach(() => {
      mockApp = new App();
    });

    it("should include built-in properties", () => {
      const result = getAllVaultProperties(mockApp);

      expect(result).toContain("file.path");
      expect(result).toContain("file.tags");
      expect(result).toContain("file.mtime");
      expect(result).toContain("file.ctime");
    });

    it("should include human-readable formats", () => {
      const result = getAllVaultProperties(mockApp);

      expect(result).toContain("file path");
      expect(result).toContain("file tags");
      expect(result).toContain("created time");
      expect(result).toContain("modified time");
    });

    it("should get properties from metadata cache if available", () => {
      (mockApp.metadataCache as any).getAllPropertyInfos = jest
        .fn()
        .mockReturnValue({
          customProp1: {},
          customProp2: {},
          title: {},
        });

      const result = getAllVaultProperties(mockApp);

      expect(result).toContain("customProp1");
      expect(result).toContain("customProp2");
      expect(result).toContain("title");
    });

    it("should handle missing getAllPropertyInfos method", () => {
      delete (mockApp.metadataCache as any).getAllPropertyInfos;

      const result = getAllVaultProperties(mockApp);

      // Should still have built-in properties
      expect(result).toContain("file.path");
      expect(result).toContain("file.tags");
    });

    it("should return sorted array with custom ordering", () => {
      const result = getAllVaultProperties(mockApp);

      // Should have custom sorting (Bases format first, then alphabetical)
      // Just verify it's an array and has expected properties
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);

      // file.* properties should come before "file *" properties
      const basesFormatIndex = result.findIndex((p) => p.startsWith("file."));
      const humanFormatIndex = result.findIndex((p) => p.startsWith("file "));

      if (basesFormatIndex >= 0 && humanFormatIndex >= 0) {
        expect(basesFormatIndex).toBeLessThan(humanFormatIndex);
      }
    });

    it("should prioritize Bases format over human-readable", () => {
      const result = getAllVaultProperties(mockApp);

      const pathIndex = result.indexOf("file.path");
      const filePathIndex = result.indexOf("file path");

      expect(pathIndex).toBeLessThan(filePathIndex);
    });
  });

  describe("stripNotePrefix", () => {
    it("should strip note. prefix", () => {
      expect(stripNotePrefix("note.title")).toBe("title");
      expect(stripNotePrefix("note.author")).toBe("author");
    });

    it("should return unchanged if no note. prefix", () => {
      expect(stripNotePrefix("title")).toBe("title");
      expect(stripNotePrefix("file.path")).toBe("file.path");
      expect(stripNotePrefix("formula.test")).toBe("formula.test");
    });

    it("should handle empty string", () => {
      expect(stripNotePrefix("")).toBe("");
    });

    it("should handle note. as entire string", () => {
      expect(stripNotePrefix("note.")).toBe("");
    });
  });

  describe("isCheckboxProperty", () => {
    let mockApp: App;

    beforeEach(() => {
      mockApp = new App();
    });

    it("should return true for checkbox widget", () => {
      (mockApp.metadataCache as any).getAllPropertyInfos = jest
        .fn()
        .mockReturnValue({
          done: { widget: "checkbox" },
          completed: { widget: "checkbox" },
        });

      expect(isCheckboxProperty(mockApp, "done")).toBe(true);
      expect(isCheckboxProperty(mockApp, "completed")).toBe(true);
    });

    it("should return false for non-checkbox widget", () => {
      (mockApp.metadataCache as any).getAllPropertyInfos = jest
        .fn()
        .mockReturnValue({
          title: { widget: "text" },
          date: { widget: "date" },
        });

      expect(isCheckboxProperty(mockApp, "title")).toBe(false);
      expect(isCheckboxProperty(mockApp, "date")).toBe(false);
    });

    it("should strip note. prefix before checking", () => {
      (mockApp.metadataCache as any).getAllPropertyInfos = jest
        .fn()
        .mockReturnValue({
          done: { widget: "checkbox" },
        });

      expect(isCheckboxProperty(mockApp, "note.done")).toBe(true);
    });

    it("should return false for missing property", () => {
      (mockApp.metadataCache as any).getAllPropertyInfos = jest
        .fn()
        .mockReturnValue({});

      expect(isCheckboxProperty(mockApp, "missing")).toBe(false);
    });

    it("should handle missing getAllPropertyInfos method", () => {
      delete (mockApp.metadataCache as any).getAllPropertyInfos;

      expect(isCheckboxProperty(mockApp, "done")).toBe(false);
    });
  });

  describe("normalizePropertyName", () => {
    let mockApp: App;

    beforeEach(() => {
      mockApp = new App();
      // Mock workspace.getLeavesOfType to return empty (API unavailable)
      mockApp.workspace.getLeavesOfType = jest.fn().mockReturnValue([]);
    });

    it("should pass through syntax format properties", () => {
      expect(normalizePropertyName(mockApp, "file.path")).toBe("file.path");
      expect(normalizePropertyName(mockApp, "file.mtime")).toBe("file.mtime");
      expect(normalizePropertyName(mockApp, "formula.test")).toBe(
        "formula.test",
      );
      expect(normalizePropertyName(mockApp, "note.title")).toBe("note.title");
    });

    it("should use hardcoded fallback when no reverseMap (Datacore path)", () => {
      expect(normalizePropertyName(mockApp, "file name")).toBe("file.name");
      expect(normalizePropertyName(mockApp, "created time")).toBe("file.ctime");
      expect(normalizePropertyName(mockApp, "modified time")).toBe(
        "file.mtime",
      );
      expect(normalizePropertyName(mockApp, "folder")).toBe("file.folder");
    });

    it("should use reverseMap when provided (Bases path)", () => {
      const reverseMap = {
        "my title": "note.title",
        "smile more": "formula.Untitled",
        filename123: "file.name",
      };
      expect(normalizePropertyName(mockApp, "my title", reverseMap)).toBe(
        "note.title",
      );
      expect(normalizePropertyName(mockApp, "smile more", reverseMap)).toBe(
        "formula.Untitled",
      );
      expect(normalizePropertyName(mockApp, "filename123", reverseMap)).toBe(
        "file.name",
      );
    });

    it("should not fall back to hardcoded defaults when reverseMap is provided", () => {
      const reverseMap = {};
      // "file name" normally maps to "file.name" via hardcoded defaults
      // but with an empty reverseMap, it should return as-is
      expect(normalizePropertyName(mockApp, "file name", reverseMap)).toBe(
        "file name",
      );
    });

    it("should return custom properties as-is", () => {
      expect(normalizePropertyName(mockApp, "customProp")).toBe("customProp");
      expect(normalizePropertyName(mockApp, "my_property")).toBe("my_property");
    });

    it("should handle empty/whitespace input", () => {
      expect(normalizePropertyName(mockApp, "")).toBe("");
      expect(normalizePropertyName(mockApp, "   ")).toBe("   ");
    });

    it("should trim input", () => {
      expect(normalizePropertyName(mockApp, "  file.path  ")).toBe("file.path");
    });
  });

  describe("isValidUri", () => {
    it("should accept valid HTTP URLs", () => {
      expect(isValidUri("http://example.com")).toBe(true);
      expect(isValidUri("https://example.com/path")).toBe(true);
      expect(isValidUri("https://example.com/path?query=1")).toBe(true);
    });

    it("should accept other valid URI schemes", () => {
      expect(isValidUri("obsidian://open?vault=test")).toBe(true);
      expect(isValidUri("file:///path/to/file")).toBe(true);
      expect(isValidUri("ftp://server.com/file")).toBe(true);
    });

    it("should reject invalid URIs", () => {
      expect(isValidUri("not-a-uri")).toBe(false);
      expect(isValidUri("example.com")).toBe(false);
      expect(isValidUri("://missing-scheme")).toBe(false);
    });

    it("should reject empty/null/undefined", () => {
      expect(isValidUri("")).toBe(false);
      expect(isValidUri(null as any)).toBe(false);
      expect(isValidUri(undefined as any)).toBe(false);
    });

    it("should reject too short URIs", () => {
      expect(isValidUri("a://")).toBe(false); // Less than 5 chars
    });

    it("should handle whitespace", () => {
      expect(isValidUri("  https://example.com  ")).toBe(true);
    });
  });

  describe("buildDisplayToSyntaxMap", () => {
    function mockConfig(
      displayNames: Record<string, string>,
    ): BasesViewConfig {
      return {
        getDisplayName: (id: string) => displayNames[id] ?? "",
      } as unknown as BasesViewConfig;
    }

    it("should map display names to syntax names", () => {
      const config = mockConfig({
        "file.name": "filename123",
        "note.prop123": "display-name",
        "formula.Untitled": "smile more",
      });
      const allProperties = [
        "file.name",
        "note.prop123",
        "formula.Untitled",
      ] as BasesPropertyId[];

      const map = buildDisplayToSyntaxMap(config, allProperties);

      expect(map["filename123"]).toBe("file.name");
      expect(map["display-name"]).toBe("note.prop123");
      expect(map["smile more"]).toBe("formula.Untitled");
    });

    it("should only map display names, not bare formula keys", () => {
      const config = mockConfig({
        "formula.Untitled": "smile more",
      });
      const allProperties = ["formula.Untitled"] as BasesPropertyId[];

      const map = buildDisplayToSyntaxMap(config, allProperties);

      // Display name maps; bare key doesn't (syntax format resolves via pass-through)
      expect(map["smile more"]).toBe("formula.Untitled");
      expect(map["Untitled"]).toBeUndefined();
    });

    it("should handle empty allProperties", () => {
      const config = mockConfig({});
      const map = buildDisplayToSyntaxMap(config, []);
      expect(Object.keys(map)).toHaveLength(0);
    });

    it("should skip properties with empty display name", () => {
      const config = mockConfig({ "file.name": "" });
      const allProperties = ["file.name"] as BasesPropertyId[];

      const map = buildDisplayToSyntaxMap(config, allProperties);

      expect(Object.keys(map)).toHaveLength(0);
    });
  });

  describe("buildSyntaxToDisplayMap", () => {
    function mockConfig(
      displayNames: Record<string, string>,
    ): BasesViewConfig {
      return {
        getDisplayName: (id: string) => displayNames[id] ?? "",
      } as unknown as BasesViewConfig;
    }

    it("should map syntax names to display names", () => {
      const config = mockConfig({
        "file.name": "filename123",
        "formula.Untitled": "smile more",
      });
      const allProperties = [
        "file.name",
        "formula.Untitled",
      ] as BasesPropertyId[];

      const map = buildSyntaxToDisplayMap(config, allProperties);

      expect(map["file.name"]).toBe("filename123");
      expect(map["formula.Untitled"]).toBe("smile more");
    });

    it("should skip properties with empty display name", () => {
      const config = mockConfig({ "file.name": "" });
      const allProperties = ["file.name"] as BasesPropertyId[];

      const map = buildSyntaxToDisplayMap(config, allProperties);

      expect(Object.keys(map)).toHaveLength(0);
    });
  });

  describe("normalizeSettingsPropertyNames", () => {
    let mockApp: App;

    beforeEach(() => {
      mockApp = new App();
    });

    it("should normalize all property settings fields", () => {
      const reverseMap = {
        filename123: "file.name",
        "smile more": "formula.Untitled",
      };
      const displayNameMap = {
        "file.name": "filename123",
        "formula.Untitled": "smile more",
      };
      const settings: Record<string, unknown> = {
        titleProperty: "filename123",
        subtitleProperty: "smile more",
        textPreviewProperty: "",
        imageProperty: "file.name",
        urlProperty: "url",
      };

      normalizeSettingsPropertyNames(
        mockApp,
        settings as any,
        reverseMap,
        displayNameMap,
      );

      expect(settings.titleProperty).toBe("file.name");
      expect(settings.subtitleProperty).toBe("formula.Untitled");
      expect(settings.textPreviewProperty).toBe(""); // empty → untouched
      expect(settings.imageProperty).toBe("file.name"); // already syntax → pass through
      expect(settings.urlProperty).toBe("url"); // unknown → as-is
    });

    it("should handle comma-separated values", () => {
      const reverseMap = {
        filename123: "file.name",
        "created time": "file.ctime",
      };
      const settings: Record<string, unknown> = {
        titleProperty: "filename123, created time",
      };

      normalizeSettingsPropertyNames(
        mockApp,
        settings as any,
        reverseMap,
        {},
      );

      expect(settings.titleProperty).toBe("file.name,file.ctime");
    });

    it("should attach displayNameMap to settings", () => {
      const displayNameMap = { "file.name": "filename123" };
      const settings: Record<string, unknown> = {};

      normalizeSettingsPropertyNames(
        mockApp,
        settings as any,
        {},
        displayNameMap,
      );

      expect((settings as any)._displayNameMap).toBe(displayNameMap);
    });
  });

  describe("getFirstBasesPropertyValue date validation", () => {
    let mockApp: App;
    let mockEntry: any;

    beforeEach(() => {
      mockApp = new App();
      mockEntry = {
        getValue: jest.fn(),
        file: { path: "test.md" },
      };
    });

    it("should accept valid date object with Date instance", () => {
      const validDate = new Date("2024-01-01");
      mockEntry.getValue = jest.fn().mockReturnValue({
        icon: "calendar",
        date: validDate,
        time: null,
      });

      const result = getFirstBasesPropertyValue(mockApp, mockEntry, "dateProp");
      expect(result).toEqual({ icon: "calendar", date: validDate, time: null });
    });

    it("should reject malformed date object with string date", () => {
      mockEntry.getValue = jest.fn().mockReturnValue({
        icon: "calendar",
        date: "2024-01-01", // String, not Date
        time: null,
      });

      // Should fall through to other checks, not return malformed value
      const result = getFirstBasesPropertyValue(mockApp, mockEntry, "dateProp");
      expect(result).not.toEqual(
        expect.objectContaining({ date: "2024-01-01" }),
      );
    });

    it("should reject date object with invalid Date (NaN)", () => {
      const invalidDate = new Date("invalid");
      mockEntry.getValue = jest.fn().mockReturnValue({
        icon: "calendar",
        date: invalidDate,
        time: null,
      });

      const result = getFirstBasesPropertyValue(mockApp, mockEntry, "dateProp");
      // Invalid date should not be returned as valid date value
      expect(result).not.toEqual(
        expect.objectContaining({ date: invalidDate }),
      );
    });
  });
});
