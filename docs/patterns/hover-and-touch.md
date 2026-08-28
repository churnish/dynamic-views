---
title: Hover and touch interactions
description: Complete inventory of all hover and touch interactions, their gating mechanism, pointer type support, and CSS/JS implementation — reference for adding, modifying, or debugging hover/touch behavior.
author: Generated with Claude Code
updated: 2026-08-28
---
# Hover and touch interactions

See also: [`odkb/webkit-compositor-constraints.md`](https://github.com/churnish/odkb/blob/main/webkit-compositor-constraints.md)

Complete inventory of all hover and touch interactions in Dynamic Views — what each does, which pointer types trigger it, and where the gating lives. Use this when adding new hover/touch behavior, debugging interaction on a specific device, or planning pointer support changes.

## Gating architecture

Two mechanisms — JS `canHover()` and CSS `@media (any-hover: hover)`.

Both use `any-hover` to include pen-capable devices.

```
canHover(el?)                        <- JS gate: matchMedia('(any-hover: hover)')
    |
    +- setupHoverIntent()            <- pointer events + isHoverPointer() filter
    |   +- setInteractSource(el, 'hover', ...)
    |       +- .interact-hover       <- source flag (hover input only)
    |       +- .interact             <- derived union
    |
    +- enableScrubbing               <- render-time boolean
    |   +- onPointerEnter/Move/Leave + isHoverPointer() filter
    |
    +- canPrimaryHover(el?)          <- matchMedia('(hover: hover)') -- mouse/trackpad only
        +- setupHoverIntent()
            +- .poster-hover-active  <- class on card (too transient for pen)
```

```
setupTouchPress()                    <- pointer events, isTouchPointer() filter
+- setInteractSource(el, 'press', ...)
    +- .interact-press              <- source flag
    +- .interact                    <- derived union (never .interact-hover)
```

```
@media (any-hover: hover)         <- CSS gate: cursor gating, slideshow, non-card UI
    +- .interact scoped            <- compound selector (JS class + browser state)
```

## `.interact` and its source classes

`.interact` means "the user is engaging this card". Three independent interactions can say so, and each owns a flag class:

| Source | Flag class | Set by |
| --- | --- | --- |
| `'hover'` | `.interact-hover` | `setupHoverIntent` (`shared-renderer.ts`), the image viewer close, released by `drag.ts` |
| `'press'` | `.interact-press` | `setupTouchPress` (`shared-renderer.ts`) |
| `'reveal'` | `.interact-reveal` | `handlePosterTapReveal` (`poster.ts`) |

`.interact` is **derived** — it is the union of the three flags, recomputed by `setInteractSource(el, source, active)` in `hover-and-touch.ts`. Nothing writes `.interact` directly.

### Why the union exists

The sources run concurrently. A tablet with a trackpad wires hover intent *and* touch press to the same card, so a finger tap and a stationary trackpad pointer can hold it at once. When each source wrote `.interact` itself, every exit was unconditional: the tap's release stripped the class while the pointer still hovered, and the card could not recover — `setupHoverIntent`'s `hasMoved` latch only re-arms on a `pointerleave`/`pointerenter` round trip, so only leaving and re-entering the card fixed it.

Deriving `.interact` from the flags makes each exit answer for its own source only.

`.interact-restore` is **not** a source. It sets `transition: none` and is added and removed around a forced reflow inside one synchronous block in `closeImageViewer` — a transition suppressor, nothing more.

The image viewer is not a source either. `viewer-active` makes the hover-intent and poster-hover deactivations in `shared-renderer.ts` early-return, so the real `pointerleave` is swallowed under the overlay and never fires again; the viewer's close is standing in for that missing exit, and it moves the **hover** source only.

### `.interact` vs `.interact-hover` in CSS

| | `.interact` | `.interact-hover` |
| --- | --- | --- |
| Set by `setupHoverIntent` | Yes (via the union) | Yes |
| Set by `setupTouchPress` | Yes (via the union) | **No** |
| Meaning | Hover OR touch press OR poster reveal | Hover input only (mouse, trackpad, pen in hover range) |
| Gates | Hover colors, card background, elevation, cursors, slideshow arrows | Cover, poster and backdrop image zoom |

`interact-hover` is always a subset of `interact` — nothing sets it alone. Selectors that should answer both a mouse and a finger keep using `interact`; only effects that must never fire from a finger use `interact-hover`. The same split applies to JS reads: `hasInteractSource(el, 'hover')` answers for the hover source alone, which is what the slideshow wheel guard needs — reading the union would let a finger press unlock a trackpad gesture.

### Why `interact-hover` exists

Image zoom on a touch press looks like a glitch, but no device-level test can suppress it. `@media (any-hover: hover)` and `Platform.isMobile` describe the *device*, and an iPad with a trackpad is simultaneously hover-capable and touch-capable — a device test either kills the zoom for the trackpad or keeps it for the finger.

The correct predicate is the input that produced the event, and `setupHoverIntent` already applies it: every listener is filtered through `isHoverPointer()`, which rejects touch and pressured pen. `interact-hover` simply publishes that filter's verdict as a class the CSS can read. On the same iPad, a trackpad move zooms and a finger press does not.

### Write sites

Every one of these goes through `setInteractSource`. A stranded `interact-hover` holds a card zoomed after the pointer has gone, so the hover source needs an exit on every path where `pointerleave` will not arrive:

| Site | Source | What it does |
| --- | --- | --- |
| `shared-renderer.ts` hover intent activate/deactivate | `hover` | Claims on the first `pointermove`, releases on `pointerleave` (after the `viewer-active` early return) |
| `shared-renderer.ts` touch press activate/deactivate | `press` | Claims on `pointerdown`, releases after the min-visible window |
| `poster.ts` `handlePosterTapReveal` | `reveal` | Claims on the revealing tap, releases on the dismissing tap and when another card takes the reveal |
| `image-viewer.ts` close, cursor over card | `hover` | Re-claims — standing in for the `pointerenter` the overlay ate. Hover only, never press or reveal |
| `image-viewer.ts` close, cursor outside card | `hover` | Releases — `pointerleave` already fired under the overlay and will not fire again |
| `drag.ts` card, tag and property-link dragstart | `hover` | Releases on dragstart — a drag captures the pointer, so no `pointerleave` arrives |
| `drag.ts` URL button dragstart | `hover` | Releases synchronously (`poster-hover-active` stays deferred) |

The viewer close is gated on `canHover(embedEl)`, not on `Platform` — a tablet with a trackpad is `Platform.isMobile` **and** hover-capable, and gating on the platform left exactly those devices holding state with no path out of it.

`setupTouchPress` and `handlePosterTapReveal` never touch the hover source. Releasing it from a tap would snap the zoom off mid-hover on a hybrid device, and `setupHoverIntent`'s `hasMoved` latch would not re-arm until the pointer left and re-entered.

## Pointer type support

`isHoverPointer(e)` in `hover-and-touch.ts` filters pointer events:


| `pointerType`        | Accepted | Why                                      |
| -------------------- | -------- | ---------------------------------------- |
| `mouse`              | Yes      | Mouse/trackpad always hovers             |
| `pen` (pressure 0)   | Yes      | Pen in hover range (not touching screen) |
| `pen` (pressure > 0) | No       | Pen contact = tap/draw, not hover        |
| `touch`              | No       | Finger has no hover state                |


`isTouchPointer(e)` in `hover-and-touch.ts` filters for touch press:


| `pointerType` | Accepted | Why                                 |
| ------------- | -------- | ----------------------------------- |
| `touch`       | Yes      | Finger press = touch interaction    |
| `pen`         | No       | Pen has hover, uses hover path      |
| `mouse`       | No       | Mouse uses hover path               |


Pressure is only checked for `pen` — mouse and touch are filtered by `pointerType` alone.

## Device behavior matrix


| Device                            | `canHover()` | Hover styles parsed | Hover activates    | Touch press |
| --------------------------------- | ------------ | ------------------- | ------------------ | ----------- |
| Desktop (mouse/trackpad)          | Yes          | Yes                 | Yes (mouse)        | --          |
| iPad + Magic Keyboard             | Yes          | Yes                 | Yes (trackpad)     | Yes         |
| iPad + Apple Pencil (no trackpad) | Yes          | Yes                 | Yes (pen hover)    | Yes         |
| iPad + both                       | Yes          | Yes                 | Yes (trackpad+pen) | Yes         |
| iPad (touch only)                 | No           | No                  | No                 | Yes         |
| iPhone (touch only)               | No           | No                  | No                 | Yes         |
| Android + S Pen                   | Yes          | Yes                 | Yes (pen hover)    | Yes         |
| Android (touch only)              | No           | No                  | No                 | Yes         |


## Interaction inventory


| Interaction                                                                | Pointer (mouse/trackpad)                          | Pen (hover)                                          | Touch (press)                         |
| -------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------- | ------------------------------------- |
| **Card hover/touch intent** -- `.interact` class, gates all card effects   | `setupHoverIntent` via `canHover`                 | `setupHoverIntent` via `canHover` + `isHoverPointer` | `setupTouchPress` via `isTouchPointer` |
| **Card hover-input intent** -- `.interact-hover` class, gates image zoom    | `setupHoverIntent` via `canHover`                 | `setupHoverIntent` via `canHover` + `isHoverPointer` | -- (never set by touch)               |
| **Title hover color** (open-on-title)                                      | CSS `.interact .card-title a:is(:hover, :active)` | Same (class set by pen hover)                        | `.interact` + `:active`              |
| **Title hover color** (open-on-card)                                       | CSS `.interact .card-title`                        | Same                                                 | `.interact`                          |
| **File path segment hover color** (subtitle + property values)             | CSS `.interact` scoped                            | Same                                                 | `.interact`                          |
| **Poster title hover color**                                               | CSS `.has-poster:is(:hover, .interact) .card-title` | Same                                                | `.interact`                          |
| **Card background hover** (flat/subtle/strong/strengthen/weaken/custom) | CSS `.interact`                                    | Same                                                 | `.interact`                          |
| **Card elevation + enlarge** (scale/translate)                             | CSS `.interact`                                    | Same                                                 | `.interact`                          |
| **Card border/shadow hover**                                               | CSS `.interact` scoped                            | Same                                                 | `.interact`                          |
| **Cover hover zoom**                                                       | CSS `.interact-hover` scoped                      | Same                                                 | --                                   |
| **Backdrop hover zoom**                                                    | CSS `.interact-hover` scoped                      | Same                                                 | --                                   |
| **Poster image zoom**                                                      | CSS `.interact-hover` scoped                      | Same                                                 | -- (tap-to-reveal uses `.poster-revealed`) |
| **Tag hover colors**                                                       | CSS `.interact .tag:is(:hover, :active)`          | Same                                                 | `.interact` + `:active`             |
| **Property link hover**                                                    | CSS `.interact .property a:is(:hover, :active)`   | Same                                                 | `.interact` + `:active`             |
| **URL button hover bg** (in header, no image behind it)                     | CSS `.card.interact-hover .card-title-url-icon:is(:hover, :active)` | Same                                | -- (never set by touch)             |
| **URL button hover bg** (over a cover, poster or backdrop)                  | CSS `.interact` scoped, one arm per image format  | Same                                                 | `.interact` + `:active`             |
| **Title underline** (open-on-title)                                        | CSS `.interact .card-title a:is(:hover, :active)` in `@media (any-hover: hover)` | Same                                    | -- (touch gets `:active` opacity)   |
| **Title link press opacity** (open-on-title)                               | CSS `.card-title a:active` (brief flash on click)  | Same                                                 | CSS `.card-title a:active` (sustained on press) |
| **Pointer cursor gating**                                                  | CSS `.interact` scoped (hover-only)               | Same                                                 | --                                   |
| **Poster content scroll** -- `overflow-y: auto` on hover                   | CSS `.poster-hover-active` via `canPrimaryHover`  | No (tap-to-reveal)                                   | --                                   |
| **Poster overlay reveal**                                                  | CSS `.poster-hover-active` via `canPrimaryHover`  | No (tap-to-reveal)                                   | --                                   |
| **Poster content display reveal**                                          | CSS `.poster-hover-active` via `canPrimaryHover`  | No (tap-to-reveal)                                   | --                                   |
| **Slideshow nav arrow reveal**                                             | CSS `.interact` scoped (hover-only)               | Same                                                 | --                                   |
| **Theme image dim suppression** -- opacity to 1                            | CSS `.interact` class (no media query)            | Same                                                 | `.interact`                          |
| **Cover/thumbnail scrubbing** (hover)                                      | `onPointerMove` + `isHoverPointer`                | Same                                                 | --                                   |
| **Cover/thumbnail scrubbing** (touch)                                      | --                                                 | --                                                    | `.scrub-hover` (horizontal swipe > 10px) |
| **Slideshow wheel gesture guard**                                          | `requiresHoverIntent` flag via `canHover`         | Same                                                 | --                                   |
| **Image preload on hover** (slideshow + scrubbing images)                  | `setupHoverIntent` (no `canHover` gate)           | Same                                                 | --                                   |
| **Hover state restore after closing image viewer**                         | Re-claims the `hover` source on dismiss           | Same                                                 | --                                   |
| **Drag hover cleanup** -- releases the `hover` source and strips `.poster-hover-active` on drag start | Reactive cleanup (not a gate)   | Same                                                 | --                                   |
| **Keyboard nav activation** -- hover-to-start                              | `setupHoverIntent` via `canHover`                 | Same                                                 | --                                   |
| **Card container z-index stacking** -- `.has-hover-card`                   | `setupHoverIntent` (Bases only)                   | Same                                                 | `setupTouchPress` (Bases only)       |
| **Non-card UI hovers** (plugin settings)                                   | CSS bare `:hover` in `@media (any-hover: hover)`  | CSS `:hover` fires for pen proximity                 | system `:active`                     |


## JS call sites


| File                 | What                                    | Gate                                     |
| -------------------- | --------------------------------------- | ---------------------------------------- |
| `shared-renderer.ts` | Card hover intent (Bases)               | `canHover(cardEl)`                       |
| `shared-renderer.ts` | Card touch press (Bases)                | Always (pointer events filter internally)|
| `hover-and-touch.ts` | Card touch press suppression on a swipe surface | `closest(SWIPE_SURFACE_SELECTOR)` -- `.card-thumbnail.multi-image, .card-cover.multi-image, .card-cover-slideshow` |
| `shared-renderer.ts` | Poster hover intent (Bases)             | `canHover(cardEl)`                       |
| `shared-renderer.ts` | Scrubbing gate, covers + thumbnails (Bases) | No gate (multi-image + setting/mode)  |
| `shared-renderer.ts` | Hover scrub handlers (Bases)            | `isHoverPointer(e)`                      |
| `multi-image-nav.ts` | Touch scrub handlers (shared)           | `isTouchPointer(e)`                      |
| `multi-image-nav.ts` | Scrub visibility reset IO (shared)      | Shared per-window IO via `getOwnerWindow`|
| `slideshow.ts`       | Wheel gesture hover guard               | `canHover(coverEl)` + `hasInteractSource(cardEl, 'hover')` |
| `slideshow.ts`       | Image preload on hover                  | No gate (benign on touch)                |


## CSS files with `@media (any-hover: hover)`


| File                          | Scope                                                            |
| ----------------------------- | ---------------------------------------------------------------- |
| `_hover-and-touch.scss`       | Cursor gating (card-level effects are unwrapped)                 |
| `_tags.scss`                  | List tag hover (card tag hover unwrapped)                        |
| `_properties.scss`            | List/heading segment hover (card hover unwrapped)                |
| `_utilities.scss`             | Embed block hover (suppresses box-shadow + edit button) |
| `card/_core.scss`             | (Card border/shadow hover unwrapped)                             |
| `card/_header.scss`           | Title underline (open-on-title)                                  |
| `card/_url-button.scss`       | URL button pointer-events gating, drag suppression (the hover background is unwrapped, keyed on `.interact-hover`) |
| `card/_cover-elements.scss`   | Cover hover zoom transition (trigger unwrapped)                  |
| `card/_backdrop.scss`         | Backdrop hover zoom transition (trigger unwrapped)               |
| `card/_previews.scss`         | Scrub indicator hide                                             |
| `card/_poster.scss`           | Content scroll, overlay reveal, content display, will-change     |
| `card/_slideshow.scss`        | Nav arrows, cover image transition, hover zoom cancel (the multi-image icon hide is unwrapped, keyed on `.interact-hover`) |



## Adding a new hover/touch interaction

1. **Card-scoped (hover + touch)**: Place CSS OUTSIDE `@media (any-hover: hover)`. Use `.interact` as the card-level gate. For child elements, use `:is(:hover, :active)` to cover both hover and touch press.
2. **Card-scoped (hover only, by device)**: Place CSS inside `@media (any-hover: hover)`. Use `.interact` as part of the selector. Keep cursor gating, slideshow arrows, and other hover-only features here.
3. **Card-scoped (hover only, by input)**: Use `.interact-hover` with no media query, for effects that must never fire from a finger on a device that also has a trackpad or pen. Keep the transition and `will-change` declarations OUTSIDE that gate — transitions are bidirectional, and one that exists only while the class is present animates in and snaps out.
4. **Non-card UI**: Add CSS inside `@media (any-hover: hover)` with bare `:hover`. No JS changes needed.
5. **JS-gated behavior**: Check `canHover(el)` before attaching hover listeners. Use `isHoverPointer(e)` inside pointer event handlers to filter touch and pen contact.
6. **New pointer event listeners**: Use `pointerenter`/`pointermove`/`pointerleave` -- never `mouseenter`/`mousemove`/`mouseleave`.
7. **Touch press feedback**: Touch press is handled automatically by `setupTouchPress()`, which claims and releases the `press` source on `pointerdown`/`pointerup`. No per-interaction JS is needed -- just ensure the CSS responds to `.interact`.
8. **A new source of `.interact`**: Add it to `InteractSource` in `hover-and-touch.ts` and write it through `setInteractSource()`. NEVER add or remove `.interact` directly -- an unconditional write strips the class while another source still holds it, and hover intent cannot re-arm without a pointer round trip.
