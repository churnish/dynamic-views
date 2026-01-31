import { Settings, DefaultViewSettings } from "./types";

export const DEFAULT_VIEW_SETTINGS: DefaultViewSettings = {
  titleProperty: "file.name",
  textPreviewProperty: "",
  imageProperty: "",
  urlProperty: "url",
  pairProperties: true,
  invertPairingForProperty: "",
  showPropertiesAbove: false,
  invertPositionForProperty: "",
  cssclasses: "",
  propertyLabels: "hide",
  subtitleProperty: "file.folder",
  fallbackToContent: true,
  fallbackToEmbeds: "always",
  imageFormat: "thumbnail",
  imagePosition: "right",
  imageFit: "crop",
  imageAspectRatio: 1.0,
  queryHeight: 0,
  listMarker: "bullet",
  cardSize: 400,
};

export const DEFAULT_SETTINGS: Settings = {
  titleProperty: "file.name",
  textPreviewProperty: "",
  imageProperty: "",
  urlProperty: "url",
  omitFirstLine: "ifMatchesTitle",
  subtitleProperty: "file.folder",
  fallbackToContent: true,
  fallbackToEmbeds: "always",
  pairProperties: true,
  invertPairingForProperty: "",
  showPropertiesAbove: false,
  invertPositionForProperty: "",
  cssclasses: "",
  propertyLabels: "hide",
  imageFormat: "thumbnail",
  imagePosition: "right",
  imageFit: "crop",
  imageAspectRatio: 1.0,
  listMarker: "bullet",
  randomizeAction: "shuffle",
  queryHeight: 0,
  openFileAction: "card",
  openRandomInNewTab: true,
  smartTimestamp: true,
  createdTimeProperty: "created time",
  modifiedTimeProperty: "modified time",
  cardSize: 400,
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
