# Dynamic Views

- **Naming prefix**: Never use the `dv-` prefix as a shorthand for Dynamic Views. Only use the full `dynamic-views-` prefix in all contexts.
- **Plugin name**: Never abbreviate the plugin name to 'DV' in the codebase, stylesheet, or any user-facing text. Always use the full name 'Dynamic Views'. It's OK to use the 'DV' shorthand in fleeting chat contexts only.

## Reference files

Use @ref/project-structure.md as a navigation reference before reading or editing any file in the codebase.

When a reference file listed below is relevant to your current work, you MUST read it before proceeding. Do NOT rely on assumptions — consult the reference first.

Proactively keep these files up-to-date as the codebase evolves by running /document.

### ref/architecture

Read...

- **grid-layout.md** before working on grid layout, CSS Grid columns, content visibility, or grid-specific resize/infinite scroll — it documents the full architecture, data structures, render pipeline, guard system, and invariants.
- **masonry-layout.md** before working on masonry layout, virtual scrolling, resize handling, or infinite scroll — it documents the full architecture, data structures, render pipeline, guard system, and invariants.

### ref/project-knowledge

Read...

- **obsidian-review-bot.md** before fixing bot-reported issues, adding/modifying eslint-disable comments, or preparing a PR for the Obsidian plugin review.
- **eslint-config.md** before modifying `eslint.config.js`, adding eslint overrides, or troubleshooting lint errors.
- **ios-webkit-quirks.md** before modifying content-visibility, IntersectionObserver, or scroll-state container queries — iOS WebKit has platform-specific bugs.
- **obsidian-api-quirks.md** before using `vault.process()`, `vault.modify()`, `new Notice()`, or any file I/O that could race with Obsidian's debounced writes.
- **scss-nesting-conventions.md** before adding or restructuring `.dynamic-views` selectors in SCSS partials — covers what to nest and what to leave flat.
- **datacore-ref-callback-patterns.md** before attaching event listeners or stateful behavior in `card-renderer.tsx` ref callbacks — documents re-render signal churn, cross-container collisions, and the WeakMap solution.
