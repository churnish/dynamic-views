# Dynamic Views

## Terminology

- **Plugin name**: NEVER abbreviate the plugin name to 'DV' in the codebase, stylesheet, or any user-facing text. ALWAYS use the full name 'Dynamic Views'. The 'DV' shorthand is acceptable in fleeting chat contexts ONLY.
- **Prefix**: NEVER use the `dv-` prefix as a shorthand for Dynamic Views. ONLY use the full `dynamic-views-` prefix in ALL contexts.
- **View names**: ALWAYS capitalize plugin view names: 'Grid', 'Masonry', 'List' NOT 'grid', 'masonry', 'list'. Do NOT capitalize when referring to the layout itself rather than the view as a whole.
- **Card views**: NEVER use the term 'card view' (singular). Use 'Grid' or 'Masonry' instead. To refer to both collectively, use 'card views' (plural).
- **Avoid "base"**: NEVER use "base" to mean "default" in comments, docs, file names, function/class/variable names, or any user-facing text — ambiguous with Obsidian's Bases feature. Use synonyms like "standard", "core", and "initial" instead.
- **Press over click/tap**: In all user-facing text, prefer "press" over "click" and "tap".

## Datacore property display

- **Current state**: Datacore card views display ONLY hardcoded properties (`file.tags`, `file.mtime`). Custom user-defined properties are NOT yet supported.
- **Future parity**: Datacore will gain full property display parity with Bases — configurable property lists, custom timestamp properties, labels, icons, and ALL rendering features. Shared helpers in `render-utils.ts` (`isTimestampProperty`, `getTimestampIcon`) already accept both `BasesResolvedSettings` and `ResolvedSettings`.
- **Lay the foundation**: When working on shared infrastructure (helpers, types, rendering logic), ALWAYS design it to work with both backends. Wire up Datacore call sites even when the feature is NOT yet observable there.

## Performance

- **Grid and Masonry performance is paramount**: Every optimization — no matter how minor — is valuable. Never dismiss a performance improvement as "not worth it".

## Knowledge files

Use @knowledge/project-structure.md as a navigational guide before reading or editing any file in the codebase.

Consult @wiki/wiki-structure.md to find user-facing, human-verified plugin wiki pages that document how features and settings are meant to function.

### knowledge/architecture

Read...

- **card-dom-structure.md** before working on card internals, card CSS selectors, property rows, or DOM differences between Bases and Datacore — documents the full card hierarchy, class names, property row structure, and backend divergences.
- **grid-layout.md** before working on grid layout, CSS Grid columns, content visibility, or grid-specific resize/infinite scroll — documents the full architecture, data structures, render pipeline, guard system, and invariants.
- **masonry-layout.md** before working on masonry layout, virtual scrolling, resize handling, or infinite scroll — documents the full architecture, data structures, render pipeline, guard system, and invariants.

### knowledge/patterns

Read...

- **eslint-config.md** before modifying `eslint.config.js`, adding eslint overrides, or troubleshooting lint errors.
- **scss-nesting-conventions.md** before adding or restructuring `.dynamic-views` selectors in SCSS partials — covers what to nest and what to leave flat.
- **datacore-ref-callback-patterns.md** before attaching event listeners or stateful behavior in `card-renderer.tsx` ref callbacks — documents re-render signal churn, cross-container collisions, and the WeakMap solution.
- **style-settings-fallbacks.md** before adding or modifying `class-select` settings in `_style-settings.scss` — documents the fallback selector pattern for CSS defaults that must work without the Style Settings plugin installed.
- **electron-css-quirks.md** before writing nested `:has()` selectors or working around `-webkit-line-clamp` truncation behavior — documents Blink/Electron CSS rendering quirks and rejected fixes.
