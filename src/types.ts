// ============================================================================
// Settings Architecture: PluginSettings + ViewDefaults + DatacoreDefaults
// Rendering receives ResolvedSettings (the fully merged type).
// Storage types are used only at persistence and resolution boundaries.
// ============================================================================

/** Plugin-level settings (settings tab only, not per-view) */
export interface PluginSettings {
  omitFirstLine: "always" | "ifMatchesTitle" | "never";
  randomizeAction: string;
  openFileAction: "card" | "title";
  openRandomInNewTab: boolean;
  smartTimestamp: boolean;
  createdTimeProperty: string;
  modifiedTimeProperty: string;
  preventSidebarSwipe: "disabled" | "base-files" | "all-views";
  revealInNotebookNavigator: "disable" | "files-folders" | "tags" | "all";
  showYoutubeThumbnails: boolean;
  showCardLinkCovers: boolean;
}

/** Per-view visual defaults (shared across Bases and Datacore) */
export interface ViewDefaults {
  // Card size
  cardSize: number;
  // Header
  titleProperty: string;
  subtitleProperty: string;
  // Text preview
  textPreviewProperty: string;
  fallbackToContent: boolean;
  textPreviewLines: number;
  // Image
  imageProperty: string;
  fallbackToEmbeds: "always" | "if-unavailable" | "never";
  imageFormat: "thumbnail" | "cover" | "poster" | "backdrop";
  thumbnailSize: "compact" | "standard" | "expanded";
  imagePosition: "left" | "right" | "top" | "bottom";
  imageFit: "crop" | "contain";
  imageAspectRatio: number;
  // Properties
  propertyLabels: "hide" | "inline" | "above";
  pairProperties: boolean;
  pairedPropertyLayout: "left" | "column" | "right";
  invertPairingForProperty: string;
  showPropertiesAbove: boolean;
  invertPositionForProperty: string;
  urlProperty: string;
  // Other
  minimumColumns: 1 | 2;
  ambientBackground: "subtle" | "dramatic" | "disable";
  cssclasses: string;
}

/** Datacore-only defaults (listMarker, queryHeight, propertyDisplay/propertySet fields) */
export interface DatacoreDefaults {
  listMarker: string;
  queryHeight: number;
  propertyDisplay1: string;
  propertyDisplay2: string;
  propertyDisplay3: string;
  propertyDisplay4: string;
  propertyDisplay5: string;
  propertyDisplay6: string;
  propertyDisplay7: string;
  propertyDisplay8: string;
  propertyDisplay9: string;
  propertyDisplay10: string;
  propertyDisplay11: string;
  propertyDisplay12: string;
  propertyDisplay13: string;
  propertyDisplay14: string;
  propertySet1SideBySide: boolean;
  propertySet2SideBySide: boolean;
  propertySet3SideBySide: boolean;
  propertySet4SideBySide: boolean;
  propertySet5SideBySide: boolean;
  propertySet6SideBySide: boolean;
  propertySet7SideBySide: boolean;
  propertySet1Above: boolean;
  propertySet2Above: boolean;
  propertySet3Above: boolean;
  propertySet4Above: boolean;
  propertySet5Above: boolean;
  propertySet6Above: boolean;
  propertySet7Above: boolean;
}

/** Fully resolved settings — the merge of PluginSettings + ViewDefaults + DatacoreDefaults */
export type ResolvedSettings = PluginSettings &
  ViewDefaults &
  DatacoreDefaults & {
    /** syntaxName → displayName map from Bases config (set at normalization point, not persisted) */
    _displayNameMap?: Record<string, string>;
  };

export interface UIState {
  sortMethod: string;
  viewMode: string;
  searchQuery: string;
  resultLimit: string;
  widthMode: string;
  collapsedGroups: string[];
}

/**
 * Settings template with timestamp for validation
 * Timestamp identifies which view is the current template
 */
export interface SettingsTemplate {
  settings: Partial<ViewDefaults & DatacoreDefaults>;
  setAt: number; // Unix timestamp (milliseconds) when template was enabled
}

export interface PluginData {
  pluginSettings: Partial<PluginSettings>;
  templates: Partial<Record<"grid" | "masonry" | "datacore", SettingsTemplate>>;
  queryStates: Record<string, UIState>;
  viewSettings: Record<string, Partial<ViewDefaults & DatacoreDefaults>>;
}

export type ViewMode = "card" | "masonry" | "list";
export type WidthMode = "normal" | "wide" | "max";

// ============================================================================
// View State Interfaces (shared between grid-view.ts and masonry-view.ts)
// ============================================================================

/** Content preview/image cache */
export interface ContentCache {
  textPreviews: Record<string, string>;
  images: Record<string, string | string[]>;
  hasImageAvailable: Record<string, boolean>;
}

/** Render version and abort control */
export interface RenderState {
  version: number;
  abortController: AbortController | null;
  lastRenderHash: string;
  lastSettingsHash: string | null;
  lastMtimes: Map<string, number>;
}

/** Group tracking for batch append */
export interface LastGroupState {
  key: string | undefined;
  container: HTMLElement | null;
}

/** Scroll throttle state */
export interface ScrollThrottleState {
  listener: (() => void) | null;
  timeoutId: number | null;
}

/** Sort/shuffle state */
export interface SortState {
  isShuffled: boolean;
  order: string[];
  lastMethod: string | null;
}

/** Keyboard focus state */
export interface FocusState {
  cardIndex: number;
  hoveredEl: HTMLElement | null;
}
