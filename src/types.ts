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
  propertyGroup1SideBySide: boolean;
  propertyGroup2SideBySide: boolean;
  propertyGroup3SideBySide: boolean;
  propertyGroup4SideBySide: boolean;
  propertyGroup5SideBySide: boolean;
  propertyGroup6SideBySide: boolean;
  propertyGroup7SideBySide: boolean;
  propertyGroup1Position: "top" | "bottom";
  propertyGroup2Position: "top" | "bottom";
  propertyGroup3Position: "top" | "bottom";
  propertyGroup4Position: "top" | "bottom";
  propertyGroup5Position: "top" | "bottom";
  propertyGroup6Position: "top" | "bottom";
  propertyGroup7Position: "top" | "bottom";
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
  thumbnailCacheSize: "minimal" | "small" | "balanced" | "large" | "unlimited";
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
  propertyGroup1SideBySide: boolean;
  propertyGroup2SideBySide: boolean;
  propertyGroup3SideBySide: boolean;
  propertyGroup4SideBySide: boolean;
  propertyGroup5SideBySide: boolean;
  propertyGroup6SideBySide: boolean;
  propertyGroup7SideBySide: boolean;
  propertyGroup1Position: "top" | "bottom";
  propertyGroup2Position: "top" | "bottom";
  propertyGroup3Position: "top" | "bottom";
  propertyGroup4Position: "top" | "bottom";
  propertyGroup5Position: "top" | "bottom";
  propertyGroup6Position: "top" | "bottom";
  propertyGroup7Position: "top" | "bottom";
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
