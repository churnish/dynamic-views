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

/**
 * Bases view options for card/masonry views
 * These options appear in the Bases view configuration menu
 */
export function getBasesViewOptions(): any[] {
    return [
        {
            type: 'text',
            displayName: 'Title property',
            key: 'titleProperty',
            placeholder: 'Comma-separated if multiple'
        },
        {
            type: 'text',
            displayName: 'Text preview property',
            key: 'descriptionProperty',
            placeholder: 'Comma-separated if multiple'
        },
        {
            type: 'text',
            displayName: 'Image property',
            key: 'imageProperty',
            placeholder: 'Comma-separated if multiple'
        },
        {
            type: 'text',
            displayName: 'Created time property',
            key: 'createdProperty',
            placeholder: 'Comma-separated if multiple'
        },
        {
            type: 'toggle',
            displayName: 'Use file metadata if property unavailable',
            key: 'fallbackToCtime',
            default: true
        },
        {
            type: 'text',
            displayName: 'Modified time property',
            key: 'modifiedProperty',
            placeholder: 'Comma-separated if multiple'
        },
        {
            type: 'toggle',
            displayName: 'Use file metadata if property unavailable',
            key: 'fallbackToMtime',
            default: true
        },
        {
            type: 'toggle',
            displayName: 'Show text preview',
            key: 'showTextPreview',
            default: true
        },
        {
            type: 'toggle',
            displayName: 'Fall back to note content if unavailable',
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
            type: 'toggle',
            displayName: 'Fall back to image embeds if unavailable',
            key: 'fallbackToEmbeds',
            default: true
        },
        {
            type: 'dropdown',
            displayName: 'Thumbnail position',
            key: 'thumbnailPosition',
            default: 'right',
            options: {
                'left': 'Left',
                'right': 'Right'
            }
        },
        {
            type: 'toggle',
            displayName: 'Always omit first line',
            key: 'alwaysOmitFirstLine',
            default: false
        },
        {
            type: 'dropdown',
            displayName: 'Metadata display (left)',
            key: 'metadataDisplayLeft',
            default: 'timestamp',
            options: {
                'none': 'None',
                'timestamp': 'Timestamp',
                'tags': 'File tags',
                'path': 'File path'
            }
        },
        {
            type: 'dropdown',
            displayName: 'Metadata display (right)',
            key: 'metadataDisplayRight',
            default: 'tags',
            options: {
                'none': 'None',
                'timestamp': 'Timestamp',
                'tags': 'File tags',
                'path': 'File path'
            }
        },
        {
            type: 'toggle',
            displayName: 'Show timestamp icon',
            key: 'showTimestampIcon',
            default: true
        },
        {
            type: 'dropdown',
            displayName: 'Open file action',
            key: 'openFileAction',
            default: 'card',
            options: {
                'card': 'Click card',
                'title': 'Click title only'
            }
        },
        {
            type: 'toggle',
            displayName: 'Add card background',
            key: 'addCardBackground',
            default: true
        },
        {
            type: 'dropdown',
            displayName: 'Thumbnail cache size',
            key: 'thumbnailCacheSize',
            default: 'balanced',
            options: {
                'small': 'Small (faster, lower quality)',
                'balanced': 'Balanced',
                'large': 'Large (slower, higher quality)'
            }
        }
    ];
}

/**
 * Additional options specific to masonry view
 */
export function getMasonryViewOptions(): any[] {
    return [
        ...getBasesViewOptions(),
        {
            type: 'number',
            displayName: 'Minimum columns',
            key: 'minMasonryColumns',
            default: 1,
            min: 1,
            max: 6
        }
    ];
}

/**
 * Read settings from Bases config
 * Maps Bases config values to Settings object
 */
export function readBasesSettings(config: any): Settings {
    return {
        titleProperty: String(config.get('titleProperty') || DEFAULT_SETTINGS.titleProperty),
        descriptionProperty: String(config.get('descriptionProperty') || DEFAULT_SETTINGS.descriptionProperty),
        imageProperty: String(config.get('imageProperty') || DEFAULT_SETTINGS.imageProperty),
        createdProperty: String(config.get('createdProperty') || DEFAULT_SETTINGS.createdProperty),
        modifiedProperty: String(config.get('modifiedProperty') || DEFAULT_SETTINGS.modifiedProperty),
        alwaysOmitFirstLine: Boolean(config.get('alwaysOmitFirstLine')),
        showTextPreview: Boolean(config.get('showTextPreview') ?? DEFAULT_SETTINGS.showTextPreview),
        showThumbnails: Boolean(config.get('showThumbnails') ?? DEFAULT_SETTINGS.showThumbnails),
        thumbnailPosition: String(config.get('thumbnailPosition') || DEFAULT_SETTINGS.thumbnailPosition) as 'left' | 'right',
        fallbackToContent: Boolean(config.get('fallbackToContent') ?? DEFAULT_SETTINGS.fallbackToContent),
        fallbackToEmbeds: Boolean(config.get('fallbackToEmbeds') ?? DEFAULT_SETTINGS.fallbackToEmbeds),
        fallbackToCtime: Boolean(config.get('fallbackToCtime') ?? DEFAULT_SETTINGS.fallbackToCtime),
        fallbackToMtime: Boolean(config.get('fallbackToMtime') ?? DEFAULT_SETTINGS.fallbackToMtime),
        metadataDisplayLeft: String(config.get('metadataDisplayLeft') || DEFAULT_SETTINGS.metadataDisplayLeft) as 'none' | 'timestamp' | 'tags' | 'path',
        metadataDisplayRight: String(config.get('metadataDisplayRight') || DEFAULT_SETTINGS.metadataDisplayRight) as 'none' | 'timestamp' | 'tags' | 'path',
        metadataDisplayWinner: null, // Computed at runtime by view instances
        listMarker: String(config.get('listMarker') || DEFAULT_SETTINGS.listMarker) as 'bullet' | 'number',
        showTimestampIcon: Boolean(config.get('showTimestampIcon') ?? DEFAULT_SETTINGS.showTimestampIcon),
        minMasonryColumns: Number(config.get('minMasonryColumns') || DEFAULT_SETTINGS.minMasonryColumns),
        randomizeAction: String(config.get('randomizeAction') || DEFAULT_SETTINGS.randomizeAction) as 'shuffle' | 'random',
        thumbnailCacheSize: String(config.get('thumbnailCacheSize') || DEFAULT_SETTINGS.thumbnailCacheSize) as 'small' | 'balanced' | 'large',
        queryHeight: 0, // Not configurable in Bases
        openFileAction: String(config.get('openFileAction') || DEFAULT_SETTINGS.openFileAction) as 'card' | 'title',
        addCardBackground: Boolean(config.get('addCardBackground') ?? DEFAULT_SETTINGS.addCardBackground)
    };
}
