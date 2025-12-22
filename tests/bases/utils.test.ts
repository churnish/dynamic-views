import { serializeGroupKey } from "../../src/bases/utils";

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

    it("should stringify arrays in .data", () => {
      const result = serializeGroupKey({ data: [1, 2, 3] });
      expect(result).toBe("[1,2,3]");
    });

    it("should stringify nested objects in .data", () => {
      const result = serializeGroupKey({ data: { nested: "value" } });
      expect(result).toBe('{"nested":"value"}');
    });
  });

  describe("Bases date Value objects", () => {
    it("should format Date object to ISO string", () => {
      const date = new Date("2024-06-15T10:30:00Z");
      const result = serializeGroupKey({ date, time: true });
      expect(result).toBe("2024-06-15T10:30:00.000Z");
    });

    it("should format date-only Date object", () => {
      const date = new Date("2024-06-15T00:00:00Z");
      const result = serializeGroupKey({ date, time: false });
      expect(result).toBe("2024-06-15T00:00:00.000Z");
    });
  });

  describe("plain objects and arrays", () => {
    it("should stringify plain objects", () => {
      expect(serializeGroupKey({ key: "value" })).toBe('{"key":"value"}');
    });

    it("should stringify arrays", () => {
      expect(serializeGroupKey([1, 2, 3])).toBe("[1,2,3]");
      expect(serializeGroupKey(["a", "b"])).toBe('["a","b"]');
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
  });
});
