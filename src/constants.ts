import { Settings, DefaultViewSettings } from './types';

export const DEFAULT_VIEW_SETTINGS: DefaultViewSettings = {
    titleProperty: "",
    descriptionProperty: "",
    imageProperty: "",
    propertyDisplay1: "file.tags",
    propertyDisplay2: "",
    propertyDisplay3: "file.path",
    propertyDisplay4: "file.mtime",
    propertyLayout12SideBySide: false,
    propertyLayout34SideBySide: true,
    propertyLabels: "hide",
    showTitle: true,
    showTextPreview: true,
    fallbackToContent: true,
    fallbackToEmbeds: true,
    imageFormat: "thumbnail",
    queryHeight: 0,
    listMarker: "bullet"
};

export const DEFAULT_SETTINGS: Settings = {
    titleProperty: "",
    descriptionProperty: "",
    imageProperty: "",
    omitFirstLine: false,
    showTitle: true,
    showTextPreview: true,
    fallbackToContent: true,
    fallbackToEmbeds: true,
    propertyDisplay1: "file.tags",
    propertyDisplay2: "",
    propertyDisplay3: "file.path",
    propertyDisplay4: "file.mtime",
    propertyLayout12SideBySide: false,
    propertyLayout34SideBySide: true,
    propertyLabels: "hide",
    imageFormat: "thumbnail",
    timestampFormat: "",
    listMarker: "bullet",
    randomizeAction: "shuffle",
    thumbnailCacheSize: "balanced",
    queryHeight: 0,
    openFileAction: "card",
    openRandomInNewPane: true,
    showShuffleInRibbon: true,
    showRandomInRibbon: true,
    expandImagesOnClick: true,
    smartTimestamp: true,
    createdTimeProperty: "",
    modifiedTimeProperty: "",
    fallbackToFileMetadata: true
};

export const DEFAULT_UI_STATE = {
    sortMethod: 'mtime-desc',
    viewMode: 'card',
    searchQuery: '',
    resultLimit: '',
    widthMode: 'normal'
};

export const STORAGE_KEY_PREFIX = 'dynamic-views';

export const CSS_CLASSES = {
    CONTAINER: 'dynamic-views-container',
    GRID: 'dynamic-views-grid',
    MASONRY: 'dynamic-views-masonry',
    LIST: 'dynamic-views-list',
    TOOLBAR: 'dynamic-views-toolbar',
    SETTINGS: 'dynamic-views-settings',
    CONTROL_BAR: 'dynamic-views-control-bar'
};
