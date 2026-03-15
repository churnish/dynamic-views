---
title: Grid layout system
description: CSS Grid column layout for card views. Render pipeline, guard system, virtual scrolling, and Bases/Datacore differences.
author: "\U0001F916 Generated with Claude Code"
updated: 2026-03-15
---
# Grid layout system

The grid layout system renders cards in a CSS Grid-based equal-height column layout. Both backends share the same card rendering pipeline ([card-renderer.tsx](../../src/shared/card-renderer.tsx)) and settings schema. Bases uses imperative DOM manipulation with virtual scrolling (mount/unmount with placeholder divs); Datacore uses declarative Preact/JSX rendering. The pipeline, guard system, and invariant sections below document the Bases implementation — see "Bases v Datacore" at the end for architectural differences.

## Files

### Shared

| File                               | Role                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------- |
| `src/shared/card-renderer.tsx`   | Pure card rendering (normalized `CardData`), used by both backends.                                          |
| `src/shared/constants.ts`        | Tuning constants (`MAX_BATCH_SIZE`, `PANE_MULTIPLIER`, `ROWS_PER_COLUMN`, throttle intervals).               |
| `src/shared/keyboard-nav.ts`     | DOM-based arrow navigation and hover-to-keyboard focus transfer.                                             |
| `src/shared/scroll-gradient.ts`  | Horizontal scroll gradients for property rows.                                                               |
| `src/shared/property-measure.ts` | Side-by-side property field width measurement + queued processing.                                           |
| `src/shared/virtual-scroll.ts`   | `VirtualItem` interface, `measureScalableHeight()`, `estimateUnmountedHeight()`, `syncVisibleItems()`.       |
| `src/shared/data-transform.ts` | Normalizes Bases/Datacore entries → `CardData` (`basesEntryToCardData`, `transformBasesEntries`).             |
| `src/shared/settings-schema.ts`| Reads and resolves Bases view settings (`readBasesSettings`, `getBasesViewOptions`).                         |
| `src/shared/scroll-preservation.ts` | Scroll position save/restore across re-renders.                                                         |
| `src/shared/text-preview-dom.ts` | DOM updates for card text previews + per-paragraph clamping.                                               |
| `src/utils/style-settings.ts` | CSS variable reading with cache (Style Settings integration).                                                |
| `src/utils/property.ts`       | Property name normalization (display-name ↔ syntax-name maps).                                               |
| `styles/_grid-masonry-shared.scss` | Shared card view CSS: container queries, view padding, groups, card foundation, content-visibility.      |
| `styles/_grid-view.scss`         | Grid-specific CSS — CSS Grid columns, subgrid groups, card sizing.                                           |

### Bases

| File                           | Role                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------- |
| `src/bases/grid-view.ts`       | View class — orchestrates rendering, resize, infinite scroll, group collapse.   |
| `src/bases/shared-renderer.ts` | `CardHandle` interface, `renderCard()` method, image-load callback integration. |
| `src/bases/sticky-heading.ts`  | Sentinel IO for sticky group heading stuck state detection.                     |
| `src/bases/utils.ts`           | Sort, group processing, content loading, context menus, Style Settings observer. |

### Datacore

| File                         | Role                                                             |
| ---------------------------- | ---------------------------------------------------------------- |
| `src/datacore/controller.tsx` | Main controller — state, query, layout effects, infinite scroll. |
| `src/datacore/card-view.tsx` | Card component — delegates to `CardRenderer` with view mode.     |

## Core data structures

### ContentCache (`src/types.ts`)

Shared cache objects for deduplicating async content loading across renders and batch appends.

| Field               | Type                      | Purpose                                        |
| ------------------- | ------------------------- | ---------------------------------------------- |
| `textPreviews`      | `Record<string, string>`  | Cached text preview content by file path.      |
| `images`            | `Record<string, string \| string[]>` | Cached image URLs (or slideshow arrays) by file path. |
| `hasImageAvailable` | `Record<string, boolean>` | Boolean flags for image availability per path. |

### RenderState (`src/types.ts`)

Tracks render versioning and change detection hashes to skip no-op re-renders.

| Field                            | Type                      | Purpose                                                     |
| -------------------------------- | ------------------------- | ----------------------------------------------------------- |
| `version`                        | `number`                  | Incremented on each render; cancels stale async operations. |
| `abortController`                | `AbortController \| null` | Cancels in-flight content loading on new render.            |
| `lastRenderHash`                 | `string`                  | Hash of data + settings + mtimes + sort + collapse state.   |
| `lastSettingsHash`               | `string \| null`          | Hash of resolved settings (detects settings changes).       |
| `lastPropertySetHash`            | `string \| null`          | Sorted property names hash (detects property set changes).  |
| `lastSettingsHashExcludingOrder` | `string \| null`          | Order-independent settings hash (detects reorder-only).     |
| `lastMtimes`                     | `Map<string, number>`     | File modification times (detects content-only changes).     |
| `lastStyleSettingsHash`          | `string \| null`          | Hash of Style Settings values (detects style-only changes). |

### Shared state interfaces (`src/types.ts`)

| Interface              | Fields                                               | Purpose                                                   |
| ---------------------- | ---------------------------------------------------- | --------------------------------------------------------- |
| `LastGroupState`       | `key: string \| undefined`, `container: HTMLElement \| null` | Tracks last-used group container for batch append.        |
| `ScrollThrottleState`  | `listener: (() => void) \| null`, `timeoutId: number \| null` | Infinite scroll throttle bookkeeping.                    |
| `SortState`            | `isShuffled: boolean`, `order: string[]`, `lastMethod: string \| null` | Shuffle/sort persistence state.                |
| `FocusState`           | `cardIndex: number`, `hoveredEl: HTMLElement \| null` | Keyboard navigation focus tracking.                       |

### Key maps and collections on `DynamicViewsGridView`

- **`cardDataByPath: Map<string, { cardData: CardData; entry: BasesEntry }>`** — Per-card cache for surgical property reorder. Stores the last `CardData` and source `BasesEntry` per file path. Updated on full render and batch append.
- **`collapsedGroups: Set<string>`** — Persisted group collapse state. Keyed by serialized group key (or `UNDEFINED_GROUP_KEY_SENTINEL` for ungrouped). Loaded once from persistence on first render; in-memory Set is authoritative thereafter.
- **`contentCache: ContentCache`** — Shared text preview and image cache. Cleared on settings change; selectively cleared on content-only updates.

### Grid-specific state fields

| Field                    | Type                                      | Purpose                                                                                                       |
| ------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `displayedCount`         | `number`                                  | Cards currently visible (infinite scroll progress).                                                           |
| `previousDisplayedCount` | `number`                                  | Count from last batch render (for incremental append).                                                        |
| `isLoading`              | `boolean`                                 | Guard: batch append in progress.                                                                              |
| `currentCardSize`        | `number`                                  | Resolved card width setting (px).                                                                             |
| `currentMinColumns`      | `number`                                  | Resolved minimum columns setting.                                                                             |
| `lastColumnCount`        | `number`                                  | Last computed column count (skip no-op CSS updates).                                                          |
| `isUpdatingColumns`      | `boolean`                                 | Guard: prevents reentrant ResizeObserver calls.                                                               |
| `lastObservedWidth`      | `number`                                  | Last container width (0 = tab switch detection).                                                              |
| `resizeRafId`            | `number \| null`                          | Double-RAF debounce tracking ID.                                                                              |
| `hasBatchAppended`       | `boolean`                                 | Flag: has infinite scroll appended items (end indicator logic).                                               |
| `virtualItems`           | `VirtualItem[]`                           | All cards as virtual items — mounted (`.el` set) or unmounted (placeholder in DOM).                           |
| `virtualItemsByGroup`    | `Map<string \| undefined, VirtualItem[]>` | Group-keyed lookup for collapse/expand.                                                                       |
| `virtualItemByPath`      | `Map<string, VirtualItem>`                | Path-keyed lookup for content updates.                                                                        |
| `groupContainers`        | `Map<string \| undefined, HTMLElement>`   | Group key → group container element.                                                                          |
| `placeholderEls`         | `Map<VirtualItem, HTMLElement>`           | Unmounted item → lightweight placeholder div.                                                                 |
| `cachedGroupOffsets`     | `Map<string \| undefined, number>`        | Group container `offsetTop` for absolute keyboard nav coordinates.                                            |
| `hasUserScrolled`        | `boolean`                                 | Mount-all-then-cull: virtual scrolling activates on first user scroll.                                        |
| `isCompensatingScroll`   | `boolean`                                 | Suppresses scroll listener during programmatic scroll adjustments.                                            |
| `isLayoutBusy`           | `boolean`                                 | Concurrency guard during batch append, resize reflow, group expand.                                           |
| `virtualScrollRafId`     | `number \| null`                          | RAF ID for `syncVirtualScroll` debounce.                                                                      |
| `cardResizeObserver`     | `ResizeObserver \| null`                  | Observes mounted cards for height changes (image load, text reflow).                                          |
| `cardResizeRafId`        | `number \| null`                          | RAF ID for `remeasureMountedCards` debounce.                                                                  |
| `cardResizeDirty`        | `boolean`                                 | Dirty flag — defers ResizeObserver events during mount window, guaranteed follow-up remeasure.                |
| `mountRemeasureTimeout`  | `ReturnType<typeof setTimeout> \| null`   | Delay for deferred passes after mount (`MOUNT_REMEASURE_MS`).                                                 |
| `newlyMountedEls`        | `HTMLElement[]`                           | Accumulator for cards needing deferred measurement passes.                                                    |
| `lastMeasuredCardWidth`  | `number`                                  | Card width at last full measurement — detects column-change need.                                             |
| `resizeObserver`         | `ResizeObserver \| null`                  | Container ResizeObserver for column recalculation.                                                            |
| `observerWindow`         | `(Window & typeof globalThis) \| null`    | Window reference for popout-safe observer construction.                                                       |
| `feedContainerRef`       | `{ current: HTMLElement \| null }`        | Ref box for the feed/grid container element.                                                                  |
| `stickyHeadings`         | `ReturnType<typeof setupStickyHeadingObserver> \| null` | Sticky heading observer cleanup handle.                                                     |
| `viewId`                 | `string \| null`                          | Persistence key for per-view state (collapsed groups).                                                        |
| `scrollPreservation`     | `ScrollPreservation \| null`              | Scroll position save/restore manager.                                                                         |
| `currentDoc`             | `Document`                                | Current document reference for popout-safe DOM operations.                                                    |
| `updateLayoutRef`        | `{ current: (() => void) \| null }`       | Ref box for layout update callback.                                                                           |
| `disconnectStyleObserver`| `(() => void) \| null`                    | Cleanup function for Style Settings MutationObserver.                                                         |
| `lastDataUpdateTime`     | `{ value: number }`                       | Ref box for throttle timestamp tracking.                                                                      |
| `trailingUpdate`         | `{ timeoutId, callback, isTrailing? }`    | Trailing edge throttle state for data updates.                                                                |

## Render pipeline

### 1. Initial render

`onDataUpdated()` → `queueMicrotask()` → `processDataUpdate()`

1. `applyCssOnlySettings()` — set CSS variables (`textPreviewLines`, `titleLines`, `imageRatio`, `thumbnailSize`) and CSS classes (`posterDisplayMode`, `imageFit`) directly on container. Bypasses throttle for instant feedback.
2. Read settings with stale-config fallback (`lastRenderedSettings`), normalize property names. (For the full resolution chain, stale config guards, and sparse storage, see [settings-resolution.md](settings-resolution.md).)
3. Apply per-view CSS classes and variables (`applyViewContainerStyles`).
4. Compute `renderHash` (data paths + mtimes + settings + style settings + sort + shuffle + collapse + properties).
5. **Skip if hash unchanged** — restore column CSS variable (may be lost on tab switch), restore scroll position, return early. Schedule delayed re-checks at 100/250/500ms to catch late Obsidian config updates.
6. Check fast paths (see §2, §3 below).
7. **Full render**:
   - Clear content cache if settings changed. Reset `displayedCount` if batches were appended.
   - Calculate column count: `max(minColumns, floor((containerWidth + gap) / (cardSize + gap)))`. Set `--dynamic-views-grid-columns` CSS variable.
   - Process groups with shuffle logic. Collect visible entries up to `displayedCount`, skipping collapsed groups.
   - Load text previews and images (async, cancellable via `AbortController`).
   - Preserve container height (`--dynamic-views-preserve-height`) to prevent scroll reset during DOM wipe.
   - Clear container, render group sections with headers and cards.
   - Post-insert measurement passes (see §Post-insert measurement passes).
   - Setup virtual scrolling: create `VirtualItem` for each card, `rebuildGroupIndex()`, `measureAllCardPositions()`, `updateCachedGroupOffsets()`, `setupCardResizeObserver()`. Cards start fully mounted; `syncVirtualScroll` activates on first user scroll.
   - Setup infinite scroll (scroll listener).
   - Setup ResizeObserver (double-RAF debounce for column recalculation).
   - Restore scroll position, remove height preservation.

### 2. Content update fast path (`updateCardsInPlace`)

Triggered when file **content** changed (mtime differs) but file paths and settings are unchanged.

**Detection**:

1. `changedPaths.size > 0` — at least one file has a new mtime.
2. `!settingsChanged` — settings hash unchanged.
3. `pathsUnchanged` — sorted file paths match previous render.

**Execution**:

1. Clear content cache for changed paths only.
2. Load fresh text previews and images for changed entries.
3. For each changed path: find fresh `BasesEntry` from `changedEntries` (pre-filtered to changed paths), rebuild `CardData` via `basesEntryToCardData()`, update `cardDataByPath` with fresh entry and cardData.
4. Call `updateCardContent()` on each card element — updates title, subtitle, properties, and text preview DOM in-place.
5. **No relayout needed** — CSS Grid auto-adjusts row heights when content changes.

#### Image change detection

When `hasImageChanged(oldCard, newCard)` returns `true`, the card cannot be surgically updated — the image DOM subtree (cover wrapper, slideshow, aspect ratio, fade-in) is too complex. Instead:

1. Clean up old card: `handle.cleanup()`, `abortCardRerenderControllers(cardEl)`, unobserve from ResizeObserver, remove element.
2. Re-render card at correct DOM position, update VirtualItem element reference, observe with ResizeObserver.
3. Insert new card at same DOM position with height-lock. Immediate passes: `syncResponsiveClasses`, `setHoverScaleForCards`
4. Deferred passes via `scheduleMountRemeasure`: `initializeScrollGradientsForCards`, `initializeTitleTruncationForCards`, `initializeTextPreviewClampForCards`, then release height lock

When image is unchanged, `updateCardContent()` handles title, subtitle, properties, text preview, and URL icon (`updateUrlButton`) surgically.

**Guard**: `changedPaths.size === 0` on the `renderHash` early return prevents content-only changes (mtime changed, paths/settings unchanged) from being skipped.

### 3. Property reorder fast path (`updatePropertyOrder`)

Triggered when only property **order** changed (not the set of properties, not other settings).

**Detection** (`isPropertyReorderOnly`):

1. `settingsChanged` — settings hash differs from last render.
2. `propertySetUnchanged` — sorted property names hash unchanged (same properties, different order).
3. `!settings.invertPropertyPairing` — pairing is position-dependent; reorder changes row count.
4. `settingsHashExcludingOrder === last` — order-independent settings hash (excludes `titleProperty`, `subtitleProperty`, `_skipLeadingProperties` which are position-derived, plus CSS-only fields).
5. `pathsUnchanged && changedPaths.size === 0` — no file additions/removals/modifications.

**Execution**:

1. For each `VirtualItem` (including unmounted): rebuild `CardData` via `basesEntryToCardData()` (preserves cached `textPreview`/`imageUrl`). Update title, subtitle, and properties DOM only for mounted cards (`if (item.el)`).
2. Update title text (preserves `.card-title-ext-suffix` child element), subtitle, and properties DOM in-place.
3. Reinitialize scroll gradients (property widths may have changed).
4. Restore scroll position.

**Grid vs. masonry difference**: Grid calls `updateTitleText()` and `rerenderSubtitle()` because `displayFirstAsTitle` derives title/subtitle from property order positions. Masonry has a `titleSubtitleUnchanged` guard that skips the fast path entirely when derived title/subtitle change. Grid iterates all mounted cards (unmounted cards get fresh data on next mount).

### 4. Batch append (infinite scroll)

`appendBatch(totalEntries)` — triggered by scroll or initial load.

1. Collect only **new** entries (from `previousDisplayedCount` to `displayedCount`), skipping collapsed groups.
2. `isLoading` is already `true` (set by `checkAndLoadMore` before calling `appendBatch`).
3. Load content for new entries only (cache-hit no-op for already-loaded).
4. Render new cards into existing or new group containers. Handle group boundaries — create new group section with header when group key changes.
5. Create `VirtualItem` for each new card during rendering. Observe with `cardResizeObserver`.
6. Update `previousDisplayedCount` to captured `currCount`.
7. Post-insert measurement passes scoped to new cards only (see §Post-insert measurement passes).
8. `rebuildGroupIndex()` to update indices. Measure new card positions. `updateCachedGroupOffsets()`. If virtual scrolling active (`hasUserScrolled`), cull items outside viewport. `isLayoutBusy` guard prevents `syncVirtualScroll` during append.
9. Show end indicator if all items displayed.
10. `finally` block: clear `isLoading`. Then, if render version unchanged (batch not aborted), chain `checkAndLoadMore(totalEntries)` to load subsequent batches if still near bottom.

`checkAndLoadMore(totalEntries)` — entry point for both the scroll listener and the post-batch chain.

1. Reads `lastRenderedSettings` — returns early if unavailable.
2. Guards: skip if `isLoading` or `displayedCount >= totalEntries`.
3. Calculates `distanceFromBottom`; skips if `>= clientHeight × PANE_MULTIPLIER`.
4. Calls `getBatchSize(settings)` — returns `columns × ROWS_PER_COLUMN`, capped at `MAX_BATCH_SIZE`. Returns `MAX_BATCH_SIZE` as fallback when container width is 0.
5. Advances `displayedCount` and calls `appendBatch`.

### 5. Resize

`ResizeObserver` → double-RAF debounce → `updateColumns()`

**Normal resize** (double-RAF debounce):

1. Read container width from `entries[0].contentRect.width`.
2. Skip if width is 0 (hidden/collapsed).
3. Schedule `requestAnimationFrame` → `requestAnimationFrame` → `updateColumns()`.
4. `updateColumns()`:
   - Calculate new column count: `max(minColumns, floor((width + gap) / (cardSize + gap)))`.
   - Only update if column count changed.
   - Save scroll position before CSS change, restore after (prevents reflow reset).
   - Set `--dynamic-views-grid-columns` CSS variable.
   - Re-initialize scroll gradients and responsive classes (card widths changed).
5. Guard: `isUpdatingColumns` flag prevents reentrant calls.

**Tab switch fast path** (width 0→positive):

1. Skip double-RAF debounce — calculate columns immediately.
2. Prevents single-column flash on tab activation.

**Key difference from masonry**: When column count changes, `updateColumns()` does remount-all-then-cull:

- CSS variable update (before RAF).
- Phase 1 (inside RAF): Refresh `cachedGroupOffsets`, mount unmounted items in viewport + buffer range.
- Phase 2: Remeasure all mounted card heights at new width. Estimate unmounted item heights.
- Phase 3: `recomputeYPositions()`, update placeholder heights, refresh `cachedGroupOffsets`, cull items outside viewport.

`isLayoutBusy` guard prevents concurrent operations. Resize without column count change runs `syncResponsiveClasses`, `initializeScrollGradients`, and `setHoverScaleForCards` in a RAF (card widths may change within the same column count). No CSS variable update or height measurement needed.

### 6. Virtual scrolling

`syncVirtualScroll()` — RAF-throttled scroll handler that mounts/unmounts cards based on scroll position.

**Lifecycle: mount-all-then-cull**

1. Initial render creates all cards as mounted `VirtualItem` objects.
2. `measureAllCardPositions()` captures each card's `offsetTop`, `offsetLeft`, width, and height.
3. `measureScalableHeight()` splits height into scalable (cover) and fixed (text, properties) portions.
4. Virtual scrolling activates on first user scroll (`hasUserScrolled` flag).
5. `syncVirtualScroll()` unmounts far off-screen cards → lightweight placeholder divs.

**Mount/unmount cycle**:

- **Unmount** (`unmountVirtualItem`): Replace card element with a `<div class="dynamic-views-grid-placeholder">` preserving measured height. Cleanup card handle, abort in-flight renders, unobserve from ResizeObserver.
- **Mount** (`mountVirtualItem`): Call `renderCard()` on connected DOM (appended to group container end), then `placeholder.replaceWith(card)`. Card mounts with height-lock: explicit `style.height` + `.dynamic-views-height-locked` class to prevent row reflow during deferred passes.
- **Height-lock release** (`onMountRemeasure`): After `MOUNT_REMEASURE_MS` delay, runs deferred passes (scroll gradients, title truncation, text clamp) on newly mounted cards, then removes height lock. Updates stored heights if changed. Responsive classes and hover scale run immediately during mount (no height impact).

**Scroll sync**:

1. Scheduled via `requestAnimationFrame` (skip-if-pending debounce). Each sync refreshes `cachedGroupOffsets` before the mount/unmount pass.
2. Calculates viewport bounds + buffer (1× viewport above and below).
3. For each item: mount if in view and unmounted, unmount if out of view and mounted.
4. Uses `estimateUnmountedHeight()` for unmounted items — split proportional scaling (cover scales with width, text assumed fixed). Known limitation (#358): `fixedHeight` is actually width-dependent (text wraps less at wider widths), causing systematic overestimation after column count increases.

**Card resize handling**:

- `cardResizeObserver` watches mounted cards for height changes.
- During mount window (`mountRemeasureTimeout` active), sets `cardResizeDirty` flag instead of processing immediately.
- After mount window completes, processes dirty flag with guaranteed remeasure.
- Outside mount window: RAF-debounced `remeasureMountedCards()` updates stored heights and placeholder heights, recomputes y positions.

**Content-visibility overridden for grid**: Grid sets `content-visibility: visible` on all cards (all platforms, not just mobile) — virtual scrolling handles performance instead. The override also prevents iOS WebKit infinite reflow loops with IO-toggled content-visibility.

### 7. Group collapse

**Toggle** (`toggleGroupCollapse`):

1. Toggle `collapseKey` in `collapsedGroups` Set.
2. Update header DOM class (`collapsed`).
3. Persist to `basesState` (async — in-memory Set is authoritative).
4. **Expanding**: call `expandGroup()` — surgically populate only this group's cards without full re-render.
5. **Collapsing**: empty group container first. Then cleanup all group's VirtualItems (handles, ResizeObserver, placeholders, path map). `virtualItemsByGroup.delete()`. `rebuildVirtualItemsOrder()` to reconstruct flat array in DOM order. `groupContainers.delete()`. `rebuildGroupIndex()`. `updateCachedGroupOffsets()`. Invalidate `lastRenderHash`. Scroll header to viewport top if it was stuck. Dispatch scroll event to trigger infinite scroll check (collapsing reduces height).

**Expand** (`expandGroup`):

1. Find matching group in data.
2. Load content (cache-hit no-op for already-loaded entries).
3. Create new VirtualItems for group's cards. Set group container and items-by-group. `rebuildVirtualItemsOrder()`. `rebuildGroupIndex()`.
4. Post-insert measurement passes scoped to group (see §Post-insert measurement passes).
5. Measure card positions. `updateCachedGroupOffsets()`. If `hasUserScrolled`, immediately cull items outside viewport.
6. Invalidate `lastRenderHash` so next `onDataUpdated()` doesn't skip.

**Fold/unfold all** (`foldAllGroups`, `unfoldAllGroups`):

- Fold: add all group keys to `collapsedGroups`, persist, trigger re-render.
- Unfold: clear `collapsedGroups`, persist, trigger re-render.

## Post-insert measurement passes

After cards are rendered into the DOM, an ordered sequence of measurement and adjustment passes runs. Each pass may depend on DOM state set by earlier passes.

### Ordered sequence

| #   | Pass                                    | Purpose                                                          | Dependency                                                                |
| --- | --------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | `syncResponsiveClasses(cards)`          | Batch compact-mode + thumbnail-stack class sync.                 | None — sets CSS classes that affect card dimensions for subsequent reads. |
| 2   | `initializeScrollGradients(container)`  | Reads scroll dimensions of property rows, sets gradient classes. | Properties must be rendered.                                              |
| 3   | `initializeTitleTruncation(container)`  | Canvas-based binary-search title truncation.                     | Subtitle and properties must be finalized (see invariant below).          |
| 4   | `initializeTextPreviewClamp(container)` | Per-paragraph ellipsis clamping for text previews.               | Text preview content must be in DOM.                                      |
| 5   | `setHoverScaleForCards(cards)`          | Sets CSS custom property for hover scale from card dimensions.   | Card dimensions must be stable.                                           |

`*ForCards(cards)` variants exist for passes 2-4, scoping measurement to a specific card array instead of scanning the full container. Pass 5 (`setHoverScaleForCards`) is inherently card-scoped — no container variant exists. Used by batch append and `updateCardContent` to scope work to mounted cards only.

### Call sites

| Call site                                | Passes used       | Variant                                                                                                          |
| ---------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| Initial render (full render path)        | All 5             | Container. Then: create VirtualItems, measure positions, setup card ResizeObserver.                              |
| Batch append (`appendBatch`)             | All 5             | `*ForCards` — new cards only. Create VirtualItems, cull if scrolled.                                            |
| Group expand (`expandGroup`)             | All 5             | Container — scoped to group. Create VirtualItems, cull if scrolled.                                             |
| Resize (`updateColumns`)                 | 1, 2, 5           | Container (in RAF after column CSS variable update). Full remount-and-cull on column change. Deferred 2, 3, 4 via `scheduleMountRemeasure` for newly mounted cards. |
| Property reorder (`updatePropertyOrder`) | 2 only            | Container — title, subtitle, and properties updated (order-derived `displayFirstAsTitle` may change title/subtitle). |
| Content update (`updateCardsInPlace`)    | 2 + per-card 3, 4 | 2: container-level after loop. 3, 4: per-card via `updateCardContent`. Image-change replacement: immediate 1, 5 + deferred 2, 3, 4 via `scheduleMountRemeasure`. |
| `onDataUpdated` CSS fast-path            | 4 only            | Container — re-measures clamps after CSS variable change.                                                        |

### Truncation ordering invariant

`initializeTitleTruncation` **must** run after `rerenderSubtitle` and `rerenderProperties` complete. Measuring before those methods finalize the DOM produces stale layout — the truncation result is immediately invalidated by subsequent DOM changes. The per-card sequence in `updateCardContent` ([shared-renderer.ts](../../src/bases/shared-renderer.ts)) enforces this:

1. `updateTitleText` → 2. `rerenderSubtitle` → 3. `rerenderProperties` → 4. `initializeTitleTruncationForCards` → 5. `updateTextPreviewDOM` + `applyPerParagraphClamp` → 6. `updateUrlButton`

## Render guard system

`processDataUpdate()` has 5 sequential guards:

| #   | Guard                        | Behavior                                                                                                         |
| --- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | `shouldProcessDataUpdate()`  | Hybrid throttle — leading + trailing edge. Suppresses calls during cooldown (see §Data update throttle below).   |
| 2   | `!this.data`                 | Return early — data not yet initialized (race with MutationObserver).                                            |
| 3   | `isLoading`                  | Return early — batch append in progress, full re-render would corrupt state.                                     |
| 4   | `renderHash === lastHash`    | Return early — nothing changed. Schedule delayed re-checks (100/250/500ms) for late Obsidian config updates.     |
| 5   | `renderState.version`        | Incremented on each render. Stale async operations (content loading) bail when version mismatches on completion. |

### Data update throttle

`shouldProcessDataUpdate()` — hybrid throttle on `onDataUpdated()`:

- **Leading edge**: first call runs immediately.
- **Trailing edge**: catches coalesced updates from Obsidian's rapid duplicate calls.
- Prevents redundant renders from stale `config.getOrder()` timing.

### Popout lifecycle

`handleDocumentChange` calls `teardownObservers()` — cancels all pending RAFs (`virtualScrollRafId`, `cardResizeRafId`, `resizeRafId`), clears `mountRemeasureTimeout`, disconnects `resizeObserver` and `cardResizeObserver`, and nullifies `observerWindow`. RAFs are canceled BEFORE nullifying `observerWindow` because RAF IDs are per-window (see `electron-popout-quirks.md`). After teardown, `renderState.lastRenderHash` is invalidated to force `processDataUpdate` past its hash-based early return. `setupCardResizeObserver` sets `observerWindow` before creating the new observer — ensures RAF callbacks target the correct window even if the observer fires before `setupGridLayout` runs. CSS Grid auto-reflows without JS, so grid views survive popout moves even without observer recreation — but observers are still needed for virtual scroll and card resize detection.

## Throttle and debounce patterns

### Resize debounce

- **Pattern**: Double-RAF debounce (cancel-and-reschedule).
- **Behavior**: Each ResizeObserver callback cancels any pending RAF and schedules `rAF → rAF → updateColumns()`. At most one column recalculation per two frames.
- **Tab switch bypass**: When width transitions 0→positive, skip debounce for immediate column calculation.
- **Cost**: Negligible — only updates a CSS variable. CSS Grid handles repositioning.

### Scroll throttle

- **Pattern**: Leading + trailing, 100ms cooldown (`SCROLL_THROTTLE_MS`).
- **Leading**: Runs `checkAndLoadMore()` immediately. Subsequent calls during cooldown are suppressed.
- **Trailing**: Runs after cooldown to catch scroll position changes during throttle.

### Image-load handling

> For the full image loading pipeline, dedup caching, and fade-in pattern, see [image-loading.md](image-loading.md).

- **No coalescing needed** — grid cards have natural height (`height: auto`). When images load, CSS Grid auto-reflows rows without JavaScript intervention.
- **Cover fade-in**: Double-RAF delay clears `skip-cover-fade` class after cached image load events have fired.

## CSS positioning model

Cards use CSS Grid for automatic flow-based positioning:

| Property / Variable                  | Set by    | Purpose                                                             |
| ------------------------------------ | --------- | ------------------------------------------------------------------- |
| `--dynamic-views-grid-columns`       | Layout JS | Column count for `grid-template-columns: repeat(N, 1fr)`.           |
| `--dynamic-views-image-aspect-ratio` | Layout JS | Cover aspect ratio via `padding-top` trick.                         |
| `--dynamic-views-preserve-height`    | Layout JS | Temporary `min-height` during DOM wipe to prevent scroll reset.     |
| `gap`                                | CSS       | Card spacing (`--dynamic-views-card-spacing-desktop/mobile`).       |
| `align-items: stretch`               | CSS       | Cards fill grid cell height (enables `margin-top: auto` alignment). |

**Key CSS classes**:

| Class                                | Element         | Purpose                                                                                                          |
| ------------------------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------- |
| `dynamic-views-grid`                 | Feed container  | CSS Grid layout with `repeat(var(--dynamic-views-grid-columns), 1fr)`.                                           |
| `dynamic-views-group-section`        | Group wrapper   | `grid-column: 1 / -1` + `subgrid` — spans full width, inherits parent columns.                                  |
| `dynamic-views-group`                | Group container | Nested subgrid for cards within a group.                                                                         |
| `bases-group-heading`                | Group header    | Sticky header with `scroll-state(stuck: top)` container query for border.                                        |
| `dynamic-views-grid-placeholder`     | Placeholder div | Lightweight spacer maintaining CSS Grid flow for unmounted cards. Height set via inline style.                   |
| `dynamic-views-height-locked`        | Card            | During mount: explicit height + overflow hidden. Prevents row reflow until deferred passes complete.             |
| `is-grouped`                         | View container  | Toggled when view has grouped data.                                                                              |
| `dynamic-views-height-preserved`     | View container  | Temporary class during DOM wipe; sets `min-height` to prevent scroll reset.                                      |

**Card flex layout** (for the full card DOM hierarchy and backend divergences, see [card-dom-structure.md](card-dom-structure.md)):

```
.card (flex-direction: column, height: 100%)
  ├── .card-content (flex-grow: 1)
  │   ├── .card-header (title, subtitle)
  │   └── .card-body (flex-grow: 1)
  │       ├── .card-cover-wrapper / .card-previews
  │       ├── .card-properties-top
  │       └── .card-properties-bottom (margin-top: auto → pushed to bottom)
  └── [cover-bottom variants]
```

`margin-top: auto` on `.card-properties-bottom` pushes properties to the bottom of fixed-height grid cells (enabled by `align-items: stretch` on the grid container).

**Subgrid group structure**:

```html
<div class="dynamic-views-grid" style="--dynamic-views-grid-columns: N">
  <div class="dynamic-views-group-section">
    <!-- grid-column: 1/-1, subgrid -->
    <div class="bases-group-heading">Title</div>
    <!-- grid-column: 1/-1, sticky -->
    <div class="dynamic-views-group">
      <!-- grid-column: 1/-1, subgrid -->
      <div class="card">...</div>
      <div class="card">...</div>
    </div>
  </div>
</div>
```

Groups use CSS `subgrid` to inherit parent column structure, ensuring cards align with the top-level grid.

## Keyboard navigation

See [keyboard-nav.md](keyboard-nav.md) for the full architecture. Summary of grid-specific wiring:

Arrow keys navigate spatially across all virtual items using absolute coordinates.

1. `setupHoverKeyboardNavigation()` — hover transfers focus target from mouse to keyboard. First arrow key activates visible focus ring.
2. `initializeContainerFocus()` — initializes keyboard nav state (`_keyboardNavActive`, `_intentionalFocus`) and `focusout` handler on feed container.
3. `getVirtualRects()` — returns `VirtualCardRect[]` with absolute coordinates. Adds `cachedGroupOffsets` to each item's group-local `y` position for cross-group navigation.
4. `handleArrowNavigation()` — batch coordinate lookup, calculate cardinal directions using weighted cross-axis distance (`primaryDist + crossAxisDist × 0.5`).
5. Up/Down restricted to same column (within 5px tolerance). Left/Right unrestricted.
6. Target card focused + `scrollIntoView({ block: 'nearest', behavior: 'smooth' })`. If target is unmounted, `mountVirtualItemByIndex()` mounts it first.

## Constants (`src/shared/constants.ts`)

| Constant             | Value | Purpose                                                        |
| -------------------- | ----- | -------------------------------------------------------------- |
| `BATCH_SIZE`         | 50    | Default infinite scroll batch size.                            |
| `MAX_BATCH_SIZE`     | 70    | Maximum batch size cap.                                        |
| `ROWS_PER_COLUMN`    | 10    | Rows per column for dynamic batch size calculation.            |
| `PANE_MULTIPLIER`    | 3     | Trigger batch load when within 3× viewport height from bottom. |
| `SCROLL_THROTTLE_MS` | 100   | Scroll event throttle interval.                                |
| `MOUNT_REMEASURE_MS` | 200   | Delay before running deferred passes on newly mounted cards.   |

### Property measurement constants (`src/shared/property-measure.ts`)

> For the full measurement pipeline, pairing logic, and alignment modes, see [property-layout.md](property-layout.md).

| Constant                  | Value | Purpose                                         |
| ------------------------- | ----- | ----------------------------------------------- |
| `SETS_PER_FRAME`          | 5     | Side-by-side property sets processed per frame. |
| `MAX_QUEUE_SIZE`          | 500   | Maximum queued property sets.                   |
| `MAX_GRADIENT_BATCH_SIZE` | 100   | Early-flush threshold for gradient updates.     |
| `MEASUREMENT_CHUNK_SIZE`  | 5     | Property fields measured per chunk.             |
| `WIDTH_TOLERANCE`         | 0.5   | Minimum width delta (px) to trigger re-layout.  |

## Key invariants

1. **`--dynamic-views-grid-columns` is the layout source of truth.** CSS Grid handles all card positioning from this single variable. No JavaScript position calculation needed (unlike masonry's per-card `left`/`top`).
2. **`renderHash` prevents redundant re-renders.** The hash includes data paths, mtimes, settings, style settings, sort, shuffle, collapse state, and visible properties. Delayed re-checks (100/250/500ms) catch Obsidian's late config updates.
3. **`isLoading` prevents concurrent renders during batch append.** `processDataUpdate()` returns early while a batch is in flight. The batch owns `renderState.version` to cancel stale operations.
4. **`previousDisplayedCount` ensures incremental append correctness.** Batch append renders only cards from `previousDisplayedCount` to `displayedCount`, never re-rendering existing cards.
5. **`collapsedGroups` is loaded once from persistence.** First render loads from `basesState`; thereafter the in-memory `Set` is authoritative. Reloading on every `onDataUpdated` would wipe state due to style-settings-triggered callbacks with stale persistence.
6. **Container height is preserved during DOM wipe.** `--dynamic-views-preserve-height` sets `min-height` before clearing the container, preventing the scroll parent from resetting scroll position.
7. **Virtual scrolling replaces content visibility.** Grid uses full virtual scrolling (mount/unmount) instead of IO-based `content-hidden` toggling. `content-visibility: visible` is set on all grid cards to override mobile's `content-visibility: auto`. iOS compatibility is maintained because virtual scrolling doesn't trigger the WebKit reflow loop. The `content-hidden` class is defensively removed from keyboard navigation targets before focusing, but is not the primary visibility mechanism for grid.
8. **CSS-only settings bypass the render pipeline.** `applyCssOnlySettings()` runs before throttle and hash comparison, setting CSS variables and classes directly for instant feedback on `textPreviewLines`, `titleLines`, `imageRatio`, `thumbnailSize`, `posterDisplayMode`, and `imageFit` changes.
9. **`appendBatch` must chain `checkAndLoadMore` after completing.** Without chaining, a batch that doesn't fill the viewport stalls infinite scroll permanently — the scroll listener never fires because there's nothing to scroll. The chain is version-guarded — aborted batches must NOT chain.
10. **`hasUserScrolled` gates virtual scroll activation.** Initial render mounts all cards for measurement. Virtual scrolling (unmounting far cards) activates only after first user scroll, matching the mount-all-then-cull pattern.
11. **`isLayoutBusy` prevents concurrent layout operations.** Set during batch append, column-change reflow, and group expand. `syncVirtualScroll` skips when busy; `cardResizeObserver` defers via `cardResizeDirty` flag.
12. **Height-locked mount prevents row reflow.** Cards mount with explicit `style.height` matching placeholder + `.dynamic-views-height-locked` class (overflow hidden). Released after deferred passes complete (`MOUNT_REMEASURE_MS`).
13. **`rebuildGroupIndex()` maintains stable item ordering.** Called after collapse, expand, initial render, and batch append. Updates `item.index` for each item. No `reindexVirtualItems()` — indices cached on items, not shifted.

## Bases v Datacore

For broader architectural differences (rendering model, events, cleanup, state), see [bases-v-datacore-differences.md](bases-v-datacore-differences.md). This section covers grid-specific divergences.

Both backends share the same card rendering pipeline (`CardRenderer`/`SharedCardRenderer`) and settings schema. They diverge in rendering model, state management, and layout strategy.

### Architecture comparison

| Aspect                 | Bases                                                       | Datacore                                                          |
| ---------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------- |
| **Rendering model**    | Imperative DOM manipulation via `renderCard()`.             | Declarative Preact/JSX components via `CardRenderer`.             |
| **State management**   | Instance fields + `{ current }` ref boxes on view class.    | Preact hooks (`dc.useState`, `dc.useRef`, `dc.useEffect`).        |
| **Layout engine**      | CSS Grid with JS-controlled `--dynamic-views-grid-columns`. | CSS Grid with JS-controlled `--dynamic-views-grid-columns`.       |
| **Content visibility** | Full virtual scrolling — unmounted cards replaced with placeholder divs. | Not implemented — all displayed cards rendered normally.          |
| **Resize strategy**    | Double-RAF debounce → update CSS variable only.             | Double-RAF debounce → update CSS variable only.                   |
| **Group collapse**     | Surgical expand/collapse with scroll position adjustment.   | State-driven re-render.                                           |
| **Content loading**    | `ContentCache` objects with abort controllers.              | `useRef` Map with effect ID race prevention.                      |
| **Cleanup**            | Manual per-card `CardHandle.cleanup()` + abort.             | Preact handles unmount cleanup.                                   |
| **Width modes**        | Standalone view — fills pane.                               | Embedded in Live Preview/Reading View with normal/wide/max modes. |

### What Bases has that Datacore lacks

- **Virtual scrolling** — Full mount/unmount virtual scrolling with placeholder divs. Unmounted cards become lightweight `<div>` placeholders preserving CSS Grid flow. Datacore renders all displayed cards normally.
- **Surgical group expand** — Expanding a collapsed group renders only that group's cards without full re-render. Datacore does a full state-driven re-render.
- **Property reorder fast path** — Detects property-order-only changes and updates card content without re-rendering.
- **Content update fast path** — Detects content-only changes (mtime differs, paths unchanged) and updates all card content in-place (title, subtitle, properties, text preview) without full re-render.

### What Datacore has that Bases lacks

- **Declarative rendering** — Data changes flow through Preact's render cycle. No manual DOM bookkeeping.
- **Width modes** — `normal` (match `--file-line-width`), `wide` (1.75×), `max` (full pane). Bases views fill their pane natively.
- **Reactive query** — `dc.query()` re-executes on Datacore index updates (500ms debounced). Bases uses Obsidian's `onDataUpdated()` callback.
- **DOM shuffle (masonry only)** — Fisher-Yates shuffle directly reorders DOM children in masonry mode. Grid and list use state-driven re-render. Bases has shuffle via data sort in `processGroups()` and full re-render, not DOM-level reordering.

### Shared behavior

- **Layout engine** — Both use CSS Grid with `repeat(var(--dynamic-views-grid-columns), 1fr)`.
- **Column calculation** — `max(minColumns, floor((width + gap) / (cardSize + gap)))`.
- **Infinite scroll** — `displayedCount` incremented by `columns × ROWS_PER_COLUMN` (capped at `MAX_BATCH_SIZE`) when within `PANE_MULTIPLIER × viewport height` from bottom. Leading + trailing throttle.
- **Card rendering** — Both backends produce `CardData` and render through shared [card-renderer.tsx](../../src/shared/card-renderer.tsx) logic (title, subtitle, properties, image, text preview).
- **Group headers** — Sticky with `scroll-state(stuck: top)` container query for bottom border (progressive enhancement — iOS WebKit doesn't support scroll-state queries).
- **Subgrid groups** — `grid-column: 1 / -1` + `grid-template-columns: subgrid` for column alignment. Subgridded columns inherit `column-gap` from the parent grid — the parent's `gap` (or `column-gap`) must stay set, otherwise grouped cards lose column spacing. Note: when grouped, `.dynamic-views-grid` and `.bases-cards-container` are the same element (ungrouped views only have `.dynamic-views-grid`), so Obsidian's native `.bases-cards-container { gap }` also applies and must be explicitly overridden when a different value is needed.
- **Responsive classes** — `syncResponsiveClasses()` runs after layout in both backends.
- **Scroll gradients** — `initializeScrollGradients()` applied to property rows in both.
- **Title truncation** — Binary-search truncation via `initializeTitleTruncation()` in both.

## Grid vs. masonry comparison

| Aspect                   | Grid                                                             | Masonry                                                    |
| ------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------- |
| **Layout engine**        | CSS Grid (`display: grid`, automatic flow)                       | Absolute positioning (`position: absolute`, JS-calculated) |
| **Card height**          | Natural content height, equal per row (`stretch`)                | Variable per card (`height: auto` or proportional)         |
| **Column control**       | Single CSS variable (`--dynamic-views-grid-columns`)             | JavaScript calculates all positions per card               |
| **Resize cost**          | ~0ms (CSS variable update only)                                  | ~3-5ms proportional, ~6-9ms correction                     |
| **Virtual scrolling**    | Full `VirtualItem[]` tracking with mount/unmount (placeholder divs preserve CSS Grid flow) | Full `VirtualItem[]` tracking with mount/unmount (absolute positioning) |
| **Image load handling**  | CSS Grid auto-reflows rows (no JS needed)                        | Coalesced RAF relayout per image batch                     |
| **Group structure**      | CSS subgrid (cards aligned with parent columns)                  | Block containers with `position: relative`                 |
| **Properties alignment** | `margin-top: auto` (works with `stretch`)                        | `margin-top: auto` (limited — no fixed card height)        |
| **Reorder fast path**    | Updates title + subtitle + properties                            | Updates properties only (title/subtitle guarded)           |
| **Content fast path**    | Full in-place update (title, subtitle, properties, text preview) | In-place update + height-change relayout (`updateCardsInPlace`) |
| **Render complexity**    | Simpler (CSS handles positioning)                                | Complex (5-guard layout system, proportional scaling)      |
| **Performance ceiling**  | Lower control (CSS Grid limits)                                  | Higher control (per-card positioning, arbitrary layouts)    |
