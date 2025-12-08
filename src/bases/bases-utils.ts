/**
 * Shared utilities for Bases views (card-view and masonry-view)
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
  loadSnippetsForEntries,
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

/**
 * Setup MutationObserver for Dynamic Views Style Settings changes
 * @returns Cleanup function to disconnect observer
 */
export function setupStyleSettingsObserver(
  onStyleChange: () => void,
): () => void {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (
        mutation.type === "attributes" &&
        mutation.attributeName === "class"
      ) {
        // Check if any dynamic-views class changed
        const oldClasses = mutation.oldValue?.split(" ") || [];
        const newClasses = document.body.className.split(" ");
        const dynamicViewsChanged =
          oldClasses
            .filter((c) => c.startsWith("dynamic-views-"))
            .sort()
            .join() !==
          newClasses
            .filter((c) => c.startsWith("dynamic-views-"))
            .sort()
            .join();

        if (dynamicViewsChanged) {
          onStyleChange();
          break;
        }
      }
    }
  });

  observer.observe(document.body, {
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ["class"],
  });

  return () => observer.disconnect();
}

/** Interface for Bases config sort method */
interface BasesConfigWithSort {
  getSort(): Array<{ property: string; direction: string }> | null;
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
 * Load snippets and images for Bases entries
 */
export async function loadContentForEntries(
  entries: BasesEntry[],
  settings: Settings,
  app: App,
  snippets: Record<string, string>,
  images: Record<string, string | string[]>,
  hasImageAvailable: Record<string, boolean>,
): Promise<void> {
  // Load snippets for text preview
  if (settings.showTextPreview) {
    const snippetEntries = entries
      .filter((entry) => !(entry.file.path in snippets))
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
            if (
              textPreviewValue?.data != null &&
              textPreviewValue.data !== ""
            ) {
              textPreviewData = textPreviewValue.data;
              break;
            }
          }
        }
        return {
          path: entry.file.path,
          file,
          textPreviewData,
        };
      })
      .filter(
        (e): e is { path: string; file: TFile; textPreviewData: unknown } =>
          e !== null,
      );

    await loadSnippetsForEntries(
      snippetEntries,
      settings.fallbackToContent,
      settings.omitFirstLine,
      app,
      snippets,
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
