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
