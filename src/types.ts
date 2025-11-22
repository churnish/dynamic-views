export interface Settings {
    titleProperty: string;
    descriptionProperty: string;
    imageProperty: string;
    omitFirstLine: boolean;
    showTitle: boolean;
    showTextPreview: boolean;
    fallbackToContent: boolean;
    fallbackToEmbeds: 'always' | 'if-empty' | 'never';
    propertyDisplay1: string;
    propertyDisplay2: string;
    propertyDisplay3: string;
    propertyDisplay4: string;
    propertyLayout12SideBySide: boolean;
    propertyLayout34SideBySide: boolean;
    propertyLabels: 'hide' | 'inline' | 'above';
    imageFormat: 'none' | 'thumbnail-left' | 'thumbnail-right' | 'thumbnail-top' | 'thumbnail-bottom' | 'cover-top' | 'cover-bottom' | 'cover-left' | 'cover-right';
    coverFitMode: 'crop' | 'contain';
    imageAspectRatio: number;
    timestampFormat: string;
    listMarker: string;
    randomizeAction: string;
    thumbnailCacheSize: 'minimal' | 'small' | 'balanced' | 'large' | 'unlimited';
    queryHeight: number;
    openFileAction: 'card' | 'title';
    openRandomInNewPane: boolean;
    showShuffleInRibbon: boolean;
    showRandomInRibbon: boolean;
    expandImagesOnClick: 'off' | 'hold' | 'toggle';
    smartTimestamp: boolean;
    createdTimeProperty: string;
    modifiedTimeProperty: string;
    fallbackToFileMetadata: boolean;
    cardSize: number;
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
    fallbackToEmbeds: 'always' | 'if-empty' | 'never';
    imageFormat: 'none' | 'thumbnail-left' | 'thumbnail-right' | 'thumbnail-top' | 'thumbnail-bottom' | 'cover-top' | 'cover-bottom' | 'cover-left' | 'cover-right';
    coverFitMode: 'crop' | 'contain';
    imageAspectRatio: number;
    queryHeight: number;
    listMarker: string;
    cardSize: number;
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
