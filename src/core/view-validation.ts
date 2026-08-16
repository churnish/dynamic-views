/**
 * Shared validation constants for ViewDefaults cleanup.
 * Used by cleanupTemplateSettings (persistence.ts) and cleanUpBaseFile (bases/utils.ts).
 */

import type { ViewDefaults } from '../types';
import { VIEW_DEFAULTS } from '../constants';

/** Valid enum values for ViewDefaults string-enum fields */
export const VALID_VIEW_VALUES: Partial<
  Record<keyof ViewDefaults, readonly string[]>
> = {
  showFileImages: ['always', 'if-unavailable', 'never'],
  imageFormat: ['thumbnail', 'cover', 'poster', 'backdrop'],
  posterDisplayMode: ['fade', 'overlay'],
  imagePosition: ['left', 'right', 'top', 'bottom'],
  imageFit: ['crop', 'contain'],
  propertyNames: ['hide', 'inline', 'above'],
  rightPropertyPosition: ['left', 'column', 'right'],
  minimumColumns: ['one', 'two'],
};

/** Expected runtime types for ViewDefaults fields */
export const VIEW_DEFAULTS_TYPES: Record<string, string> = {};
for (const [key, value] of Object.entries(VIEW_DEFAULTS)) {
  VIEW_DEFAULTS_TYPES[key] = typeof value;
}

/**
 * Valid [min, max] for numeric ViewDefaults fields. Must agree with the slider
 * bounds in getBasesViewOptions() — a hand-edited .base file can carry any number.
 */
export const VIEW_DEFAULTS_RANGES: Record<string, [number, number]> = {
  cardSize: [50, 800],
  titleLines: [1, 5],
  subtitleLines: [1, 5],
  textPreviewLines: [1, 10],
  cardGapDesktop: [0, 64],
  cardGapPhone: [0, 64],
  thumbnailSize: [64, 128],
  imageRatio: [0.25, 2.5],
};

/** Numeric fields that accept fractional values — every other range is clamped and rounded. */
export const FRACTIONAL_VIEW_DEFAULTS = new Set<string>(['imageRatio']);
