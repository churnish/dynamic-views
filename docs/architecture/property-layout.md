---
title: Property layout system
description: Property pairing, width measurement, scroll gradients, and vertical positioning inside cards for both backends.
author: "\U0001F916 Generated with Claude Code"
last updated: 2026-03-06
---
# Property layout system

## Overview

The property layout system controls how property rows are arranged inside cards in Grid and Masonry views. It decides which properties are paired side-by-side, measures their widths to allocate space optimally, applies scroll gradients when content overflows, and splits properties into top/bottom containers around the text preview. The system spans six files: `src/shared/property-measure.ts` (width measurement pipeline), `src/shared/scroll-gradient.ts` (overflow gradient indicators), `src/shared/property-helpers.ts` (`computeInvertPairs` algorithm and collapse logic), `src/shared/card-renderer.tsx` (Datacore property rendering and pairing), `src/bases/shared-renderer.ts` (Bases property rendering and container classes), and `styles/_properties.scss` (CSS layout rules and state classes).

## Files

| File                             | Role                                                                   |
| -------------------------------- | ---------------------------------------------------------------------- |
| `src/shared/property-measure.ts` | Width measurement pipeline, visibility gating, queue system.           |
| `src/shared/scroll-gradient.ts`  | Horizontal/vertical gradient indicators for overflowing content.       |
| `src/shared/property-helpers.ts` | `computeInvertPairs()`, `shouldCollapseField()`, property type checks. |
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
3. Registers the card with an `IntersectionObserver` (100px rootMargin) for visibility gating.
4. Creates a `ResizeObserver` on the card element — queues measurement on size changes.

### Visibility gating

A per-window `Map<Window, IntersectionObserver>` (`visibilityObservers`) tracks which cards are in or near the viewport (100px margin). `getVisibilityObserver(win)` creates or reuses an observer for the card's owning window — popout windows need their own observer since `IntersectionObserver` is bound to its document's viewport. `cleanupVisibilityObserver()` supports targeted per-window cleanup. `queueCardSets()` skips cards not in `visibleCards`. On first resize, `visibleCards.add(cardEl)` is called immediately to ensure initial measurement.

### Queue system

Property sets are queued for measurement to prevent frame drops:

- **`setQueue: QueuedSet[]`** — FIFO queue of `{ set: HTMLElement, card: HTMLElement }`.
- **`queuedSets: Set<HTMLElement>`** — O(1) duplicate detection.
- **`MAX_QUEUE_SIZE = 500`** — queue overflow guard.
- **`SETS_PER_FRAME = 5`** — maximum sets processed per `requestAnimationFrame`.

`queueCardSets()` also checks a width cache (`WeakMap<HTMLElement, number>`) with 0.5px tolerance to skip redundant measurements when card width hasn't changed.

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

Both caches are cleared by `resetGapCache()` on theme/settings changes.

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

### First-render special handling

On first `ResizeObserver` callback, `isFirstResize` forces `visibleCards.add(cardEl)` so the card is immediately eligible for measurement — the `IntersectionObserver` may not have fired yet.

### Remeasurement

`remeasurePropertyFields(container)` clears all `.property-measured` states and CSS vars, then re-measures in chunks of `MEASUREMENT_CHUNK_SIZE = 5` per frame. Called when property label mode changes.

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
| `.content-hidden`     | Card         | Off-screen card with `content-visibility: hidden` (measurement skipped).     |

**Default unmeasured state**: `.property-pair .property { flex: 0 1 auto; max-width: 50% }` — each field can shrink but never exceeds half the pair width. Measurement replaces this with explicit widths.

**State transitions**: unmounted → default (`flex: 0 1 auto; max-width: 50%`) → `.property-measuring` → measure → `.property-measured` (CSS vars active). Compact mode bypasses measurement entirely.

**Collapsed pairs**: When one field has `.property-collapsed`, the visible partner expands (`max-width: 100%; flex: 1 1 auto`). When both are collapsed, the `.property-pair` wrapper gets `display: none`.

## Alignment modes

Controlled by the `rightPropertyPosition` view setting, which adds a class to the view container. **Bases-only**: `applyViewContainerStyles()` is called exclusively from Bases views. Datacore does not consume `rightPropertyPosition` — this is a known parity gap.

### Right (default)

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

### Column

Class: `dynamic-views-paired-property-column`.

- **Skips JS measurement entirely** — `measurePropertyFields()` returns early, `queueCardSets()` returns early.
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

### Batch processing after measurement

During queued measurement, gradient targets are collected into `gradientBatch[]` rather than updating immediately. The batch is flushed:

- **On queue drain**: After all sets are processed, a `requestAnimationFrame` processes the gradient batch, then dispatches `PROPERTY_MEASURED` event on each processed card's `ownerDocument` (not necessarily `window.document` — popout windows have their own `Document` instance). The event fires regardless of whether gradients were collected.
- **On early flush** (`MAX_GRADIENT_BATCH_SIZE = 100`): If the batch exceeds 100 entries mid-queue, a RAF flush runs but does not dispatch the event — processing continues and the terminal dispatch fires on queue drain.

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
- **Measurement still skipped**: `measureSideBySideSet()` returns early when card has `.compact-mode`. `queueCardSets()` also skips. CSS flex-wrap handles layout without JS measurement.
- **Left-aligned**: Compact-mode `.pair-right` content resets to `justify-content: flex-start` — right-alignment on stacked full-width properties would be visually inconsistent.

## Settings reference

> For the full settings resolution pipeline (three-layer merge, sparse storage, template system), see [settings-resolution.md](settings-resolution.md).

### View settings (Bases config / Datacore settings)

| Key                      | Type                            | Default                                            | Description                                        | Consumed by                                                                                                                |
| ------------------------ | ------------------------------- | -------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `propertyLabels`         | `'hide' \| 'inline' \| 'above'` | `'hide'` (ViewDefaults) / `'inline'` (Bases)       | Label display mode.                                | Both renderers, measurement (label width), CSS.                                                                            |
| `pairProperties`         | `boolean`                       | `false` (ViewDefaults + Bases) / `true` (Datacore) | Whether properties pair by default.                | Both renderers (pairing algorithm).                                                                                        |
| `rightPropertyPosition`  | `'left' \| 'column' \| 'right'` | `'right'`                                          | Right-side field alignment mode. Bases-only.       | `applyViewContainerStyles()` (Bases), [_properties.scss](../../styles/_properties.scss), measurement skip in `measurePropertyFields()`/`queueCardSets()`. |
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
| `dynamic-views-timestamp-icon`              | `class-select`    | edge     | Timestamp icon position. Options: `dynamic-views-timestamp-icon-{edge,left,center,right,hide}`.                                   |

## Invariants

1. **Measurement requires DOM attachment.** `processSetQueue()` checks `set.isConnected && card.isConnected` before calling `measureSideBySideSet()`. Measurement of disconnected elements produces zero widths.
2. **Column mode must not trigger JS measurement.** Both `measurePropertyFields()` and `queueCardSets()` check for `.dynamic-views-paired-property-column` and return early. Column mode relies on `flex: 1 1 0` CSS only.
3. **Compact mode must not trigger JS measurement.** Three guards: `queueCardSets()` skips at queue time, `processSetQueue()` checks each item before processing (catches cards that became compact between queueing and processing), and `measureSideBySideSet()` returns early. CSS forces `width: 100% !important`.
4. **Gradient batch must flush before `PROPERTY_MEASURED` fires.** The event is dispatched in the same RAF as gradient processing, after the batch is cleared. Masonry relayout handlers can rely on gradients being applied.
5. **Content-hidden cards must not be measured.** Reading dimensions on cards with `content-visibility: hidden` triggers Chromium console warnings and returns incorrect values. Both measurement and gradient code skip `.content-hidden` cards.
6. **Gap caches must be reset on theme change.** `resetGapCache()` clears `cachedFieldGap` and `cachedLabelGap`. Stale values produce incorrect width allocation after theme switches.
7. **`pendingFlush` prevents concurrent RAF batches.** While a gradient flush is in-flight, new queue processing is deferred (`!isProcessingSets && !pendingFlush` gate) to avoid interleaved read/write cycles.
8. **Width cache prevents redundant measurement.** `cardWidthCache` (WeakMap) stores last measured `clientWidth` per card. Measurements are skipped when width changes by less than 0.5px (`WIDTH_TOLERANCE`).
9. **Scroll position resets after measurement.** Both wrappers have `scrollLeft` reset to 0 after widths are applied, ensuring gradients start in the correct state.
10. **`property-measuring` is always removed.** The `finally` block in `measureSideBySideSet()` guarantees `property-measuring` is removed even if measurement throws.
