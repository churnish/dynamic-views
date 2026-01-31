/**
 * Data transformation utilities
 * Converts various data sources (Datacore, Bases) into normalized CardData format
 */

import { TFile, type App, type BasesEntry } from "obsidian";
import { getFileExtInfo } from "../utils/file-extension";
import type { CardData } from "./card-renderer";
import type { Settings } from "../types";
import type { DatacoreAPI, DatacoreFile } from "../datacore/types";
import {
  getFirstDatacorePropertyValue,
  getFirstBasesPropertyValue,
  normalizePropertyName,
  isValidUri,
  isCheckboxProperty,
  stripNotePrefix,
} from "../utils/property";
import { hasUriScheme } from "../utils/link-parser";
import { VALID_IMAGE_EXTENSIONS } from "../utils/image";
import { formatTimestamp, extractTimestamp } from "./render-utils";
import { getListSeparator } from "../utils/style-settings";

/**
 * Resolve file.links or file.embeds property from metadataCache
 * Shared helper used by both Bases and Datacore resolvers
 */
function resolveFileLinksProperty(
  app: App,
  filePath: string,
  type: "links" | "embeds",
): string | null {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return null;

  const cache = app.metadataCache.getFileCache(file);
  const source = type === "links" ? cache?.links : cache?.embeds;
  const items = (source || [])
    .filter((l) => typeof l.link === "string" && l.link.trim() !== "")
    .map((l) => `[[${l.link}]]`);

  return items.length === 0 ? null : JSON.stringify({ type: "array", items });
}

/**
 * Strip leading hash (#) from tag strings
 * @param tags Array of tag strings
 * @returns Array with hashes removed
 */
function stripTagHashes(tags: string[]): string[] {
  return tags.map((tag) => tag.replace(/^#/, ""));
}

/**
 * Check if a property is a custom timestamp property (created/modified time)
 * These properties should use styled formatting (recent/older abbreviation)
 * Handles both Bases format (note.propertyName) and Datacore format (propertyName)
 */
function isCustomTimestampProperty(
  propertyName: string,
  settings: Settings,
): boolean {
  const stripped = stripNotePrefix(propertyName);

  if (settings.createdTimeProperty) {
    const settingStripped = stripNotePrefix(settings.createdTimeProperty);
    if (stripped === settingStripped) return true;
  }

  if (settings.modifiedTimeProperty) {
    const settingStripped = stripNotePrefix(settings.modifiedTimeProperty);
    if (stripped === settingStripped) return true;
  }

  return false;
}

/**
 * Convert resolved property value to plain text for subtitle
 * Handles tags marker, array JSON, and regular strings
 */
function resolveSubtitleToPlainText(
  subtitleValue: string | null,
  settings: Settings,
  cardData: CardData,
): string | undefined {
  if (!subtitleValue) return undefined;

  // Handle tags marker - use correct array based on property name
  if (subtitleValue === "tags") {
    const isYamlOnly =
      settings.subtitleProperty === "tags" ||
      settings.subtitleProperty === "note.tags";
    const tags = isYamlOnly ? cardData.yamlTags : cardData.tags;
    return tags.length > 0 ? tags.join(getListSeparator()) : undefined;
  }

  // Handle array JSON (starts with specific prefix)
  if (subtitleValue.startsWith('{"type":"array"')) {
    try {
      const parsed = JSON.parse(subtitleValue) as {
        type: string;
        items: string[];
      };
      if (parsed.type === "array") return parsed.items.join(getListSeparator());
    } catch {
      /* fall through to return raw value */
    }
  }

  return subtitleValue || undefined;
}

/**
 * Apply smart timestamp logic to properties
 * If sorting by created/modified time, automatically show that timestamp
 * (unless both are already shown)
 */
function applySmartTimestamp(
  props: string[],
  sortMethod: string,
  settings: Settings,
): string[] {
  // Only apply if smart timestamp is enabled
  if (!settings.smartTimestamp) {
    return props;
  }

  // Prerequisite: both settings must be populated
  if (!settings.createdTimeProperty || !settings.modifiedTimeProperty) {
    return props;
  }

  // Detect ctime sorting: includes "ctime" OR matches createdTimeProperty (for Bases)
  const createdPropStripped = stripNotePrefix(settings.createdTimeProperty);
  const sortingByCtime =
    sortMethod.includes("ctime") ||
    sortMethod.startsWith(settings.createdTimeProperty + "-") ||
    sortMethod.startsWith(createdPropStripped + "-");

  // Detect mtime sorting: includes "mtime" OR matches modifiedTimeProperty (for Bases)
  const modifiedPropStripped = stripNotePrefix(settings.modifiedTimeProperty);
  const sortingByMtime =
    sortMethod.includes("mtime") ||
    sortMethod.startsWith(settings.modifiedTimeProperty + "-") ||
    sortMethod.startsWith(modifiedPropStripped + "-");

  // Only proceed if sorting by a timestamp
  if (!sortingByCtime && !sortingByMtime) {
    return props;
  }

  // Check if both timestamps are already shown
  const hasCtimeProperty = props.some(
    (p) =>
      p === "file.ctime" ||
      p === "created time" ||
      (settings.createdTimeProperty && p === settings.createdTimeProperty),
  );
  const hasMtimeProperty = props.some(
    (p) =>
      p === "file.mtime" ||
      p === "modified time" ||
      (settings.modifiedTimeProperty && p === settings.modifiedTimeProperty),
  );

  // If both are shown, don't change anything
  if (hasCtimeProperty && hasMtimeProperty) {
    return props;
  }

  // Determine which timestamp property to show and which to replace
  const targetProperty = sortingByCtime
    ? settings.createdTimeProperty
    : settings.modifiedTimeProperty;

  const propertiesToReplace = sortingByCtime
    ? ["file.mtime", "modified time", settings.modifiedTimeProperty].filter(
        Boolean,
      )
    : ["file.ctime", "created time", settings.createdTimeProperty].filter(
        Boolean,
      );

  // Replace mismatched timestamp properties
  return props.map((prop) => {
    if (propertiesToReplace.includes(prop)) {
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
  styled: boolean = false,
): string | null {
  if (!propertyName) return null;

  const prop = propertyName.trim().toLowerCase();

  if (prop === "file.ctime" || prop === "created time") {
    return formatTimestamp(ctime, false, styled);
  }
  if (prop === "file.mtime" || prop === "modified time") {
    return formatTimestamp(mtime, false, styled);
  }

  return null;
}

/**
 * Transform Datacore result into CardData
 * Handles Datacore-specific API (p.value(), p.$path, etc.)
 */
export function datacoreResultToCardData(
  app: App,
  result: DatacoreFile,
  dc: DatacoreAPI,
  settings: Settings,
  sortMethod: string,
  isShuffled: boolean,
  textPreview?: string,
  imageUrl?: string | string[],
): CardData {
  // Get folder path (without filename)
  const path = result.$path || "";
  const folderPath = path.split("/").slice(0, -1).join("/");

  // Get timestamps (convert Luxon DateTime to milliseconds) - needed for special property resolution
  const ctime = result.$ctime?.toMillis?.() || 0;
  const mtime = result.$mtime?.toMillis?.() || 0;

  // Get title from property (first available from comma-separated list) or fallback to filename
  // Check for special properties first (timestamps, etc.)
  let title = "";
  if (settings.titleProperty) {
    const titleProps = settings.titleProperty.split(",").map((p) => p.trim());
    for (const prop of titleProps) {
      // Try timestamp property first
      const specialValue = resolveTimestampProperty(prop, ctime, mtime);
      if (specialValue) {
        title = specialValue;
        break;
      }
      // Special case: file.name in Datacore → use $name
      if (prop === "file.name" || prop === "file name") {
        title = result.$name || "";
        break;
      }
      // Try regular property
      let rawTitle = getFirstDatacorePropertyValue(result, prop);
      if (Array.isArray(rawTitle)) rawTitle = rawTitle.join(getListSeparator());
      const propTitle = dc.coerce.string(rawTitle);
      if (propTitle) {
        title = propTitle;
        break;
      }
    }
  }

  // Get YAML tags only from 'tags' property
  const yamlTagsRaw = result.value("tags");
  const yamlTags: string[] = stripTagHashes(
    Array.isArray(yamlTagsRaw)
      ? yamlTagsRaw.filter((t): t is string => typeof t === "string")
      : [],
  );
  // Get tags in YAML + note body from $tags
  const tags = stripTagHashes(result.$tags || []);

  // Create base card data
  const cardData: CardData = {
    path,
    name: result.$name || "",
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

  // Resolve properties from Datacore settings (propertyDisplay1-14 on Settings)
  const subtitlePropsList =
    settings.subtitleProperty
      ?.split(",")
      .map((p) => p.trim())
      .filter((p) => p) || [];

  let props = [
    settings.propertyDisplay1,
    settings.propertyDisplay2,
    settings.propertyDisplay3,
    settings.propertyDisplay4,
    settings.propertyDisplay5,
    settings.propertyDisplay6,
    settings.propertyDisplay7,
    settings.propertyDisplay8,
    settings.propertyDisplay9,
    settings.propertyDisplay10,
    settings.propertyDisplay11,
    settings.propertyDisplay12,
    settings.propertyDisplay13,
    settings.propertyDisplay14,
    ...subtitlePropsList,
  ];

  // Apply smart timestamp logic (includes subtitle fallbacks)
  props = applySmartTimestamp(props, sortMethod, settings);

  // Extract processed subtitle props, then trim array back to 14
  const processedSubtitleProps = props.slice(14);
  props = props.slice(0, 14);

  // Deduplicate
  const seen = new Set<string>();
  cardData.properties = props
    .filter((prop) => {
      if (!prop || prop === "") return false;
      if (seen.has(prop)) return false;
      seen.add(prop);
      return true;
    })
    .map((prop) => ({
      name: prop,
      value: resolveDatacoreProperty(app, prop, result, cardData, settings, dc),
    }));

  // Resolve subtitle property (supports comma-separated list)
  if (settings.subtitleProperty && processedSubtitleProps.length > 0) {
    for (const prop of processedSubtitleProps) {
      const timestamp = resolveTimestampProperty(prop, ctime, mtime, false);
      if (timestamp) {
        cardData.subtitle = timestamp;
        break;
      }
      const resolved = resolveDatacoreProperty(
        app,
        prop,
        result,
        cardData,
        settings,
        dc,
      );
      if (resolved !== null && resolved !== "") {
        cardData.subtitle = resolveSubtitleToPlainText(
          resolved,
          settings,
          cardData,
        );
        break;
      }
    }
  }

  // Resolve URL property
  if (settings.urlProperty) {
    let urlValue = getFirstDatacorePropertyValue(result, settings.urlProperty);
    if (Array.isArray(urlValue)) {
      urlValue = urlValue.find((v): v is string => typeof v === "string");
    }

    if (typeof urlValue === "string") {
      cardData.urlValue = urlValue;
      cardData.hasValidUrl = isValidUri(urlValue);
    }
  }

  return cardData;
}

/**
 * Transform Bases entry into CardData
 * Handles Bases-specific API (entry.getValue(), entry.file.path, etc.)
 */
export function basesEntryToCardData(
  app: App,
  entry: BasesEntry,
  settings: Settings,
  sortMethod: string,
  isShuffled: boolean,
  visibleProperties: string[],
  textPreview?: string,
  imageUrl?: string | string[],
): CardData {
  // Use file.basename directly (file name without extension)
  const fileName = entry.file.basename || entry.file.name;

  // Get folder path (without filename)
  const path = entry.file.path;
  const folderPath = path.split("/").slice(0, -1).join("/");

  // Get timestamps - needed for special property resolution
  const ctime = entry.file.stat.ctime;
  const mtime = entry.file.stat.mtime;

  // Get title from property (first available from comma-separated list) or fallback to filename
  // Check for special properties first (timestamps, etc.)
  let title = "";
  if (settings.titleProperty) {
    const titleProps = settings.titleProperty.split(",").map((p) => p.trim());
    for (const prop of titleProps) {
      // Normalize property name for Bases API
      const normalizedProp = normalizePropertyName(app, prop);
      // Try timestamp property first
      const specialValue = resolveTimestampProperty(
        normalizedProp,
        ctime,
        mtime,
      );
      if (specialValue) {
        title = specialValue;
        break;
      }
      // Try regular property via Bases API
      const titleValue = getFirstBasesPropertyValue(app, entry, normalizedProp);
      const titleData = (titleValue as { data?: unknown } | null)?.data;
      if (Array.isArray(titleData) && titleData.length > 0) {
        title = titleData.map(String).join(getListSeparator());
        break;
      }
      if (
        titleData != null &&
        titleData !== "" &&
        (typeof titleData === "string" || typeof titleData === "number")
      ) {
        title = String(titleData);
        break;
      }
    }
  }

  // Get YAML tags only from 'tags' property
  const yamlTagsValue = entry.getValue("note.tags") as {
    data?: unknown;
  } | null;
  let yamlTags: string[] = [];

  if (yamlTagsValue && yamlTagsValue.data != null) {
    const tagData = yamlTagsValue.data;
    const rawTags = Array.isArray(tagData)
      ? tagData
          .map((t: unknown) => {
            // Handle Bases tag objects - extract the actual tag string
            if (t && typeof t === "object" && "data" in t) {
              return String((t as { data: unknown }).data);
            }
            // Fallback to string/number conversion
            return typeof t === "string" || typeof t === "number"
              ? String(t)
              : "";
          })
          .filter((t) => t)
      : typeof tagData === "string" || typeof tagData === "number"
        ? [String(tagData)]
        : [];

    yamlTags = stripTagHashes(rawTags);
  }

  // Get tags in YAML + note body from file.tags property
  const allTagsValue = entry.getValue("file.tags") as { data?: unknown } | null;
  let tags: string[] = [];

  if (allTagsValue && allTagsValue.data != null) {
    const tagData = allTagsValue.data;
    const rawTags = Array.isArray(tagData)
      ? tagData
          .map((t: unknown) => {
            // Handle Bases tag objects - extract the actual tag string
            if (t && typeof t === "object" && "data" in t) {
              return String((t as { data: unknown }).data);
            }
            // Fallback to string/number conversion
            return typeof t === "string" || typeof t === "number"
              ? String(t)
              : "";
          })
          .filter((t) => t)
      : typeof tagData === "string" || typeof tagData === "number"
        ? [String(tagData)]
        : [];

    tags = stripTagHashes(rawTags);
  }

  // Create base card data
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
  // Include subtitle properties for smart timestamp check
  const subtitlePropsList =
    settings.subtitleProperty
      ?.split(",")
      .map((p) => normalizePropertyName(app, p.trim()))
      .filter((p) => p) || [];

  let props = [...visibleProperties, ...subtitlePropsList];

  // Apply smart timestamp logic (includes subtitle fallbacks)
  props = applySmartTimestamp(props, sortMethod, settings);

  // Extract processed subtitle props back out
  const processedSubtitleProps = props.slice(visibleProperties.length);
  props = props.slice(0, visibleProperties.length);

  // Deduplicate (earlier properties take priority)
  const seen = new Set<string>();
  cardData.properties = props
    .filter((prop) => {
      if (!prop || prop === "") return false;
      if (seen.has(prop)) return false;
      seen.add(prop);
      return true;
    })
    .map((prop) => ({
      name: prop,
      value: resolveBasesProperty(app, prop, entry, cardData, settings),
    }));

  // Resolve subtitle property (supports comma-separated list)
  if (settings.subtitleProperty && processedSubtitleProps.length > 0) {
    for (const prop of processedSubtitleProps) {
      const timestamp = resolveTimestampProperty(prop, ctime, mtime, false);
      if (timestamp) {
        cardData.subtitle = timestamp;
        break;
      }
      const resolved = resolveBasesProperty(
        app,
        prop,
        entry,
        cardData,
        settings,
      );
      if (resolved !== null && resolved !== "") {
        cardData.subtitle = resolveSubtitleToPlainText(
          resolved,
          settings,
          cardData,
        );
        break;
      }
    }
  }

  // Resolve URL property
  // Normalize property names to support both display names and syntax names
  if (settings.urlProperty) {
    const normalizedUrlProperty = settings.urlProperty
      .split(",")
      .map((p) => normalizePropertyName(app, p.trim()))
      .join(",");
    const urlValue = getFirstBasesPropertyValue(
      app,
      entry,
      normalizedUrlProperty,
    );

    if (urlValue && typeof urlValue === "object" && "data" in urlValue) {
      let urlData = urlValue.data;
      if (Array.isArray(urlData)) {
        urlData = urlData.find((v): v is string => typeof v === "string");
      }

      if (typeof urlData === "string") {
        cardData.urlValue = urlData;
        cardData.hasValidUrl = isValidUri(urlData);
      }
    }
  }

  return cardData;
}

/**
 * Batch transform Datacore results to CardData array
 */
export function transformDatacoreResults(
  app: App,
  results: DatacoreFile[],
  dc: DatacoreAPI,
  settings: Settings,
  sortMethod: string,
  isShuffled: boolean,
  textPreviews: Record<string, string>,
  images: Record<string, string | string[]>,
  hasImageAvailable: Record<string, boolean>,
): CardData[] {
  return results
    .filter((p) => p.$path)
    .map((p) => {
      // For image files, use file itself as card image
      const ext = getFileExtInfo(p.$path, true)?.ext.slice(1) || "";
      if (VALID_IMAGE_EXTENSIONS.includes(ext) && !images[p.$path]) {
        const file = app.vault.getAbstractFileByPath(p.$path);
        if (file instanceof TFile) {
          images[p.$path] = app.vault.getResourcePath(file);
          hasImageAvailable[p.$path] = true;
        }
      }
      return datacoreResultToCardData(
        app,
        p,
        dc,
        settings,
        sortMethod,
        isShuffled,
        textPreviews[p.$path],
        images[p.$path],
      );
    });
}

/**
 * Batch transform Bases entries to CardData array
 */
export function transformBasesEntries(
  app: App,
  entries: BasesEntry[],
  settings: Settings,
  sortMethod: string,
  isShuffled: boolean,
  visibleProperties: string[],
  textPreviews: Record<string, string>,
  images: Record<string, string | string[]>,
  hasImageAvailable: Record<string, boolean>,
): CardData[] {
  return entries.map((entry) => {
    // For image files, use file itself as card image
    const ext = entry.file.extension?.toLowerCase() || "";
    if (VALID_IMAGE_EXTENSIONS.includes(ext) && !images[entry.file.path]) {
      images[entry.file.path] = app.vault.getResourcePath(entry.file);
      hasImageAvailable[entry.file.path] = true;
    }
    return basesEntryToCardData(
      app,
      entry,
      settings,
      sortMethod,
      isShuffled,
      visibleProperties,
      textPreviews[entry.file.path],
      images[entry.file.path],
    );
  });
}

/**
 * Resolve property value for Bases entry
 * Returns null for missing/empty properties
 */
export function resolveBasesProperty(
  app: App,
  propertyName: string,
  entry: BasesEntry,
  cardData: CardData,
  settings: Settings,
): string | null {
  if (!propertyName || propertyName === "") {
    return null;
  }

  // Handle special properties (support both dot and space notation)
  // Examples: file.path, file.tags, file.mtime, file.ctime
  // Or: "file path", "file tags", "modified time", "created time"
  if (propertyName === "file.path" || propertyName === "file path") {
    const path = cardData.path;
    if (!path || path === "") {
      return null;
    }
    return path;
  }

  // YAML tags only
  if (propertyName === "tags" || propertyName === "note.tags") {
    return cardData.yamlTags.length > 0 ? "tags" : null;
  }

  // tags in YAML + note body
  if (propertyName === "file.tags" || propertyName === "file tags") {
    return cardData.tags.length > 0 ? "tags" : null;
  }

  // file.links - non-embedded links from metadataCache
  if (propertyName === "file.links" || propertyName === "file links") {
    return resolveFileLinksProperty(app, cardData.path, "links");
  }

  // file.embeds - embedded links from metadataCache
  if (propertyName === "file.embeds" || propertyName === "file embeds") {
    return resolveFileLinksProperty(app, cardData.path, "embeds");
  }

  // Handle file timestamp properties (styled for property display)
  const timestamp = resolveTimestampProperty(
    propertyName,
    cardData.ctime,
    cardData.mtime,
    true,
  );
  if (timestamp) return timestamp;

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
    return formatTimestamp(
      timestampData.timestamp,
      timestampData.isDateOnly,
      isCustomTimestamp,
    );
  }

  // Extract .data for Bases properties
  const data = (value as { data?: unknown })?.data;

  // Handle empty values
  if (
    data == null ||
    data === "" ||
    (Array.isArray(data) && data.length === 0)
  ) {
    // Check if this is an empty checkbox property - show indeterminate state
    if (isCheckboxProperty(app, propertyName)) {
      return JSON.stringify({ type: "checkbox", indeterminate: true });
    }

    // Return empty string for empty property (property exists but empty)
    // This distinguishes from null (missing property)
    return "";
  }

  // Handle checkbox/boolean properties - return special marker for renderer
  if (typeof data === "boolean") {
    return JSON.stringify({ type: "checkbox", checked: data });
  }

  // Convert to string
  if (typeof data === "string" || typeof data === "number") {
    const result = String(data);
    // Treat whitespace-only strings as empty
    if (typeof data === "string" && result.trim() === "") {
      return "";
    }
    // Check if this is an internal link (Bases strips [[]] for single link values)
    // Internal links: have sourcePath/display AND no URI scheme
    // External links: have URI scheme (https://, obsidian://, etc.)
    if (!hasUriScheme(result) && typeof data === "string") {
      const valueObj = value as { sourcePath?: unknown; display?: unknown };
      if (valueObj.sourcePath !== undefined || valueObj.display !== undefined) {
        // Wrap internal link in wikilink syntax for renderTextWithLinks
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
        if (item && typeof item === "object" && "data" in item) {
          const nestedData = (item as { data: unknown }).data;
          if (nestedData == null || nestedData === "") return null;
          if (
            typeof nestedData === "string" ||
            typeof nestedData === "number" ||
            typeof nestedData === "boolean"
          ) {
            return String(nestedData);
          }
          // Handle nested Link objects in .data
          // Check link first (original text), fall back to path (resolved)
          if (typeof nestedData === "object" && nestedData !== null) {
            if ("link" in nestedData) {
              const linkValue = (nestedData as { link: unknown }).link;
              if (typeof linkValue === "string" && linkValue.trim() !== "") {
                return `[[${linkValue}]]`;
              }
            }
            if ("path" in nestedData) {
              const pathValue = (nestedData as { path: unknown }).path;
              if (typeof pathValue === "string" && pathValue.trim() !== "") {
                return `[[${pathValue}]]`;
              }
            }
          }
          return null; // Can't stringify complex nested objects
        }
        if (item == null || item === "") return null;
        // Bases preserves original YAML strings (including wikilinks)
        if (
          typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean"
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
    return JSON.stringify({ type: "array", items: stringElements });
  }

  // For complex types (objects), return null (can't display)
  // Note: Bases preserves wikilinks as plain strings, no Link object handling needed
  return null;
}

/**
 * Resolve property value for Datacore file
 * Returns null for missing/empty properties
 */
export function resolveDatacoreProperty(
  app: App,
  propertyName: string,
  result: DatacoreFile,
  cardData: CardData,
  settings: Settings,
  dc: DatacoreAPI,
): string | null {
  if (!propertyName || propertyName === "") return null;

  // Handle special properties (support both dot and space notation)
  // Dot notation: file.path, file.tags, file.mtime, file.ctime
  // Space notation: "file path", "file tags", "modified time", "created time"
  if (propertyName === "file.path" || propertyName === "file path") {
    const path = cardData.path;
    if (!path || path === "") return null;
    return path;
  }

  if (propertyName === "file.folder" || propertyName === "folder") {
    // Return "/" for root folder (empty folderPath)
    return cardData.folderPath === "" ? "/" : cardData.folderPath || null;
  }

  // YAML tags only
  if (propertyName === "tags") {
    return cardData.yamlTags.length > 0 ? "tags" : null; // Special marker
  }

  // tags in YAML + note body
  if (propertyName === "file.tags" || propertyName === "file tags") {
    return cardData.tags.length > 0 ? "tags" : null; // Special marker
  }

  // file.links - non-embedded links from metadataCache
  if (propertyName === "file.links" || propertyName === "file links") {
    return resolveFileLinksProperty(app, cardData.path, "links");
  }

  // file.embeds - embedded links from metadataCache
  if (propertyName === "file.embeds" || propertyName === "file embeds") {
    return resolveFileLinksProperty(app, cardData.path, "embeds");
  }

  // Handle file timestamp properties (styled for property display)
  const timestamp = resolveTimestampProperty(
    propertyName,
    cardData.ctime,
    cardData.mtime,
    true,
  );
  if (timestamp) return timestamp;

  // Generic property: read from frontmatter
  const rawValue = getFirstDatacorePropertyValue(result, propertyName);

  // Handle arrays - join elements
  if (Array.isArray(rawValue)) {
    // Check if all elements are dates - if so, format first one
    // Use styled=true for consistent formatting with file timestamps
    const firstElement = rawValue[0] as unknown;
    const timestampData = extractTimestamp(firstElement);
    if (timestampData) {
      return formatTimestamp(
        timestampData.timestamp,
        timestampData.isDateOnly,
        true,
      );
    }

    // Otherwise join all elements as strings
    const stringElements = rawValue
      .map((item: unknown) => {
        // Use dc.coerce.string for all items - handles Link objects correctly
        // (returns [[path|display]] format which preserves navigation and shows filename)
        const str = dc.coerce.string(item);
        return str && str.trim() !== "" ? str : null;
      })
      .filter((s): s is string => s !== null);

    if (stringElements.length === 0) {
      // All elements were empty - treat as missing property
      return null;
    }

    // Return array marker for special rendering
    return JSON.stringify({ type: "array", items: stringElements });
  }

  // Check if it's a date/datetime value - format regardless of property type
  const timestampData = extractTimestamp(rawValue);
  if (timestampData) {
    // Use styled formatting only for custom timestamp properties
    const isCustomTimestamp = isCustomTimestampProperty(propertyName, settings);
    return formatTimestamp(
      timestampData.timestamp,
      timestampData.isDateOnly,
      isCustomTimestamp,
    );
  }

  // Handle checkbox/boolean properties - return special marker for renderer
  if (typeof rawValue === "boolean") {
    return JSON.stringify({ type: "checkbox", checked: rawValue });
  }

  // Handle missing property (null/undefined)
  if (rawValue === null || rawValue === undefined) {
    // Check if this is a custom timestamp property
    const isCustomCreatedTime =
      settings.createdTimeProperty &&
      propertyName === settings.createdTimeProperty;
    const isCustomModifiedTime =
      settings.modifiedTimeProperty &&
      propertyName === settings.modifiedTimeProperty;

    if (isCustomCreatedTime || isCustomModifiedTime) {
      // Fall back to file metadata
      // Use styled=true for consistent formatting with other timestamp displays
      const timestamp = isCustomCreatedTime ? cardData.ctime : cardData.mtime;
      return formatTimestamp(timestamp, false, true);
    }

    // Check if this is an empty checkbox property - show indeterminate state
    if (isCheckboxProperty(app, propertyName)) {
      return JSON.stringify({ type: "checkbox", indeterminate: true });
    }

    // Return null for missing property
    return null;
  }

  // Coerce to string - handles Link objects correctly (returns [[path|display]] format)
  const value = dc.coerce.string(rawValue);

  // Handle empty values (property exists but empty)
  if (!value || value.trim() === "") {
    return "";
  }

  return value;
}
