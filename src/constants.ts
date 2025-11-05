import { Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
    titleProperty: "",
    descriptionProperty: "",
    imageProperty: "",
    createdProperty: "",
    modifiedProperty: "",
    alwaysOmitFirstLine: false,
    showTextPreview: true,
    showThumbnails: true,
    thumbnailPosition: "right",
    fallbackToContent: true,
    fallbackToEmbeds: true,
    fallbackToCtime: true,
    fallbackToMtime: true,
    metadataDisplayLeft: "timestamp",
    metadataDisplayRight: "tags",
    metadataDisplayWinner: null,
    listMarker: "bullet",
    showTimestampIcon: true,
    minMasonryColumns: 1,
    randomizeAction: "shuffle",
    thumbnailCacheSize: "balanced",
    queryHeight: 0,
    openFileAction: "card",
    addCardBackground: true
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
