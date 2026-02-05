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

/** Luminance threshold for light/dark theme detection (values above = light background) */
export const LUMINANCE_LIGHT_THRESHOLD = 0.333;
