/**
 * Universal settings schema
 * Defines settings structure for both Bases and Datacore views
 */

import type { Settings, DefaultViewSettings } from "../types";
import { DEFAULT_VIEW_SETTINGS } from "../constants";

// Bases config object interface
interface BasesConfig {
  get(key: string): unknown;
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
          displayName: "Show note content if property missing or empty",
          key: "fallbackToContent",
          default: d.fallbackToContent,
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
            !config.get("imageProperty") &&
            config.get("fallbackToEmbeds") === "never",
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
            config.get("imageFormat") === "poster" ||
            config.get("imageFormat") === "backdrop" ||
            (!config.get("imageProperty") &&
              config.get("fallbackToEmbeds") === "never"),
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
            config.get("imageFormat") === "backdrop" ||
            (!config.get("imageProperty") &&
              config.get("fallbackToEmbeds") === "never"),
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
            config.get("imageFormat") === "backdrop" ||
            (!config.get("imageProperty") &&
              config.get("fallbackToEmbeds") === "never"),
        },
      ],
    },
    {
      type: "group",
      displayName: "Property set 1",
      items: [
        {
          type: "property",
          displayName: "Property 1",
          key: "propertyDisplay1",
          placeholder: "Select property",
          default: d.propertyDisplay1,
        },
        {
          type: "property",
          displayName: "Property 2",
          key: "propertyDisplay2",
          placeholder: "Select property",
          default: d.propertyDisplay2,
        },
        {
          type: "toggle",
          displayName: "Show above text preview",
          key: "propertySet1Above",
          default: d.propertySet1Above,
          shouldHide: (config: BasesConfig) =>
            !config.get("propertyDisplay1") && !config.get("propertyDisplay2"),
        },
        {
          type: "toggle",
          displayName: "Show side-by-side",
          key: "propertySet1SideBySide",
          default: d.propertySet1SideBySide,
          shouldHide: (config: BasesConfig) =>
            !config.get("propertyDisplay1") || !config.get("propertyDisplay2"),
        },
      ],
    },
    {
      type: "group",
      displayName: "Property set 2",
      items: [
        {
          type: "property",
          displayName: "Property 3",
          key: "propertyDisplay3",
          placeholder: "Select property",
          default: "",
        },
        {
          type: "property",
          displayName: "Property 4",
          key: "propertyDisplay4",
          placeholder: "Select property",
          default: "",
        },
        {
          type: "toggle",
          displayName: "Show above text preview",
          key: "propertySet2Above",
          default: d.propertySet2Above,
          shouldHide: (config: BasesConfig) =>
            !config.get("propertyDisplay3") && !config.get("propertyDisplay4"),
        },
        {
          type: "toggle",
          displayName: "Show side-by-side",
          key: "propertySet2SideBySide",
          default: d.propertySet2SideBySide,
          shouldHide: (config: BasesConfig) =>
            !config.get("propertyDisplay3") || !config.get("propertyDisplay4"),
        },
      ],
    },
    {
      type: "group",
      displayName: "Property set 3",
      items: [
        {
          type: "property",
          displayName: "Property 5",
          key: "propertyDisplay5",
          placeholder: "Select property",
          default: "",
        },
        {
          type: "property",
          displayName: "Property 6",
          key: "propertyDisplay6",
          placeholder: "Select property",
          default: "",
        },
        {
          type: "toggle",
          displayName: "Show above text preview",
          key: "propertySet3Above",
          default: d.propertySet3Above,
          shouldHide: (config: BasesConfig) =>
            !config.get("propertyDisplay5") && !config.get("propertyDisplay6"),
        },
        {
          type: "toggle",
          displayName: "Show side-by-side",
          key: "propertySet3SideBySide",
          default: d.propertySet3SideBySide,
          shouldHide: (config: BasesConfig) =>
            !config.get("propertyDisplay5") || !config.get("propertyDisplay6"),
        },
      ],
    },
    {
      type: "group",
      displayName: "Property set 4",
      items: [
        {
          type: "property",
          displayName: "Property 7",
          key: "propertyDisplay7",
          placeholder: "Select property",
          default: "",
        },
        {
          type: "property",
          displayName: "Property 8",
          key: "propertyDisplay8",
          placeholder: "Select property",
          default: "",
        },
        {
          type: "toggle",
          displayName: "Show above text preview",
          key: "propertySet4Above",
          default: d.propertySet4Above,
          shouldHide: (config: BasesConfig) =>
            !config.get("propertyDisplay7") && !config.get("propertyDisplay8"),
        },
        {
          type: "toggle",
          displayName: "Show side-by-side",
          key: "propertySet4SideBySide",
          default: d.propertySet4SideBySide,
          shouldHide: (config: BasesConfig) =>
            !config.get("propertyDisplay7") || !config.get("propertyDisplay8"),
        },
      ],
    },
    {
      type: "group",
      displayName: "Property set 5",
      items: [
        {
          type: "property",
          displayName: "Property 9",
          key: "propertyDisplay9",
          placeholder: "Select property",
          default: "",
        },
        {
          type: "property",
          displayName: "Property 10",
          key: "propertyDisplay10",
          placeholder: "Select property",
          default: "",
        },
        {
          type: "toggle",
          displayName: "Show above text preview",
          key: "propertySet5Above",
          default: d.propertySet5Above,
          shouldHide: (config: BasesConfig) =>
            !config.get("propertyDisplay9") && !config.get("propertyDisplay10"),
        },
        {
          type: "toggle",
          displayName: "Show side-by-side",
          key: "propertySet5SideBySide",
          default: d.propertySet5SideBySide,
          shouldHide: (config: BasesConfig) =>
            !config.get("propertyDisplay9") || !config.get("propertyDisplay10"),
        },
      ],
    },
    {
      type: "group",
      displayName: "Property set 6",
      items: [
        {
          type: "property",
          displayName: "Property 11",
          key: "propertyDisplay11",
          placeholder: "Select property",
          default: "",
        },
        {
          type: "property",
          displayName: "Property 12",
          key: "propertyDisplay12",
          placeholder: "Select property",
          default: "",
        },
        {
          type: "toggle",
          displayName: "Show above text preview",
          key: "propertySet6Above",
          default: d.propertySet6Above,
          shouldHide: (config: BasesConfig) =>
            !config.get("propertyDisplay11") &&
            !config.get("propertyDisplay12"),
        },
        {
          type: "toggle",
          displayName: "Show side-by-side",
          key: "propertySet6SideBySide",
          default: d.propertySet6SideBySide,
          shouldHide: (config: BasesConfig) =>
            !config.get("propertyDisplay11") ||
            !config.get("propertyDisplay12"),
        },
      ],
    },
    {
      type: "group",
      displayName: "Property set 7",
      items: [
        {
          type: "property",
          displayName: "Property 13",
          key: "propertyDisplay13",
          placeholder: "Select property",
          default: "",
        },
        {
          type: "property",
          displayName: "Property 14",
          key: "propertyDisplay14",
          placeholder: "Select property",
          default: "",
        },
        {
          type: "toggle",
          displayName: "Show above text preview",
          key: "propertySet7Above",
          default: d.propertySet7Above,
          shouldHide: (config: BasesConfig) =>
            !config.get("propertyDisplay13") &&
            !config.get("propertyDisplay14"),
        },
        {
          type: "toggle",
          displayName: "Show side-by-side",
          key: "propertySet7SideBySide",
          default: d.propertySet7SideBySide,
          shouldHide: (config: BasesConfig) =>
            !config.get("propertyDisplay13") ||
            !config.get("propertyDisplay14"),
        },
      ],
    },
    {
      type: "group",
      displayName: "Other",
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
          type: "text",
          displayName: "URL property",
          key: "urlProperty",
          placeholder: "Comma-separated if multiple",
          default: d.urlProperty,
        },
        {
          type: "text",
          displayName: "cssclasses",
          key: "cssclasses",
          placeholder: "Comma-separated if multiple",
          default: "",
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
    // String properties
    titleProperty: getString("titleProperty", defaults.titleProperty),
    textPreviewProperty: getString(
      "textPreviewProperty",
      defaults.textPreviewProperty,
    ),
    imageProperty: getString("imageProperty", defaults.imageProperty),
    urlProperty: getString("urlProperty", defaults.urlProperty),
    subtitleProperty: getString("subtitleProperty", defaults.subtitleProperty),

    // Boolean properties
    fallbackToContent: getBool("fallbackToContent", defaults.fallbackToContent),

    // Enum: fallbackToEmbeds
    fallbackToEmbeds: (() => {
      const value = config.get("fallbackToEmbeds");
      return value === "always" ||
        value === "if-unavailable" ||
        value === "never"
        ? value
        : defaults.fallbackToEmbeds;
    })(),

    // Property display strings (1-14)
    // DEPENDENCY: initializeViewDefaults() must run before this to persist defaults.
    // Fallback is "" (empty) because:
    // - New views: initializeViewDefaults sets file.tags/file.mtime defaults for 1-2
    // - Cleared fields: "" persists to JSON (undefined doesn't)
    // - If init fails: shows empty (safe fallback, user can re-select)
    propertyDisplay1: getString("propertyDisplay1", ""),
    propertyDisplay2: getString("propertyDisplay2", ""),
    propertyDisplay3: getString("propertyDisplay3", ""),
    propertyDisplay4: getString("propertyDisplay4", ""),
    propertyDisplay5: getString("propertyDisplay5", ""),
    propertyDisplay6: getString("propertyDisplay6", ""),
    propertyDisplay7: getString("propertyDisplay7", ""),
    propertyDisplay8: getString("propertyDisplay8", ""),
    propertyDisplay9: getString("propertyDisplay9", ""),
    propertyDisplay10: getString("propertyDisplay10", ""),
    propertyDisplay11: getString("propertyDisplay11", ""),
    propertyDisplay12: getString("propertyDisplay12", ""),
    propertyDisplay13: getString("propertyDisplay13", ""),
    propertyDisplay14: getString("propertyDisplay14", ""),

    // CSS classes for view container
    cssclasses: getString("cssclasses", defaults.cssclasses),

    // Property set side-by-side booleans (1-7)
    propertySet1SideBySide: getBool(
      "propertySet1SideBySide",
      defaults.propertySet1SideBySide,
    ),
    propertySet2SideBySide: getBool(
      "propertySet2SideBySide",
      defaults.propertySet2SideBySide,
    ),
    propertySet3SideBySide: getBool(
      "propertySet3SideBySide",
      defaults.propertySet3SideBySide,
    ),
    propertySet4SideBySide: getBool(
      "propertySet4SideBySide",
      defaults.propertySet4SideBySide,
    ),
    propertySet5SideBySide: getBool(
      "propertySet5SideBySide",
      defaults.propertySet5SideBySide,
    ),
    propertySet6SideBySide: getBool(
      "propertySet6SideBySide",
      defaults.propertySet6SideBySide,
    ),
    propertySet7SideBySide: getBool(
      "propertySet7SideBySide",
      defaults.propertySet7SideBySide,
    ),

    // Property set position-on-top booleans (1-7)
    propertySet1Above: getBool("propertySet1Above", defaults.propertySet1Above),
    propertySet2Above: getBool("propertySet2Above", defaults.propertySet2Above),
    propertySet3Above: getBool("propertySet3Above", defaults.propertySet3Above),
    propertySet4Above: getBool("propertySet4Above", defaults.propertySet4Above),
    propertySet5Above: getBool("propertySet5Above", defaults.propertySet5Above),
    propertySet6Above: getBool("propertySet6Above", defaults.propertySet6Above),
    propertySet7Above: getBool("propertySet7Above", defaults.propertySet7Above),

    // Enum: propertyLabels
    propertyLabels: (() => {
      const value = config.get("propertyLabels");
      return value === "hide" || value === "inline" || value === "above"
        ? value
        : defaults.propertyLabels;
    })(),

    // Image settings
    imageFormat: (() => {
      const value = config.get("imageFormat");
      return value === "thumbnail" ||
        value === "cover" ||
        value === "poster" ||
        value === "backdrop"
        ? value
        : defaults.imageFormat;
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
    cardSize: getNumber("cardSize", defaults.cardSize),

    // Enum: listMarker
    listMarker: (() => {
      const value = config.get("listMarker");
      return value === "bullet" || value === "number"
        ? value
        : defaults.listMarker;
    })(),

    // Global settings (not configurable per-view in Bases)
    omitFirstLine: globalSettings.omitFirstLine,
    randomizeAction: globalSettings.randomizeAction,
    queryHeight: 0, // Not configurable in Bases
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
    // String properties
    titleProperty: getString("titleProperty", defaults.titleProperty),
    textPreviewProperty: getString(
      "textPreviewProperty",
      defaults.textPreviewProperty,
    ),
    imageProperty: getString("imageProperty", defaults.imageProperty),
    urlProperty: getString("urlProperty", defaults.urlProperty),
    subtitleProperty: getString("subtitleProperty", defaults.subtitleProperty),

    // Boolean properties
    fallbackToContent: getBool("fallbackToContent", defaults.fallbackToContent),

    // Enum: fallbackToEmbeds
    fallbackToEmbeds: (() => {
      const value = config.get("fallbackToEmbeds");
      return value === "always" ||
        value === "if-unavailable" ||
        value === "never"
        ? value
        : defaults.fallbackToEmbeds;
    })(),

    // Property display strings (1-14)
    propertyDisplay1: getString("propertyDisplay1", ""),
    propertyDisplay2: getString("propertyDisplay2", ""),
    propertyDisplay3: getString("propertyDisplay3", ""),
    propertyDisplay4: getString("propertyDisplay4", ""),
    propertyDisplay5: getString("propertyDisplay5", ""),
    propertyDisplay6: getString("propertyDisplay6", ""),
    propertyDisplay7: getString("propertyDisplay7", ""),
    propertyDisplay8: getString("propertyDisplay8", ""),
    propertyDisplay9: getString("propertyDisplay9", ""),
    propertyDisplay10: getString("propertyDisplay10", ""),
    propertyDisplay11: getString("propertyDisplay11", ""),
    propertyDisplay12: getString("propertyDisplay12", ""),
    propertyDisplay13: getString("propertyDisplay13", ""),
    propertyDisplay14: getString("propertyDisplay14", ""),

    // CSS classes for view container
    cssclasses: getString("cssclasses", defaults.cssclasses),

    // Property set side-by-side booleans (1-7)
    propertySet1SideBySide: getBool(
      "propertySet1SideBySide",
      defaults.propertySet1SideBySide,
    ),
    propertySet2SideBySide: getBool(
      "propertySet2SideBySide",
      defaults.propertySet2SideBySide,
    ),
    propertySet3SideBySide: getBool(
      "propertySet3SideBySide",
      defaults.propertySet3SideBySide,
    ),
    propertySet4SideBySide: getBool(
      "propertySet4SideBySide",
      defaults.propertySet4SideBySide,
    ),
    propertySet5SideBySide: getBool(
      "propertySet5SideBySide",
      defaults.propertySet5SideBySide,
    ),
    propertySet6SideBySide: getBool(
      "propertySet6SideBySide",
      defaults.propertySet6SideBySide,
    ),
    propertySet7SideBySide: getBool(
      "propertySet7SideBySide",
      defaults.propertySet7SideBySide,
    ),

    // Property set position-on-top booleans (1-7)
    propertySet1Above: getBool("propertySet1Above", defaults.propertySet1Above),
    propertySet2Above: getBool("propertySet2Above", defaults.propertySet2Above),
    propertySet3Above: getBool("propertySet3Above", defaults.propertySet3Above),
    propertySet4Above: getBool("propertySet4Above", defaults.propertySet4Above),
    propertySet5Above: getBool("propertySet5Above", defaults.propertySet5Above),
    propertySet6Above: getBool("propertySet6Above", defaults.propertySet6Above),
    propertySet7Above: getBool("propertySet7Above", defaults.propertySet7Above),

    // Enum: propertyLabels
    propertyLabels: (() => {
      const value = config.get("propertyLabels");
      return value === "hide" || value === "inline" || value === "above"
        ? value
        : defaults.propertyLabels;
    })(),

    // Image settings
    imageFormat: (() => {
      const value = config.get("imageFormat");
      return value === "thumbnail" ||
        value === "cover" ||
        value === "poster" ||
        value === "backdrop"
        ? value
        : defaults.imageFormat;
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
    cardSize: getNumber("cardSize", defaults.cardSize),

    // Enum: listMarker
    listMarker: (() => {
      const value = config.get("listMarker");
      return value === "bullet" || value === "number"
        ? value
        : defaults.listMarker;
    })(),

    // queryHeight set to 0 (not configurable in Bases)
    queryHeight: 0,
  };
}
