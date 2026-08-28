---
title: Image viewer
description: Dual-mode image viewer architecture — gesture systems (hand-rolled desktop wheel/pointer, native mobile touch), keyboard handler map, arrow navigation, constrained vs fullscreen modes, touch and drag-out gating, cleanup lifecycle, and invariants.
author: 🤖 Generated with Claude Code
updated: 2026-08-26
---
# Image viewer

See also: [`odkb/electron-popout-quirks.md`](https://github.com/churnish/odkb/blob/main/electron-popout-quirks.md)

`src/core/image-viewer.ts` implements a zoom/pan image viewer overlay with two gesture backends, platform-aware keyboard handling, and drag-out support. Its public surface is six functions; everything else, including the `CloneElement` expando type, is private.

| Export | Role |
|---|---|
| `handleImageViewerTrigger()` | Entry point for card image clicks |
| `setViewerImageSet()` | Registers a card's navigable image set at render time |
| `cleanupAllViewers()` | Force teardown on view destruction |
| `closeAllViewers()` | Closes every open viewer, wherever its owning view lives |
| `hasOpenViewer()` | O(1) "is any viewer open" test, for hot keyboard paths |
| `getViewerSourceEmbed()` | Reads the clone's source-embed expando without re-declaring the type |

## Design principle: native parity takes priority

**When plugin behaviour and Obsidian's native lightbox disagree, match native.** This outranks arguments from taste, convention, or platform guidelines. If native's choice looks wrong, reproduce it anyway and record the reasoning — do not "fix" it.

Two consequences worth stating outright:

- **Verify native before claiming it.** Native's behaviour is frequently not where you expect: the drag cursor is a body class set from JS, not a rule in the lightbox CSS block; the titlebar name comes from `img.alt` for wikilink embeds rather than URL derivation; the close button's hover lightens via svg opacity while its colour stays fixed. Several claims in this session were wrong on first inspection because only one likely location was searched. Read the extracted renderer, and measure at runtime where possible.
- **Reproduce native's asymmetries too.** The close button is touch-sized and gets a raised backing plate on `.is-phone` only, while the titlebar reserves `--touch-size-m` of height across all of `.is-mobile` — so on tablets the titlebar reserves space the button never fills. That is native's inconsistency and it is mirrored deliberately. An earlier change extended the touch target to `.is-mobile` on accessibility grounds and was reverted under this principle.

Genuine divergences are limited to things native has no equivalent for — constrained-to-pane mode, the plugin's Style Settings toggles, and dragging the image out into the vault — plus arrow navigation on tablets with a hardware keyboard. Each is noted where it appears below.

## Viewer modes

Two display modes, determined at open time:

| Mode | CSS class | Mount point | Positioning | When |
|---|---|---|---|---|
| Fullscreen | `.is-zoomed` | `body` | `position: fixed` | Phone always; tablet/desktop when fullscreen not disabled |
| Constrained | `.dynamic-views-viewer-constrained` + `.is-zoomed` | the owning `.workspace-leaf` | `position: absolute; inset: 0`, with a ResizeObserver adjusting only `top` for the tab header inset | Desktop/tablet with fullscreen disabled in Style Settings |

Mounting the constrained clone inside its leaf rather than on `body` is what makes it participate in Obsidian's tab-drop preview and stops it painting over the split resize handle. The leaf is already `contain: strict` + `overflow: hidden` + `isolation: isolate`, so an absolutely positioned child reproduces the leaf rect exactly and is paint-clipped to it — no geometry tracking needed. The ResizeObserver exists only because the tab header collapses to `display: none` in the sidebars, where the inset must be zero.

The fullscreen backdrop uses `--lightbox-background` (Obsidian's native lightbox variable, wrapped as `--dynamic-views-lightbox-background`) at 0.9 alpha, matching the native lightbox in both themes. Constrained mode has no native counterpart, so it keeps the pane-blended `--background-primary` tint — but at the same 0.9 alpha, so both modes dim by the same amount. It previously derived its alpha from the theme's `--background-modifier-cover`, which made the two modes dim differently. The native lightbox class itself is not exported from the `obsidian` module, so it cannot be used directly (see [#419](https://github.com/churnish/dynamic-views/issues/419)).

Modals need no special handling, matching native — nothing in the renderer couples the lightbox to the modal system. Obsidian's `.modal-container` reads `z-index: var(--layer-modal)`, the same variable the viewer reads, and is appended to `body` afterwards, so it stacks on top by DOM order and the viewer stays open behind it. Keyboard precedence is handled separately, by the keymap scope — see [Keyboard handlers](#keyboard-handlers).

Both modes also opt out of the browser's default touch behaviours, but only fullscreen does so wholesale (`touch-action: none`, matching native's `.lightbox-media`). See [Touch and drag-out](#touch-and-drag-out).

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

The file name always shows, as in native; visibility is governed solely by the wrapped `--lightbox-titlebar-display` variable, which themes can still override. The titlebar fades out while the image is zoomed, matching native — keyed to `.is-pannable`, which both gesture backends maintain.

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
- **Drag into the vault**: constrained mode only, and only at 1x. `imgEl.draggable` is toggled by the gesture backend in the same guarded block that toggles `.is-pannable`, so panning keeps the pointer once zoomed; the `dragstart` handler re-checks `.is-pannable` and builds the payload via `app.dragManager`. Full screen never attaches the listener at all — the overlay covers everything droppable — and is additionally held inert by `draggable = false` plus a `user-drag: none` rule.

#### Scope wiring

`resetZoom` lives on the object returned by `setupImageViewerGestures()` and cannot see `attachDesktopGestures`'s locals. Three bindings in the outer closure bridge the gap, mirroring the existing `mobileResetTransform` pattern: `desktopResetTransform`, `desktopCleanup`, and a `desktopAttached` boolean.

`desktopAttached` replaces the old `panzoomInstance` null-check in both `ensureGestures()` (whose guard is `if (desktopAttached || mobileTouchHandler) return`) and `cleanup()`. It is set immediately after the wheel listener registers, not at the end of the function: a throw in between would otherwise make cleanup skip desktop teardown and leak the listener. Without the sentinel, `ensureGestures` would attach a second wheel and pointer set on every navigation load, leaking the first.

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

## Touch and drag-out

Three separate mechanisms decide whether a press on the image starts a drag, and they do not overlap the way their names suggest.

| Mechanism | Governs | Scope |
|---|---|---|
| `imgEl.draggable` | The desktop HTML5 drag-and-drop path | Set at gesture setup and re-gated on every zoom-state change |
| `-webkit-user-drag: none` | The same desktop path, via CSS | Non-mobile fullscreen, plus any zoomed viewer |
| `touch-action: none` | Every default touch behaviour, **including WebKit's long-press image drag** | Fullscreen only |

**On WebKit, neither `draggable` nor `-webkit-user-drag` reaches the long-press affordance.** A press on an image with `draggable="false"` still starts a system drag, fires the drag-lift haptic, and then aborts with no payload. Only opting the region out with `touch-action: none` prevents it. Native does exactly this on `.lightbox-media` (`app.css:8624-8633`) and additionally sets `draggable="false"` at element creation (`app.js:95278-95282`) — the attribute alone is not what does the work there either. See `odkb/ios-webkit-quirks.md`.

`touch-action: none` is scoped to fullscreen deliberately. Constrained mode is a plugin-only mode with no native counterpart, and its purpose on tablets is that a long press **does** start a vault drag — opting it out there would delete the feature.

Drag-out itself is allowed only when `allowDragOut` is true (`!isFullscreen`) **and** the image is not pannable, so it is confined to constrained mode at 1x. Phones never qualify by construction: `isFullscreen` is `isPhone || fullscreen-not-disabled`.

### The payload must not come from `imgEl.src`

External card images are blob-cached, and the viewer swaps its own `img.src` to the cached blob at open. A card that was scrubbed or slideshow-stepped before opening is *already* showing a blob. So `imgEl.src` is unreliable at every point in the viewer's life, and anything needing the image's real address must read `currentRawUrl` instead — tracked from open and updated on every navigation step.

Both the drag payload and the titlebar name depend on this. Reading `imgEl.src` for the payload produces an embed carrying a session-scoped `blob:` URL, which resolves until the app restarts and then dies; reading it for the title produces the blob's UUID instead of a filename. `currentRawUrl` is derived from the matched entry in the navigable set, falling back to `imgEl.src` only for cards with no set, whose src is never swapped.

## YouTube resolution upgrade

Cards fetch the narrowest YouTube rung that covers their own display size (see [image-loading.md](image-loading.md)), so opening one would otherwise fill the screen with a 320px image. `upgradeYouTubeResolution` re-resolves the video at full resolution and swaps `imgEl.src` when it lands.

Three things the obvious implementation gets wrong:

- **The viewer has no video ID and cannot recover one with the forward parser.** `getYouTubeVideoId` returns null for a thumbnail URL — `vi` is not an ID-carrying path segment, and the WebP host is not a `youtube.com` name at all. `getVideoIdFromThumbnailUrl` is the reverse parser, deliberately limited to the two hosts the plugin emits.
- **Arrow navigation would revert it.** `showIndex` re-reads the card's raw URLs, so upgrading only at open lets a single `→` `←` round trip drop the image back to the card's rung permanently. The upgrade runs on **every index change**, not just at open.
- **The open path is synchronous and the probe is not.** By the time the probe answers, the viewer may have closed, been torn down by `cleanupAllViewers`, or navigated elsewhere. The swap is guarded on `imgEl.isConnected`, on `currentIndex` not having moved since the probe started, and on `currentRawUrl` not having been superseded. None of the three subsumes the others.

`currentRawUrl` is updated to the upgraded URL so drag-out hands over the image actually on screen. The titlebar deliberately keeps the name it opened with — it is a label, not an address, and rewriting it mid-view to a different rung is visible noise.

## Keyboard handlers

Keyboard input runs through **one catch-all `Scope`** pushed onto Obsidian's keymap stack (`app.keymap.pushScope`), not through document listeners. A document listener cannot win against a modal: Obsidian's own keydown listener is capture-phase on `window` (`app.js:59501-59504`), so the capture path reaches Window before Document regardless of registration order, and a modal's Escape handler closes synchronously and detaches `.modal-container` in the same tick on desktop (`app.js:63741`, `:63699`). Any DOM-presence test for "is a modal open" therefore reads false by the time a document handler runs.

`Modal.open` pushes a **parentless** scope (`app.js:63628`, `:63493`) and `Scope.handleKey` only walks `parent` (`app.js:59475`), so while a modal is up the viewer's scope is never consulted — the first Escape closes the modal, the second reaches the viewer.

**Observed**: 2026-08-10, Obsidian 1.13.6. All `app.js`/`app.css` line numbers in this doc are read against that version — re-resolve by symbol rather than trusting the number.

Registration is a catch-all `(null, null)`, the shape Obsidian's own HotkeyManager uses (`app.js:65672`): an entry bound to a specific key swallows that key even when the callback declines (`app.js:59471-59472`), which would eat Escape for other panes when the leaf guard bails. Returning `false` makes Obsidian `preventDefault()` + `stopPropagation()` at the window listener (`app.js:59570-59571`), which also keeps the event off the card's own keydown handler.

The callback bails via `isConstrainedViewerInactive()` before anything else, then dispatches in this order:

| Order | Keys | Platform | Behaviour |
|---|---|---|---|
| 1 | ArrowLeft, ArrowRight | Desktop + keyboard tablets | Step through the card's navigable image set. Only when the card registered a set of more than one image. See [Arrow navigation](#arrow-navigation). Tested first so the mobile block list below cannot shadow it on tablets. |
| 2 | Space, Enter, Escape, R, ArrowDown | Mobile | Consumed, preventing underlying card/link activation. Returning `false` does the blocking that a hand-rolled `stopPropagation()` used to. |
| 3 | Escape, Space | Desktop | Close the viewer. Space would otherwise scroll the pane or re-activate the card underneath. |

Anything else returns `undefined` and falls through to the parent scope.

### Constrained viewer leaf guard

`isConstrainedViewerInactive(el, doc)` — module-scope helper. Returns true when a constrained viewer's originating leaf is not active, causing keyboard handlers to return early. Prevents handlers in one pane from affecting a viewer in another pane.

Checks: viewer has `.dynamic-views-viewer-constrained` class, `doc.activeElement` is not the viewer, originating leaf (via `__originalEmbed`) is not `.mod-active`, and a different leaf has focus.

Checked once at the top of the scope callback, so it gates every key the viewer handles.

## Arrow navigation

ArrowLeft/ArrowRight step through the images a card can already navigate. Enabled on desktop always, and on tablets when a hardware keyboard is attached (`Platform.isTablet && hasPhysicalKeyboard()`); phones are excluded even with a keyboard. There is no swipe gesture in the viewer on any platform.

`hasPhysicalKeyboard()` is a local accessor, not a `Platform` property — see its doc comment in `image-viewer.ts` for why module augmentation cannot reach it, and why it can only ever widen the mobile case.

Tablets run the **mobile** gesture backend, so `desktopResetTransform` is null. `resetZoom()` therefore also calls `mobileResetTransform()`, exposed from the mobile gesture closure, to zero `scale`/`panX`/`panY` and cancel momentum — otherwise a navigated image would inherit the previous zoom. Bounds need no extra handling: `mobileLoadHandler` already recomputes `imgWidth`/`imgHeight`/`maxScale` on every load, src swaps included.

### The navigable set

`setViewerImageSet(embedEl, urls)` registers what the viewer may step through, keyed in a module-scope `WeakMap` by the `.dynamic-views-image-embed` element — the same element `handleImageViewerTrigger` receives as `e.currentTarget`. DOM-keyed, so entries are collected when cards unmount; there is no explicit cleanup.

Two render sites in `shared-renderer.ts` populate it, both with the already-capped arrays:

| Site | Array | Cap |
|---|---|---|
| `renderSlideshow` | `imageUrls` (already `slideshowUrls`) | `MAX_MULTI_IMAGES` |
| `renderImage` | `scrubUrls`, when non-null | `MAX_MULTI_IMAGES` |

`scrubUrls` is capped and gated by the caller — thumbnails check their own scrubbing setting, covers check the navigation mode — so `renderImage` needs no extra condition. Every other format — Slide-mode covers aside, plus posters, backdrops, single-image thumbnails and single-image covers — registers nothing, and the viewer is inert there.

**The viewer steps a snapshot, not the live array.** The `WeakMap` stores the array the renderer passed, by reference; the copy is taken in `openImageViewer` (`viewerImageSets.get(embedEl)?.slice()`). Taking it at open rather than at registration is both cheaper — cards whose viewer never opens pay for no copy — and better ordered, since URLs at indices 1+ are validated only on hover or first touch and the broken ones are spliced out of this very array before the copy is made. Both source arrays are spliced in place by the card's broken-URL recovery while the viewer may be open (`createPreloadBrokenHandler` for slideshows, the `tryNextImage` and `nextImg` error handlers for scrubbable covers and thumbnails). Holding the live array would silently shift `currentIndex` mid-session and could shrink the set below the `length > 1` gate evaluated at open. Broken entries are still skipped — via the global `brokenImageUrls`, not via array mutation.

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

**The two levels have different ownership, and that asymmetry is load-bearing.** `viewerCleanupFns` and `viewerClones` are per-renderer instance fields — one pair per card view. `viewerListenerCleanups` and `openViewerClosers` are module-scope and shared by every view in every window. `cleanupAllViewers()` receives only one view's maps, so it must **prune the module-scope maps per clone**, never clear them: clearing tears down a viewer still open in a different view, popping its keymap scope and dropping its closer while its clone stays mounted. That leaves an overlay with every close path dead at once — Escape, the backdrop, the close button and `closeAllViewers()` — and the source card unreachable underneath it.

### Error rollback

`openImageViewer()` wraps listener setup in try-catch. On failure, cleanup runs in reverse order: gesture → listeners → observers → DOM removal. Prevents orphaned clones.

Two mutations happen *before* the try block — the body zoom class, and `viewer-active` on the source card, set by the trigger. Every exit that leaves without a viewer must roll both back, or the body class suppresses card focus rings for the rest of the session and the card keeps hover deactivation suppressed. `abandonViewerOpen()` is that rollback, shared by the catch block and by both early returns.

### Module-scope maps

- **`viewerListenerCleanups`**: Keyboard/click/touch listener cleanup. Pruned per clone by `cleanupAllViewers()`.
- **`openViewerClosers`**: One closer per open viewer, keyed by clone. Backs the exported `closeAllViewers()`, which `main.ts` calls instead of stripping `is-zoomed`. Also backs `hasOpenViewer()`, which lets `keyboard-nav.ts` skip a document-wide `.is-zoomed` query on every arrow keypress — sound because the clone is the only element that ever carries that class, so an empty map means the query would have found nothing in any document.
- **`viewerCursorPositions`**: Last pointer position over each overlay, `WeakMap`-keyed by the source embed. Read on close to decide hover-intent restore and scrub resume.

The wheel listener needs no map: it is removed inside `desktopCleanup`, which closes over both the handler and the container, with the same `WHEEL_OPTIONS` object used to add it.

Because these maps are module-scope, a probe that removes a clone with `el.remove()` strands every entry keyed to it, and the trigger then treats the viewer as still open — the next click silently does nothing. Close viewers the way the app does.

## Close behavior

`closeImageViewer()` handles two post-close restorations:

- **Hover intent**: Restores `.interact` and `.interact-hover` on the original card to work around an Electron hit-testing issue where `:hover` and `mouseenter` are unreliable after clone overlay removal. The `restoreHoverIntent` parameter (default `true`) is `false` when a new viewer pre-empts the current one. When the cursor is outside the card both classes are removed instead — the `pointerleave` that would normally clear them already fired under the overlay and will not fire again, and a stranded `.interact-hover` holds the image zoom open.
- **Scrub resume**: Tracks cursor position in the `viewerCursorPositions` `WeakMap` (set by a `mousemove` listener on the overlay during open). On close, dispatches a synthetic `pointermove` to resume scrubbing if the cursor is still over a multi-image cover or thumbnail, and a `pointerleave` if it is out of bounds. Both must be `PointerEvent`s carrying `pointerType: 'mouse'` — the scrub handlers bind `pointermove`/`pointerleave` and gate on `isHoverPointer`, so a `MouseEvent` reaches no listener and fails silently.

## Key types

```typescript
type CloneElement = HTMLElement & { __originalEmbed?: HTMLElement };
```

Stores reference to the original embed element for O(1) cleanup lookup and leaf detection.

```typescript
interface ViewerGestureControls {
  cleanup: () => void;
  resetZoom: () => void;
  ensureGestures: () => void;
}
```

Returned by `setupImageViewerGestures()`. `resetZoom` and `ensureGestures` are called only from arrow navigation, which is desktop-only plus keyboard-equipped tablets.

The navigable set is a bare `string[]`, registered by `setViewerImageSet()` from the renderer. It carried a `format` discriminator until the two per-format looping settings it selected between were removed; navigation now always wraps. See [Arrow navigation](#arrow-navigation).

## Invariants

1. **At most one viewer open at a time.** `openImageViewer()` closes all others first.
2. **`CloneElement.__originalEmbed` always points to source.** Used for cleanup lookup and leaf detection.
3. **Gesture controls and listeners always cleaned up together.** `viewerCleanupFns` and `viewerListenerCleanups` deletion happens in pairs.
4. **Image load must be awaited before gesture attachment.** Checks `imgEl.complete && imgEl.naturalWidth > 0` (catches broken images where `complete` is true but decode failed); otherwise waits for `load` event.
5. **Touch identifier matching is required.** Mobile handler tracks `prevTouch1/2` by `identifier` to distinguish finger lifts from new touches.
6. **Momentum animation frame must be canceled on all paths.** `mobileAnimFrame` canceled on cleanup, new touch start, and scale <= 1.
7. **Modals take keys, not the viewer's existence.** A modal's parentless keymap scope shadows the viewer's, so the viewer stays open behind it and the first Escape closes only the modal. There is no DOM observation and no coupling in either direction — the earlier MutationObserver that closed fullscreen viewers on modal open was a plugin invention with no native counterpart, and it left constrained viewers permanently behind a class it never removed.
8. **Desktop focus management.** Clone gets `tabindex="-1"` and focus. Capture-phase pointerdown re-focuses on tab switch. No focus on mobile (prevents keyboard interference).
9. **The viewer's image set is a snapshot.** Indices stay valid for the viewer's lifetime even as the card splices broken URLs out of its own arrays.
10. **At most one pending navigation error listener.** Each step clears `pendingNavError` before arming the next; cleanup removes whatever remains.
11. **`imgEl.src` is never the image's address.** It is a `blob:` URL for any external image, both after the viewer's own swap at open and, for a scrubbed or stepped card, before it. Read `currentRawUrl`.
12. **Module-scope registries are pruned per clone, never cleared.** They are shared across every card view; clearing them from one view's teardown strands another view's open viewer with no close path.
13. **Every exit without a viewer rolls back the body class and `viewer-active`.** Early returns and the setup catch share `abandonViewerOpen()`.
14. **The YouTube resolution upgrade runs on every index change, never only at open.** Applying it once lets one arrow round trip revert the image permanently, because `showIndex` re-reads the card's raw URLs.
