export interface Settings {
    titleProperty: string;
    descriptionProperty: string;
    imageProperty: string;
    omitFirstLine: boolean;
    showTitle: boolean;
    showTextPreview: boolean;
    fallbackToContent: boolean;
    fallbackToEmbeds: boolean;
    propertyDisplay1: string;
    propertyDisplay2: string;
    propertyDisplay3: string;
    propertyDisplay4: string;
    propertyLayout12SideBySide: boolean;
    propertyLayout34SideBySide: boolean;
    propertyLabels: 'hide' | 'inline' | 'above';
    imageFormat: 'none' | 'thumbnail' | 'cover';
    timestampFormat: string;
    listMarker: string;
    randomizeAction: string;
    thumbnailCacheSize: 'minimal' | 'small' | 'balanced' | 'large' | 'unlimited';
    queryHeight: number;
    openFileAction: 'card' | 'title';
    openRandomInNewPane: boolean;
    showShuffleInRibbon: boolean;
    showRandomInRibbon: boolean;
    expandImagesOnClick: boolean;
    smartTimestamp: boolean;
    createdTimeProperty: string;
    modifiedTimeProperty: string;
    fallbackToFileMetadata: boolean;
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
    propertyDisplay1: string;
    propertyDisplay2: string;
    propertyDisplay3: string;
    propertyDisplay4: string;
    propertyLayout12SideBySide: boolean;
    propertyLayout34SideBySide: boolean;
    propertyLabels: 'hide' | 'inline' | 'above';
    showTitle: boolean;
    showTextPreview: boolean;
    fallbackToContent: boolean;
    fallbackToEmbeds: boolean;
    imageFormat: 'none' | 'thumbnail' | 'cover';
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
