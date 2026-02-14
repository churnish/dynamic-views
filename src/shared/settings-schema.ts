/**
 * Universal settings schema
 * Defines settings structure for both Bases and Datacore views
 */

import type { BasesViewConfig, ViewOption } from "obsidian";
import type {
  PluginSettings,
  ViewDefaults,
  BasesResolvedSettings,
} from "../types";
import { VIEW_DEFAULTS, BASES_DEFAULTS } from "../constants";

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
  viewType?: "grid" | "masonry",
  config?: BasesViewConfig,
): ViewOption[] {
  // Merge settings template into defaults (if template exists)
  // For new views: config is empty → controls show these defaults = template values
  // For existing views: config has values → these defaults are ignored by Obsidian
  const d = { ...VIEW_DEFAULTS, ...BASES_DEFAULTS };
  if (viewType) {
    try {
      // Access plugin instance to read settings template
      const plugin = window.app?.plugins?.plugins?.["dynamic-views"];
      // Cast through unknown — persistenceManager is on DynamicViews, not base Plugin
      const pm = (
        plugin as unknown as {
          persistenceManager?: {
            getSettingsTemplate(
              viewType: string,
            ): { settings?: Record<string, unknown> } | undefined;
          };
        }
      )?.persistenceManager;
      if (pm) {
        const template = pm.getSettingsTemplate(viewType);
        if (template) {
          Object.assign(d, template);
        }
      }
    } catch {
      // Plugin not ready yet — use static defaults
    }
  }

  const schema = [
    {
      type: "slider",
      displayName: "Card size",
      key: "cardSize",
      min: 50,
      max: 800,
      step: 10,
      default: d.cardSize,
    },
    {
      type: "group",
      displayName: "Title",
      items: [
        {
          type: "toggle",
          displayName: "Display first property as title",
          key: "displayFirstAsTitle",
          default: d.displayFirstAsTitle,
        },
        {
          type: "slider",
          displayName: "Lines",
          key: "titleLines",
          min: 1,
          max: 5,
          step: 1,
          default: d.titleLines,
          shouldHide: (config: BasesConfig) =>
            (config.get("displayFirstAsTitle") ?? d.displayFirstAsTitle) ===
            false,
        },
        {
          type: "toggle",
          displayName: "Display second property as subtitle",
          key: "displaySecondAsSubtitle",
          default: d.displaySecondAsSubtitle,
          shouldHide: (config: BasesConfig) =>
            (config.get("displayFirstAsTitle") ?? d.displayFirstAsTitle) ===
            false,
        },
      ],
    },
    {
      type: "group",
      displayName: "Text preview",
      items: [
        {
          type: "property",
          displayName: "Text preview property",
          key: "textPreviewProperty",
          default: d.textPreviewProperty,
          filter: (prop: string) =>
            config
              ? config.getOrder().some((id) => String(id) === String(prop))
              : true,
        },
        {
          type: "toggle",
          displayName: "Show note content if property missing/empty",
          key: "fallbackToContent",
          default: d.fallbackToContent,
        },
        {
          type: "slider",
          displayName: "Lines",
          key: "textPreviewLines",
          min: 1,
          max: 10,
          step: 1,
          default: d.textPreviewLines,
          shouldHide: (config: BasesConfig) =>
            !(config.get("textPreviewProperty") ?? d.textPreviewProperty) &&
            (config.get("fallbackToContent") ?? d.fallbackToContent) === false,
        },
      ],
    },
    {
      type: "group",
      displayName: "Image",
      items: [
        {
          type: "text",
          displayName: "Image property",
          key: "imageProperty",
          placeholder: "Comma-separated if multiple",
          default: d.imageProperty,
        },
        {
          type: "dropdown",
          displayName: "Show image embeds",
          key: "fallbackToEmbeds",
          options: {
            always: "Always",
            "if-unavailable": "If no available property images",
            never: "Never",
          },
          default: d.fallbackToEmbeds,
        },
        {
          type: "dropdown",
          displayName: "Format",
          key: "imageFormat",
          options: {
            thumbnail: "Thumbnail",
            cover: "Cover",
            poster: "Poster",
            backdrop: "Backdrop",
          },
          default: d.imageFormat,
          shouldHide: (config: BasesConfig) =>
            !(config.get("imageProperty") || d.imageProperty) &&
            (config.get("fallbackToEmbeds") ?? d.fallbackToEmbeds) === "never",
        },
        {
          type: "slider",
          displayName: "Size",
          key: "thumbnailSize",
          min: 50,
          max: 100,
          step: 1,
          default: d.thumbnailSize,
          shouldHide: (config: BasesConfig) =>
            (config.get("imageFormat") ?? d.imageFormat) !== "thumbnail" ||
            (!(config.get("imageProperty") || d.imageProperty) &&
              (config.get("fallbackToEmbeds") ?? d.fallbackToEmbeds) ===
                "never"),
        },
        {
          type: "dropdown",
          displayName: "Position",
          key: "imagePosition",
          options: {
            left: "Left",
            right: "Right",
            top: "Top",
            bottom: "Bottom",
          },
          default: d.imagePosition,
          shouldHide: (config: BasesConfig) =>
            (config.get("imageFormat") ?? d.imageFormat) === "poster" ||
            (config.get("imageFormat") ?? d.imageFormat) === "backdrop" ||
            (!(config.get("imageProperty") || d.imageProperty) &&
              (config.get("fallbackToEmbeds") ?? d.fallbackToEmbeds) ===
                "never"),
        },
        {
          type: "dropdown",
          displayName: "Fit",
          key: "imageFit",
          options: {
            crop: "Crop",
            contain: "Contain",
          },
          default: d.imageFit,
          shouldHide: (config: BasesConfig) =>
            (config.get("imageFormat") ?? d.imageFormat) === "backdrop" ||
            (!(config.get("imageProperty") || d.imageProperty) &&
              (config.get("fallbackToEmbeds") ?? d.fallbackToEmbeds) ===
                "never"),
        },
        {
          type: "slider",
          displayName: "Ratio",
          key: "imageRatio",
          min: 0.25,
          max: 2.5,
          step: 0.05,
          default: d.imageRatio,
          shouldHide: (config: BasesConfig) =>
            (config.get("imageFormat") ?? d.imageFormat) === "backdrop" ||
            (!(config.get("imageProperty") || d.imageProperty) &&
              (config.get("fallbackToEmbeds") ?? d.fallbackToEmbeds) ===
                "never"),
        },
      ],
    },
    {
      type: "group",
      displayName: "Properties",
      items: [
        {
          type: "dropdown",
          displayName: "Property labels",
          key: "propertyLabels",
          options: {
            above: "Above",
            inline: "Inline",
            hide: "Hide",
          },
          default: d.propertyLabels,
          shouldHide: (config: BasesConfig) => config.getOrder().length === 0,
        },
        {
          type: "property",
          displayName: "URL property",
          key: "urlProperty",
          default: d.urlProperty,
          filter: (prop: string) =>
            config
              ? config.getOrder().some((id) => String(id) === String(prop))
              : true,
        },
        {
          type: "toggle",
          displayName: "Pair properties",
          key: "pairProperties",
          default: d.pairProperties,
          shouldHide: (config: BasesConfig) => config.getOrder().length <= 1,
        },
        {
          type: "dropdown",
          displayName: "Right property position",
          key: "rightPropertyPosition",
          options: {
            left: "Left",
            column: "Column",
            right: "Right",
          },
          default: d.rightPropertyPosition,
          shouldHide: (config: BasesConfig) =>
            config.getOrder().length <= 1 ||
            (config.get("pairProperties") ?? d.pairProperties) === false,
        },
        {
          type: "text",
          displayName: "Invert pairing for property",
          key: "invertPropertyPairing",
          placeholder: "Comma-separated if multiple",
          default: d.invertPropertyPairing,
          shouldHide: (config: BasesConfig) => config.getOrder().length <= 1,
        },
      ],
    },
    {
      type: "group",
      displayName: "Other",
      items: [
        {
          type: "dropdown",
          displayName: "Minimum columns",
          key: "minimumColumns",
          options: {
            one: "One",
            two: "Two",
          },
          default: viewType === "masonry" ? "two" : "one",
        },
        {
          type: "text",
          displayName: "cssclasses",
          key: "cssclasses",
          placeholder: "Comma-separated if multiple",
          default: d.cssclasses,
        },
        {
          type: "toggle",
          displayName: "Save settings as default",
          key: "isTemplate",
          default: false,
        },
      ],
    },
  ];
  // Schema objects use widened string types; assertion is safe because
  // the literal structure matches ViewOption discriminated union members.
  return schema as ViewOption[];
}

/**
 * Additional options specific to masonry view
 */
export function getMasonryViewOptions(config?: BasesViewConfig): ViewOption[] {
  return getBasesViewOptions("masonry", config);
}

/** Type-safe config value getters with fallback to defaults */
function createConfigGetters(config: BasesConfig) {
  return {
    // Empty string "" is a valid user choice (intentionally cleared field)
    getString: (key: string, fallback: string): string => {
      const value = config.get(key);
      if (value !== undefined && value !== null) {
        return typeof value === "string" ? value : fallback;
      }
      return fallback;
    },
    getBool: (key: string, fallback: boolean): boolean => {
      const value = config.get(key);
      return typeof value === "boolean" ? value : fallback;
    },
    getNumber: (key: string, fallback: number): number => {
      const value = config.get(key);
      return typeof value === "number" && Number.isFinite(value)
        ? value
        : fallback;
    },
  };
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
  viewType?: "grid" | "masonry",
  previousSettings?: Partial<BasesResolvedSettings>,
  templateOverrides?: Partial<ViewDefaults>,
): BasesResolvedSettings {
  // Template overrides serve as fallbacks for new views whose config isn't populated yet
  const defaults = {
    ...VIEW_DEFAULTS,
    ...BASES_DEFAULTS,
    ...templateOverrides,
  };

  const { getString, getBool, getNumber } = createConfigGetters(config);

  // Position-based title/subtitle: derive from getOrder() positions
  const displayFirstAsTitle = getBool(
    "displayFirstAsTitle",
    defaults.displayFirstAsTitle,
  );
  const displaySecondAsSubtitle = getBool(
    "displaySecondAsSubtitle",
    defaults.displaySecondAsSubtitle,
  );
  const order = config.getOrder();
  let titleProperty = "";
  let subtitleProperty = "";
  let _skipLeadingProperties = 0;
  if (displayFirstAsTitle && order[0]) {
    titleProperty = order[0];
    _skipLeadingProperties = 1;
    if (displaySecondAsSubtitle && order[1]) {
      subtitleProperty = order[1];
      _skipLeadingProperties = 2;
    }
  }

  // Read ViewDefaults from Bases config
  // Note: propertyLabels and imageFormat use previousSettings for stale config fallback
  const viewSettings: ViewDefaults = {
    cardSize: getNumber("cardSize", defaults.cardSize),
    titleProperty,
    titleLines: getNumber("titleLines", defaults.titleLines),
    subtitleProperty,
    displayFirstAsTitle,
    displaySecondAsSubtitle,
    textPreviewProperty: getString(
      "textPreviewProperty",
      defaults.textPreviewProperty,
    ),
    fallbackToContent: getBool("fallbackToContent", defaults.fallbackToContent),
    textPreviewLines: getNumber("textPreviewLines", defaults.textPreviewLines),
    imageProperty: getString("imageProperty", defaults.imageProperty),
    fallbackToEmbeds: (() => {
      const value = config.get("fallbackToEmbeds");
      return value === "always" ||
        value === "if-unavailable" ||
        value === "never"
        ? value
        : defaults.fallbackToEmbeds;
    })(),
    imageFormat: (() => {
      const value = config.get("imageFormat");
      if (
        value === "thumbnail" ||
        value === "cover" ||
        value === "poster" ||
        value === "backdrop"
      ) {
        return value;
      }
      // Stale config guard: use previous value if available
      if (previousSettings?.imageFormat !== undefined) {
        return previousSettings.imageFormat;
      }
      return defaults.imageFormat;
    })(),
    thumbnailSize: getNumber("thumbnailSize", defaults.thumbnailSize),
    imagePosition: (() => {
      const value = config.get("imagePosition");
      return value === "left" ||
        value === "right" ||
        value === "top" ||
        value === "bottom"
        ? value
        : defaults.imagePosition;
    })(),
    imageFit: (() => {
      const value = config.get("imageFit");
      return value === "crop" || value === "contain"
        ? value
        : defaults.imageFit;
    })(),
    imageRatio: getNumber("imageRatio", defaults.imageRatio),
    propertyLabels: (() => {
      const value = config.get("propertyLabels");
      if (value === "hide" || value === "inline" || value === "above") {
        return value;
      }
      // Stale config guard: use previous value if available
      if (previousSettings?.propertyLabels !== undefined) {
        return previousSettings.propertyLabels;
      }
      return defaults.propertyLabels;
    })(),
    pairProperties: getBool("pairProperties", defaults.pairProperties),
    rightPropertyPosition: (() => {
      const value = config.get("rightPropertyPosition");
      return value === "left" || value === "column" || value === "right"
        ? value
        : defaults.rightPropertyPosition;
    })(),
    invertPropertyPairing: getString(
      "invertPropertyPairing",
      defaults.invertPropertyPairing,
    ),
    showPropertiesAbove: defaults.showPropertiesAbove,
    invertPropertyPosition: defaults.invertPropertyPosition,
    urlProperty: getString("urlProperty", defaults.urlProperty),
    minimumColumns: (() => {
      const value = config.get("minimumColumns");
      if (value === "one") return 1;
      if (value === "two") return 2;
      const fallback = viewType === "masonry" ? 2 : defaults.minimumColumns;
      return fallback;
    })(),
    cssclasses: getString("cssclasses", defaults.cssclasses),
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
): Partial<ViewDefaults> {
  // Merge BASES_DEFAULTS so fallbacks and sparse filter use actual Bases defaults
  const mergedDefaults = { ...defaults, ...BASES_DEFAULTS };

  const { getString, getBool, getNumber } = createConfigGetters(config);

  // Extract all values with type coercion
  const full: ViewDefaults = {
    cardSize: getNumber("cardSize", mergedDefaults.cardSize),
    titleProperty: mergedDefaults.titleProperty,
    titleLines: getNumber("titleLines", mergedDefaults.titleLines),
    subtitleProperty: mergedDefaults.subtitleProperty,
    displayFirstAsTitle: getBool(
      "displayFirstAsTitle",
      mergedDefaults.displayFirstAsTitle,
    ),
    displaySecondAsSubtitle: getBool(
      "displaySecondAsSubtitle",
      mergedDefaults.displaySecondAsSubtitle,
    ),
    textPreviewProperty: getString(
      "textPreviewProperty",
      mergedDefaults.textPreviewProperty,
    ),
    fallbackToContent: getBool(
      "fallbackToContent",
      mergedDefaults.fallbackToContent,
    ),
    textPreviewLines: getNumber(
      "textPreviewLines",
      mergedDefaults.textPreviewLines,
    ),
    imageProperty: getString("imageProperty", mergedDefaults.imageProperty),
    fallbackToEmbeds: (() => {
      const value = config.get("fallbackToEmbeds");
      return value === "always" ||
        value === "if-unavailable" ||
        value === "never"
        ? value
        : mergedDefaults.fallbackToEmbeds;
    })(),
    imageFormat: (() => {
      const value = config.get("imageFormat");
      return value === "thumbnail" ||
        value === "cover" ||
        value === "poster" ||
        value === "backdrop"
        ? value
        : mergedDefaults.imageFormat;
    })(),
    thumbnailSize: getNumber("thumbnailSize", mergedDefaults.thumbnailSize),
    imagePosition: (() => {
      const value = config.get("imagePosition");
      return value === "left" ||
        value === "right" ||
        value === "top" ||
        value === "bottom"
        ? value
        : mergedDefaults.imagePosition;
    })(),
    imageFit: (() => {
      const value = config.get("imageFit");
      return value === "crop" || value === "contain"
        ? value
        : mergedDefaults.imageFit;
    })(),
    imageRatio: getNumber("imageRatio", mergedDefaults.imageRatio),
    propertyLabels: (() => {
      const value = config.get("propertyLabels");
      return value === "hide" || value === "inline" || value === "above"
        ? value
        : mergedDefaults.propertyLabels;
    })(),
    pairProperties: getBool("pairProperties", mergedDefaults.pairProperties),
    rightPropertyPosition: (() => {
      const value = config.get("rightPropertyPosition");
      return value === "left" || value === "column" || value === "right"
        ? value
        : mergedDefaults.rightPropertyPosition;
    })(),
    invertPropertyPairing: getString(
      "invertPropertyPairing",
      mergedDefaults.invertPropertyPairing,
    ),
    showPropertiesAbove: mergedDefaults.showPropertiesAbove,
    invertPropertyPosition: mergedDefaults.invertPropertyPosition,
    urlProperty: getString("urlProperty", mergedDefaults.urlProperty),
    minimumColumns: (() => {
      const value = config.get("minimumColumns");
      if (value === "one") return 1;
      if (value === "two") return 2;
      return mergedDefaults.minimumColumns;
    })(),
    cssclasses: getString("cssclasses", mergedDefaults.cssclasses),
  };

  // Filter to only non-default values (sparse)
  const result: Partial<ViewDefaults> = {};
  for (const key of Object.keys(full) as (keyof ViewDefaults)[]) {
    if (full[key] !== mergedDefaults[key]) {
      (result as Record<string, unknown>)[key] = full[key];
    }
  }
  return result;
}
