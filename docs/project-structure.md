---
title: Project structure
description: Maps every source, test, and stylesheet file in the Dynamic Views plugin to its responsibility.
author: 🤖 Generated with Claude Code
last updated: 2026-03-06
---
# Project structure

```
dynamic-views/
├── main.ts                           # Plugin entry point — registers views, commands, API
├── styles.css                        # Compiled CSS (build artifact, gitignored)
├── esbuild.config.mjs                # Build config (JS/TS only)
├── eslint.config.js                  # Lint rules (obsidianmd plugin)
├── vitest.config.ts                  # Test config (vitest, jsdom)
├── version-bump.mjs                  # Version bump + lint pre-check
├── tsconfig.json
├── package.json
├── manifest.json
├── CLAUDE.md / AGENTS.md
│
├── src/
│   ├── constants.ts                  # Default settings, view defaults, Datacore defaults
│   ├── types.ts                      # Core interfaces: settings, view defaults, resolved settings
│   ├── persistence.ts                # Plugin data persistence and settings resolution
│   ├── plugin-settings.ts            # Plugin settings tab UI
│   ├── jsx-runtime.ts                # JSX runtime proxy -> Datacore's bundled Preact
│   ├── jsx.d.ts                      # JSX type declarations
│   │
│   ├── bases/                        # Bases backend (Obsidian native API)
│   │   ├── grid-view.ts              # Grid layout view
│   │   ├── masonry-view.ts           # Masonry layout view
│   │   ├── shared-renderer.ts        # Shared card rendering (deduplicates grid/masonry)
│   │   ├── sticky-heading.ts         # Sentinel IO for sticky group heading stuck state
│   │   ├── swipe-interceptor.ts      # Touch gesture interception for panzoom on mobile
│   │   └── utils.ts                  # Context menus, toolbar, property management
│   │
│   ├── datacore/                     # Datacore backend (Preact/JSX)
│   │   ├── controller.tsx            # Main controller — state, query processing, rendering
│   │   ├── card-view.tsx             # Card component (grid + masonry modes)
│   │   ├── list-view.tsx             # List view component
│   │   ├── masonry-view.tsx          # Masonry wrapper over CardView
│   │   ├── query-sync.ts             # Query processing + code block sync
│   │   ├── toolbar.tsx               # Toolbar with dropdowns + controls
│   │   ├── settings.tsx              # View settings panel component
│   │   └── types.d.ts                # Datacore API + Preact type defs
│   │
│   ├── shared/                       # Cross-backend shared logic
│   │   ├── card-renderer.tsx         # Pure card rendering (normalized CardData)
│   │   ├── hover-intent.ts           # Shared hover intent (mousemove-after-mouseenter) utility
│   │   ├── constants.ts              # Infinite scroll, throttling, batch size constants
│   │   ├── content-loader.ts         # Async image/text loading with dedup
│   │   ├── content-visibility.ts     # IntersectionObserver-based visibility management
│   │   ├── context-menu.ts           # Right-click menus for cards/links
│   │   ├── data-transform.ts         # Normalizes Datacore/Bases data -> CardData
│   │   ├── image-loader.ts           # Image aspect ratio caching + fallbacks
│   │   ├── image-viewer.ts           # Panzoom image viewer
│   │   ├── keyboard-nav.ts           # Keyboard focus management for cards
│   │   ├── property-helpers.ts       # Type-checking for tags, timestamps, checkboxes
│   │   ├── property-measure.ts       # Measures property field widths + scroll gradients
│   │   ├── render-utils.ts           # Date/timestamp/property rendering functions
│   │   ├── scroll-gradient.ts        # Horizontal scroll gradients for properties
│   │   ├── scroll-preservation.ts    # Scroll position save/restore
│   │   ├── settings-schema.ts        # Universal settings schema parser
│   │   ├── slideshow.ts              # Card image slideshow (animation + swipe)
│   │   ├── text-preview-dom.ts       # DOM updates for card text previews
│   │   ├── view-validation.ts        # ViewDefaults validation + cleanup
│   │   └── virtual-scroll.ts         # Virtual scrolling: VirtualItem, syncVisibleItems
│   │
│   └── utils/                        # Pure utility functions
│       ├── dropdown-position.ts      # Click-outside detection for dropdowns
│       ├── file-extension.ts         # File format + extension detection
│       ├── file.ts                   # File timestamps + path resolution
│       ├── image.ts                  # Image path processing + embed extraction
│       ├── link-parser.ts            # Frontmatter link parsing (internal/external)
│       ├── masonry-layout.ts         # Pure masonry positioning calculations
│       ├── notebook-navigator.ts     # Notebook Navigator plugin integration
│       ├── owner-window.ts           # Popout-safe window reference from DOM element
│       ├── property.ts               # Property extraction for Datacore/Bases
│       ├── randomize.ts              # Randomization + pane type from modifier keys
│       ├── sanitize.ts               # Control character removal (localStorage safety)
│       ├── storage.ts                # Storage key generation
│       ├── style-settings.ts         # CSS variable reading with cache
│       └── text-preview.ts           # Markdown stripping for card previews
│
├── tests/                            # Mirrors src/ structure
│   ├── setup.ts
│   ├── __mocks__/
│   │   ├── obsidian.ts
│   ├── bases/
│   │   ├── cleanup.test.ts
│   │   ├── grid-scroll.test.ts
│   │   ├── sync-responsive-classes.test.ts
│   │   └── utils.test.ts
│   ├── persistence.test.ts
│   ├── shared/
│   │   ├── constants.test.ts
│   │   ├── content-visibility.test.ts
│   │   ├── content-loader.test.ts
│   │   ├── data-transform.test.ts
│   │   ├── hover-intent.test.ts
│   │   ├── image-loader.test.ts
│   │   ├── property-helpers.test.ts
│   │   ├── render-utils.test.ts
│   │   ├── scroll-gradient.test.ts
│   │   ├── settings-schema.test.ts
│   │   ├── text-preview-dom.test.ts
│   │   └── virtual-scroll.test.ts
│   └── utils/
│       ├── dropdown-position.test.ts
│       ├── file.test.ts
│       ├── image.test.ts
│       ├── masonry-layout.test.ts
│       ├── property.test.ts
│       ├── query-sync.test.ts
│       ├── randomize.test.ts
│       ├── sanitize.test.ts
│       ├── storage.test.ts
│       ├── style-settings.test.ts
│       └── text-preview.test.ts
│
├── styles/                           # SCSS source (compiled to styles.css)
│   ├── main.scss                     # Entry point — @use's all partials in order
│   ├── _style-settings.scss          # @settings YAML comment block (Style Settings)
│   ├── _variables.scss               # Derived CSS custom properties
│   ├── _focus.scss                   # Focus rings, focus-visible
│   ├── _container.scss               # Container queries, width system, scroll fade
│   ├── datacore/                     # Datacore backend UI
│   │   ├── _toolbar.scss             # Toolbar, dropdowns, buttons
│   │   ├── _query-editor.scss        # Query dropdown and editor
│   │   ├── _settings.scss            # View settings panel
│   │   └── _list-view.scss           # List view styles
│   ├── _grid-masonry-shared.scss     # Shared card view layout: groups, sticky headers, card foundation, content-visibility
│   ├── _grid-view.scss               # Grid: CSS Grid columns, subgrid, grid spacing
│   ├── _image-viewer.scss            # Image viewer overlay, panzoom, cursor rules
│   ├── card/                         # Card internals
│   │   ├── _core.scss                # Card container, borders, backgrounds, border color presets
│   │   ├── _previews.scss            # Thumbnail sizing, text preview, position layouts
│   │   ├── _header.scss              # Title, subtitle, file type indicators
│   │   ├── _cover.scss               # Cover flexbox system, wrapper positioning, masonry cover height overrides
│   │   ├── _cover-elements.scss      # Cover element styling, hover zoom, cover-content border, crop/fit/background
│   │   ├── _cover-placeholders.scss  # Placeholder/skeleton styles and visibility
│   │   ├── _cover-side.scss          # Side cover layout adjustments
│   │   ├── _images.scss              # Shared image styles across all formats (skip-cover-fade, fullbleed img)
│   │   ├── _backdrop.scss            # Backdrop image format
│   │   ├── _poster.scss              # Poster image format
│   │   └── _slideshow.scss           # Slideshow animations
│   ├── _properties.scss              # Property row system, labels, timestamps, paths, paired property layout
│   ├── _property-colors.scss         # Color presets for labels, text, subtitle, title
│   ├── _tags.scss                    # Tag styles (outline/fill/plaintext/theme) + color presets
│   ├── _hover-states.scss            # Hover color presets, cursor gating
│   ├── _text-interaction.scss        # Text selectability + cursor rules (open-on-title, poster-revealed)
│   ├── _scroll-gradient.scss         # Horizontal/vertical gradient masks for scrollable content
│   ├── _masonry-view.scss            # Masonry: absolute positioning, container rules, transitions
│   ├── _compact.scss                 # Narrow pane breakpoints, compact toolbar
│   ├── _plugin-settings.scss         # Plugin settings tab styling
│   └── _utilities.scss               # Utility classes
│
├── docs/                             # Project docs
│   └── ...
├── archive/                          # Preserved deprecated code
│   └── ...
└── .github/                          # CI workflows, issue templates
    └── ...
```
