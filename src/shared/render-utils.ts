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
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
  const moment = require("moment");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const styleSettings = require("../utils/style-settings") as {
    shouldShowRecentTimeOnly(): boolean;
    shouldShowOlderDateOnly(): boolean;
    getDatetimeFormat(): string;
    getDateFormat(): string;
    getTimeFormat(): string;
  };

  // For date-only properties, show date only
  if (isDateOnly) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
    return moment(timestamp).format(styleSettings.getDateFormat());
  }

  // For styled property display, apply Style Settings toggles
  if (styled) {
    const now = Date.now();
    const isRecent = now - timestamp < 86400000;

    if (isRecent && styleSettings.shouldShowRecentTimeOnly()) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
      return moment(timestamp).format(styleSettings.getTimeFormat());
    }
    if (!isRecent && styleSettings.shouldShowOlderDateOnly()) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
      return moment(timestamp).format(styleSettings.getDateFormat());
    }
  }

  // Full datetime
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
  return moment(timestamp).format(styleSettings.getDatetimeFormat());
}

/**
 * Check if timestamp icon should be shown
 */
export function shouldShowTimestampIcon(): boolean {
  // Import at runtime to avoid circular dependencies
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
  const { showTimestampIcon } = require("../utils/style-settings");
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
  return showTimestampIcon();
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
