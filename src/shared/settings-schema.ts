/**
 * Universal settings schema
 * Defines settings structure for both Bases and Datacore views
 */

import type { Settings, DefaultViewSettings } from '../types';
import { DEFAULT_SETTINGS, DEFAULT_VIEW_SETTINGS } from '../constants';

// Module-level reference to plugin for accessing template settings
let pluginInstance: any = null;

export function setPluginInstance(plugin: any): void {
    pluginInstance = plugin;
}

/**
 * Bases view options for card/masonry views
 * These options appear in the Bases view configuration menu
 */
export function getBasesViewOptions(): any[] {
    // Get template settings if available
    const template = pluginInstance?.persistenceManager?.getDefaultViewSettings() || DEFAULT_VIEW_SETTINGS;

    return [
        {
            type: 'dropdown',
            displayName: 'Metadata display (left)',
            key: 'metadataDisplayLeft',
            default: template.metadataDisplayLeft,
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
            default: template.metadataDisplayRight,
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
            placeholder: 'Comma-separated if multiple',
            default: template.titleProperty
        },
        {
            type: 'toggle',
            displayName: 'Show text preview',
            key: 'showTextPreview',
            default: template.showTextPreview
        },
        {
            type: 'text',
            displayName: 'Text preview property',
            key: 'descriptionProperty',
            placeholder: 'Comma-separated if multiple',
            default: template.descriptionProperty
        },
        {
            type: 'toggle',
            displayName: 'Use note content if text preview property unavailable',
            key: 'fallbackToContent',
            default: template.fallbackToContent
        },
        {
            type: 'toggle',
            displayName: 'Show thumbnails',
            key: 'showThumbnails',
            default: template.showThumbnails
        },
        {
            type: 'text',
            displayName: 'Image property',
            key: 'imageProperty',
            placeholder: 'Comma-separated if multiple',
            default: template.imageProperty
        },
        {
            type: 'toggle',
            displayName: 'Use in-note images if image property unavailable',
            key: 'fallbackToEmbeds',
            default: template.fallbackToEmbeds
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
export function readBasesSettings(config: any, globalSettings: Settings, defaultViewSettings: DefaultViewSettings): Settings {
    return {
        minCardWidth: globalSettings.minCardWidth, // From global settings
        titleProperty: String(config.get('titleProperty') || defaultViewSettings.titleProperty),
        descriptionProperty: String(config.get('descriptionProperty') || defaultViewSettings.descriptionProperty),
        imageProperty: String(config.get('imageProperty') || defaultViewSettings.imageProperty),
        createdProperty: globalSettings.createdProperty, // From global settings
        modifiedProperty: globalSettings.modifiedProperty, // From global settings
        omitFirstLine: globalSettings.omitFirstLine, // From global settings
        showTextPreview: Boolean(config.get('showTextPreview') ?? defaultViewSettings.showTextPreview),
        showThumbnails: Boolean(config.get('showThumbnails') ?? defaultViewSettings.showThumbnails),
        thumbnailPosition: globalSettings.thumbnailPosition, // From global settings
        fallbackToContent: Boolean(config.get('fallbackToContent') ?? defaultViewSettings.fallbackToContent),
        fallbackToEmbeds: Boolean(config.get('fallbackToEmbeds') ?? defaultViewSettings.fallbackToEmbeds),
        fallbackToCtime: Boolean(config.get('fallbackToCtime') ?? DEFAULT_SETTINGS.fallbackToCtime),
        fallbackToMtime: Boolean(config.get('fallbackToMtime') ?? DEFAULT_SETTINGS.fallbackToMtime),
        metadataDisplayLeft: String(config.get('metadataDisplayLeft') || defaultViewSettings.metadataDisplayLeft) as 'none' | 'timestamp' | 'tags' | 'path',
        metadataDisplayRight: String(config.get('metadataDisplayRight') || defaultViewSettings.metadataDisplayRight) as 'none' | 'timestamp' | 'tags' | 'path',
        metadataDisplayWinner: null, // Computed at runtime by view instances
        timestampDisplay: globalSettings.timestampDisplay, // From global settings
        listMarker: String(config.get('listMarker') || DEFAULT_SETTINGS.listMarker) as 'bullet' | 'number',
        showTimestampIcon: globalSettings.showTimestampIcon, // From global settings
        minMasonryColumns: globalSettings.minMasonryColumns, // From global settings
        minGridColumns: globalSettings.minGridColumns, // From global settings
        randomizeAction: String(config.get('randomizeAction') || DEFAULT_SETTINGS.randomizeAction) as 'shuffle' | 'random',
        thumbnailCacheSize: globalSettings.thumbnailCacheSize, // From global settings
        queryHeight: 0, // Not configurable in Bases
        openFileAction: globalSettings.openFileAction, // From global settings
        addCardBackground: globalSettings.addCardBackground // From global settings
    };
}
