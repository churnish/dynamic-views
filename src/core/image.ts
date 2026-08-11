import { App } from 'obsidian';
import { VALID_IMAGE_EXTENSIONS } from '../constants';
import { getYouTubeVideoId } from './youtube-preview';

/**
 * Check if a URL is an external HTTP/HTTPS URL
 * @param url - The URL to check
 * @returns true if URL starts with http:// or https://
 */
export function isExternalUrl(url: string): boolean {
  return (
    /^https?:\/\//i.test(url) &&
    // Android Capacitor serves local files via http://localhost/_capacitor_file_/
    !url.includes('/_capacitor_file_/')
  );
}

/**
 * Extract vault-relative file path from an Obsidian resource URL.
 * Handles both modern `app://random-id/path` and legacy `app://local/path` formats.
 * @returns Decoded vault path, or null for non-app:// URLs
 */
export function getVaultPathFromResourceUrl(src: string): string | null {
  try {
    const url = new URL(src);
    if (url.protocol !== 'app:') return null;
    // pathname: /<id>/<vault-path> — skip empty first segment and vault id
    const firstSlash = url.pathname.indexOf('/', 1);
    if (firstSlash === -1) return null;
    return decodeURIComponent(url.pathname.slice(firstSlash + 1));
  } catch {
    return null;
  }
}

/**
 * Extract the display name for an image, matching Obsidian's native lightbox titlebar:
 * the basename of the URL's decoded path. Works for both `app://` and external URLs.
 * @returns File name, or empty string for data URIs and unparseable input
 */
export function getImageDisplayName(src: string): string {
  if (src.startsWith('data:')) return '';
  try {
    const path = decodeURIComponent(new URL(src).pathname);
    return path.slice(path.lastIndexOf('/') + 1);
  } catch {
    return '';
  }
}

// Generate regex from VALID_IMAGE_EXTENSIONS to ensure they stay in sync
// Combines jpeg/jpg as jpe?g for efficiency (order-independent)
const IMAGE_EXTENSION_REGEX = new RegExp(
  `\\.(${VALID_IMAGE_EXTENSIONS.filter((e) => e !== 'jpeg' && e !== 'jpg')
    .concat(['jpe?g'])
    .join('|')})$`,
  'i'
);

/**
 * Check if a path has a valid image file extension
 * @param path - The file path or URL to check
 * @returns true if path ends with a valid image extension
 */
function hasValidImageExtension(path: string): boolean {
  return IMAGE_EXTENSION_REGEX.test(path);
}

/**
 * Wikilink body: the target in group 1, then an optional caption or fragment.
 *
 * A single `]` stays in the target so bracketed names like `Image[1355x762].png`
 * survive — Obsidian's own parser resolves those — while `]]` still closes the
 * link. Shared so the path form and the embed form cannot drift apart.
 */
export const WIKILINK_TARGET = String.raw`((?:[^\]|#]|](?!]))+)(?:[|#](?:[^\]]|](?!]))*)?`;

/**
 * Strip wikilink syntax from image path
 * Handles: [[path]], ![[path]], [[path|caption]], [[path#heading]], [[path#^block]]
 * @param path - Path that may contain wikilink syntax
 * @returns Clean path without wikilink markers, fragments, or captions; empty string if null/undefined
 */
export function stripWikilinkSyntax(path: string | null | undefined): string {
  if (!path) return '';
  // Trim before matching - wikilinks may have surrounding whitespace
  const trimmed = path.trim();
  // Capture path before any | (caption) or # (fragment/heading/block)
  const wikilinkMatch = trimmed.match(
    new RegExp(String.raw`^!?\[\[${WIKILINK_TARGET}]]$`)
  );
  return wikilinkMatch ? wikilinkMatch[1].trim() : trimmed;
}

/**
 * Process and validate image paths from property values
 * Handles wikilink stripping, URL validation, and path separation
 * @param imagePaths - Raw image paths from properties (may contain wikilinks)
 * @returns Object with validated internal paths and external URLs
 */
export function processImagePaths(imagePaths: string[]): {
  internalPaths: string[];
  externalUrls: string[];
} {
  const internalPaths: string[] = [];
  const externalUrls: string[] = [];

  for (const imgPath of imagePaths) {
    // Strip wikilink syntax
    const cleanPath = stripWikilinkSyntax(imgPath);

    // Skip empty or whitespace-only paths
    if (cleanPath.trim().length === 0) continue;

    if (isExternalUrl(cleanPath)) {
      // Skip YouTube video URLs (not images) - thumbnails extracted from embeds only
      if (getYouTubeVideoId(cleanPath)) {
        continue;
      }
      // External URL - pass through without validation
      // Browser handles load/error at render time for faster initial display
      externalUrls.push(cleanPath);
    } else {
      // Internal path - validate extension upfront for explicit paths
      // Extension-less wikilinks like ![[photo]] handled at resolution time
      if (hasValidImageExtension(cleanPath)) {
        internalPaths.push(cleanPath);
      }
    }
  }

  return { internalPaths, externalUrls };
}

/**
 * Convert internal image paths to resource URLs
 * @param internalPaths - Array of internal file paths
 * @param sourcePath - Path of the source file (for link resolution)
 * @param app - Obsidian App instance
 * @returns Array of resource URLs
 */
export function resolveInternalImagePaths(
  internalPaths: string[],
  sourcePath: string,
  app: App
): string[] {
  const resourcePaths: string[] = [];

  for (const propPath of internalPaths) {
    const imageFile = app.metadataCache.getFirstLinkpathDest(
      propPath,
      sourcePath
    );
    if (imageFile && VALID_IMAGE_EXTENSIONS.includes(imageFile.extension)) {
      const resourcePath = app.vault.getResourcePath(imageFile);
      resourcePaths.push(resourcePath);
    }
  }

  return resourcePaths;
}
