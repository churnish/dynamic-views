export interface Settings {
    titleProperty: string;
    descriptionProperty: string;
    imageProperty: string;
    createdProperty: string;
    modifiedProperty: string;
    omitFirstLine: boolean;
    showTextPreview: boolean;
    showThumbnails: boolean;
    fallbackToContent: boolean;
    fallbackToEmbeds: boolean;
    fallbackToCtime: boolean;
    fallbackToMtime: boolean;
    metadataDisplay1: string;
    metadataDisplay2: string;
    metadataDisplay3: string;
    metadataDisplay4: string;
    metadataLayout12SideBySide: boolean;
    metadataLayout34SideBySide: boolean;
    timestampDisplay: 'ctime' | 'mtime' | 'sort-based';
    listMarker: string;
    randomizeAction: string;
    thumbnailCacheSize: 'minimal' | 'small' | 'balanced' | 'large' | 'unlimited';
    queryHeight: number;
    openFileAction: 'card' | 'title';
    openRandomInNewPane: boolean;
    showShuffleInRibbon: boolean;
    showRandomInRibbon: boolean;
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
    metadataDisplay1: string;
    metadataDisplay2: string;
    metadataDisplay3: string;
    metadataDisplay4: string;
    metadataLayout12SideBySide: boolean;
    metadataLayout34SideBySide: boolean;
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
    viewSettings: Record<string, Partial<DefaultViewSettings>>;
}

export type ViewMode = 'card' | 'masonry' | 'list';
export type WidthMode = 'normal' | 'wide' | 'max';
export type SortMethod = 'mtime-desc' | 'mtime-asc' | 'ctime-desc' | 'ctime-asc' | 'title' | 'size' | 'random';
