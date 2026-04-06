---
title: Keyboard navigation
description: Spatial arrow-key navigation across card views — activation modes, focus state flags, virtual rect navigation, and popout rebinding.
author: 🤖 Generated with Claude Code
updated: 2026-04-06
---
# Keyboard navigation

The keyboard navigation system provides spatial arrow-key navigation across card views. Two activation modes: hover-to-start (hover card, press arrow) and tab-to-start (Tab into container focuses first card). The core navigation logic lives in [keyboard-nav.ts](../../src/shared/keyboard-nav.ts), wired imperatively from the view classes.

## Files

### Shared

| File | Role |
|---|---|
| [keyboard-nav.ts](../../src/shared/keyboard-nav.ts) | Core module: `handleArrowNavigation()` (2D spatial nav), `setupHoverKeyboardNavigation()` (capture-phase keydown), `initializeContainerFocus()` (focusout handler), `isArrowKey()`, `isImageViewerBlockingNav()`. |
| [content-visibility.ts](../../src/shared/content-visibility.ts) | `CONTENT_HIDDEN_CLASS` removed from focus targets before `.focus()`. |
| [styles/_focus.scss](../../styles/_focus.scss) | Card focus ring via `:focus-visible::after` box-shadow. |
| [styles/_image-viewer.scss](../../styles/_image-viewer.scss) | Suppresses focus ring during image viewer zoom. |

### Bases

| File | Role |
|---|---|
| [shared-renderer.ts](../../src/bases/shared-renderer.ts) | Card keydown handler (Enter/Space/Arrow/Escape), roving tabindex, focus/blur state. |
| [grid-view.ts](../../src/bases/grid-view.ts) | Wires `setupHoverKeyboardNavigation`, `initializeContainerFocus`, provides `getVirtualRects()`, `reattach()` on popout. |
| [masonry-view.ts](../../src/bases/masonry-view.ts) | Same wiring pattern as grid-view: `setupHoverKeyboardNavigation`, `initializeContainerFocus`, inline `getVirtualRects`, `reattach()` on popout. |

## Focus terminology

- **DOM focus** = browser's native `document.activeElement`
- **Visible focus** = `_keyboardNavActive === true`, card retains DOM focus so `:focus-visible::after` renders the focus ring (`_focus.scss`)
- A card can have DOM focus without visible focus (after mouse click)
- Visible focus requires explicit keyboard activation

## Container state flags

### `FocusManagedContainer`

| Field | Type | Purpose |
|---|---|---|
| `_keyboardNavActive` | `boolean` | When true, card retains DOM focus (`:focus-visible` renders ring). When false, unwanted focus is rejected. Set on keyboard activation, cleared on Escape or focusout. |
| `_intentionalFocus` | `boolean` | Guards against focus event handlers rejecting programmatic `.focus()`. Set true before focus, cleared synchronously after. |
| `_focusCleanup` | `() => void` | Prevents duplicate focusout handler registration via `initializeContainerFocus()`. |

### `FocusState`

Defined in `src/types.ts`. Held as instance field on grid-view and masonry-view classes.

| Field | Type | Purpose |
|---|---|---|
| `cardIndex` | `number` | Index of the card with `tabindex="0"` (roving tabindex). Updated via `onFocusChange` callback from `setupHoverKeyboardNavigation`. |
| `hoveredEl` | `HTMLElement \| null` | Currently hovered card element. Set by `onHoverStart`/`onHoverEnd` callbacks in `renderCard`. Read by `setupHoverKeyboardNavigation` via `getHoveredCard()` getter. |

## Roving tabindex

One card has `tabindex="0"` (the "focusable" card), all others have `tabindex="-1"`.

`focusState.cardIndex` on the view class, passed to `renderCard`, applied in shared-renderer.ts.

## Navigation algorithm

`handleArrowNavigation()` uses 2D spatial positioning:

1. Collect all card positions (stored `VirtualCardRect[]`)
2. For each candidate card, check directional validity:
   - ArrowDown/ArrowUp: candidate must be below/above AND in same column (within 5px tolerance)
   - ArrowLeft/ArrowRight: candidate must be to left/right (no column constraint)
3. Score by weighted distance: `primaryAxisDist + crossAxisDist * 0.5`
4. Focus nearest valid candidate, scroll into view

### Two paths

| Path | Data source | Virtual scrolling |
|---|---|---|
| **Virtual** | Pre-computed `VirtualCardRect[]` with stored x/y/width/height. If target is unmounted, calls `onMountItem()` first. See [grid-layout.md](grid-layout.md) and [masonry-layout.md](masonry-layout.md). | Yes |

## Activation flows

### Flow 1: Hover-to-start (`setupHoverKeyboardNavigation`)

1. User hovers card, presses arrow key
2. Capture-phase keydown on `ownerDocument` fires (before card handlers)
3. Four-case priority check:
   - **Case 1**: Card visibly focused — return early (let card's handler navigate)
   - **Case 2**: Hovering card — set `_intentionalFocus=true`, `_keyboardNavActive=true`, focus hovered card, update focusable index, clear `_intentionalFocus` via RAF
   - **Case 3**: Card has DOM focus but not visible — activate `_keyboardNavActive`, let event propagate to card handler
   - **Case 4**: Nothing — do nothing
4. Subsequent arrows handled by card's own keydown handler calling `handleArrowNavigation()`

### Flow 2: Tab-to-start

Browser natively focuses the card with `tabindex="0"` (roving tabindex). `initializeContainerFocus()` handles cleanup (resetting `_keyboardNavActive` on focusout), not activation.

### Escape

Clears `_keyboardNavActive`, blurs focused card. Handled in shared-renderer.ts card keydown.

## Popout window support

The capture-phase keydown listener binds to `ownerDocument` (not global `document`). When a view moves to/from a popout:

- `reattach()` re-binds to the new document
- Called from `handleDocumentChange()` in grid-view.ts and masonry-view.ts
- See `electron-popout-quirks.md` for why binding to the correct window matters
- See [popout-window-safety.md](../patterns/popout-window-safety.md) for the full popout-safe derivation pattern and common pitfalls

## Image viewer blocking

`isImageViewerBlockingNav()` checks for `.dynamic-views-image-embed.is-zoomed`:

- **Fullscreen viewer** — blocks all navigation
- **Constrained viewer** — blocks only if original embed is in same container
- Prevents arrow keys from navigating cards while panning/zooming an image

## Key invariants

1. **Capture phase intercepts before card handlers.** `setupHoverKeyboardNavigation` binds in capture phase so it can activate focus state before the card's own keydown handler fires (which checks `_keyboardNavActive`).
2. **`_intentionalFocus` is set before `.focus()` and cleared after.** Cleared synchronously after `handleArrowNavigation()` returns (all focus events fire synchronously within the call).
3. **`_keyboardNavActive` must be `false` after mouse interaction.** Mouse clicks do not activate visible focus — they set DOM focus only. Ensures focus rings only appear during keyboard navigation.
4. **Roving tabindex tracks the last-focused card.** When arrow navigation moves focus, the `onFocusChange`/`onNavigate` callback updates the focusable index so the tabindex follows.
5. **Virtual rects include unmounted items.** In Bases, `getVirtualRects()` returns positions for ALL items (mounted and unmounted). `handleVirtualArrowNavigation` calls `onMountItem()` to mount the target before focusing.
6. **Image viewer blocks arrow navigation.** When a panzoom viewer is active, `isImageViewerBlockingNav()` prevents arrow keys from moving card focus.
7. **One visible-focus container at a time.** Case 3 in `setupHoverKeyboardNavigation` only activates `_keyboardNavActive` when the focused card is in THIS container (`focusedCardContainer === getContainerRef()`), preventing cross-view focus activation when multiple views exist.
8. **`content-hidden` is removed before focus.** `CONTENT_HIDDEN_CLASS` is removed from target cards before `.focus()` to ensure the focus target is visible (prevents focusing an invisible element in virtual-scrolled views).
