---
title: Doc index
description: Index of all project docs — when and why to read each one.
author: 🤖 Generated with Claude Code
last updated: 2026-03-13
---
# Doc index

## architecture/

| Doc | Read before |
|---|---|
| [card-dom-structure.md](architecture/card-dom-structure.md) | Working on card internals, card CSS selectors, property rows, or DOM differences between Bases and Datacore — documents the full card hierarchy, class names, property row structure, and backend divergences. |
| [grid-layout.md](architecture/grid-layout.md) | Working on grid layout, CSS Grid columns, content visibility, or grid-specific resize/infinite scroll — documents the full architecture, data structures, render pipeline, guard system, and invariants. |
| [masonry-layout.md](architecture/masonry-layout.md) | Working on masonry layout, virtual scrolling, resize handling, or infinite scroll — documents the full architecture, data structures, render pipeline, guard system, and invariants. |
| [property-layout.md](architecture/property-layout.md) | Working on property pairing, width measurement, scroll gradients, compact mode, or property position settings — documents the pairing algorithm, JS measurement pipeline, CSS state machine, alignment modes, and invariants. |
| [bases-v-datacore-differences.md](architecture/bases-v-datacore-differences.md) | Working on cross-backend code, shared infrastructure, or any feature that touches both Bases and Datacore — documents rendering model, event handling, cleanup, state, and common pitfalls from backend divergence. |
| [settings-resolution.md](architecture/settings-resolution.md) | Working on settings defaults, persistence, templates, sparse storage, or the resolution chain — documents the three-layer merge pipeline, stale config guards, type coercion, position-based title derivation, and invariants. |
| [image-loading.md](architecture/image-loading.md) | Working on image loading, caching, aspect ratios, broken URL tracking, embed extraction, or the content-loader dedup pipeline — documents the two-tier cache architecture, fallback chain, load handler wiring, and invariants. |
| [slideshow.md](architecture/slideshow.md) | Working on slideshow navigation, gesture detection, animation sequencing, image preloading, failed image recovery, or the external blob cache — documents the navigator state machine, gesture boundary algorithm, undo window, cleanup lifecycle, and invariants. |
| [write-path-safety.md](architecture/write-path-safety.md) | Adding or modifying any file write operation — inventories all write paths, documents allowed/prohibited APIs, and lists invariants that prevent data corruption. |

## Root

| Doc | Read before |
|---|---|
| [release-guide.md](release-guide.md) | Running a release, bumping versions, or troubleshooting the release pipeline — documents the full npm version lifecycle, GitHub Action build, wiki publishing, and rollback procedures. |

## patterns/

| Doc | Read before |
|---|---|
| [eslint-config.md](patterns/eslint-config.md) | Modifying `eslint.config.js`, adding eslint overrides, or troubleshooting lint errors. |
| [scss-nesting-conventions.md](patterns/scss-nesting-conventions.md) | Adding or restructuring `.dynamic-views` selectors in SCSS partials — covers what to nest and what to leave flat. |
| [datacore-ref-callback-patterns.md](patterns/datacore-ref-callback-patterns.md) | Attaching event listeners or stateful behavior in `card-renderer.tsx` ref callbacks — documents re-render signal churn, cross-container collisions, and the WeakMap solution. |
| [style-settings-fallbacks.md](patterns/style-settings-fallbacks.md) | Adding or modifying Style Settings options (`class-select`, `class-toggle`, `variable-number-slider`) — documents fallback patterns for CSS defaults that must work without the Style Settings plugin installed. |
| [css-variable-wrapping.md](patterns/css-variable-wrapping.md) | Adding, modifying, or locally overriding external Obsidian CSS variables — documents the plugin-namespaced wrapper pattern, resolution semantics, and the local override gotcha. |
| [electron-css-quirks.md](patterns/electron-css-quirks.md) | Writing nested `:has()` selectors or working around `-webkit-line-clamp` truncation behavior — documents Blink/Electron CSS rendering quirks and rejected fixes. |
