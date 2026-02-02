/**
 * Property utility functions for handling comma-separated properties
 */

import { TFile } from "obsidian";
import type {
  App,
  BasesEntry,
  BasesViewConfig,
  BasesPropertyId,
} from "obsidian";
import type { DatacoreFile, DatacoreDate } from "../datacore/types";

/**
 * Strip "note." prefix from property name to get frontmatter key
 * Bases prefixes frontmatter properties with "note." in its syntax
 */
export function stripNotePrefix(propertyName: string): string {
  return propertyName.startsWith("note.")
    ? propertyName.slice(5)
    : propertyName;
}

/**
 * Get property info from Obsidian's property registry
 * @param app - Obsidian App instance
 * @param propertyName - Property name (may include "note." prefix)
 * @returns Property info object with type/widget, or undefined if not found
 */
function getPropertyInfo(
  app: App,
  propertyName: string,
): { type?: string; widget?: string } | undefined {
  const fmProp = stripNotePrefix(propertyName);
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- getAllPropertyInfos not in official types */
  return (app.metadataCache as any).getAllPropertyInfos?.()?.[fmProp] as
    | { type?: string; widget?: string }
    | undefined;
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
}

/**
 * Check if a property is a checkbox type using Obsidian's property registry
 * @param app - Obsidian App instance
 * @param propertyName - Property name (may include "note." prefix)
 * @returns true if property widget type is "checkbox"
 */
export function isCheckboxProperty(app: App, propertyName: string): boolean {
  return getPropertyInfo(app, propertyName)?.widget === "checkbox";
}

/**
 * Hardcoded fallback map: display name → syntax name
 * Used when Bases API is unavailable (Datacore path)
 */
const DEFAULT_DISPLAY_TO_SYNTAX: Record<string, string> = {
  "file name": "file.name",
  "file backlinks": "file.backlinks",
  "file base name": "file.basename",
  "created time": "file.ctime",
  "file embeds": "file.embeds",
  "file extension": "file.ext",
  folder: "file.folder",
  "file full name": "file.fullname",
  "file links": "file.links",
  "modified time": "file.mtime",
  "file path": "file.path",
  "file size": "file.size",
  "file tags": "file.tags",
};

/**
 * Build reverse lookup map from documented Bases API
 * Uses BasesViewConfig.getDisplayName() (since 1.10.0) and BasesView.allProperties (since 1.10.0)
 * Returns displayName → syntaxName mapping, including custom user-set display names
 */
export function buildDisplayToSyntaxMap(
  config: BasesViewConfig,
  allProperties: BasesPropertyId[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const propertyId of allProperties) {
    const displayName = config.getDisplayName(propertyId);
    if (displayName) {
      map[displayName] = propertyId;
    }
  }
  return map;
}

/**
 * Build forward lookup map: syntaxName → displayName
 * Used by getPropertyLabel to show user-facing display names on cards
 */
export function buildSyntaxToDisplayMap(
  config: BasesViewConfig,
  allProperties: BasesPropertyId[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const propertyId of allProperties) {
    const displayName = config.getDisplayName(propertyId);
    if (displayName) {
      map[propertyId] = displayName;
    }
  }
  return map;
}

/**
 * Normalize property name to Bases syntax format
 * Accepts both display names ("file name") and syntax names ("file.name")
 *
 * @param app - Obsidian app instance
 * @param propertyName - User-entered property name
 * @param reverseMap - Optional displayName → syntaxName map from buildDisplayToSyntaxMap (Bases path)
 * @returns Normalized syntax name for Bases getValue()
 */
export function normalizePropertyName(
  app: App,
  propertyName: string,
  reverseMap?: Record<string, string>,
): string {
  if (!propertyName || !propertyName.trim()) return propertyName;

  const trimmed = propertyName.trim();

  // 1. Already in syntax format - pass through
  if (
    trimmed.startsWith("file.") ||
    trimmed.startsWith("formula.") ||
    trimmed.startsWith("note.")
  ) {
    return trimmed;
  }

  // 2. Look up in reverse map (Bases path with documented API)
  if (reverseMap) {
    if (trimmed in reverseMap) {
      return reverseMap[trimmed];
    }
    // Don't fall back to hardcoded defaults when reverse map is available
  } else {
    // 3. Hardcoded fallback (Datacore path)
    if (trimmed in DEFAULT_DISPLAY_TO_SYNTAX) {
      return DEFAULT_DISPLAY_TO_SYNTAX[trimmed];
    }
  }

  // 4. Otherwise return as-is (note property bare name)
  return trimmed;
}

/**
 * Normalize a comma-separated property string in-place
 * Each property name is trimmed and normalized via normalizePropertyName
 */
function normalizePropertyString(
  app: App,
  value: string,
  reverseMap: Record<string, string>,
): string {
  if (!value) return value;
  return value
    .split(",")
    .map((p) => normalizePropertyName(app, p.trim(), reverseMap))
    .join(",");
}

/** Settings fields that contain property names needing normalization */
const PROPERTY_SETTINGS_KEYS = [
  "titleProperty",
  "subtitleProperty",
  "textPreviewProperty",
  "imageProperty",
  "urlProperty",
] as const;

/**
 * Normalize all property name fields in settings using the reverse display-name map
 * Also attaches the forward display name map for property label rendering
 * Call once at the top of the render cycle; downstream code uses the pre-normalized values
 */
export function normalizeSettingsPropertyNames(
  app: App,
  settings: {
    [K in (typeof PROPERTY_SETTINGS_KEYS)[number]]?: string;
  } & { _displayNameMap?: Record<string, string> },
  reverseMap: Record<string, string>,
  displayNameMap: Record<string, string>,
): void {
  for (const key of PROPERTY_SETTINGS_KEYS) {
    const value = settings[key];
    if (value) {
      settings[key] = normalizePropertyString(app, value, reverseMap);
    }
  }
  settings._displayNameMap = displayNameMap;
}

/**
 * Get first non-empty property value from comma-separated list (Bases)
 * Accepts any property type (text, number, checkbox, date, datetime, list)
 */
export function getFirstBasesPropertyValue(
  app: App,
  entry: BasesEntry,
  propertyString: string,
): unknown {
  if (!propertyString || !propertyString.trim()) return null;

  const properties = propertyString
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p);

  for (const prop of properties) {
    let value: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- Bases getValue requires any for property names
      value = entry.getValue(prop as any);
    } catch {
      // Obsidian's getValue can throw when entry's internal property data is null
      continue;
    }

    // Check for date/datetime values first - they have { icon, date, time } structure
    // Validate date is actually a Date object to avoid passing malformed values
    if (
      value &&
      typeof value === "object" &&
      "date" in value &&
      (value as { date: unknown }).date instanceof Date &&
      !isNaN((value as { date: Date }).date.getTime()) &&
      "time" in value
    ) {
      return value;
    }

    // Check for empty property BEFORE formula fallback
    // Bases returns {icon} for both missing and empty - use metadata cache to distinguish
    // Empty properties return {data: null}, missing properties return null
    if (
      value &&
      typeof value === "object" &&
      "icon" in value &&
      !("data" in value)
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
    if (value && typeof value === "object" && "data" in value) {
      return value;
    }
  }

  return null;
}

/**
 * Get first non-empty property value from comma-separated list (Datacore)
 * Accepts any property type (text, number, checkbox, date, datetime, list)
 */
export function getFirstDatacorePropertyValue(
  page: DatacoreFile,
  propertyString: string,
): unknown {
  if (!propertyString || !propertyString.trim()) return null;

  const properties = propertyString
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p);

  for (const prop of properties) {
    const value: unknown = page.value(prop);

    // Check if property exists (not null/undefined)
    if (value !== null && value !== undefined) {
      return value;
    }
  }

  return null;
}

/**
 * Get first valid date/datetime property value from comma-separated list (Bases)
 * Only accepts date and datetime property types
 */
export function getFirstBasesDatePropertyValue(
  app: App,
  entry: BasesEntry,
  propertyString: string,
): unknown {
  if (!propertyString || !propertyString.trim()) return null;

  const properties = propertyString
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p);

  for (const prop of properties) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- Bases getValue requires any for property names
    const value = entry.getValue(prop as any);

    // Return first valid date value found
    if (
      value &&
      typeof value === "object" &&
      "date" in value &&
      value.date instanceof Date
    ) {
      return value;
    }
  }

  return null;
}

/**
 * Get first valid date/datetime property value from comma-separated list (Datacore)
 * Only accepts DateTime objects with toMillis() method
 */
export function getFirstDatacoreDatePropertyValue(
  page: DatacoreFile,
  propertyString: string,
): DatacoreDate | null {
  if (!propertyString || !propertyString.trim()) return null;

  const properties = propertyString
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p);

  for (const prop of properties) {
    const value: unknown = page.value(prop);

    // Only accept DateTime objects (have toMillis method)
    if (value && typeof value === "object" && "toMillis" in value) {
      return value as DatacoreDate;
    }
    // Skip properties with wrong type
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
  propertyString: string,
): string[] {
  if (!propertyString || !propertyString.trim()) return [];

  const properties = propertyString
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p);
  const allImages: string[] = [];

  for (const prop of properties) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- Bases getValue requires any for property names
    const value = entry.getValue(prop as any);

    // Extract data from {data: value} structure (both regular and formula properties use this)
    if (!value || !(typeof value === "object" && "data" in value)) continue;
    const data = value.data;
    if (data == null || data === "") continue;

    // Process data (array or single value)
    if (Array.isArray(data)) {
      for (const item of data) {
        if (typeof item === "string" || typeof item === "number") {
          const str = String(item);
          if (str.trim()) allImages.push(str);
        }
      }
    } else if (typeof data === "string" || typeof data === "number") {
      const str = String(data);
      if (str.trim()) allImages.push(str);
    }
  }

  return allImages;
}

/**
 * Get ALL image values from ALL comma-separated properties (Datacore)
 * Only accepts text and list property types containing image paths/URLs
 * Returns array of all image paths/URLs found across all properties
 */
export function getAllDatacoreImagePropertyValues(
  page: DatacoreFile,
  propertyString: string,
): string[] {
  if (!propertyString || !propertyString.trim()) return [];

  const properties = propertyString
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p);
  const allImages: string[] = [];

  for (const prop of properties) {
    const value: unknown = page.value(prop);

    // Skip if property doesn't exist
    if (value === null || value === undefined) continue;

    if (Array.isArray(value)) {
      // List property - collect all values
      for (const item of value) {
        // Handle Link objects with path property
        if (typeof item === "object" && item !== null && "path" in item) {
          const pathValue = (item as { path: unknown }).path;
          if (typeof pathValue === "string" || typeof pathValue === "number") {
            const str = String(pathValue).trim();
            if (str) allImages.push(str);
          }
        } else if (typeof item === "string" || typeof item === "number") {
          const str = String(item).trim();
          if (str) allImages.push(str);
        }
      }
    } else {
      // Single value
      // Handle Link objects with path property
      if (typeof value === "object" && value !== null && "path" in value) {
        const pathValue = (value as { path: unknown }).path;
        if (typeof pathValue === "string" || typeof pathValue === "number") {
          const str = String(pathValue).trim();
          if (str) allImages.push(str);
        }
      } else if (typeof value === "string" || typeof value === "number") {
        const str = String(value).trim();
        if (str) allImages.push(str);
      }
    }
  }

  return allImages;
}

/**
 * Map of technical property names to exact labels (no capitalization changes)
 */
const PROPERTY_LABEL_MAP: Record<string, string> = {
  "file.file": "file",
  file: "file",
  "file.name": "file name",
  "file name": "file name",
  "file.basename": "file base name",
  "file base name": "file base name",
  "file.ext": "file extension",
  "file.extension": "file extension",
  "file extension": "file extension",
  "file.backlinks": "file backlinks",
  "file backlinks": "file backlinks",
  "file.ctime": "created time",
  "created time": "created time",
  "file.embeds": "file embeds",
  "file embeds": "file embeds",
  "file.fullname": "file full name",
  "file full name": "file full name",
  "file.links": "file links",
  "file links": "file links",
  "file.path": "file path",
  path: "file path",
  "file path": "file path",
  "file.size": "file size",
  "file size": "file size",
  "file.tags": "file tags",
  "file tags": "file tags",
  tags: "tags",
  "note.tags": "tags",
  "file.mtime": "modified time",
  "modified time": "modified time",
  "file.folder": "folder",
  folder: "folder",
};

/**
 * Convert property name to readable label
 * When displayNameMap is provided (Bases path), uses custom display names from .base YAML
 * Falls back to PROPERTY_LABEL_MAP for built-in properties, then prefix stripping
 */
export function getPropertyLabel(
  propertyName: string,
  displayNameMap?: Record<string, string>,
): string {
  if (!propertyName || propertyName === "") return "";

  // Custom display name from .base YAML takes priority
  if (displayNameMap && propertyName in displayNameMap) {
    return displayNameMap[propertyName];
  }

  // Check if we have a mapped label
  const mappedLabel = PROPERTY_LABEL_MAP[propertyName.toLowerCase()];
  if (mappedLabel) return mappedLabel;

  // Strip note. prefix from YAML properties
  // (note.formula.one → formula.one, preserving the actual property name)
  if (propertyName.startsWith("note.")) {
    return propertyName.slice(5); // Remove "note."
  }

  // Strip formula. prefix from formula properties
  if (propertyName.startsWith("formula.")) {
    return propertyName.slice(8); // Remove "formula."
  }

  // For custom properties, use exact capitalization as-is
  return propertyName;
}

/**
 * Get all property names used in the vault
 * Returns an array of all property names (from frontmatter)
 * Includes built-in special properties for property display
 */
export function getAllVaultProperties(app: App): string[] {
  const properties = new Set<string>();

  // Add special built-in properties for property display
  // Include both Bases format (file.tags) and human-readable format (file tags)
  properties.add("file.path");
  properties.add("file.tags");
  properties.add("file.mtime");
  properties.add("file.ctime");
  properties.add("file path");
  properties.add("file tags");
  properties.add("created time");
  properties.add("modified time");

  // Get all properties from metadata cache using type assertion
  // getAllPropertyInfos was added in Obsidian 1.4.0+
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- MetadataCache lacks getAllPropertyInfos in type definitions
  const metadataCache = app.metadataCache as any;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- getAllPropertyInfos not in official types
  if (typeof metadataCache.getAllPropertyInfos === "function") {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- getAllPropertyInfos not in official types
    const allPropertyInfos = metadataCache.getAllPropertyInfos() as Record<
      string,
      unknown
    > | null;

    if (allPropertyInfos) {
      for (const [propertyName] of Object.entries(allPropertyInfos)) {
        properties.add(propertyName);
      }
    }
  }

  // Return sorted array
  return Array.from(properties).sort((a, b) => {
    // Bases format (file.tags) takes priority over human-readable format (file tags)
    const aBasesFormat = a.startsWith("file.");
    const bBasesFormat = b.startsWith("file.");
    const aHumanFormat =
      (a.startsWith("file ") || a.includes(" time")) && !aBasesFormat;
    const bHumanFormat =
      (b.startsWith("file ") || b.includes(" time")) && !bBasesFormat;

    // Bases format first
    if (aBasesFormat && !bBasesFormat) return -1;
    if (!aBasesFormat && bBasesFormat) return 1;

    // Human-readable format second
    if (aHumanFormat && !bHumanFormat) return -1;
    if (!aHumanFormat && bHumanFormat) return 1;

    // Alphabetical for rest
    return a.localeCompare(b);
  });
}

/**
 * Validate if a string is a valid URI
 * Accepts any URI scheme (http://, https://, obsidian://, file://, etc.)
 */
export function isValidUri(value: string): boolean {
  if (!value || typeof value !== "string") return false;

  const trimmed = value.trim();

  // Basic length checks
  if (trimmed.length < 5 || trimmed.length > 2048) return false;

  // Must contain :// pattern for URI scheme
  if (!trimmed.includes("://")) return false;

  // Validate URI format: scheme + :// + path
  const uriPattern = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/.+$/;
  return uriPattern.test(trimmed);
}
