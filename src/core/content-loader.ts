import type { App, TFile } from 'obsidian';
import { VALID_IMAGE_EXTENSIONS } from '../constants';
import { processImagePaths, resolveInternalImagePaths } from './image';
import { extractImageEmbeds } from './image-extraction';
import { loadNotePreview } from './text-preview';
import { MAX_MULTI_IMAGES } from './constants';

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

// Module-level result caches survive view instance destruction, so
// back/forward navigation serves content from memory instead of disk.
const cachedTextPreviews = new Map<string, string>();
const cachedImageResults = new Map<string, ImageLoadResult>();

/**
 * Clear in-flight tracking and module caches (call on plugin unload)
 */
export function clearInFlightLoads(): void {
  inFlightTextPreviews.clear();
  inFlightImages.clear();
  cachedTextPreviews.clear();
  cachedImageResults.clear();
}

/**
 * Invalidate module-level caches for a specific file path.
 * Call when a vault file is modified to ensure stale content isn't served.
 */
export function invalidateContentCacheForPath(path: string): void {
  if (cachedTextPreviews.size === 0 && cachedImageResults.size === 0) return;
  const prefix = `${path}|`;
  for (const key of cachedTextPreviews.keys()) {
    if (key.startsWith(prefix)) cachedTextPreviews.delete(key);
  }
  for (const key of cachedImageResults.keys()) {
    if (key.startsWith(prefix)) cachedImageResults.delete(key);
  }
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
 * @param showFileImages - When images found in the file itself (self-image, in-note embeds) may be used
 * @param imageCache - Cache object to store loaded images
 * @param hasImageCache - Cache object to track image availability
 * @param embedOptions - Options for embed extraction (YouTube, cardlink)
 */
export async function loadImageForEntry(
  path: string,
  file: TFile,
  app: App,
  imagePropertyValues: unknown[],
  showFileImages: 'always' | 'if-unavailable' | 'never',
  imageCache: Record<string, string | string[]>,
  hasImageCache: Record<string, boolean>,
  embedOptions?: {
    includeYoutube?: boolean;
    includeCardLink?: boolean;
    youtubeTargetWidth?: number;
  }
): Promise<void> {
  // Skip if already in caller's cache (uses path, not composite key, because each
  // caller passes their own cache objects - this prevents re-loading within a batch)
  if (path in hasImageCache) {
    return;
  }

  // Image files use themselves as card image when no property images exist
  // (gated on showFileImages — "never" suppresses self-image as embed fallback;
  // getResourcePath is synchronous so in-flight dedup is unnecessary)
  if (
    showFileImages !== 'never' &&
    imagePropertyValues.length === 0 &&
    VALID_IMAGE_EXTENSIONS.includes(file.extension?.toLowerCase() ?? '')
  ) {
    imageCache[path] = app.vault.getResourcePath(file);
    hasImageCache[path] = true;
    return;
  }

  // If another view is loading this path with same settings, await its result
  // Composite key includes all parameters that affect output:
  // - imagePropertyValues: the property images themselves are the primary
  //   output, so a view that points at a different image property — or none —
  //   must not read back the previous view's result. This cache outlives any
  //   single render, so without it, clearing imageProperty leaves the old
  //   images on screen until the app restarts.
  // - showFileImages: determines whether embeds are extracted
  // - embedOptions: determines which embed types (YouTube, CardLink) are included
  // - youtubeTargetWidth: selects the YouTube rung, so it changes the resolved
  //   URL — without it two views at different card sizes share one wrong result
  const embedKey = embedOptions
    ? `${embedOptions.includeYoutube ?? false}|${embedOptions.includeCardLink ?? false}|${embedOptions.youtubeTargetWidth ?? 'max'}`
    : 'false|false|max';
  // NUL separates the values: it cannot occur in a frontmatter string, so no
  // two distinct value lists can collapse onto one key the way they would
  // with a space separator.
  const propertyKey = imagePropertyValues.map((v) => String(v)).join('\x00');
  const cacheKey = `${path}|${propertyKey}|${showFileImages}|${embedKey}`;
  const existing = inFlightImages.get(cacheKey);
  if (existing) {
    const result = await existing;
    if (result.images !== null) {
      imageCache[path] = result.images;
    }
    hasImageCache[path] = result.hasImage;
    return;
  }

  const cached = cachedImageResults.get(cacheKey);
  if (cached) {
    if (cached.images !== null) {
      imageCache[path] = cached.images;
    }
    hasImageCache[path] = cached.hasImage;
    return;
  }

  // Create and store the loading promise - returns result so all callers can assign to their caches
  const loadPromise = (async (): Promise<ImageLoadResult> => {
    try {
      // Filter to only valid string paths before processing
      const validPaths = imagePropertyValues.filter(
        (v): v is string => typeof v === 'string' && v.length > 0
      );

      // Process image paths using shared utility (sync - no validation needed)
      const { internalPaths, externalUrls } = processImagePaths(validPaths);

      // Convert internal paths to resource URLs using shared utility
      // External URLs are used directly (browser handles load/error at render time)
      let validImages: string[] = [
        ...resolveInternalImagePaths(internalPaths, path, app),
        ...externalUrls,
      ];

      // Handle embed images based on showFileImages mode
      if (showFileImages === 'always') {
        // Pull from properties first, then append in-note embeds
        // Skip parsing if property already has max images
        if (validImages.length < MAX_MULTI_IMAGES) {
          const embedImages = await extractImageEmbeds(file, app, embedOptions);
          validImages = [...validImages, ...embedImages];
        }
      } else if (showFileImages === 'if-unavailable') {
        // Only use embeds if no valid property images
        if (validImages.length === 0) {
          validImages = await extractImageEmbeds(file, app, embedOptions);
        }
      } else if (showFileImages === 'never') {
        // Only use property images, never use embeds
        // No action needed - validImages already contains only property images
      }

      if (validImages.length > 0) {
        // Limit images to slideshow max to avoid loading excess images
        const limitedImages = validImages.slice(0, MAX_MULTI_IMAGES);
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
    if (result.images !== null) {
      imageCache[path] = result.images;
    }
    hasImageCache[path] = result.hasImage;
    cachedImageResults.set(cacheKey, result);
  } finally {
    inFlightImages.delete(cacheKey);
  }
}

/**
 * Loads images for multiple entries in parallel
 *
 * @param entries - Array of entries with path, file, and imagePropertyValues
 * @param showFileImages - When images found in the file itself (self-image, in-note embeds) may be used
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
  showFileImages: 'always' | 'if-unavailable' | 'never',
  app: App,
  imageCache: Record<string, string | string[]>,
  hasImageCache: Record<string, boolean>,
  embedOptions?: {
    includeYoutube?: boolean;
    includeCardLink?: boolean;
    youtubeTargetWidth?: number;
  }
): Promise<void> {
  await Promise.all(
    entries.map(async (entry) => {
      await loadImageForEntry(
        entry.path,
        entry.file,
        app,
        entry.imagePropertyValues,
        showFileImages,
        imageCache,
        hasImageCache,
        embedOptions
      );
    })
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
 * @param omitFirstLine - When to omit first line from text preview
 * @param textPreviewCache - Cache object to store loaded text previews
 * @param fileName - Optional file name for title comparison
 * @param titleString - Optional title string for first line comparison
 */
export async function loadTextPreviewForEntry(
  path: string,
  file: TFile,
  app: App,
  textPreviewData: unknown,
  fallbackToContent: boolean,
  omitFirstLine: 'always' | 'ifMatchesTitle' | 'never',
  textPreviewCache: Record<string, string>,
  fileName?: string,
  titleString?: string,
  preserveHeadings?: boolean,
  preserveNewlines?: boolean
): Promise<void> {
  // Skip if already in caller's cache (uses path, not composite key, because each
  // caller passes their own cache objects - this prevents re-loading within a batch)
  if (path in textPreviewCache) {
    return;
  }

  // If another view is loading this path with same settings, await its result
  // Composite key includes all parameters that affect output:
  // - fallbackToContent: determines whether file content is used as fallback
  // - omitFirstLine: affects whether first line is stripped from text preview
  // - hasTextPreview: whether textPreviewData is provided (affects output source)
  // - fileName/titleString: included when omitFirstLine="ifMatchesTitle" (affects first-line comparison)
  // - preserveHeadings/preserveNewlines: affect how text is stripped/normalized
  const hasTextPreview =
    textPreviewData != null &&
    (typeof textPreviewData === 'string' ||
      typeof textPreviewData === 'number') &&
    String(textPreviewData).trim().length > 0
      ? '1'
      : '0';
  const titleKey =
    omitFirstLine === 'ifMatchesTitle'
      ? `|${fileName ?? ''}|${titleString ?? ''}`
      : '';
  const cacheKey = `${path}|${fallbackToContent}|${omitFirstLine}|${hasTextPreview}${titleKey}|${preserveHeadings ?? false}|${preserveNewlines ?? false}`;
  const existing = inFlightTextPreviews.get(cacheKey);
  if (existing) {
    textPreviewCache[path] = await existing;
    return;
  }

  const cachedResult = cachedTextPreviews.get(cacheKey);
  if (cachedResult !== undefined) {
    textPreviewCache[path] = cachedResult;
    return;
  }

  // Create and store the loading promise
  const loadPromise = (async (): Promise<string> => {
    try {
      if (file.extension === 'md') {
        return await loadNotePreview(
          file,
          app,
          textPreviewData,
          {
            fallbackToContent,
            omitFirstLine,
            preserveHeadings,
            preserveNewlines,
          },
          fileName,
          titleString
        );
      } else {
        return '';
      }
    } catch (error) {
      console.error(`Failed to load text preview for ${path}:`, error);
      return '';
    }
  })();

  inFlightTextPreviews.set(cacheKey, loadPromise);

  try {
    const result = await loadPromise;
    textPreviewCache[path] = result;
    cachedTextPreviews.set(cacheKey, result);
  } finally {
    inFlightTextPreviews.delete(cacheKey);
  }
}

/**
 * Loads text previews for multiple entries in parallel
 *
 * @param entries - Array of entries with path, file, and textPreviewData
 * @param fallbackToContent - Whether to fall back to file content if no text preview
 * @param omitFirstLine - When to omit first line from text preview
 * @param app - Obsidian app instance
 * @param textPreviewCache - Cache object to store loaded text previews
 */
export async function loadTextPreviewsForEntries(
  entries: TextPreviewEntry[],
  fallbackToContent: boolean,
  omitFirstLine: 'always' | 'ifMatchesTitle' | 'never',
  app: App,
  textPreviewCache: Record<string, string>,
  preserveHeadings?: boolean,
  preserveNewlines?: boolean
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
        preserveHeadings,
        preserveNewlines
      );
    })
  );
}
