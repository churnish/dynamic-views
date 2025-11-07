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
    getFirstBasesPropertyValue,
    getFirstDatacoreDatePropertyValue,
    getFirstBasesDatePropertyValue
} from '../utils/property';
import { isBasesDateValue, formatTimestamp } from './render-utils';

/**
 * Resolve timestamp for Datacore result based on settings and sort method
 */
function resolveDatacoreTimestamp(
    result: DatacoreFile,
    settings: Settings,
    sortMethod: string,
    isShuffled: boolean
): number | null {
    const useCreatedTime = sortMethod.startsWith('ctime') && !isShuffled;
    const customProperty = useCreatedTime ? settings.createdProperty : settings.modifiedProperty;
    const fallbackEnabled = useCreatedTime ? settings.fallbackToCtime : settings.fallbackToMtime;

    if (customProperty) {
        // Try to get first valid date from comma-separated properties
        const propValue = getFirstDatacoreDatePropertyValue(result, customProperty);

        if (propValue && typeof propValue === 'object' && 'toMillis' in propValue) {
            // Found valid date property
            return propValue.toMillis();
        } else if (fallbackEnabled) {
            // No valid property date found - fall back to file metadata if enabled
            const fileTimestamp = useCreatedTime ? result.$ctime : result.$mtime;
            return fileTimestamp?.toMillis?.() || null;
        }
        // If no valid property and fallback disabled, return null
        return null;
    } else if (fallbackEnabled) {
        // No custom property configured - use file metadata if fallback enabled
        const fileTimestamp = useCreatedTime ? result.$ctime : result.$mtime;
        return fileTimestamp?.toMillis?.() || null;
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

    // Resolve display timestamp based on custom properties
    const displayTimestamp = resolveDatacoreTimestamp(result, settings, sortMethod, isShuffled);

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
        hasImageAvailable: hasImageAvailable || false,
        displayTimestamp: displayTimestamp || undefined
    };

    // Resolve metadata properties
    const props = [
        settings.metadataDisplay1,
        settings.metadataDisplay2,
        settings.metadataDisplay3,
        settings.metadataDisplay4
    ];

    // Detect duplicates (priority: 1 > 2 > 3 > 4)
    const seen = new Set<string>();
    const effectiveProps = props.map(prop => {
        if (!prop || prop === '') return '';
        if (seen.has(prop)) return ''; // Duplicate, skip
        seen.add(prop);
        return prop;
    });

    // Store property names for rendering
    cardData.metadataProperty1 = effectiveProps[0] || undefined;
    cardData.metadataProperty2 = effectiveProps[1] || undefined;
    cardData.metadataProperty3 = effectiveProps[2] || undefined;
    cardData.metadataProperty4 = effectiveProps[3] || undefined;

    // Resolve property values
    cardData.metadata1 = effectiveProps[0] ? resolveDatacoreMetadataProperty(effectiveProps[0], result, cardData, settings, dc) : null;
    cardData.metadata2 = effectiveProps[1] ? resolveDatacoreMetadataProperty(effectiveProps[1], result, cardData, settings, dc) : null;
    cardData.metadata3 = effectiveProps[2] ? resolveDatacoreMetadataProperty(effectiveProps[2], result, cardData, settings, dc) : null;
    cardData.metadata4 = effectiveProps[3] ? resolveDatacoreMetadataProperty(effectiveProps[3], result, cardData, settings, dc) : null;

    return cardData;
}

/**
 * Resolve timestamp for Bases entry based on settings and sort method
 */
function resolveBasesTimestamp(
    entry: BasesEntry,
    settings: Settings,
    sortMethod: string,
    isShuffled: boolean
): number | null {
    const useCreatedTime = sortMethod.startsWith('ctime') && !isShuffled;
    const customProperty = useCreatedTime ? settings.createdProperty : settings.modifiedProperty;
    const fallbackEnabled = useCreatedTime ? settings.fallbackToCtime : settings.fallbackToMtime;

    if (customProperty) {
        // Try to get first valid date from comma-separated properties
        const value = getFirstBasesDatePropertyValue(entry, customProperty) as { date?: Date } | null;

        if (value && isBasesDateValue(value)) {
            // Found valid date property
            return value.date.getTime();
        } else if (fallbackEnabled) {
            // No valid property date found - fall back to file metadata if enabled
            return useCreatedTime ? entry.file.stat.ctime : entry.file.stat.mtime;
        }
        // If no valid property and fallback disabled, return null
        return null;
    } else if (fallbackEnabled) {
        // No custom property configured - use file metadata if fallback enabled
        return useCreatedTime ? entry.file.stat.ctime : entry.file.stat.mtime;
    }

    return null;
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

    // Resolve display timestamp based on custom properties
    const displayTimestamp = resolveBasesTimestamp(entry, settings, sortMethod, isShuffled);

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
        hasImageAvailable: hasImageAvailable || false,
        displayTimestamp: displayTimestamp || undefined
    };

    // Resolve metadata properties
    const props = [
        settings.metadataDisplay1,
        settings.metadataDisplay2,
        settings.metadataDisplay3,
        settings.metadataDisplay4
    ];

    // Detect duplicates (priority: 1 > 2 > 3 > 4)
    const seen = new Set<string>();
    const effectiveProps = props.map(prop => {
        if (!prop || prop === '') return '';
        if (seen.has(prop)) return ''; // Duplicate, skip
        seen.add(prop);
        return prop;
    });

    // Store property names for rendering
    cardData.metadataProperty1 = effectiveProps[0] || undefined;
    cardData.metadataProperty2 = effectiveProps[1] || undefined;
    cardData.metadataProperty3 = effectiveProps[2] || undefined;
    cardData.metadataProperty4 = effectiveProps[3] || undefined;

    // Resolve property values
    cardData.metadata1 = effectiveProps[0] ? resolveBasesMetadataProperty(effectiveProps[0], entry, cardData, settings) : null;
    cardData.metadata2 = effectiveProps[1] ? resolveBasesMetadataProperty(effectiveProps[1], entry, cardData, settings) : null;
    cardData.metadata3 = effectiveProps[2] ? resolveBasesMetadataProperty(effectiveProps[2], entry, cardData, settings) : null;
    cardData.metadata4 = effectiveProps[3] ? resolveBasesMetadataProperty(effectiveProps[3], entry, cardData, settings) : null;

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
 * Resolve metadata property value for Bases entry
 * Returns null for missing/empty properties
 */
export function resolveBasesMetadataProperty(
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

    // Check if property is a timestamp property
    const isCreatedTimestamp = propertyName === 'file.ctime' || propertyName === 'created time' ||
        settings.createdProperty.split(',').map(p => p.trim()).includes(propertyName);
    const isModifiedTimestamp = propertyName === 'file.mtime' || propertyName === 'modified time' ||
        settings.modifiedProperty.split(',').map(p => p.trim()).includes(propertyName);

    if (isCreatedTimestamp || isModifiedTimestamp) {
        const timestamp = cardData.displayTimestamp ||
            (isCreatedTimestamp ? cardData.ctime : cardData.mtime);

        if (!timestamp) {
            return null;
        }
        const formatted = formatTimestamp(timestamp);
        return formatted;
    }

    // Generic property: read from frontmatter
    const value = getFirstBasesPropertyValue(entry, propertyName) as { data?: unknown } | null;
    const data = value?.data;

    // Return null for missing or empty values
    if (data == null || data === '' || (Array.isArray(data) && data.length === 0)) {
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
 * Resolve metadata property value for Datacore file
 * Returns null for missing/empty properties
 */
export function resolveDatacoreMetadataProperty(
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

    // Check if property is a timestamp property
    const isCreatedTimestamp = propertyName === 'file.ctime' || propertyName === 'created time' ||
        settings.createdProperty.split(',').map(p => p.trim()).includes(propertyName);
    const isModifiedTimestamp = propertyName === 'file.mtime' || propertyName === 'modified time' ||
        settings.modifiedProperty.split(',').map(p => p.trim()).includes(propertyName);

    if (isCreatedTimestamp || isModifiedTimestamp) {
        // Use displayTimestamp if available, otherwise fall back to file timestamps
        const timestamp = cardData.displayTimestamp ||
            (isCreatedTimestamp ? cardData.ctime : cardData.mtime);

        if (!timestamp) return null;
        return formatTimestamp(timestamp);
    }

    // Generic property: read from frontmatter
    let rawValue = getFirstDatacorePropertyValue(result, propertyName);
    if (Array.isArray(rawValue)) rawValue = rawValue[0];
    const value = dc.coerce.string(rawValue || '');

    // Return null for empty values
    if (!value || value === '') return null;

    return value;
}
