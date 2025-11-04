/**
 * Universal settings schema
 * Defines settings structure for both Bases and Datacore views
 */

import type { Settings } from '../types';

/** Default settings used by both Bases and Datacore */
export const DEFAULT_SETTINGS: Settings = {
    titleProperty: "title",
    descriptionProperty: "description",
    imageProperty: "cover",
    alwaysOmitFirstLine: false,
    showTextPreview: true,
    showThumbnails: true,
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
            type: 'property',
            displayName: 'Title property',
            key: 'titleProperty',
            default: 'title',
            placeholder: 'Property name for card title'
        },
        {
            type: 'property',
            displayName: 'Description property',
            key: 'descriptionProperty',
            default: 'description',
            placeholder: 'Property name for description'
        },
        {
            type: 'property',
            displayName: 'Image property',
            key: 'imageProperty',
            default: 'cover',
            placeholder: 'Property name for cover image'
        },
        {
            type: 'toggle',
            displayName: 'Show text preview',
            key: 'showTextPreview',
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
        alwaysOmitFirstLine: Boolean(config.get('alwaysOmitFirstLine')),
        showTextPreview: Boolean(config.get('showTextPreview') ?? DEFAULT_SETTINGS.showTextPreview),
        showThumbnails: Boolean(config.get('showThumbnails') ?? DEFAULT_SETTINGS.showThumbnails),
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
