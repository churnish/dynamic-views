/**
 * File format utilities
 * Shared between card-renderer.tsx (Datacore) and shared-renderer.ts (Bases)
 */

import { VALID_IMAGE_EXTENSIONS } from "./image";

// Cached hidden formats (set once per session)
let cachedHiddenFormats: Set<string> | null = null;

/**
 * Extract lowercase extension from path
 * Returns null for empty/invalid extensions (e.g., ".", "file.")
 */
function extractExtension(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext && ext !== "" ? ext : null;
}

/**
 * Get hidden file formats from Style Settings CSS variable
 * Cached for performance - changes require reload
 */
export function getHiddenFormats(): Set<string> {
  if (cachedHiddenFormats) return cachedHiddenFormats;

  const rawValue = getComputedStyle(document.body)
    .getPropertyValue("--dynamic-views-hidden-file-extensions")
    .trim();

  // Explicitly cleared (literal "" or '') = show all
  if (rawValue === '""' || rawValue === "''") {
    cachedHiddenFormats = new Set();
  } else {
    const value = rawValue.replace(/['"]/g, "");
    cachedHiddenFormats = value
      ? new Set(value.split(",").map((e) => e.trim().toLowerCase()))
      : new Set(["md"]); // Default when not set
  }

  return cachedHiddenFormats;
}

/**
 * Get file format info for display
 * @param path - File path
 * @param forceShow - Bypass hidden formats check (for file.fullname)
 */
export function getFileExtInfo(
  path: string,
  forceShow = false,
): { ext: string } | null {
  const ext = extractExtension(path);
  if (!ext) return null;
  if (!forceShow && getHiddenFormats().has(ext)) return null;
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
  const ext = extractExtension(path);
  if (!ext) return title;
  if (!forceStrip && ext === "md") return title;

  const extWithDot = `.${ext}`;
  if (title.toLowerCase().endsWith(extWithDot)) {
    return title.slice(0, -extWithDot.length);
  }
  return title;
}

/**
 * Get Lucide icon name for file format
 * Returns null if format is hidden or no extension
 */
export function getFileTypeIcon(path: string): string | null {
  const ext = extractExtension(path);
  if (!ext) return null;
  if (getHiddenFormats().has(ext)) return null;

  if (ext === "canvas") return "layout-dashboard";
  if (ext === "base") return "layout-list";
  if (ext === "pdf") return "file-text";
  if (VALID_IMAGE_EXTENSIONS.includes(ext)) return "image";
  return "file";
}
