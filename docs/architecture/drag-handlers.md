---
title: Drag handlers
description: Drag handler factory system, platform quirks, hover suppression strategy, and dataset freshness pattern for stale closures.
author: 🤖 Generated with Claude Code
updated: 2026-03-16
---
# Drag handlers

The plugin supports four drag types, all implemented as factory functions in [`drag.ts`](../../src/shared/drag.ts). Each factory returns an event handler (or handler set) that both Bases and Datacore backends wire up at their respective call sites. A `DataTransfer.prototype.getData` patch (`installDropTextPatch`) suppresses Chromium's platform-level `text/uri-list` for plugin-initiated drags.

## Factory functions

| Factory | Drag source | DataTransfer content | Notes |
|---|---|---|---|
| `createTagDragHandler` | Tag chip | `text/plain`: `#tag` | Nullifies `app.dragManager.draggable` so editor's dragover accepts via else-path |
| `createCardDragHandler` | Card / title | Obsidian link drag | Delegates to `app.dragManager.dragLink` |
| `createExternalLinkDragHandler` | External link `<a>` | `text/plain`: URL, or `[caption](url)` when caption differs from URL | Uses `DRAG_MARKER` MIME for `text/uri-list` suppression |
| `createUrlButtonDragHandlers` | URL button `<a>` | `text/plain`: URL | Returns `{ onDragStart, onDragEnd, onTouchStart }` + registers mousedown internally |

## DataTransfer and drop behavior

Native `<a href>` drag auto-populates `text/uri-list`, `text/html`, and `text/plain`. Obsidian's drop handler prefers `text/uri-list` and wraps as `[url](url)`. To insert plain URL text:

1. `clearData()` strips all native types (does NOT affect the drag ghost — ghost uses `textContent`)
2. `setData(DRAG_MARKER, '')` marks the drag as plugin-initiated
3. `setData('text/plain', url)` sets the drop text

The `getData` patch returns `''` for `text/uri-list` when `DRAG_MARKER` is present, causing Obsidian to skip wrapping and let CodeMirror's native handler insert `text/plain` directly. The patch must be applied per-window (each Electron `BrowserWindow` has its own `DataTransfer.prototype`). See [`electron-popout-quirks.md`](../../../knowledge/electron-popout-quirks.md).

### `effectAllowed`

`effectAllowed = 'copyLink'` allows both copy and link operations. `'link'` alone rejects drops into CodeMirror (uses `dropEffect = 'copy'`). The `copy` bit re-enables the macOS `+` badge (see platform quirks below), but working drops are more important than cosmetic suppression.

## Hover suppression on dragstart

Three JS-toggled classes control hover effects: `hover-intent-active`, `poster-hover-active`, `cover-hover-active`. All are removed on dragstart, but with constraints:

**Card-level handlers** (`createCardDragHandler`, Bases `handleDrag`): remove all three synchronously via `clearCardHoverState()`.

**URL button handlers** (`createUrlButtonDragHandlers`): remove `hover-intent-active` and `cover-hover-active` synchronously, but **defer** `poster-hover-active` removal via `setTimeout(0)`. This is because `poster-hover-active` controls `pointer-events: auto` on `.card-content` — synchronous removal sets `pointer-events: none`, aborting the drag before the drag subsystem takes over. The deferred removal runs after dragstart completes.

The deferred `setTimeout(0)` also sets `pointer-events: none` on the icon itself, clearing the stuck `:hover` pseudo-class (Chromium keeps `:hover` on the drag source throughout the drag operation — see platform quirks).

## iOS touch handling

iOS native touch drags bypass the HTML5 DnD API entirely — `dragstart` and `dragend` never fire (see `ios-webkit-quirks.md`). Only drop-target events fire on the receiving element. Cleanup logic in `onDragEnd` (tooltip removal, pointer-events restore, body class removal) needs an alternative path.

**`onTouchStart` fallback**: Registers a document-level `drop` listener that runs the same `cleanup` function as `onDragEnd`. A `touchend` listener (also `{ once: true }`) removes the `drop` listener if the touch ends without initiating a drag.

**Deferred tooltip interception**: Obsidian creates a `.tooltip` element from the icon's `aria-label` ~1-2s after native drag ends — well after `drop` fires. The `cleanup` function installs a MutationObserver on `document.body` that watches for tooltip creation, scoped to `urlValue` text match to avoid removing unrelated tooltips. The observer disconnects after 3 seconds.

**Click handler tooltip removal**: All three call sites (Bases shared-renderer, Datacore card-renderer) also remove `.tooltip` synchronously in the URL button `click` handler. This covers the iPad scenario where pressing the button opens Safari, and the tooltip persists when switching back to Obsidian.

## Platform quirks

### Chromium `draggable` attribute states

HTML `draggable` has three states: `"true"`, `"false"` (actively suppresses drag on children), and absent/auto (doesn't suppress). `draggable="false"` on a parent `<div>` prevents native drag initiation on child `<a href>` elements. Preact can't produce the absent state — `undefined` coerces to `false` via the DOM property. Fix: `removeAttribute('draggable')` in the ref callback (runs after Preact's prop application).

### Chromium drag source resolution

When both parent (`draggable="true"`) and child (`<a href>`, natively draggable) exist, Chromium picks the drag source BEFORE dispatching `dragstart`. `stopPropagation()` can't change the source — the browser has already decided. Fix: ensure only one draggable element exists (e.g., remove parent's `draggable` attribute for poster cards).

### Synchronous `pointer-events: none` aborts drag

Removing a class during `dragstart` that causes `pointer-events: none` on the drag source aborts the drag immediately (dragstart → dragend, no drag events). Style recalc from class removal is synchronous within the event handler. The browser checks `pointer-events` after `dragstart` completes and aborts if `none`. Hover class removal on dragstart is only safe for elements that DON'T have `pointer-events` gated by the class being removed.

### `:hover` persists during drag

Chromium keeps `:hover` on the drag source element throughout the drag operation. `pointer-events: none` via `setTimeout(0)` removes the element from hit-testing, which eventually clears the pseudo-class — but NOT immediately. The pseudo-class persists until the next hit-test triggered by actual mouse movement.

### macOS `+` badge flash (Chromium bug 40860622)

macOS calls `sourceOperationMaskForDraggingContext:` BEFORE Chromium dispatches the JS `dragstart` event. `effectAllowed: "uninitialized"` maps to `NSDragOperationEvery`, showing the `+` (copy) badge. ALL JS-level fixes exhausted: `effectAllowed` variations (`copyLink`, `link`, capture-phase `move`), `stopPropagation` removal, `-webkit-user-drag: none` (breaks drag entirely). VS Code has the same limitation.

### Preact JSX event props interfere with drag

Preact's JSX event props (`onDragStart`, etc.) interfere with Chromium's drag lifecycle — `<a href>` fails intermittently, `<div draggable>` aborts immediately. `el.textContent` mutation during `dragstart` also disrupts drag on Preact-managed elements. Fix: native `addEventListener` in ref callbacks (card-level drag also uses `stopImmediatePropagation()` to prevent Preact's synthetic handler from interfering). See [`datacore-ref-callback-patterns.md`](../patterns/datacore-ref-callback-patterns.md) for the `__dragBound` guard pattern.

## Drag ghost

URL button uses the native `<a href>` ghost (Chromium renders a 2-line ghost: title + URL). A hidden `<span class="dynamic-views-drag-text">` provides `textContent` for the ghost. Uses sr-only pattern (`clip: rect(0,0,0,0)`, `position: absolute`, 1×1px) — NOT `display:none`/`visibility:hidden` which exclude from ghost capture. The ghost text is refreshed on re-render via `dragText.textContent = card.urlValue` (both Bases and DC use direct DOM mutation in their ref callbacks).
