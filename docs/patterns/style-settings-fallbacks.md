---
title: Style Settings fallback selectors
description: Patterns for CSS defaults that work with or without the Style Settings plugin installed.
author: 🤖 Generated with Claude Code
last updated: 2026-03-14
---
# Style Settings fallback selectors

## Problem

The [Style Settings](https://github.com/mgmeyers/obsidian-style-settings) plugin reads `class-select` options from [_style-settings.scss](../../styles/_style-settings.scss) and adds the selected value as a body class (e.g., `body.dynamic-views-poster-theme-dark`). Without Style Settings installed, **no body class is added**, so CSS rules gated behind those classes silently fail.

## Fallback pattern

Use `:is()` with a `:not([class*="prefix-"])` arm to match both "class explicitly present" and "no class in this group":

```scss
body:is(
    .dynamic-views-poster-theme-dark,
    :not([class*='dynamic-views-poster-theme-'])
  )
  .dynamic-views.poster-mode-overlay
  .card.image-format-poster
  .card-poster::after {
  /* dark tint is the default — fires with or without Style Settings */
}
```

For settings where the default means "no CSS override needed" (e.g., hover background = transparent), use the simpler `:not()` form since there's no explicit class to match:

```scss
body:not([class*='dynamic-views-card-background-hover-'])
  .dynamic-views
  .card.hover-intent-active:hover {
  background-color: transparent;
}
```

## Specificity

`:is()` takes the specificity of its most specific argument. Both `.dynamic-views-poster-theme-dark` (class = `0,1,0`) and `:not([class*="..."])` (attribute = `0,1,0`) have equal specificity. The fallback branch has the same weight as the explicit branch — no cascade surprises.

## When a fallback is NOT needed

- **Natural CSS baseline**: The default is the browser/theme default with no rule needed (e.g., "Faint" border color uses the base `--background-modifier-border` variable — no class-gated rule exists).
- **JS-driven defaults**: The JS code has its own fallback. Example: `getTagStyle()` returns `"outline"` when no body class matches — tag rendering uses the JS return value, not CSS body class gating.
- **Unreachable without Style Settings**: If a setting group's parent requires a body class that only Style Settings sets, the child settings are unreachable without the plugin.

## When adding a new `class-select` setting

1. Check if the default option needs a CSS rule (or is the natural baseline).
2. If it needs a rule, add the `:is(.default-class, :not([class*="prefix-"]))` fallback.
3. If the setting is nested under a parent that requires Style Settings, skip the fallback.

## `class-toggle` fallback — inverted toggle (CSS)

For toggles where the default is ON, invert the toggle name so that **absence of class = feature enabled** (the correct default). The toggle becomes a "disable" switch:

```yaml
# Before (broken without Style Settings)
id: dynamic-views-poster-hover-zoom
type: class-toggle
default: true

# After (works without Style Settings)
id: dynamic-views-poster-disable-reveal-zoom
type: class-toggle
```

In CSS, replace positive match with `:not()`:

```scss
/* Before */
body.dynamic-views-poster-hover-zoom .dynamic-views ... {
}

/* After — absence of class = enabled */
body:not(.dynamic-views-poster-disable-reveal-zoom) .dynamic-views ... {
}
```

In JS, invert the check:

```typescript
// Before
const isFullscreen = body.classList.contains(
  'dynamic-views-image-viewer-fullscreen'
);
// After
const isFullscreen = !body.classList.contains(
  'dynamic-views-image-viewer-disable-fullscreen'
);
```

### When adding a new `class-toggle` with default ON

1. Name the toggle as a "disable" switch (e.g., `disable-feature` instead of `feature`).
2. Use `:not(.disable-class)` in CSS to match "enabled" state.
3. Invert any JS `classList.contains()` checks.

## `class-toggle` fallback — `.css-settings-manager` gate (CSS)

For toggles where the default is ON but inversion is impractical (e.g., the toggle hides a UI element and cannot be reframed as "show"), gate the CSS behind `.css-settings-manager` (the `<style>` element Style Settings creates):

```scss
/* Show pin button only when user explicitly unchecks the toggle.
   .css-settings-manager = Style Settings active, so :not() means toggle is OFF. */
body.css-settings-manager:not(.dynamic-views-hide-pin-toolbar)
  .dynamic-views
  .pin-btn {
  display: flex !important;
}
```

Without Style Settings, `.css-settings-manager` is absent, so the entire rule is inert — the element stays hidden by default.

## `variable-number-slider` fallback (CSS)

Style Settings `variable-number-slider` sets a CSS custom property (e.g., `--dynamic-views-card-border-thickness`) via the `.css-settings-manager` `<style>` element. Without Style Settings installed — or before the user changes the slider — the variable is undefined. Use the native CSS `var()` fallback:

```scss
/* 1px fallback used when Style Settings is not installed */
--card-border-thickness-fixed: var(--dynamic-views-card-border-thickness, 1px);
```

The `default:` field in the `@settings` YAML only controls the slider's initial UI position — it does NOT set the CSS variable.

### When adding a new `variable-number-slider` setting

1. Every consumer of the variable MUST include a fallback value matching the `default:` in `@settings`.
2. If multiple consumers read the same variable, resolve it once into a local variable with the fallback, then reference the local variable downstream.

## Avoid re-renders from Style Settings changes

Re-renders from Style Settings changes are disruptive — they reset scroll position. Only add settings to `getStyleSettingsHash()` when they genuinely affect rendered card content (text, icons, layout). Do NOT add settings that only affect:

- **CSS-only toggles** (hover zoom, poster mode, cursor) — body class changes are picked up by CSS automatically.
- **JS event listener targets** (e.g., cover hover zoom mode) — design listeners to work without rebinding. Example: `setupHoverZoomEligibility` always listens on `cardEl`; the mode-dependent `cover-hover-active` class (from `setupHoverIntent`) gates activation in CSS.

## Current fallbacks

### `class-select` (CSS)

| Setting                   | Default        | Fallback file                                                    |
| ------------------------- | -------------- | ---------------------------------------------------------------- |
| Poster overlay tint       | dark           | [_poster.scss](../../styles/card/_poster.scss)                                                   |
| Cover background          | dimmed         | [_cover-placeholders.scss](../../styles/card/_cover-placeholders.scss), [_cover-elements.scss](../../styles/card/_cover-elements.scss)               |
| Poster background         | dimmed         | [_poster.scss](../../styles/card/_poster.scss)                                                   |
| Cover hover zoom          | card           | [_cover-elements.scss](../../styles/card/_cover-elements.scss)                                           |
| Show cover placeholder    | Grid           | [_cover-side.scss](../../styles/card/_cover-side.scss), [_cover-placeholders.scss](../../styles/card/_cover-placeholders.scss)                   |
| Card border color (hover) | muted          | [_core.scss](../../styles/card/_core.scss)                                                     |
| Card background (hover)   | transparent    | [_hover-states.scss](../../styles/_hover-states.scss)                                             |
| Omit first line           | ifMatchesTitle | No CSS fallback needed — JS default via `getOmitFirstLineMode()` |

Note: "Show cover placeholder" uses the fallback only in Grid sections. Masonry sections intentionally omit the `:not()` arm because Masonry's default is "no placeholders" — the natural CSS baseline (no rule needed).

### `class-toggle` — inverted (CSS)

| Setting                  | Toggle class                                    | Fallback file        |
| ------------------------ | ----------------------------------------------- | -------------------- |
| Do not lift (card hover) | `dynamic-views-card-hover-disable-elevate`      | [_hover-states.scss](../../styles/_hover-states.scss) |
| Poster reveal zoom       | `dynamic-views-poster-disable-reveal-zoom`      | [_poster.scss](../../styles/card/_poster.scss)       |
| Image viewer fullscreen  | `dynamic-views-image-viewer-disable-fullscreen` | [_image-viewer.scss](../../styles/_image-viewer.scss) |

### `class-toggle` — `.css-settings-manager` gate (CSS)

| Setting          | Toggle class                     | Fallback file   |
| ---------------- | -------------------------------- | --------------- |
| Hide pin toolbar | `dynamic-views-hide-pin-toolbar` | [_toolbar.scss](../../styles/datacore/_toolbar.scss) |

### `variable-number-slider` (CSS)

All `variable-number-slider` settings use the native `var()` fallback pattern. The fallback value must match the `default:` in [_style-settings.scss](../../styles/_style-settings.scss). Examples: `var(--dynamic-views-card-border-thickness, 1px)`, `var(--dynamic-views-card-padding, 8px)`.
