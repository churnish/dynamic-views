---
title: Style Settings fallback selectors
description: Patterns for CSS defaults that work with or without the Style Settings plugin installed.
author: 🤖 Generated with Claude Code
updated: 2026-08-14
---
# Style Settings fallback selectors

## Problem

The [Style Settings](https://github.com/mgmeyers/obsidian-style-settings) plugin reads `class-select` options from [_style-settings.scss](../../styles/_style-settings.scss) and adds the selected value as a body class (e.g., `body.dynamic-views-poster-color-scheme-dark`). Without Style Settings installed, **no body class is added**, so CSS rules gated behind those classes silently fail.

## Fallback pattern

Use `:is()` with a `:not([class*="prefix-"])` arm to match both "class explicitly present" and "no class in this group":

```scss
body:is(
    .dynamic-views-poster-color-scheme-dark,
    :not([class*='dynamic-views-poster-color-scheme-'])
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
  .card.interact {
  background-color: transparent;
}
```

## Specificity

`:is()` takes the specificity of its most specific argument. Both `.dynamic-views-poster-color-scheme-dark` (class = `0,1,0`) and `:not([class*="..."])` (attribute = `0,1,0`) have equal specificity. The fallback branch has the same weight as the explicit branch — no cascade surprises.

## When a fallback is NOT needed

- **Natural CSS baseline**: The default is the browser/theme default with no rule needed (e.g., "Faint" border color uses the base `--background-modifier-border` variable — no class-gated rule exists).
- **JS-driven defaults**: The JS code has its own fallback, so the default holds with no body class present. Example: `getOmitFirstLineMode()` returns `"ifMatchesTitle"` when no class matches, and that value is passed into text preview extraction. This only counts where the returned value genuinely reaches rendering — tag appearance, by contrast, is entirely CSS-driven in [_tags.scss](../../styles/_tags.scss), where `:not()` exclusion on the non-default modes makes Outline fire with or without Style Settings. No JS reads the tag style at all.
- **Unreachable without Style Settings**: If a setting group's parent requires a body class that only Style Settings sets, the child settings are unreachable without the plugin.

## `class-select` — `:not()` exclusion (CSS)

When the default mode has CSS rules that other modes must override, use `:not()` to exclude the other modes instead of requiring a body class for the default:

```scss
/* Grid is the default — fires when neither masonry-only nor disabled */
body:not(
    .dynamic-views-fixed-cover-height-masonry,
    .dynamic-views-fixed-cover-height-none
  )
  .dynamic-views-grid
  .card-cover-wrapper {
  /* grid-default overrides */
}
```

This eliminates the need for a body class on the default mode entirely. The plugin JS never adds the default class — Style Settings manages the non-default classes, and the CSS baseline handles the rest.

Style Settings v1.0.9 `initClasses()` adds exactly one class per `class-select` — the stored value, else the `@settings` `default:`, else none. There is no window where two classes from the same group coexist. The `:not()` exclusion is still preferred, but on its own merits (works without Style Settings installed, no default class to manage), not as a race workaround.

Prefer `:not()` exclusion over `:is()` + `:not([class*="..."])` when the default mode needs CSS overrides and all non-default modes are known. Use the `:is()` pattern when the default has a named class that Style Settings explicitly manages.

### JS must mirror the CSS exclusion logic

When JS code checks whether a `:not()` exclusion default is active, it MUST use the same inverted check — NOT a positive match on the default class:

```typescript
// ✅ Correct — mirrors CSS :not(-masonry, -none) exclusion
const isFixedHeightActive =
  !body.classList.contains(FIXED_COVER_HEIGHT_MASONRY) &&
  !body.classList.contains(FIXED_COVER_HEIGHT_NONE);

// ❌ Wrong — positive check fails when no body class is present
const isFixedHeightActive =
  body.classList.contains(FIXED_COVER_HEIGHT_GRID) ||
  body.classList.contains(FIXED_COVER_HEIGHT_BOTH);
```

The positive check returns `false` when Style Settings is absent (no body class), causing JS to take the "off" path while CSS takes the "on" path — a silent disagreement. The inverted check returns `true` for the same state, matching CSS.

## `class-select` — never reuse a `variable-text` id

When converting a `variable-text` setting to a `class-select`, the `class-select` MUST get a **fresh id**. Style Settings' `initClasses()` calls `body.classList.add(storedValue)` for every `class-select` id it finds in its stored config. If a user previously stored a text value under that id (e.g., `0.9em`), `classList.add('0.9em')` throws `InvalidCharacterError` — which aborts `initClasses()` and breaks class initialization for **every** Style Settings option, not just the converted one.

Allocating a new id sidesteps this: `setConfig()` deletes orphaned stored settings on load, so the old text value is discarded without migration code. The trade-off is that the user's old custom value is lost — mention it in the release notes.

Example: `dynamic-views-title-font-size` (`variable-text`) was retired and replaced by `dynamic-views-title-size` (`class-select`) plus `dynamic-views-title-size-custom` (`variable-text`).

## `class-select` — `allowEmpty` gotcha

`allowEmpty: true` adds a visible blank dropdown entry with internal value `"none"`. There is no way to label it or hide it. Avoid `allowEmpty: true` when the default needs a visible name — use `allowEmpty: false` with an explicit default option instead, matching the pattern used by all other `class-select` settings in the plugin.

YAML `default: none` (lowercase) is parsed as null by the YAML parser, breaking the setting entirely (makes it invisible in Style Settings). Use `default: None` (capitalized) if `allowEmpty: true` is unavoidable.

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
  'dynamic-views-image-viewer-constrain-to-pane'
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

### Prefer the slider over `variable-number`

Style Settings renders `variable-number` as a bare `<input type="text">` — no `min`, `max`, `step` or `inputMode`, and nothing rejects letters. `variable-number-slider` renders `<input type="range">`, which enforces the numeric range.

- **Use the slider for every numeric option.** `variable-number` only makes sense where arbitrary text is genuinely acceptable.
- **Read defensively anyway.** A text-typed value, a unit suffix, or a value stored before the type changed can all reach the consumer. Parse with `parseFloat` and fall back to the documented default rather than trusting the field.
- **Out-of-range stored values survive a type change.** The slider clamps what it *displays*, but the emitted CSS variable keeps the old value until the user moves the control.

## Body-level variable + attribute selector gate

When multiple `class-select` presets all resolve to a single CSS variable consumed by one rule, use a `[class*=...]` attribute selector gate to prevent IACVT (invalid at computed value time) when no preset class is present.

**Problem**: Some body classes are JS-managed (e.g., `dynamic-views-open-on-title`) and always present regardless of Style Settings installation. If a consumption rule matches via the JS class but the color preset variable is undefined (no Style Settings), `var(--undefined)` triggers IACVT — the property becomes `inherit`, overriding lower-specificity rules.

**Solution**: Add `[class*='dynamic-views-{setting-prefix}-']` to the consumption rule. This only matches when at least one preset class from that setting group exists on body:

```scss
/* Gate: rule only fires when a title-color preset is active */
body.dynamic-views-open-on-title:not(
    .dynamic-views-title-hover-color-no-change
  ):is(
    [class*='dynamic-views-title-color-'],
    [class*='dynamic-views-title-hover-color-']
  )
  .dynamic-views
  .card.interact
  .card-title
  a:is(:hover, :active) {
  color: var(
    --dynamic-views-title-hover-color-value,
    var(--dynamic-views-title-color-hover-color)
  );
}
```

The body-level variable assignments (`hover-color-vars` mixin in [_property-colors.scss](../../styles/_property-colors.scss)) have zero hover-path cost — they only re-evaluate when body classes change (rare Style Settings events). The consumption rules in [_hover-and-touch.scss](../../styles/_hover-and-touch.scss) are the only card-level rules evaluated during hover recalculations.

**Specificity**: `[class*='...']` has the same specificity as a class selector (0,1,0), so the gate adds specificity equivalent to the per-variant body class it replaces.

**When to use**: Color preset consolidation where N body-class variants all set the same CSS variable, consumed by one rule. NOT needed when the consumption rule's other selectors already require a Style Settings class (no JS-managed classes in the chain).

### Prefer `:is()` enumeration over `[class*=]`

`[class*='dynamic-views-{prefix}-']` is a substring attribute selector — when *any* class on the element changes, the browser must re-evaluate every rule using `[class*=]` on that element. On `body`, where Obsidian, themes, and Style Settings frequently toggle classes, this triggers unnecessary style invalidation.

When all preset classes are known at authorship time (they usually are), replace the `[class*=]` gate with an explicit `:is()` enumeration:

```scss
/* ❌ Substring — invalidates on every body class change */
body[class*='dynamic-views-view-background-']:not(
    .dynamic-views-view-background-default
  ) ...

/* ✅ Enumeration — invalidates only when a listed class changes */
body:is(
    .dynamic-views-view-background-flexoki,
    .dynamic-views-view-background-ayu,
    ...
  ) ...
```

`:is()` with class selectors builds a proper invalidation set — the browser only re-evaluates when one of the listed classes specifically changes. The trade-off is that adding a new preset requires updating both the definition rules and the consumption `:is()` list.

The `[class*=]` gate remains appropriate when presets are open-ended (user-extensible) or when the consumption rule is on a non-`body` element with infrequent class mutations.

## Avoid re-renders from Style Settings changes

Re-renders from Style Settings changes are disruptive — they reset scroll position. Only add settings to `getStyleSettingsHash()` when they genuinely affect rendered card content (text, icons, layout). Do NOT add settings that only affect:

- **CSS-only toggles** (hover zoom, poster mode, cursor) — body class changes are picked up by CSS automatically.
- **JS event listener targets** — design listeners to work without rebinding. Example: `setupHoverZoomEligibility` always listens on `cardEl`.

### Geometry-only settings: `getStyleSettingsLayoutHash()`

Some settings change card *geometry* without changing card *content*. Masonry has no per-card `ResizeObserver`, so such a change leaves stale card positions until something forces a relayout.

Everything that alters text metrics qualifies: font size presets, and the Bold / Italic / Small caps / Case toggles on every text element. `TEXT_METRIC_CLASS_PATTERN` matches all of them. Colour, alignment and visibility settings do NOT belong here — they repaint without changing box sizes.

These belong in `getStyleSettingsLayoutHash()` ([style-settings.ts](../../src/utils/style-settings.ts)), NOT in `getStyleSettingsHash()`:

- `getStyleSettingsHash()` gates the text preview cache wipe in [grid-view.ts](../../src/bases/grid-view.ts) and [masonry-view.ts](../../src/bases/masonry-view.ts). Adding a geometric setting there would force re-extraction of every card's text preview from file content.
- `getStyleSettingsLayoutHash()` is appended to `renderHash` only, so the layout re-runs while cached previews survive.

Both hashes are concatenated in `setupStyleSettingsObserver` so either kind of change fires the callback. The layout hash reads `document.body.className` and regex-matches the classes — no `getComputedStyle` calls per render cycle. Custom values typed into the `-custom` text fields are already covered by the stylesheet observer.

When adding a metric-affecting setting to a new element, extend the element-stem alternation in `TEXT_METRIC_CLASS_PATTERN`. Longer stems MUST precede their own prefixes (`property-name` before `property`, the `group-*` stems before `property`/`title`), otherwise the shorter alternative matches first and the class is missed.

Font *family* settings are still not covered: they are `variable-text`, so they set a CSS variable rather than a body class and are invisible to a `className` match. They reach the plugin through the stylesheet observer, which fires `onStyleChange()` unconditionally.

## Current fallbacks

### `class-select` (CSS)

| Setting                   | Default        | Fallback file                                                    |
| ------------------------- | -------------- | ---------------------------------------------------------------- |
| Poster overlay tint       | dark           | [_poster.scss](../../styles/card/_poster.scss)                                                   |
| Poster fade tint          | dark           | [_poster.scss](../../styles/card/_poster.scss) — `:not(-light, -match)` enumeration (fires for `-dark` and no class) |
| Cover background          | dimmed         | [_cover-placeholders.scss](../../styles/card/_cover-placeholders.scss), [_cover-elements.scss](../../styles/card/_cover-elements.scss)               |
| Poster background         | dimmed         | [_poster.scss](../../styles/card/_poster.scss)                                                   |
| Show cover placeholder    | Grid           | [_cover-side.scss](../../styles/card/_cover-side.scss), [_cover-placeholders.scss](../../styles/card/_cover-placeholders.scss)                   |
| Card border color (hover) | muted          | [_core.scss](../../styles/card/_core.scss)                                                     |
| Card background (hover)   | transparent    | [_hover-and-touch.scss](../../styles/_hover-and-touch.scss)                                             |
| Card shadow color         | Default        | No CSS fallback needed — Default passes theme shadow vars through unchanged |
| File type indicator      | None           | [_header.scss](../../styles/card/_header.scss) — suffix visible by default, only Flair hides it  |
| Fixed cover height       | Grid (slider)  | [_grid-view.scss](../../styles/_grid-view.scss), [_cover-elements.scss](../../styles/card/_cover-elements.scss) — `:not(-masonry, -none)` exclusion (fires for `-grid`, `-both`, and no class) |
| Fixed poster height      | Grid (slider)  | [_poster.scss](../../styles/card/_poster.scss) — `:not(-masonry, -none)` exclusion (fires for `-grid`, `-both`, and no class) |
| Omit first line           | ifMatchesTitle | No CSS fallback needed — JS default via `getOmitFirstLineMode()` |
| View background           | Default        | No CSS fallback needed — natural baseline (transparent, no rule fires) |
| Font size (8 settings)    | per element    | No CSS fallback needed — natural baseline, `var(--…-size-value, <theme default>)` resolves when no class is present |
| Group header color (3 settings) | per element | No CSS fallback needed — natural baseline, `var(--…-color-value, <theme default>)` resolves when no class is present |

Note: "Show cover placeholder" uses the fallback only in Grid sections. Masonry sections intentionally omit the `:not()` arm because Masonry's default is "no placeholders" — the natural CSS baseline (no rule needed).

### Body-level variable + `[class*=...]` gate

| Setting group | Gate selector | Variable | Consumption file |
| --- | --- | --- | --- |
| Title color (hover, open-on-title) | `[class*='dynamic-views-title-color-']`, `[class*='dynamic-views-title-hover-color-']` | `--dynamic-views-title-color-hover-color`, `--dynamic-views-title-hover-color-value` | [_hover-and-touch.scss](../../styles/_hover-and-touch.scss) |
| Title color (hover, open-on-card) | `[class*='dynamic-views-title-hover-color-']` | `--dynamic-views-title-hover-color-value` | [_hover-and-touch.scss](../../styles/_hover-and-touch.scss) |
| Subtitle color (hover) | `[class*='dynamic-views-subtitle-color-']` | `--dynamic-views-subtitle-color-hover-color` | [_hover-and-touch.scss](../../styles/_hover-and-touch.scss) |
| Property color with names (hover) | `[class*='dynamic-views-property-color-with-names-']` | `--dynamic-views-property-with-name-color-hover-color` | [_hover-and-touch.scss](../../styles/_hover-and-touch.scss) |
| Property color without names (hover) | `[class*='dynamic-views-property-color-without-names-']` | `--dynamic-views-property-no-name-color-hover-color` | [_hover-and-touch.scss](../../styles/_hover-and-touch.scss) |

### `class-toggle` — inverted (CSS)

| Setting                  | Toggle class                                    | Fallback file        |
| ------------------------ | ----------------------------------------------- | -------------------- |
| Disable lift (card hover) | `dynamic-views-card-hover-disable-lift`      | [_hover-and-touch.scss](../../styles/_hover-and-touch.scss) |
| Poster reveal zoom       | `dynamic-views-poster-disable-reveal-zoom`      | [_poster.scss](../../styles/card/_poster.scss)       |
| Image viewer fullscreen  | `dynamic-views-image-viewer-constrain-to-pane` | [_image-viewer.scss](../../styles/_image-viewer.scss) |
| Cover hover zoom         | `dynamic-views-cover-disable-hover-zoom`        | [_cover-elements.scss](../../styles/card/_cover-elements.scss) |

### `class-toggle` — `.css-settings-manager` gate (CSS)

| Setting          | Toggle class                     | Fallback file   |
| ---------------- | -------------------------------- | --------------- |
| Hide pin toolbar | `dynamic-views-hide-pin-toolbar` | *(removed)* |

### `variable-number-slider` (CSS)

All `variable-number-slider` settings use the native `var()` fallback pattern. The fallback value must match the `default:` in [_style-settings.scss](../../styles/_style-settings.scss). Examples: `var(--dynamic-views-card-border-thickness, 1px)`, `var(--dynamic-views-card-padding, 8px)`.
