---
title: Full screen
description: Spacer + scroll anchoring (Android) and margin bridge + settle (iOS) architecture for hiding/showing bars during scroll, gradient swap mask-image management, direction detection, tap shield, and platform-specific branches.
author: 🤖 Generated with Claude Code
updated: 2026-04-07
---
# Full screen

See also: [`odkb/webkit-compositor-constraints.md`](https://github.com/churnish/odkb/blob/main/webkit-compositor-constraints.md), [`odkb/android-chromium-quirks.md`](https://github.com/churnish/odkb/blob/main/android-chromium-quirks.md)

Hides Obsidian UI bars on downward scroll in Dynamic Views card views on phone. Bar animations match native Obsidian full screen. Android uses an in-flow spacer with `overflow-anchor` for scroll-safe height changes + WAAPI animations. iOS uses a `margin-top` bridge on the scroll child to defer layout mutations to scroll-idle.

For empirical research, rejected approaches, and prototype history, see [full-screen.md](../dev/full-screen.md).

## UX requirements

Non-negotiable. Reject any implementation that violates these, regardless of technical convenience.

1. **No false top**: Scrolling up must reach the true top (`scrollTop=0`, no offset) in a single gesture. No wall, no pause, no hidden content above the pane.
2. **No false bottom**: Scrolling down must reach the true bottom. Last card and end indicator fully accessible.
3. **Atomic bar transitions**: All bar elements (header, toolbar, search row, navbar, mask-image gradient) must appear and disappear together. No delayed individual elements.
4. **No show jank**: Show transition must not produce visible jank — no white flash, no content jump, no dropped frames.
5. **No momentum kill**: Hide and show transitions must not interrupt scroll momentum on either platform.

## Files

| File | Role |
|---|---|
| `src/bases/full-screen.ts` | `FullScreenController` class + `createFullScreenController()` factory |
| `src/shared/constants.ts` | Tuning constants (`FULL_SCREEN_*`) |
| `styles/_full-screen.scss` | `full-screen-active`, `full-screen-showing` (iOS), `data-dynamic-views-show` (Android), spacer, navbar, and scrim rules |
| `tests/bases/full-screen-factory.test.ts` | Factory guard tests (missing DOM elements, mount/unmount lifecycle) |

## Debug access

Runtime path to the controller:

```js
leaf.view.controller.view.fullScreen
```

Where `leaf` is any Bases leaf from `app.workspace.iterateAllLeaves()`.

## System overview

On phone, Bases card views have a fixed header, a static toolbar (`.bases-header`), an optional search row, and a fixed navbar. Native Obsidian full screen works in Markdown views (driven by CodeMirror's internal `markdown-scroll` event) but not in Bases views — Bases does not fire that event. The plugin implements its own scroll-driven bar management.

### Bases vs Markdown constraint

Native `is-hidden-nav` handles header and navbar hide/show for both view types. But Bases views additionally require:

1. **Toolbar collapse** — `.bases-header` must be hidden (opacity + margin collapse)
2. **~99px margin-top gap fill** — `.view-content` has ~99px `margin-top` compensating for the fixed header; removing it requires layout mutation

These are layout changes (reflow) that conflict with iOS momentum scroll. Markdown views do not need them — content reflow is minimal (just header/navbar transform). The bridge architecture (iOS) and spacer architecture (Android) exist specifically to handle these mutations safely.

## DOM structure

```
.workspace-leaf-content [data-type='bases']       ← leafContent / classTarget
  .view-header                                    ← tap shield during hide
  .view-content                                   ← margin-top: ~99px
    .bases-header                                 ← toolbar
    .bases-search-row                             ← optional
    .bases-error
    .bases-view                                   ← scrollEl
      .dynamic-views-spacer                       ← Android only (in-flow)
      .dynamic-views-bases-container              ← container
```

| Zone | Element | Notes |
|---|---|---|
| **Status bar** | Safe area inset (`--safe-area-inset-top`) | `.app-container` background |
| **Header** | `.view-header` | `position: fixed` on floating-nav phones |
| **Toolbar** | `.bases-header` | Static flex sibling above scroll container |
| **Search row** | `.bases-search-row` | Optional, static flex sibling |
| **Content** | `.bases-view` | Scroll container; contains `.dynamic-views-bases-container` |
| **Navbar** | `.mobile-navbar` | `position: fixed` at bottom |

"Bars" = header + toolbar + search row + navbar (all elements that hide/show).

Additional cached references (constructor):

| Field | Selector | Purpose |
|---|---|---|
| `workspaceSplitEl` | `.workspace-split.mod-root` | Mask-image gradient swap target |
| `appContainerEl` | `.app-container` | Background inline (ancestor above leaf) |
| `workspaceEl` | `.workspace` | Background inline (ancestor above leaf) |

## State model

### Flags

| Flag | Type | Purpose |
|---|---|---|
| `mounted` | `boolean` | Whether the controller is active |
| `barsHidden` | `boolean` | Whether bars are currently hidden |
| `settled` | `boolean` | Whether deferred layout mutations have completed |
| `spacerActive` | `boolean` | Whether the Android spacer is in use (persists across hide/show) |
| `totalShiftMeasured` | `boolean` | Short-circuit for `measureTotalShift()` after first valid measurement |
| `safeAreaSettling` | `boolean` | True during orientation change debounce — suppresses show/hide decisions |
| `isActiveHider` | `boolean` | Whether this controller instance initiated the hide (prevents cross-controller cleanup) |
| `programmaticScroll` | `boolean` | Blocks scroll handler during `scrollTop` writes |
| `pendingLayout` | `(() => void) \| null` | Deferred layout mutation queued for scroll-idle |

### Key measurements

| Field | Source | Purpose |
|---|---|---|
| `totalShift` | `scrollEl.getBoundingClientRect()` delta with/without `full-screen-active` | Total pixel shift when bars hide — used for spacer height, bridge, scroll compensation |
| `originalMarginTop` | `getComputedStyle(viewContent).marginTop` | Pre-hide margin-top (~99px) — component of `totalShift` and CSS calc inputs |
| `headerShift` | `viewHeaderEl.offsetHeight` | Header height (~44px) — WAAPI transform target |
| `navbarHeight` | `navbarEl.offsetHeight` | Navbar height (~52px) — WAAPI transform target |
| `headerToContentGap` | `originalMarginTop - headerShift - safeAreaAtMount` | Constant 8px gap between header bottom and viewContent start — used in CSS `calc()` for toolbar positioning |
| `viewPadding` | `--dynamic-views-bases-view-padding` CSS variable | Scroll container padding-top (12px) — subtracted from heading sticky tops |
| `lockedScrollHeight` | `scrollEl.offsetHeight` | Locked scroll container height — prevents flex layout from resizing during transitions |

### State transitions

```
                    mount()
                      │
                      ▼
              ┌───────────────┐
              │  BARS VISIBLE  │  mounted=true, barsHidden=false
              │  (idle state)  │
              └───────┬───────┘
                      │ scroll down > HIDE_DEAD_ZONE
                      ▼
              ┌───────────────┐
              │  BARS HIDDEN   │  barsHidden=true
              │  (animating)   │
              └───────┬───────┘
                      │ idle timer fires
                      ▼
              ┌───────────────┐
              │  BARS HIDDEN   │  settled=true
              │  (settled)     │
              └───────┬───────┘
                      │ scroll up > SHOW_DEAD_ZONE
                      ▼
              ┌───────────────┐
              │  BARS SHOWING  │  barsHidden=false
              │  (animating)   │
              └───────┬───────┘
                      │
          ┌───────────┴───────────┐
          │ iOS                   │ Android
          │ idle → full cleanup   │ idle → WAAPI cancel
          │ → BARS VISIBLE        │ spacer persists
          ▼                       ▼
  ┌───────────────┐     ┌──────────────────┐
  │  BARS VISIBLE  │     │  BARS VISIBLE     │  spacerActive=true
  │  (clean)       │     │  (spacer active)  │
  └───────────────┘     └────────┬─────────┘
                                 │ scrollTop ≤ 1 at idle
                                 ▼
                        ┌──────────────────┐
                        │  commitSpacerResolve()  │
                        │  → spacer removed       │
                        │  → full-screen-active   │
                        │    removed              │
                        │  → BARS VISIBLE (clean) │
                        └──────────────────┘
```

## Factory function

`createFullScreenController()` is the entry point used by both `grid-view.ts` and `masonry-view.ts`.

```
createFullScreenController(scrollEl, containerEl, plugin, register)
  │
  ├── Find .view-content (ancestor of scrollEl)
  ├── Find .mobile-navbar (document query)
  │
  ├── If either missing → return null
  │
  ├── new FullScreenController({scrollEl, container, viewContent, navbarEl})
  │
  ├── If plugin.persistenceManager.getPluginSettings().fullScreen
  │   └── controller.mount()
  │
  ├── register(() => controller.unmount())
  │
  └── return controller
```

**Guards**: Returns `null` if `.view-content` or `.mobile-navbar` is missing (Android FUSE filesystem delays can cause `.mobile-navbar` to be absent at construction time).

## Mount / unmount lifecycle

### Mount

1. **Guard**: Requires `auto-full-screen` body class (Obsidian mobile full-screen setting). Idempotent — no-op if already mounted.
2. **Measure**: Cache `originalMarginTop`, `navbarHeight`, `headerShift`, `headerToContentGap`. Measure `totalShift` via getBoundingClientRect delta (toggle `full-screen-active` temporarily). `viewPadding` is measured lazily inside `measureTotalShift()` on first hide if mount-time GBR returned 0.
3. **Lock height**: Set inline `height` on `scrollEl` to decouple `clientHeight` from flex layout changes. Set `--dynamic-views-scroll-past-end` CSS variable for scroll-past-end padding.
4. **Pre-promote** (Android): Add `dynamic-views-navbar-animated` class on navbar (`will-change: transform, opacity`).
5. **Attach listeners**: `scroll` (passive), `touchstart`/`touchend` (passive) on scrollEl, `touchend` (non-passive) on viewHeaderEl, `resize` on window, `drop` on viewHeaderEl (blocks Obsidian `handleDrop` from opening files when tap shield intercepts native drag events). Set up `ResizeObserver` on search row for live sync during show mode (coalesced via `searchSyncRafId` rAF).

### Unmount

1. **Remove listeners**: All event listeners and ResizeObserver.
2. **Cancel timers**: `scrollIdleTimer`, `spacerResolveTimer`, `pendingRevealTimer`, `resizeTimer`, pending rAFs.
3. **Restore state**: If `isActiveHider`, remove `full-screen-active`/`full-screen-showing`, clear overlays, restore mask-image, show Capacitor status bar.
4. **Clean up DOM**: Remove spacer, unlock height, clear inline styles on container/navbar/header, remove padding class.
5. **Cancel WAAPI**: Cancel all running animations.

## Hide path

### Common preamble

`hideBarsUI()` starts by blurring the active element (`activeElement.blur()`) to dismiss the soft keyboard if the search input is focused. Also cancels any pending Capacitor status bar show rAF from a prior show (rapid show→hide).

### Android — spacer + overflow-anchor

Two cases depending on whether a spacer already exists from a previous hide/show cycle.

#### Case B: first hide (no spacer)

Two-frame approach — spacer expands in frame 1, `overflow-anchor` fires between frames, class applies in frame 2.

```
Frame 1 (synchronous):
  ├── Pin header/toolbar/search at visible position (inline styles)
  ├── ensureSpacerChrome() — insert .dynamic-views-spacer before container
  ├── programmaticScroll = true
  ├── Unlock scroll height (remove inline height)
  └── Set spacer height = totalShift
                        │
        overflow-anchor fires between frames
        (browser adjusts scrollTop to keep container anchored)
                        │
Frame 2 (rAF):
  ├── Add full-screen-active on leafContent
  ├── spacerActive = true
  ├── applyShowOverlays() — toolbar/search as absolute overlays
  ├── computeEffectiveShift() — resize spacer to effectiveShift
  ├── syncToolbarBgHeight(toolbarH, searchH) — opaque backing
  ├── applyBackgroundInlines() — body/app-container/workspace
  ├── Set opaque mask-image
  ├── programmaticScroll = false
  ├── settled = true
  ├── clearHeaderInlines()
  ├── Start hide WAAPI (header + navbar + navbar-hidden class)
  ├── Cancel old show WAAPI (after new hide WAAPI started)
  ├── clearOverlayBars() — remove absolute positioning
  ├── applyHideSpacerCover() — background color on spacer
  └── clearSpacerHeadingTops()
                        │
Idle (500ms):
  └── settleAndroidSpacerHide() — cancel WAAPI, persist navbar inlines, apply tap shield, relock height
```

#### Case A: re-hide from show mode (spacer already active)

Spacer and `full-screen-active` already in place — no layout change needed. WAAPI-fade bars out.

```
Synchronous:
  ├── Swap mask-image to opaque
  ├── programmaticScroll = true
  └── Read WAAPI "from" values from current header position

rAF:
  ├── Start hide WAAPI (header + navbar + navbar-hidden class)
  ├── Cancel old show WAAPI (after new hide started)
  ├── clearOverlayBars()
  ├── applyHideSpacerCover()
  └── clearSpacerHeadingTops()

settled = true (synchronous, after rAF queued)

Idle (500ms):
  └── settleAndroidSpacerHide() — cancel WAAPI, persist navbar inlines, apply tap shield, relock height
```

### iOS — margin bridge + deferred settle

```
Synchronous (momentum-safe):
  ├── Set opaque mask-image
  ├── Set margin-top: totalShift + transition: none on container (bridge)
  ├── Add full-screen-active on leafContent
  ├── applyBackgroundInlines()
  └── settled = false

Double-rAF:
  ├── rAF 1: Set navbar transition
  └── rAF 2: Apply navbar transform + opacity (hide)

Idle (2000ms):
  ├── programmaticScroll = true
  ├── Unlock scroll height
  ├── Remove margin-top bridge
  ├── scrollTop -= totalShift (clamped to 0)
  ├── settled = true
  ├── Add tap-shield class on header
  └── rAF: measure → relock height
```

## Show path

### Android — spacer-based show

```
Synchronous:
  ├── programmaticScroll = true
  ├── Replace tap-shield class with inline opacity:0 + transform (preserve hidden state)
  ├── Remove tap-shield class
  └── Read WAAPI "from" values (fill:forwards still active)

rAF:
  ├── clearHideSpacerCover()
  ├── applyShowOverlays() — toolbar/search as absolute overlays
  ├── computeEffectiveShift() — live toolbar + search heights
  ├── ensureSpacerChrome() + set spacer height = effectiveShift
  ├── spacerActive = true
  ├── syncToolbarBgHeight() — opaque backing behind toolbar/search
  ├── applySpacerHeadingTops() — adjust sticky heading positions
  ├── restoreMaskImage() — gradient swap
  ├── Start header show WAAPI (transform + opacity)
  ├── Cancel old hide WAAPI (after new show started)
  ├── clearHeaderInlines() + re-add header-show class + opaque header bg
  ├── Start navbar show WAAPI (transform + opacity)
  ├── clearNavbarInlines()
  ├── Start toolbar + search fade WAAPI
  └── Deferred: Capacitor status bar show (next rAF)

Idle (500ms):
  ├── If scrollTop ≤ 1 → commitSpacerResolve() (full cleanup)
  └── Else → cancelAnimations() only (spacer persists)
```

### iOS — class-based show + deferred settle

```
Synchronous:
  ├── Capacitor status bar show
  ├── clearHeaderInlines() — remove tap-shield
  ├── Add header-show class + force style recalc
  ├── Add full-screen-showing on leafContent
  ├── If !settled: remove margin-top bridge (geometric cancellation)
  ├── Navbar: clear blocking inlines, add navbar-show class
  └── restoreMaskImage()

rAF:
  └── WAAPI fade-in on toolbar + search

Idle (2000ms):
  ├── programmaticScroll = true
  ├── Remove margin-top bridge
  ├── If settled && scrollTop ≥ totalShift: scrollTop += totalShift
  ├── Unlock height
  ├── cancelAnimations()
  ├── Remove full-screen-showing
  ├── clearHeaderInlines()
  ├── Remove full-screen-active
  ├── clearBackgroundInlines()
  ├── isActiveHider = false
  ├── clearMaskImageInline()
  ├── clearNavbarInlines()
  ├── settled = false
  └── rAF: programmaticScroll = false, reset accumulatedDelta, relock height
```

## Spacer system (Android)

The spacer is an in-flow `<div>` inserted inside `scrollEl` before the container. Its height changes are absorbed by `overflow-anchor`, which adjusts `scrollTop` to keep the container (the anchor target) at the same visual position.

```
.bases-view (scrollEl)
  ├── .dynamic-views-spacer    ← overflow-anchor: none (excluded from anchor selection)
  └── .dynamic-views-bases-container  ← anchor target
```

### Lifecycle

- **`ensureSpacerChrome()`**: Creates and inserts the spacer div. Idempotent.
- **`clearSpacerChrome()`**: Removes the spacer, resets `spacerActive`.
- **`commitSpacerResolve()`**: Collapses spacer + removes `full-screen-active` in one synchronous block. Spacer removal (content moves up) is cancelled by class removal (margin + toolbar restore, scrollEl moves down). Net visual effect: zero.

### Show overlays

During show mode, toolbar and search row are positioned as `position: absolute` overlays on `leafContent` (which gets `position: relative` via `[data-dynamic-views-show]`). They cover the spacer area while fading in via WAAPI.

- **`applyShowOverlays()`**: Sets toolbar/search to absolute positioning with CSS `calc()` expressions for `top` that use live CSS variables (`--safe-area-inset-top`, `--view-header-height`, `headerToContentGap`). Creates `toolbarBgEl` — an opaque backing div (z-index 28) behind toolbar/search to prevent content showing through during the WAAPI opacity fade.
- **`clearShowOverlays()`**: Removes absolute positioning, toolbarBgEl, `data-dynamic-views-show` attribute, and heading top inlines.

### Hide spacer cover

During hide with spacer active, `applyHideSpacerCover()` gives the spacer a background color so content below isn't visible through it. The `::before` scrim (on `leafContent`, outside the scroll container) paints above the spacer naturally. `clearHideSpacerCover()` removes the background and calls `clearSpacerHeadingTops()` to remove stale heading inlines from the hide state.

### Spacer resolve

When the user scrolls to `scrollTop ≤ 1` during show mode (spacer active, bars visible), a 50ms timer (`FULL_SCREEN_SPACER_RESOLVE_DELAY_MS`) schedules `commitSpacerResolve()` for full cleanup. This is a visual no-op — the spacer height is already compensated by the margin/toolbar restoration when `full-screen-active` is removed.

### `computeEffectiveShift()`

Returns `{shift, toolbarH, searchH}` — one layout read. `shift = originalMarginTop + toolbarH + searchH`. Callers reuse the component heights to avoid redundant forced layouts (e.g., `syncToolbarBgHeight()` accepts pre-read heights).

## Heading sticky tops

When the spacer is active (Android show mode), sticky group headings need adjusted `top` values because the spacer pushes content down inside the scroll container.

- **`applySpacerHeadingTops(effectiveShift)`**: Sets inline `top` on all `.bases-group-heading:not(.collapsed)` and `.dynamic-views-sticky-sentinel` elements. Heading top = `effectiveShift - viewPadding`. Sentinel top = heading top + 1px. Uses a `:is()` compound selector for a single `querySelectorAll` pass.
- **`clearSpacerHeadingTops()`**: Removes inline `top` (and `z-index` on headings). Uses a broader selector WITHOUT `:not(.collapsed)` — clears ALL headings including collapsed ones, ensuring no stale inlines persist after collapse state changes during active spacer.

Inline styles are used instead of CSS rules to avoid violating the `[data-dynamic-views-show]` descendant combinator invariant (attribute selectors matching real descendants trigger subtree-wide style recalc on Android's single-threaded compositor).

## Tap shield

When bars are hidden, the header element is positioned as an invisible tap absorber in the status bar zone. Tapping this zone reveals bars.

### Setup

- **Android**: `dynamic-views-tap-shield` class added in `settleAndroidSpacerHide()` (fires from `pendingLayout` on 500ms scroll idle timer).
- **iOS**: `dynamic-views-tap-shield` class added in hide settle `pendingLayout` (after 2000ms idle).

### CSS effect

The class sets `transform: translateY(0) !important` (returns header from off-screen to natural position), `opacity: 0 !important` (invisible), `margin-top: 0 !important` (overrides Obsidian's safe-area margin), `z-index: 30 !important` (above `::before` scrim), and `pointer-events: auto !important`. Specificity: 0,6,0 (beats the 0,5,0 `full-screen-active` hide rules).

### Hit-testing

Chromium and WebKit hit-test `position: fixed` elements against their pre-transform layout box, not the visual rect. The header's layout box covers y=0 through ~90px regardless of any `transform`.

### Header tap handler

`onHeaderTap()` listens for `touchend` (non-passive) on `.view-header`. Uses a deferred reveal mechanism:

1. **`preventDefault()`** — suppresses click synthesis on header children.
2. **Heading forward** — temporarily lowers header `pointer-events`, hit-tests via `elementFromPoint`, forwards click to stuck group headings that straddle the tap shield zone.
3. **Deferred timer** — starts a 100ms timer (`FULL_SCREEN_REVEAL_DEFER_MS`). If `onScroll` receives a delta > 3px (`FULL_SCREEN_REVEAL_CANCEL_DELTA`) during that window, the timer is cancelled (fast momentum suppresses reveal). If no significant scroll arrives, bars show.
4. **Click-eater** — on reveal, registers a one-time capture click listener to suppress the synthesized click from the triggering touch.

## Resize handling

Orientation changes require remeasuring `totalShift`, `originalMarginTop`, `headerShift`, `navbarHeight`, and `lockedScrollHeight`.

```
onResize()
  ├── safeAreaSettling = true (suppress scroll decisions)
  ├── Cancel pending settle (stale values)
  ├── Immediate: relock scrollHeight, update headerShift/navbarHeight
  │
  ├── setTimeout 500ms:
  │   ├── safeAreaSettling = false
  │   └── remeasureAfterResize()
  │       ├── Re-measure totalShift via GBR technique
  │       ├── Re-sync spacer + overlays if active
  │       └── Re-queue cancelled settle (Android)
  │
  └── setTimeout 2500ms → remeasureAfterResize() (verification pass)
      └── CSS safe area variables can oscillate back after initial settling
```

**Toolbar positioning** uses CSS `calc()` with live CSS variables, so it needs no JS remeasure during rotation — the expressions resolve at paint time.

## Mask-image gradient swap

Both platforms use a gradient swap on `.workspace-split.mod-root` to avoid destroying the compositor render surface during transitions.

- **Constructor**: Caches Obsidian's mask-image gradient via `getComputedStyle` into `cachedMaskImage`.
- **Hide** (`hideBarsUI`): Sets `OPAQUE_MASK` — a fully-opaque gradient (`linear-gradient(rgb(0,0,0),rgb(0,0,0))`) that produces no visual masking but keeps the render surface allocated.
- **Show** (`restoreMaskImage`): Swaps back to `cachedMaskImage`. Gradient-to-gradient swap — compositor updates the mask texture without recreating the surface. Safe during momentum scroll.
- **Cleanup** (`clearMaskImageInline`): Fully removes the inline properties. Structural compositor change — only safe when not scroll-concurrent. Called from: unmount, iOS show idle, `commitSpacerResolve()` (Android), and as fallback inside `restoreMaskImage()` when no cached gradient exists.

Without the gradient swap, removing mask-image (`none` → CSS gradient) destroys and recreates the ~66MB render surface, forcing full subtree rasterization.

## CSS state classes

### On `leafContent` (`[data-type='bases']`)

| Class / Attribute | Platform | When applied | When removed | Effect |
|---|---|---|---|---|
| `full-screen-active` | Both | `hideBarsUI()` | iOS: show idle. Android: `commitSpacerResolve()` or unmount | Hides header/toolbar/search, collapses margins |
| `full-screen-showing` | iOS only | `showBarsUI()` | Show idle | Higher-specificity overrides to restore bars |
| `data-dynamic-views-show` | Android only | `applyShowOverlays()` | `clearShowOverlays()` | Containing block for overlays, scrim/gradient CSS |
| `dynamic-views-grouped` | Both | Grid/masonry view (grouped) | View change | Grouped scrim variant (opaque, z-index 25) |

### On `.view-header`

| Class | When applied | When removed | Effect |
|---|---|---|---|
| `dynamic-views-tap-shield` | After hide settle | Before show WAAPI / show idle | Invisible tap absorber at natural position |
| `dynamic-views-header-show` | Show path | `clearBarInlines()` / `clearHeaderInlines()` | `z-index: 30`, `min-height: 0` (collapses tap shield), `pointer-events: auto` |

### On `.mobile-navbar`

| Class | Platform | When applied | When removed | Effect |
|---|---|---|---|---|
| `dynamic-views-navbar-animated` | Android | Mount | Unmount | `will-change: transform, opacity` (layer pre-promotion) |
| `dynamic-views-navbar-hidden` | Android | Hide rAF | `clearNavbarInlines()` | `pointer-events: none` |
| `dynamic-views-navbar-show` | iOS | Show path | `clearNavbarInlines()` | `transform: translateY(0); opacity: 1` |

### On `.dynamic-views-bases-container`

| Class | When applied | When removed | Effect |
|---|---|---|---|
| `dynamic-views-full-screen-enabled` | Mount | Unmount | Indicates full screen controller is active |

### Scrim pseudos (`::before` on `leafContent`)

| Variant | Z-index | Background | Pointer-events |
|---|---|---|---|
| Ungrouped hide | 10 | `linear-gradient(to bottom, bg 0, transparent safe-area)` | `none` |
| Grouped hide | 25 | `var(--dynamic-views-view-bg-color, background-primary)` | `none` |
| Android show (`[data-dynamic-views-show]`) | inherited (10/25) | `background-primary`, full margin-top height | Grouped: `auto` |

### Z-index stack (full-screen active)

```
10  ungrouped ::before scrim
20  sticky group headers
21  hovered card enlarge/elevate
24  headings during spacer show (inline z-index)
25  grouped ::before scrim
28  toolbarBgEl (opaque backing during show fade)
29  toolbar/search overlays (absolute positioned during show)
30  header during show animation / tap shield
```

## Direction detection

### Temporal-spatial hybrid algorithm

1. **Compute** `delta = currentScrollTop - previousScrollTop`
2. **Direction change**: If delta reverses, reset `accumulatedDelta = 0`, record `directionChangeTime`
3. **Accumulate**: `accumulatedDelta += delta`
4. **Check thresholds**: Hide if `accumulatedDelta > HIDE_DEAD_ZONE`, show if `accumulatedDelta < -SHOW_DEAD_ZONE`

### Constants

| Constant | Value | Purpose |
|---|---|---|
| `FULL_SCREEN_HIDE_DEAD_ZONE` | 30px | Accumulated downward delta to trigger hide |
| `FULL_SCREEN_SHOW_DEAD_ZONE` | 20px | Accumulated upward delta to trigger show |
| `FULL_SCREEN_SHOW_SUSTAIN_MS` | 80ms | Minimum sustained direction before toggling |
| `FULL_SCREEN_TOP_ZONE` | 50px | Auto-show zone near top (expands to `totalShift` when unsettled + scrolling up) |
| `FULL_SCREEN_TOGGLE_COOLDOWN_MS` | 300ms | Minimum interval between transitions |
| `FULL_SCREEN_SCROLL_IDLE_MS` | 2000ms | iOS settle debounce |
| `FULL_SCREEN_SCROLL_IDLE_ANDROID_MS` | 500ms | Android settle debounce |
| `FULL_SCREEN_ANIM_MS` | 300ms | Header/navbar slide + toolbar/search fade duration |
| `FULL_SCREEN_FADE_MS` | 200ms | Header/navbar opacity fade duration |
| `FULL_SCREEN_SPACER_RESOLVE_DELAY_MS` | 50ms | Spacer resolve timer at top |
| `FULL_SCREEN_REVEAL_DEFER_MS` | 100ms | Header-tap deferred reveal window |
| `FULL_SCREEN_REVEAL_CANCEL_DELTA` | 3px | Per-event scroll delta to cancel reveal |
| `FULL_SCREEN_TAP_MAX_DISTANCE` | 10px | Max movement for tap detection |
| `FULL_SCREEN_TAP_MAX_DURATION_MS` | 300ms | Max duration for tap detection |

### Sustain gate

Prevents false triggers from deceleration bounce (brief delta reversals at fling end). Applied to both hide and show on iOS. Skipped on Android — Chromium fling decelerates monotonically.

### Adaptive auto-show zone

When bars are hidden, unsettled, and the user scrolls upward, the auto-show zone expands from `FULL_SCREEN_TOP_ZONE` (50px) to `totalShift` (~150px). This prevents the spacer/bridge gap from becoming visible. The expansion only activates during upward scroll to avoid hide-then-auto-show cycling.

### Cooldown accumulator reset

During the 300ms cooldown, `accumulatedDelta` resets to 0 on every scroll event. Layout-induced synthetic deltas (~250px from margin restoration) would otherwise trigger the opposite transition immediately.

## Tap-to-reveal

When bars are hidden, tapping the scroll area reveals them. The `onTouchEnd` handler detects taps (< 10px movement, < 300ms duration) and decides whether to show bars.

### Exemptions

| Target | Selector | Reason |
|---|---|---|
| **Cover image** | `.card-cover` | Opens image viewer |
| **Thumbnail** | `.card-thumbnail` | Opens image viewer |
| **Poster card with image** | `.image-format-poster.has-poster` | Toggles poster-revealed |
| **Group collapse region** | `.bases-group-collapse-region` | Triggers fold/unfold |

Cover/thumbnail exemption has one exception: if image viewer is disabled AND open action is "press on title", the image tap is non-interactive, so bars reveal.

### Reveal conditions

After exemptions, bars show when:

- **Tap outside a card** — `!target.closest('.card')`
- **Open-on-title mode, non-title tap** — card body is non-interactive, so tap reveals bars. Title link taps (`.card-title a`) are exempt.

In open-on-card mode, card body taps do not reveal bars.

## WAAPI animation system

### Options

| Constant | Duration | Easing | Targets |
|---|---|---|---|
| `HEADER_SLIDE_OPTS` | 300ms | ease-in-out | Header transform |
| `NAVBAR_SLIDE_OPTS` | 300ms | ease-out | Navbar transform |
| `BAR_FADE_OPTS` | 200ms | ease-in-out | Header/navbar opacity |
| `UI_FADE_OPTS` | 300ms | ease-in-out | Toolbar/search opacity |

All use `fill: 'forwards'` to hold the final frame until cancelled.

### Composite priority ordering

Show WAAPI animations are started BEFORE cancelling old hide animations. Later-created animations have higher composite priority per WAAPI section 4.6 — cancelling hide first would snap elements visible for one frame before show starts. The same pattern is used for re-hide from show mode (Case A).

### Android CSS cascade constraint

WAAPI animation effects are lower in the cascade than `!important` author declarations. Android header/navbar `transform` and `opacity` must NOT be in CSS `!important` rules — they are controlled entirely via WAAPI and inline styles. iOS keeps `!important` transform/opacity in CSS class rules because it does not use WAAPI for header.

## Height locking

Scroll container height is locked via inline `style.height` to prevent `clientHeight` from changing during `full-screen-active`. Without locking, flex layout changes (margin removal, toolbar collapse) resize the scroll container, causing the scroll indicator to teleport.

### Unlock-measure-relock pattern

1. **Unlock**: Remove inline `height`
2. **Mutate**: Remove bridge/class, adjust `scrollTop`
3. **Measure**: Read `offsetHeight` (browser's authoritative flex-calculated value)
4. **Relock**: Set inline `height` to the measured value

### `flex: 1` override behavior

The locked `height` does not truly constrain the scroll container because `.bases-view` has `flex: 1`. The inline `height` acts as a `flex-basis` hint. True locking with `flex: 0 0 auto` was rejected — it creates a visible gap at the bottom.

### Android height lock persistence

On Android, the height lock is NOT unlocked during show idle. Unlocking triggers scroll layer raster invalidation that flashes on Chrome/146. The stale height lock persists until the next hide cycle or unmount.

## Background inlines

Three elements above the leaf (`body`, `.app-container`, `.workspace`) receive inline `background-color` via `applyBackgroundInlines()` — the leaf-scoped `full-screen-active` class cannot reach these ancestors. Uses `var(--dynamic-views-background-primary)`. Cleared by `clearBackgroundInlines()`.

## Platform branches

### iOS

- **Settle delay**: 2000ms. Outlasts the native scroll indicator fade (~1.5s).
- **Sustain gate**: 80ms on both directions.
- **Double-rAF**: Required for navbar hide. WebKit's passive scroll listener optimization collapses transition + target into one style recalc without it.
- **Show path**: Synchronous class toggle (no two-frame split). Navbar animates via persisted hide-path transition inline.
- **Mask-image**: `restoreMaskImage()` synchronous in show. `clearMaskImageInline()` at show idle only.
- **`scrollTop` writes**: ONLY at scroll-idle (detected via debounce, not `scrollend`). Any `scrollTop` write during momentum or active touch kills scroll unconditionally.

### Android

- **Spacer-based hide/show**: `overflow-anchor` absorbs height changes. No `scrollTop` write in the show path.
- **WAAPI animations**: `element.animate()` gets better compositor scheduling on the single-threaded WebView compositor than CSS transitions.
- **Show inline bypass**: `applyShowOverlays()` / `clearShowOverlays()` use inline `setProperty()` instead of `classList` — avoids style invalidation that exceeds the single-threaded compositor frame budget.
- **`data-dynamic-views-show` attribute**: Set on `leafContent` for `::before`/`::after` pseudo CSS rules. Attribute selectors only recalc matching pseudos, not descendants.
- **Settle delay**: 500ms. Must exceed `FULL_SCREEN_ANIM_MS` (300ms) so WAAPI finishes before idle fires.
- **Sustain gate**: Skipped. Chromium fling decelerates monotonically.
- **Single-rAF**: Chromium does not collapse transitions in passive listeners.
- **`scrollTop` kills flings**: Any `scrollTop` write during an active Chromium compositor fling cancels it. Writes during active touch are safe.
- **`programmaticScroll` deadlock**: The flag blocks ALL scroll events. If not cleared via rAF, the idle timer never fires and `pendingLayout` never runs.

### WebView compositor limitation

Android WebView uses a single-threaded (synchronous) compositor — the impl thread and UI thread share the same thread. CSS transitions during active scroll compete with scroll processing for the same thread, causing 30-55ms frame gaps. WAAPI gets better scheduling but does not fully eliminate contention.

## Invariants

1. **Momentum safety (iOS)**: NEVER write `scrollTop` during momentum or active touch. Only safe at true scroll-idle.
2. **Bridge math (iOS)**: `margin-top: totalShift` on hide increases `scrollHeight` to keep coordinate space aligned. Show: remove bridge when unsettled (geometric cancellation); no bridge when settled.
3. **Spacer anchor exclusion (Android)**: The spacer has `overflow-anchor: none` so the container is the anchor target. Without this, `overflow-anchor` would select the spacer itself, producing no scroll compensation.
4. **Cooldown accumulator reset**: `accumulatedDelta` must be reset to 0 on every scroll event during cooldown.
5. **Height lock lifecycle**: Lock at mount time. iOS: unlock-measure-relock at settle. Android: height lock persists through show — only unlocked at next hide, `commitSpacerResolve()`, or unmount.
6. **Programmatic scroll guard (Android)**: Flag MUST be cleared in the next rAF — blocking longer prevents the idle timer from firing `pendingLayout`.
7. **Instant layout only**: Layout mutations during scroll must use `transition: none`. Animated transitions cause continuous relayout that kills momentum.
8. **`measureTotalShift()` before hide**: Mount-time `getBoundingClientRect` may return 0 if CSS selectors don't match at construction time. Short-circuits via `totalShiftMeasured` flag. Note: mount uses GBR delta (class toggle), `measureTotalShift()` uses component sum (`originalMarginTop + toolbarH + searchH`) — these can diverge if search row visibility changes between mount and first hide.
9. **Android: no direct class removal on show**: `classList.remove('full-screen-active')` without restoring bars first causes a white flash. Always use `applyShowOverlays()` first. Class removal only happens at `commitSpacerResolve()`.
10. **Android: no `!important` transform/opacity in CSS**: WAAPI effects are lower in the cascade than `!important` rules.
11. **WAAPI cancel ordering**: Start new animations BEFORE cancelling old ones (WAAPI section 4.6 composite priority). Exception: none — this applies to all hide→show and show→hide transitions.
12. **Spacer lifecycle (Android)**: Spacer persists across hide/show cycles. Only resolved at `commitSpacerResolve()` (scrollTop ≤ 1 at idle) or unmount. Spacer removal + class removal must be synchronous — their visual effects cancel to net zero.
13. **`restoreMaskImage()` in show path**: Runs in show rAF (Android) or synchronously (iOS). Deferring to idle violates UX requirement 3 (atomic bar transitions).
14. **`data-dynamic-views-show` selectors must terminate on pseudos**: Selectors using this attribute on `leafContent` MUST terminate on `::before`/`::after`. If they match real descendants, the attribute change triggers subtree-wide style recalc.
15. **Tap shield cleared before show WAAPI (Android)**: The class's `transform: translateY(0)` would be read as the animation start, producing a fade-only transition with no slide.
16. **`full-screen-active` on leafContent, not body**: Scopes style invalidation to the leaf subtree (~360 elements) instead of the entire document (~3000+). Also prevents multi-controller races.
17. **CSS `calc()` for toolbar positioning**: Uses `calc(var(--safe-area-inset-top) + var(--view-header-height) + headerToContentGap)` — resolves at paint time with live CSS variable values. Eliminates JS/CSS mismatch during Android orientation changes where `env(safe-area-inset-top)` oscillates.
18. **Search row ResizeObserver**: `syncShowLayoutForSearch()` re-syncs spacer height, heading tops, and toolbarBg when search opens/closes during active show mode. Sets `programmaticScroll = true` synchronously to suppress anchor-induced scroll events.
