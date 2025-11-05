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
    minCardWidth: 400,
    titleProperty: "",
    descriptionProperty: "",
    imageProperty: "",
    createdProperty: "",
    modifiedProperty: "",
    omitFirstLine: false,
    showTextPreview: true,
    showThumbnails: true,
    thumbnailPosition: "right",
    fallbackToContent: true,
    fallbackToEmbeds: true,
    fallbackToCtime: true,
    fallbackToMtime: true,
    metadataDisplayLeft: "timestamp",
    metadataDisplayRight: "path",
    metadataDisplayWinner: null,
    timestampDisplay: "sort-based",
    listMarker: "bullet",
    showTimestampIcon: true,
    minMasonryColumns: 2,
    minGridColumns: 1,
    randomizeAction: "shuffle",
    thumbnailCacheSize: "balanced",
    queryHeight: 0,
    openFileAction: "card",
    addCardBackground: "tinted"
};

export const DEFAULT_UI_STATE = {
    sortMethod: 'mtime-desc',
    viewMode: 'card',
    searchQuery: '',
    resultLimit: '',
    widthMode: 'normal'
};

export const STORAGE_KEY_PREFIX = 'dv';

export const CSS_CLASSES = {
    CONTAINER: 'dynamic-views-container',
    CARD: 'dv-card',
    MASONRY: 'dv-masonry',
    LIST: 'dv-list',
    TOOLBAR: 'dv-toolbar',
    SETTINGS: 'dv-settings',
    CONTROL_BAR: 'dv-control-bar'
};
