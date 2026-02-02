import { Settings, DefaultViewSettings } from "./types";

export const DEFAULT_VIEW_SETTINGS: DefaultViewSettings = {
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
  // Non-UI
  listMarker: "bullet",
  queryHeight: 0,
  // Datacore-only defaults (kept until Datacore refactor)
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

export const DEFAULT_SETTINGS: Settings = {
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
  // Non-UI
  listMarker: "bullet",
  queryHeight: 0,
  // Datacore-only defaults (kept until Datacore refactor)
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
  // Settings-only
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
