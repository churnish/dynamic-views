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
    time?: boolean;  // true for datetime, false for date-only
    icon?: string;   // 'lucide-clock' for datetime, 'lucide-calendar' for date
}

/**
 * Format timestamp using moment.js format from settings
 * Falls back to automatic date/datetime detection with Style Settings toggles
 */
export function formatTimestamp(timestamp: number, settings: Settings, isDateOnly: boolean = false): string {
    const date = new Date(timestamp);

    // Use custom format from settings (overrides all auto-detection)
    if (settings.timestampFormat && settings.timestampFormat.trim()) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
        const moment = require('moment');
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
        return moment(timestamp).format(settings.timestampFormat);
    }

    // Format components
    const yyyy = date.getFullYear();
    const MM = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const HH = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');

    // For date-only properties, show date only
    if (isDateOnly) {
        return `${yyyy}-${MM}-${dd}`;
    }

    // For datetime properties, apply Style Settings toggles
    // Import at runtime to avoid circular dependencies
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
    const { shouldShowRecentTimeOnly, shouldShowOlderDateOnly } = require('../utils/style-settings');

    const now = Date.now();
    const isRecent = now - timestamp < 86400000;

    if (isRecent) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        if (shouldShowRecentTimeOnly()) {
            return `${HH}:${mm}`;
        }
        return `${yyyy}-${MM}-${dd} ${HH}:${mm}`;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    if (shouldShowOlderDateOnly()) {
        return `${yyyy}-${MM}-${dd}`;
    }
    return `${yyyy}-${MM}-${dd} ${HH}:${mm}`;
}

/**
 * Check if timestamp icon should be shown
 */
export function shouldShowTimestampIcon(): boolean {
    // Import at runtime to avoid circular dependencies
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
    const { showTimestampIcon } = require('../utils/style-settings');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return showTimestampIcon();
}

/**
 * Get timestamp icon name based on property being displayed
 */
export function getTimestampIcon(propertyName: string, settings: Settings): 'calendar' | 'clock' {
    // Check if property is created time (calendar icon)
    if (propertyName === 'file.ctime' || propertyName === 'created time' ||
        (settings.createdTimeProperty && propertyName === settings.createdTimeProperty)) {
        return 'calendar';
    }

    // Otherwise it's modified time (clock icon)
    return 'clock';
}

/**
 * Check if a value is a valid Datacore date value
 * Must have 'time' property to distinguish from text properties that might contain date-like strings
 */
export function isDatacoreDateValue(value: unknown): value is DateValue {
    return value !== null &&
           typeof value === 'object' &&
           'date' in value &&
           value.date instanceof Date &&
           'time' in value &&
           typeof (value as DateValue).time === 'boolean';
}

/**
 * Extract timestamp from Datacore date value
 */
export function extractDatacoreTimestamp(value: unknown): { timestamp: number; isDateOnly: boolean } | null {
    if (isDatacoreDateValue(value)) {
        return {
            timestamp: value.date.getTime(),
            isDateOnly: value.time === false
        };
    }
    return null;
}

/**
 * Check if a value is a valid Bases date value
 * Must have 'time' property to distinguish from text properties that might contain date-like strings
 */
export function isBasesDateValue(value: unknown): value is DateValue {
    return value !== null &&
           typeof value === 'object' &&
           'date' in value &&
           value.date instanceof Date &&
           'time' in value &&
           typeof (value as DateValue).time === 'boolean';
}

/**
 * Extract timestamp from Bases date value
 */
export function extractBasesTimestamp(value: unknown): { timestamp: number; isDateOnly: boolean } | null {
    if (isBasesDateValue(value)) {
        return {
            timestamp: value.date.getTime(),
            isDateOnly: value.time === false
        };
    }
    return null;
}
