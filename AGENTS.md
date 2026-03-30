# dynamic-views

- **Error surfacing**: `new Notice()` ONLY for user-initiated action failures and confirmations. Internal and background failures MUST use `console.error`/`console.warn` — NEVER surface notices for operations the user did NOT trigger.
- **`--size-*` over `px`**: Use Obsidian's `--size-*` CSS variables (e.g., `var(--size-2-2)`) instead of hardcoded pixel values whenever a matching token exists.
- **No `:has()` in card selectors**: NEVER use `:has()` on elements inside `.dynamic-views` that exist in quantity (cards, properties, covers, previews) or re-evaluate on interaction. `:has()` causes upward style invalidation — with N cards × M properties, a single class toggle triggers O(N×M) recalculation. Use render-time CSS classes instead (e.g., `.has-label`, `.has-poster`).

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

## Datacore parity

- **Current state**: Datacore card views display ONLY hardcoded properties (`file.tags`, `file.mtime`). Custom user-defined properties are NOT yet supported.
- **Future work**: Datacore will gain full property display parity with Bases — configurable property lists, custom timestamp properties, labels, icons, and ALL rendering features. Shared helpers in `render-utils.ts` (`isTimestampProperty`, `getTimestampIcon`) already accept both `BasesResolvedSettings` and `ResolvedSettings`.
- **Lay the foundation**: When working on shared infrastructure (helpers, types, rendering logic), ALWAYS design it to work with both backends. Wire up Datacore call sites even when the feature is NOT yet observable there.

## Popout safety

- **Derive from DOM**: In `src/shared/`, `src/bases/`, and `src/datacore/`, NEVER use bare `document`, `window`, `new ResizeObserver`, `new IntersectionObserver`, `getComputedStyle`, `matchMedia`, `navigator`, or `document.createElement`. ALWAYS derive from the nearest DOM element via `getOwnerWindow(el)` (`src/utils/owner-window.ts`) or `el.ownerDocument`. `ResizeObserver` from the wrong window silently fails on popout elements.
- **Module-level code**: When module-level code needs all open documents (no DOM element in scope), use the `setDocumentProvider` pattern — a module-level setter registered from `main.ts` onload via `getAllPopoutDocuments()`.
- **Safe exceptions**: `document.body.classList` reads for config classes (Style Settings syncs to all documents), `setTimeout`/`setInterval`/`requestIdleCallback` (process-level), `new Image()` for network validation (never inserted into DOM), offscreen `document.createElement('canvas')` for measurement.
- **Reference**: See `knowledge/electron-popout-quirks.md` for the full list of cross-window pitfalls, safe patterns, and mitigations.

## Navigation

- Read **@docs/overview.md** for a high-level understanding of the plugin architecture, backends, and systems.
- Read **@docs/principles.md** for project values and trade-off priorities.
- Consult **@docs/project-structure.md** and **@docs/index.md** before reading or editing any file in the codebase. ALWAYS update both when adding, removing, or renaming source, test, or doc files.
- Consult **@wiki/wiki-structure.md** for user-facing, human-verified plugin wiki pages that document how plugin features and settings function.

***

## Guidelines

Per official Obsidian plugin guidelines:

- **No `FileSystemAdapter` cast**: Gate ALL `FileSystemAdapter` usage behind `instanceof` check. Mobile uses `CapacitorAdapter`.
- **No `process.platform`**: Use Obsidian's `Platform` API instead.
- **Settings headings**: ONLY use section headings if there are multiple sections. General settings go at top without heading.
- **No `insertAdjacentHTML`**: Use DOM API or Obsidian helpers (`createEl()`, `createDiv()`, `createSpan()`) instead.
- **Use `el.empty()`**: To clean up HTML element contents.
- **Correct callback type**: `callback` for unconditional, `checkCallback` for conditional, `editorCallback`/`editorCheckCallback` when an active editor is required.
- **No `workspace.activeLeaf`**: Use `getActiveViewOfType()` instead.
- **Null-check `activeEditor`**: Use optional chaining (`activeEditor?.editor`).
- **Editor API for active file**: Prefer over `Vault.modify()` (preserves cursor, selection, folded state).
- **`Vault.process()` for background edits**: Atomic operation, avoids conflicts vs. `Vault.modify()`.
- **`FileManager.processFrontMatter()`**: NEVER parse/modify YAML manually.
- **Vault API over Adapter API**: Better performance (caching) and safety (serial operations).
- **`normalizePath()`**: ALWAYS use for human-defined paths (handles slashes, spaces, Unicode, cross-platform).
- **`updateOptions()`**: To change or reconfigure editor extensions after registration (updates ALL editors).
- **No overriding core styling**: Add own classes and scope styling to them.
- **Obsidian CSS variables**: Use for consistent styling. Create custom variables ONLY if no matching variable exists.
- **`instanceof` before casting**: Test before casting to `TFile`, `TFolder`, `FileSystemAdapter`, etc.
- **Optimize load time**: Initial UI setup on `workspace.onLayoutReady()`, NOT in constructor or `onload()`.
- **Deferred views**: Tabs load as `DeferredView` until visible. NEVER assume `leaf.view` is the real view — use `instanceof`. `await revealLeaf(leaf)` or `await leaf.loadIfDeferred()` before access.
- **License**: Include LICENSE file. Comply with original licenses of used code. Attribute in README if required.
- **Trademark**: NEVER use "Obsidian" in a way that suggests the plugin is first-party.

***

## Project overview

- Target: Obsidian Community Plugin (TypeScript → bundled JavaScript).
- Entry point: `main.ts` compiled to `main.js` and loaded by Obsidian.
- Required release artifacts: `main.js`, `manifest.json`, and optional `styles.css`.

## Environment & tooling

- Node.js: use current LTS (Node 18+ recommended).
- **Package manager: npm** (required for this sample - `package.json` defines npm scripts and dependencies).
- **Bundler: esbuild** (required for this sample - `esbuild.config.mjs` and build scripts depend on it). Alternative bundlers like Rollup or webpack are acceptable for other projects if they bundle all external dependencies into `main.js`.
- Types: `obsidian` type definitions.

**Note**: This sample project has specific technical dependencies on npm and esbuild. If you're creating a plugin from scratch, you can choose different tools, but you'll need to replace the build configuration accordingly.

### Install

```bash
npm install
```

### Dev (watch)

```bash
npm run dev
```

### Production build

```bash
npm run build
```

## Linting

- To use eslint install eslint from terminal: `npm install -g eslint`
- To use eslint to analyze this project use this command: `eslint main.ts`
- eslint will then create a report with suggestions for code improvement by file and line number.
- If your source code is in a folder, such as `src`, you can use eslint with this command to analyze all files in that folder: `eslint ./src/`

## File & folder conventions

- **Organize code into multiple files**: Split functionality across separate modules rather than putting everything in `main.ts`.
- Source lives in `src/`. Keep `main.ts` small and focused on plugin lifecycle (loading, unloading, registering commands).
- **Example file structure**:
  ```
  src/
    main.ts           # Plugin entry point, lifecycle management
    settings.ts       # Settings interface and defaults
    commands/         # Command implementations
      command1.ts
      command2.ts
    ui/              # UI components, modals, views
      modal.ts
      view.ts
    utils/           # Utility functions, helpers
      helpers.ts
      constants.ts
    types.ts         # TypeScript interfaces and types
  ```
- **Do not commit build artifacts**: Never commit `node_modules/`, `main.js`, or other generated files to version control.
- Keep the plugin small. Avoid large dependencies. Prefer browser-compatible packages.
- Generated output should be placed at the plugin root or `dist/` depending on your build setup. Release artifacts must end up at the top level of the plugin folder in the vault (`main.js`, `manifest.json`, `styles.css`).

## Manifest rules (`manifest.json`)

- Must include (non-exhaustive):  
  - `id` (plugin ID; for local dev it should match the folder name)  
  - `name`  
  - `version` (Semantic Versioning `x.y.z`)  
  - `minAppVersion`  
  - `description`  
  - `isDesktopOnly` (boolean)  
  - Optional: `author`, `authorUrl`, `fundingUrl` (string or map)
- Never change `id` after release. Treat it as stable API.
- Keep `minAppVersion` accurate when using newer APIs.
- Canonical requirements are coded here: https://github.com/obsidianmd/obsidian-releases/blob/master/.github/workflows/validate-plugin-entry.yml

## Testing

- Manual install for testing: copy `main.js`, `manifest.json`, `styles.css` (if any) to:
  ```
  <Vault>/.obsidian/plugins/<plugin-id>/
  ```
- Reload Obsidian and enable the plugin in **Settings → Community plugins**.

## Commands & settings

- Any user-facing commands should be added via `this.addCommand(...)`.
- If the plugin has configuration, provide a settings tab and sensible defaults.
- Persist settings using `this.loadData()` / `this.saveData()`.
- Use stable command IDs; avoid renaming once released.

## Versioning & releases

- Bump `version` in `manifest.json` (SemVer) and update `versions.json` to map plugin version → minimum app version.
- Create a GitHub release whose tag exactly matches `manifest.json`'s `version`. Do not use a leading `v`.
- Attach `manifest.json`, `main.js`, and `styles.css` (if present) to the release as individual assets.
- After the initial release, follow the process to add/update your plugin in the community catalog as required.

## Security, privacy, and compliance

Follow Obsidian's **Developer Policies** and **Plugin Guidelines**. In particular:

- Default to local/offline operation. Only make network requests when essential to the feature.
- No hidden telemetry. If you collect optional analytics or call third-party services, require explicit opt-in and document clearly in `README.md` and in settings.
- Never execute remote code, fetch and eval scripts, or auto-update plugin code outside of normal releases.
- Minimize scope: read/write only what's necessary inside the vault. Do not access files outside the vault.
- Clearly disclose any external services used, data sent, and risks.
- Respect user privacy. Do not collect vault contents, filenames, or personal information unless absolutely necessary and explicitly consented.
- Avoid deceptive patterns, ads, or spammy notifications.
- Register and clean up all DOM, app, and interval listeners using the provided `register*` helpers so the plugin unloads safely.

## UX & copy guidelines (for UI text, commands, settings)

- Prefer sentence case for headings, buttons, and titles.
- Use clear, action-oriented imperatives in step-by-step copy.
- Use **bold** to indicate literal UI labels. Prefer "select" for interactions.
- Use arrow notation for navigation: **Settings → Community plugins**.
- Keep in-app strings short, consistent, and free of jargon.

## Performance

- Keep startup light. Defer heavy work until needed.
- Avoid long-running tasks during `onload`; use lazy initialization.
- Batch disk access and avoid excessive vault scans.
- Debounce/throttle expensive operations in response to file system events.

## Coding conventions

- TypeScript with `"strict": true` preferred.
- **Keep `main.ts` minimal**: Focus only on plugin lifecycle (onload, onunload, addCommand calls). Delegate all feature logic to separate modules.
- **Split large files**: If any file exceeds ~200-300 lines, consider breaking it into smaller, focused modules.
- **Use clear module boundaries**: Each file should have a single, well-defined responsibility.
- Bundle everything into `main.js` (no unbundled runtime deps).
- Avoid Node/Electron APIs if you want mobile compatibility; set `isDesktopOnly` accordingly.
- Prefer `async/await` over promise chains; handle errors gracefully.

## Mobile

- Where feasible, test on iOS and Android.
- Don't assume desktop-only behavior unless `isDesktopOnly` is `true`.
- Avoid large in-memory structures; be mindful of memory and storage constraints.

## Agent do/don't

**Do**
- Add commands with stable IDs (don't rename once released).
- Provide defaults and validation in settings.
- Write idempotent code paths so reload/unload doesn't leak listeners or intervals.
- Use `this.register*` helpers for everything that needs cleanup.

**Don't**
- Introduce network calls without an obvious user-facing reason and documentation.
- Ship features that require cloud services without clear disclosure and explicit opt-in.
- Store or transmit vault contents unless essential and consented.

## Common tasks

### Organize code across multiple files

**main.ts** (minimal, lifecycle only):
```ts
import { Plugin } from "obsidian";
import { MySettings, DEFAULT_SETTINGS } from "./settings";
import { registerCommands } from "./commands";

export default class MyPlugin extends Plugin {
  settings: MySettings;

  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    registerCommands(this);
  }
}
```

**settings.ts**:
```ts
export interface MySettings {
  enabled: boolean;
  apiKey: string;
}

export const DEFAULT_SETTINGS: MySettings = {
  enabled: true,
  apiKey: "",
};
```

**commands/index.ts**:
```ts
import { Plugin } from "obsidian";
import { doSomething } from "./my-command";

export function registerCommands(plugin: Plugin) {
  plugin.addCommand({
    id: "do-something",
    name: "Do something",
    callback: () => doSomething(plugin),
  });
}
```

### Add a command

```ts
this.addCommand({
  id: "your-command-id",
  name: "Do the thing",
  callback: () => this.doTheThing(),
});
```

### Persist settings

```ts
interface MySettings { enabled: boolean }
const DEFAULT_SETTINGS: MySettings = { enabled: true };

async onload() {
  this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  await this.saveData(this.settings);
}
```

### Register listeners safely

```ts
this.registerEvent(this.app.workspace.on("file-open", f => { /* ... */ }));
this.registerDomEvent(window, "resize", () => { /* ... */ });
this.registerInterval(window.setInterval(() => { /* ... */ }, 1000));
```

## Troubleshooting

- Plugin doesn't load after build: ensure `main.js` and `manifest.json` are at the top level of the plugin folder under `<Vault>/.obsidian/plugins/<plugin-id>/`. 
- Build issues: if `main.js` is missing, run `npm run build` or `npm run dev` to compile your TypeScript source code.
- Commands not appearing: verify `addCommand` runs after `onload` and IDs are unique.
- Settings not persisting: ensure `loadData`/`saveData` are awaited and you re-render the UI after changes.
- Mobile-only issues: confirm you're not using desktop-only APIs; check `isDesktopOnly` and adjust.

## References

- Obsidian sample plugin: https://github.com/obsidianmd/obsidian-sample-plugin
- API documentation: https://docs.obsidian.md
- Developer policies: https://docs.obsidian.md/Developer+policies
- Plugin guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
- Style guide: https://help.obsidian.md/style-guide
