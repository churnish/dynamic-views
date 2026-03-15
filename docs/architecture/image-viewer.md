---
title: Image viewer
description: Dual-mode image viewer architecture — gesture systems (Panzoom desktop, native mobile touch), keyboard handler map, constrained vs fullscreen modes, cleanup lifecycle, and invariants.
author: 🤖 Generated with Claude Code
updated: 2026-03-14
---
# Image viewer

`src/shared/image-viewer.ts` implements a panzoom image viewer overlay with two gesture backends, platform-aware keyboard handling, and clipboard/drag support. The module exports two functions: `handleImageViewerTrigger()` (entry point for card image clicks) and `cleanupAllViewers()` (force cleanup on view destruction). Everything else is private.

## Viewer modes

Two display modes, determined at open time:

| Mode | CSS class | Positioning | When |
|---|---|---|---|
| Fullscreen | `.is-zoomed` | `position: fixed` on `body` | Phone always; tablet/desktop when fullscreen not disabled |
| Constrained | `.dynamic-views-viewer-fixed` + `.is-zoomed` | `position: fixed`, bounds locked to workspace-leaf via ResizeObserver | Desktop/tablet with fullscreen disabled in Style Settings |

Fullscreen viewers close when a modal opens (command palette, settings). Constrained viewers add `.dynamic-views-viewer-behind-modal` — this class is permanent for that viewer instance (the MutationObserver only watches `addedNodes`). The viewer must be closed and reopened after modal dismissal.

## Gesture system

```
GestureMode = 'mobile' | 'desktop'
```

Mobile (phone or tablet, `Platform.isMobile`) always uses `'mobile'`. Desktop only uses `'desktop'`. The mode determines which gesture backend attaches — they never coexist.

### Desktop: Panzoom

Library: `@panzoom/panzoom`. Provides scroll-wheel zoom, mouse drag pan, cursor states, and edge-gluing in maximized mode.

- **Maximize** (Space): Toggles `.is-maximized` class. Custom `setTransform` callback (`desktopSetTransform`) clamps pan so image edges stay at container boundaries. Min-scale set to fill the container.
- **Reset** (R / ArrowDown): Exits maximized mode, resets to scale 1, centered.
- **Right-click reset**: When maximized, re-centers at contain scale (stays maximized). When not maximized, resets to scale 1.
- **Popout quirk**: Panzoom binds pointer events to module-scope `document`. In popout windows, pointer events must be rebound to the popout's document (`gestureDoc`), otherwise drag/release fails.
- **Alt+drag**: `setAltDragMode(true)` excludes the image from Panzoom and sets `imgEl.draggable = true` to allow native drag via `app.dragManager`.

### Mobile: native touch handler

No Panzoom. Direct `touchstart`/`touchmove`/`touchend` listeners on the container. Ported from Obsidian's native `mobile-image-viewer` (deobfuscated source in `archive/obsidian-native-image-viewer.js`).

- **Pinch zoom**: Two-finger gesture with focal-point tracking (midpoint between fingers, relative to `container.getBoundingClientRect()` — works in both fullscreen and constrained modes).
- **Pan**: One-finger drag. Clamped: `maxPan = imgDim * (scale-1) / scale / 2` — prevents showing empty space.
- **Momentum**: Linear velocity decay after touch release (`momentumTick` — `velocity -= Math.min(0.003 * dt, velocity)`, clamped to prevent negative overshoot). Scale guard: `if (scale <= 1) return` — no momentum at 1x zoom since pan is clamped to 0.
- **Snap-back**: Pinching below 1x snaps back to 1x.
- **iOS drag & drop**: Touch handler uses `{ passive: true }`. iOS fires `touchcancel` when it takes over for drag, cleaning up handler state. At scale=1, maxPan=0 so microtremor during long-press hold is clamped.

### Desktop: zoom-disabled mode

When `dynamic-views-zoom-disabled` class is present, no Panzoom or mobile touch handler attaches. Desktop-only behaviors in this mode:

- **`onPinchWheel`**: Trackpad pinch (Ctrl+wheel) toggles `.is-maximized` class.
- **`onSpacebar`**: Space/R/ArrowDown toggle maximize/restore (same as Panzoom mode but no zoom).
- **Always draggable**: `imgEl.draggable = true` set unconditionally. `onPanzoomOffDragStart` handles drag via `app.dragManager` for vault files, or `text/plain` embed markdown for external URLs.

## Keyboard handlers

All desktop keyboard handlers use capture-phase listeners and are guarded by `isConstrainedViewerInactive()` in constrained mode.

### Desktop only

| Handler | Keys | Scope | Notes |
|---|---|---|---|
| `imageViewerKeyHandler` | Space, R, ArrowDown | `setupImageViewerGestures` | Toggle maximize, reset zoom. Only when Panzoom active. |
| `onSpacebar` | Space, R, ArrowDown | `openImageViewer` | Same keys when Panzoom disabled (zoom-disabled mode). |
| `onEscape` | Escape | `openImageViewer` | Close viewer. |
| `onCopy` | Cmd/Ctrl+C | `openImageViewer` | Copy image to clipboard. Handles CORS via canvas for external images. |
| `onEnter` | Enter | `openImageViewer` | Open image's vault file. Uses `getVaultPathFromResourceUrl()`. No-op for external images. |
| `onAltKeyDown/Up` | Alt press/release | `openImageViewer` | Enable/disable alt-drag mode. Only when Panzoom active. |
| `onAltBlur` | Window blur | `openImageViewer` | Resets alt-drag state when user Alt+Tabs away. Only when Panzoom active. |

### Mobile only

| Handler | Keys | Scope | Notes |
|---|---|---|---|
| `onBlockKeys` | Space, Enter, Escape, R, ArrowDown | `openImageViewer` | `preventDefault()` + `stopPropagation()`. Prevents underlying card/link activation. |

`stopPropagation()` is required because the card element underneath the overlay retains focus and has its own keydown handler — `preventDefault()` alone only blocks browser default actions, not other JS listeners.

### Constrained viewer leaf guard

`isConstrainedViewerInactive(el, doc)` — module-scope helper. Returns true when a constrained viewer's originating leaf is not active, causing keyboard handlers to return early. Prevents handlers in one pane from affecting a viewer in another pane.

Checks: viewer has `.dynamic-views-viewer-fixed` class, `doc.activeElement` is not the viewer, originating leaf (via `__originalEmbed`) is not `.mod-active`, and a different leaf has focus.

Used by: `imageViewerKeyHandler`, `onSpacebar`, `onEscape`, `onCopy`, `onEnter`, `onAltKeyDown`.

## Cleanup lifecycle

### Two-level tracking

1. **`viewerCleanupFns`** (passed in from caller): Gesture cleanup — Panzoom `.destroy()`, ResizeObserver `.disconnect()`, mobile touch handlers, momentum `cancelAnimationFrame()`.
2. **`viewerListenerCleanups`** (module-scope Map): Listener cleanup — all keyboard, click, pointer, touch, drag handlers. Timeout cleanup. Observer cleanup.

`viewerCleanupFns` is keyed by clone element. `viewerClones` (the caller-provided map) is keyed by original embed element (original → clone mapping). Deletion happens in pairs in `closeImageViewer()` and `cleanupAllViewers()`.

### Error rollback

`openImageViewer()` wraps listener setup in try-catch. On failure, cleanup runs in reverse order: gesture → listeners → observers → DOM removal. Prevents orphaned clones.

### Module-scope maps

- **`viewerListenerCleanups`**: Keyboard/click/touch listener cleanup. Used by `cleanupAllViewers()`.
- **`containerWheelHandlers`**: Wheel event handlers tracked separately (Panzoom wheel listeners need explicit removal).

## Close behavior

`closeImageViewer()` handles two post-close restorations:

- **Hover intent**: Restores `.hover-intent-active` on the original card to work around an Electron hit-testing issue where `:hover` and `mouseenter` are unreliable after clone overlay removal. The `restoreHoverIntent` parameter (default `true`) is `false` when a new viewer pre-empts the current one.
- **Thumbnail scrub resume**: Tracks cursor position via `dataset.viewerX/viewerY` (set by a `mousemove` listener on the overlay during open). On close, dispatches synthetic `mousemove` to resume slideshow scrubbing if cursor is still over a multi-image thumbnail. Uses `requestAnimationFrame` to handle Preact re-render race conditions. Dispatches `mouseleave` if cursor is out of bounds.

## Key types

```typescript
type CloneElement = HTMLElement & { __originalEmbed?: HTMLElement };
```

Stores reference to the original embed element for O(1) cleanup lookup and leaf detection.

```typescript
interface ViewerGestureControls {
  cleanup: () => void;
  setAltDragMode: (enabled: boolean) => void;
}
```

Returned by `setupImageViewerGestures()`. `setAltDragMode` is desktop-only — never called on mobile (gated by `!isMobile && gestureControls`).

## Invariants

1. **At most one viewer open at a time.** `openImageViewer()` closes all others first.
2. **`CloneElement.__originalEmbed` always points to source.** Used for cleanup lookup and leaf detection.
3. **Gesture controls and listeners always cleaned up together.** `viewerCleanupFns` and `viewerListenerCleanups` deletion happens in pairs.
4. **Image load must be awaited before gesture attachment.** Checks `imgEl.complete && imgEl.naturalWidth > 0` (catches broken images where `complete` is true but decode failed); otherwise waits for `load` event.
5. **Touch identifier matching is required.** Mobile handler tracks `prevTouch1/2` by `identifier` to distinguish finger lifts from new touches.
6. **Momentum animation frame must be canceled on all paths.** `mobileAnimFrame` canceled on cleanup, new touch start, and scale <= 1.
7. **Fullscreen closes on modal; constrained hides.** MutationObserver on `body` detects `.modal-container` / `.prompt` additions.
8. **Desktop focus management.** Clone gets `tabindex="-1"` and focus. Capture-phase pointerdown re-focuses on tab switch. No focus on mobile (prevents keyboard interference).
