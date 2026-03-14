---
title: Bases v Datacore differences
description: Architectural differences between the Bases (imperative DOM) and Datacore (Preact JSX) backends — rendering, events, cleanup, state, and common pitfalls.
author: 🤖 Generated with Claude Code
last updated: 2026-03-12
---
# Bases v Datacore differences

Architectural comparison of the Bases and Datacore backends. For masonry-specific divergences (virtual scrolling, resize strategy, layout guards), see [masonry-layout.md](masonry-layout.md).

## Rendering model

|                        | Bases (`bases/shared-renderer.ts`)                                                                                                 | Datacore (`shared/card-renderer.tsx` + `datacore/controller.tsx`)                                                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Paradigm**           | Imperative DOM — `createDiv()`, `createEl()`, `createSpan()`                                                                       | Declarative Preact JSX — VDOM diffing                                                                                                                                                            |
| **Entry point**        | `SharedCardRenderer.renderCard()` returns `CardHandle { el, cleanup }`                                                             | `CardRenderer` function component returns JSX wrapping `Card` components                                                                                                                         |
| **Element stability**  | Card DOM is stable after creation — no automatic re-renders                                                                        | Preact re-renders on signal/state change; DOM elements reused via `key={card.path}`                                                                                                              |
| **Mid-interaction**    | Safe — DOM won't mutate unless explicitly called                                                                                   | Unsafe — data signal changes can trigger re-render during hover, scroll, or drag                                                                                                                 |
| **Surgical updates**   | `updateCardContent()` consolidates title, subtitle, properties, and text preview DOM surgery                                       | Preact diffs entire card component; no surgical subtree replacement                                                                                                                              |
| **Container**          | Cards appended directly to view-managed container element                                                                          | `CardRenderer` returns a wrapping `div.dynamic-views-grid`/`.dynamic-views-masonry`                                                                                                              |
| **Post-insert passes** | Explicit ordered sequence: responsive classes → scroll gradients → title truncation → text preview clamp → hover scale (grid only) | Not needed — Preact re-render handles layout. `syncResponsiveClasses`, `initializeScrollGradients`, and `initializeTitleTruncation` called as one-shot batch operations, not an ordered pipeline |

## Event handling

|                       | Bases                                                                     | Datacore                                                                              |
| --------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Mechanism**         | Native `addEventListener` with `{ signal }` option                        | JSX event props (`onMouseDown`, `onClick`) + ref callback `addEventListener`          |
| **Lifecycle**         | Attached once at card creation; stable for card lifetime                  | JSX props: re-processed by Preact on every re-render. Ref callbacks: run every render |
| **Cleanup**           | AbortController per card — `signal.abort()` removes all listeners at once | JSX props: auto-managed by Preact. Manual listeners: AbortController or WeakMap       |
| **Reattachment risk** | None — listeners survive until explicit teardown                          | High — naively attached listeners in ref callbacks are destroyed on next re-render    |

## Re-render behavior

|                            | Bases                                         | Datacore                                                                         |
| -------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------- |
| **Frequency**              | Zero automatic re-renders                     | 7+ re-renders per card during init; mid-interaction re-renders from data changes |
| **Cause**                  | N/A                                           | Datacore signals (query results, metadata updates, state changes)                |
| **Ref callback impact**    | N/A                                           | Runs on every render — must be idempotent (see WeakMap pattern below)            |
| **`setIcon` calls**        | One-shot at creation time                     | Must guard with `!el.hasChildNodes()` to avoid redundant DOM clear-and-rebuild   |
| **Stateful behavior**      | Instance properties on `SharedCardRenderer`   | Module-level `WeakMap<HTMLElement, ...>` keyed by DOM element (not card path)    |
| **Cross-container safety** | N/A — each view has its own renderer instance | `Map<string, ...>` keyed by `card.path` collides across containers; use WeakMap  |

### The WeakMap pattern (Datacore only)

For state that must survive re-renders and avoid path collisions, use `WeakMap<HTMLElement, ...>`. Full details in [datacore-ref-callback-patterns.md](../patterns/datacore-ref-callback-patterns.md).

Key properties:

- **Idempotent**: checks `existing.signal.aborted` before re-attaching
- **No path collisions**: keyed by DOM element, not `card.path`
- **Auto-cleanup**: entries GC'd with the element
- **Key stability**: cards keyed by `card.path` in JSX, so Preact reuses the same DOM element

Current usages: `cardHoverIntentState` (cover hover zoom), `cardHoverIntentActive` (card-level hover intent), `containerCleanupMap` (container cleanup functions), `containerCssClassesMap` (previous cssclasses tracking to avoid unnecessary DOM mutations).

## `document`/`window` scope

Both backends must handle Electron popout windows. Full details in `electron-popout-quirks.md` (plugins-level docs).

|                           | Bases                                                                                           | Datacore                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Observer construction** | `getOwnerWindow(cardEl).ResizeObserver` / `.IntersectionObserver`                               | Same — `getOwnerWindow(containerRef.current).ResizeObserver`                                |
| **rAF**                   | `getOwnerWindow(cardEl).requestAnimationFrame()`                                                | Same pattern                                                                                |
| **Module-scope pitfall**  | `measureCanvas` uses `document.createElement('canvas')` — intentional (never inserted into DOM) | Same `measureCanvas` (Datacore calls `initializeTitleTruncation` from [shared-renderer.ts](../../src/bases/shared-renderer.ts)) |
| **Shared utility**        | `getOwnerWindow()` from `utils/owner-window.ts` — both backends import it                       | Same                                                                                        |

`PLUGIN_SETTINGS_CHANGE` is dispatched via `app.workspace.trigger()` in [persistence.ts](../../src/persistence.ts). Bases views ([grid-view.ts](../../src/bases/grid-view.ts)/[masonry-view.ts](../../src/bases/masonry-view.ts)) listen via `registerEvent((this.app.workspace as Events).on(PLUGIN_SETTINGS_CHANGE, ...))` for auto-cleanup on view unload. Datacore ([controller.tsx](../../src/datacore/controller.tsx)) listens via `(app.workspace as Events).on()` inside a `useEffect` with `offref` cleanup. The `as Events` cast is needed because `Workspace.on()` overloads don't accept custom event strings. `app.workspace` is a shared JS object across all Electron windows, so popout views receive the event correctly.

**Rule**: Never use bare `document`, `window`, `ResizeObserver`, `IntersectionObserver`, or `requestAnimationFrame` for elements that may be in a popout. Derive from `el.ownerDocument` / `el.ownerDocument.defaultView`.

## DOM hierarchy

|                      | Bases                                                                           | Datacore                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Outer wrapper**    | `.dynamic-views` (view container)                                               | `div.dynamic-views` (returned by `View` in [controller.tsx](../../src/datacore/controller.tsx)); its parent (Datacore code block container) is not plugin-controlled |
| **Layout container** | `.dynamic-views-masonry` or `.dynamic-views-grid`                               | `div.dynamic-views-masonry` or `div.dynamic-views-grid` (returned by `CardRenderer`)                                              |
| **Group sections**   | `.dynamic-views-group-section` → `.masonry-container` / CSS Grid                | Flat — no group sections (Datacore doesn't support grouping yet)                                                                  |
| **Card DOM**         | Identical class names and nesting — see [card-dom-structure.md](card-dom-structure.md) for divergences | Same                                                                                                                              |

## Settings and state

> For the full resolution chain, sparse storage, stale config guards, and template system, see [settings-resolution.md](settings-resolution.md).

|                     | Bases                                                                                                   | Datacore                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Settings source** | `.base` YAML → Obsidian Bases API: `config.get()`, `config.getOrder()`                                  | Code block markers + `persistenceManager.getDatacoreState(queryId)`                                   |
| **Settings type**   | `BasesResolvedSettings` = `PluginSettings & ViewDefaults` + `_displayNameMap`, `_skipLeadingProperties` | `ResolvedSettings` = `PluginSettings & ViewDefaults & DatacoreDefaults` + `_displayNameMap`           |
| **Property layout** | `rightPropertyPosition` applied via `applyViewContainerStyles()` (see [property-layout.md](property-layout.md))             | `rightPropertyPosition` not consumed — known parity gap (see [property-layout.md](property-layout.md))                    |
| **View ID**         | YAML `id` field in `.base` file                                                                         | 6-char query ID string in code block                                                                  |
| **UI state**        | `BasesUIState { collapsedGroups }` per view ID                                                          | `DatacoreState { sortMethod, viewMode, widthMode, searchQuery, resultLimit, settings? }` per query ID |
| **Persistence**     | `persistenceManager.getBasesState(viewId)` / `setBasesState()`                                          | `persistenceManager.getDatacoreState(queryId)` / `setDatacoreState()`                                 |
| **Settings sync**   | Bases API handles it natively                                                                           | `layout-change` workspace event triggers re-read; `PLUGIN_SETTINGS_CHANGE` via `app.workspace`         |
| **Sparse storage**  | Only `collapsedGroups` stored; empty → entry deleted                                                    | Only non-default values stored; all defaults → entry deleted                                          |

## Cleanup

|                            | Bases                                                                                  | Datacore                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Primary mechanism**      | `SharedCardRenderer.cleanup()` iterates instance arrays                                | `dc.useEffect` unmount return + exported `cleanupAll*()` functions                                  |
| **Per-card teardown**      | `CardHandle.cleanup()` — aborts card AbortController, disconnects observers            | Ref callback `el === null` branch calls `cleanupCardScrollListeners(card.path)`                     |
| **AbortController scope**  | One per card, stable for card lifetime                                                 | `scrollController`: recreated every render (re-render problem). WeakMap state: stable               |
| **Instance arrays**        | `cardAbortControllers[]`, `propertyObservers[]`, `slideshowCleanups[]`, `cardScopes[]` | Module-level Maps: `cardScrollAbortControllers`, `cardResponsiveObservers`, `cardPropertyObservers` |
| **Cross-container safety** | Each view has its own `SharedCardRenderer` instance                                    | Module-level Maps keyed by `card.path` — collision risk across containers                           |

## Shared infrastructure

`src/shared/` contains cross-backend code, but not all files serve both backends.

### Used by both backends

| Module                  | Purpose                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| [constants.ts](../../src/shared/constants.ts)          | Infinite scroll, throttling, batch size constants                                                 |
| [data-transform.ts](../../src/shared/data-transform.ts)     | Normalizes Datacore/Bases data → `CardData` interface                                             |
| [content-loader.ts](../../src/shared/content-loader.ts)     | Async image/text loading with dedup                                                               |
| [image-loader.ts](../../src/shared/image-loader.ts)       | Image aspect ratio caching + fallbacks                                                            |
| [context-menu.ts](../../src/shared/context-menu.ts)       | Right-click menus for cards/links                                                                 |
| [scroll-gradient.ts](../../src/shared/scroll-gradient.ts)    | Horizontal/vertical gradient masks for scrollable content                                         |
| [keyboard-nav.ts](../../src/shared/keyboard-nav.ts)       | Arrow key focus management                                                                        |
| [hover-intent.ts](../../src/shared/hover-intent.ts)       | Mousemove-after-mouseenter hover intent utility                                                   |
| [property-measure.ts](../../src/shared/property-measure.ts)   | Property field width measurement + scroll gradients                                               |
| [property-helpers.ts](../../src/shared/property-helpers.ts)   | Tag/file/formula type checks, pair computation                                                    |
| [render-utils.ts](../../src/shared/render-utils.ts)       | Date/timestamp rendering — accepts both settings types                                            |
| [content-visibility.ts](../../src/shared/content-visibility.ts) | `CONTENT_HIDDEN_CLASS` consumed by [keyboard-nav.ts](../../src/shared/keyboard-nav.ts), [scroll-gradient.ts](../../src/shared/scroll-gradient.ts), [property-measure.ts](../../src/shared/property-measure.ts) |
| [view-validation.ts](../../src/shared/view-validation.ts)    | ViewDefaults validation — used by [persistence.ts](../../src/persistence.ts) (serves both backends)                         |
| [slideshow.ts](../../src/shared/slideshow.ts)          | Card image slideshow (animation + swipe)                                                          |
| [image-viewer.ts](../../src/shared/image-viewer.ts)       | Panzoom image viewer                                                                              |

[data-transform.ts](../../src/shared/data-transform.ts) provides parallel transform functions per backend: `datacoreResultToCardData()` / `transformDatacoreResults()` and `basesEntryToCardData()` / `transformBasesEntries()`.

### Datacore only (despite being in `shared/`)

| Module              | Reason                                                  |
| ------------------- | ------------------------------------------------------- |
| [card-renderer.tsx](../../src/shared/card-renderer.tsx) | Preact JSX — returns JSX components, not imperative DOM |

### Bases only (despite being in `shared/`)

| Module                   | Reason                                                                           |
| ------------------------ | -------------------------------------------------------------------------------- |
| [virtual-scroll.ts](../../src/shared/virtual-scroll.ts)      | Only imported by [bases/masonry-view.ts](../../src/bases/masonry-view.ts)                                         |
| [scroll-preservation.ts](../../src/shared/scroll-preservation.ts) | Only imported by [bases/grid-view.ts](../../src/bases/grid-view.ts) and [bases/masonry-view.ts](../../src/bases/masonry-view.ts)                |
| [settings-schema.ts](../../src/shared/settings-schema.ts)     | Only imported by [bases/utils.ts](../../src/bases/utils.ts), [bases/grid-view.ts](../../src/bases/grid-view.ts), [bases/masonry-view.ts](../../src/bases/masonry-view.ts) |
| [text-preview-dom.ts](../../src/shared/text-preview-dom.ts)    | Only imported by [bases/grid-view.ts](../../src/bases/grid-view.ts) and [bases/masonry-view.ts](../../src/bases/masonry-view.ts)                |

### Bases functions used by Datacore

| Function (from `bases/shared-renderer.ts`) | Purpose                                         |
| ------------------------------------------ | ----------------------------------------------- |
| `syncResponsiveClasses()`                  | Batch compact-mode + thumbnail-stack class sync |
| `initializeTitleTruncation()`              | Canvas-based batch title truncation             |

## Common pitfalls

Bugs that have occurred from backend divergence.

### Workspace event dispatch pattern

`PLUGIN_SETTINGS_CHANGE` is dispatched via `app.workspace.trigger()` and received via `(app.workspace as Events).on()`. The `as Events` cast is required because `Workspace.on()` has typed overloads for built-in events only. Bases views use `registerEvent()` for auto-cleanup on view unload; Datacore uses `useEffect` with `offref` cleanup. Previously dispatched on `document.body`, which failed in popout windows because `document.body` resolves to the main window's body in the module scope.

### Ref callback `setIcon` churn

`setIcon(el, icon)` in a Preact ref callback runs on every re-render (7+ times during init). `setIcon` clears the element before inserting, so no visual duplication occurs, but each call is redundant DOM work (clear + rebuild). **Fix**: Guard with `!el.hasChildNodes()` to skip the call when the icon is already present.

### SCSS `&.class` vs descendant selector for Bases DOM

Bases attaches classes directly to the card element (`.card.image-format-cover`), requiring `&.image-format-cover` in SCSS. Writing `.image-format-cover` as a descendant selector silently matches nothing. This is particularly tricky because the Datacore backend produces the same structure, but the class is set via JSX `className` prop rather than imperative `addClass()`.

### `scrollController` recreation on re-render

Each Datacore `Card` render creates a new `AbortController`. The ref callback aborts the previous one via `cleanupCardScrollListeners(card.path)`. Listeners attached with the old signal are silently removed. **Fix**: Use WeakMap pattern for listeners that must survive re-renders. See [datacore-ref-callback-patterns.md](../patterns/datacore-ref-callback-patterns.md).

### Cross-container `card.path` collision

Module-level `Map<string, AbortController>` keyed by `card.path` in [card-renderer.tsx](../../src/shared/card-renderer.tsx). When the same file appears in two Dynamic Views containers, one container's cleanup aborts the other's signal. **Fix**: Use `WeakMap<HTMLElement, ...>` instead of path-keyed Map.

### Style Settings text preview cache invalidation

Both backends must invalidate cached text previews when Style Settings toggles change (`omitFirstLine`, `keepPreviewHeadings`, `keepPreviewNewlines`), but they use completely different mechanisms:

- **Bases**: `getStyleSettingsHash()` returns a hash of all JS-relevant Style Settings values. On each render cycle, [grid-view.ts](../../src/bases/grid-view.ts)/[masonry-view.ts](../../src/bases/masonry-view.ts) compare `styleSettingsHash !== lastStyleSettingsHash` and clear `contentCache.textPreviews = {}` on mismatch. Simple and total — all cached entries are discarded.
- **Datacore**: `_styleRevision` (a Preact state counter) is bumped by the MutationObserver when body classes change, triggering a re-render. The content loading effect re-runs because `omitFirstLine`/`keepPreviewHeadings`/`keepPreviewNewlines` are in its dependency array. A `prevTextPreviewSettingsRef` tracks a composite key of the three values; when it changes, the cache copy loop is skipped so all text previews reload from scratch.

**Past bug**: Datacore's cache copy loop only checked mtime, not whether Style Settings changed. When SS toggles changed, the effect re-ran but copied stale cached entries forward, so text previews never updated. Fixed by adding the `prevTextPreviewSettingsRef` composite key check.

### Title link structure divergence

Bases: `a.internal-link.card-title-text` (single element with both classes). Datacore: `a.internal-link` wrapping `span.card-title-text`. The inner span exists because `setupTitleTruncation` reads/writes `.card-title-text.textContent` and would destroy ext-suffix children if the link element carried the text class. CSS selectors must account for both structures.
