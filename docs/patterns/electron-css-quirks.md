---
title: Electron CSS quirks
description: Blink/Electron CSS rendering quirks affecting selectors, text truncation, overflow clipping, and container queries.
author: 🤖 Generated with Claude Code
last updated: 2026-03-12
---
# Electron CSS quirks

## Nested `:has()` inside `:has()` is broken

**Discovered**: 2026-02-25 on Electron 39.5.

`:has()` containing another `:has()` — even through `:not()` — silently fails. The inner `:has()` is treated as invalid, and forgiving selector parsing discards that argument.

### What works

| Pattern                     | Example                            | Status |
| --------------------------- | ---------------------------------- | ------ |
| Simple `:has()`             | `.card-body:has(> .card-previews)` | Works  |
| `:not(:has())` at top level | `.property:not(:has(.label))`      | Works  |
| `:has(:is())`               | `.card-body:has(:is(.a, .b))`      | Works  |

### What breaks

| Pattern                  | Example                                      | Status |
| ------------------------ | -------------------------------------------- | ------ |
| `:has()` inside `:has()` | `:has(> .foo:not(:has(> .bar)))`             | Broken |
| Nested via `:not()`      | `:has(> .el:not(:has(> .child:only-child)))` | Broken |

### Workaround

Replace nested `:has()` with adjacent sibling combinator `+` plus a simple `:has()` override.

**Before** (broken):

```scss
.card-body:has(
    > .card-previews:not(:has(> .card-thumbnail-placeholder:only-child))
  )
  > .card-properties-bottom {
  padding-top: var(--size-4-2);
}
```

**After** (working):

```scss
// Positive match via adjacent sibling — no :has() needed
.card-body > .card-previews + .card-properties-bottom {
  padding-top: var(--size-4-2);
}

// Override for the excluded case — simple :has(), not nested
.card-body
  > .card-previews:has(> .card-thumbnail-placeholder:only-child)
  + .card-properties-bottom {
  padding-top: 0;
}
```

### Files affected by this fix

- [styles/_grid-view.scss](../../styles/_grid-view.scss) — Grid properties-bottom spacing
- [styles/_masonry-view.scss](../../styles/_masonry-view.scss) — Masonry properties-bottom spacing (both cover-bottom and non-cover variants)

## `-webkit-line-clamp` preserves trailing whitespace

`-webkit-line-clamp` preserves trailing whitespace at the truncation point before appending its ellipsis. When a word boundary falls at the truncation point (common, since `word-break: break-word` prefers word boundaries), the result is `word …` instead of `word…`.

The `-webkit-` prefix is historical (Blink forked from WebKit in 2013 and kept all prefixed properties). No CSS-only fix exists — `-webkit-line-clamp` offers zero control over its ellipsis behavior, and `text-overflow` only applies to single-line truncation.

### JS fix considered and rejected

A binary-search approach was prototyped and confirmed working:

1. Detect clamped overflow via `scrollHeight > clientHeight`
2. Binary search for max text prefix where `prefix + "…"` fits within clamped height
3. `trimEnd()` the prefix, set `textContent = trimmed + "…"`

**Rejected because the tradeoffs outweigh the cosmetic benefit:**

- ~10 forced layout reflows per card (setting `textContent` then reading `scrollHeight` in a loop)
- Reimplements browser truncation in JS — fights the platform instead of using it
- In Datacore (Preact), mutates DOM that the framework owns
- Doesn't survive container resize without re-render

### Affected file

- [styles/card/_previews.scss](../../styles/card/_previews.scss) — `.card-text-preview` uses `-webkit-line-clamp: var(--dynamic-views-text-preview-lines, 5)`

## Stuck `:hover` after drag

**Discovered**: 2026-03-03 on Electron 39.5.

After a drag operation ends, Chromium does **not** re-hit-test the element under the pointer. The dragged element retains `:hover` state until the next mouse move event. This causes visible artifacts when hover styles include transitions — e.g., a card background-color transition animates back over ~1s after drop.

This is a longstanding Chromium behavior, not Electron-specific.

### Mitigation

Gate visible hover effects behind a JS-managed class rather than pure `:hover`. Dynamic Views uses `hover-intent-active` (set by [hover-intent.ts](../../src/shared/hover-intent.ts) on mousemove-after-mouseenter, removed on mouseleave/dragend). CSS hover styles are scoped to `.hover-intent-active:hover`, so the stuck `:hover` has no visual effect because the class is removed in `dragend`.

```scss
// Wrong: visible artifact from stuck :hover
.card:hover {
  background: var(--hover-bg);
}

// Right: class is removed in dragend, so stuck :hover is invisible
.card.hover-intent-active:hover {
  background: var(--hover-bg);
}
```

### Files

- [src/shared/hover-intent.ts](../../src/shared/hover-intent.ts) — `hover-intent-active` class management
- [styles/_hover-states.scss](../../styles/_hover-states.scss) — All card hover styles gated by `.hover-intent-active:hover`

## `overflow-clip-margin` ignored with per-axis `overflow-y: clip`

**Discovered**: 2026-03-05 on Electron 39.5.

`overflow-clip-margin` only takes effect when using the `overflow` shorthand (`overflow: clip`). When `overflow-y: clip` is set independently (e.g., `overflow-x: visible; overflow-y: clip`), the clip margin is silently ignored.

### Impact

Masonry's container used `overflow-x: visible; overflow-y: clip` so that cards could extend horizontally (e.g., sticky header borders with negative margins) while clipping vertical scroll overflow. Adding hover transforms (scale, translate) on edge-row cards caused them to be clipped at the container boundary because the clip margin wasn't applied.

### Fix

Switch to the shorthand `overflow: clip` + `overflow-clip-margin: <value>`. The clip margin then applies to both axes uniformly, accommodating both vertical hover transforms and horizontal negative-margin extensions.

```scss
// Broken: clip margin ignored
.masonry-container {
  overflow-x: visible;
  overflow-y: clip;
  overflow-clip-margin: var(--bases-view-padding); // silently ignored
}

// Working: shorthand enables clip margin
.masonry-container {
  overflow: clip;
  overflow-clip-margin: var(--bases-view-padding); // applied to both axes
}
```

### Affected file

- [styles/_masonry-view.scss](../../styles/_masonry-view.scss) — `.dynamic-views-masonry` overflow and clip margin

## `@container scroll-state(stuck)` cannot style the container element

**Discovered**: 2026-03-08 on Electron 39.5.

CSS `@container scroll-state(stuck: top)` container queries can only style **descendants** of the container element, not the container itself. This is per spec — the container query matches on the container, but only descendant selectors inside the `@container` block are valid targets.

### Impact

Sticky group headings need elevated `z-index` when stuck (to paint above hovered cards with `z-index: 11`). A pure CSS approach using `container-type: scroll-state` on the heading and `@container scroll-state(stuck: top)` to set `z-index: 20` on child elements (`.bases-group-collapse-region`, `.bases-group-count`) was attempted. However, child `z-index` inside a flex container creates per-child stacking contexts — these cannot compete with cards in the parent grid stacking context. Only `z-index` on the heading element itself works, which `@container` cannot target.

### Fix

JS `IntersectionObserver` + zero-height sentinel approach. A sentinel div at each group section's top is observed — when it exits the scroll viewport upward, the heading is stuck. The observer toggles a `stuck` class on the heading, which carries `z-index: 20`. The `@container scroll-state(stuck: top)` rule is retained for the bottom border (progressive enhancement on descendant `::after`).

### Files

- [src/bases/sticky-heading.ts](../../src/bases/sticky-heading.ts) — Sentinel IO observer
- [styles/_grid-masonry-shared.scss](../../styles/_grid-masonry-shared.scss) — `.stuck` z-index rule, sentinel CSS, `@container` border rule

## `-webkit-line-clamp` ignores block margins

**Discovered**: 2026-03-09 on Electron 39.5.

`-webkit-line-clamp` counts only text lines — block-level margins between elements (e.g., `<p>` with `margin-top`) do not consume any line budget. A container with `-webkit-line-clamp: 4` and six `<p>` children separated by `1lh` margins shows 4 lines of text plus all inter-paragraph margins, not 4 "visual lines" including margins.

No CSS-only mechanism exists to make `-webkit-line-clamp` count block margins as lines. The unprefixed `line-clamp: auto` with `max-height` is the future spec answer, but CSSWG reverted the dual-clamping resolution in January 2026 due to 4% page-load compatibility impact.

Related findings:

- **`<br>` elements behave identically** — they produce the same result as `\n` with `white-space: pre-line`. Neither consumes a clamp line.
- **`gap` is not an alternative** — `gap` does not work on `display: -webkit-box` (legacy flexbox). Only modern `flex`/`grid` support it.

### Workaround

JS per-paragraph clamping: measure each `<p>` height against a line budget, hide overflow paragraphs with `display: none`, and apply `-webkit-line-clamp` only to the last visible paragraph. See `applyClampFromMeasurements` in [text-preview-dom.ts](../../src/shared/text-preview-dom.ts).

### Affected files

- [src/shared/text-preview-dom.ts](../../src/shared/text-preview-dom.ts) — JS per-paragraph clamp algorithm
- [styles/card/_previews.scss](../../styles/card/_previews.scss) — `:has(> p)` dual-path: native clamp for single-block text, `display: block` for multi-paragraph

## `display: -webkit-box` computes as `flow-root`

**Discovered**: 2026-03-09 on Chrome 142 (Electron 36).

`display: -webkit-box` computes to `flow-root` in Chrome 142+. Despite the different computed value, `-webkit-line-clamp` still functions correctly — the truncation and ellipsis behavior is unchanged. This is a DevTools display quirk, not a functional regression.
