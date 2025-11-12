/**
 * Data transformation utilities
 * Converts various data sources (Datacore, Bases) into normalized CardData format
 */

import type { BasesEntry } from 'obsidian';
import type { CardData } from './card-renderer';
import type { Settings } from '../types';
import type { DatacoreAPI, DatacoreFile } from '../types/datacore';
import {
    getFirstDatacorePropertyValue,
    getFirstBasesPropertyValue
} from '../utils/property';
import { formatTimestamp, extractBasesTimestamp, extractDatacoreTimestamp } from './render-utils';

/**
 * Apply smart timestamp logic to properties
 * If sorting by created/modified time, automatically show that timestamp
 * (unless both are already shown)
 */
function applySmartTimestamp(
    props: string[],
    sortMethod: string,
    settings: Settings
): string[] {
    // console.log('// [Smart Timestamp] applySmartTimestamp called');
    // console.log('// [Smart Timestamp] Input props:', props);
    // console.log('// [Smart Timestamp] sortMethod:', sortMethod);
    // console.log('// [Smart Timestamp] settings.smartTimestamp:', settings.smartTimestamp);
    // console.log('// [Smart Timestamp] settings.createdTimeProperty:', settings.createdTimeProperty);
    // console.log('// [Smart Timestamp] settings.modifiedTimeProperty:', settings.modifiedTimeProperty);

    // Only apply if smart timestamp is enabled
    if (!settings.smartTimestamp) {
        // console.log('// [Smart Timestamp] Feature disabled, returning original props');
        return props;
    }

    // Determine which timestamp we're sorting by
    const sortingByCtime = sortMethod.includes('ctime');
    const sortingByMtime = sortMethod.includes('mtime');
    // console.log('// [Smart Timestamp] sortingByCtime:', sortingByCtime);
    // console.log('// [Smart Timestamp] sortingByMtime:', sortingByMtime);

    // Only proceed if sorting by a timestamp
    if (!sortingByCtime && !sortingByMtime) {
        // console.log('// [Smart Timestamp] Not sorting by timestamp, returning original props');
        return props;
    }

    // Check if both timestamps are already shown
    const hasCtimeProperty = props.some(p =>
        p === 'file.ctime' || p === 'created time' ||
        (settings.createdTimeProperty && p === settings.createdTimeProperty)
    );
    const hasMtimeProperty = props.some(p =>
        p === 'file.mtime' || p === 'modified time' ||
        (settings.modifiedTimeProperty && p === settings.modifiedTimeProperty)
    );
    // console.log('// [Smart Timestamp] hasCtimeProperty:', hasCtimeProperty);
    // console.log('// [Smart Timestamp] hasMtimeProperty:', hasMtimeProperty);

    // If both are shown, don't change anything
    if (hasCtimeProperty && hasMtimeProperty) {
        // console.log('// [Smart Timestamp] Both timestamps shown, returning original props');
        return props;
    }

    // Determine which timestamp property to show and which to replace
    const targetProperty = sortingByCtime
        ? (settings.createdTimeProperty || 'file.ctime')
        : (settings.modifiedTimeProperty || 'file.mtime');

    const propertiesToReplace = sortingByCtime
        ? ['file.mtime', 'modified time', settings.modifiedTimeProperty].filter(Boolean)
        : ['file.ctime', 'created time', settings.createdTimeProperty].filter(Boolean);

    // console.log('// [Smart Timestamp] targetProperty:', targetProperty);
    // console.log('// [Smart Timestamp] propertiesToReplace:', propertiesToReplace);

    // Replace mismatched timestamp properties
    const result = props.map(prop => {
        if (propertiesToReplace.includes(prop)) {
            // console.log(`// [Smart Timestamp] Replacing "${prop}" with "${targetProperty}"`);
            return targetProperty;
        }
        return prop;
    });

    // console.log('// [Smart Timestamp] Output props:', result);
    return result;
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
    snippet?: string,
    imageUrl?: string | string[],
    hasImageAvailable?: boolean
): CardData {
    // Get title from property (first available from comma-separated list) or fallback to filename
    let rawTitle = getFirstDatacorePropertyValue(result, settings.titleProperty);
    if (Array.isArray(rawTitle)) rawTitle = rawTitle[0];
    const title = dc.coerce.string(rawTitle || result.$name || '');

    // Get folder path (without filename)
    const path = result.$path || '';
    const folderPath = path.split('/').slice(0, -1).join('/');

    // Get tags
    const tags = result.$tags || [];

    // Get timestamps (convert Luxon DateTime to milliseconds)
    const ctime = result.$ctime?.toMillis?.() || 0;
    const mtime = result.$mtime?.toMillis?.() || 0;

    // Create base card data
    const cardData: CardData = {
        path,
        name: result.$name || '',
        title,
        tags,
        ctime,
        mtime,
        folderPath,
        snippet,
        imageUrl,
        hasImageAvailable: hasImageAvailable || false
    };

    // Resolve properties
    let props = [
        settings.propertyDisplay1,
        settings.propertyDisplay2,
        settings.propertyDisplay3,
        settings.propertyDisplay4
    ];

    // Apply smart timestamp logic
    props = applySmartTimestamp(props, sortMethod, settings);

    // Detect duplicates (priority: 1 > 2 > 3 > 4)
    const seen = new Set<string>();
    const effectiveProps = props.map(prop => {
        if (!prop || prop === '') return '';
        if (seen.has(prop)) return ''; // Duplicate, skip
        seen.add(prop);
        return prop;
    });

    // Store property names for rendering
    cardData.propertyName1 = effectiveProps[0] || undefined;
    cardData.propertyName2 = effectiveProps[1] || undefined;
    cardData.propertyName3 = effectiveProps[2] || undefined;
    cardData.propertyName4 = effectiveProps[3] || undefined;

    // Resolve property values
    cardData.property1 = effectiveProps[0] ? resolveDatacoreProperty(effectiveProps[0], result, cardData, settings, dc) : null;
    cardData.property2 = effectiveProps[1] ? resolveDatacoreProperty(effectiveProps[1], result, cardData, settings, dc) : null;
    cardData.property3 = effectiveProps[2] ? resolveDatacoreProperty(effectiveProps[2], result, cardData, settings, dc) : null;
    cardData.property4 = effectiveProps[3] ? resolveDatacoreProperty(effectiveProps[3], result, cardData, settings, dc) : null;

    return cardData;
}


/**
 * Transform Bases entry into CardData
 * Handles Bases-specific API (entry.getValue(), entry.file.path, etc.)
 */
export function basesEntryToCardData(
    entry: BasesEntry,
    settings: Settings,
    sortMethod: string,
    isShuffled: boolean,
    snippet?: string,
    imageUrl?: string | string[],
    hasImageAvailable?: boolean
): CardData {
    // Use file.basename directly (file name without extension)
    const fileName = entry.file.basename || entry.file.name;

    // Get title from property (first available from comma-separated list) or fallback to filename
    const titleValue = getFirstBasesPropertyValue(entry, settings.titleProperty) as { data?: unknown } | null;
    const titleData = titleValue?.data;
    const title = (titleData != null && titleData !== '' && (typeof titleData === 'string' || typeof titleData === 'number'))
        ? String(titleData)
        : fileName;

    // Get folder path (without filename)
    const path = entry.file.path;
    const folderPath = path.split('/').slice(0, -1).join('/');

    // Get tags from file.tags property (includes both YAML and inline body tags)
    const tagsValue = entry.getValue('file.tags') as { data?: unknown } | null;
    let tags: string[] = [];

    if (tagsValue && tagsValue.data != null) {
        const tagData = tagsValue.data;
        const rawTags = Array.isArray(tagData)
            ? tagData.map((t: unknown) => {
                // Handle Bases tag objects - extract the actual tag string
                if (t && typeof t === 'object' && 'data' in t) {
                    return String((t as { data: unknown }).data);
                }
                // Fallback to string/number conversion
                return (typeof t === 'string' || typeof t === 'number') ? String(t) : '';
            }).filter(t => t)
            : (typeof tagData === 'string' || typeof tagData === 'number') ? [String(tagData)] : [];

        // Strip leading # from tags if present
        tags = rawTags.map(tag => tag.replace(/^#/, ''));
    }

    // Get timestamps
    const ctime = entry.file.stat.ctime;
    const mtime = entry.file.stat.mtime;

    // Create base card data
    const cardData: CardData = {
        path,
        name: fileName,
        title,
        tags,
        ctime,
        mtime,
        folderPath,
        snippet,
        imageUrl,
        hasImageAvailable: hasImageAvailable || false
    };

    // Resolve properties
    let props = [
        settings.propertyDisplay1,
        settings.propertyDisplay2,
        settings.propertyDisplay3,
        settings.propertyDisplay4
    ];

    // Apply smart timestamp logic
    props = applySmartTimestamp(props, sortMethod, settings);

    // Detect duplicates (priority: 1 > 2 > 3 > 4)
    const seen = new Set<string>();
    const effectiveProps = props.map(prop => {
        if (!prop || prop === '') return '';
        if (seen.has(prop)) return ''; // Duplicate, skip
        seen.add(prop);
        return prop;
    });

    // Store property names for rendering
    cardData.propertyName1 = effectiveProps[0] || undefined;
    cardData.propertyName2 = effectiveProps[1] || undefined;
    cardData.propertyName3 = effectiveProps[2] || undefined;
    cardData.propertyName4 = effectiveProps[3] || undefined;

    // Resolve property values
    cardData.property1 = effectiveProps[0] ? resolveBasesProperty(effectiveProps[0], entry, cardData, settings) : null;
    cardData.property2 = effectiveProps[1] ? resolveBasesProperty(effectiveProps[1], entry, cardData, settings) : null;
    cardData.property3 = effectiveProps[2] ? resolveBasesProperty(effectiveProps[2], entry, cardData, settings) : null;
    cardData.property4 = effectiveProps[3] ? resolveBasesProperty(effectiveProps[3], entry, cardData, settings) : null;

    return cardData;
}

/**
 * Batch transform Datacore results to CardData array
 */
export function transformDatacoreResults(
    results: DatacoreFile[],
    dc: DatacoreAPI,
    settings: Settings,
    sortMethod: string,
    isShuffled: boolean,
    snippets: Record<string, string>,
    images: Record<string, string | string[]>,
    hasImageAvailable: Record<string, boolean>
): CardData[] {
    return results
        .filter(p => p.$path)
        .map(p => datacoreResultToCardData(
            p,
            dc,
            settings,
            sortMethod,
            isShuffled,
            snippets[p.$path],
            images[p.$path],
            hasImageAvailable[p.$path]
        ));
}

/**
 * Batch transform Bases entries to CardData array
 */
export function transformBasesEntries(
    entries: BasesEntry[],
    settings: Settings,
    sortMethod: string,
    isShuffled: boolean,
    snippets: Record<string, string>,
    images: Record<string, string | string[]>,
    hasImageAvailable: Record<string, boolean>
): CardData[] {
    return entries.map(entry => basesEntryToCardData(
        entry,
        settings,
        sortMethod,
        isShuffled,
        snippets[entry.file.path],
        images[entry.file.path],
        hasImageAvailable[entry.file.path]
    ));
}

/**
 * Resolve property value for Bases entry
 * Returns null for missing/empty properties
 */
export function resolveBasesProperty(
    propertyName: string,
    entry: BasesEntry,
    cardData: CardData,
    settings: Settings
): string | null {
    if (!propertyName || propertyName === '') {
        return null;
    }

    // Handle special properties (support both Bases and Datacore formats)
    // Bases format: file.path, file.tags, file.mtime, file.ctime
    // Datacore format: "file path", "file tags", "modified time", "created time"
    if (propertyName === 'file.path' || propertyName === 'file path') {
        const path = cardData.folderPath;
        if (!path || path === '') {
            return null;
        }
        return path;
    }

    if (propertyName === 'file.tags' || propertyName === 'file tags' || propertyName === 'tags') {
        const result = cardData.tags.length > 0 ? 'tags' : null;
        return result;
    }

    // Handle file timestamp properties directly
    if (propertyName === 'file.ctime' || propertyName === 'created time') {
        const formatted = formatTimestamp(cardData.ctime, settings);
        return formatted;
    }
    if (propertyName === 'file.mtime' || propertyName === 'modified time') {
        const formatted = formatTimestamp(cardData.mtime, settings);
        return formatted;
    }

    // Generic property: read from frontmatter
    const value = getFirstBasesPropertyValue(entry, propertyName);

    // Handle fallback for custom timestamp properties
    if (!value) {
        // Check if this is a custom timestamp property
        const isCustomCreatedTime = settings.createdTimeProperty && propertyName === settings.createdTimeProperty;
        const isCustomModifiedTime = settings.modifiedTimeProperty && propertyName === settings.modifiedTimeProperty;

        if (isCustomCreatedTime || isCustomModifiedTime) {
            if (settings.fallbackToFileMetadata) {
                // Fall back to file metadata
                const timestamp = isCustomCreatedTime ? cardData.ctime : cardData.mtime;
                return formatTimestamp(timestamp, settings);
            } else {
                // Show placeholder but still render as timestamp (for icon)
                return '...';
            }
        }
        return null;
    }

    // Check if it's a date/datetime value - format with custom format
    // Date properties return { date: Date, time: boolean } directly
    const timestampData = extractBasesTimestamp(value);
    if (timestampData) {
        const formatted = formatTimestamp(timestampData.timestamp, settings, timestampData.isDateOnly);
        return formatted;
    }

    // For non-date properties, extract .data
    const data = (value as { data?: unknown })?.data;

    // Handle empty values for custom timestamp properties
    if (data == null || data === '' || (Array.isArray(data) && data.length === 0)) {
        // Check if this is a custom timestamp property
        const isCustomCreatedTime = settings.createdTimeProperty && propertyName === settings.createdTimeProperty;
        const isCustomModifiedTime = settings.modifiedTimeProperty && propertyName === settings.modifiedTimeProperty;

        if (isCustomCreatedTime || isCustomModifiedTime) {
            if (settings.fallbackToFileMetadata) {
                // Fall back to file metadata
                const timestamp = isCustomCreatedTime ? cardData.ctime : cardData.mtime;
                return formatTimestamp(timestamp, settings);
            } else {
                // Show placeholder but still render as timestamp (for icon)
                return '...';
            }
        }
        return null;
    }

    // Convert to string
    if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
        const result = String(data);
        return result;
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
    dc: DatacoreAPI
): string | null {
    if (!propertyName || propertyName === '') return null;

    // Handle special properties (support both Bases and Datacore formats)
    // Bases format: file.path, file.tags, file.mtime, file.ctime
    // Datacore format: "file path", "file tags", "modified time", "created time"
    if (propertyName === 'file.path' || propertyName === 'file path') {
        // Extract folder path, trim after last /, return null if root
        const path = cardData.folderPath;
        if (!path || path === '') return null;
        return path;
    }

    if (propertyName === 'file.tags' || propertyName === 'file tags' || propertyName === 'tags') {
        // Tags are already resolved in cardData.tags
        return cardData.tags.length > 0 ? 'tags' : null; // Special marker
    }

    // Handle file timestamp properties directly
    if (propertyName === 'file.ctime' || propertyName === 'created time') {
        return formatTimestamp(cardData.ctime, settings);
    }
    if (propertyName === 'file.mtime' || propertyName === 'modified time') {
        return formatTimestamp(cardData.mtime, settings);
    }

    // Generic property: read from frontmatter
    let rawValue = getFirstDatacorePropertyValue(result, propertyName);
    if (Array.isArray(rawValue)) rawValue = rawValue[0];

    // Check if it's a date/datetime value - format with custom format
    const timestampData = extractDatacoreTimestamp(rawValue);
    if (timestampData) {
        return formatTimestamp(timestampData.timestamp, settings, timestampData.isDateOnly);
    }

    // Coerce to string for non-date values
    const value = dc.coerce.string(rawValue || '');

    // Handle empty values for custom timestamp properties
    if (!value || value === '') {
        // Check if this is a custom timestamp property
        const isCustomCreatedTime = settings.createdTimeProperty && propertyName === settings.createdTimeProperty;
        const isCustomModifiedTime = settings.modifiedTimeProperty && propertyName === settings.modifiedTimeProperty;

        if (isCustomCreatedTime || isCustomModifiedTime) {
            if (settings.fallbackToFileMetadata) {
                // Fall back to file metadata
                const timestamp = isCustomCreatedTime ? cardData.ctime : cardData.mtime;
                return formatTimestamp(timestamp, settings);
            } else {
                // Show placeholder but still render as timestamp (for icon)
                return '...';
            }
        }
        return null;
    }

    return value;
}
