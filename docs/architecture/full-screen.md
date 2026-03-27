---
title: Full screen architecture
description: Bridge+settle system (iOS) and WAAPI-driven bridge-less path (Android) for hiding/showing bars during scroll, direction detection algorithm, height locking, settle sequence, short-view guard, WebView compositor limitation, and platform-specific branches.
author: "\U0001F916 Generated with Claude Code"
updated: 2026-03-27
---
# Full screen architecture

Full screen hides the header, toolbar, search row, and navbar during downward scroll in Bases card views on mobile, reclaiming screen space for content. On iOS, the system uses a bridge+settle architecture: `margin-top` on the scroll child adjusts `scrollHeight` in sync with visual displacement, preventing false scroll boundaries during momentum scroll, followed by real layout changes at scroll-idle. On Android, a bridge-less hide path applies class toggle + `scrollTop` adjustment synchronously (Chromium's compositor survives `scrollTop` writes during active scroll), with bar animations driven by WAAPI (`element.animate()`) for better compositor scheduling on the single-threaded WebView compositor. The show path uses a reverse bridge (`margin-top: -totalShift`) to avoid a synchronous `scrollTop` write that exceeded one frame budget on Pixel 8a. Direction detection uses a temporal-spatial hybrid algorithm with dead zones, a sustain gate, and a cooldown to prevent false triggers. This doc covers the stable architecture — for empirical research, rejected approaches, and prototype history, see [full-screen.md](../dev/full-screen.md).

## Files

| File | Role |
|---|---|
| `src/bases/full-screen.ts` | Full screen controller — scroll listener, direction detection, hide/show/settle logic |
| `src/shared/constants.ts` | Tuning constants (`FULL_SCREEN_*`) |
| `styles/_full-screen.scss` | `full-screen-active` and `full-screen-showing` class rules |

## System overview

On mobile, Bases card views have a fixed header, a static toolbar (`.bases-header`), an optional search row, and a fixed navbar. Native Obsidian full screen works in markdown views (driven by CodeMirror's internal `markdown-scroll` event) but not in Bases views — Bases doesn't fire that event. The plugin implements its own scroll-driven bar management.

### Bases vs markdown constraint

Native `is-hidden-nav` handles header and navbar hide/show for both view types. But Bases views additionally require:

1. **Toolbar collapse** — `.bases-header` must be hidden (transform + margin collapse)
2. **99px margin-top gap fill** — `.view-content` has ~99px `margin-top` compensating for the fixed header; removing it requires layout mutation

These are layout changes (reflow) that conflict with iOS momentum scroll. Markdown views don't need them — content reflow is minimal (just header/navbar transform). The bridge+settle architecture exists specifically to defer these layout mutations to scroll-idle.

## DOM structure

Bases leaf hierarchy, top to bottom:

```
.workspace-leaf-content
  .view-header              (position: fixed on phone)
  .view-content             (overflow: hidden, flex column, margin-top: ~99px)
    .bases-header           (toolbar, static flex sibling above scroll container)
    .bases-search-row       (optional)
    .bases-error
    .bases-view             (scroll container, flex: 1)
      .dynamic-views-bases-container
```

| Zone | Element | Notes |
|---|---|---|
| **Status bar** | Safe area inset (`--safe-area-inset-top`) | `.app-container` background |
| **Header** | `.view-header` | `position: fixed` on floating-nav phones |
| **Toolbar** | `.bases-header` | Static flex sibling above scroll container |
| **Search row** | `.bases-search-row` | Optional, static flex sibling |
| **Content** | `.bases-view` | Scroll container; contains `.dynamic-views-bases-container` |
| **Navbar** | `.mobile-navbar` | `position: fixed` at bottom |

"Bars" = header + toolbar + search row + navbar (all elements that hide/show).

## Bridge + settle architecture

The bridge resolves the fundamental conflict on iOS: hiding bars requires layout mutations (margin, toolbar collapse), but layout mutations during iOS momentum scroll kill the momentum. The bridge applies `margin-top` on the scroll child (`.dynamic-views-bases-container`) to visually compensate for the layout shift. Unlike `translateY` (which displaces visually without changing `scrollHeight`), `margin-top` adjusts `scrollHeight` in sync with visual displacement — the coordinate space stays aligned, eliminating false top/bottom at scroll boundaries. Real layout changes swap in at scroll-idle. Android does NOT use a bridge on the hide path — Chromium's compositor tolerates `scrollTop` writes during active scroll, so class toggle + `scrollTop` adjustment happen synchronously. The show path uses a reverse bridge (`margin-top: -totalShift`) because the `scrollTop += totalShift` write forced 22-26ms synchronous layout on Pixel 8a. Bar animations use WAAPI (`element.animate()`) for better compositor scheduling on the single-threaded WebView compositor (see Platform branches).

### Short-view guard

Before hiding, the controller checks whether the view has enough scrollable range. The guard evaluates only when `accumulatedDelta > FULL_SCREEN_HIDE_DEAD_ZONE && !barsHidden` — not on every scroll event.

- **Threshold**: `scrollableRange >= 3 * totalShift`. Pre-hide range must be at least 3x `totalShift` because hiding bars increases the viewport by `totalShift`, shrinking the scrollable range by the same amount. 3x ensures the post-hide range (2x `totalShift`) leaves meaningful scroll distance.
- **Re-measurement**: The guard calls `measureTotalShift()` to get the authoritative value before evaluating (see `totalShift` measurement below).

### Hide sequence

#### iOS (bridge + deferred settle)

1. **Immediate (momentum-safe)**: Apply `full-screen-active` CSS class (layout: `margin-top: 0`, toolbar `margin-bottom: -height`, pointer-events removal). Apply `margin-top: totalShift` bridge on scroll child (`.dynamic-views-bases-container`) — increases `scrollHeight` to keep coordinate space aligned. Lock scroll container height via inline `style.height`. Animate header/navbar via inline styles (transform + opacity) using the double-rAF pattern.
2. **Idle (debounced)**: Remove `margin-top` -> `scrollTop -= totalShift` -> re-measure height -> relock.

#### Android (WAAPI + bridge-less)

1. **Immediate**: Unlock height -> apply `full-screen-active` CSS class (sets `pointer-events: none` and `transition: none` only — NO `!important` transform/opacity in CSS) -> pin header at current position via inline `transform` (prevents flash during class application) -> `scrollTop -= totalShift` in the same synchronous tick. Chromium's compositor-based scrolling survives `scrollTop` writes during active scroll (unlike iOS WebKit where they are unconditionally fatal). `settled = true` immediately. `pendingLayout` deferred for height relock at idle.
2. **rAF**: Clear `programmaticScroll`. Animate header and navbar hide via `element.animate()` (WAAPI) — transform + opacity to hidden state. `fill: 'forwards'` holds final frame. Cancel any existing animations before starting new ones (rapid cycling safety).
3. **Idle**: Height relock deferred to idle (`requestIdleCallback` / `setTimeout` fallback). `offsetHeight` read moved out of the animation window to avoid forcing synchronous layout during the transition.

### Show sequence

#### iOS (bridge + deferred settle)

3. **Immediate**: Apply `full-screen-showing` CSS class override. If not settled (hide bridge still active), remove `margin-top` — bridge removal and bar restoration cancel geometrically (zero net visual shift). If settled, no bridge needed — content shifts down naturally as bars reappear (same as Safari's native address bar behavior); `scrollTop += totalShift` at idle compensates. Restore navbar via inline styles.
4. **Idle (debounced)**: Remove `margin-top` -> if settled, `scrollTop += totalShift` -> remove all full-screen classes -> unlock height -> re-measure -> relock.

#### Android (WAAPI + reverse bridge)

3. **Immediate**: Cancel any in-flight WAAPI animations. Apply `full-screen-showing` CSS class override (higher specificity restores bars visually — direct class removal causes white flash, see Platform branches below). Apply reverse bridge: `margin-top: -totalShift` on scroll child (`.dynamic-views-bases-container`) instead of `scrollTop += totalShift`. The `scrollTop` write forced 22-26ms synchronous layout on Pixel 8a (exceeding one 16ms frame budget), causing visible jank. The negative margin achieves the same visual offset without triggering synchronous layout. Animate header and navbar show via `element.animate()` (WAAPI) — transform + opacity to visible state. `fill: 'forwards'` holds final frame.
4. **Idle (500ms)**: Cancel WAAPI animations (cleanup) -> remove reverse bridge (`margin-top`) -> `scrollTop += totalShift` (safe at idle, no scroll contention) -> remove `full-screen-active` + `full-screen-showing` classes -> unlock height -> re-measure -> relock. Deferred via `pendingLayout`.

### `totalShift` measurement

`totalShift` is initially measured at mount time: toggle `full-screen-active` class, read `getBoundingClientRect().top` before/after on the scroll container, then remove the class.

**Mount-time measurement bug**: `getBoundingClientRect` returns 0 when `[data-type='bases']` CSS selectors don't match at construction time (the leaf hasn't received its `data-type` attribute yet). The `measureTotalShift()` method provides the authoritative re-measurement from live DOM: `getComputedStyle(viewContent).marginTop + toolbar.offsetHeight`. It is called both at guard evaluation time and inside `hideBarsUI()`, and is gated on `!body.classList.contains('full-screen-active')` (otherwise `marginTop` reads as 0 from the class rule).

### Why a bridge

Direct `scrollTop` compensation is impossible — `scrollTop` writes kill scroll unconditionally (during momentum, active touch, and idle). See `knowledge/webkit-compositor-constraints.md` for details. The bridge uses `margin-top` on the scroll child to visually cancel the layout shift. Unlike the previous `translateY` approach, `margin-top` adjusts `scrollHeight` in sync with visual displacement — the coordinate space stays aligned, so there are no false top/bottom at scroll boundaries. At idle when no scroll is active, the margin is removed and a real `scrollTop` adjustment takes its place.

## Direction detection

### Temporal-spatial hybrid algorithm

Direction detection combines accumulated scroll delta (spatial) with sustained direction duration (temporal). On each scroll event:

1. Compute `delta = currentScrollTop - previousScrollTop`
2. If delta reverses direction: reset `accumulatedDelta = 0`, record `directionChangeTime = Date.now()`
3. Add delta to `accumulatedDelta`
4. Check thresholds

### Constants

All constants are in `src/shared/constants.ts`:

| Constant | Value | Purpose |
|---|---|---|
| `FULL_SCREEN_HIDE_DEAD_ZONE` | 30px | Accumulated downward delta to trigger hide |
| `FULL_SCREEN_SHOW_DEAD_ZONE` | 20px | Accumulated upward delta to trigger show |
| `FULL_SCREEN_SHOW_SUSTAIN_MS` | 80ms | Minimum sustained direction before triggering |
| `FULL_SCREEN_TOP_ZONE` | 50px | Baseline `scrollTop` threshold for auto-show near top. Expands to `totalShift` when bridge is active and scroll direction is upward (see Adaptive auto-show zone) |
| `FULL_SCREEN_TOGGLE_COOLDOWN_MS` | 300ms | Minimum interval between hide/show transitions |
| `FULL_SCREEN_SCROLL_IDLE_MS` | 2000ms | iOS settle debounce — outlasts scroll indicator fade (~1.5s) |
| `FULL_SCREEN_SCROLL_IDLE_ANDROID_MS` | 500ms | Must exceed FULL_SCREEN_ANIM_MS (300ms) so WAAPI finishes before idle cancels |

### Adaptive auto-show zone

When the hide bridge is active (`!settled`) and the user is scrolling upward (`accumulatedDelta < 0`), the auto-show zone expands from `FULL_SCREEN_TOP_ZONE` (50px) to `totalShift` (~150px). This prevents the margin gap (empty space at the top of the scroll range created by the bridge) from becoming visible. Bridge removal and bar restoration cancel geometrically — the scroll child's `margin-top` removal shifts content up by `totalShift`, while `full-screen-showing` restoring `.view-content` margin shifts the scroll container down by `totalShift`. Net visual shift is zero.

The expansion only activates during upward scroll to prevent hide→auto-show cycling: bars hide at ~80px (TOP_ZONE + HIDE_DEAD_ZONE), well below `totalShift`. During downward scroll (`accumulatedDelta >= 0`), the normal 50px zone applies. After settle, the bridge is removed and the normal zone applies in all directions.

### Sustain gate

The sustain gate (`Date.now() - directionChangeTime >= FULL_SCREEN_SHOW_SUSTAIN_MS`) prevents false triggers from deceleration bounce — short-lived delta reversals at the end of a fling. Applied to BOTH hide and show directions:

- **Scroll-down deceleration**: brief upward delta -> false show trigger
- **Scroll-up deceleration**: brief downward delta -> false hide trigger

Without the sustain gate on hide, rapid hide/show cycling occurred during fast downward scrolls.

### Cooldown accumulator reset

During the 300ms cooldown after a toggle, scroll events still fire. The `full-screen-showing` class restores `margin-top` on `.view-content`, which causes WebKit to fire layout-induced scroll deltas (~250px compensation). Without resetting the accumulator during cooldown, these synthetic deltas leak past the cooldown and immediately trigger the opposite transition.

Fix: `accumulatedDelta = 0` on every scroll event during cooldown.

### Layout-induced scroll deltas

When `full-screen-showing` restores margin-top, WebKit compensates by adjusting scroll position, producing a large synthetic scroll delta (~250px, equal to `totalShift`). These deltas are not user-initiated but are indistinguishable from real scroll events. The cooldown accumulator reset and the `programmaticScroll` guard during settle handle both sources.

## Height locking

### Why lock

Scroll container height is locked via inline `style.height` to prevent `clientHeight` from changing during `full-screen-active`. Without locking, flex layout changes (margin removal, toolbar collapse) resize the scroll container, causing the scroll indicator to teleport.

### Unlock-measure-relock pattern

At settle time:

1. **Unlock**: Remove inline `height`
2. **Mutate**: Remove bridge, adjust `scrollTop`
3. **Measure**: Read `offsetHeight` (browser's authoritative flex-calculated value)
4. **Relock**: Set inline `height` to the measured value

Direct height calculation (`currentHeight + totalShift`) was rejected — it compounded rounding errors across rapid hide/show cycles.

### `flex: 1` override behavior

The locked `height` doesn't truly constrain the scroll container because `.bases-view` has `flex: 1` in Obsidian's layout. The inline `height` acts as a `flex-basis` hint that WebKit respects during the brief transition period. True locking with `flex: 0 0 auto` was rejected — it creates a visible gap strip at the bottom of the viewport when bars are hidden.

## Tap-to-reveal

When bars are hidden, tapping reveals them. The `onTouchEnd` handler (passive `touchend` on scroll container) detects taps (< 10px movement, < 300ms duration) and decides whether to show bars or defer to the card's own click handler.

### Exemptions

Certain tap targets must NOT reveal bars — their tap has a dedicated function handled by the card's `click` event (which fires after `touchend`):

| Target | Selector | Reason |
|---|---|---|
| **Cover image** | `.card-cover` | Opens image viewer |
| **Thumbnail** | `.card-thumbnail` | Opens image viewer |
| **Poster card with image** | `.image-format-poster.has-poster` | Toggles `poster-revealed` |

Cover/thumbnail exemption has one exception: if image viewer is disabled (`dynamic-views-image-viewer-disabled`) AND open action is "press on title" (`dynamic-views-open-on-title`), the image tap is non-interactive, so bars reveal.

Poster exemption is unconditional — poster tap-to-reveal is always active on mobile, independent of image viewer.

### Bar reveal conditions

After exemptions, bars show when:

1. **Tap outside a card** — `!target.closest('.card')`
2. **Open-on-title mode, non-title tap** — card body is non-interactive, so tap reveals bars. Title link taps (`.card-title a`) are exempt (they open the file).

In open-on-card mode, card body taps don't reveal bars — the card's click handler opens the file.

## Platform branches

### iOS

- **Settle delay**: `FULL_SCREEN_SCROLL_IDLE_MS = 2000ms`. Outlasts the native scroll indicator fade (~1.5s after last scroll event), making the settle's `scrollTop` write invisible.
- **Sustain gate**: 80ms on both directions. Required because iOS momentum produces deceleration bounce (brief delta reversals).
- **Double-rAF**: Required for bar hide animations. WebKit's passive scroll listener optimization collapses transition + target into one style recalc without it. See `knowledge/webkit-compositor-constraints.md`.
- **Show path**: Synchronous — no two-frame split.
- **Scroll indicator**: Jumps when bars hide/show because the scroll container's effective height changes. Matches Safari's native address bar behavior. Accepted.

### Android

- **Bridge-less hide, reverse bridge show**: Android hide path uses NO bridge — class toggle + `scrollTop` adjustment in the same synchronous tick. Chromium's compositor-based scrolling is resilient to `scrollTop` writes during active scroll (unlike iOS WebKit where they are unconditionally fatal). `settled = true` immediately, no deferred settle needed. Show path uses a reverse bridge (`margin-top: -totalShift` on scroll child) instead of synchronous `scrollTop += totalShift` — the `scrollTop` write forced 22-26ms synchronous layout on Pixel 8a. Bridge cleanup + `scrollTop` adjustment deferred to idle.
- **WAAPI animations**: Header and navbar hide/show use `element.animate()` (Web Animations API) instead of CSS transitions. WAAPI gets better compositor scheduling on Chromium WebView for transform+opacity animations during active scroll. `fill: 'forwards'` holds the final frame. Animations are cancelled before starting new ones (rapid cycling safety) and cancelled during idle cleanup and unmount.
- **Split CSS rules**: iOS keeps `!important` transform/opacity in CSS class rules. Android CSS only sets `pointer-events` + `transition: none` — transform/opacity are controlled entirely via JS/WAAPI. This split exists because WAAPI animation effects are lower in the cascade than `!important` author declarations — WAAPI cannot override `!important` CSS.
- **`will-change` pre-promotion**: Navbar gets true mount-time pre-promotion via inline `will-change: transform, opacity` (set in constructor). Header's `will-change` is in the `.full-screen-active` CSS rule — it activates when the class is applied (first hide), not at mount time. Both eliminate the first-transform layer promotion stall that otherwise causes a visible hitch.
- **Height relock deferred to idle**: `offsetHeight` forced layout moved out of the animation window to `requestIdleCallback` (with `setTimeout` fallback). Prevents synchronous layout during the transition frame.
- **Settle delay**: `FULL_SCREEN_SCROLL_IDLE_ANDROID_MS = 500ms`. Used only for show path class cleanup (`pendingLayout`).
- **Sustain gate**: Bypassed. Android Chromium produces less deceleration bounce than iOS and the gate is unnecessary.
- **Single-rAF**: Bar hide uses a single `requestAnimationFrame` (not double-rAF). Chromium doesn't collapse transitions in passive listeners.
- **Show path**: Uses `full-screen-showing` CSS override (higher specificity) to restore bars visually. Direct class removal (`classList.remove('full-screen-active')`) causes a white flash — Chromium renders intermediate layout states within a single synchronous tick, so the 99px `margin-top` gap appears as a white strip before `scrollTop` compensation takes effect. Reverse bridge (`margin-top: -totalShift`) replaces the synchronous `scrollTop` write. Class cleanup deferred to idle (500ms) via `pendingLayout`.
- **`programmaticScroll` deadlock**: `programmaticScroll = true` blocks ALL scroll events in `onScroll`. If not cleared promptly (via rAF), the idle timer never fires and `pendingLayout` never runs — causing a deadlock where bars can only hide once. The rAF clear after `scrollTop` writes is load-bearing.
- **Scrollbar**: Never auto-fades. Scrollbar resize during settle is always visible — accepted as inherent to the platform.

#### WebView compositor limitation

Android WebView uses a single-threaded (synchronous) compositor — the impl thread and UI thread are the same thread. This is a fundamental architectural difference from desktop Chrome and iOS WKWebView, both of which have separate compositor threads/processes that handle animations concurrently with scroll processing.

The practical impact: CSS transitions during active scroll compete with scroll processing for the same thread, causing 30-55ms frame gaps (2-3 dropped frames at 60fps). WAAPI gets better compositor scheduling than CSS transitions but does not fully eliminate contention — this is a WebView architectural limitation, not fixable at the application level.

Source: Chromium WebView threading docs, synchronous compositing design doc.

## Invariants

1. **Momentum safety (iOS)**: NEVER write `scrollTop` during momentum or active touch. `scrollTop` writes are only safe at true scroll-idle (detected via scroll debounce, NOT `scrollend` on WebKit).
2. **Bridge math (iOS only)**: `margin-top: totalShift` on hide (positive margin increases `scrollHeight`). On show, the hide bridge is removed when unsettled (geometric cancellation); no bridge is applied when settled — bars reappear naturally. Bridge and `scrollTop` adjustment must use the same `totalShift` value. Android uses no bridge.
3. **No pre-promotion needed**: The `margin-top` bridge does not involve compositor layers, so no `transform: translateY(0)` pre-promotion is required at initialization.
4. **Cooldown accumulator reset**: `accumulatedDelta` must be reset to 0 on every scroll event during cooldown. Layout-induced synthetic deltas (~250px) would otherwise trigger the opposite transition immediately.
5. **Height lock lifecycle**: Lock at hide time, unlock-measure-relock at settle, unlock at full show cleanup. Never leave height locked after all full-screen classes are removed.
6. **Programmatic scroll guard**: `scrollTop` writes must set a `programmaticScroll` flag. The scroll handler must check this flag and skip processing. On Android, the flag MUST be cleared in the next rAF — blocking it longer prevents the idle timer from firing `pendingLayout`, causing a deadlock.
7. **No `will-change: transform` on scroll containers**: Breaks scroll event detection on child containers. Use `transform: translateY(0)` for pre-promotion instead.
8. **Instant layout only**: Layout mutations during scroll must use `transition: none`. Animated transitions (any duration > 0) cause continuous relayout that kills momentum.
9. **`measureTotalShift()` before hide**: Mount-time `getBoundingClientRect` may return 0 if CSS selectors don't match at construction time. `measureTotalShift()` must be called before any hide to ensure the authoritative value. Only valid when `full-screen-active` is NOT on body.
10. **Short-view guard**: Hide must be skipped when `scrollableRange < 3 * totalShift`. Post-hide range would be only `2 * totalShift`, leaving insufficient scroll distance.
11. **Android: no direct class removal on show**: `classList.remove('full-screen-active')` without `full-screen-showing` causes a white flash — Chromium renders the intermediate 99px margin gap. Always use the `full-screen-showing` CSS override first, then defer class removal to idle.
12. **Android: no `!important` transform/opacity in CSS**: WAAPI animation effects are lower in the cascade than `!important` author declarations. Android header/navbar transform and opacity must NOT be in CSS `!important` rules — they are controlled entirely via WAAPI and inline styles.
13. **WAAPI cancel before animate**: WAAPI animations must be cancelled before starting new ones. Rapid hide/show cycling without cancellation causes animation stacking and visual corruption.
