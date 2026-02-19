---
title: Grid layout system
description: The grid layout system renders cards in a CSS Grid-based equal-height column layout. Both backends share the same card rendering pipeline (`card-renderer.tsx`) and settings schema. Bases uses imperative DOM manipulation with IntersectionObserver-based content visibility. Datacore uses declarative Preact/JSX rendering. The detailed pipeline, guard system, and invariant sections below document the Bases implementation; see "Bases vs. Datacore" at the end for architectural differences.
author: "\U0001F916 Generated with Claude Code"
last updated: 2026-02-19
---

# Grid layout system

## Files

### Shared

| File                               | Role                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------- |
| `src/shared/card-renderer.tsx`     | Pure card rendering (normalized `CardData`), used by both backends.     |
| `src/shared/constants.ts`          | Tuning constants (`BATCH_SIZE`, `PANE_MULTIPLIER`, throttle intervals). |
| `src/shared/content-visibility.ts` | IntersectionObserver-based `content-hidden` class toggling.             |
| `src/shared/keyboard-nav.ts`       | DOM-based arrow navigation and hover-to-keyboard focus transfer.        |
| `src/shared/scroll-gradient.ts`    | Horizontal scroll gradients for property rows.                          |
| `src/shared/property-measure.ts`   | Side-by-side property field width measurement + queued processing.      |
| `styles/card/_grid.scss`           | Grid-specific CSS — CSS Grid columns, subgrid groups, card sizing.      |

### Bases

| File                           | Role                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------- |
| `src/bases/grid-view.ts`       | View class — orchestrates rendering, resize, infinite scroll, group collapse.   |
| `src/bases/shared-renderer.ts` | `CardHandle` interface, `renderCard()` method, image-load callback integration. |

### Datacore

| File                         | Role                                                             |
| ---------------------------- | ---------------------------------------------------------------- |
| `src/datacore/view.tsx`      | Main controller — state, query, layout effects, infinite scroll. |
| `src/datacore/card-view.tsx` | Card component — delegates to `CardRenderer` with view mode.     |

## Core data structures

### ContentCache (`src/types.ts`)

Shared cache objects for deduplicating async content loading across renders and batch appends.

| Field               | Type                      | Purpose                                        |
| ------------------- | ------------------------- | ---------------------------------------------- |
| `textPreviews`      | `Record<string, string>`  | Cached text preview content by file path.      |
| `images`            | `Record<string, string>`  | Cached image URLs by file path.                |
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

### Key maps on `DynamicViewsGridView`

- **`cardDataByPath: Map<string, { cardData: CardData; entry: BasesEntry }>`** — Per-card cache for surgical property reorder. Stores the last `CardData` and source `BasesEntry` per file path. Updated on full render and batch append.
- **`collapsedGroups: Set<string>`** — Persisted group collapse state. Keyed by serialized group key (or `UNDEFINED_GROUP_KEY_SENTINEL` for ungrouped). Loaded once from persistence on first render; in-memory Set is authoritative thereafter.
- **`contentCache: ContentCache`** — Shared text preview and image cache. Cleared on settings change; selectively cleared on content-only updates.

### Grid-specific state fields

| Field                    | Type             | Purpose                                                         |
| ------------------------ | ---------------- | --------------------------------------------------------------- |
| `displayedCount`         | `number`         | Cards currently visible (infinite scroll progress).             |
| `previousDisplayedCount` | `number`         | Count from last batch render (for incremental append).          |
| `isLoading`              | `boolean`        | Guard: batch append in progress.                                |
| `currentCardSize`        | `number`         | Resolved card width setting (px).                               |
| `currentMinColumns`      | `number`         | Resolved minimum columns setting.                               |
| `lastColumnCount`        | `number`         | Last computed column count (skip no-op CSS updates).            |
| `isUpdatingColumns`      | `boolean`        | Guard: prevents reentrant ResizeObserver calls.                 |
| `lastObservedWidth`      | `number`         | Last container width (0 = tab switch detection).                |
| `resizeRafId`            | `number \| null` | Double-RAF debounce tracking ID.                                |
| `hasBatchAppended`       | `boolean`        | Flag: has infinite scroll appended items (end indicator logic). |

## Render pipeline

### 1. Initial render

`onDataUpdated()` → `queueMicrotask()` → `processDataUpdate()`

1. `applyCssOnlySettings()` — set CSS variables (`textPreviewLines`, `titleLines`, `imageRatio`, `thumbnailSize`) directly on container. Bypasses throttle for instant feedback.
2. Read settings with stale-config fallback (`lastRenderedSettings`), normalize property names.
3. Apply per-view CSS classes and variables (`applyViewContainerStyles`).
4. Compute `renderHash` (data paths + mtimes + settings + sort + shuffle + collapse + properties).
5. **Skip if hash unchanged** — restore column CSS variable (may be lost on tab switch), restore scroll position, return early. Schedule delayed re-checks at 100/250/500ms to catch late Obsidian config updates.
6. Check fast paths (see §2, §3 below).
7. **Full render**:
   - Clear content cache if settings changed. Reset `displayedCount` if batches were appended.
   - Calculate column count: `max(minColumns, floor((containerWidth + gap) / (cardSize + gap)))`. Set `--dynamic-views-grid-columns` CSS variable.
   - Process groups with shuffle logic. Collect visible entries up to `displayedCount`, skipping collapsed groups.
   - Load text previews and images (async, cancellable via `AbortController`).
   - Preserve container height (`--dynamic-views-preserve-height`) to prevent scroll reset during DOM wipe.
   - Clear container, render group sections with headers and cards.
   - Batch post-render hooks: `syncResponsiveClasses()`, `initializeScrollGradients()`, `initializeTitleTruncation()`.
   - Setup ResizeObserver (double-RAF debounce for column recalculation).
   - Setup infinite scroll (scroll listener + content visibility observer).
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
3. Update text preview DOM in-place (`querySelector('.card-text-preview')`).
4. **No relayout needed** — CSS Grid auto-adjusts row heights when content changes.

### 3. Property reorder fast path (`updatePropertyOrder`)

Triggered when only property **order** changed (not the set of properties, not other settings).

**Detection** (`isPropertyReorderOnly`):

1. `settingsChanged` — settings hash differs from last render.
2. `propertySetUnchanged` — sorted property names hash unchanged (same properties, different order).
3. `!settings.invertPropertyPairing` — pairing is position-dependent; reorder changes row count.
4. `settingsHashExcludingOrder === last` — order-independent settings hash (excludes `titleProperty`, `subtitleProperty`, `_skipLeadingProperties` which are position-derived, plus CSS-only fields).
5. `pathsUnchanged && changedPaths.size === 0` — no file additions/removals/modifications.

**Execution**:

1. For each card in DOM (`[data-path]`): rebuild `CardData` via `basesEntryToCardData()` (preserves cached `textPreview`/`imageUrl`).
2. Update title text (preserves `.card-title-ext-suffix` child element), subtitle, and properties DOM in-place.
3. Reinitialize scroll gradients (property widths may have changed).
4. Restore scroll position.

**Grid vs. masonry difference**: Grid calls `updateTitleText()` and `rerenderSubtitle()` because `displayFirstAsTitle` derives title/subtitle from property order positions. Masonry has a `titleSubtitleUnchanged` guard that skips the fast path entirely when derived title/subtitle change. Grid also iterates all DOM cards (no virtual scrolling), which can cause a multi-second delay with 1000+ cards.

### 4. Batch append (infinite scroll)

`appendBatch(totalEntries)` — triggered by scroll or initial load.

1. Collect only **new** entries (from `previousDisplayedCount` to `displayedCount`), skipping collapsed groups.
2. Set `isLoading = true` (suppresses concurrent `processDataUpdate` calls).
3. Load content for new entries only (cache-hit no-op for already-loaded).
4. Render new cards into existing or new group containers. Handle group boundaries — create new group section with header when group key changes.
5. Update `previousDisplayedCount` to captured `currCount`.
6. Batch post-render hooks scoped to new cards only: `syncResponsiveClasses()`, `initializeScrollGradientsForCards()`, `initializeTitleTruncationForCards()`.
7. Show end indicator if all items displayed.
8. Clear `isLoading` in `finally` block.

### 5. Resize

`ResizeObserver` → double-RAF debounce → `updateColumns()`

**Normal resize** (double-RAF debounce):

1. Read container width from `entries[0].contentRect.width`.
2. Skip if width is 0 (hidden/collapsed) or unchanged.
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

**Key difference from masonry**: Grid resize only updates the CSS variable controlling column count. CSS Grid handles all card repositioning automatically. No height measurement, no proportional scaling, no correction pass.

### 6. Content visibility

`setupContentVisibility()` — custom IntersectionObserver (not browser-native `content-visibility: auto`).

1. Observer uses scroll container as root with `rootMargin: ${PANE_MULTIPLIER * 100}% 0px` (300% top/bottom margin).
2. Toggles `content-hidden` CSS class on cards entering/leaving the extended viewport.
3. CSS rule `.content-hidden { content-visibility: hidden }` allows the browser to skip rendering for off-screen cards.
4. **Disabled on mobile**: iOS WebKit enters an infinite reflow loop when IO-toggled `content-visibility: hidden` changes card geometry, re-triggering the observer. Mobile falls back to browser-managed `content-visibility: auto`.

**Difference from masonry**: Grid uses content visibility for rendering optimization only (cards remain in DOM). Masonry uses full virtual scrolling — unmounting cards from the DOM entirely.

### 7. Group collapse

**Toggle** (`toggleGroupCollapse`):

1. Toggle `collapseKey` in `collapsedGroups` Set.
2. Update header DOM class (`collapsed`).
3. Persist to `basesState` (async — in-memory Set is authoritative).
4. **Expanding**: call `expandGroup()` — surgically populate only this group's cards without full re-render.
5. **Collapsing**: synchronously empty group container, then scroll header to viewport top if it was stuck. Invalidate `lastRenderHash`. Dispatch scroll event to trigger infinite scroll check (collapsing reduces height).

**Expand** (`expandGroup`):

1. Find matching group in data.
2. Load content (cache-hit no-op for already-loaded entries).
3. Render cards into group container with correct card indices.
4. Run scoped post-render hooks.
5. Invalidate `lastRenderHash` so next `onDataUpdated()` doesn't skip.

**Fold/unfold all** (`foldAllGroups`, `unfoldAllGroups`):

- Fold: add all group keys to `collapsedGroups`, persist, trigger re-render.
- Unfold: clear `collapsedGroups`, persist, trigger re-render.

## Render guard system

`processDataUpdate()` has 4 sequential guards:

| #   | Guard                     | Behavior                                                                                                         |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | `!this.data`              | Return early — data not yet initialized (race with MutationObserver).                                            |
| 2   | `isLoading`               | Return early — batch append in progress, full re-render would corrupt state.                                     |
| 3   | `renderHash === lastHash` | Return early — nothing changed. Schedule delayed re-checks (100/250/500ms) for late Obsidian config updates.     |
| 4   | `renderState.version`     | Incremented on each render. Stale async operations (content loading) bail when version mismatches on completion. |

### Data update throttle

`shouldProcessDataUpdate()` — hybrid throttle on `onDataUpdated()`:

- **Leading edge**: first call runs immediately.
- **Trailing edge**: catches coalesced updates from Obsidian's rapid duplicate calls.
- Prevents redundant renders from stale `config.getOrder()` timing.

## Throttle and debounce patterns

### Resize debounce

- **Pattern**: Double-RAF debounce (cancel-and-reschedule).
- **Behavior**: Each ResizeObserver callback cancels any pending RAF and schedules `rAF → rAF → updateColumns()`. At most one column recalculation per two frames.
- **Tab switch bypass**: When width transitions 0→positive, skip debounce for immediate column calculation.
- **Cost**: Negligible — only updates a CSS variable. CSS Grid handles repositioning.

### Scroll throttle

- **Pattern**: Leading + trailing, 100ms cooldown (`SCROLL_THROTTLE_MS`).
- **Leading**: Runs `checkAndLoad()` immediately.
- **Trailing**: Runs after cooldown to catch scroll position changes during throttle.

### Image-load handling

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

| Class                            | Element         | Purpose                                                                        |
| -------------------------------- | --------------- | ------------------------------------------------------------------------------ |
| `dynamic-views-grid`             | Feed container  | CSS Grid layout with `repeat(var(--dynamic-views-grid-columns), 1fr)`.         |
| `dynamic-views-group-section`    | Group wrapper   | `grid-column: 1 / -1` + `subgrid` — spans full width, inherits parent columns. |
| `dynamic-views-group`            | Group container | Nested subgrid for cards within a group.                                       |
| `bases-group-heading`            | Group header    | Sticky header with `scroll-state(stuck: top)` container query for border.      |
| `content-hidden`                 | Card            | Added by IntersectionObserver; triggers `content-visibility: hidden`.          |
| `is-grouped`                     | View container  | Toggled when view has grouped data.                                            |
| `dynamic-views-height-preserved` | View container  | Temporary class during DOM wipe; sets `min-height` to prevent scroll reset.    |

**Card flex layout**:

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

Arrow keys navigate spatially across all mounted cards using DOM measurements.

1. `setupHoverKeyboardNavigation()` — hover transfers focus target from mouse to keyboard. First arrow key activates visible focus ring.
2. `initializeContainerFocus()` — `tabindex=0` on feed container for initial Tab focus.
3. `handleArrowNavigation()` — batch all `getBoundingClientRect` calls, calculate cardinal directions using weighted cross-axis distance (`primaryDist + crossAxisDist × 0.5`).
4. Up/Down restricted to same column (within 5px tolerance). Left/Right unrestricted.
5. Target card focused + `scrollIntoView({ block: 'nearest' })`.

**Grid vs. masonry difference**: Grid navigates DOM-mounted cards only (all cards are in DOM). Masonry's `handleVirtualArrowNavigation()` can target unmounted cards and mounts them before focusing via `onMountItem(index)`.

## Constants (`src/shared/constants.ts`)

| Constant             | Value | Purpose                                                        |
| -------------------- | ----- | -------------------------------------------------------------- |
| `BATCH_SIZE`         | 50    | Default infinite scroll batch size.                            |
| `MAX_BATCH_SIZE`     | 70    | Maximum batch size cap.                                        |
| `ROWS_PER_COLUMN`    | 10    | Rows per column for dynamic batch size calculation.            |
| `PANE_MULTIPLIER`    | 3     | Trigger batch load when within 3× viewport height from bottom. |
| `SCROLL_THROTTLE_MS` | 100   | Scroll event throttle interval.                                |

### Property measurement constants (`src/shared/property-measure.ts`)

| Constant                  | Value | Purpose                                         |
| ------------------------- | ----- | ----------------------------------------------- |
| `SETS_PER_FRAME`          | 5     | Side-by-side property sets processed per frame. |
| `MAX_QUEUE_SIZE`          | 500   | Maximum queued property sets.                   |
| `MAX_GRADIENT_BATCH_SIZE` | 100   | Early-flush threshold for gradient updates.     |
| `MEASUREMENT_CHUNK_SIZE`  | 5     | Property fields measured per chunk.             |

## Key invariants

1. **`--dynamic-views-grid-columns` is the layout source of truth.** CSS Grid handles all card positioning from this single variable. No JavaScript position calculation needed (unlike masonry's per-card `left`/`top`).
2. **`renderHash` prevents redundant re-renders.** The hash includes data paths, mtimes, settings, sort, shuffle, collapse state, and visible properties. Delayed re-checks (100/250/500ms) catch Obsidian's late config updates.
3. **`isLoading` prevents concurrent renders during batch append.** `processDataUpdate()` returns early while a batch is in flight. The batch owns `renderState.version` to cancel stale operations.
4. **`previousDisplayedCount` ensures incremental append correctness.** Batch append renders only cards from `previousDisplayedCount` to `displayedCount`, never re-rendering existing cards.
5. **`collapsedGroups` is loaded once from persistence.** First render loads from `basesState`; thereafter the in-memory `Set` is authoritative. Reloading on every `onDataUpdated` would wipe state due to style-settings-triggered callbacks with stale persistence.
6. **Container height is preserved during DOM wipe.** `--dynamic-views-preserve-height` sets `min-height` before clearing the container, preventing the scroll parent from resetting scroll position.
7. **Content visibility is disabled on iOS.** `setupContentVisibility()` returns a no-op on mobile to avoid the WebKit infinite reflow loop. Mobile falls back to browser-managed `content-visibility: auto`.
8. **CSS-only settings bypass the render pipeline.** `applyCssOnlySettings()` runs before throttle and hash comparison, setting CSS variables directly for instant feedback on `textPreviewLines`, `titleLines`, `imageRatio`, and `thumbnailSize` changes.

## Bases vs. Datacore

Both backends share the same card rendering pipeline (`CardRenderer`/`SharedCardRenderer`) and settings schema. They diverge in rendering model, state management, and layout strategy.

### Architecture comparison

| Aspect                 | Bases                                                       | Datacore                                                          |
| ---------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------- |
| **Rendering model**    | Imperative DOM manipulation via `renderCard()`.             | Declarative Preact/JSX components via `CardRenderer`.             |
| **State management**   | Instance fields + `{ current }` ref boxes on view class.    | Preact hooks (`dc.useState`, `dc.useRef`, `dc.useEffect`).        |
| **Layout engine**      | CSS Grid with JS-controlled `--dynamic-views-grid-columns`. | CSS Grid with JS-controlled `--dynamic-views-grid-columns`.       |
| **Content visibility** | Custom IntersectionObserver (`content-hidden` class).       | Not implemented — all displayed cards rendered normally.          |
| **Resize strategy**    | Double-RAF debounce → update CSS variable only.             | Double-RAF throttle → update CSS variable only.                   |
| **Group collapse**     | Surgical expand/collapse with scroll position adjustment.   | State-driven re-render.                                           |
| **Content loading**    | `ContentCache` objects with abort controllers.              | `useRef` Map with effect ID race prevention.                      |
| **Cleanup**            | Manual per-card `CardHandle.cleanup()` + abort.             | Preact handles unmount cleanup.                                   |
| **Width modes**        | Standalone view — fills pane.                               | Embedded in Live Preview/Reading View with normal/wide/max modes. |

### What Bases has that Datacore lacks

- **Content visibility optimization** — IntersectionObserver toggles `content-hidden` class at `PANE_MULTIPLIER` distance, allowing the browser to skip rendering for far-off-screen cards. Datacore renders all displayed cards normally.
- **Surgical group expand** — Expanding a collapsed group renders only that group's cards without full re-render. Datacore does a full state-driven re-render.
- **Property reorder fast path** — Detects property-order-only changes and updates card content without re-rendering.
- **Content update fast path** — Detects content-only changes (mtime differs, paths unchanged) and updates text previews in-place.

### What Datacore has that Bases lacks

- **Declarative rendering** — Data changes flow through Preact's render cycle. No manual DOM bookkeeping.
- **Width modes** — `normal` (match `--file-line-width`), `wide` (1.75×), `max` (full pane). Bases views fill their pane natively.
- **Reactive query** — `dc.query()` re-executes on Datacore index updates (500ms debounced). Bases uses Obsidian's `onDataUpdated()` callback.
- **DOM shuffle** — Fisher-Yates shuffle directly reorders DOM children + triggers relayout. Bases rebuilds via data sort.

### Shared behavior

- **Layout engine** — Both use CSS Grid with `repeat(var(--dynamic-views-grid-columns), 1fr)`.
- **Column calculation** — `max(minColumns, floor((width + gap) / (cardSize + gap)))`.
- **Infinite scroll** — `displayedCount` incremented by `columns × ROWS_PER_COLUMN` (capped at `MAX_BATCH_SIZE`) when within `PANE_MULTIPLIER × viewport height` from bottom. Leading + trailing throttle.
- **Card rendering** — Both backends produce `CardData` and render through shared `card-renderer.tsx` logic (title, subtitle, properties, image, text preview).
- **Group headers** — Sticky with `scroll-state(stuck: top)` container query for bottom border (progressive enhancement — iOS WebKit doesn't support scroll-state queries).
- **Subgrid groups** — `grid-column: 1 / -1` + `grid-template-columns: subgrid` for column alignment.
- **Responsive classes** — `syncResponsiveClasses()` runs after layout in both backends.
- **Scroll gradients** — `initializeScrollGradients()` applied to property rows in both.
- **Title truncation** — Binary-search truncation via `initializeTitleTruncation()` in both.

## Grid vs. masonry comparison

| Aspect                   | Grid                                                 | Masonry                                                    |
| ------------------------ | ---------------------------------------------------- | ---------------------------------------------------------- |
| **Layout engine**        | CSS Grid (`display: grid`, automatic flow)           | Absolute positioning (`position: absolute`, JS-calculated) |
| **Card height**          | Natural content height, equal per row (`stretch`)    | Variable per card (`height: auto` or proportional)         |
| **Column control**       | Single CSS variable (`--dynamic-views-grid-columns`) | JavaScript calculates all positions per card               |
| **Resize cost**          | ~0ms (CSS variable update only)                      | ~3-5ms proportional, ~6-9ms correction                     |
| **Virtual scrolling**    | None — all cards in DOM, content-visibility for perf | Full `VirtualItem[]` tracking with mount/unmount           |
| **Image load handling**  | CSS Grid auto-reflows rows (no JS needed)            | Coalesced RAF relayout per image batch                     |
| **Group structure**      | CSS subgrid (cards aligned with parent columns)      | Block containers with `position: relative`                 |
| **Properties alignment** | `margin-top: auto` (works with `stretch`)            | `margin-top: auto` (limited — no fixed card height)        |
| **Reorder fast path**    | Updates title + subtitle + properties                | Updates properties only (title/subtitle guarded)           |
| **Content fast path**    | Updates text preview in-place                        | Not implemented (full relayout on content change)          |
| **Render complexity**    | Simpler (CSS handles positioning)                    | Complex (5-guard layout system, proportional scaling)      |
| **Performance ceiling**  | Lower control (CSS Grid limits)                      | Higher control (arbitrary layouts, virtual scroll)         |
