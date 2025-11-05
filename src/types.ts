export interface Settings {
    minCardWidth: number;
    titleProperty: string;
    descriptionProperty: string;
    imageProperty: string;
    createdProperty: string;
    modifiedProperty: string;
    omitFirstLine: boolean;
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
    timestampDisplay: 'ctime' | 'mtime' | 'sort-based';
    listMarker: string;
    showTimestampIcon: boolean;
    minMasonryColumns: number;
    minGridColumns: number;
    randomizeAction: string;
    thumbnailCacheSize: 'minimal' | 'small' | 'balanced' | 'large' | 'unlimited';
    queryHeight: number;
    openFileAction: 'card' | 'title';
    addCardBackground: 'tinted' | 'transparent';
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
    descriptionProperty: string;
    imageProperty: string;
    metadataDisplayLeft: 'none' | 'timestamp' | 'tags' | 'path';
    metadataDisplayRight: 'none' | 'timestamp' | 'tags' | 'path';
    showTextPreview: boolean;
    fallbackToContent: boolean;
    showThumbnails: boolean;
    fallbackToEmbeds: boolean;
    queryHeight: number;
    listMarker: string;
}

export interface PluginData {
    globalSettings: Settings;
    defaultViewSettings: DefaultViewSettings;
    queryStates: Record<string, UIState>;
    basesViewMetadataWinners: Record<string, 'left' | 'right' | null>;
}

export type ViewMode = 'card' | 'masonry' | 'list';
export type WidthMode = 'normal' | 'wide' | 'max';
export type SortMethod = 'mtime-desc' | 'mtime-asc' | 'ctime-desc' | 'ctime-asc' | 'title' | 'size' | 'random';
