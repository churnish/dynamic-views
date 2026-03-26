---
title: Style Settings fallback selectors
description: Patterns for CSS defaults that work with or without the Style Settings plugin installed.
author: 🤖 Generated with Claude Code
updated: 2026-03-25
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

## `class-select` — `:not()` exclusion (CSS)

When the default mode has CSS rules that other modes must override, use `:not()` to exclude the other modes instead of requiring a body class for the default:

```scss
/* Extension mode is the default — fires when no other mode is active */
body:not(
    .dynamic-views-file-type-flair,
    .dynamic-views-file-type-icon,
    .dynamic-views-file-type-none
  )
  .dynamic-views
  .card-title {
  /* extension-specific overrides */
}
```

This eliminates the need for a body class on the default mode entirely. The plugin JS never adds the default class — Style Settings manages the non-default classes, and the CSS baseline handles the rest.

This pattern also avoids the `initClasses` race: Style Settings' `initClasses` adds the `@settings` `default:` class to body, then applies the stored value without removing the default. Both classes coexist. By not depending on a body class for the default mode, the race is structurally impossible.

Prefer `:not()` exclusion over `:is()` + `:not([class*="..."])` when the default mode needs CSS overrides and all non-default modes are known. Use the `:is()` pattern when the default has a named class that Style Settings explicitly manages.

## When adding a new `class-select` setting

1. Check if the default option needs a CSS rule (or is the natural baseline).
2. If the default needs a rule AND all non-default options are known, use the `:not()` exclusion pattern — no body class for the default.
3. If the default needs a rule but non-default options may be added later, use the `:is(.default-class, :not([class*="prefix-"]))` fallback.
4. If the setting is nested under a parent that requires Style Settings, skip the fallback.

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

## Body-level variable + attribute selector gate

When multiple `class-select` presets all resolve to a single CSS variable consumed by one rule, use a `[class*=...]` attribute selector gate to prevent IACVT (invalid at computed value time) when no preset class is present.

**Problem**: Some body classes are JS-managed (e.g., `dynamic-views-open-on-title`) and always present regardless of Style Settings installation. If a consumption rule matches via the JS class but the color preset variable is undefined (no Style Settings), `var(--undefined)` triggers IACVT — the property becomes `inherit`, overriding lower-specificity rules.

**Solution**: Add `[class*='dynamic-views-{setting-prefix}-']` to the consumption rule. This only matches when at least one preset class from that setting group exists on body:

```scss
/* Gate: rule only fires when a title-color preset is active */
body:is(
    .dynamic-views-open-on-title,
    .dynamic-views-poster-reveal-press.dynamic-views-open-on-card
  ):is(
    [class*='dynamic-views-title-color-'],
    [class*='dynamic-views-title-hover-color-']
  )
  .dynamic-views
  .card.hover-intent-active
  .card-title
  a:hover {
  color: var(
    --dynamic-views-title-hover-color-value,
    var(--dynamic-views-title-color-hover-color)
  );
}
```

The body-level variable assignments (`hover-color-vars` mixin in [_property-colors.scss](../../styles/_property-colors.scss)) have zero hover-path cost — they only re-evaluate when body classes change (rare Style Settings events). The consumption rules in [_hover-states.scss](../../styles/_hover-states.scss) are the only card-level rules evaluated during hover recalculations.

**Specificity**: `[class*='...']` has the same specificity as a class selector (0,1,0), so the gate adds specificity equivalent to the per-variant body class it replaces.

**When to use**: Color preset consolidation where N body-class variants all set the same CSS variable, consumed by one rule. NOT needed when the consumption rule's other selectors already require a Style Settings class (no JS-managed classes in the chain).

## Avoid re-renders from Style Settings changes

Re-renders from Style Settings changes are disruptive — they reset scroll position. Only add settings to `getStyleSettingsHash()` when they genuinely affect rendered card content (text, icons, layout). Do NOT add settings that only affect:

- **CSS-only toggles** (hover zoom, poster mode, cursor) — body class changes are picked up by CSS automatically.
- **JS event listener targets** — design listeners to work without rebinding. Example: `setupHoverZoomEligibility` always listens on `cardEl`.

## Current fallbacks

### `class-select` (CSS)

| Setting                   | Default        | Fallback file                                                    |
| ------------------------- | -------------- | ---------------------------------------------------------------- |
| Poster overlay tint       | dark           | [_poster.scss](../../styles/card/_poster.scss)                                                   |
| Cover background          | dimmed         | [_cover-placeholders.scss](../../styles/card/_cover-placeholders.scss), [_cover-elements.scss](../../styles/card/_cover-elements.scss)               |
| Poster background         | dimmed         | [_poster.scss](../../styles/card/_poster.scss)                                                   |
| Show cover placeholder    | Grid           | [_cover-side.scss](../../styles/card/_cover-side.scss), [_cover-placeholders.scss](../../styles/card/_cover-placeholders.scss)                   |
| Card border color (hover) | muted          | [_core.scss](../../styles/card/_core.scss)                                                     |
| Card background (hover)   | transparent    | [_hover-states.scss](../../styles/_hover-states.scss)                                             |
| Card shadow color         | Default        | No CSS fallback needed — Default passes theme shadow vars through unchanged |
| File format indicator    | Extension      | [_header.scss](../../styles/card/_header.scss) — `:not()` exclusion pattern (no body class for default)  |
| Omit first line           | ifMatchesTitle | No CSS fallback needed — JS default via `getOmitFirstLineMode()` |

Note: "Show cover placeholder" uses the fallback only in Grid sections. Masonry sections intentionally omit the `:not()` arm because Masonry's default is "no placeholders" — the natural CSS baseline (no rule needed).

### Body-level variable + `[class*=...]` gate

| Setting group | Gate selector | Variable | Consumption file |
| --- | --- | --- | --- |
| Title color (hover, open-on-title) | `[class*='dynamic-views-title-color-']`, `[class*='dynamic-views-title-hover-color-']` | `--dynamic-views-title-color-hover-color`, `--dynamic-views-title-hover-color-value` | [_hover-states.scss](../../styles/_hover-states.scss) |
| Title color (hover, open-on-card) | `[class*='dynamic-views-title-hover-color-']` | `--dynamic-views-title-hover-color-value` | [_hover-states.scss](../../styles/_hover-states.scss) |
| Subtitle color (hover) | `[class*='dynamic-views-subtitle-color-']` | `--dynamic-views-subtitle-color-hover-color` | [_hover-states.scss](../../styles/_hover-states.scss) |
| Property color with labels (hover) | `[class*='dynamic-views-property-color-with-labels-']` | `--dynamic-views-property-with-label-color-hover-color` | [_hover-states.scss](../../styles/_hover-states.scss) |
| Property color without labels (hover) | `[class*='dynamic-views-property-color-without-labels-']` | `--dynamic-views-property-no-label-color-hover-color` | [_hover-states.scss](../../styles/_hover-states.scss) |

### `class-toggle` — inverted (CSS)

| Setting                  | Toggle class                                    | Fallback file        |
| ------------------------ | ----------------------------------------------- | -------------------- |
| Do not lift (card hover) | `dynamic-views-card-hover-disable-elevate`      | [_hover-states.scss](../../styles/_hover-states.scss) |
| Poster reveal zoom       | `dynamic-views-poster-disable-reveal-zoom`      | [_poster.scss](../../styles/card/_poster.scss)       |
| Image viewer fullscreen  | `dynamic-views-image-viewer-disable-fullscreen` | [_image-viewer.scss](../../styles/_image-viewer.scss) |
| Cover hover zoom         | `dynamic-views-cover-disable-hover-zoom`        | [_cover-elements.scss](../../styles/card/_cover-elements.scss) |

### `class-toggle` — `.css-settings-manager` gate (CSS)

| Setting          | Toggle class                     | Fallback file   |
| ---------------- | -------------------------------- | --------------- |
| Hide pin toolbar | `dynamic-views-hide-pin-toolbar` | [_toolbar.scss](../../styles/datacore/_toolbar.scss) |

### `variable-number-slider` (CSS)

All `variable-number-slider` settings use the native `var()` fallback pattern. The fallback value must match the `default:` in [_style-settings.scss](../../styles/_style-settings.scss). Examples: `var(--dynamic-views-card-border-thickness, 1px)`, `var(--dynamic-views-card-padding, 8px)`.
