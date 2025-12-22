/**
 * Shared utilities for Bases views (grid-view and masonry-view)
 * Eliminates code duplication between view implementations
 */

import { BasesEntry, TFile, App } from "obsidian";
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
import type { Settings } from "../types";

/** CSS selector for embedded view detection - centralized for maintainability */
export const EMBEDDED_VIEW_SELECTOR =
  ".markdown-preview-view, .markdown-reading-view, .markdown-source-view";

/** Sentinel value for undefined group keys in dataset storage */
export const UNDEFINED_GROUP_KEY_SENTINEL = "__dv_undefined__";

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
export { setupStyleSettingsObserver } from "../utils/style-settings";

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
      // For complex data (arrays, nested objects), stringify the data portion
      try {
        return JSON.stringify(data);
      } catch {
        // Fall through to full object stringify
      }
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
 * Render group header if group has a key
 * Creates the heading element with property label and value
 * Header is rendered as sibling to card group (matching vanilla Bases structure)
 */
export function renderGroupHeader(
  containerEl: HTMLElement,
  group: { hasKey(): boolean; key?: unknown },
  config: BasesConfigWithSort,
): void {
  if (!group.hasKey()) return;

  const headerEl = containerEl.createDiv("bases-group-heading");

  if (config.groupBy?.property) {
    const propertyEl = headerEl.createDiv("bases-group-property");
    const propertyName = config.getDisplayName(config.groupBy.property);
    propertyEl.setText(propertyName);
  }

  const valueEl = headerEl.createDiv("bases-group-value");
  // Use serializeGroupKey for display - handles primitives cleanly
  const keyValue = serializeGroupKey(group.key) ?? "";
  valueEl.setText(keyValue);
}

/**
 * Get sort method from Bases config
 */
export function getSortMethod(config: BasesConfigWithSort): string {
  const sortConfigs = config.getSort();

  if (sortConfigs && sortConfigs.length > 0) {
    const firstSort = sortConfigs[0];
    const property = firstSort.property;
    const direction = firstSort.direction.toLowerCase();

    if (property.includes("ctime")) {
      return `ctime-${direction}`;
    }
    if (property.includes("mtime")) {
      return `mtime-${direction}`;
    }
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
  if (settings.showTextPreview) {
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
  if (settings.imageFormat !== "none") {
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
    );
  }
}
