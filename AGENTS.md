# Dynamic Views

- **Backwards compatibility**: Always ask before adding backwards compatibility or migration code.
- **Naming prefix**: Never use the `dv-` prefix as a shorthand for Dynamic Views. Only use the full `dynamic-views-` prefix in all contexts.
- **Plugin name**: Never abbreviate the plugin name to 'DV' in the codebase, stylesheet, or any user-facing text. Always use the full name 'Dynamic Views'. It's OK to use the 'DV' shorthand in fleeting chat contexts only.
- **Test and verify changes via Chrome DevTools MCP** whenever possible — inspect DOM, run scripts, take screenshots etc. Only defer to the user when human judgement is required. The user always performs final verification.

## Reference files

Use @ref/project-structure.md to navigate the codebase — it maps every file and its responsibility. Always keep it up-to-date as the structure changes.

When a reference file listed below is relevant to your current work, you MUST read it before proceeding. Do NOT rely on assumptions — consult the reference first.

- Read **ref/obsidian-review-bot.md** before fixing bot-reported issues, adding/modifying eslint-disable comments, or preparing a PR for the Obsidian plugin review.
- Read **ref/eslint-config.md** before modifying `eslint.config.js`, adding eslint overrides, or troubleshooting lint errors.
- Read **ref/ios-webkit-quirks.md** before modifying content-visibility, IntersectionObserver, or scroll-state container queries — iOS WebKit has platform-specific bugs.
- Read **ref/obsidian-api-quirks.md** before using `vault.process()`, `vault.modify()`, or any file I/O that could race with Obsidian's debounced writes.
