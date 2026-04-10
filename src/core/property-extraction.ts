/**
 * Property value extraction from Bases entries
 * Retrieves first/all values from comma-separated property lists
 */

import { TFile } from 'obsidian';
import type { App, BasesEntry, BasesPropertyId } from 'obsidian';
import { stripNotePrefix } from './property-display';

/**
 * Get first non-empty property value from comma-separated list (Bases)
 * Accepts any property type (text, number, checkbox, date, datetime, list)
 */
export function getFirstBasesPropertyValue(
  app: App,
  entry: BasesEntry,
  propertyString: string
): unknown {
  if (!propertyString || !propertyString.trim()) return null;

  const properties = propertyString
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p);

  for (const prop of properties) {
    let value: unknown;
    try {
      value = entry.getValue(prop as unknown as BasesPropertyId);
    } catch {
      // Obsidian's getValue can throw when entry's internal property data is null
      continue;
    }

    // Check for date/datetime values first - they have { icon, date, time } structure
    // Validate date is actually a Date object to avoid passing malformed values
    if (
      value &&
      typeof value === 'object' &&
      'date' in value &&
      (value as { date: unknown }).date instanceof Date &&
      !isNaN((value as { date: Date }).date.getTime()) &&
      'time' in value
    ) {
      return value;
    }

    // Check for empty property BEFORE formula fallback
    // Bases returns {icon} for both missing and empty - use metadata cache to distinguish
    // Empty properties return {data: null}, missing properties return null
    if (
      value &&
      typeof value === 'object' &&
      'icon' in value &&
      !('data' in value)
    ) {
      const filePath = entry.file?.path;
      if (filePath) {
        const file = app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
          const cache = app.metadataCache.getFileCache(file);
          const fmProp = stripNotePrefix(prop);
          if (cache?.frontmatter && fmProp in cache.frontmatter) {
            // Property exists in frontmatter but has no value - return empty marker
            return { data: null };
          }
        }
      }
    }

    // Return first valid value found (both regular and formula properties use {data: value} structure)
    if (value && typeof value === 'object' && 'data' in value) {
      return value;
    }
  }

  return null;
}

/**
 * Get ALL image values from ALL comma-separated properties (Bases)
 * Only accepts text and list property types containing image paths/URLs
 * Returns array of all image paths/URLs found across all properties
 */
export function getAllBasesImagePropertyValues(
  app: App,
  entry: BasesEntry,
  propertyString: string
): string[] {
  if (!propertyString || !propertyString.trim()) return [];

  const properties = propertyString
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p);
  const allImages: string[] = [];

  for (const prop of properties) {
    const value = entry.getValue(prop as unknown as BasesPropertyId);

    // Extract data from {data: value} structure (both regular and formula properties use this)
    if (!value || !(typeof value === 'object' && 'data' in value)) continue;
    const data = value.data;
    if (data == null || data === '') continue;

    // Process data (array or single value)
    if (Array.isArray(data)) {
      for (const item of data) {
        if (typeof item === 'string' || typeof item === 'number') {
          const str = String(item);
          if (str.trim()) allImages.push(str);
        }
      }
    } else if (typeof data === 'string' || typeof data === 'number') {
      const str = String(data);
      if (str.trim()) allImages.push(str);
    }
  }

  return allImages;
}
