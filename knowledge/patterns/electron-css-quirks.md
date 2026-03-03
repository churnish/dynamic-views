---
title: Electron CSS quirks
description: Blink/Electron CSS rendering quirks affecting selectors and text truncation.
author: 🤖 Generated with Claude Code
last updated: 2026-03-04
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

- `styles/_grid-view.scss` — Grid properties-bottom spacing
- `styles/_masonry-view.scss` — Masonry properties-bottom spacing (both cover-bottom and non-cover variants)

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

- `styles/card/_previews.scss` — `.card-text-preview` uses `-webkit-line-clamp: var(--dynamic-views-text-preview-lines, 5)`

## Stuck `:hover` after drag

**Discovered**: 2026-03-03 on Electron 39.5.

After a drag operation ends, Chromium does **not** re-hit-test the element under the pointer. The dragged element retains `:hover` state until the next mouse move event. This causes visible artifacts when hover styles include transitions — e.g., a card background-color transition animates back over ~1s after drop.

This is a longstanding Chromium behavior, not Electron-specific.

### Mitigation

Gate visible hover effects behind a JS-managed class rather than pure `:hover`. Dynamic Views uses `hover-intent-active` (set by `hover-intent.ts` on mousemove-after-mouseenter, removed on mouseleave/dragend). CSS hover styles are scoped to `.hover-intent-active:hover`, so the stuck `:hover` has no visual effect because the class is removed in `dragend`.

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

- `src/shared/hover-intent.ts` — `hover-intent-active` class management
- `styles/_hover-states.scss` — All card hover styles gated by `.hover-intent-active:hover`
