/**
 * Universal settings schema
 * Defines settings structure for both Bases and Datacore views
 */

import type {
  PluginSettings,
  ViewDefaults,
  BasesResolvedSettings,
} from "../types";
import { VIEW_DEFAULTS } from "../constants";

// Bases config object interface
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
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Bases API requires any for options array structure
export function getBasesViewOptions(viewType?: "grid" | "masonry"): any[] {
  // Merge settings template into defaults (if template exists)
  // For new views: config is empty → controls show these defaults = template values
  // For existing views: config has values → these defaults are ignored by Obsidian
  const d = { ...VIEW_DEFAULTS };
  if (viewType) {
    try {
      // Access plugin instance to read settings template
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
      const plugin = (window as any).app?.plugins?.plugins?.["dynamic-views"];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (plugin?.persistenceManager) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const template =
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
          plugin.persistenceManager.getSettingsTemplate(viewType);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (template?.settings) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          Object.assign(d, template.settings);
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
      displayName: "Header",
      items: [
        {
          type: "text",
          displayName: "Title property",
          key: "titleProperty",
          placeholder: "Comma-separated if multiple",
          default: d.titleProperty,
        },
        {
          type: "text",
          displayName: "Subtitle property",
          key: "subtitleProperty",
          placeholder: "Comma-separated if multiple",
          default: d.subtitleProperty,
        },
      ],
    },
    {
      type: "group",
      displayName: "Text preview",
      items: [
        {
          type: "text",
          displayName: "Text preview property",
          key: "textPreviewProperty",
          placeholder: "Comma-separated if multiple",
          default: d.textPreviewProperty,
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
          type: "dropdown",
          displayName: "Size",
          key: "thumbnailSize",
          options: {
            compact: "Compact",
            standard: "Standard",
            expanded: "Expanded",
          },
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
            inline: "Inline",
            above: "On top",
            hide: "Hide",
          },
          default: d.propertyLabels,
          shouldHide: (config: BasesConfig) => config.getOrder().length === 0,
        },
        {
          type: "text",
          displayName: "URL property",
          key: "urlProperty",
          placeholder: "Comma-separated if multiple",
          default: d.urlProperty,
        },
        {
          type: "toggle",
          displayName: "Show properties above text preview",
          key: "showPropertiesAbove",
          default: d.showPropertiesAbove,
          shouldHide: (config: BasesConfig) =>
            config.getOrder().length === 0 ||
            (!(config.get("textPreviewProperty") ?? d.textPreviewProperty) &&
              (config.get("fallbackToContent") ?? d.fallbackToContent) ===
                false),
        },
        {
          type: "text",
          displayName: "Invert position for property",
          key: "invertPropertyPosition",
          placeholder: "Comma-separated if multiple",
          default: d.invertPropertyPosition,
          shouldHide: (config: BasesConfig) =>
            config.getOrder().length <= 1 ||
            (!(config.get("textPreviewProperty") ?? d.textPreviewProperty) &&
              (config.get("fallbackToContent") ?? d.fallbackToContent) ===
                false),
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
          type: "dropdown",
          displayName: "Ambient card background",
          key: "ambientBackground",
          options: {
            subtle: "Subtle",
            dramatic: "Dramatic",
            disable: "Disable",
          },
          default: d.ambientBackground,
          shouldHide: (config: BasesConfig) =>
            (config.get("imageFormat") ?? d.imageFormat) === "poster" ||
            (config.get("imageFormat") ?? d.imageFormat) === "backdrop" ||
            (!(config.get("imageProperty") || d.imageProperty) &&
              (config.get("fallbackToEmbeds") ?? d.fallbackToEmbeds) ===
                "never"),
        },
        {
          type: "toggle",
          displayName: "Use these settings for new views",
          key: "isTemplate",
          default: false,
        },
      ],
    },
  ];
  return schema;
}

/**
 * Additional options specific to masonry view
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Bases API requires any for options array structure
export function getMasonryViewOptions(): any[] {
  return getBasesViewOptions("masonry");
}

/**
 * Read settings from Bases config
 * Maps Bases config values to BasesResolvedSettings by merging:
 *   VIEW_DEFAULTS (overridden by config) + pluginSettings
 */
export function readBasesSettings(
  config: BasesConfig,
  pluginSettings: PluginSettings,
  viewType?: "grid" | "masonry",
): BasesResolvedSettings {
  const defaults = VIEW_DEFAULTS;

  // Helper: get string property with fallback
  // Empty string "" is a valid user choice (intentionally cleared field)
  const getString = (key: string, fallback: string): string => {
    const value = config.get(key);
    if (value !== undefined && value !== null) {
      return typeof value === "string" ? value : fallback;
    }
    return fallback;
  };

  // Helper: get boolean property with fallback
  const getBool = (key: string, fallback: boolean): boolean => {
    const value = config.get(key);
    return typeof value === "boolean" ? value : fallback;
  };

  // Helper: get number property with fallback
  const getNumber = (key: string, fallback: number): number => {
    const value = config.get(key);
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : fallback;
  };

  // Read ViewDefaults from Bases config
  const viewSettings: ViewDefaults = {
    cardSize: getNumber("cardSize", defaults.cardSize),
    titleProperty: getString("titleProperty", defaults.titleProperty),
    subtitleProperty: getString("subtitleProperty", defaults.subtitleProperty),
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
      return value === "thumbnail" ||
        value === "cover" ||
        value === "poster" ||
        value === "backdrop"
        ? value
        : defaults.imageFormat;
    })(),
    thumbnailSize: (() => {
      const value = config.get("thumbnailSize");
      return value === "compact" || value === "standard" || value === "expanded"
        ? value
        : defaults.thumbnailSize;
    })(),
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
      return value === "hide" || value === "inline" || value === "above"
        ? value
        : defaults.propertyLabels;
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
    showPropertiesAbove: getBool(
      "showPropertiesAbove",
      defaults.showPropertiesAbove,
    ),
    invertPropertyPosition: getString(
      "invertPropertyPosition",
      defaults.invertPropertyPosition,
    ),
    urlProperty: getString("urlProperty", defaults.urlProperty),
    minimumColumns: (() => {
      const value = config.get("minimumColumns");
      if (value === "one") return 1;
      if (value === "two") return 2;
      const fallback = viewType === "masonry" ? 2 : defaults.minimumColumns;
      return fallback;
    })(),
    ambientBackground: (() => {
      const value = config.get("ambientBackground");
      return value === "subtle" || value === "dramatic" || value === "disable"
        ? value
        : defaults.ambientBackground;
    })(),
    cssclasses: getString("cssclasses", defaults.cssclasses),
  };

  // Merge: pluginSettings + config-derived ViewDefaults
  return {
    ...pluginSettings,
    ...viewSettings,
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
  // Helper: get string property with fallback
  // Empty string "" is a valid user choice (intentionally cleared field)
  const getString = (key: string, fallback: string): string => {
    const value = config.get(key);
    if (value !== undefined && value !== null) {
      return typeof value === "string" ? value : fallback;
    }
    return fallback;
  };

  // Helper: get boolean property with fallback
  const getBool = (key: string, fallback: boolean): boolean => {
    const value = config.get(key);
    return typeof value === "boolean" ? value : fallback;
  };

  // Helper: get number property with fallback
  const getNumber = (key: string, fallback: number): number => {
    const value = config.get(key);
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : fallback;
  };

  // Extract all values with type coercion
  const full: ViewDefaults = {
    cardSize: getNumber("cardSize", defaults.cardSize),
    titleProperty: getString("titleProperty", defaults.titleProperty),
    subtitleProperty: getString("subtitleProperty", defaults.subtitleProperty),
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
      return value === "thumbnail" ||
        value === "cover" ||
        value === "poster" ||
        value === "backdrop"
        ? value
        : defaults.imageFormat;
    })(),
    thumbnailSize: (() => {
      const value = config.get("thumbnailSize");
      return value === "compact" || value === "standard" || value === "expanded"
        ? value
        : defaults.thumbnailSize;
    })(),
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
      return value === "hide" || value === "inline" || value === "above"
        ? value
        : defaults.propertyLabels;
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
    showPropertiesAbove: getBool(
      "showPropertiesAbove",
      defaults.showPropertiesAbove,
    ),
    invertPropertyPosition: getString(
      "invertPropertyPosition",
      defaults.invertPropertyPosition,
    ),
    urlProperty: getString("urlProperty", defaults.urlProperty),
    minimumColumns: (() => {
      const value = config.get("minimumColumns");
      if (value === "one") return 1;
      if (value === "two") return 2;
      return defaults.minimumColumns;
    })(),
    ambientBackground: (() => {
      const value = config.get("ambientBackground");
      return value === "subtle" || value === "dramatic" || value === "disable"
        ? value
        : defaults.ambientBackground;
    })(),
    cssclasses: getString("cssclasses", defaults.cssclasses),
  };

  // Filter to only non-default values (sparse)
  const result: Partial<ViewDefaults> = {};
  for (const key of Object.keys(full) as (keyof ViewDefaults)[]) {
    if (full[key] !== defaults[key]) {
      (result as Record<string, unknown>)[key] = full[key];
    }
  }
  return result;
}
