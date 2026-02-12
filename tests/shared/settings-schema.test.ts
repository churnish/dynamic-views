import {
  readBasesSettings,
  extractBasesTemplate,
} from "../../src/shared/settings-schema";

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

const MOCK_VIEW_DEFAULTS: any = {
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
};

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

describe("readBasesSettings — templateOverrides", () => {
  it("should use templateOverrides when config has no value", () => {
    const config = createMockConfig({}, []);
    const result = readBasesSettings(
      config,
      MOCK_PLUGIN_SETTINGS,
      "grid",
      undefined,
      { cardSize: 500 },
    );
    expect(result.cardSize).toBe(500);
  });

  it("should prefer config values over templateOverrides", () => {
    const config = createMockConfig({ cardSize: 600 }, []);
    const result = readBasesSettings(
      config,
      MOCK_PLUGIN_SETTINGS,
      "grid",
      undefined,
      { cardSize: 500 },
    );
    expect(result.cardSize).toBe(600);
  });

  it("should apply templateOverrides to enum fallbacks", () => {
    const config = createMockConfig({}, []);
    const result = readBasesSettings(
      config,
      MOCK_PLUGIN_SETTINGS,
      "grid",
      undefined,
      { propertyLabels: "above" },
    );
    expect(result.propertyLabels).toBe("above");
  });
});

describe("extractBasesTemplate", () => {
  // VIEW_DEFAULTS from mock: cardSize=300, formatFirstAsTitle=false, propertyLabels="hide"
  // BASES_DEFAULTS from mock: formatFirstAsTitle=true, propertyLabels="inline"
  // mergedDefaults: cardSize=300, formatFirstAsTitle=true, propertyLabels="inline"

  it("should return only non-default values (sparse)", () => {
    const config = createMockConfig({ cardSize: 400 }, []);
    const result = extractBasesTemplate(config, MOCK_VIEW_DEFAULTS);
    expect(result).toEqual({ cardSize: 400 });
  });

  it("should detect BASES_DEFAULTS differences from VIEW_DEFAULTS", () => {
    // formatFirstAsTitle: false in config — differs from mergedDefaults (true from BASES_DEFAULTS)
    const config = createMockConfig({ formatFirstAsTitle: false }, []);
    const result = extractBasesTemplate(config, MOCK_VIEW_DEFAULTS);
    expect(result.formatFirstAsTitle).toBe(false);
  });

  it("should return empty object when all values match defaults", () => {
    const config = createMockConfig({}, []);
    const result = extractBasesTemplate(config, MOCK_VIEW_DEFAULTS);
    expect(result).toEqual({});
  });

  it("should coerce minimumColumns string to number", () => {
    const config = createMockConfig({ minimumColumns: "two" }, []);
    const result = extractBasesTemplate(config, MOCK_VIEW_DEFAULTS);
    expect(result.minimumColumns).toBe(2);
  });
});
