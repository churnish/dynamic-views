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
  cardSize: 300,
  // Header
  titleProperty: "file base name",
  subtitleProperty: "folder",
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
  imageRatio: 1.0,
  // Properties
  propertyLabels: "inline",
  pairProperties: false,
  rightPropertyPosition: "right",
  invertPropertyPairing: "",
  showPropertiesAbove: false,
  invertPropertyPosition: "",
  urlProperty: "url",
  // Other
  minimumColumns: 1 as const,
  ambientBackground: "disable",
  cssclasses: "",
};

export const DATACORE_DEFAULTS: DatacoreDefaults = {
  listMarker: "bullet",
  queryHeight: 0,
  // PLACEHOLDER: pairProperties forces side-by-side for hard-coded tags+mtime
  // Will be revisited during Bases-style property rework
  pairProperties: true,
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

/** Default Bases UI state (collapsedGroups only) */
export const DEFAULT_BASES_STATE = {
  collapsedGroups: [] as string[],
};

/** Default Datacore state (UI + settings) */
export const DEFAULT_DATACORE_STATE = {
  sortMethod: "mtime-desc",
  viewMode: "card",
  searchQuery: "",
  resultLimit: "",
  widthMode: "normal",
  settings: undefined,
};

export const STORAGE_KEY_PREFIX = "dynamic-views";
