import type { App, TFile } from "obsidian";
import {
  processImagePaths,
  resolveInternalImagePaths,
  extractImageEmbeds,
} from "../utils/image";
import { loadFilePreview } from "../utils/text-preview";
import { getSlideshowMaxImages } from "../utils/style-settings";

// Track in-flight loads - Map to Promises so concurrent requests can await
const inFlightTextPreviews = new Map<string, Promise<string>>();

/**
 * Result of loading images for an entry
 * Returned by Promise so all callers can assign to their own caches
 */
interface ImageLoadResult {
  images: string | string[] | null;
  hasImage: boolean;
}

const inFlightImages = new Map<string, Promise<ImageLoadResult>>();

/**
 * Clear in-flight tracking (call on plugin unload)
 */
export function clearInFlightLoads(): void {
  inFlightTextPreviews.clear();
  inFlightImages.clear();
}

/**
 * Entry with text preview loading data
 */
export interface TextPreviewEntry {
  path: string;
  file: TFile;
  textPreviewData: unknown;
  fileName?: string;
  titleString?: string;
}

/**
 * Loads images for an entry
 * Handles property images, fallback to embeds, and caching
 *
 * @param path - File path for the entry
 * @param file - TFile object
 * @param app - Obsidian app instance
 * @param imagePropertyValues - Array of image property values
 * @param fallbackToEmbeds - Whether to extract embedded images if no property images
 * @param imageCache - Cache object to store loaded images
 * @param hasImageCache - Cache object to track image availability
 * @param embedOptions - Options for embed extraction (YouTube, cardlink)
 */
export async function loadImageForEntry(
  path: string,
  file: TFile,
  app: App,
  imagePropertyValues: unknown[],
  fallbackToEmbeds: "always" | "if-empty" | "never",
  imageCache: Record<string, string | string[]>,
  hasImageCache: Record<string, boolean>,
  embedOptions?: {
    includeYoutube?: boolean;
    includeCardLink?: boolean;
  },
): Promise<void> {
  // Skip if already in caller's cache (uses path, not composite key, because each
  // caller passes their own cache objects - this prevents re-loading within a batch)
  if (path in hasImageCache) {
    return;
  }

  // If another view is loading this path with same settings, await its result
  // Composite key includes all parameters that affect output:
  // - fallbackToEmbeds: determines whether embeds are extracted
  // - embedOptions: determines which embed types (YouTube, CardLink) are included
  const embedKey = embedOptions
    ? `${embedOptions.includeYoutube ?? false}|${embedOptions.includeCardLink ?? false}`
    : "false|false";
  const cacheKey = `${path}|${fallbackToEmbeds}|${embedKey}`;
  const existing = inFlightImages.get(cacheKey);
  if (existing) {
    const result = await existing;
    if (result.images !== null) {
      imageCache[path] = result.images;
    }
    hasImageCache[path] = result.hasImage;
    return;
  }

  // Create and store the loading promise - returns result so all callers can assign to their caches
  const loadPromise = (async (): Promise<ImageLoadResult> => {
    try {
      // Get max images once (used for both embed limit check and final slice)
      const maxImages = getSlideshowMaxImages();

      // Filter to only valid string paths before processing
      const validPaths = imagePropertyValues.filter(
        (v): v is string => typeof v === "string" && v.length > 0,
      );

      // Process image paths using shared utility (sync - no validation needed)
      const { internalPaths, externalUrls } = processImagePaths(validPaths);

      // Convert internal paths to resource URLs using shared utility
      let validImages: string[] = [
        ...resolveInternalImagePaths(internalPaths, path, app),
        ...externalUrls, // External URLs passed through - browser handles load/error
      ];

      // Handle embed images based on fallbackToEmbeds mode
      if (fallbackToEmbeds === "always") {
        // Pull from properties first, then append in-note embeds
        // Skip parsing if property already has max images
        if (validImages.length < maxImages) {
          const embedImages = await extractImageEmbeds(file, app, embedOptions);
          validImages = [...validImages, ...embedImages];
        }
      } else if (fallbackToEmbeds === "if-empty") {
        // Only use embeds if property missing/empty
        if (validImages.length === 0) {
          validImages = await extractImageEmbeds(file, app, embedOptions);
        }
      } else if (fallbackToEmbeds === "never") {
        // Only use property images, never use embeds
        // No action needed - validImages already contains only property images
      }

      if (validImages.length > 0) {
        // Limit images to slideshow max to avoid loading excess images
        const limitedImages = validImages.slice(0, maxImages);
        // Return as array if multiple, string if single
        return {
          images: limitedImages.length > 1 ? limitedImages : limitedImages[0],
          hasImage: true,
        };
      } else {
        // No images available
        return { images: null, hasImage: false };
      }
    } catch (error) {
      console.error(`Failed to load image for ${path}:`, error);
      // Return failure result to prevent infinite retry loops
      return { images: null, hasImage: false };
    }
  })();

  inFlightImages.set(cacheKey, loadPromise);

  try {
    const result = await loadPromise;
    // Assign to caller's cache
    if (result.images !== null) {
      imageCache[path] = result.images;
    }
    hasImageCache[path] = result.hasImage;
  } finally {
    inFlightImages.delete(cacheKey);
  }
}

/**
 * Loads images for multiple entries in parallel
 *
 * @param entries - Array of entries with path, file, and imagePropertyValues
 * @param fallbackToEmbeds - Whether to extract embedded images if no property images
 * @param app - Obsidian app instance
 * @param imageCache - Cache object to store loaded images
 * @param hasImageCache - Cache object to track image availability
 * @param embedOptions - Options for embed extraction (YouTube, cardlink)
 */
export async function loadImagesForEntries(
  entries: Array<{
    path: string;
    file: TFile;
    imagePropertyValues: unknown[];
  }>,
  fallbackToEmbeds: "always" | "if-empty" | "never",
  app: App,
  imageCache: Record<string, string | string[]>,
  hasImageCache: Record<string, boolean>,
  embedOptions?: {
    includeYoutube?: boolean;
    includeCardLink?: boolean;
  },
): Promise<void> {
  await Promise.all(
    entries.map(async (entry) => {
      await loadImageForEntry(
        entry.path,
        entry.file,
        app,
        entry.imagePropertyValues,
        fallbackToEmbeds,
        imageCache,
        hasImageCache,
        embedOptions,
      );
    }),
  );
}

/**
 * Loads text preview for an entry
 * Handles text preview property, fallback to content, and caching
 *
 * @param path - File path for the entry
 * @param file - TFile object
 * @param app - Obsidian app instance
 * @param textPreviewData - Text preview property value
 * @param fallbackToContent - Whether to fall back to file content if no text preview
 * @param omitFirstLine - When to omit first line from preview
 * @param textPreviewCache - Cache object to store loaded text previews
 * @param fileName - Optional file name for title comparison (Datacore only)
 * @param titleString - Optional title string for first line comparison (Datacore only)
 */
export async function loadTextPreviewForEntry(
  path: string,
  file: TFile,
  app: App,
  textPreviewData: unknown,
  fallbackToContent: boolean,
  omitFirstLine: "always" | "ifMatchesTitle" | "never",
  textPreviewCache: Record<string, string>,
  fileName?: string,
  titleString?: string,
): Promise<void> {
  // Skip if already in caller's cache (uses path, not composite key, because each
  // caller passes their own cache objects - this prevents re-loading within a batch)
  if (path in textPreviewCache) {
    return;
  }

  // If another view is loading this path with same settings, await its result
  // Composite key includes all parameters that affect output:
  // - fallbackToContent: determines whether file content is used as fallback
  // - omitFirstLine: affects whether first line is stripped from preview
  // - hasPreview: whether textPreviewData is provided (affects output source)
  // - fileName/titleString: included when omitFirstLine="ifMatchesTitle" (affects first-line comparison)
  const hasPreview =
    textPreviewData != null &&
    (typeof textPreviewData === "string" ||
      typeof textPreviewData === "number") &&
    String(textPreviewData).trim().length > 0
      ? "1"
      : "0";
  const titleKey =
    omitFirstLine === "ifMatchesTitle"
      ? `|${fileName ?? ""}|${titleString ?? ""}`
      : "";
  const cacheKey = `${path}|${fallbackToContent}|${omitFirstLine}|${hasPreview}${titleKey}`;
  const existing = inFlightTextPreviews.get(cacheKey);
  if (existing) {
    textPreviewCache[path] = await existing;
    return;
  }

  // Create and store the loading promise
  const loadPromise = (async (): Promise<string> => {
    try {
      if (file.extension === "md") {
        return await loadFilePreview(
          file,
          app,
          textPreviewData,
          {
            fallbackToContent,
            omitFirstLine,
          },
          fileName,
          titleString,
        );
      } else {
        return "";
      }
    } catch (error) {
      console.error(`Failed to load text preview for ${path}:`, error);
      return "";
    }
  })();

  inFlightTextPreviews.set(cacheKey, loadPromise);

  try {
    textPreviewCache[path] = await loadPromise;
  } finally {
    inFlightTextPreviews.delete(cacheKey);
  }
}

/**
 * Loads text previews for multiple entries in parallel
 *
 * @param entries - Array of entries with path, file, and textPreviewData
 * @param fallbackToContent - Whether to fall back to file content if no text preview
 * @param omitFirstLine - When to omit first line from preview
 * @param app - Obsidian app instance
 * @param textPreviewCache - Cache object to store loaded text previews
 */
export async function loadTextPreviewsForEntries(
  entries: TextPreviewEntry[],
  fallbackToContent: boolean,
  omitFirstLine: "always" | "ifMatchesTitle" | "never",
  app: App,
  textPreviewCache: Record<string, string>,
): Promise<void> {
  await Promise.all(
    entries.map(async (entry) => {
      await loadTextPreviewForEntry(
        entry.path,
        entry.file,
        app,
        entry.textPreviewData,
        fallbackToContent,
        omitFirstLine,
        textPreviewCache,
        entry.fileName,
        entry.titleString,
      );
    }),
  );
}
