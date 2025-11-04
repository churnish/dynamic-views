/**
 * Data transformation utilities
 * Converts various data sources (Datacore, Bases) into normalized CardData format
 */

import type { CardData } from './card-renderer';
import type { Settings } from '../types';

/**
 * Transform Datacore result into CardData
 * Handles Datacore-specific API (p.value(), p.$path, etc.)
 */
export function datacoreResultToCardData(
    result: any,
    dc: any,
    settings: Settings,
    snippet?: string,
    imageUrl?: string | string[],
    hasImageAvailable?: boolean
): CardData {
    // Get title from property or fallback to filename
    let rawTitle = result.value(settings.titleProperty);
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

    return {
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
}

/**
 * Transform Bases entry into CardData
 * Handles Bases-specific API (entry.getValue(), entry.file.path, etc.)
 */
export function basesEntryToCardData(
    entry: any, // BasesEntry type
    settings: Settings,
    snippet?: string,
    imageUrl?: string | string[],
    hasImageAvailable?: boolean
): CardData {
    // Use file.basename directly (file name without extension)
    const fileName = entry.file.basename || entry.file.name;

    // Get title from property or fallback to filename
    // getValue returns an object with 'data' property when value exists
    const titleValue = entry.getValue(settings.titleProperty);
    const title = (titleValue && titleValue.data != null && titleValue.data !== '')
        ? String(titleValue.data)
        : fileName;

    // Get folder path (without filename)
    const path = entry.file.path;
    const folderPath = path.split('/').slice(0, -1).join('/');

    // Get tags from file.tags property (includes both YAML and inline body tags)
    const tagsValue = entry.getValue('file.tags');
    let tags: string[] = [];

    if (tagsValue && tagsValue.data != null) {
        const tagData = tagsValue.data;
        const rawTags = Array.isArray(tagData)
            ? tagData.map((t: any) => String(t))
            : [String(tagData)];

        // Strip leading # from tags if present
        tags = rawTags.map(tag => tag.replace(/^#/, ''));
    }

    // Get timestamps
    const ctime = entry.file.stat.ctime;
    const mtime = entry.file.stat.mtime;

    return {
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
}

/**
 * Batch transform Datacore results to CardData array
 */
export function transformDatacoreResults(
    results: any[],
    dc: any,
    settings: Settings,
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
            snippets[p.$path],
            images[p.$path],
            hasImageAvailable[p.$path]
        ));
}

/**
 * Batch transform Bases entries to CardData array
 */
export function transformBasesEntries(
    entries: any[], // BasesEntry[]
    settings: Settings,
    snippets: Record<string, string>,
    images: Record<string, string | string[]>,
    hasImageAvailable: Record<string, boolean>
): CardData[] {
    return entries.map(entry => basesEntryToCardData(
        entry,
        settings,
        snippets[entry.file.path],
        images[entry.file.path],
        hasImageAvailable[entry.file.path]
    ));
}
