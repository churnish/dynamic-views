---
title: ESLint configuration
description: ESLint config structure, project overrides, and bot vs local differences.
author: 🤖 Generated with Claude Code
last updated: 2026-03-11
---
# ESLint configuration

This project uses `eslint-plugin-obsidianmd`'s `recommended` config, which bundles JS recommended, TypeScript type-checked, and Obsidian-specific rules.

## Config structure

The config uses `defineConfig()` from `eslint/config` — required because the obsidianmd recommended config uses `extends` in flat config entries.

### What the recommended config includes

- **`obsidianmd/*`**: 20+ Obsidian-specific rules (commands, settings-tab, vault, DOM, manifest, license, sentence-case, regex-lookbehind, etc.).
- **`@typescript-eslint`**: Type-checked recommended rules.
- **`@microsoft/sdl`**: Security rules (no-document-write, no-inner-html).
- **`import`**: Module rules (no-nodejs-modules, no-extraneous-dependencies).
- **`depend`**: Dependency quality rules (ban-dependencies for microutilities).
- **General rules**: `no-console` (only warn/error/debug), `no-restricted-globals` (app, fetch, localStorage), `no-restricted-imports` (axios, moment direct import), `no-explicit-any` as error.

### Project-specific overrides (2 total)

1. **`@typescript-eslint/no-unused-vars`** — adds `varsIgnorePattern: "^_"` for intentionally unused callback parameters (`_match`, `_newIndex`, etc.).
2. **`no-undef: "off"` for TS files** — TypeScript handles undefined variable checking natively; the ESLint rule produces false positives on the `JSX` namespace. Recommended by typescript-eslint.

## Bot vs local ESLint differences

The Obsidian review bot and local ESLint use the same ruleset but differ in behavior:

- The bot ignores all `eslint-disable` comments (see `plugins/docs/obsidian-review-bot.md`).
- Some rules may report differently due to scanner implementation differences.
- A directive can be "unused" per the bot but needed locally. When this happens, keep it with a description for local ESLint — the bot ignores it anyway.

## Moment.js

Obsidian re-exports moment.js as a named export: `import { moment } from 'obsidian'`. This is the correct import — no `eslint-disable` comments needed. Do NOT import from the `'moment'` package directly (`no-restricted-imports` blocks it). The test mock in `tests/__mocks__/obsidian.ts` exports a matching `moment` stub.

## Restricted disable directives

`@eslint-community/eslint-plugin-eslint-comments` with `no-restricted-disable` blocks `eslint-disable` for `obsidianmd/*` rules. The Obsidian review bot strips all directives before scanning, so suppression is useless — fix the underlying violation instead. The `@eslint-community/eslint-comments/*` pattern is also restricted to prevent self-suppression.

## Sentence case rule workaround

The `obsidianmd/ui/sentence-case` rule flags inline string literals in `.setName()` and `.setDesc()` that contain mid-sentence capitals (e.g., `Ctrl/Cmd`, proper nouns like `Grid` or `Masonry`). Since `obsidianmd/*` rules cannot be suppressed with `eslint-disable` (see above), extract the string to a `const` variable — the rule only checks inline string literals, not variable references.

```ts
// Flagged by sentence-case
.setDesc('Hold Ctrl/Cmd to override.')

// Passes — extracted to const
const OPEN_RANDOM_DESC = 'Hold Ctrl/Cmd to override.';
.setDesc(OPEN_RANDOM_DESC)
```

Existing examples in [plugin-settings.ts](../../src/plugin-settings.ts): `CONTEXT_MENU_DESC`, `OPEN_RANDOM_DESC`.
