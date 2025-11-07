import { Settings, DefaultViewSettings } from './types';

export const DEFAULT_VIEW_SETTINGS: DefaultViewSettings = {
    titleProperty: "",
    descriptionProperty: "",
    imageProperty: "",
    metadataDisplayLeft: "timestamp",
    metadataDisplayRight: "path",
    showTextPreview: true,
    fallbackToContent: true,
    showThumbnails: true,
    fallbackToEmbeds: true,
    queryHeight: 0,
    listMarker: "bullet"
};

export const DEFAULT_SETTINGS: Settings = {
    titleProperty: "",
    descriptionProperty: "",
    imageProperty: "",
    createdProperty: "",
    modifiedProperty: "",
    omitFirstLine: false,
    showTextPreview: true,
    showThumbnails: true,
    fallbackToContent: true,
    fallbackToEmbeds: true,
    fallbackToCtime: true,
    fallbackToMtime: true,
    metadataDisplayLeft: "timestamp",
    metadataDisplayRight: "path",
    metadataDisplayWinner: null,
    timestampDisplay: "sort-based",
    listMarker: "bullet",
    randomizeAction: "shuffle",
    thumbnailCacheSize: "balanced",
    queryHeight: 0,
    openFileAction: "card",
    openRandomInNewPane: true
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
    CARD: 'dynamic-views-card',
    MASONRY: 'dynamic-views-masonry',
    LIST: 'dynamic-views-list',
    TOOLBAR: 'dynamic-views-toolbar',
    SETTINGS: 'dynamic-views-settings',
    CONTROL_BAR: 'dynamic-views-control-bar'
};
