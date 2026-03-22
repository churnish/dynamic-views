# Masonry layout optimization roadmap

- Optimize Masonry layout for maximal parity with Media Companion.
- No optimization is too small; even a 0.1% improvement is valuable.
- Measure, optimize, repeat until near MC parity.
- **Profiling reference**: session `ce81d2e3`. 300-card fixture, 10 groups, vault-local images, 5 columns at 340px. Single-run data — directional signal is clear but exact values need replication (3 runs with median).

## Status key

- **Done** — implemented and verified
- **In progress** — plan exists, implementation pending
- **Planned** — scoped but no implementation plan yet
- **Evaluate** — needs investigation before committing
- **Reverted** — attempted, didn't work
- **Deprioritized** — profiling showed low impact
- **Eliminated** — profiling showed no need

## CLS elimination (#358)

Tracked in dedicated doc: [cls-elimination.md](cls-elimination.md). Contains full problem analysis, estimation model empirics, industry survey, proven constraints, all tried/rejected approaches with results, and remaining candidates.

## Priority order (Bases)

Recalibrated from T1-T12 profiling battery. Ordered by expected impact x confidence.

| # | Task | Expected impact | Evidence | Status |
|---|---|---|---|---|
| P0 | Resize frame cost investigation | 93ms→43ms avg (54% reduction) | T6: Style recalc dominated (41-189ms). Deferred `syncResponsiveClasses` + scroll gradients to post-resize. ~42ms architectural floor remains (Blink style recalc). | Done |
| P1 | `updateCachedGroupOffsets` algorithm | 39ms→0ms on scroll frames | T1: 39ms for 2 groups. Fixed: `groupOffsetsDirty` flag skips DOM reads on scroll-only frames. | Done |
| P1 | Cold-start forced reflow reduction | 113ms → <50ms total | T1: 3 reflow paths (57 + 39 + 42ms). | Planned |
| P2 | Reduce `renderCard()` DOM | Compounds across all layout operations | T1: 2,657 elements, 4,485 style recalc. T12: 37 mutations/card. | Evaluate |
| P2 | CardHandle cleanup cost | 27ms/card → <5ms/card | T10: 508ms for 19 cards. Linear scaling. | Planned |
| P1 | Transform-based positioning | Eliminates ~42ms/frame architectural floor | T6 confirmed: style recalc from `top/left/width/height` writes is the remaining cost. `translate3d` is compositor-only. | **Done** |
| — | Pre-cached image dimensions | Marginal for vault-local images | T2: 2ms load span. T3: deferred remeasure catches drift at 95ms. | Deprioritized |
| — | Single-column reflow | Marginal with current coalescing | T2: 1 relayout/frame. O(n) where n=23 mounted, not 300 total. | Deprioritized |
| — | Staggered mounting | No scenario requires it | T5: 23-42 mounted, no storms, change every ~7.5 frames. | Eliminated |

Sections below are ordered by **subsystem/concern area**, not by priority or chronology. The priority table above (P0-P3) handles priority ordering.

## 1. Scroll smoothness

| Optimization | Status | Notes |
|---|---|---|
| Stable column assignment during remeasure | Done | `repositionWithStableColumns()` — preserves column from existing `left` position instead of greedy shortest-column. |
| Debounced scroll remeasure (200ms) | Done | Split into two timers: `scrollRemeasureTimeout` handles deferred resize only (`pendingDeferredResize`). `mountRemeasureTimeout` (200ms trailing throttle) handles post-mount scroll corrections. Eliminates mid-scroll flicker. |
| Smooth correction transition (200ms ease) | Done | Default 200ms ease transition on `.card.masonry-positioned` via `--masonry-reposition-duration` provides smooth correction. `masonry-correcting` class is added/removed in JS to time the correction window (must match `MASONRY_CORRECTION_MS`). Corrections visible to user since they fire when scroll is idle. |
| Post-mount remeasure (`remeasureAndReposition`) | Done | Trailing throttle via `mountRemeasureTimeout` (200ms). First mount in `syncVirtualScroll` starts timer; subsequent mounts during cooldown ignored (timer not reset). After 200ms, `onMountRemeasure()` calls `remeasureAndReposition(skipTransition=true)`. Fixes overlap from proportional height drift. |
| Deferred remeasure (`scheduleDeferredRemeasure`) | Done | Double-RAF catch for async height changes (image decode, cover-ready). **T3**: Catches drift at ~95ms after initial layout, cancelling the 500ms safety net as designed. |
| Batch layout guard (`!batchLayoutPending`) | Done | Prevents `remeasureAndReposition` from corrupting `groupLayoutResults` during double-RAF wait. |
| Scroll compensation | Done | Adjusts `scrollTop` after remeasure to keep first visible card anchored. Only fires when scroll is idle (no feedback loop risk). |
| Batch position merge | Done | `calculateIncrementalMasonryLayout` with inline merge of `positions`, `heights`, and `columnAssignments` arrays across batches so stable reposition has full data. |
| Image-load stable columns | Done | Image-load handler uses `remeasureAndReposition` (stable columns) instead of full greedy `calculateMasonryLayout`. |
| Card ResizeObserver | Done | Single `ResizeObserver` on all mounted cards, RAF-debounced. Catches any card height change: CSS-only settings (cover ratio, text preview lines, title lines), text preview changes, image loads. Observed in `renderCard`, unobserved in `unmountVirtualItem`. Guards skip during active resize, batch layout, and pre-layout. |

## 2. Resize smoothness

| Optimization | Status | Notes |
|---|---|---|
| Proportional resize scaling | Done | Zero-DOM-read `height * (newWidth / oldWidth)` at ~60fps. Single-pass `proportionalResizeLayout` with zero intermediate allocations — inlines greedy shortest-column, updates VirtualItems in-place, writes styles to mounted cards in one iteration. **T6: 93ms→43ms avg (54%), 189ms→56ms worst (70%).** Deferred `syncResponsiveClasses` + `initializeScrollGradientsForCards` to post-resize correction. ~42ms floor = Blink style recalc for 70 cards with inline style writes. |
| Synchronous ResizeObserver layout | Done | Layout runs synchronously inside RO callback — no RAF deferral. RO fires at most once per frame, providing native coalescing. Replaced 100ms throttle + double-RAF (~7.5fps). Chromium throttles RAF for 400ms-3s after rapid `setBounds`, so RAF-based deferral caused stale layouts. |
| `pendingResizeWidth` cache | Done | Eliminates `getBoundingClientRect` during resize. |
| Explicit card height during resize | Done | `style.height` set on mounted cards during resize prevents layout/render mismatch between proportional positions and `height: auto` render. Cleared on correction. |
| Image-load suppression during active resize | Done | `image-coalesced` relayouts skipped when resize active. Prevents image-load events interleaving with resize frames (~2.2ms each). Post-resize correction picks up height changes. |
| Post-resize correction (200ms debounce) | Done | DOM re-measurement to fix proportional drift. Uses default `--masonry-reposition-duration` (200ms) transition on `.card.masonry-positioned`. 200ms is the minimum safe debounce — 16ms and 100ms both cause card flashing from mid-drag correction firing. **T8: 283ms correction delay (200ms debounce + 83ms DOM/style), 222ms transition, 505ms total settle.** Matches design expectations. |
| Unconditional sync during resize | Done | `syncVirtualScroll` runs every proportional frame. Cheap for same-column-count (0-3 mounts at edges). Skipping caused blank space from proportional drift at viewport edges. |
| Split proportional scaling (scalable + fixed) | Done | Cover scales linearly, text stays fixed: `scalableHeight * ratio + fixedHeight`. [Issue #300](https://github.com/churnish/dynamic-views/issues/300). |
| Stable columns during resize correction | Done | First-class `col` on VirtualItem + `columnAssignments[]` on MasonryLayoutResult. All layout paths produce and consume stored column indices — correction pass uses `repositionWithStableColumns` when column count unchanged. Eliminates post-resize shuffle. |
| Pure proportional during resize (no DOM reads) | Reverted | Pure proportional IS the active resize path (zero DOM reads via `proportionalResizeLayout`). What was rejected: omitting post-resize correction. Without the 200ms debounced DOM re-measure after resize ends, proportional height drift caused visible gaps that persisted after release. The current system uses pure proportional during drag + DOM correction after. |
| CSS transitions during resize | Done | `masonry-resize-active` keeps `top`/`left` transitions at `--masonry-reposition-duration` (200ms). Cards animate to new positions during drag. `width` and `height` are not transitioned — height snaps to match proportional scaling, width assumes target instantly. Became viable after split proportional scaling (#300) reduced per-frame cost. |
| Deferred resize-path forced reflows | Done | `syncResponsiveClasses` + `initializeScrollGradientsForCards` moved from per-frame RO callback to post-resize correction via RAF. Eliminated style recalc escalation (41→189ms growing pattern). Per-frame cost now flat ~42ms. `resizeCorrectionRafId` tracked in `teardownObservers()` + `isConnected` guard. |

## 3. Image load efficiency

| Optimization | Status | Notes | Value | Effort |
|---|---|---|---|---|
| Image-load coalescing | Done | Single RAF debounce via `pendingImageRelayout` flag. ~60 concurrent loads → 1 layout/frame. **T2: 23 images in 2ms span.** Vault-local images complete within a single frame — coalescing works but benefit masked by local I/O speed. | | |
| Single-column reflow on image load | Deprioritized | MC's `reflowColumn()` shifts only same-column items by delta — O(n/cols). DV uses `remeasureAndReposition` with stable columns (O(n) but preserves column assignments). **Deprioritized**: T2 showed image-load coalescing limits to 1 relayout/frame, and virtual scroll means n=23 mounted cards not 300 total. O(23) vs O(23/5) is negligible. Revisit at 500+ mounted cards with external images. | 1 | 3 |
| Pre-cached image dimensions | Deprioritized | MC uses sidecar metadata for math-based height: `(colWidth / imgWidth) * imgHeight`. DV uses DOM `offsetHeight`. DV already caches aspect ratios in `imageMetadataCache`. **Deprioritized**: T3 showed deferred remeasure catches drift reliably at ~95ms, cancelling safety net as designed. T2 showed vault-local images load in 2ms. Correction mechanism works — eliminating corrections at the source has marginal benefit. Revisit for external/slow images. | 1 | 3 |

## 4. Rendering performance

| Optimization | Status | Notes | Value | Effort |
|---|---|---|---|---|
| Inline styles replacing CSS custom properties | Done | Direct `style.left`/`style.top`/`style.width`/`style.height` instead of `--masonry-left`/`--masonry-top` etc. Eliminates CSS variable resolution overhead. Container `--masonry-height` stays as custom property (one-per-container). | | |
| Scoped `container-type` to grid-only | Done | Moved `container-type: inline-size` from `.dynamic-views .card` (all cards) to `.dynamic-views-grid .card`. No `@container` queries target masonry card-level containment — was creating unused layout work. | | |
| `virtualItemsByGroup` pre-index | Done | `Map<string \| undefined, VirtualItem[]>` with `rebuildGroupIndex()`. Eliminates repeated O(n) filter scans (3-5 per layout call) with O(1) map lookup. | | |
| `for` loops replacing `forEach` | Done | In `calculateMasonryLayout` and `calculateIncrementalMasonryLayout`. Eliminates closure allocation per card. Exception: `applyMasonryLayout()` (Datacore-only path) still uses `forEach`. | | |
| `contain: layout style paint` | Done | On `.masonry-positioned` cards. Limits paint boundaries without full layer promotion. | | |
| Batch `offsetHeight` reads | Done | Single forced reflow per layout pass — read all heights before writing positions. | | |
| `content-visibility: hidden` for off-screen cards | Done | IntersectionObserver-based visibility management for virtual scroll. | | |
| CardHandle per-card cleanup | Done | `renderCard()` returns `{ el, cleanup }`. Cleanup aborts AbortController, disconnects ResizeObservers, stops slideshows. Enables individual card teardown for virtual scrolling. **T10: 27ms/card cleanup cost.** Dominated by `ResizeObserver.unobserve` + `virtualItems` splice + `rebuildGroupIndex`. See CardHandle cleanup optimization below. | | |
| Reduce `renderCard()` DOM element count | Evaluate | DV creates ~15-30 DOM elements per card (varies by features) vs MC's ~3-5. **T1: 2,657 total DOM elements, 4,485 style recalc elements for 40 cards. T12: 37 DOM mutations/card for property reorder (846 total).** DOM complexity is a background tax on every layout operation — style recalc, forced reflow, mutation handling all scale with element count. | 4 | 4 |
| Transform-based positioning | Planned | `transform: translate3d(x, y, 0)` is compositor-only (skips layout+paint). Current `top`/`left` triggers layout recalc. **T6 confirmed: ~42ms/frame architectural floor is Blink style recalc from inline `top/left/width/height` writes.** Transforms would eliminate position-change recalc (compositor-only). Trade-off: significant per-card VRAM cost from compositor layer promotion at high DPR. `contain: layout style paint` already limits scope but does NOT prevent style recalc. | 5 | 2 |
| Cold-start forced reflow reduction | Evaluate | **T1: 113ms total forced reflow across 3 paths.** `updateLayoutRef.current` (57ms initial + 12ms second), ~~`updateCachedGroupOffsets` (39ms)~~ resolved, `remeasureAndReposition` (42ms), style recalc (49ms, 4,485 elements). Remaining: ~74ms across 2 paths — consolidation could still reduce total cost. | 3 | 3 |
| CardHandle cleanup optimization | Evaluate | **T10: 27ms/card cleanup, 508ms for 19-card group collapse.** Per-card: `AbortController.abort()`, `ResizeObserver.unobserve()`, slideshow stop, `virtualItems` splice + `rebuildGroupIndex`. The array mutation + index rebuild repeats per card — batching cleanup (splice once, rebuild once) could dramatically reduce cost. | 3 | 2 |
| Synchronous property measurement | Done | Replaced async RAF queue with synchronous paired property measurement — eliminates 2-3 frame mount flicker. CSS `visibility: hidden` fallback gate. Removed ~150 lines of queue infrastructure. | | |
| Batched compact-stacked wrapping detection | Done | RAF-batched read/write: collapse N forced reflows per resize into 1 per document. Moved `compactWidthCache` + detection from both backends to shared `property-helpers.ts`. Grid row-level sync with 1px tolerance. | | |

## 5. Virtual scroll refinements

| Optimization | Status | Notes | Value | Effort |
|---|---|---|---|---|
| Virtual scroll engine | Done | `syncVirtualScroll()` mounts/unmounts based on scroll position. RAF-debounced passive scroll listener. Replaced IntersectionObserver-based `content-visibility`. **T5: 23-42 cards mounted (7.7-13% of 300). 25 mount/unmount transitions, no storms.** Working as designed. | | |
| Dynamic buffer (1x pane height) | Done | Replaced fixed 800px buffer. Scales with pane size — fewer mounts on small panes, more on tall panes. **T5: Buffer adds ~14 cards beyond ~23 visible.** | | |
| `cachedGroupOffsets` | Done | Eliminates `getBoundingClientRect` from scroll/resize hot path. Refreshed synchronously before every `syncVirtualScroll()`. ~~T1 (before): 39ms for 2 groups, linear scaling.~~ Resolved by algorithm optimization. | | |
| `hasUserScrolled` guard | Done | Prevents premature unmounting during initial render and batch loading. | | |
| Keyboard navigation across unmounted cards | Done | `VirtualCardRect[]` from stored positions. Navigates spatially, mounts target on demand. | | |
| Direction-aware remeasurement suppression | Done (superseded) | Debounced scroll remeasure (200ms) eliminates the feedback loop entirely — remeasure only fires when scroll is idle. | | |
| Scroll anchoring during reflow | Done | `scrollTop` compensation after remeasure anchors first visible card. Fires only when scroll idle (debounced). | | |
| `updateCachedGroupOffsets` algorithm | Done | **T1 (before): 39ms for 2 groups (linear scaling).** Fixed: `groupOffsetsDirty` flag — scroll-only frames skip DOM reads entirely (39ms→0ms). Flag set true by resize, mount/unmount, and remeasure paths. | 5 | 2 |
| Staggered mounting across frames | Eliminated | **T5: No mount storms observed.** Virtual scroll keeps 23-42 cards mounted with smooth cycling (change every ~7.5 frames). Same-column-count resize mounts 0-3 cards at edges. Column-count changes cause larger mount bursts but infrequent. Initial batch render uses `masonry-resizing` class to hide cards during layout. No scenario in current implementation produces the 50-70 card mount storms this was designed to address. | 0 | — |
| Persistent paired property width cache | Done | `Map<filePath, {containerWidth, pairs[]}>` stores measured CSS vars. On virtual scroll re-mount, applies cached widths directly — zero forced reflows. Invalidated on settings change (`resetPersistentWidthCache`), per-card on fresh DOM from in-place update, and on container width change. | 2 | 1 |

## 6. Grouped masonry

| Optimization | Status | Notes |
|---|---|---|
| Basic grouped masonry | Done | Fixed. Group expand/collapse layout also resolved (see below). |
| Group expand/collapse layout | Done | Full expand/collapse lifecycle: `toggleGroupCollapse` (sync cleanup, virtual item eviction, scroll compensation) + `expandGroup` (async render, layout via `'expand-group'` source with remount-all, post-insert measurement passes, version guard). **T10: Collapse costs 508ms for 19 cards (~27ms/card).** See CardHandle cleanup optimization in section 4. |
| Per-group virtual scroll | Done | Each group has its own container with `cachedGroupOffsets`. **T4: 7 scroll iterations to load all 300 cards across 11 groups.** |
| Per-group proportional resize | Done | Iterates `virtualItemsByGroup` per group in proportional path. **T7: 18 width transitions, column boundary crossing at frame 35.** |

## 7. Datacore parity gaps

Bases is the main backend. Datacore will be worked on after all Bases optimizations are complete. See architecture comparison in [masonry-layout.md](masonry-layout.md) → "Bases v Datacore".

**Dependencies**: Gaps 2 (proportional resize) and 3 (post-resize correction) depend on Gap 1 (virtual scrolling) — proportional scaling requires `VirtualItem` tracking for `scalableHeight`/`fixedHeight`/`measuredAtWidth`. Gap 5 (stable columns) is independent — `columnAssignments` already stored in `lastLayoutResultRef`. Gap 8 (group offset caching) depends on grouped masonry support, not virtual scrolling.

| Gap | Status | Notes | Value | Effort |
|---|---|---|---|---|
| Virtual scrolling | Planned | Biggest gap. Datacore renders all cards up to `displayedCount` in DOM. With 1000+ cards, performance degrades. Bases mounts only viewport-adjacent cards via `VirtualItem[]` tracking. | 5 | 5 |
| Proportional resize scaling | Planned | Datacore does full `calculateMasonryLayout()` per resize frame. Bases does zero-DOM-read `height * (newWidth / oldWidth)` at ~60fps via `proportionalResizeLayout`. | 4 | 4 |
| Post-resize correction | Planned | Follows from proportional resize. 200ms debounced DOM re-measure fixes proportional height drift. | 3 | 2 |
| Stable column assignment during remeasure | Planned | `repositionWithStableColumns()` is shared code — Datacore just needs to call it instead of greedy recalculation in its relayout paths. | 3 | 1 |
| IO-based `content-visibility` on desktop | Evaluate | Bases Grid uses scroll-position-based `CONTENT_HIDDEN_CLASS` toggling (not IO-based — `setupContentVisibility` is dead code). Bases Masonry relies purely on virtual scroll mount/unmount. Datacore has no JS-level content-visibility management — relies only on global CSS `content-visibility: auto` from the stylesheet (applies to mobile via `body.is-mobile` selector). Without virtual scrolling, this is the primary mechanism for off-screen rendering reduction. | 2 | 3 |
| Layout guard system | Evaluate | Bases has 5 sequential guards preventing corruption (batch pending, reentrant, coalescing). Datacore has 2 explicit JS guards (`isUpdatingLayout` reentrancy + `pendingLayoutUpdate` queued coalescing) but lacks batch pending, image coalescing, and deferred resize suppression. | 2 | 3 |
| Group offset caching | Planned | Eliminates `getBoundingClientRect` from scroll/resize hot path. Datacore currently has no equivalent cache. Datacore doesn't support grouped masonry yet — grouped masonry support is the actual prerequisite, not virtual scrolling. `getBoundingClientRect` in resize paths matters independent of virtual scrolling. | 2 | 2 |
| Card height change detection | Evaluate | Bases has a single `cardResizeObserver` (RAF-debounced) watching all mounted cards — catches CSS-only height changes (cover ratio, text preview lines, title lines) that don't trigger explicit relayout. Datacore has no equivalent; relies on `useEffect` dependency chain. Would catch edge cases where CSS changes affect card height without triggering a Preact re-render. | 2 | 2 |
| Image-load coalescing | Evaluate | Bases uses explicit RAF debounce via `pendingImageRelayout`. Datacore image loads call `updateLayout()` imperatively (bypasses Preact entirely) — no explicit coalescing. The `isUpdatingLayout` reentrancy guard provides de facto coalescing (concurrent calls queued as one pending update), but each image load still fires its own `updateLayout()` call. | 2 | 1 |
