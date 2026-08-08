---
title: Image viewer
description: Dual-mode image viewer architecture — gesture systems (hand-rolled desktop wheel/pointer, native mobile touch), keyboard handler map, arrow navigation, constrained vs fullscreen modes, cleanup lifecycle, and invariants.
author: 🤖 Generated with Claude Code
updated: 2026-08-08
---
# Image viewer

See also: [`odkb/electron-popout-quirks.md`](https://github.com/churnish/odkb/blob/main/electron-popout-quirks.md)

`src/core/image-viewer.ts` implements a zoom/pan image viewer overlay with two gesture backends, platform-aware keyboard handling, and clipboard/drag support. The module exports two functions: `handleImageViewerTrigger()` (entry point for card image clicks) and `cleanupAllViewers()` (force cleanup on view destruction). Everything else is private.

## Design principle: native parity takes priority

**When plugin behaviour and Obsidian's native lightbox disagree, match native.** This outranks arguments from taste, convention, or platform guidelines. If native's choice looks wrong, reproduce it anyway and record the reasoning — do not "fix" it.

Two consequences worth stating outright:

- **Verify native before claiming it.** Native's behaviour is frequently not where you expect: the drag cursor is a body class set from JS, not a rule in the lightbox CSS block; the titlebar name comes from `img.alt` for wikilink embeds rather than URL derivation; the close button's hover lightens via svg opacity while its colour stays fixed. Several claims in this session were wrong on first inspection because only one likely location was searched. Read the extracted renderer, and measure at runtime where possible.
- **Reproduce native's asymmetries too.** The close button is touch-sized and gets a raised backing plate on `.is-phone` only, while the titlebar reserves `--touch-size-m` of height across all of `.is-mobile` — so on tablets the titlebar reserves space the button never fills. That is native's inconsistency and it is mirrored deliberately. An earlier change extended the touch target to `.is-mobile` on accessibility grounds and was reverted under this principle.

Genuine divergences are limited to things native has no equivalent for — constrained-to-pane mode, the plugin's Style Settings toggles, Cmd+C copy, Enter-to-open, and Alt+drag — plus arrow navigation on tablets with a hardware keyboard. Each is noted where it appears below.

## Viewer modes

Two display modes, determined at open time:

| Mode | CSS class | Positioning | When |
|---|---|---|---|
| Fullscreen | `.is-zoomed` | `position: fixed` on `body` | Phone always; tablet/desktop when fullscreen not disabled |
| Constrained | `.dynamic-views-viewer-fixed` + `.is-zoomed` | `position: fixed`, bounds locked to workspace-leaf via ResizeObserver | Desktop/tablet with fullscreen disabled in Style Settings |

The fullscreen backdrop uses `--lightbox-background` (Obsidian's native lightbox variable, wrapped as `--dynamic-views-lightbox-background`) at 0.9 alpha, matching the native lightbox in both themes. Constrained mode keeps the pane-blended `--background-primary` overlay — it has no native counterpart. The native lightbox class itself is not exported from the `obsidian` module, so it cannot be used directly (see [#419](https://github.com/churnish/dynamic-views/issues/419)).

Fullscreen viewers close when a modal opens (command palette, settings). Constrained viewers add `.dynamic-views-viewer-behind-modal` — this class is permanent for that viewer instance (the MutationObserver only watches `addedNodes`). The viewer must be closed and reopened after modal dismissal.

## Overlay chrome

The clone carries two chrome elements, both absolutely positioned against it (the clone's `contain: strict` gives it layout containment, making it their containing block):

```
.dynamic-views-image-embed.is-zoomed
├── img
├── .dynamic-views-viewer-titlebar        ← pointer-events: none
│   └── .dynamic-views-viewer-titlebar-text
└── .dynamic-views-viewer-close           ← setIcon(el, 'x')
```

Both replicate Obsidian's native lightbox declarations (`.lightbox-titlebar`, `.modal-close-button` + `.clickable-icon` + `.mod-raised`) rather than reusing those class names. Obsidian's internal class names carry no compatibility guarantee — the lightbox itself is not part of the plugin API (see [#419](https://github.com/churnish/dynamic-views/issues/419)) — so borrowing them would couple the viewer's appearance to private implementation detail. Theme customization still reaches these elements through the wrapped `--lightbox-titlebar-color` / `--lightbox-titlebar-display` variables, which is the supported surface.

The titlebar name resolves as `img.title || img.alt || getImageDisplayName(src)` — the same chain the native lightbox uses, verified against Obsidian 1.13.5. It must be computed **before** `getCachedBlobUrl()` swaps external `src` values for `blob:` URLs, which have no usable basename.

Card images always carry `alt=""`, so in practice the name is the basename of the URL's decoded path, query string stripped — matching native for external images (`…/300` → `300`, `…demo.png?cachebust=99` → `demo.png`). Native shows a vault-relative path for `![[wikilink]]` embeds only because Obsidian sets `alt` to the link text there; that is the `alt` branch, not URL derivation.

The Style Settings toggle `dynamic-views-image-viewer-hide-filename` is inverted — absence of the class shows the name, so the default survives without Style Settings installed. Unlike native, the titlebar does not fade out while the image is zoomed; the plugin tracks no zoom-level state class.

The close button needs no interaction guards: `onOverlayClick` only fires when `e.target === cloneEl`, and `setupTouchInterceptAll` intercepts `touchmove` only without calling `preventDefault()`.

## Image sizing

The viewer image matches the native lightbox exactly: `max-width/max-height: 100%` of the overlay, `padding: var(--size-4-2)` with `box-sizing: border-box`, and `width/height: auto` so images smaller than the overlay stay at natural size rather than upscaling. Measured against native at a 1100×800 viewport, an 800×600 image renders at 816×616 border-box in both.

There is no percentage cap. An earlier `90vh`/`90vw` desktop cap made large images visibly smaller than native and was removed, along with the `max-width`/`max-height` transition that existed only for the deleted maximize mode. Constrained mode keeps its own `90%` inset — it has no native counterpart.

## Dismissal

Three paths close the viewer: the `x` button, a press on the backdrop, and Escape/Space on desktop. **Pressing the image itself never dismisses** — `onOverlayClick` requires `e.target === cloneEl`, so image targets fall through. This matches the native lightbox, whose media-container click handler closes only when the target is not an `HTMLImageElement`. There is no longer a `dynamic-views-image-viewer-disable-dismiss-on-press` Style Setting; it existed solely to suppress image-press dismissal and became a no-op.

## Gesture system

```
GestureMode = 'mobile' | 'desktop'
```

Mobile (phone or tablet, `Platform.isMobile`) always uses `'mobile'`. Desktop only uses `'desktop'`. The mode determines which gesture backend attaches — they never coexist.

### Desktop: hand-rolled wheel + pointer

No library. `attachDesktopGestures()` owns three numbers — `scale`, `panX`, `panY` — and writes them as **native's transform order**: `translate(panXpx, panYpx) scale(scale)`. Translate applies after the scale, so the pan is in **screen pixels**. `@panzoom/panzoom` was removed once the wheel handler was ported; the workarounds it needed (container reparenting for its module-scope `isAttached`, four rebound pointer listeners for popouts, an `!important` cursor override, `is-grabbing` listeners, `{ animate: false }` on every reset) all disappeared with it.

- **Transform writes are coalesced.** `applyDesktopTransform()` schedules a single-slot `requestAnimationFrame` (`if (rafId) return`), matching native's `applyZoom`. A burst of wheel or pointer events produces one style write per frame; the callback reads the live state, so a reset issued mid-frame is picked up by the pending callback rather than queuing a second one. Scheduled and cancelled through `gestureWin` — never a bare global, which in a popout would schedule on the main window and silently no-op the cancel.
- **Clamping is against live dimensions**, exactly as native's `getMaxPanBounds`: `maxPanX = max(0, (imgEl.offsetWidth * scale - container.offsetWidth) / 2)`, same for Y. Deliberately not cached — the container resizes without a `load` event on window resize (fullscreen) and via the `.workspace-leaf` ResizeObserver that rewrites the clone's inline size (constrained). A cache would also buy nothing, since `imgEl.offsetWidth` is read in the same expression; the clone's `contain: strict` keeps the read cheap. At 1x the image never exceeds the container, so `maxPan` is 0 and pan is pinned — the same "no pan until zoomed" behaviour native has, with no separate flag.
- **Pointer drag pan**: `pointerdown`/`pointermove`/`pointerup`/`pointercancel`, all four on `imgEl`. `setPointerCapture` retargets the stream to the capture element, so document-level listeners are unnecessary and container-level ones would never fire — which is also why popouts need no special handling. `pointerdown` bails unless `e.button === 0 && scale > 1` (native's `handleMouseDown`) and alt-drag is off; `pointermove` bails unless the pointer id matches the captured one, since the listeners are permanently attached and hovering a zoomed image would otherwise pan it. Movement is added in screen pixels with no scale division.
- **Cursor**: `.is-pannable` is toggled on the container from inside the rAF, guarded by a `wasPannable` boolean so an unchanged state writes no class (the container has `contain: strict`, and this runs every gesture frame). SCSS gives `.is-zoomed.is-pannable img` `cursor: grab`, matching native's `.lightbox.is-zoomed .media-wrapper img`; at 1x the image inherits `cursor: default` from the overlay. `pointerdown`/`pointerup` add and remove Obsidian's own `is-grabbing` class on the owner document's body for the closed-fist drag cursor — `app.css` already carries `cursor: grabbing !important` for it, so the plugin adds no CSS. Because that class is app-wide, gesture cleanup removes it unconditionally: `pointerup` never fires if the viewer is torn down mid-drag.
- **No maximize mode**: there is no fill-the-container state, no `.is-maximized` class, and no keyboard or right-click zoom reset. Space closes the viewer (see [Keyboard handlers](#keyboard-handlers)); right-click on the image is suppressed by `onContextMenu` in `openImageViewer`.
- **Alt+drag**: `setAltDragMode(true)` sets a closure flag that makes `pointerdown` bail, plus `imgEl.draggable = true`, allowing native drag via `app.dragManager`.

#### Scope wiring

`resetZoom` and `setAltDragMode` live on the object returned by `setupImageViewerGestures()` and cannot see `attachDesktopGestures`'s locals. Four bindings in the outer closure bridge the gap, mirroring the existing `mobileResetTransform` pattern: `desktopResetTransform`, `desktopSetAltDrag`, `desktopCleanup`, and a `desktopAttached` boolean.

`desktopAttached` replaces the old `panzoomInstance` null-check in both `ensureGestures()` (whose guard is `if (desktopAttached || mobileTouchHandler) return`) and `cleanup()`. It is set immediately after the wheel listener registers, not at the end of the function: a throw in between would otherwise make cleanup skip desktop teardown and leak the listener along with its `containerWheelHandlers` entry. Without the sentinel, `ensureGestures` would attach a second wheel and pointer set on every navigation load and overwrite the tracked handler, leaking the first.

The four pointer listeners share one `AbortController`; `desktopCleanup` aborts it and cancels any pending rAF.

### Wheel behaviour

Replicates native's `handleWheelZoom` exactly. Three branches, on a `{ passive: false }` listener attached to the container — native binds to its whole viewer with no target check, so the backdrop behaves like the image.

| Condition | Behaviour |
|---|---|
| `ctrlKey \|\| metaKey` | `preventDefault`, then zoom about the cursor |
| No modifier, scale > 1 | `preventDefault`, then pan |
| No modifier, scale = 1 | Ignored — **no `preventDefault`**, so normal scrolling is untouched |

**Zoom is additive, not multiplicative.** `deltaY` is normalised by `deltaMode` (`DOM_DELTA_LINE` ×40, `DOM_DELTA_PAGE` ×800), then the step is `-delta / 150`, doubled when `Platform.isMacOS && !Number.isInteger(e.deltaY)` — fractional deltas mean a trackpad. The result is added to the current scale and clamped to 1–10. Trackpad pinch synthesises `ctrlKey` on every platform, so pinch lands in the zoom branch for free. The plugin's `zoomSensitivity` setting is applied as a *relative* multiplier (`step *= sensitivity / 0.08`) so its default reproduces native exactly.

Because the desktop backend now uses native's transform order, both branches are native's arithmetic verbatim:

- **Pan**: `panX -= 1.5 * deltaX`. Screen pixels, so travel is a flat 1.5 × delta at every zoom level with no scale division.
- **Focal zoom**: `pan' = (pan - f) * (zNew/zOld) + f`, where `f` is the cursor offset from the **container** centre (not the element's — the image is centred in a full-window container, so an element-relative focal drifts on whichever axis the image does not fill).

Returning to 1x zeroes the pan explicitly, as native does, so zooming out after panning never strands the image off-screen.

### Mobile: native touch handler

Direct `touchstart`/`touchmove`/`touchend` listeners on the container. Behavior modeled after Obsidian's native `mobile-image-viewer`.

**The mobile backend keeps the opposite transform order** — `scale(s) translate(x, y)`, so its pan is pre-scale and its one-finger delta is divided by the scale. This divergence from the desktop backend (and from native) is deliberate: the mobile pinch/pan/momentum maths is written against pre-scale units throughout, and it is already at parity with Obsidian's mobile viewer, which is a different implementation from the desktop lightbox.

- **Pinch zoom**: Two-finger gesture with focal-point tracking (midpoint between fingers, relative to `container.getBoundingClientRect()` — works in both fullscreen and constrained modes).
- **Pan**: One-finger drag. Clamped: `maxPan = imgDim * (scale-1) / scale / 2` — prevents showing empty space.
- **Momentum**: Linear velocity decay after touch release (`momentumTick` — `velocity -= Math.min(0.003 * dt, velocity)`, clamped to prevent negative overshoot). Scale guard: `if (scale <= 1) return` — no momentum at 1x zoom since pan is clamped to 0.
- **Snap-back**: Pinching below 1x snaps back to 1x.
- **WebKit drag & drop**: Touch handler uses `{ passive: true }`. WebKit fires `touchcancel` when it takes over for drag, cleaning up handler state. At scale=1, maxPan=0 so microtremor during long-press hold is clamped.

### Desktop: zoom-disabled mode

When `dynamic-views-zoom-disabled` class is present, neither gesture backend attaches. Desktop-only behavior in this mode:

- **Always draggable**: `imgEl.draggable = true` set unconditionally. `onZoomDisabledDragStart` handles drag via `app.dragManager` for vault files, or `text/plain` embed markdown for external URLs.

## Keyboard handlers

All desktop keyboard handlers use capture-phase listeners and are guarded by `isConstrainedViewerInactive()` in constrained mode.

### Desktop only

| Handler | Keys | Scope | Notes |
|---|---|---|---|
| `onEscape` | Escape, Space | `openImageViewer` | Close viewer. Space also `preventDefault()`s to stop pane scroll and card re-activation. |
| `onCopy` | Cmd/Ctrl+C | `openImageViewer` | Copy image to clipboard. Handles CORS via canvas for external images. |
| `onEnter` | Enter | `openImageViewer` | Open image's vault file. Uses `getVaultPathFromResourceUrl()`. No-op for external images. |
| `onAltKeyDown/Up` | Alt press/release | `openImageViewer` | Enable/disable alt-drag mode. Only when gestures are active. |
| `onAltBlur` | Window blur | `openImageViewer` | Resets alt-drag state when user Alt+Tabs away. Only when gestures are active. |
| `onArrowNav` | ArrowLeft, ArrowRight | `openImageViewer` | Step through the card's navigable image set. Only attached when the card registered a set of more than one image. See [Arrow navigation](#arrow-navigation). |

### Mobile only

| Handler | Keys | Scope | Notes |
|---|---|---|---|
| `onBlockKeys` | Space, Enter, Escape, R, ArrowDown | `openImageViewer` | `preventDefault()` + `stopPropagation()`. Prevents underlying card/link activation. |

`stopPropagation()` is required because the card element underneath the overlay retains focus and has its own keydown handler — `preventDefault()` alone only blocks browser default actions, not other JS listeners. See [keyboard-nav.md](keyboard-nav.md) for the card-side blocking mechanism (`isImageViewerBlockingNav()`).

### Constrained viewer leaf guard

`isConstrainedViewerInactive(el, doc)` — module-scope helper. Returns true when a constrained viewer's originating leaf is not active, causing keyboard handlers to return early. Prevents handlers in one pane from affecting a viewer in another pane.

Checks: viewer has `.dynamic-views-viewer-fixed` class, `doc.activeElement` is not the viewer, originating leaf (via `__originalEmbed`) is not `.mod-active`, and a different leaf has focus.

Used by: `onEscape`, `onCopy`, `onEnter`, `onAltKeyDown`, `onArrowNav`.

## Arrow navigation

ArrowLeft/ArrowRight step through the images a card can already navigate. Enabled on desktop always, and on tablets when a hardware keyboard is attached (`Platform.isTablet && hasPhysicalKeyboard()`); phones are excluded even with a keyboard. There is no swipe gesture in the viewer on any platform.

`hasPhysicalKeyboard()` is a local accessor, not a `Platform` property — see its doc comment in `image-viewer.ts` for why module augmentation cannot reach it, and why it can only ever widen the mobile case.

Tablets run the **mobile** gesture backend, so `desktopResetTransform` is null. `resetZoom()` therefore also calls `mobileResetTransform()`, exposed from the mobile gesture closure, to zero `scale`/`panX`/`panY` and cancel momentum — otherwise a navigated image would inherit the previous zoom. Bounds need no extra handling: `mobileLoadHandler` already recomputes `imgWidth`/`imgHeight`/`maxScale` on every load, src swaps included.

### The navigable set

`setViewerImageSet(embedEl, set)` registers what the viewer may step through, keyed in a module-scope `WeakMap` by the `.dynamic-views-image-embed` element — the same element `handleImageViewerTrigger` receives as `e.currentTarget`. DOM-keyed, so entries are collected when cards unmount; there is no explicit cleanup.

Two render sites in `shared-renderer.ts` populate it, both with the already-capped arrays:

| Site | `format` | Array | Cap |
|---|---|---|---|
| `renderSlideshow` | `'slideshow'` | `imageUrls` (already `slideshowUrls`) | `getSlideshowMaxImages()` |
| `renderImage` | `'thumbnail'` | `scrubbableUrls`, when non-null | 10 |

`scrubbableUrls` being non-null already encodes the thumbnail + multi-image + scrubbing-enabled gate, so no extra condition is needed. Every other format — plain covers, posters, backdrops, single-image thumbnails — registers nothing, and the viewer is inert there.

**The map holds a snapshot, not the live array.** `setViewerImageSet` copies with `[...urls]`. Both source arrays are spliced in place by the card's broken-URL recovery while the viewer may be open (`createPreloadBrokenHandler` for slideshows, the `tryNextImage` and `nextImg` error handlers for scrubbable thumbnails). Holding the live array would silently shift `currentIndex` mid-session and could shrink the set below the `length > 1` gate evaluated at open. Broken entries are still skipped — via the global `brokenImageUrls`, not via array mutation.

### Index independence

The viewer tracks its own `currentIndex`, resolved at open by matching the clicked image against the set. Card images render with raw `src`, but a slideshow or scrub step may already have swapped in a `blob:` URL, and `imgEl.src` returns the resolved percent-encoded form — so four forms are matched (raw attribute, resolved `src`, and each through `getCachedBlobUrl`). No match falls back to index 0.

Navigating in the viewer never advances the card underneath. Closing the viewer leaves the card on whatever image it was showing.

### Stepping rules

`getNextImageIndex()` in `src/core/viewer-navigation.ts` is the pure stepper, extracted for testability. It mirrors `createSlideshowNavigator`'s rules:

- **Navigation always wraps** — past the last image returns to the first, and vice versa. There is no opt-out.
- **Broken entries are skipped**, guarded by `skipped < urls.length`.
- Returns `-1` when exhausted or when the step lands back on `current`.

### Navigation errors

Navigation carries its own error handling. The gesture module's `errorHandler` cannot be reused: it exists only when the image was not already complete at open, it is `{ once: true }`, and its sole job is cancelling initial gesture attachment.

Reassigning `img.src` mid-load fires no `error` for the aborted request, so superseded listeners would survive. A single `pendingNavError` slot holds at most one navigation error listener; each step removes the previous one before arming its own. Without that, stale listeners accumulate and all fire on a later genuine 404, each marking a different — valid — URL broken in the session-global `brokenImageUrls`.

On error the handler marks the URL broken and retries in the same direction, bounded by an `attempts` counter independent of the stepper's exhaustion guard. `slideshow.ts`'s per-navigator `failedIndices` is closure-private and deliberately not replicated; `brokenImageUrls` is the shared skip set.

### Zoom and gestures across steps

`showIndex` calls `gestureControls.resetZoom()` before swapping `src` so the incoming image starts at 1x. `.is-pannable` self-clears on the next frame, when `applyDesktopTransform` (or the mobile `applyTransform`) sees the scale back at 1.

`ensureGestures()` closes a hole navigation opens: if the *first* image is broken, the gesture module's `errorHandler` removes `initialLoadHandler` and neither is re-armed. Without it, navigating to a valid image would leave that image with no pan, no wheel zoom, and no working `resetZoom` for the rest of the viewer session. `showIndex` calls it on every successful load.

### Titles

Titles after navigation use `getImageDisplayName(url)` only — not the `title || alt || basename` chain used at open. `title`/`alt` belong to the initially embedded image and must not be reapplied to a different one. Equivalent in practice today, since card images always carry `alt=""`.

## Cleanup lifecycle

### Two-level tracking

1. **`viewerCleanupFns`** (passed in from caller): Gesture cleanup — desktop wheel/pointer listeners and pending rAF, mobile touch handlers, momentum `cancelAnimationFrame()`.
2. **`viewerListenerCleanups`** (module-scope Map): Listener cleanup — all keyboard, click, pointer, touch, drag handlers. Timeout cleanup. Observer cleanup.

`viewerCleanupFns` is keyed by clone element. `viewerClones` (the caller-provided map) is keyed by original embed element (original → clone mapping). Deletion happens in pairs in `closeImageViewer()` and `cleanupAllViewers()`.

### Error rollback

`openImageViewer()` wraps listener setup in try-catch. On failure, cleanup runs in reverse order: gesture → listeners → observers → DOM removal. Prevents orphaned clones.

### Module-scope maps

- **`viewerListenerCleanups`**: Keyboard/click/touch listener cleanup. Used by `cleanupAllViewers()`.
- **`containerWheelHandlers`**: Wheel event handlers tracked separately — the listener is registered with non-default options (`{ passive: false }`), so removal needs the stored reference and the same options object.

## Close behavior

`closeImageViewer()` handles two post-close restorations:

- **Hover intent**: Restores `.interact` on the original card to work around an Electron hit-testing issue where `:hover` and `mouseenter` are unreliable after clone overlay removal. The `restoreHoverIntent` parameter (default `true`) is `false` when a new viewer pre-empts the current one.
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
  resetZoom: () => void;
  ensureGestures: () => void;
}
```

Returned by `setupImageViewerGestures()`. `setAltDragMode` is desktop-only — never called on mobile (gated by `!isMobile && gestureControls`). `resetZoom` and `ensureGestures` are called only from arrow navigation, which is likewise desktop-only.

```typescript
interface ViewerImageSet {
  urls: string[];
  format: 'slideshow' | 'thumbnail';
}
```

Registered by `setViewerImageSet()` from the renderer. `format` selects which per-format looping style setting applies. See [Arrow navigation](#arrow-navigation).

## Invariants

1. **At most one viewer open at a time.** `openImageViewer()` closes all others first.
2. **`CloneElement.__originalEmbed` always points to source.** Used for cleanup lookup and leaf detection.
3. **Gesture controls and listeners always cleaned up together.** `viewerCleanupFns` and `viewerListenerCleanups` deletion happens in pairs.
4. **Image load must be awaited before gesture attachment.** Checks `imgEl.complete && imgEl.naturalWidth > 0` (catches broken images where `complete` is true but decode failed); otherwise waits for `load` event.
5. **Touch identifier matching is required.** Mobile handler tracks `prevTouch1/2` by `identifier` to distinguish finger lifts from new touches.
6. **Momentum animation frame must be canceled on all paths.** `mobileAnimFrame` canceled on cleanup, new touch start, and scale <= 1.
7. **Fullscreen closes on modal; constrained hides.** MutationObserver on `body` detects `.modal-container` / `.prompt` additions.
8. **Desktop focus management.** Clone gets `tabindex="-1"` and focus. Capture-phase pointerdown re-focuses on tab switch. No focus on mobile (prevents keyboard interference).
9. **The viewer's image set is a snapshot.** Indices stay valid for the viewer's lifetime even as the card splices broken URLs out of its own arrays.
10. **At most one pending navigation error listener.** Each step clears `pendingNavError` before arming the next; cleanup removes whatever remains.
