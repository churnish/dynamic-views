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
            type: 'slider',
            displayName: 'Card size',
            key: 'cardSize',
            min: 50,
            max: 800,
            step: 10,
            default: DEFAULT_VIEW_SETTINGS.cardSize
        },
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
            displayName: 'Use note content if text preview property missing or empty',
            key: 'fallbackToContent',
            default: DEFAULT_VIEW_SETTINGS.fallbackToContent
        },
        {
            type: 'dropdown',
            displayName: 'Image format',
            key: 'imageFormat',
            options: {
                'thumbnail': 'Thumbnail',
                'cover': 'Cover',
                'none': 'None'
            },
            default: 'thumbnail'
        },
        {
            type: 'dropdown',
            displayName: 'Image position',
            key: 'imagePosition',
            options: {
                'left': 'Left',
                'right': 'Right',
                'top': 'Top',
                'bottom': 'Bottom'
            },
            default: 'right'
        },
        {
            type: 'text',
            displayName: 'Image property',
            key: 'imageProperty',
            placeholder: 'Comma-separated if multiple',
            default: DEFAULT_VIEW_SETTINGS.imageProperty
        },
        {
            type: 'dropdown',
            displayName: 'Show image embeds',
            key: 'fallbackToEmbeds',
            options: {
                'always': 'Always',
                'if-empty': 'If image property missing or empty',
                'never': 'Never'
            },
            default: 'always'
        },
        {
            type: 'dropdown',
            displayName: 'Image fit',
            key: 'coverFitMode',
            options: {
                'crop': 'Crop',
                'contain': 'Contain'
            },
            default: 'crop'
        },
        {
            type: 'slider',
            displayName: 'Image ratio',
            key: 'imageAspectRatio',
            min: 0.25,
            max: 2.5,
            step: 0.05,
            default: DEFAULT_VIEW_SETTINGS.imageAspectRatio
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
            displayName: 'Pair first and second properties',
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
            displayName: 'Pair third and fourth properties',
            key: 'propertyLayout34SideBySide',
            default: DEFAULT_VIEW_SETTINGS.propertyLayout34SideBySide
        },
        {
            type: 'dropdown',
            displayName: 'Show property labels',
            key: 'propertyLabels',
            options: {
                'inline': 'Inline',
                'above': 'On top',
                'hide': 'Hide'
            },
            default: DEFAULT_VIEW_SETTINGS.propertyLabels
        }
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
        fallbackToEmbeds: (() => {
            const value = config.get('fallbackToEmbeds');
            return (value === 'always' || value === 'if-empty' || value === 'never') ? value : defaultViewSettings.fallbackToEmbeds;
        })(),
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
        propertyLabels: (() => {
            const value = config.get('propertyLabels');
            return (value === 'hide' || value === 'inline' || value === 'above') ? value : defaultViewSettings.propertyLabels;
        })(),
        imageFormat: (() => {
            const rawFormat = config.get('imageFormat');
            const rawPosition = config.get('imagePosition');

            // Handle migration from old compound format (e.g., 'thumbnail-top') to new split format
            let format: 'thumbnail' | 'cover' | 'none' = 'thumbnail';
            let position: 'left' | 'right' | 'top' | 'bottom' = 'right';

            if (rawFormat === 'thumbnail' || rawFormat === 'cover' || rawFormat === 'none') {
                // New format: imageFormat is just the format part
                format = rawFormat;
            } else if (typeof rawFormat === 'string' && rawFormat.includes('-')) {
                // Old compound format: extract both parts from imageFormat
                const parts = rawFormat.split('-');
                const formatPart = parts[0];
                format = (formatPart === 'thumbnail' || formatPart === 'cover' || formatPart === 'none') ? formatPart : 'thumbnail';
                // If we have an old compound format, extract position from it (unless overridden by new imagePosition setting)
                const oldPosition = parts[1];
                position = (rawPosition === 'left' || rawPosition === 'right' || rawPosition === 'top' || rawPosition === 'bottom')
                    ? rawPosition
                    : ((oldPosition === 'left' || oldPosition === 'right' || oldPosition === 'top' || oldPosition === 'bottom') ? oldPosition : 'right');
            }

            if (format === 'none') return 'none';

            // Use rawPosition if it exists, otherwise keep the position extracted above (or default)
            if (rawPosition === 'left' || rawPosition === 'right' || rawPosition === 'top' || rawPosition === 'bottom') {
                position = rawPosition;
            }

            return `${format}-${position}` as typeof defaultViewSettings.imageFormat;
        })(),
        coverFitMode: (() => {
            const value = config.get('coverFitMode');
            return (value === 'crop' || value === 'contain') ? value : defaultViewSettings.coverFitMode;
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
        expandImagesOnClick: globalSettings.expandImagesOnClick, // From global settings
        cardSize: (() => {
            const value = config.get('cardSize');
            return (typeof value === 'number') ? value : defaultViewSettings.cardSize;
        })(),
        imageAspectRatio: (() => {
            const value = config.get('imageAspectRatio');
            return (typeof value === 'number') ? value : defaultViewSettings.imageAspectRatio;
        })()
    };
}
