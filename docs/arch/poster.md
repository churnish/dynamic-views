---
title: Poster image format
description: Poster image format architecture — static content clipping, scroll reset, tap-to-reveal, hover intent, display mode switching, and the CSS-only vs full-render setting boundary.
author: 🤖 Generated with Claude Code
updated: 2026-08-28
---
# Poster image format

The poster image format positions a full-bleed background image behind card content. Two interaction modes control how content is presented: **static** (always visible, JS-clipped to fit) and **interactive** (hidden by default, revealed on hover/tap). The core logic lives in `src/core/poster.ts` with wiring in `src/bases/shared-renderer.ts`.

## Display modes

Poster cards have two visual display modes controlled by the `posterDisplayMode` setting:

| Mode | Container class | Content layout | Image treatment |
|---|---|---|---|
| **Fade** | `poster-mode-fade` | Bottom-aligned, `max-height: 70%` | Gradient overlay from bottom |
| **Overlay** | `poster-mode-overlay` | Full card height | Image dimmed via `filter: brightness()` |

Both modes are purely CSS. Switching between them changes the available content area, which affects static clipping calculations.

### Fade tint

The fade gradient is a real DOM element (`.poster-gradient`) created in `shared-renderer.ts` — not an `::after` pseudo-element, which forces async compositor layer creation and a 1-3 frame blank flash on WebKit virtual scroll remount.

Its color comes from the per-view `tint` setting, which `applyLineAndModeVariables()` writes onto the `.dynamic-views` container as exactly one `tint-*` class. The same setting governs the overlay tint and the backdrop tint — one key, three rule sets, disambiguated by the container's `poster-mode-*` class and the card's `image-format-*` class:

| Value | Container class | `--dynamic-views-poster-fade-rgb` | Text |
|---|---|---|---|
| Dark | `tint-dark` | `0 0 0` | `#fafafa` / `#f5f5f5` |
| Light | `tint-light` | `255 255 255` | `#0a0a0a` / `#141414` |
| Adapt to color scheme (default) | `tint-adapt` | follows `body.theme-dark` / `body.theme-light` | follows |

Because JS always writes one of the three classes, no Style-Settings-absent fallback arm is needed. Each palette rule is two selectors: the explicit tint, plus the `tint-adapt` arm gated on `body.theme-dark` or `body.theme-light`.

Both the gradient stops and the fade-mode text color overrides (`--text-normal`, `--text-muted`, `--text-faint` and their `--dynamic-views-*` twins) read these variables, so light fade flips the text dark in the same rule. The variables are set on `.card.image-format-poster.has-poster` and inherit down to `.poster-gradient`.

`tint` is in `CSS_ONLY_SETTINGS_KEYS` — a repaint-only setting that changes the container class without re-rendering cards or resetting scroll.

## Static vs interactive

The `posterInteractToReveal` setting controls the interaction model:

| Value | Container class | Behavior |
|---|---|---|
| `false` (default) | `poster-static` | Content always visible, JS clips overflow |
| `true` | *(none)* | Content hidden, revealed on hover (desktop) or tap (mobile) |

**This setting is NOT CSS-only** — toggling it requires a full re-render because interactive mode depends on render-time event handler setup (`setupHoverIntent` for desktop hover, `isPosterClickReveal` for mobile tap). The container-level `poster-static` class toggle alone is insufficient. See [hover-and-touch.md](../patterns/hover-and-touch.md) for the pointer type filtering and hover intent gating architecture.

## Static clipping pipeline

`clipPosterStaticOverflow(cardEl)` measures card content and hides elements that don't fit. Internally decomposed into **five phases** — three writes and two reads — that can run per-card or batched across multiple cards. Two of the phases exist solely to fold the per-paragraph text preview clamp into the same read/write separation.

```
clipPosterStaticOverflow(cardEl)      — single card
clipPosterStaticOverflowBatch(cards)  — batched (2 reflows total, not 2 per card)
│
├── 1. clearPosterClipState(cardEl) → PosterClipPrepared | null           [WRITE]
│      ├── Card is content-hidden → return null (see Content-hidden filter)
│      ├── Remove .poster-clip-hidden from all elements
│      ├── Reset --dynamic-views-title-lines on .card-title
│      ├── Reset --dynamic-views-subtitle-lines on .card-subtitle
│      ├── Reset --dynamic-views-text-preview-lines on .card-text-preview
│      ├── clearParagraphClampState() → <p> children, if .has-paragraphs
│      ├── No .card-content, or nothing clippable and no title → return null
│      └── Returns { contentEl, titleEl, subtitleEl, clippable[],
│                    textPreviewEl, textPreviewWrapper, paragraphs[] }
│
├── 2. measurePreparedParagraphClamp(prepared)                            [READ]
│      → ParagraphClampMeasurement | null
│      └── measureParagraphClamp(): line height, inherited budget,
│          unclamped <p> heights
│
├── 3. applyParagraphClamp(clamp)                                         [WRITE]
│      └── Clamps <p>s to the container's line budget
│
├── 4. measurePosterClipGeometry(cardEl, prepared, caps)                  [READ]
│      → PosterClipMeasured | null
│      ├── scrollHeight <= clientHeight (no overflow) → return null
│      ├── getBoundingClientRect() for all clippable elements + title
│      ├── getComputedStyle().lineHeight for text preview, subtitle, title
│      └── caps from readPosterLineCaps() — one container read, not one per card
│
└── 5. applyPosterClipDecisions(prepared, measured, paragraphClamp)       [WRITE]
       ├── Element fully below clip boundary → add .poster-clip-hidden
       ├── Element partially visible:
       │   ├── Text preview → clampToFit() → fitted line count
       │   │   └── fitted > 0 → applyParagraphClamp(clamp, fitted)
       │   └── Subtitle → clampToFit() with --dynamic-views-subtitle-lines
       └── Title (never hidden) → clampToFit() with --dynamic-views-title-lines
```

**Why paragraph clamping sits inside the poster pipeline**: unclamped `<p>` text inflates `.card-content`'s `scrollHeight` and shifts every rect below the preview, so phase 4 would decide to hide elements that in fact fit. The clamp must be applied before the geometry read, and its own inputs must be read before that — hence the extra read/write pair rather than a call to `applyPerParagraphClamp` from inside phase 1.

**Why phase 5 needs no re-measure**: `ParagraphClampMeasurement.heights` are recorded unclamped, so they stay valid at any budget. Phase 5 re-runs `applyParagraphClamp` with the reduced fitted count using the same heights, keeping the write phase read-free.

**Batch variant**: `clipPosterStaticOverflowBatch` runs each phase across every card before moving to the next — all clears, then all paragraph reads, then all paragraph clamps, then all geometry reads, then all clip writes. Two forced reflows total regardless of card count. The single-card `clipPosterStaticOverflow` calls the same five functions sequentially.

**Container caps in the batch**: caps are memoized per `.dynamic-views` container rather than read once off the first card. A compact-stacked batch is collected per document and can span two views with different line settings.

### Content-hidden filter

`clearPosterClipState` returns `null` for any card inside a `content-visibility: hidden` subtree, so every entry point inherits the filter — callers do not repeat it. Such cards measure at zero height, making clip work meaningless. The per-card `ResizeObserver` applies the same guard independently.

**Known gap**: a hidden card keeps whatever clip state it had rather than having it cleared. Neither state is correct — nothing re-clips on reveal, because the IntersectionObserver only toggles the visibility class. Stale clipping is the cheaper of the two wrong states, which is why the guard sits before the clear rather than after it.

### Clippable elements (DOM order)

1. `.card-subtitle` (from `.card-header`)
2. `.card-title-url-icon` (from `.card-header`)
3. Children of `.card-properties-top`
4. `.card-text-preview-wrapper`
5. Children of `.card-properties-bottom`

Title is handled separately — it is never hidden, only line-clamped.

### Line clamp pattern

All three clampable text elements (title, subtitle, text preview) use CSS variables set via `setCssProps()`:
- `--dynamic-views-title-lines`
- `--dynamic-views-subtitle-lines`
- `--dynamic-views-text-preview-lines`

All three elements carry their own clamp in base CSS, so poster only overwrites the variable. The subtitle's clamp lives on its `.property-content-wrapper` rather than on `.card-subtitle` itself — the subtitle is a flex item and cannot host a `-webkit-box` — but the variable is written on `.card-subtitle` and inherits down.

`clampToFit()` never raises a line count: it caps its result at the container's value for that variable, read once per container during the measure phase. Poster reduces to fit, it does not override the per-view setting.

It returns **the applied line count**, or `0` when not even one line fits. The text preview branch needs the number, not a yes/no — the fitted count becomes the budget for the paragraph re-clamp in phase 5. Callers that only care whether the element survived compare the return against `0`.

### Call sites

| Context | Caller | Variant | Notes |
|---|---|---|---|
| Grid initial render | `shared-renderer.ts` | Single | One condition covering static cards and imageless cards. Masonry defers to the card RO — cards have no final size at render time |
| Card ResizeObserver | `shared-renderer.ts` | Single | One branch covering both poster-static cards and imageless Grid cards. Size-guarded (`lastClipWidth`/`lastClipHeight`) |
| `textPreviewLines` change | `applyCssOnlySettings` | Batch | Gated by `lastClippedTextPreviewLines` so an unchanged value fires nothing. Imageless Grid cards are included regardless of static mode |
| Static mode toggled ON | `applyCssOnlySettings` | Batch | Cards with an image only — static mode does not change the imageless content area |
| Display mode changed | `applyCssOnlySettings` | Batch | Deferred via `requestAnimationFrame` (CSS needs one frame to recalculate layout after class swap) |
| Compact-stacked settling | `processCompactStackedBatch` | Batch | Poster-static cards plus imageless Grid cards, after stacking changes property heights |

Every entry point above goes through `clearPosterClipState`, so none of them needs to filter out content-hidden cards. Choosing *which* cards to pass is still the caller's job. The batch sites select `.card.image-format-poster`, except the static-mode transition, which stays on `.has-poster`.

**Why imageless cards clip unconditionally in Grid**: their height is constrained by `aspect-ratio` like every other poster card in the row, so content overflows with no reveal interaction to recover it. The clip is therefore not tied to `posterInteractToReveal`. Masonry is excluded — it writes an explicit per-card height and never applies the ratio to imageless cards.

`resetPosterClipping(cards: HTMLElement[])` exists as a standalone function for the transition-to-interactive path only (static mode toggled OFF). It takes an **array**, not a single card: restoring the container's line budget means re-measuring paragraph heights, so a per-card variant would cost one reflow per card. It runs its own three phases — clear every card's clip state and paragraph clamp, read paragraph metrics at the restored budget, re-clamp — for one reflow total.

## Display mode re-clip

When `posterDisplayMode` changes while in static mode, content area size differs (fade constrains to `max-height: 70%`, overlay uses full height). `applyCssOnlySettings` detects the mode change via a tri-state `prevMode`:

- `'overlay'` — container had `poster-mode-overlay`
- `'fade'` — container had `poster-mode-fade`
- `null` — first call (neither class present)

Re-clip only fires when `prevMode !== null && posterDisplayMode !== prevMode && isStatic`. The `null` guard prevents a spurious rAF re-clip on initial render.

## Scroll reset

`resetPosterScroll(cardEl)` resets vertical and horizontal scroll positions after the exit transition finishes (poster content fading out).

- Listens for `transitionend` on `.card-content` with a computed-duration fallback timeout (+50ms margin).
- Uses manual `removeEventListener` instead of `{ once: true }` — child transitions bubble up, pass the `e.target` guard (returning early), but `once` still removes the listener prematurely.
- `settled` flag prevents double-fire from the event + timeout race.

Called on: unhover (desktop), untap (mobile), dismiss-other (revealing card B dismisses card A).

## Tap-to-reveal

`handlePosterTapReveal(e, cardEl, openOnTitle)` handles tap reveal/dismiss. Returns `true` if the event was consumed.

### Reveal (card not yet revealed)

1. `preventDefault()` + `stopPropagation()`
2. Dismiss any previously revealed card in the same `.dynamic-views` container (remove `poster-revealed` + `interact`, call `resetPosterScroll`)
3. Add `poster-revealed` + `interact` to the clicked card

### Dismiss (card already revealed, non-interactive area clicked)

1. `stopPropagation()` (no `preventDefault`)
2. Remove `poster-revealed` + `interact`
3. Call `resetPosterScroll`

### Passthrough (returns `false`)

- No `.card-poster` element in the card
- Click landed on an interactive element (`a`, `button`, `.tag`, etc.)
- Text is selected (prevents double-click word selection from being swallowed)
- Click landed on a text-target element when `openOnTitle` is on

## Hover intent

Desktop poster hover uses `setupHoverIntent` — requires `mousemove` after `mouseenter` before activating. This prevents scroll-triggered false activations (mouse stationary, viewport scrolls card under cursor).

Two `setupHoverIntent` calls are registered on the same card element:
1. **Card-level** — gates cursor styles, link hover effects, keyboard nav
2. **Poster-level** — adds/removes `poster-hover-active` class, calls `resetPosterScroll` on deactivate

Both share the same `AbortController` signal — they cancel together on card unmount. Each has an independent `hasMoved` closure variable.

## `.interact` class lifecycle

This class gates ~60 CSS rules (hover colors, cursors, slideshow nav). It must be managed on ALL poster state transitions. Poster image zoom is NOT among them — it keys on `interact-hover`, which only hover input sets, so a tap never zooms. Tap reveal has its own zoom, keyed on `poster-revealed`.

| Transition | Action |
|---|---|
| Tap reveal | Add to revealed card |
| Tap dismiss | Remove from dismissed card |
| Dismiss-other (reveal card B) | Remove from card A |
| Hover activate | *(managed by card-level setupHoverIntent, not poster-specific)* |
| Touch press | *(managed by setupTouchPress, not poster-specific)* |

Leaking it on dismissed cards causes stale hover effects, particularly visible on iPad with pointer input.

## Card height in Grid

Poster card height in Grid always follows the image aspect ratio — imageless cards included. The three Grid `aspect-ratio` rules in `card/_poster.scss` (fixed height on, dynamic, dynamic + contain) all select `.card.image-format-poster` with no `.has-poster` qualifier, so every card in a row resolves to the same ratio-derived height with no JS stretching involved.

`overflow: hidden` on `.card.image-format-poster` is load-bearing: it zeroes the Grid automatic minimum size, letting `aspect-ratio` win over content height. Overflowing content is hidden by the clipping pipeline above.

**Masonry is excluded.** Its four `aspect-ratio` rules keep `.has-poster` — Masonry sizes each card individually and writes an explicit inline height, so applying the ratio to imageless cards would clip content with no row uniformity to gain.

**Row equalization**: with fixed poster height off, `equalizeRowPosterHeights()` writes `--row-poster-aspect-ratio` so every card in a row matches the tallest image. Its `matchCard` selects all poster cards, but the ratio *read* is gated on `has-poster` (`hasRatio` in the config). That gate is load-bearing, not an optimization: `image-loader.ts` writes the fallback `--actual-aspect-ratio: 0.75` at the same moment `showImagePlaceholder` drops `has-poster`, so a failed-image card is imageless *and* carries a real ratio that would otherwise poison the row max. The write loop is ungated — an all-imageless row writes `0`, and `aspect-ratio: 1 / 0` degenerates to natural height. Skipping the write instead would leave a stale ratio from a previous row composition, since row membership shifts with column count and virtual-scroll re-indexing.

## Invariants

1. `clipPosterStaticOverflow` always clears stale state before clipping — callers never need to call `resetPosterClipping` first.
2. `posterInteractToReveal` is excluded from `CSS_ONLY_SETTINGS_KEYS` — toggling triggers a full re-render.
3. `posterDisplayMode` IS in `CSS_ONLY_SETTINGS_KEYS` — changes are instant CSS class swaps with deferred re-clip.
4. `transitionend` listeners in `resetPosterScroll` use manual removal, not `{ once: true }`.
5. `.interact` must be removed on ALL dismiss paths.
6. Batch reads (rects + lineHeights) happen before writes — no read-write interleaving within a single card. The batch variant extends this across multiple cards: all clears → all reads (one reflow) → all writes.
7. Display mode re-clip uses a `null`-guarded tri-state to skip the first call.
8. Loop call sites MUST use `clipPosterStaticOverflowBatch` — per-card `clipPosterStaticOverflow` in a loop causes O(K) forced reflows.
9. `clearPosterClipState` does NOT guard on `has-poster` — callers are responsible for passing the right cards.
10. New Style Settings body-class toggles that affect rendering MUST be added to `getStyleSettingsHash()` — without hash inclusion, the body class observer's dedup gate silently swallows the change.
11. `clampToFit` MUST NOT exceed the container's line-count value. The cap is read in the measure phase, never in the write phase — a `getComputedStyle` call during writes would break invariant 6 and force one style recalc per card in the batch path.
12. Content is only scrollable outside `poster-static`. Scrolling is gated behind interact-to-reveal on every platform, not just touch, so poster cards do not behave differently by input device — see the rationale comment in `card/_poster.scss`.
