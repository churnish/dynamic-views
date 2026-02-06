import {
  isTagProperty,
  isFileProperty,
  isFormulaProperty,
  shouldCollapseField,
} from "../../src/shared/property-helpers";

describe("property-helpers", () => {
  describe("isTagProperty", () => {
    it("returns true for tag properties", () => {
      expect(isTagProperty("tags")).toBe(true);
      expect(isTagProperty("note.tags")).toBe(true);
      expect(isTagProperty("file.tags")).toBe(true);
      expect(isTagProperty("file tags")).toBe(true);
    });

    it("returns false for non-tag properties", () => {
      expect(isTagProperty("title")).toBe(false);
      expect(isTagProperty("file.name")).toBe(false);
      expect(isTagProperty(undefined)).toBe(false);
    });
  });

  describe("isFileProperty", () => {
    it("returns true for file properties", () => {
      expect(isFileProperty("file.name")).toBe(true);
      expect(isFileProperty("file.path")).toBe(true);
      expect(isFileProperty("file tags")).toBe(true);
      expect(isFileProperty("FILE.NAME")).toBe(true);
    });

    it("returns false for non-file properties", () => {
      expect(isFileProperty("tags")).toBe(false);
      expect(isFileProperty("title")).toBe(false);
      expect(isFileProperty(undefined)).toBe(false);
    });
  });

  describe("isFormulaProperty", () => {
    it("returns true for formula properties", () => {
      expect(isFormulaProperty("formula.test")).toBe(true);
      expect(isFormulaProperty("formula.complex.name")).toBe(true);
    });

    it("returns false for non-formula properties", () => {
      expect(isFormulaProperty("tags")).toBe(false);
      expect(isFormulaProperty("file.name")).toBe(false);
      expect(isFormulaProperty(undefined)).toBe(false);
    });
  });

  describe("shouldCollapseField", () => {
    // Empty string tests
    it("collapses empty string with hideEmptyMode='all'", () => {
      expect(shouldCollapseField("", "title", false, "all", "inline")).toBe(
        true,
      );
    });

    it("does not collapse empty string with hideEmptyMode='show'", () => {
      expect(shouldCollapseField("", "title", false, "show", "inline")).toBe(
        false,
      );
    });

    it("collapses empty string with hideEmptyMode='labels-hidden' when labels hidden", () => {
      expect(
        shouldCollapseField("", "title", false, "labels-hidden", "hide"),
      ).toBe(true);
    });

    it("does not collapse empty string with hideEmptyMode='labels-hidden' when labels visible", () => {
      expect(
        shouldCollapseField("", "title", false, "labels-hidden", "inline"),
      ).toBe(false);
    });

    // Null note property (missing) tests
    it("collapses null note property with hideMissing=true", () => {
      expect(shouldCollapseField(null, "title", true, "show", "inline")).toBe(
        true,
      );
    });

    it("collapses null note property with hideMissing=false but hideEmptyMode='all'", () => {
      expect(shouldCollapseField(null, "title", false, "all", "inline")).toBe(
        true,
      );
    });

    it("does not collapse null note property with hideMissing=false and hideEmptyMode='show'", () => {
      expect(shouldCollapseField(null, "title", false, "show", "inline")).toBe(
        false,
      );
    });

    // Null file property tests (file props can't be "missing", only empty)
    it("collapses null file property with hideEmptyMode='all'", () => {
      expect(
        shouldCollapseField(null, "file.name", true, "all", "inline"),
      ).toBe(true);
    });

    it("does not collapse null file property with hideEmptyMode='show'", () => {
      expect(
        shouldCollapseField(null, "file.name", true, "show", "inline"),
      ).toBe(false);
    });

    // Null formula property tests
    it("collapses null formula property with hideEmptyMode='all'", () => {
      expect(
        shouldCollapseField(null, "formula.test", true, "all", "inline"),
      ).toBe(true);
    });

    it("does not collapse null formula property with hideEmptyMode='show'", () => {
      expect(
        shouldCollapseField(null, "formula.test", true, "show", "inline"),
      ).toBe(false);
    });

    // Null tag property tests
    it("collapses null tag property with hideEmptyMode='all'", () => {
      expect(shouldCollapseField(null, "tags", true, "all", "inline")).toBe(
        true,
      );
    });

    it("does not collapse null tag property with hideEmptyMode='show'", () => {
      expect(shouldCollapseField(null, "tags", true, "show", "inline")).toBe(
        false,
      );
    });

    // Non-empty value tests
    it("does not collapse non-empty values", () => {
      expect(shouldCollapseField("value", "title", true, "all", "inline")).toBe(
        false,
      );
      expect(
        shouldCollapseField("value", "file.name", true, "all", "inline"),
      ).toBe(false);
      expect(shouldCollapseField("#tag", "tags", true, "all", "inline")).toBe(
        false,
      );
    });
  });
});
