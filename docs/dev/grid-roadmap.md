---
title: Grid optimization roadmap
description: Grid performance optimization tracking — virtual scroll committed-row lock, CSS Grid style recalc bottleneck, forced reflow reduction, and status.
author: 🤖 Generated with Claude Code
updated: 2026-03-30
---
# Grid optimization roadmap

- Grid uses CSS Grid layout with virtual scroll (committed-row lock) and scroll-position-based content-visibility gating.
- **Profiling reference**: session `39ae9fd1`. Perf trace at `/tmp/dv-manual-scroll-trace.json.gz` — M4 Pro, leisurely scroll pace. 7,000+ DOM elements; 70% of frame cost is `UpdateLayoutTree` (style recalc), not Layout/reflow.
- Grid fills in 120ms vs Masonry 62ms with identical 10-card budget — CSS Grid style invalidation cascades to all items on each insertion; absolute positioning (Masonry) is style-isolated.
- Shared card view optimizations (rendering, cleanup, properties) live in [card-views-roadmap.md](card-views-roadmap.md).

## Status key

- **Done** — implemented and verified
- **Evaluate** — needs investigation before committing
- **Planned** — scoped but no implementation plan yet

## Priority order

Ordered by expected impact × confidence from perf trace analysis.

| # | Task | Expected impact | Evidence | Status |
|---|---|---|---|---|
| P0 | Virtual scroll: committed-row lock | Directional fill + row atomicity | Mount ordering matches scroll direction. Cold start/jump: topmost-first. 2 rows/frame budget. | Done |
| P1 | Style recalc reduction | 70% of scroll frame cost | `UpdateLayoutTree` on 7,000+ elements per insertion. CSS Grid architectural — invalidation cascades to all grid items. | Evaluate |
| — | `__slowMount` debug removal | Cleanup before release | 15× frame delay toggle for mount ordering visual QA. | Planned |
| — | Phase 1 unit tests | Regression coverage | Committed-row lock, ROW_BUDGET loop, isJump carve-out, cold start vs directional, velocity gate — no tests. | Planned |
| — | Grid layout architecture doc | Knowledge capture | Committed-row lock mount ordering, cold start row selection, within-row direction, design evolution. | Planned |

## 1. Virtual scroll (committed-row lock)

All done. Grid's virtual scroll uses a committed-row lock — fundamentally different from Masonry's center-outward anchor.

| Optimization | Status | Notes |
|---|---|---|
| Committed-row lock | Done | Phase 1 of `syncVirtualScroll()`. Locks to a row, mounts all items atomically, then advances. Prevents partial rows (blank cards within a row). |
| Directional mounting | Done | Scroll down: left-to-right, top-to-bottom. Scroll up: right-to-left, bottom-to-top. Direction from accumulated delta (`DIRECTION_ACCUM_THRESHOLD` = 50px filters trackpad micro-reversals). |
| Cold start / jump detection | Done | First open or scrollbar jump: topmost-first, left-to-right. Jump = `\|scrollDelta\| > paneHeight` at high velocity. `jumpPending` stays active until all visible rows mounted, then transitions to directional. |
| ROW_BUDGET=2 loop | Done | `GRID_ROW_BUDGET` (2) complete rows per frame. Masonry derives equivalent: `GRID_ROW_BUDGET × columns`. |
| High velocity suppression | Done | Row commits suppressed above `HIGH_VELOCITY_THRESHOLD` (4000 px/s). Jumps exempt (single discrete event). |
| Content-visibility gating | Done | `CONTENT_HIDDEN_CLASS` toggled by scroll position. Cards in hidden buffer zone get `content-visibility: hidden` with `contain-intrinsic-height`. |
| Budget continuation | Done | When budget exhausted, schedules another sync frame. Suppressed during high velocity (scroll handler re-triggers). Jumps exempt. |
| Scroll-idle fallback | Done | 150ms debounced `scheduleVirtualScrollSync()` after scroll stops. Catches cases where velocity gate killed budgetExhausted reschedule on the last scroll event. |
| Frame mount cap | Done | `frameMountCount` caps total mounts across recursive sync calls (sync → onMountRemeasure → recursive sync) to `GRID_ROW_BUDGET × columns` per frame. Prevents 60+ card cascade on wide panes. |

## 2. Style recalc (main bottleneck)

The dominant cost. CSS Grid invalidates all items when any item is inserted or removed — unlike Masonry's style-isolated absolute positioning.

| Optimization | Status | Notes |
|---|---|---|
| `DocumentFragment` batch insertions | Evaluate | Coalesce DOM insertions to reduce style recalc passes. Cards currently inserted individually. |
| `contain: layout style` on cards | Evaluate | Limit style invalidation scope. Already on Masonry cards (`contain: layout style paint`). |
| `content-visibility: auto` on far-off-screen | Evaluate | Browser-managed render skipping could reduce the 7,000+ element recalc count. JS-managed `content-visibility: hidden` already used in the hidden buffer zone — `auto` would extend further. |

## 3. Tests

| Test | Status | Notes |
|---|---|---|
| Committed-row lock (Phase 1 Steps 1-3) | Planned | Complex stateful logic with 6+ interacting flags: `jumpPending` lifecycle, direction accumulator reset, cold start vs continuous transition, velocity calculation edge cases. Extracting testable pure functions requires refactoring tightly-coupled private methods. |
| ROW_BUDGET loop + isJump carve-out | Planned | Core jump fix has no regression test. `mountRowRange` is extractable and testable independently. Loop iteration count, early exit on `!rowMountedThisPass`, budget per pass = `columns`. |
| Cold start vs directional transition | Planned | `jumpPending` stays active until all visible rows mounted. Transition to directional selection when `jumpPending` clears. |

## 4. Documentation

| Doc | Status | Notes |
|---|---|---|
| Committed-row lock in `docs/architecture/grid-layout.md` | Done | §6a: algorithm, row selection, direction tracking, velocity gate, jump lifecycle, frame mount cap, masonry comparison, design evolution, state fields, constants, invariants. |

## What NOT to do

Approaches tried and rejected across sessions `39ae9fd1`, `2fc701c0`, `92794ff4`:

- **Scroll direction for full `virtualItems` iteration order** — 3 approaches failed (alternates, reverses, breaks monotonicity)
- **Viewport-center-outward two-pointer scan** — alternates between rows above/below center, not directional
- **Mounted-center anchor without freezing** — anchor drifts as cards mount
- **Cold start by scanning for mounted cards per-frame** — false triggers on partial mounts
- **Direction-aware cold start** — breaks jump-up behavior
- **Dynamic pixel-height budget** — ROW_BUDGET=2 is sufficient for both short and tall cards; pixel budgeting adds complexity for zero-height edge cases with no visible benefit
- **MutationObserver cumulative row-split tests** — unreliable due to unmount/remount cycles
