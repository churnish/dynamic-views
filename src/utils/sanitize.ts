/**
 * Remove control characters that can corrupt localStorage
 * @param value - String value to sanitize
 * @returns Sanitized string with control characters removed
 */
export function sanitizeString(value: string): string {
  if (typeof value !== "string") return value;
  // Intentionally using control characters to remove them from strings
  // eslint-disable-next-line no-control-regex -- Intentionally matching control characters for removal
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

/**
 * Sanitize an object's string properties
 * @param obj - Object to sanitize
 * @returns New object with sanitized string values
 */
export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const sanitized = {} as T;
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      sanitized[key as keyof T] = sanitizeString(value) as T[keyof T];
    } else {
      sanitized[key as keyof T] = value as T[keyof T];
    }
  }
  return sanitized;
}
