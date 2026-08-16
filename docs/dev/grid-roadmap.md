---
title: Grid optimization roadmap
description: Grid performance optimization tracking — virtual scroll committed-row lock, CSS Grid style recalc bottleneck, forced reflow reduction, and status.
author: 🤖 Generated with Claude Code
updated: 2026-04-12
---
# Grid optimization roadmap

- Grid uses CSS Grid layout with virtual scroll (committed-row lock) and scroll-position-based content-visibility gating.
- **Profiling reference**: session `39ae9fd1` (initial), session `471c8e8d` (follow-up with bail-out and batch optimizations). Latest trace: `tall.base` popout, M4 Pro, no throttling — 1,437ms total forced reflow, 38 style recalcs averaging 56ms each (3,000–6,000 elements per recalc). 90% of reflow cost is Bases internals; plugin code contributed ~7.6%, all of it in the poster mixed-row stretch pass — since removed in favour of a pure CSS `aspect-ratio` chain.
- Grid fills in 120ms vs Masonry 62ms with identical 10-card budget — CSS Grid style invalidation cascades to all items on each insertion; absolute positioning (Masonry) is style-isolated.
- Shared card views optimizations (rendering, cleanup, properties) live in [card-views-roadmap.md](card-views-roadmap.md).

## Status key

- **Done** — implemented and verified
- **Evaluate** — needs investigation before committing
- **Planned** — scoped but no implementation plan yet

## Priority order

Ordered by expected impact × confidence from perf trace analysis.

| # | Task | Expected impact | Evidence | Status |
|---|---|---|---|---|
| P0 | Virtual scroll: committed-row lock | Directional fill + row atomicity | Mount ordering matches scroll direction. Cold start/jump: topmost-first. 2 rows/frame budget. | Done |
| P1 | Style recalc reduction | 70% of scroll frame cost | `UpdateLayoutTree` on 3,000–6,000 elements per recalc. CSS Grid architectural — invalidation cascades to all grid items. 840 children in single group. | Evaluate (display:none approach reverted — see §5) |
| P2 | Stretch no-op bail-out | 62% redundant calls eliminated | Composite key (items × columns × image-ready × compact-stacked) + polynomial hash. 16→9 calls, ~100ms→~23ms per scroll round-trip. | Done |
| P2 | `clipPosterStaticOverflow` batch | O(K)→O(1) reflows | Split into clear/measure/apply phases. Batch variant runs all clears → all reads (1 reflow) → all writes. | Done |
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
| `DocumentFragment` batch insertions | Rejected | No benefit — insertions already batched within rAF, `replaceWith` is unbatchable. |
| `contain: layout style` on cards | Rejected | No benefit for container-level invalidation (the 90% cost). Grid items all participate in track sizing regardless of child containment. |
| `content-visibility: auto` on far-off-screen | Rejected | No measurable benefit for forced sync reflows (only helps passive rendering). |
| `content-visibility: hidden` on all items | Rejected | 2.87× speedup measured, but breaks card rendering — cards must be visible for measurement. |
| `display: none` placeholders + padding scroll height | Reverted | Math is correct for whole-row operations, but scroll compensation is irreconcilable — `syncGroupPadding` and `remeasureMountedCards` both compensate scrollTop independently, producing >14 jumps >100px across 4 tested variants. Also: `display: none` doesn't reduce style recalc — Chrome iterates hidden elements in `UpdateLayoutTree`. Only layout is skipped. Checkpoint: `4638b8f`. |
| Remove placeholders from DOM entirely | Evaluate | Would actually reduce style recalc count (unlike `display: none`). Requires padding-based scroll height (same as reverted approach) but avoids the grid auto-placement renumbering issue since elements are fully absent. |

## 3. Tests

| Test | Status | Notes |
|---|---|---|
| Committed-row lock (Phase 1 Steps 1-3) | Planned | Complex stateful logic with 6+ interacting flags: `jumpPending` lifecycle, direction accumulator reset, cold start vs continuous transition, velocity calculation edge cases. Extracting testable pure functions requires refactoring tightly-coupled private methods. |
| ROW_BUDGET loop + isJump carve-out | Planned | Core jump fix has no regression test. `mountRowRange` is extractable and testable independently. Loop iteration count, early exit on `!rowMountedThisPass`, budget per pass = `columns`. |
| Cold start vs directional transition | Planned | `jumpPending` stays active until all visible rows mounted. Transition to directional selection when `jumpPending` clears. |

## 4. Documentation

| Doc | Status | Notes |
|---|---|---|
| Committed-row lock in `docs/arch/grid-layout.md` | Done | §6a: algorithm, row selection, direction tracking, velocity gate, jump lifecycle, frame mount cap, masonry comparison, design evolution, state fields, constants, invariants. |

## What NOT to do

Approaches tried and rejected across sessions `39ae9fd1`, `2fc701c0`, `92794ff4`:

- **Scroll direction for full `virtualItems` iteration order** — 3 approaches failed (alternates, reverses, breaks monotonicity)
- **Viewport-center-outward two-pointer scan** — alternates between rows above/below center, not directional
- **Mounted-center anchor without freezing** — anchor drifts as cards mount
- **Cold start by scanning for mounted cards per-frame** — false triggers on partial mounts
- **Direction-aware cold start** — breaks jump-up behavior
- **Dynamic pixel-height budget** — ROW_BUDGET=2 is sufficient for both short and tall cards; pixel budgeting adds complexity for zero-height edge cases with no visible benefit
- **MutationObserver cumulative row-split tests** — unreliable due to unmount/remount cycles

### Style recalc approaches (session `2da45655`)

All empirically tested on M4 Pro with `tall.base` (840 cards) and `recalc.base` (100 cards, poster, paired props):

- **`DocumentFragment` batch** — no benefit (insertions already batched in rAF)
- **`contain: layout style` on cards** — no benefit for container-level invalidation
- **`content-visibility: auto` on far-off-screen** — no benefit for forced sync reflows
- **`display: none` placeholders + padding** — math correct for whole-row ops, but scroll compensation irreconcilable (4 variants tested: `overflow-anchor: auto` + manual, native-only, manual-only, anchor-wrapping). Root cause: `syncGroupPadding` and `remeasureMountedCards` both compensate `scrollTop`, producing oscillation. Also `display: none` doesn't reduce style recalc — only layout. Checkpoint `4638b8f`.
