/**
 * Universal settings schema
 * Defines settings structure for both Bases and Datacore views
 */

import type { Settings } from '../types';

/** Default settings used by both Bases and Datacore */
export const DEFAULT_SETTINGS: Settings = {
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
    randomizeAction: "shuffle",
    thumbnailCacheSize: "balanced",
    queryHeight: 0,
    openFileAction: "card",
    addCardBackground: "tinted"
};

/**
 * Bases view options for card/masonry views
 * These options appear in the Bases view configuration menu
 */
export function getBasesViewOptions(): any[] {
    return [
        {
            type: 'dropdown',
            displayName: 'Metadata display (left)',
            key: 'metadataDisplayLeft',
            default: 'timestamp',
            options: {
                'timestamp': 'Timestamp',
                'path': 'File path',
                'tags': 'File tags',
                'none': 'None'
            }
        },
        {
            type: 'dropdown',
            displayName: 'Metadata display (right)',
            key: 'metadataDisplayRight',
            default: 'path',
            options: {
                'timestamp': 'Timestamp',
                'path': 'File path',
                'tags': 'File tags',
                'none': 'None'
            }
        },
        {
            type: 'text',
            displayName: 'Title property',
            key: 'titleProperty',
            placeholder: 'Comma-separated if multiple'
        },
        {
            type: 'toggle',
            displayName: 'Show text preview',
            key: 'showTextPreview',
            default: true
        },
        {
            type: 'text',
            displayName: 'Text preview property',
            key: 'descriptionProperty',
            placeholder: 'Comma-separated if multiple'
        },
        {
            type: 'toggle',
            displayName: 'Use note content if text preview property unavailable',
            key: 'fallbackToContent',
            default: true
        },
        {
            type: 'toggle',
            displayName: 'Show thumbnails',
            key: 'showThumbnails',
            default: true
        },
        {
            type: 'text',
            displayName: 'Image property',
            key: 'imageProperty',
            placeholder: 'Comma-separated if multiple'
        },
        {
            type: 'toggle',
            displayName: 'Use in-note images if image property unavailable',
            key: 'fallbackToEmbeds',
            default: true
        },
    ];
}

/**
 * Additional options specific to masonry view
 */
export function getMasonryViewOptions(): any[] {
    return getBasesViewOptions();
}

/**
 * Read settings from Bases config
 * Maps Bases config values to Settings object
 */
export function readBasesSettings(config: any, globalSettings: Settings): Settings {
    return {
        titleProperty: String(config.get('titleProperty') || DEFAULT_SETTINGS.titleProperty),
        descriptionProperty: String(config.get('descriptionProperty') || DEFAULT_SETTINGS.descriptionProperty),
        imageProperty: String(config.get('imageProperty') || DEFAULT_SETTINGS.imageProperty),
        createdProperty: globalSettings.createdProperty, // From global settings
        modifiedProperty: globalSettings.modifiedProperty, // From global settings
        omitFirstLine: globalSettings.omitFirstLine, // From global settings
        showTextPreview: Boolean(config.get('showTextPreview') ?? DEFAULT_SETTINGS.showTextPreview),
        showThumbnails: Boolean(config.get('showThumbnails') ?? DEFAULT_SETTINGS.showThumbnails),
        thumbnailPosition: globalSettings.thumbnailPosition, // From global settings
        fallbackToContent: Boolean(config.get('fallbackToContent') ?? DEFAULT_SETTINGS.fallbackToContent),
        fallbackToEmbeds: Boolean(config.get('fallbackToEmbeds') ?? DEFAULT_SETTINGS.fallbackToEmbeds),
        fallbackToCtime: Boolean(config.get('fallbackToCtime') ?? DEFAULT_SETTINGS.fallbackToCtime),
        fallbackToMtime: Boolean(config.get('fallbackToMtime') ?? DEFAULT_SETTINGS.fallbackToMtime),
        metadataDisplayLeft: String(config.get('metadataDisplayLeft') || DEFAULT_SETTINGS.metadataDisplayLeft) as 'none' | 'timestamp' | 'tags' | 'path',
        metadataDisplayRight: String(config.get('metadataDisplayRight') || DEFAULT_SETTINGS.metadataDisplayRight) as 'none' | 'timestamp' | 'tags' | 'path',
        metadataDisplayWinner: null, // Computed at runtime by view instances
        timestampDisplay: globalSettings.timestampDisplay, // From global settings
        listMarker: String(config.get('listMarker') || DEFAULT_SETTINGS.listMarker) as 'bullet' | 'number',
        showTimestampIcon: globalSettings.showTimestampIcon, // From global settings
        minMasonryColumns: globalSettings.minMasonryColumns, // From global settings
        randomizeAction: String(config.get('randomizeAction') || DEFAULT_SETTINGS.randomizeAction) as 'shuffle' | 'random',
        thumbnailCacheSize: globalSettings.thumbnailCacheSize, // From global settings
        queryHeight: 0, // Not configurable in Bases
        openFileAction: globalSettings.openFileAction, // From global settings
        addCardBackground: globalSettings.addCardBackground // From global settings
    };
}
