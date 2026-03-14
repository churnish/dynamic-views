/**
 * Shared rendering utilities
 * Pure functions used by both Bases (DOM) and Datacore (JSX) views
 */

import type { App } from 'obsidian';
import { moment } from 'obsidian';
import type { BasesResolvedSettings } from '../types';
import { isSameProperty } from '../utils/property';
import {
  shouldShowRecentTimeOnly,
  shouldShowOlderDateOnly,
  getDatetimeFormat,
  getDateFormat,
  getTimeFormat,
  showTimestampIcon,
} from '../utils/style-settings';

/**
 * Interface for date values from Datacore/Bases
 * These external APIs return objects with a date property
 */
interface DateValue {
  date: Date;
  time?: boolean; // true for datetime, false for date-only
  icon?: string; // 'lucide-clock' for datetime, 'lucide-calendar' for date
}

/**
 * Check if a timestamp is from today
 */
export function isTimestampToday(timestamp: number): boolean {
  const timestampDate = new Date(timestamp);
  const todayDate = new Date();
  return (
    timestampDate.getFullYear() === todayDate.getFullYear() &&
    timestampDate.getMonth() === todayDate.getMonth() &&
    timestampDate.getDate() === todayDate.getDate()
  );
}

/**
 * Format timestamp using moment.js with formats from Style Settings
 * @param timestamp - The timestamp to format
 * @param isDateOnly - If true, always use date-only format (for date-type properties)
 * @param styled - If true, apply recent/older abbreviation rules
 */
export function formatTimestamp(
  timestamp: number,
  isDateOnly: boolean = false,
  styled: boolean = false
): string {
  // For date-only properties, use date format
  if (isDateOnly) {
    return moment(timestamp).format(getDateFormat());
  }

  // For non-styled properties, use full datetime format
  if (!styled) {
    return moment(timestamp).format(getDatetimeFormat());
  }

  // Determine whether to show time-only or date-only format
  // Each timestamp evaluated independently based on its own date
  const isToday = isTimestampToday(timestamp);
  const isFuture = timestamp > Date.now();
  const showTimeOnly = isToday && shouldShowRecentTimeOnly();
  const showDateOnly = !isToday && !isFuture && shouldShowOlderDateOnly();

  if (showTimeOnly) {
    return moment(timestamp).format(getTimeFormat());
  }
  if (showDateOnly) {
    return moment(timestamp).format(getDateFormat());
  }

  // Full datetime for styled
  return moment(timestamp).format(getDatetimeFormat());
}

/**
 * Check if timestamp icon should be shown
 */
export function shouldShowTimestampIcon(): boolean {
  return showTimestampIcon();
}

/**
 * Get timestamp icon name based on property being displayed
 */
export function getTimestampIcon(
  propertyName: string,
  settings: BasesResolvedSettings
): 'calendar' | 'clock' {
  if (
    propertyName === 'file.ctime' ||
    propertyName === 'created time' ||
    (settings.createdTimeProperty &&
      isSameProperty(propertyName, settings.createdTimeProperty))
  ) {
    return 'calendar';
  }

  return 'clock';
}

/**
 * Check if a property is a known or configured timestamp property
 * Returns true for hardcoded file timestamps regardless of settings,
 * and for custom smart timestamp properties when smartTimestamp is ON
 */
export function isTimestampProperty(
  propertyName: string,
  settings: BasesResolvedSettings
): boolean {
  if (
    propertyName === 'file.mtime' ||
    propertyName === 'file.ctime' ||
    propertyName === 'modified time' ||
    propertyName === 'created time'
  ) {
    return true;
  }
  if (!settings.smartTimestamp) return false;
  return (
    isSameProperty(propertyName, settings.createdTimeProperty) ||
    isSameProperty(propertyName, settings.modifiedTimeProperty)
  );
}

/**
 * Check if a value is a Bases date value ({date: Date, time: boolean})
 */
export function isBasesDateValue(value: unknown): value is DateValue {
  return (
    value !== null &&
    typeof value === 'object' &&
    'date' in value &&
    value.date instanceof Date &&
    !isNaN(value.date.getTime()) &&
    'time' in value &&
    typeof (value as DateValue).time === 'boolean'
  );
}

/**
 * Luxon DateTime interface (subset used by Datacore)
 * @see https://moment.github.io/luxon/api-docs/index.html#datetime
 */
interface LuxonDateTime {
  toMillis(): number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

/**
 * Check if a value is a Luxon DateTime (Datacore format)
 */
export function isLuxonDateTime(value: unknown): value is LuxonDateTime {
  return (
    value !== null &&
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof (value as LuxonDateTime).toMillis === 'function' &&
    'hour' in value &&
    typeof (value as LuxonDateTime).hour === 'number'
  );
}

/**
 * Check if a value is a valid date value (works for both Bases and Datacore)
 * @deprecated Use isBasesDateValue or isLuxonDateTime directly
 */
export function isDateValue(value: unknown): value is DateValue {
  return isBasesDateValue(value);
}

/**
 * Extract timestamp from date value (works for both Bases and Datacore)
 */
export function extractTimestamp(
  value: unknown
): { timestamp: number; isDateOnly: boolean } | null {
  // Bases format: {date: Date, time: boolean}
  if (isBasesDateValue(value)) {
    return {
      timestamp: value.date.getTime(),
      isDateOnly: value.time === false,
    };
  }

  // Datacore format: Luxon DateTime
  // @see https://moment.github.io/luxon/api-docs/index.html#datetime
  if (isLuxonDateTime(value)) {
    const isDateOnly =
      value.hour === 0 &&
      value.minute === 0 &&
      value.second === 0 &&
      value.millisecond === 0;
    return {
      timestamp: value.toMillis(),
      isDateOnly,
    };
  }

  return null;
}

/** Factory for tag drag handlers — used by both Bases and Datacore tag rendering. */
export function createTagDragHandler(
  app: App,
  tag: string
): (e: DragEvent) => void {
  return (e) => {
    e.stopPropagation();
    e.dataTransfer?.clearData();
    e.dataTransfer?.setData('text/plain', '#' + tag);
    app.dragManager.onDragStart(e, {
      type: 'text',
      title: tag,
      icon: 'hashtag',
    });
    // Clear draggable so editor's dragover accepts the drop via its else-path
    (app.dragManager as Record<string, unknown>).draggable = null;
  };
}
