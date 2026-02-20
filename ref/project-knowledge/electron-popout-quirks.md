---
title: Electron popout window quirks
description: Platform-specific quirks when running plugin code in Electron popout (BrowserWindow) windows.
author: 🤖 Generated with Claude Code
last updated: 2026-02-21
---
# Electron popout window quirks

Obsidian's "Open in new window" creates an Electron `BrowserWindow` (popout) with a separate V8 isolate and separate document. Plugin JS runs in the main window's context but operates on DOM elements in the popout's document. This causes several non-obvious issues.

## Module-scope `document`/`window` resolve to main window

All bare references to `document`, `window`, `requestAnimationFrame`, `ResizeObserver`, etc. at module scope resolve to the main window. For popout-aware code, derive from the element:

```ts
const doc = el.ownerDocument;
const win = doc.defaultView ?? window;
win.requestAnimationFrame(() => { ... });
new win.ResizeObserver((entries) => { ... });
```

**Affected APIs**: `document.body`, `document.activeElement`, `document.hasFocus()`, `document.createElement()`, `window.innerWidth/innerHeight`, `window.focus()`, `ResizeObserver`, `IntersectionObserver`, `requestAnimationFrame`, `addEventListener` on `document`/`window`.

## Cross-context observers silently fail

`ResizeObserver` and `IntersectionObserver` created in the main window's JS context silently fail to observe elements in a popout's DOM. The constructor must come from the popout's window:

```ts
// Wrong: uses main window's RO constructor
new ResizeObserver(callback).observe(popoutElement);

// Right: uses popout's RO constructor
const win = popoutElement.ownerDocument.defaultView ?? window;
new win.ResizeObserver(callback).observe(popoutElement);
```

Diagnostic: `ownerDocument.defaultView.ResizeObserver !== window.ResizeObserver` → `true` in popouts.

## No re-hit-test after overlay removal

After removing a DOM overlay (`cloneEl.remove()`), Electron popout windows do **not** recalculate `:hover` or dispatch `mouseenter`/`mouseleave` on elements that were underneath. In the main window, `:hover` updates after a `requestAnimationFrame`; in popouts, it stays stale indefinitely.

**Impact**: Any code that checks `element.matches(":hover")` or waits for `mouseenter` after removing an overlaying element will get incorrect results in popouts.

**Workaround**: Apply state changes (e.g., class additions) directly rather than depending on browser re-hit-testing. See `closeImageViewer()` in `image-viewer.ts` for an example.

## Panzoom `isAttached` check

The `@panzoom/panzoom` library's `isAttached` check walks up the DOM to find `document` (module scope). In popouts, the element is in a different document, so the check fails. Workaround: temporarily reparent the container to `document.body` during init, then move it back. See `setupImageViewerGestures()` in `image-viewer.ts`.

## Event listener binding

Libraries that bind event listeners to module-scope `document` (e.g., `pointermove`, `pointerup` for drag handling) will miss events in popouts since pointer events fire on the popout's document. Must rebind to the popout's document after init. See panzoom rebinding in `image-viewer.ts`.

## `defaultView` is null after window close

When a popout's `BrowserWindow` is closed, `ownerDocument.defaultView` returns `null` for elements that were in that document. Cleanup code that derives the window via `containerEl.ownerDocument.defaultView` must null-check — otherwise a `?? fallback` pattern may trigger unintended global behavior (e.g., cleaning up all windows' observers instead of just the closed one).

```ts
// Wrong: falls through to global cleanup when window is gone
cleanupObserver(el.ownerDocument.defaultView ?? undefined);

// Right: skip cleanup — observer dies with its window
const win = el.ownerDocument.defaultView;
if (win) cleanupObserver(win);
```

## ResizeObserver doesn't fire for minimized windows

Electron does not dispatch `ResizeObserver` callbacks for minimized `BrowserWindow` instances. The window must be restored/shown before testing RO-based behavior. This applies to both main and popout windows.
