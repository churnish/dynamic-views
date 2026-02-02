/**
 * Universal settings schema
 * Defines settings structure for both Bases and Datacore views
 */

import type { Settings, DefaultViewSettings } from "../types";
import { DEFAULT_VIEW_SETTINGS } from "../constants";

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
  const d = { ...DEFAULT_VIEW_SETTINGS };
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
            (config.get("imageFormat") ?? d.imageFormat) !== "thumbnail",
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
          key: "imageAspectRatio",
          min: 0.25,
          max: 2.5,
          step: 0.05,
          default: d.imageAspectRatio,
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
        },
        {
          type: "toggle",
          displayName: "Pair properties",
          key: "pairProperties",
          default: d.pairProperties,
        },
        {
          type: "dropdown",
          displayName: "Paired property layout",
          key: "pairedPropertyLayout",
          options: {
            "align-left": "Align left",
            "snap-to-edges": "Snap to edges",
            "equal-width": "Equal width",
          },
          default: d.pairedPropertyLayout,
          shouldHide: (config: BasesConfig) =>
            (config.get("pairProperties") ?? d.pairProperties) === false,
        },
        {
          type: "text",
          displayName: "Invert pairing for property",
          key: "invertPairingForProperty",
          placeholder: "Comma-separated if multiple",
          default: d.invertPairingForProperty,
        },
        {
          type: "toggle",
          displayName: "Show properties above text preview",
          key: "showPropertiesAbove",
          default: d.showPropertiesAbove,
          shouldHide: (config: BasesConfig) =>
            !(config.get("textPreviewProperty") ?? d.textPreviewProperty) &&
            (config.get("fallbackToContent") ?? d.fallbackToContent) === false,
        },
        {
          type: "text",
          displayName: "Invert position for property",
          key: "invertPositionForProperty",
          placeholder: "Comma-separated if multiple",
          default: d.invertPositionForProperty,
          shouldHide: (config: BasesConfig) =>
            !(config.get("textPreviewProperty") ?? d.textPreviewProperty) &&
            (config.get("fallbackToContent") ?? d.fallbackToContent) === false,
        },
        {
          type: "text",
          displayName: "URL property",
          key: "urlProperty",
          placeholder: "Comma-separated if multiple",
          default: d.urlProperty,
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
            "1": "One",
            "2": "Two",
          },
          default: viewType === "masonry" ? "2" : String(d.minimumColumns ?? 1),
        },
        {
          type: "dropdown",
          displayName: "Ambient background",
          key: "ambientBackground",
          options: {
            subtle: "Subtle",
            dramatic: "Dramatic",
            disable: "Disable",
          },
          default: d.ambientBackground,
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
          displayName: "Use these settings for new views",
          key: "__isTemplate",
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
 * Maps Bases config values to Settings object
 */
export function readBasesSettings(
  config: BasesConfig,
  globalSettings: Settings,
  defaultViewSettings: DefaultViewSettings,
  viewType?: "grid" | "masonry",
): Settings {
  // Null guard
  const defaults = defaultViewSettings || DEFAULT_VIEW_SETTINGS;

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

  return {
    // Card size
    cardSize: getNumber("cardSize", defaults.cardSize),
    // Header
    titleProperty: getString("titleProperty", defaults.titleProperty),
    subtitleProperty: getString("subtitleProperty", defaults.subtitleProperty),
    // Text preview
    textPreviewProperty: getString(
      "textPreviewProperty",
      defaults.textPreviewProperty,
    ),
    fallbackToContent: getBool("fallbackToContent", defaults.fallbackToContent),
    textPreviewLines: getNumber("textPreviewLines", defaults.textPreviewLines),
    // Image
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
    imageAspectRatio: getNumber("imageAspectRatio", defaults.imageAspectRatio),
    // Properties
    propertyLabels: (() => {
      const value = config.get("propertyLabels");
      return value === "hide" || value === "inline" || value === "above"
        ? value
        : defaults.propertyLabels;
    })(),
    pairProperties: getBool("pairProperties", defaults.pairProperties),
    pairedPropertyLayout: (() => {
      const value = config.get("pairedPropertyLayout");
      return value === "align-left" ||
        value === "snap-to-edges" ||
        value === "equal-width"
        ? value
        : defaults.pairedPropertyLayout;
    })(),
    invertPairingForProperty: getString(
      "invertPairingForProperty",
      defaults.invertPairingForProperty,
    ),
    showPropertiesAbove: getBool(
      "showPropertiesAbove",
      defaults.showPropertiesAbove,
    ),
    invertPositionForProperty: getString(
      "invertPositionForProperty",
      defaults.invertPositionForProperty,
    ),
    urlProperty: getString("urlProperty", defaults.urlProperty),
    // Other
    minimumColumns: (() => {
      const value = config.get("minimumColumns");
      const parsed = typeof value === "string" ? parseInt(value, 10) : value;
      const fallback = viewType === "masonry" ? 2 : defaults.minimumColumns;
      return typeof parsed === "number" && Number.isFinite(parsed)
        ? parsed
        : fallback;
    })(),
    ambientBackground: (() => {
      const value = config.get("ambientBackground");
      return value === "subtle" || value === "dramatic" || value === "disable"
        ? value
        : defaults.ambientBackground;
    })(),
    cssclasses: getString("cssclasses", defaults.cssclasses),
    // Non-UI
    listMarker: (() => {
      const value = config.get("listMarker");
      return value === "bullet" || value === "number"
        ? value
        : defaults.listMarker;
    })(),
    queryHeight: 0, // Not configurable in Bases
    // Datacore-only: pass through from global settings (kept until Datacore refactor)
    propertyDisplay1: globalSettings.propertyDisplay1,
    propertyDisplay2: globalSettings.propertyDisplay2,
    propertyDisplay3: globalSettings.propertyDisplay3,
    propertyDisplay4: globalSettings.propertyDisplay4,
    propertyDisplay5: globalSettings.propertyDisplay5,
    propertyDisplay6: globalSettings.propertyDisplay6,
    propertyDisplay7: globalSettings.propertyDisplay7,
    propertyDisplay8: globalSettings.propertyDisplay8,
    propertyDisplay9: globalSettings.propertyDisplay9,
    propertyDisplay10: globalSettings.propertyDisplay10,
    propertyDisplay11: globalSettings.propertyDisplay11,
    propertyDisplay12: globalSettings.propertyDisplay12,
    propertyDisplay13: globalSettings.propertyDisplay13,
    propertyDisplay14: globalSettings.propertyDisplay14,
    propertySet1SideBySide: globalSettings.propertySet1SideBySide,
    propertySet2SideBySide: globalSettings.propertySet2SideBySide,
    propertySet3SideBySide: globalSettings.propertySet3SideBySide,
    propertySet4SideBySide: globalSettings.propertySet4SideBySide,
    propertySet5SideBySide: globalSettings.propertySet5SideBySide,
    propertySet6SideBySide: globalSettings.propertySet6SideBySide,
    propertySet7SideBySide: globalSettings.propertySet7SideBySide,
    propertySet1Above: globalSettings.propertySet1Above,
    propertySet2Above: globalSettings.propertySet2Above,
    propertySet3Above: globalSettings.propertySet3Above,
    propertySet4Above: globalSettings.propertySet4Above,
    propertySet5Above: globalSettings.propertySet5Above,
    propertySet6Above: globalSettings.propertySet6Above,
    propertySet7Above: globalSettings.propertySet7Above,
    // Settings-only (not configurable per-view in Bases)
    omitFirstLine: globalSettings.omitFirstLine,
    randomizeAction: globalSettings.randomizeAction,
    openFileAction: globalSettings.openFileAction,
    openRandomInNewTab: globalSettings.openRandomInNewTab,
    smartTimestamp: globalSettings.smartTimestamp,
    createdTimeProperty: globalSettings.createdTimeProperty,
    modifiedTimeProperty: globalSettings.modifiedTimeProperty,
    showYoutubeThumbnails: globalSettings.showYoutubeThumbnails,
    showCardLinkCovers: globalSettings.showCardLinkCovers,
    preventSidebarSwipe: globalSettings.preventSidebarSwipe,
    revealInNotebookNavigator: globalSettings.revealInNotebookNavigator,
  };
}

/**
 * Extract view-specific settings from Bases config for template storage
 * @param config Bases view configuration
 * @param defaults Default view settings for fallback values
 * @returns Partial settings object suitable for template storage
 */
export function extractBasesTemplate(
  config: BasesConfig,
  defaults: DefaultViewSettings,
): Partial<DefaultViewSettings> {
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

  return {
    // Card size
    cardSize: getNumber("cardSize", defaults.cardSize),
    // Header
    titleProperty: getString("titleProperty", defaults.titleProperty),
    subtitleProperty: getString("subtitleProperty", defaults.subtitleProperty),
    // Text preview
    textPreviewProperty: getString(
      "textPreviewProperty",
      defaults.textPreviewProperty,
    ),
    fallbackToContent: getBool("fallbackToContent", defaults.fallbackToContent),
    textPreviewLines: getNumber("textPreviewLines", defaults.textPreviewLines),
    // Image
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
    imageAspectRatio: getNumber("imageAspectRatio", defaults.imageAspectRatio),
    // Properties
    propertyLabels: (() => {
      const value = config.get("propertyLabels");
      return value === "hide" || value === "inline" || value === "above"
        ? value
        : defaults.propertyLabels;
    })(),
    pairProperties: getBool("pairProperties", defaults.pairProperties),
    pairedPropertyLayout: (() => {
      const value = config.get("pairedPropertyLayout");
      return value === "align-left" ||
        value === "snap-to-edges" ||
        value === "equal-width"
        ? value
        : defaults.pairedPropertyLayout;
    })(),
    invertPairingForProperty: getString(
      "invertPairingForProperty",
      defaults.invertPairingForProperty,
    ),
    showPropertiesAbove: getBool(
      "showPropertiesAbove",
      defaults.showPropertiesAbove,
    ),
    invertPositionForProperty: getString(
      "invertPositionForProperty",
      defaults.invertPositionForProperty,
    ),
    urlProperty: getString("urlProperty", defaults.urlProperty),
    // Other
    minimumColumns: (() => {
      const value = config.get("minimumColumns");
      const parsed = typeof value === "string" ? parseInt(value, 10) : value;
      return typeof parsed === "number" && Number.isFinite(parsed)
        ? parsed
        : defaults.minimumColumns;
    })(),
    ambientBackground: (() => {
      const value = config.get("ambientBackground");
      return value === "subtle" || value === "dramatic" || value === "disable"
        ? value
        : defaults.ambientBackground;
    })(),
    cssclasses: getString("cssclasses", defaults.cssclasses),
    // Non-UI
    listMarker: (() => {
      const value = config.get("listMarker");
      return value === "bullet" || value === "number"
        ? value
        : defaults.listMarker;
    })(),
    queryHeight: 0,
  };
}
