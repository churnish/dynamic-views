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
    {
      type: "toggle",
      displayName: "Show text preview",
      key: "showTextPreview",
      default: DEFAULT_VIEW_SETTINGS.showTextPreview,
    },
    {
      type: "text",
      displayName: "Text preview property",
      key: "descriptionProperty",
      placeholder: "Comma-separated if multiple",
      default: DEFAULT_VIEW_SETTINGS.descriptionProperty,
    },
    {
      type: "toggle",
      displayName:
        "Show note content if text preview property missing or empty",
      key: "fallbackToContent",
      default: DEFAULT_VIEW_SETTINGS.fallbackToContent,
    },
    {
      type: "dropdown",
      displayName: "Image format",
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
      displayName: "Image position",
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
      displayName: "Image fit",
      key: "coverFitMode",
      options: {
        crop: "Crop",
        contain: "Contain",
      },
      default: "crop",
    },
    {
      type: "slider",
      displayName: "Image ratio",
      key: "imageAspectRatio",
      min: 0.25,
      max: 2.5,
      step: 0.05,
      default: DEFAULT_VIEW_SETTINGS.imageAspectRatio,
    },
    {
      type: "dropdown",
      displayName: "Show property labels",
      key: "propertyLabels",
      options: {
        inline: "Inline",
        above: "On top",
        hide: "Hide",
      },
      default: DEFAULT_VIEW_SETTINGS.propertyLabels,
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
          key: "propertyLayout12SideBySide",
          default: DEFAULT_VIEW_SETTINGS.propertyLayout12SideBySide,
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
          key: "propertyLayout34SideBySide",
          default: DEFAULT_VIEW_SETTINGS.propertyLayout34SideBySide,
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
          key: "propertyLayout56SideBySide",
          default: DEFAULT_VIEW_SETTINGS.propertyLayout56SideBySide,
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
          key: "propertyLayout78SideBySide",
          default: DEFAULT_VIEW_SETTINGS.propertyLayout78SideBySide,
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
          key: "propertyLayout910SideBySide",
          default: DEFAULT_VIEW_SETTINGS.propertyLayout910SideBySide,
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
  const descriptionPropertyValue = config.get("descriptionProperty");
  const imagePropertyValue = config.get("imageProperty");

  return {
    titleProperty:
      typeof titlePropertyValue === "string"
        ? titlePropertyValue
        : defaultViewSettings.titleProperty,
    descriptionProperty:
      typeof descriptionPropertyValue === "string"
        ? descriptionPropertyValue
        : defaultViewSettings.descriptionProperty,
    imageProperty:
      typeof imagePropertyValue === "string"
        ? imagePropertyValue
        : defaultViewSettings.imageProperty,
    omitFirstLine: globalSettings.omitFirstLine, // From global settings
    showTitle: Boolean(
      config.get("showTitle") ?? defaultViewSettings.showTitle,
    ),
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
    propertyLayout12SideBySide: Boolean(
      config.get("propertyLayout12SideBySide") ??
        defaultViewSettings.propertyLayout12SideBySide,
    ),
    propertyLayout34SideBySide: Boolean(
      config.get("propertyLayout34SideBySide") ??
        defaultViewSettings.propertyLayout34SideBySide,
    ),
    propertyLayout56SideBySide: Boolean(
      config.get("propertyLayout56SideBySide") ??
        defaultViewSettings.propertyLayout56SideBySide,
    ),
    propertyLayout78SideBySide: Boolean(
      config.get("propertyLayout78SideBySide") ??
        defaultViewSettings.propertyLayout78SideBySide,
    ),
    propertyLayout910SideBySide: Boolean(
      config.get("propertyLayout910SideBySide") ??
        defaultViewSettings.propertyLayout910SideBySide,
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
    propertyLabels: (() => {
      const value = config.get("propertyLabels");
      return value === "hide" || value === "inline" || value === "above"
        ? value
        : defaultViewSettings.propertyLabels;
    })(),
    imageFormat: (() => {
      const rawFormat = config.get("imageFormat");
      const rawPosition = config.get("imagePosition");

      // Handle migration from old compound format (e.g., 'thumbnail-top') to new split format
      let format: "thumbnail" | "cover" | "none" = "thumbnail";
      let position: "left" | "right" | "top" | "bottom" = "right";

      if (
        rawFormat === "thumbnail" ||
        rawFormat === "cover" ||
        rawFormat === "none"
      ) {
        // New format: imageFormat is just the format part
        format = rawFormat;
      } else if (typeof rawFormat === "string" && rawFormat.includes("-")) {
        // Old compound format: extract both parts from imageFormat
        const parts = rawFormat.split("-");
        const formatPart = parts[0];
        format =
          formatPart === "thumbnail" ||
          formatPart === "cover" ||
          formatPart === "none"
            ? formatPart
            : "thumbnail";
        // If we have an old compound format, extract position from it (unless overridden by new imagePosition setting)
        const oldPosition = parts[1];
        position =
          rawPosition === "left" ||
          rawPosition === "right" ||
          rawPosition === "top" ||
          rawPosition === "bottom"
            ? rawPosition
            : oldPosition === "left" ||
                oldPosition === "right" ||
                oldPosition === "top" ||
                oldPosition === "bottom"
              ? oldPosition
              : "right";
      }

      if (format === "none") return "none";

      // Use rawPosition if it exists, otherwise keep the position extracted above (or default)
      if (
        rawPosition === "left" ||
        rawPosition === "right" ||
        rawPosition === "top" ||
        rawPosition === "bottom"
      ) {
        position = rawPosition;
      }

      return `${format}-${position}` as typeof defaultViewSettings.imageFormat;
    })(),
    coverFitMode: (() => {
      const value = config.get("coverFitMode");
      return value === "crop" || value === "contain"
        ? value
        : defaultViewSettings.coverFitMode;
    })(),
    timestampFormat: globalSettings.timestampFormat, // From global settings
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
    openRandomInNewPane: globalSettings.openRandomInNewPane, // From global settings
    showShuffleInRibbon: globalSettings.showShuffleInRibbon, // From global settings
    showRandomInRibbon: globalSettings.showRandomInRibbon, // From global settings
    smartTimestamp: globalSettings.smartTimestamp, // From global settings
    createdTimeProperty: globalSettings.createdTimeProperty, // From global settings
    modifiedTimeProperty: globalSettings.modifiedTimeProperty, // From global settings
    fallbackToFileMetadata: globalSettings.fallbackToFileMetadata, // From global settings
    expandImagesOnClick: globalSettings.expandImagesOnClick, // From global settings
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
  };
}
