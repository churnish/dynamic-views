/**
 * File format utilities
 * Shared between card-renderer.tsx (Datacore) and shared-renderer.ts (Bases)
 */

import { VALID_IMAGE_EXTENSIONS } from './image';

/**
 * Extract lowercase extension from path
 * Returns null for extensionless files or empty extensions
 */
function extractExtension(path: string): string | null {
  const fileName = path.split('/').pop() || '';
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0) return null;
  const ext = fileName.slice(dotIndex + 1).toLowerCase();
  return ext || null;
}

/**
 * Get file format info for display.
 * Excludes .md by default — Obsidian's file.name already strips it,
 * so the suffix would add information not present in the title.
 * @param forceShow - Show all extensions including .md (for file.fullname)
 */
export function getFileExtInfo(
  path: string,
  forceShow = false
): { ext: string } | null {
  const ext = extractExtension(path);
  if (!ext) return null;
  if (!forceShow && ext === 'md') return null;
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
  forceStrip = false
): string {
  const ext = extractExtension(path);
  if (!ext) return title;
  if (!forceStrip && ext === 'md') return title;

  const extWithDot = `.${ext}`;
  if (title.toLowerCase().endsWith(extWithDot)) {
    return title.slice(0, -extWithDot.length);
  }
  return title;
}

/** Get Lucide icon name for file format. Excludes .md (no meaningful icon). */
export function getFileTypeIcon(path: string): string | null {
  const ext = extractExtension(path);
  if (!ext || ext === 'md') return null;
  if (ext === 'canvas') return 'layout-dashboard';
  if (ext === 'base') return 'layout-list';
  if (ext === 'pdf') return 'file-text';
  if (VALID_IMAGE_EXTENSIONS.includes(ext)) return 'image';
  return 'file';
}
