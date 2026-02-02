import type {
  PluginSettings,
  ViewDefaults,
  DatacoreDefaults,
  ResolvedSettings,
} from "./types";

export const PLUGIN_SETTINGS: PluginSettings = {
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

export const VIEW_DEFAULTS: ViewDefaults = {
  // Card size
  cardSize: 400,
  // Header
  titleProperty: "file.name",
  subtitleProperty: "file.folder",
  // Text preview
  textPreviewProperty: "",
  fallbackToContent: true,
  textPreviewLines: 5,
  // Image
  imageProperty: "",
  fallbackToEmbeds: "always",
  imageFormat: "thumbnail",
  thumbnailSize: "standard",
  imagePosition: "right",
  imageFit: "crop",
  imageAspectRatio: 1.0,
  // Properties
  propertyLabels: "hide",
  pairProperties: true,
  pairedPropertyLayout: "snap-to-edges",
  invertPairingForProperty: "",
  showPropertiesAbove: false,
  invertPositionForProperty: "",
  urlProperty: "url",
  // Other
  minimumColumns: 1,
  ambientBackground: "disable",
  cssclasses: "",
};

export const DATACORE_DEFAULTS: DatacoreDefaults = {
  listMarker: "bullet",
  queryHeight: 0,
  propertyDisplay1: "file.tags",
  propertyDisplay2: "file.mtime",
  propertyDisplay3: "",
  propertyDisplay4: "",
  propertyDisplay5: "",
  propertyDisplay6: "",
  propertyDisplay7: "",
  propertyDisplay8: "",
  propertyDisplay9: "",
  propertyDisplay10: "",
  propertyDisplay11: "",
  propertyDisplay12: "",
  propertyDisplay13: "",
  propertyDisplay14: "",
  propertySet1SideBySide: true,
  propertySet2SideBySide: false,
  propertySet3SideBySide: false,
  propertySet4SideBySide: false,
  propertySet5SideBySide: false,
  propertySet6SideBySide: false,
  propertySet7SideBySide: false,
  propertySet1Above: false,
  propertySet2Above: false,
  propertySet3Above: false,
  propertySet4Above: false,
  propertySet5Above: false,
  propertySet6Above: false,
  propertySet7Above: false,
};

/**
 * Merge defaults + overrides into a fully resolved settings object.
 * Used at resolution boundaries (Bases view init, Datacore view init).
 */
export function resolveSettings(
  pluginSettings: PluginSettings,
  viewDefaults: ViewDefaults = VIEW_DEFAULTS,
  datacoreDefaults: DatacoreDefaults = DATACORE_DEFAULTS,
  overrides?: Partial<ViewDefaults & DatacoreDefaults>,
): ResolvedSettings {
  return {
    ...pluginSettings,
    ...viewDefaults,
    ...datacoreDefaults,
    ...overrides,
  };
}

export const DEFAULT_UI_STATE = {
  sortMethod: "mtime-desc",
  viewMode: "card",
  searchQuery: "",
  resultLimit: "",
  widthMode: "normal",
  collapsedGroups: [] as string[],
};

export const DEFAULT_TEMPLATE_VIEWS = {
  grid: null,
  masonry: null,
  datacore: null,
};

export const STORAGE_KEY_PREFIX = "dynamic-views";
