export interface Settings {
    titleProperty: string;
    descriptionProperty: string;
    imageProperty: string;
    createdProperty: string;
    modifiedProperty: string;
    alwaysOmitFirstLine: boolean;
    showTextPreview: boolean;
    showThumbnails: boolean;
    thumbnailPosition: 'left' | 'right';
    fallbackToContent: boolean;
    fallbackToEmbeds: boolean;
    fallbackToCtime: boolean;
    fallbackToMtime: boolean;
    metadataDisplayLeft: 'none' | 'timestamp' | 'tags' | 'path';
    metadataDisplayRight: 'none' | 'timestamp' | 'tags' | 'path';
    metadataDisplayWinner: 'left' | 'right' | null;
    listMarker: string;
    showTimestampIcon: boolean;
    minMasonryColumns: number;
    randomizeAction: string;
    thumbnailCacheSize: string;
    queryHeight: number;
    openFileAction: string;
    addCardBackground: boolean;
}

export interface UIState {
    sortMethod: string;
    viewMode: string;
    searchQuery: string;
    resultLimit: string;
    widthMode: string;
}

export interface PluginData {
    globalSettings: Settings;
    queryStates: Record<string, UIState>;
    basesViewMetadataWinners: Record<string, 'left' | 'right' | null>;
}

export type ViewMode = 'card' | 'masonry' | 'list';
export type WidthMode = 'normal' | 'wide' | 'max';
export type SortMethod = 'mtime-desc' | 'mtime-asc' | 'ctime-desc' | 'ctime-asc' | 'title' | 'size' | 'random';
