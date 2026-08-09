---
title: CSS variable wrapping
description: Plugin-namespaced CSS variable wrappers, variable catalog, JS-set variables, and resolution semantics.
author: 🤖 Generated with Claude Code
updated: 2026-08-09
---
# CSS variable wrapping

All external Obsidian CSS variables are read through plugin-namespaced wrappers defined in [_variables.scss](../../styles/_variables.scss). ~78 wrappers follow the pattern:

```scss
body {
  --dynamic-views-text-normal: var(--text-normal, #222222);
}
```

Obsidian defines all CSS variables on `body` (`.theme-dark`/`.theme-light`), not `:root`. Wrappers live on `body` so `var()` references resolve against the correct element. Usage sites reference `var(--dynamic-views-text-normal)` instead of bare `var(--text-normal)`. This provides:

- **Consistent fallbacks**: Each external var has a single fallback value (Obsidian default light theme), declared once.
- **Namespace isolation**: Grepping `--dynamic-views-` shows all plugin-owned references. Bare external vars only appear in [_variables.scss](../../styles/_variables.scss) wrappers.

## Variable catalog

[_variables.scss](../../styles/_variables.scss) is the canonical catalog of all CSS custom properties the plugin defines on `body`. Variables fall into three categories.

### 1. Wrapped Obsidian variables

These mirror an Obsidian variable with a plugin-namespaced name and a hardcoded fallback (default light theme value). The fallback ensures the plugin works correctly if a custom theme removes the variable.

```scss
--dynamic-views-text-normal: var(--text-normal, #222222);
--dynamic-views-anim-duration-fast: var(--anim-duration-fast, 140ms);
--dynamic-views-radius-s: var(--radius-s, 4px);
```

Organized into groups: Typography, Border radius, Icons, Animation, Shadows, Layout, Colors, Backgrounds, Text, Links, Interactive.

### 2. Derived/computed variables

These do not wrap an Obsidian variable. They compute a value from other `--dynamic-views-*` variables using `calc()`, `clamp()`, `color-mix()`, or `hsl()`.

```scss
// Clamped from the JS-set image aspect ratio
--dynamic-views-thumbnail-aspect-ratio: clamp(0.5, var(--dynamic-views-image-aspect-ratio, 1), 2);

// Composed from HSL components set by Style Settings (hsl-split format)
--dynamic-views-tag-color-custom: hsl(
  var(--dynamic-views-tag-color-custom-h),
  var(--dynamic-views-tag-color-custom-s),
  var(--dynamic-views-tag-color-custom-l)
);
// Hover variant with slight hue shift, saturation boost, and lightness increase
--dynamic-views-tag-color-custom-hover: hsl(
  calc(var(--dynamic-views-tag-color-custom-h) - 3),
  calc(var(--dynamic-views-tag-color-custom-s) * 1.02),
  calc(var(--dynamic-views-tag-color-custom-l) * 1.15)
);
```

The title hover color resolver at the bottom of `_variables.scss` also falls into this category — it maps body class presets to a single `--dynamic-views-title-hover-color-value` variable.

### 3. Plugin-owned variables (SCSS string values)

These define string tokens consumed via CSS `content:` or `counter-style` patterns. They have no Obsidian counterpart.

```scss
--dynamic-views-list-separator: ', ';
--dynamic-views-empty-value-marker: '—';
```

These are also overridable via Style Settings `variable-text` options with `quotes: true`.

## Exempt variables

Plugin-internal variables are NOT wrapped — they're defined by the plugin itself:

- Layout: `--card-bg`, `--field1-width`, `--field2-width`, `--cover-inner-radius`, `--cover-non-edge-radius`, `--side-cover-*`, `--masonry-height`, `--masonry-reposition-duration`
- Interaction: `--hover-scale-*`, `--cover-inset-*`
- Structure: `--card-border-*`, `--poster-inset`, `--backdrop-inset`, `--tag-text-color`

`--size-*` variables (Obsidian spacing tokens) are also exempt per [AGENTS.md](../../AGENTS.md) — they're used without fallbacks or wrappers.

## JS-set CSS variables

Some `--dynamic-views-*` variables are set at runtime from JavaScript rather than SCSS. These interact with SCSS-defined variables in two ways: container-scoped inline styles from view settings, and body-level reads for layout computation.

### `applyCssOnlySettings()` (per-view container)

Defined in `shared-renderer.ts`. Called on every `onDataUpdated()` callback, outside the render throttle, for instant slider feedback. Sets inline `style` properties on the `.dynamic-views-bases-container` element:

| Variable | Source | Notes |
|---|---|---|
| `--dynamic-views-text-preview-lines` | `config.get('textPreviewLines')` | Consumed by `-webkit-line-clamp` |
| `--dynamic-views-title-lines` | `config.get('titleLines')` | Also toggles `title-single-line` class |
| `--dynamic-views-subtitle-lines` | `config.get('subtitleLines')` | Consumed by `max-height`, not `-webkit-line-clamp` — see `card-dom-structure.md`. Also toggles `subtitle-scroll` class |
| `--dynamic-views-image-aspect-ratio` | `config.get('imageRatio')` | Fed into `--dynamic-views-thumbnail-aspect-ratio` via `clamp()` in `_variables.scss` |
| `--dynamic-views-thumbnail-size` | `config.get('thumbnailSize')` | Set with `px` unit |

`applyViewContainerStyles()` (same file, called from the render pass rather than the CSS fast-path) sets one more container variable:

| Variable | Source | Notes |
|---|---|---|
| `--dynamic-views-card-spacing-desktop` / `-phone` | `settings.cardGapDesktop` / `cardGapPhone` | Only the current platform's variable is written (`Platform.isPhone`). Feeds both the `gap` rules in `_grid-view.scss` and `getCardSpacing()`. Written only when the value changes, because each write must be followed by `clearStyleSettingsCache()` |

These are per-view — each Bases leaf's container gets its own values. `textPreviewLines`, `imageRatio`, and `thumbnailSize` are in `CSS_ONLY_SETTINGS_KEYS` (excluded from the render hash — CSS-only changes skip full DOM rebuild). `titleLines` and `subtitleLines` are NOT in that set — they also trigger a full re-render because they toggle the `title-single-line` and `subtitle-scroll` classes, which affect card layout and, for the subtitle, which scroll gradients get wired up at render time. The function also toggles classes for `posterDisplayMode` (`poster-mode-fade`/`poster-mode-overlay`) and `imageFit` (`image-fit-crop`/`image-fit-contain`), which are in `CSS_ONLY_SETTINGS_KEYS` despite being class toggles rather than CSS variables.

### `style-settings.ts` (body-level reads)

Functions in `style-settings.ts` read `--dynamic-views-*` variables from `document.body` via `getComputedStyle()` for use in JS layout calculations:

- `getCardSpacing()` — reads `--dynamic-views-card-spacing-desktop` or `--dynamic-views-card-spacing-phone`. The container element is authoritative: `applyViewContainerStyles()` writes the per-view gap setting there as an inline style, so the container read comes first and wins everywhere — including embeds, where the CSS `gap` rules also apply. Only when the container carries no value does it fall back to `--size-4-2` (inside `.internal-embed`) or to the `body`-level value.
- `getCompactBreakpoint()` — reads `--dynamic-views-compact-breakpoint`.
- `getZoomSensitivityDesktop()` — reads `--dynamic-views-zoom-sensitivity`.
- `getSlideshowMaxImages()` — reads `--dynamic-views-slideshow-max-images`.
- `getDatetimeFormat()`, `getDateFormat()`, `getTimeFormat()` — read `variable-text` format strings.
- `getListSeparator()`, `getEmptyValueMarker()` — read `variable-text` string tokens.

All reads go through a per-render-cycle cache (`cssTextCache` / `containerSpacingCache`) cleared by `clearStyleSettingsCache()` to avoid layout thrashing from repeated `getComputedStyle()` calls.

### Other JS-set variables (element-scoped)

A few variables are set on individual elements rather than the container:

- `--hover-scale-x`, `--hover-scale-y` — set per-card in `grid-view.ts` and `masonry-view.ts` for hover enlarge transforms.
- `--field1-width`, `--field2-width` — set per property-set in `property-measure.ts` for paired property column widths.
- `--overlay-opacity` — set on the image viewer clone in `image-viewer.ts`.

These are exempt from the wrapping convention because they are scoped to individual DOM elements, not inherited from `body`.

## When to wrap, use directly, or create new

| Scenario | Action |
|---|---|
| **Using an Obsidian theme variable** (e.g., `--text-muted`, `--color-red`) | Wrap it in `_variables.scss` with a `--dynamic-views-` prefix and fallback. Reference the wrapper in SCSS. |
| **Using `--size-*` spacing tokens** | Use directly — exempt from wrapping per AGENTS.md. |
| **Need a computed value from existing variables** | Add a derived variable in `_variables.scss` using `calc()`, `clamp()`, or `hsl()`. |
| **Adding a Style Settings slider or text option** | The Style Settings plugin injects `--dynamic-views-*` variables into a `<style>` element. If JS also needs the value, add a reader function in `style-settings.ts`. |
| **Adding a per-element layout value from JS** | Use a short, unprefixed name (e.g., `--field1-width`) set via `el.style.setProperty()`. No wrapper needed. |
| **Adding a string token** (separator, marker) | Define in `_variables.scss` as a plugin-owned variable. Optionally expose via Style Settings `variable-text`. |

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
body.dynamic-views-backdrop-color-scheme-dark .dynamic-views .card.image-format-backdrop:has(.card-backdrop) {
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

- [_poster.scss](../../styles/card/_poster.scss) — fade mode (light text), overlay light-theme (dark text), overlay dark-theme (light text)
- [_backdrop.scss](../../styles/card/_backdrop.scss) — dark overlay (light text), light overlay (dark text)
- [_grid-masonry-shared.scss](../../styles/_grid-masonry-shared.scss) — `--bases-view-padding` on plugin view types (Obsidian sets this on `.workspace-leaf-content`, not `body`, so the `body`-level wrapper resolves to the fallback; the redefinition on `.bases-view[data-view-type]` provides the correct inherited value)

## When adding a new wrapper

1. Define `--dynamic-views-foo: var(--foo, <default-theme-value>)` in [_variables.scss](../../styles/_variables.scss) `body` block.
2. Replace all bare `var(--foo)` references across SCSS with `var(--dynamic-views-foo)`.
3. If any SCSS rule locally overrides `--foo` (e.g., text color overrides on poster/backdrop), also set `--dynamic-views-foo` at that same site.
