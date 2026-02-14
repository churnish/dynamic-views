---
title: Obsidian API quirks
description: >-
  Undocumented Obsidian API behaviors discovered during Dynamic Views
  development. Covers file write timing, race conditions, and workarounds.
author: 🤖 Generated with Claude Code
last updated: 2026-02-13
---

## Debounced disk writes (~2 seconds)

Obsidian debounces all file writes via `TextFileView.requestSave` with a **2-second** delay (documented in the TypeScript API). This applies globally — Markdown files, `.base` files, and any file managed by Obsidian's editor system.

### Implication for `vault.process()`

`vault.process(file, fn)` reads the file **from disk**, not from Obsidian's in-memory state. If Obsidian has pending in-memory changes that haven't been flushed (within the ~2s debounce window), `vault.process()` reads stale content. Writing back the transformed result overwrites the file **without** the pending changes, causing data loss.

### Known race condition

When a user creates a new Bases view and quickly switches its type (e.g., table → dynamic-views-grid), the new view exists in Obsidian's memory but not on disk. If `vault.process()` runs within the debounce window, it reads the file without the new view, rewrites it, and the view is lost. Obsidian then shows "View X not found."

### Guard (Dynamic Views)

`cleanUpBaseFile()` accepts a `callerViewName` parameter. The `vault.process()` callback checks that the caller's view name exists in the parsed views array before modifying the file. If it's missing (stale disk read), the callback returns the original content unchanged, preventing data loss.

## Notice container stale cache

> Observed in Obsidian **1.12.1** (Catalyst), installer 1.11.4.

Obsidian caches the `.notice-container` DOM element in a `Map<Window, HTMLDivElement>` keyed by `activeWindow`. When the last notice in a container fades out, `Notice.hide()` detaches both the notice element and the empty container from the DOM — but does **not** remove the Map entry.

On the next `new Notice()`, the constructor finds the cached (but detached) container via `Map.get(activeWindow)`, appends the new notice to it, and never re-attaches the container to `document.body`. The notice is invisible.

### When it triggers

This only affects notices created **after all previous notices have fully faded** (animation complete + detach). If notices overlap (a new one while another is still visible), the container stays in the DOM and the bug doesn't manifest.

### Workaround

After `new Notice()`, check if the container is connected and re-attach if stale:

```typescript
const notice = new Notice("...");
const nc = (notice as { containerEl?: HTMLElement }).containerEl?.parentElement;
if (nc && !nc.isConnected) {
  activeWindow.document.body.appendChild(nc);
}
```

### Where applied

`handleTemplateToggle()` in `src/bases/utils.ts` — the one-shot template save notice.
