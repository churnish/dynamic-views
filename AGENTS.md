# Dynamic Views

- **Error surfacing**: `new Notice()` ONLY for user-initiated action failures and confirmations. Internal and background failures MUST use `console.error`/`console.warn` — NEVER surface notices for operations the user did NOT trigger.
- **Grid and Masonry performance is paramount**: Every optimization — no matter how minor — is valuable. Never dismiss a performance improvement as "not worth it".

## Terminology

- **Plugin name**: NEVER abbreviate the plugin name to 'DV' in the codebase, stylesheet, or any user-facing text. ALWAYS use the full name 'Dynamic Views'. The 'DV' shorthand is acceptable in fleeting chat contexts ONLY.
- **Prefix**: NEVER use the `dv-` prefix as a shorthand for Dynamic Views. ONLY use the full `dynamic-views-` prefix in ALL contexts.
- **View names**: ALWAYS capitalize plugin view names: 'Grid', 'Masonry', 'List' NOT 'grid', 'masonry', 'list'. Do NOT capitalize when referring to the layout itself rather than the view as a whole.
- **Card views**: NEVER use the term 'card view' (singular). Use 'Grid' or 'Masonry' instead. To refer to both collectively, use 'card views' (plural).
- **Avoid 'base'**: NEVER use 'base' to mean 'default' in comments, docs, file names, function/class/variable names, or any user-facing text — ambiguous with Obsidian's Bases core plugin. Use synonyms like 'standard', 'core', and 'initial' instead.
- **Press over click/tap**: In all user-facing text, prefer 'press' over 'click' and 'tap'.
- **Style Settings**: NEVER abbreviate to 'SS' in comments, docs, or user-facing text. ALWAYS use the full name 'Style Settings'. To refer to a singular option, use 'style setting' (lowercase).
- **Text preview**: When referring to the Markdown-stripped text shown on cards, ALWAYS use 'text preview' NOT 'preview'. Use 'previews' (plural) ONLY when referring to both text preview and thumbnail image format collectively.

## Datacore property display

- **Current state**: Datacore card views display ONLY hardcoded properties (`file.tags`, `file.mtime`). Custom user-defined properties are NOT yet supported.
- **Future parity**: Datacore will gain full property display parity with Bases — configurable property lists, custom timestamp properties, labels, icons, and ALL rendering features. Shared helpers in `render-utils.ts` (`isTimestampProperty`, `getTimestampIcon`) already accept both `BasesResolvedSettings` and `ResolvedSettings`.
- **Lay the foundation**: When working on shared infrastructure (helpers, types, rendering logic), ALWAYS design it to work with both backends. Wire up Datacore call sites even when the feature is NOT yet observable there.

## Navigation

- **Docs**: Consult @docs/project-structure.md and @docs/index.md before reading or editing any file in the codebase. ALWAYS update both when adding, removing, or renaming source, test, or doc files. When working on a complex system with no existing doc covering it, suggest creating an architectural doc. Proactively keep ALL docs up-to-date by running the `/document` skill.
- **Wiki**: Consult @wiki/wiki-structure.md for user-facing, human-verified plugin wiki pages that document how features and settings are meant to function.
