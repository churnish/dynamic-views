import { serializeGroupKey, handleTemplateToggle } from "../../src/bases/utils";
import { Notice } from "obsidian";

// Mock extractBasesTemplate — returns a sparse template object
jest.mock("../../src/shared/settings-schema", () => ({
  extractBasesTemplate: jest.fn(() => ({ cardSize: 250 })),
}));

// Mock modules that handleTemplateToggle doesn't use but utils.ts imports
jest.mock("../../src/shared/data-transform", () => ({
  resolveTimestampProperty: jest.fn(),
}));
jest.mock("../../src/utils/property", () => ({
  getFirstBasesPropertyValue: jest.fn(),
  getAllBasesImagePropertyValues: jest.fn(),
}));
jest.mock("../../src/shared/content-loader", () => ({
  loadTextPreviewsForEntries: jest.fn(),
  loadImagesForEntries: jest.fn(),
}));
jest.mock("../../src/utils/notebook-navigator", () => ({
  shouldUseNotebookNavigator: jest.fn(),
  navigateToTagInNotebookNavigator: jest.fn(),
  navigateToFolderInNotebookNavigator: jest.fn(),
}));

// activeWindow is an Obsidian global (maps to the current window)
(global as any).activeWindow = window;

/** Create a mock BasesConfigInit backed by a plain Map */
function createMockConfig(initial: Record<string, unknown> = {}): {
  get: jest.Mock;
  set: jest.Mock;
  getOrder: jest.Mock;
} {
  const store = new Map(Object.entries(initial));
  return {
    get: jest.fn((key: string) => store.get(key)),
    set: jest.fn((key: string, value: unknown) => {
      if (value === undefined) store.delete(key);
      else store.set(key, value);
    }),
    getOrder: jest.fn(() => []),
  };
}

/** Create a mock plugin with persistenceManager.setSettingsTemplate */
function createMockPlugin(): {
  persistenceManager: { setSettingsTemplate: jest.Mock };
} {
  return {
    persistenceManager: {
      setSettingsTemplate: jest.fn().mockResolvedValue(undefined),
    },
  };
}

describe("handleTemplateToggle", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("first call (initialization)", () => {
    it("should set initializedRef and return without action when isTemplate is false", () => {
      const config = createMockConfig({ isTemplate: false });
      const plugin = createMockPlugin();
      const initializedRef = { value: false };
      const cooldownRef = {
        value: null as ReturnType<typeof setTimeout> | null,
      };

      handleTemplateToggle(
        config as any,
        "grid",
        plugin as any,
        initializedRef,
        cooldownRef,
      );

      expect(initializedRef.value).toBe(true);
      expect(config.set).not.toHaveBeenCalled();
      expect(cooldownRef.value).toBeNull();
    });

    it("should reset stale isTemplate and start cooldown on first call", () => {
      const config = createMockConfig({ isTemplate: true });
      const plugin = createMockPlugin();
      const initializedRef = { value: false };
      const cooldownRef = {
        value: null as ReturnType<typeof setTimeout> | null,
      };

      handleTemplateToggle(
        config as any,
        "grid",
        plugin as any,
        initializedRef,
        cooldownRef,
      );

      expect(initializedRef.value).toBe(true);
      expect(config.set).toHaveBeenCalledWith("isTemplate", undefined);
      expect(cooldownRef.value).not.toBeNull();
      // Should NOT save template or show notice on first call
      expect(
        plugin.persistenceManager.setSettingsTemplate,
      ).not.toHaveBeenCalled();
    });

    it("should clear cooldown after 3s timeout", () => {
      const config = createMockConfig({ isTemplate: true });
      const plugin = createMockPlugin();
      const initializedRef = { value: false };
      const cooldownRef = {
        value: null as ReturnType<typeof setTimeout> | null,
      };

      handleTemplateToggle(
        config as any,
        "grid",
        plugin as any,
        initializedRef,
        cooldownRef,
      );
      expect(cooldownRef.value).not.toBeNull();

      jest.advanceTimersByTime(3000);
      expect(cooldownRef.value).toBeNull();
    });
  });

  describe("normal toggle (after initialization)", () => {
    it("should skip when isTemplate is false", () => {
      const config = createMockConfig({ isTemplate: false });
      const plugin = createMockPlugin();
      const initializedRef = { value: true };
      const cooldownRef = {
        value: null as ReturnType<typeof setTimeout> | null,
      };

      handleTemplateToggle(
        config as any,
        "grid",
        plugin as any,
        initializedRef,
        cooldownRef,
      );

      expect(config.set).not.toHaveBeenCalled();
      expect(
        plugin.persistenceManager.setSettingsTemplate,
      ).not.toHaveBeenCalled();
    });

    it("should save template, show notice, and start cooldown on toggle ON", () => {
      const config = createMockConfig({ isTemplate: true });
      const plugin = createMockPlugin();
      const initializedRef = { value: true };
      const cooldownRef = {
        value: null as ReturnType<typeof setTimeout> | null,
      };

      handleTemplateToggle(
        config as any,
        "grid",
        plugin as any,
        initializedRef,
        cooldownRef,
      );

      // Resets the one-shot toggle
      expect(config.set).toHaveBeenCalledWith("isTemplate", undefined);
      // Saves template
      expect(
        plugin.persistenceManager.setSettingsTemplate,
      ).toHaveBeenCalledWith("grid", expect.any(Object));
      // Starts cooldown
      expect(cooldownRef.value).not.toBeNull();
    });

    it("should use correct label for masonry view type", () => {
      const config = createMockConfig({ isTemplate: true });
      const plugin = createMockPlugin();
      const initializedRef = { value: true };
      const cooldownRef = {
        value: null as ReturnType<typeof setTimeout> | null,
      };

      handleTemplateToggle(
        config as any,
        "masonry",
        plugin as any,
        initializedRef,
        cooldownRef,
      );

      expect(
        plugin.persistenceManager.setSettingsTemplate,
      ).toHaveBeenCalledWith("masonry", expect.any(Object));
    });
  });

  describe("cooldown suppression", () => {
    it("should reset isTemplate but skip save/notice during cooldown", () => {
      const config = createMockConfig({ isTemplate: true });
      const plugin = createMockPlugin();
      const initializedRef = { value: true };
      const cooldownRef = {
        value: setTimeout(() => {}, 9999) as ReturnType<typeof setTimeout>,
      };

      handleTemplateToggle(
        config as any,
        "grid",
        plugin as any,
        initializedRef,
        cooldownRef,
      );

      // Still resets the toggle (one-shot)
      expect(config.set).toHaveBeenCalledWith("isTemplate", undefined);
      // But does NOT save or show notice
      expect(
        plugin.persistenceManager.setSettingsTemplate,
      ).not.toHaveBeenCalled();
    });

    it("should save template after cooldown expires", () => {
      const config = createMockConfig({ isTemplate: true });
      const plugin = createMockPlugin();
      const initializedRef = { value: true };
      const cooldownRef = {
        value: null as ReturnType<typeof setTimeout> | null,
      };

      // First toggle — starts cooldown
      handleTemplateToggle(
        config as any,
        "grid",
        plugin as any,
        initializedRef,
        cooldownRef,
      );
      expect(
        plugin.persistenceManager.setSettingsTemplate,
      ).toHaveBeenCalledTimes(1);

      // Expire the cooldown
      jest.advanceTimersByTime(3000);
      expect(cooldownRef.value).toBeNull();

      // Second toggle — should save again
      config.get.mockReturnValue(true);
      handleTemplateToggle(
        config as any,
        "grid",
        plugin as any,
        initializedRef,
        cooldownRef,
      );
      expect(
        plugin.persistenceManager.setSettingsTemplate,
      ).toHaveBeenCalledTimes(2);
    });
  });

  describe("notice container re-attach", () => {
    it("should re-attach disconnected notice container to document body", () => {
      const config = createMockConfig({ isTemplate: true });
      const plugin = createMockPlugin();
      const initializedRef = { value: true };
      const cooldownRef = {
        value: null as ReturnType<typeof setTimeout> | null,
      };

      // Create a detached container to simulate the stale cache bug
      const noticeContainer = document.createElement("div");
      const containerEl = document.createElement("div");
      noticeContainer.appendChild(containerEl);
      // noticeContainer is NOT in the document — isConnected will be false

      // Override Notice mock to set containerEl
      const OriginalNotice = Notice;
      (Notice as any) = class {
        containerEl = containerEl;
        constructor() {}
      };

      handleTemplateToggle(
        config as any,
        "grid",
        plugin as any,
        initializedRef,
        cooldownRef,
      );

      // The detached container should now be in document.body
      expect(noticeContainer.isConnected).toBe(true);

      // Restore
      (Notice as any) = OriginalNotice;
    });
  });
});

describe("serializeGroupKey", () => {
  describe("primitives", () => {
    it("should return undefined for null", () => {
      expect(serializeGroupKey(null)).toBeUndefined();
    });

    it("should return undefined for undefined", () => {
      expect(serializeGroupKey(undefined)).toBeUndefined();
    });

    it("should return string as-is", () => {
      expect(serializeGroupKey("test")).toBe("test");
      expect(serializeGroupKey("")).toBe("");
      expect(serializeGroupKey("hello world")).toBe("hello world");
    });

    it("should convert number to string", () => {
      expect(serializeGroupKey(123)).toBe("123");
      expect(serializeGroupKey(0)).toBe("0");
      expect(serializeGroupKey(-42)).toBe("-42");
      expect(serializeGroupKey(3.14)).toBe("3.14");
    });

    it("should convert boolean to string", () => {
      expect(serializeGroupKey(true)).toBe("true");
      expect(serializeGroupKey(false)).toBe("false");
    });
  });

  describe("Bases Value objects with .data", () => {
    it("should extract string from .data", () => {
      expect(serializeGroupKey({ icon: "📁", data: "folder" })).toBe("folder");
      expect(serializeGroupKey({ data: "value" })).toBe("value");
    });

    it("should extract number from .data and convert to string", () => {
      expect(serializeGroupKey({ icon: "🔢", data: 462 })).toBe("462");
      expect(serializeGroupKey({ data: 0 })).toBe("0");
      expect(serializeGroupKey({ data: -1 })).toBe("-1");
    });

    it("should extract boolean from .data and convert to string", () => {
      expect(serializeGroupKey({ icon: "✓", data: true })).toBe("true");
      expect(serializeGroupKey({ data: false })).toBe("false");
    });

    it("should return undefined for null .data", () => {
      expect(serializeGroupKey({ icon: "❌", data: null })).toBeUndefined();
    });

    it("should return undefined for undefined .data", () => {
      expect(
        serializeGroupKey({ icon: "❌", data: undefined }),
      ).toBeUndefined();
    });

    it("should handle empty string in .data", () => {
      expect(serializeGroupKey({ data: "" })).toBe("");
    });

    it("should return undefined for empty arrays in .data", () => {
      expect(serializeGroupKey({ data: [] })).toBeUndefined();
    });

    it("should join primitive arrays in .data with comma separator", () => {
      const result = serializeGroupKey({ data: [1, 2, 3] });
      expect(result).toBe("1, 2, 3");
    });

    it("should stringify nested objects in .data", () => {
      const result = serializeGroupKey({ data: { nested: "value" } });
      expect(result).toBe('{"nested":"value"}');
    });
  });

  describe("Bases date Value objects", () => {
    it("should format Date object to ISO string", () => {
      const date = new Date("2024-06-15T10:30:00Z");
      const result = serializeGroupKey({ date });
      expect(result).toBe("2024-06-15T10:30:00.000Z");
    });

    it("should format Date object with additional properties to ISO string", () => {
      // Additional properties like `time` are ignored - only .date matters
      const date = new Date("2024-06-15T00:00:00Z");
      const result = serializeGroupKey({ date, time: false, extra: "ignored" });
      expect(result).toBe("2024-06-15T00:00:00.000Z");
    });
  });

  describe("plain objects and arrays", () => {
    it("should stringify plain objects", () => {
      expect(serializeGroupKey({ key: "value" })).toBe('{"key":"value"}');
    });

    it("should return undefined for empty arrays", () => {
      expect(serializeGroupKey([])).toBeUndefined();
    });

    it("should join string arrays with comma separator", () => {
      expect(serializeGroupKey(["a", "b", "c"])).toBe("a, b, c");
    });

    it("should join number arrays with comma separator", () => {
      expect(serializeGroupKey([1, 2, 3])).toBe("1, 2, 3");
    });

    it("should extract .data from arrays of Bases Value objects (tags)", () => {
      const tags = [
        { icon: "lucide-text", data: "#tag1" },
        { icon: "lucide-text", data: "#tag2" },
      ];
      expect(serializeGroupKey(tags)).toBe("#tag1, #tag2");
    });
  });

  describe("edge cases", () => {
    it("should handle circular references gracefully", () => {
      const obj: Record<string, unknown> = {};
      obj.self = obj;
      const result = serializeGroupKey(obj);
      expect(result).toMatch(/^\[object:/);
    });

    it("should not confuse regular objects with .data as Bases Values", () => {
      // Object with .data that contains null should return undefined
      expect(serializeGroupKey({ data: null })).toBeUndefined();
      // Object with .data that contains a value should extract it
      expect(serializeGroupKey({ data: "extracted" })).toBe("extracted");
    });

    it("should handle mixed primitive types in arrays", () => {
      expect(serializeGroupKey([1, "two", true])).toBe("1, two, true");
    });

    it("should recursively process nested .data properties", () => {
      expect(serializeGroupKey({ data: { data: "nested" } })).toBe("nested");
    });

    it("should convert NaN to string", () => {
      expect(serializeGroupKey(NaN)).toBe("NaN");
    });

    it("should convert Infinity to string", () => {
      expect(serializeGroupKey(Infinity)).toBe("Infinity");
    });

    it("should handle arrays with null elements", () => {
      // Arrays with null stringify to JSON
      expect(serializeGroupKey([1, null, 3])).toBe("[1,null,3]");
    });
  });
});
