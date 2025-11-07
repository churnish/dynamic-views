/**
 * Universal settings schema
 * Defines settings structure for both Bases and Datacore views
 */

import type { Settings, DefaultViewSettings } from '../types';
import { DEFAULT_SETTINGS, DEFAULT_VIEW_SETTINGS } from '../constants';

// Bases config object interface
interface BasesConfig {
    get(key: string): unknown;
}

// Plugin instance interface
interface PluginInstance {
    persistenceManager: {
        getGlobalSettings(): Settings;
        getDefaultViewSettings(): DefaultViewSettings;
    };
}

// Module-level reference to plugin for accessing template settings
let _pluginInstance: PluginInstance | null = null;

export function setPluginInstance(plugin: PluginInstance): void {
    _pluginInstance = plugin;
}

/**
 * Bases view options for card/masonry views
 * These options appear in the Bases view configuration menu
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Bases API requires untyped options array
export function getBasesViewOptions(): any[] {
    // Use static defaults from DEFAULT_VIEW_SETTINGS
    // The template values will be used as fallbacks in readBasesSettings() instead
    return [
        {
            type: 'dropdown',
            displayName: 'Metadata display (left)',
            key: 'metadataDisplayLeft',
            default: DEFAULT_VIEW_SETTINGS.metadataDisplayLeft,
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
            default: DEFAULT_VIEW_SETTINGS.metadataDisplayRight,
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
            default: DEFAULT_VIEW_SETTINGS.titleProperty
        },
        {
            type: 'toggle',
            displayName: 'Show text preview',
            key: 'showTextPreview',
            default: DEFAULT_VIEW_SETTINGS.showTextPreview
        },
        {
            type: 'text',
            displayName: 'Text preview property',
            key: 'descriptionProperty',
            placeholder: 'Comma-separated if multiple',
            default: DEFAULT_VIEW_SETTINGS.descriptionProperty
        },
        {
            type: 'toggle',
            displayName: 'Use note content if text preview property unavailable',
            key: 'fallbackToContent',
            default: DEFAULT_VIEW_SETTINGS.fallbackToContent
        },
        {
            type: 'toggle',
            displayName: 'Show thumbnails',
            key: 'showThumbnails',
            default: DEFAULT_VIEW_SETTINGS.showThumbnails
        },
        {
            type: 'text',
            displayName: 'Image property',
            key: 'imageProperty',
            placeholder: 'Comma-separated if multiple',
            default: DEFAULT_VIEW_SETTINGS.imageProperty
        },
        {
            type: 'toggle',
            displayName: 'Use in-note images if image property unavailable',
            key: 'fallbackToEmbeds',
            default: DEFAULT_VIEW_SETTINGS.fallbackToEmbeds
        },
    ];
}

/**
 * Additional options specific to masonry view
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Bases API requires untyped options array
export function getMasonryViewOptions(): any[] {
    return getBasesViewOptions();
}

/**
 * Read settings from Bases config
 * Maps Bases config values to Settings object
 */
export function readBasesSettings(config: BasesConfig, globalSettings: Settings, defaultViewSettings: DefaultViewSettings): Settings {
    const titlePropertyValue = config.get('titleProperty');
    const descriptionPropertyValue = config.get('descriptionProperty');
    const imagePropertyValue = config.get('imageProperty');

    return {
        titleProperty: typeof titlePropertyValue === 'string' ? titlePropertyValue : defaultViewSettings.titleProperty,
        descriptionProperty: typeof descriptionPropertyValue === 'string' ? descriptionPropertyValue : defaultViewSettings.descriptionProperty,
        imageProperty: typeof imagePropertyValue === 'string' ? imagePropertyValue : defaultViewSettings.imageProperty,
        createdProperty: globalSettings.createdProperty, // From global settings
        modifiedProperty: globalSettings.modifiedProperty, // From global settings
        omitFirstLine: globalSettings.omitFirstLine, // From global settings
        showTextPreview: Boolean(config.get('showTextPreview') ?? defaultViewSettings.showTextPreview),
        showThumbnails: Boolean(config.get('showThumbnails') ?? defaultViewSettings.showThumbnails),
        fallbackToContent: Boolean(config.get('fallbackToContent') ?? defaultViewSettings.fallbackToContent),
        fallbackToEmbeds: Boolean(config.get('fallbackToEmbeds') ?? defaultViewSettings.fallbackToEmbeds),
        fallbackToCtime: Boolean(config.get('fallbackToCtime') ?? DEFAULT_SETTINGS.fallbackToCtime),
        fallbackToMtime: Boolean(config.get('fallbackToMtime') ?? DEFAULT_SETTINGS.fallbackToMtime),
        metadataDisplayLeft: (() => {
            const value = config.get('metadataDisplayLeft');
            return (typeof value === 'string' ? value : defaultViewSettings.metadataDisplayLeft) as 'none' | 'timestamp' | 'tags' | 'path';
        })(),
        metadataDisplayRight: (() => {
            const value = config.get('metadataDisplayRight');
            return (typeof value === 'string' ? value : defaultViewSettings.metadataDisplayRight) as 'none' | 'timestamp' | 'tags' | 'path';
        })(),
        metadataDisplayWinner: null, // Computed at runtime by view instances
        timestampDisplay: globalSettings.timestampDisplay, // From global settings
        listMarker: (() => {
            const value = config.get('listMarker');
            return (typeof value === 'string' ? value : DEFAULT_SETTINGS.listMarker) as 'bullet' | 'number';
        })(),
        randomizeAction: (() => {
            const value = config.get('randomizeAction');
            return (typeof value === 'string' ? value : DEFAULT_SETTINGS.randomizeAction) as 'shuffle' | 'random';
        })(),
        thumbnailCacheSize: globalSettings.thumbnailCacheSize, // From global settings
        queryHeight: 0, // Not configurable in Bases
        openFileAction: globalSettings.openFileAction, // From global settings
        openRandomInNewPane: globalSettings.openRandomInNewPane // From global settings
    };
}
