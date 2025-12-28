/**
 * Shared constants used across Grid and Masonry views
 */

/** Default batch size for infinite scroll */
export const BATCH_SIZE = 50;

/** Gap size between cards - default fallback (actual value from CSS via getCardSpacing()) */
export const GAP_SIZE = 12;

/** Scroll position tolerance in pixels */
export const SCROLL_TOLERANCE = 1;

/** Default image aspect ratio for covers */
export const IMAGE_ASPECT_RATIO = 0.55;

/** Pane height multiplier for infinite scroll trigger threshold */
export const PANE_MULTIPLIER = 3;

/** Scroll event throttle in milliseconds */
export const SCROLL_THROTTLE_MS = 100;

/** Rows per column for batch size calculation */
export const ROWS_PER_COLUMN = 10;

/** Maximum batch size cap */
export const MAX_BATCH_SIZE = 70;

/** Debounce delay for layout updates in milliseconds */
export const LAYOUT_UPDATE_DELAY = 50;

/** Throttle interval for resize layout updates in milliseconds */
export const RESIZE_THROTTLE_MS = 100;

/** Slideshow animation duration in milliseconds (must match CSS) */
export const SLIDESHOW_ANIMATION_MS = 300;

/** Wide mode multiplier for expanded width (must match CSS --datacore-wide-multiplier) */
export const WIDE_MODE_MULTIPLIER = 1.75;

/** Minimum movement in pixels to determine swipe direction */
export const SWIPE_DETECT_THRESHOLD = 10;

/** Delay in ms after gesture ends before allowing click events */
export const GESTURE_TIMEOUT_MS = 50;
