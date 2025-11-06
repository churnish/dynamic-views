import { App, TFile } from 'obsidian';

/**
 * Check if a URL is an external HTTP/HTTPS URL
 * @param url - The URL to check
 * @returns true if URL starts with http:// or https://
 */
export function isExternalUrl(url: string): boolean {
    return /^https?:\/\//i.test(url);
}

/**
 * Check if a path has a valid image file extension
 * @param path - The file path or URL to check
 * @returns true if path ends with a valid image extension
 */
export function hasValidImageExtension(path: string): boolean {
    return /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(path);
}

/**
 * Validate if a URL points to a valid, loadable image
 * Uses the browser's Image object to verify the URL can be loaded
 * @param url - The image URL to validate
 * @returns Promise that resolves to true if image loads successfully
 */
export function validateImageUrl(url: string): Promise<boolean> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        // Set a reasonable timeout to avoid hanging on slow/dead URLs
        setTimeout(() => resolve(false), 5000);
        img.src = url;
    });
}

/**
 * Load image for a file from property or embeds
 * @param app - Obsidian App instance
 * @param filePath - Path of the file to load image for
 * @param imagePropertyValue - Value from image property (if any)
 * @param cacheSize - Thumbnail cache size setting
 * @param fallbackToEmbeds - Whether to fall back to in-note images when property has no value
 * @param imagePropertyName - The image property name (empty string means no property configured)
 * @returns Promise resolving to image URL(s) or null
 */
export async function loadImageForFile(
    app: App,
    filePath: string,
    imagePropertyValue: string,
    cacheSize: 'small' | 'balanced' | 'large',
    fallbackToEmbeds: boolean = true,
    imagePropertyName: string = ''
): Promise<string | string[] | null> {
    const validImageExtensions = ['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp'];

    const propertyImagePaths: string[] = [];
    const propertyExternalUrls: string[] = [];

    // Parse image property value (could be single path or array)
    if (imagePropertyValue) {
        const paths = Array.isArray(imagePropertyValue) ? imagePropertyValue : [imagePropertyValue];

        for (const path of paths) {
            if (typeof path === 'string') {
                if (isExternalUrl(path)) {
                    propertyExternalUrls.push(path);
                } else {
                    propertyImagePaths.push(path);
                }
            }
        }
    }

    // Phase A: Convert property image paths to resource paths
    const propertyResourcePaths: string[] = [];

    // Process internal paths
    for (const propPath of propertyImagePaths) {
        const imageFile = app.metadataCache.getFirstLinkpathDest(propPath, filePath);
        if (imageFile && validImageExtensions.includes(imageFile.extension)) {
            const resourcePath = app.vault.getResourcePath(imageFile);
            propertyResourcePaths.push(resourcePath);
        }
    }

    // Process external URLs with async validation
    for (const externalUrl of propertyExternalUrls) {
        const isValid = await validateImageUrl(externalUrl);
        if (isValid) {
            propertyResourcePaths.push(externalUrl);
        }
    }

    // Phase B: Extract body embed resource paths (fallback if no property images)
    const file = app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) return null;

    const metadata = app.metadataCache.getFileCache(file);
    if (!metadata) return null;

    const bodyResourcePaths: string[] = [];
    const bodyExternalUrls: string[] = [];

    // Process embeds - separate external URLs from internal paths
    if (metadata.embeds) {
        for (const embed of metadata.embeds) {
            const embedLink = embed.link;
            if (isExternalUrl(embedLink)) {
                // External URL embed
                if (hasValidImageExtension(embedLink) || !embedLink.includes('.')) {
                    bodyExternalUrls.push(embedLink);
                }
            } else {
                // Internal path embed
                const targetFile = app.metadataCache.getFirstLinkpathDest(embedLink, filePath);
                if (targetFile && validImageExtensions.includes(targetFile.extension)) {
                    const resourcePath = app.vault.getResourcePath(targetFile);
                    bodyResourcePaths.push(resourcePath);
                }
            }
        }
    }

    // Validate external URLs from body
    for (const externalUrl of bodyExternalUrls) {
        const isValid = await validateImageUrl(externalUrl);
        if (isValid) {
            bodyResourcePaths.push(externalUrl);
        }
    }

    // Phase C: Determine which images to use based on settings
    let allResourcePaths: string[] = [];

    // If no image property is configured, always use in-note images
    if (!imagePropertyName || imagePropertyName.trim() === '') {
        allResourcePaths = bodyResourcePaths;
    }
    // If image property is configured
    else {
        // If property has values, use them (no fallback)
        if (propertyResourcePaths.length > 0) {
            allResourcePaths = propertyResourcePaths;
        }
        // If property has no values and fallback is enabled, use body embeds
        else if (fallbackToEmbeds) {
            allResourcePaths = bodyResourcePaths;
        }
        // Otherwise, no images
        else {
            allResourcePaths = [];
        }
    }

    // Return result
    if (allResourcePaths.length === 0) return null;
    return allResourcePaths.length > 1 ? allResourcePaths : allResourcePaths[0];
}
