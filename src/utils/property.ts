/**
 * Property utility functions for handling comma-separated properties
 */

import type { BasesEntry } from 'obsidian';
import type { DatacoreFile, DatacoreDate } from '../types/datacore';

/**
 * Get first non-empty property value from comma-separated list (Bases)
 * Accepts any property type (text, number, checkbox, date, datetime, list)
 */
export function getFirstBasesPropertyValue(entry: BasesEntry, propertyString: string): unknown {
    if (!propertyString || !propertyString.trim()) return null;

    const properties = propertyString.split(',').map(p => p.trim()).filter(p => p);

    for (const prop of properties) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any -- Bases API lacks proper TypeScript types for getValue
        const value = entry.getValue(prop as any);

        // Check if property exists and has a value
        const propertyExists = value && (
            ('date' in value && value.date instanceof Date) ||
            ('data' in value)
        );

        if (propertyExists) {
            return value;
        }
    }

    return null;
}

/**
 * Get first non-empty property value from comma-separated list (Datacore)
 * Accepts any property type (text, number, checkbox, date, datetime, list)
 */
export function getFirstDatacorePropertyValue(page: DatacoreFile, propertyString: string): unknown {
    if (!propertyString || !propertyString.trim()) return null;

    const properties = propertyString.split(',').map(p => p.trim()).filter(p => p);

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
export function getFirstBasesDatePropertyValue(entry: BasesEntry, propertyString: string): unknown {
    if (!propertyString || !propertyString.trim()) return null;

    const properties = propertyString.split(',').map(p => p.trim()).filter(p => p);

    for (const prop of properties) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any -- Bases API lacks proper TypeScript types for getValue
        const value = entry.getValue(prop as any);

        // Only accept date/datetime values
        if (value && 'date' in value && value.date instanceof Date) {
            return value;
        }
        // Skip properties with wrong type
    }

    return null;
}

/**
 * Get first valid date/datetime property value from comma-separated list (Datacore)
 * Only accepts DateTime objects with toMillis() method
 */
export function getFirstDatacoreDatePropertyValue(page: DatacoreFile, propertyString: string): DatacoreDate | null {
    if (!propertyString || !propertyString.trim()) return null;

    const properties = propertyString.split(',').map(p => p.trim()).filter(p => p);

    for (const prop of properties) {
        const value: unknown = page.value(prop);

        // Only accept DateTime objects (have toMillis method)
        if (value && typeof value === 'object' && 'toMillis' in value) {
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
export function getAllBasesImagePropertyValues(entry: BasesEntry, propertyString: string): string[] {
    if (!propertyString || !propertyString.trim()) return [];

    const properties = propertyString.split(',').map(p => p.trim()).filter(p => p);
    const allImages: string[] = [];

    for (const prop of properties) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any -- Bases API lacks proper TypeScript types for getValue
        const value = entry.getValue(prop as any);

        // Skip if property doesn't exist or is not text/list type
        if (!value || !('data' in value)) continue;

        // Handle the value
        const data = value.data;

        if (Array.isArray(data)) {
            // List property - collect all values
            for (const item of data) {
                if (typeof item === 'string' || typeof item === 'number') {
                    const str = String(item);
                    if (str && str.trim()) {
                        allImages.push(str);
                    }
                }
            }
        } else if (data != null && data !== '') {
            // Text property - single value
            if (typeof data === 'string' || typeof data === 'number') {
                const str = String(data);
                if (str.trim()) {
                    allImages.push(str);
                }
            }
        }
    }

    return allImages;
}

/**
 * Get ALL image values from ALL comma-separated properties (Datacore)
 * Only accepts text and list property types containing image paths/URLs
 * Returns array of all image paths/URLs found across all properties
 */
export function getAllDatacoreImagePropertyValues(page: DatacoreFile, propertyString: string): string[] {
    if (!propertyString || !propertyString.trim()) return [];

    const properties = propertyString.split(',').map(p => p.trim()).filter(p => p);
    const allImages: string[] = [];

    for (const prop of properties) {
        const value: unknown = page.value(prop);

        // Skip if property doesn't exist
        if (value === null || value === undefined) continue;

        if (Array.isArray(value)) {
            // List property - collect all values
            for (const item of value) {
                // Handle Link objects with path property
                if (typeof item === 'object' && item !== null && 'path' in item) {
                    const pathValue = (item as { path: unknown }).path;
                    if (typeof pathValue === 'string' || typeof pathValue === 'number') {
                        const str = String(pathValue).trim();
                        if (str) allImages.push(str);
                    }
                } else if (typeof item === 'string' || typeof item === 'number') {
                    const str = String(item).trim();
                    if (str) allImages.push(str);
                }
            }
        } else {
            // Single value
            // Handle Link objects with path property
            if (typeof value === 'object' && value !== null && 'path' in value) {
                const pathValue = (value as { path: unknown }).path;
                if (typeof pathValue === 'string' || typeof pathValue === 'number') {
                    const str = String(pathValue).trim();
                    if (str) allImages.push(str);
                }
            } else if (typeof value === 'string' || typeof value === 'number') {
                const str = String(value).trim();
                if (str) allImages.push(str);
            }
        }
    }

    return allImages;
}
