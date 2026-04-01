---
title: Full screen
description: Bridge+settle system (iOS) and scroll-linked bridge unwind (Android) for hiding/showing bars during scroll, gradient swap mask-image management, direction detection algorithm, height locking, tap shield, and platform-specific branches.
author: 🤖 Generated with Claude Code
updated: 2026-04-01
---
# Full screen

Hides Obsidian UI bars on downward scroll in Dynamic Views card views on phone. Bar animations match native Obsidian full screen. iOS uses a bridge architecture (`margin-top` on scroll child) to defer layout mutations to scroll-idle. Android uses WAAPI animations with a scroll-linked `transform` show bridge that unwinds as the user approaches the top.

For empirical research, rejected approaches, and prototype history, see `dev/full-screen.md`.

## UX requirements

Non-negotiable. Reject any implementation that violates these, regardless of technical convenience.

1. **No false top**: Scrolling up must reach the true top (`scrollTop=0`, no offset) in a single gesture. No wall, no pause, no hidden content above the viewport.
2. **No false bottom**: Scrolling down must reach the true bottom. Last card and end indicator fully accessible.
3. **Atomic bar transitions**: All bar elements (header, toolbar, search row, navbar, mask-image gradient) must appear and disappear together. No delayed individual elements.
4. **No show jank**: Show transition must not produce visible jank — no white flash, no content jump, no dropped frames.
5. **No momentum kill**: Hide and show transitions must not interrupt scroll momentum on either platform.

## Files

| File | Role |
|---|---|
| `src/bases/full-screen.ts` | Full screen controller — scroll listener, direction detection, hide/show/settle logic |
| `src/shared/constants.ts` | Tuning constants (`FULL_SCREEN_*`) |
| `styles/_full-screen.scss` | `full-screen-active`, `full-screen-showing` (iOS only), and `data-dynamic-views-show` (Android only) rules |

## Debug access

Runtime path to the FullScreenController:

`leaf.view.controller.view.fullScreen`

Where `leaf` is any Bases leaf from `app.workspace.iterateAllLeaves()`.

## System overview

On phone, Bases card views have a fixed header, a static toolbar (`.bases-header`), an optional search row, and a fixed navbar. Native Obsidian full screen works in Markdown views (driven by CodeMirror's internal `markdown-scroll` event) but not in Bases views — Bases does not fire that event. The plugin implements its own scroll-driven bar management.

### Bases vs Markdown constraint

Native `is-hidden-nav` handles header and navbar hide/show for both view types. But Bases views additionally require:

1. **Toolbar collapse** — `.bases-header` must be hidden (transform + margin collapse)
2. **99px margin-top gap fill** — `.view-content` has ~99px `margin-top` compensating for the fixed header; removing it requires layout mutation

These are layout changes (reflow) that conflict with iOS momentum scroll. Markdown views do not need them — content reflow is minimal (just header/navbar transform). The bridge+settle architecture exists specifically to defer these layout mutations to scroll-idle.

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

## Mask-image gradient swap

Both platforms use a gradient swap on `.workspace-split.mod-root` to avoid destroying the compositor render surface during hide/show transitions.

- **Constructor**: Caches Obsidian's mask-image gradient via `getComputedStyle` into `cachedMaskImage`.
- **Hide**: Sets `OPAQUE_MASK` (`linear-gradient(rgb(0,0,0),rgb(0,0,0))`) — a fully-opaque gradient that produces no visual masking but keeps the render surface allocated.
- **Show**: `restoreMaskImage()` swaps back to `cachedMaskImage`. This is a gradient-to-gradient swap — the compositor updates the mask texture without recreating the render surface. Safe during momentum scroll.
- **Unmount / iOS idle**: `clearMaskImageInline()` fully removes the inline properties. This is a structural compositor change (property removal vs value swap) and is only safe when not scroll-concurrent.

Without the gradient swap, removing mask-image (`none` to CSS gradient) destroys and recreates the ~66MB render surface, forcing full subtree rasterization that exceeds the single-threaded compositor frame budget.

## Bridge + settle architecture

The bridge resolves the fundamental conflict on iOS: hiding bars requires layout mutations (margin, toolbar collapse), but layout mutations during iOS momentum scroll kill the momentum.

- The bridge applies `margin-top` on the scroll child (`.dynamic-views-bases-container`) to visually compensate for the layout shift.
- Unlike `translateY` (which displaces visually without changing `scrollHeight`), `margin-top` adjusts `scrollHeight` in sync with visual displacement — the coordinate space stays aligned, eliminating false top/bottom at scroll boundaries.
- Real layout changes swap in at scroll-idle.
- **Android does NOT use a margin bridge on hide.** Hide: Chromium's compositor tolerates `scrollTop` writes during active touch scroll (but NOT during flings — `scrollTop` kills flings). Show: uses a `transform: translateY(-totalShift)` bridge on the container (compositor-only, no layout invalidation) that unwinds scroll-linked as the user approaches the top.

### Hide sequence

#### iOS (bridge + deferred settle)

1. **Immediate (momentum-safe)**: Apply `full-screen-active` class on leafContent (not body — scopes style invalidation to the leaf subtree instead of the full document). Apply inline background-color on body/app-container/workspace (unreachable from leaf class). Apply `margin-top: totalShift` bridge on scroll child (`.dynamic-views-bases-container`) — increases `scrollHeight` to keep coordinate space aligned. Set opaque mask-image gradient. Animate navbar via inline styles using the double-rAF pattern (transition + target in separate frames — WebKit's passive scroll listener optimization collapses them otherwise). Hide Capacitor status bar.
2. **Idle (2000ms debounce)**: Remove `margin-top` bridge, `scrollTop -= totalShift`, set tap-shield inlines on header (`transform: translateY(0)`, `opacity: 0`, `margin-top: 0`), unlock-measure-relock height. `settled = true`.

#### Android (WAAPI + bridge-less)

1. **Immediate**: Cancel pending show rAF and WAAPI animations. Clear show-state inlines and show bridge transform. Pin header/toolbar/search at visible position via inline `!important` styles (prevents flash during class application). Remove height lock. Apply `full-screen-active` class. If `bridgePhaseActive` is false, `scrollTop -= totalShift` (clamped to 0). If `bridgePhaseActive` is true, skip scrollTop adjustment (scrollTop was never increased during show). Clear `bridgePhaseActive`. `settled = true` immediately. Set opaque mask-image gradient. Defer height relock to idle via `pendingLayout`. Hide Capacitor status bar.
2. **rAF**: Clear `programmaticScroll`. Cancel any running show animations. Remove header/toolbar/search inline pins. Start WAAPI hide animations — separate transform + opacity for header and navbar (per-property timing matches native), opacity-only for toolbar and search. `fill: 'forwards'` holds final frame. Header WAAPI `onfinish` sets tap-shield inlines: `transform: translateY(0)`, `opacity: 0`, `margin-top: 0` (snaps header to natural position as invisible tap absorber). Set `pointer-events: none` on navbar.
3. **Idle**: Height relock only — `offsetHeight` read deferred to `requestIdleCallback` (with `setTimeout` fallback) to avoid forcing synchronous layout during the animation window.

### Show sequence

#### iOS (bridge + deferred settle)

1. **Immediate**: Add `full-screen-showing` CSS class on `leafContent`. If not settled (hide bridge still active), remove `margin-top` bridge — bridge removal and bar restoration cancel geometrically (zero net visual shift). If settled, no bridge needed — content shifts down naturally as bars reappear (same as Safari address bar behavior). Restore navbar via inline styles — the inline `transition` from hide persists, producing an animated reveal. Restore mask-image gradient via `restoreMaskImage()` (gradient swap, safe during momentum). Show Capacitor status bar. Toolbar and search fade in via WAAPI in rAF.
2. **Idle (2000ms debounce)**: Remove `margin-top` bridge. If settled, `scrollTop += totalShift`. Cancel WAAPI animations. Remove `full-screen-showing` class. Clear header inlines (tap-shield removal). Remove `full-screen-active` class. `isActiveHider = false`. Fully remove mask-image inline via `clearMaskImageInline()`. Clear navbar inlines. `settled = false`. Unlock-measure-relock height.

#### Android (scroll-linked show bridge)

1. **Immediate**: Set `programmaticScroll = true`. Clear tap-shield inlines on header (must happen before reading WAAPI "from" values — `onfinish` sets `transform: translateY(0)` which would be read as animation start). Read WAAPI "from" values from `fill: forwards` state before rAF.
2. **rAF**: `applyShowInlines()` restores `margin-top`, toolbar, search row, header pointer-events/z-index via inline `setProperty()` calls (bypasses `classList` to avoid style invalidation). Sets `data-dynamic-views-show` attribute on `leafContent` for `::before` scrim and `::after` scroll gradient CSS rules. If settled, set `transform: translateY(-totalShift)` on container (compositor-only show bridge) and `bridgePhaseActive = true`. Restore mask-image gradient via `restoreMaskImage()`. Clear `programmaticScroll`. Start show WAAPI animations BEFORE canceling old animations (later-created animations have higher composite priority per WAAPI section 4.6). Header + navbar: transform + opacity. Toolbar + search: opacity only. Cancel old WAAPI animations after new ones start. Defer Capacitor status bar show to next rAF (separates window inset change from CSS layout reflow).
3. **Scroll-linked unwind**: On each scroll event while `bridgePhaseActive && !barsHidden`, `unwindBridge(scrollTop)` reduces the bridge transform via smoothstep easing over a zone of `lockedScrollHeight` (pane height). Transform writes are compositor-only — safe during fling. A `lastBridgePx` field skips no-op writes when the rounded value hasn't changed.
4. **Idle (500ms or 50ms at top)**: Cancel WAAPI animations. Remove `data-dynamic-views-show` attribute. Clear navbar and header inlines. If `scrollTop <= 1` (bridge already unwound to 0), `commitBridgeResolve()` does full cleanup: removes `full-screen-active`, clears show inlines, clears mask-image, resets flags, relocks height. Otherwise, show inlines and `full-screen-active` persist until the next hide.

### Scroll-linked bridge unwind (Android)

The Android show path does NOT keep the bridge at constant magnitude. Instead:

- **Show rAF** sets `transform: translateY(-totalShift)` on the container — compositor-only, no layout/raster invalidation. `bridgePhaseActive = true`.
- **Per scroll event** while `bridgePhaseActive`, `unwindBridge(scrollTop)` reduces the bridge magnitude via smoothstep easing. The zone is `lockedScrollHeight` (pane height, so the non-1:1 motion spreads across the full visible scroll distance). By `scrollTop=0`, the bridge is `translateY(0)` — no false top.
- **At `scrollTop <= 1`**: A `FULL_SCREEN_BRIDGE_RESOLVE_DELAY_MS` (50ms) timer schedules `commitBridgeResolve()` — full cleanup (class removal, show inline removal, height relock). This is a visual no-op since the transform is already 0.
- **`bridgePhaseActive` stays true** until `commitBridgeResolve()` or `hideBarsUI()`. The flag means "Android show state needs cleanup", not "bridge has non-zero transform". The hide path checks it to skip `scrollTop` reversal (scrollTop was never increased during show).

This architecture exists because Chrome/146 WebView's single-threaded compositor flashes content for one frame during any `scrollTop` write (tile re-rasterization), and `scrollTop` writes also kill active Chromium flings. The scroll-linked unwind eliminates both the false top and all show-path `scrollTop` writes.

### `totalShift` measurement

`totalShift` is initially measured at mount time: toggle `full-screen-active` class, read `getBoundingClientRect().top` before/after on the scroll container, then remove the class.

**Mount-time measurement bug**: `getBoundingClientRect` returns 0 when `[data-type='bases']` CSS selectors do not match at construction time (the leaf has not received its `data-type` attribute yet). The `measureTotalShift()` method provides the authoritative re-measurement from live DOM: `getComputedStyle(viewContent).marginTop + toolbar.offsetHeight + searchRow.offsetHeight`. It is called in the hide threshold check (before `hideBarsUI()`) and again inside `hideBarsUI()` itself, and is gated on `!body.classList.contains('full-screen-active')` (otherwise `marginTop` reads as 0 from the class rule).

### Why a bridge

Direct `scrollTop` compensation is impossible on iOS — `scrollTop` writes kill scroll unconditionally (during momentum, active touch, and idle). See `webkit-compositor-constraints.md` for details. The bridge uses `margin-top` on the scroll child to visually cancel the layout shift. Unlike the previous `translateY` approach, `margin-top` adjusts `scrollHeight` in sync with visual displacement — the coordinate space stays aligned, so there are no false top/bottom at scroll boundaries. At idle when no scroll is active, the margin is removed and a real `scrollTop` adjustment takes its place.

## Header tap intercept

A separate `onHeaderTap()` handler listens for `touchend` (passive) on `.view-header`. When bars are hidden, the header element is positioned as an invisible tap shield in the status bar zone (via inline `transform: translateY(0)`, `opacity: 0`, `margin-top: 0`). Tapping this zone reveals bars.

- **Guard**: Fires only when `barsHidden` is true.
- **Action**: Sets `lastToggleTime` before calling `showBarsUI()` — prevents cooldown from being bypassed.
- **CSS support**: `.view-header` has a `min-height` covering `safe-area-inset-top + view-header-height` during `full-screen-active` to ensure the tap target covers the full status bar zone.

### Tap shield setup

Both platforms set identical tap-shield inlines on the header after hide completes:

- **Android**: Set in the header WAAPI `onfinish` callback (after hide animation completes).
- **iOS**: Set in the hide settle `pendingLayout` (after 2000ms idle).

The inlines are `transform: translateY(0)` (returns header to natural position from off-screen), `opacity: 0` (invisible), and `margin-top: 0` (overrides Obsidian's `safe-area-inset-top` margin so shield covers from y=0). This matches native Obsidian full-screen behavior.

Tap-shield inlines are cleared by `clearHeaderInlines()` during the show path — on iOS in the show idle `pendingLayout`, on Android via `clearHeaderInlines()` called after starting show WAAPI.

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
| `FULL_SCREEN_ANIM_MS` | 300ms | Header/navbar slide and toolbar/search fade duration |
| `FULL_SCREEN_FADE_MS` | 200ms | Header/navbar opacity fade duration |

### Adaptive auto-show zone

When the hide bridge is active (`!settled`) and the user is scrolling upward (`accumulatedDelta < 0`), the auto-show zone expands from `FULL_SCREEN_TOP_ZONE` (50px) to `totalShift` (~150px). This prevents the margin gap (empty space at the top of the scroll range created by the bridge) from becoming visible. Bridge removal and bar restoration cancel geometrically — the scroll child's `margin-top` removal shifts content up by `totalShift`, while `full-screen-showing` restoring `.view-content` margin shifts the scroll container down by `totalShift`. Net visual shift is zero.

The expansion only activates during upward scroll to prevent hide-then-auto-show cycling: bars hide at ~80px (TOP_ZONE + HIDE_DEAD_ZONE), well below `totalShift`. During downward scroll (`accumulatedDelta >= 0`), the normal 50px zone applies. After settle, the bridge is removed and the normal zone applies in all directions.

### Sustain gate

The sustain gate (`Date.now() - directionChangeTime >= FULL_SCREEN_SHOW_SUSTAIN_MS`) prevents false triggers from deceleration bounce — short-lived delta reversals at the end of a fling. Applied to BOTH hide and show on iOS:

- **Scroll-down deceleration**: Brief upward delta produces false show trigger.
- **Scroll-up deceleration**: Brief downward delta produces false hide trigger.

Skipped on Android — Chromium fling decelerates monotonically (no bounce).

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

The locked `height` does not truly constrain the scroll container because `.bases-view` has `flex: 1` in Obsidian's layout. The inline `height` acts as a `flex-basis` hint that WebKit respects during the brief transition period. True locking with `flex: 0 0 auto` was rejected — it creates a visible gap strip at the bottom of the viewport when bars are hidden.

### Android height lock persistence

On Android, the height lock is NOT unlocked during show idle. Unlocking triggers scroll layer raster invalidation that flashes on Chrome/146. The stale height lock (bars-hidden value) persists — the extra `totalShift` pixels of scroll space are negligible on top of the ~50% scroll-past-end padding. Height is only unlocked at unmount or the next hide cycle.

## Tap-to-reveal

When bars are hidden, tapping reveals them. The `onTouchEnd` handler (passive `touchend` on scroll container) detects taps (< 10px movement, < 300ms duration) and decides whether to show bars or defer to the card's own click handler.

### Exemptions

Certain tap targets must NOT reveal bars — their tap has a dedicated function handled by the card's `click` event (which fires after `touchend`):

| Target | Selector | Reason |
|---|---|---|
| **Cover image** | `.card-cover` | Opens image viewer |
| **Thumbnail** | `.card-thumbnail` | Opens image viewer |
| **Poster card with image** | `.image-format-poster.has-poster` | Toggles `poster-revealed` |
| **Group collapse region** | `.bases-group-collapse-region` | Triggers fold/unfold |

Cover/thumbnail exemption has one exception: if image viewer is disabled (`dynamic-views-image-viewer-disabled`) AND open action is "press on title" (`dynamic-views-open-on-title`), the image tap is non-interactive, so bars reveal.

Poster exemption is unconditional — poster tap-to-reveal is always active on mobile, independent of image viewer.

### Bar reveal conditions

After exemptions, bars show when:

1. **Tap outside a card** — `!target.closest('.card')`
2. **Open-on-title mode, non-title tap** — card body is non-interactive, so tap reveals bars. Title link taps (`.card-title a`) are exempt (they open the file).

In open-on-card mode, card body taps do not reveal bars — the card's click handler opens the file.

## Platform branches

### iOS

- **Settle delay**: `FULL_SCREEN_SCROLL_IDLE_MS = 2000ms`. Outlasts the native scroll indicator fade (~1.5s after last scroll event), making the settle's `scrollTop` write invisible.
- **Sustain gate**: 80ms on both directions. Required because iOS momentum produces deceleration bounce (brief delta reversals).
- **Double-rAF**: Required for bar hide animations. WebKit's passive scroll listener optimization collapses transition + target into one style recalc without it. See `webkit-compositor-constraints.md`.
- **Show path**: Synchronous class toggle — no two-frame split. Navbar animates via the inline `transition` persisting from hide. Header animates via Obsidian's native `.view-header` transition (not suppressed on iOS). Toolbar and search fade in via WAAPI in rAF.
- **Mask-image**: `restoreMaskImage()` called synchronously in the show path (gradient swap is safe during momentum). `clearMaskImageInline()` called at show idle (structural removal only safe at rest).
- **Show idle cleanup**: `clearHeaderInlines()` removes tap-shield inlines before removing `full-screen-active`. `isActiveHider` set to false. Full class and inline cleanup.
- **Scroll indicator**: Jumps when bars hide/show because the scroll container's effective height changes. Matches Safari's native address bar behavior. Accepted.

### Android

- **Bridge-less hide**: Class toggle + `scrollTop` adjustment in the same synchronous tick. Chromium's compositor tolerates mid-scroll `scrollTop` writes (unlike iOS where they are unconditionally fatal). `settled = true` immediately. No deferred settle needed.
- **Scroll-linked show bridge**: Show rAF sets `transform: translateY(-totalShift)` on container (compositor-only). Per scroll event, `unwindBridge()` reduces the bridge via smoothstep easing over `lockedScrollHeight`. At `scrollTop=0`, bridge is already 0 — no false top. Idle cleanup at top is a visual no-op. Eliminates Chrome/146 flash from `scrollTop` tile re-rasterization.
- **`scrollTop` kills Chromium flings**: ANY `scrollTop` write during an active Chromium compositor fling cancels the fling entirely. This extends the iOS constraint (`scrollTop` kills momentum) to Android during flings. `scrollTop` writes during active touch (finger on screen) are safe.
- **WAAPI animations**: Header and navbar hide/show use `element.animate()` (Web Animations API). WAAPI gets better compositor scheduling on the single-threaded WebView compositor. `fill: 'forwards'` holds the final frame. Animations are cancelled before starting new ones (rapid cycling safety).
- **Show WAAPI ordering**: Show WAAPI animations are started BEFORE canceling old hide animations. Later-created animations have higher composite priority per WAAPI section 4.6 — canceling hide first would snap elements visible for one frame before show starts.
- **Split CSS rules**: iOS keeps `!important` transform/opacity in CSS class rules. Android CSS only sets `pointer-events` + `transition: none` — transform/opacity are controlled entirely via JS/WAAPI. WAAPI animation effects are lower in the cascade than `!important` author declarations.
- **`will-change` pre-promotion**: Navbar gets mount-time pre-promotion via inline `will-change: transform, opacity` (set in constructor). Header's `will-change` is in the `.full-screen-active` CSS rule. Both eliminate the first-transform layer promotion stall.
- **Show inline bypass**: `applyShowInlines()`/`clearShowInlines()` restore bars via inline `setProperty()` calls, bypassing `classList` entirely to avoid style invalidation that exceeds the single-threaded WebView compositor's frame budget.
- **`data-dynamic-views-show` attribute**: Set on `leafContent` for `::before` scrim and `::after` scroll gradient CSS rules. Attribute selectors only recalc matching pseudos, not descendants.
- **Settle delay**: `FULL_SCREEN_SCROLL_IDLE_ANDROID_MS = 500ms`. Used for show idle cleanup (animation cancel, attribute removal, navbar/header inline clear).
- **Sustain gate**: Bypassed. Android Chromium fling decelerates monotonically (no bounce).
- **Single-rAF**: Bar hide uses a single `requestAnimationFrame` (not double-rAF). Chromium does not collapse transitions in passive listeners.
- **`programmaticScroll` deadlock**: `programmaticScroll = true` blocks ALL scroll events in `onScroll`. If not cleared promptly (via rAF), the idle timer never fires and `pendingLayout` never runs — bars can only hide once. The rAF clear after `scrollTop` writes is load-bearing.
- **Scrollbar**: Never auto-fades. Scrollbar resize during settle is always visible — accepted as inherent to the platform.

#### WebView compositor limitation

Android WebView uses a single-threaded (synchronous) compositor — the impl thread and UI thread are the same thread. This is a fundamental architectural difference from desktop Chrome and iOS WKWebView, both of which have separate compositor threads/processes that handle animations concurrently with scroll processing.

The practical impact: CSS transitions during active scroll compete with scroll processing for the same thread, causing 30-55ms frame gaps (2-3 dropped frames at 60fps). WAAPI gets better compositor scheduling than CSS transitions but does not fully eliminate contention — this is a WebView architectural limitation, not fixable at the application level.

## Invariants

1. **Momentum safety (iOS)**: NEVER write `scrollTop` during momentum or active touch. `scrollTop` writes are only safe at true scroll-idle (detected via scroll debounce, NOT `scrollend` on WebKit).
2. **Bridge math (iOS only)**: `margin-top: totalShift` on hide (positive margin increases `scrollHeight`). On show, the hide bridge is removed when unsettled (geometric cancellation); no bridge is applied when settled — bars reappear naturally. Bridge and `scrollTop` adjustment must use the same `totalShift` value. Android uses scroll-linked `transform` bridge on show (unwinds to 0 at the top), `scrollTop` on hide.
3. **No pre-promotion needed**: The `margin-top` bridge does not involve compositor layers, so no `transform: translateY(0)` pre-promotion is required at initialization.
4. **Cooldown accumulator reset**: `accumulatedDelta` must be reset to 0 on every scroll event during cooldown. Layout-induced synthetic deltas (~250px) would otherwise trigger the opposite transition immediately.
5. **Height lock lifecycle**: Lock at hide time. iOS: unlock-measure-relock at settle, unlock at full show cleanup. Android: height lock persists through show — NOT unlocked at show idle. Only unlocked at the next hide or unmount.
6. **Programmatic scroll guard**: `scrollTop` writes must set a `programmaticScroll` flag. The scroll handler must check this flag and skip processing. On Android, the flag MUST be cleared in the next rAF — blocking it longer prevents the idle timer from firing `pendingLayout`, causing a deadlock.
7. **No `will-change: transform` on scroll containers**: Breaks scroll event detection on child containers. Use `transform: translateY(0)` for pre-promotion instead.
8. **Instant layout only**: Layout mutations during scroll must use `transition: none`. Animated transitions (any duration > 0) cause continuous relayout that kills momentum.
9. **`measureTotalShift()` before hide**: Mount-time `getBoundingClientRect` may return 0 if CSS selectors do not match at construction time. `measureTotalShift()` must be called before any hide to ensure the authoritative value. Only valid when `full-screen-active` is NOT on the class target (body on Android, leafContent on iOS).
10. **Android: no direct class removal on show**: `classList.remove('full-screen-active')` without restoring bars first causes a white flash — Chromium renders the intermediate 99px margin gap. Always use `applyShowInlines()` + `data-dynamic-views-show` attribute to restore bars visually. Class removal does NOT happen at show idle — it stays until the next hide.
11. **Android: no `!important` transform/opacity in CSS**: WAAPI animation effects are lower in the cascade than `!important` author declarations. Android header/navbar transform and opacity must NOT be in CSS `!important` rules — they are controlled entirely via WAAPI and inline styles.
12. **WAAPI cancel before animate**: WAAPI animations must be cancelled before starting new ones. Rapid hide/show cycling without cancellation causes animation stacking and visual corruption.
13. **Android bridge lifecycle**: Show bridge starts at `translateY(-totalShift)` and unwinds scroll-linked as the user approaches the top. `bridgePhaseActive` stays true until `commitBridgeResolve()` (at `scrollTop=0` idle) or `hideBarsUI()`. The hide path checks `bridgePhaseActive` to skip `scrollTop` reversal (scrollTop was never increased during show). `scrollTop` is never written during show.
14. **`restoreMaskImage()` in show path (both platforms)**: `restoreMaskImage()` runs in the show rAF (Android) or synchronously (iOS). Gradient swap keeps the render surface allocated. Deferring to idle violates UX requirement 3 (atomic bar transitions) — the navbar gradient appears late.
15. **`data-dynamic-views-show` selectors must terminate on pseudos**: The `[data-dynamic-views-show]` attribute on `leafContent` triggers CSS rules for `::before`/`::after` pseudos only. Selectors using this attribute MUST terminate on a pseudo-element — if they match real descendants, the attribute change triggers subtree-wide style recalc that exceeds the Android WebView compositor frame budget.
16. **Tap shield cleared before show WAAPI**: On Android, tap-shield inlines (`transform`, `opacity`, `margin-top`) on the header must be cleared before reading WAAPI "from" values. Otherwise `onfinish`'s `transform: translateY(0)` is read as the animation start, producing a fade-only transition with no slide.
17. **Android: `scrollTop` kills flings**: ANY `scrollTop` write during an active Chromium compositor fling cancels the fling. `scrollTop` writes during active touch (finger on screen) are safe. The scroll-linked bridge unwind avoids all `scrollTop` writes during show.
18. **Android: `unwindBridge` is compositor-only**: Per-scroll-event `transform` writes in `unwindBridge()` do not trigger layout or tile invalidation. A `lastBridgePx` change-detection field skips no-op writes when the rounded value hasn't changed (avoids redundant `setStyle` calls on the single-threaded compositor).
19. **iOS: `full-screen-active` on leafContent, not body**: iOS applies the `full-screen-active` class to `leafContent` (`[data-type='bases']`) instead of body. This scopes style invalidation to the leaf subtree (~360 elements) instead of the entire document (~3000+). Body-class invalidation on WKWebView triggers 60-96ms compositor operations with poster cards. Three elements outside the leaf (body, `.app-container`, `.workspace`) receive inline `background-color` via `applyBackgroundInlines()`/`clearBackgroundInlines()`. Android keeps the body class — Chromium's multi-threaded compositor handles the invalidation without frame drops.
