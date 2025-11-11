/**
 * Shared constants used across Grid and Masonry views
 */

/** Default batch size for infinite scroll */
export const BATCH_SIZE = 50;

/** Gap size between elements (must match CSS --dynamic-views-element-spacing) */
export const GAP_SIZE = 8;

/** Scroll position tolerance in pixels */
export const SCROLL_TOLERANCE = 1;

/** Row grouping tolerance for masonry layout in pixels */
export const ROW_TOLERANCE = 20;

/** Default image aspect ratio for covers */
export const IMAGE_ASPECT_RATIO = 0.55;

/** Viewport multiplier for infinite scroll trigger (above viewport) */
export const VIEWPORT_MULTIPLIER_ABOVE = 2;

/** Viewport multiplier for infinite scroll trigger (below viewport) */
export const VIEWPORT_MULTIPLIER_BELOW = 1;

/** Debounce delay for layout updates in milliseconds */
export const LAYOUT_UPDATE_DELAY = 50;
