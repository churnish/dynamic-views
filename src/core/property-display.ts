/**
 * Property display and normalization utilities
 * Handles display names, label mapping, URI validation, and settings normalization
 */

import type { App } from 'obsidian';
import { DEFAULT_DISPLAY_TO_SYNTAX } from './property-mapping';

/**
 * Strip "note." prefix from property name to get frontmatter key
 * Bases prefixes frontmatter properties with "note." in its syntax
 */
export function stripNotePrefix(propertyName: string): string {
  return propertyName.startsWith('note.')
    ? propertyName.slice(5)
    : propertyName;
}

/**
 * Check if two property names refer to the same property,
 * accounting for Bases "note." prefix variations
 */
export function isSameProperty(a: string, b: string): boolean {
  if (a === b) return true;
  const aStripped = stripNotePrefix(a);
  const bStripped = stripNotePrefix(b);
  return aStripped === bStripped || aStripped === b || a === bStripped;
}

/** Parse comma-separated property names into a Set for O(1) lookup */
export function parsePropertyList(csv: string): Set<string> {
  if (!csv) return new Set();
  return new Set(
    csv
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s)
  );
}

/**
 * Get property info from Obsidian's property registry
 * @param app - Obsidian App instance
 * @param propertyName - Property name (may include "note." prefix)
 * @returns Property info object with type/widget, or undefined if not found
 */
function getPropertyInfo(
  app: App,
  propertyName: string
): { type?: string; widget?: string } | undefined {
  const fmProp = stripNotePrefix(propertyName);
  return app.metadataCache.getAllPropertyInfos?.()?.[fmProp] as
    | { type?: string; widget?: string }
    | undefined;
}

/**
 * Check if a property is a checkbox type using Obsidian's property registry
 * @param app - Obsidian App instance
 * @param propertyName - Property name (may include "note." prefix)
 * @returns true if property widget type is "checkbox"
 */
export function isCheckboxProperty(app: App, propertyName: string): boolean {
  return getPropertyInfo(app, propertyName)?.widget === 'checkbox';
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
  reverseMap?: Record<string, string>
): string {
  if (!propertyName || !propertyName.trim()) return propertyName;

  const trimmed = propertyName.trim();

  // 1. Already in syntax format - pass through
  if (
    trimmed.startsWith('file.') ||
    trimmed.startsWith('formula.') ||
    trimmed.startsWith('note.')
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
    // 3. Hardcoded fallback
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
  reverseMap: Record<string, string>
): string {
  if (!value) return value;
  return value
    .split(',')
    .map((p) => normalizePropertyName(app, p.trim(), reverseMap))
    .join(',');
}

/** Settings fields that contain property names needing normalization */
const PROPERTY_SETTINGS_KEYS = [
  'titleProperty',
  'subtitleProperty',
  'textPreviewProperty',
  'imageProperty',
  'urlProperty',
  'invertPropertyPairing',
  'invertPropertyPosition',
] as const;

/**
 * Normalize all property name fields in settings using the reverse display-name map
 * Also attaches the forward display name map for property name rendering
 * Call once at the top of the render cycle; downstream code uses the pre-normalized values
 */
export function normalizeSettingsPropertyNames(
  app: App,
  settings: {
    [K in (typeof PROPERTY_SETTINGS_KEYS)[number]]?: string;
  } & { _displayNameMap?: Record<string, string> },
  reverseMap: Record<string, string>,
  displayNameMap: Record<string, string>
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
 * Map of technical property names to exact labels (no capitalization changes)
 */
const PROPERTY_LABEL_MAP: Record<string, string> = {
  'file.file': 'file',
  file: 'file',
  'file.name': 'file name',
  'file name': 'file name',
  'file.basename': 'file base name',
  'file base name': 'file base name',
  'file.ext': 'file extension',
  'file.extension': 'file extension',
  'file extension': 'file extension',
  'file.backlinks': 'file backlinks',
  'file backlinks': 'file backlinks',
  'file.ctime': 'created time',
  'created time': 'created time',
  'file.embeds': 'file embeds',
  'file embeds': 'file embeds',
  'file.fullname': 'file full name',
  'file full name': 'file full name',
  'file.links': 'file links',
  'file links': 'file links',
  'file.path': 'file path',
  path: 'file path',
  'file path': 'file path',
  'file.size': 'file size',
  'file size': 'file size',
  'file.tags': 'file tags',
  'file tags': 'file tags',
  tags: 'tags',
  'note.tags': 'tags',
  'file.mtime': 'modified time',
  'modified time': 'modified time',
  'file.folder': 'folder',
  folder: 'folder',
};

/**
 * Normalize built-in property name to its display form.
 * E.g. "file.mtime" → "modified time", "file.ctime" → "created time".
 * Returns the input unchanged if no mapping exists.
 */
export function toDisplayName(property: string): string {
  return PROPERTY_LABEL_MAP[property] ?? property;
}

/**
 * Normalize built-in property name to its syntax form.
 * E.g. "modified time" → "file.mtime", "created time" → "file.ctime".
 * Returns the input unchanged if no mapping exists.
 */
export function toSyntaxName(property: string): string {
  return DEFAULT_DISPLAY_TO_SYNTAX[property] ?? property;
}

/**
 * Convert property name to readable display name
 * When displayNameMap is provided (Bases path), uses custom display names from .base YAML
 * Falls back to PROPERTY_LABEL_MAP for built-in properties, then prefix stripping
 */
export function getPropertyDisplayName(
  propertyName: string,
  displayNameMap?: Record<string, string>
): string {
  if (!propertyName || propertyName === '') return '';

  // Custom display name from .base YAML takes priority
  if (displayNameMap && propertyName in displayNameMap) {
    return displayNameMap[propertyName];
  }

  // Check if we have a mapped label
  const mappedLabel = PROPERTY_LABEL_MAP[propertyName.toLowerCase()];
  if (mappedLabel) return mappedLabel;

  // Strip note. prefix from YAML properties
  // (note.formula.one → formula.one, preserving the actual property name)
  const stripped = stripNotePrefix(propertyName);
  if (stripped !== propertyName) {
    return stripped;
  }

  // Strip formula. prefix from formula properties
  if (propertyName.startsWith('formula.')) {
    return propertyName.slice(8); // Remove "formula."
  }

  // For custom properties, use exact capitalization as-is
  return propertyName;
}
