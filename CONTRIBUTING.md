**Thank you for your interest in contributing!**

To get started, see [good first issues](https://github.com/churnish/dynamic-views/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22Help%20wanted%22) or [most valuable issues](https://github.com/churnish/dynamic-views/issues?q=is%3Aissue%20state%3Aopen%20(label%3A%22%F0%9F%9F%A0%20High%20priority%22%20OR%20label%3A%22%F0%9F%9F%A1%20Medium%20priority%22)).

Reach out if you'd like to co-maintain the plugin — we could really use the help.

You can reach churnish on Discord: https://discord.com/users/1315765624894656655

## Setup

```bash
git clone https://github.com/churnish/dynamic-views.git
cd dynamic-views
npm install
```

| Command | What it does |
|---|---|
| `npm run dev` | Watch mode — rebuilds JS/TS on save |
| `npm run css` | Compile SCSS to `styles.css` (one-shot) |
| `npm run css:watch` | Watch mode — recompiles SCSS on save |
| `npm run build` | Full production build (CSS + JS) |
| `npm test` | Run test suite |

During development, run `npm run dev` and `npm run css:watch` in parallel.

Before submitting, run the full pipeline:

```bash
npx prettier --write . && npx eslint . && npm run css && npx tsc --noEmit && node esbuild.config.mjs production && npm run knip && npm test
```

## Architecture

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/churnish/dynamic-views)

Dynamic Views renders card views in Obsidian's Bases plugin using direct DOM manipulation.

Start here:

- [AGENTS.md](AGENTS.md) — codebase conventions, terminology, navigation pointers
- [docs/overview.md](docs/overview.md) — architecture, backends, data flow, major systems
- [docs/index.md](docs/index.md) — full doc index with "read before" guidance for every doc
- [docs/project-structure.md](docs/project-structure.md) — directory tree with file descriptions

## SCSS

Styles live in `styles/` as SCSS partials, compiled with Dart Sass (no autoprefixer). Entry point is [styles/main.scss](styles/main.scss), which loads all partials in dependency order.

Card-specific styles are in `styles/card/`. The plugin integrates with the [Style Settings](https://github.com/mgalloy/obsidian-style-settings) plugin via a YAML comment block in `styles/_style-settings.scss`.

## Testing

Tests live in `tests/` and mirror the `src/` directory structure. The test runner is Vitest with a jsdom environment.

```bash
npm test              # Single run
npm run test:watch    # Watch mode
npm run test:coverage # With coverage report
```

An Obsidian API mock is at `tests/__mocks__/obsidian.ts`.
