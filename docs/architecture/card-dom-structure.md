---
title: Card DOM structure
description: Card DOM hierarchy, class names, and property rows for Grid and Masonry views.
author: 🤖 Generated with Claude Code
updated: 2026-04-06
---
# Card DOM structure

Internal DOM hierarchy of cards in Grid and Masonry views.

## Rendering model

| Aspect | Implementation |
| --- | --- |
| **Method** | Imperative DOM (`createDiv`, `createEl`) via [shared-renderer.ts](../../src/bases/shared-renderer.ts) |
| **Container** | Cards appended directly to view-managed container |
| **Cleanup** | `AbortController` per card + class-level arrays |

## Card hierarchy

Both backends produce the same DOM structure with minor element-type differences noted below.

```
div.card                                    ← data-path="{path}"
│ [format classes: image-format-{cover|thumbnail|poster|backdrop}]
│ [position classes: card-cover-{top|bottom|left|right}, card-thumbnail-{position}]
│ [structural: has-card-content, has-header, has-properties-bottom, has-poster, has-backdrop,
│              has-cover, has-cover-placeholder, has-cover-wrapper-placeholder]
│ [state: clickable-card, compact-mode, thumbnail-stack]
│ [transient: interact, poster-hover-active, poster-revealed]
│
├─ div.card-cover-wrapper                   ← cover format, position=top|left (before .card-content)
│   ├─ div.card-cover                       ← single image
│   │   └─ div.dynamic-views-image-embed → img
│   ├─ div.card-cover.card-cover-slideshow  ← slideshow (≥2 images, top/bottom only; see `slideshow.md`)
│   │   ├─ div.dynamic-views-image-embed
│   │   │   ├─ img.slideshow-img.slideshow-img-current
│   │   │   └─ img.slideshow-img.slideshow-img-next
│   │   ├─ div.slideshow-icon               ← Lucide icon
│   │   ├─ div.slideshow-nav-left           ← setIcon('lucide-chevron-left')
│   │   └─ div.slideshow-nav-right          ← setIcon('lucide-chevron-right')
│   └─ div.card-cover-placeholder           ← no image fallback
│
├─ div.card-poster → img                    ← poster format (absolute, fills card)
├─ div.card-backdrop → img                  ← backdrop format (absolute, fills card)
│
├─ div.card-content                          ← poster format: scroll container (overflow-y: auto)
│   ├─ div.card-header                      ← present when title, subtitle, or URL button exist
│   │   ├─ div.card-title-block
│   │   │   ├─ div.card-title               ← tabIndex=-1
│   │   │   │   ├─ span.card-title-icon     ← file-type icon (Icon mode)
│   │   │   │   ├─ span.card-title-ext      ← format badge (Flair mode); data-ext="{ext}"
│   │   │   │   ├─ [openFileAction=title]:
│   │   │   │   │   └─ a.internal-link.card-title-text ← clickable link; tabIndex=-1
│   │   │   │   │       ├─ (text: title)
│   │   │   │   │       └─ span.card-title-ext-suffix   ← ".ext" (Extension mode)
│   │   │   │   └─ [openFileAction=card]:
│   │   │   │       ├─ span.card-title-text
│   │   │   │       └─ span.card-title-ext-suffix
│   │   │   └─ div.card-subtitle            ← subtitle property; tabIndex=-1
│   │   └─ a.card-title-url-icon            ← .text-icon-button.svg-icon; URL button; href, aria-label
│   │
│   └─ div.card-body
│       ├─ div.card-properties.card-properties-top [.names-above]
│       │   └─ (property rows — see below)
│       ├─ div.card-previews
│       │   ├─ div.card-text-preview-wrapper
│       │   │   └─ div.card-text-preview
│       │   │       ├─ span.card-text-preview-text    ← default (single block)
│       │   │       └─ p (×N)                         ← "Preserve line breaks" active + text has \n
│       │   └─ div.card-thumbnail [.multi-image]
│       │       └─ div.dynamic-views-image-embed → img
│       │       OR div.card-thumbnail-placeholder
│       └─ div.card-properties.card-properties-bottom [.names-above]
│
└─ div.card-cover-wrapper                   ← cover format, position=bottom|right (after .card-content)
```

**Poster format note**: In poster format, `.card-content` is the scroll container (not `.card-body`). Both `.card-header` and `.card-body` are direct children of `.card-content` and scroll together when content overflows.

## Property rows

> For the full measurement pipeline, pairing logic, width allocation, and alignment modes, see [property-layout.md](property-layout.md).

Inside `.card-properties-top` or `.card-properties-bottom`:

```
[Unpaired]:
div.property.property-{N}
  ├─ div.property-name                      ← above mode
  ├─ span.property-name-inline              ← inline mode
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

## Structural content classes

Render-time classes that replace `:has()` selectors (see AGENTS.md constraint). Both backends use the shared `VISIBLE_BODY_SELECTOR` module-level constant:

```
.card-properties-top, .card-properties-bottom, .card-previews:not(.thumbnail-placeholder-only)
```

| Class | Element | Selector | Set from | CSS effect |
|---|---|---|---|---|
| `has-header` | `.card` | `.card-header` exists | Card root querySelector | Prevents cover-only padding reset from zeroing padding on title-only cards |
| `has-card-content` | `.card` | `VISIBLE_BODY_SELECTOR` on card descendants | Inline querySelector | Drives title divider border and cover-only padding resets |
| `has-body-content` | `.card-body` | `VISIBLE_BODY_SELECTOR` on body children | Card-body ref querySelector | Without it, `card-body` is `display: none` (collapses to avoid gap from `card-content` flex layout) |

Both exclude `.card-previews.thumbnail-placeholder-only` — a previews container with only a thumbnail placeholder, hidden by CSS when the "Show thumbnail placeholder" style setting is off. The CSS rule scoping (`body:not(.dynamic-views-show-thumbnail-placeholder)`) ensures `card-body` is never hidden when placeholders are visible.

## Spacing

`.card-content` and `.card-body` use separate gaps declared in [styles/card/_core.scss](../../styles/card/_core.scss):

- `.card-content` (header↔body): `gap: var(--size-2-3)`
- `.card-body` (propsTop↔previews↔propsBottom): `gap: var(--size-4-2)`
- `.card-properties` (between property rows): `gap: var(--size-4-2)`, or `var(--size-4-3)` when `.names-above` is present

Key behaviors:

- **`margin-top: auto`**: Works with gap — gap provides the minimum, auto absorbs remaining space. Used on `.card-properties-bottom` in Grid (fixed-height cards) to push it to the bottom.
- **`display: none` children**: Gap automatically skips them — no compensation rules needed for hidden placeholders.
- **No owl selectors**: The previous `> * + *:not(:empty)` approach required 7+ scattered padding/margin compensation rules across [_grid-view.scss](../../styles/_grid-view.scss), [_masonry-view.scss](../../styles/_masonry-view.scss), and [_cover-elements.scss](../../styles/card/_cover-elements.scss). Gap eliminated all of them.

