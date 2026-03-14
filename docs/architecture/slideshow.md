---
title: Slideshow system
description: Card cover image slideshow — navigation, gesture detection, animation, preloading, failed image recovery, and visibility reset.
author: "\U0001F916 Generated with Claude Code"
last updated: 2026-03-06
---
# Slideshow system

## Overview

The slideshow system enables multi-image navigation on card covers in Grid and Masonry views. It supports arrow clicks, trackpad/wheel gestures, and touch swipes with animated transitions between images. The system spans three files: `src/shared/slideshow.ts` (navigator, gesture detection, animation, preload, external blob cache), `src/shared/hover-intent.ts` (mousemove-after-mouseenter activation utility), and `src/bases/swipe-interceptor.ts` (touch gesture interception for panzoom on mobile). Both renderers (`src/shared/card-renderer.tsx` for Datacore, `src/bases/shared-renderer.ts` for Bases) wire up the shared slideshow functions and own the visibility reset IntersectionObserver.

## Files

| File                             | Role                                                                  |
| -------------------------------- | --------------------------------------------------------------------- |
| `src/shared/slideshow.ts`        | Navigator, gesture detection, animation, preload, external blob cache |
| `src/shared/hover-intent.ts`     | Hover intent utility (mousemove-after-mouseenter activation)          |
| `src/bases/swipe-interceptor.ts` | Touch gesture interception for panzoom on mobile                      |
| `styles/card/_slideshow.scss`    | Animation keyframes, nav arrows, indicator, boundary dimming          |

## Navigator state

`createSlideshowNavigator()` returns `{ navigate, reset }` and closes over:

| Field                        | Type                                    | Purpose                                                                                     |
| ---------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------- |
| `currentIndex`               | `number`                                | Current displayed image (0-based)                                                           |
| `isAnimating`                | `boolean`                               | Active animation flag                                                                       |
| `lastWrapFromFirstTimestamp` | `number \| null`                        | Timestamp of last First-to-Last wrap (undo window)                                          |
| `activeAnimationTimeout`     | `ReturnType<typeof setTimeout> \| null` | setTimeout ID for animation completion                                                      |
| `activeExitClass`            | `string`                                | Exit animation CSS class currently applied                                                  |
| `activeEnterClass`           | `string`                                | Enter animation CSS class currently applied                                                 |
| `activeNewIndex`             | `number`                                | Target index being animated toward                                                          |
| `failedIndices`              | `Set<number>`                           | Indices that failed during THIS navigator's lifetime                                        |
| `pendingTimeouts`            | `Set<ReturnType<typeof setTimeout>>`    | All pending timeouts for consolidated abort cleanup                                         |
| `animationDuration`          | `number`                                | Read from CSS `--anim-duration-moderate` at init, fallback `SLIDESHOW_ANIMATION_MS` (300ms) |

## Gesture state (wheel/trackpad)

`setupSwipeGestures()` closes over:

| Field                  | Type                                    | Purpose                                        |
| ---------------------- | --------------------------------------- | ---------------------------------------------- |
| `accumulatedDeltaX`    | `number`                                | Horizontal scroll accumulation during gesture  |
| `lastDeltaX`           | `number`                                | Previous deltaX for direction change detection |
| `navigatedThisGesture` | `boolean`                               | One navigation per gesture flag                |
| `peakSinceNav`         | `number`                                | Peak \|deltaX\| since last navigation          |
| `inDecayPhase`         | `boolean`                               | Currently in velocity decay detection          |
| `decayEventCount`      | `number`                                | Wheel events since entering decay phase        |
| `minSinceDecay`        | `number`                                | Minimum \|deltaX\| during current decay phase  |
| `gestureResetTimeout`  | `ReturnType<typeof setTimeout> \| null` | Quiet period timeout for gesture end           |

## DOM structure

Dual stacked images with z-index layering:

```html
<div class="card-cover card-cover-slideshow">
  <div class="dynamic-views-image-embed">
    <img class="slideshow-img slideshow-img-current" />
    <!-- z-index: 2 -->
    <img class="slideshow-img slideshow-img-next" />
    <!-- z-index: 1 -->
  </div>
  <div class="slideshow-nav-left">...</div>
  <div class="slideshow-nav-right">...</div>
  <div class="slideshow-indicator">...</div>
</div>
```

Next image is `visibility: hidden` when not animating (empty `src` would show broken icon).

## Animation sequencing

### Cancel-and-restart

If `isAnimating` when `navigate()` is called, `finishAnimation()` snaps the current animation to its end state, then the new animation starts immediately.

### `finishAnimation()`

1. Clear `activeAnimationTimeout`
2. Remove animation classes from both images
3. Swap role classes: current becomes next, next becomes current
4. Clear `src` on the now-next element
5. Update `currentIndex` to `activeNewIndex`
6. Set `isAnimating = false`
7. Call `updateBoundaryClasses()`

### Animation classes

| Class                   | Applied to | Direction           |
| ----------------------- | ---------- | ------------------- |
| `slideshow-exit-left`   | Current    | Next (direction 1)  |
| `slideshow-enter-left`  | Next       | Next (direction 1)  |
| `slideshow-exit-right`  | Current    | Prev (direction -1) |
| `slideshow-enter-right` | Next       | Prev (direction -1) |

Last-to-First wrap reversal: exit-right + enter-right (reversed direction to signal "rewind"). Controlled by `isWrapToFirst` detection.

### CSS animations

All four keyframes use `--dynamic-views-anim-duration-moderate` (plugin-derived variable, set to `var(--anim-duration-moderate, 300ms)` in [_variables.scss](../../styles/_variables.scss)) with `ease` timing and `forwards` fill mode. JS reads the Obsidian variable `--anim-duration-moderate` directly at navigator init for timeout synchronization (fallback 300ms); both resolve to the same value.

## Gesture boundary detection (peak + decay)

### Problem

Trackpad wheel events have decaying deltas at the end of a gesture. A new gesture also starts with rising deltas. Without boundary detection, the system cannot distinguish "gesture ending" from "new gesture starting" since both are continuous wheel event streams.

### Algorithm

1. Track `peakSinceNav = max(peakSinceNav, |deltaX|)` across all wheel events
2. Enter decay phase when `|deltaX| < peakSinceNav * 0.3` (`WHEEL_DECAY_RATIO`)
3. Track `minSinceDecay` as the minimum `|deltaX|` seen during decay
4. **Brief fluctuation recovery**: if `|deltaX| >= decayThreshold` within first 5 events (`WHEEL_DECAY_MIN_EVENTS`), exit decay (false alarm from sustained swipe)
5. **New gesture detected** when all three conditions met:
   - `decayEventCount >= 5` (`WHEEL_DECAY_MIN_EVENTS`)
   - `|deltaX| >= minSinceDecay * 3` (`WHEEL_RESUME_RATIO`)
   - `|deltaX| >= 15` (`WHEEL_RESUME_DELTA`)
6. On new gesture: reset `accumulatedDeltaX`, `navigatedThisGesture`, and all decay state

### Direction change

Immediate full reset if `sign(deltaX)` changes. Always intentional.

### Navigation trigger

`|accumulatedDeltaX| >= 5` (`WHEEL_SWIPE_THRESHOLD`). One navigation per gesture via `navigatedThisGesture` flag. Positive deltaX = next slide (trackpad convention).

### Quiet period fallback

150ms (`WHEEL_GESTURE_GAP_MS`) timeout with no wheel events resets all gesture state. Note: the quiet period reset does NOT clear `lastDeltaX`, so direction change detection works across gesture boundaries. This appears intentional — a new gesture in the opposite direction should still trigger a direction change reset.

## noLoop clamping

When `isSlideshowLoopingDisabled()` returns true (Style Settings toggle), navigation clamps at boundaries instead of wrapping:

- `navigate()` returns early if `newIndex` would go out of bounds
- The skip loop also clamps — if the next non-broken index would exceed bounds, navigation stops
- Boundary classes (`.slideshow-at-first`, `.slideshow-at-last`) dim the corresponding nav arrow via CSS

## Touch swipe

| Parameter           | Value                                 | Notes                                                                            |
| ------------------- | ------------------------------------- | -------------------------------------------------------------------------------- |
| Swipe threshold     | 30px                                  | `TOUCH_SWIPE_THRESHOLD`                                                          |
| Direction detection | 10px                                  | `SWIPE_DETECT_THRESHOLD` — must exceed before classifying horizontal vs vertical |
| Horizontal test     | \|deltaX\| > \|deltaY\|               | Only after detection threshold                                                   |
| Direction mapping   | Swipe right = prev, swipe left = next | OPPOSITE of trackpad (natural scrolling)                                         |
| One per swipe       | `touchNavigated` flag                 | Reset on `touchstart`                                                            |

Touch events use `capture: true` and call `stopPropagation()` + `stopImmediatePropagation()` on `touchstart` (blocks sidebar swipe detection) and `preventDefault()` + `stopPropagation()` + `stopImmediatePropagation()` on horizontal `touchmove`.

Mobile indicator is hidden during horizontal swipe (`.dynamic-views-indicator-hidden`) and shown again on vertical scroll of the view container (throttled to `SCROLL_THROTTLE_MS`).

## Undo window (First-to-Last-to-First)

### Problem

User rapidly navigates backward past the first image (First-to-Last wrap), then immediately navigates forward (Last-to-First wrap). The second wrap is accidental undo, not intentional — but the wrap reversal logic would reverse its animation direction, creating a confusing visual.

### Solution

- Track `lastWrapFromFirstTimestamp` when a First-to-Last wrap occurs (direction -1, currentIndex 0, newIndex last)
- Within `UNDO_WINDOW_MS` (2500ms), suppress `isWrapToFirst` reversal on the next Last-to-First navigation — treat it as normal forward navigation
- Requires 3+ images (2-image alternating direction feels glitchy)
- Not applied when `honorGestureDirection=true` (scroll/swipe always use gesture direction directly)
- Cleared on any non-wrap navigation

## Failed image handling

### Local tracking (`failedIndices` per navigator)

- Skip known-failed indices during navigation (loop with `direction` step)
- Stop advancing if `skipped >= imageUrls.length` or `newIndex === currentIndex`
- Call `onAllFailed()` when all exhausted

### Global tracking (`brokenImageUrls` in [image-loader.ts](../../src/shared/image-loader.ts))

> For the full broken URL tracking lifecycle, two-tier dedup cache, and aspect ratio caching, see [image-loading.md](image-loading.md).

- Session-scoped `Set<string>`, survives across cards/navigators
- `markImageBroken(url)` on load error
- Checked alongside `failedIndices` during skip loop

### Error recovery flows

| Scenario                  | Behavior                                                                    |
| ------------------------- | --------------------------------------------------------------------------- |
| First image fails         | `skipAnimation=true`, auto-advance to next valid image                      |
| Image fails mid-animation | Hide next img, wait `animationDuration + 50ms`, retry `navigate(direction)` |
| Skip-animation failure    | Recursive `navigate()` with `skipAnimation=true`, same direction            |
| All images exhausted      | `isAnimating = false`, call `onAllFailed()` callback                        |

### `slideshow-single` class

When broken images are detected and only 1 valid image remains, `.slideshow-single` is added to the slideshow wrapper. CSS hides indicator and both nav arrows.

## Preload guard

Shared `{ done: boolean }` object (`preloadGuard`) deduplicates preload between:

1. **Hover intent preload** (`setupImagePreload`) — fires on desktop hover
2. **First navigation preload** (inside `navigate()`) — fires on mobile where hover never occurs

Both paths splice broken URLs from the image array via the `onBroken` callback. Without the guard, double splice corrupts indices. Whichever fires first sets `guard.done = true`; the other returns early.

## Navigation methods

| Trigger                | Direction | `honorGestureDirection` | `skipAnimation` |
| ---------------------- | --------- | ----------------------- | --------------- |
| Arrow left click       | -1        | false                   | false           |
| Arrow right click      | 1         | false                   | false           |
| Wheel/trackpad         | +/-1      | true                    | false           |
| Touch swipe            | +/-1      | true                    | false           |
| First image fails      | 1         | false                   | true            |
| Mid-animation failure  | same      | same                    | false           |
| Skip-animation failure | same      | same                    | true            |

## Hover intent integration

`setupHoverIntent()` in [hover-intent.ts](../../src/shared/hover-intent.ts) requires a `mousemove` event after `mouseenter` to activate. Prevents false triggers when elements scroll under a stationary cursor.

- **Arrow visibility**: Gated by `.hover-intent-active` class on the card (set by the shared hover intent system in both renderers)
- **Image preload**: Fires on hover intent activation (deduped with `preloadGuard`)
- **Hover zoom eligibility**: `.hover-zoom-eligible` set on `mouseenter` to the current image, cleared from all images on `mouseleave`, cleared from old image (now `.slideshow-img-next`) after animation completes via the callback returned by `setupHoverZoomEligibility()`

## Visibility reset

The IntersectionObserver that watches the slideshow container lives in the renderers ([src/bases/shared-renderer.ts](../../src/bases/shared-renderer.ts) and [src/shared/card-renderer.tsx](../../src/shared/card-renderer.tsx)), NOT in [slideshow.ts](../../src/shared/slideshow.ts):

1. Track `wasHidden` flag (initially `false`)
2. On not intersecting: set `wasHidden = true`
3. On intersecting AND `wasHidden`: set `wasHidden = false`, call `reset()`

Both renderers use `getOwnerWindow(slideshowEl).IntersectionObserver` to construct the observer from the correct window context (popout window support).

### `reset()` behavior

`reset()` returns early if `isAnimating` is true. Otherwise it finds the first non-broken image index, sets `currentIndex`, clears `failedIndices`, clears `lastWrapFromFirstTimestamp`, updates the current image `src`, and calls `updateBoundaryClasses()`. It also fires the `onSlideChange` callback via a `load` event listener on the current image after setting the new `src`.

## Boundary classes

| Class                 | Condition                     | Purpose                           |
| --------------------- | ----------------------------- | --------------------------------- |
| `.slideshow-at-first` | `currentIndex === 0`          | CSS dims left arrow when no-loop  |
| `.slideshow-at-last`  | `currentIndex === length - 1` | CSS dims right arrow when no-loop |

Applied to `.card-cover-slideshow` (parent of image embed). Updated by `updateBoundaryClasses()` after every index change. Dimming only activates when `body.dynamic-views-slideshow-disable-looping` is present (Style Settings toggle).

## External blob cache

Obsidian's Electron sends `Cache-Control: no-cache` on cross-origin requests, making browser HTTP caching ineffective for external images. The blob cache uses `requestUrl` (Obsidian API, bypasses CORS) to fetch once and serve as same-origin `blob:` URLs.

| State                  | Type                                 | Purpose                                            |
| ---------------------- | ------------------------------------ | -------------------------------------------------- |
| `externalBlobCache`    | `Map<string, string>`                | Original URL to blob URL mapping                   |
| `pendingFetches`       | `Map<string, Promise<string\|null>>` | Deduplicates concurrent fetch requests             |
| `failedValidationUrls` | `Set<string>`                        | URLs that failed image validation (no retry)       |
| `isCleanedUp`          | `boolean`                            | Prevents orphaned blob URLs from in-flight fetches |

Cache eviction at `BLOB_CACHE_LIMIT` (150): iterates entries, revokes first blob URL not currently displayed by any `<img>` element. If all entries are in-use, allows temporary overflow.

## Cleanup

### Per-slideshow (AbortController)

**Datacore** ([card-renderer.tsx](../../src/shared/card-renderer.tsx)): `AbortController` stored on `element._slideshowController`. On re-render: abort previous controller before creating new one.

**Bases** ([shared-renderer.ts](../../src/bases/shared-renderer.ts)): Abort closure `() => controller.abort()` pushed to `slideshowCleanups[]` array (`(() => void)[]`) on the `SharedCardRenderer` instance. On batch cleanup or per-card teardown: iterate and call each cleanup function.

Both backends share the same abort behavior:

- On abort signal: `finishAnimation()`, clear all `pendingTimeouts`, disconnect visibility observer
- All event listeners use `{ signal }` option for automatic removal

### Global (plugin unload)

`cleanupExternalBlobCache()`:

- Sets `isCleanedUp = true` (prevents orphaned blob URLs from in-flight fetches completing after cleanup)
- Revokes all blob URLs via `URL.revokeObjectURL()`
- Clears `externalBlobCache`, `pendingFetches`, `failedValidationUrls`, `brokenImageUrls`

`initExternalBlobCache()` on plugin load: resets `isCleanedUp` flag and clears `brokenImageUrls`.

## Constants

| Constant                 | Value | Purpose                                           |
| ------------------------ | ----- | ------------------------------------------------- |
| `SLIDESHOW_ANIMATION_MS` | 300   | Animation fallback duration (ms)                  |
| `UNDO_WINDOW_MS`         | 2500  | First-to-Last-to-First undo detection window (ms) |
| `WHEEL_SWIPE_THRESHOLD`  | 5     | Accumulated deltaX to trigger navigation          |
| `WHEEL_GESTURE_GAP_MS`   | 150   | Quiet period for gesture end detection (ms)       |
| `TOUCH_SWIPE_THRESHOLD`  | 30    | Touch distance to trigger navigation (px)         |
| `SWIPE_DETECT_THRESHOLD` | 10    | Minimum movement to classify swipe direction (px) |
| `WHEEL_DECAY_RATIO`      | 0.3   | Decay phase entry (30% of peak)                   |
| `WHEEL_DECAY_MIN_EVENTS` | 5     | Events before decay is confirmed                  |
| `WHEEL_RESUME_RATIO`     | 3     | Acceleration ratio for new gesture detection      |
| `WHEEL_RESUME_DELTA`     | 15    | Absolute acceleration threshold                   |
| `BLOB_CACHE_LIMIT`       | 150   | Max external blob URL cache entries               |
| `SCROLL_THROTTLE_MS`     | 100   | Scroll event throttle for indicator restore (ms)  |

## Invariants

1. **Single animation at a time.** `isAnimating` is a boolean, not a counter. `finishAnimation()` is idempotent (returns early if `!isAnimating`).
2. **`failedIndices` checked before navigation.** The skip loop stops if `skipped >= imageUrls.length` (iterated through all indices) or `newIndex === currentIndex` (wrapped back to start).
3. **Undo window cleared on any non-wrap navigation.** `lastWrapFromFirstTimestamp` is set only on First-to-Last wrap, nulled on all other navigations.
4. **`preloadGuard.done` prevents duplicate array splices.** Whichever path (hover or first-navigate) fires first claims the guard; the other is a no-op.
5. **Current image always has higher z-index.** Role classes (and thus z-index) are swapped only in `finishAnimation()`, never mid-animation.
6. **Gesture accumulation reset on direction change.** `sign(deltaX)` change triggers immediate full reset — always intentional.
7. **Decay phase recovery requires both 5+ events AND meaningful acceleration.** Both `WHEEL_DECAY_MIN_EVENTS` and `WHEEL_RESUME_RATIO`/`WHEEL_RESUME_DELTA` must be satisfied to detect a new gesture.
8. **Blob URLs revoked and caches cleared on unload.** `isCleanedUp` flag prevents orphaned blob URLs from completing fetches after cleanup.
9. **Touch direction mapping inverted vs trackpad.** Swipe right = previous (natural scrolling), positive deltaX = next (trackpad convention).
10. **Visibility reset only on hidden-to-visible transition.** `wasHidden` flag prevents reset on initial intersection or repeated visible states.
