---
title: Masonry layout system
description: The masonry layout system renders cards in a Pinterest-style variable-height column layout. Both backends share the same pure layout math (`masonry-layout.ts`). Bases uses imperative DOM manipulation with virtual scrolling and proportional resize scaling. Datacore uses declarative Preact/JSX rendering without virtual scrolling. The detailed pipeline, guard system, and invariant sections below document the Bases implementation; see "Bases vs. Datacore" at the end for architectural differences.
author: 🤖 Generated with Claude Code
last updated: 2026-02-19
---

# Masonry layout system

## Files

### Shared

| File                           | Role                                                                                                                                                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/utils/masonry-layout.ts`  | Pure layout math — column/position calculations, no DOM. Exports: `calculateMasonryLayout`, `calculateMasonryDimensions`, `calculateIncrementalMasonryLayout`, `repositionWithStableColumns`, `computeGreedyColumnHeights`. |
| `src/shared/constants.ts`      | Tuning constants (`BATCH_SIZE`, `PANE_MULTIPLIER`, throttle intervals).                                                                                                                                                     |
| `src/shared/card-renderer.tsx` | Pure card rendering (normalized `CardData`), used by both backends.                                                                                                                                                         |
| `src/shared/keyboard-nav.ts`   | `VirtualCardRect` interface and spatial arrow navigation.                                                                                                                                                                   |
| `styles/_masonry.scss`         | Masonry-specific CSS — absolute card positioning, container sizing.                                                                                                                                                         |

### Bases

| File                           | Role                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| `src/bases/masonry-view.ts`    | View class — orchestrates rendering, layout, virtual scroll, resize, infinite scroll. |
| `src/shared/virtual-scroll.ts` | `VirtualItem` interface and `syncVisibleItems` helper.                                |
| `src/bases/shared-renderer.ts` | `CardHandle` interface, `renderCard()` method, image-load callback integration.       |

### Datacore

| File                            | Role                                                             |
| ------------------------------- | ---------------------------------------------------------------- |
| `src/datacore/view.tsx`         | Main controller — state, query, layout effects, infinite scroll. |
| `src/datacore/masonry-view.tsx` | Thin wrapper — sets `viewMode="masonry"` on `CardView`.          |
| `src/datacore/card-view.tsx`    | Card component — delegates to `CardRenderer` with view mode.     |

## Core data structures

### VirtualItem (`src/shared/virtual-scroll.ts`)

Lightweight representation of every card. Mounted cards have `el` and `handle`; unmounted cards are pure JS objects with stored positions.

| Field             | Type                  | Purpose                                                                     |
| ----------------- | --------------------- | --------------------------------------------------------------------------- |
| `index`           | `number`              | Position in flat card list.                                                 |
| `x`, `y`          | `number`              | Inline `left` and `top` values.                                             |
| `width`           | `number`              | Inline `width` value.                                                       |
| `height`          | `number`              | Current height (may be proportionally scaled).                              |
| `measuredHeight`  | `number`              | Height at original measurement width.                                       |
| `measuredAtWidth` | `number`              | `cardWidth` when height was DOM-measured.                                   |
| `scalableHeight`  | `number`              | Height of scalable portion (top/bottom cover) at `measuredAtWidth`.         |
| `fixedHeight`     | `number`              | Height of fixed portion (header, properties, preview) at `measuredAtWidth`. |
| `cardData`        | `CardData`            | Normalized card data for rendering.                                         |
| `entry`           | `BasesEntry`          | Obsidian Bases entry.                                                       |
| `groupKey`        | `string \| undefined` | Group key (`undefined` for ungrouped).                                      |
| `el`              | `HTMLElement \| null` | DOM element when mounted, `null` when unmounted.                            |
| `handle`          | `CardHandle \| null`  | Cleanup handle when mounted, `null` when unmounted.                         |

### MasonryLayoutResult (`src/utils/masonry-layout.ts`)

Output of layout calculations. Stored per group in `groupLayoutResults`.

| Field                 | Type                | Purpose                                                  |
| --------------------- | ------------------- | -------------------------------------------------------- |
| `positions`           | `MasonryPosition[]` | `{ left, top }` for each card.                           |
| `columnHeights`       | `number[]`          | Running column heights after placement.                  |
| `containerHeight`     | `number`            | Max column height minus trailing gap.                    |
| `containerWidth`      | `number`            | Container width used for calculation.                    |
| `cardWidth`           | `number`            | Computed card width.                                     |
| `columns`             | `number`            | Number of columns used.                                  |
| `heights`             | `number[]`          | Card heights used (measured or scaled).                  |
| `measuredAtCardWidth` | `number`            | `cardWidth` when heights were DOM-measured (not scaled). |

### Key maps on `MasonryBasesView`

- **`groupLayoutResults: Map<string | undefined, MasonryLayoutResult>`** — Layout result per group (or `undefined` for ungrouped). Used by `tryProportionalResize` for height scaling and `appendBatch` for incremental continuation.
- **`virtualItems: VirtualItem[]`** — Flat array of all cards across all groups, in render order.
- **`virtualItemsByGroup: Map<string | undefined, VirtualItem[]>`** — Pre-indexed groupKey → VirtualItem[] lookup. Rebuilt via `rebuildGroupIndex()` after any `virtualItems` mutation. Eliminates repeated O(n) filter scans in layout hot paths.
- **`groupContainers: Map<string | undefined, HTMLElement>`** — DOM container per group for mounting cards.
- **`cachedGroupOffsets: Map<string | undefined, number>`** — Cached vertical offset (relative to scroll container) per group. Refreshed synchronously before every `syncVirtualScroll()` call. Eliminates `getBoundingClientRect` from the scroll/resize hot path.
- **`pendingResizeWidth: number | null`** — Container width cached from the latest `ResizeObserver` entry. Used by the resize fast path to avoid a forced `getBoundingClientRect` reflow.

## Render pipeline

### 1. Initial render

`processDataUpdate()` → `setupMasonryLayout(settings)` → `updateLayoutRef.current("initial-render")`

1. Clear container, create masonry container element.
2. Render groups/cards with `renderCard()`. Push `VirtualItem` per card with `x=0, y=0, height=0`.
3. `updateLayoutRef.current("initial-render")`:
   - Add `masonry-resizing` class (hides cards during layout).
   - Set inline `width` on all cards.
   - Force single reflow (`void allCards[0]?.offsetHeight`).
   - Read all heights in single pass (`allCards.map(c => c.offsetHeight)`).
   - `calculateMasonryLayout()` per group.
   - Apply inline `left` and `top` per card.
   - `updateVirtualItemPositions()` stores positions in VirtualItems.
   - Store result in `groupLayoutResults` with `measuredAtCardWidth`.
   - Remove `masonry-resizing` class. `syncVirtualScroll()`.
4. Setup infinite scroll (scroll listener + ResizeObserver).

### 2. Batch append (infinite scroll)

`appendBatch(totalEntries, settings)` — Triggered by scroll or ResizeObserver.

1. Collect only NEW entries (from `previousDisplayedCount` to `displayedCount`).
2. Set `batchLayoutPending = true` (suppresses concurrent full relayouts).
3. Load content for new entries, render new cards into group containers.
4. Push `VirtualItem` per new card.
5. **Incremental layout** (if single group + previous result exists):
   - Pre-set inline `width` on new cards.
   - Wait for images to settle (or skip if fixed-cover-height).
   - In double-RAF: `calculateIncrementalMasonryLayout()` continues from previous `columnHeights`.
   - Apply positions to new cards only. Update container height.
   - Update VirtualItem positions for new cards.
   - **Merge heights**: `result.heights = [...prevHeights, ...newHeights]`. Store merged result.
6. Otherwise, fall back to full `updateLayoutRef.current()`.
7. Clear `batchLayoutPending`. `syncVirtualScroll()`. Check if more content needed.

### 3. Property reorder (fast path)

`processDataUpdate()` → `updatePropertyOrder()` — Triggered when only property ORDER changed (not the set of properties, not other settings).

**Detection** (`isPropertyReorderOnly`):

1. `settingsChanged` — settings hash differs from last render.
2. `propertySetUnchanged` — sorted property names hash unchanged (same properties, different order).
3. `!settings.invertPropertyPairing` — pairing is position-dependent; reorder changes row count.
4. `titleSubtitleUnchanged` — `lastTitleProperty`/`lastSubtitleProperty` instance fields match current values. When `displayFirstAsTitle` is ON, title/subtitle are derived from positions 1–2 in `config.getOrder()`. If those positions changed, card heights may vary → skip fast path.
5. `settingsHashExcludingOrder === last` — order-independent settings hash (excludes `titleProperty`, `subtitleProperty`, `_skipLeadingProperties` which are position-derived, plus CSS-only fields like `textPreviewLines`, `titleLines`, `imageRatio`, `thumbnailSize`).
6. `pathsUnchanged && changedPaths.size === 0` — no file additions/removals/modifications.

**Execution** (`updatePropertyOrder()`):

1. For each `VirtualItem`: rebuild `cardData` via `basesEntryToCardData()` (preserves cached `textPreview`/`imageUrl`).
2. For mounted cards (`item.el`): call `rerenderProperties()` only — title/subtitle unchanged by guard.
3. Unmounted cards: `cardData` updated; next mount uses new order.
4. Reinitialize scroll gradients. Restore scroll position.
5. **No masonry layout recalculation** — card heights are invariant under property reorder (property rows have constant height regardless of order).

**Grid view difference**: Grid has no `titleSubtitleUnchanged` guard — CSS grid auto-reflows when DOM content changes. Grid also calls `updateTitleText()` and `rerenderSubtitle()` since title/subtitle may change. Grid iterates all DOM cards (no virtual scrolling yet), which causes a multi-second delay with many cards.

### 4. Resize

`ResizeObserver` → `throttledResize()` → `updateLayoutRef.current("resize-observer")`

**Fast path** has two branches (prior heights must exist for unmounted cards):

**Proportional branch** (`"resize-observer"`) — zero DOM reads, single-pass:

1. Read container width from `pendingResizeWidth` cache (no `getBoundingClientRect` reflow).
2. `proportionalResizeLayout()` — single pass over all cards per group:
   - Split proportional height: `scalableHeight × (cardWidth / measuredAtWidth) + fixedHeight`. Cover area scales linearly; text content stays constant.
   - Greedy shortest-column placement (inlined — bypasses `calculateMasonryLayout`).
   - Update VirtualItem positions in-place (bypasses `updateVirtualItemPositions`).
   - Apply inline `width`, `left`, `top`, `height` to mounted cards.
3. Update `cachedGroupOffsets`. Run `syncVirtualScroll()` unconditionally (cheap for same-column-count frames: 0-3 mounts at viewport edges from proportional drift).
4. Return — skip full measurement path.

The explicit inline `height` prevents mismatch between layout positions and rendered height. Without it, `height: auto` would render at natural height while positions use proportional height → overlap/gaps. Cards look slightly "frozen" during drag (content doesn't reflow to new width); this resolves on correction.

**DOM measurement branch** (`"resize-correction"`, `"image-coalesced"`) — ~6-9ms:

1. For correction only: clear inline `height` so cards reflow to natural height.
2. Add `masonry-measuring` class. Set inline `width` on mounted cards. Force reflow.
3. Read mounted cards' `offsetHeight`. Unmounted cards use proportional scaling.
4. `calculateMasonryLayout()` with mixed heights. Apply positions.
5. For correction: set `measuredAtCardWidth` to establish fresh baseline.
6. Update metadata for mounted cards. Remove `masonry-measuring`. Return.

**Post-resize correction** (`"resize-correction"`, 200ms after last resize):

Proportional height scaling drifts from true `height: auto` render heights. After resize settles, the DOM measurement branch clears explicit heights, re-measures mounted cards, and updates `measuredAtCardWidth` to the current card width, establishing a fresh baseline for future scaling.

**Fallback — full measurement** (no prior heights, e.g., first resize before any layout):

1. If unmounted items exist, remount all (append to container end).
2. Build `allCards` from `virtualItems` (not DOM query — DOM order differs after remount).
3. Set inline `width`, force reflow, read all heights, calculate layout, apply positions.
4. `updateVirtualItemPositions()`, store in `groupLayoutResults`.

### 5. Virtual scroll

Activated on first user scroll (`hasUserScrolled` flag). Prevents premature unmounting during initial render and batch loading.

**`syncVirtualScroll()`** — Single pass over all VirtualItems:

1. Calculate visible range: `scrollTop ± paneHeight` (1x pane height buffer).
2. Look up container offset per group from `cachedGroupOffsets` (no `getBoundingClientRect`).
3. For each item: `itemTop = containerOffsetY + item.y`, `itemBottom = itemTop + item.height`.
4. If `inView && !item.el` → `mountVirtualItem()`: render card, apply stored position, set refs. Side cover CSS custom properties (`--dynamic-views-side-cover-width`, `--dynamic-views-side-cover-content-padding`) are set synchronously using `item.width` — `renderCoverWrapper` defers these to RAF (needs `offsetWidth`, unavailable during `renderCard`), so without this the CSS fallback shows for 1 frame.
5. If `!inView && item.el` → `unmountVirtualItem()`: cleanup, remove from DOM, clear refs.

**Trigger points**: scroll event (RAF-debounced), after full layout, after batch append. **Skipped during active resize** — mount/unmount deferred to post-resize correction to prevent mount storms (50-70 cards mounting in one frame during column count changes).

**Post-mount remeasure**: When `syncVirtualScroll` mounts new cards outside of active resize, remeasure is debounced (200ms via `scrollRemeasureTimeout`). After scroll settles, `remeasureAndReposition()` re-measures DOM heights and recalculates positions, correcting overlap caused by proportional height drift in `height: auto` cards. The debounce prevents flicker from immediate vs. deferred remeasure fighting over image-load height changes (~24px cover drift).

## Layout update guard system

`updateLayoutRef.current(source?)` has 5 sequential guards:

| #   | Guard                     | Behavior                                                                                                                                                                                                                                       |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `containerWidth === 0`    | Return early — container not visible.                                                                                                                                                                                                          |
| 2   | `batchLayoutPending`      | Return early — incremental batch in flight, full relayout would corrupt `groupLayoutResults`.                                                                                                                                                  |
| 3   | Unmounted items           | Source-dependent: remount all for `expand-group`, `multi-group-fallback`, and `new-group-fallback`; allow through for `resize-observer`, `resize-correction`, and `image-coalesced` (fast path measures mounted cards only); block all others. |
| 4   | `source === "image-load"` | Coalesce into single RAF (`pendingImageRelayout` flag). Direct relayouts subsume pending image relayouts.                                                                                                                                      |
| 5   | `isUpdatingLayout`        | Queue via `pendingLayoutUpdate` flag, process in `finally` block.                                                                                                                                                                              |

### Layout sources

| Source                   | Trigger                                           | Path                                                                                     |
| ------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `"initial-render"`       | First render                                      | Full measurement with card hiding.                                                       |
| `"resize-observer"`      | ResizeObserver (synchronous)                      | Mounted-card measurement fast path → fallback to full.                                   |
| `"image-load"`           | Cover/thumbnail image loaded                      | Coalesced → `"image-coalesced"`.                                                         |
| `"resize-correction"`    | 200ms after last resize ends                      | Mounted-card measurement fast path → correction pass.                                    |
| `"image-coalesced"`      | RAF after image-load batch                        | Mounted-card measurement fast path if unmounted items exist, otherwise full measurement. |
| `"expand-group"`         | Group uncollapsed                                 | Full measurement with remount-all.                                                       |
| `"multi-group-fallback"` | Batch spanned multiple groups                     | Full measurement with remount-all.                                                       |
| `"new-group-fallback"`   | Batch added cards to a group with no prior layout | Full measurement with remount-all.                                                       |
| `"content-update"`       | In-place card update changed height               | Full measurement (blocked if unmounted items).                                           |
| `"queued-update"`        | Dequeued from reentrant guard                     | Full measurement (blocked if unmounted items).                                           |
| `"property-measured"`    | Property field width measurement settled          | Full measurement (blocked if unmounted items).                                           |

## Throttle and debounce patterns

### Resize throttle

- **Pattern**: Synchronous execution in ResizeObserver callback.
- **Behavior**: Layout runs directly inside the ResizeObserver callback. RO fires at most once per frame, so no additional coalescing is needed. Chromium throttles `requestAnimationFrame` for 400ms–3s after rapid `setBounds` calls (e.g., hotkey window resize), so RAF-based deferral caused stale layouts.
- **Container width caching**: `pendingResizeWidth` stores `entries[0].contentRect.width` before the RAF, eliminating `getBoundingClientRect` reflow in the layout function.
- **Unconditional sync during resize**: `syncVirtualScroll` runs after every proportional resize frame. For same-column-count frames (~95%), this is cheap (0-3 mounts at viewport edges from proportional drift). At column count boundaries, sync handles the full layout reshuffle.
- **Post-resize correction**: 200ms after the last resize, `"resize-correction"` re-measures mounted cards to fix proportional height drift, then `syncVirtualScroll` runs to mount/unmount cards for the final layout. The 200ms debounce cannot be reduced — rAF (~16ms) and 100ms both cause card flashing because ResizeObserver gaps let correction fire mid-drag, triggering mode switching (proportional ↔ DOM measurement).

### Scroll throttle

- **Pattern**: Leading + trailing, 100ms cooldown (`SCROLL_THROTTLE_MS`).
- **Leading**: Runs `checkAndLoadMore()` immediately. Schedules `syncVirtualScroll` via RAF.
- **Trailing**: Runs after cooldown if events arrived during it.

### Image-load coalescing

- **Pattern**: Single RAF debounce via `pendingImageRelayout` flag.
- **Effect**: ~60 concurrent image loads → 1 layout per frame instead of 60.
- **Subsumption**: Direct relayouts (resize, initial-render) clear the flag, subsuming pending image relayouts.

### Card height change detection (`cardResizeObserver`)

- **Pattern**: Single `ResizeObserver` instance observes all mounted cards. RAF-debounced (cancel-and-reschedule — at most one reflow per frame).
- **Purpose**: Catch-all safety net for CSS-only height changes that bypass the normal layout pipeline — cover ratio slider, text preview lines, title lines, thumbnail size settings, and any future height-changing events.
- **Lifecycle**: Created once in `setupMasonryLayout` (guarded by `!this.cardResizeObserver`). Registered for disconnect on view unload. Cards are observed in `renderCard` and unobserved in `unmountVirtualItem`. On full re-render, `containerEl.empty()` removes all card DOM nodes — ResizeObserver stops tracking removed elements automatically, so no explicit `disconnect` is needed between re-renders. After initial layout, the spurious RAF from card creation is cancelled to avoid a redundant no-op remeasure.
- **Guards**: The callback returns early if `resizeCorrectionTimeout !== null` (resize in progress), `batchLayoutPending`, `lastLayoutCardWidth === 0` (pre-layout), or `!lastRenderedSettings`. The RAF callback re-checks the same conditions plus `containerEl.isConnected` before calling `remeasureAndReposition`.
- **Relation to `updateCardsInPlace`**: `updateCardsInPlace` retains its synchronous `remeasureAndReposition` call — content updates are infrequent, single events where RAF debounce would be a visible regression. The observer is a complementary catch-all, not a replacement for the direct call.

### Cross-window observer context

- **Problem**: Plugin code runs in the main window's module context. `new ResizeObserver()` / `new IntersectionObserver()` resolve to the main window's constructor. In Electron, each popout BrowserWindow has its own V8 isolate — observers from the main window silently fail to fire callbacks for DOM elements in a popout window.
- **Detection**: `observerWindow` field tracks the window context of existing observers. On each `setupMasonryLayout` call, `masonryContainer.ownerDocument.defaultView` is compared against `observerWindow`. On mismatch (view moved to a different window), existing observers are disconnected and nullified, forcing re-creation in the correct context.
- **Creation**: Guarded observers (`layoutResizeObserver`, `cardResizeObserver`) use `new (this.observerWindow ?? window).ResizeObserver(...)`. The `scrollResizeObserver` (recreated each call) uses a local `const RO = (container.ownerDocument.defaultView ?? window).ResizeObserver`.
- **Per-card observers** (in `shared-renderer.ts`): No field needed — derive the window inline from `cardEl.ownerDocument.defaultView` at each creation site.

## CSS positioning model

Cards use `position: absolute` with direct inline styles for per-card positioning (eliminates CSS variable resolution overhead):

| Style / Property   | Set by    | Purpose                                                              |
| ------------------ | --------- | -------------------------------------------------------------------- |
| `style.width`      | Layout JS | Card width (inline style).                                           |
| `style.left`       | Layout JS | Card left position (inline style).                                   |
| `style.top`        | Layout JS | Card top position (inline style).                                    |
| `style.height`     | Layout JS | Card height. Set during resize, cleared on correction.               |
| `--masonry-height` | Layout JS | Container min-height via CSS custom property (sets scrollable area). |

**Key CSS classes**:

| Class                   | Element           | Purpose                                                                                      |
| ----------------------- | ----------------- | -------------------------------------------------------------------------------------------- |
| `masonry-container`     | Group container   | Applied by `applyMasonryLayout`.                                                             |
| `masonry-positioned`    | Card              | Added after position is set; removed during initial layout to hide cards.                    |
| `masonry-resizing`      | Masonry container | Hides cards during initial layout measurement.                                               |
| `masonry-measuring`     | Masonry container | Forces content rendering for accurate `offsetHeight` reads (overrides `content-visibility`). |
| `masonry-correcting`    | Masonry container | 200ms ease for top/left during post-resize correction and scroll remeasure.                  |
| `masonry-resize-active` | Masonry container | Strips top/left transitions during active resize drag — cards reposition instantly.          |

## Keyboard navigation

Arrow keys navigate spatially across all cards, including unmounted ones.

1. `renderCard()` passes `getVirtualRects` callback → returns `VirtualCardRect[]` from `virtualItems`.
2. `renderCard()` passes `onMountItem` callback → calls `mountVirtualItemByIndex()`.
3. `handleArrowNavigation()` receives `virtualRects`, delegates to `handleVirtualArrowNavigation()`.
4. Target found by `findBestTargetIndex()` using weighted distance (`primaryDist + crossAxisDist × 0.5`).
5. Up/Down restricted to same column (within 5px tolerance). Left/Right unrestricted.
6. If target is unmounted, `onMountItem(index)` mounts it before focusing.

## Constants (`src/shared/constants.ts`)

| Constant                | Value          | Purpose                                                                  |
| ----------------------- | -------------- | ------------------------------------------------------------------------ |
| `BATCH_SIZE`            | 50             | Default infinite scroll batch size.                                      |
| `MAX_BATCH_SIZE`        | 70             | Maximum batch size cap.                                                  |
| `ROWS_PER_COLUMN`       | 10             | Rows per column for dynamic batch size calculation.                      |
| `PANE_MULTIPLIER`       | 3              | Trigger batch load when within 3× viewport height from bottom.           |
| `SCROLL_THROTTLE_MS`    | 100            | Scroll event throttle interval.                                          |
| (virtual scroll buffer) | 1× pane height | Dynamic: `scrollEl.clientHeight` above/below pane to keep cards mounted. |

## Key invariants

1. **`virtualItems` is the source of truth for card ordering.** After remounting, always collect cards from `virtualItems`, never `querySelectorAll` (DOM order differs after remount — appended at end).
2. **`groupLayoutResults` stores original measured heights**, not scaled. The proportional fast path intentionally omits `heights` from the stored result (scaled values would corrupt the merge in `appendBatch`). The DOM measurement and full layout paths store accurate DOM-measured heights. `appendBatch`'s merge handles missing heights via `?? []`.
3. **`updateVirtualItemPositions` maps by group index.** `virtualItemsByGroup.get(key)[i]` ↔ `result.positions[i]`. Consistent because both use the same ordering. The proportional fast path bypasses this function and updates VirtualItems inline.
4. **`batchLayoutPending` suppresses concurrent full relayouts** during incremental batch layout. Image-load and other relayouts would corrupt `groupLayoutResults` by including new-batch cards before the incremental layout positions them.
5. **`cachedGroupOffsets` must be refreshed before every `syncVirtualScroll()`.** Call `updateCachedGroupOffsets()` synchronously before sync. The cache eliminates `getBoundingClientRect` from the scroll/resize hot path. Stale offsets cause incorrect mount/unmount decisions.
6. **Virtual scroll sync runs unconditionally after every position change.** Full measurement, batch append, correction, and proportional resize all call `syncVirtualScroll()`. During same-column-count resize, sync is cheap (0-3 mounts at edges from proportional drift). Skipping sync during resize caused blank space as items drifted outside the viewport without remounting.
7. **Post-mount remeasure is debounced during scroll.** When `syncVirtualScroll` mounts new cards, remeasure is deferred via `scrollRemeasureTimeout` (200ms, matching resize correction delay). Newly mounted cards' DOM heights change as images load (~24px cover drift), so immediate remeasure would fight deferred remeasure — opposite position jumps within ~32ms cause visible flicker. The debounce ensures one clean `remeasureAndReposition()` + deferred pass after scroll settles, when images have loaded and heights are stable. Uses `repositionWithStableColumns()` to preserve column assignments — prevents cascading column switching from small height changes. In grouped mode, `remeasureAndReposition` checks whether stable reposition introduced excessive column imbalance: if the stable column-height range exceeds 1.5× the greedy range AND the absolute difference exceeds `gap × 4`, it falls back to a full `calculateMasonryLayout()` for that group. This prevents column drift from amplifying across incremental batch appends. Ungrouped mode always uses stable columns — visual stability during scroll outweighs minor imbalance with a single group. Position transitions use the base 140ms ease — corrections are visible to the user since remeasure is debounced to scroll idle. Scroll compensation adjusts `scrollTop` after remeasure to keep the first visible card anchored. Skipped during active resize (cards have explicit heights) and during `batchLayoutPending` (unpositioned batch cards would corrupt `groupLayoutResults` heights, causing ~2700px gaps at batch boundaries). Image-load relayout also uses `remeasureAndReposition()` (stable columns) rather than a full `calculateMasonryLayout()` call — this prevents column reassignment when images finish loading, since height changes at that point are minor corrections, not structural changes requiring column rebalancing.
8. **`hasUserScrolled` prevents premature unmounting.** Virtual scroll activation is deferred until first scroll event. Before that, all cards are mounted and sync is a no-op.

## Bases vs. Datacore

Both backends share the same pure layout math (`calculateMasonryLayout()`, `calculateIncrementalMasonryLayout()`, `repositionWithStableColumns()`) and the same greedy shortest-column algorithm. They diverge in rendering model, state management, and performance strategy.

### Architecture comparison

| Aspect                  | Bases                                                     | Datacore                                                          |
| ----------------------- | --------------------------------------------------------- | ----------------------------------------------------------------- |
| **Rendering model**     | Imperative DOM manipulation via `renderCard()`.           | Declarative Preact/JSX components via `CardRenderer`.             |
| **State management**    | Instance fields + `{ current }` ref boxes on view class.  | Preact hooks (`dc.useState`, `dc.useRef`, `dc.useEffect`).        |
| **Card positioning**    | Direct inline styles (`style.left`, `style.top`).         | CSS custom properties (`--masonry-left`, `--masonry-top`).        |
| **Virtual scrolling**   | Full `VirtualItem[]` tracking with mount/unmount.         | Not implemented — all displayed cards rendered in DOM.            |
| **Resize strategy**     | 3-tier: proportional fast path → correction → fallback.   | Full recalculation via double-RAF throttle. No proportional path. |
| **Resize cost**         | ~3-5ms/frame (proportional), ~6-9ms (correction).         | Full `calculateMasonryLayout()` per frame.                        |
| **Layout guard system** | 5 sequential guards with source-dependent behavior.       | No guard system — layout runs via `useEffect` dependencies.       |
| **Image coalescing**    | Single RAF debounce via `pendingImageRelayout` flag.      | Handled by Preact re-render batching.                             |
| **Group collapse**      | Surgical expand/collapse with scroll position adjustment. | State-driven re-render.                                           |
| **Content loading**     | `ContentCache` class with abort controllers.              | `useRef` Map with effect ID race prevention.                      |
| **Cleanup**             | Manual per-card `CardHandle.cleanup()` + abort.           | Preact handles unmount cleanup.                                   |
| **Width modes**         | Standalone view — fills pane.                             | Embedded in Live Preview/Reading View with normal/wide/max modes. |

### What Bases has that Datacore lacks

- **Virtual scrolling** — Bases mounts only viewport-adjacent cards, handling thousands efficiently. Datacore renders all cards up to `displayedCount` in the DOM. With 1000+ visible cards, Datacore may degrade.
- **Proportional resize scaling** — Zero-DOM-read resize at ~60fps. Scales `measuredHeight × (newWidth / measuredAtWidth)` without touching the DOM. Datacore does a full recalculation each frame.
- **Post-resize correction** — 200ms debounced DOM re-measure to fix proportional height drift and establish a fresh baseline.
- **Layout guard system** — Source-tagged layout requests with 5 guards preventing corruption (batch pending, reentrant, coalescing). Datacore relies on Preact's effect scheduling.
- **Group offset caching** — `cachedGroupOffsets` eliminates `getBoundingClientRect` from the scroll/resize hot path.
- **Property reorder fast path** — Detects property-order-only changes and updates card content without relayout.
- **Post-mount remeasure** — After virtual scroll mounts new cards, `remeasureAndReposition()` corrects proportional height drift. Debounced during scroll (200ms) to avoid flicker from image-load height oscillation.

### What Datacore has that Bases lacks

- **Declarative rendering** — Data changes flow through Preact's render cycle. No manual DOM bookkeeping.
- **Width modes** — `normal` (match `--file-line-width`), `wide` (1.75×), `max` (full pane). Bases views fill their pane natively.
- **Reactive query** — `dc.query()` re-executes on Datacore index updates (500ms debounced). Bases uses Obsidian's `onDataUpdated()` callback.
- **DOM shuffle** — Fisher-Yates shuffle directly reorders DOM children + triggers relayout. Bases rebuilds via data sort.

### Pure utility functions (`src/utils/masonry-layout.ts`)

| Function                              | Shared?  | Purpose                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `calculateMasonryLayout()`            | Both     | Full greedy shortest-column layout from scratch.                                                                                                                                                                                                                                                                                                                       |
| `calculateMasonryDimensions()`        | Both     | Column count and card width without measuring heights.                                                                                                                                                                                                                                                                                                                 |
| `calculateIncrementalMasonryLayout()` | Both     | Continues greedy placement from previous `columnHeights`.                                                                                                                                                                                                                                                                                                              |
| `repositionWithStableColumns()`       | Both     | Reposition with heights changed but column assignments preserved.                                                                                                                                                                                                                                                                                                      |
| `computeGreedyColumnHeights()`        | Bases    | Computes greedy shortest-column heights without allocating positions. Used by `remeasureAndReposition` to check whether `repositionWithStableColumns` introduced excessive column imbalance in grouped mode — triggers fallback to full `calculateMasonryLayout` when stable-column range exceeds 1.5× the greedy range and the absolute difference exceeds `gap × 4`. |
| `applyMasonryLayout()`                | Datacore | Applies a `MasonryLayoutResult` to DOM elements via CSS custom properties.                                                                                                                                                                                                                                                                                             |

### Shared behavior

- **Layout algorithm** — Greedy shortest-column placement via `calculateMasonryLayout()`.
- **Incremental append** — `calculateIncrementalMasonryLayout()` continues from previous `columnHeights` when container width is stable.
- **Batch height reads** — Single forced reflow per layout pass (read all `offsetHeight` values before writing positions).
- **Infinite scroll** — `displayedCount` incremented by `columns × ROWS_PER_COLUMN` (capped at `MAX_BATCH_SIZE`) when within `PANE_MULTIPLIER × viewport height` from bottom. Leading + trailing throttle.
- **Card rendering** — Both backends produce `CardData` and render through shared `card-renderer.tsx` logic (title, subtitle, properties, image, text preview).
- **CSS classes** — `masonry-container`, `masonry-positioned`, `masonry-measuring` used by both.
- **Responsive classes** — `syncResponsiveClasses()` runs after layout in both backends.
- **Scroll gradients** — `initializeScrollGradients()` applied to property rows in both.
- **Title truncation** — Binary-search truncation via `initializeTitleTruncation()` in both.
