---
title: Card DOM structure
description: Card DOM hierarchy, class names, property rows, and backend divergences for Grid and Masonry views.
author: "\U0001F916 Generated with Claude Code"
last updated: 2026-03-06
---
# Card DOM structure

Internal DOM hierarchy of cards in Grid and Masonry views, for both Bases and Datacore backends.

## Rendering model

|               | Bases ([shared-renderer.ts](../../src/bases/shared-renderer.ts))                      | Datacore ([card-renderer.tsx](../../src/shared/card-renderer.tsx))                                                      |
| ------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Method**    | Imperative DOM (`createDiv`, `createEl`)          | Declarative JSX (Preact)                                                            |
| **Container** | Cards appended directly to view-managed container | `CardRenderer` returns wrapping `div.dynamic-views-grid` / `.dynamic-views-masonry` |
| **Cleanup**   | `AbortController` per card + class-level arrays   | Module-level WeakMaps keyed by card path                                            |

## Card hierarchy

Both backends produce the same DOM structure with minor element-type differences noted below.

```
div.card                                    ← data-path="{path}"
│ [format classes: image-format-{cover|thumbnail|poster|backdrop}]
│ [position classes: card-cover-{top|bottom|left|right}, card-thumbnail-{position}]
│ [state: clickable-card, compact-mode, thumbnail-stack]
│ [transient: hover-intent-active, cover-hover-active, poster-hover-active, poster-revealed]
│
├─ div.card-cover-wrapper                   ← cover format, position=top|left (before .card-content)
│   ├─ div.card-cover                       ← single image
│   │   └─ div.dynamic-views-image-embed → img
│   ├─ div.card-cover.card-cover-slideshow  ← slideshow (≥2 images, top/bottom only; see `slideshow.md`)
│   │   ├─ div.dynamic-views-image-embed
│   │   │   ├─ img.slideshow-img.slideshow-img-current
│   │   │   └─ img.slideshow-img.slideshow-img-next
│   │   ├─ div.slideshow-indicator          ← Lucide icon
│   │   ├─ div.slideshow-nav-left           ← setIcon('lucide-chevron-left')
│   │   └─ div.slideshow-nav-right          ← setIcon('lucide-chevron-right')
│   └─ div.card-cover-placeholder           ← no image fallback
│
├─ div.card-poster → img                    ← poster format (absolute, fills card)
├─ div.card-backdrop → img                  ← backdrop format (absolute, fills card)
│
├─ div.card-content
│   ├─ div.card-header                      ← present when title, subtitle, or URL button exist
│   │   ├─ div.card-title-block
│   │   │   ├─ div.card-title               ← tabIndex=-1
│   │   │   │   ├─ span.card-title-icon     ← file-type icon (Icon mode)
│   │   │   │   ├─ span.card-title-ext      ← format badge (Flair mode); data-ext="{ext}"
│   │   │   │   ├─ [openFileAction=title]:
│   │   │   │   │   └─ a.internal-link [1] ← clickable link; tabIndex=-1
│   │   │   │   │       ├─ span.card-title-text (Datacore only) [1]
│   │   │   │   │       ├─ (text: title)
│   │   │   │   │       └─ span.card-title-ext-suffix   ← ".ext" (Extension mode)
│   │   │   │   └─ [openFileAction=card]:
│   │   │   │       ├─ span.card-title-text
│   │   │   │       └─ span.card-title-ext-suffix
│   │   │   └─ div.card-subtitle            ← subtitle property; tabIndex=-1
│   │   └─ a.card-title-url-icon            ← .text-icon-button.svg-icon; URL button; href, aria-label
│   │
│   └─ div.card-body
│       ├─ div.card-properties.card-properties-top
│       │   └─ (property rows — see below)
│       ├─ div.card-previews
│       │   ├─ div.card-text-preview-wrapper
│       │   │   └─ div.card-text-preview
│       │   │       ├─ span.card-text-preview-text    ← default (single block)
│       │   │       └─ p (×N)                         ← "Preserve line breaks" active + text has \n
│       │   └─ div.card-thumbnail [.multi-image]
│       │       └─ div.dynamic-views-image-embed → img
│       │       OR div.card-thumbnail-placeholder
│       └─ div.card-properties.card-properties-bottom
│
└─ div.card-cover-wrapper                   ← cover format, position=bottom|right (after .card-content)
```

## Property rows

> For the full measurement pipeline, pairing logic, width allocation, and alignment modes, see [property-layout.md](property-layout.md).

Inside `.card-properties-top` or `.card-properties-bottom`:

```
[Unpaired]:
div.property.property-{N}
  ├─ div.property-label                     ← above mode
  ├─ span.property-label-inline             ← inline mode
  └─ div.property-content-wrapper           ← scrollable; tabIndex=-1
      └─ div.property-content
          ├─ span.empty-value-marker
          ├─ span.timestamp-icon + text     ← timestamp properties
          ├─ div.tags-wrapper → a.tag (×N)  ← tag properties
          ├─ div.path-wrapper               ← file.path / file.folder
          │   └─ span.path-segment-wrapper (×N)
          │       ├─ span.path-segment.{folder|filename}-segment
          │       └─ span.path-separator
          ├─ span.list-wrapper              ← array properties
          │   └─ span → span.list-item + span.list-separator (×N)
          ├─ input.metadata-input-checkbox  ← checkbox properties
          └─ span (text + links)            ← generic properties

[Paired]:
div.property-pair.property-pair-{N}
  ├─ div.property.property-{N}.pair-left
  └─ div.property.property-{N+1}.pair-right
```

## Spacing

`.card-content` and `.card-body` use separate gaps declared in [styles/card/_core.scss](../../styles/card/_core.scss):

- `.card-content` (header↔body): `gap: var(--size-2-3)`
- `.card-body` (propsTop↔previews↔propsBottom): `gap: var(--size-2-2)`

Key behaviors:

- **`margin-top: auto`**: Works with gap — gap provides the minimum, auto absorbs remaining space. Used on `.card-properties-bottom` in Grid (fixed-height cards) to push it to the bottom.
- **`display: none` children**: Gap automatically skips them — no compensation rules needed for hidden placeholders.
- **No owl selectors**: The previous `> * + *:not(:empty)` approach required 7+ scattered padding/margin compensation rules across [_grid-view.scss](../../styles/_grid-view.scss), [_masonry-view.scss](../../styles/_masonry-view.scss), and [_cover-elements.scss](../../styles/card/_cover-elements.scss). Gap eliminated all of them.

## Backend differences

These are the only structural divergences — all class names and nesting are otherwise identical.

| Element                | Bases                                                    | Datacore                                              |
| ---------------------- | -------------------------------------------------------- | ----------------------------------------------------- |
| **Title link**         | `a.internal-link.card-title-text` (single element)       | `a.internal-link` wrapping `span.card-title-text` [1] |
| **Thumbnail stacking** | ResizeObserver physically moves `.card-thumbnail` in DOM | CSS `order` only, no DOM movement                     |

[1] Datacore wraps title text in an inner `span.card-title-text` because `setupTitleTruncation` reads/writes `.card-title-text.textContent` and would destroy ext-suffix children if flattened. Bases uses a single `a` element with both classes.
