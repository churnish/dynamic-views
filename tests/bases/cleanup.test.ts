import { App, TFile } from "obsidian";
import { cleanUpBaseFile } from "../../src/bases/utils";

// Mock all constants used by utils.ts (imported transitively via view-validation)
jest.mock("../../src/constants", () => ({
  VIEW_DEFAULTS: {
    cardSize: 300,
    titleProperty: "file.name",
    titleLines: 2,
    subtitleProperty: "file.folder",
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
    formatFirstAsTitle: false,
    formatSecondAsSubtitle: false,
  },
  DATACORE_DEFAULTS: {
    listMarker: "bullet",
    queryHeight: 0,
    pairProperties: true,
  },
  BASES_DEFAULTS: {
    formatFirstAsTitle: true,
    formatSecondAsSubtitle: false,
    propertyLabels: "inline",
  },
}));

function createMockFile(path: string): TFile {
  const file = new TFile();
  file.path = path;
  file.name = path.split("/").pop() ?? path;
  file.basename = file.name.replace(/\.base$/, "");
  file.extension = "base";
  file.stat = { ctime: 0, mtime: 0, size: 0 };
  return file;
}

function createMockPlugin() {
  return {
    persistenceManager: {
      migrateBasesState: jest.fn().mockResolvedValue(undefined),
      getSettingsTemplate: jest.fn().mockReturnValue(undefined),
    },
  } as any;
}

/**
 * Set up vault.process to capture the callback transformation.
 * Returns a function that retrieves the transformed data after cleanUpBaseFile runs.
 */
function setupVaultProcess(app: App, data: unknown): () => unknown {
  const content = JSON.stringify(data);
  let transformedContent: string = content;

  app.vault.process = jest.fn(
    async (_file: TFile, fn: (c: string) => string) => {
      transformedContent = fn(content);
      return transformedContent;
    },
  );

  return () => {
    try {
      return JSON.parse(transformedContent);
    } catch {
      return transformedContent;
    }
  };
}

describe("cleanUpBaseFile", () => {
  let app: App;
  let plugin: ReturnType<typeof createMockPlugin>;

  beforeEach(() => {
    app = new App();
    plugin = createMockPlugin();
  });

  it("should return null for non-.base files", async () => {
    const file = createMockFile("test.md");
    const result = await cleanUpBaseFile(app, file, plugin);
    expect(result).toBeNull();
  });

  it("should return null for null file", async () => {
    const result = await cleanUpBaseFile(app, null, plugin);
    expect(result).toBeNull();
  });

  it("should return empty map when no views exist", async () => {
    const file = createMockFile("test.base");
    setupVaultProcess(app, { views: [] });

    const result = await cleanUpBaseFile(app, file, plugin);
    expect(result).toEqual(new Map());
  });

  it("should skip non-dynamic-views view types", async () => {
    const file = createMockFile("test.base");
    setupVaultProcess(app, {
      views: [{ type: "table", name: "Table View" }],
    });

    const result = await cleanUpBaseFile(app, file, plugin);
    expect(result).toEqual(new Map());
  });

  it("should remove stale keys not in ALLOWED_VIEW_KEYS", async () => {
    const file = createMockFile("test.base");
    const getResult = setupVaultProcess(app, {
      views: [
        {
          type: "dynamic-views-grid",
          name: "My View",
          id: "abc123-My View",
          cardSize: 400,
          deletedSetting: "stale",
          listMarker: "bullet", // DatacoreDefaults key — not allowed in Bases
        },
      ],
    });

    await cleanUpBaseFile(app, file, plugin);

    const result = getResult() as { views: Record<string, unknown>[] };
    expect(result.views[0]).not.toHaveProperty("deletedSetting");
    expect(result.views[0]).not.toHaveProperty("listMarker");
    expect(result.views[0].cardSize).toBe(400);
  });

  it("should delete stale titleProperty/subtitleProperty keys", async () => {
    const file = createMockFile("test.base");
    const getResult = setupVaultProcess(app, {
      views: [
        {
          type: "dynamic-views-grid",
          name: "My View",
          id: "abc123-My View",
          cardSize: 400,
          titleProperty: "file.name",
          subtitleProperty: "note.author",
        },
      ],
    });

    await cleanUpBaseFile(app, file, plugin);

    const result = getResult() as { views: Record<string, unknown>[] };
    expect(result.views[0]).not.toHaveProperty("titleProperty");
    expect(result.views[0]).not.toHaveProperty("subtitleProperty");
    expect(result.views[0].cardSize).toBe(400);
  });

  it("should delete values with wrong type", async () => {
    const file = createMockFile("test.base");
    const getResult = setupVaultProcess(app, {
      views: [
        {
          type: "dynamic-views-grid",
          name: "Test",
          id: "abc-Test",
          thumbnailSize: "compact", // string instead of number
          cardSize: 400,
        },
      ],
    });

    await cleanUpBaseFile(app, file, plugin);

    const result = getResult() as { views: Record<string, unknown>[] };
    expect(result.views[0]).not.toHaveProperty("thumbnailSize");
    expect(result.views[0].cardSize).toBe(400);
  });

  it("should reset invalid enum values to first valid value", async () => {
    const file = createMockFile("test.base");
    const getResult = setupVaultProcess(app, {
      views: [
        {
          type: "dynamic-views-grid",
          name: "Test",
          id: "abc-Test",
          imagePosition: "invalid-pos",
        },
      ],
    });

    await cleanUpBaseFile(app, file, plugin);

    const result = getResult() as { views: Record<string, unknown>[] };
    // First valid value for imagePosition is "left"
    expect(result.views[0].imagePosition).toBe("left");
  });

  it("should remove keys matching VIEW_DEFAULTS (sparse cleanup)", async () => {
    const file = createMockFile("test.base");
    const getResult = setupVaultProcess(app, {
      views: [
        {
          type: "dynamic-views-grid",
          name: "Test",
          id: "abc-Test",
          cardSize: 300, // matches VIEW_DEFAULTS
          imageFormat: "cover", // doesn't match
        },
      ],
    });

    await cleanUpBaseFile(app, file, plugin);

    const result = getResult() as { views: Record<string, unknown>[] };
    expect(result.views[0]).not.toHaveProperty("cardSize");
    expect(result.views[0].imageFormat).toBe("cover");
  });

  it("should skip sparse cleanup for BASES_DEFAULTS keys", async () => {
    const file = createMockFile("test.base");
    const getResult = setupVaultProcess(app, {
      views: [
        {
          type: "dynamic-views-grid",
          name: "Test",
          id: "abc-Test",
          // VIEW_DEFAULTS.formatFirstAsTitle = false, but BASES_DEFAULTS overrides to true
          // so this value should NOT be removed by sparse cleanup
          formatFirstAsTitle: false,
        },
      ],
    });

    await cleanUpBaseFile(app, file, plugin);

    const result = getResult() as { views: Record<string, unknown>[] };
    expect(result.views[0].formatFirstAsTitle).toBe(false);
  });

  it("should preserve minimumColumns (YAML strings not type-checked)", async () => {
    const file = createMockFile("test.base");
    const getResult = setupVaultProcess(app, {
      views: [
        {
          type: "dynamic-views-grid",
          name: "Test",
          id: "abc-Test",
          minimumColumns: "two",
        },
      ],
    });

    await cleanUpBaseFile(app, file, plugin);

    const result = getResult() as { views: Record<string, unknown>[] };
    // minimumColumns skipped for type check, "two" is valid enum, and
    // YAML "two" !== VIEW_DEFAULTS number 1, so preserved by sparse cleanup
    expect(result.views[0].minimumColumns).toBe("two");
  });

  it("should generate view IDs for named views without IDs", async () => {
    const file = createMockFile("test.base");
    const getResult = setupVaultProcess(app, {
      views: [
        {
          type: "dynamic-views-grid",
          name: "New View",
        },
      ],
    });

    const viewIds = await cleanUpBaseFile(app, file, plugin);

    expect(viewIds?.get("New View")).toBeDefined();
    const result = getResult() as { views: Record<string, unknown>[] };
    expect(result.views[0].id).toMatch(/-New View$/);
  });

  it("should migrate basesState when view is renamed", async () => {
    const file = createMockFile("test.base");
    setupVaultProcess(app, {
      views: [
        {
          type: "dynamic-views-grid",
          name: "Renamed View",
          id: "abc123-Old Name", // name in ID doesn't match current name
        },
      ],
    });

    await cleanUpBaseFile(app, file, plugin);

    expect(plugin.persistenceManager.migrateBasesState).toHaveBeenCalledWith(
      "abc123-Old Name",
      expect.stringContaining("-Renamed View"),
    );
  });

  it("should not migrate when view ID is duplicated", async () => {
    const file = createMockFile("test.base");
    setupVaultProcess(app, {
      views: [
        {
          type: "dynamic-views-grid",
          name: "View A",
          id: "abc123-Original",
        },
        {
          type: "dynamic-views-grid",
          name: "View B",
          id: "abc123-Original", // duplicate ID — indicates copy, not rename
        },
      ],
    });

    await cleanUpBaseFile(app, file, plugin);

    // No migration for duplicated IDs (it's a copy, not a rename)
    expect(plugin.persistenceManager.migrateBasesState).not.toHaveBeenCalled();
  });

  it("should handle invalid YAML gracefully", async () => {
    const file = createMockFile("test.base");
    app.vault.process = jest.fn(
      async (_file: TFile, fn: (c: string) => string) => {
        return fn("not-valid-json");
      },
    );

    const result = await cleanUpBaseFile(app, file, plugin);
    // parseYaml (mocked as JSON.parse) throws, callback returns original content
    expect(result).toEqual(new Map());
  });

  it("should handle content without views array", async () => {
    const file = createMockFile("test.base");
    setupVaultProcess(app, { otherKey: "value" });

    const result = await cleanUpBaseFile(app, file, plugin);
    expect(result).toEqual(new Map());
  });

  it("should return content unchanged when no cleanup needed", async () => {
    const file = createMockFile("test.base");
    const originalData = {
      views: [
        {
          type: "dynamic-views-grid",
          name: "Test",
          id: "abc-Test",
          imageFormat: "cover",
        },
      ],
    };
    const getResult = setupVaultProcess(app, originalData);

    await cleanUpBaseFile(app, file, plugin);

    // When changeCount is 0, callback returns original content string (not stringifyYaml)
    const result = getResult();
    expect(typeof result).toBe("object");
    expect((result as any).views[0].imageFormat).toBe("cover");
  });
});
