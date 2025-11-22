import type { App, TFile } from 'obsidian';
import { processImagePaths, resolveInternalImagePaths, extractEmbedImages } from '../utils/image';
import { loadFilePreview } from '../utils/preview';

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
    fallbackToEmbeds: 'always' | 'if-empty' | 'never',
    imageCache: Record<string, string | string[]>,
    hasImageCache: Record<string, boolean>
): Promise<void> {
    // Skip if already in cache
    if (path in imageCache) {
        return;
    }

    try {
        // Process and validate image paths using shared utility
        const { internalPaths, externalUrls } = await processImagePaths(imagePropertyValues as string[]);

        // Convert internal paths to resource URLs using shared utility
        let validImages: string[] = [
            ...resolveInternalImagePaths(internalPaths, path, app),
            ...externalUrls  // External URLs already validated by processImagePaths
        ];

        // Handle embed images based on fallbackToEmbeds mode
        if (fallbackToEmbeds === 'always') {
            // Pull from properties first, then append in-note embeds
            const embedImages = await extractEmbedImages(file, app);
            validImages = [...validImages, ...embedImages];
        } else if (fallbackToEmbeds === 'if-empty') {
            // Only use embeds if property missing/empty
            if (validImages.length === 0) {
                validImages = await extractEmbedImages(file, app);
            }
        } else if (fallbackToEmbeds === 'never') {
            // Only use property images, never use embeds
            // No action needed - validImages already contains only property images
        }

        if (validImages.length > 0) {
            // Store as array if multiple, string if single
            imageCache[path] = validImages.length > 1 ? validImages : validImages[0];
            hasImageCache[path] = true;
        }
    } catch (error) {
        console.error(`Failed to load image for ${path}:`, error);
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
    fallbackToEmbeds: 'always' | 'if-empty' | 'never',
    app: App,
    imageCache: Record<string, string | string[]>,
    hasImageCache: Record<string, boolean>
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
                hasImageCache
            );
        })
    );
}

/**
 * Loads text snippet/preview for an entry
 * Handles property description, fallback to content, and caching
 *
 * @param path - File path for the entry
 * @param file - TFile object
 * @param app - Obsidian app instance
 * @param descriptionData - Description property value
 * @param fallbackToContent - Whether to fall back to file content if no description
 * @param omitFirstLine - Whether to omit first line from preview
 * @param snippetCache - Cache object to store loaded snippets
 * @param fileName - Optional file name for title comparison (Datacore only)
 * @param titleString - Optional title string for first line comparison (Datacore only)
 */
export async function loadSnippetForEntry(
    path: string,
    file: TFile,
    app: App,
    descriptionData: unknown,
    fallbackToContent: boolean,
    omitFirstLine: boolean,
    snippetCache: Record<string, string>,
    fileName?: string,
    titleString?: string
): Promise<void> {
    // Skip if already in cache
    if (path in snippetCache) {
        return;
    }

    try {
        if (file.extension === 'md') {
            // Use shared utility for preview loading
            snippetCache[path] = await loadFilePreview(
                file,
                app,
                descriptionData,
                {
                    fallbackToContent,
                    omitFirstLine
                },
                fileName,
                titleString
            );
        } else {
            snippetCache[path] = '';
        }
    } catch (error) {
        console.error(`Failed to load snippet for ${path}:`, error);
        snippetCache[path] = '';
    }
}

/**
 * Loads snippets for multiple entries in parallel
 *
 * @param entries - Array of entries with path, file, and descriptionData
 * @param fallbackToContent - Whether to fall back to file content if no description
 * @param omitFirstLine - Whether to omit first line from preview
 * @param app - Obsidian app instance
 * @param snippetCache - Cache object to store loaded snippets
 */
export async function loadSnippetsForEntries(
    entries: Array<{
        path: string;
        file: TFile;
        descriptionData: unknown;
        fileName?: string;
        titleString?: string;
    }>,
    fallbackToContent: boolean,
    omitFirstLine: boolean,
    app: App,
    snippetCache: Record<string, string>
): Promise<void> {
    await Promise.all(
        entries.map(async (entry) => {
            await loadSnippetForEntry(
                entry.path,
                entry.file,
                app,
                entry.descriptionData,
                fallbackToContent,
                omitFirstLine,
                snippetCache,
                entry.fileName,
                entry.titleString
            );
        })
    );
}
