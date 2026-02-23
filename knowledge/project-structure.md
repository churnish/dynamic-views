---
title: Project structure
description: Maps every source, test, and stylesheet file in the Dynamic Views plugin to its responsibility.
author: 🤖 Generated with Claude Code
last updated: 2026-02-16
---

# Project structure

```
dynamic-views/
├── main.ts                          # Plugin entry point — registers views, commands, API
├── styles.css                       # Compiled CSS (build artifact, gitignored)
├── esbuild.config.mjs               # Build config (JS/TS only)
├── eslint.config.js                  # Lint rules (obsidianmd plugin)
├── jest.config.cjs                   # Test config (ts-jest, jsdom)
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
│   ├── settings-tab.ts               # Plugin settings tab UI
│   ├── jsx-runtime.ts                # JSX runtime proxy -> Datacore's bundled Preact
│   ├── jsx.d.ts                      # JSX type declarations
│   │
│   ├── bases/                        # Bases backend (Obsidian native API)
│   │   ├── grid-view.ts              # Grid layout view
│   │   ├── masonry-view.ts           # Masonry layout view
│   │   ├── shared-renderer.ts        # Shared card rendering (deduplicates grid/masonry)
│   │   ├── swipe-interceptor.ts      # Touch gesture interception for panzoom on mobile
│   │   └── utils.ts                  # Context menus, toolbar, property management
│   │
│   ├── datacore/                     # Datacore backend (Preact/JSX)
│   │   ├── view.tsx                  # Main controller — state, query processing, rendering
│   │   ├── card-view.tsx             # Card component (grid + masonry modes)
│   │   ├── list-view.tsx             # List view component
│   │   ├── masonry-view.tsx          # Masonry wrapper over CardView
│   │   ├── toolbar.tsx               # Toolbar with dropdowns + controls
│   │   ├── settings.tsx              # Settings panel component
│   │   └── types.d.ts               # Datacore API + Preact type defs
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
│       ├── property.ts               # Property extraction for Datacore/Bases
│       ├── query-sync.ts             # Query processing + code block sync
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
│   │   └── styleMock.js
│   ├── bases/
│   │   ├── cleanup.test.ts
│   │   ├── sync-responsive-classes.test.ts
│   │   └── utils.test.ts
│   ├── persistence.test.ts
│   ├── shared/
│   │   ├── content-visibility.test.ts
│   │   ├── content-loader.test.ts
│   │   ├── data-transform.test.ts
│   │   ├── image-loader.test.ts
│   │   ├── property-helpers.test.ts
│   │   ├── render-utils.test.ts
│   │   ├── scroll-gradient.test.ts
│   │   └── settings-schema.test.ts
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
│   ├── _grid-masonry-shared.scss    # Shared card view layout: groups, sticky headers, card base
│   ├── _grid-view.scss              # Grid view layout: CSS Grid, subgrid, grid spacing
│   ├── _image-viewer.scss           # Image viewer overlay, panzoom
│   ├── card/                         # Card internals
│   │   ├── _core.scss                # Card container, borders, backgrounds
│   │   ├── _content.scss             # Thumbnail position layouts
│   │   ├── _header.scss              # Title, subtitle, file type indicators
│   │   ├── _thumbnail.scss           # Thumbnail sizing, crop/contain modes
│   │   ├── _masonry-covers.scss      # Masonry cover height variants
│   │   ├── _cover.scss               # Cover flexbox system, wrapper positioning
│   │   ├── _cover-elements.scss      # Cover element styling, cover-content border
│   │   ├── _cover-placeholders.scss  # Placeholder/skeleton styles
│   │   ├── _side-cover-spacing.scss  # Side cover layout adjustments
│   │   ├── _backdrop-poster-shared.scss # Shared backdrop/poster base
│   │   ├── _backdrop.scss            # Backdrop image format
│   │   ├── _poster.scss              # Poster image format
│   │   └── _slideshow.scss           # Slideshow animations
│   ├── _properties.scss              # Property row system, labels, timestamps, paths
│   ├── _property-colors.scss         # Color presets for labels, text, subtitle, title
│   ├── _tags.scss                    # Tag styles (outline/fill/plaintext/theme) + color presets
│   ├── _hover-states.scss            # Hover color rules, cursor gating
│   ├── _text-interaction.scss        # Text selectability + cursor rules (open-on-title, poster-revealed)
│   ├── _scroll-gradient.scss         # Horizontal/vertical gradient masks for scrollable content
│   ├── _masonry-view.scss            # Masonry view layout: absolute positioning, flex overrides
│   ├── _compact.scss                 # Narrow pane breakpoints, compact toolbar
│   └── _utilities.scss               # Utility classes
│
├── knowledge/                        # Project knowledge docs
│   └── ...
├── archive/                          # Preserved deprecated code
│   └── ...
└── .github/                          # CI workflows, issue templates
    └── ...
```
