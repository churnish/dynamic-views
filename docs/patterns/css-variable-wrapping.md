---
title: CSS variable wrapping
description: Plugin-namespaced CSS variable wrappers, resolution semantics, and the local override gotcha.
author: 🤖 Generated with Claude Code
last updated: 2026-03-14
---
# CSS variable wrapping

All external Obsidian CSS variables are read through plugin-namespaced wrappers defined in `_variables.scss`. ~65 wrappers follow the pattern:

```scss
body {
  --dynamic-views-text-normal: var(--text-normal, #222222);
}
```

Obsidian defines all CSS variables on `body` (`.theme-dark`/`.theme-light`), not `:root`. Wrappers live on `body` so `var()` references resolve against the correct element. Usage sites reference `var(--dynamic-views-text-normal)` instead of bare `var(--text-normal)`. This provides:

- **Consistent fallbacks**: Each external var has a single fallback value (Obsidian default light theme), declared once.
- **Namespace isolation**: Grepping `--dynamic-views-` shows all plugin-owned references. Bare external vars only appear in `_variables.scss` wrappers.

## Exempt variables

Plugin-internal variables are NOT wrapped — they're defined by the plugin itself:

- Layout: `--card-bg`, `--field1-width`, `--field2-width`, `--cover-inner-radius`, `--cover-non-edge-radius`, `--side-cover-*`, `--masonry-height`, `--masonry-reposition-duration`
- Interaction: `--hover-scale-*`, `--cover-inset-*`
- Structure: `--card-border-*`, `--poster-inset`, `--backdrop-inset`, `--tag-text-color`

`--size-*` variables (Obsidian spacing tokens) are also exempt per AGENTS.md — they're used without fallbacks or wrappers.

## Resolution gotcha: local overrides don't propagate

CSS spec §2.2: "The computed value of a custom property is the specified value with any `var()` functions substituted." Substitution happens at the element where the custom property is **defined**, not where it's consumed.

```scss
// Wrapper defined on body — var(--text-normal) resolves to #222222 HERE
body {
  --dynamic-views-text-normal: var(--text-normal, #222222);
}

// Local override on a card — does NOT affect --dynamic-views-text-normal
.card.image-format-poster {
  --text-normal: #fafafa;  // Only affects bare var(--text-normal) on this element
}
```

The wrapper `--dynamic-views-text-normal` was computed on `body` and the resolved value (`#222222` or whatever `--text-normal` is on `body`) is inherited down. The local `--text-normal: #fafafa` override on the card does NOT cause the wrapper to re-resolve.

### Fix: redefine wrappers at override sites

Wherever bare `--text-*` overrides are set (poster text, backdrop text), also set the `--dynamic-views-text-*` wrappers:

```scss
// Backdrop dark overlay — light text
body.dynamic-views-backdrop-theme-dark .dynamic-views .card.image-format-backdrop:has(.card-backdrop) {
  --text-normal: #fafafa;
  --text-muted: #f5f5f5;
  --text-faint: color-mix(in srgb, #f5f5f5 60%, transparent);
  // Must also set wrappers — they won't pick up the bare overrides above
  --dynamic-views-text-normal: #fafafa;
  --dynamic-views-text-muted: #f5f5f5;
  --dynamic-views-text-faint: color-mix(in srgb, #f5f5f5 60%, transparent);
}
```

### Override sites

Six sites currently redefine both bare and wrapped variables:

- `_poster.scss` — gradient overlay (dark text), gradient overlay (light text), full overlay (dark text)
- `_backdrop.scss` — dark overlay (light text), light overlay (dark text)
- `_grid-masonry-shared.scss` — `--bases-view-padding` on plugin view types (Obsidian sets this on `.workspace-leaf-content`, not `body`, so the `body`-level wrapper resolves to the fallback; the redefinition on `.bases-view[data-view-type]` provides the correct inherited value)

## When adding a new wrapper

1. Define `--dynamic-views-foo: var(--foo, <default-theme-value>)` in `_variables.scss` `body` block.
2. Replace all bare `var(--foo)` references across SCSS with `var(--dynamic-views-foo)`.
3. If any SCSS rule locally overrides `--foo` (e.g., text color overrides on poster/backdrop), also set `--dynamic-views-foo` at that same site.
