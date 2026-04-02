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

/** Scroll-idle debounce for virtual scroll fallback sync (ms).
 * Velocity gate suppresses budgetExhausted reschedule during fast scroll —
 * this timeout guarantees a final sync after scroll stops. Must exceed
 * SCROLL_THROTTLE_MS so the idle fires after the last throttled check. */
export const SCROLL_IDLE_SYNC_MS = 150;

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

/** Masonry mount budget fallback before first layout (card width unknown).
 * After layout, Masonry derives its budget from GRID_ROW_BUDGET × columns. */
export const SCROLL_MOUNT_BUDGET = 3;

/** Mount budget multiplier: GRID_ROW_BUDGET × columns cards per frame. Grid
 * mounts complete rows; Masonry mounts the equivalent card count for parity.
 * Two row-equivalents balance viewport fill speed against per-frame layout. */
export const GRID_ROW_BUDGET = 2;

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
export const SWIPE_DETECT_THRESHOLD = 16;

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

export const MAX_HOVER_SCALE = 1.04;

/** Selector for visible body children — used by card-renderer and shared-renderer. */
export const VISIBLE_BODY_SELECTOR =
  '.card-properties-top, .card-properties-bottom, .card-previews:not(.thumbnail-placeholder-only)';

// Poster stretch trio — the class signals stretch state and the two CSS variables carry computed values. All three must be set/cleared together; clearing only the class leaks stale CSS variable state. Consumed by `_poster.scss`.
export const POSTER_STRETCH_CLASS = 'poster-stretch';
export const POSTER_ROW_MIN_HEIGHT_VAR = '--poster-row-min-height';
export const POSTER_ASPECT_OVERRIDE_VAR = '--poster-aspect-override';

// Fixed cover height body classes (Style Settings class-select options)
export const FIXED_COVER_HEIGHT_GRID = 'dynamic-views-fixed-cover-height-grid';
export const FIXED_COVER_HEIGHT_MASONRY =
  'dynamic-views-fixed-cover-height-masonry';
export const FIXED_COVER_HEIGHT_BOTH = 'dynamic-views-fixed-cover-height-both';
export const FIXED_COVER_HEIGHT_NONE = 'dynamic-views-fixed-cover-height-none';

// Fixed poster height body classes (Style Settings class-select options).
// GRID and BOTH mean fixed height is ON — JS only checks the OFF variants (MASONRY, NONE).
/** ON variants not checked in JS (default behavior) @public */
export const FIXED_POSTER_HEIGHT_GRID =
  'dynamic-views-fixed-poster-height-grid';
export const FIXED_POSTER_HEIGHT_MASONRY =
  'dynamic-views-fixed-poster-height-masonry';
/** @public */
export const FIXED_POSTER_HEIGHT_BOTH =
  'dynamic-views-fixed-poster-height-both';
export const FIXED_POSTER_HEIGHT_NONE =
  'dynamic-views-fixed-poster-height-none';

/** Size-adaptive hover scale for a card — consistent gap consumption regardless of height.
    Returns empty string for invalid heights (removes property, falls back to CSS default). */
export function computeHoverScale(height: number): string {
  if (height <= 0) return '';
  return String(Math.min(1 + (HOVER_GROWTH_PX * 2) / height, MAX_HOVER_SCALE));
}

/** Accumulated scroll delta (px) before committing to a new direction. Filters trackpad micro-reversals (19-39px) during deceleration. */
export const DIRECTION_ACCUM_THRESHOLD = 50;

/** Scroll velocity (px/s) above which row commits are suppressed to avoid transient positions during scrollbar drags and trackpad flicks. */
export const HIGH_VELOCITY_THRESHOLD = 4000;

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
/** Android settle debounce — must exceed FULL_SCREEN_ANIM_MS (300ms) so
 *  WAAPI show animations complete before idle cleanup cancels them.
 *  Cancelling mid-animation snaps header opacity from ~50% to 100%, causing
 *  a white flash. 500ms = 300ms animation + 200ms buffer. */
export const FULL_SCREEN_SCROLL_IDLE_ANDROID_MS = 500;
/** Bar hide/show animation duration (ms) — independent of TOGGLE_COOLDOWN_MS */
export const FULL_SCREEN_ANIM_MS = 300;
/** Bar opacity fade duration (ms) — matches native header/navbar opacity transition */
export const FULL_SCREEN_FADE_MS = 200;

/** Delay (ms) before resolving a fully-unwound bridge at scrollTop=0.
 *  Short — just enough to confirm idle. Android has no elastic bounce. */
export const FULL_SCREEN_BRIDGE_RESOLVE_DELAY_MS = 50;
