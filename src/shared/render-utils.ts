/**
 * Shared rendering utilities
 * Pure functions used by both Bases (DOM) and Datacore (JSX) views
 */

import type { Settings } from "../types";

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
 * Format timestamp using moment.js with formats from Style Settings
 */
export function formatTimestamp(
  timestamp: number,
  isDateOnly: boolean = false,
  styled: boolean = false,
): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment -- Dynamic require for moment.js dependency
  const moment = require("moment");
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Dynamic require to avoid circular dependency
  const styleSettings = require("../utils/style-settings") as {
    shouldShowRecentTimeOnly(): boolean;
    shouldShowOlderDateOnly(): boolean;
    getDatetimeFormat(): string;
    getDateFormat(): string;
    getTimeFormat(): string;
  };

  // For date-only properties, show date only
  if (isDateOnly) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- moment.js untyped API
    return moment(timestamp).format(styleSettings.getDateFormat()) as string;
  }

  // For styled property display, apply Style Settings toggles
  if (styled) {
    const timestampDate = new Date(timestamp);
    const todayDate = new Date();
    const isToday =
      timestampDate.getFullYear() === todayDate.getFullYear() &&
      timestampDate.getMonth() === todayDate.getMonth() &&
      timestampDate.getDate() === todayDate.getDate();

    if (isToday && styleSettings.shouldShowRecentTimeOnly()) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- moment.js untyped API
      return moment(timestamp).format(styleSettings.getTimeFormat()) as string;
    }
    const isFuture = timestamp > Date.now();
    if (!isToday && !isFuture && styleSettings.shouldShowOlderDateOnly()) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- moment.js untyped API
      return moment(timestamp).format(styleSettings.getDateFormat()) as string;
    }
  }

  // Full datetime
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- moment.js untyped API
  return moment(timestamp).format(styleSettings.getDatetimeFormat()) as string;
}

/**
 * Check if timestamp icon should be shown
 */
export function shouldShowTimestampIcon(): boolean {
  // Import at runtime to avoid circular dependencies
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Dynamic require to avoid circular dependency
  const styleSettings = require("../utils/style-settings") as {
    showTimestampIcon(): boolean;
  };
  return styleSettings.showTimestampIcon();
}

/**
 * Get timestamp icon name based on property being displayed
 */
export function getTimestampIcon(
  propertyName: string,
  settings: Settings,
): "calendar" | "clock" {
  // Check if property is created time (calendar icon)
  if (
    propertyName === "file.ctime" ||
    propertyName === "created time" ||
    (settings.createdTimeProperty &&
      propertyName === settings.createdTimeProperty)
  ) {
    return "calendar";
  }

  // Otherwise it's modified time (clock icon)
  return "clock";
}

/**
 * Check if a value is a valid date value (works for both Bases and Datacore)
 * Must have 'time' property to distinguish from text properties that might contain date-like strings
 */
export function isDateValue(value: unknown): value is DateValue {
  return (
    value !== null &&
    typeof value === "object" &&
    "date" in value &&
    value.date instanceof Date &&
    !isNaN(value.date.getTime()) &&
    "time" in value &&
    typeof (value as DateValue).time === "boolean"
  );
}

/**
 * Extract timestamp from date value (works for both Bases and Datacore)
 */
export function extractTimestamp(
  value: unknown,
): { timestamp: number; isDateOnly: boolean } | null {
  if (isDateValue(value)) {
    return {
      timestamp: value.date.getTime(),
      isDateOnly: value.time === false,
    };
  }
  return null;
}
