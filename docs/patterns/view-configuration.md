---
title: View configuration
description: Centralized reference for configuring Dynamic Views per-view settings — setting keys, workflows, and templates.
author: Generated with Claude Code
updated: 2026-08-09
---
# View configuration

Centralized reference for configuring Dynamic Views per-view settings for Bases. Interface-agnostic — the same settings apply whether accessed via CLI eval, Chrome DevTools MCP, Safari Inspector, or ADB.

See [plugin-view-navigation.md](plugin-view-navigation.md) for DOM hierarchy, selectors, and view identification.

## API

All programmatic access goes through the `persistenceManager` (pm):

```js
const pm = app.plugins.plugins['dynamic-views'].persistenceManager;
```

### Bases

Edit the `.base` file YAML via filesystem tools (Edit tool, `app.vault.adapter.write()`), then close the leaf and reopen it. `openFile` on the same leaf does NOT re-parse the YAML.

Bases UI state (collapsed groups):

```js
pm.getBasesState(viewId);   // { collapsedGroups: [...] }
pm.setBasesState(viewId, { collapsedGroups: ['Group A'] });
```

### Templates

```js
// Save a settings snapshot as default for new views of a type
pm.setSettingsTemplate('grid', template);      // Bases Grid
pm.setSettingsTemplate('masonry', template);   // Bases Masonry

// Read
pm.getSettingsTemplate('grid');
```

### Plugin-level settings

```js
pm.getPluginSettings();
pm.setPluginSettings(settings);  // Merges sparse — only non-default values persisted
```

## View settings

`ViewDefaults` — set as YAML keys in `.base` files.

### Card size

| Key | Type | Default | Range |
|---|---|---|---|
| `cardSize` | `number` | `300` | 50–800 px |

### Title

| Key | Type | Default | Notes |
|---|---|---|---|
| `titleProperty` | `string` | `'file.name'` | Position-derived when `displayFirstAsTitle` is ON |
| `titleLines` | `number` | `2` | 1–5 |
| `subtitleProperty` | `string` | `'file.folder'` | Position-derived when `displaySecondAsSubtitle` is ON |
| `subtitleLines` | `number` | `2` | 1–5. Slider hidden unless both `displayFirstAsTitle` and `displaySecondAsSubtitle` are ON |
| `displayFirstAsTitle` | `boolean` | `true` | Derives title from first property in order |
| `displaySecondAsSubtitle` | `boolean` | `false` | Derives subtitle from second property |

### Text preview

| Key | Type | Default | Range | Notes |
|---|---|---|---|---|
| `textPreviewProperty` | `string` | `''` | — | Property for text preview content |
| `fallbackToContent` | `boolean` | `true` | — | Fall back to file content when property is empty |
| `textPreviewLines` | `number` | `5` | 1–10 | CSS-only (no re-render) |

### Image

| Key | Type | Default | Values | Notes |
|---|---|---|---|---|
| `imageProperty` | `string` | `''` | — | Property for card image |
| `showFileImages` | `string` | `'always'` | `'always'`, `'if-unavailable'`, `'never'` | |
| `imageFormat` | `string` | `'thumbnail'` | `'thumbnail'`, `'cover'`, `'poster'`, `'backdrop'` | |
| `posterDisplayMode` | `string` | `'fade'` | `'fade'`, `'overlay'` | Only when `imageFormat` is `'poster'` |
| `posterInteractToReveal` | `boolean` | `false` | — | When ON: content hidden, revealed on hover (desktop) / press (mobile) |
| `thumbnailSize` | `number` | `80` | 64–128 | CSS-only |
| `imagePosition` | `string` | `'right'` | `'left'`, `'right'`, `'top'`, `'bottom'` | Thumbnail/cover position relative to content |
| `imageFit` | `string` | `'crop'` | `'crop'`, `'contain'` | CSS-only |
| `imageRatio` | `number` | `1.0` | 0.25–2.5 | CSS-only |

### Properties

| Key | Type | Default | Values |
|---|---|---|---|
| `propertyNames` | `string` | `'inline'` | `'hide'`, `'inline'`, `'above'` |
| `pairProperties` | `boolean` | `false` | — |
| `rightPropertyPosition` | `string` | `'column'` | `'left'`, `'column'`, `'right'` |
| `invertPropertyPairing` | `string` | `''` | Comma-separated property names |
| `showPropertiesAbove` | `boolean` | `false` | Hardcoded (no UI) |
| `invertPropertyPosition` | `string` | `''` | Hardcoded (no UI) |
| `urlProperty` | `string` | `''` | URL for card click target |

### Layout

| Key | Type | Default (Grid) | Default (Masonry) | Values | Notes |
|---|---|---|---|---|---|
| `minimumColumns` | `1 \| 2` | `1` | `2` | `1`, `2` | Bases YAML: `'one'`/`'two'` strings |
| `cardGapDesktop` | `number` | `8` | `8` | 0–64 px | Gap between cards. Also sets the view edge inset, floored at 12px. Slider hidden on phone |
| `cssclasses` | `string` | `''` | `''` | — | Comma-separated CSS classes |

The card gap is a desktop and tablet setting only. Phone uses a fixed 6px gap (`PHONE_CARD_GAP` in `src/core/constants.ts`), and the slider is hidden there — a phone pane is too narrow for the gap to be worth tuning. `cardGapDesktop` still persists in the `.base` YAML on every platform, so a phone editing a synced view leaves the desktop value alone.

## CSS-only settings

These only affect CSS custom properties — changing them does NOT trigger a card re-render:

`textPreviewLines`, `imageRatio`, `thumbnailSize`, `posterDisplayMode`, `imageFit`

## Per-view CSS variable overrides via `cssclasses`

The `cssclasses` setting adds classes to the `.dynamic-views` container. A CSS snippet can define helper classes that set CSS custom properties on this element, enabling per-view overrides of Style Settings values.

**Card radius example** — a `radius-16` class in a CSS snippet:

```css
.radius-16 {
  --dynamic-views-card-border-radius: 16px;
}
```

**How it works**: CSS variables inherit through the DOM tree, so a value set on the container is visible to every card below it and overrides the Style Settings value declared on `body`.

**Limitations**: Only `variable-number-slider` Style Settings options work with this pattern — they use CSS variables that inherit through the DOM. `class-toggle` and `class-select` options use body classes read via `document.body.classList`, which cannot be overridden per-container.

**Card gap is no longer a `cssclasses` case**: `cardGapDesktop` is a per-view setting. `applyViewContainerStyles()` writes `--dynamic-views-card-spacing-desktop|-phone` as an inline style on the container, which beats any `cssclasses` helper class by specificity. Use the Card gap slider instead (desktop and tablet — the phone gap is fixed).

## Resolution order

Settings resolve through layered merges. Highest priority wins.

`config.get()` > `template` > `BASES_DEFAULTS` > `VIEW_DEFAULTS` > `pluginSettings`

See [settings-resolution.md](../arch/settings-resolution.md) for the full pipeline, sparse storage, type coercion, and invariants.

## Caveats

- **Sparse storage**: Setting a key to its default value removes it from storage. Setting ALL keys to defaults deletes the entire state entry.
- **No `getGlobalSettings`/`setGlobalSettings`**: These methods do NOT exist on `persistenceManager`. Use `getPluginSettings`/`setPluginSettings` instead.
- **Bases YAML re-parse**: Editing a `.base` file requires closing and reopening the leaf for changes to take effect. `openFile` on the same leaf does NOT re-parse.
- **minimumColumns coercion**: Bases YAML stores `'one'`/`'two'` strings; internal types use `1`/`2` numbers. Set the string value when editing YAML directly.
- **Qualified property ids**: `urlProperty` and `textPreviewProperty` are blanked unless their value appears in `config.getOrder()`, which reports frontmatter properties **qualified** (`note.url`). Write the qualified form when editing YAML directly — a bare `url` resolves to nothing, silently, and the property picker shows the row as empty. Obsidian normalizes `order` entries back to the bare form on save, so the file and the runtime disagree on purpose; the property must also be present in `order` at all.
- **Stale config guards**: Obsidian fires duplicate `onDataUpdated()` callbacks with stale values. `imageFormat` and `propertyNames` have guards — see [settings-resolution.md](../arch/settings-resolution.md).
- **Hardcoded fields**: `showPropertiesAbove` and `invertPropertyPosition` bypass `config.get()` and always use static defaults. They have no schema entries, making them invisible to users.
- **Position-derived title/subtitle**: When `displayFirstAsTitle` is ON, `titleProperty` and `subtitleProperty` are derived from property order — setting them directly in the YAML has no effect. They are also cleaned up (deleted) from the YAML by `cleanUpBaseFile()`.
