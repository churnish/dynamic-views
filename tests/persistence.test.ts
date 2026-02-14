import { PersistenceManager } from "../src/persistence";
import { Plugin } from "obsidian";

// Mock dependencies
jest.mock("../src/utils/sanitize", () => ({
  sanitizeObject: jest.fn((obj) => obj),
  sanitizeString: jest.fn((str) => str),
}));

jest.mock("../src/constants", () => ({
  PLUGIN_SETTINGS: {
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
  },
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
    displayFirstAsTitle: false,
    displaySecondAsSubtitle: false,
  },
  DATACORE_DEFAULTS: {
    listMarker: "bullet",
    queryHeight: 0,
    pairProperties: true,
  },
  BASES_DEFAULTS: {
    displayFirstAsTitle: true,
    displaySecondAsSubtitle: false,
    propertyLabels: "inline",
  },
  DEFAULT_BASES_STATE: {
    collapsedGroups: [],
  },
  DEFAULT_DATACORE_STATE: {
    sortMethod: "mtime-desc",
    viewMode: "grid",
    searchQuery: "",
    resultLimit: "",
    widthMode: "normal",
    settings: undefined,
  },
}));

describe("PersistenceManager", () => {
  let mockPlugin: Plugin;
  let manager: PersistenceManager;

  beforeEach(() => {
    mockPlugin = {
      loadData: jest.fn().mockResolvedValue(null),
      saveData: jest.fn().mockResolvedValue(undefined),
    } as any;

    manager = new PersistenceManager(mockPlugin);
  });

  describe("constructor", () => {
    it("should initialize with empty data", () => {
      const settings = manager.getPluginSettings();
      expect(settings).toBeDefined();
      // Returns defaults merged with empty stored data
      expect(settings.omitFirstLine).toBe("ifMatchesTitle");
    });
  });

  describe("load", () => {
    it("should load data from plugin", async () => {
      const mockData = {
        pluginSettings: { smartTimestamp: false },
        templates: {},
        basesStates: {},
        datacoreStates: {},
      };

      mockPlugin.loadData = jest.fn().mockResolvedValue(mockData);
      await manager.load();

      const settings = manager.getPluginSettings();
      expect(settings.smartTimestamp).toBe(false);
    });

    it("should handle null loaded data", async () => {
      mockPlugin.loadData = jest.fn().mockResolvedValue(null);
      await manager.load();

      const settings = manager.getPluginSettings();
      expect(settings).toBeDefined();
    });

    it("should handle partial loaded data", async () => {
      const mockData = {
        pluginSettings: { randomizeAction: "random" },
      };

      mockPlugin.loadData = jest.fn().mockResolvedValue(mockData);
      await manager.load();

      const settings = manager.getPluginSettings();
      expect(settings.randomizeAction).toBe("random");
      // Default value preserved
      expect(settings.smartTimestamp).toBe(true);
    });
  });

  describe("save", () => {
    it("should save sparse data to plugin", async () => {
      await manager.setPluginSettings({ smartTimestamp: false });

      expect(mockPlugin.saveData).toHaveBeenCalled();
      // Saves only non-default values
      const savedData = (mockPlugin.saveData as jest.Mock).mock.calls[0][0];
      expect(savedData.pluginSettings).toEqual({ smartTimestamp: false });
    });
  });

  describe("getPluginSettings", () => {
    it("should return merged defaults with stored settings", () => {
      const settings = manager.getPluginSettings();
      expect(settings.omitFirstLine).toBe("ifMatchesTitle");
      expect(settings.randomizeAction).toBe("shuffle");
    });
  });

  describe("setPluginSettings", () => {
    it("should update plugin settings", async () => {
      await manager.setPluginSettings({ smartTimestamp: false });

      const settings = manager.getPluginSettings();
      expect(settings.smartTimestamp).toBe(false);
    });

    it("should only store non-default values", async () => {
      // Set a default value - should not be stored
      await manager.setPluginSettings({ smartTimestamp: true });

      const savedData = (mockPlugin.saveData as jest.Mock).mock.calls[0][0];
      // smartTimestamp: true is the default, so shouldn't be in sparse storage
      expect(savedData.pluginSettings?.smartTimestamp).toBeUndefined();
    });

    it("should save after updating", async () => {
      await manager.setPluginSettings({ randomizeAction: "random" });

      expect(mockPlugin.saveData).toHaveBeenCalled();
    });

    it("should sanitize settings", async () => {
      const { sanitizeObject } = require("../src/utils/sanitize");

      await manager.setPluginSettings({ randomizeAction: "test" as any });

      expect(sanitizeObject).toHaveBeenCalled();
    });
  });

  describe("getBasesState", () => {
    it("should return default state when no viewId", () => {
      const state = manager.getBasesState();
      expect(state).toEqual({ collapsedGroups: [] });
    });

    it("should return default state for unknown viewId", () => {
      const state = manager.getBasesState("unknown-view");
      expect(state).toEqual({ collapsedGroups: [] });
    });

    it("should return stored state for known viewId", async () => {
      await manager.setBasesState("view-1", {
        collapsedGroups: ["group1", "group2"],
      });

      const state = manager.getBasesState("view-1");
      expect(state.collapsedGroups).toEqual(["group1", "group2"]);
    });
  });

  describe("setBasesState", () => {
    it("should store collapsed groups", async () => {
      await manager.setBasesState("view-1", {
        collapsedGroups: ["group1"],
      });

      const state = manager.getBasesState("view-1");
      expect(state.collapsedGroups).toEqual(["group1"]);
    });

    it("should delete entry when collapsedGroups empty", async () => {
      await manager.setBasesState("view-1", {
        collapsedGroups: ["group1"],
      });
      await manager.setBasesState("view-1", { collapsedGroups: [] });

      // After clearing, should return default
      const state = manager.getBasesState("view-1");
      expect(state).toEqual({ collapsedGroups: [] });
    });

    it("should not store when no viewId", async () => {
      await manager.setBasesState(undefined, { collapsedGroups: ["group1"] });

      // Should not have saved
      expect(mockPlugin.saveData).not.toHaveBeenCalled();
    });

    it("should sanitize collapsedGroups", async () => {
      const { sanitizeString } = require("../src/utils/sanitize");

      await manager.setBasesState("view-1", {
        collapsedGroups: ["group1", "group2"],
      });

      expect(sanitizeString).toHaveBeenCalled();
    });
  });

  describe("migrateBasesState", () => {
    it("should move state from old to new ID", async () => {
      await manager.setBasesState("abc123-Old Name", {
        collapsedGroups: ["group1"],
      });

      await manager.migrateBasesState("abc123-Old Name", "abc123-New Name");

      const oldState = manager.getBasesState("abc123-Old Name");
      const newState = manager.getBasesState("abc123-New Name");

      expect(oldState).toEqual({ collapsedGroups: [] }); // Cleared
      expect(newState.collapsedGroups).toEqual(["group1"]);
    });

    it("should do nothing if old state doesn't exist", async () => {
      await manager.migrateBasesState("abc123-Nonexistent", "abc123-New Name");

      const state = manager.getBasesState("abc123-New Name");
      expect(state).toEqual({ collapsedGroups: [] });
    });
  });

  describe("getDatacoreState", () => {
    it("should return default state when no queryId", () => {
      const state = manager.getDatacoreState();
      expect(state.sortMethod).toBe("mtime-desc");
      expect(state.viewMode).toBe("grid");
    });

    it("should return default state for unknown queryId", () => {
      const state = manager.getDatacoreState("unknown-query");
      expect(state).toEqual({
        sortMethod: "mtime-desc",
        viewMode: "grid",
        searchQuery: "",
        resultLimit: "",
        widthMode: "normal",
        settings: undefined,
      });
    });

    it("should merge stored state with defaults", async () => {
      await manager.setDatacoreState("query-1", {
        sortMethod: "alphabetical" as any,
      });

      const state = manager.getDatacoreState("query-1");
      expect(state.sortMethod).toBe("alphabetical");
      expect(state.viewMode).toBe("grid"); // Default preserved
    });
  });

  describe("setDatacoreState", () => {
    it("should store non-default values", async () => {
      await manager.setDatacoreState("query-1", {
        searchQuery: "test query",
      });

      const state = manager.getDatacoreState("query-1");
      expect(state.searchQuery).toBe("test query");
    });

    it("should truncate searchQuery to 500 chars", async () => {
      const longQuery = "a".repeat(600);
      await manager.setDatacoreState("query-1", { searchQuery: longQuery });

      const state = manager.getDatacoreState("query-1");
      expect(state.searchQuery.length).toBe(500);
    });

    it("should delete entry when all values are defaults", async () => {
      await manager.setDatacoreState("query-1", {
        searchQuery: "test",
      });
      // Reset to default
      await manager.setDatacoreState("query-1", {
        searchQuery: "",
      });

      // After clearing to defaults, state should be default
      const state = manager.getDatacoreState("query-1");
      expect(state.searchQuery).toBe("");
    });

    it("should not store when no queryId", async () => {
      await manager.setDatacoreState(undefined, { searchQuery: "test" });

      expect(mockPlugin.saveData).not.toHaveBeenCalled();
    });

    it("should sanitize string values", async () => {
      const { sanitizeString } = require("../src/utils/sanitize");

      await manager.setDatacoreState("query-1", { searchQuery: "test" });

      expect(sanitizeString).toHaveBeenCalled();
    });

    it("should sanitize settings object", async () => {
      const { sanitizeObject } = require("../src/utils/sanitize");

      await manager.setDatacoreState("query-1", {
        settings: { cardSize: 300 } as any,
      });

      expect(sanitizeObject).toHaveBeenCalled();
    });
  });

  describe("getSettingsTemplate", () => {
    it("should return undefined for non-existent template", () => {
      const template = manager.getSettingsTemplate("grid");
      expect(template).toBeUndefined();
    });

    it("should return stored template", async () => {
      await manager.setSettingsTemplate("grid", { cardSize: 300 });

      const template = manager.getSettingsTemplate("grid");
      expect(template?.cardSize).toBe(300);
    });
  });

  describe("setSettingsTemplate", () => {
    it("should store template", async () => {
      await manager.setSettingsTemplate("masonry", { cardSize: 250 });

      const template = manager.getSettingsTemplate("masonry");
      expect(template?.cardSize).toBe(250);
    });

    it("should delete template when null", async () => {
      await manager.setSettingsTemplate("grid", { cardSize: 300 });
      await manager.setSettingsTemplate("grid", null);

      const template = manager.getSettingsTemplate("grid");
      expect(template).toBeUndefined();
    });

    it("should save after updating", async () => {
      await manager.setSettingsTemplate("datacore", { cardSize: 300 });

      expect(mockPlugin.saveData).toHaveBeenCalled();
    });
  });

  describe("queryId-based isolation", () => {
    it("should keep separate states for different queryIds", async () => {
      await manager.setDatacoreState("query-1", { searchQuery: "alpha" });
      await manager.setDatacoreState("query-2", { searchQuery: "beta" });

      const state1 = manager.getDatacoreState("query-1");
      const state2 = manager.getDatacoreState("query-2");

      expect(state1.searchQuery).toBe("alpha");
      expect(state2.searchQuery).toBe("beta");
    });
  });

  describe("viewId-based isolation", () => {
    it("should keep separate states for different viewIds", async () => {
      await manager.setBasesState("view-1", { collapsedGroups: ["g1"] });
      await manager.setBasesState("view-2", { collapsedGroups: ["g2", "g3"] });

      const state1 = manager.getBasesState("view-1");
      const state2 = manager.getBasesState("view-2");

      expect(state1.collapsedGroups).toEqual(["g1"]);
      expect(state2.collapsedGroups).toEqual(["g2", "g3"]);
    });
  });

  describe("cleanupTemplateSettings (via load)", () => {
    it("should remove stale keys not in ViewDefaults or DatacoreDefaults", async () => {
      mockPlugin.loadData = jest.fn().mockResolvedValue({
        templates: { grid: { cardSize: 400, deletedSetting: "stale" } },
      });
      await manager.load();

      const template = manager.getSettingsTemplate("grid");
      expect(template).not.toHaveProperty("deletedSetting");
      expect(template?.cardSize).toBe(400);
      expect(mockPlugin.saveData).toHaveBeenCalled();
    });

    it("should delete values with wrong type (string instead of number)", async () => {
      mockPlugin.loadData = jest.fn().mockResolvedValue({
        templates: { grid: { thumbnailSize: "compact", cardSize: 400 } },
      });
      await manager.load();

      const template = manager.getSettingsTemplate("grid");
      expect(template).not.toHaveProperty("thumbnailSize");
      expect(template?.cardSize).toBe(400);
    });

    it("should delete values with wrong type (number instead of string)", async () => {
      mockPlugin.loadData = jest.fn().mockResolvedValue({
        templates: { grid: { imageProperty: 123, cardSize: 400 } },
      });
      await manager.load();

      const template = manager.getSettingsTemplate("grid");
      expect(template).not.toHaveProperty("imageProperty");
      expect(template?.cardSize).toBe(400);
    });

    it("should delete values with wrong type (string instead of boolean)", async () => {
      mockPlugin.loadData = jest.fn().mockResolvedValue({
        templates: { masonry: { fallbackToContent: "yes", cardSize: 400 } },
      });
      await manager.load();

      const template = manager.getSettingsTemplate("masonry");
      expect(template).not.toHaveProperty("fallbackToContent");
      expect(template?.cardSize).toBe(400);
    });

    it("should delete null values (typeof null !== any expected type)", async () => {
      mockPlugin.loadData = jest.fn().mockResolvedValue({
        templates: { grid: { cardSize: null, imageProperty: null } },
      });
      await manager.load();

      // Template removed entirely since all settings cleaned
      const template = manager.getSettingsTemplate("grid");
      expect(template).toBeUndefined();
    });

    it("should reset invalid enum values to first valid value", async () => {
      // imagePosition: first valid is "left", VIEW_DEFAULTS is "right" — reset is observable
      mockPlugin.loadData = jest.fn().mockResolvedValue({
        templates: { grid: { imagePosition: "invalid-pos" } },
      });
      await manager.load();

      const template = manager.getSettingsTemplate("grid");
      expect(template?.imagePosition).toBe("left");
    });

    it("should keep valid enum values", async () => {
      mockPlugin.loadData = jest.fn().mockResolvedValue({
        templates: { grid: { imageFormat: "cover" } },
      });
      await manager.load();

      const template = manager.getSettingsTemplate("grid");
      expect(template?.imageFormat).toBe("cover");
    });

    it("should skip minimumColumns for type and enum checks", async () => {
      // minimumColumns stores numbers in templates, but VIEW_DEFAULTS type is number
      // and VALID_VIEW_VALUES has strings ["one", "two"] — skip both checks
      mockPlugin.loadData = jest.fn().mockResolvedValue({
        templates: { masonry: { minimumColumns: 2 } },
      });
      await manager.load();

      const template = manager.getSettingsTemplate("masonry");
      // minimumColumns=2 is the masonry default, so it gets removed by sparse cleanup
      expect(template).toBeUndefined();
    });

    it("should preserve non-default minimumColumns in grid templates", async () => {
      mockPlugin.loadData = jest.fn().mockResolvedValue({
        templates: { grid: { minimumColumns: 2 } },
      });
      await manager.load();

      const template = manager.getSettingsTemplate("grid");
      // Grid default is 1, so 2 is non-default and preserved
      expect(template?.minimumColumns).toBe(2);
    });

    it("should remove keys matching VIEW_DEFAULTS (sparse cleanup)", async () => {
      // cardSize=300 matches VIEW_DEFAULTS, imageFormat="cover" doesn't
      mockPlugin.loadData = jest.fn().mockResolvedValue({
        templates: { grid: { cardSize: 300, imageFormat: "cover" } },
      });
      await manager.load();

      const template = manager.getSettingsTemplate("grid");
      expect(template).not.toHaveProperty("cardSize");
      expect(template?.imageFormat).toBe("cover");
    });

    it("should remove template entirely when all settings cleaned", async () => {
      mockPlugin.loadData = jest.fn().mockResolvedValue({
        templates: { grid: { deletedKey: "stale" } },
      });
      await manager.load();

      const template = manager.getSettingsTemplate("grid");
      expect(template).toBeUndefined();
    });

    it("should allow DatacoreDefaults keys in datacore templates", async () => {
      mockPlugin.loadData = jest.fn().mockResolvedValue({
        templates: { datacore: { listMarker: "checkbox" } },
      });
      await manager.load();

      const template = manager.getSettingsTemplate("datacore");
      expect(template?.listMarker).toBe("checkbox");
    });

    it("should type-check DatacoreDefaults values in datacore templates", async () => {
      mockPlugin.loadData = jest.fn().mockResolvedValue({
        templates: {
          datacore: {
            queryHeight: "tall", // string instead of number
            pairProperties: "yes", // string instead of boolean
            listMarker: "checkbox", // correct type (string)
            cardSize: 400,
          },
        },
      });
      await manager.load();

      const template = manager.getSettingsTemplate("datacore");
      expect(template).not.toHaveProperty("queryHeight");
      expect(template).not.toHaveProperty("pairProperties");
      expect(template?.listMarker).toBe("checkbox");
      expect(template?.cardSize).toBe(400);
    });

    it("should reject DatacoreDefaults keys in grid templates", async () => {
      mockPlugin.loadData = jest.fn().mockResolvedValue({
        templates: { grid: { listMarker: "checkbox", cardSize: 400 } },
      });
      await manager.load();

      const template = manager.getSettingsTemplate("grid");
      expect(template).not.toHaveProperty("listMarker");
      expect(template?.cardSize).toBe(400);
    });

    it("should skip sparse cleanup for BASES_DEFAULTS keys in grid/masonry", async () => {
      // displayFirstAsTitle in BASES_DEFAULTS defaults to true, VIEW_DEFAULTS to false.
      // For Bases (grid/masonry), false matching VIEW_DEFAULTS should NOT be removed
      // because BASES_DEFAULTS overrides it.
      mockPlugin.loadData = jest.fn().mockResolvedValue({
        templates: { grid: { displayFirstAsTitle: false } },
      });
      await manager.load();

      const template = manager.getSettingsTemplate("grid");
      // false matches VIEW_DEFAULTS but displayFirstAsTitle is in BASES_DEFAULTS,
      // so sparse cleanup skips it — value preserved
      expect(template?.displayFirstAsTitle).toBe(false);
    });

    it("should not skip sparse cleanup for BASES_DEFAULTS keys in datacore", async () => {
      mockPlugin.loadData = jest.fn().mockResolvedValue({
        templates: { datacore: { displayFirstAsTitle: false } },
      });
      await manager.load();

      const template = manager.getSettingsTemplate("datacore");
      // Datacore is not Bases, so displayFirstAsTitle=false matches VIEW_DEFAULTS
      // and gets cleaned as sparse default
      expect(template).toBeUndefined();
    });

    it("should not trigger save when no cleanup needed", async () => {
      mockPlugin.loadData = jest.fn().mockResolvedValue({
        templates: { grid: { cardSize: 400 } },
      });
      await manager.load();

      // No save call from cleanup — only loadData was called
      expect(mockPlugin.saveData).not.toHaveBeenCalled();
    });

    it("should handle empty templates", async () => {
      mockPlugin.loadData = jest.fn().mockResolvedValue({
        templates: { grid: {} },
      });
      await manager.load();

      // Empty template is harmless (no overrides) — no cleanup triggered
      expect(mockPlugin.saveData).not.toHaveBeenCalled();
    });
  });
});
