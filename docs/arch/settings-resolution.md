---
title: Settings resolution pipeline
description: Three-layer merge of defaults, templates, and per-view config into resolved settings. Covers sparse storage, type coercion, stale guards, and migration.
author: 🤖 Generated with Claude Code
updated: 2026-04-10
---
# Settings resolution pipeline

See also: [`odkb/obsidian-api-quirks.md`](https://github.com/churnish/odkb/blob/main/obsidian-api-quirks.md)

The settings resolution pipeline merges static defaults, template overrides, and per-view config into fully resolved settings objects for Bases. Covers the three-layer resolution chain, sparse storage pattern, position-based title/subtitle derivation, stale config guards, type coercion, template system, and migration. For the user-facing setting keys, defaults, ranges, and programmatic API, see [view-configuration.md](../patterns/view-configuration.md).

## Files

| File                            | Role                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/constants.ts`              | Static defaults (`VIEW_DEFAULTS`, `BASES_DEFAULTS`, `PLUGIN_SETTINGS`)                                             |
| `src/types.ts`                  | `ViewDefaults`, `PluginSettings`, `ResolvedSettings`, `BasesDefaults`                                         |
| `src/persistence.ts`            | `PersistenceManager` — sparse storage, sanitization, template CRUD, migration                                      |
| `src/core/settings-schema.ts` | `readBasesSettings()`, `extractBasesTemplate()`, `getBasesViewOptions()` schema builder                            |
| `src/core/view-validation.ts` | `VALID_VIEW_VALUES`, `VIEW_DEFAULTS_TYPES` — shared validation constants for YAML cleanup, template cleanup, and runtime enum validation |
| `src/bases/utils.ts`            | `cleanUpBaseFile()` — YAML cleanup, template injection, ID management                                              |

## Core data structures

### PluginSettings (`src/types.ts`)

Plugin-level settings from the settings tab. Not per-view.

| Field                       | Type                                              | Purpose                               |
| --------------------------- | ------------------------------------------------- | ------------------------------------- |
| `smartTimestamp`            | `boolean`                                         | Use relative timestamps               |
| `createdTimeProperty`       | `string`                                          | Property name for created time        |
| `modifiedTimeProperty`      | `string`                                          | Property name for modified time       |
| `randomizeAction`           | `string`                                          | Shuffle/randomize behavior            |
| `openOnTitle`               | `boolean`                                         | Title, rather than card, opens files  |
| `preventSidebarSwipe`       | `boolean`                                         | Prevent sidebar swipe on mobile       |
| `revealInNotebookNavigator` | `'disable' \| 'files-folders' \| 'tags' \| 'all'` | Notebook Navigator integration        |
| `showYoutubeThumbnails`     | `boolean`                                         | Fetch YouTube thumbnails              |
| `showCardLinkCovers`        | `boolean`                                         | Fetch card link cover images          |
| `folderCommands`            | `boolean`                                         | Show folder commands in context menus |
| `fullScreen`                | `boolean`                                         | Hide interface on scroll (phone)      |
| `openRandomInNewTab`        | `boolean`                                         | Open random file in new tab           |

**Migrated fields**: `omitFirstLine` was migrated to a Style Settings `class-select` (read via `getOmitFirstLineMode()` in JS).

### ViewDefaults (`src/types.ts`)

Per-view visual settings. 29 fields covering card size, title, text preview, image, properties, and layout.

| Field                     | Type                            | Default         | Notes                                                                               |
| ------------------------- | ------------------------------- | --------------- | ----------------------------------------------------------------------------------- |
| `cardSize`                | `number`                        | `300`           | Card width in pixels                                                                |
| `titleProperty`           | `string`                        | `'file.name'`   | Position-based derivation when `displayFirstAsTitle` is ON                          |
| `subtitleProperty`        | `string`                        | `'file.folder'` | Position-based derivation when `displaySecondAsSubtitle` is ON                      |
| `displayFirstAsTitle`     | `boolean`                       | `false`         | Overridden by `BASES_DEFAULTS` (`true`)                                             |
| `displaySecondAsSubtitle` | `boolean`                       | `false`         | Overridden by `BASES_DEFAULTS` (`false`)                                            |
| `propertyNames`           | `'hide' \| 'inline' \| 'above'` | `'hide'`        | Overridden by `BASES_DEFAULTS` (`'inline'`). Has stale config guard                 |
| `minimumColumns`          | `1 \| 2`                        | `1`             | Masonry default is `2` (view-type-specific, not in `BASES_DEFAULTS`)                |
| `imageFormat`             | enum                            | `'thumbnail'`   | Has stale config guard                                                              |

### BasesDefaults (`src/types.ts`)

Bases-only overrides that shadow `ViewDefaults` fields.

| Field                     | Type                            | Default    | Shadows                                |
| ------------------------- | ------------------------------- | ---------- | -------------------------------------- |
| `displayFirstAsTitle`     | `boolean`                       | `true`     | `ViewDefaults.displayFirstAsTitle`     |
| `displaySecondAsSubtitle` | `boolean`                       | `false`    | `ViewDefaults.displaySecondAsSubtitle` |
| `propertyNames`           | `'hide' \| 'inline' \| 'above'` | `'inline'` | `ViewDefaults.propertyNames`           |

### Resolved types

| Type                    | Definition                                                                       | Used by                     |
| ----------------------- | -------------------------------------------------------------------------------- | --------------------------- |
| `ResolvedSettings` | `PluginSettings & ViewDefaults` + `_displayNameMap?` + `_skipLeadingProperties?` | Bases rendering pipeline    |

### PluginData (`src/types.ts`)

Top-level persisted structure.

| Field            | Type                                                          | Purpose                                      |
| ---------------- | ------------------------------------------------------------- | -------------------------------------------- |
| `pluginSettings` | `Partial<PluginSettings>`                                     | Sparse plugin-level settings                 |
| `templates`      | `Partial<Record<'grid' \| 'masonry', SettingsTemplate>>`      | Settings snapshots for new views             |
| `basesStates`    | `Record<string, BasesUIState>`                                | Per-view collapsed groups (keyed by view ID) |

## Resolution chains

### Bases path

`readBasesSettings()` in [settings-schema.ts](../../src/core/settings-schema.ts). Called on every `onDataUpdated()`.

```
1. VIEW_DEFAULTS                    (static)
2. BASES_DEFAULTS                   (static, overrides VIEW_DEFAULTS)
3. templateOverrides                (sparse user template, fallback for new views)
   ─── merged into `defaults` ───
4. config.get(key)                  (per-view Bases YAML values override defaults)
5. pluginSettings                   (spread into final object alongside view settings)
```

Precedence (highest wins): `config.get()` -> `templateOverrides` -> `BASES_DEFAULTS` -> `VIEW_DEFAULTS`. Plugin-level fields come from `pluginSettings` without overlap (different key sets).

Return type: `ResolvedSettings` (includes computed `_skipLeadingProperties`).

### Schema defaults path

`getBasesViewOptions()` in [settings-schema.ts](../../src/core/settings-schema.ts). Called when the **settings panel is opened**, NOT on view creation or file open. Populates dropdown defaults and option lists.

```
1. VIEW_DEFAULTS + BASES_DEFAULTS              (static merge)
2. getMinimumColumnsDefault(viewType)          (view-type-specific: masonry=2, grid=1)
3. template (if new view)                      (Object.assign onto merged defaults)
```

New view detection: `!config || config.get('id') == null`. The `id` field is assigned by `cleanUpBaseFile()` on first render — absence means never rendered.

## Resolution algorithm

`readBasesSettings()` is the single entry point for resolving per-view settings. It runs on every `onDataUpdated()` call (see [config-reactivity.md](config-reactivity.md) for the full trigger pipeline).

### Merge sequence

```
 ┌─────────────────────────────────────────────────────────────┐
 │  1. Build defaults object                                   │
 │     { ...VIEW_DEFAULTS,                                     │
 │       ...BASES_DEFAULTS,                                    │
 │       minimumColumns: getMinimumColumnsDefault(viewType),   │
 │       ...templateOverrides }                                │
 │                                                             │
 │  2. For each ViewDefaults key:                              │
 │     value = config.get(key) ?? defaults[key]                │
 │     (type-checked: getString, getBool, getNumber,           │
 │      or getValidEnum with stale config fallback)            │
 │                                                             │
 │  3. Derive position-based title/subtitle from getOrder()    │
 │     (overrides titleProperty / subtitleProperty)            │
 │                                                             │
 │  4. Filter hidden properties against getOrder()             │
 │     (textPreviewProperty / urlProperty cleared if not in    │
 │      the visible order set)                                 │
 │                                                             │
 │  5. Hardcoded fields bypass config entirely:                │
 │     showPropertiesAbove = defaults.showPropertiesAbove      │
 │     invertPropertyPosition = defaults.invertPropertyPosition│
 │                                                             │
 │  6. Merge: { ...pluginSettings, ...viewSettings,            │
 │              _skipLeadingProperties }                        │
 │     → returns ResolvedSettings                              │
 └─────────────────────────────────────────────────────────────┘
```

### Type-safe config getters

`createConfigGetters(config)` returns three functions that read from `config.get()` with type validation and fallback to defaults:

| Getter | Accepts | Fallback rule |
|---|---|---|
| `getString(key, fallback)` | `string` (including `""`) | Non-string or `undefined`/`null` → fallback |
| `getBool(key, fallback)` | `boolean` | Non-boolean → fallback |
| `getNumber(key, fallback)` | `number` (finite only) | Non-number or `NaN`/`Infinity` → fallback |

Enum fields (`imageFormat`, `propertyNames`, `showFileImages`, etc.) use `getValidEnum()` instead. It validates against `VALID_VIEW_VALUES` and optionally falls back to `previousSettings` before the default — this is the stale config guard mechanism.

### When each layer is consulted

| Layer | First render | Subsequent renders | New view | Existing view |
|---|---|---|---|---|
| `VIEW_DEFAULTS` | Always | Always | Always | Always |
| `BASES_DEFAULTS` | Always (overrides `VIEW_DEFAULTS`) | Always | Always | Always |
| `templateOverrides` | Only if `isNewView` | Never | Merged into defaults | Skipped |
| `config.get()` | Always (may return pre-populated schema defaults) | Always (authoritative) | Reads schema defaults (pre-populated by Obsidian) | Reads user-set values |
| `pluginSettings` | Always (separate key namespace) | Always | Always | Always |
| `previousSettings` | Not available (no prior render) | Stale enum fallback only | Not available | Passed from `lastRenderedSettings` |

On first render of a **new view**, Obsidian pre-populates the `.base` YAML with schema defaults from `getBasesViewOptions()`. Then `cleanUpBaseFile()` overwrites those with template values. So `config.get()` returns template-injected values, and `templateOverrides` in `readBasesSettings()` serves as a belt-and-suspenders fallback for any keys that `cleanUpBaseFile()` missed.

On first render of an **existing view** (app restart), `config.get()` returns the user's saved YAML values directly. No template overrides are applied — `isNewView` is `false` because the view already has an `id`.

## Cleanup lifecycle

`cleanUpBaseFile()` in [utils.ts](../../src/bases/utils.ts) is the YAML maintenance function. It processes ALL Dynamic Views view entries in a `.base` file at once.

### When it runs

Called from `processDataUpdate()` (inside `onDataUpdated()`) only when:
- **First render**: `this.viewId` is not set yet.
- **View rename**: `this.viewId` doesn't end with the current view name.

It is intentionally skipped on subsequent renders to avoid `vault.process()` racing with Obsidian's debounced `config.set()` file writes.

### What it does (in order)

1. **Caller guard**: Aborts (returns `null`) if the calling view's name isn't in the on-disk YAML yet (Obsidian may not have flushed a newly created view).
2. **ID pre-scan**: Counts ID occurrences across all view entries to detect duplicates. Used in step 3 to distinguish renames from duplicates.
3. **ID management**: For each Dynamic Views view entry:
   - If `id` is missing or the name portion doesn't match the current view name, generates a new `id` (`{hash}-{viewName}`).
   - **Rename detection**: If an existing unique ID's name portion changed, it's a rename (not a new view). The old `basesState` is migrated to the new ID via `migrateBasesState()`.
   - **New view detection**: If a new ID is needed and it's NOT a rename, it's a new view. Template values are injected into the YAML (see [Template application](#template-system)).
4. **Stale key removal**: Deletes any key not in `ALLOWED_VIEW_KEYS` (a union of Bases-native keys, `ViewDefaults` keys, `isTemplate`, and `id`).
5. **Type validation**: Deletes values whose type doesn't match `VIEW_DEFAULTS_TYPES` (skipping `minimumColumns` — YAML stores strings, defaults store numbers).
6. **Enum validation**: Resets invalid enum values to the first entry in `VALID_VIEW_VALUES`.
7. **Legacy key deletion**: Explicitly deletes `titleProperty` and `subtitleProperty` — they are valid `ViewDefaults` keys but stale in Bases YAML (now position-derived).
8. **Sparse cleanup**: Deletes YAML keys whose value matches `VIEW_DEFAULTS`, with two exceptions:
   - Keys in `BASES_DEFAULTS` are preserved (the `VIEW_DEFAULTS` value is a meaningful non-default choice in Bases context).
   - Keys present in the active template are preserved (the `VIEW_DEFAULTS` value is an explicit user choice that differs from the template-modified effective default).

### Return value

Returns `Promise<Map<string, { id: string; isNew: boolean }> | null>`. Returns `null` on early abort (no file, not a `.base` file, caller view not found in YAML). Callers use optional chaining (`viewIds?.get(viewName)`) and check `isNew` to decide whether to pass `templateOverrides` to `readBasesSettings()`.

## Role of view-validation.ts

[view-validation.ts](../../src/core/view-validation.ts) exports two shared validation constants consumed by both `cleanupTemplateSettings()` (persistence) and `cleanUpBaseFile()` (YAML cleanup):

| Export | Type | Purpose |
|---|---|---|
| `VALID_VIEW_VALUES` | `Partial<Record<keyof ViewDefaults, readonly string[]>>` | Valid enum values for string-enum fields. Used by `getValidEnum()` in settings reading, `cleanUpBaseFile()` for YAML enum reset, and `cleanupTemplateSettings()` for template enum reset. |
| `VIEW_DEFAULTS_TYPES` | `Record<string, string>` | Expected `typeof` for each `VIEW_DEFAULTS` key (computed at module load from `VIEW_DEFAULTS`). Used by `cleanUpBaseFile()` and `cleanupTemplateSettings()` to delete wrong-typed values. |

These constants are extracted into a shared module to ensure that YAML cleanup, template cleanup, and runtime config reading all validate against the same set of valid values and types. Without this, adding a new enum option would require updating multiple files.

## Sparse storage pattern

Only non-default values are persisted. This keeps `data.json` minimal and ensures new defaults propagate to existing installations.

### Where sparse filtering occurs

| Location                 | What it filters        | Comparison target                            | Special handling                                                                                               |
| ------------------------ | ---------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `setPluginSettings()`    | Plugin settings        | `PLUGIN_SETTINGS`                            | Shallow sanitize before compare; dispatches `PLUGIN_SETTINGS_CHANGE` via `app.workspace.trigger()` after saving     |
| `setBasesState()`        | Collapsed groups       | Empty array                                  | Empty -> delete key                                                                                            |
| `extractBasesTemplate()` | Template values        | `VIEW_DEFAULTS` merged with `BASES_DEFAULTS` | Only non-default pairs retained                                                                                |
| `save()`                 | Top-level keys         | Empty object check                           | Skips empty sub-objects entirely                                                                               |

### Stored template cleanup

`PersistenceManager.load()` runs `cleanupTemplateSettings()` on each stored template to remove:

1. Keys not in `VIEW_DEFAULTS`
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
| `propertyNames`  | Validate against `'hide' \| 'inline' \| 'above'`. If invalid: fall back to `previousSettings.propertyNames`, then to `defaults.propertyNames`.                 |

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

1. User toggles `isTemplate` ON in Bases view settings.
2. `extractBasesTemplate()` reads all config values with same coercion as `readBasesSettings()`, compares against merged defaults (`{...VIEW_DEFAULTS, ...BASES_DEFAULTS}`), returns only non-default pairs.
3. `BASES_DEFAULTS` values serve as the comparison target for those keys — no keys are skipped from the sparse filter.
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

### Template cleanup on load

`PersistenceManager.load()` runs `cleanupTemplateSettings()` on each stored template. This removes stale keys from older plugin versions before any view renders. See [Stored template cleanup](#stored-template-cleanup) under sparse storage for the full cleanup steps.

### Template interaction with the resolution chain

Templates participate in the resolution chain at three points, each serving a different purpose:

| Point | Function | Purpose |
|---|---|---|
| Schema defaults | `getBasesViewOptions()` | Populates the settings GUI with template values for new views |
| YAML injection | `cleanUpBaseFile()` | Writes template values directly into the `.base` file YAML |
| Config fallback | `readBasesSettings()` | Ensures `config.get()` falls back to template values before static defaults |

All three use the same new-view detection (`id` field absence) and the same template source (`persistenceManager.getSettingsTemplate()`). The redundancy is intentional — YAML injection is the primary mechanism, but config fallbacks cover any keys that `cleanUpBaseFile()` didn't write (e.g., if `vault.process()` failed silently).

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

1. **ALLOWED_VIEW_KEYS filter**: Removes keys not in the allowed set. Covers stale keys from previous versions.
2. **Explicit per-key deletion**: `titleProperty`/`subtitleProperty` are deleted by a dedicated deletion block — they ARE in `ALLOWED_VIEW_KEYS` (as `ViewDefaults` keys) but are no longer valid in Bases YAML (now position-derived via `displayFirstAsTitle`/`displaySecondAsSubtitle`).

Invalid enum values are reset to the first valid value from `VALID_VIEW_VALUES`.

**Hardcoded Bases fields**: `showPropertiesAbove` and `invertPropertyPosition` bypass `config.get()` in `readBasesSettings()` and always use the static default. They have no schema entries in `getBasesViewOptions()`, making them invisible to Bases users.

**Template-aware sparse cleanup**: After the above, `cleanUpBaseFile` runs a sparse pass that deletes YAML keys matching `VIEW_DEFAULTS`. However, when a template overrides a `VIEW_DEFAULTS` value, the `VIEW_DEFAULTS` value becomes a meaningful user choice (differs from the effective default). These keys are preserved — the sparse pass skips deletion when the key exists in the active template.

## Key invariants

1. **Template is read-only until explicitly toggled.** The `isTemplate` toggle is the only way to snapshot current settings as a template. Templates are never auto-updated.
2. **New view detection uses three functionally equivalent signals.** Schema defaults: `!config || config.get('id') == null`. YAML injection: `cleanUpBaseFile()` checks raw `viewObj.id` presence and name match, returns `isNew` flag. Config fallbacks: caller passes `templateOverrides` conditionally based on `isNew` from `cleanUpBaseFile()`.
3. **`_skipLeadingProperties` is computed, never persisted.** Recalculated on every `readBasesSettings()` call from the current property order.
4. **`BASES_DEFAULTS.displayFirstAsTitle = true`** overrides `VIEW_DEFAULTS.displayFirstAsTitle = false` — title is derived from property order by default.
5. **Stale config guards prevent reverts from duplicate callbacks.** `imageFormat` and `propertyNames` fall back to `previousSettings` when config returns invalid values.
6. **`minimumColumns` requires coercion at every boundary.** Bases YAML stores `"one"`/`"two"` strings; internal types use `1 | 2` numbers. Masonry defaults to `2`, Grid to `1`. All sites use `getMinimumColumnsDefault(viewType)` as single source of truth.
7. **Sparse storage ensures new defaults propagate.** Only non-default values are persisted, so adding a new default or changing an existing one automatically applies to all users who haven't overridden it.
8. **Template cleanup runs on every plugin load.** Stale keys, wrong types, and invalid enum values are removed from templates before use.
9. **Obsidian pre-populates schema defaults into new `.base` YAML.** `cleanUpBaseFile()` runs AFTER this, so template injection must unconditionally overwrite — not guard with `if (!(key in viewObj))`.
10. **`getBasesViewOptions()` is NOT called on view creation.** Only called when the settings panel is opened. Template injection for new views happens in `cleanUpBaseFile()`, not via schema defaults.
11. **`cleanUpBaseFile()` runs only on first render or rename.** Subsequent renders skip it to avoid `vault.process()` racing with Obsidian's debounced config writes. The caller checks `!this.viewId || name mismatch`.
12. **`VALID_VIEW_VALUES` and `VIEW_DEFAULTS_TYPES` are the single source of truth for validation.** `VALID_VIEW_VALUES` is shared by `cleanUpBaseFile()`, `cleanupTemplateSettings()`, and `getValidEnum()`. `VIEW_DEFAULTS_TYPES` is shared by `cleanUpBaseFile()` and `cleanupTemplateSettings()` (not used by `getValidEnum()`). Adding a new enum option or field type requires updating only `view-validation.ts` and `constants.ts`.
13. **Templates participate at three resolution points.** Schema defaults (GUI), YAML injection (`cleanUpBaseFile`), and config fallbacks (`readBasesSettings`). All three use the same new-view detection and template source. The redundancy is a safety net — YAML injection is primary.
