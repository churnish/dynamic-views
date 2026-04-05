---

## description: Complete inventory of all hover interactions, their gating mechanism, pointer type support, and CSS/JS implementation — reference for adding, modifying, or debugging hover behavior.

author: 🤖 Generated with Claude Code
updated: 2026-04-05

# Hover interactions

Complete inventory of all hover interactions in Dynamic Views — what each does, which pointer types trigger it, and where the gating lives. Use this when adding new hover behavior, debugging hover on a specific device, or planning pointer support changes.

## Gating architecture

Two mechanisms — JS `canHover()` and CSS `@media (any-hover: hover)`.

Both use `any-hover` to include pen-capable devices.

```
canHover(el?)                        ← JS gate: matchMedia('(any-hover: hover)')
    │
    ├─ setupHoverIntent()            ← pointer events + isHoverPointer() filter
    │   └─ .hover-intent-active      ← class on card
    │
    ├─ enableScrubbing               ← render-time boolean
    │   └─ onPointerEnter/Move/Leave + isHoverPointer() filter
    │
    └─ canPrimaryHover(el?)          ← matchMedia('(hover: hover)') — mouse/trackpad only
        └─ setupHoverIntent()
            └─ .poster-hover-active  ← class on card (too transient for pen)
```

```
@media (any-hover: hover)         ← CSS gate: 16 SCSS files
    └─ .hover-intent-active:hover ← compound selector (JS class + browser :hover)
```

## Pointer type support

`isHoverPointer(e)` in `hover.ts` filters pointer events:


| `pointerType`        | Accepted | Why                                      |
| -------------------- | -------- | ---------------------------------------- |
| `mouse`              | ✅        | Mouse/trackpad always hovers             |
| `pen` (pressure 0)   | ✅        | Pen in hover range (not touching screen) |
| `pen` (pressure > 0) | ❌        | Pen contact = tap/draw, not hover        |
| `touch`              | ❌        | Finger has no hover state                |


Pressure is only checked for `pen` — mouse and touch are filtered by `pointerType` alone.

## Device behavior matrix


| Device                            | `canHover()` | Hover styles parsed | Hover activates    |
| --------------------------------- | ------------ | ------------------- | ------------------ |
| Desktop (mouse/trackpad)          | ✅            | ✅                   | ✅ (mouse)          |
| iPad + Magic Keyboard             | ✅            | ✅                   | ✅ (trackpad)       |
| iPad + Apple Pencil (no trackpad) | ✅            | ✅                   | ✅ (pen hover only) |
| iPad + both                       | ✅            | ✅                   | ✅ (trackpad + pen) |
| iPad (touch only)                 | ❌            | ❌                   | ❌                  |
| iPhone (touch only)               | ❌            | ❌                   | ❌                  |
| Android + S Pen                   | ✅            | ✅                   | ✅ (pen hover only) |
| Android (touch only)              | ❌            | ❌                   | ❌                  |


## Interaction inventory


| Interaction                                                                        | Pointer (mouse/trackpad)                          | Pen (hover)                                          |
| ---------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------- |
| **Card hover intent** — `.hover-intent-active` class, gates all card hover effects | `setupHoverIntent` via `canHover`                 | `setupHoverIntent` via `canHover` + `isHoverPointer` |
| **Title hover color** (open-on-title)                                              | CSS `.hover-intent-active .card-title a:hover`    | Same (class set by pen hover)                        |
| **Title hover color** (open-on-card)                                               | CSS `.hover-intent-active:hover .card-title`      | Same                                                 |
| **File path segment hover color** (subtitle + property values)                     | CSS `.hover-intent-active` scoped                 | Same                                                 |
| **Poster title hover color**                                                       | CSS `.has-poster:hover .card-title`               | Same                                                 |
| **Card background hover** (tinted/primary/custom)                                  | CSS `.hover-intent-active:hover`                  | Same                                                 |
| **Card elevation + enlarge** (scale/translate)                                     | CSS `.hover-intent-active:hover`                  | Same                                                 |
| **Pointer cursor gating**                                                          | CSS `.hover-intent-active` scoped                 | Same                                                 |
| **Poster content scroll** — `overflow-y: auto` on hover                            | CSS `.poster-hover-active` via `canPrimaryHover`  | ❌ tap-to-reveal instead                              |
| **Poster image zoom** — `scale(1.05)`                                              | CSS `.poster-hover-active` via `canPrimaryHover`  | ❌ tap-to-reveal instead                              |
| **Poster overlay reveal**                                                          | CSS `.poster-hover-active` via `canPrimaryHover`  | ❌ tap-to-reveal instead                              |
| **Poster content display reveal**                                                  | CSS `.poster-hover-active` via `canPrimaryHover`  | ❌ tap-to-reveal instead                              |
| **Slideshow nav arrow reveal**                                                     | CSS `.hover-intent-active` scoped                 | Same                                                 |
| **Theme image dim suppression** — opacity → 1                                      | CSS `.hover-intent-active` class (no media query) | Same                                                 |
| **Cover hover zoom**                                                               | CSS `.hover-intent-active` scoped                 | Same                                                 |
| **Card border/shadow hover**                                                       | CSS `.hover-intent-active` scoped                 | Same                                                 |
| **Tag hover colors**                                                               | CSS `.hover-intent-active .tag:hover`             | Same                                                 |
| **Property link hover**                                                            | CSS `.hover-intent-active .property a:hover`      | Same                                                 |
| **Thumbnail scrubbing**                                                            | `onPointerMove` + `isHoverPointer` via `canHover` | Same                                                 |
| **Slideshow wheel gesture guard**                                                  | `requiresHoverIntent` flag via `canHover`         | Same                                                 |
| **Image preload on hover** (slideshow + scrubbing images)                          | `setupHoverIntent` (no `canHover` gate)           | Same                                                 |
| **Hover state restore after closing image viewer**                                 | Re-adds `.hover-intent-active` on dismiss         | Same                                                 |
| **Drag hover cleanup** — strips hover classes on drag start                        | Reactive cleanup (not a gate)                     | Same                                                 |
| **Keyboard nav activation** — hover-to-start                                       | `setupHoverIntent` via `canHover`                 | Same                                                 |
| **Card container z-index stacking** — `.has-hover-card`                            | `setupHoverIntent` (Bases only)                   | Same                                                 |
| **Non-card UI hovers** (Datacore toolbar/editor/settings, plugin settings)         | CSS bare `:hover` in `@media (any-hover: hover)`  | CSS `:hover` fires for pen proximity                 |


## JS call sites


| File                 | What                                    | Gate                                     |
| -------------------- | --------------------------------------- | ---------------------------------------- |
| `shared-renderer.ts` | Card hover intent (Bases)               | `canHover(cardEl)`                       |
| `shared-renderer.ts` | Poster hover intent (Bases)             | `canHover(cardEl)`                       |
| `shared-renderer.ts` | Thumbnail scrubbing gate (Bases)        | `canHover(cardEl)`                       |
| `shared-renderer.ts` | Thumbnail scrubbing handlers (Bases)    | `isHoverPointer(e)`                      |
| `card-renderer.tsx`  | Thumbnail scrubbing gate (Datacore)     | `canHover()` (no element — device-level) |
| `card-renderer.tsx`  | Card + poster hover intent (Datacore)   | `canHover(cardEl)`                       |
| `card-renderer.tsx`  | Thumbnail scrubbing handlers (Datacore) | `isHoverPointer(e)`                      |
| `slideshow.ts`       | Wheel gesture hover guard               | `canHover(coverEl)`                      |
| `slideshow.ts`       | Image preload on hover                  | No gate (benign on touch)                |


## CSS files with `@media (any-hover: hover)`


| File                          | Scope                                                            |
| ----------------------------- | ---------------------------------------------------------------- |
| `_hover-states.scss`          | Card title/subtitle/property colors, bg, elevation, cursor       |
| `_tags.scss`                  | Tag hover colors (outline/fill/plaintext variants)               |
| `_properties.scss`            | Property value hover, path segment hover                         |
| `_plugin-settings.scss`       | Plugin settings tab hover                                        |
| `_utilities.scss`             | Datacore embed block hover (suppresses box-shadow + edit button) |
| `card/_core.scss`             | Card border/shadow hover                                         |
| `card/_header.scss`           | Header hover states                                              |
| `card/_cover-elements.scss`   | Cover hover zoom                                                 |
| `card/_backdrop.scss`         | Backdrop hover effects                                           |
| `card/_poster.scss`           | Content scroll, image zoom, overlay reveal, content display      |
| `card/_slideshow.scss`        | Nav arrows, boundary dimming, indicator hide                     |
| `card/_previews.scss`         | Thumbnail scrub indicator                                        |
| `datacore/_toolbar.scss`      | Toolbar button/dropdown hovers                                   |
| `datacore/_query-editor.scss` | Query editor button hovers                                       |
| `datacore/_settings.scss`     | Settings panel hover states                                      |
| `datacore/_list-view.scss`    | List view link hover                                             |


## Adding a new hover interaction

1. **Card-scoped**: Add CSS inside an existing `@media (any-hover: hover)` block. Use `.hover-intent-active` or `.poster-hover-active` as part of the selector — never bare `:hover` on card elements.
2. **Non-card UI**: Add CSS inside `@media (any-hover: hover)` with bare `:hover`. No JS changes needed.
3. **JS-gated behavior**: Check `canHover(el)` before attaching listeners. Use `isHoverPointer(e)` inside pointer event handlers to filter touch and pen contact.
4. **New pointer event listeners**: Use `pointerenter`/`pointermove`/`pointerleave` — never `mouseenter`/`mousemove`/`mouseleave`.

