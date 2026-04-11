---
title: Config reactivity
description: How config changes propagate from onDataUpdated through dirty-checking, render hash comparison, and the CSS fast-path to re-render decisions — covers all hash inputs, stale config guards, incremental update paths, and Style Settings reactivity.
author: 🤖 Generated with Claude Code
updated: 2026-04-12
---
# Config reactivity

See also: [`odkb/electron-popout-quirks.md`](https://github.com/churnish/odkb/blob/main/electron-popout-quirks.md)

The plugin's reactivity pipeline decides what to re-render when a config value, file content, or Style Settings option changes. It separates instant CSS updates from expensive DOM rebuilds and uses a composite render hash to skip redundant work. Both Grid and Masonry views share the same pipeline structure — file paths below reference `grid-view.ts` but the Masonry equivalents are structurally identical.

## Pipeline overview

```
Obsidian fires onDataUpdated()
  │
  ├─ applyCssOnlySettings()          ← immediate, no throttle
  ├─ initializeTextPreviewClamp()    ← re-measure clamped text
  │
  └─ queueMicrotask → processDataUpdate()
       │
       ├─ shouldProcessDataUpdate()  ← hybrid throttle (may reject)
       ├─ guards: !data, isLoading   ← bail if no data yet
       ├─ cleanUpBaseFile()          ← first render or view rename only
       ├─ readBasesSettings()        ← 3-layer merge + stale guards
       ├─ build renderHash           ← 10-component composite
       │
       ├─ renderHash unchanged + cards exist + no changedPaths?
       │    └─ EARLY RETURN (skip re-render)
       │
       ├─ changedPaths > 0 + settings stable + order unchanged?
       │    └─ updateCardsInPlace()  ← incremental content update
       │
       ├─ settings changed + only property order differs?
       │    └─ updatePropertyOrder() ← surgical property reorder
       │
       └─ otherwise
            └─ FULL RE-RENDER
```

## Trigger: `onDataUpdated()`

Obsidian calls `onDataUpdated()` on the view instance whenever the `.base` file config changes, query results update, or file metadata changes. The callback receives no arguments — it reads state from `this.config`, `this.data`, and `this.containerEl`.

**Additional trigger sources** (plugin-internal):

| Source | When |
|---|---|
| `setupStyleSettingsObserver()` callback | Style Settings class or CSS variable changes |
| `layout-change` workspace event | View moves to/from popout window |
| `PLUGIN_SETTINGS_CHANGE` event | Plugin settings tab save |
| `foldAllGroups()` / `unfoldAllGroups()` | Manual group collapse toggle |

**Why `queueMicrotask`**: Obsidian may fire `onDataUpdated()` before `config.getOrder()` reflects the new property order. The microtask delay gives Obsidian time to finish updating config state. The early-return guard also schedules delayed re-checks at 100/250/500ms as a safety net for late config updates.

## CSS fast-path

`applyCssOnlySettings()` runs synchronously inside `onDataUpdated()`, before the microtask-deferred `processDataUpdate()`. This provides instant visual feedback for settings that only affect CSS custom properties.

**CSS-only settings** (defined in `CSS_ONLY_SETTINGS_KEYS`, `constants.ts`):

| Setting | CSS mechanism |
|---|---|
| `textPreviewLines` | `--dynamic-views-text-preview-lines` |
| `imageRatio` | `--dynamic-views-image-aspect-ratio` |
| `thumbnailSize` | `--dynamic-views-thumbnail-size` |
| `posterDisplayMode` | `.poster-mode-fade` / `.poster-mode-overlay` class toggle |
| `imageFit` | `.image-fit-crop` / `.image-fit-contain` class toggle |

These are excluded from the settings hash so they don't trigger a full DOM rebuild.

`applyCssOnlySettings()` also handles `titleLines` (sets `--dynamic-views-title-lines` + `title-single-line` class) and `posterInteractToReveal` (toggles `poster-static` class with clipping logic). These are NOT in `CSS_ONLY_SETTINGS_KEYS` — they remain in the render hash and trigger a full re-render too, but the CSS is applied eagerly for instant visual feedback.

## Settings reading: `readBasesSettings()`

Called from `processDataUpdate()`. Merges settings from multiple layers (highest priority first):

```
config.get(key)  →  templateOverrides  →  BASES_DEFAULTS  →  VIEW_DEFAULTS  →  pluginSettings
```

See `settings-resolution.md` for the full merge pipeline and type coercion rules.

### Stale config guards

Obsidian fires duplicate `onDataUpdated()` callbacks ~150-200ms later with stale cached values. Two enum fields have fallback guards to prevent visual flicker:

- **`imageFormat`**: Validated against `['thumbnail', 'cover', 'poster', 'backdrop']`. If stale/invalid → falls back to `previousSettings.imageFormat`, then to the default.
- **`propertyNames`**: Validated against `['hide', 'inline', 'above']`. Same fallback chain.

The caller passes `this.lastRenderedSettings` as the fallback source, which stores the last successfully resolved settings.

## Render hash

The render hash is a 10-component string built from all inputs that affect card DOM structure. If the hash is unchanged AND cards are already rendered AND no file content changed, the view skips re-rendering entirely.

### Hash components

| # | Component | What it detects |
|---|---|---|
| 1 | `path:mtime` for each entry | File additions, removals, content edits |
| 2 | `settingsHash` | Any non-CSS-only setting change |
| 3 | `groupByProperty` | Group-by property change or enable/disable |
| 4 | `sortMethod` | Entry-level sort field/direction change |
| 5 | `groupOrderHash` | Group sort order change (group key sequence) |
| 6 | `styleSettingsHash` | Style Settings changes affecting rendering |
| 7 | `collapsedHash` | Group collapse/expand state |
| 8 | `isShuffled` flag | Shuffle toggle |
| 9 | `shuffledOrder` | Shuffle seed/sequence |
| 10 | `visibleProperties` | Property display order |

### `settingsHash` internals

Built from all settings EXCEPT `CSS_ONLY_SETTINGS_KEYS`. Also includes `visibleProperties`, `sortMethod`, and `groupByProperty` for redundancy (these affect both hash and settings).

### `settingsHashExcludingOrder`

A further-filtered hash that excludes `ORDER_DERIVED_SETTINGS_KEYS` (`titleProperty`, `subtitleProperty`, `_skipLeadingProperties`). Used to detect property-reorder-only changes — when `displayFirstAsTitle` derives title/subtitle from property positions, reordering properties changes these derived settings even though no "real" setting changed.

### `styleSettingsHash`

Computed by `getStyleSettingsHash()` in `style-settings.ts`. Captures JS-readable Style Settings values that affect card rendering:

- Timestamp formatting (recent/older format toggles, datetime/date/time format strings)
- Property display (list separator, empty marker, hide-empty mode, tag hash prefix)
- Property display (hide-missing-properties mode)
- Slideshow (enabled, thumbnail scrubbing disabled, max images)
- Layout (compact breakpoint, zoom sensitivity, title/subtitle overflow scroll body classes, uniform poster height)
- Text preview content (keep headings, keep newlines, omit-first-line mode)

**Adding new body-class toggles**: Any `class-toggle` that affects rendering (JS behavior, not just CSS) MUST be added to `getStyleSettingsHash()` via `hasBodyClass()`. The body class observer detects the `dynamic-views-*` class change but uses hash-based deduplication — if the hash doesn't change, `onStyleChange()` never fires and the re-render pipeline is never triggered.

## Dirty-checking: early-return guard

```
renderHash === lastRenderHash
  && feedContainer has children
  && changedPaths.size === 0
→ SKIP re-render
```

When skipped, the view still:
- Restores CSS grid column count (may be lost on tab switch)
- Restores scroll position
- Checks if viewport is underfilled (CSS-only change may have changed card heights)

## Content-change detection

The `lastMtimes` map (`Map<string, number>`) tracks `file.path → file.stat.mtime` from the last render. On each update cycle:

1. Compare current mtimes against stored values
2. Files with changed mtimes → `changedPaths` set
3. Insertion order matches `allEntries` order (Bases sort order) — used for `orderUnchanged` check

Two derived flags control the update path:

| Flag | Condition | Meaning |
|---|---|---|
| `pathsUnchanged` | Same set of file paths (any order) | No files added or removed |
| `orderUnchanged` | Same file paths in same positions | Sort order preserved |

## Update paths

### Full re-render

Triggered when settings changed, files were added/removed, or order changed. Clears all card DOM, rebuilds from scratch.

### Incremental content update (`updateCardsInPlace`)

**Conditions**: `changedPaths > 0` AND `!settingsChanged` AND `pathsUnchanged` AND `orderUnchanged`.

Surgically updates only the changed cards:
1. Invalidate cache entries for changed files only
2. Async-load fresh text/image content for changed files
3. Rebuild `CardData` for each changed file
4. If image changed → full card re-render (image layout affects card height)
5. If only text/properties changed → update title/subtitle/properties inline

### Property reorder (`updatePropertyOrder`)

**Conditions**: `settingsChanged` AND `propertySetUnchanged` AND `!settings.invertPropertyPairing` AND `pathsUnchanged` AND `changedPaths.size === 0` AND `settingsHashExcludingOrder` unchanged.

The `invertPropertyPairing` guard is necessary because pairing inversion is position-dependent — reordering properties changes which pairs get inverted, affecting card height.

Rebuilds `CardData` and updates DOM title/subtitle/properties without full re-render — card heights are invariant under property reorder (when pairing inversion is off).

## Style Settings reactivity

`setupStyleSettingsObserver()` in `style-settings.ts` watches two mutation sources:

1. **Body class mutations**: `MutationObserver` on `document.body` with `attributeFilter: ['class']`. Detects `class-toggle` and `class-select` changes (body classes prefixed with `dynamic-views-*`).
2. **Stylesheet mutations**: `MutationObserver` on `#css-settings-manager` style element. Detects `variable-number-slider` changes that update CSS variables.

The **body class observer** uses hash-based deduplication: filters for `dynamic-views-*` class changes, then calls `clearStyleSettingsCache()` and compares `getStyleSettingsHash()` against the previous hash. Only fires `onDataUpdated()` if JS-relevant values actually changed.

The **stylesheet observer** uses a simpler check: fires `onDataUpdated()` whenever the style element mutates and its `textContent` contains `'--dynamic-views-'`. No hash comparison — stylesheet mutations are infrequent enough that dedup is unnecessary.

**Popout safety**: Observers derive `MutationObserver` from `containerEl.ownerDocument.defaultView` so popout windows observe their own body, not the main window's.

## Invariants

- CSS-only settings NEVER trigger a full re-render — they're applied synchronously and excluded from the render hash.
- `queueMicrotask` delay between `onDataUpdated()` and `processDataUpdate()` is mandatory — `config.getOrder()` may return stale values without it.
- `lastMtimes` insertion order MUST match `allEntries` order for `orderUnchanged` to work.
- Stale config guards only protect `imageFormat` and `propertyNames` — other enum settings are not known to produce stale callbacks.
- Body class observer hash deduplication prevents observer storms when Style Settings writes multiple class changes in rapid succession. The stylesheet observer uses a simpler content-contains check.
