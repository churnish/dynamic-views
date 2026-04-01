---
title: Mobile performance roadmap
description: iPhone 13 compositor and memory optimization options — empirical findings, prioritized approaches, and status tracking for low-end WKWebView devices.
author: 🤖 Generated with Claude Code
updated: 2026-04-01
---
# Mobile performance roadmap

Optimization options for Masonry views with poster images on low-end iOS devices (iPhone 13 — 4GB RAM, A15 GPU). Findings are from empirical Safari Timeline profiling and on-device memory audits. iPad M3 and Pixel 8a are unaffected due to 8GB RAM and faster GPUs.

## Problem summary

| Issue | Metric | Healthy |
|---|---|---|
| Compositor bottleneck | 60-96ms per composite | <4ms |
| Frame drops (14s recording) | 297/479 at 60fps, 104 at 30fps | 0 |
| WKWebView memory | 659MB (page=343MB, js=256MB) | <500MB |
| WKWebView hard limit | ~1-1.5GB | — |
| Decoded image bitmaps | 119MB (15 images × ~8MB) | — |
| Mounted cards | 34 / 300 virtual items | — |

## Approaches

### 1. Remove `will-change: transform` from idle poster images

**Status**: Done

Every poster `<img>` had `will-change: transform` for the reveal zoom animation. This pre-promoted each image to its own GPU compositor layer — 15+ full-resolution decoded bitmap textures permanently in VRAM. The A15 GPU can't composite this many layers during full-screen hide/reveal, causing 60-96ms composites.

**Fix**: Move `will-change` to active states only (`.poster-revealed` for tap, `.poster-hover-active` for desktop hover). One-time layer promotion cost on first interaction is negligible vs permanent GPU overhead during scroll.

**Impact**: Compositing — removes ~15 GPU layers from the compositor tree during normal scrolling.

### 2. `createImageBitmap` with `resizeWidth` for poster images

**Status**: Not started

Poster images decode at native resolution (e.g., 3000×2000 = 24MB RGBA). Max display size on iPhone 13 is ~390px × 3 DPR = 1170px. Everything wider wastes decoded memory.

`createImageBitmap(blob, { resizeWidth: 1170, resizeQuality: 'medium' })` decodes AND downscales off the main thread. Supports Safari 15+ (verify on target iOS version). Falls back to canvas if unavailable.

**Estimated savings**: 15 images from 119MB → 52MB (at 3× DPR) or 24MB (at 2× DPR).

**Integration point**: Intercept image URL before setting `img.src` in the image load pipeline. For `app://` URLs (local vault images), use `fetch()` + `createImageBitmap()`.

**Tradeoff**: Adds async processing to the image load path. Canvas fallback needed for older Safari. Poster zoom may show lower-resolution image momentarily.

### 3. Clear `img.src` on unmount

**Status**: Not started

When virtual scroll unmounts a card, the `<img>` element is removed from the DOM — but WKWebView may keep the decoded bitmap in its image cache. Setting `img.src = ''` before removal forces the browser to release the decoded bitmap.

**Integration point**: In the virtual scroll unmount path, before `item.el.remove()`.

**Impact**: Low-effort, potentially medium memory savings from WKWebView's decoded image cache eviction.

### 4. Tighten mount zone for poster format on iOS

**Status**: Not started

Current mount zone on mobile: viewport ± 1× pane height. With poster images as the dominant memory consumer, reduce to ± 0.5× pane when `imageFormat === 'poster'` and `Platform.isIosApp`.

Reduces mounted cards from ~34 to ~20-24, cutting decoded image memory proportionally.

**Tradeoff**: More visible card pop-in during fast scroll. Poster cards already have fade-in animation, so visual impact may be minimal.

### 5. JS-computed visibility tiers (replace broken IO)

**Status**: Not started

`content-visibility: hidden` IntersectionObserver is disabled on iOS due to infinite reflow loop (WebKit re-evaluates IO entries when geometry changes from cv:hidden, creating a cycle). The alternative: skip IO entirely and compute visibility from scroll position in JS.

Masonry already has position + height for every virtual item via `syncVirtualScroll`. Add a third tier:

```
Tier 0: In viewport         → fully visible
Tier 1: mount zone, not VP  → mounted, visibility: hidden
Tier 2: outside mount zone  → unmounted (current behavior)
```

`visibility: hidden` prevents painting but maintains layout geometry — no IO re-fire. Since masonry cards are absolutely positioned with JS-computed dimensions, `contain: strict` can isolate them further.

**Impact**: Reduces painting cost for off-screen-but-mounted cards. Does NOT reduce compositing as aggressively as `content-visibility: hidden`, but avoids the reflow loop.

**Note**: `visibility: hidden` still paints to a transparent buffer. For GPU composite reduction, this is less effective than `content-visibility: hidden` but safe on WebKit.

### 6. `contain: strict` on iOS poster cards

**Status**: Not started

Add `contain: strict` (currently `contain: layout style paint`) to poster cards on iOS. The `size` component tells the browser that the card's internal rendering is unaffected by ancestor geometry changes (e.g., full-screen class toggle).

```scss
body.is-ios .dynamic-views-masonry .card.image-format-poster.masonry-positioned {
  contain: strict;
}
```

**Caveat**: `contain: size` means the element contributes 0px to intrinsic sizing. Since masonry cards are absolutely positioned with explicit inline widths/heights, this should be safe. Verify that `aspect-ratio` still works correctly under `contain: size`.

### 7. Detach full-screen from body class

**Status**: Not started (last resort)

`body.classList.add('full-screen-active')` triggers subtree-wide style invalidation across the entire document. Android's show path already avoids body-class invalidation by using inline styles (documented in `full-screen.ts`). iOS hide path still uses the body class.

**Fix**: Target only specific elements (view-header, mobile-navbar, toolbar) via inline styles instead of body class.

**Tradeoff**: The `full-screen-active` body class controls Obsidian's native CSS for hiding the view header, toolbar, etc. Replicating those styles via inline styles is more fragile. High effort, high risk.

## Priority

| # | Approach | Target | Impact | Effort | Risk |
|---|---|---|---|---|---|
| 1 | Remove `will-change` from idle posters | Compositing | High | Low | Low |
| 2 | `createImageBitmap` resizeWidth | Memory | Very high | Medium | Medium |
| 3 | Clear `img.src` on unmount | Memory | Medium | Low | Low |
| 4 | Tighter mount zone for poster on iOS | Memory | Medium | Low | Low |
| 5 | JS-computed visibility tiers | Compositing + Memory | Medium | Medium | Low |
| 6 | `contain: strict` on iOS poster cards | Compositing | Medium | Low | Medium |
| 7 | Detach full-screen from body class | Compositing | High | High | High |

## Empirical context

- **Safari Timeline profiling** works on WKWebView over USB — Layout & Rendering, Memory, and Frames instruments are available. No flame chart (open WebKit bug since 2012). Exported as JSON, parseable with Python for automated analysis.
- **Virtual scroll is working correctly**: 34/300 cards mounted, 266 unmounted. No blob URL leaks. Images only exist on mounted cards.
- **659MB total memory**: page=343MB (DOM tree, layout tree, render tree for entire workspace), js=256MB (Obsidian core + all plugins + metadata cache), other=60MB. Not a plugin leak — it's the full app footprint on a 4GB device.
- **`performance.now()` on iOS Safari has 1ms resolution** — limits profiling precision.
- **`performance.mark()`/`performance.measure()`** work in WKWebView iOS 11+.
