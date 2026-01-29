export interface Settings {
  titleProperty: string;
  textPreviewProperty: string;
  imageProperty: string;
  urlProperty: string;
  omitFirstLine: "always" | "ifMatchesTitle" | "never";
  subtitleProperty: string;
  fallbackToContent: boolean;
  fallbackToEmbeds: "always" | "if-unavailable" | "never";
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
  cssclasses: string;
  propertyLabels: "hide" | "inline" | "above";
  imageFormat: "thumbnail" | "cover" | "poster" | "backdrop";
  imagePosition: "left" | "right" | "top" | "bottom";
  imageFit: "crop" | "contain";
  imageAspectRatio: number;
  listMarker: string;
  randomizeAction: string;
  queryHeight: number;
  openFileAction: "card" | "title";
  openRandomInNewTab: boolean;
  smartTimestamp: boolean;
  createdTimeProperty: string;
  modifiedTimeProperty: string;
  cardSize: number;
  preventSidebarSwipe: "disabled" | "base-files" | "all-views";
  revealInNotebookNavigator: "disable" | "files-folders" | "tags" | "all";
  showYoutubeThumbnails: boolean;
  showCardLinkCovers: boolean;
}

export interface UIState {
  sortMethod: string;
  viewMode: string;
  searchQuery: string;
  resultLimit: string;
  widthMode: string;
}

export interface DefaultViewSettings {
  titleProperty: string;
  textPreviewProperty: string;
  imageProperty: string;
  urlProperty: string;
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
  cssclasses: string;
  propertyLabels: "hide" | "inline" | "above";
  subtitleProperty: string;
  fallbackToContent: boolean;
  fallbackToEmbeds: "always" | "if-unavailable" | "never";
  imageFormat: "thumbnail" | "cover" | "poster" | "backdrop";
  imagePosition: "left" | "right" | "top" | "bottom";
  imageFit: "crop" | "contain";
  imageAspectRatio: number;
  queryHeight: number;
  listMarker: string;
  cardSize: number;
}

/**
 * Settings template with timestamp for validation
 * Timestamp identifies which view is the current template
 */
export interface SettingsTemplate {
  settings: Partial<DefaultViewSettings>;
  setAt: number; // Unix timestamp (milliseconds) when template was enabled
}

export interface PluginData {
  globalSettings: Settings;
  defaultViewSettings: DefaultViewSettings;
  queryStates: Record<string, UIState>;
  viewSettings: Record<string, Partial<DefaultViewSettings>>;
  defaultTemplateViews: {
    grid: SettingsTemplate | null;
    masonry: SettingsTemplate | null;
    list: SettingsTemplate | null;
  };
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
