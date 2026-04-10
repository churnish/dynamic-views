import type { PluginSettings, ViewDefaults, BasesDefaults } from './types';

/** Valid image file extensions supported by the plugin */
export const VALID_IMAGE_EXTENSIONS: string[] = [
  'avif',
  'bmp',
  'gif',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'webp',
];

export const PLUGIN_SETTINGS: PluginSettings = {
  randomizeAction: 'shuffle',
  openFileAction: 'card',
  openRandomInNewTab: true,
  smartTimestamp: true,
  createdTimeProperty: 'created time',
  modifiedTimeProperty: 'modified time',
  preventSidebarSwipe: true,
  revealInNotebookNavigator: 'disable',
  showYoutubeThumbnails: true,
  showCardLinkCovers: true,
  folderCommands: true,
  fullScreen: true,
};

export const VIEW_DEFAULTS: ViewDefaults = {
  // Card size
  cardSize: 300,
  // Title
  titleProperty: 'file.name',
  titleLines: 2,
  subtitleProperty: 'file.folder',
  // Position-based title/subtitle
  displayFirstAsTitle: false,
  displaySecondAsSubtitle: false,
  // Text preview
  textPreviewProperty: '',
  fallbackToContent: true,
  textPreviewLines: 5,
  // Image
  imageProperty: '',
  fallbackToEmbeds: 'always',
  imageFormat: 'thumbnail',
  posterDisplayMode: 'fade',
  posterInteractToReveal: false,
  thumbnailSize: 80,
  imagePosition: 'right',
  imageFit: 'crop',
  imageRatio: 1.0,
  // Properties
  propertyNames: 'hide',
  pairProperties: false,
  rightPropertyPosition: 'column',
  invertPropertyPairing: '',
  showPropertiesAbove: false,
  invertPropertyPosition: '',
  urlProperty: '',
  // Other
  minimumColumns: 1 as const,
  cssclasses: '',
};

export const BASES_DEFAULTS: BasesDefaults = {
  displayFirstAsTitle: true,
  displaySecondAsSubtitle: false,
  propertyNames: 'inline',
};

/** Default Bases UI state (collapsedGroups only) */
export const DEFAULT_BASES_STATE = {
  collapsedGroups: [] as string[],
};

// posterInteractToReveal excluded — toggling requires re-render to wire hover intent + tap handlers
export const CSS_ONLY_SETTINGS_KEYS = new Set([
  'textPreviewLines',
  'imageRatio',
  'thumbnailSize',
  'posterDisplayMode',
  'imageFit',
]);

export const ORDER_DERIVED_SETTINGS_KEYS = new Set([
  'titleProperty',
  'subtitleProperty',
  '_skipLeadingProperties',
]);

/** Custom event dispatched when plugin-level settings change */
export const PLUGIN_SETTINGS_CHANGE = 'dynamic-views-plugin-settings';
