---
title: CLS reverse placement
description: Deep dive into reverse masonry placement for CLS elimination (#358) — Phase 4 design, bugs, and failure analysis; Phase 8 directional flush stacking design, implementation, and bugs.
author: "\U0001F916 Generated with Claude Code"
updated: 2026-03-22
---
# CLS reverse placement

Experiment log for reverse placement approaches in [CLS elimination (#358)](cls-elimination.md). Covers Phase 4 (reverse greedy — REVERTED) and Phase 8 (directional flush stacking — REVERTED).

## Terminology

- **Flush stacking**: Positioning a card so one edge is exactly `gap` pixels from the adjacent card in the same column. Forward flush stacking anchors the top edge; reverse flush stacking anchors the bottom edge. Guarantees exact spacing regardless of estimation error.
- **Seed cards**: Cards already mounted (visible in the DOM) at the moment the deferred resize relayout runs. They have `item.el` set, so they don't enter the mount path and `flushStackMounts` never touches them. They keep estimated heights from `proportionalResizeLayout`. Typically ~6 cards out of ~50 mounted.
- **Seed boundary**: The `forwardColumnBottoms` / `reverseColumnTops` values computed from seed cards during `seedDirectionalTracking`. Because seed cards have estimated heights, these boundaries have 5-25px error — producing a small gap or overlap between the seed region and the flush-stacked region.
- **Stale card**: A mounted card whose `measuredAtWidth` differs from `lastLayoutCardWidth` by >1px. Includes both seed cards (measured at old width) and never-measured cards (`measuredAtWidth === 0`). The `hasStaleCards` check in `onScrollIdle` gates correction deferral.
- **Deferred resize**: When the resize correction path (`resizeCorrectionTimeout` callback) finds `isScrollRemeasurePending()` true, it sets `pendingDeferredResize = true` instead of running the full relayout immediately. The relayout is deferred to `onScrollIdle`. This doesn't require the user to resize and scroll simultaneously — `isScrollRemeasurePending()` returns true when a scroll-idle debounce timer is in flight, which can be triggered by the resize itself (via `syncVirtualScroll`), by iOS momentum scrolling, or by recent scroll events within the 200ms window.
- **Directional tracking**: Per-group arrays (`forwardColumnBottoms`, `reverseColumnTops`) that track column boundaries for flush stacking. Seeded from mounted card positions after the deferred resize relayout. Updated incrementally as cards are flush-stacked.

## Design

Core insight (user-originated): the CLS problem is **directional**. Downward scroll after resize has zero CLS because height estimation errors propagate downward (off-screen). The fix: mirror the placement algorithm for upward scroll — anchor each card's BOTTOM edge flush against the topmost visible card in its column, so errors propagate UPWARD (off-screen).

- **Cost**: One visible correction when the user reaches the layout origin (top of container)
- **Benefit**: Zero CLS during all post-resize scrolling

### How it works

**Forward greedy** (normal): tracks `columnBottoms` per column. Place card at `y = columnBottoms[col]`, pick shortest column. Grows downward.

**Reverse greedy** (Phase 4, upward scroll): tracks `reverseColumnTops` per column. Place card at `y = reverseColumnTops[col] - measuredHeight - gap`, pick tallest column (highest Y = most room above). Grows upward.

`reverseColumnTops` is **seeded** from the topmost mounted card's Y position in each column — the boundary where existing forward-placed cards end and reverse placement begins.

### Flush stacking guarantee

Regardless of column assignment strategy, each reverse-placed card's bottom edge is exactly `gap` pixels above the card below it:

```
card bottom = reverseColumnTops[col] - gap
card below top = reverseColumnTops[col]
distance = gap  ✓
```

Estimation errors only affect **off-screen column tops** (upward drift), not the boundary between forward and reverse regions. This was confirmed analytically after the gaps were initially misattributed to a forward/reverse greedy mismatch (see [Misattributed root cause](#misattributed-root-cause) below).

## Key design decisions

### Scroll direction tracking

`scrollingUp` MUST be tracked in the **scroll handler**, not `syncVirtualScroll`. `syncVirtualScroll` is called from non-scroll paths (proportional resize, `onMountRemeasure`). Tracking direction there produces false "scrolling up" during synthetic calls, triggering reverse placement when the user hasn't scrolled.

### `eagerPreMeasure` interaction

Phase 1e's `eagerPreMeasure` updates `measuredAtWidth` to the current width for content-hidden cards. These cards bypass the `measuredAtWidth !== lastLayoutCardWidth` reverse placement condition despite having estimated `item.height`. Additional check needed: `Math.abs(item.height - item.measuredHeight) > 1`.

### Column assignment strategy

**Stable columns** (keep forward-assigned `item.col`): causes progressive cross-column Y-drift (~55px over 30 cards) because forward assignment used estimated heights while reverse placement uses measured heights. Columns become visibly uneven at the full reflow — an unfamiliar visual artifact.

**Reverse greedy** (tallest-column-first): cards may land in different columns than forward greedy assigned. Produces card shuffling at the full reflow, which users already expect from resize events. **User decision: use reverse greedy.**

Neither strategy affects the flush stacking guarantee — gaps between adjacent cards in the same column are always exactly `gap` pixels.

### `onScrollIdle` suppression

`remeasureAndReposition` is the **sole CLS source**. Every code path that calls it produces visible CLS — 13 layout shifts across ~8 paint frames over 132ms. Inline style writes to ~50 mounted cards cascade through 2.8K-7.2K elements. The ONLY way to eliminate CLS is to NOT call `remeasureAndReposition` during post-resize scroll.

Phase 4 suppresses `remeasureAndReposition` in `onScrollIdle` when `postResizeScrollActive` is true:

- **Upward scroll** (`reverseActivated`): reverse placement handles corrections incrementally. Full reflow at layout origin.
- **Downward scroll**: errors propagate off-screen below. Must still clean up `masonry-skip-transition` class and eventually clear `postResizeScrollActive`.

### `scheduleDeferredRemeasure` guard

Returns early when `postResizeScrollActive` — prevents the deferred remeasure path from calling `remeasureAndReposition` during post-resize scroll.

## Phase 4: Reverse greedy — REVERTED

All changes in `src/bases/masonry-view.ts`. Build + 973 tests pass.

| Component | Function/field | Description |
|---|---|---|
| State fields | `lastScrollTop`, `scrollingUp`, `reverseActivated`, `reverseColumnTops` | Reverse placement state |
| Scroll direction | scroll handler | Tracked in scroll handler only |
| Reverse queue + batch | `syncVirtualScroll` | Collects stale cards during upward scroll, batch measures + repositions |
| `onScrollIdle` mods | `onScrollIdle` | Upward: full reflow at origin. Downward: skip `remeasureAndReposition` |
| `scheduleDeferredRemeasure` guard | `scheduleDeferredRemeasure` | Early return when `postResizeScrollActive` |
| Reset on new layout | `containerEl.empty()` path | Clears reverse state |

Column count derived from `groupLayoutResults` (not `lastLayoutColumns` which doesn't exist on the class).

### Bugs found during testing

#### 1. Premature `onScrollIdle` via `syncVirtualScroll` chain

**Symptom**: `remeasureAndReposition` called during post-resize scroll despite Phase 4 guards.

**Cause**: `pendingDeferredResize` handler → `updateLayoutRef.current('resize-observer')` → `syncVirtualScroll` → schedules 200ms `scrollRemeasureTimeout` → `onScrollIdle`. This nested `onScrollIdle` has `pendingDeferredResize: false` and (for downward scroll) `reverseActivated: false`, so it falls through to `remeasureAndReposition`.

**First fix**: Cancel `scrollRemeasureTimeout` after `updateLayoutRef.current` returns. **BROKE virtual scroll** — prevented `onScrollIdle` from ever firing for unmount cleanup.

**Correct fix**: Keep the timeout. Make `onScrollIdle` return early for ALL `postResizeScrollActive` cases.

#### 2. Reverse placement Tier 2 gap

**Symptom**: Cards entering mount zone from content-hidden state (Tier 2 → Tier 1) skip reverse placement.

**Cause**: Phase 4's reverse placement check was only in the `!item.el` mount path (Tier 3 → Tier 1). On desktop with Tier 2, items have `item.el` set during Tier 2 mount — the `!item.el` block is skipped.

**Fix**: Add reverse placement check to the content-hidden → mount zone transition path. `eagerPreMeasure` updates `measuredHeight` but not `item.height`, so `height !== measuredHeight` catches these items.

#### 3. `postResizeScrollActive` lifecycle

**Problem**: Suppressing ALL `onScrollIdle` corrections for both directions blocks:
1. `onMountRemeasure` for never-measured cards (guard checks `!postResizeScrollActive`)
2. `masonry-skip-transition` cleanup (no `scheduleDeferredRemeasure` call) → card transitions disabled permanently → flickering

**Resolution**: The original plan's step 3c was correct — only suppress for `reverseActivated` (upward), fall through for downward. BUT downward fallthrough calls `remeasureAndReposition` which produces identical CLS (see [bug #4](#4-downward-cls-same-as-upward)). This created a tension between two requirements: (a) suppress CLS, (b) don't break virtual scroll.

**Latest approach**: Keep `postResizeScrollActive` set until all stale cards leave the mount zone (`hasStaleCards` check). Clean up `masonry-skip-transition` via RAF in the skip path. This is the version that was deployed when visible gaps appeared — see [Open bugs](#open-bugs-cause-of-visible-gaps).

#### 4. Downward CLS same as upward

**Discovery**: Phase 4 initially only suppressed upward scroll CLS. The assumption was "errors propagate off-screen below during downward scroll." Wrong — `remeasureAndReposition` corrects ALL ~50 mounted cards regardless of scroll direction. The cascade touches visible cards in both directions.

**Implication**: `remeasureAndReposition` must be suppressed for BOTH scroll directions during `postResizeScrollActive`. Corrections must happen either incrementally (per-card on mount) or at a natural boundary (layout origin).

#### 5. Transient over-mounting after resize

After full relayout via `pendingDeferredResize` handler, 680/820 items mounted (expected ~50). Items properly unmounted on next scroll event. Likely pre-existing — `syncVirtualScroll` at end of layout may be gated by `hasUserScrolled` or stale mount zone boundaries. Not a Phase 4 regression.

### Open bugs (cause of visible gaps)

The user saw 772px and 1256px gaps between cards after resize. Two bugs identified:

#### 1. Stale `reverseColumnTops` column count

After a second resize (e.g., 4→2 cols then back), `reverseColumnTops` retained the old column count (5 entries for a 2-column layout). Cards placed into non-existent columns.

**Fix implemented**: Reset `reverseActivated = false` and `reverseColumnTops = []` in `pendingDeferredResize` handler. Gaps persisted after this fix → bug #2 is the remaining cause.

#### 2. `hasStaleCards` blocking `onMountRemeasure`

The `hasStaleCards` check keeps `postResizeScrollActive` true until all stale cards leave the mount zone. While active, `onMountRemeasure` is blocked for **never-measured cards** — cards that have never been in the DOM and need initial measurement. Without measurement, these cards keep their estimated height, creating large position gaps.

**Fix**: Not implemented in Phase 4. Need to decouple the `postResizeScrollActive` guard for never-measured cards (`measuredAtWidth === 0`) from the guard for post-resize cards (`measuredAtWidth > 0` at different width). Phase 1b's synchronous `onMountRemeasure` should fire for never-measured cards regardless of `postResizeScrollActive`.

### Misattributed root cause

The 772px gaps were initially attributed to a **fundamental flaw in reverse greedy column assignment** — forward greedy and reverse greedy assign cards to different columns, creating gaps at the boundary. This analysis was wrong.

Flush stacking (`y = reverseColumnTops[col] - measuredHeight - gap`) produces exact `gap`-pixel spacing between adjacent cards **regardless of column assignment**. The column assignment only determines which column a card goes into, not the spacing within that column. Estimation errors affect off-screen column tops, not the forward/reverse boundary.

The visible gaps came from implementation bugs (stale column count + blocked `onMountRemeasure`), not algorithmic incompatibility. Phase 4 was nearly reverted based on this incorrect analysis.

**Lesson**: When a solution appears broken, isolate the actual failure (instrument, reproduce, trace) before concluding the approach is fundamentally flawed.

### Plan gaps

The original plan (`plans/358-reverse-placement.md`) was correct for the happy path (upward scroll → reverse placement → full reflow at top). Five blind spots forced reactive patches that interacted unpredictably, creating cascading breakage.

#### 1. Downward CLS not addressed

Step 3c assumed downward scroll could "fall through to normal `remeasureAndReposition`." But `remeasureAndReposition` IS the CLS source in both directions — it corrects ALL ~50 mounted cards regardless of scroll direction (see [bug #4](#4-downward-cls-same-as-upward)). Reactive patch: suppress for both directions, leading to the `hasStaleCards` lifecycle complexity.

#### 2. Non-`onScrollIdle` callers ignored

The plan only suppresses `onScrollIdle`. But `cardResizeObserver`, image-load relayout, and content-update callbacks also call `remeasureAndReposition` during post-resize scroll. Each produces CLS independently. Reactive patch: `forcedSkipTransition` (force `skipTransition=true` and add `masonry-skip-transition` inside `remeasureAndReposition` when `postResizeScrollActive` is true).

#### 3. `onMountRemeasure` interaction

When `postResizeScrollActive` stays true (reverse active, user hasn't reached top), it blocks `onMountRemeasure` for never-measured cards (`measuredAtWidth === 0`) — producing large gaps. Reactive patch: `hasMountedStaleWidthCards()` helper to decouple the guard.

#### 4. CSS transition lifecycle

The plan assumed `masonry-skip-transition` from `pendingDeferredResize` stays active throughout post-resize scroll. But individual callers (`cardResizeObserver`) don't pass `skipTransition` to `remeasureAndReposition` — corrections animate via the 200ms CSS transition on `top`/`left`. Reactive patch: `forcedSkipTransition` (same as gap #2).

#### 5. `cardResizeObserver` feedback loop

`remeasureAndReposition` clears explicit card heights for measurement → `cardResizeObserver` fires because heights changed → triggers ANOTHER `remeasureAndReposition` via RAF → but `masonry-skip-transition` already removed (1 RAF lifecycle) → transform changes animate. Loop repeats 3-4 times producing 13 layout shifts across 8 paint frames. See [cls-elimination.md constraint #5](cls-elimination.md#proven-constraints) for the full WHATWG spec timing analysis (RAF step 11 vs RO step 14).

#### Pattern

Each reactive patch fixed one gap but interacted with other patches. The accumulated result (278 lines of changes across `forcedSkipTransition`, `inRemeasure`, deferred `syncResponsiveClasses`, `hasMountedStaleWidthCards()`, modified `onScrollIdle`, `initialRemeasureTimeout` guard) was catastrophic — overlapping cards, cards laid one-by-one during scroll, cards starting at few px tall then extending.

**Requirement for Phase 8**: Must explicitly address ALL 5 gaps as first-class design concerns, not afterthoughts.

## Phase 8: Directional flush stacking — REVERTED

Redesigned reverse placement as directional flush stacking. Newly-mounting cards during post-resize scroll are measured on mount and positioned off-screen (forward below viewport, reverse above). `remeasureAndReposition` runs at scroll-idle — flush-stacked cards have zero drift. All 5 plan gaps addressed upfront.

### Implementation

Changes in `masonry-view.ts`, `masonry-layout.ts`, `constants.ts`. Key additions:

- **State fields**: `lastScrollTop`, `scrollingUp`, `forwardColumnBottoms`, `reverseColumnTops`, `postResizeSafetyTimeout`, `postResizeSafetyFired`, `directionalTrackingSeeded`, `lastLayoutColumns`
- **`seedDirectionalTracking(gap)`**: Seeds per-group column boundary arrays from mounted cards after deferred resize relayout
- **`flushStackMounts(items, cardWidth, gap)`**: Batched 3-phase measurement + positioning (clear heights → read offsetHeight → compute flush positions + write styles)
- **`pickReverseGreedyColumn(columnTops)`**: Selects column with highest top Y (most room above) for reverse placement
- **Correction caller gates**: `cardResizeObserver` and `scheduleDeferredRemeasure` return early during `postResizeScrollActive`
- **Stale card deferral**: `onScrollIdle` defers `remeasureAndReposition` while mounted stale cards remain; `postResizeSafetyFired` forces clear after `POST_RESIZE_SAFETY_MS` (2s)
- **Origin reflow**: `scrollTop <= paneHeight` triggers immediate `onScrollIdle` (unconditional — not gated behind scroll direction)

### Bugs found during Phase 8

#### 1. `pendingDeferredResize` re-entry

`updateLayoutRef.current?.('resize-observer')` inside the `onScrollIdle` deferred resize handler can re-trigger `pendingDeferredResize = true` via nested resize observations. This caused `seedDirectionalTracking` to run 2-3 times per resize cycle.

**Fix**: Guard the `pendingDeferredResize` block with `&& !this.postResizeScrollActive`. Re-clearing `pendingDeferredResize` after `updateLayoutRef.current` is insufficient — async events can re-set it.

#### 2. Flush stacking before seeding (overlaps/gaps)

`updateLayoutRef.current?.('resize-observer')` in the deferred resize handler triggers `syncVirtualScroll` → `flushStackMounts` — but `seedDirectionalTracking` hasn't run yet. The tracking Maps are empty/stale, producing wrong positions (cards placed at ~7000px instead of ~14000px — overlaps and large gaps).

**Fix**: `directionalTrackingSeeded` flag gates `flushStackMounts`; set `true` after `seedDirectionalTracking`, cleared on reset and `postResizeScrollActive` clear. Cards from the initial relayout keep estimated positions (same as current Phase 1c behavior).

#### 3. Seed cards are irreducible CLS

Cards already mounted before the deferred resize relayout are NOT in the `staleMountQueue` — they don't enter the mount path (`!item.el` is false). They keep estimated heights. ~6 seed cards remain stale after flush stacking handles ~44 newly-mounted cards. These produce the minimum CLS at scroll-idle correction.

The stale card deferral mechanism keeps `postResizeScrollActive` true until all mounted cards have `measuredAtWidth === lastLayoutCardWidth`. Seed cards only clear this condition when they scroll off-screen (unmounted and replaced by flush-stacked cards with actual heights).

### RO feedback loop (Phase 5 unnecessary)

During scroll-idle `remeasureAndReposition`:
1. `remeasureAndReposition(skipTransition=true)` → height writes → RO fires
2. `scheduleDeferredRemeasure(true)` → registers RAF₁
3. Frame N, step 11: RAF₁ fires → registers RAF₂
4. Frame N, step 14: RO delivers → `postResizeScrollActive` gate doesn't apply (already false) → registers RAF_RO
5. Frame N+1, step 11: RAF₂ fires first (earlier registration) → `remeasureAndReposition` → zero drift → returns false. RAF_RO fires next → zero drift → returns false.

The loop self-terminates because there's no drift. `masonry-skip-transition` persists until `scheduleDeferredRemeasure`'s cleanup runs.

**Pre-existing vulnerability**: if an image loads between the main correction and RAF₂, the image-load height change creates drift. RAF_RO's `remeasureAndReposition` may run after `masonry-skip-transition` is removed, causing transitions. Not a Phase 8 regression — the same vulnerability exists in the current `onScrollIdle` → `remeasureAndReposition` → `scheduleDeferredRemeasure` path.

### Phase 8.2: Position propagation — REVERTED

Phase 8.2 (session `697a1bea`) attempted position propagation to close the gap between flush-stacked and unmounted zones. Three iterations of boundary detection logic (seenMounted, flush signature, seenFlush). Propagation closed the boundary gap but couldn't fix non-uniform per-card spacing errors (3352px blank space). Extended to mounted off-screen items — still ineffective. Reverted.

## Related research

### Media Companion zero-CLS analysis

Media Companion's masonry has zero CLS because card heights are known exactly — image dimensions from `.sidecar.md` metadata + constant 24px nowrap filename label. No text reflow, no estimation error, no scroll compensation needed. Uses identical proportional scaling formula but with ~0px error vs Dynamic Views' 20-100px.

MC's `reflowColumn` correction path is pure JS math — never reads DOM during position writes. Dynamic Views' `remeasureAndReposition` forces layout via `getBoundingClientRect()` in `updateCachedGroupOffsets()` mid-write, producing the 13-shift cascade. Deferring group offset computation to after all position writes (or computing from JS state) could reduce layout shift count.

**Key takeaway**: The technique for zero CLS IS accurate height prediction. Width-bucket cache ([remaining candidate #2 in cls-elimination.md](cls-elimination.md#2-width-bucket-exact-height-cache)) remains the highest-value approach for reducing estimation error at the source.

## Testing environment quirks

### RAF doesn't fire in DevTools-driven popouts

Programmatic `scrollTop` changes fire the scroll event, but `scheduleVirtualScrollSync` (RAF-based throttle) doesn't execute because the popout isn't actively painting. Manual `syncVirtualScroll()` calls work. Real user scrolling works because the window is focused and painting.

### Popouts don't reload with main window

`remote.getCurrentWindow().reload()` only reloads the main BrowserWindow. Popout windows keep old code in memory. Full app quit + relaunch required to refresh popout code.

### Worktree `main.js` not auto-deployed

Worktree builds output `main.js` to the worktree directory, not the plugin directory. Must manually copy to deploy. Previous restart ran stale (non-worktree) code — all runtime verification was against the wrong build.

### Masonry view instance path

Access via `leaf.view.controller.view` (not directly on the leaf). Bases view creates sub-views internally through a controller.

### Prototype monkey-patching

Must patch the prototype AND `delete mv.methodName` to remove own-property shadows from prior instrumentation attempts.

## References

- **Parent doc**: [cls-elimination.md](cls-elimination.md) — problem definition, proven constraints, estimation model, all tried approaches, remaining candidates
- **Issue**: [#358](https://github.com/churnish/dynamic-views/issues/358)
- **Plan**: `plans/358-phase-8-reverse-placement.md`
- **Session** (Phase 8): `a1535935-e203-442b-90bd-d33132f172a9`
- **Session** (Phase 4): `7e845376-c46c-464b-aff7-51388c1220cc`
- **Session** (Phases 1-1e): `e1137b1a-4a8c-40d4-b38a-2f822d74ac09`
