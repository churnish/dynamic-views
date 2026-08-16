/**
 * Data transformation utilities
 * Converts Bases entries into normalized CardData format
 */

import { TFile, type App, type BasesEntry } from 'obsidian';
import type { CardData } from './card-data';
import type { ResolvedSettings } from '../types';
import { getFirstBasesPropertyValue } from './property-extraction';
import {
  isCheckboxProperty,
  isSameProperty,
  stripNotePrefix,
  toDisplayName,
  toSyntaxName,
} from './property-display';
import { hasUriScheme } from '../utils/link-parser';
import { formatTimestamp, extractTimestamp } from './render-utils';
import { isTagProperty } from './property-helpers';

const DANGEROUS_SCHEMES = /^(javascript|data|vbscript):/i;

/** Validate if a string is a valid URI. Blocks dangerous schemes (javascript:, data:, vbscript:). */
function isValidUri(value: string): boolean {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (DANGEROUS_SCHEMES.test(trimmed)) return false;
  if (trimmed.length < 5 || trimmed.length > 2048) return false;
  if (!trimmed.includes('://')) return false;
  const uriPattern = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/.+$/;
  return uriPattern.test(trimmed);
}

/**
 * Resolve file.links or file.embeds property from metadataCache
 * Shared helper for resolving file link properties
 */
function resolveFileLinksProperty(
  app: App,
  filePath: string,
  type: 'links' | 'embeds'
): string | null {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return null;

  const cache = app.metadataCache.getFileCache(file);
  const source = type === 'links' ? cache?.links : cache?.embeds;
  const items = (source || [])
    .filter((l) => typeof l.link === 'string' && l.link.trim() !== '')
    .map((l) => `[[${l.link}]]`);

  return items.length === 0 ? null : JSON.stringify({ type: 'array', items });
}

/**
 * Resolve file.backlinks property from metadataCache.
 * getBacklinksForFile returns { data: Map<sourcePath, LinkCache[]> } —
 * keys are paths of files that link TO this file.
 */
function resolveFileBacklinksProperty(
  app: App,
  filePath: string
): string | null {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return null;

  const backlinks = app.metadataCache.getBacklinksForFile(file);
  if (!backlinks?.data) return null;

  const items: string[] = [];
  for (const sourcePath of backlinks.data.keys()) {
    // Basename only — matches native Bases table column display
    const name = sourcePath.replace(/\.md$/, '').split('/').pop() || sourcePath;
    items.push(`[[${name}]]`);
  }

  return items.length === 0 ? null : JSON.stringify({ type: 'array', items });
}

/**
 * Strip leading hash (#) from tag strings
 * @param tags Array of tag strings
 * @returns Array with hashes removed
 */
function stripTagHashes(tags: string[]): string[] {
  return tags.map((tag) => tag.replace(/^#/, ''));
}

/**
 * Check if a property is a custom timestamp property (created/modified time)
 * These properties should use styled formatting (recent/older abbreviation)
 */
function isCustomTimestampProperty(
  propertyName: string,
  settings: ResolvedSettings
): boolean {
  return (
    (!!settings.createdTimeProperty &&
      isSameProperty(propertyName, settings.createdTimeProperty)) ||
    (!!settings.modifiedTimeProperty &&
      isSameProperty(propertyName, settings.modifiedTimeProperty))
  );
}

/**
 * Apply smart timestamp logic to properties
 * If sorting by created/modified time, automatically show that timestamp
 * (unless both are already shown)
 */
export function applySmartTimestamp(
  props: string[],
  sortMethod: string,
  settings: ResolvedSettings
): string[] {
  // Only apply if smart timestamp is enabled
  if (!settings.smartTimestamp) {
    return props;
  }

  // Prerequisite: both settings must be populated
  if (!settings.createdTimeProperty || !settings.modifiedTimeProperty) {
    return props;
  }

  const createdProp = settings.createdTimeProperty;
  const modifiedProp = settings.modifiedTimeProperty;
  const createdStripped = stripNotePrefix(createdProp);
  const modifiedStripped = stripNotePrefix(modifiedProp);

  // Collect all known name forms for each timestamp.
  // Bases getOrder() uses "note." prefix for YAML properties, getSort() uses
  // internal names (file.mtime), and settings use display names (modified time).
  const createdForms = new Set([
    createdProp,
    createdStripped,
    'note.' + createdProp,
    'note.' + createdStripped,
    toDisplayName(createdStripped),
    toSyntaxName(createdStripped),
  ]);
  const modifiedForms = new Set([
    modifiedProp,
    modifiedStripped,
    'note.' + modifiedProp,
    'note.' + modifiedStripped,
    toDisplayName(modifiedStripped),
    toSyntaxName(modifiedStripped),
  ]);

  const sortingByCtime = [...createdForms].some((f) =>
    sortMethod.startsWith(f + '-')
  );

  const sortingByMtime = [...modifiedForms].some((f) =>
    sortMethod.startsWith(f + '-')
  );

  if (!sortingByCtime && !sortingByMtime) {
    return props;
  }

  const hasCreated = props.some((p) => createdForms.has(p));
  const hasModified = props.some((p) => modifiedForms.has(p));

  if (hasCreated && hasModified) {
    return props;
  }

  // Replace the non-sort timestamp with the sort timestamp
  const targetProperty = sortingByCtime ? createdProp : modifiedProp;
  const replaceForms = sortingByCtime ? modifiedForms : createdForms;

  return props.map((prop) => {
    if (replaceForms.has(prop)) {
      return targetProperty;
    }
    return prop;
  });
}

/**
 * Resolve timestamp property to formatted string
 * Shared by title, text preview, and property display
 * @param styled - Apply Style Settings abbreviation rules (for styled property display)
 */
export function resolveTimestampProperty(
  propertyName: string,
  ctime: number,
  mtime: number,
  styled: boolean = false
): string | null {
  if (!propertyName) return null;

  const prop = propertyName.trim();

  if (prop === 'file.ctime' || prop === 'created time') {
    return formatTimestamp(ctime, false, styled);
  }
  if (prop === 'file.mtime' || prop === 'modified time') {
    return formatTimestamp(mtime, false, styled);
  }

  return null;
}

/**
 * Transform Bases entry into CardData
 * Handles Bases-specific API (entry.getValue(), entry.file.path, etc.)
 */
export function basesEntryToCardData(
  app: App,
  entry: BasesEntry,
  settings: ResolvedSettings,
  sortMethod: string,
  isShuffled: boolean,
  visibleProperties: string[],
  textPreview?: string,
  imageUrl?: string | string[]
): CardData {
  // Use file.basename directly (file name without extension)
  const fileName = entry.file.basename || entry.file.name;

  // Get folder path (without filename)
  const path = entry.file.path;
  const folderPath = path.split('/').slice(0, -1).join('/');

  // Get timestamps - needed for special property resolution
  const ctime = entry.file.stat.ctime;
  const mtime = entry.file.stat.mtime;

  // Get title from property (first available from comma-separated list) or fallback to filename
  // Check for special properties first (timestamps, etc.)
  let title = '';
  if (settings.titleProperty) {
    const titleProps = settings.titleProperty.split(',').map((p) => p.trim());
    for (const prop of titleProps) {
      // Try timestamp property first
      const specialValue = resolveTimestampProperty(prop, ctime, mtime);
      if (specialValue) {
        title = specialValue;
        break;
      }
      // Try regular property via Bases API
      const titleValue = getFirstBasesPropertyValue(app, entry, prop);
      const titleData = (titleValue as { data?: unknown } | null)?.data;
      if (Array.isArray(titleData) && titleData.length > 0) {
        title = titleData.map(String).join(', ');
        break;
      }
      if (
        titleData != null &&
        titleData !== '' &&
        (typeof titleData === 'string' || typeof titleData === 'number')
      ) {
        title = String(titleData);
        break;
      }
    }
  }

  // Only fetch tags when needed for display or subtitle
  const needsTags =
    visibleProperties.some(isTagProperty) ||
    isTagProperty(settings.subtitleProperty);

  let yamlTags: string[] = [];
  let tags: string[] = [];

  if (needsTags) {
    // Bases getValue can throw on malformed property data (e.g. null in tags array)
    try {
      const yamlTagsValue = entry.getValue('note.tags') as {
        data?: unknown;
      } | null;
      if (yamlTagsValue && yamlTagsValue.data != null) {
        const tagData = yamlTagsValue.data;
        const rawTags = Array.isArray(tagData)
          ? tagData
              .map((t: unknown) => {
                if (t && typeof t === 'object' && 'data' in t) {
                  return String((t as { data: unknown }).data);
                }
                return typeof t === 'string' || typeof t === 'number'
                  ? String(t)
                  : '';
              })
              .filter((t) => t)
          : typeof tagData === 'string' || typeof tagData === 'number'
            ? [String(tagData)]
            : [];
        yamlTags = stripTagHashes(rawTags);
      }
    } catch {
      // Obsidian's getValue can throw when tag data contains null values
    }

    try {
      const allTagsValue = entry.getValue('file.tags') as {
        data?: unknown;
      } | null;
      if (allTagsValue && allTagsValue.data != null) {
        const tagData = allTagsValue.data;
        const rawTags = Array.isArray(tagData)
          ? tagData
              .map((t: unknown) => {
                if (t && typeof t === 'object' && 'data' in t) {
                  return String((t as { data: unknown }).data);
                }
                return typeof t === 'string' || typeof t === 'number'
                  ? String(t)
                  : '';
              })
              .filter((t) => t)
          : typeof tagData === 'string' || typeof tagData === 'number'
            ? [String(tagData)]
            : [];
        tags = stripTagHashes(rawTags);
      }
    } catch {
      // Obsidian's getValue can throw when tag data contains null values
    }
  }

  // Create initial card data
  const cardData: CardData = {
    path,
    name: fileName,
    title,
    tags,
    yamlTags,
    ctime,
    mtime,
    folderPath,
    textPreview,
    imageUrl,
    properties: [],
  };

  // Resolve properties from config.getOrder() visible list
  // Skip leading properties rendered as title/subtitle
  const displayProperties = visibleProperties.slice(
    settings._skipLeadingProperties ?? 0
  );

  // Include subtitle properties for smart timestamp check
  const subtitlePropsList =
    settings.subtitleProperty
      ?.split(',')
      .map((p) => p.trim())
      .filter((p) => p) || [];

  let props = [...displayProperties, ...subtitlePropsList];

  // Apply smart timestamp logic (includes subtitle fallbacks)
  props = applySmartTimestamp(props, sortMethod, settings);

  // Extract processed subtitle props back out
  const processedSubtitleProps = props.slice(displayProperties.length);
  props = props.slice(0, displayProperties.length);

  // Deduplicate (earlier properties take priority)
  const seen = new Set<string>();
  cardData.properties = props
    .filter((prop) => {
      if (!prop || prop === '') return false;
      if (seen.has(prop)) return false;
      seen.add(prop);
      return true;
    })
    .map((prop) => {
      const meta: { isDate?: boolean } = {};
      const value = resolveBasesProperty(
        app,
        prop,
        entry,
        cardData,
        settings,
        meta
      );
      return { name: prop, value, isDate: meta.isDate === true };
    });

  // Resolve subtitle property (supports comma-separated list).
  // File timestamps are not special-cased here: resolveFileProperty already formats
  // them, so one resolution path covers every property type the subtitle can hold.
  if (settings.subtitleProperty && processedSubtitleProps.length > 0) {
    for (const prop of processedSubtitleProps) {
      const meta: { isDate?: boolean } = {};
      const resolved = resolveBasesProperty(
        app,
        prop,
        entry,
        cardData,
        settings,
        meta
      );
      if (resolved !== null && resolved !== '') {
        // Marker strings (tags, array JSON) are passed through untouched so the
        // renderer rebuilds pills and list separators exactly as it does for rows
        cardData.subtitle = resolved;
        cardData.subtitleIsDate = meta.isDate === true;
        break;
      }
    }
  }

  // Resolve URL property
  if (settings.urlProperty) {
    const urlValue = getFirstBasesPropertyValue(
      app,
      entry,
      settings.urlProperty
    );

    if (urlValue && typeof urlValue === 'object' && 'data' in urlValue) {
      let urlData = urlValue.data;
      if (Array.isArray(urlData)) {
        urlData = urlData.find((v): v is string => typeof v === 'string');
      }

      if (typeof urlData === 'string') {
        cardData.urlValue = urlData;
        cardData.hasValidUrl = isValidUri(urlData);
      }
    }
  }

  return cardData;
}

/**
 * Batch transform Bases entries to CardData array
 */
export function transformBasesEntries(
  app: App,
  entries: BasesEntry[],
  settings: ResolvedSettings,
  sortMethod: string,
  isShuffled: boolean,
  visibleProperties: string[],
  textPreviews: Record<string, string>,
  images: Record<string, string | string[]>,
  hasImageAvailable: Record<string, boolean>
): CardData[] {
  return entries.map((entry) => {
    return basesEntryToCardData(
      app,
      entry,
      settings,
      sortMethod,
      isShuffled,
      visibleProperties,
      textPreviews[entry.file.path],
      images[entry.file.path]
    );
  });
}

/**
 * Resolve built-in file properties shared across both backends.
 * Returns string|null for matched properties, undefined if not a file property.
 */
function resolveFileProperty(
  propertyName: string,
  cardData: CardData,
  app: App,
  ctime: number,
  mtime: number
): string | null | undefined {
  if (propertyName === 'file.path' || propertyName === 'file path') {
    const path = cardData.path;
    return !path || path === '' ? null : path;
  }

  if (propertyName === 'file.folder' || propertyName === 'folder') {
    return cardData.folderPath === '' ? '/' : cardData.folderPath || null;
  }

  if (propertyName === 'tags' || propertyName === 'note.tags') {
    return cardData.yamlTags.length > 0 ? 'tags' : null;
  }

  if (propertyName === 'file.tags' || propertyName === 'file tags') {
    return cardData.tags.length > 0 ? 'tags' : null;
  }

  if (propertyName === 'file.links' || propertyName === 'file links') {
    return resolveFileLinksProperty(app, cardData.path, 'links');
  }

  if (propertyName === 'file.embeds' || propertyName === 'file embeds') {
    return resolveFileLinksProperty(app, cardData.path, 'embeds');
  }

  if (propertyName === 'file.backlinks' || propertyName === 'file backlinks') {
    return resolveFileBacklinksProperty(app, cardData.path);
  }

  const timestamp = resolveTimestampProperty(propertyName, ctime, mtime, true);
  if (timestamp) return timestamp;

  return undefined;
}

/**
 * Resolve property value for Bases entry
 * Returns null for missing/empty properties
 * @param meta - Optional out-param: set `isDate` when the value is a formatted date. An out-param
 * keeps the `string | null` return that every caller and assertion already relies on.
 */
export function resolveBasesProperty(
  app: App,
  propertyName: string,
  entry: BasesEntry,
  cardData: CardData,
  settings: ResolvedSettings,
  meta?: { isDate?: boolean }
): string | null {
  if (!propertyName || propertyName === '') {
    return null;
  }

  const fileResult = resolveFileProperty(
    propertyName,
    cardData,
    app,
    cardData.ctime,
    cardData.mtime
  );
  if (fileResult !== undefined) return fileResult;

  // Generic property: read from frontmatter
  const value = getFirstBasesPropertyValue(app, entry, propertyName);

  // No value - property missing or empty
  if (!value) {
    return null;
  }

  // Check if it's a date/datetime value - format regardless of property type
  const timestampData = extractTimestamp(value);
  if (timestampData) {
    // Use styled formatting only for custom timestamp properties
    const isCustomTimestamp = isCustomTimestampProperty(propertyName, settings);
    if (meta) meta.isDate = true;
    return formatTimestamp(
      timestampData.timestamp,
      timestampData.isDateOnly,
      isCustomTimestamp
    );
  }

  // File-typed values carry the file on `.file` and have no `.data`, so they must be handled
  // before the `data == null` guard below returns an empty value
  const fileValue = (value as { file?: unknown })?.file;
  if (fileValue instanceof TFile) {
    return `[[${fileValue.path}|${fileValue.basename}]]`;
  }

  // Extract .data for Bases properties
  const data = (value as { data?: unknown })?.data;

  // Handle empty values
  if (
    data == null ||
    data === '' ||
    (Array.isArray(data) && data.length === 0)
  ) {
    // Check if this is an empty checkbox property - show indeterminate state
    if (isCheckboxProperty(app, propertyName)) {
      return JSON.stringify({ type: 'checkbox', indeterminate: true });
    }

    // Return empty string for empty property (property exists but empty)
    // This distinguishes from null (missing property)
    return '';
  }

  // Handle checkbox/boolean properties - return special marker for renderer
  if (typeof data === 'boolean') {
    return JSON.stringify({ type: 'checkbox', checked: data });
  }

  // Convert to string
  if (typeof data === 'string' || typeof data === 'number') {
    const result = String(data);
    // Treat whitespace-only strings as empty
    if (typeof data === 'string' && result.trim() === '') {
      return '';
    }
    // Check if this is an internal link (Bases strips [[]] for single link values)
    // Internal links: have sourcePath/display AND no URI scheme
    // External links: have URI scheme (https://, obsidian://, etc.)
    if (!hasUriScheme(result) && typeof data === 'string') {
      const valueObj = value as {
        sourcePath?: unknown;
        display?: { data?: string };
      };
      if (valueObj.sourcePath !== undefined || valueObj.display !== undefined) {
        // Wrap internal link in wikilink syntax for renderTextWithLinks
        const displayText = valueObj.display?.data;
        if (displayText && displayText !== result) {
          return `[[${result}|${displayText}]]`;
        }
        return `[[${result}]]`;
      }
    }
    return result;
  }

  // Handle arrays - join elements
  if (Array.isArray(data)) {
    const stringElements = data
      .map((item: unknown) => {
        // Handle nested Bases objects with .data
        if (item && typeof item === 'object' && 'data' in item) {
          const nestedData = (item as { data: unknown }).data;
          if (nestedData == null || nestedData === '') return null;
          if (
            typeof nestedData === 'string' ||
            typeof nestedData === 'number' ||
            typeof nestedData === 'boolean'
          ) {
            return String(nestedData);
          }
          // Handle nested Link objects in .data
          // Check link first (original text), fall back to path (resolved)
          if (typeof nestedData === 'object' && nestedData !== null) {
            if ('link' in nestedData) {
              const linkValue = (nestedData as { link: unknown }).link;
              if (typeof linkValue === 'string' && linkValue.trim() !== '') {
                return `[[${linkValue}]]`;
              }
            }
            if ('path' in nestedData) {
              const pathValue = (nestedData as { path: unknown }).path;
              if (typeof pathValue === 'string' && pathValue.trim() !== '') {
                return `[[${pathValue}]]`;
              }
            }
          }
          return null; // Can't stringify complex nested objects
        }
        if (item == null || item === '') return null;
        // Bases preserves original YAML strings (including wikilinks)
        if (
          typeof item === 'string' ||
          typeof item === 'number' ||
          typeof item === 'boolean'
        ) {
          return String(item);
        }
        return null; // Can't stringify complex objects
      })
      .filter((s): s is string => s !== null);

    if (stringElements.length === 0) {
      return null; // All elements were empty - treat as missing property
    }
    // Return array marker for special rendering
    return JSON.stringify({ type: 'array', items: stringElements });
  }

  // For complex types (objects), return null (can't display)
  // Note: Bases preserves wikilinks as plain strings, no Link object handling needed
  return null;
}
