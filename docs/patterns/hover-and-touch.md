---

## description: Complete inventory of all hover and touch interactions, their gating mechanism, pointer type support, and CSS/JS implementation — reference for adding, modifying, or debugging hover/touch behavior.

author: Generated with Claude Code
updated: 2026-04-05

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
    |   +- .interact                 <- class on card
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
+- .interact                        <- class on card (shared with hover)
```

```
@media (any-hover: hover)         <- CSS gate: cursor gating, slideshow, non-card UI
    +- .interact scoped            <- compound selector (JS class + browser state)
```

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
| **Title hover color** (open-on-title)                                      | CSS `.interact .card-title a:is(:hover, :active)` | Same (class set by pen hover)                        | `.interact` + `:active`              |
| **Title hover color** (open-on-card)                                       | CSS `.interact .card-title`                        | Same                                                 | `.interact`                          |
| **File path segment hover color** (subtitle + property values)             | CSS `.interact` scoped                            | Same                                                 | `.interact`                          |
| **Poster title hover color**                                               | CSS `.has-poster:is(:hover, .interact) .card-title` | Same                                                | `.interact`                          |
| **Card background hover** (flat/subtle/strong/strengthen/weaken/custom) | CSS `.interact`                                    | Same                                                 | `.interact`                          |
| **Card elevation + enlarge** (scale/translate)                             | CSS `.interact`                                    | Same                                                 | `.interact`                          |
| **Card border/shadow hover**                                               | CSS `.interact` scoped                            | Same                                                 | `.interact`                          |
| **Cover hover zoom**                                                       | CSS `.interact` scoped                            | Same                                                 | `.interact`                          |
| **Backdrop hover zoom**                                                    | CSS `.interact` scoped                            | Same                                                 | `.interact`                          |
| **Poster image zoom**                                                      | CSS `.interact` scoped                            | Same                                                 | `.interact`                          |
| **Tag hover colors**                                                       | CSS `.interact .tag:is(:hover, :active)`          | Same                                                 | `.interact` + `:active`             |
| **Property link hover**                                                    | CSS `.interact .property a:is(:hover, :active)`   | Same                                                 | `.interact` + `:active`             |
| **URL icon hover bg**                                                      | CSS `.interact .card-title-url-icon:is(:hover, :active)` | Same                                           | `.interact` + `:active`             |
| **Title underline** (open-on-title)                                        | CSS `.interact .card-title a:is(:hover, :active)` in `@media (any-hover: hover)` | Same                                    | -- (touch gets `:active` opacity)   |
| **Title link press opacity** (open-on-title)                               | CSS `.card-title a:active` (brief flash on click)  | Same                                                 | CSS `.card-title a:active` (sustained on press) |
| **Pointer cursor gating**                                                  | CSS `.interact` scoped (hover-only)               | Same                                                 | --                                   |
| **Poster content scroll** -- `overflow-y: auto` on hover                   | CSS `.poster-hover-active` via `canPrimaryHover`  | No (tap-to-reveal)                                   | --                                   |
| **Poster overlay reveal**                                                  | CSS `.poster-hover-active` via `canPrimaryHover`  | No (tap-to-reveal)                                   | --                                   |
| **Poster content display reveal**                                          | CSS `.poster-hover-active` via `canPrimaryHover`  | No (tap-to-reveal)                                   | --                                   |
| **Slideshow nav arrow reveal**                                             | CSS `.interact` scoped (hover-only)               | Same                                                 | --                                   |
| **Theme image dim suppression** -- opacity to 1                            | CSS `.interact` class (no media query)            | Same                                                 | `.interact`                          |
| **Thumbnail scrubbing** (hover)                                            | `onPointerMove` + `isHoverPointer`                | Same                                                 | --                                   |
| **Thumbnail scrubbing** (touch)                                            | --                                                 | --                                                    | `.scrub-hover` (horizontal swipe > 10px) |
| **Slideshow wheel gesture guard**                                          | `requiresHoverIntent` flag via `canHover`         | Same                                                 | --                                   |
| **Image preload on hover** (slideshow + scrubbing images)                  | `setupHoverIntent` (no `canHover` gate)           | Same                                                 | --                                   |
| **Hover state restore after closing image viewer**                         | Re-adds `.interact` on dismiss                    | Same                                                 | --                                   |
| **Drag hover cleanup** -- strips hover classes on drag start               | Reactive cleanup (not a gate)                     | Same                                                 | --                                   |
| **Keyboard nav activation** -- hover-to-start                              | `setupHoverIntent` via `canHover`                 | Same                                                 | --                                   |
| **Card container z-index stacking** -- `.has-hover-card`                   | `setupHoverIntent` (Bases only)                   | Same                                                 | `setupTouchPress` (Bases only)       |
| **Non-card UI hovers** (plugin settings)                                   | CSS bare `:hover` in `@media (any-hover: hover)`  | CSS `:hover` fires for pen proximity                 | system `:active`                     |


## JS call sites


| File                 | What                                    | Gate                                     |
| -------------------- | --------------------------------------- | ---------------------------------------- |
| `shared-renderer.ts` | Card hover intent (Bases)               | `canHover(cardEl)`                       |
| `shared-renderer.ts` | Card touch press (Bases)                | Always (pointer events filter internally)|
| `shared-renderer.ts` | Poster hover intent (Bases)             | `canHover(cardEl)`                       |
| `shared-renderer.ts` | Thumbnail scrubbing gate (Bases)        | No gate (multi-image + setting)          |
| `shared-renderer.ts` | Thumbnail hover scrub handlers (Bases)  | `isHoverPointer(e)`                      |
| `thumbnail-scrub.ts` | Thumbnail touch scrub handlers (shared) | `isTouchPointer(e)`                      |
| `thumbnail-scrub.ts` | Thumbnail visibility reset IO (shared)  | Shared per-window IO via `getOwnerWindow`|
| `slideshow.ts`       | Wheel gesture hover guard               | `canHover(coverEl)`                      |
| `slideshow.ts`       | Image preload on hover                  | No gate (benign on touch)                |


## CSS files with `@media (any-hover: hover)`


| File                          | Scope                                                            |
| ----------------------------- | ---------------------------------------------------------------- |
| `_hover-and-touch.scss`       | Cursor gating (card-level effects are unwrapped)                 |
| `_tags.scss`                  | List tag hover (card tag hover unwrapped)                        |
| `_properties.scss`            | List/heading segment hover (card hover unwrapped)                |
| `_plugin-settings.scss`       | Plugin settings tab hover                                        |
| `_utilities.scss`             | Embed block hover (suppresses box-shadow + edit button) |
| `card/_core.scss`             | (Card border/shadow hover unwrapped)                             |
| `card/_header.scss`           | URL icon pointer-events gating, drag suppression                 |
| `card/_cover-elements.scss`   | Cover hover zoom transition (trigger unwrapped)                  |
| `card/_backdrop.scss`         | Backdrop hover zoom transition (trigger unwrapped)               |
| `card/_poster.scss`           | Content scroll, overlay reveal, content display, will-change     |
| `card/_slideshow.scss`        | Nav arrows, boundary dimming, icon hide                          |



## Adding a new hover/touch interaction

1. **Card-scoped (hover + touch)**: Place CSS OUTSIDE `@media (any-hover: hover)`. Use `.interact` as the card-level gate. For child elements, use `:is(:hover, :active)` to cover both hover and touch press.
2. **Card-scoped (hover only)**: Place CSS inside `@media (any-hover: hover)`. Use `.interact` as part of the selector. Keep cursor gating, slideshow arrows, and other hover-only features here.
3. **Non-card UI**: Add CSS inside `@media (any-hover: hover)` with bare `:hover`. No JS changes needed.
4. **JS-gated behavior**: Check `canHover(el)` before attaching hover listeners. Use `isHoverPointer(e)` inside pointer event handlers to filter touch and pen contact.
5. **New pointer event listeners**: Use `pointerenter`/`pointermove`/`pointerleave` -- never `mouseenter`/`mousemove`/`mouseleave`.
6. **Touch press feedback**: Touch press is handled automatically by `setupTouchPress()` which adds/removes `.interact` on `pointerdown`/`pointerup`. No per-interaction JS is needed -- just ensure the CSS responds to `.interact`.
