---
title: Property layout system
description: Property pairing, width measurement, scroll gradients, and vertical positioning inside cards for both backends.
author: 🤖 Generated with Claude Code
updated: 2026-03-16
---
# Property layout system

## Overview

The property layout system controls how property rows are arranged inside cards in Grid and Masonry views. It decides which properties are paired side-by-side, measures their widths to allocate space optimally, applies scroll gradients when content overflows, and splits properties into top/bottom containers around the text preview. The system spans six files: `src/shared/property-measure.ts` (width measurement pipeline), `src/shared/scroll-gradient.ts` (overflow gradient indicators), `src/shared/property-helpers.ts` (`computeInvertPairs` algorithm and collapse logic), `src/shared/card-renderer.tsx` (Datacore property rendering and pairing), `src/bases/shared-renderer.ts` (Bases property rendering and container classes), and `styles/_properties.scss` (CSS layout rules and state classes).

## Files

| File                             | Role                                                                   |
| -------------------------------- | ---------------------------------------------------------------------- |
| `src/shared/property-measure.ts` | Width measurement pipeline, synchronous measurement, ResizeObserver.   |
| `src/shared/scroll-gradient.ts`  | Horizontal/vertical gradient indicators for overflowing content.       |
| `src/shared/property-helpers.ts` | `computeInvertPairs()`, `shouldCollapseField()`, property type checks, batched compact-stacked detection. |
| `src/shared/card-renderer.tsx`   | Datacore property rendering, `PropertySet` grouping, top/bottom split. |
| `src/bases/shared-renderer.ts`   | Bases property rendering, container class application, measurement.    |
| `src/utils/property.ts`          | `parsePropertyList()` — comma-separated string to `Set<string>`.       |
| `styles/_properties.scss`        | All property CSS: pairs, measurement states, alignment, compact mode.  |

## Pairing logic

Properties can be displayed as unpaired full-width rows or as side-by-side pairs. Two modes control this.

### Two modes

- **`pairProperties=true`** (Datacore default): All consecutive properties are paired by default. The `invertPropertyPairing` string lists property names to **unpair** — any property named in the set stays full-width.
- **`pairProperties=false`** (ViewDefaults + Bases default): All properties are unpaired by default. The `invertPropertyPairing` string lists property names to **pair** — named properties are paired with their neighbor.

### Parsing `invertPropertyPairing`

`parsePropertyList(csv)` in `src/utils/property.ts` splits the comma-separated string, trims whitespace, and filters empty entries into a `Set<string>` for O(1) lookup. This set is called `invertPairingSet` in both renderers (the name reflects the `pairProperties=true` path; when `pairProperties=false`, the same set drives `computeInvertPairs`).

### `computeInvertPairs()` algorithm

Called only when `pairProperties=false`. Scans the full property array (not just visible props) and returns a `Map<number, number>` mapping left-index to right-index.

```ts
function computeInvertPairs(
  props: Array<{ name: string }>,
  invertPairingSet: Set<string>
): Map<number, number>;
```

For each unclaimed property `i` whose name is in `invertPairingSet`:

1. **First property** (`i === 0`): partner is always index 1.
2. **Otherwise**: if the next property (`i + 1`) is also in `invertPairingSet`, partner is `i + 1`. Otherwise partner is `i - 1`.
3. Both indices must be in bounds and unclaimed. The lower index becomes left, the higher becomes right. Both are marked as claimed.

### PropertySet data structure

Both renderers group visible properties into sets before rendering:

```ts
// Datacore (card-renderer.tsx)
interface PropertySet {
  items: Array<{ name: string; value: unknown; fieldIndex: number }>;
  paired: boolean;
}

// Bases (shared-renderer.ts) — same `items` field
// but includes `originalIndex` for the top/bottom split.
interface PropertySet {
  items: Array<{
    name: string;
    value: unknown;
    fieldIndex: number;
    originalIndex: number;
  }>;
  paired: boolean;
}
```

- **`paired=true`**: Two properties rendered inside a `.property-pair` wrapper with `.pair-left` and `.pair-right` position classes.
- **`paired=false`**: Single property rendered as a direct child of `.card-properties`.

The pairing decision walks visible properties sequentially. When `pairProperties=true`, two consecutive properties are paired unless either name is in `invertPairingSet`. When `pairProperties=false`, pairing only occurs if `invertPairs.get(current.fieldIndex - 1) === next.fieldIndex - 1` (note: `fieldIndex` is 1-based, so `fieldIndex - 1` recovers the 0-based index used by `computeInvertPairs`).

### Vertical position: top/bottom split

Properties are split into `.card-properties-top` (above text preview/thumbnail) and `.card-properties-bottom` (below).

**Bases**: Uses `textPreviewIndex` — properties whose `originalIndex < textPreviewIndex` go to top, the rest go to bottom. When no text preview property is set, all properties go to bottom.

**Datacore**: Uses `showPropertiesAbove` (boolean) + `invertPropertyPosition` (comma-separated property names). For each property set:

1. Check if any property in the set is named in `invertPositionSet`.
2. If `showPropertiesAbove=true`: properties go to top unless inverted. If `showPropertiesAbove=false`: properties go to bottom unless inverted.

```ts
const isAbove = settings.showPropertiesAbove
  ? !anyInvertedPosition
  : anyInvertedPosition;
```

## Width measurement pipeline

Paired property widths are measured by JavaScript to allocate space proportionally rather than using a fixed 50-50 split. Managed by `src/shared/property-measure.ts`.

### Entry point

`measurePropertyFields(cardEl)` is called per card after rendering. Returns a `ResizeObserver[]` for cleanup. It:

1. Skips if column mode (`.dynamic-views-paired-property-column` on view container).
2. Finds all `.property-pair` elements and the `.card-properties` container.
3. Performs synchronous initial measurement via `measureCardPairsSynchronous()` — completes before first paint.
4. Creates a `ResizeObserver` on the card element for resize-triggered remeasurement.

### Synchronous measurement

`measureCardPairsSynchronous(cardEl, sets, cardProps)` measures all property pairs in a card synchronously. Guards skip compact mode, column mode, content-hidden cards, and cards whose width hasn't changed (width cache with 0.5px tolerance). Each set triggers one forced reflow via `measureSideBySideSet()`. Gradient updates and `PROPERTY_MEASURED` event dispatch happen inline after all sets are measured.

This replaced an earlier async queue system (`SETS_PER_FRAME = 5` per RAF, `IntersectionObserver` visibility gating). Virtual scrolling bounds the DOM-resident card count tightly enough that synchronous measurement completes within a single frame without perceptible jank. The async queue caused 2-3 frames of visible flicker as the unmeasured CSS state (`flex: 0 1 auto; max-width: 50%`) was painted before `.property-measured` was applied.

### Two-tier width caching

Two caches prevent redundant measurement at different granularities:

- **`cardWidthCache`** (`WeakMap<HTMLElement, number>`): Prevents redundant measurement of the same live DOM element. Stores last measured `clientWidth` per card. Measurements are skipped when width changes by less than 0.5px (`WIDTH_TOLERANCE`). Auto-cleans when card elements are garbage collected.
- **`persistentWidthCache`** (`Map<string, CachedCardMeasurement>`): Prevents forced reflows on re-mount of previously-measured files. Keyed by file path (`data-path`), stores `{ containerWidth, pairs[] }` where each pair has `field1`/`field2` width strings. On virtual scroll re-mount, cached widths are applied directly (CSS var set + class toggle) — zero forced reflows. Cache is invalidated by `resetPersistentWidthCache()` (settings change), `remeasurePropertyFields()` (label mode change), and in-place card updates (fresh DOM on a reused card element triggers per-path deletion).

The persistent cache lookup in `measureCardPairsSynchronous()` runs after the `cardWidthCache` width-change check and before the measurement loop. On cache hit (same pair count, container width within tolerance), it applies cached CSS vars, resets scroll positions, collects gradient targets, and returns early. On cache miss (first measurement or width change), the full measurement loop runs and stores results into the persistent cache before gradient application.

### Two-phase measurement

`measureSideBySideSet(set, gradientTargets)` performs the actual measurement:

**Phase 1: `.property-measuring` state (CSS constraints removed)**

```scss
.property-pair.property-measuring .property {
  width: auto !important;
  max-width: none !important;
  flex: 0 0 auto !important;
}
.property-pair.property-measuring .property-content-wrapper {
  width: auto !important;
  max-width: none !important;
  overflow-x: visible !important;
  flex: 0 1 auto !important;
}
.property-pair.property-measuring .property-content {
  width: max-content !important;
  max-width: none !important;
  min-width: 0 !important;
}
```

A forced reflow (`void set.offsetWidth`) ensures content dimensions are accurate.

**Phase 2: Measure and allocate**

Reads `content.scrollWidth` for each field's `.property-content`, then applies allocation via CSS custom properties.

### Allocation algorithm

Uses `cardProperties.clientWidth` as container width. Subtracts the pair gap (`cachedFieldGap`, read from `getComputedStyle(set).gap`).

| Case                  | Condition                      | Field 1 width                    | Field 2 width                    |
| --------------------- | ------------------------------ | -------------------------------- | -------------------------------- |
| **Both fit**          | `width1 + width2 <= available` | `width1` (exact)                 | `available - width1` (remainder) |
| **Field 1 fits half** | `width1 <= available / 2`      | `width1` (exact)                 | `available - width1` (remainder) |
| **Field 2 fits half** | `width2 <= available / 2`      | `available - width2` (remainder) | `width2` (exact)                 |
| **Neither fits half** | Both > 50%                     | `available / 2`                  | `available / 2`                  |

### Empty field handling

When a field's `.property-content` has zero `scrollWidth`:

- Empty field gets `0px` width.
- Partner gets full `containerWidth` (no gap subtracted since the empty field is invisible).

### Label measurement

- **Inline labels** (`.property-label-inline`): `width = content.scrollWidth + inlineLabel.scrollWidth + cachedLabelGap`.
- **Above labels** (`.property-label`): `width = max(content.scrollWidth, aboveLabel.scrollWidth)`.

Gap values are read once from CSS and cached (with fallbacks for unparseable values):

- **`cachedFieldGap`**: `parseFloat(getComputedStyle(set).gap) || 8` — gap between paired fields.
- **`cachedLabelGap`**: `parseFloat(getComputedStyle(field).gap) || 4` — gap between inline label and content.

Gap values are Obsidian hardcoded constants (`--size-*` vars) — read once on first use and never reset.

### CSS custom properties

After measurement, applied on the `.property-pair` element:

- **`--field1-width`**: Width for `.pair-left` field.
- **`--field2-width`**: Width for `.pair-right` field.

### `.property-measured` state

After applying CSS vars, the set gets `property-measured` class. CSS switches from the default unmeasured flex rules to explicit widths:

```scss
.property-pair.property-measured .pair-left {
  width: var(--field1-width);
  flex: 0 0 auto;
  max-width: none;
}
.property-pair.property-measured .pair-right {
  width: var(--field2-width);
  flex: 0 0 auto;
  max-width: none;
}
```

### Remeasurement

`remeasurePropertyFields(container)` clears all `.property-measured` states and CSS vars, then re-measures all sets synchronously. Called when property label mode changes — low frequency, bounded card count due to virtual scrolling.

## CSS state machine

| Class                 | Element      | Meaning                                                                      |
| --------------------- | ------------ | ---------------------------------------------------------------------------- |
| `.property-pair`      | Pair wrapper | Contains two `.property` children in side-by-side layout.                    |
| `.pair-left`          | Left field   | First property in a pair (`.property` child).                                |
| `.pair-right`         | Right field  | Second property in a pair (`.property` child).                               |
| `.property-measuring` | Pair wrapper | Transient: CSS constraints removed via `!important` for natural width reads. |
| `.property-measured`  | Pair wrapper | Widths allocated: fields use `--field1-width`/`--field2-width` CSS vars.     |
| `.property-collapsed` | Field        | Empty/missing field hidden (`display: none`).                                |
| `.is-scrollable`      | Field        | Content overflows wrapper width (set by scroll gradient system).             |
| `.compact-mode`       | Card         | Card below compact breakpoint — pairs stack vertically.                      |
| `.compact-stacked`    | Card         | Set by JS when `hasWrappedPairs()` returns true: all pairs stack vertically. |
| `.content-hidden`     | Card         | Off-screen card with `content-visibility: hidden` (measurement skipped).     |

**Default unmeasured state**: `.property-pair:not(.property-measured) { visibility: hidden }` hides pairs before measurement completes. Column mode and compact mode override this with `visibility: visible` since they skip JS measurement. Sync measurement applies `.property-measured` before first paint in normal flow, so the hidden state is never visible.

**State transitions**: unmounted → default (hidden via `visibility: hidden`) → `.property-measuring` → measure → `.property-measured` (CSS vars active, visible). Compact mode and column mode bypass measurement entirely (visible immediately).

**Collapsed pairs**: When one field has `.property-collapsed`, the visible partner expands (`max-width: 100%; flex: 1 1 auto`). When both are collapsed, the `.property-pair` wrapper gets `display: none`.

## Alignment modes

Controlled by the `rightPropertyPosition` view setting, which adds a class to the view container. **Bases-only**: `applyViewContainerStyles()` is called exclusively from Bases views. Datacore does not consume `rightPropertyPosition` — this is a known parity gap.

### Right

Class: `dynamic-views-paired-property-right`. This class is always applied by `applyViewContainerStyles()` for consistency/debuggability, but has no matching CSS selectors — right alignment is the CSS default without any class override.

- **`.pair-right` content**: Right-aligned via `justify-content: flex-end` on `.property-content` and `min-width: 100%`.
- **`.pair-right` wrapper**: `justify-content: flex-end` when not scrollable; flips to `flex-start` when `.is-scrollable` (scroll position starts at left edge).
- **Inline label order**: Label after content (`order: 2` on `.property-label-inline`).
- **Above label alignment**: `text-align: right`.

### Left

Class: `dynamic-views-paired-property-left`.

- Resets right-field alignment to `justify-content: flex-start` on wrapper and content.
- Resets inline label order to `order: 0` (label before content).
- Resets above label to `text-align: left`.

### Column (default)

Class: `dynamic-views-paired-property-column`.

- **Skips JS measurement entirely** — `measurePropertyFields()` returns early, `measureCardPairsSynchronous()` returns early.
- CSS rule: `.property-pair .property { flex: 1 1 0 }` gives each field equal width.
- Left-alignment (same CSS overrides as left mode).

### Full-row alignment (Style Settings)

`body.dynamic-views-full-row-align-right` makes inline-labeled unpaired properties right-align their value: `flex: 0 1 auto` + `margin-left: auto` on `.property-content-wrapper`. The `flex` override is essential — without it, the wrapper's default `flex: 1 1 0` would fill the container, making `margin-left: auto` a no-op.

## Scroll gradient integration

After measurement, fields that overflow their wrapper receive gradient indicators showing hidden content direction.

### When gradients are applied

`updateScrollGradient(field)` checks if `.property-content.scrollWidth > .property-content-wrapper.clientWidth`. If so, the field gets `.is-scrollable` and the wrapper gets a gradient class.

### Three gradient classes

| Class                   | Condition                        | Indicator  |
| ----------------------- | -------------------------------- | ---------- |
| `scroll-gradient-right` | At start, content extends right  | Right fade |
| `scroll-gradient-left`  | At end, content extends left     | Left fade  |
| `scroll-gradient-both`  | Middle position, both directions | Both fades |

Scroll position is compared against `SCROLL_TOLERANCE = 1` (unitless numeric, pixels in JS context) to determine edge state.

### `.is-scrollable` alignment flip

When a right-side field (`.pair-right`) gets `.is-scrollable`, its wrapper alignment flips from `justify-content: flex-end` to `flex-start`. This ensures the user sees content from the left edge and can scroll right to see more.

### Gradient application after measurement

During synchronous measurement, gradient targets are collected into a local array. After all sets are measured, `updateScrollGradient()` is called on each target inline — no RAF deferral. The `PROPERTY_MEASURED` event is dispatched on the card's `ownerDocument` (not necessarily `window.document` — popout windows have their own `Document` instance) after gradient application.

### Masonry relayout coordination

> For the full masonry layout guard system and how `"property-measured"` sources are handled, see [masonry-layout.md](masonry-layout.md).

The `PROPERTY_MEASURED` custom event (dispatched on each processed card's `ownerDocument` after gradient batch flush) is listened to by masonry views to trigger a relayout — property measurement can change card heights. The masonry listener is bound to `this.containerEl.ownerDocument` at construction time. When a masonry view moves to a popout window, `handleDocumentChange(oldDoc, newDoc)` removes the listener from the old document and rebinds it to the new one — without this, the listener stays on the main window's document and misses events dispatched on the popout's document.

### Initialization

`initializeScrollGradients(container)` runs batch gradient initialization after render using a read-then-write pattern:

1. **Phase 1** (read): Measure all wrapper/content dimensions.
2. **Phase 2** (write): Apply gradient classes and `.is-scrollable`.

Paired fields that haven't been measured yet (no `.property-measured` class) are skipped, unless in compact or column mode where JS measurement isn't needed.

## Compact mode

### Breakpoint

Style Settings slider `dynamic-views-compact-breakpoint`, default `390px`. Set to 0 to disable. `syncResponsiveClasses()` reads the breakpoint and toggles `.compact-mode` on cards whose width falls below the threshold.

### Behavior

- **Content-based stacking via `flex-wrap: wrap` + `flex: 1 1 auto`**: Flexbox line-breaking uses the max-content width as hypothetical main size. Short properties (timestamps, tags) stay side-by-side; long properties (file names, URLs) stack when combined content + gap exceeds card width. No `flex-direction: column` — wrapping is intrinsic.
- **Width overrides**: `width: auto !important; max-width: 100% !important; flex: 1 1 auto !important`. Overrides measured widths if card was previously in non-compact measured state.
- **Measurement still skipped**: `measureSideBySideSet()` returns early when card has `.compact-mode`. `measureCardPairsSynchronous()` also skips. CSS flex-wrap handles layout without JS measurement.
- **Left-aligned**: Compact-mode `.pair-right` content resets to `justify-content: flex-start` — right-alignment on stacked full-width properties would be visually inconsistent.

### Compact stacked

`flex-wrap: wrap` in compact mode produces content-aware wrapping — short pairs stay side-by-side while long ones stack. When any pair wraps, `.compact-stacked` is added to force all pairs to stack vertically, ensuring visual consistency.

**`hasWrappedPairs()` detection** (`property-helpers.ts`): Queries all `.property-pair` elements on the card, compares `getBoundingClientRect().top` of `.pair-left` vs `.pair-right` with +1px tolerance. Returns `true` if any right child is below its left sibling.

**RAF-batched detection**: Detection is batched via `queueCompactStackedCheck()` in `property-helpers.ts`. Per-card `ResizeObserver` callbacks queue cards; a single `requestAnimationFrame` per document processes each document's batch independently (1 forced reflow per document per frame, not N). Cards are partitioned by `ownerDocument` into `pendingCardsByDoc` (`Map<Document, Set<HTMLElement>>`) with separate RAF IDs per document (`batchRafIds`). This prevents cross-window interference: forced reflow only flushes one document's layout, and row sync comparisons are meaningless across different viewports. The `compactWidthCache` (`WeakMap<HTMLElement, number>`) is shared module-level state in `property-helpers.ts` — both Bases (`shared-renderer.ts`) and Datacore (`card-renderer.tsx`) import the same functions.

**Three-phase batch pattern**:

1. **Write**: Remove `.compact-stacked` from all queued cards.
2. **Reflow**: Single `void eligible[0].offsetHeight` — collapses N per-card reflows into 1 per document.
3. **Read**: Call `hasWrappedPairs()` on each card.
4. **Row sync** (Grid only): Group grid cards by `getBoundingClientRect().top` (1px tolerance). If ANY card in a row wraps, ALL cards in that row get `.compact-stacked`. Cross-group contamination is geometrically impossible — groups are sequential in document flow with intervening headers, so cards in different groups never share the same `.top`.
5. **Write**: Apply `.compact-stacked` where wrapping detected (including row-synced cards).

**`compactWidthCache` loop prevention**: Toggling `.compact-stacked` changes card height, which fires the `ResizeObserver`, which would re-evaluate wrapping — creating an infinite loop. The cache tracks the last width at which wrapping was evaluated. `queueCompactStackedCheck()` skips re-evaluation when only height changed (same width in cache). `cancelCompactStackedCheck()` removes the card from the batch, clears the class, and deletes the cache entry (used when exiting compact mode). `invalidateCompactStackedCache()` clears the cache entry and removes the card from the pending batch (used when cards become `.content-hidden` so wrapping is re-evaluated when they return to view).

**Detection flow**:

1. Per-card RO fires → `queueCompactStackedCheck(cardEl, cardWidth)` checks cache, queues if width changed.
2. RAF fires → batch processes all queued cards: remove `.compact-stacked`, force 1 reflow, read `hasWrappedPairs()`, apply `.compact-stacked`.
3. If not compact: `cancelCompactStackedCheck(cardEl)` removes class and cache entry.

**CSS rules for stacked mode** (`_properties.scss`):

- `.card.compact-stacked .property-pair`: `flex-direction: column; flex-wrap: nowrap; gap: var(--size-2-2)`.
- Order resets: `.pair-right .property-label-inline` and `.property-content` reset to `order: 0` (label-then-value natural reading order).
- Alignment resets: `.pair-right .property-content` and `.property-content-wrapper` reset to `justify-content: flex-start`; labels reset to `text-align: left`.
- Timestamp icon: edge-mode reset flips pair-right icon to left (`order: 0`); right-mode override keeps icon right (`order: 2`, specificity 0,7,1); center-mode override keeps icon right (`order: 2`, specificity 0,7,1).

**Right mode two-layer alignment**: In side-by-side compact, right-alignment is preserved (`flex-end`, order reversal) — compact resets are scoped via `:not(.dynamic-views-paired-property-right)`. In compact-stacked, left-alignment is forced — pair-right spans full width, and right-aligning it creates inconsistency with the pair-left row above.

## Settings reference

> For the full settings resolution pipeline (three-layer merge, sparse storage, template system), see [settings-resolution.md](settings-resolution.md).

### View settings (Bases config / Datacore settings)

| Key                      | Type                            | Default                                            | Description                                        | Consumed by                                                                                                                |
| ------------------------ | ------------------------------- | -------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `propertyLabels`         | `'hide' \| 'inline' \| 'above'` | `'hide'` (ViewDefaults) / `'inline'` (Bases)       | Label display mode.                                | Both renderers, measurement (label width), CSS.                                                                            |
| `pairProperties`         | `boolean`                       | `false` (ViewDefaults + Bases) / `true` (Datacore) | Whether properties pair by default.                | Both renderers (pairing algorithm).                                                                                        |
| `rightPropertyPosition`  | `'left' \| 'column' \| 'right'` | `'column'`                                         | Right-side field alignment mode. Bases-only.       | `applyViewContainerStyles()` (Bases), [_properties.scss](../../styles/_properties.scss), measurement skip in `measurePropertyFields()`/`measureCardPairsSynchronous()`. |
| `invertPropertyPairing`  | `string`                        | `''`                                               | Comma-separated names to invert pairing behavior.  | Both renderers via `parsePropertyList()`.                                                                                  |
| `showPropertiesAbove`    | `boolean`                       | `false`                                            | Default vertical position for properties.          | Datacore renderer (top/bottom split).                                                                                      |
| `invertPropertyPosition` | `string`                        | `''`                                               | Comma-separated names to invert vertical position. | Datacore renderer (top/bottom split).                                                                                      |

### Style Settings (CSS / body classes)

| Setting                                     | Type              | Default  | Description                                                                                                                       |
| ------------------------------------------- | ----------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `dynamic-views-compact-breakpoint`          | `variable-number` | `390px`  | Card width threshold for compact mode.                                                                                            |
| `dynamic-views-full-row-property-alignment` | `class-select`    | `left`   | Full-row property value alignment (left/right).                                                                                   |
| `dynamic-views-property-label-case`         | `class-select`    | preserve | Label text-transform (preserve/lowercase/uppercase). Options: `dynamic-views-property-label-case-{preserve,lowercase,uppercase}`. |
| `dynamic-views-property-label-bold`         | `class-toggle`    | off      | Bold labels.                                                                                                                      |
| `dynamic-views-property-label-small-caps`   | `class-toggle`    | off      | Small caps labels.                                                                                                                |

## Invariants

1. **Measurement requires DOM attachment.** `measureCardPairsSynchronous()` checks `set.isConnected` before calling `measureSideBySideSet()`. Measurement of disconnected elements produces zero widths.
2. **Column mode must not trigger JS measurement.** Both `measurePropertyFields()` and `measureCardPairsSynchronous()` check for `.dynamic-views-paired-property-column` and return early. Column mode relies on `flex: 1 1 0` CSS only.
3. **Compact mode must not trigger JS measurement.** Two guards: `measureCardPairsSynchronous()` skips at entry, and `measureSideBySideSet()` returns early. CSS forces `width: 100% !important`.
4. **Gradients are applied before `PROPERTY_MEASURED` fires.** Both happen synchronously in `measureCardPairsSynchronous()` — gradient updates first, then event dispatch. Masonry relayout handlers can rely on gradients being applied.
5. **Content-hidden cards must not be measured.** Reading dimensions on cards with `content-visibility: hidden` triggers Chromium console warnings and returns incorrect values. Both `measureCardPairsSynchronous()` and `measureSideBySideSet()` skip `.content-hidden` cards.
6. **Gap values are read-once constants.** `cachedFieldGap` and `cachedLabelGap` are read from Obsidian's hardcoded `--size-*` CSS vars on first use and never reset.
7. **Unmeasured pairs are hidden via CSS.** `.property-pair:not(.property-measured) { visibility: hidden }` prevents flicker from the unmeasured flex state. Column mode and compact mode override with `visibility: visible` since they skip JS measurement.
8. **Width caches prevent redundant measurement.** `cardWidthCache` (WeakMap) prevents re-measuring the same live element; `persistentWidthCache` (Map) prevents forced reflows on re-mount of previously-measured files. Both use 0.5px `WIDTH_TOLERANCE`. The persistent cache is invalidated on settings change (`resetPersistentWidthCache`), label mode change (`remeasurePropertyFields`), and in-place card updates (fresh DOM on a reused element triggers per-path deletion).
9. **Scroll position resets after measurement.** Both wrappers have `scrollLeft` reset to 0 after widths are applied, ensuring gradients start in the correct state.
10. **`property-measuring` is always removed.** The `finally` block in `measureSideBySideSet()` guarantees `property-measuring` is removed even if measurement throws.
11. **Compact-exit triggers property re-measurement.** `syncResponsiveClasses` collects cards exiting compact mode and calls `remeasureCardPairs()` after all class toggles. This is necessary because the property RO fires before `compact-mode` is removed — measurement skipped at compact guard, no subsequent RO event.
12. **In-place updates invalidate persistent cache.** When `measureCardPairsSynchronous` detects fresh DOM (unmeasured sets) on a reused card element (`cardWidthCache` hit), it deletes the persistent cache entry for that file path before re-measuring. This prevents stale cached widths from being applied after property value changes.
13. **`compact-stacked` requires `compact-mode`.** `cancelCompactStackedCheck` always runs on compact exit (via `syncResponsiveClasses`). Batched detection guards on `.compact-mode` presence — non-compact cards are filtered out before measurement.
14. **Batch state requires no explicit cleanup.** Module-level `pendingCardsByDoc`, `batchRafIds`, and `compactWidthCache` are self-managing. `isConnected` + `compact-mode` guards handle stale entries. WeakMap allows GC of removed card elements. Per-document `Set` entries are cleared after each batch.
