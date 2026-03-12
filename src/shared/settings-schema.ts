/**
 * Universal settings schema
 * Defines settings structure for both Bases and Datacore views
 */

import type {
  BasesPropertyId,
  BasesViewConfig,
  BasesAllOptions,
} from 'obsidian';
import type {
  PluginSettings,
  ViewDefaults,
  BasesResolvedSettings,
} from '../types';
import { VIEW_DEFAULTS, BASES_DEFAULTS } from '../constants';
import { VALID_VIEW_VALUES } from './view-validation';
import { stripNotePrefix } from '../utils/property';

/** Minimal Bases config interface — subset of BasesViewConfig used by settings readers */
interface BasesConfig {
  get(key: string): unknown;
  getOrder(): string[];
}

/**
 * Bases view options for card/masonry views
 * These options appear in the Bases view configuration menu
 *
 * Called by Obsidian BEFORE the view constructor — schema defaults determine
 * what new views show in the settings GUI. When a template exists, its values
 * replace the static defaults so new views immediately reflect template settings.
 *
 * @param viewType - "grid" or "masonry" to look up the correct settings template
 * @param config - Runtime config passed by Obsidian (undocumented — official type says no param)
 */
export function getBasesViewOptions(
  viewType?: 'grid' | 'masonry',
  config?: BasesViewConfig
): BasesAllOptions[] {
  // Merge settings template into defaults for NEW views only.
  // Existing views (have an id from cleanUpBaseFile) use plain defaults —
  // otherwise template-polluted defaults override user-cleared settings.
  const d = { ...VIEW_DEFAULTS, ...BASES_DEFAULTS };
  if (viewType) {
    try {
      const plugin = window.app?.plugins?.plugins?.['dynamic-views'];
      const pm = (
        plugin as unknown as {
          persistenceManager?: {
            getSettingsTemplate(
              viewType: string
            ): { settings?: Record<string, unknown> } | undefined;
          };
        }
      )?.persistenceManager;
      if (pm) {
        // Must agree with readBasesSettings(templateOverrides) and
        // cleanUpBaseFile()'s YAML template injection on "new view" detection.
        const isNewView = !config || config.get('id') == null;
        if (isNewView) {
          const template = pm.getSettingsTemplate(viewType);
          if (template) {
            Object.assign(d, template);
          }
        }
      }
    } catch {
      // Plugin not ready yet — use static defaults
    }
  }

  // Cache property registry once (used by imageProperty filter)
  const propertyInfos = window.app?.metadataCache?.getAllPropertyInfos?.() as
    | Record<string, { widget?: string }>
    | undefined;

  /** Properties currently displayed as title/subtitle (position-based). */
  function getPositionTitleProps(): Set<string> {
    if (!config) return new Set();
    const rawFirst = config.get('displayFirstAsTitle');
    const displayFirst =
      typeof rawFirst === 'boolean' ? rawFirst : d.displayFirstAsTitle;
    if (!displayFirst) return new Set();

    const order = config.getOrder();
    const configStr = (key: string, fallback: string): string => {
      const v = config.get(key);
      return typeof v === 'string' ? v : fallback;
    };
    const special = new Set(
      [
        configStr('textPreviewProperty', d.textPreviewProperty),
        configStr('urlProperty', d.urlProperty),
        configStr('imageProperty', d.imageProperty),
      ].filter(Boolean)
    );
    const candidates = special.size
      ? order.filter((id) => !special.has(String(id)))
      : order;

    const result = new Set<string>();
    if (candidates[0]) {
      result.add(String(candidates[0]));
      const rawSecond = config.get('displaySecondAsSubtitle');
      const displaySecond =
        typeof rawSecond === 'boolean' ? rawSecond : d.displaySecondAsSubtitle;
      if (displaySecond && candidates[1]) {
        result.add(String(candidates[1]));
      }
    }
    return result;
  }

  const schema = [
    {
      type: 'slider',
      displayName: 'Card size',
      key: 'cardSize',
      min: 50,
      max: 800,
      step: 10,
      default: d.cardSize,
    },
    {
      type: 'group',
      displayName: 'Title',
      items: [
        {
          type: 'toggle',
          displayName: 'Display first property as title',
          key: 'displayFirstAsTitle',
          default: d.displayFirstAsTitle,
        },
        {
          type: 'slider',
          displayName: 'Lines',
          key: 'titleLines',
          min: 1,
          max: 5,
          step: 1,
          default: d.titleLines,
          shouldHide: (config: BasesConfig) =>
            (config.get('displayFirstAsTitle') ?? d.displayFirstAsTitle) ===
            false,
        },
        {
          type: 'toggle',
          displayName: 'Display second property as subtitle',
          key: 'displaySecondAsSubtitle',
          default: d.displaySecondAsSubtitle,
          shouldHide: (config: BasesConfig) =>
            (config.get('displayFirstAsTitle') ?? d.displayFirstAsTitle) ===
            false,
        },
      ],
    },
    {
      type: 'group',
      displayName: 'Text preview',
      items: [
        {
          type: 'property',
          displayName: 'Text preview property',
          key: 'textPreviewProperty',
          placeholder: 'Visible property',
          default: d.textPreviewProperty,
          filter: (prop: BasesPropertyId) =>
            config
              ? config.getOrder().some((id) => String(id) === String(prop)) &&
                !getPositionTitleProps().has(String(prop))
              : true,
        },
        {
          type: 'toggle',
          displayName: 'Show note content if property unavailable',
          key: 'fallbackToContent',
          default: d.fallbackToContent,
        },
        {
          type: 'slider',
          displayName: 'Lines',
          key: 'textPreviewLines',
          min: 1,
          max: 10,
          step: 1,
          default: d.textPreviewLines,
          shouldHide: (config: BasesConfig) =>
            !(config.get('textPreviewProperty') ?? d.textPreviewProperty) &&
            (config.get('fallbackToContent') ?? d.fallbackToContent) === false,
        },
      ],
    },
    {
      type: 'group',
      displayName: 'Image',
      items: [
        {
          type: 'property',
          displayName: 'Image property',
          key: 'imageProperty',
          placeholder: 'Property',
          default: d.imageProperty,
          filter: (prop: BasesPropertyId) => {
            if (prop.startsWith('file.')) return false;
            if (prop.startsWith('formula.')) return true;
            if (!propertyInfos) return true;
            const widget = propertyInfos[stripNotePrefix(prop)]?.widget;
            return !widget || widget === 'text' || widget === 'multitext';
          },
        },
        {
          type: 'dropdown',
          displayName: 'Show image embeds',
          key: 'fallbackToEmbeds',
          options: {
            always: 'Always',
            'if-unavailable': 'If property unavailable',
            never: 'Never',
          },
          default: d.fallbackToEmbeds,
        },
        {
          type: 'dropdown',
          displayName: 'Format',
          key: 'imageFormat',
          options: {
            thumbnail: 'Thumbnail',
            cover: 'Cover',
            poster: 'Poster',
            backdrop: 'Backdrop',
          },
          default: d.imageFormat,
          shouldHide: (config: BasesConfig) =>
            !(config.get('imageProperty') || d.imageProperty) &&
            (config.get('fallbackToEmbeds') ?? d.fallbackToEmbeds) === 'never',
        },
        {
          type: 'dropdown',
          displayName: 'Display mode',
          key: 'posterDisplayMode',
          options: {
            fade: 'Fade',
            overlay: 'Overlay',
          },
          default: d.posterDisplayMode,
          shouldHide: (config: BasesConfig) =>
            (config.get('imageFormat') ?? d.imageFormat) !== 'poster' ||
            (!(config.get('imageProperty') || d.imageProperty) &&
              (config.get('fallbackToEmbeds') ?? d.fallbackToEmbeds) ===
                'never'),
        },
        {
          type: 'slider',
          displayName: 'Size',
          key: 'thumbnailSize',
          min: 64,
          max: 128,
          step: 1,
          default: d.thumbnailSize,
          shouldHide: (config: BasesConfig) =>
            (config.get('imageFormat') ?? d.imageFormat) !== 'thumbnail' ||
            (!(config.get('imageProperty') || d.imageProperty) &&
              (config.get('fallbackToEmbeds') ?? d.fallbackToEmbeds) ===
                'never'),
        },
        {
          type: 'dropdown',
          displayName: 'Position',
          key: 'imagePosition',
          options: {
            left: 'Left',
            right: 'Right',
            top: 'Top',
            bottom: 'Bottom',
          },
          default: d.imagePosition,
          shouldHide: (config: BasesConfig) =>
            (config.get('imageFormat') ?? d.imageFormat) === 'poster' ||
            (config.get('imageFormat') ?? d.imageFormat) === 'backdrop' ||
            (!(config.get('imageProperty') || d.imageProperty) &&
              (config.get('fallbackToEmbeds') ?? d.fallbackToEmbeds) ===
                'never'),
        },
        {
          type: 'dropdown',
          displayName: 'Fit',
          key: 'imageFit',
          options: {
            crop: 'Crop',
            contain: 'Contain',
          },
          default: d.imageFit,
          shouldHide: (config: BasesConfig) =>
            (config.get('imageFormat') ?? d.imageFormat) === 'backdrop' ||
            (!(config.get('imageProperty') || d.imageProperty) &&
              (config.get('fallbackToEmbeds') ?? d.fallbackToEmbeds) ===
                'never'),
        },
        {
          type: 'slider',
          displayName: 'Ratio',
          key: 'imageRatio',
          min: 0.25,
          max: 2.5,
          step: 0.05,
          default: d.imageRatio,
          shouldHide: (config: BasesConfig) =>
            (config.get('imageFormat') ?? d.imageFormat) === 'backdrop' ||
            (!(config.get('imageProperty') || d.imageProperty) &&
              (config.get('fallbackToEmbeds') ?? d.fallbackToEmbeds) ===
                'never'),
        },
      ],
    },
    {
      type: 'group',
      displayName: 'Properties',
      items: [
        {
          type: 'dropdown',
          displayName: 'Property labels',
          key: 'propertyLabels',
          options: {
            above: 'Above',
            inline: 'Inline',
            hide: 'Hide',
          },
          default: d.propertyLabels,
          shouldHide: (config: BasesConfig) => config.getOrder().length === 0,
        },
        {
          type: 'property',
          displayName: 'URL property',
          key: 'urlProperty',
          placeholder: 'Visible property',
          default: d.urlProperty,
          filter: (prop: BasesPropertyId) =>
            config
              ? config.getOrder().some((id) => String(id) === String(prop)) &&
                !getPositionTitleProps().has(String(prop))
              : true,
        },
        {
          type: 'toggle',
          displayName: 'Pair properties',
          key: 'pairProperties',
          default: d.pairProperties,
          shouldHide: (config: BasesConfig) => config.getOrder().length <= 1,
        },
        {
          type: 'dropdown',
          displayName: 'Right property position',
          key: 'rightPropertyPosition',
          options: {
            left: 'Left',
            column: 'Column',
            right: 'Right',
          },
          default: d.rightPropertyPosition,
          shouldHide: (config: BasesConfig) =>
            config.getOrder().length <= 1 ||
            (config.get('pairProperties') ?? d.pairProperties) === false,
        },
        {
          type: 'text',
          displayName: 'Invert pairing for property',
          key: 'invertPropertyPairing',
          placeholder: 'Comma-separated if multiple',
          default: d.invertPropertyPairing,
          shouldHide: (config: BasesConfig) => config.getOrder().length <= 1,
        },
      ],
    },
    {
      type: 'group',
      displayName: 'Other',
      items: [
        {
          type: 'dropdown',
          displayName: 'Minimum columns',
          key: 'minimumColumns',
          options: {
            one: 'One',
            two: 'Two',
          },
          default: viewType === 'masonry' ? 'two' : 'one',
        },
        {
          type: 'text',
          displayName: 'cssclasses',
          key: 'cssclasses',
          placeholder: 'Comma-separated if multiple',
          default: d.cssclasses,
        },
        {
          type: 'toggle',
          displayName: 'Save as default settings',
          key: 'isTemplate',
          default: false,
        },
      ],
    },
  ];
  // Schema objects use widened string types; assertion is safe because
  // the literal structure matches BasesAllOptions discriminated union members.
  return schema as BasesAllOptions[];
}

/**
 * Additional options specific to masonry view
 */
export function getMasonryViewOptions(
  config?: BasesViewConfig
): BasesAllOptions[] {
  return getBasesViewOptions('masonry', config);
}

/** Type-safe config value getters with fallback to defaults */
function createConfigGetters(config: BasesConfig) {
  return {
    // Empty string "" is a valid user choice (intentionally cleared field)
    getString: (key: string, fallback: string): string => {
      const value = config.get(key);
      if (value !== undefined && value !== null) {
        return typeof value === 'string' ? value : fallback;
      }
      return fallback;
    },
    getBool: (key: string, fallback: boolean): boolean => {
      const value = config.get(key);
      return typeof value === 'boolean' ? value : fallback;
    },
    getNumber: (key: string, fallback: number): number => {
      const value = config.get(key);
      return typeof value === 'number' && Number.isFinite(value)
        ? value
        : fallback;
    },
  };
}

/** Validate a config value against VALID_VIEW_VALUES, with optional stale config fallback */
function getValidEnum<T extends string>(
  config: BasesConfig,
  field: keyof typeof VALID_VIEW_VALUES,
  defaultValue: T,
  previousValue?: T
): T {
  const value = config.get(field as string);
  const valid = VALID_VIEW_VALUES[field];
  if (valid?.includes(value as string)) return value as T;
  if (previousValue !== undefined) return previousValue;
  return defaultValue;
}

/**
 * Read settings from Bases config
 * Maps Bases config values to BasesResolvedSettings by merging:
 *   VIEW_DEFAULTS (overridden by config) + pluginSettings
 *
 * @param previousSettings - Optional previous settings to use as fallback when
 *   config.get() returns undefined. This prevents stale Obsidian updates from
 *   reverting user settings to defaults.
 */
export function readBasesSettings(
  config: BasesConfig,
  pluginSettings: PluginSettings,
  viewType?: 'grid' | 'masonry',
  previousSettings?: Partial<BasesResolvedSettings>,
  templateOverrides?: Partial<ViewDefaults>
): BasesResolvedSettings {
  // Template overrides serve as fallbacks for new views whose config isn't populated yet
  const defaults = {
    ...VIEW_DEFAULTS,
    ...BASES_DEFAULTS,
    ...templateOverrides,
  };

  const { getString, getBool, getNumber } = createConfigGetters(config);

  // Read special-purpose properties first (needed to exclude from title/subtitle)
  let textPreviewProperty = getString(
    'textPreviewProperty',
    defaults.textPreviewProperty
  );
  let urlProperty = getString('urlProperty', defaults.urlProperty);
  const imageProperty = getString('imageProperty', defaults.imageProperty);

  // Position-based title/subtitle: derive from getOrder() positions
  // Skip properties with special roles (text preview, URL button, image)
  const displayFirstAsTitle = getBool(
    'displayFirstAsTitle',
    defaults.displayFirstAsTitle
  );
  const displaySecondAsSubtitle = getBool(
    'displaySecondAsSubtitle',
    defaults.displaySecondAsSubtitle
  );
  const order = config.getOrder();
  const specialProps = new Set(
    [textPreviewProperty, urlProperty, imageProperty].filter(Boolean)
  );
  const candidateOrder = specialProps.size
    ? order.filter((id) => !specialProps.has(String(id)))
    : order;
  let titleProperty = '';
  let subtitleProperty = '';
  let _skipLeadingProperties = 0;
  if (displayFirstAsTitle && candidateOrder[0]) {
    titleProperty = String(candidateOrder[0]);
    _skipLeadingProperties = order.indexOf(candidateOrder[0]) + 1;
    if (displaySecondAsSubtitle && candidateOrder[1]) {
      subtitleProperty = String(candidateOrder[1]);
      _skipLeadingProperties = order.indexOf(candidateOrder[1]) + 1;
    }
  }

  // Properties hidden from the view remain in config but aren't resolved
  const orderSet = new Set(order.map(String));
  if (textPreviewProperty && !orderSet.has(textPreviewProperty))
    textPreviewProperty = '';
  if (urlProperty && !orderSet.has(urlProperty)) urlProperty = '';

  // Read ViewDefaults from Bases config
  // Note: propertyLabels and imageFormat use previousSettings for stale config fallback
  const viewSettings: ViewDefaults = {
    cardSize: getNumber('cardSize', defaults.cardSize),
    titleProperty,
    titleLines: getNumber('titleLines', defaults.titleLines),
    subtitleProperty,
    displayFirstAsTitle,
    displaySecondAsSubtitle,
    textPreviewProperty,
    fallbackToContent: getBool('fallbackToContent', defaults.fallbackToContent),
    textPreviewLines: getNumber('textPreviewLines', defaults.textPreviewLines),
    imageProperty,
    fallbackToEmbeds: getValidEnum(
      config,
      'fallbackToEmbeds',
      defaults.fallbackToEmbeds
    ),
    imageFormat: getValidEnum(
      config,
      'imageFormat',
      defaults.imageFormat,
      previousSettings?.imageFormat
    ),
    thumbnailSize: getNumber('thumbnailSize', defaults.thumbnailSize),
    imagePosition: getValidEnum(
      config,
      'imagePosition',
      defaults.imagePosition
    ),
    imageFit: getValidEnum(config, 'imageFit', defaults.imageFit),
    posterDisplayMode: getValidEnum(
      config,
      'posterDisplayMode',
      defaults.posterDisplayMode
    ),
    imageRatio: getNumber('imageRatio', defaults.imageRatio),
    propertyLabels: getValidEnum(
      config,
      'propertyLabels',
      defaults.propertyLabels,
      previousSettings?.propertyLabels
    ),
    pairProperties: getBool('pairProperties', defaults.pairProperties),
    rightPropertyPosition: getValidEnum(
      config,
      'rightPropertyPosition',
      defaults.rightPropertyPosition
    ),
    invertPropertyPairing: getString(
      'invertPropertyPairing',
      defaults.invertPropertyPairing
    ),
    showPropertiesAbove: defaults.showPropertiesAbove,
    invertPropertyPosition: defaults.invertPropertyPosition,
    urlProperty,
    minimumColumns: (() => {
      const value = config.get('minimumColumns');
      if (value === 'one') return 1;
      if (value === 'two') return 2;
      const fallback = viewType === 'masonry' ? 2 : defaults.minimumColumns;
      return fallback;
    })(),
    cssclasses: getString('cssclasses', defaults.cssclasses),
  };

  // Merge: pluginSettings + config-derived ViewDefaults + computed fields
  return {
    ...pluginSettings,
    ...viewSettings,
    _skipLeadingProperties,
  };
}

/**
 * Extract view-specific settings from Bases config for template storage
 * Only extracts ViewDefaults keys (no Datacore-specific fields)
 * Returns sparse object — only includes values that differ from defaults
 */
export function extractBasesTemplate(
  config: BasesConfig,
  defaults: ViewDefaults,
  viewType: 'grid' | 'masonry'
): Partial<ViewDefaults> {
  // Merge BASES_DEFAULTS so fallbacks and sparse filter use actual Bases defaults
  const mergedDefaults = { ...defaults, ...BASES_DEFAULTS };

  const { getString, getBool, getNumber } = createConfigGetters(config);

  // Extract all values with type coercion
  const full: ViewDefaults = {
    cardSize: getNumber('cardSize', mergedDefaults.cardSize),
    titleProperty: mergedDefaults.titleProperty,
    titleLines: getNumber('titleLines', mergedDefaults.titleLines),
    subtitleProperty: mergedDefaults.subtitleProperty,
    displayFirstAsTitle: getBool(
      'displayFirstAsTitle',
      mergedDefaults.displayFirstAsTitle
    ),
    displaySecondAsSubtitle: getBool(
      'displaySecondAsSubtitle',
      mergedDefaults.displaySecondAsSubtitle
    ),
    textPreviewProperty: getString(
      'textPreviewProperty',
      mergedDefaults.textPreviewProperty
    ),
    fallbackToContent: getBool(
      'fallbackToContent',
      mergedDefaults.fallbackToContent
    ),
    textPreviewLines: getNumber(
      'textPreviewLines',
      mergedDefaults.textPreviewLines
    ),
    imageProperty: getString('imageProperty', mergedDefaults.imageProperty),
    fallbackToEmbeds: getValidEnum(
      config,
      'fallbackToEmbeds',
      mergedDefaults.fallbackToEmbeds
    ),
    imageFormat: getValidEnum(
      config,
      'imageFormat',
      mergedDefaults.imageFormat
    ),
    thumbnailSize: getNumber('thumbnailSize', mergedDefaults.thumbnailSize),
    imagePosition: getValidEnum(
      config,
      'imagePosition',
      mergedDefaults.imagePosition
    ),
    imageFit: getValidEnum(config, 'imageFit', mergedDefaults.imageFit),
    posterDisplayMode: getValidEnum(
      config,
      'posterDisplayMode',
      mergedDefaults.posterDisplayMode
    ),
    imageRatio: getNumber('imageRatio', mergedDefaults.imageRatio),
    propertyLabels: getValidEnum(
      config,
      'propertyLabels',
      mergedDefaults.propertyLabels
    ),
    pairProperties: getBool('pairProperties', mergedDefaults.pairProperties),
    rightPropertyPosition: getValidEnum(
      config,
      'rightPropertyPosition',
      mergedDefaults.rightPropertyPosition
    ),
    invertPropertyPairing: getString(
      'invertPropertyPairing',
      mergedDefaults.invertPropertyPairing
    ),
    showPropertiesAbove: mergedDefaults.showPropertiesAbove,
    invertPropertyPosition: mergedDefaults.invertPropertyPosition,
    urlProperty: getString('urlProperty', mergedDefaults.urlProperty),
    minimumColumns: (() => {
      const value = config.get('minimumColumns');
      if (value === 'one') return 1;
      if (value === 'two') return 2;
      return mergedDefaults.minimumColumns;
    })(),
    cssclasses: getString('cssclasses', mergedDefaults.cssclasses),
  };

  // Filter to only non-default values (sparse)
  const result: Partial<ViewDefaults> = {};
  for (const key of Object.keys(full) as (keyof ViewDefaults)[]) {
    // minimumColumns has a view-type-specific default (masonry=2, grid=1)
    if (key === 'minimumColumns') {
      const minColDefault = viewType === 'masonry' ? 2 : 1;
      if (full[key] !== minColDefault) {
        (result as Record<string, unknown>)[key] = full[key];
      }
      continue;
    }
    if (full[key] !== mergedDefaults[key]) {
      (result as Record<string, unknown>)[key] = full[key];
    }
  }
  return result;
}
