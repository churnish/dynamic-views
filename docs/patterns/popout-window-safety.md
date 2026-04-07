---
title: Popout window safety
description: When and why to use getOwnerWindow(el) instead of bare window/document — covers cross-window pitfalls in Electron popout windows, the safe exceptions, and the setDocumentProvider pattern for module-level code.
author: 🤖 Generated with Claude Code
updated: 2026-04-06
---
# Popout window safety

Obsidian's "Open in new window" creates an Electron `BrowserWindow` with a separate `document` and `window` object (but sharing the same V8 isolate and JS heap). Plugin JS runs in the main window's context, but operates on DOM elements that may live in a popout's document. Bare `window`/`document` references always resolve to the main window — using them on popout elements causes silent failures: observers that never fire, `getComputedStyle` that reads the wrong stylesheet, `requestAnimationFrame` IDs that can't be cancelled.

For the full list of cross-window pitfalls (silent observer failures, stale hit-testing, `instanceof` failures, RAF ID scoping, `defaultView` null after close), see `odkb/electron-popout-quirks.md`.

## Core rule: derive from DOM

In `src/shared/` and `src/bases/`, never use bare `document`, `window`, `new ResizeObserver`, `new IntersectionObserver`, `getComputedStyle`, `matchMedia`, `navigator`, or `document.createElement`. Always derive the correct window/document from the nearest DOM element.

Two patterns cover all cases:

| Pattern | When to use |
|---|---|
| `getOwnerWindow(el)` | Need the `Window` object (for constructors, `requestAnimationFrame`, `getComputedStyle`) |
| `el.ownerDocument` | Need the `Document` object (for `createElement`, `createRange`, `body`, `activeElement`, event dispatch) |

## `getOwnerWindow(el)`

Defined in `src/utils/owner-window.ts`:

```ts
export function getOwnerWindow(el: Element | null | undefined): Window & typeof globalThis {
  return el?.ownerDocument?.defaultView ?? window;
}
```

Walks `el.ownerDocument.defaultView` to get the window that owns the element. Falls back to the main `window` when the element is null or its window has been closed (`defaultView` returns null after a popout closes).

### Usage categories

**Constructors** — observers created from the wrong window silently fail on popout elements:

```ts
const win = getOwnerWindow(scrollContainer);
new win.IntersectionObserver(callback, { root: scrollContainer });
new win.ResizeObserver(callback);
```

**`requestAnimationFrame`** — RAF IDs are scoped per window; cancelling on the wrong window is a silent no-op:

```ts
getOwnerWindow(cardEl).requestAnimationFrame(() => { ... });
```

**`getComputedStyle`** — must read from the element's own window to get correct values:

```ts
getOwnerWindow(wrapper).getComputedStyle(wrapper).fontSize;
```

### Call sites

`getOwnerWindow` is used across most of `src/shared/` and `src/bases/`: `content-visibility.ts`, `hover-and-touch.ts`, `icon-alignment.ts`, `image-loader.ts`, `keyboard-nav.ts`, `poster.ts`, `property-helpers.ts`, `property-measure.ts`, `scroll-gradient.ts`, `scroll-preservation.ts`, `slideshow.ts`, `text-preview-dom.ts`, `thumbnail-scrub.ts`, `context-menu.ts`, `image-viewer.ts`, `shared-renderer.ts`, `masonry-view.ts`.

## `el.ownerDocument`

Use when you need the `Document` rather than the `Window` — element creation, range creation, body class reads, event dispatch, or `activeElement` checks:

```ts
// Create elements in the correct document
const div = cardEl.ownerDocument.createElement('div');
const textNode = cardEl.ownerDocument.createTextNode(title);

// Read body classes from the correct document
const body = cardEl.ownerDocument.body;

// Dispatch events on the correct document
cardEl.ownerDocument.dispatchEvent(new CustomEvent(PROPERTY_MEASURED));

// Check active element in the correct window
const active = scrollEl.ownerDocument.activeElement;
```

When you need both `Document` and `Window`, use `ownerDocument` for document operations and `getOwnerWindow` for window operations — don't chain `ownerDocument.defaultView` manually (the utility handles the null fallback).

## `setDocumentProvider` — module-level code

Some module-level code needs to iterate over all open documents (main + popouts) but has no DOM element in scope to derive from. The `setDocumentProvider` pattern solves this: a module-level setter is registered from `main.ts` onload.

In `src/shared/slideshow.ts`:

```ts
let getDocuments: () => Document[] = () => [document];

export function setDocumentProvider(fn: () => Document[]): void {
  getDocuments = fn;
}
```

In `main.ts`:

```ts
setDocumentProvider(() => [document, ...this.getAllPopoutDocuments()]);
```

`getAllPopoutDocuments()` walks Obsidian's undocumented `floatingSplit` to collect all popout documents:

```ts
getAllPopoutDocuments(): Document[] {
  const floating = (
    this.app.workspace as unknown as {
      floatingSplit?: { children: { doc: Document }[] };
    }
  ).floatingSplit?.children;
  return floating ? floating.map((w) => w.doc) : [];
}
```

The default `() => [document]` provides a safe fallback before plugin initialization. After `onload`, the provider returns all documents — enabling operations like cleaning up slideshow blob URLs across every open window.

Use this pattern only when there is genuinely no DOM element available. If you have any element, prefer `getOwnerWindow(el)` or `el.ownerDocument`.

## Safe exceptions

These bare global usages are safe and do not need the DOM-derived pattern:

| Usage | Why it's safe |
|---|---|
| `document.body.classList` reads for config classes | Style Settings syncs body classes to all documents (main + popouts). The main `document.body` is the canonical source — always available, no popout lifecycle dependency. |
| `setTimeout` / `setInterval` / `requestIdleCallback` | Process-level timers, not window-scoped. Fire regardless of which window scheduled them. |
| `new Image()` for network validation | Never inserted into DOM — used only to test whether a URL loads. No document context matters. |
| Offscreen `document.createElement('canvas')` for measurement | Would be safe if used (never inserted into a visible document), but the codebase currently uses the popout-safe `ownerDoc.createElement('canvas')` pattern instead. |

## Common mistakes

- **`new ResizeObserver(cb).observe(popoutEl)`** — uses the main window's `ResizeObserver` constructor. The observer silently never fires. Use `new getOwnerWindow(popoutEl).ResizeObserver(cb)`.
- **`window.requestAnimationFrame(cb)` then `window.cancelAnimationFrame(id)`** — if the element is in a popout, the RAF runs in the main window's frame loop (wrong timing) and cancellation may target the wrong ID pool. Use `getOwnerWindow(el).requestAnimationFrame(cb)`.
- **`getComputedStyle(el)` without qualifying the window** — reads from the main window's style context, which may return different values if the popout has different viewport dimensions. Use `getOwnerWindow(el).getComputedStyle(el)`.
- **`document.createElement('div')` for visible DOM** — creates the element in the main window's document. Appending it to a popout element works but can cause `instanceof` failures and style resolution issues. Use `el.ownerDocument.createElement('div')`.
- **Cancelling RAF after nullifying the window reference** — the `?? window` fallback targets the main window, making the cancel a no-op. Always cancel before clearing the reference. See `odkb/electron-popout-quirks.md` for details.
