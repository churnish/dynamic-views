/**
 * Shared rendering utilities
 * Pure functions used by both Bases (DOM) and Datacore (JSX) views
 */

import type { Settings } from '../types';

/**
 * Interface for date values from Datacore/Bases
 * These external APIs return objects with a date property
 */
interface DateValue {
    date: Date;
}

/**
 * Format timestamp with automatic date/datetime detection
 * Shows time only if within last 24 hours, otherwise just date
 */
export function formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    const now = Date.now();
    const isRecent = now - timestamp < 86400000;

    if (isRecent) {
        const HH = String(date.getHours()).padStart(2, '0');
        const mm = String(date.getMinutes()).padStart(2, '0');
        return `${HH}:${mm}`;
    }

    const yyyy = date.getFullYear();
    const MM = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${MM}-${dd}`;
}

/**
 * Determine effective metadata display values
 * TODO Phase 4: Update to return all 4 fields with proper layout flags
 */
export function getEffectiveMetadata(settings: Settings): {
    left: string;
    right: string;
} {
    // Temporary stub: map new fields to old two-field system
    const left = settings.metadataDisplay1;
    const right = settings.metadataDisplay3;

    // Detect duplicates (field 1 takes priority)
    const isDuplicate = left !== '' && left === right;

    return {
        left,
        right: isDuplicate ? '' : right
    };
}

/**
 * Check if timestamp icon should be shown
 */
export function shouldShowTimestampIcon(settings: Settings): boolean {
    // Import at runtime to avoid circular dependencies
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
    const { showTimestampIcon } = require('../utils/style-settings');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return showTimestampIcon();
}

/**
 * Get timestamp icon name based on sort method
 */
export function getTimestampIcon(sortMethod: string): 'calendar' | 'clock' {
    return sortMethod.startsWith('ctime') ? 'calendar' : 'clock';
}

/**
 * Check if a value is a valid Datacore date value
 */
export function isDatacoreDateValue(value: unknown): value is DateValue {
    return value !== null && typeof value === 'object' && 'date' in value && value.date instanceof Date;
}

/**
 * Extract timestamp from Datacore date value
 */
export function extractDatacoreTimestamp(value: unknown): number | null {
    if (isDatacoreDateValue(value)) {
        return value.date.getTime();
    }
    return null;
}

/**
 * Check if a value is a valid Bases date value
 */
export function isBasesDateValue(value: unknown): value is DateValue {
    return value !== null && typeof value === 'object' && 'date' in value && value.date instanceof Date;
}

/**
 * Extract timestamp from Bases date value
 */
export function extractBasesTimestamp(value: unknown): number | null {
    if (isBasesDateValue(value)) {
        return value.date.getTime();
    }
    return null;
}
