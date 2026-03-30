---
title: Keyboard navigation
description: Spatial arrow-key navigation across card views — activation modes, focus state flags, virtual rect navigation, popout rebinding, and Bases/Datacore differences.
author: 🤖 Generated with Claude Code
updated: 2026-03-15
---
# Keyboard navigation

The keyboard navigation system provides spatial arrow-key navigation across card views. Two activation modes: hover-to-start (hover card, press arrow) and tab-to-start (Tab into container focuses first card). Both backends share the core navigation logic in [keyboard-nav.ts](../../src/shared/keyboard-nav.ts) but wire it differently — Bases uses imperative setup on the view class, Datacore uses declarative ref callbacks in [card-renderer.tsx](../../src/shared/card-renderer.tsx).

## Files

### Shared

| File | Role |
|---|---|
| [keyboard-nav.ts](../../src/shared/keyboard-nav.ts) | Core module: `handleArrowNavigation()` (2D spatial nav), `setupHoverKeyboardNavigation()` (capture-phase keydown), `initializeContainerFocus()` (focusout handler), `isArrowKey()`, `isImageViewerBlockingNav()`. |
| [card-renderer.tsx](../../src/shared/card-renderer.tsx) | Datacore card container: `CardContainerElement` interface, container ref setup, card keydown/focus/blur handlers. |
| [content-visibility.ts](../../src/shared/content-visibility.ts) | `CONTENT_HIDDEN_CLASS` removed from focus targets before `.focus()`. |
| [styles/_focus.scss](../../styles/_focus.scss) | Card focus ring via `:focus-visible::after` box-shadow. |
| [styles/_image-viewer.scss](../../styles/_image-viewer.scss) | Suppresses focus ring during image viewer zoom. |

### Bases

| File | Role |
|---|---|
| [shared-renderer.ts](../../src/bases/shared-renderer.ts) | Card keydown handler (Enter/Space/Arrow/Escape), roving tabindex, focus/blur state. |
| [grid-view.ts](../../src/bases/grid-view.ts) | Wires `setupHoverKeyboardNavigation`, `initializeContainerFocus`, provides `getVirtualRects()`, `reattach()` on popout. |
| [masonry-view.ts](../../src/bases/masonry-view.ts) | Same wiring pattern as grid-view: `setupHoverKeyboardNavigation`, `initializeContainerFocus`, inline `getVirtualRects`, `reattach()` on popout. |

### Datacore

| File | Role |
|---|---|
| [controller.tsx](../../src/datacore/controller.tsx) | Calls `setupHoverKeyboardNavigation()` in a `useEffect` hook, wiring `hoveredCardRef`, `containerRef`, and `setFocusableCardIndex`. |

## Focus terminology

- **DOM focus** = browser's native `document.activeElement`
- **Visible focus** = `_keyboardNavActive === true`, card retains DOM focus so `:focus-visible::after` renders the focus ring (`_focus.scss`)
- A card can have DOM focus without visible focus (after mouse click)
- Visible focus requires explicit keyboard activation

## Container state flags

Two interfaces carry focus management state, one per backend.

### `CardContainerElement` (Datacore)

| Field | Type | Purpose |
|---|---|---|
| `_keyboardNavActive` | `boolean` | When true, card retains DOM focus (`:focus-visible` renders ring). When false, focusin handler rejects/blurs unwanted focus. Set on keyboard activation, cleared on mouse click, Escape, or focusout leaving all cards. |
| `_intentionalFocus` | `boolean` | Guards against focus event handlers rejecting programmatic `.focus()`. Set true before focus, cleared via RAF. |
| `_lastKey` | `string \| null` | Tracks last key pressed; cleared to `null` via RAF. Used to detect Tab in focusin handler. |
| `_mouseDown` | `boolean` | Tracks mousedown state. Distinguishes click from keyboard blur. |

### `FocusManagedContainer` (Bases)

| Field | Type | Purpose |
|---|---|---|
| `_keyboardNavActive` | `boolean` | Same role as Datacore. |
| `_intentionalFocus` | `boolean` | Same role as Datacore. |
| `_focusCleanup` | `() => void` | Prevents duplicate focusout handler registration via `initializeContainerFocus()`. |

**Critical lifecycle detail:** `_keyboardNavActive` is preserved across Preact ref cycles (only initialized when `undefined`). The other transient fields reset on every cycle.

### `FocusState` (Bases)

Defined in `src/types.ts`. Held as instance field on grid-view and masonry-view classes.

| Field | Type | Purpose |
|---|---|---|
| `cardIndex` | `number` | Index of the card with `tabindex="0"` (roving tabindex). Updated via `onFocusChange` callback from `setupHoverKeyboardNavigation`. |
| `hoveredEl` | `HTMLElement \| null` | Currently hovered card element. Set by `onHoverStart`/`onHoverEnd` callbacks in `renderCard`. Read by `setupHoverKeyboardNavigation` via `getHoveredCard()` getter. |

## Roving tabindex

One card has `tabindex="0"` (the "focusable" card), all others have `tabindex="-1"`.

- **Bases**: `focusState.cardIndex` on view class, passed to `renderCard`, applied in shared-renderer.ts
- **Datacore**: `focusableCardIndex` prop on CardView/MasonryView, applied in card-renderer.tsx

## Navigation algorithm

`handleArrowNavigation()` uses 2D spatial positioning:

1. Collect all card positions (DOM path: `getBoundingClientRect()`, virtual path: stored `VirtualCardRect[]`)
2. For each candidate card, check directional validity:
   - ArrowDown/ArrowUp: candidate must be below/above AND in same column (within 5px tolerance)
   - ArrowLeft/ArrowRight: candidate must be to left/right (no column constraint)
3. Score by weighted distance: `primaryAxisDist + crossAxisDist * 0.5`
4. Focus nearest valid candidate, scroll into view

### Two paths

| Path | Data source | Virtual scrolling | Used by |
|---|---|---|---|
| **DOM-based** | Queries all `.card` elements, uses `getBoundingClientRect()` | No | Datacore |
| **Virtual** | Pre-computed `VirtualCardRect[]` with stored x/y/width/height. If target is unmounted, calls `onMountItem()` first. See [grid-layout.md](grid-layout.md) and [masonry-layout.md](masonry-layout.md). | Yes | Bases grid + masonry |

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

- **Bases**: Browser natively focuses the card with `tabindex="0"` (roving tabindex). `initializeContainerFocus()` handles cleanup (resetting `_keyboardNavActive` on focusout), not activation.
- **Datacore**: Two paths:
  1. Container's `onFocus` handler: detects `_lastKey === 'Tab'`, sets `_keyboardNavActive=true`, delegates focus to first card.
  2. Document-level `focusin` listener (`handleDocumentFocusin`): detects Tab into `markdown-preview-view` and delegates to first card. Datacore-specific — handles Tab from outside the container.

### Escape

Clears `_keyboardNavActive`, blurs focused card. In Bases: handled in shared-renderer.ts card keydown. In Datacore: handled in a capture-phase document keydown listener set up by the container ref callback (card `onKeyDown` handles Enter/Space/Arrow but not Escape).

## Popout window support

The capture-phase keydown listener binds to `ownerDocument` (not global `document`). When a view moves to/from a popout:

- `reattach()` re-binds to the new document
- Called from `handleDocumentChange()` in grid-view.ts and masonry-view.ts
- Datacore: card-renderer.tsx uses `getOwnerWindow(el)` for RAF calls; ref callback re-runs on re-mount (implicit rebind)
- See `electron-popout-quirks.md` for why binding to the correct window matters

## Image viewer blocking

`isImageViewerBlockingNav()` checks for `.dynamic-views-image-embed.is-zoomed`:

- **Fullscreen viewer** — blocks all navigation
- **Constrained viewer** — blocks only if original embed is in same container
- Prevents arrow keys from navigating cards while panning/zooming an image

## Bases v Datacore differences

| Aspect | Bases | Datacore |
|---|---|---|
| **Wiring** | Imperative — view class calls `setupHoverKeyboardNavigation()` and `initializeContainerFocus()` directly | controller.tsx calls `setupHoverKeyboardNavigation()` in `useEffect`; card-renderer.tsx ref callback sets up container keydown, focusin, and card handlers |
| **Card keydown** | shared-renderer.ts `addEventListener('keydown', ..., { signal })` with per-card AbortController | card-renderer.tsx JSX `onKeyDown` prop |
| **Modifier keys** | Obsidian `Scope` per card — pushed on focus, popped on blur. Handles Cmd/Ctrl+Enter (new tab) and Cmd/Ctrl+Space. `activeScope` field prevents scope leaks during rapid focus switching. | `Keymap.isModEvent(e)` in card `onKeyDown` — no Scope integration. |
| **Document listeners** | One: `setupHoverKeyboardNavigation` capture-phase keydown | Four: `setupHoverKeyboardNavigation` capture-phase keydown (from controller.tsx), container ref's capture-phase keydown (`_lastKey`/Escape), document-level `focusin` (Tab detection), document-level `mouseup` (`_mouseDown` reset) |
| **Virtual scrolling** | `getVirtualRects()` provides stored positions; `onMountItem` mounts unmounted cards | Not implemented — all cards in DOM, uses DOM-based path |
| **Tab detection** | Via roving tabindex; focusout handler resets state | `_lastKey` tracking in container keydown + focusin check |
| **Focus state** | `focusState.cardIndex` on view class | `focusableCardIndex` Preact state via `dc.useState` |
| **Container state** | `FocusManagedContainer` with `_focusCleanup` (dedup guard for focusout handler) | `CardContainerElement` with `_lastKey` + `_mouseDown` (needed because Datacore's focusin handler must distinguish mouse clicks from keyboard focus to prevent unwanted focus ring activation) |
| **Popout rebind** | Explicit `reattach()` in `handleDocumentChange()` | Implicit — ref callback re-runs on re-mount |
| **`_keyboardNavActive` lifecycle** | Set once on container, persists until view teardown | Preserved across Preact ref cycles via `undefined` check (other fields reset) |

## Key invariants

1. **Capture phase intercepts before card handlers.** `setupHoverKeyboardNavigation` binds in capture phase so it can activate focus state before the card's own keydown handler fires (which checks `_keyboardNavActive`).
2. **`_intentionalFocus` is set before `.focus()` and cleared after.** Datacore clears via RAF (async — guards against focusin rejection across microtasks). Bases clears synchronously after `handleArrowNavigation()` returns (all focus events fire synchronously within the call).
3. **`_keyboardNavActive` must be `false` after mouse interaction.** Mouse clicks do not activate visible focus — they set DOM focus only. Ensures focus rings only appear during keyboard navigation.
4. **Roving tabindex tracks the last-focused card.** When arrow navigation moves focus, the `onFocusChange`/`onNavigate` callback updates the focusable index so the tabindex follows.
5. **Virtual rects include unmounted items.** In Bases, `getVirtualRects()` returns positions for ALL items (mounted and unmounted). `handleVirtualArrowNavigation` calls `onMountItem()` to mount the target before focusing.
6. **Image viewer blocks arrow navigation.** When a panzoom viewer is active, `isImageViewerBlockingNav()` prevents arrow keys from moving card focus.
7. **One visible-focus container at a time.** Case 3 in `setupHoverKeyboardNavigation` only activates `_keyboardNavActive` when the focused card is in THIS container (`focusedCardContainer === getContainerRef()`), preventing cross-view focus activation when multiple views exist.
8. **`content-hidden` is removed before focus.** `CONTENT_HIDDEN_CLASS` is removed from target cards before `.focus()` to ensure the focus target is visible (prevents focusing an invisible element in virtual-scrolled views).
