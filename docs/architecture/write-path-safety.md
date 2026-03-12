---
title: Write path safety
description: Inventories all file write operations, documents allowed APIs, and lists invariants that prevent data corruption.
author: 🤖 Generated with Claude Code
last updated: 2026-03-09
---
# Write path safety

All file write operations in Dynamic Views, the APIs they use, and the invariants that prevent data corruption. Consult before adding new write paths or modifying existing ones.

## Allowed write APIs

| API                                            | Use case                                             | Safety                                |
| ---------------------------------------------- | ---------------------------------------------------- | ------------------------------------- |
| `vault.process()`                              | Atomic read-modify-write for `.base` and `.md` files | Atomic, serialized                    |
| `processFrontMatter()`                         | YAML property changes in `.md` files                 | Atomic, Obsidian-managed YAML         |
| `Plugin.saveData()`                            | Plugin config (`data.json`)                          | Obsidian-managed                      |
| `vault.create()`                               | New file creation only                               | Collision-safe via `getAvailablePath` |
| `config.set()`                                 | Bases-native YAML keys in `.base` files              | Delegates to Obsidian's writer        |
| `editor.replaceRange()` / `replaceSelection()` | Cursor-position insertions                           | Reversible via undo                   |

## Prohibited APIs

### Obsidian plugin guidelines

Required by Obsidian's plugin review process:

- `FileSystemAdapter` direct access without `instanceof` guard — crashes on mobile (`CapacitorAdapter`)
- `vault.adapter.*` over `vault.*` — Vault API has caching and serial operation safety
- Manual YAML parsing of `.md` frontmatter — use `processFrontMatter()` instead
- Manual plugin data I/O — use `Plugin.loadData()` / `Plugin.saveData()` instead

### Self-imposed

Not required by Obsidian guidelines, but enforced in this plugin for safety:

- `vault.modify()` — non-atomic, races with `vault.process()`
- `vault.adapter.write()` / `adapter.writeBinary()` / `adapter.append()` — raw filesystem, bypasses caching
- `vault.delete()` / `vault.trash()` / `vault.rename()` — the plugin must NEVER delete, trash, or rename user files

## Write path inventory

### 1. `.base` file cleanup — `vault.process()` + `stringifyYaml()`

- **Location**: `src/bases/utils.ts`, `cleanUpBaseFile()`
- **Trigger**: Automatic on first render of any DV view
- **Scope**: Parses `.base` YAML, removes stale DV keys, resets invalid enums, assigns persistence IDs, applies template defaults, re-serializes
- **Guards**: `try/catch` on `parseYaml` returns original content; `changeCount === 0` skips rewrite; caller-view guard prevents race with `config.set()`
- **Accepted risk**: `ALLOWED_VIEW_KEYS` allowlist strips unrecognized keys — forward-compatibility risk if Obsidian adds new Bases-native view keys, accepted to prevent stale key accumulation

### 2. Markdown checkbox toggle — `processFrontMatter()`

- **Location**: `src/bases/shared-renderer.ts`, `src/shared/card-renderer.tsx`
- **Trigger**: User clicks a checkbox property on a card
- **Scope**: Sets a single boolean in the note's YAML frontmatter
- **Guards**: `instanceof TFile` check before write
- **Mitigation**: `.catch()` logs errors to console, preventing silent UI/data desync

### 3. Datacore query sync — `vault.process()` + string replacement

- **Location**: `src/datacore/controller.tsx`, `src/datacore/query-sync.ts`
- **Trigger**: User edits a DQL query in the toolbar
- **Scope**: Replaces query text between DQL START/END markers in the code block
- **Guards**: Returns original content if markers not found; `isSyncing`/`pendingSync` serializes concurrent writes

### 4. Plugin data — `Plugin.saveData()`

- **Location**: `src/persistence.ts`, `PersistenceManager.save()`
- **Trigger**: Any settings/state change
- **Scope**: Writes sparse plugin config to `data.json`
- **Guards**: Input sanitization via `sanitizeObject`; `searchQuery` truncated to 500 chars

### 5. New file creation — `vault.create()`

- **Location**: `main.ts` (commands), `src/datacore/controller.tsx` (toolbar)
- **Trigger**: User invokes create command
- **Scope**: Creates new `.md` or `.base` files with template content
- **Guards**: `getAvailablePath` / `getAvailableBasePath` prevents name collisions; `try/catch` with Notice

### 6. Bases config — `config.set()`

- **Location**: `src/bases/utils.ts`
- **Trigger**: Template toggle reset on render, user toggle
- **Scope**: Sets `isTemplate` key in `.base` YAML

### 7. Editor insertion — `editor.replaceRange()` / `replaceSelection()`

- **Location**: `main.ts`
- **Trigger**: User insert command, card drag-and-drop into editor
- **Scope**: Inserts query template or wiki link at cursor position

## Invariants

1. **All writes to user `.md` files MUST be user-initiated.** No automatic background writes to notes.
2. **`parseYaml` failures MUST return original content unchanged.** Never propagate parse errors into file writes.
3. **Fire-and-forget writes MUST have `.catch()` handlers** to prevent silent UI/data desync.
