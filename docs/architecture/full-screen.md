---
title: Full screen architecture
description: Bridge+settle system for hiding/showing bars during scroll, direction detection algorithm, height locking, settle sequence, and platform-specific branches.
author: "\U0001F916 Generated with Claude Code"
updated: 2026-03-25
---
# Full screen architecture

Full screen hides the header, toolbar, search row, and navbar during downward scroll in Bases card views on mobile, reclaiming screen space for content. The system uses a bridge+settle architecture: compositor-safe visual compensation during momentum scroll, followed by real layout changes at scroll-idle. Direction detection uses a temporal-spatial hybrid algorithm with dead zones, a sustain gate, and a cooldown to prevent false triggers. This doc covers the stable architecture — for empirical research, rejected approaches, and prototype history, see [full-screen.md](../dev/full-screen.md).

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

The bridge resolves the fundamental conflict: hiding bars requires layout mutations (margin, toolbar collapse), but layout mutations during iOS momentum scroll kill the momentum. The bridge provides immediate visual compensation using compositor-safe transforms, then swaps for real layout at scroll-idle.

### Hide sequence

1. **Immediate (momentum-safe)**: Apply `full-screen-active` CSS class (layout: `margin-top: 0`, toolbar `margin-bottom: -height`, pointer-events removal). Apply `translateY(totalShift)` bridge on scroll child (`.dynamic-views-bases-container`). Lock scroll container height via inline `style.height`. Animate header/navbar via inline styles (transform + opacity) using the double-rAF pattern.
2. **Idle (debounced)**: Remove bridge (`translateY` reset) -> `scrollTop -= totalShift` -> re-measure height -> relock.

### Show sequence

3. **Immediate**: Apply `full-screen-showing` CSS class override. If settled (bridge already removed), apply reverse bridge `translateY(-totalShift)`. Animate header/navbar back via inline styles using double-rAF.
4. **Idle (debounced)**: Remove bridge -> if settled, `scrollTop += totalShift` -> remove all full-screen classes -> unlock height -> re-measure -> relock.

### `totalShift` measurement

`totalShift` is measured once at initialization: toggle `full-screen-active` class, read `getBoundingClientRect().top` before/after on the scroll container, then remove the class.

### Why a bridge

Direct `scrollTop` compensation is impossible — `scrollTop` writes kill scroll unconditionally (during momentum, active touch, and idle). See `knowledge/webkit-compositor-constraints.md` for details. The bridge uses `translateY` on the scroll child to visually cancel the layout shift without touching `scrollTop`, then swaps for a real `scrollTop` adjustment at idle when no scroll is active.

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
| `FULL_SCREEN_TOP_ZONE` | 50px | `scrollTop` threshold — always show bars near top |
| `FULL_SCREEN_TOGGLE_COOLDOWN_MS` | 300ms | Minimum interval between hide/show transitions |
| `FULL_SCREEN_SCROLL_IDLE_MS` | 2000ms | iOS settle debounce — outlasts scroll indicator fade (~1.5s) |
| `FULL_SCREEN_SCROLL_IDLE_ANDROID_MS` | 150ms | Android settle debounce — scrollbar never fades anyway |

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

## Platform branches

### iOS

- **Settle delay**: `FULL_SCREEN_SCROLL_IDLE_MS = 2000ms`. Outlasts the native scroll indicator fade (~1.5s after last scroll event), making the settle's `scrollTop` write invisible.
- **Sustain gate**: 80ms on both directions. Required because iOS momentum produces deceleration bounce (brief delta reversals).
- **Double-rAF**: Required for bar hide animations. WebKit's passive scroll listener optimization collapses transition + target into one style recalc without it. See `knowledge/webkit-compositor-constraints.md`.
- **Show path**: Synchronous — no two-frame split.
- **Scroll indicator**: Jumps when bars hide/show because the scroll container's effective height changes. Matches Safari's native address bar behavior. Accepted.

### Android

- **Settle delay**: `FULL_SCREEN_SCROLL_IDLE_ANDROID_MS = 150ms`. Android Chromium's scrollbar never auto-fades, so the settle's `scrollTop` adjustment is visible regardless of timing. 150ms is enough for Chromium fling to fully stop (`scrollend` fires at ~1ms after last scroll event on Chromium).
- **Sustain gate**: Bypassed. Android Chromium produces less deceleration bounce than iOS and the gate is unnecessary.
- **Single-rAF**: Bar hide uses a single `requestAnimationFrame` (not double-rAF). Chromium doesn't collapse transitions in passive listeners.
- **Show path**: Synchronous — same as iOS, no two-frame split.
- **Scrollbar**: Never auto-fades. Scrollbar resize during settle is always visible — accepted as inherent to the platform.

## Invariants

1. **Momentum safety**: NEVER write `scrollTop` during momentum or active touch. `scrollTop` writes are only safe at true scroll-idle (detected via scroll debounce, NOT `scrollend` on WebKit).
2. **Bridge math**: `translateY(totalShift)` on hide, `translateY(-totalShift)` on reverse show. Bridge and `scrollTop` adjustment must use the same `totalShift` value.
3. **Pre-promotion**: Elements that receive `transform` during scroll must be pre-promoted with `transform: translateY(0)` at initialization. First-time layer promotion kills momentum.
4. **Cooldown accumulator reset**: `accumulatedDelta` must be reset to 0 on every scroll event during cooldown. Layout-induced synthetic deltas (~250px) would otherwise trigger the opposite transition immediately.
5. **Height lock lifecycle**: Lock at hide time, unlock-measure-relock at settle, unlock at full show cleanup. Never leave height locked after all full-screen classes are removed.
6. **Programmatic scroll guard**: `scrollTop` writes during settle must set a `programmaticScroll` flag. The scroll handler must check this flag and skip direction detection for the resulting synthetic scroll event.
7. **No `will-change: transform` on scroll containers**: Breaks scroll event detection on child containers. Use `transform: translateY(0)` for pre-promotion instead.
8. **Instant layout only**: Layout mutations during scroll must use `transition: none`. Animated transitions (any duration > 0) cause continuous relayout that kills momentum.
