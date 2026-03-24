/**
 * Shared constants used across Grid and Masonry views
 */

/** Default batch size for infinite scroll */
export const BATCH_SIZE = 50;

/** Scroll position tolerance in pixels */
export const SCROLL_TOLERANCE = 1;

/** Pane height multiplier for infinite scroll trigger threshold */
export const PANE_MULTIPLIER = 3;

/** Content-hidden zone multiplier — cards between 1× and this × paneHeight get
 *  content-visibility: hidden instead of full unmount (non-WebKit only). */
export const HIDDEN_BUFFER_MULTIPLIER = 2;

/** Scroll event throttle in milliseconds */
export const SCROLL_THROTTLE_MS = 100;

/** Rows per column for batch size calculation */
export const ROWS_PER_COLUMN = 10;

/** Maximum batch size cap */
export const MAX_BATCH_SIZE = 70;

/** Throttle interval for resize layout updates in milliseconds */
export const RESIZE_THROTTLE_MS = 100;

/** Fallback height for virtual items that have never been DOM-measured.
 *  Used to prevent 0-height compression in layout calculations.
 *  Conservative estimate — corrected when the item mounts and gets measured. */
export const UNMEASURED_CARD_HEIGHT = 200;

/** Masonry correction delay and transition duration in ms (must match CSS masonry-correcting) */
export const MASONRY_CORRECTION_MS = 200;

/** Throttle interval for scroll-concurrent CLS correction.
 *  During post-resize scroll, corrections run at most once per this interval. */
export const SCROLL_CORRECTION_INTERVAL_MS = 1000;

/** Throttle interval for post-mount remeasure during scroll.
 * --masonry-reposition-duration in _core.scss must not exceed this value. */
export const MOUNT_REMEASURE_MS = 200;

/** Max WebKit momentum duration — height-lock releases and scrollTop writes
 *  are suppressed for this long after touchend to preserve compositor-driven
 *  deceleration (which is killed by any programmatic scrollTop write). */
export const MOMENTUM_GUARD_MS = 3000;

/** Delay for safety net remeasure after initial render.
 * Catches slow async height changes that the double-rAF deferred remeasure misses. */
export const INITIAL_REMEASURE_MS = 500;

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

/** Accumulated downward scroll (px) to trigger full screen hide */
export const FULL_SCREEN_HIDE_DEAD_ZONE = 30;
/** Accumulated upward scroll (px) to trigger full screen show */
export const FULL_SCREEN_SHOW_DEAD_ZONE = 20;

/** Minimum sustained upward scroll duration (ms) before triggering show */
export const FULL_SCREEN_SHOW_SUSTAIN_MS = 80;
/** scrollTop threshold — always show bars when near top */
export const FULL_SCREEN_TOP_ZONE = 50;
/** Minimum ms between hide/show transitions */
export const FULL_SCREEN_TOGGLE_COOLDOWN_MS = 300;
/** Scroll-idle debounce for bridge settle.
 *  2s outlasts the iOS native scroll indicator fade (~1.5s),
 *  so the settle's scrollTop adjustment is invisible. */
export const FULL_SCREEN_SCROLL_IDLE_MS = 2000;
/** Android settle debounce — Android Chromium scrollbar never fades,
 *  so the settle scrollTop adjustment is always visible regardless of timing.
 *  150ms is enough for Chromium fling to fully stop (scrollend fires at ~1ms). */
export const FULL_SCREEN_SCROLL_IDLE_ANDROID_MS = 150;
