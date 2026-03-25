---
title: CLS source isolation
description: CLS source identified in masonry layout (#358) — onScrollIdle → remeasureAndReposition. Diagnostic experiments, methodology, the globalThis bug that invalidated Phase 9.2, and the confirmed CLS mechanism.
author: "\U0001F916 Generated with Claude Code"
updated: 2026-03-24
---
# CLS source isolation (#358)

## Problem

After pane resize + scroll, visible position jumps on masonry cards. 10 fix attempts failed across five attack vectors — scroll compensation, layout invalidation, reverse placement, RO suppression, and opacity masking. All targeted the correction pipeline — Phase 9.2 concluded the corrections were NOT the source. **That conclusion was wrong** due to a `globalThis` bug (see below). The correction pipeline IS the source.

## CLS sources — identified

Two correction paths share the same CLS-producing mechanism. Which fires depends on whether scroll is active when `resize-correction` enters `updateLayoutRef`.

### Path A: `resize-correction` (at rest)

**Source**: `resizeCorrectionTimeout` → `updateLayoutRef('resize-correction')` inline DOM measurement branch.

**Trigger**: 200ms after resize ends, when `isScrollRemeasurePending()` is false. This is the primary CLS for the **resize → wait → scroll** repro.

### Path B: `onScrollIdle` → `remeasureAndReposition` (scroll-idle)

**Source**: `scrollRemeasureTimeout` debounce → `onScrollIdle` → `remeasureAndReposition`.

**Trigger**: `scrollRemeasureTimeout` (200ms debounce) expires during scroll. The timer resets only when `mountedPostResize` is true (a post-resize card mounts that frame). Zones with no post-resize cards to mount create 200ms gaps where the timer fires mid-scroll. This is the CLS for the **resize → scroll immediately** repro.

### Shared mechanism

1. Pane resize narrows cards → title text wraps (1→2 lines)
2. Cards keep explicit `style.height` during scroll (prevents CLS during active scrolling)
3. Correction fires (Path A at rest, Path B at scroll-idle)
4. Correction clears explicit `style.height`
5. Cards grow to natural height (text wrap adds ~20-30px)
6. Downstream cards in each column shift down → **visible CLS**

**Pattern**: Discrete jumps when the user is stationary. Path A: 200ms after resize ends. Path B: 200ms after scroll stops (or mid-scroll due to timer bug).

**Key observation**: With corrections disabled (`noAll`), card heights remain clamped — title text wraps but is clipped by the explicit height constraint. No height change → no column reposition → no CLS.

**Session `e1bfc13f` discovery**: Path A updates `measuredAtWidth` on all mounted cards. After Path A runs, newly-mounting cards during scroll match `lastLayoutCardWidth` — `mountedPostResize` never triggers. Scroll-concurrent corrections gated on `mountedPostResize` do not fire for the resize-then-wait-then-scroll repro. Confirmed via `console.trace` instrumentation.

## The `globalThis` bug

Phase 9.2 (session `bd6310f2`) concluded "the correction pipeline is NOT the CLS source" (constraint #15 in `cls-elimination.md`). **This conclusion is invalid.**

The diagnostic guards used `globalThis.__clsDiag` to read flags set by the user on `window.__clsDiag`. esbuild does NOT map `globalThis` to `window` in bundled code — it resolves to a module-scoped reference. All guards silently read a different object than the one the user set from the DevTools console. Every flag test in Phase 9.2 was a no-op.

Fixed by changing `globalThis` to `window` in session `f4ae5162`. After the fix, `noAll = true` (all corrections disabled) eliminates CLS — confirming the correction pipeline IS the source.

## Diagnostic methodology

### Layout Shift API (unreliable)

- `PerformanceObserver` with `layout-shift` type
- Filters out shifts within 500ms of user input via `hadRecentInput`
- Resize drag and scroll are both user input — ALL shifts during the user's repro are excluded
- Reported 0.00 CLS when resize transitions were disabled, yet user still saw visible CLS
- DO NOT use for this specific problem

### Console-togglable diagnostic flags

Runtime flags on `window.__clsDiag` guard correction paths without rebuilding. Must use `window` (not `globalThis`) for esbuild compatibility.

| Flag | What it disables |
|---|---|
| `noAll` | All correction paths (master switch) |
| `noScrollIdle` | `onScrollIdle` entirely |
| `noResizeCorrection` | `resize-correction` 200ms post-resize path |
| `noCardRO` | `cardResizeObserver` callback |
| `noMount` | `mountVirtualItem` (blocks new card mounts during scroll) |

## Elimination experiments (session `f4ae5162`, working guards)

| Experiment | What was disabled | CLS result | Conclusion |
|---|---|---|---|
| 5. `noAll` | All correction paths | **CLS gone** | Correction pipeline IS the source |
| 6. `noCardRO` only | Card ResizeObserver | CLS persists | Not the sole trigger |
| 7. `noScrollIdle` only | `onScrollIdle` entirely | **CLS gone** | `onScrollIdle` is the trigger |
| 8. `noResizeCorrection` only | 200ms post-resize correction | CLS persists | Not the sole trigger |

### Invalidated experiments (session `bd6310f2`, broken guards)

| Experiment | What was disabled | CLS result | Actual status |
|---|---|---|---|
| 1. `onMountRemeasure` disabled | `return;` at top | CLS persists | **INVALID** — guard was no-op (`globalThis` bug) |
| 2. `remeasureAndReposition` disabled | `return false;` at top | CLS persists | **INVALID** — guard was no-op (`globalThis` bug) |
| 3. Both disabled + transitions 0s | Both methods + CSS | CLS persists | **INVALID** — guards were no-ops |
| 4. Transitions disabled | CSS `transition: none !important` | CLS persists | Valid CSS-only test, still useful |

## Position-write code paths

All code that writes `style.top`/`style.left` to masonry cards, with context on when they fire.

### During active resize

- **`proportionalResizeLayout`** — writes ALL mounted cards via `updateLayoutRef('resize-observer')` in ResizeObserver callback
- `masonry-resize-active` class enables `transition: top/left` during resize

### During scroll

- **`mountVirtualItem`** — initial positioning of NEW cards only
- **`onMountRemeasure`** → `remeasureAndReposition` — synchronous correction of newly-mounted cards, `skipTransition=true`. Only fires for never-measured cards (`measuredAtWidth === 0`); post-resize cards have `measuredAtWidth > 0` and don't trigger this path.

### At scroll-idle (CLS source)

- **`onScrollIdle`** → `remeasureAndReposition` — batch correction, `skipTransition=true`. **This is the CLS source.** Fires via `scrollRemeasureTimeout` (200ms debounce) which resets only on post-resize card mount frames — NOT on scroll events.
- **`onScrollIdle` deferred path** → `updateLayoutRef('resize-observer')` — full layout recalc (only when `pendingDeferredResize`)
- **`scheduleDeferredRemeasure`** → `remeasureAndReposition` — double-RAF follow-up correction

> **Note**: `onScrollIdle` was removed in `6fb3ae0` (path unification). Correction now runs scroll-concurrent inside `syncVirtualScroll`, throttled by `SCROLL_CORRECTION_INTERVAL_MS` (1000ms). The CLS mechanism (height clearing → text wrap → column cascade) is unchanged — only the timing moved from scroll-idle to scroll-concurrent.

### From async events

- **`cardResizeObserver`** → `remeasureAndReposition` — RAF-debounced, guarded by `isScrollRemeasurePending()`
- **`image-load`** → `remeasureAndReposition` — coalesced per-frame, guarded
- **`property-measured`** → `updateLayoutRef` — idle callback after property width measurement
- **~~`resize-correction`~~** — 200ms after resize ends. **Layer 1**: no longer calls `remeasureAndReposition` or `updateLayoutRef`. Sets `postResizeScrollActive` to defer correction to scroll-concurrent path.

## `scrollRemeasureTimeout` behavior

The name `onScrollIdle` is misleading. The 200ms debounce timer tracks **post-resize card mount activity**, not scroll activity.

```
scrollRemeasureTimeout resets when:
  pendingDeferredResize || postResizeScrollActive || mountedPostResize

mountedPostResize is true only on frames where a post-resize card mounts.
Scroll events alone do NOT reset the timer.
```

During continuous scrolling, stretches where no post-resize cards mount (already mounted, or between unmounted regions) create 200ms gaps. The timer fires mid-scroll, producing discrete CLS jumps — even though the user never stops scrolling.

**Design bug**: A scroll-idle debounce should reset on every scroll event — "idle" means "user stopped scrolling," so any scroll resets the countdown. This timer ignores scroll events and only resets on card mounts, letting it fire mid-scroll. Fixing the reset condition to track scroll events (not mount events) would ensure corrections only fire when the user actually stops scrolling.

## Key discoveries

- **`globalThis` ≠ `window` in esbuild bundles**: esbuild converts `globalThis` to a module-scoped reference. Code using `globalThis.__property` does NOT share state with `window.__property` set from the DevTools console. All runtime diagnostic flags must use `window` directly.
- **Layout Shift API `hadRecentInput` excludes all user-caused shifts**: Resize drag and scroll are both classified as user input. CLS metrics from this API do NOT capture the shifts the user perceives.
- **Phase 9.2 constraint #15 invalidated**: "The correction pipeline is NOT the CLS source" was wrong — all guards were no-ops due to the `globalThis` bug. The correction pipeline IS the source.
- **CLS is from height correction, not position correction**: The visible shift comes from `remeasureAndReposition` clearing explicit `style.height` → cards growing to accommodate text wrap → column reposition cascade. Cards don't shift because their `top`/`left` is wrong — they shift because their HEIGHT changes and pushes everything below them.

## Sessions

- `bd6310f2-f04e-428c-bce6-934dbe977b87` — Phase 9.2 elimination experiments (invalidated by `globalThis` bug), Layout Shift API methodology discovery
- `f4ae5162-1f22-4494-b8dc-305ce1037c48` — CLS source identified. `globalThis` bug found and fixed. Four experiments with working guards confirmed `onScrollIdle` → `remeasureAndReposition` as sole CLS source.
