/**
 * File extension utilities
 * Shared between card-renderer.tsx (Datacore) and shared-renderer.ts (Bases)
 */

import { VALID_IMAGE_EXTENSIONS } from "./image";

// Cache for hidden extensions (invalidated on style change)
let cachedHiddenExtensions: Set<string> | null = null;

/**
 * Invalidate the hidden extensions cache
 * Call when --dynamic-views-hidden-file-extensions CSS variable changes
 */
export function invalidateHiddenExtensionsCache(): void {
  cachedHiddenExtensions = null;
}

/**
 * Get hidden file extensions from Style Settings CSS variable
 * Results are cached until invalidateHiddenExtensionsCache() is called
 */
export function getHiddenExtensions(): Set<string> {
  if (cachedHiddenExtensions) return cachedHiddenExtensions;

  const value = getComputedStyle(document.body)
    .getPropertyValue("--dynamic-views-hidden-file-extensions")
    .trim()
    .replace(/['"]/g, "");

  cachedHiddenExtensions = value
    ? new Set(value.split(",").map((e) => e.trim().toLowerCase()))
    : new Set(["md"]);

  return cachedHiddenExtensions;
}

/**
 * Get file extension info for display
 * @param path - File path
 * @param forceShow - Bypass hidden extensions check (for file.fullname)
 */
export function getFileExtInfo(
  path: string,
  forceShow = false,
): { ext: string } | null {
  const ext = path.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  if (!forceShow && getHiddenExtensions().has(ext)) return null;
  return { ext: `.${ext}` };
}

/**
 * Strip file extension from title if present
 * @param title - Title text
 * @param path - File path (used to determine extension)
 * @param forceStrip - Strip even .md extension (for file.fullname)
 */
export function stripExtFromTitle(
  title: string,
  path: string,
  forceStrip = false,
): string {
  const ext = path.split(".").pop()?.toLowerCase();
  if (!ext) return title;
  if (!forceStrip && ext === "md") return title;

  const extWithDot = `.${ext}`;
  if (title.toLowerCase().endsWith(extWithDot)) {
    return title.slice(0, -extWithDot.length);
  }
  return title;
}

/**
 * Get Lucide icon name for file type (non-markdown files only)
 */
export function getFileTypeIcon(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase();
  if (!ext || ext === "md") return null;

  if (ext === "canvas") return "layout-dashboard";
  if (ext === "base") return "layout-list";
  if (ext === "pdf") return "file-text";
  if (VALID_IMAGE_EXTENSIONS.includes(ext)) return "image";
  return "file";
}
