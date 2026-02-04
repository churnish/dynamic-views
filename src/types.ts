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
  imageRatio: number;
  // Properties
  propertyLabels: "hide" | "inline" | "above";
  pairProperties: boolean;
  rightPropertyPosition: "left" | "column" | "right";
  invertPropertyPairing: string;
  showPropertiesAbove: boolean;
  invertPropertyPosition: string;
  urlProperty: string;
  // Other
  minimumColumns: 1 | 2;
  ambientBackground: "subtle" | "dramatic" | "disable";
  cssclasses: string;
}

/** Datacore-only defaults */
export interface DatacoreDefaults {
  listMarker: string;
  queryHeight: number;
  /** PLACEHOLDER: Forces pairing for hard-coded tags+mtime until rework */
  pairProperties: boolean;
}

/** Fully resolved settings — the merge of PluginSettings + ViewDefaults + DatacoreDefaults */
export type ResolvedSettings = PluginSettings &
  ViewDefaults &
  DatacoreDefaults & {
    /** syntaxName → displayName map from Bases config (set at normalization point, not persisted) */
    _displayNameMap?: Record<string, string>;
  };

/** Bases-only UI state (persisted per .base file by ctime) */
export interface BasesUIState {
  collapsedGroups: string[];
}

/** Datacore-only state: UI + view settings (persisted per query by ctime:queryId) */
export interface DatacoreState {
  // UI state
  sortMethod: string;
  viewMode: string;
  searchQuery: string;
  resultLimit: string;
  widthMode: string;
  // View settings (previously in viewSettings)
  settings?: Partial<ViewDefaults & DatacoreDefaults>;
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
  basesStates: Record<string, BasesUIState>; // Bases only: { collapsedGroups }
  datacoreStates: Record<string, DatacoreState>; // Datacore only: UI + settings
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
