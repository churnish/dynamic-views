---
title: Card views optimization roadmap
description: Shared card views optimization tracking — card rendering, cleanup, property measurement, and forced reflow items that affect both Grid and Masonry.
author: 🤖 Generated with Claude Code
updated: 2026-04-11
---
# Card views optimization roadmap

Shared optimizations that affect both Grid and Masonry views. Backend-specific items live in [grid-roadmap.md](grid-roadmap.md) and [masonry-roadmap.md](masonry-roadmap.md).

## Status key

- **Done** — implemented and verified
- **Evaluate** — needs investigation before committing

## Priority order

| # | Task | Expected impact | Evidence | Status |
|---|---|---|---|---|
| P1 | `appendBatch` forced reflows | All >2ms Layout events | `renderImage` reads `offsetHeight`/`offsetWidth` during batch card rendering. Initial batch path. | Evaluate |
| P1 | `groupOffsetsDirty` flag | 39ms→0ms on scroll frames | T1: 39ms for 2 groups. Skip DOM reads on scroll-only frames. | Done |
| P2 | Reduce `renderCard()` DOM element count | Compounds across all layout operations | T1: 2,657 elements, 4,485 style recalc for 40 cards. T12: 37 mutations/card. | Evaluate |
| P2 | CardHandle cleanup optimization | 27ms→<5ms per card | T10: 508ms for 19-card group collapse. Array mutation + index rebuild repeats per card. | Evaluate |
| P3 | Batched `clipPosterStaticOverflow` | O(K)→O(1) reflows | Split into clear/measure/apply phases. 3 loop call sites converted. | Done |

## 1. Card rendering

| Optimization | Status | Notes |
|---|---|---|
| Reduce `renderCard()` DOM element count | Evaluate | Dynamic Views creates ~15-30 DOM elements per card (varies by features) vs MC's ~3-5. **T1: 2,657 total DOM elements, 4,485 style recalc elements for 40 cards. T12: 37 DOM mutations/card for property reorder (846 total).** DOM complexity is a background tax on every layout operation — style recalc, forced reflow, mutation handling all scale with element count. |
| `appendBatch` forced reflows | Evaluate | `renderImage` reads `offsetHeight`/`offsetWidth` during card rendering in `appendBatch`, triggering forced reflow. All >2ms Layout events trace to this path. Fix: defer image layout reads to after batch insertion completes. |

## 2. Card lifecycle

| Optimization | Status | Notes |
|---|---|---|
| CardHandle per-card cleanup | Done | `renderCard()` returns `{ el, cleanup }`. Cleanup aborts AbortController, disconnects ResizeObservers, stops slideshows. Enables individual card teardown for virtual scrolling. **T10: 27ms/card cleanup cost.** |
| CardHandle cleanup optimization | Evaluate | **T10: 27ms/card cleanup, 508ms for 19-card group collapse.** Per-card: `AbortController.abort()`, `ResizeObserver.unobserve()`, slideshow stop, `virtualItems` splice + `rebuildGroupIndex`. Batching cleanup (splice once, rebuild once) could dramatically reduce cost. |

## 3. Property layout

| Optimization | Status | Notes |
|---|---|---|
| Synchronous property measurement | Done | Replaced async RAF queue with synchronous paired property measurement — eliminates 2-3 frame mount flicker. CSS `visibility: hidden` fallback gate. Removed ~150 lines of queue infrastructure. |
| Batched compact-stacked wrapping detection | Done | RAF-batched read/write: collapse N forced reflows per resize into 1 per document. Moved `compactWidthCache` + detection from both backends to shared `property-helpers.ts`. Grid row-level sync with 1px tolerance. |
| Batched `clipPosterStaticOverflow` | Done | Split into clear/measure/apply phases (`clearPosterClipState`, `measurePosterClipGeometry`, `applyPosterClipDecisions`). Batch variant runs all clears → all reads (1 reflow) → all writes. 3 loop call sites converted to `clipPosterStaticOverflowBatch`. |
| Persistent paired property width cache | Done | `Map<filePath, {containerWidth, pairs[]}>` stores measured CSS vars. On virtual scroll re-mount, applies cached widths directly — zero forced reflows. Invalidated on settings change (`resetPersistentWidthCache`), per-card on fresh DOM from in-place update, and on container width change. |

## 4. Scroll infrastructure

| Optimization | Status | Notes |
|---|---|---|
| `groupOffsetsDirty` flag | Done | Prevents redundant `getBoundingClientRect` on scroll-only frames. Flag set by resize, mount/unmount, and remeasure. **T1: 39ms→0ms.** |
| `content-visibility: hidden` for off-screen cards | Done | Cards outside mount zone but within hidden buffer get `content-visibility: hidden` with `contain-intrinsic-height`. Grid uses scroll-position-based toggling; Masonry uses IntersectionObserver. |
