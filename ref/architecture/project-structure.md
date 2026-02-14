# Project structure

```
dynamic-views/
|-- main.ts                            # Plugin entry point — registers views, commands, API
|-- styles.css                         # All plugin CSS
|-- esbuild.config.mjs                 # Build config
|-- eslint.config.js                   # Lint rules (obsidianmd plugin)
|-- jest.config.cjs                    # Test config (ts-jest, jsdom)
|-- version-bump.mjs                   # Version bump + lint pre-check
|-- tsconfig.json
|-- package.json
|-- manifest.json
|-- CLAUDE.md / AGENTS.md
|
|-- src/
|     |-- constants.ts                 # Default settings, view defaults, Datacore defaults
|     |-- types.ts                     # Core interfaces: settings, view defaults, resolved settings
|     |-- persistence.ts               # Plugin data persistence and settings resolution
|     |-- settings-tab.ts              # Plugin settings tab UI
|     |-- jsx-runtime.ts               # JSX runtime proxy -> Datacore's bundled Preact
|     |-- jsx.d.ts                     # JSX type declarations
|     |
|     |-- bases/                       # Bases backend (Obsidian native API)
|     |     |-- grid-view.ts           # Grid layout view
|     |     |-- masonry-view.ts        # Masonry layout view
|     |     |-- shared-renderer.ts     # Shared card rendering (deduplicates grid/masonry)
|     |     |-- swipe-interceptor.ts   # Touch gesture interception for panzoom on mobile
|     |     \-- utils.ts               # Context menus, toolbar, property management
|     |
|     |-- datacore/                    # Datacore backend (Preact/JSX)
|     |     |-- view.tsx               # Main controller — state, query processing, rendering
|     |     |-- card-view.tsx          # Card component (grid + masonry modes)
|     |     |-- list-view.tsx          # List view component
|     |     |-- masonry-view.tsx       # Masonry wrapper over CardView
|     |     |-- toolbar.tsx            # Toolbar with dropdowns + controls
|     |     |-- settings.tsx           # Settings panel component
|     |     \-- types.d.ts             # Datacore API + Preact type defs
|     |
|     |-- shared/                      # Cross-backend shared logic
|     |     |-- card-renderer.tsx      # Pure card rendering (normalized CardData)
|     |     |-- constants.ts           # Infinite scroll, throttling, batch size constants
|     |     |-- content-loader.ts      # Async image/text loading with dedup
|     |     |-- content-visibility.ts  # IntersectionObserver-based visibility management
|     |     |-- context-menu.ts        # Right-click menus for cards/links
|     |     |-- data-transform.ts      # Normalizes Datacore/Bases data -> CardData
|     |     |-- image-loader.ts        # Image aspect ratio caching + fallbacks
|     |     |-- image-viewer.ts        # Panzoom image viewer
|     |     |-- keyboard-nav.ts        # Keyboard focus management for cards
|     |     |-- property-helpers.ts    # Type-checking for tags, timestamps, checkboxes
|     |     |-- property-measure.ts    # Measures property field widths + scroll gradients
|     |     |-- render-utils.ts        # Date/timestamp/property rendering functions
|     |     |-- scroll-gradient.ts     # Horizontal scroll gradients for properties
|     |     |-- scroll-preservation.ts # Scroll position save/restore
|     |     |-- settings-schema.ts     # Universal settings schema parser
|     |     |-- slideshow.ts           # Card image slideshow (animation + swipe)
|     |     \-- view-validation.ts     # ViewDefaults validation + cleanup
|     |
|     \-- utils/                       # Pure utility functions
|           |-- dropdown-position.ts   # Click-outside detection for dropdowns
|           |-- file-extension.ts      # File format + extension detection
|           |-- file.ts                # File timestamps + path resolution
|           |-- image.ts              # Image path processing + embed extraction
|           |-- link-parser.ts         # Frontmatter link parsing (internal/external)
|           |-- masonry-layout.ts      # Pure masonry positioning calculations
|           |-- notebook-navigator.ts  # Notebook Navigator plugin integration
|           |-- property.ts            # Property extraction for Datacore/Bases
|           |-- query-sync.ts          # Query processing + code block sync
|           |-- randomize.ts           # Randomization + pane type from modifier keys
|           |-- sanitize.ts            # Control character removal (localStorage safety)
|           |-- storage.ts             # Storage key generation
|           |-- style-settings.ts      # CSS variable reading with cache
|           \-- text-preview.ts        # Markdown stripping for card previews
|
|-- tests/                             # Mirrors src/ structure
|     |-- setup.ts
|     |-- __mocks__/
|     |     |-- obsidian.ts
|     |     \-- styleMock.js
|     |-- bases/
|     |     |-- cleanup.test.ts
|     |     |-- sync-responsive-classes.test.ts
|     |     \-- utils.test.ts
|     |-- persistence.test.ts
|     |-- shared/
|     |     |-- content-loader.test.ts
|     |     |-- data-transform.test.ts
|     |     |-- image-loader.test.ts
|     |     |-- property-helpers.test.ts
|     |     |-- render-utils.test.ts
|     |     |-- scroll-gradient.test.ts
|     |     \-- settings-schema.test.ts
|     \-- utils/
|           |-- dropdown-position.test.ts
|           |-- file.test.ts
|           |-- image.test.ts
|           |-- masonry-layout.test.ts
|           |-- property.test.ts
|           |-- query-sync.test.ts
|           |-- randomize.test.ts
|           |-- sanitize.test.ts
|           |-- storage.test.ts
|           |-- style-settings.test.ts
|           \-- text-preview.test.ts
|
|-- ref/                               # Reference docs (files not listed here)
|-- archive/                           # Archived code (files not listed here)
\-- .github/                           # CI workflows, issue templates (files not listed here)
```
