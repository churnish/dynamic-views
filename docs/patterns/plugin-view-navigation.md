---
title: Plugin view navigation
description: Definitive reference for navigating Dynamic Views plugin views and elements across platforms — view identification, DOM hierarchy, correct selectors, full-screen elements, and platform-specific probing patterns.
author: 🤖 Generated with Claude Code
updated: 2026-03-30
---
# Plugin view navigation

Reference for navigating Dynamic Views plugin views and DOM elements via CDP (Chrome DevTools Protocol), WebKit Inspector, or direct DOM queries. Covers both Bases and Datacore backends, correct selectors, and common pitfalls. All class names and paths verified empirically against live runtime.

For card internals (property rows, cover elements, header structure), see [`card-dom-structure.md`](../architecture/card-dom-structure.md). 

For backend rendering model differences, see [`bases-v-datacore-differences.md`](../architecture/bases-v-datacore-differences.md).

## View identification

Dynamic Views extends native Obsidian view types — it does NOT register custom leaf types.

| Backend | Leaf type | Filter expression |
|---|---|---|
| Bases | `bases` | `getLeavesOfType('bases').filter(l => l.view.containerEl.querySelector('.dynamic-views'))` |
| Datacore | `markdown` | `getLeavesOfType('markdown').filter(l => l.view.containerEl.querySelector('.dynamic-views'))` |

**View mode** is determined by the container class on the layout element inside `.dynamic-views`:

| Mode | Class | Present on |
|---|---|---|
| Grid | `.dynamic-views-grid` | Both backends |
| Masonry | `.dynamic-views-masonry` | Both backends |

## DOM hierarchy

Bases views: `.view-content` contains `.bases-header`, `.bases-search-row`, `.bases-error`, and `.bases-view` as siblings. Only the card path (through `.bases-view`) is shown below — see [Toolbar structure](#toolbar-structure) for toolbar elements.

### Bases Grid (ungrouped)

```
leaf.view.containerEl
└── div.view-content
    └── div.bases-view                              ← scrollEl
        └── div.dynamic-views.dynamic-views-bases-container  ← container
            └── div.dynamic-views-grid
                └── div.dynamic-views-group-section
                    └── div.dynamic-views-group.bases-cards-group
                        ├── div.card
                        └── ...
```

Ungrouped Grid wraps cards in a single implicit `.dynamic-views-group-section` → `.dynamic-views-group`. No group heading is rendered.

### Bases Grid (grouped)

```
leaf.view.containerEl
└── div.view-content
    └── div.bases-view.is-grouped                   ← scrollEl
        └── div.dynamic-views.dynamic-views-bases-container.is-grouped  ← container
            └── div.dynamic-views-grid.bases-cards-container
                ├── div.dynamic-views-group-section
                │   ├── div.bases-group-heading      ← group header
                │   ├── div.dynamic-views-group.bases-cards-group
                │   │   ├── div.card
                │   │   └── ...
                │   └── div.dynamic-views-sticky-sentinel
                ├── div.dynamic-views-group-section
                │   └── ...
                └── ...
```

When grouped: `.is-grouped` is added to both `.bases-view` and `.dynamic-views`, `.bases-cards-container` is added to `.dynamic-views-grid`, and each section gets a `.bases-group-heading` + `.dynamic-views-sticky-sentinel`.

### Bases Masonry (ungrouped)

```
leaf.view.containerEl
└── div.view-content
    └── div.bases-view                              ← scrollEl
        └── div.dynamic-views.dynamic-views-bases-container  ← container
            └── div.dynamic-views-masonry.masonry-container
                ├── div.card.masonry-positioned
                └── ...
```

Ungrouped Masonry is flat — cards are direct children of `.dynamic-views-masonry.masonry-container`. No group sections or wrappers.

### Bases Masonry (grouped)

```
leaf.view.containerEl
└── div.view-content
    └── div.bases-view.is-grouped                   ← scrollEl
        └── div.dynamic-views.dynamic-views-bases-container.is-grouped  ← container
            └── div.dynamic-views-masonry.bases-cards-container
                ├── div.dynamic-views-group-section
                │   ├── div.bases-group-heading      ← group header
                │   ├── div.dynamic-views-group.bases-cards-group.masonry-container
                │   │   ├── div.card.masonry-positioned
                │   │   └── ...
                │   └── div.dynamic-views-sticky-sentinel
                └── ...
```

When grouped, `.masonry-container` moves from `.dynamic-views-masonry` to each `.dynamic-views-group` (each group is its own masonry container).

### Datacore (Live Preview)

```
leaf.view.containerEl
└── div.view-content
    └── div.markdown-source-view
        └── div.cm-editor
            └── div.cm-scroller                     ← scrollEl
                └── div.cm-sizer
                    └── div.cm-contentContainer
                        └── div.cm-content
                            └── div.cm-preview-code-block.cm-embed-block.cm-lang-datacorejsx
                                └── div.block-language-datacorejsx
                                    └── div.dynamic-views  ← container (no -bases-container)
                                        ├── div.controls-wrapper
                                        │   ├── div.bottom-controls
                                        │   └── div.search-controls-compact
                                        ├── div.results-container
                                        │   └── div.dynamic-views-grid
                                        │       ├── div.card
                                        │       └── ...
                                        └── div (load-more sentinel)
```

### Datacore (Reading view)

```
leaf.view.containerEl
└── div.view-content
    └── div.markdown-reading-view
        └── div.markdown-preview-view.markdown-rendered
            └── div.markdown-preview-sizer.markdown-preview-section
                └── div.el-pre
                    └── div.block-language-datacorejsx
                        └── div.dynamic-views       ← container (no -bases-container)
                            ├── div.controls-wrapper
                            ├── div.results-container
                            │   └── div.dynamic-views-grid
                            │       ├── div.card
                            │       └── ...
                            └── div (load-more sentinel)
```

Both views coexist as siblings under `.view-content` — Obsidian keeps the inactive view in the DOM.

Key differences from Bases:
- `.dynamic-views` does NOT have the `dynamic-views-bases-container` class
- `.results-container` sits between `.dynamic-views` and the grid/masonry layout element
- No `.bases-view` — the scroll element is `.cm-scroller` (Live Preview) or `.markdown-preview-view` (Reading view)
- No group sections — cards are direct children of `.dynamic-views-grid`
- Toolbar is `.controls-wrapper` (with `.bottom-controls` + `.search-controls-compact`), NOT `.bases-toolbar`

## Card selectors

The card class is `.card`.

**Count all visible cards:**
```js
document.querySelectorAll('.dynamic-views .card').length
```

**Scoped to a specific view:**
```js
leaf.view.containerEl.querySelectorAll('.dynamic-views .card').length
```

### Card modifier classes

| Class | Meaning |
|---|---|
| `image-format-thumbnail` | Thumbnail image format |
| `image-format-poster` | Poster image format |
| `card-thumbnail-right` | Thumbnail on right side |
| `clickable-card` | Card opens note on click |
| `has-card-content` | Card has text preview or thumbnail |
| `has-properties-bottom` | Properties rendered below content |
| `has-header` | Card has a header (title/subtitle) |
| `compact-mode` | Compact card layout |
| `compact-stacked` | Compact with stacked layout (Datacore) |
| `content-hidden` | Card content hidden (content-visibility) |
| `card-fade-in` | Fade-in animation class |
| `image-ready` | Cover/thumbnail image loaded |
| `masonry-positioned` | Absolutely positioned in masonry layout |

### Container modifier classes

| Class | Meaning |
|---|---|
| `dynamic-views-bases-container` | Bases backend container (absent on Datacore) |
| `dynamic-views-paired-property-column` | Paired property column layout active |
| `poster-mode-fade` | Poster fade display mode |
| `image-fit-crop` | Image fit mode: crop |
| `image-fit-contain` | Image fit mode: contain |
| `is-grouped` | View has groupBy enabled |
| `dynamic-views-empty` | Zero results (Datacore) |
| `dynamic-views-hidden` | Container hidden (Datacore, when code block is not visible) |

## Toolbar structure

### Bases (Obsidian-owned)

```
div.bases-header
└── div.bases-toolbar
    ├── div.bases-toolbar-item.bases-toolbar-views-menu
    ├── div.bases-toolbar-item.bases-toolbar-results-menu
    ├── div.bases-toolbar-item.bases-toolbar-sort-menu
    ├── div.bases-toolbar-item.bases-toolbar-filter-menu
    ├── div.bases-toolbar-item.bases-toolbar-properties-menu
    ├── div.bases-toolbar-item.bases-toolbar-search
    └── div.bases-toolbar-item.bases-toolbar-new-item-menu
```

The search row is a sibling: `div.bases-search-row`.

### Datacore (plugin-created)

```
div.controls-wrapper
├── div.bottom-controls      (view/sort/limit controls)
└── div.search-controls-compact  (search input)
```

## Full-screen controller elements

The `FullScreenController` (`src/bases/full-screen.ts`) targets these elements on mobile:

| Property | Selector | Discovery method |
|---|---|---|
| `scrollEl` | `.bases-view` | Passed via `FullScreenElements` interface |
| `container` | `.dynamic-views-bases-container` | Passed via `FullScreenElements` interface |
| `viewContent` | `.view-content` | Passed via `FullScreenElements` interface |
| `navbarEl` | `.mobile-navbar` | Passed via `FullScreenElements` interface |
| `viewHeaderEl` | `.view-header` | `viewContent.parentElement.querySelector('.view-header')` |
| `toolbarEl` | `.bases-header` | `leafContent.querySelector('.bases-header')` |
| `searchRowEl` | `.bases-search-row` | `leafContent.querySelector('.bases-search-row')` |

Note: `toolbarEl` targets `.bases-header` (the full header), NOT `.bases-toolbar` (the toolbar inside it).

## Other structural elements

| Element | Selector | Notes |
|---|---|---|
| End indicator | `.dynamic-views-end-indicator` | Appended to container when all cards are loaded |
| Sticky sentinel | `.dynamic-views-sticky-sentinel` | Created by `setupStickyHeadingObserver` for grouped views |
| Group heading | `.bases-group-heading` | Only rendered when `groupBy` is set |
| View header | `.view-header` | Obsidian native — sibling of `.view-content` inside `.workspace-leaf-content` |
| Measure lane | `.dynamic-views-measure-lane` | Temporary element for column width measurement during re-render |

## Platform-specific probing

### Desktop

Use **Obsidian CLI** (`obsidian eval`) or **Chrome DevTools MCP** (`evaluate_script`). See [View identification](#view-identification) for filter expressions and [Card selectors](#card-selectors) for card queries.

### Android (ADB + CDP)

Forward the debug port, then connect via WebSocket CDP.

```bash
adb forward tcp:9222 localabstract:chromium_devtools_remote
```

**Discover the vault path at runtime — do NOT hardcode:**
```js
app.vault.adapter.basePath
```

Android vault paths vary by device and sync method. Always query `basePath` first.
### iOS/iPadOS (Safari Web Inspector)

Manual console access only — no programmatic CDP connection. Queries run in Safari's Web Inspector console connected to the Obsidian WKWebView.

## Common pitfalls

1. **`.bases-card` does not exist** — the card class is `.card`. The name `.bases-card` is a hallucination derived from the parent `.bases-cards-group`. Every "0 cards found" conclusion from using `.bases-card` is wrong.
2. **Dynamic Views does not register custom leaf types** — it piggybacks on `bases` (for Bases backend) and `markdown` (for Datacore backend). Searching for DV-specific leaf types will find nothing.
3. **Cards may be empty right after app restart** — Bases queries use Obsidian's `metadataCache`, which updates continuously but needs an initial indexing pass on startup. If a CDP query runs before `app.metadataCache.resolved === true`, results may be incomplete.
4. **Android vault path is not fixed** — the path varies by device and sync method. Always discover via `app.vault.adapter.basePath`, never hardcode.
5. **Datacore `.dynamic-views` has no `.dynamic-views-bases-container`** — Bases views add `dynamic-views-bases-container` to the `.dynamic-views` element; Datacore views do not. Do not use `.dynamic-views-bases-container` as a universal selector for all Dynamic Views containers.
6. **Ungrouped masonry is flat, grouped masonry has group wrappers** — ungrouped Masonry cards are direct children of `.dynamic-views-masonry.masonry-container`. When grouped, Masonry gets the same `.dynamic-views-group-section` → `.dynamic-views-group` structure as Grid, and `.masonry-container` moves from `.dynamic-views-masonry` to each `.dynamic-views-group`.
7. **Toolbar class differs by backend** — Bases uses `.bases-header` > `.bases-toolbar` (Obsidian-owned elements the plugin cannot modify). Datacore uses `.controls-wrapper` > `.bottom-controls` (plugin-created elements). There is no shared toolbar selector.
