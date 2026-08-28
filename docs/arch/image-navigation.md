---
title: Image navigation
description: Card cover image slideshow — navigation, gesture detection, animation, preloading, failed image recovery, and visibility reset.
author: 🤖 Generated with Claude Code
updated: 2026-08-28
---
# Image navigation

See also: [`odkb/webkit-compositor-constraints.md`](https://github.com/churnish/odkb/blob/main/webkit-compositor-constraints.md)

## Overview

The slideshow system enables multi-image navigation on card covers in Grid and Masonry views. All four cover positions are eligible — top, bottom, left and right. It supports arrow clicks, trackpad/wheel gestures, and touch swipes with animated transitions between images. The system spans two files: `src/core/slideshow.ts` (navigator, gesture detection, animation, preload, external blob cache) and `src/core/hover-and-touch.ts` (hover and touch interaction utilities). The renderer (`src/bases/shared-renderer.ts`) wires up the shared slideshow functions and owns the visibility reset IntersectionObserver.

### Relationship to the image viewer

The image viewer has its own desktop-only arrow navigation over the same image sets — see [Arrow navigation](image-viewer.md#arrow-navigation). Two boundaries matter:

- **Indices are independent.** The viewer tracks its own index; stepping in the viewer never advances the card's navigator, and closing the viewer leaves the card where it was.
- **The viewer holds a snapshot, not the card's live array.** `setViewerImageSet()` copies the array at render time, so the in-place splices this document's failed image handling performs cannot shift the viewer's indices mid-session.

The two share the global `brokenImageUrls` skip set, but not the navigator's closure-private `failedIndices`.

## Files

| File                             | Role                                                                  |
| -------------------------------- | --------------------------------------------------------------------- |
| `src/core/slideshow.ts`        | Navigator, gesture detection, animation, preload, external blob cache |
| `src/core/multi-image-nav.ts`  | Touch swipe-to-advance, hover scrub helpers, visibility reset IO |
| `src/core/multi-image-icon.ts` | Corner icon hidden state: exclusivity slot, restore, shared scroll listener |
| `src/core/hover-and-touch.ts`  | Hover and touch interaction utilities                                 |
| `styles/card/_slideshow.scss`    | Animation keyframes, nav arrows, cover icon, hover zoom cancel        |
| `styles/card/_previews.scss`     | Thumbnail indicator: default, positioning, hidden state, hover hide, Style Settings hide |
| `src/bases/utils.ts`             | `setupIndicatorRestoreTriggers()` — tap-elsewhere and focus-loss restore wiring |

## Cover navigation modes

Multi-image covers navigate in one of two modes, chosen by the `Navigation` style setting (`dynamic-views-cover-navigation`). All four cover positions honour both.

| Mode | Body class | Interaction | Engine |
|---|---|---|---|
| Scrub (default) | `dynamic-views-cover-navigation-scrub` | Pointer X position across the cover picks the frame; touch swipes advance one image | `multi-image-nav.ts`, shared with thumbnails |
| Slide | `dynamic-views-cover-navigation-slide` | Hover arrows, wheel/trackpad gestures, touch swipe | `slideshow.ts`, described by the rest of this document |

`isCoverScrubMode()` in `style-settings.ts` reads the mode by elimination — it returns `true` unless the `-slide` class is present, so the default holds with Style Settings absent. The mode is part of `getStyleSettingsHash()`, so switching it re-renders cards.

Scrub mode reuses the thumbnail path wholesale: `renderCoverWrapper` creates a plain `.card-cover` and hands `renderImage` the capped URL array, which builds the dual `slideshow-img` pair, wires hover scrub and `setupTouchSwipeNavigation`, and calls `setViewerImageSet`. The cover gets `.multi-image` and, unless the icon is hidden, a `.slideshow-icon`. It does NOT get nav arrows or wheel gestures. It does get the hover zoom, applied as `scale` rather than `transform` so it cannot fight the frame slide animation, and only on the frame the hover started on — the first frame change cancels it.

The `Disable navigation` toggle (`dynamic-views-cover-disable-navigation`) still kills both modes, on every platform. The mode dropdown itself is hidden on phones, where hover does not exist and the two modes reduce to the same touch swipe.

### URL button dead zone

Some layouts park the URL button over the image, where it sits directly in the pointer's path. `getDeadRect()` and `pointInRect()` inside `renderImage` ([shared-renderer.ts](../../src/bases/shared-renderer.ts)) carve out a rectangle around that button which the hover scrub ignores.

- **Eligibility is an intersection test.** The button's rect is tested against the image's rect, and no zone exists when the two do not overlap. The layouts that keep the button in the header away from the image are exactly the ones that need no zone, so naming none of them keeps layouts nobody has thought of yet correct for free.
- **Geometry comes from live rects.** The zone is flush to the card's top and right edges, inset from the button on the left by the button's own right-hand gap and below it by the button's own top gap, then clipped to the image on every side. Card padding is a Style Settings slider and the button's box is bigger on mobile, so any literal would be wrong at most settings.
- **`pointermove` freezes the frame, it does not reset it.** While the pointer is inside the zone the handler returns before computing an index, so travelling to the button no longer drags the frame along with the pointer. The frame the user scrubbed to is still the one on screen when they come back.
- **A `pointerleave` inside the zone is not a leave.** The button is not a descendant of the image, so moving onto it fires `pointerleave` on the image. When the event's coordinates fall inside the zone the handler returns early: no reset to the first image, no `.scrub-hover` removal, no rect invalidation, and no touch state sync. Clipping the zone to the image is what tells the two exits apart — a pointer moving onto the button reports a point inside the image, while a geometric exit reports one outside it altogether.
- **The zone is measured once per hover.** `cachedDeadRect` is `undefined` until first needed and `null` for a card that has none. It is invalidated alongside `cachedRect` on `pointerenter` and on a real `pointerleave`, so a button that `updateUrlButton()` has added or removed since the last hover cannot leave a stale zone behind.

### Image cap

Both covers and thumbnails cap at `MAX_MULTI_IMAGES` (10) from `src/core/constants.ts`. It is a compile-time constant, applied in `content-loader.ts` (embed limit + final slice), `image-extraction.ts` (probe and result bounds), and at both `renderImage` call sites. There is no user-facing setting for it.

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
| `requiresHoverIntent`  | `boolean`                               | `true` on hover-capable devices (`(hover: hover)` media query) |
| `cardEl`               | `HTMLElement`                           | Card ancestor for hover intent class check (parameter) |

See [hover-and-touch.md](../patterns/hover-and-touch.md) for the `canHover()` gating architecture this flag participates in.

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
  <div class="slideshow-icon">...</div>
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

### DevTools testing caveat

When testing wheel gestures via `dispatchEvent(new WheelEvent(...))` in DevTools, synchronous dispatches share gesture state — `navigatedThisGesture` persists across calls because the 150ms `gestureResetTimeout` never fires between them. Test navigation in isolation or add a 200ms delay between gesture sequences. Additionally, `e.defaultPrevented` is true for ALL horizontal wheel events that pass the hover intent guard (not just navigated ones), so it is not a reliable proxy for "navigation happened." Check `src` changes or animation classes instead.

## Looping

Navigation always wraps — forward past the last image returns to the first, backward past the first goes to the last. The skip loop for broken entries wraps the same way, bounded by an exhaustion guard. There is no opt-out: the former "Do not loop" Style Settings toggles (cover and thumbnail) were removed, along with the boundary classes and dimmed-arrow styling that only existed to signal the clamped ends.

## Touch swipe

### Direction lock

Primary: `touch-action: pan-y` on `.card-cover-slideshow` (CSS, compositor-level). Browser handles vertical scroll natively, only horizontal gestures reach JS. Industry standard — used by Hammer.js, @use-gesture, Swiper.js.

Secondary: JS direction detection as fallback guard (see table below).

| Parameter           | Value                                 | Notes                                                                            |
| ------------------- | ------------------------------------- | -------------------------------------------------------------------------------- |
| Swipe threshold     | 30px                                  | `TOUCH_SWIPE_THRESHOLD`                                                          |
| Direction detection | 16px                                  | `SWIPE_DETECT_THRESHOLD` — secondary JS guard, aligns with platform paging slop  |
| Horizontal test     | \|deltaX\| > \|deltaY\|               | Only after detection threshold                                                   |
| Direction mapping   | Swipe right = prev, swipe left = next | OPPOSITE of trackpad (natural scrolling)                                         |
| One per swipe       | `touchNavigated` flag                 | Reset on `touchstart`                                                            |

Touch events use `capture: true` and call `stopPropagation()` + `stopImmediatePropagation()` on `touchstart` (blocks sidebar swipe detection) and `preventDefault()` + `stopPropagation()` + `stopImmediatePropagation()` on horizontal `touchmove`.

Mobile icon is hidden during horizontal swipe (`.dynamic-views-icon-hidden`) and shown again on vertical scroll of the view container (throttled to `SCROLL_THROTTLE_MS`).

### Indicator exclusivity and restore

`multi-image-icon.ts` holds the hidden indicator in one module-scope `activeIndicator`. `claimIndicator()` sets it and restores the previously hidden one, so at most one indicator is hidden at a time across every card, every mode, and every open view. `restoreActiveIndicator()` is the argument-free counterpart — safe to call when nothing is hidden. `releaseIndicator(el)` is the targeted form used by the scroll trigger: it always removes the class from the element passed, and clears the slot only if that element still holds it.

The state lives in its own module because both engines need it and `multi-image-nav.ts` already imports `getCachedBlobUrl` and `preloadImageBatch` from `slideshow.ts` — putting the state in either would make a cycle. `multi-image-icon.ts` imports from neither.

Four triggers bring the icon back:

| Trigger | Wired in | Gating |
|---|---|---|
| Another card's swipe claims the indicator | `claimIndicator()`, `multi-image-icon.ts` | Ungated — reached only from the touch swipe path |
| Vertical scroll of `.bases-view` | `addScrollIndicatorRestore()`, `multi-image-icon.ts` | Ungated, throttled to `SCROLL_THROTTLE_MS` |
| Tap anywhere that is not a cover or thumbnail | `setupIndicatorRestoreTriggers()`, `src/bases/utils.ts` | `Platform.isMobile` |
| The view's pane stops being the active leaf | `setupIndicatorRestoreTriggers()`, `src/bases/utils.ts` | `Platform.isMobile` |

The visibility reset IntersectionObserver is **not** among them. `observeScrubReset` runs the reset closure `setupTouchSwipeNavigation` returns, which restores the image to frame 0 but never touches `activeIndicator` — a card that scrolls out and back gets its icon back through the scroll trigger it necessarily crossed, not through the observer.

The last two are called once per view from the Grid and Masonry constructors, alongside the other container-level pointer wiring. They live for the view's lifetime rather than a render's: `containerEl` is created once and only emptied on re-render, so one delegated listener covers every card without accumulating, and `register`/`registerEvent` tear both down with the view.

Two details are load-bearing. The tap listener uses **capture phase** — card handlers call `stopPropagation()`, so a bubble-phase listener on the container would never see a tap that landed on a card. And it listens for **`pointerdown`, not `click`**, so it also fires for a tap that turns into a scroll or a long press. Taps inside `.card-cover` or `.card-thumbnail` are skipped: the user may still be working that image.

Only the wiring is platform-gated — a touch swipe is the only thing that hides the icon. `restoreActiveIndicator()` itself is platform-agnostic, so the existing paths can share it.

Both modes go through the same slot. `setupTouchSwipeNavigation` (scrub) and `setupSwipeGestures` (slide) each call `claimIndicator()` immediately before adding `dynamic-views-icon-hidden`, which are the only two places in `src/` that add the class. Each also registers its restore through `addScrollIndicatorRestore()`, so a view with covers in both modes still carries one throttled scroll listener, not one per cover. Exclusivity therefore holds across modes: a swipe in Slide mode restores an icon a swipe in Scrub mode hid, and the reverse. Note that Scrub is both a mode name and the name of the hover mechanism — here it is the mode.

The gates stay at the call sites, and they are not the same gate. Slide checks the `is-mobile` body class before hiding and before registering its scroll restore; scrub reaches the hide only through `isTouchPointer(e)` and registers its scroll restore unconditionally. The shared module is deliberately platform-agnostic and imposes neither.

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

### Global tracking (`brokenImageUrls` in [image-loader.ts](../../src/core/image-loader.ts))

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

When broken images are detected and only 1 valid image remains, `.slideshow-single` is added to the slideshow wrapper. CSS hides the slideshow icon and both nav arrows.

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

`setupHoverIntent()` in [hover-and-touch.ts](../../src/core/hover-and-touch.ts) requires a `mousemove` event after `mouseenter` to activate. Prevents false triggers when elements scroll under a stationary cursor.

- **Wheel gesture guard**: On hover-capable devices (`(hover: hover)`), wheel events in `setupSwipeGestures` require `.interact` on the card before processing. Touch-primary devices bypass the guard (hover intent is never set up there). When the guard blocks an event, all gesture state is reset to prevent stale accumulation.
- **Arrow visibility**: Hover-only, with no style setting to change it — gated by the `.interact` class on the card (set by the shared hover intent system in both renderers)
- **Image preload**: Fires on hover intent activation (deduped with `preloadGuard`)
- **Hover zoom eligibility**: `.hover-zoom-eligible` set on `mouseenter` to the current image, cleared from all images on `mouseleave` — unless the card carries `viewer-active`, since the open viewer overlay fires `mouseleave` on a card the pointer never left, and dropping eligibility there replays the zoom-in when the viewer closes — cleared from old image (now `.slideshow-img-next`) after animation completes via the callback returned by `setupHoverZoomEligibility()`. Covers only — thumbnails do not zoom — and the card, not the image, is the session boundary.
- **Zoom cancel**: a frame change drops the zoom outright instead of easing out of it. `cancelHoverZoom()` adds `.zoom-cancel` — which suppresses the scale transition — before removing `.hover-zoom-eligible`, so the scale lands back at 1 within a single recalc rather than animating a zoom-out over the frame the pointer just moved to. The next `mouseenter` strips `.zoom-cancel` from every frame in the same recalc that marks the current one eligible, so a fresh hover animates normally.

## Visibility reset

The IntersectionObserver that watches the slideshow container lives in the renderer ([src/bases/shared-renderer.ts](../../src/bases/shared-renderer.ts)), NOT in [slideshow.ts](../../src/core/slideshow.ts):

1. Track `wasHidden` flag (initially `false`)
2. On not intersecting: set `wasHidden = true`
3. On intersecting AND `wasHidden`: set `wasHidden = false`, call `reset()`

The renderer uses `getOwnerWindow(slideshowEl).IntersectionObserver` to construct the observer from the correct window context (popout window support).

### `reset()` behavior

`reset()` returns early if `isAnimating` is true. Otherwise it finds the first non-broken image index, sets `currentIndex`, clears `failedIndices`, clears `lastWrapFromFirstTimestamp` and updates the current image `src`. It also fires the `onSlideChange` callback via a `load` event listener on the current image after setting the new `src`.

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

Abort closure `() => controller.abort()` pushed to `slideshowCleanups[]` array (`(() => void)[]`) on the `SharedCardRenderer` instance. On batch cleanup or per-card teardown: iterate and call each cleanup function.

Abort behavior:

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
| `MAX_MULTI_IMAGES`       | 10    | Cap on images per multi-image cover or thumbnail  |
| `UNDO_WINDOW_MS`         | 2500  | First-to-Last-to-First undo detection window (ms) |
| `WHEEL_SWIPE_THRESHOLD`  | 5     | Accumulated deltaX to trigger navigation          |
| `WHEEL_GESTURE_GAP_MS`   | 150   | Quiet period for gesture end detection (ms)       |
| `TOUCH_SWIPE_THRESHOLD`  | 30    | Touch distance to trigger navigation (px)         |
| `SWIPE_DETECT_THRESHOLD` | 16    | Minimum movement to classify swipe direction (px) |
| `WHEEL_DECAY_RATIO`      | 0.3   | Decay phase entry (30% of peak)                   |
| `WHEEL_DECAY_MIN_EVENTS` | 5     | Events before decay is confirmed                  |
| `WHEEL_RESUME_RATIO`     | 3     | Acceleration ratio for new gesture detection      |
| `WHEEL_RESUME_DELTA`     | 15    | Absolute acceleration threshold                   |
| `BLOB_CACHE_LIMIT`       | 150   | Max external blob URL cache entries               |
| `SCROLL_THROTTLE_MS`     | 100   | Scroll event throttle for icon restore (ms)       |

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
11. **Wheel gesture guard matches hover intent gate.** The renderer gates `setupHoverIntent` behind `matchMedia('(hover: hover)')`. The wheel guard in `setupSwipeGestures` uses the same media query — if one is skipped, both are.
12. **Gesture state reset on hover intent guard.** When the wheel handler's hover intent guard blocks an event, `accumulatedDeltaX`, `navigatedThisGesture`, `lastDeltaX`, `gestureResetTimeout`, and decay state are all reset. Without this, stale state from blocked events would leak into the next accepted gesture.
13. **At most one indicator hidden at a time.** `activeIndicator` is a single module-scope reference, not a set — `claimIndicator()` restores the previous one before taking it. Calling `restoreActiveIndicator()` when nothing is hidden is a no-op.
14. **One `activeIndicator` in the codebase.** It lives only in `multi-image-icon.ts`; scrub and slide both mutate it through that module's exports. A second copy in either engine would silently break exclusivity between the modes.
