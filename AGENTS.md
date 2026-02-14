# Dynamic Views

- **Naming prefix**: Never use the `dv-` prefix as a shorthand for Dynamic Views. Only use the full `dynamic-views-` prefix in all contexts.
- **Plugin name**: Never abbreviate the plugin name to 'DV' in the codebase, stylesheet, or any user-facing text. Always use the full name 'Dynamic Views'. It's OK to use the 'DV' shorthand in fleeting chat contexts only.

## Reference files

Use @ref/architecture/project-structure.md to navigate the codebase — it maps every file and its responsibility. Always keep it up-to-date as the structure changes.

When a reference file listed below is relevant to your current work, you MUST read it before proceeding. Do NOT rely on assumptions — consult the reference first.

All paths below are relative to `ref/project-knowledge/`.

- Read **obsidian-review-bot.md** before fixing bot-reported issues, adding/modifying eslint-disable comments, or preparing a PR for the Obsidian plugin review.
- Read **eslint-config.md** before modifying `eslint.config.js`, adding eslint overrides, or troubleshooting lint errors.
- Read **ios-webkit-quirks.md** before modifying content-visibility, IntersectionObserver, or scroll-state container queries — iOS WebKit has platform-specific bugs.
- Read **obsidian-api-quirks.md** before using `vault.process()`, `vault.modify()`, `new Notice()`, or any file I/O that could race with Obsidian's debounced writes.
