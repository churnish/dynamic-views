---
title: View configuration
description: Centralized reference for configuring Dynamic Views per-view settings — setting keys, state properties, per-backend workflows, DQL query syntax, and search filtering.
author: Generated with Claude Code
updated: 2026-04-04
---
# View configuration

Centralized reference for configuring Dynamic Views per-view settings across both Bases and Datacore backends. Interface-agnostic — the same settings apply whether accessed via CLI eval, Chrome DevTools MCP, Safari Inspector, or ADB.

See [plugin-view-navigation.md](plugin-view-navigation.md) for DOM hierarchy, selectors, and view identification.

## API

All programmatic access goes through the `persistenceManager` (pm):

```js
const pm = app.plugins.plugins['dynamic-views'].persistenceManager;
```

### Datacore

```js
// Read state
pm.getDatacoreState(queryId);

// Set state (shallow-merges top-level keys)
pm.setDatacoreState(queryId, { viewMode: 'masonry' });

// IMPORTANT: the `settings` sub-object is REPLACED, not merged.
// To update a single setting without losing others:
const current = pm.getDatacoreState(queryId);
pm.setDatacoreState(queryId, {
  settings: { ...current.settings, cardSize: 400 },
});

// Trigger re-render after state change
app.workspace.trigger('layout-change');
```

The `queryId` is a 6-char string embedded in the `datacorejsx` code block.

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
pm.setSettingsTemplate('datacore', template);  // Datacore

// Read
pm.getSettingsTemplate('grid');
```

### Plugin-level settings

```js
pm.getPluginSettings();
pm.setPluginSettings(settings);  // Merges sparse — only non-default values persisted
```

## Datacore state properties

Top-level state wrapping per-query UI and settings. Set via `pm.setDatacoreState(queryId, { ... })`.

| Property | Default | Values |
|---|---|---|
| `viewMode` | `'grid'` | `'grid'`, `'masonry'`, `'list'` |
| `sortMethod` | `'mtime-desc'` | `'name-asc'`, `'name-desc'`, `'mtime-asc'`, `'mtime-desc'`, `'ctime-asc'`, `'ctime-desc'` |
| `searchQuery` | `''` | Free text (see [Search syntax](#search-syntax)), truncated to 500 chars |
| `resultLimit` | `''` | Number as string (e.g., `'10'`), empty = no limit |
| `widthMode` | `'normal'` | `'normal'`, `'wide'`, `'max'` |
| `settings` | `undefined` | Partial `ViewDefaults & DatacoreDefaults` (see below) |

## View settings

Shared `ViewDefaults` — applies to both backends unless noted. Set via `pm.setDatacoreState(queryId, { settings: { ... } })` for Datacore, or as YAML keys in `.base` files for Bases.

### Card size

| Key | Type | Default | Range |
|---|---|---|---|
| `cardSize` | `number` | `300` | 50–800 px |

### Title

| Key | Type | Default (Bases) | Default (Datacore) | Notes |
|---|---|---|---|---|
| `titleProperty` | `string` | `'file.name'` | `'$name'` | Bases: position-derived when `displayFirstAsTitle` is ON |
| `titleLines` | `number` | `2` | `2` | 1–5 |
| `subtitleProperty` | `string` | `'file.folder'` | `''` | Bases: position-derived when `displaySecondAsSubtitle` is ON |
| `displayFirstAsTitle` | `boolean` | `true` | `false` | Bases only — derives title from first property in order. No-op for Datacore |
| `displaySecondAsSubtitle` | `boolean` | `false` | `false` | Bases only — derives subtitle from second property. No-op for Datacore |

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
| `fallbackToEmbeds` | `string` | `'always'` | `'always'`, `'if-unavailable'`, `'never'` | |
| `imageFormat` | `string` | `'thumbnail'` | `'thumbnail'`, `'cover'`, `'poster'`, `'backdrop'` | |
| `posterDisplayMode` | `string` | `'fade'` | `'fade'`, `'overlay'` | Only when `imageFormat` is `'poster'` |
| `posterInteractToReveal` | `boolean` | `false` | — | When ON: content hidden, revealed on hover (desktop) / press (mobile) |
| `thumbnailSize` | `number` | `80` | 64–128 | CSS-only |
| `imagePosition` | `string` | `'right'` | `'left'`, `'right'`, `'top'`, `'bottom'` | Thumbnail/cover position relative to content |
| `imageFit` | `string` | `'crop'` | `'crop'`, `'contain'` | CSS-only |
| `imageRatio` | `number` | `1.0` | 0.25–2.5 | CSS-only |

### Properties

| Key | Type | Default (Bases) | Default (Datacore) | Values |
|---|---|---|---|---|
| `propertyNames` | `string` | `'inline'` | `'hide'` | `'hide'`, `'inline'`, `'above'` |
| `pairProperties` | `boolean` | `false` | `true` | — |
| `rightPropertyPosition` | `string` | `'column'` | `'column'` | `'left'`, `'column'`, `'right'` |
| `invertPropertyPairing` | `string` | `''` | `''` | Comma-separated property names |
| `showPropertiesAbove` | `boolean` | `false` | `false` | Hardcoded in Bases (no UI) |
| `invertPropertyPosition` | `string` | `''` | `''` | Hardcoded in Bases (no UI) |
| `urlProperty` | `string` | `''` | `''` | URL for card click target |

### Layout

| Key | Type | Default (Grid) | Default (Masonry) | Values | Notes |
|---|---|---|---|---|---|
| `minimumColumns` | `1 \| 2` | `1` | `2` | `1`, `2` | Bases YAML: `'one'`/`'two'` strings |
| `cssclasses` | `string` | `''` | `''` | — | Comma-separated CSS classes |

### Datacore-only

| Key | Type | Default | Values | Notes |
|---|---|---|---|---|
| `listMarker` | `string` | `'bullet'` | `'bullet'`, `'number'`, `'none'` | List view only |
| `queryHeight` | `number` | `0` | 0+ (no upper bound) | Code block height in pixels (0 = auto) |

## CSS-only settings

These only affect CSS custom properties — changing them does NOT trigger a card re-render:

`textPreviewLines`, `imageRatio`, `thumbnailSize`, `posterDisplayMode`, `imageFit`

## Per-view CSS variable overrides via `cssclasses`

The `cssclasses` setting adds classes to the `.dynamic-views` container (Bases) or `.dynamic-views-grid`/`.dynamic-views-masonry` element (Datacore). A CSS snippet can define helper classes that set CSS custom properties on these elements, enabling per-view overrides of Style Settings values.

**Card spacing example** — a `gap-16` class in a CSS snippet:

```css
.gap-16 {
  --dynamic-views-card-spacing-desktop: 16px;
  --dynamic-views-card-spacing-phone: 16px;
}
```

**How it works**: `getCardSpacing()` in `style-settings.ts` reads the CSS variable from `getComputedStyle(containerEl)` first, then falls back to `document.body`. CSS variables inherit through the DOM tree, so the override is visible regardless of which ancestor it's set on. Results are cached per container per render cycle (`Map<HTMLElement, number>`, cleared in `clearStyleSettingsCache()`).

**Limitations**: Only `variable-number-slider` Style Settings options work with this pattern — they use CSS variables that inherit through the DOM. `class-toggle` and `class-select` options use body classes read via `document.body.classList`, which cannot be overridden per-container.

## Resolution order

Settings resolve through layered merges. Highest priority wins.

**Bases**: `config.get()` > `template` > `BASES_DEFAULTS` > `VIEW_DEFAULTS` > `pluginSettings`

**Datacore**: `per-query settings` > `template` > `DATACORE_DEFAULTS` > `VIEW_DEFAULTS` > `pluginSettings`

See [settings-resolution.md](../architecture/settings-resolution.md) for the full pipeline, sparse storage, type coercion, and invariants.

## DQL query syntax

Datacore views use `datacorejsx` code blocks with DQL query markers:

````
```datacorejsx
// –––– DQL QUERY START ––––
@page and #game and rating >= 7
// ––––– DQL QUERY END –––––
```
````

- **Empty query** defaults to `@file` (all files).
- **Auto-wrapping**: If query lacks `@file` or `@page`, it's wrapped as `@file and (QUERY)`. Only `@file` and `@page` are recognized — queries starting with other type selectors (`@task`, `@section`, etc.) are also wrapped, producing a compound query.
- **Editing**: Update the query between the DQL markers via the Edit tool. NEVER use `app.vault.adapter.write()`.

### Type filters

| Syntax | Description |
|---|---|
| `@page` | All pages (most common for card views) |
| `@file` | All files |
| `@task` | Tasks |
| `@section` | Sections |
| `@block` | Blocks |
| `@codeblock` | Code blocks |
| `@datablock` | Data blocks |
| `@list-item` | List items |
| `@block-list` | Blocks containing lists |

### Filter atoms

| Syntax | Example |
|---|---|
| `#tag` | `#game`, `#philosophy/natural` |
| `path("folder")` | `path("Games")` |
| `epath("exact/path")` | `epath("Games/Dark Souls.md")` |
| `exists(field)` | `exists(rating)` |
| `linksto([[Link]])` | `linksto([[Coworker]])` |
| `linkedfrom([[Link]])` | `linkedfrom([[Project]])` |
| `connected([[Link]])` | `connected([[Topic]])` |
| `parentof(query)` | `parentof(@codeblock)` |
| `childof(query)` | `childof(@page)` |
| `subtree(query)` | `subtree(@page)` |
| `supertree(query)` | `supertree(@codeblock)` |
| *expression* | `rating >= 9` |

### Boolean operators

| Operator | Meaning |
|---|---|
| `and` / `&` | Both must match |
| `or` / `\|` | Either matches |
| `!` | Negation (prefix) |
| `(...)` | Grouping |

`and` binds tighter than `or`. Negated queries are slow — combine with a type filter (e.g., `!#book and @page`).

### Field references

| Syntax | Description |
|---|---|
| `field` | Direct property reference (case-insensitive) |
| `$name` | Intrinsic field ($ prefix) |
| `$row["field name"]` | Bracket access for fields with spaces (MUST be lowercased) |
| `a.b` | Nested object access |

### Intrinsic fields

| Field | Description |
|---|---|
| `$name` | Object name/title |
| `$path` | File path |
| `$file` | Source file path |
| `$tags` | List of tags |
| `$links` | List of outgoing links |
| `$types` | List of type strings |
| `$parent` | Parent object |
| `$frontmatter` | Raw frontmatter object |

### Comparison operators

`=`, `!=`, `>`, `<`, `>=`, `<=`

### String literals

ALWAYS use double quotes. Single quotes are buggy (Datacore issue #75).

### Common functions

All functions support postfix: `a.f(b)` = `f(a, b)`.

| Function | Description |
|---|---|
| `contains(val, target)` | Recursive deep search |
| `icontains(val, target)` | Case-insensitive contains |
| `startswith(str, prefix)` | Test prefix |
| `endswith(str, suffix)` | Test suffix |
| `length(val)` | Size of array/string/object |
| `lower(str)` / `upper(str)` | Case conversion |
| `date(str)` | Parse date (`date(now)` for current) |
| `dur(str)` | Parse duration (`dur(7d)`) |
| `choice(cond, trueVal, falseVal)` | Ternary |
| `default(val, fallback)` | Fallback if null |
| `filter(array, fn)` | Filter by predicate |
| `map(array, fn)` | Transform elements |
| `sort(array, keyFn?)` | Sort array |
| `join(array, sep)` | Concatenate to string |
| `regextest(pattern, str)` | Test regex match |

For the full 55-function reference, consult the local Datacore docs via `/ob-ref`.

### Example queries

```
// All pages
@page

// Pages tagged game with high rating
@page and #game and rating >= 9

// Pages in a folder
@page and path("Projects")

// Pages linking to a specific note
@page and linksto([[Coworker]])

// Uncompleted tasks
@task and $completed = false

// Field existence
@page and exists(cover)

// Complex filter
@page and (#book or #article) and rating >= 7

// Sections containing a keyword
@section and $name.contains("Daily")
```

## Search syntax

The toolbar search filters results client-side:

| Pattern | Meaning |
|---|---|
| `term` | File name contains "term" |
| `-term` | File name does NOT contain "term" |
| `#tag` | File has tag |
| `-#tag` | File does NOT have tag |

Multiple terms are combined with AND logic.

## Caveats

### API

- **`settings` sub-object replacement**: `setDatacoreState` shallow-merges top-level keys (`viewMode`, `sortMethod`, etc.) but REPLACES the nested `settings` object entirely. Always spread existing settings when updating a single key (see [API example](#datacore)).
- **Sparse storage**: Setting a key to its default value removes it from storage. Setting ALL keys to defaults deletes the entire state entry.
- **`getDatacoreState` returns defaults**: The returned object includes default values for missing keys — safe to spread `state.settings` when updating.
- **No `getGlobalSettings`/`setGlobalSettings`**: These methods do NOT exist on `persistenceManager`. Use `getPluginSettings`/`setPluginSettings` instead.

### Bases

- **Bases YAML re-parse**: Editing a `.base` file requires closing and reopening the leaf for changes to take effect. `openFile` on the same leaf does NOT re-parse.
- **minimumColumns coercion**: Bases YAML stores `'one'`/`'two'` strings; internal types use `1`/`2` numbers. Set the string value when editing YAML directly.
- **Stale config guards**: Obsidian fires duplicate `onDataUpdated()` callbacks with stale values. `imageFormat` and `propertyNames` have guards — see [settings-resolution.md](../architecture/settings-resolution.md).
- **Hardcoded Bases fields**: `showPropertiesAbove` and `invertPropertyPosition` bypass `config.get()` and always use static defaults. They have no schema entries, making them invisible to Bases users.
- **Position-derived title/subtitle**: When `displayFirstAsTitle` is ON, `titleProperty` and `subtitleProperty` are derived from property order — setting them directly in the YAML has no effect. They are also cleaned up (deleted) from the YAML by `cleanUpBaseFile()`.

### DQL

- **Tag indexing discrepancy**: DQL `#tag` queries may return fewer results than expected. Datacore's tag indexing appears incomplete for some vaults. Bases `file.hasTag()` uses Obsidian's native metadata cache, which is reliable.
- **Single quotes in DQL**: Buggy (Datacore issue #75). ALWAYS use double quotes.
