/**
 * Property utility functions for handling comma-separated properties
 */

import type { App, BasesEntry } from "obsidian";
import type { DatacoreFile, DatacoreDate } from "../types/datacore";

/**
 * Type declarations for undocumented Bases API
 */
interface BasesPropertyConfig {
  propertyId: string;
  getDisplayName(): string;
}

interface BasesQuery {
  properties: Record<string, BasesPropertyConfig>;
  formulas: Record<string, unknown>;
}

interface BasesView {
  query: BasesQuery;
}

/**
 * Hardcoded fallback map: display name → syntax name
 * Used when Bases API is unavailable
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
 * Build reverse lookup map from Bases view's query.properties
 * Returns displayName → syntaxName mapping
 */
function buildDisplayToSyntaxMap(app: App): Record<string, string> | null {
  try {
    const leaves = app.workspace.getLeavesOfType("bases");
    if (!leaves || leaves.length === 0) return null;

    const view = leaves[0].view as unknown as BasesView;
    if (!view?.query?.properties) return null;

    const map: Record<string, string> = {};
    for (const [syntaxName, config] of Object.entries(view.query.properties)) {
      if (config && typeof config.getDisplayName === "function") {
        const displayName = config.getDisplayName();
        if (displayName) {
          map[displayName] = syntaxName;
        }
      }
    }
    return map;
  } catch {
    return null;
  }
}

/**
 * Get formula names from Bases view's query.formulas
 */
function getFormulaNames(app: App): Set<string> {
  try {
    const leaves = app.workspace.getLeavesOfType("bases");
    if (!leaves || leaves.length === 0) return new Set();

    const view = leaves[0].view as unknown as BasesView;
    if (!view?.query?.formulas) return new Set();

    return new Set(Object.keys(view.query.formulas));
  } catch {
    return new Set();
  }
}

/**
 * Normalize property name to Bases syntax format
 * Accepts both display names ("file name") and syntax names ("file.name")
 *
 * @param app - Obsidian app instance
 * @param propertyName - User-entered property name
 * @returns Normalized syntax name for Bases getValue()
 */
export function normalizePropertyName(app: App, propertyName: string): string {
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

  // 2. Try dynamic API first
  const dynamicMap = buildDisplayToSyntaxMap(app);
  if (dynamicMap) {
    // API available - only use dynamic lookup
    if (trimmed in dynamicMap) {
      return dynamicMap[trimmed];
    }
    // Don't fall back to hardcoded defaults when API is available
  } else {
    // 3. API unavailable - use hardcoded fallback
    if (trimmed in DEFAULT_DISPLAY_TO_SYNTAX) {
      return DEFAULT_DISPLAY_TO_SYNTAX[trimmed];
    }
  }

  // 4. Check if it's a formula name (without prefix)
  const formulaNames = getFormulaNames(app);
  if (formulaNames.has(trimmed)) {
    return `formula.${trimmed}`;
  }

  // 5. Otherwise return as-is (note property bare name)
  return trimmed;
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
    // Try property as-is first, then with formula. prefix if not found
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    let value = entry.getValue(prop as any);

    // If property not found (error object with icon), try as formula property
    if (
      value &&
      typeof value === "object" &&
      "icon" in value &&
      !("data" in value)
    ) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      value = entry.getValue(`formula.${prop}` as any);
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
    // Try property as-is first, then with formula. prefix if not found
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    let value = entry.getValue(prop as any);

    // If property not found (error object with icon), try as formula property
    if (
      value &&
      typeof value === "object" &&
      "icon" in value &&
      !("data" in value) &&
      !("date" in value)
    ) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      value = entry.getValue(`formula.${prop}` as any);
    }

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
    // Try property as-is first, then with formula. prefix if not found
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    let value = entry.getValue(prop as any);

    // If property not found (error object with icon), try as formula property
    if (
      value &&
      typeof value === "object" &&
      "icon" in value &&
      !("data" in value)
    ) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      value = entry.getValue(`formula.${prop}` as any);
    }

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
 * Returns exact property names for special properties, or original name for custom properties
 */
export function getPropertyLabel(propertyName: string): string {
  if (!propertyName || propertyName === "") return "";

  // Check if we have a mapped label
  const mappedLabel = PROPERTY_LABEL_MAP[propertyName.toLowerCase()];
  if (mappedLabel) return mappedLabel;

  // Strip note. prefix from YAML properties
  if (propertyName.startsWith("note.")) {
    return propertyName.slice(5); // Remove "note."
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
  const metadataCache = app.metadataCache as any;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (typeof metadataCache.getAllPropertyInfos === "function") {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const allPropertyInfos = metadataCache.getAllPropertyInfos();

    if (allPropertyInfos) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
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
