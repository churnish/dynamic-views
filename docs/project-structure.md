---
title: Project structure
description: Maps every source, test, and stylesheet file in the Dynamic Views plugin to its responsibility.
author: 🤖 Generated with Claude Code
updated: 2026-04-10
---
# Project structure

```
dynamic-views/
├── .github/                          # CI workflows, issue templates
│   └── ...
├── archive/                          # Preserved deprecated code
│   └── ...
├── docs/                             # Project docs
│   └── ...
├── src/
│   ├── bases/                        # Bases backend (Obsidian native API)
│   │   ├── grid-view.ts              # Grid layout view
│   │   ├── full-screen.ts              # Full screen mobile scrolling + createFullScreenController() factory
│   │   ├── masonry-view.ts           # Masonry layout view
│   │   ├── shared-renderer.ts        # Shared card rendering (deduplicates grid/masonry)
│   │   ├── sticky-header.ts           # Sentinel IO for sticky group header stuck state
│   │   └── utils.ts                  # Context menus, toolbar, property management
│   │
│   ├── core/                         # Core logic (shared across views)
│   │   ├── card-data.ts              # CardData + CardHandle type definitions
│   │   ├── constants.ts              # Infinite scroll, throttling, batch size constants
│   │   ├── content-loader.ts         # Async image/text loading with dedup
│   │   ├── content-visibility.ts     # IntersectionObserver-based visibility management
│   │   ├── context-menu.ts           # Right-click menus for cards/links
│   │   ├── data-transform.ts         # Normalizes Bases data -> CardData, URI validation
│   │   ├── drag.ts                   # Drag handler factories (tag, card, link, URL icon)
│   │   ├── file.ts                   # File timestamps + path resolution
│   │   ├── hover-and-touch.ts        # Shared hover and touch interaction utilities
│   │   ├── icon-alignment.ts         # Timestamp icon optical vertical alignment (live DOM measurement + boost ratio)
│   │   ├── image.ts                  # Image path processing, wikilink stripping, URL validation
│   │   ├── image-extraction.ts       # Image embed extraction from file content (wikilinks, Markdown, cardlink)
│   │   ├── image-loader.ts           # Image aspect ratio caching + fallbacks
│   │   ├── image-viewer.ts           # Panzoom image viewer
│   │   ├── keyboard-nav.ts           # Keyboard focus management for cards
│   │   ├── notebook-navigator.ts     # Notebook Navigator plugin integration
│   │   ├── poster.ts                 # Poster format utilities (static clipping, scroll reset)
│   │   ├── property-display.ts       # Property display names, settings normalization
│   │   ├── property-extraction.ts    # Bases entry value extraction (first/all property values)
│   │   ├── property-helpers.ts       # Type-checking for tags, timestamps, checkboxes; compact wrapping detection
│   │   ├── property-mapping.ts       # Display name ↔ syntax name bidirectional maps
│   │   ├── property-measure.ts       # Measures property field widths + scroll gradients
│   │   ├── randomize.ts              # Randomization, shuffle, pane type from modifier keys
│   │   ├── render-utils.ts           # Date/timestamp/property rendering functions
│   │   ├── scroll-gradient.ts        # Horizontal scroll gradients for properties
│   │   ├── scroll-preservation.ts    # Scroll position save/restore
│   │   ├── settings-schema.ts        # Universal settings schema parser
│   │   ├── slideshow.ts              # Card image slideshow (animation + swipe)
│   │   ├── text-preview-dom.ts       # DOM updates for card text previews
│   │   ├── text-preview.ts           # Markdown stripping for card previews
│   │   ├── thumbnail-scrub.ts        # Touch scrubbing with slide animation + shared visibility reset IO for multi-image thumbnails
│   │   ├── view-validation.ts        # ViewDefaults validation + cleanup
│   │   ├── virtual-scroll.ts         # Virtual scrolling: VirtualItem, syncVisibleItems
│   │   └── youtube-preview.ts        # YouTube video ID extraction + thumbnail validation
│   │
│   ├── utils/                        # Pure utility functions
│   │   ├── file-extension.ts         # File format + extension detection
│   │   ├── link-parser.ts            # Frontmatter link parsing (internal/external)
│   │   ├── masonry-layout.ts         # Pure masonry positioning calculations
│   │   ├── owner-window.ts           # Popout-safe window reference from DOM element
│   │   ├── sanitize.ts               # Control character removal (localStorage safety)
│   │   └── style-settings.ts         # CSS variable reading with cache
│   │
│   ├── constants.ts                  # Default settings, view defaults
│   ├── obsidian-augments.d.ts        # Obsidian module augmentations for undocumented APIs
│   ├── persistence.ts                # Plugin data persistence and settings resolution
│   ├── plugin-settings.ts            # Plugin settings tab UI
│   └── types.ts                      # Core interfaces: settings, view defaults, resolved settings
│
├── styles/                           # SCSS source (compiled to styles.css)
│   ├── card/                         # Card internals
│   │   ├── _backdrop.scss            # Backdrop image format
│   │   ├── _core.scss                # Card container, borders, backgrounds, border/background color presets
│   │   ├── _cover-elements.scss      # Cover element styling, hover zoom, cover-content border, crop/fit/background
│   │   ├── _cover-placeholders.scss  # Placeholder/skeleton styles and visibility
│   │   ├── _cover-side.scss          # Side cover layout adjustments
│   │   ├── _cover.scss               # Cover flexbox system, wrapper positioning, masonry cover height overrides
│   │   ├── _header.scss              # Title, subtitle, file type indicators
│   │   ├── _images.scss              # Shared image styles across all formats (skip-cover-fade, fullbleed img)
│   │   ├── _poster.scss              # Poster image format
│   │   ├── _previews.scss            # Thumbnail sizing, text preview, position layouts
│   │   └── _slideshow.scss           # Slideshow animations
│   │
│   ├── _compact.scss                 # Narrow pane breakpoints, compact toolbar
│   ├── _container.scss               # Container queries, width system, scroll fade
│   ├── _focus.scss                   # Focus rings, focus-visible
│   ├── _grid-masonry-shared.scss     # Shared card views layout: groups, sticky headers, card foundation, content-visibility
│   ├── _grid-view.scss               # Grid: CSS Grid columns, subgrid, grid spacing
│   ├── _hover-and-touch.scss          # Hover and touch visual feedback, cursor gating
│   ├── _image-viewer.scss            # Image viewer overlay, panzoom, cursor rules
│   ├── _masonry-view.scss            # Masonry: absolute positioning, container rules, transitions
│   ├── _plugin-settings.scss         # Plugin settings tab styling
│   ├── _properties.scss              # Property row system, labels, timestamps, paths, paired property layout
│   ├── _property-colors.scss         # Color presets for labels, text, subtitle, title
│   ├── _scroll-gradient.scss         # Horizontal/vertical gradient masks for scrollable content
│   ├── _style-settings.scss          # @settings YAML comment block (Style Settings)
│   ├── _tags.scss                    # Tag styles (outline/fill/plaintext/theme) + color presets
│   ├── _text-interaction.scss        # Text selectability + cursor rules (open-on-title, poster-revealed)
│   ├── _utilities.scss               # Utility classes
│   ├── _variables.scss               # Derived CSS custom properties
│   └── main.scss                     # Entry point — @use's all partials in order
│
├── tests/                            # Mirrors src/ structure
│   ├── __mocks__/
│   │   └── obsidian.ts
│   ├── bases/
│   │   ├── can-flush-image-relayout.test.ts
│   │   ├── cleanup.test.ts
│   │   ├── full-screen-factory.test.ts
│   │   ├── grid-equalize.test.ts
│   │   ├── grid-poster-stretch.test.ts
│   │   ├── grid-scroll.test.ts
│   │   ├── shared-renderer.test.ts
│   │   ├── sync-responsive-classes.test.ts
│   │   └── utils.test.ts
│   ├── core/
│   │   ├── constants.test.ts
│   │   ├── content-loader.test.ts
│   │   ├── content-visibility.test.ts
│   │   ├── data-transform.test.ts
│   │   ├── file.test.ts
│   │   ├── hover-and-touch.test.ts
│   │   ├── image.test.ts
│   │   ├── image-extraction.test.ts
│   │   ├── image-loader.test.ts
│   │   ├── poster.test.ts
│   │   ├── property-display.test.ts
│   │   ├── property-extraction.test.ts
│   │   ├── property-helpers.test.ts
│   │   ├── property-mapping.test.ts
│   │   ├── randomize.test.ts
│   │   ├── render-utils.test.ts
│   │   ├── scroll-gradient.test.ts
│   │   ├── settings-schema.test.ts
│   │   ├── text-preview-dom.test.ts
│   │   ├── text-preview.test.ts
│   │   ├── thumbnail-scrub.test.ts
│   │   ├── virtual-scroll.test.ts
│   │   └── youtube-preview.test.ts
│   ├── utils/
│   │   ├── file-extension.test.ts
│   │   ├── link-parser.test.ts
│   │   ├── masonry-layout.test.ts
│   │   ├── sanitize.test.ts
│   │   └── style-settings.test.ts
│   ├── persistence.test.ts
│   └── setup.ts
│
├── AGENTS.md                         # AI agent instructions
├── CLAUDE.md                         # AI agent instructions (pointer)
├── esbuild.config.mjs                # Build config (JS/TS only)
├── eslint.config.js                  # Lint rules (obsidianmd plugin)
├── main.ts                           # Plugin entry point — registers views, commands, API
├── manifest.json                     # Obsidian plugin manifest
├── package.json                      # Dependencies, scripts, metadata
├── styles.css                        # Compiled CSS (build artifact, gitignored)
├── tsconfig.json                     # TypeScript compiler options
├── version-bump.mjs                  # Version bump + lint pre-check
└── vitest.config.ts                  # Test config (vitest, jsdom)
```
