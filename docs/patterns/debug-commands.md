---
title: Debug commands
description: Console-invokable diagnostic commands for runtime debugging — layout inspection.
author: 🤖 Generated with Claude Code
updated: 2026-03-15
---
# Debug commands

Runtime diagnostic commands invokable from the developer console (Cmd+Opt+I on Mac, Safari Inspector on mobile). All commands are idempotent — safe to run multiple times.

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
