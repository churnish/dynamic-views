/**
 * Shared rendering utilities
 * Pure functions used by both Bases (DOM) and Datacore (JSX) views
 */

import type { ResolvedSettings } from "../types";

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

  // For date-only properties, use date format
  if (isDateOnly) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- moment.js untyped API
    return moment(timestamp).format(styleSettings.getDateFormat()) as string;
  }

  // For non-styled properties, use full datetime format
  if (!styled) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- moment.js untyped API
    return moment(timestamp).format(
      styleSettings.getDatetimeFormat(),
    ) as string;
  }

  // Determine whether to show time-only or date-only format
  // Each timestamp evaluated independently based on its own date
  const isToday = isTimestampToday(timestamp);
  const isFuture = timestamp > Date.now();
  const showTimeOnly = isToday && styleSettings.shouldShowRecentTimeOnly();
  const showDateOnly =
    !isToday && !isFuture && styleSettings.shouldShowOlderDateOnly();

  if (showTimeOnly) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- moment.js untyped API
    return moment(timestamp).format(styleSettings.getTimeFormat()) as string;
  }
  if (showDateOnly) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- moment.js untyped API
    return moment(timestamp).format(styleSettings.getDateFormat()) as string;
  }

  // Full datetime for styled
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
  settings: ResolvedSettings,
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
 * Check if a value is a Bases date value ({date: Date, time: boolean})
 */
export function isBasesDateValue(value: unknown): value is DateValue {
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
    typeof value === "object" &&
    "toMillis" in value &&
    typeof (value as LuxonDateTime).toMillis === "function" &&
    "hour" in value &&
    typeof (value as LuxonDateTime).hour === "number"
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
  value: unknown,
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
