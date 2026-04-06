---
title: Poster image format
description: Poster image format architecture — static content clipping, scroll reset, tap-to-reveal, hover intent, display mode switching, and the CSS-only vs full-render setting boundary.
author: 🤖 Generated with Claude Code
updated: 2026-04-04
---
# Poster image format

The poster image format positions a full-bleed background image behind card content. Two interaction modes control how content is presented: **static** (always visible, JS-clipped to fit) and **interactive** (hidden by default, revealed on hover/tap). The core logic lives in `src/shared/poster.ts` with wiring in `src/bases/shared-renderer.ts`.

## Display modes

Poster cards have two visual display modes controlled by the `posterDisplayMode` setting:

| Mode | Container class | Content layout | Image treatment |
|---|---|---|---|
| **Fade** | `poster-mode-fade` | Bottom-aligned, `max-height: 70%` | Gradient overlay from bottom |
| **Overlay** | `poster-mode-overlay` | Full card height | Image dimmed via `filter: brightness()` |

Both modes are purely CSS. Switching between them changes the available content area, which affects static clipping calculations.

## Static vs interactive

The `posterInteractToReveal` setting controls the interaction model:

| Value | Container class | Behavior |
|---|---|---|
| `false` (default) | `poster-static` | Content always visible, JS clips overflow |
| `true` | *(none)* | Content hidden, revealed on hover (desktop) or tap (mobile) |

**This setting is NOT CSS-only** — toggling it requires a full re-render because interactive mode depends on render-time event handler setup (`setupHoverIntent` for desktop hover, `isPosterClickReveal` for mobile tap). The container-level `poster-static` class toggle alone is insufficient.

## Static clipping pipeline

`clipPosterStaticOverflow(cardEl)` measures card content and hides elements that don't fit. It handles its own reset (clearing stale clip state) before re-clipping.

```
clipPosterStaticOverflow(cardEl)
│
├── 1. RESET: clear stale state
│   ├── Remove .poster-clip-hidden from all elements
│   ├── Reset --dynamic-views-title-lines on .card-title
│   ├── Reset --dynamic-views-subtitle-lines + .poster-clip-clamped on .card-subtitle
│   └── Reset --dynamic-views-text-preview-lines on .card-text-preview
│       └── Re-apply per-paragraph clamp if has-paragraphs
│
├── 2. EARLY RETURNS
│   ├── No .card-content → return
│   ├── No .has-poster class → return
│   └── scrollHeight <= clientHeight (no overflow after reset) → return
│
├── 3. BATCH READ (one forced reflow)
│   ├── getBoundingClientRect() for all clippable elements + title
│   └── getComputedStyle().lineHeight for text preview, subtitle, title
│
└── 4. WRITE LOOP (reverse DOM order, bottom-up)
    ├── Element fully below clip boundary → add .poster-clip-hidden
    ├── Element partially visible:
    │   ├── Text preview → clampToFit() with --dynamic-views-text-preview-lines
    │   └── Subtitle → clampToFit() with --dynamic-views-subtitle-lines + .poster-clip-clamped
    └── Title (never hidden) → clampToFit() with --dynamic-views-title-lines
```

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

Subtitle additionally gets the `poster-clip-clamped` class, which provides `display: -webkit-box` (title and text preview already have this in their base CSS rules).

### Call sites

| Context | Caller | Notes |
|---|---|---|
| Grid initial render | `shared-renderer.ts` | Clip only (no prior state) |
| ResizeObserver | `shared-renderer.ts` | Size-guarded (`lastClipWidth`/`lastClipHeight`) |
| `textPreviewLines` change | `applyCssOnlySettings` | Immediate re-clip |
| Static mode toggled ON | `applyCssOnlySettings` | Immediate |
| Display mode changed | `applyCssOnlySettings` | Deferred via `requestAnimationFrame` (CSS needs one frame to recalculate layout after class swap) |

`resetPosterClipping(cardEl)` exists as a standalone function for the transition-to-interactive path only (static mode toggled OFF). All other sites call `clipPosterStaticOverflow` which resets internally.

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

`handlePosterTapReveal(e, cardEl, openFileAction)` handles tap reveal/dismiss. Returns `true` if the event was consumed.

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
- Click landed on a text-target element when `openFileAction === 'title'`

## Hover intent

Desktop poster hover uses `setupHoverIntent` — requires `mousemove` after `mouseenter` before activating. This prevents scroll-triggered false activations (mouse stationary, viewport scrolls card under cursor).

Two `setupHoverIntent` calls are registered on the same card element:
1. **Card-level** — gates cursor styles, link hover effects, keyboard nav
2. **Poster-level** — adds/removes `poster-hover-active` class, calls `resetPosterScroll` on deactivate

Both share the same `AbortController` signal — they cancel together on card unmount. Each has an independent `hasMoved` closure variable.

## `.interact` class lifecycle

This class gates ~60 CSS rules (hover colors, cursors, zoom, slideshow nav). It must be managed on ALL poster state transitions:

| Transition | Action |
|---|---|
| Tap reveal | Add to revealed card |
| Tap dismiss | Remove from dismissed card |
| Dismiss-other (reveal card B) | Remove from card A |
| Hover activate | *(managed by card-level setupHoverIntent, not poster-specific)* |
| Touch press | *(managed by setupTouchPress, not poster-specific)* |

Leaking it on dismissed cards causes stale hover effects, particularly visible on iPad with pointer input.

## Invariants

1. `clipPosterStaticOverflow` always clears stale state before clipping — callers never need to call `resetPosterClipping` first.
2. `posterInteractToReveal` is excluded from `CSS_ONLY_SETTINGS_KEYS` — toggling triggers a full re-render.
3. `posterDisplayMode` IS in `CSS_ONLY_SETTINGS_KEYS` — changes are instant CSS class swaps with deferred re-clip.
4. `transitionend` listeners in `resetPosterScroll` use manual removal, not `{ once: true }`.
5. `.interact` must be removed on ALL dismiss paths.
6. Batch reads (rects + lineHeights) happen before the write loop — no read-write interleaving within a single card.
7. Display mode re-clip uses a `null`-guarded tri-state to skip the first call.
