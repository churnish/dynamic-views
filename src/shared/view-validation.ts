/**
 * Shared validation constants for ViewDefaults cleanup.
 * Used by cleanupTemplateSettings (persistence.ts) and cleanupBaseFile (bases/utils.ts).
 */

import type { ViewDefaults } from "../types";
import { VIEW_DEFAULTS } from "../constants";

/** Valid enum values for ViewDefaults string-enum fields */
export const VALID_VIEW_VALUES: Partial<
  Record<keyof ViewDefaults, readonly string[]>
> = {
  fallbackToEmbeds: ["always", "if-unavailable", "never"],
  imageFormat: ["thumbnail", "cover", "poster", "backdrop"],
  imagePosition: ["left", "right", "top", "bottom"],
  imageFit: ["crop", "contain"],
  propertyLabels: ["hide", "inline", "above"],
  rightPropertyPosition: ["left", "column", "right"],
  minimumColumns: ["one", "two"],
};

/** Expected runtime types for ViewDefaults fields, derived from VIEW_DEFAULTS */
export const VIEW_DEFAULTS_TYPES: Record<string, string> = {};
for (const [key, value] of Object.entries(VIEW_DEFAULTS)) {
  VIEW_DEFAULTS_TYPES[key] = typeof value;
}
