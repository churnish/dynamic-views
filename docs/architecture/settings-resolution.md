---
title: Settings resolution pipeline
description: Three-layer merge of defaults, templates, and per-view config into resolved settings. Covers sparse storage, type coercion, stale guards, and migration.
author: "\U0001F916 Generated with Claude Code"
last updated: 2026-03-12
---
# Settings resolution pipeline

The settings resolution pipeline merges static defaults, template overrides, and per-view config into fully resolved settings objects for both Bases and Datacore backends. Covers the three-layer resolution chain, sparse storage pattern, position-based title/subtitle derivation, stale config guards, type coercion, template system, and migration.

## Files

| File                            | Role                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/constants.ts`              | Static defaults (`VIEW_DEFAULTS`, `BASES_DEFAULTS`, `DATACORE_DEFAULTS`, `PLUGIN_SETTINGS`), `resolveSettings()`   |
| `src/types.ts`                  | `ViewDefaults`, `PluginSettings`, `ResolvedSettings`, `BasesResolvedSettings`, `DatacoreDefaults`, `BasesDefaults` |
| `src/persistence.ts`            | `PersistenceManager` — sparse storage, sanitization, template CRUD, migration                                      |
| `src/shared/settings-schema.ts` | `readBasesSettings()`, `extractBasesTemplate()`, `getBasesViewOptions()` schema builder                            |
| `src/shared/view-validation.ts` | `VALID_VIEW_VALUES`, `VIEW_DEFAULTS_TYPES` — shared validation constants                                           |
| `src/bases/utils.ts`            | `cleanUpBaseFile()` — YAML cleanup, template injection, ID management                                              |
| `src/datacore/controller.tsx`   | `getPersistedSettings()` — Datacore resolution via `resolveSettings()`                                             |

## Core data structures

### PluginSettings (`src/types.ts`)

Plugin-level settings from the settings tab. Not per-view.

| Field                       | Type                                              | Purpose                               |
| --------------------------- | ------------------------------------------------- | ------------------------------------- |
| `smartTimestamp`            | `boolean`                                         | Use relative timestamps               |
| `createdTimeProperty`       | `string`                                          | Property name for created time        |
| `modifiedTimeProperty`      | `string`                                          | Property name for modified time       |
| `randomizeAction`           | `string`                                          | Shuffle/randomize behavior            |
| `openFileAction`            | `'card' \| 'title'`                               | What click target opens files         |
| `preventSidebarSwipe`       | `'disabled' \| 'base-files' \| 'all-views'`       | Prevent sidebar swipe on mobile       |
| `revealInNotebookNavigator` | `'disable' \| 'files-folders' \| 'tags' \| 'all'` | Notebook Navigator integration        |
| `showYoutubeThumbnails`     | `boolean`                                         | Fetch YouTube thumbnails              |
| `showCardLinkCovers`        | `boolean`                                         | Fetch card link cover images          |
| `contextMenuCommands`       | `boolean`                                         | Show plugin commands in context menus |

**Migrated fields**: `omitFirstLine` was migrated to a Style Settings `class-select` (read via `getOmitFirstLineMode()` in JS).

### ViewDefaults (`src/types.ts`)

Per-view visual settings shared across both backends. 26 fields covering card size, title, text preview, image, properties, and layout.

| Field                     | Type                            | Default         | Notes                                                                               |
| ------------------------- | ------------------------------- | --------------- | ----------------------------------------------------------------------------------- |
| `cardSize`                | `number`                        | `300`           | Card width in pixels                                                                |
| `titleProperty`           | `string`                        | `'file.name'`   | Overridden by `DATACORE_DEFAULTS` (`'$name'`) and position-based derivation (Bases) |
| `subtitleProperty`        | `string`                        | `'file.folder'` | Overridden by `DATACORE_DEFAULTS` (`''`) and position-based derivation (Bases)      |
| `displayFirstAsTitle`     | `boolean`                       | `false`         | Overridden by `BASES_DEFAULTS` (`true`). No-op for Datacore                         |
| `displaySecondAsSubtitle` | `boolean`                       | `false`         | Overridden by `BASES_DEFAULTS` (`false`). No-op for Datacore                        |
| `propertyLabels`          | `'hide' \| 'inline' \| 'above'` | `'hide'`        | Overridden by `BASES_DEFAULTS` (`'inline'`). Has stale config guard                 |
| `minimumColumns`          | `1 \| 2`                        | `1`             | Masonry default is `2` (view-type-specific, not in `BASES_DEFAULTS`)                |
| `imageFormat`             | enum                            | `'thumbnail'`   | Has stale config guard                                                              |

### DatacoreDefaults (`src/types.ts`)

Datacore-only overrides that shadow `ViewDefaults` fields via spread order.

| Field              | Type      | Default    | Shadows                         |
| ------------------ | --------- | ---------- | ------------------------------- |
| `titleProperty`    | `string`  | `'$name'`  | `ViewDefaults.titleProperty`    |
| `subtitleProperty` | `string`  | `''`       | `ViewDefaults.subtitleProperty` |
| `pairProperties`   | `boolean` | `true`     | `ViewDefaults.pairProperties`   |
| `listMarker`       | `string`  | `'bullet'` | Datacore-only (list view)       |
| `queryHeight`      | `number`  | `0`        | Datacore-only (query editor)    |

### BasesDefaults (`src/types.ts`)

Bases-only overrides that shadow `ViewDefaults` fields.

| Field                     | Type                            | Default    | Shadows                                |
| ------------------------- | ------------------------------- | ---------- | -------------------------------------- |
| `displayFirstAsTitle`     | `boolean`                       | `true`     | `ViewDefaults.displayFirstAsTitle`     |
| `displaySecondAsSubtitle` | `boolean`                       | `false`    | `ViewDefaults.displaySecondAsSubtitle` |
| `propertyLabels`          | `'hide' \| 'inline' \| 'above'` | `'inline'` | `ViewDefaults.propertyLabels`          |

### Resolved types

| Type                    | Definition                                                                       | Used by                     |
| ----------------------- | -------------------------------------------------------------------------------- | --------------------------- |
| `ResolvedSettings`      | `PluginSettings & ViewDefaults & DatacoreDefaults` + `_displayNameMap?`          | Datacore rendering pipeline |
| `BasesResolvedSettings` | `PluginSettings & ViewDefaults` + `_displayNameMap?` + `_skipLeadingProperties?` | Bases rendering pipeline    |

### PluginData (`src/types.ts`)

Top-level persisted structure.

| Field            | Type                                                                   | Purpose                                      |
| ---------------- | ---------------------------------------------------------------------- | -------------------------------------------- |
| `pluginSettings` | `Partial<PluginSettings>`                                              | Sparse plugin-level settings                 |
| `templates`      | `Partial<Record<'grid' \| 'masonry' \| 'datacore', SettingsTemplate>>` | Settings snapshots for new views             |
| `basesStates`    | `Record<string, BasesUIState>`                                         | Per-view collapsed groups (keyed by view ID) |
| `datacoreStates` | `Record<string, DatacoreState>`                                        | Per-query UI + settings (keyed by query ID)  |

## Resolution chains

### Bases path

`readBasesSettings()` in `settings-schema.ts`. Called on every `onDataUpdated()`.

```
1. VIEW_DEFAULTS                    (static)
2. BASES_DEFAULTS                   (static, overrides VIEW_DEFAULTS)
3. templateOverrides                (sparse user template, fallback for new views)
   ─── merged into `defaults` ───
4. config.get(key)                  (per-view Bases YAML values override defaults)
5. pluginSettings                   (spread into final object alongside view settings)
```

Precedence (highest wins): `config.get()` -> `templateOverrides` -> `BASES_DEFAULTS` -> `VIEW_DEFAULTS`. Plugin-level fields come from `pluginSettings` without overlap (different key sets).

Return type: `BasesResolvedSettings` (includes computed `_skipLeadingProperties`).

### Datacore path

`getPersistedSettings()` in `controller.tsx`. Called via `dc.useCallback`.

```
1. pluginSettings                   (plugin-level)
2. VIEW_DEFAULTS                    (per-view visual defaults)
3. DATACORE_DEFAULTS                (shadows titleProperty, subtitleProperty, pairProperties)
4. { ...template, ...datacoreState.settings }   (template + per-query overrides)
   ─── passed to resolveSettings() ───
```

`resolveSettings()` merges via object spread:

```ts
{ ...pluginSettings, ...viewDefaults, ...datacoreDefaults, ...overrides }
```

Precedence (highest wins): `overrides` -> `datacoreDefaults` -> `viewDefaults` -> `pluginSettings`.

Return type: `ResolvedSettings`.

### Schema defaults path

`getBasesViewOptions()` in `settings-schema.ts`. Called when the **settings panel is opened**, NOT on view creation or file open. Populates dropdown defaults and option lists.

```
1. VIEW_DEFAULTS + BASES_DEFAULTS              (static merge)
2. getMinimumColumnsDefault(viewType)          (view-type-specific: masonry=2, grid=1)
3. template (if new view)                      (Object.assign onto merged defaults)
```

New view detection: `!config || config.get('id') == null`. The `id` field is assigned by `cleanUpBaseFile()` on first render — absence means never rendered.

## Sparse storage pattern

Only non-default values are persisted. This keeps `data.json` minimal and ensures new defaults propagate to existing installations.

### Where sparse filtering occurs

| Location                 | What it filters        | Comparison target                            | Special handling                                                                                               |
| ------------------------ | ---------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `setPluginSettings()`    | Plugin settings        | `PLUGIN_SETTINGS`                            | Shallow sanitize before compare; dispatches `PLUGIN_SETTINGS_CHANGE` event on `document.body` after saving     |
| `setDatacoreState()`     | Datacore UI + settings | `DEFAULT_DATACORE_STATE`                     | `searchQuery` truncated to 500 chars; nested `settings` object sanitized separately; empty state -> delete key |
| `setBasesState()`        | Collapsed groups       | Empty array                                  | Empty -> delete key                                                                                            |
| `extractBasesTemplate()` | Template values        | `VIEW_DEFAULTS` merged with `BASES_DEFAULTS` | Only non-default pairs retained                                                                                |
| `save()`                 | Top-level keys         | Empty object check                           | Skips empty sub-objects entirely                                                                               |

### Template cleanup on load

`PersistenceManager.load()` runs `cleanupTemplateSettings()` on each stored template to remove:

1. Keys not in `VIEW_DEFAULTS` (or `DATACORE_DEFAULTS` for Datacore templates)
2. Values whose type doesn't match the expected defaults type
3. Stale enum values (reset to first valid value)
4. Values matching `VIEW_DEFAULTS` (for Bases: skips keys where `BASES_DEFAULTS` overrides `VIEW_DEFAULTS`)

Empty templates after cleanup are deleted entirely.

## Position-based title/subtitle derivation

When `displayFirstAsTitle` is ON (Bases only), title and subtitle are derived from property order positions rather than stored as explicit property names.

### Algorithm (`readBasesSettings()`)

1. Read `textPreviewProperty`, `urlProperty`, `imageProperty` as the "special" set.
2. Get `config.getOrder()` — the ordered property list from the `.base` file.
3. Filter out special properties to get `candidateOrder`.
4. `titleProperty` = `candidateOrder[0]` (first non-special property).
5. If `displaySecondAsSubtitle` is ON: `subtitleProperty` = `candidateOrder[1]`.
6. `_skipLeadingProperties` = index of the last consumed property in the original `order` + 1.

### \_skipLeadingProperties

Computed as `order.indexOf(candidateOrder[N]) + 1` — the index of the last consumed candidate in the **original** `config.getOrder()` array, plus one. Special properties (text preview, URL, image) that appear before the title candidate in `getOrder()` inflate the value beyond 1 even for title alone.

| Value | Meaning                                                                                |
| ----- | -------------------------------------------------------------------------------------- |
| `0`   | `displayFirstAsTitle` is OFF, or no candidate properties exist                         |
| `≥1`  | Index of last consumed property in original `config.getOrder()` + 1 (title only)       |
| `≥2`  | Index of last consumed property in original `config.getOrder()` + 1 (title + subtitle) |

Computed on every render. Never persisted. Consumed by card rendering to skip rendering title/subtitle properties in the property row.

### Filter in schema

`getPositionTitleProps()` in `getBasesViewOptions()` mirrors the same derivation to exclude title/subtitle properties from `textPreviewProperty` and `urlProperty` dropdowns.

## Stale config guards

Obsidian fires duplicate `onDataUpdated()` callbacks ~150-200ms after the correct call with stale cached config values. Two fields have guards in `readBasesSettings()`:

| Field            | Guard behavior                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `imageFormat`    | Validate against `'thumbnail' \| 'cover' \| 'poster' \| 'backdrop'`. If invalid: fall back to `previousSettings.imageFormat`, then to `defaults.imageFormat`. |
| `propertyLabels` | Validate against `'hide' \| 'inline' \| 'above'`. If invalid: fall back to `previousSettings.propertyLabels`, then to `defaults.propertyLabels`.              |

The `previousSettings` parameter is passed from the view class — it stores the last successfully resolved settings. Without these guards, stale config would revert user settings to defaults on every duplicate callback.

## Type coercion: minimumColumns

Bases YAML stores dropdown values as strings (`"one"`, `"two"`), but `ViewDefaults.minimumColumns` is typed as `1 | 2`. Coercion is required at every boundary.

| Location                    | Direction               | Coercion                                                                            |
| --------------------------- | ----------------------- | ----------------------------------------------------------------------------------- |
| `readBasesSettings()`       | YAML string -> number   | `"one"` -> `1`, `"two"` -> `2`                                                      |
| `extractBasesTemplate()`    | YAML string -> number   | Same coercion, stores number in template                                            |
| `cleanupTemplateSettings()` | Skip type check         | `minimumColumns` excluded from type validation (YAML string !== default number)     |
| `getBasesViewOptions()`     | Number -> YAML string   | Schema `default` uses `'one'`/`'two'` strings for the dropdown                      |
| `cleanUpBaseFile()` cleanup | YAML string validation  | Enum validation via `VALID_VIEW_VALUES` (compares against `['one', 'two']` strings) |
| `cleanUpBaseFile()` inject  | Template number -> YAML | `1` -> `'one'`, `2` -> `'two'` when injecting template into new view YAML           |
| View-type-specific default  | Masonry: `2`, Grid: `1` | Via `getMinimumColumnsDefault(viewType)` — single source of truth                   |

## Template system

### Saving a template

1. User toggles `isTemplate` ON in Bases view settings (or Datacore settings panel).
2. For Bases: `extractBasesTemplate()` reads all config values with same coercion as `readBasesSettings()`, compares against merged defaults (`{...VIEW_DEFAULTS, ...BASES_DEFAULTS}`), returns only non-default pairs.
3. For Bases: `BASES_DEFAULTS` values serve as the comparison target for those keys — no keys are skipped from the sparse filter.
4. `PersistenceManager.setSettingsTemplate()` stores the sparse template keyed by view type.

### Applying a template to new views

**Schema defaults** (GUI population): `getBasesViewOptions()` applies template values via `Object.assign(d, template)` before building the schema. Only applies when `isNewView` (`!config || config.get('id') == null`).

**YAML injection** (`cleanUpBaseFile()`): When a new view is detected (needs new ID and is not a rename), template values are injected directly into the YAML object, **unconditionally overwriting** existing values:

```ts
for (const [key, value] of Object.entries(template)) {
  const yamlValue =
    key === 'minimumColumns' && typeof value === 'number'
      ? value === 1 ? 'one' : 'two'
      : value;
  if (viewObj[key] !== yamlValue) {
    viewObj[key] = yamlValue;
    changeCount++;
  }
}
```

Unconditional override is required because Obsidian pre-populates ALL schema defaults into the `.base` YAML config when creating a new view through the UI — `cleanUpBaseFile` runs AFTER this pre-population, so all keys already exist. A `if (!(key in viewObj))` guard would silently skip every template value.

**Config fallbacks** (`readBasesSettings()`): `templateOverrides` are spread into `defaults` so config reads fall back to template values before static defaults.

### New view detection

`!config || config.get('id') == null` — the `id` field is assigned by `cleanUpBaseFile()` on first render. Absence of `id` means the view has never been rendered. The `!config` guard handles the case where Obsidian doesn't pass config.

## Migration

### basesState migration (`migrateBasesState()`)

When a view is renamed (detected in `cleanUpBaseFile()` as an existing unique ID whose name portion changed), the old basesState key is moved to the new ID:

```ts
this.data.basesStates[newId] = oldState;
delete this.data.basesStates[oldId];
```

### Legacy YAML cleanup (`cleanUpBaseFile()`)

Two separate cleanup mechanisms:

1. **ALLOWED_VIEW_KEYS filter**: Removes keys not in the allowed set. Covers `DatacoreDefaults` keys that leaked into Bases YAML and any other stale keys from previous versions.
2. **Explicit per-key deletion**: `titleProperty`/`subtitleProperty` are deleted by a dedicated deletion block — they ARE in `ALLOWED_VIEW_KEYS` (as `ViewDefaults` keys) but are no longer valid in Bases YAML (now position-derived via `displayFirstAsTitle`/`displaySecondAsSubtitle`).

Invalid enum values are reset to the first valid value from `VALID_VIEW_VALUES`.

**Hardcoded Bases fields**: `showPropertiesAbove` and `invertPropertyPosition` bypass `config.get()` in `readBasesSettings()` and always use the static default. They have no schema entries in `getBasesViewOptions()`, making them invisible to Bases users.

**Template-aware sparse cleanup**: After the above, `cleanUpBaseFile` runs a sparse pass that deletes YAML keys matching `VIEW_DEFAULTS`. However, when a template overrides a `VIEW_DEFAULTS` value, the `VIEW_DEFAULTS` value becomes a meaningful user choice (differs from the effective default). These keys are preserved — the sparse pass skips deletion when the key exists in the active template.

## Key invariants

1. **Template is read-only until explicitly toggled.** The `isTemplate` toggle is the only way to snapshot current settings as a template. Templates are never auto-updated.
2. **New view detection uses three functionally equivalent signals.** Schema defaults: `!config || config.get('id') == null`. YAML injection: `cleanUpBaseFile()` checks raw `viewObj.id` presence and name match, returns `isNew` flag. Config fallbacks: caller passes `templateOverrides` conditionally based on `isNew` from `cleanUpBaseFile()`.
3. **`_skipLeadingProperties` is computed, never persisted.** Recalculated on every `readBasesSettings()` call from the current property order.
4. **`DATACORE_DEFAULTS` overrides `VIEW_DEFAULTS`** for `titleProperty` (`'$name'` over `'file.name'`), `subtitleProperty` (`''` over `'file.folder'`), and `pairProperties` (`true` over `false`) via spread order in `resolveSettings()`.
5. **`BASES_DEFAULTS.displayFirstAsTitle = true`** overrides `VIEW_DEFAULTS.displayFirstAsTitle = false`. This is the primary behavioral difference between backends — Bases derives title from property order by default.
6. **Per-query Datacore state is isolated by `QUERY_ID`.** Each code block instance has its own persisted settings and UI state.
7. **Stale config guards prevent reverts from duplicate callbacks.** `imageFormat` and `propertyLabels` fall back to `previousSettings` when config returns invalid values.
8. **`minimumColumns` requires coercion at every boundary.** Bases YAML stores `"one"`/`"two"` strings; internal types use `1 | 2` numbers. Masonry defaults to `2`, Grid to `1`. All sites use `getMinimumColumnsDefault(viewType)` as single source of truth.
9. **Sparse storage ensures new defaults propagate.** Only non-default values are persisted, so adding a new default or changing an existing one automatically applies to all users who haven't overridden it.
10. **Template cleanup runs on every plugin load.** Stale keys, wrong types, and invalid enum values are removed from templates before use.
11. **Obsidian pre-populates schema defaults into new `.base` YAML.** `cleanUpBaseFile()` runs AFTER this, so template injection must unconditionally overwrite — not guard with `if (!(key in viewObj))`.
12. **`getBasesViewOptions()` is NOT called on view creation.** Only called when the settings panel is opened. Template injection for new views happens in `cleanUpBaseFile()`, not via schema defaults.
