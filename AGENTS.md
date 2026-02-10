# Dynamic Views instructions

- **Backwards compatibility**: Always ask before adding backwards compatibility or migration code.
- **Naming prefix**: Never use the `dv-` prefix as a shorthand for Dynamic Views. Only use the full `dynamic-views-` prefix in all contexts.
- **Plugin name**: Never abbreviate the plugin name to 'DV' in the codebase, stylesheet, or any user-facing text. Always use the full name 'Dynamic Views'. It's OK to use the 'DV' shorthand in fleeting chat contexts only.
- **Test and verify changes via Chrome DevTools MCP** whenever possible — inspect DOM, run scripts, take screenshots etc. Only defer to the user when human judgement is required. The user always performs final verification.

## Terminology

- Use **"properties"** (never "frontmatter" or "front-matter") when referring to YAML metadata at the top of Markdown files.
- **"Markdown"** is a proper noun and must always be capitalized.

## Reference files

When a reference file listed below is relevant to your current work, you MUST read it before proceeding. Do NOT rely on assumptions — consult the reference first.

- Read **ref/obsidian-review-bot.md** before fixing bot-reported issues, adding/modifying eslint-disable comments, or preparing a PR for the Obsidian plugin review.
- Read **ref/eslint-config.md** before modifying `eslint.config.js`, adding eslint overrides, or troubleshooting lint errors.
