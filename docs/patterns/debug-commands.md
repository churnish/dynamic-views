---
title: Debug commands
description: Console-invokable diagnostic commands for runtime debugging — sync verification, layout inspection.
author: 🤖 Generated with Claude Code
updated: 2026-03-15
---
# Debug commands

Runtime diagnostic commands invokable from the developer console (Cmd+Opt+I on Mac, Safari Inspector on iOS). All commands are idempotent — safe to run multiple times.

## Sync notice

Confirms that a new build reached a device after iCloud sync. Shows an auto-incrementing number as a persistent Notice on each plugin load.

**Use case**: Build on Mac → iCloud syncs `main.js` to iOS → reload plugin on iOS → notice confirms new code is running.

| Action | Command |
|---|---|
| Enable | `app.saveLocalStorage('dynamic-views-sync-notice', '0')` |
| Disable + reset | `app.saveLocalStorage('dynamic-views-sync-notice', null)` |

- **State**: Stored in `localStorage` via Obsidian's `App#saveLocalStorage` — per-device, persists across reloads.
- **Counter**: Increments in `onload()`. Each hot-reload or manual plugin reload bumps the number.
- **Notice**: Duration 0 (persists until dismissed).
- **Source**: `main.ts`, `SYNC_NOTICE_KEY` constant.

## Card width badges

Overlays a pixel-width badge on every card across all windows (main + popouts). Badges update live via ResizeObserver — useful for debugging column widths, responsive breakpoints, and grid/masonry sizing.

| Action | Command |
|---|---|
| Show / refresh | `app.plugins.plugins['dynamic-views'].debugWidths()` |
| Remove | Run the same command again (idempotent — clears existing badges before reapplying) |

- **Badge**: Monospace `{width}px` label, top-right corner of each card, `z-index: 9999`.
- **Live updates**: Each badge has its own `ResizeObserver` on the card element. Disconnected on removal.
- **Popout-safe**: Uses `getAllPopoutDocuments()` and per-window `ResizeObserver` constructor.
- **Source**: `main.ts`, `debugWidths()` method.
