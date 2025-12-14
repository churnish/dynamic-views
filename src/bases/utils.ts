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

/** Interface for Bases config sort method */
interface BasesConfigWithSort {
  getSort(): Array<{ property: string; direction: string }> | null;
  getDisplayName(property: string): string;
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
        return indexA - indexB;
      });
    }
    return { group, entries: groupEntries };
  });
}

/**
 * Render group header if group has a key
 * Creates the heading element with property label and value
 */
export function renderGroupHeader(
  groupEl: HTMLElement,
  group: { hasKey(): boolean; key?: unknown },
  config: BasesConfigWithSort,
): void {
  if (!group.hasKey()) return;

  const headerEl = groupEl.createDiv("bases-group-heading");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
  const groupBy = (config as any).groupBy;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (groupBy?.property) {
    const propertyEl = headerEl.createDiv("bases-group-property");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
    const propertyName = config.getDisplayName(groupBy.property);
    propertyEl.setText(propertyName);
  }

  const valueEl = headerEl.createDiv("bases-group-value");
  const keyValue = group.key?.toString() || "";
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
