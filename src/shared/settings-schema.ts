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
    return [
        {
            type: 'property',
            displayName: 'Metadata item one',
            key: 'metadataDisplay1',
            placeholder: 'Select property',
            default: ''
        },
        {
            type: 'property',
            displayName: 'Metadata item two',
            key: 'metadataDisplay2',
            placeholder: 'Select property',
            default: ''
        },
        {
            type: 'toggle',
            displayName: 'Show items one and two side-by-side',
            key: 'metadataLayout12SideBySide',
            default: DEFAULT_VIEW_SETTINGS.metadataLayout12SideBySide
        },
        {
            type: 'property',
            displayName: 'Metadata item three',
            key: 'metadataDisplay3',
            placeholder: 'Select property',
            default: ''
        },
        {
            type: 'property',
            displayName: 'Metadata item four',
            key: 'metadataDisplay4',
            placeholder: 'Select property',
            default: ''
        },
        {
            type: 'toggle',
            displayName: 'Show items three and four side-by-side',
            key: 'metadataLayout34SideBySide',
            default: DEFAULT_VIEW_SETTINGS.metadataLayout34SideBySide
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
        metadataDisplay1: (() => {
            const value = config.get('metadataDisplay1');
            // If value is explicitly set (including empty string), use it
            if (value !== undefined && value !== null) {
                return typeof value === 'string' ? value : '';
            }
            // For Bases views, default to empty (no metadata shown)
            return '';
        })(),
        metadataDisplay2: (() => {
            const value = config.get('metadataDisplay2');
            if (value !== undefined && value !== null) {
                return typeof value === 'string' ? value : '';
            }
            return '';
        })(),
        metadataDisplay3: (() => {
            const value = config.get('metadataDisplay3');
            if (value !== undefined && value !== null) {
                return typeof value === 'string' ? value : '';
            }
            return '';
        })(),
        metadataDisplay4: (() => {
            const value = config.get('metadataDisplay4');
            if (value !== undefined && value !== null) {
                return typeof value === 'string' ? value : '';
            }
            return '';
        })(),
        metadataLayout12SideBySide: Boolean(config.get('metadataLayout12SideBySide') ?? defaultViewSettings.metadataLayout12SideBySide),
        metadataLayout34SideBySide: Boolean(config.get('metadataLayout34SideBySide') ?? defaultViewSettings.metadataLayout34SideBySide),
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
        openRandomInNewPane: globalSettings.openRandomInNewPane, // From global settings
        showShuffleInRibbon: globalSettings.showShuffleInRibbon, // From global settings
        showRandomInRibbon: globalSettings.showRandomInRibbon // From global settings
    };
}
