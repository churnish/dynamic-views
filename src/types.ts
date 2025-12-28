export interface Settings {
  titleProperty: string;
  textPreviewProperty: string;
  imageProperty: string;
  urlProperty: string;
  omitFirstLine: "always" | "ifMatchesTitle" | "never";
  showTitle: boolean;
  subtitleProperty: string;
  showTextPreview: boolean;
  fallbackToContent: boolean;
  fallbackToEmbeds: "always" | "if-empty" | "never";
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
  propertySet1Position: "top" | "bottom";
  propertySet2Position: "top" | "bottom";
  propertySet3Position: "top" | "bottom";
  propertySet4Position: "top" | "bottom";
  propertySet5Position: "top" | "bottom";
  propertySet6Position: "top" | "bottom";
  propertySet7Position: "top" | "bottom";
  propertyLabels: "hide" | "inline" | "above";
  imageFormat:
    | "none"
    | "thumbnail-left"
    | "thumbnail-right"
    | "thumbnail-top"
    | "thumbnail-bottom"
    | "cover-top"
    | "cover-bottom"
    | "cover-left"
    | "cover-right";
  imageFit: "crop" | "contain";
  imageAspectRatio: number;
  listMarker: string;
  randomizeAction: string;
  queryHeight: number;
  openFileAction: "card" | "title";
  openRandomInNewTab: boolean;
  showShuffleInRibbon: boolean;
  showRandomInRibbon: boolean;
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
  propertySet1Position: "top" | "bottom";
  propertySet2Position: "top" | "bottom";
  propertySet3Position: "top" | "bottom";
  propertySet4Position: "top" | "bottom";
  propertySet5Position: "top" | "bottom";
  propertySet6Position: "top" | "bottom";
  propertySet7Position: "top" | "bottom";
  propertyLabels: "hide" | "inline" | "above";
  showTitle: boolean;
  subtitleProperty: string;
  showTextPreview: boolean;
  fallbackToContent: boolean;
  fallbackToEmbeds: "always" | "if-empty" | "never";
  imageFormat:
    | "none"
    | "thumbnail-left"
    | "thumbnail-right"
    | "thumbnail-top"
    | "thumbnail-bottom"
    | "cover-top"
    | "cover-bottom"
    | "cover-left"
    | "cover-right";
  imageFit: "crop" | "contain";
  imageAspectRatio: number;
  queryHeight: number;
  listMarker: string;
  cardSize: number;
}

export interface PluginData {
  globalSettings: Settings;
  defaultViewSettings: DefaultViewSettings;
  queryStates: Record<string, UIState>;
  viewSettings: Record<string, Partial<DefaultViewSettings>>;
}

export type ViewMode = "card" | "masonry" | "list";
export type WidthMode = "normal" | "wide" | "max";
export type SortMethod =
  | "mtime-desc"
  | "mtime-asc"
  | "ctime-desc"
  | "ctime-asc"
  | "title"
  | "size"
  | "random";

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
