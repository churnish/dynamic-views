/**
 * Data transformation utilities
 * Converts various data sources (Datacore, Bases) into normalized CardData format
 */

import { TFile, type App, type BasesEntry } from "obsidian";
import type { CardData } from "./card-renderer";
import type { Settings } from "../types";
import type { DatacoreAPI, DatacoreFile } from "../datacore/types";
import {
  getFirstDatacorePropertyValue,
  getFirstBasesPropertyValue,
  normalizePropertyName,
  isValidUri,
} from "../utils/property";
import { hasUriScheme } from "../utils/link-parser";
import { VALID_IMAGE_EXTENSIONS } from "../utils/image";
import { formatTimestamp, extractTimestamp } from "./render-utils";

/**
 * Strip leading hash (#) from tag strings
 * @param tags Array of tag strings
 * @returns Array with hashes removed
 */
function stripTagHashes(tags: string[]): string[] {
  return tags.map((tag) => tag.replace(/^#/, ""));
}

/**
 * Handle custom timestamp property fallback logic
 * @param propertyName The property being resolved
 * @param settings Plugin settings
 * @param cardData Card data with file metadata timestamps
 * @returns Formatted timestamp string, placeholder, or null
 */
function handleTimestampPropertyFallback(
  propertyName: string,
  settings: Settings,
  cardData: CardData,
): string | null {
  // Check if this is a custom timestamp property
  const isCustomCreatedTime =
    settings.createdTimeProperty &&
    propertyName === settings.createdTimeProperty;
  const isCustomModifiedTime =
    settings.modifiedTimeProperty &&
    propertyName === settings.modifiedTimeProperty;

  if (!isCustomCreatedTime && !isCustomModifiedTime) {
    return null; // Not a custom timestamp property
  }

  // Fall back to file metadata
  const timestamp = isCustomCreatedTime ? cardData.ctime : cardData.mtime;
  return formatTimestamp(timestamp);
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
    return tags.length > 0 ? tags.join(", ") : undefined;
  }

  // Handle array JSON (starts with specific prefix)
  if (subtitleValue.startsWith('{"type":"array"')) {
    try {
      const parsed = JSON.parse(subtitleValue) as {
        type: string;
        items: string[];
      };
      if (parsed.type === "array") return parsed.items.join(", ");
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

  // Determine which timestamp we're sorting by
  const sortingByCtime = sortMethod.includes("ctime");
  const sortingByMtime = sortMethod.includes("mtime");

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
    ? settings.createdTimeProperty || "file.ctime"
    : settings.modifiedTimeProperty || "file.mtime";

  const propertiesToReplace = sortingByCtime
    ? ["file.mtime", "modified time", settings.modifiedTimeProperty].filter(
        Boolean,
      )
    : ["file.ctime", "created time", settings.createdTimeProperty].filter(
        Boolean,
      );

  // Replace mismatched timestamp properties
  const result = props.map((prop) => {
    if (propertiesToReplace.includes(prop)) {
      return targetProperty;
    }
    return prop;
  });

  return result;
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
  result: DatacoreFile,
  dc: DatacoreAPI,
  settings: Settings,
  sortMethod: string,
  isShuffled: boolean,
  textPreview?: string,
  imageUrl?: string | string[],
  hasImageAvailable?: boolean,
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
      // Try regular property
      let rawTitle = getFirstDatacorePropertyValue(result, prop);
      if (Array.isArray(rawTitle)) rawTitle = rawTitle[0];
      const propTitle = dc.coerce.string(rawTitle);
      if (propTitle) {
        title = propTitle;
        break;
      }
    }
  }
  if (!title) {
    title = result.$name || "";
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
    hasImageAvailable: hasImageAvailable || false,
  };

  // Resolve properties
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
  ];

  // Apply smart timestamp logic
  props = applySmartTimestamp(props, sortMethod, settings);

  // Detect duplicates (priority: 1 > 2 > 3 > 4 > 5 > 6 > 7 > 8 > 9 > 10 > 11 > 12 > 13 > 14)
  const seen = new Set<string>();
  const effectiveProps = props.map((prop) => {
    if (!prop || prop === "") return "";
    if (seen.has(prop)) return ""; // Duplicate, skip
    seen.add(prop);
    return prop;
  });

  // Store property names and resolve property values (loop for all 14 properties)
  for (let i = 0; i < 14; i++) {
    const propName = `propertyName${i + 1}` as keyof CardData;
    const propValue = `property${i + 1}` as keyof CardData;

    cardData[propName] = (effectiveProps[i] || undefined) as never;
    cardData[propValue] = (
      effectiveProps[i]
        ? resolveDatacoreProperty(
            effectiveProps[i],
            result,
            cardData,
            settings,
            dc,
          )
        : null
    ) as never;
  }

  // Resolve subtitle property (supports comma-separated list)
  if (settings.subtitleProperty) {
    const subtitleProps = settings.subtitleProperty
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p);
    for (const prop of subtitleProps) {
      const resolved = resolveDatacoreProperty(
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
  textPreview?: string,
  imageUrl?: string | string[],
  hasImageAvailable?: boolean,
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
  if (!title) {
    title = fileName;
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
    hasImageAvailable: hasImageAvailable || false,
  };

  // Resolve properties
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
  ];

  // Apply smart timestamp logic
  props = applySmartTimestamp(props, sortMethod, settings);

  // Detect duplicates (priority: 1 > 2 > 3 > 4 > 5 > 6 > 7 > 8 > 9 > 10 > 11 > 12 > 13 > 14)
  const seen = new Set<string>();
  const effectiveProps = props.map((prop) => {
    if (!prop || prop === "") return "";
    if (seen.has(prop)) return ""; // Duplicate, skip
    seen.add(prop);
    return prop;
  });

  // Store property names and resolve property values (loop for all 14 properties)
  for (let i = 0; i < 14; i++) {
    const propName = `propertyName${i + 1}` as keyof CardData;
    const propValue = `property${i + 1}` as keyof CardData;

    cardData[propName] = (effectiveProps[i] || undefined) as never;
    cardData[propValue] = (
      effectiveProps[i]
        ? resolveBasesProperty(
            app,
            effectiveProps[i],
            entry,
            cardData,
            settings,
          )
        : null
    ) as never;
  }

  // Resolve subtitle property (supports comma-separated list)
  // Normalize property names to support both display names and syntax names
  if (settings.subtitleProperty) {
    const subtitleProps = settings.subtitleProperty
      .split(",")
      .map((p) => normalizePropertyName(app, p.trim()))
      .filter((p) => p);
    for (const prop of subtitleProps) {
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
      const ext = p.$path.split(".").pop()?.toLowerCase() || "";
      if (VALID_IMAGE_EXTENSIONS.includes(ext) && !images[p.$path]) {
        const file = app.vault.getAbstractFileByPath(p.$path);
        if (file instanceof TFile) {
          images[p.$path] = app.vault.getResourcePath(file);
          hasImageAvailable[p.$path] = true;
        }
      }
      return datacoreResultToCardData(
        p,
        dc,
        settings,
        sortMethod,
        isShuffled,
        textPreviews[p.$path],
        images[p.$path],
        hasImageAvailable[p.$path],
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
      textPreviews[entry.file.path],
      images[entry.file.path],
      hasImageAvailable[entry.file.path],
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

  // Handle special properties (support both Bases and Datacore formats)
  // Bases format: file.path, file.tags, file.mtime, file.ctime
  // Datacore format: "file path", "file tags", "modified time", "created time"
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

  // Handle fallback for custom timestamp properties when property is missing
  if (!value) {
    const fallback = handleTimestampPropertyFallback(
      propertyName,
      settings,
      cardData,
    );
    if (fallback !== null) return fallback;
    return null;
  }

  // Check if it's a date/datetime value - format with custom format
  // Date properties return { date: Date, time: boolean } directly
  const timestampData = extractTimestamp(value);
  if (timestampData) {
    return formatTimestamp(timestampData.timestamp, timestampData.isDateOnly);
  }

  // For non-date properties, extract .data
  const data = (value as { data?: unknown })?.data;

  // Handle empty values for custom timestamp properties
  if (
    data == null ||
    data === "" ||
    (Array.isArray(data) && data.length === 0)
  ) {
    const fallback = handleTimestampPropertyFallback(
      propertyName,
      settings,
      cardData,
    );
    if (fallback !== null) return fallback;

    // Return empty string for empty property (property exists but empty)
    // This distinguishes from null (missing property)
    return "";
  }

  // Convert to string
  if (
    typeof data === "string" ||
    typeof data === "number" ||
    typeof data === "boolean"
  ) {
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
          if (typeof nestedData === "object" && nestedData !== null) {
            if ("path" in nestedData) {
              const pathValue = (nestedData as { path: unknown }).path;
              if (typeof pathValue === "string" && pathValue.trim() !== "") {
                return `[[${pathValue}]]`;
              }
            }
            if ("link" in nestedData) {
              const linkValue = (nestedData as { link: unknown }).link;
              if (typeof linkValue === "string" && linkValue.trim() !== "") {
                return `[[${linkValue}]]`;
              }
            }
          }
          return null; // Can't stringify complex nested objects
        }
        if (item == null || item === "") return null;
        if (
          typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean"
        ) {
          return String(item);
        }
        // Handle Link objects directly in array
        if (typeof item === "object") {
          if ("path" in item) {
            const pathValue = (item as { path: unknown }).path;
            if (typeof pathValue === "string" && pathValue.trim() !== "") {
              return `[[${pathValue}]]`;
            }
          }
          if ("link" in item) {
            const linkValue = (item as { link: unknown }).link;
            if (typeof linkValue === "string" && linkValue.trim() !== "") {
              return `[[${linkValue}]]`;
            }
          }
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

  // Handle Link objects (Bases may use path or link property for wikilinks)
  if (typeof data === "object" && data !== null) {
    // Check for path property (like Datacore Link objects)
    if ("path" in data) {
      const pathValue = (data as { path: unknown }).path;
      if (typeof pathValue === "string" && pathValue.trim() !== "") {
        return `[[${pathValue}]]`;
      }
    }
    // Check for link property (alternative structure)
    if ("link" in data) {
      const linkValue = (data as { link: unknown }).link;
      if (typeof linkValue === "string" && linkValue.trim() !== "") {
        return `[[${linkValue}]]`;
      }
    }
  }

  // For complex types, return null (can't display)
  return null;
}

/**
 * Resolve property value for Datacore file
 * Returns null for missing/empty properties
 */
export function resolveDatacoreProperty(
  propertyName: string,
  result: DatacoreFile,
  cardData: CardData,
  settings: Settings,
  dc: DatacoreAPI,
): string | null {
  if (!propertyName || propertyName === "") return null;

  // Handle special properties (support both Bases and Datacore formats)
  // Bases format: file.path, file.tags, file.mtime, file.ctime
  // Datacore format: "file path", "file tags", "modified time", "created time"
  if (propertyName === "file.path" || propertyName === "file path") {
    const path = cardData.path;
    if (!path || path === "") return null;
    return path;
  }

  // YAML tags only
  if (propertyName === "tags") {
    return cardData.yamlTags.length > 0 ? "tags" : null; // Special marker
  }

  // tags in YAML + note body
  if (propertyName === "file.tags" || propertyName === "file tags") {
    return cardData.tags.length > 0 ? "tags" : null; // Special marker
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
    const firstElement = rawValue[0] as unknown;
    const timestampData = extractTimestamp(firstElement);
    if (timestampData) {
      return formatTimestamp(timestampData.timestamp, timestampData.isDateOnly);
    }

    // Otherwise join all elements as strings
    const stringElements = rawValue
      .map((item: unknown) => {
        // Handle Link objects with path property
        if (typeof item === "object" && item !== null && "path" in item) {
          const pathValue = (item as { path: unknown }).path;
          if (typeof pathValue === "string" && pathValue.trim() !== "") {
            return pathValue;
          }
        }
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

  // Check if it's a date/datetime value - format with custom format
  const timestampData = extractTimestamp(rawValue);
  if (timestampData) {
    return formatTimestamp(timestampData.timestamp, timestampData.isDateOnly);
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
      const timestamp = isCustomCreatedTime ? cardData.ctime : cardData.mtime;
      return formatTimestamp(timestamp);
    }
    // Return null for missing property
    return null;
  }

  // Handle Link objects with path property (single value)
  // Preserve wikilink syntax so renderTextWithLinks can detect it
  if (typeof rawValue === "object" && rawValue !== null && "path" in rawValue) {
    const pathValue = (rawValue as { path: unknown }).path;
    if (typeof pathValue === "string" && pathValue.trim() !== "") {
      return `[[${pathValue}]]`;
    }
  }

  // Coerce to string for non-date, non-link values
  const value = dc.coerce.string(rawValue);

  // Handle empty values (property exists but empty)
  if (!value || value.trim() === "") {
    const fallback = handleTimestampPropertyFallback(
      propertyName,
      settings,
      cardData,
    );
    if (fallback !== null) return fallback;

    // Return empty string for empty property (property exists but empty)
    // This distinguishes from null (missing property)
    return "";
  }

  return value;
}
