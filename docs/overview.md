---
title: Plugin overview
description: High-level overview of the Dynamic Views plugin — what it does, backends, data flow, and major subsystems.
author: "\U0001F916 Generated with Claude Code"
updated: 2026-03-14
---
# Plugin overview

## What Dynamic Views does

Dynamic Views renders card views (Grid, Masonry) for Obsidian's Bases and the Datacore plugin. Cards display images in multiple formats (cover, thumbnail, poster, backdrop), Markdown-stripped text previews, and configurable property rows. The plugin also provides a panzoom image viewer, multi-image slideshows, context menus, keyboard navigation, and virtual scrolling. See the [README](../README.md) for key features and the [wiki](../wiki/) for detailed documentation.

The plugin entry point is [main.ts](../main.ts) — it registers Bases view types, commands, and the settings tab, and exposes a `createView()` API that Datacore code blocks call into. Core type definitions live in [types.ts](../src/types.ts) and default values in [constants.ts](../src/constants.ts).

## Two backends

```
        ┌───────────────────┐         ┌───────────────────┐
        │       Bases       │         │     Datacore      │
        │     (DOM API)     │         │   (Preact JSX)    │
        │                   │         │                   │
        │  grid-view.ts     │         │  controller.tsx   │
        │  masonry-view.ts  │         │  card-view.tsx    │
        │  shared-renderer  │         │  masonry-view.tsx │
        └─────────┬─────────┘         └─────────┬─────────┘
                  │                             │
                  │      data-transform.ts      │
                  └──────────► CardData ◄───────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │          shared/          │
                    │                           │
                    │  card-renderer            │
                    │  content-loader           │
                    │  image-viewer             │
                    │  ...                      │
                    └───────────────────────────┘
```

- **Bases**: Uses the Obsidian native API with direct DOM manipulation. Each view extends `BasesView`. Entry points are [grid-view.ts](../src/bases/grid-view.ts) and [masonry-view.ts](../src/bases/masonry-view.ts), with shared card rendering logic deduplicated in [shared-renderer.ts](../src/bases/shared-renderer.ts).
- **Datacore**: Uses a Preact JSX component tree rendered by the Datacore plugin. Entry point is [controller.tsx](../src/datacore/controller.tsx), which manages state and query processing. Card rendering lives in [card-view.tsx](../src/datacore/card-view.tsx).
- **Shared layer**: Both backends normalize their query results into the `CardData` type (defined in [card-renderer.tsx](../src/shared/card-renderer.tsx), normalized by [data-transform.ts](../src/shared/data-transform.ts)). Most rendering logic, content loading, layout engines, and interactive features live in `shared/` and operate on this normalized type.

## Data flow

```
  Query result (Bases config / Datacore query)
          │
          ▼
  data-transform.ts ─── normalize to CardData[]
          │
          ▼
  content-loader.ts ─── async image + text loading (dedup, caching)
          │
          ▼
  card-renderer.tsx ─── build card DOM / Preact elements
          │
          ▼
  Layout engine ─────── Grid (CSS Grid) or Masonry (absolute positioning)
```

## Layout engines

- **Grid**: CSS Grid with responsive column counts. All cards are mounted in the DOM; render cost is managed by [content-visibility.ts](../src/shared/content-visibility.ts) (IntersectionObserver-based gating). Infinite scroll appends cards in batches.
- **Masonry**: Absolute positioning with a column-balancing algorithm ([masonry-layout.ts](../src/utils/masonry-layout.ts)). Only viewport-visible cards are mounted via [virtual-scroll.ts](../src/shared/virtual-scroll.ts), which handles mount/unmount as the user scrolls. Infinite scroll loads additional batches on demand.

## Major subsystems

| Subsystem | Key files | Role |
|---|---|---|
| Card rendering | [card-renderer.tsx](../src/shared/card-renderer.tsx) | Defines `CardData`, builds card DOM/Preact elements, wires image viewer and slideshow triggers. |
| Content loading | [content-loader.ts](../src/shared/content-loader.ts)<br>[image-loader.ts](../src/shared/image-loader.ts) | Async image/text loading with in-flight dedup and two-tier caching. |
| Virtual scroll | [virtual-scroll.ts](../src/shared/virtual-scroll.ts) | Masonry-only card mount/unmount by viewport position. |
| Content visibility | [content-visibility.ts](../src/shared/content-visibility.ts) | IntersectionObserver-based render gating for Grid. |
| Image viewer | [image-viewer.ts](../src/shared/image-viewer.ts) | Panzoom zoom/pan in constrained and fullscreen modes. |
| Slideshow | [slideshow.ts](../src/shared/slideshow.ts) | Multi-image card navigation, gesture detection, external blob cache. |
| Property layout | [property-measure.ts](../src/shared/property-measure.ts)<br>[scroll-gradient.ts](../src/shared/scroll-gradient.ts) | Property field width measurement, paired layout, horizontal scroll gradients. |
| Context menus | [context-menu.ts](../src/shared/context-menu.ts) | Right-click menus for cards and links, used by both backends. |
| Settings resolution | [persistence.ts](../src/persistence.ts)<br>[settings-schema.ts](../src/shared/settings-schema.ts) | Three-layer merge: defaults, template, per-view runtime config. |
| Text previews | [text-preview-dom.ts](../src/shared/text-preview-dom.ts)<br>[text-preview.ts](../src/utils/text-preview.ts) | Markdown stripping and DOM mutation for card text. |
| Keyboard navigation | [keyboard-nav.ts](../src/shared/keyboard-nav.ts) | Arrow key focus management across card grid. See [architecture/keyboard-nav.md](architecture/keyboard-nav.md). |

## Styles

SCSS source lives in [styles/](../styles/), compiled via `npm run css` (Dart Sass, no autoprefixer) to `styles.css`. Entry point is [main.scss](../styles/main.scss). Card-specific partials are in [styles/card/](../styles/card/), Datacore UI in [styles/datacore/](../styles/datacore/). The plugin integrates with Style Settings via a YAML comment block in [_style-settings.scss](../styles/_style-settings.scss). Derived CSS custom properties are defined in [_variables.scss](../styles/_variables.scss). See [patterns/css-variable-wrapping.md](patterns/css-variable-wrapping.md) and [patterns/style-settings-fallbacks.md](patterns/style-settings-fallbacks.md) for conventions.

## Settings system

Settings resolve through three layers: hardcoded defaults, an optional saved template (per view type), and per-view runtime config. Only non-default values are persisted (sparse storage), and stale keys from older plugin versions are cleaned up automatically. See [architecture/settings-resolution.md](architecture/settings-resolution.md) for the full resolution chain, type coercion rules, and invariants.

## Testing

Tests mirror `src/` in [tests/](../tests/), run via Vitest with jsdom (`npm test`). An Obsidian API mock lives at [tests/\_\_mocks\_\_/obsidian.ts](../tests/__mocks__/obsidian.ts).

See [index.md](index.md) for the full doc index with "read before" guidance for each architecture and pattern doc.
