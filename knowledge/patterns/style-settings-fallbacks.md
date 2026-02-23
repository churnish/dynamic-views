---
title: Style Settings fallback selectors
description: Patterns for CSS defaults that work with or without the Style Settings plugin installed.
author: 🤖 Generated with Claude Code
last updated: 2026-02-21
---

# Style Settings fallback selectors

## Problem

The [Style Settings](https://github.com/mgmeyers/obsidian-style-settings) plugin reads `class-select` options from `_style-settings.scss` and adds the selected value as a body class (e.g., `body.dynamic-views-poster-theme-dark`). Without Style Settings installed, **no body class is added**, so CSS rules gated behind those classes silently fail.

## Fallback pattern

Use `:is()` with a `:not([class*="prefix-"])` arm to match both "class explicitly present" and "no class in this group":

```scss
body:is(
    .dynamic-views-poster-theme-dark,
    :not([class*="dynamic-views-poster-theme-"])
  )
  .dynamic-views
  .card.image-format-poster.poster-overlay
  .card-poster::after {
  /* dark tint is the default — fires with or without Style Settings */
}
```

For settings where the default means "no CSS override needed" (e.g., hover background = transparent), use the simpler `:not()` form since there's no explicit class to match:

```scss
body:not([class*="dynamic-views-card-background-hover-"])
  .dynamic-views
  .card.hover-intent-active:hover {
  background-color: transparent;
}
```

## Specificity

`:is()` takes the specificity of its most specific argument. Both `.dynamic-views-poster-theme-dark` (class = `0,1,0`) and `:not([class*="..."])` (attribute = `0,1,0`) have equal specificity. The fallback branch has the same weight as the explicit branch — no cascade surprises.

## When a fallback is NOT needed

- **Natural CSS baseline**: The default is the browser/theme default with no rule needed (e.g., "Faint" border color uses the base `--background-modifier-border` variable — no class-gated rule exists).
- **JS-driven defaults**: The JS code has its own fallback. Example: `getCoverHoverZoomMode()` returns `"card"` when no body class is present — the zoom behavior is controlled by JS adding `.cover-hover-active`, not by CSS matching a body class.
- **Unreachable without Style Settings**: If a setting group's parent requires a body class that only Style Settings sets, the child settings are unreachable without the plugin.

## When adding a new `class-select` setting

1. Check if the default option needs a CSS rule (or is the natural baseline).
2. If it needs a rule, add the `:is(.default-class, :not([class*="prefix-"]))` fallback.
3. If the setting is nested under a parent that requires Style Settings, skip the fallback.

## Current fallbacks (as of 82607e0)

| Setting                   | Default     | Fallback file                                      |
| ------------------------- | ----------- | -------------------------------------------------- |
| Poster overlay tint       | dark        | `_poster.scss`                                     |
| Cover background          | plain       | `_cover-placeholders.scss`, `_masonry-covers.scss` |
| Card border color (hover) | muted       | `_content.scss`                                    |
| Card background (hover)   | transparent | `_core.scss`                                       |
