---
title: Plugin overview
description: High-level overview of the Dynamic Views plugin — what it does, architecture, data flow, and major systems.
author: 🤖 Generated with Claude Code
updated: 2026-04-10
---
# Plugin overview

## What Dynamic Views does

- Dynamic Views renders card views (Grid, Masonry) in Obsidian's built-in [Bases](https://obsidian.md/help/bases) plugin.
- Cards can display images in multiple formats (cover, thumbnail, poster, backdrop), markup-stripped text previews, and configurable property rows.
- The plugin also provides a zoom/pan image viewer, multi-image navigation, and keyboard navigation.
- See the [README](../README.md) for key features and documentation.
- The plugin entry point is [main.ts](../main.ts) — it registers Bases view types, commands, and the settings tab.
- Core type definitions live in [types.ts](../src/types.ts) and default values in [constants.ts](../src/constants.ts).

## Architecture

```
        ┌───────────────────┐
        │       Bases       │
        │     (DOM API)     │
        │                   │
        │  grid-view.ts     │
        │  masonry-view.ts  │
        │  shared-renderer  │
        └─────────┬─────────┘
                  │
                  │      data-transform.ts
                  └──────────► CardData
                                  │
                    ┌─────────────┴─────────────┐
                    │           core/           │
                    │                           │
                    │  card-data                │
                    │  content-loader           │
                    │  image-viewer             │
                    │  ...                      │
                    └───────────────────────────┘
```

- **Bases**: Uses the Obsidian native API with direct DOM manipulation. Each view extends `BasesView`. Entry points are [grid-view.ts](../src/bases/grid-view.ts) and [masonry-view.ts](../src/bases/masonry-view.ts), with shared card rendering logic deduplicated in [shared-renderer.ts](../src/bases/shared-renderer.ts).
- **Core layer**: Bases query results are normalized into the `CardData` type (defined in [card-data.ts](../src/core/card-data.ts), normalized by [data-transform.ts](../src/core/data-transform.ts)). Most rendering logic, content loading, layout engines, and interactive features live in `core/` and operate on this normalized type.

## Data flow

```
  Query result (Bases config)
          │
          ▼
  data-transform.ts ─── normalize to CardData[]
          │
          ▼
  content-loader.ts ─── async image + text loading (dedup, caching)
          │
          ▼
  shared-renderer.ts ── build card DOM
          │
          ▼
  Layout engine ─────── Grid (CSS Grid) or Masonry (absolute positioning)
```

## Layout engines

- **Grid**: CSS Grid with responsive column counts. All cards are mounted in the DOM; render cost is managed by [content-visibility.ts](../src/core/content-visibility.ts) (IntersectionObserver-based gating). Infinite scroll appends cards in batches.
- **Masonry**: Absolute positioning with a column-balancing algorithm ([masonry-layout.ts](../src/utils/masonry-layout.ts)). Only viewport-visible cards are mounted via [virtual-scroll.ts](../src/core/virtual-scroll.ts), which handles mount/unmount as the user scrolls. Infinite scroll loads additional batches on demand.

## Major systems

| System | Key files | Role |
|---|---|---|
| Card rendering | [card-data.ts](../src/core/card-data.ts), [shared-renderer.ts](../src/bases/shared-renderer.ts) | Defines `CardData`, builds card DOM, wires image viewer and slideshow triggers. |
| Content loading | [content-loader.ts](../src/core/content-loader.ts)<br>[image-loader.ts](../src/core/image-loader.ts) | Async image/text loading with in-flight dedup and two-tier caching. |
| Virtual scroll | [virtual-scroll.ts](../src/core/virtual-scroll.ts) | Masonry-only card mount/unmount by viewport position. |
| Content visibility | [content-visibility.ts](../src/core/content-visibility.ts) | IntersectionObserver-based render gating for Grid. |
| Image viewer | [image-viewer.ts](../src/core/image-viewer.ts) | Zoom/pan gestures in constrained and fullscreen modes. |
| Slideshow | [slideshow.ts](../src/core/slideshow.ts) | Multi-image card navigation, gesture detection, external blob cache. |
| Property layout | [property-measure.ts](../src/core/property-measure.ts)<br>[scroll-gradient.ts](../src/core/scroll-gradient.ts) | Property field width measurement, paired layout, horizontal scroll gradients. |
| Context menus | [context-menu.ts](../src/core/context-menu.ts) | Right-click menus for cards and links. |
| Settings resolution | [persistence.ts](../src/persistence.ts)<br>[settings-schema.ts](../src/core/settings-schema.ts) | Three-layer merge: defaults, template, per-view runtime config. |
| Text previews | [text-preview-dom.ts](../src/core/text-preview-dom.ts)<br>[text-preview.ts](../src/core/text-preview.ts) | Markdown stripping and DOM mutation for card text. |
| Keyboard navigation | [keyboard-nav.ts](../src/core/keyboard-nav.ts) | Arrow key focus management across card grid. See [arch/keyboard-nav.md](arch/keyboard-nav.md). |

## Styles

- SCSS source lives in [styles/](../styles/), compiled via `npm run css` (Dart Sass, no autoprefixer) to `styles.css`.
- Entry point: [main.scss](../styles/main.scss).
- Card-specific partials: [styles/card/](../styles/card/).
- Dynamic Views integrates with the Style Settings plugin via a YAML comment block in [_style-settings.scss](../styles/_style-settings.scss).
- Derived CSS custom properties are defined in [_variables.scss](../styles/_variables.scss).
- See [patterns/css-variable-wrapping.md](patterns/css-variable-wrapping.md) and [patterns/style-settings-fallbacks.md](patterns/style-settings-fallbacks.md) for conventions.

## Settings system

- Settings resolve through three layers: hardcoded defaults, an optional saved template (per view type), and per-view runtime config.
- Only non-default values are persisted (sparse storage). Stale keys from older plugin versions are cleaned up automatically.
- See [arch/settings-resolution.md](arch/settings-resolution.md) for the full resolution chain, type coercion rules, and invariants.

## Testing

- Tests mirror `src/` in [tests/](../tests/).
- Run via Vitest with jsdom (`npm test`).
- An Obsidian API mock lives at [tests/\_\_mocks\_\_/obsidian.ts](../tests/__mocks__/obsidian.ts).
- See [index.md](index.md) for the full doc index with "read before" guidance for each architecture and pattern doc.
