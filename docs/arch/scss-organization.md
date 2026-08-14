---
title: SCSS organization
description: SCSS partial structure, loading order rationale, dependency relationships, and file categories — documents the stylesheet architecture and why partials are organized as they are.
author: 🤖 Generated with Claude Code
updated: 2026-08-14
---
# SCSS organization

The plugin's styles are authored as SCSS partials compiled via Dart Sass (`npm run css`) into a single `styles.css` output. The entry point is [main.scss](../../styles/main.scss), which loads 29 partials in a strict order. Partials do not `@use` each other (except `_property-colors.scss` which imports `sass:list` and `sass:string` for mixin logic) — all inter-file dependencies are CSS cascade-based, meaning a partial's rules must appear after the rules it overrides or the variables it consumes.

## Import order

[main.scss](../../styles/main.scss) groups imports into nine categories. The order is intentional — each group builds on what the previous groups established.

```
 1. Style Settings             _style-settings
 2. Foundation                 _variables, _focus, _container
 3. View layout                _grid-masonry-shared, _full-screen, _grid-view
 4. Overlays                   _image-viewer
 5. Card internals             card/_core, card/_previews, card/_header
 6. Image formats              card/_cover, card/_cover-elements, card/_cover-placeholders,
                               card/_cover-side, card/_images, card/_backdrop,
                               card/_poster, card/_slideshow
 7. Data display               _properties, _property-colors, _tags, _hover-and-touch,
                               _text-interaction, _scroll-gradient
 8. View types                  _masonry-view
 9. Overrides                  _compact, _plugin-settings, _utilities
```

### Why this sequence matters

1. **`_style-settings` must be first.** It contains the `/* @settings */` YAML comment block that the Style Settings plugin parses. Sass `--style=expanded` output preserves it as-is. The block defines `class-toggle` and `class-select` options that set body classes, and `variable-text`, `variable-number-slider` and `variable-themed-color` options that set CSS variables — all consumed by every other partial.

2. **`_variables` must precede all consumers.** It declares ~78 plugin-namespaced CSS variable wrappers on `body` (e.g., `--dynamic-views-text-normal: var(--text-normal, #222222)`) plus derived values (clamped aspect ratios, HSL color compositions, title hover color resolution). Nearly every other partial references these wrappers. See [css-variable-wrapping.md](../patterns/css-variable-wrapping.md) for the wrapping pattern.

3. **`_focus` and `_container` establish core element rules.** `_focus` normalizes focus rings and box-shadow resets. `_container` sets the `.dynamic-views` width system, embed padding, phone bottom spacing, and full-screen scroll range.

4. **View layout before card internals.** `_grid-masonry-shared` sets `container-type: inline-size` on `.bases-view` (enabling container queries used by `_compact`) and declares shared group/heading styles. `_grid-view` defines CSS Grid column layout, spacing, and subgrid. These structural rules must exist before card-level rules can position within them.

5. **Card internals before image formats.** `_core` establishes card structure (flexbox, padding, backgrounds, borders, animations). `_cover` and its siblings layer format-specific rules on top — they override `_core` values for cover positioning, aspect ratios, and placeholders.

6. **Image formats are ordered by dependency.** `_cover` defines the flexbox system and wrapper positioning. `_cover-elements` adds hover zoom and border. `_cover-placeholders` and `_cover-side` handle Grid-specific placeholder visibility and side layout adjustments. `_images` provides shared styles across all formats. `_backdrop` and `_poster` are self-contained full-bleed formats that build on `_core` card rules. `_slideshow` adds animation layers on top of cover elements.

7. **Data display after card structure.** Properties, tags, and interaction styles reference card dimensions and wrapper variables. `_property-colors` uses a Sass mixin to generate color preset rules for labels, text, subtitles, and titles — it depends on the `.card` and `.card-properties` selectors established earlier. `_hover-and-touch` consumes color variables defined by `_property-colors` body-class rules.

8. **View types specialize layout.** `_masonry-view` overrides Grid-oriented defaults with masonry-specific rules (absolute positioning, `overflow: clip`).

9. **Overrides are last.** `_compact` uses `@container` queries (requiring `container-type` from step 4) to override card layout at narrow widths. `_plugin-settings` styles the plugin settings tab (outside `.dynamic-views`). `_utilities` provides one-off utility classes and programmatic state classes that may override rules from any earlier partial.

## File categories

### Configuration (`_style-settings`)

Contains two parts: (1) the `/* @settings */` YAML comment block parsed by the Style Settings plugin to generate the settings UI, defining `class-toggle`, `class-select`, `variable-text`, `variable-number-slider` and `variable-themed-color` options; and (2) executable CSS rules for conditional Style Settings visibility and plugin settings divider styling.

### Foundation (`_variables`, `_focus`, `_container`)

Plugin-wide CSS custom property declarations, focus ring normalization, and the `.dynamic-views` container sizing system. These partials define the vocabulary that all other partials consume.

### View layout (`_grid-masonry-shared`, `_full-screen`, `_grid-view`)

Structural rules for view containers: container queries, view padding, group headings, sticky headers, phone full-screen bar hide/show, and CSS Grid column layout. `_grid-masonry-shared` handles rules common to both Grid and Masonry. `_grid-view` is Grid-specific. Masonry-specific overrides live in `_masonry-view` (loaded later in the override group).

### Overlays (`_image-viewer`)

The image viewer overlay — fixed-position, full-screen, appended to `body`. Loaded between view layout and card internals because it sits above the card layer but below Obsidian's notice layer.

### Card internals (`card/_core`, `card/_previews`, `card/_header`)

Card container structure: flexbox layout, padding, backgrounds, borders, border-color presets, fade-in animation, content spacing, thumbnail sizing, text preview truncation, and header layout. These are format-agnostic — they apply to all cards regardless of image format.

### Image formats (`card/_cover*`, `card/_images`, `card/_backdrop`, `card/_poster`, `card/_slideshow`)

Format-specific styling for the four image formats (cover, backdrop, poster, thumbnail). The cover subsystem is split across five files by concern: flexbox system (`_cover`), element styling and hover zoom (`_cover-elements`), placeholder/skeleton visibility (`_cover-placeholders`), side-cover Grid adjustments (`_cover-side`), and shared cross-format image rules (`_images`).

### Data display (`_properties`, `_property-colors`, `_tags`, `_hover-and-touch`, `_text-interaction`, `_scroll-gradient`)

Property row layout, paired column measurement, color presets (generated via Sass mixin), tag styles (outline/fill/plaintext/theme), hover feedback, touch press states, text selectability, cursor rules, and horizontal/vertical gradient masks.

### View types (`_masonry-view`)

`_masonry-view` converts Grid-oriented card rules to masonry absolute positioning, container sizing, and `overflow: clip`. Loaded after data display so it can override card layout rules established in earlier groups.

### Overrides (`_compact`, `_plugin-settings`, `_utilities`)

Final rules that override or specialize earlier declarations. `_compact` applies narrow-pane breakpoints via `@container` queries. `_plugin-settings` styles the plugin settings tab (outside `.dynamic-views`). `_utilities` collects one-off utility classes, programmatic state classes, and embed overrides.

## Dependency relationships

### CSS custom properties (cascade dependency)

`_variables.scss` is the source of all `--dynamic-views-*` wrapper variables. 26 of 29 partials reference at least one wrapper variable — making `_variables` the most depended-on file. The three exceptions are `_text-interaction` (uses only body classes, not CSS variables), `_compact` (uses container queries, not variables directly), and `_scroll-gradient` (uses only hardcoded values and body classes).

### Style Settings body classes (runtime dependency)

21 of 29 partials contain selectors gated on `body.dynamic-views-*` classes set by the Style Settings plugin. These are runtime dependencies — the CSS rules exist in the output regardless, but only activate when the corresponding body class is present. `_style-settings.scss` defines the available options; all other files are consumers. See [style-settings-fallbacks.md](../patterns/style-settings-fallbacks.md) for how defaults work without Style Settings installed.

### Sass module dependency

Only `_property-colors.scss` uses Sass `@use` imports (`sass:list`, `sass:string`) for its `@mixin color-setting()` generator. All other inter-file relationships are pure CSS cascade — no Sass variables, mixins, or functions cross partial boundaries.

### Container query dependency

`_grid-masonry-shared` sets `container-type: inline-size` on `.bases-view`. `_compact` uses unnamed `@container` queries that resolve against this container. `_grid-view` also sets `container-type` on `.dynamic-views-grid .card` for subgrid column queries. These `@container` consumers must load after the `container-type` declarations.

## Cross-references

- [css-variable-wrapping.md](../patterns/css-variable-wrapping.md) — the `--dynamic-views-*` wrapper pattern, resolution gotcha, and override sites.
- [style-settings-fallbacks.md](../patterns/style-settings-fallbacks.md) — fallback patterns for all Style Settings option types.
- [scss-nesting-conventions.md](../patterns/scss-nesting-conventions.md) — when to nest under `.dynamic-views {}` vs. leave flat.
- [card-dom-structure.md](card-dom-structure.md) — the DOM hierarchy that SCSS selectors target.
