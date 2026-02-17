---
title: Masonry layout system
description: The masonry layout system renders cards in a Pinterest-style variable-height column layout. It uses absolute positioning via CSS custom properties, proportional height scaling during resize, incremental batch appends for infinite scroll, and virtual scrolling to handle thousands of cards efficiently.
author: 🤖 Generated with Claude Code
last updated: 2026-02-17
---

# Masonry layout system

## Files

| File                           | Role                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| `src/bases/masonry-view.ts`    | View class — orchestrates rendering, layout, virtual scroll, resize, infinite scroll.    |
| `src/utils/masonry-layout.ts`  | Pure layout math — column/position calculations, no DOM.                                 |
| `src/shared/virtual-scroll.ts` | `VirtualItem` interface and `syncVisibleItems` helper.                                   |
| `src/shared/keyboard-nav.ts`   | `VirtualCardRect` interface and spatial arrow navigation across mounted/unmounted cards. |
| `src/shared/constants.ts`      | Tuning constants (`BATCH_SIZE`, `PANE_MULTIPLIER`, throttle intervals).                  |
| `src/bases/shared-renderer.ts` | `CardHandle` interface, `renderCard()` method, image-load callback integration.          |
| `styles/_masonry.scss`         | Masonry-specific CSS — absolute card positioning, container sizing.                      |

## Core data structures

### VirtualItem (`src/shared/virtual-scroll.ts`)

Lightweight representation of every card. Mounted cards have `el` and `handle`; unmounted cards are pure JS objects with stored positions.

| Field             | Type                  | Purpose                                             |
| ----------------- | --------------------- | --------------------------------------------------- |
| `index`           | `number`              | Position in flat card list.                         |
| `x`, `y`          | `number`              | `--masonry-left` and `--masonry-top` values.        |
| `width`           | `number`              | `--masonry-width` value.                            |
| `height`          | `number`              | Current height (may be proportionally scaled).      |
| `measuredHeight`  | `number`              | Height at original measurement width.               |
| `measuredAtWidth` | `number`              | `cardWidth` when height was DOM-measured.           |
| `cardData`        | `CardData`            | Normalized card data for rendering.                 |
| `entry`           | `BasesEntry`          | Obsidian Bases entry.                               |
| `groupKey`        | `string \| undefined` | Group key (`undefined` for ungrouped).              |
| `el`              | `HTMLElement \| null` | DOM element when mounted, `null` when unmounted.    |
| `handle`          | `CardHandle \| null`  | Cleanup handle when mounted, `null` when unmounted. |

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
   - Set `--masonry-width` on all cards.
   - Force single reflow (`void allCards[0]?.offsetHeight`).
   - Read all heights in single pass (`allCards.map(c => c.offsetHeight)`).
   - `calculateMasonryLayout()` per group.
   - Apply `--masonry-left` and `--masonry-top` per card.
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
   - Pre-set `--masonry-width` on new cards.
   - Wait for images to settle (or skip if fixed-cover-height).
   - In double-RAF: `calculateIncrementalMasonryLayout()` continues from previous `columnHeights`.
   - Apply positions to new cards only. Update container height.
   - Update VirtualItem positions for new cards.
   - **Merge heights**: `result.heights = [...prevHeights, ...newHeights]`. Store merged result.
6. Otherwise, fall back to full `updateLayoutRef.current()`.
7. Clear `batchLayoutPending`. `syncVirtualScroll()`. Check if more content needed.

### 3. Resize

`ResizeObserver` → `throttledResize()` → `updateLayoutRef.current("resize-observer")`

**Fast path** has two branches (prior heights must exist for unmounted cards):

**Proportional branch** (`"resize-observer"`) — zero DOM reads, ~3-5ms:

1. Read container width from `pendingResizeWidth` cache (no `getBoundingClientRect` reflow).
2. Calculate proportional heights for ALL cards: `measuredHeight × (cardWidth / measuredAtWidth)`.
3. `calculateMasonryLayout()` with proportional heights.
4. Apply `--masonry-width`, `--masonry-left`, `--masonry-top`, `--masonry-card-height` to mounted cards.
5. `updateVirtualItemPositions()`. Update `cachedGroupOffsets`. `syncVirtualScroll()`.
6. Return — skip full measurement path.

The explicit `--masonry-card-height` prevents mismatch between layout positions and rendered height. Without it, `height: auto` would render at natural height while positions use proportional height → overlap/gaps. Cards look slightly "frozen" during drag (content doesn't reflow to new width); this resolves on correction.

**DOM measurement branch** (`"resize-correction"`, `"image-coalesced"`) — ~6-9ms:

1. For correction only: clear `--masonry-card-height` so cards reflow to natural height.
2. Add `masonry-measuring` class. Set `--masonry-width` on mounted cards. Force reflow.
3. Read mounted cards' `offsetHeight`. Unmounted cards use proportional scaling.
4. `calculateMasonryLayout()` with mixed heights. Apply positions.
5. For correction: set `measuredAtCardWidth` to establish fresh baseline.
6. Update metadata for mounted cards. Remove `masonry-measuring`. Return.

**Post-resize correction** (`"resize-correction"`, 200ms after last resize):

Proportional height scaling drifts from true `height: auto` render heights. After resize settles, the DOM measurement branch clears explicit heights, re-measures mounted cards, and updates `measuredAtCardWidth` to the current card width, establishing a fresh baseline for future scaling.

**Fallback — full measurement** (no prior heights, e.g., first resize before any layout):

1. If unmounted items exist, remount all (append to container end).
2. Build `allCards` from `virtualItems` (not DOM query — DOM order differs after remount).
3. Set `--masonry-width`, force reflow, read all heights, calculate layout, apply positions.
4. `updateVirtualItemPositions()`, store in `groupLayoutResults`.

### 4. Virtual scroll

Activated on first user scroll (`hasUserScrolled` flag). Prevents premature unmounting during initial render and batch loading.

**`syncVirtualScroll()`** — Single pass over all VirtualItems:

1. Calculate visible range: `scrollTop ± paneHeight` (1x pane height buffer).
2. Look up container offset per group from `cachedGroupOffsets` (no `getBoundingClientRect`).
3. For each item: `itemTop = containerOffsetY + item.y`, `itemBottom = itemTop + item.height`.
4. If `inView && !item.el` → `mountVirtualItem()`: render card, apply stored position, set refs.
5. If `!inView && item.el` → `unmountVirtualItem()`: cleanup, remove from DOM, clear refs.

**Trigger points**: scroll event (RAF-debounced), after full layout, after batch append, during live resize.

## Layout update guard system

`updateLayoutRef.current(source?)` has 5 sequential guards:

| #   | Guard                     | Behavior                                                                                                                                                                                     |
| --- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `containerWidth === 0`    | Return early — container not visible.                                                                                                                                                        |
| 2   | `batchLayoutPending`      | Return early — incremental batch in flight, full relayout would corrupt `groupLayoutResults`.                                                                                                |
| 3   | Unmounted items           | Source-dependent: remount all for `expand-group`; allow through for `resize-observer`, `resize-correction`, and `image-coalesced` (fast path measures mounted cards only); block all others. |
| 4   | `source === "image-load"` | Coalesce into single RAF (`pendingImageRelayout` flag). Direct relayouts subsume pending image relayouts.                                                                                    |
| 5   | `isUpdatingLayout`        | Queue via `pendingLayoutUpdate` flag, process in `finally` block.                                                                                                                            |

### Layout sources

| Source                | Trigger                                  | Path                                                                                     |
| --------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `"initial-render"`    | First render                             | Full measurement with card hiding.                                                       |
| `"resize-observer"`   | ResizeObserver (RAF-debounced)           | Mounted-card measurement fast path → fallback to full.                                   |
| `"image-load"`        | Cover/thumbnail image loaded             | Coalesced → `"image-coalesced"`.                                                         |
| `"resize-correction"` | 200ms after last resize ends             | Mounted-card measurement fast path → correction pass.                                    |
| `"image-coalesced"`   | RAF after image-load batch               | Mounted-card measurement fast path if unmounted items exist, otherwise full measurement. |
| `"expand-group"`      | Group uncollapsed                        | Full measurement with remount-all.                                                       |
| `"content-update"`    | In-place card update changed height      | Full measurement (blocked if unmounted items).                                           |
| `"queued-update"`     | Dequeued from reentrant guard            | Full measurement (blocked if unmounted items).                                           |
| `"property-measured"` | Property field width measurement settled | Full measurement (blocked if unmounted items).                                           |

## Throttle and debounce patterns

### Resize throttle

- **Pattern**: RAF debounce (cancel-and-reschedule).
- **Behavior**: Every ResizeObserver callback cancels any pending RAF and schedules a new one. At most one layout runs per frame (~60fps).
- **No trailing call**: Single RAF ensures the last resize event always fires.
- **Container width caching**: `pendingResizeWidth` stores `entries[0].contentRect.width` before the RAF, eliminating `getBoundingClientRect` reflow in the layout function.
- **Virtual scroll sync during resize**: With `cachedGroupOffsets`, `syncVirtualScroll` is a pure JS loop (~1-2ms) and runs after every resize frame to keep cards mounted/unmounted correctly.
- **Post-resize correction**: 200ms after the last resize, `"resize-correction"` re-measures mounted cards to fix proportional height drift.

### Scroll throttle

- **Pattern**: Leading + trailing, 100ms cooldown (`SCROLL_THROTTLE_MS`).
- **Leading**: Runs `checkAndLoadMore()` immediately. Schedules `syncVirtualScroll` via RAF.
- **Trailing**: Runs after cooldown if events arrived during it.

### Image-load coalescing

- **Pattern**: Single RAF debounce via `pendingImageRelayout` flag.
- **Effect**: ~60 concurrent image loads → 1 layout per frame instead of 60.
- **Subsumption**: Direct relayouts (resize, initial-render) clear the flag, subsuming pending image relayouts.

## CSS positioning model

Cards use `position: absolute` with CSS custom properties:

| Property                | Set by    | Consumed by                                                                      |
| ----------------------- | --------- | -------------------------------------------------------------------------------- |
| `--masonry-width`       | Layout JS | `.dynamic-views-masonry .card` width.                                            |
| `--masonry-left`        | Layout JS | `.dynamic-views-masonry .card` left position.                                    |
| `--masonry-top`         | Layout JS | `.dynamic-views-masonry .card` top position.                                     |
| `--masonry-card-height` | Layout JS | `.dynamic-views-masonry .card` height. Set during resize, cleared on correction. |
| `--masonry-height`      | Layout JS | Container min-height (sets scrollable area).                                     |

**Key CSS classes**:

| Class                | Element           | Purpose                                                                                      |
| -------------------- | ----------------- | -------------------------------------------------------------------------------------------- |
| `masonry-container`  | Group container   | Applied by `applyMasonryLayout`.                                                             |
| `masonry-positioned` | Card              | Added after position is set; removed during initial layout to hide cards.                    |
| `masonry-resizing`   | Masonry container | Hides cards during initial layout measurement.                                               |
| `masonry-measuring`  | Masonry container | Forces content rendering for accurate `offsetHeight` reads (overrides `content-visibility`). |

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
2. **`groupLayoutResults` stores original measured heights**, not scaled. `tryProportionalResize` restores original heights after updating VirtualItem positions with scaled values. This ensures future proportional scaling always starts from the original measurement.
3. **`updateVirtualItemPositions` maps by filter index.** `virtualItems.filter(v => v.groupKey === key)[i]` ↔ `result.positions[i]`. Consistent because both use the same ordering.
4. **`batchLayoutPending` suppresses concurrent full relayouts** during incremental batch layout. Image-load and other relayouts would corrupt `groupLayoutResults` by including new-batch cards before the incremental layout positions them.
5. **`cachedGroupOffsets` must be refreshed before every `syncVirtualScroll()`.** Call `updateCachedGroupOffsets()` synchronously before sync. The cache eliminates `getBoundingClientRect` from the scroll/resize hot path. Stale offsets cause incorrect mount/unmount decisions.
6. **Virtual scroll sync must run after any position change.** Proportional resize, full measurement, batch append, and live resize all call `syncVirtualScroll()` to mount/unmount cards based on updated positions.
7. **`hasUserScrolled` prevents premature unmounting.** Virtual scroll activation is deferred until first scroll event. Before that, all cards are mounted and sync is a no-op.
