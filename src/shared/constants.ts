/**
 * Shared constants used across Grid and Masonry views
 */

/** Default batch size for infinite scroll */
export const BATCH_SIZE = 50;

/** Scroll position tolerance in pixels */
export const SCROLL_TOLERANCE = 1;

/** Pane height multiplier for infinite scroll trigger threshold */
export const PANE_MULTIPLIER = 3;

/** Scroll event throttle in milliseconds */
export const SCROLL_THROTTLE_MS = 100;

/** Rows per column for batch size calculation */
export const ROWS_PER_COLUMN = 10;

/** Maximum batch size cap */
export const MAX_BATCH_SIZE = 70;

/** Throttle interval for resize layout updates in milliseconds */
export const RESIZE_THROTTLE_MS = 100;

/** Masonry correction delay and transition duration in ms (must match CSS masonry-correcting) */
export const MASONRY_CORRECTION_MS = 200;

/** Throttle interval for post-mount remeasure during scroll.
 * --masonry-reposition-duration in _core.scss must not exceed this value. */
export const MOUNT_REMEASURE_MS = 200;

/** Slideshow animation duration in milliseconds (must match CSS) */
export const SLIDESHOW_ANIMATION_MS = 300;

/** Wide mode multiplier for expanded width */
export const WIDE_MODE_MULTIPLIER = 1.75;

/** Minimum movement in pixels to determine swipe direction */
export const SWIPE_DETECT_THRESHOLD = 10;

/** Delay in ms after gesture ends before allowing click events */
export const GESTURE_TIMEOUT_MS = 50;

/** JSON prefix for checkbox property markers */
export const CHECKBOX_MARKER_PREFIX = '{"type":"checkbox"';

/** Thumbnail stacking threshold multiplier (card stacks when width < thumbnail * this) */
export const THUMBNAIL_STACK_MULTIPLIER = 3;

/** Custom event dispatched when a Datacore dropdown opens (closes dropdowns in other queries) */
export const DROPDOWN_OPENED_EVENT = 'dynamic-views:dropdown-opened';

/** Fixed hover growth per side in px. Scale = 1 + (2 * HOVER_GROWTH_PX) / height. */
export const HOVER_GROWTH_PX = 4;

const MAX_HOVER_SCALE = 1.04;

/** Size-adaptive hover scale for a card — consistent gap consumption regardless of height.
    Returns empty string for invalid heights (removes property, falls back to CSS default). */
export function computeHoverScale(height: number): string {
  if (height <= 0) return '';
  return String(Math.min(1 + (HOVER_GROWTH_PX * 2) / height, MAX_HOVER_SCALE));
}
