import type { App, TFile } from "obsidian";
import {
  processImagePaths,
  resolveInternalImagePaths,
  extractEmbedImages,
} from "../utils/image";
import { loadFilePreview } from "../utils/text-preview";
import { getSlideshowMaxImages } from "../utils/style-settings";

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
 */
export async function loadImageForEntry(
  path: string,
  file: TFile,
  app: App,
  imagePropertyValues: unknown[],
  fallbackToEmbeds: "always" | "if-empty" | "never",
  imageCache: Record<string, string | string[]>,
  hasImageCache: Record<string, boolean>,
): Promise<void> {
  // Skip if already checked (hasImageCache tracks both success and failure)
  if (path in hasImageCache) {
    return;
  }

  try {
    // Filter to only valid string paths before processing
    const validPaths = imagePropertyValues.filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    );

    // Process and validate image paths using shared utility
    const { internalPaths, externalUrls } = await processImagePaths(validPaths);

    // Convert internal paths to resource URLs using shared utility
    let validImages: string[] = [
      ...resolveInternalImagePaths(internalPaths, path, app),
      ...externalUrls, // External URLs already validated by processImagePaths
    ];

    // Handle embed images based on fallbackToEmbeds mode
    if (fallbackToEmbeds === "always") {
      // Pull from properties first, then append in-note embeds
      const embedImages = await extractEmbedImages(file, app);
      validImages = [...validImages, ...embedImages];
    } else if (fallbackToEmbeds === "if-empty") {
      // Only use embeds if property missing/empty
      if (validImages.length === 0) {
        validImages = await extractEmbedImages(file, app);
      }
    } else if (fallbackToEmbeds === "never") {
      // Only use property images, never use embeds
      // No action needed - validImages already contains only property images
    }

    if (validImages.length > 0) {
      // Limit images to slideshow max to avoid loading excess images
      const maxImages = getSlideshowMaxImages();
      const limitedImages = validImages.slice(0, maxImages);
      // Store as array if multiple, string if single
      imageCache[path] =
        limitedImages.length > 1 ? limitedImages : limitedImages[0];
      hasImageCache[path] = true;
    } else {
      // Mark as checked but no images available
      hasImageCache[path] = false;
    }
  } catch (error) {
    console.error(`Failed to load image for ${path}:`, error);
    // Mark as checked to prevent infinite retry loops
    hasImageCache[path] = false;
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
 * @param omitFirstLine - Whether to omit first line from preview
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
  omitFirstLine: boolean,
  textPreviewCache: Record<string, string>,
  fileName?: string,
  titleString?: string,
): Promise<void> {
  // Skip if already in cache
  if (path in textPreviewCache) {
    return;
  }

  try {
    if (file.extension === "md") {
      // Use shared utility for preview loading
      textPreviewCache[path] = await loadFilePreview(
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
      textPreviewCache[path] = "";
    }
  } catch (error) {
    console.error(`Failed to load text preview for ${path}:`, error);
    textPreviewCache[path] = "";
  }
}

/**
 * Loads text previews for multiple entries in parallel
 *
 * @param entries - Array of entries with path, file, and textPreviewData
 * @param fallbackToContent - Whether to fall back to file content if no text preview
 * @param omitFirstLine - Whether to omit first line from preview
 * @param app - Obsidian app instance
 * @param textPreviewCache - Cache object to store loaded text previews
 */
export async function loadTextPreviewsForEntries(
  entries: TextPreviewEntry[],
  fallbackToContent: boolean,
  omitFirstLine: boolean,
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
