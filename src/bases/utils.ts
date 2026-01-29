/**
 * Shared utilities for Bases views (grid-view and masonry-view)
 * Eliminates code duplication between view implementations
 */

import { BasesEntry, TFile, TFolder, Menu, App, BasesView } from "obsidian";
import { resolveTimestampProperty } from "../shared/data-transform";
import {
  getFirstBasesPropertyValue,
  getAllBasesImagePropertyValues,
  normalizePropertyName,
} from "../utils/property";
import {
  loadTextPreviewsForEntries,
  loadImagesForEntries,
} from "../shared/content-loader";
import { setupSwipeInterception } from "./swipe-interceptor";
import {
  shouldUseNotebookNavigator,
  navigateToTagInNotebookNavigator,
  navigateToFolderInNotebookNavigator,
} from "../utils/notebook-navigator";
import type { Settings, DefaultViewSettings } from "../types";
import { DEFAULT_VIEW_SETTINGS } from "../constants";
import type DynamicViews from "../../main";

// Bases config interface for initialization (get/set only - getAll handled by tryGetAllConfig)
interface BasesConfigInit {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

/** Marker key for initialized views - plugin-scoped to avoid collisions */
export const INIT_MARKER = "_dynamic-views-initialized";

/**
 * Safely get all config keys, validating structure
 * Returns config keys object if valid, null otherwise
 * Used to safely access Obsidian's undocumented config.getAll()
 */
export function tryGetAllConfig(
  config: unknown,
): Record<string, unknown> | null {
  if (
    typeof config !== "object" ||
    config === null ||
    !("getAll" in config) ||
    typeof (config as Record<string, unknown>).getAll !== "function"
  ) {
    return null;
  }

  try {
    const result = (config as { getAll: () => unknown }).getAll();
    // Validate result is a plain object (not null, array, or other object types)
    if (
      result !== null &&
      typeof result === "object" &&
      !Array.isArray(result)
    ) {
      return result as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Safely set config value with error handling
 */
function safeConfigSet(
  config: BasesConfigInit,
  key: string,
  value: unknown,
): void {
  try {
    config.set(key, value);
  } catch (e) {
    console.warn(`[dynamic-views] Failed to set config key "${key}":`, e);
  }
}

/**
 * Check if value needs to be set to empty string (cleared or invalid type)
 */
function needsEmptyString(value: unknown): boolean {
  return value === undefined || typeof value !== "string";
}

/** All property display keys (1-14) for iteration */
const PROPERTY_DISPLAY_KEYS = [
  "propertyDisplay1",
  "propertyDisplay2",
  "propertyDisplay3",
  "propertyDisplay4",
  "propertyDisplay5",
  "propertyDisplay6",
  "propertyDisplay7",
  "propertyDisplay8",
  "propertyDisplay9",
  "propertyDisplay10",
  "propertyDisplay11",
  "propertyDisplay12",
  "propertyDisplay13",
  "propertyDisplay14",
] as const;

/**
 * Initialize default property values for a new Bases view
 * Called once on view creation to persist defaults so clearing works correctly
 *
 * IMPORTANT: This function must run before readBasesSettings() to ensure
 * defaults are persisted. If initialization fails, propertyDisplay fields
 * fall back to "" (empty) in readBasesSettings.
 *
 * @param config - Bases config object with get/set methods
 * @param allKeys - Pre-fetched config keys from tryGetAllConfig()
 * @param plugin - Plugin instance to access persistence manager
 * @param file - TFile of the view being initialized
 * @param viewType - Type of view (grid or masonry)
 */
export function initializeViewDefaults(
  config: BasesConfigInit,
  allKeys: Record<string, unknown>,
  plugin: DynamicViews,
  file: TFile | null,
  viewType: "grid" | "masonry",
): void {
  console.log(
    `[initializeViewDefaults] Called for ${viewType}, hasInitMarker=${INIT_MARKER in allKeys}`,
  );

  // Check for initialization marker (persists even if user clears all settings)
  if (INIT_MARKER in allKeys) {
    // View was initialized before - preserve existing state, don't apply template
    console.log(
      "[initializeViewDefaults] Already initialized, preserving state",
    );
    for (const key of PROPERTY_DISPLAY_KEYS) {
      if (needsEmptyString(allKeys[key])) {
        safeConfigSet(config, key, "");
      }
    }
    return;
  }

  // Fresh view - check for settings template or use defaults
  let defaults: Partial<DefaultViewSettings>;
  const settingsTemplate =
    plugin.persistenceManager.getSettingsTemplate(viewType);

  console.log(
    `[initializeViewDefaults] viewType=${viewType}, hasTemplate=${!!settingsTemplate}`,
  );
  if (settingsTemplate) {
    console.log(
      "[initializeViewDefaults] Using settings template, titleProperty:",
      settingsTemplate.settings.titleProperty,
    );
    console.log(
      "[initializeViewDefaults] Using settings template, cardSize:",
      settingsTemplate.settings.cardSize,
    );
  }

  if (settingsTemplate) {
    // Copy from settings template
    defaults = settingsTemplate.settings;
  } else {
    // Use global defaults
    console.log("[initializeViewDefaults] No template, using global defaults");
    defaults = plugin.persistenceManager.getDefaultViewSettings();
  }

  // Initialize with defaults
  safeConfigSet(config, INIT_MARKER, true);

  // Apply all settings from template or global defaults
  console.log(
    "[initializeViewDefaults] About to apply titleProperty:",
    defaults?.titleProperty,
  );
  if (defaults?.titleProperty !== undefined) {
    safeConfigSet(config, "titleProperty", defaults.titleProperty);
    console.log("[initializeViewDefaults] Applied titleProperty successfully");
  } else {
    console.log(
      "[initializeViewDefaults] titleProperty is undefined, skipping",
    );
  }
  if (defaults?.textPreviewProperty !== undefined) {
    safeConfigSet(config, "textPreviewProperty", defaults.textPreviewProperty);
  }
  if (defaults?.imageProperty !== undefined) {
    safeConfigSet(config, "imageProperty", defaults.imageProperty);
  }
  if (defaults?.urlProperty !== undefined) {
    safeConfigSet(config, "urlProperty", defaults.urlProperty);
  }
  if (defaults?.subtitleProperty !== undefined) {
    safeConfigSet(config, "subtitleProperty", defaults.subtitleProperty);
  }
  if (defaults?.fallbackToContent !== undefined) {
    safeConfigSet(config, "fallbackToContent", defaults.fallbackToContent);
  }
  if (defaults?.fallbackToEmbeds !== undefined) {
    safeConfigSet(config, "fallbackToEmbeds", defaults.fallbackToEmbeds);
  }
  if (defaults?.cssclasses !== undefined) {
    safeConfigSet(config, "cssclasses", defaults.cssclasses);
  }
  if (defaults?.cardSize !== undefined) {
    safeConfigSet(config, "cardSize", defaults.cardSize);
  }
  if (defaults?.imageFormat !== undefined) {
    safeConfigSet(config, "imageFormat", defaults.imageFormat);
  }
  if (defaults?.imagePosition !== undefined) {
    safeConfigSet(config, "imagePosition", defaults.imagePosition);
  }
  if (defaults?.imageFit !== undefined) {
    safeConfigSet(config, "imageFit", defaults.imageFit);
  }
  if (defaults?.imageAspectRatio !== undefined) {
    safeConfigSet(config, "imageAspectRatio", defaults.imageAspectRatio);
  }
  if (defaults?.propertyLabels !== undefined) {
    safeConfigSet(config, "propertyLabels", defaults.propertyLabels);
  }
  if (defaults?.listMarker !== undefined) {
    safeConfigSet(config, "listMarker", defaults.listMarker);
  }

  // Property display strings (1-14)
  safeConfigSet(
    config,
    "propertyDisplay1",
    defaults?.propertyDisplay1 ?? DEFAULT_VIEW_SETTINGS.propertyDisplay1,
  );
  safeConfigSet(
    config,
    "propertyDisplay2",
    defaults?.propertyDisplay2 ?? DEFAULT_VIEW_SETTINGS.propertyDisplay2,
  );
  // Properties 3-14 default to "" (empty) - persist so clearing works
  for (const key of PROPERTY_DISPLAY_KEYS.slice(2)) {
    safeConfigSet(config, key, defaults?.[key] ?? "");
  }

  // Property set side-by-side booleans (1-7)
  if (defaults?.propertySet1SideBySide !== undefined) {
    safeConfigSet(
      config,
      "propertySet1SideBySide",
      defaults.propertySet1SideBySide,
    );
  }
  if (defaults?.propertySet2SideBySide !== undefined) {
    safeConfigSet(
      config,
      "propertySet2SideBySide",
      defaults.propertySet2SideBySide,
    );
  }
  if (defaults?.propertySet3SideBySide !== undefined) {
    safeConfigSet(
      config,
      "propertySet3SideBySide",
      defaults.propertySet3SideBySide,
    );
  }
  if (defaults?.propertySet4SideBySide !== undefined) {
    safeConfigSet(
      config,
      "propertySet4SideBySide",
      defaults.propertySet4SideBySide,
    );
  }
  if (defaults?.propertySet5SideBySide !== undefined) {
    safeConfigSet(
      config,
      "propertySet5SideBySide",
      defaults.propertySet5SideBySide,
    );
  }
  if (defaults?.propertySet6SideBySide !== undefined) {
    safeConfigSet(
      config,
      "propertySet6SideBySide",
      defaults.propertySet6SideBySide,
    );
  }
  if (defaults?.propertySet7SideBySide !== undefined) {
    safeConfigSet(
      config,
      "propertySet7SideBySide",
      defaults.propertySet7SideBySide,
    );
  }
}

/** CSS selector for embedded view detection - centralized for maintainability */
export const EMBEDDED_VIEW_SELECTOR =
  ".markdown-preview-view, .markdown-reading-view, .markdown-source-view";

/** Sentinel value for undefined group keys in dataset storage */
export const UNDEFINED_GROUP_KEY_SENTINEL = "__dynamic-views-undefined__";

/**
 * Write group key to element's dataset, using sentinel for undefined
 */
export function setGroupKeyDataset(
  el: HTMLElement,
  groupKey: string | undefined,
): void {
  el.dataset.groupKey =
    groupKey === undefined ? UNDEFINED_GROUP_KEY_SENTINEL : groupKey;
}

/**
 * Read group key from element's dataset, converting sentinel to undefined
 */
export function getGroupKeyDataset(el: HTMLElement): string | undefined {
  const value = el.dataset.groupKey;
  return value === UNDEFINED_GROUP_KEY_SENTINEL ? undefined : value;
}

/**
 * Check if a container element is embedded within a markdown view
 */
export function isEmbeddedView(containerEl: HTMLElement): boolean {
  return containerEl.closest(EMBEDDED_VIEW_SELECTOR) !== null;
}

/**
 * Setup swipe interception on mobile if enabled based on settings
 * @returns AbortController if interception was set up, null otherwise
 */
export function setupBasesSwipeInterception(
  containerEl: HTMLElement,
  app: App,
  globalSettings: Settings,
): AbortController | null {
  const isEmbedded = isEmbeddedView(containerEl);
  const shouldIntercept =
    app.isMobile &&
    (globalSettings.preventSidebarSwipe === "all-views" ||
      (globalSettings.preventSidebarSwipe === "base-files" && !isEmbedded));

  if (shouldIntercept) {
    const controller = new AbortController();
    setupSwipeInterception(containerEl, controller.signal);
    return controller;
  }
  return null;
}

// Re-export from shared location
export {
  setupStyleSettingsObserver,
  getStyleSettingsHash,
} from "../utils/style-settings";

/** Interface for Bases config groupBy property */
export interface BasesGroupBy {
  property?: string;
}

/** Interface for Bases config with sort and groupBy methods */
interface BasesConfigWithSort {
  getSort(): Array<{ property: string; direction: string }> | null;
  getDisplayName(property: string): string;
  groupBy?: BasesGroupBy;
}

/** Type guard to check if config has groupBy with valid structure */
export function hasGroupBy(
  config: unknown,
): config is { groupBy?: BasesGroupBy } {
  if (typeof config !== "object" || config === null || !("groupBy" in config)) {
    return false;
  }
  const groupBy = (config as { groupBy: unknown }).groupBy;
  // groupBy can be undefined (no grouping) or object with optional property string
  return (
    groupBy === undefined ||
    (typeof groupBy === "object" &&
      groupBy !== null &&
      (!("property" in groupBy) ||
        typeof (groupBy as { property: unknown }).property === "string"))
  );
}

/**
 * Serialize group key to string for comparison
 * Handles Bases Value objects, date objects, and objects that would stringify to "[object Object]"
 */
export function serializeGroupKey(key: unknown): string | undefined {
  if (key === undefined || key === null) return undefined;
  if (typeof key === "string") return key;
  if (typeof key === "number" || typeof key === "boolean") return String(key);

  if (typeof key === "object" && key !== null) {
    // Check if array-like (Bases uses proxy arrays that fail Array.isArray)
    const isArrayLike =
      Array.isArray(key) ||
      (typeof (key as ArrayLike<unknown>).length === "number" &&
        !("data" in key) &&
        !("date" in key));

    // Handle arrays of Bases Value objects (e.g., tags: [{icon, data: "#tag1"}, ...])
    if (isArrayLike) {
      // Avoid copying if already an array
      const arr = Array.isArray(key)
        ? key
        : Array.from(key as ArrayLike<unknown>);
      if (arr.length === 0) return undefined;
      // Extract .data from each element that has it
      const extracted = arr.map((item): unknown => {
        if (item && typeof item === "object" && "data" in item) {
          return (item as { data: unknown }).data;
        }
        return item;
      });
      // If all elements are strings/primitives after extraction, join them
      if (extracted.every((v) => typeof v === "string")) {
        return extracted.join(", ");
      }
      if (
        extracted.every(
          (v) =>
            typeof v === "string" ||
            typeof v === "number" ||
            typeof v === "boolean",
        )
      ) {
        return extracted.map(String).join(", ");
      }
      // Complex array - stringify
      try {
        return JSON.stringify(extracted);
      } catch {
        // Fall through
      }
    }

    // Handle Bases date Value objects (e.g., {date: Date, time: boolean})
    if ("date" in key && (key as { date: unknown }).date instanceof Date) {
      return (key as { date: Date }).date.toISOString();
    }

    // Handle Bases Value objects with .data property (e.g., {icon: "...", data: 462})
    if ("data" in key) {
      const data = (key as { data: unknown }).data;
      if (data === null || data === undefined) return undefined;
      if (typeof data === "string") return data;
      if (typeof data === "number" || typeof data === "boolean")
        return String(data);
      // Recursively process .data (handles arrays of Value objects inside .data)
      if (typeof data === "object" && data !== null) {
        return serializeGroupKey(data);
      }
    }

    // Handle Bases Value objects with .icon but no .data (empty/missing value)
    if ("icon" in key && !("data" in key)) {
      return undefined;
    }
  }

  // For objects/arrays, use JSON to avoid collision
  try {
    return JSON.stringify(key);
  } catch {
    // JSON.stringify can fail on circular references - fallback to unique string
    return `[object:${Object.prototype.toString.call(key)}]`;
  }
}

/** Interface for group data with entries */
interface GroupData {
  entries: BasesEntry[];
  hasKey(): boolean;
  key?: unknown;
}

/**
 * Process groups with shuffle logic applied
 * Extracts and optionally reorders entries within each group based on shuffle state
 */
export function processGroups<T extends GroupData>(
  groupedData: T[],
  isShuffled: boolean,
  shuffledOrder: string[],
): Array<{ group: T; entries: BasesEntry[] }> {
  return groupedData.map((group) => {
    let groupEntries = [...group.entries];
    if (isShuffled && shuffledOrder.length > 0) {
      groupEntries = groupEntries.sort((a, b) => {
        const indexA = shuffledOrder.indexOf(a.file.path);
        const indexB = shuffledOrder.indexOf(b.file.path);
        // Missing entries (indexOf returns -1) sort to end
        const adjustedA = indexA === -1 ? Infinity : indexA;
        const adjustedB = indexB === -1 ? Infinity : indexB;
        return adjustedA - adjustedB;
      });
    }
    return { group, entries: groupEntries };
  });
}

/**
 * Check if value is a tag array (array of Value objects with # prefixed data)
 * Bases proxy arrays have .data containing the actual array
 */
function isTagArray(key: unknown): boolean {
  if (!key || typeof key !== "object") return false;

  // Bases proxy has .data property containing the actual array
  if (!("data" in key)) return false;

  const data = (key as { data: unknown }).data;
  if (!data || !Array.isArray(data) || data.length === 0) return false;

  // Check if first item has .data starting with #
  const first: unknown = data[0];
  if (first && typeof first === "object" && "data" in first) {
    const itemData = (first as { data: unknown }).data;
    return typeof itemData === "string" && itemData.startsWith("#");
  }
  return false;
}

/**
 * Render group value with rich HTML matching vanilla Bases structure
 * Handles tags, dates, folders, and primitives
 */
function renderGroupValue(
  valueEl: HTMLElement,
  key: unknown,
  app: App,
  propertyName?: string,
): void {
  // Tags: render as clickable tag elements
  if (isTagArray(key)) {
    // Bases proxy has .data containing the actual array
    const dataArr = (key as { data: unknown[] }).data;
    const arr = Array.isArray(dataArr) ? dataArr : Array.from(dataArr);
    const container = valueEl.createDiv("value-list-container");

    // Create tag elements
    arr.forEach((item) => {
      if (item && typeof item === "object" && "data" in item) {
        const data = (item as { data: unknown }).data;
        if (typeof data === "string" && data.startsWith("#")) {
          const element = container.createSpan("value-list-element");
          element.createEl("a", {
            cls: "tag",
            text: data.slice(1), // Remove # prefix
            href: "#",
          });
        }
      }
    });

    // Event delegation: single listener on container handles all tag clicks
    container.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (!target.hasClass("tag")) return;
      e.preventDefault();

      const tagText = target.textContent ?? "";
      // Use Notebook Navigator if configured for tags
      if (
        shouldUseNotebookNavigator(app, "tag") &&
        navigateToTagInNotebookNavigator(app, tagText)
      ) {
        return;
      }
      // Fallback to global search
      const searchPlugin = (
        app as unknown as {
          internalPlugins: {
            plugins: {
              "global-search"?: {
                instance?: { openGlobalSearch?: (query: string) => void };
              };
            };
          };
        }
      ).internalPlugins.plugins["global-search"];
      if (searchPlugin?.instance?.openGlobalSearch) {
        searchPlugin.instance.openGlobalSearch("tag:" + tagText);
      }
    });
    return;
  }

  // Dates: format as timestamp
  if (
    key &&
    typeof key === "object" &&
    "date" in key &&
    (key as { date: unknown }).date instanceof Date
  ) {
    const date = (key as { date: Date }).date;
    valueEl.setText(date.toLocaleDateString());
    return;
  }

  // Folders: render as clickable path segments
  if (propertyName === "file.folder" || propertyName === "folder") {
    // Extract folder path from Bases Value object or plain string
    const folderPath =
      key && typeof key === "object" && "data" in key
        ? String((key as { data: unknown }).data)
        : typeof key === "string"
          ? key
          : null;

    if (folderPath && folderPath.length > 0) {
      const folders = folderPath.split("/").filter((f) => f);
      if (folders.length > 0) {
        const pathWrapper = valueEl.createDiv("path-wrapper");

        folders.forEach((folder, idx) => {
          const cumulativePath = folders.slice(0, idx + 1).join("/");
          const segmentWrapper = pathWrapper.createSpan("path-segment-wrapper");

          const segment = segmentWrapper.createSpan(
            "path-segment folder-segment",
          );
          segment.setText(folder);

          segment.addEventListener("click", (e) => {
            e.stopPropagation();
            const folderFile = app.vault.getAbstractFileByPath(cumulativePath);
            if (shouldUseNotebookNavigator(app, "folder")) {
              if (
                folderFile instanceof TFolder &&
                navigateToFolderInNotebookNavigator(app, folderFile)
              ) {
                return;
              }
            }
            const fileExplorer = (
              app as unknown as {
                internalPlugins?: {
                  plugins?: {
                    "file-explorer"?: {
                      instance?: { revealInFolder?: (file: unknown) => void };
                    };
                  };
                };
              }
            ).internalPlugins?.plugins?.["file-explorer"];
            if (fileExplorer?.instance?.revealInFolder && folderFile) {
              fileExplorer.instance.revealInFolder(folderFile);
            }
          });

          segment.addEventListener("contextmenu", (e) => {
            e.stopPropagation();
            e.preventDefault();
            const folderFile = app.vault.getAbstractFileByPath(cumulativePath);
            if (folderFile instanceof TFolder) {
              const menu = new Menu();
              app.workspace.trigger(
                "file-menu",
                menu,
                folderFile,
                "file-explorer",
              );
              menu.showAtMouseEvent(e);
            }
          });

          if (idx < folders.length - 1) {
            const separator = segmentWrapper.createSpan("path-separator");
            separator.setText("/");
          }
        });
        return;
      }
    }
  }

  // Fallback: use serialized string
  const keyValue = serializeGroupKey(key) ?? "";
  valueEl.setText(keyValue);
}

/**
 * Render group header with property name and value (or "None" for empty keys)
 * Header is rendered as sibling to card group (matching vanilla Bases structure)
 */
export function renderGroupHeader(
  containerEl: HTMLElement,
  group: { hasKey(): boolean; key?: unknown },
  config: BasesConfigWithSort,
  app: App,
  entryCount: number,
): void {
  // Don't render header when not grouping
  if (!config.groupBy?.property) return;

  const headerEl = containerEl.createDiv("bases-group-heading");

  const propertyEl = headerEl.createDiv("bases-group-property");
  const propertyName = config.getDisplayName(config.groupBy.property);
  propertyEl.setText(propertyName);

  const valueEl = headerEl.createDiv("bases-group-value");

  // Show "None" for empty/missing keys (covers hasKey()=false and empty arrays)
  if (!serializeGroupKey(group.key)) {
    valueEl.setText("None");
    const countEl = headerEl.createDiv("bases-group-count");
    const formattedCount = entryCount
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const countText =
      entryCount === 1 ? "1 result" : `${formattedCount} results`;
    countEl.setText(countText);
    return;
  }

  renderGroupValue(valueEl, group.key, app, config.groupBy.property);

  // Render result count
  const countEl = headerEl.createDiv("bases-group-count");
  const formattedCount = entryCount
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const countText = entryCount === 1 ? "1 result" : `${formattedCount} results`;
  countEl.setText(countText);
}

/**
 * Get sort method from Bases config
 * Returns a string that uniquely identifies the sort configuration
 */
export function getSortMethod(config: BasesConfigWithSort): string {
  const sortConfigs = config.getSort();

  if (sortConfigs && sortConfigs.length > 0) {
    const firstSort = sortConfigs[0];
    const property = firstSort.property;
    const direction = firstSort.direction.toLowerCase();
    return `${property}-${direction}`;
  }
  return "mtime-desc";
}

/**
 * Load text previews and images for Bases entries
 */
export async function loadContentForEntries(
  entries: BasesEntry[],
  settings: Settings,
  app: App,
  textPreviews: Record<string, string>,
  images: Record<string, string | string[]>,
  hasImageAvailable: Record<string, boolean>,
): Promise<void> {
  // Load text previews
  if (settings.textPreviewProperty || settings.fallbackToContent) {
    const textPreviewEntries = entries
      .filter((entry) => !(entry.file.path in textPreviews))
      .map((entry) => {
        const file = app.vault.getAbstractFileByPath(entry.file.path);
        if (!(file instanceof TFile)) return null;

        // Resolve text preview property - check timestamps first
        let textPreviewData: unknown = null;
        if (settings.textPreviewProperty) {
          const textPreviewProps = settings.textPreviewProperty
            .split(",")
            .map((p) => p.trim());
          for (const prop of textPreviewProps) {
            const normalizedProp = normalizePropertyName(app, prop);
            // Try timestamp property first
            const timestamp = resolveTimestampProperty(
              normalizedProp,
              entry.file.stat.ctime,
              entry.file.stat.mtime,
            );
            if (timestamp) {
              textPreviewData = timestamp;
              break;
            }
            // Try regular property
            const textPreviewValue = getFirstBasesPropertyValue(
              app,
              entry,
              normalizedProp,
            ) as { data?: unknown } | null;
            const data = textPreviewValue?.data;
            if (
              data != null &&
              data !== "" &&
              (typeof data === "string" || typeof data === "number")
            ) {
              textPreviewData = data;
              break;
            }
          }
        }

        // Get title for first line comparison (similar to Datacore path)
        let titleString: string | undefined;
        if (settings.titleProperty) {
          const titleProps = settings.titleProperty
            .split(",")
            .map((p) => p.trim());
          for (const prop of titleProps) {
            const normalizedProp = normalizePropertyName(app, prop);
            const titleValue = getFirstBasesPropertyValue(
              app,
              entry,
              normalizedProp,
            ) as { data?: unknown } | null;
            if (
              titleValue?.data != null &&
              titleValue.data !== "" &&
              (typeof titleValue.data === "string" ||
                typeof titleValue.data === "number")
            ) {
              titleString = String(titleValue.data);
              break;
            }
          }
        }

        return {
          path: entry.file.path,
          file,
          textPreviewData,
          fileName: entry.file.basename,
          titleString,
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    await loadTextPreviewsForEntries(
      textPreviewEntries,
      settings.fallbackToContent,
      settings.omitFirstLine,
      app,
      textPreviews,
    );
  }

  // Load images for thumbnails
  {
    const imageEntries = entries
      .filter((entry) => !(entry.file.path in images))
      .map((entry) => {
        const file = app.vault.getAbstractFileByPath(entry.file.path);
        if (!(file instanceof TFile)) return null;

        // Normalize property names to support both display names and syntax names
        const normalizedImageProperty = settings.imageProperty
          ? settings.imageProperty
              .split(",")
              .map((p) => normalizePropertyName(app, p.trim()))
              .join(",")
          : "";
        const imagePropertyValues = getAllBasesImagePropertyValues(
          app,
          entry,
          normalizedImageProperty,
        );
        return {
          path: entry.file.path,
          file,
          imagePropertyValues: imagePropertyValues as unknown[],
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    await loadImagesForEntries(
      imageEntries,
      settings.fallbackToEmbeds,
      app,
      images,
      hasImageAvailable,
      {
        includeYoutube: settings.showYoutubeThumbnails,
        includeCardLink: settings.showCardLinkCovers,
      },
    );
  }
}

/** Interface for accessing Bases view through Obsidian's view wrapper */
interface BasesViewWrapper {
  controller?: {
    view?: {
      type?: string;
      config: {
        get(key: string): unknown;
        set(key: string, value: unknown): void;
      };
    };
  };
}

/**
 * Check if a view is the current template by comparing timestamps
 * Used to validate template toggle state on view load
 * @param config - View's config object
 * @param viewType - "grid" or "masonry"
 * @param plugin - Plugin instance for accessing persistence manager
 * @returns true if this view is the current template, false if stale
 */
export function isCurrentTemplateView(
  config: BasesConfigInit,
  viewType: "grid" | "masonry",
  plugin: DynamicViews,
): boolean {
  const savedTemplate = plugin.persistenceManager.getSettingsTemplate(viewType);

  // No template exists - this can't be the template
  if (!savedTemplate) {
    return false;
  }

  // Get this view's timestamp
  const viewTimestamp = config.get("__templateSetAt");

  // Compare timestamps - only the view that most recently became template should match
  return viewTimestamp === savedTemplate.setAt;
}

/**
 * Disable __isTemplate toggle in all other views of the same type
 * Implements mutual exclusion - only one view of each type can be template
 * @param app - Obsidian App instance
 * @param viewType - Type identifier ("dynamic-views-grid" or "dynamic-views-masonry")
 * @param currentView - The view that should remain enabled (optional - skip this one)
 */
export function clearOldTemplateToggles(
  app: App,
  viewType: "dynamic-views-grid" | "dynamic-views-masonry",
  currentView?: BasesView,
): void {
  console.log(
    `[clearOldTemplateToggles] Disabling templates for type: ${viewType}`,
  );

  app.workspace.iterateAllLeaves((leaf) => {
    const view = leaf.view as BasesViewWrapper;
    const actualView = view.controller?.view;

    // Skip if not a dynamic-views view
    if (!actualView?.type?.startsWith("dynamic-views-")) {
      return;
    }

    // Skip if different view type (e.g., masonry when we're processing grid)
    if (actualView.type !== viewType) {
      return;
    }

    // Skip the current view (the one being enabled)
    if (currentView && actualView === currentView) {
      return;
    }

    // Check if this view has template enabled
    const isTemplate = actualView.config.get("__isTemplate") === true;
    if (isTemplate) {
      console.log(
        `[clearOldTemplateToggles] Disabling template in view`,
        actualView,
      );
      // Clear timestamp first so the cascading onDataUpdated() won't try to clear the global template
      actualView.config.set("__templateSetAt", undefined);
      actualView.config.set("__isTemplate", false);
    }
  });
}
