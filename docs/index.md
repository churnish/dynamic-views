---
title: Doc index
description: Index of all project docs — when and why to read each one.
author: 🤖 Generated with Claude Code
updated: 2026-04-06
---
# Doc index

> [!important]
> While an effort is made to keep these docs continuously up to date, all content is generated with Claude Code and may contain inaccuracies — verify important information against source code.

Cross-plugin knowledge docs (platform quirks, Obsidian API gotchas, Electron/CSS rendering issues) live in a [shared repository](https://github.com/churnish/odkb).

| Doc | Read before |
|---|---|
| [overview.md](overview.md) | First time working on this codebase, or need a high-level understanding of the plugin's architecture and major systems. |
| [principles.md](principles.md) | Making trade-off decisions — what the plugin prioritizes and why. |
| [project-structure.md](project-structure.md) | Navigating the codebase, finding files, or understanding module responsibilities — documents the full directory tree with file descriptions. |
| [release-guide.md](release-guide.md) | Running a release, bumping versions, or troubleshooting the release pipeline — documents the full npm version lifecycle, GitHub Action build, and rollback procedures. |

## arch/

Stable reference docs for system internals — data structures, render pipelines, invariants, and design decisions that remain valid across sessions.

| Doc | Read before |
|---|---|
| [card-dom-structure.md](arch/card-dom-structure.md) | Working on card internals, card CSS selectors, or property rows — documents the full card hierarchy, class names, and property row structure. |
| [config-reactivity.md](arch/config-reactivity.md) | Working on config-change propagation, render hash, dirty-checking, `onDataUpdated`, stale config guards, CSS fast-path, Style Settings reactivity, or incremental update paths — documents the full pipeline from config change to re-render decision. |
| [drag-handlers.md](arch/drag-handlers.md) | Working on drag handlers, DataTransfer, drop behavior, hover suppression during drag, or WebKit touch handling — documents the factory system, platform quirks, dataset freshness pattern, and drag ghost implementation. |
| [full-screen.md](arch/full-screen.md) | Working on full screen bar hide/show, spacer + scroll anchoring (Android), margin bridge + settle (iOS), gradient swap mask-image, WAAPI animations, direction detection, height locking, tap shield, or platform-specific branches — documents the complete architecture, state model, settle sequences, and invariants. |
| [grid-layout.md](arch/grid-layout.md) | Working on grid layout, CSS Grid columns, content visibility, or grid-specific resize/infinite scroll — documents the full architecture, data structures, render pipeline, guard system, and invariants. |
| [image-loading.md](arch/image-loading.md) | Working on image loading, caching, aspect ratios, broken URL tracking, embed extraction, or the content-loader dedup pipeline — documents the two-tier cache architecture, fallback chain, load handler wiring, and invariants. |
| [image-viewer.md](arch/image-viewer.md) | Working on image viewer gestures, keyboard handlers, constrained vs fullscreen modes, Panzoom integration, mobile touch handling, or viewer cleanup — documents the dual-mode gesture system, keyboard handler map, leaf guard pattern, cleanup lifecycle, and invariants. |
| [keyboard-nav.md](arch/keyboard-nav.md) | Working on keyboard focus management, arrow-key navigation, hover-to-start or tab-to-start activation, roving tabindex, or focus state flags — documents the spatial navigation algorithm, activation flows, container state interfaces, popout rebinding, and invariants. |
| [masonry-layout.md](arch/masonry-layout.md) | **Frozen** — not kept up to date due to extensive masonry work. Verify against source code. |
| [poster.md](arch/poster.md) | Working on poster static clipping, scroll reset, tap-to-reveal, hover intent, display mode switching, or the `posterInteractToReveal` setting boundary — documents the clipping pipeline, reset lifecycle, interaction handlers, and invariants. |
| [property-layout.md](arch/property-layout.md) | Working on property pairing, width measurement, scroll gradients, compact mode, or property position settings — documents the pairing algorithm, JS measurement pipeline, CSS state machine, alignment modes, and invariants. |
| [scss-organization.md](arch/scss-organization.md) | Working on SCSS partials, import order, adding new partials, or understanding stylesheet dependencies — documents the file categories, loading order rationale, and dependency relationships. |
| [settings-resolution.md](arch/settings-resolution.md) | Working on settings defaults, persistence, templates, sparse storage, or the resolution chain — documents the three-layer merge pipeline, stale config guards, type coercion, position-based title derivation, and invariants. |
| [image-navigation.md](arch/image-navigation.md) | Working on slideshow navigation, gesture detection, animation sequencing, image preloading, failed image recovery, or the external blob cache — documents the navigator state machine, gesture boundary algorithm, undo window, cleanup lifecycle, and invariants. |
| [write-path-safety.md](arch/write-path-safety.md) | Adding or modifying any file write operation — inventories all write paths, documents allowed/prohibited APIs, and lists invariants that prevent data corruption. |

## dev/

Empirical development artifacts — research logs, optimization tracking, and investigation records. Documents what was tried, measured, rejected, and learned.

| Doc | Read before |
|---|---|
| [card-views-roadmap.md](dev/card-views-roadmap.md) | Working on shared card views performance — card rendering, CardHandle cleanup, property measurement, forced reflow reduction, and status tracking. |
| [cls-elimination.md](dev/cls-elimination.md) | Working on post-resize scroll-idle CLS (#358) — documents the problem, proven constraints, all tried approaches with results, remaining candidates, and cross-session empirical findings. |
| [cls-reverse-placement.md](dev/cls-reverse-placement.md) | Continuing reverse masonry placement (#358) — documents the shared design, Phase 4 (reverse greedy) bugs and failure analysis, Phase 8 (directional flush stacking) implementation and bugs, and testing environment quirks. |
| [cls-source-isolation.md](dev/cls-source-isolation.md) | Investigating the actual source of visible CLS (#358) — diagnostic experiments, measurement methodology, Layout Shift API limitations, ruled-out sources, and remaining unknowns. |
| [full-screen.md](dev/full-screen.md) | Working on full screen mobile scrolling — documents native Obsidian behavior, empirical findings, WebKit compositor constraints, CSS scroll-driven animation research, rejected approaches, Chrome/146 Android show flash (compositor render surface lifecycle, scrollTop tile re-rasterization, custom property inheritance cost), the space reclaim constraint, and `overflow-anchor`/`scroll-state()` platform timeline tracking. |
| [grid-roadmap.md](dev/grid-roadmap.md) | Working on Grid performance — documents virtual scroll committed-row lock, CSS Grid style recalc bottleneck, forced reflow reduction, rejected approaches, and status tracking. |
| [icon-alignment.md](dev/icon-alignment.md) | Working on icon vertical alignment with text — documents all failed approaches (CSS, canvas TextMetrics, offscreen DOM), Android text autosizing constraints, the offscreen measurement exemption, and the live DOM measurement solution. |
| [masonry-roadmap.md](dev/masonry-roadmap.md) | Working on masonry performance — documents all optimizations by system (scroll, resize, image loading, rendering, virtual scroll, grouped masonry), priority table from T1-T12 profiling, and status tracking. |
| [mobile-perf-roadmap.md](dev/mobile-perf-roadmap.md) | Working on iPhone 13 compositor or memory performance — documents empirical findings (Safari Timeline, memory audits), prioritized optimization approaches, and status tracking. |

## patterns/

Reusable conventions and recipes — coding patterns, CSS quirks, and configuration guides that apply across the codebase.

| Doc | Read before |
|---|---|
| [css-variable-wrapping.md](patterns/css-variable-wrapping.md) | Adding, modifying, or locally overriding external Obsidian CSS variables — documents the plugin-namespaced wrapper pattern, resolution semantics, and the local override gotcha. |
| [debug-commands.md](patterns/debug-commands.md) | Using runtime diagnostic commands (card width badges) — documents console invocations, toggle semantics, and teardown. |
| [eslint-config.md](patterns/eslint-config.md) | Modifying [eslint.config.js](../eslint.config.js), adding eslint overrides, or troubleshooting lint errors. |
| [hover-and-touch.md](patterns/hover-and-touch.md) | Adding, modifying, or debugging hover or touch press behavior — complete inventory of all hover and touch interactions, pointer type support (mouse/pen/touch), gating mechanisms (`canHover`, `isHoverPointer`, `isTouchPointer`, `@media (any-hover: hover)`), device behavior matrix, and touch press feedback architecture. |
| [plugin-view-navigation.md](patterns/plugin-view-navigation.md) | Probing, querying, or targeting Dynamic Views elements via CDP, WebKit Inspector, or DOM queries — documents the full view hierarchy, correct selectors, and platform-specific probing patterns. |
| [popout-window-safety.md](patterns/popout-window-safety.md) | Using `getOwnerWindow(el)`, `el.ownerDocument`, or `setDocumentProvider` in code that may run in popout windows — documents the DOM-derived pattern, safe exceptions, and common mistakes. |
| [scss-nesting-conventions.md](patterns/scss-nesting-conventions.md) | Adding or restructuring `.dynamic-views` selectors in SCSS partials — covers what to nest and what to leave flat. |
| [style-settings-fallbacks.md](patterns/style-settings-fallbacks.md) | Adding, modifying, or debugging Style Settings options (`class-select`, `class-toggle`, `variable-number-slider`), or consolidating per-variant body-class rules into CSS variable consumption with `[class*=...]` gates — documents fallback patterns for CSS defaults that must work without the Style Settings plugin installed. |
| [view-configuration.md](patterns/view-configuration.md) | Configuring per-view settings for Bases — setting keys, defaults, ranges, templates, workflows, and per-view CSS variable overrides via `cssclasses`. |
