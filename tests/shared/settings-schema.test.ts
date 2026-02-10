import { readBasesSettings } from "../../src/shared/settings-schema";

// Mock constants (same pattern as cleanup.test.ts)
jest.mock("../../src/constants", () => ({
  VIEW_DEFAULTS: {
    cardSize: 300,
    titleProperty: "file.name",
    titleLines: 2,
    subtitleProperty: "file.folder",
    formatFirstAsTitle: false,
    formatSecondAsSubtitle: false,
    textPreviewProperty: "",
    fallbackToContent: true,
    textPreviewLines: 5,
    imageProperty: "",
    fallbackToEmbeds: "always",
    imageFormat: "thumbnail",
    thumbnailSize: 80,
    imagePosition: "right",
    imageFit: "crop",
    imageRatio: 1.0,
    propertyLabels: "hide",
    pairProperties: false,
    rightPropertyPosition: "right",
    invertPropertyPairing: "",
    showPropertiesAbove: false,
    invertPropertyPosition: "",
    urlProperty: "url",
    minimumColumns: 1,
    cssclasses: "",
  },
  BASES_DEFAULTS: {
    formatFirstAsTitle: true,
    formatSecondAsSubtitle: false,
    propertyLabels: "inline",
  },
}));

/** Minimal mock implementing the BasesConfig interface */
function createMockConfig(values: Record<string, unknown>, order: string[]) {
  return {
    get: (key: string) => values[key],
    getOrder: () => order,
  };
}

const MOCK_PLUGIN_SETTINGS: any = {
  omitFirstLine: "ifMatchesTitle",
  randomizeAction: "shuffle",
  openFileAction: "card",
  openRandomInNewTab: true,
  smartTimestamp: true,
  createdTimeProperty: "created time",
  modifiedTimeProperty: "modified time",
  preventSidebarSwipe: "disabled",
  revealInNotebookNavigator: "disable",
  showYoutubeThumbnails: true,
  showCardLinkCovers: true,
};

describe("readBasesSettings — position-based title/subtitle", () => {
  it("should derive titleProperty from order[0] when formatFirstAsTitle is true", () => {
    const config = createMockConfig({ formatFirstAsTitle: true }, [
      "note.director",
      "note.year",
    ]);
    const result = readBasesSettings(config, MOCK_PLUGIN_SETTINGS);
    expect(result.titleProperty).toBe("note.director");
    expect(result.subtitleProperty).toBe("");
    expect(result._skipLeadingProperties).toBe(1);
  });

  it("should derive both title and subtitle when both toggles are true", () => {
    const config = createMockConfig(
      { formatFirstAsTitle: true, formatSecondAsSubtitle: true },
      ["note.director", "note.year", "note.genre"],
    );
    const result = readBasesSettings(config, MOCK_PLUGIN_SETTINGS);
    expect(result.titleProperty).toBe("note.director");
    expect(result.subtitleProperty).toBe("note.year");
    expect(result._skipLeadingProperties).toBe(2);
  });

  it("should not derive subtitle when order has only one item", () => {
    const config = createMockConfig(
      { formatFirstAsTitle: true, formatSecondAsSubtitle: true },
      ["note.director"],
    );
    const result = readBasesSettings(config, MOCK_PLUGIN_SETTINGS);
    expect(result.titleProperty).toBe("note.director");
    expect(result.subtitleProperty).toBe("");
    expect(result._skipLeadingProperties).toBe(1);
  });

  it("should not derive title or subtitle when formatFirstAsTitle is false", () => {
    const config = createMockConfig({ formatFirstAsTitle: false }, [
      "note.director",
      "note.year",
    ]);
    const result = readBasesSettings(config, MOCK_PLUGIN_SETTINGS);
    expect(result.titleProperty).toBe("");
    expect(result.subtitleProperty).toBe("");
    expect(result._skipLeadingProperties).toBe(0);
  });

  it("should not derive title when order is empty", () => {
    const config = createMockConfig({ formatFirstAsTitle: true }, []);
    const result = readBasesSettings(config, MOCK_PLUGIN_SETTINGS);
    expect(result.titleProperty).toBe("");
    expect(result._skipLeadingProperties).toBe(0);
  });

  it("should use BASES_DEFAULTS (formatFirstAsTitle: true) when config has no override", () => {
    const config = createMockConfig(
      {}, // no formatFirstAsTitle override — falls back to BASES_DEFAULTS.formatFirstAsTitle (true)
      ["note.title", "note.author"],
    );
    const result = readBasesSettings(config, MOCK_PLUGIN_SETTINGS);
    expect(result.titleProperty).toBe("note.title");
    expect(result._skipLeadingProperties).toBe(1);
  });
});
