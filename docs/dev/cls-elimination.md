---
title: CLS elimination
description: Post-resize scroll-idle CLS in masonry layout (#358) — problem definition, proven constraints, estimation model, industry survey, all tried approaches, remaining candidates, and key source files.
author: "\U0001F916 Generated with Claude Code"
updated: 2026-03-25
---
# CLS elimination (#358)

Post-resize CLS in masonry layout. After pane resize (column count change) and scroll, visible position jumps on masonry cards. Affects both Grid and Masonry (both share `estimateUnmountedHeight`), but Masonry is the primary focus — Grid has simpler correction paths.

> **Note**: Phase 9.2 originally concluded the correction pipeline was NOT the source. **This was wrong** — a `globalThis` bug made all diagnostic guards no-ops (see [cls-source-isolation.md](cls-source-isolation.md)). Session `f4ae5162` identified the source: `onScrollIdle` → `remeasureAndReposition` clearing explicit heights → cards grow from text wrap → column reposition cascade.

## Problem

After a pane resize that changes column count (e.g., 4→2), ~960 unmounted cards have estimated heights with 20-100px error per card. The estimation model (`estimateUnmountedHeight()`) splits card height into `scalableHeight` (covers — scales linearly with width) and `fixedHeight` (text, properties, header — scales as `sqrt(widthRatio)` with k=0.5). But text reflow is discrete — no continuous function predicts it exactly. Per-card estimation error: 20-100px. Aggregate scroll compensations up to -453px observed after column increase.

The visible CLS during post-resize scroll has been attributed to various subsystems across 10 phases of investigation — all were ruled out or produced zero improvement. The source remains unidentified (see constraint #15 and [cls-source-isolation.md](cls-source-isolation.md)).

## Requirements

1. **Zero CLS**: No visible layout shift at any point during or after post-resize scrolling. Transition suppression (`masonry-skip-transition`) must persist until all correction paths (`onMountRemeasure`, `cardResizeObserver`, `scheduleDeferredRemeasure`) are quiescent. Accepting "minor subsequent CLS" is not an acceptable trade-off.

## Proven constraints

1. **Cross-column differential is unfixable by scrollTop**: single-axis scroll compensation cannot correct multi-column differential height shifts. Formally proven in two independent analyses (prior session 7.14, 7.16). Any per-card mid-scroll correction produces micro-jitter worse than one batch jump.

2. **Estimation cannot be perfect**: text reflow is discrete (lines either wrap or don't). 20-100px error at ~40% width change is structural.

3. **Visible jump is from MOUNTED card height corrections**: Phase 1e proved that 84% of unmounted items having exact estimates doesn't reduce the visible jump. Originally superseded by constraint #15 (Phase 9.2), but #15 was invalidated by the `globalThis` bug. Session `f4ae5162` confirmed: CLS comes from `remeasureAndReposition` clearing explicit `style.height` → cards grow from text wrap → column cascade.

4. **Cross-column residuals (~10-30px) are NOT the CLS source**: Three independent compensation approaches targeting per-column residuals all produced zero perceptible improvement (see Phases 2a, 2b, 2c below). The visible jump must come from something else.

5. **CLS is multi-frame, not single-jump**: Performance trace (#4) revealed 13 layout shifts across ~8 paint frames over 132ms. Inline `top`/`left`/`width` style writes to ~50 mounted cards invalidate layout; `updateCachedGroupOffsets()` forces layout via `getBoundingClientRect()`; each style recalculation cascades through 2.8K-7.2K elements (42-82ms each) — long enough for the browser to render intermediate frames with partial position updates. The CLS source is the style recalculation cascade, not cross-column differential or scroll compensation. The cascade is driven by a `cardResizeObserver` feedback loop — `remeasureAndReposition` clears heights triggering RO, which schedules RAF for another `remeasureAndReposition`. Phase 5 blocked this loop when implemented (reducing from ~8 to 2 paint frames) but was later reverted.

6. **Eliminating `top`/`left` layout invalidation is insufficient**: Phase 3 replaced all position writes with compositor-only `translate3d` — zero perceptible CLS improvement. The cascade persists from `width`/`height` inline style writes (layout-affecting, cannot be removed) and `updateCachedGroupOffsets()` forced reflows via `getBoundingClientRect()`. Five independent approaches across two attack vectors (scroll compensation: Phases 2a-2c; layout invalidation: Phase 3) have all failed.

7. **"Zero DOM reads" in proportionalResizeLayout is a real constraint**: Adding a forced reflow (clear height + set width + read offsetHeight) to the proportional resize path caused p95 = 20.7ms and max = 142.5ms frame times (9% of frames over 16ms budget). `offsetHeight` reads alone cost <1ms for ~80 cards, but the style invalidation + reflow from clearing/setting inline styles on every resize frame is expensive. The old estimation path (3-5ms) must remain the primary resize path.

8. **Image-load cover insertion is a secondary CLS source, not primary**: Cards mount without cover/img elements (height 193-280px). When images load, cover wrappers appear (~200px), causing 67-90px height deltas per card and up to 283px position shifts. However, CLS is visible in views with zero images — the estimation error corrections (7-13 mounted cards shifting 5-25px simultaneously via `remeasureAndReposition`) ARE perceptible. The image-load cascade (120 layout calls observed in session `f9de8344`) was measured in a view WITH images and incorrectly generalized as the primary source. Both sources contribute: estimation error is the baseline CLS present in all views, image-load adds on top in views with covers.

9. **`cardResizeObserver` is the empirically verified source of continuous post-resize scroll CLS on main branch**: ~100 calls per scroll session via the RO feedback loop (constraint #5). However, suppressing it had zero visible effect — the CLS the user perceives may have a different source during manual pane-border resize (vs programmatic sidebar toggle).

10. **Position propagation is fundamentally limited by non-uniform per-card estimation error**: A uniform per-column delta closes the boundary gap between flush-stacked and unmounted zones but cannot fix the distributed spacing errors within the shifted zone (3-33px per card, 800-3000px total over 200+ cards per column).

11. **`masonry-correcting` is a CSS no-op**: The class is added/removed in JS but has zero CSS rules in any SCSS file. It does nothing visually — pure timing marker.

12. **Layout Shift API excludes user-input-associated shifts**: `PerformanceObserver` with `layout-shift` type filters out shifts within 500ms of user input via `hadRecentInput`. Resize drag and scroll are both user input. CLS metrics from this API do NOT capture the shifts the user perceives during resize+scroll. Do NOT use Layout Shift API to measure this specific CLS.

13. **CSS `transition: top/left` on cards is reported as CLS by the Layout Shift API**: Each animation frame of a CSS position transition is counted as a separate layout shift. Animated transitions produce MORE measured CLS (spread across many frames) than instant snaps (one frame), even though they look smoother. However, per constraint #12, this measurement is unreliable during user input.

14. **Animated position corrections cause transition interruption cascade**: Removing `skipTransition=true` from correction paths enables CSS transitions, but `cardResizeObserver` fires ~16ms after each correction (height clearing triggers RO). Each re-entrant correction interrupts the in-progress transition, restarting it from the interpolated position. Combined with instant `scrollTop` compensation, this produces layout corruption (overlapping cards, empty space). A transition guard (`transitionGuardActive` flag blocking RO + deferred remeasure for the transition duration) prevents the cascade but doesn't address the underlying CLS.

15. **~~The CLS source is NOT the correction pipeline~~** *(invalidated)*: Phase 9.2 used `globalThis.__clsDiag` for runtime guards, but esbuild does not map `globalThis` to `window` — all guards were no-ops. Session `f4ae5162` re-tested with `window.__clsDiag` and confirmed: `noAll` (all corrections disabled) **eliminates CLS**. `noScrollIdle` alone also eliminates CLS. The correction pipeline IS the source. See [cls-source-isolation.md](cls-source-isolation.md).

16. **`isScrollRemeasurePending()` must NOT include `postResizeScrollActive`**: Adding `postResizeScrollActive` to `isScrollRemeasurePending()` blocks `resize-observer` and `resize-correction` sources in `updateLayoutRef` (line 1625-1634), preventing column count changes and proportional repositioning during resize. The `postResizeScrollActive` guard must be applied directly at specific correction paths (cardRO, image-load, property-measured, `scheduleDeferredRemeasure`) instead.

17. **Two CLS repro patterns, same root cause**: (1) Resize → scroll immediately (<200ms): `onScrollIdle` → `remeasureAndReposition` (Path B). (2) Resize → wait → scroll: `resize-correction` → `updateLayoutRef` inline code (Path A). Both share the same mechanism: clearing explicit `style.height` → cards reflow to natural height → downstream cards shift. Path A fires at rest (200ms after resize). Path B fires at scroll-idle. Both produce a jump when the user is stationary.

18. **`resize-correction` updates `measuredAtWidth` on all mounted cards**: After Path A runs, newly-mounting cards during scroll match `lastLayoutCardWidth` — `mountedPostResize` never triggers. Scroll-concurrent corrections that gate on `mountedPostResize` do not fire for the resize-then-wait-then-scroll repro. Confirmed empirically via `console.trace` instrumentation (zero `remeasureAndReposition` calls during scroll).

19. **Scroll-concurrent correction only addresses repro #1**: Moving `remeasureAndReposition` to fire during scroll does not address the primary CLS from `resize-correction` (Path A), which fires at rest before any scroll happens. The fix must address the shared height-clearing mechanism across both paths.

20. **Scroll-concurrent correction requires follow-up virtual scroll sync**: `remeasureAndReposition` inside `syncVirtualScroll` changes item Y positions, but mount/unmount decisions were already made earlier in the same call. Without a recursive `syncVirtualScroll()` after `didWork`, stale mounted items remain at wrong positions — producing blank columns. The `SCROLL_CORRECTION_INTERVAL_MS` (1000ms) throttle prevents re-entering the correction block on the recursive call.

21. **`scrollHeight` has a blind zone equal to `paddingBottom`**: `scrollHeight = max(clientHeight, paddingTop + contentIntrinsicHeight)`. When estimation error < `paddingBottom` (8px), `paddingTop + contentHeight < clientHeight`, so `scrollHeight === clientHeight === offsetHeight` — clipping undetectable. Empirically verified: all 7 clipped cards in a 350-card real-world test had diffs 3-7.7px, all below the 8px threshold. 0/7 detection rate. The typical estimation error (~9px avg) falls exactly in the blind zone.

## Estimation model

`estimateUnmountedHeight()` in `src/shared/virtual-scroll.ts` uses split proportional scaling:

- **Cover (scalableHeight)**: linear scaling — perfect accuracy (±0.3-0.5px avg error)
- **Fixed (fixedHeight)**: `fixedHeight × sqrt(widthRatio)` (k=0.5) — all estimation error comes from this

Empirical comparison (105 items, 61 unique aspect ratios, ultra-wide 4:1 to ultra-tall 1:5):

| Test | k=0.75 avgAbsErr | k=0.5 avgAbsErr | k=0.75 bias | k=0.5 bias |
|---|---|---|---|---|
| 676→564px (wide) | 11.8px | 10.6px | -6.0px | +1.1px |
| 387→334px (narrow) | 11.5px | 9.2px | -6.3px | +1.6px |

37% of items didn't reflow at all on 13-17% width change — the model predicted growth that never happened. ~8-10px avgAbsErr is the practical floor for any single-exponent heuristic.

## Industry survey

Virtual masonry scroll jumping is a well-documented, partially unsolved problem:

- **Masonic**: Permanent position cache + 2× viewport overscan buffer, zero scroll correction
- **TanStack Virtual / virtua**: `scrollTop` delta compensation. Virtua defers corrections during iOS momentum scrolling
- **react-virtualized**: Author (Brian Vaughn) confirmed it as unsolvable for scroll-up into unmeasured territory
- **Worst case for every library**: Jump-to-middle via scrollbar, then scroll up into unmeasured items

Sources: [TanStack/virtual #659](https://github.com/TanStack/virtual/issues/659), [react-virtualized #610](https://github.com/bvaughn/react-virtualized/issues/610), [virtua source](https://github.com/inokawa/virtua), [dotnet/aspnetcore #65158](https://github.com/dotnet/aspnetcore/issues/65158)

## Current state (Phase 1c + 1e)

### Pre-Phase-1 scroll compensation fixes (session `4eb5606b`)

Five fixes to the scroll compensation mechanism that reduce symptom severity:

1. `compensatingScrollCount` counter — replaces boolean (handles recursive `remeasureMountedCards` setting `scrollTop` multiple times per RAF)
2. Inline `onMountRemeasure` — replaces 200ms `scheduleMountRemeasure` (compensations before paint → invisible for small drifts)
3. Deferred `inMountRemeasure` clear — keeps guard active through RO callbacks (prevents ±X oscillation)
4. Deferred RO observation — newly mounted cards observed AFTER `onMountRemeasure` settles heights
5. `contain-intrinsic-height` padding subtraction — content-hidden cards no longer inflate `offsetHeight` by 16px

### Three-tier virtual scroll (Phase 1)

- **Tier 1** (mount zone): viewport ± 1×P — fully rendered
- **Tier 2** (content-hidden zone, desktop only): viewport ± 2×P — mounted for measurement, `content-visibility: hidden`. Desktop-only because Masonry lacks Grid's momentum mount cap (`touchActive`/`lastTouchEndTime`) — without it, 2×P mounts during flick scroll cause frame drops on mobile.
- **Tier 3**: unmounted (no DOM)

### Synchronous mount measurement (Phase 1b)

Never-measured cards (`measuredAtWidth === 0`) trigger `onMountRemeasure` synchronously in the same frame they mount. Result: **zero CLS on first forward scroll**. Empirical: zero scroll jumps across full 92K dataset (995 cards). Pre-Phase-1b baseline was 15 compensations of -62 to -269px.

### Deferred post-resize correction (Phase 1c)

Post-resize cards (`measuredAtWidth > 0` at different width) skip synchronous remeasure via `postResizeScrollActive` guard. Corrections deferred to scroll-idle. Result: **zero CLS during scroll** after resize, but one batch jump when scroll stops.

### Eager Tier 2 pre-measurement (Phase 1e)

Post-resize cards entering the content-hidden zone get measured and their baselines updated (`measuredHeight`, `measuredAtWidth`, `scalableHeight`, `fixedHeight`) without changing `item.height` or positions. 84% of unmounted items get exact estimates. Reduces drift magnitude in subsequent `remeasureAndReposition` calls but doesn't eliminate the visible jump.

## Tried approaches

### Phase 1d: Per-card incremental correction during scroll — REVERTED

**Mechanism**: Measure each newly-mounted post-resize card individually, apply per-column cascade deltas and scroll compensation per card during scroll.

**Result**: 56 incremental correction calls affecting 556 cards, 20 scroll compensations totaling 6771px. Significantly worse than 1 batch jump at scroll-idle.

**Why it failed**: Each correction shifts ONE column while others stay put. `scrollTop` compensation adjusts the entire viewport, overcompensating for non-shifted columns. Many small jitters > one batch jump.

### Phase 2a: Weighted-median anchor — REVERTED

**Mechanism**: Replace first-visible-card anchor with weighted-median visible-column anchor. Weight = visible pixels per column. Biases `scrollTop` correction toward the column with more visible content.

**Result**: ~10px improvement on 200px correction. Zero noticeable change.

**Why it failed**: Mathematically sound but insufficient — the problem is structural, not anchor-selection. 10px on 200px is perceptually irrelevant.

**Data**: 4→2 col resize, 118 post-resize cards. Col 0 delta = -203px (96px visible), col 1 delta = -194px (237px visible). Median chose -193px vs old -203px.

### Phase 2b: Per-card `translateY` compensation — REVERTED

**Mechanism**: After `scrollTop` compensation, apply `transform: translateY(-residual)` to each mounted card where `residual = colDelta - medianDelta`. Zero-CLS for one frame (exact pre-relayout positions), then clear transforms.

**Result**: Zero perceptible improvement. Transforms mask for one frame then snap to true positions — the snap IS the visible jump.

**Why it failed**: A single-frame visual mask is not perceptible — the snap to true positions IS the visible jump.

### Phase 2c: Per-column CSS `@keyframes` animation — REVERTED

**Mechanism**: CSS `@keyframes masonry-cls-slide` animates `transform: translateY(var(--cls-offset))` → `translateY(0)` over 200ms. Applied per-column residual as `--cls-offset`. Independent of `transition: none !important` from `masonry-skip-transition`.

**Result**: Zero perceptible improvement despite 200ms smooth slide of 10-30px residuals.

**Why it failed**: The 10-30px cross-column residuals are not the source of the visible CLS. Smoothly animating an imperceptible offset is still imperceptible.

### Phase 3: Transform-based positioning — REVERTED

All masonry card position writes used `transform: translate3d(x, y, 0)` instead of inline `top`/`left`. Compositor-only update — skips layout invalidation and paint for position-only changes (e.g., proportional resize). Applied to both Bases (`masonry-view.ts`, 8 sites) and Datacore (`masonry-layout.ts`, 1 site) backends. `width` and `height` remained as inline styles (layout-affecting, needed for text wrapping and scroll stabilization).

**CLS impact: none.** The visible scroll-idle jump after resize was unchanged. The style recalculation cascade persists because `width`/`height` inline style writes still trigger layout invalidation, and `updateCachedGroupOffsets()` still forces reflow via `getBoundingClientRect()`. The `top`/`left` writes were only part of the cascade source — removing them alone is insufficient. The transform change is a valid performance optimization for position-only updates but does not address the CLS problem.

### Phase 4: Reverse masonry placement — REVERTED

Reverse-greedy column assignment during upward scroll — anchor card bottom edges flush against topmost visible card per column, propagating estimation errors upward (off-screen). Full reflow at layout origin. Eliminated CLS but introduced 300-2300px blank gaps between cards during upward scroll (proportional layout estimates produce non-gap-free positions, and Phase 4 suppresses corrections).

**See [cls-reverse-placement.md](cls-reverse-placement.md)** for the full experiment log — design, implementation, bugs found, and failure analysis.

### Phase 5: RO feedback loop suppression — REVERTED

The multi-frame CLS cascade (constraint #5: 13 layout shifts across ~8 paint frames) is caused by a `cardResizeObserver` feedback loop: `remeasureAndReposition` clears heights → RO fires → RAF → another `remeasureAndReposition` → cascade across frames.

Fix: boolean `suppressCardResizeObserver` flag set in `remeasureAndReposition` before DOM writes when `skipTransition=true`. The `cardResizeObserver` callback checks and self-clears the flag, returning early. Double-RAF fallback handles cases where no RO fires (heights unchanged).

Key discovery: CSS class-based guards (`classList.contains('masonry-skip-transition')`) are unreliable for gating RO callbacks. Per the WHATWG HTML spec "update the rendering" algorithm, RAF fires at step 11 BEFORE ResizeObserver delivers at step 14 — the RAF that removes the class executes before the RO callback checks it. `setTimeout(0)` is also wrong — tasks run before the rendering pipeline. Only double-RAF (RAF₁ at step 11 → RAF₂ at next frame's step 11) reliably spans the RO delivery window.

**CLS impact: partial.** Eliminates the feedback loop cascade (13→2 correction frames). But the single-frame correction at scroll-idle still moves 7-13 visible cards by 5-25px. These deltas are within the 10-30px range previously classified as imperceptible (constraint #4), but simultaneous movement of 13 cards may exceed the perceptibility threshold.

**Status: REVERTED** — `suppressCardResizeObserver` was only on the experimental branch and was reverted alongside the Phase 4 reverse placement work. Never committed to main.

### Phase 6: Actual mounted-card measurement — REVERTED

Replaced `estimateUnmountedHeight` with actual `offsetHeight` reads for mounted cards in `proportionalResizeLayout`. Caller prep: clear explicit height + set new width on all mounted cards + force one reflow. Layout loop reads `offsetHeight` for mounted cards (no additional reflow since cards are absolutely positioned), estimates for unmounted. Also updates `scalableHeight`/`fixedHeight`/`measuredAtWidth` baselines so future estimation is accurate when cards get unmounted.

**CLS impact: zero for resize-correction path.** Correction pass finds 0 position changes and 0 height mismatches — estimation error eliminated at the source for mounted cards (was 15-26px avg, 46-68px max).

**Performance impact: unacceptable.** The forced reflow per resize frame caused frame drops during drag: p95 = 20.7ms, max = 142.5ms, 9% of frames over 16ms budget (122 frames measured). The "zero DOM reads" design of `proportionalResizeLayout` was a real performance constraint, not over-engineering — `offsetHeight` reads on ~80 cards cost <1ms, but clearing height + setting width + forcing reflow on every resize frame triggers expensive style recalculation.

**Key discovery: estimation error AND image-load cover insertion both cause CLS.** In views with images, instrumentation revealed 120 layout calls after a single resize+scroll, dominated by `image-load` → `remeasureAndReposition` cascades — cards mount without cover/img elements (height 193-280px), and cover wrappers appear on load (~200px delta). However, CLS is also visible in views with zero images, confirming that the estimation error corrections (7-13 cards shifting 5-25px simultaneously) are independently perceptible. The 120-call cascade was incorrectly generalized as the sole CLS source.

### Performance trace diagnosis — COMPLETED

DevTools Performance trace captured during resize→scroll→idle→`remeasureAndReposition` (995 items, 4→2 column change, session `7e845376`).

**Results**:

| Metric | Value |
|---|---|
| Layout shifts | 13 in 132ms cluster (CLS 0.053) |
| Style recalculations | 12 × 42-82ms each (2.8K-7.2K elements) |
| Forced reflow total | 418ms |
| Top reflow sources | `eagerPreMeasure` 53ms, minified layout funcs 137/120/93ms |

**Root cause identified**: The CLS is NOT a single jump — it's 13 layout shifts across ~8 paint frames over 132ms. Inline `top`/`left`/`width` + CSS custom property writes to ~50 mounted cards during `remeasureAndReposition` invalidate layout. `updateCachedGroupOffsets()` then forces layout via `getBoundingClientRect()`. Each style recalculation cascades through 2.8K-7.2K elements (42-82ms), long enough for the browser to yield and render intermediate frames with partial position updates.

**Impact on prior analysis**: The three compensation approaches (Phases 2a-2c) targeted cross-column differential (~10-30px) — an imperceptible effect. The actual CLS source is the multi-frame style recalculation cascade during position writes, not imperfect scroll compensation.

### Per-column DOM wrappers — REJECTED (not implemented)

**Mechanism**: Wrap each column in a container div, apply per-column `translateY` to the wrapper.

**Why rejected**: Column count changes during resize (e.g., 4→2 cols) require reparenting cards between wrappers. Reparenting ~500 cards triggers full layout recalculation, breaking the proportional resize fast path (zero-DOM-read, single-pass, 3-5ms/frame at 60fps).

### Phase 8: Directional flush stacking — REVERTED

Redesigned reverse placement as directional flush stacking. Newly-mounting cards during post-resize scroll are measured on mount and positioned off-screen (forward below viewport, reverse above). `remeasureAndReposition` runs at scroll-idle — flush-stacked cards have zero drift. All 5 plan gaps from Phase 4 addressed upfront.

Core mechanism implemented and runtime-verified but CLS not yet eliminated. ~6 seed cards (already mounted before deferred resize relayout) remain stale and produce minimum CLS at scroll-idle correction. Flush stacking + position propagation were implemented and tested but failed to eliminate CLS.

**See [cls-reverse-placement.md](cls-reverse-placement.md)** for the full implementation details, bugs found, and the Phase 4→Phase 8 evolution.

### Phase 8.2: Position propagation — REVERTED

Propagated per-column Y deltas from flush-stacked zone to unmounted zone after each `flushStackMounts` batch. Three boundary detection iterations: `seenMounted` gate (skipped mounted items — wrong side seeding), flush-stacking signature filter (no boundary gate — -12111px deltas), `seenFlush` gate (correct boundary but blank space persisted).

**Result**: Propagation closed the boundary gap (verified: 366 items shifted +81 to +164px forward, 500+ items shifted -9 to -114px reverse). But blank space persisted (3352px max gap). Root cause: uniform per-column delta corrects the boundary offset but not the non-uniform per-card spacing errors within the shifted zone. Each card has 3-33px estimation error; over 200+ cards per column, total distributed error is 800-3000px.

Also extended propagation to mounted off-screen items (writing `style.top` for items outside viewport). Still ineffective — the spacing error is structural, not an offset problem.

### Phase 8.3: cardResizeObserver suppression — REVERTED

Empirical trace on main branch identified `cardResizeObserver` as the sole source of continuous CLS during post-resize scroll: ~100 `cardResizeObserver` → `remeasureAndReposition` calls per scroll session. `onScrollIdle` fired once at end. `onMountRemeasure` fired zero times.

Fix attempted: `postResizeScrollActive` guard on `cardResizeObserver` + `scrollRemeasureTimeout` cancel after setting guard. Zero visible effect on user's manual reproduction (pane border drag + scroll). The trace was done with programmatic sidebar toggle — may trigger different timing than manual pane resize.

### Phase 9: Crossfade opacity masking — REVERTED

Applied `masonry-fade-correcting` CSS class (opacity 0.4 with `transition: opacity 70ms ease !important`) to dim cards before position corrections. Three iterations:

- **v1**: Added class and called `remeasureAndReposition` in same RAF — browser batched both into one paint, dimmed state never rendered.
- **v2**: RAF separation inside `scheduleDeferredRemeasure` — wrapped only the follow-up correction, but the primary CLS source was `updateLayoutRef('resize-observer')` running synchronously before `scheduleDeferredRemeasure`.
- **v3**: Added class in `onScrollIdle` before `updateLayoutRef`, deferred layout to RAF — but the `pendingDeferredResize` branch never fires for the user's repro (resize → then scroll). The actual CLS comes from the non-deferred `onScrollIdle` path which had only 2-3px corrections (imperceptible).

**Why it failed**: Applied to wrong code path. `pendingDeferredResize` requires resize correction to fire DURING active scroll (rare timing). The user's repro (resize → then scroll) means the correction fires before scroll starts.

### Phase 9.1: Animated CSS transitions — REVERTED

Removed `skipTransition=true` from all correction paths so `remeasureAndReposition` writes positions that animate via existing CSS `transition: top 200ms, left 200ms` on `.masonry-positioned`. Visually working at 1s and 2s test durations. At 500ms, layout corruption appeared (overlapping cards, empty space).

**Root cause of corruption**: `cardResizeObserver` feedback loop — height clearing in `remeasureAndReposition` fires RO ~16ms later, which calls `remeasureAndReposition` again while the previous CSS transition is in progress. Each re-entry interrupts the transition and applies instant `scrollTop` compensation against the full position delta while cards are mid-animation. At longer durations (1-2s) the interruption happens when cards have barely moved (~1-3% displacement) so corruption is invisible. At 500ms the interruption is visible (~6% displacement per frame).

A transition guard (`transitionGuardActive` flag blocking `cardResizeObserver`, `scheduleDeferredRemeasure`, and `onMountRemeasure` for `MASONRY_CORRECTION_MS + 16ms`) was implemented and prevented the cascade, but the underlying CLS was unchanged because corrections are not the CLS source (constraint #15).

### Phase 9.2: CLS source isolation — INVALIDATED

Systematic elimination of CLS source candidates. Four experiments disabled individual subsystems; CLS persisted through all. **All experiments were invalid** — diagnostic guards used `globalThis.__clsDiag` which esbuild does not map to `window`, making every guard a no-op. Key finding that remains valid: the Layout Shift API is unreliable for this problem (`hadRecentInput` filtering).

Session `f4ae5162` re-ran elimination experiments with working guards (`window.__clsDiag`). Results: `noAll` (all corrections disabled) **eliminates CLS**. `noScrollIdle` alone eliminates CLS. Source identified as `onScrollIdle` → `remeasureAndReposition` clearing explicit heights → text-wrap height growth → column reposition cascade.

**See [cls-source-isolation.md](cls-source-isolation.md)** for the corrected experiments and full CLS mechanism.

### Phase 10: Scroll-concurrent correction — COMMITTED

Inverted the correction timing: instead of correcting at scroll-idle (all prior phases), correct DURING active scroll so scroll motion masks the visual shift. Never correct at rest. Implemented throttled `remeasureAndReposition` in `syncVirtualScroll` (every `SCROLL_CORRECTION_INTERVAL_MS` = 1000ms during scroll), gated on `postResizeScrollActive`. Removed the non-deferred `onScrollIdle` correction path entirely.

**Result**: Does not address the primary CLS repro (resize → wait → scroll). `resize-correction` (Path A) fires 200ms after resize and updates `measuredAtWidth` on all mounted cards. By the time the user scrolls, newly-mounting cards already match `lastLayoutCardWidth` — `mountedPostResize` never triggers, so the scroll-concurrent correction never activates. Confirmed via `console.trace` instrumentation: zero `remeasureAndReposition` calls during scroll.

**Key discovery**: The visible CLS is from `resize-correction` itself (Path A, `updateLayoutRef('resize-correction')` inline code), not from `onScrollIdle` → `remeasureAndReposition` (Path B). Both paths share the same height-clearing + repositioning mechanism, but the primary repro only triggers Path A.

**Status**: Committed on main (`6fb3ae0`). Path unification replaced dual Path A/B with single `remeasureAndReposition` call from resize-correction. Removed `pendingDeferredResize`, `scrollRemeasureTimeout`, `onScrollIdle`. `isScrollRemeasurePending()` simplified to `inMountRemeasure` only. Hidden-tab guard added (zero-width container check). Sparse layout regression fixed (`3a4258f`) — scroll-concurrent correction inside `syncVirtualScroll` needed follow-up `syncVirtualScroll()` after `remeasureAndReposition` changed positions. Scroll-idle safety net (`postResizeIdleTimeout`, 2s) clears `postResizeScrollActive` if user stops scrolling mid-correction.

### Layer 2: scrollHeight pre-read — REVERTED

Read `scrollHeight` on height-clamped cards to detect text clipping without clearing heights. Growth-only — only fixes underestimates (clipped text), defers overestimates to scroll. No height clearing = no CLS cascade. Called in `resizeCorrectionTimeout` after guards, before `postResizeScrollActive`.

**Mechanism**: `scrollHeight` returns natural content height even when `style.height` is set. For cards where `scrollHeight > offsetHeight`, grow `style.height` to `scrollHeight + paddingBottom`, reposition with stable columns, apply scroll compensation.

**Precondition**: Only relevant when virtual scrolling is active (unmounted items exist). When all cards are mounted, the full measurement path gives natural DOM heights — no estimated clipping. Test with >50 cards + scroll to activate virtual scrolling, then resize narrow→wide.

**Result**: 0/7 clipped cards detected in 350-card real-world test. The technique works for large clipping (>8px) but fails for the typical estimation error range (3-8px).

**Root cause — `scrollHeight` blind zone (constraint #21)**: `scrollHeight = max(clientHeight, padTop + contentIntrinsicHeight)`. When clipping < `paddingBottom` (8px), `padTop + content < clientHeight`, so `scrollHeight === clientHeight`. The browser reports no overflow. All 7 clipped cards had diffs of 3-7.7px — all below the 8px threshold. The typical estimation error falls exactly in the blind zone.

**Key discovery**: `scrollHeight + paddingBottom` = exact natural height when clipping IS detected (verified 20/20 cards, 0 error, 0.2ms/60 cards). The technique itself is sound — it just can't see small diffs.

### Accept as inherent limitation — REJECTED

The CLS is NOT an inherent limitation of virtual masonry — it is caused by the correction pipeline. The correction is necessary (cards need accurate heights), but its timing and visual impact can be improved.

- **Evidence for**: Three compensation approaches (Phases 2a-2c) targeting cross-column differential produced zero improvement. Transform-based positioning (Phase 3) eliminating `top`/`left` layout invalidation also produced zero improvement. Position propagation (Phase 8.2) proved that uniform per-column deltas cannot fix non-uniform per-card estimation errors. The error is distributed across cards, not concentrated at a boundary. cardResizeObserver suppression (Phase 8.3) had zero visible effect despite eliminating ~100 RO feedback loop calls per scroll. Phase 9.2 proved that the correction pipeline is not the CLS source — disabling all corrections produces the same visible CLS. The Layout Shift API is unreliable for this measurement (constraint #12). Ten independent approaches across five attack vectors have failed. The estimation error is structural. Cross-column differential is provably unfixable by scroll compensation. The remaining `width`/`height` writes and `getBoundingClientRect()` forced reflows cannot be eliminated without fundamentally changing the layout model.
- **Evidence against**: Width-bucket caching and detached offscreen measurement attack a third vector — estimation accuracy — which has not been fully explored.

### Layer 1: Defer height correction to scroll — COMMITTED

`resize-correction` no longer calls `remeasureAndReposition`. Instead, it sets `postResizeScrollActive = true` directly, deferring height correction to the scroll-concurrent path. The 2s idle timeout clears the flag without correcting if the user never scrolls.

**Constraint #18 workaround**: Instead of relying on `mountedPostResize` (which requires `measuredAtWidth` mismatch), `postResizeScrollActive` is set directly by the resize-correction timeout. This bypasses the constraint entirely — scroll-concurrent correction activates on first scroll regardless of `measuredAtWidth` state.

**Guards added**: `cardResizeObserver`, image-load coalescing, `initialRemeasureTimeout`, and the `remeasureAndReposition` early-exit skip-transition cleanup all check `postResizeScrollActive` to prevent at-rest corrections during the deferral window.

**Result**: Zero CLS at rest for both repro patterns (resize → wait → scroll, and resize → scroll immediately). Both converge to the same scroll-concurrent correction mechanism. Corrections during scroll are masked by motion.

**Trade-off**: Between resize-end and first scroll, cards have estimated heights (~9px avg clipping). scrollHeight pre-read attempted but failed (constraint #21 — blind zone). Addressable by width-bucket height cache.

**Status**: Committed on main (`3b45d24`). Also includes masonry simplification (`eccfe72`) — extracted `resolveStableOrGreedy`, `applyCardPositions`, `createVirtualItem` helpers, `LayoutSource` type union, `get win()` getter, shared constants. Net -183 lines.

## Remaining candidates

### 1. Width-bucket exact height cache

Cache exact measured heights keyed by card width (rounded to nearest 10px). Users drag through a small set of widths — after one resize cycle, many cards have cached exact heights for common widths.

- **Pros**: Eliminates estimation error at the source for repeated widths. Progressive improvement.
- **Cons**: First resize at a new width still has full error. Cache invalidated by content changes. Memory cost scales with cards × width buckets.
- **Effort**: Medium (~50-80 lines).

### 2. Pre-mount cover space reservation

Reserve cover height in the card DOM at mount time using cached aspect ratios, BEFORE the image loads. The `imageMetadataCache` already stores aspect ratios for previously-seen images. When a card mounts with a known image URL, render the cover wrapper with `padding-top` based on the cached ratio — same technique used post-load, just applied earlier. Cards would mount at their final height, eliminating the ~200px jump when images load.

- **Pros**: Addresses the secondary CLS source (~200px per card from image-load). Zero resize performance cost. Uses existing cache infrastructure. Complements estimation-error fixes.
- **Cons**: First-ever image load still has no cached ratio (must fall back to default). Cache is in-memory only — lost on app restart.
- **Effort**: Medium (~30-50 lines).

### 3. Velocity-proportional correction throttle

Refinement over binary scroll-concurrent. Correction throttle interval scales inversely with scroll velocity: fast scroll = correct every 500ms, slow scroll = every 2000ms. Simplest form: replace fixed `SCROLL_CORRECTION_INTERVAL_MS` with `Math.max(500, 2000 - velocity * k)`. ~5 lines.

- **Pros**: Better masking of corrections during slow scroll.
- **Cons**: Over-engineering — the binary approach captures 90% of the benefit. The primary CLS is at rest (velocity=0), which velocity-proportional doesn't address.
- **Effort**: Low (~5 lines). Consider only if scroll-concurrent correction itself is perceptible.

### 4. Visual reference

See `一/Masonry CLS mechanism.canvas` — audited flowchart of the full CLS mechanism, function graph, and remaining candidates.

## References

- **Issue**: [#358](https://github.com/churnish/dynamic-views/issues/358) — original problem report with progress comments

### Sessions

- `e1137b1a-4a8c-40d4-b38a-2f822d74ac09` — Phases 1–1e. Session report section 7 has 18 empirical findings.
- `7e845376-c46c-464b-aff7-51388c1220cc` — Phases 2a–4. Empirical findings extracted to [cls-reverse-placement.md](cls-reverse-placement.md).
- `f9de8344-bdcf-4307-a26f-1eb770532cbb` — Phase 5 RO feedback loop suppression, Phase 6 actual mounted-card measurement (reverted — resize jank). Key discoveries: setTimeout vs double-RAF ordering, image-load cover insertion as primary CLS source.
- `a1535935-e203-442b-90bd-d33132f172a9` — Phase 8 directional flush stacking.
- `5c11119f-07d9-4edc-8afc-0a0cb51ba6b2` — Phase 8.1/8.2 flush stacking, position propagation attempts, directional growth architecture design.
- `697a1bea-eb5a-4f32-a45e-1e99895d8c75` — Phase 8.2 position propagation (reverted), Phase 8.3 cardResizeObserver suppression (reverted). Empirical CLS trace on main branch.
- `bd6310f2-f04e-428c-bce6-934dbe977b87` — Phase 9 crossfade masking (wrong code path), Phase 9.1 animated transitions (layout corruption from RO feedback loop), Phase 9.2 CLS source isolation (corrections not the source, Layout Shift API unreliable). Key discoveries: `masonry-correcting` is CSS no-op, `pendingDeferredResize` timing, transition interruption cascade, Layout Shift API `hadRecentInput` filtering.
- Pre-Phase-1: scroll compensation fixes (5 fixes, referenced as `4eb5606b` in issue comments — full UUID unknown)
- Pre-Phase-1: estimation model optimization k=0.75→0.5, industry survey (referenced as `d52099d0` in issue comments — full UUID unknown)
- `f4ae5162-1f22-4494-b8dc-305ce1037c48` — CLS source identified (`globalThis` bug found). Handoff session for `e1bfc13f`.
- `e1bfc13f-6e9c-43c3-916a-12396e05b99a` — Phase 10 scroll-concurrent correction (incomplete). Two CLS repro patterns identified (Path A vs Path B). Canvas consolidated and audited. Constraints #16-19.
- `80d28af2-4d57-43c3-9261-479dd5a723fa` — Path unification (dual Path A/B → single `remeasureAndReposition`). Handoff session for `b4ff3a0f`.
- `b4ff3a0f-adad-40a6-b475-3bd0ff1421c3` — Sparse layout regression fix (`3a4258f`). Scroll-concurrent correction follow-up sync. `postResizeIdleTimeout` safety net.
- `9e52cedb-aa5a-4cf4-afa7-5111024373c4` — Layer 1 defer height correction to scroll (`3b45d24`). Masonry simplification (`eccfe72`). CLS mechanism canvas extensively updated. scrollHeight pre-read candidate proposed.
- `02a292a2-ea88-4942-bbc4-63938c73f4d1` — Layer 2 scrollHeight pre-read (reverted — blind zone). Constraint #21 discovered. Visual reference: `一/scrollHeight blind zone.diagram.md`.

## Key source files

- `src/bases/masonry-view.ts` — `remeasureAndReposition`, `syncVirtualScroll`, `eagerPreMeasure`, `scheduleDeferredRemeasure`, `postResizeIdleTimeout`
- `src/utils/masonry-layout.ts` — `repositionWithStableColumns`, `calculateMasonryLayout`
- `src/shared/virtual-scroll.ts` — `VirtualItem`, `estimateUnmountedHeight`, `measureScalableHeight`
- `src/shared/constants.ts` — `MASONRY_CORRECTION_MS` (200ms), `HIDDEN_BUFFER_MULTIPLIER` (2), `SCROLL_CORRECTION_INTERVAL_MS` (1000ms)
- `styles/_masonry-view.scss` — `masonry-skip-transition`, `--masonry-reposition-duration`
