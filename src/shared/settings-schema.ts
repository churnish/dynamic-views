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
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Bases API requires any for options array structure
export function getBasesViewOptions(): any[] {
  return [
    {
      type: "slider",
      displayName: "Card size",
      key: "cardSize",
      min: 50,
      max: 800,
      step: 10,
      default: DEFAULT_VIEW_SETTINGS.cardSize,
    },
    {
      type: "group",
      displayName: "Title",
      items: [
        {
          type: "toggle",
          displayName: "Show title",
          key: "showTitle",
          default: DEFAULT_VIEW_SETTINGS.showTitle,
        },
        {
          type: "text",
          displayName: "Title property",
          key: "titleProperty",
          placeholder: "Comma-separated if multiple",
          default: DEFAULT_VIEW_SETTINGS.titleProperty,
        },
      ],
    },
    {
      type: "group",
      displayName: "Text preview",
      items: [
        {
          type: "toggle",
          displayName: "Show text preview",
          key: "showTextPreview",
          default: DEFAULT_VIEW_SETTINGS.showTextPreview,
        },
        {
          type: "text",
          displayName: "Text preview property",
          key: "textPreviewProperty",
          placeholder: "Comma-separated if multiple",
          default: DEFAULT_VIEW_SETTINGS.textPreviewProperty,
        },
        {
          type: "toggle",
          displayName:
            "Show note content if text preview property missing or empty",
          key: "fallbackToContent",
          default: DEFAULT_VIEW_SETTINGS.fallbackToContent,
        },
      ],
    },
    {
      type: "group",
      displayName: "Image",
      items: [
        {
          type: "dropdown",
          displayName: "Format",
          key: "imageFormat",
          options: {
            thumbnail: "Thumbnail",
            cover: "Cover",
            none: "No image",
          },
          default: "thumbnail",
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
          default: "right",
        },
        {
          type: "text",
          displayName: "Image property",
          key: "imageProperty",
          placeholder: "Comma-separated if multiple",
          default: DEFAULT_VIEW_SETTINGS.imageProperty,
        },
        {
          type: "dropdown",
          displayName: "Show image embeds",
          key: "fallbackToEmbeds",
          options: {
            always: "Always",
            "if-empty": "If image property missing or empty",
            never: "Never",
          },
          default: "always",
        },
        {
          type: "dropdown",
          displayName: "Fit",
          key: "imageFit",
          options: {
            crop: "Crop",
            contain: "Contain",
          },
          default: "crop",
        },
        {
          type: "slider",
          displayName: "Ratio",
          key: "imageAspectRatio",
          min: 0.25,
          max: 2.5,
          step: 0.05,
          default: DEFAULT_VIEW_SETTINGS.imageAspectRatio,
        },
      ],
    },
    {
      type: "group",
      displayName: "Properties",
      items: [
        {
          type: "text",
          displayName: "Subtitle property",
          key: "subtitleProperty",
          placeholder: "Comma-separated if multiple",
          default: DEFAULT_VIEW_SETTINGS.subtitleProperty,
        },
        {
          type: "text",
          displayName: "URL property",
          key: "urlProperty",
          placeholder: "Comma-separated if multiple",
          default: "",
        },
        {
          type: "dropdown",
          displayName: "Property labels",
          key: "propertyLabels",
          options: {
            inline: "Inline",
            above: "On top",
            hide: "Hide",
          },
          default: DEFAULT_VIEW_SETTINGS.propertyLabels,
        },
      ],
    },
    {
      type: "group",
      displayName: "Property set 1",
      items: [
        {
          type: "property",
          displayName: "First property",
          key: "propertyDisplay1",
          placeholder: "Select property",
          default: DEFAULT_VIEW_SETTINGS.propertyDisplay1,
        },
        {
          type: "property",
          displayName: "Second property",
          key: "propertyDisplay2",
          placeholder: "Select property",
          default: DEFAULT_VIEW_SETTINGS.propertyDisplay2,
        },
        {
          type: "toggle",
          displayName: "Show side-by-side",
          key: "propertySet1SideBySide",
          default: DEFAULT_VIEW_SETTINGS.propertySet1SideBySide,
        },
        {
          type: "dropdown",
          displayName: "Position",
          key: "propertySet1Position",
          options: {
            top: "Top",
            bottom: "Bottom",
          },
          default: DEFAULT_VIEW_SETTINGS.propertySet1Position,
        },
      ],
    },
    {
      type: "group",
      displayName: "Property set 2",
      items: [
        {
          type: "property",
          displayName: "First property",
          key: "propertyDisplay3",
          placeholder: "Select property",
          default: "",
        },
        {
          type: "property",
          displayName: "Second property",
          key: "propertyDisplay4",
          placeholder: "Select property",
          default: "",
        },
        {
          type: "toggle",
          displayName: "Show side-by-side",
          key: "propertySet2SideBySide",
          default: DEFAULT_VIEW_SETTINGS.propertySet2SideBySide,
        },
        {
          type: "dropdown",
          displayName: "Position",
          key: "propertySet2Position",
          options: {
            top: "Top",
            bottom: "Bottom",
          },
          default: DEFAULT_VIEW_SETTINGS.propertySet2Position,
        },
      ],
    },
    {
      type: "group",
      displayName: "Property set 3",
      items: [
        {
          type: "property",
          displayName: "First property",
          key: "propertyDisplay5",
          placeholder: "Select property",
          default: "",
        },
        {
          type: "property",
          displayName: "Second property",
          key: "propertyDisplay6",
          placeholder: "Select property",
          default: "",
        },
        {
          type: "toggle",
          displayName: "Show side-by-side",
          key: "propertySet3SideBySide",
          default: DEFAULT_VIEW_SETTINGS.propertySet3SideBySide,
        },
        {
          type: "dropdown",
          displayName: "Position",
          key: "propertySet3Position",
          options: {
            top: "Top",
            bottom: "Bottom",
          },
          default: DEFAULT_VIEW_SETTINGS.propertySet3Position,
        },
      ],
    },
    {
      type: "group",
      displayName: "Property set 4",
      items: [
        {
          type: "property",
          displayName: "First property",
          key: "propertyDisplay7",
          placeholder: "Select property",
          default: "",
        },
        {
          type: "property",
          displayName: "Second property",
          key: "propertyDisplay8",
          placeholder: "Select property",
          default: "",
        },
        {
          type: "toggle",
          displayName: "Show side-by-side",
          key: "propertySet4SideBySide",
          default: DEFAULT_VIEW_SETTINGS.propertySet4SideBySide,
        },
        {
          type: "dropdown",
          displayName: "Position",
          key: "propertySet4Position",
          options: {
            top: "Top",
            bottom: "Bottom",
          },
          default: DEFAULT_VIEW_SETTINGS.propertySet4Position,
        },
      ],
    },
    {
      type: "group",
      displayName: "Property set 5",
      items: [
        {
          type: "property",
          displayName: "First property",
          key: "propertyDisplay9",
          placeholder: "Select property",
          default: "",
        },
        {
          type: "property",
          displayName: "Second property",
          key: "propertyDisplay10",
          placeholder: "Select property",
          default: "",
        },
        {
          type: "toggle",
          displayName: "Show side-by-side",
          key: "propertySet5SideBySide",
          default: DEFAULT_VIEW_SETTINGS.propertySet5SideBySide,
        },
        {
          type: "dropdown",
          displayName: "Position",
          key: "propertySet5Position",
          options: {
            top: "Top",
            bottom: "Bottom",
          },
          default: DEFAULT_VIEW_SETTINGS.propertySet5Position,
        },
      ],
    },
    {
      type: "group",
      displayName: "Property set 6",
      items: [
        {
          type: "property",
          displayName: "First property",
          key: "propertyDisplay11",
          placeholder: "Select property",
          default: "",
        },
        {
          type: "property",
          displayName: "Second property",
          key: "propertyDisplay12",
          placeholder: "Select property",
          default: "",
        },
        {
          type: "toggle",
          displayName: "Show side-by-side",
          key: "propertySet6SideBySide",
          default: DEFAULT_VIEW_SETTINGS.propertySet6SideBySide,
        },
        {
          type: "dropdown",
          displayName: "Position",
          key: "propertySet6Position",
          options: {
            top: "Top",
            bottom: "Bottom",
          },
          default: DEFAULT_VIEW_SETTINGS.propertySet6Position,
        },
      ],
    },
    {
      type: "group",
      displayName: "Property set 7",
      items: [
        {
          type: "property",
          displayName: "First property",
          key: "propertyDisplay13",
          placeholder: "Select property",
          default: "",
        },
        {
          type: "property",
          displayName: "Second property",
          key: "propertyDisplay14",
          placeholder: "Select property",
          default: "",
        },
        {
          type: "toggle",
          displayName: "Show side-by-side",
          key: "propertySet7SideBySide",
          default: DEFAULT_VIEW_SETTINGS.propertySet7SideBySide,
        },
        {
          type: "dropdown",
          displayName: "Position",
          key: "propertySet7Position",
          options: {
            top: "Top",
            bottom: "Bottom",
          },
          default: DEFAULT_VIEW_SETTINGS.propertySet7Position,
        },
      ],
    },
  ];
}

/**
 * Additional options specific to masonry view
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Bases API requires any for options array structure
export function getMasonryViewOptions(): any[] {
  return getBasesViewOptions();
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

  // Helper: get position property with fallback
  const getPosition = (
    key: string,
    fallback: "top" | "bottom",
  ): "top" | "bottom" => {
    const value = config.get(key);
    return value === "top" || value === "bottom" ? value : fallback;
  };

  // Helper: get imageFormat from separate format and position dropdowns
  const getImageFormat = (): Settings["imageFormat"] => {
    const format = config.get("imageFormat");
    const position = config.get("imagePosition");

    if (format === "none") return "none";

    // Combine format + position (e.g., "cover" + "top" → "cover-top")
    if (
      (format === "thumbnail" || format === "cover") &&
      (position === "left" ||
        position === "right" ||
        position === "top" ||
        position === "bottom")
    ) {
      return `${format}-${position}` as Settings["imageFormat"];
    }

    return defaults.imageFormat;
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
    showTitle: getBool("showTitle", defaults.showTitle),
    showTextPreview: getBool("showTextPreview", defaults.showTextPreview),
    fallbackToContent: getBool("fallbackToContent", defaults.fallbackToContent),

    // Enum: fallbackToEmbeds
    fallbackToEmbeds: (() => {
      const value = config.get("fallbackToEmbeds");
      return value === "always" || value === "if-empty" || value === "never"
        ? value
        : defaults.fallbackToEmbeds;
    })(),

    // Property display strings (1-14)
    propertyDisplay1: getString("propertyDisplay1", defaults.propertyDisplay1),
    propertyDisplay2: getString("propertyDisplay2", defaults.propertyDisplay2),
    propertyDisplay3: getString("propertyDisplay3", defaults.propertyDisplay3),
    propertyDisplay4: getString("propertyDisplay4", defaults.propertyDisplay4),
    propertyDisplay5: getString("propertyDisplay5", defaults.propertyDisplay5),
    propertyDisplay6: getString("propertyDisplay6", defaults.propertyDisplay6),
    propertyDisplay7: getString("propertyDisplay7", defaults.propertyDisplay7),
    propertyDisplay8: getString("propertyDisplay8", defaults.propertyDisplay8),
    propertyDisplay9: getString("propertyDisplay9", defaults.propertyDisplay9),
    propertyDisplay10: getString(
      "propertyDisplay10",
      defaults.propertyDisplay10,
    ),
    propertyDisplay11: getString(
      "propertyDisplay11",
      defaults.propertyDisplay11,
    ),
    propertyDisplay12: getString(
      "propertyDisplay12",
      defaults.propertyDisplay12,
    ),
    propertyDisplay13: getString(
      "propertyDisplay13",
      defaults.propertyDisplay13,
    ),
    propertyDisplay14: getString(
      "propertyDisplay14",
      defaults.propertyDisplay14,
    ),

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

    // Property set positions (1-7)
    propertySet1Position: getPosition(
      "propertySet1Position",
      defaults.propertySet1Position,
    ),
    propertySet2Position: getPosition(
      "propertySet2Position",
      defaults.propertySet2Position,
    ),
    propertySet3Position: getPosition(
      "propertySet3Position",
      defaults.propertySet3Position,
    ),
    propertySet4Position: getPosition(
      "propertySet4Position",
      defaults.propertySet4Position,
    ),
    propertySet5Position: getPosition(
      "propertySet5Position",
      defaults.propertySet5Position,
    ),
    propertySet6Position: getPosition(
      "propertySet6Position",
      defaults.propertySet6Position,
    ),
    propertySet7Position: getPosition(
      "propertySet7Position",
      defaults.propertySet7Position,
    ),

    // Enum: propertyLabels
    propertyLabels: (() => {
      const value = config.get("propertyLabels");
      return value === "hide" || value === "inline" || value === "above"
        ? value
        : defaults.propertyLabels;
    })(),

    // Image settings
    imageFormat: getImageFormat(),
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
    showShuffleInRibbon: globalSettings.showShuffleInRibbon,
    showRandomInRibbon: globalSettings.showRandomInRibbon,
    smartTimestamp: globalSettings.smartTimestamp,
    createdTimeProperty: globalSettings.createdTimeProperty,
    modifiedTimeProperty: globalSettings.modifiedTimeProperty,
    showYoutubeThumbnails: globalSettings.showYoutubeThumbnails,
    showCardLinkCovers: globalSettings.showCardLinkCovers,
    preventSidebarSwipe: globalSettings.preventSidebarSwipe,
    revealInNotebookNavigator: globalSettings.revealInNotebookNavigator,
  };
}
