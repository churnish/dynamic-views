/**
 * Universal settings schema
 * Defines settings structure for both Bases and Datacore views
 */

import type { Settings, DefaultViewSettings } from "../types";
import { DEFAULT_SETTINGS, DEFAULT_VIEW_SETTINGS } from "../constants";

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
          key: "coverFitMode",
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
          default: "",
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
      displayName: "Property group 1",
      items: [
        {
          type: "property",
          displayName: "First property",
          key: "propertyDisplay1",
          placeholder: "Select property",
          default: "",
        },
        {
          type: "property",
          displayName: "Second property",
          key: "propertyDisplay2",
          placeholder: "Select property",
          default: "",
        },
        {
          type: "toggle",
          displayName: "Show side-by-side",
          key: "propertyGroup1SideBySide",
          default: DEFAULT_VIEW_SETTINGS.propertyGroup1SideBySide,
        },
        {
          type: "dropdown",
          displayName: "Position",
          key: "propertyGroup1Position",
          options: {
            top: "Top",
            bottom: "Bottom",
          },
          default: DEFAULT_VIEW_SETTINGS.propertyGroup1Position,
        },
      ],
    },
    {
      type: "group",
      displayName: "Property group 2",
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
          key: "propertyGroup2SideBySide",
          default: DEFAULT_VIEW_SETTINGS.propertyGroup2SideBySide,
        },
        {
          type: "dropdown",
          displayName: "Position",
          key: "propertyGroup2Position",
          options: {
            top: "Top",
            bottom: "Bottom",
          },
          default: DEFAULT_VIEW_SETTINGS.propertyGroup2Position,
        },
      ],
    },
    {
      type: "group",
      displayName: "Property group 3",
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
          key: "propertyGroup3SideBySide",
          default: DEFAULT_VIEW_SETTINGS.propertyGroup3SideBySide,
        },
        {
          type: "dropdown",
          displayName: "Position",
          key: "propertyGroup3Position",
          options: {
            top: "Top",
            bottom: "Bottom",
          },
          default: DEFAULT_VIEW_SETTINGS.propertyGroup3Position,
        },
      ],
    },
    {
      type: "group",
      displayName: "Property group 4",
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
          key: "propertyGroup4SideBySide",
          default: DEFAULT_VIEW_SETTINGS.propertyGroup4SideBySide,
        },
        {
          type: "dropdown",
          displayName: "Position",
          key: "propertyGroup4Position",
          options: {
            top: "Top",
            bottom: "Bottom",
          },
          default: DEFAULT_VIEW_SETTINGS.propertyGroup4Position,
        },
      ],
    },
    {
      type: "group",
      displayName: "Property group 5",
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
          key: "propertyGroup5SideBySide",
          default: DEFAULT_VIEW_SETTINGS.propertyGroup5SideBySide,
        },
        {
          type: "dropdown",
          displayName: "Position",
          key: "propertyGroup5Position",
          options: {
            top: "Top",
            bottom: "Bottom",
          },
          default: DEFAULT_VIEW_SETTINGS.propertyGroup5Position,
        },
      ],
    },
    {
      type: "group",
      displayName: "Property group 6",
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
          key: "propertyGroup6SideBySide",
          default: DEFAULT_VIEW_SETTINGS.propertyGroup6SideBySide,
        },
        {
          type: "dropdown",
          displayName: "Position",
          key: "propertyGroup6Position",
          options: {
            top: "Top",
            bottom: "Bottom",
          },
          default: DEFAULT_VIEW_SETTINGS.propertyGroup6Position,
        },
      ],
    },
    {
      type: "group",
      displayName: "Property group 7",
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
          key: "propertyGroup7SideBySide",
          default: DEFAULT_VIEW_SETTINGS.propertyGroup7SideBySide,
        },
        {
          type: "dropdown",
          displayName: "Position",
          key: "propertyGroup7Position",
          options: {
            top: "Top",
            bottom: "Bottom",
          },
          default: DEFAULT_VIEW_SETTINGS.propertyGroup7Position,
        },
      ],
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
export function readBasesSettings(
  config: BasesConfig,
  globalSettings: Settings,
  defaultViewSettings: DefaultViewSettings,
): Settings {
  const titlePropertyValue = config.get("titleProperty");
  const textPreviewPropertyValue = config.get("textPreviewProperty");
  const imagePropertyValue = config.get("imageProperty");
  const urlPropertyValue = config.get("urlProperty");

  return {
    titleProperty:
      typeof titlePropertyValue === "string"
        ? titlePropertyValue
        : defaultViewSettings.titleProperty,
    textPreviewProperty:
      typeof textPreviewPropertyValue === "string"
        ? textPreviewPropertyValue
        : defaultViewSettings.textPreviewProperty,
    imageProperty:
      typeof imagePropertyValue === "string"
        ? imagePropertyValue
        : defaultViewSettings.imageProperty,
    urlProperty:
      typeof urlPropertyValue === "string"
        ? urlPropertyValue
        : defaultViewSettings.urlProperty,
    omitFirstLine: globalSettings.omitFirstLine, // From global settings
    showTitle: Boolean(
      config.get("showTitle") ?? defaultViewSettings.showTitle,
    ),
    subtitleProperty: (() => {
      const value = config.get("subtitleProperty");
      if (value !== undefined && value !== null) {
        return typeof value === "string" ? value : "";
      }
      return "";
    })(),
    showTextPreview: Boolean(
      config.get("showTextPreview") ?? defaultViewSettings.showTextPreview,
    ),
    fallbackToContent: Boolean(
      config.get("fallbackToContent") ?? defaultViewSettings.fallbackToContent,
    ),
    fallbackToEmbeds: (() => {
      const value = config.get("fallbackToEmbeds");
      return value === "always" || value === "if-empty" || value === "never"
        ? value
        : defaultViewSettings.fallbackToEmbeds;
    })(),
    propertyDisplay1: (() => {
      const value = config.get("propertyDisplay1");
      // If value is explicitly set (including empty string), use it
      if (value !== undefined && value !== null) {
        return typeof value === "string" ? value : "";
      }
      // For Bases views, default to empty (no properties shown)
      return "";
    })(),
    propertyDisplay2: (() => {
      const value = config.get("propertyDisplay2");
      if (value !== undefined && value !== null) {
        return typeof value === "string" ? value : "";
      }
      return "";
    })(),
    propertyDisplay3: (() => {
      const value = config.get("propertyDisplay3");
      if (value !== undefined && value !== null) {
        return typeof value === "string" ? value : "";
      }
      return "";
    })(),
    propertyDisplay4: (() => {
      const value = config.get("propertyDisplay4");
      if (value !== undefined && value !== null) {
        return typeof value === "string" ? value : "";
      }
      return "";
    })(),
    propertyGroup1SideBySide: Boolean(
      config.get("propertyGroup1SideBySide") ??
      defaultViewSettings.propertyGroup1SideBySide,
    ),
    propertyGroup2SideBySide: Boolean(
      config.get("propertyGroup2SideBySide") ??
      defaultViewSettings.propertyGroup2SideBySide,
    ),
    propertyDisplay5: (() => {
      const value = config.get("propertyDisplay5");
      if (value !== undefined && value !== null) {
        return typeof value === "string" ? value : "";
      }
      return "";
    })(),
    propertyDisplay6: (() => {
      const value = config.get("propertyDisplay6");
      if (value !== undefined && value !== null) {
        return typeof value === "string" ? value : "";
      }
      return "";
    })(),
    propertyGroup3SideBySide: Boolean(
      config.get("propertyGroup3SideBySide") ??
      defaultViewSettings.propertyGroup3SideBySide,
    ),
    propertyDisplay7: (() => {
      const value = config.get("propertyDisplay7");
      if (value !== undefined && value !== null) {
        return typeof value === "string" ? value : "";
      }
      return "";
    })(),
    propertyDisplay8: (() => {
      const value = config.get("propertyDisplay8");
      if (value !== undefined && value !== null) {
        return typeof value === "string" ? value : "";
      }
      return "";
    })(),
    propertyGroup4SideBySide: Boolean(
      config.get("propertyGroup4SideBySide") ??
      defaultViewSettings.propertyGroup4SideBySide,
    ),
    propertyDisplay9: (() => {
      const value = config.get("propertyDisplay9");
      if (value !== undefined && value !== null) {
        return typeof value === "string" ? value : "";
      }
      return "";
    })(),
    propertyDisplay10: (() => {
      const value = config.get("propertyDisplay10");
      if (value !== undefined && value !== null) {
        return typeof value === "string" ? value : "";
      }
      return "";
    })(),
    propertyGroup5SideBySide: Boolean(
      config.get("propertyGroup5SideBySide") ??
      defaultViewSettings.propertyGroup5SideBySide,
    ),
    propertyDisplay11: (() => {
      const value = config.get("propertyDisplay11");
      if (value !== undefined && value !== null) {
        return typeof value === "string" ? value : "";
      }
      return "";
    })(),
    propertyDisplay12: (() => {
      const value = config.get("propertyDisplay12");
      if (value !== undefined && value !== null) {
        return typeof value === "string" ? value : "";
      }
      return "";
    })(),
    propertyGroup6SideBySide: Boolean(
      config.get("propertyGroup6SideBySide") ??
      defaultViewSettings.propertyGroup6SideBySide,
    ),
    propertyDisplay13: (() => {
      const value = config.get("propertyDisplay13");
      if (value !== undefined && value !== null) {
        return typeof value === "string" ? value : "";
      }
      return "";
    })(),
    propertyDisplay14: (() => {
      const value = config.get("propertyDisplay14");
      if (value !== undefined && value !== null) {
        return typeof value === "string" ? value : "";
      }
      return "";
    })(),
    propertyGroup7SideBySide: Boolean(
      config.get("propertyGroup7SideBySide") ??
      defaultViewSettings.propertyGroup7SideBySide,
    ),
    propertyGroup1Position: (() => {
      const value = config.get("propertyGroup1Position");
      return value === "top" || value === "bottom"
        ? value
        : defaultViewSettings.propertyGroup1Position;
    })(),
    propertyGroup2Position: (() => {
      const value = config.get("propertyGroup2Position");
      return value === "top" || value === "bottom"
        ? value
        : defaultViewSettings.propertyGroup2Position;
    })(),
    propertyGroup3Position: (() => {
      const value = config.get("propertyGroup3Position");
      return value === "top" || value === "bottom"
        ? value
        : defaultViewSettings.propertyGroup3Position;
    })(),
    propertyGroup4Position: (() => {
      const value = config.get("propertyGroup4Position");
      return value === "top" || value === "bottom"
        ? value
        : defaultViewSettings.propertyGroup4Position;
    })(),
    propertyGroup5Position: (() => {
      const value = config.get("propertyGroup5Position");
      return value === "top" || value === "bottom"
        ? value
        : defaultViewSettings.propertyGroup5Position;
    })(),
    propertyGroup6Position: (() => {
      const value = config.get("propertyGroup6Position");
      return value === "top" || value === "bottom"
        ? value
        : defaultViewSettings.propertyGroup6Position;
    })(),
    propertyGroup7Position: (() => {
      const value = config.get("propertyGroup7Position");
      return value === "top" || value === "bottom"
        ? value
        : defaultViewSettings.propertyGroup7Position;
    })(),
    propertyLabels: (() => {
      const value = config.get("propertyLabels");
      return value === "hide" || value === "inline" || value === "above"
        ? value
        : defaultViewSettings.propertyLabels;
    })(),
    imageFormat: (() => {
      const format = config.get("imageFormat");
      const position = config.get("imagePosition");

      // Handle "none" directly
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

      // Check if already a combined value (legacy/direct)
      const value = format;
      if (
        value === "thumbnail-left" ||
        value === "thumbnail-right" ||
        value === "thumbnail-top" ||
        value === "thumbnail-bottom" ||
        value === "cover-left" ||
        value === "cover-right" ||
        value === "cover-top" ||
        value === "cover-bottom" ||
        value === "none"
      ) {
        return value;
      }

      return defaultViewSettings.imageFormat;
    })(),
    coverFitMode: (() => {
      const value = config.get("coverFitMode");
      return value === "crop" || value === "contain"
        ? value
        : defaultViewSettings.coverFitMode;
    })(),
    listMarker: (() => {
      const value = config.get("listMarker");
      return (
        typeof value === "string" ? value : DEFAULT_SETTINGS.listMarker
      ) as "bullet" | "number";
    })(),
    randomizeAction: (() => {
      const value = config.get("randomizeAction");
      return (
        typeof value === "string" ? value : DEFAULT_SETTINGS.randomizeAction
      ) as "shuffle" | "random";
    })(),
    thumbnailCacheSize: globalSettings.thumbnailCacheSize, // From global settings
    queryHeight: 0, // Not configurable in Bases
    openFileAction: globalSettings.openFileAction, // From global settings
    openRandomInNewTab: globalSettings.openRandomInNewTab, // From global settings
    showShuffleInRibbon: globalSettings.showShuffleInRibbon, // From global settings
    showRandomInRibbon: globalSettings.showRandomInRibbon, // From global settings
    smartTimestamp: globalSettings.smartTimestamp, // From global settings
    createdTimeProperty: globalSettings.createdTimeProperty, // From global settings
    modifiedTimeProperty: globalSettings.modifiedTimeProperty, // From global settings
    fallbackToFileMetadata: globalSettings.fallbackToFileMetadata, // From global settings
    cardSize: (() => {
      const value = config.get("cardSize");
      return typeof value === "number" ? value : defaultViewSettings.cardSize;
    })(),
    imageAspectRatio: (() => {
      const value = config.get("imageAspectRatio");
      return typeof value === "number"
        ? value
        : defaultViewSettings.imageAspectRatio;
    })(),
    preventSidebarSwipe: globalSettings.preventSidebarSwipe, // From global settings
  };
}
