# dynamic-views

- **Error surfacing**: `new Notice()` ONLY for user-initiated action failures and confirmations. Internal and background failures MUST use `console.error`/`console.warn` — NEVER surface notices for operations the user did NOT trigger.
- **`--size-*` over `px`**: Use Obsidian's `--size-*` CSS variables (e.g., `var(--size-2-2)`) instead of hardcoded pixel values whenever a matching token exists.
- **No `:has()` in card selectors**: NEVER use `:has()` on elements inside `.dynamic-views` that exist in quantity (cards, properties, covers, previews) or re-evaluate on interaction. `:has()` causes upward style invalidation — with N cards × M properties, a single class toggle triggers O(N×M) recalculation. Use render-time CSS classes instead (e.g., `.has-name`, `.has-poster`).

## Terminology

- **Plugin name**: NEVER abbreviate the plugin name to 'DV' in the codebase, stylesheet, or any user-facing text. ALWAYS use the full name 'Dynamic Views'. The 'DV' shorthand is acceptable in fleeting chat contexts ONLY.
- **Prefix**: NEVER use the `dv-` prefix as a shorthand for Dynamic Views. ONLY use the full `dynamic-views-` prefix in ALL contexts.
- **View names**: ALWAYS capitalize plugin view names: 'Grid', 'Masonry', 'List' NOT 'grid', 'masonry', 'list'. Do NOT capitalize when referring to the layout itself rather than the view as a whole.
- **Card views**: NEVER use the term 'card view' (singular). Use 'Grid' or 'Masonry' instead. To refer to both collectively, use 'card views' (plural).
- **Avoid 'base'**: NEVER use 'base' to mean 'default' in comments, docs, file names, function/class/variable names, or any user-facing text — ambiguous with Obsidian's Bases core plugin. Use synonyms like 'standard', 'core', and 'initial' instead.
- **Style Settings**: NEVER abbreviate to 'SS' in comments, docs, or user-facing text. ALWAYS use the full name 'Style Settings'. To refer to a singular option, use 'style setting' (lowercase).
- **Text preview**: When referring to the Markdown-stripped text shown on cards, ALWAYS use 'text preview' NOT 'preview'. Use 'previews' (plural) ONLY when referring to both text preview and thumbnail image format collectively.
- **Properties**: In user-facing text, use 'properties' (NOT 'frontmatter', 'front-matter', or 'YAML') when referring to YAML metadata at the top of Markdown files. 'Frontmatter' and 'YAML' are acceptable in code, comments, docs, and tests.
- **Markdown**: 'Markdown' is a proper noun and MUST be capitalized.
- **Pane vs viewport**: Use 'pane' when referring to the scroll container's visible dimensions (`scrollEl.clientHeight`/`clientWidth`). Reserve 'viewport' for the full app window (`window.innerHeight`/`innerWidth`).
- **WebKit over iOS/iPadOS**: In comments, identifiers, docs, and chat, use 'WebKit' when code targets both iOS and iPadOS (both use WKWebView). Use 'iOS' or 'iPadOS' ONLY when targeting one platform specifically. `Platform.isIosApp` and other external Obsidian API names are exemptions. NEVER use 'WebKit' in user-facing text (README, wiki, settings, notices) — use 'iOS' and 'iPadOS' instead.

## Popout window safety

See [docs/patterns/popout-window-safety.md](docs/patterns/popout-window-safety.md) for the full rules (prohibited bare globals, `getOwnerWindow(el)` / `el.ownerDocument` derivation, `setDocumentProvider` pattern, safe exceptions). See `knowledge/electron-popout-quirks.md` for the underlying Electron quirks.

## Navigation

| Doc | Read before |
|---|---|
| **@docs/overview.md** | First time working on this codebase, or need a high-level understanding of the plugin architecture and systems. |
| **@docs/principles.md** | Making trade-off decisions — what the plugin prioritizes and why. |
| **@docs/project-structure.md**, **@docs/index.md** | Reading or editing any file in the codebase. ALWAYS update both when adding, removing, or renaming source, test, or doc files. |
| **@docs/patterns/plugin-view-navigation.md** | Probing, querying, or targeting Dynamic Views elements via CDP, WebKit Inspector, or DOM queries — correct selectors, DOM hierarchy, and platform-specific probing patterns. |
| **@docs/patterns/view-configuration.md** | Configuring per-view settings for Bases — setting keys, defaults, ranges, templates, and workflows. |
| **@obsidian-guidelines/main.md**, **@obsidian-guidelines/additional.md** | Working on plugin code, submissions, or review compliance. |

