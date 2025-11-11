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
            type: 'toggle',
            displayName: 'Show title',
            key: 'showTitle',
            default: DEFAULT_VIEW_SETTINGS.showTitle
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
            type: 'dropdown',
            displayName: 'Card image',
            key: 'imageFormat',
            options: {
                'none': 'No image',
                'thumbnail': 'Thumbnail',
                'cover': 'Cover'
            },
            default: 'thumbnail'
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
        {
            type: 'property',
            displayName: 'First property',
            key: 'propertyDisplay1',
            placeholder: 'Select property',
            default: ''
        },
        {
            type: 'property',
            displayName: 'Second property',
            key: 'propertyDisplay2',
            placeholder: 'Select property',
            default: ''
        },
        {
            type: 'toggle',
            displayName: 'Show first and second properties side-by-side',
            key: 'propertyLayout12SideBySide',
            default: DEFAULT_VIEW_SETTINGS.propertyLayout12SideBySide
        },
        {
            type: 'property',
            displayName: 'Third property',
            key: 'propertyDisplay3',
            placeholder: 'Select property',
            default: ''
        },
        {
            type: 'property',
            displayName: 'Fourth property',
            key: 'propertyDisplay4',
            placeholder: 'Select property',
            default: ''
        },
        {
            type: 'toggle',
            displayName: 'Show third and fourth properties side-by-side',
            key: 'propertyLayout34SideBySide',
            default: DEFAULT_VIEW_SETTINGS.propertyLayout34SideBySide
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
        omitFirstLine: globalSettings.omitFirstLine, // From global settings
        showTitle: Boolean(config.get('showTitle') ?? defaultViewSettings.showTitle),
        showTextPreview: Boolean(config.get('showTextPreview') ?? defaultViewSettings.showTextPreview),
        fallbackToContent: Boolean(config.get('fallbackToContent') ?? defaultViewSettings.fallbackToContent),
        fallbackToEmbeds: Boolean(config.get('fallbackToEmbeds') ?? defaultViewSettings.fallbackToEmbeds),
        propertyDisplay1: (() => {
            const value = config.get('propertyDisplay1');
            // If value is explicitly set (including empty string), use it
            if (value !== undefined && value !== null) {
                return typeof value === 'string' ? value : '';
            }
            // For Bases views, default to empty (no properties shown)
            return '';
        })(),
        propertyDisplay2: (() => {
            const value = config.get('propertyDisplay2');
            if (value !== undefined && value !== null) {
                return typeof value === 'string' ? value : '';
            }
            return '';
        })(),
        propertyDisplay3: (() => {
            const value = config.get('propertyDisplay3');
            if (value !== undefined && value !== null) {
                return typeof value === 'string' ? value : '';
            }
            return '';
        })(),
        propertyDisplay4: (() => {
            const value = config.get('propertyDisplay4');
            if (value !== undefined && value !== null) {
                return typeof value === 'string' ? value : '';
            }
            return '';
        })(),
        propertyLayout12SideBySide: Boolean(config.get('propertyLayout12SideBySide') ?? defaultViewSettings.propertyLayout12SideBySide),
        propertyLayout34SideBySide: Boolean(config.get('propertyLayout34SideBySide') ?? defaultViewSettings.propertyLayout34SideBySide),
        imageFormat: (() => {
            const value = config.get('imageFormat');
            return (value === 'none' || value === 'thumbnail' || value === 'cover') ? value : defaultViewSettings.imageFormat;
        })(),
        timestampFormat: globalSettings.timestampFormat, // From global settings
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
        showRandomInRibbon: globalSettings.showRandomInRibbon, // From global settings
        smartTimestamp: globalSettings.smartTimestamp, // From global settings
        createdTimeProperty: globalSettings.createdTimeProperty, // From global settings
        modifiedTimeProperty: globalSettings.modifiedTimeProperty, // From global settings
        fallbackToFileMetadata: globalSettings.fallbackToFileMetadata, // From global settings
        expandImagesOnClick: globalSettings.expandImagesOnClick // From global settings
    };
}
