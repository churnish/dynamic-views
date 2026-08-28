// ============================================================================
// Settings Architecture: PluginSettings + ViewDefaults
// Rendering receives ResolvedSettings (the fully merged type).
// Storage types are used only at persistence and resolution boundaries.
// ============================================================================

/** Plugin-level settings (settings tab only, not per-view) */
export interface PluginSettings {
  randomizeAction: string;
  openOnTitle: boolean;
  openRandomInNewTab: boolean;
  smartTimestamp: boolean;
  createdTimeProperty: string;
  modifiedTimeProperty: string;
  preventSidebarSwipe: boolean;
  revealInNotebookNavigator: 'disable' | 'files-folders' | 'tags' | 'all';
  showYoutubeThumbnails: boolean;
  showCardLinkCovers: boolean;
  folderCommands: boolean;
  fullScreen: boolean;
}

/** Per-view visual defaults */
export interface ViewDefaults {
  // Card size
  cardSize: number;
  // Title
  titleProperty: string;
  titleLines: number;
  subtitleProperty: string;
  subtitleLines: number;
  // Position-based title/subtitle
  displayFirstAsTitle: boolean;
  displaySecondAsSubtitle: boolean;
  // Text preview
  textPreviewProperty: string;
  fallbackToContent: boolean;
  textPreviewLines: number;
  // Image
  imageProperty: string;
  showFileImages: 'always' | 'if-unavailable' | 'never';
  imageFormat: 'thumbnail' | 'cover' | 'poster' | 'backdrop';
  posterDisplayMode: 'fade' | 'overlay';
  posterInteractToReveal: boolean;
  thumbnailSize: number;
  imagePosition: 'left' | 'right' | 'top' | 'bottom';
  imageFit: 'crop' | 'contain';
  imageRatio: number;
  // Properties
  propertyNames: 'hide' | 'inline' | 'above';
  pairProperties: boolean;
  rightPropertyPosition: 'left' | 'column' | 'right';
  invertPropertyPairing: string;
  showPropertiesAbove: boolean;
  invertPropertyPosition: string;
  urlProperty: string;
  // Other
  minimumColumns: 1 | 2;
  cardGapDesktop: number;
  cssclasses: string;
}

/** Bases-only defaults (overrides VIEW_DEFAULTS for Bases views) */
export interface BasesDefaults {
  displayFirstAsTitle: boolean;
  displaySecondAsSubtitle: boolean;
  propertyNames: 'hide' | 'inline' | 'above';
}

/** Fully resolved settings — the merge of PluginSettings + ViewDefaults */
export type ResolvedSettings = PluginSettings &
  ViewDefaults & {
    /** syntaxName → displayName map from Bases config (set at normalization point, not persisted) */
    _displayNameMap?: Record<string, string>;
    /** Count of leading getOrder() properties rendered as title/subtitle (0–2) */
    _skipLeadingProperties?: number;
  };

/** Bases-only UI state (persisted per .base file by view ID) */
export interface BasesUIState {
  collapsedGroups: string[];
}

/** Saved settings snapshot applied as defaults to new views of the same type */
export type SettingsTemplate = Partial<ViewDefaults>;

export interface PluginData {
  pluginSettings: Partial<PluginSettings>;
  templates: Partial<Record<'grid' | 'masonry', SettingsTemplate>>;
  basesStates: Record<string, BasesUIState>;
}

/** Median card-height profile split by image presence, captured at teardown so
 *  back-nav can size each deferred-mount card individually instead of applying
 *  one flat average. Declared here rather than in virtual-scroll.ts to keep
 *  types.ts import-free. */
export interface MountEstimateProfile {
  withImage: { scalable: number; fixed: number };
  withoutImage: { scalable: number; fixed: number };
  measuredAtWidth: number;
  /** Cover wrapper width at measuredAtWidth; 0 if unknown */
  coverWidth: number;
}

export interface AnchorScrollState {
  anchorPath: string;
  anchorOffset: number;
  anchorIndex: number;
  columns: number;
  count: number;
  height: number;
  /** Optional — legacy saved state predates the profile */
  estimate?: MountEstimateProfile;
}
export interface LegacyScrollState {
  top: number;
  count: number;
  height: number;
}
export type ScrollRestoreState = AnchorScrollState | LegacyScrollState | null;

export type LayoutSource =
  | 'initial-render'
  | 'resize-observer'
  | 'image-load'
  | 'image-coalesced'
  | 'expand-group'
  | 'compact-mode-sync'
  | 'property-measured'
  | 'queued-update'
  | 'card-disconnected-fallback';

// ============================================================================
// View State Interfaces (shared between grid-view.ts and masonry-view.ts)
// ============================================================================

/** Content text preview/image cache */
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
  lastPropertySetHash: string | null;
  lastSettingsHashExcludingOrder: string | null;
  lastStyleSettingsHash: string | null;
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
