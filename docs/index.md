---
title: Doc index
description: Index of all project docs — when and why to read each one.
author: 🤖 Generated with Claude Code
updated: 2026-03-22
---
# Doc index

> [!important]
> While an effort is made to keep these docs continuously up to date, all content is AI-generated and may contain inaccuracies — verify critical information against source code.

| Doc | Read before |
|---|---|
| [overview.md](overview.md) | First time working on this codebase, or need a high-level understanding of the plugin's architecture, backends, and major subsystems. |
| [project-structure.md](project-structure.md) | Navigating the codebase, finding files, or understanding module responsibilities — documents the full directory tree with file descriptions. |
| [release-guide.md](release-guide.md) | Running a release, bumping versions, or troubleshooting the release pipeline — documents the full npm version lifecycle, GitHub Action build, wiki publishing, and rollback procedures. |

## architecture/

Stable reference docs for subsystem internals — data structures, render pipelines, invariants, and design decisions that remain valid across sessions.

| Doc | Read before |
|---|---|
| [card-dom-structure.md](architecture/card-dom-structure.md) | Working on card internals, card CSS selectors, property rows, or DOM differences between Bases and Datacore — documents the full card hierarchy, class names, property row structure, and backend divergences. |
| [grid-layout.md](architecture/grid-layout.md) | Working on grid layout, CSS Grid columns, content visibility, or grid-specific resize/infinite scroll — documents the full architecture, data structures, render pipeline, guard system, and invariants. |
| [masonry-layout.md](architecture/masonry-layout.md) | Working on masonry layout, virtual scrolling, resize handling, or infinite scroll — documents the full architecture, data structures, render pipeline, guard system, and invariants. |
| [property-layout.md](architecture/property-layout.md) | Working on property pairing, width measurement, scroll gradients, compact mode, or property position settings — documents the pairing algorithm, JS measurement pipeline, CSS state machine, alignment modes, and invariants. |
| [bases-v-datacore-differences.md](architecture/bases-v-datacore-differences.md) | Working on cross-backend code, shared infrastructure, or any feature that touches both Bases and Datacore — documents rendering model, event handling, cleanup, state, and common pitfalls from backend divergence. |
| [settings-resolution.md](architecture/settings-resolution.md) | Working on settings defaults, persistence, templates, sparse storage, or the resolution chain — documents the three-layer merge pipeline, stale config guards, type coercion, position-based title derivation, and invariants. |
| [image-loading.md](architecture/image-loading.md) | Working on image loading, caching, aspect ratios, broken URL tracking, embed extraction, or the content-loader dedup pipeline — documents the two-tier cache architecture, fallback chain, load handler wiring, and invariants. |
| [image-viewer.md](architecture/image-viewer.md) | Working on image viewer gestures, keyboard handlers, constrained vs fullscreen modes, Panzoom integration, mobile touch handling, or viewer cleanup — documents the dual-mode gesture system, keyboard handler map, leaf guard pattern, cleanup lifecycle, and invariants. |
| [keyboard-nav.md](architecture/keyboard-nav.md) | Working on keyboard focus management, arrow-key navigation, hover-to-start or tab-to-start activation, roving tabindex, or focus state flags — documents the spatial navigation algorithm, activation flows, container state interfaces, popout rebinding, and invariants. |
| [slideshow.md](architecture/slideshow.md) | Working on slideshow navigation, gesture detection, animation sequencing, image preloading, failed image recovery, or the external blob cache — documents the navigator state machine, gesture boundary algorithm, undo window, cleanup lifecycle, and invariants. |
| [drag-handlers.md](architecture/drag-handlers.md) | Working on drag handlers, DataTransfer, drop behavior, hover suppression during drag, or WebKit touch handling — documents the factory system, platform quirks, dataset freshness pattern, and drag ghost implementation. |
| [write-path-safety.md](architecture/write-path-safety.md) | Adding or modifying any file write operation — inventories all write paths, documents allowed/prohibited APIs, and lists invariants that prevent data corruption. |

## dev/

Empirical development artifacts — research logs, optimization tracking, and investigation records. Documents what was tried, measured, rejected, and learned.

| Doc | Read before |
|---|---|
| [cls-elimination.md](dev/cls-elimination.md) | Working on post-resize scroll-idle CLS (#358) — documents the problem, proven constraints, all tried approaches with results, remaining candidates, and cross-session empirical findings. |
| [cls-reverse-placement.md](dev/cls-reverse-placement.md) | Continuing reverse masonry placement (#358) — documents the shared design, Phase 4 (reverse greedy) bugs and failure analysis, Phase 8 (directional flush stacking) implementation and bugs, and testing environment quirks. |
| [cls-source-isolation.md](dev/cls-source-isolation.md) | Investigating the actual source of visible CLS (#358) — diagnostic experiments, measurement methodology, Layout Shift API limitations, ruled-out sources, and remaining unknowns. |
| [full-screen.md](dev/full-screen.md) | Working on full screen mobile scrolling (#132) — documents empirical findings, WebKit compositor constraints, CSS scroll-driven animation research, rejected approaches, the space reclaim constraint, navbar hide behavior, and the v84 inline-only animation architecture. |
| [masonry-roadmap.md](dev/masonry-roadmap.md) | Working on masonry performance — documents all optimizations by subsystem (scroll, resize, image loading, rendering, virtual scroll, grouped masonry), priority table from T1-T12 profiling, Datacore parity gaps, and status tracking. |

## patterns/

Reusable conventions and recipes — coding patterns, CSS quirks, and configuration guides that apply across the codebase.

| Doc | Read before |
|---|---|
| [eslint-config.md](patterns/eslint-config.md) | Modifying [eslint.config.js](../eslint.config.js), adding eslint overrides, or troubleshooting lint errors. |
| [scss-nesting-conventions.md](patterns/scss-nesting-conventions.md) | Adding or restructuring `.dynamic-views` selectors in SCSS partials — covers what to nest and what to leave flat. |
| [datacore-ref-callback-patterns.md](patterns/datacore-ref-callback-patterns.md) | Attaching event listeners or stateful behavior in [card-renderer.tsx](../src/shared/card-renderer.tsx) ref callbacks — documents re-render signal churn, cross-container collisions, WeakMap pattern, and `__dragBound` + dataset freshness pattern. |
| [style-settings-fallbacks.md](patterns/style-settings-fallbacks.md) | Adding, modifying, or debugging Style Settings options (`class-select`, `class-toggle`, `variable-number-slider`) — documents fallback patterns for CSS defaults that must work without the Style Settings plugin installed. |
| [css-variable-wrapping.md](patterns/css-variable-wrapping.md) | Adding, modifying, or locally overriding external Obsidian CSS variables — documents the plugin-namespaced wrapper pattern, resolution semantics, and the local override gotcha. |
| [debug-commands.md](patterns/debug-commands.md) | Using runtime diagnostic commands (card width badges) — documents console invocations, toggle semantics, and teardown. |
| [electron-css-quirks.md](patterns/electron-css-quirks.md) | Writing nested `:has()` selectors or working around `-webkit-line-clamp` truncation behavior — documents Blink/Electron CSS rendering quirks and rejected fixes. |
