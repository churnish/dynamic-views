---
title: Immersive scroll
description: Empirical research for immersive mobile scrolling (GitHub #132) — WebKit compositor constraints, CSS scroll-driven animation findings, rejected approaches, the space reclaim constraint, and the v84 inline-only animation architecture.
author: "\U0001F916 Generated with Claude Code"
updated: 2026-03-24
---
# Immersive scroll

## Terminology

Top to bottom on a Bases card view on phone:

| Zone | Element | Height | Notes |
|---|---|---|---|
| **Status bar** | Safe area inset | `--safe-area-inset-top` | `.app-container` bg, not animatable without side effects |
| **Header** | `.view-header` | ~44px | `position: fixed` on floating-nav phones |
| **Toolbar** | `.bases-header` | variable | Static flex sibling above scroll container |
| **Search row** | `.bases-search-row` | variable | Optional, static flex sibling |
| **Content** | `.bases-view` | flex: 1 | Scroll container; contains `.dynamic-views-bases-container` |
| **Navbar** | `.mobile-navbar` | ~52px + `--safe-area-inset-bottom` | `position: fixed` at bottom |

All heights are device-dependent. Prototypes read values at runtime via `getComputedStyle()`.

"Bars" = header + toolbar + search row + navbar (all elements that hide/show).

## Requirements

Hard UX constraints:

- **Direction-based**: Hide bars on scroll-down, reveal on scroll-up. Position-based (reappear only at top) is unacceptable.
- **Intentional scroll only**: Show trigger requires active touch, NOT momentum.
- **Responsive**: Bars must hide/show during active scroll, not deferred to scrollend. Post-momentum toggling feels broken.
- **Tap-to-reveal**: Tap without scrolling shows bars.
- **Top fade mask**: Must NOT use `-webkit-mask-image` on scroll container (kills momentum — v50). Use a separate fixed overlay div with opacity toggle.
- **Status bar bg**: Must hide with the header — native Obsidian immersive hides it. Content or a matching background must fill the safe area zone when bars are hidden.
- **Momentum-safe**: During iOS momentum scroll, ONLY compositor-safe changes (transform, opacity) are allowed. `scrollTop` writes and layout-affecting style mutations (margin/padding changes via class toggles) both kill momentum by forcing WebKit compositor sync. All layout mutations must be deferred to a scroll-idle debounce — NOT `scrollend`, which fires at finger-lift before momentum begins.

## Obsidian native immersive internals

### Body classes

| Class | Meaning | Scope |
|---|---|---|
| `is-floating-nav` | Floating nav setting enabled | Phone only |
| `auto-full-screen` | Full screen appearance setting enabled | Phone only |
| `is-hidden-nav` | Bars currently hidden | Both (works in Bases views) |

Immersive scroll only activates when `auto-full-screen` is present.

### Hide/show mechanics

- **Header** (`.view-header`): `transform: translateY()` upward + `opacity: 0`. Height: 44px + 47px safe-area = 91px.
- **Navbar** (`.mobile-navbar`): `transform: translateY()` downward + `opacity: 0`. Height: 52px + 34px safe-area = 86px.
- **Header transition**: `opacity 0.2s ease-in-out, transform 0.3s ease-in-out`.
- **Navbar transition**: `opacity 0.2s ease-in-out, transform 0.3s ease-out`.

### CSS variables

| Variable | Value | Notes |
|---|---|---|
| `--safe-area-inset-top` | `47px` | Populated |
| `--safe-area-inset-bottom` | `34px` | Populated |
| `--header-height` | Empty | Not set by Obsidian |
| `--mobile-navbar-height` | Empty | Not set by Obsidian |
| `--view-bottom-spacing` | Empty | Not set by Obsidian |
| `--view-top-spacing` | NOT adjusted when `is-hidden-nav` set | |

### `is-hidden-nav` CSS rules

- **Header**: uses `--view-header-height` + `--view-header-top-offset`.
- **Navbar**: uses `--navbar-height` + `--navbar-bottom-offset`.
- **Desktop**: opacity-only (CSS vars empty); full transform on mobile only.
- `::after` hit area and fade mask adjustments on both.

### Fade masks

- **Top**: `-webkit-mask-image: var(--view-top-fade-mask)` on `.view-content`. Gradient: `linear-gradient(rgba(0,0,0, 0.25) 0%, #000 47px)`.
- **Bottom**: `::after` pseudo-element on `.workspace-leaf-content`.

### Floating nav CSS

```css
.is-phone.is-floating-nav,
.is-phone.auto-full-screen {
  --navbar-position: fixed;
  --view-header-position: fixed;
  --view-top-spacing: calc(safe-area + header + 8px);
}
```

### Scroll event

Native immersive is driven by internal `markdown-scroll` event (CodeMirror-level). Bases views don't fire this event. Plugin must implement own scroll detection.

### Undocumented APIs to track

`is-hidden-nav`, `auto-full-screen`, `is-floating-nav`, `--view-top-fade-mask`, `--view-header-height`, `--view-header-top-offset`, `--navbar-height`, `--navbar-bottom-offset`.

## DOM structure

Bases leaf hierarchy:

```
.workspace-leaf-content
  .view-header              (position: fixed on phone)
  .view-content              (overflow: hidden, flex column, margin-top: 99px, padding: 0)
    .bases-header            (toolbar, static — sibling above scroll container)
    .bases-search-row
    .bases-error
    .bases-view              (scroll container)
      .dynamic-views-bases-container
```

- `.view-content`: `overflow: hidden`, `display: flex; flex-direction: column`.
- Toolbar (`.bases-header`) is a sibling ABOVE `.bases-view` — doesn't scroll away, must be explicitly hidden.

## Key constraint: Bases vs markdown

`is-hidden-nav` handles header + navbar hide/show in both view types. But Bases views additionally need:

1. **Toolbar collapse** (`.bases-header` transform)
2. **99px `margin-top` gap fill** on `.view-content`

These are layout changes (reflow), which cause scroll interruption. Markdown views don't need them. Native immersive works in markdown because content reflow is minimal (just header/navbar transform). In Bases views, toolbar collapse + gap reclamation amplifies jank to unacceptable levels.

## WebKit compositor architecture

### Fundamental constraint

ANY main-thread JavaScript during compositor scroll (UIScrollView momentum) causes compositor-to-main-thread sync that pauses momentum. This is architectural, not a bug.

**Affected APIs** (all cause sync): `classList`, inline styles, WAAPI `.animate()`, WAAPI `.play()`, `requestAnimationFrame` callbacks.

No JS-based workaround exists. Native iOS apps use `UIScrollViewDelegate.scrollViewDidScroll` at the UI thread level, synchronized with the compositor. Web apps in WKWebView cannot access this. Capacitor bridge is possible but out of scope.

**Caveat (v49)**: JS during momentum kills momentum ONLY if it triggers continuous relayout. Instant layout changes (`transition: none`) do NOT kill momentum — the compositor sync is brief enough that UIScrollView resumes. v39's jank was misattributed to `classList` itself; the actual cause was `transition: margin-top 0.3s` continuously relayouting for 300ms after every class toggle. **v97 confirmed**: this holds in the v84 inline-only architecture — instant `margin-top: 0` on `.view-content` does not kill momentum.

**Caveat (v87, v96)**: `scrollTop` writes kill iOS scroll unconditionally — during momentum, active touch, and idle. Not just momentum. v96 tested touch-gated `scrollTop` writes (finger on screen, no momentum) and they still killed the scroll. True scroll-idle must be detected via scroll debounce (no scroll events for N ms).

**Caveat (v99)**: First `transform` write on an element that has never been transformed forces WebKit to create a new compositing layer (layer promotion). This one-time cost causes a compositor sync that kills momentum. Subsequent transform writes reuse the existing layer and are momentum-safe. Fix: pre-promote with `transform: translateY(0)` at initialization. Do NOT use `will-change: transform` on `.view-content` — it breaks scroll event detection on child scroll containers (v100).

**v88 approach**: Bridge the visual gap with compositor-safe `transform: translateY()` on the scroll container during momentum, then swap for real margin-based layout reclaim at scroll-idle.

### Double-rAF pattern

WebKit's passive scroll listener optimization collapses inline `style.setProperty()` transition+target into a single style recalculation when both are set in the same execution context. Fix: frame 1 sets transition, frame 2 (nested `requestAnimationFrame`) sets target value. This forces two separate style recalcs, ensuring the transition fires.

```js
// Frame 1: set transition
el.style.setProperty('transition', 'transform 0.3s ease-out');
requestAnimationFrame(() => {
  // Frame 2: set target value — separate style recalc
  el.style.setProperty('transform', 'translateY(-91px)');
});
```

### `scrollend` event

- Shipped Safari 26.2 (Dec 2025).
- Intended as jank-free JS trigger — fires when scroll fully stops on desktop. See WebKit caveat below.
- Safari 26.0-26.1 needs debounced scroll fallback.
- **WebKit caveat**: fires at finger-lift, BEFORE momentum begins — NOT at true scroll-idle. Layout mutations at `scrollend` still kill momentum (v87).

### IntersectionObserver behavior

- Callbacks are async and don't block compositor directly.
- DOM mutations inside the callback still trigger style invalidation and compositor sync on next frame.
- Fires during iOS momentum scroll (unlike scroll events which are debounced) — meaningful advantage for position-based detection.

### Industry status quo

All major PWAs and JS libraries (headroom.js, headspace, Twitter/X) accept iOS momentum-scroll jank. headroom.js iOS issue #100 documents this. No JS-based solution avoids it.

## CSS scroll-driven animations

### Compositor eligibility

`animation-timeline: scroll()` shipped Safari 26 (iOS 26, fall 2025) with threaded compositor execution for **eligible properties only**.

**Eligible properties** (STP 234): `opacity`, `transform`, `translate`, `scale`, `rotate`, `filter`, `backdrop-filter`, Motion Path properties.

Anything else silently falls back to main thread.

### Critical findings

| Finding | Impact |
|---|---|
| **`var()` in `@keyframes` blocks compositor** | Per CSS spec, `var()` substitution requires main-thread style resolution on every frame. Even static values. `@property` registration does NOT help. Fix: hardcode values or use WAAPI with ScrollTimeline. |
| **Passive scroll listeners** do NOT degrade compositor execution | Architecturally decoupled. |
| **CSS transitions on same elements** do NOT interfere | Animations override transitions per CSS Cascade L5. Add `transition: none !important` as defense. |
| **`timeline-scope`** may not get compositor promotion | WebKit's deferred style resolution (Jan-Feb 2025) may not cover cross-subtree hoisting in first-gen Safari 26. |
| **Source must be composited** | WebKit Bug 303136. `overflow: hidden` above scroll container may prevent compositor promotion. |
| **Threaded flag** only stabilized Dec 2025 | WebKit Bug 303465. Safari 26.0 support does not guarantee compositor execution in all DOM shapes. |
| **`position: fixed` elements** already composited layers | Helps with header/navbar. |
| **`animation-fill-mode: both`** does not affect eligibility | |
| **`will-change`** likely redundant for declarative CSS animations | Auto-promoted, but harmless on few elements. |
| **4 simultaneous animations** is trivial | No limit concern. |

Sources: Bram.us 2023, WebKit commit 256893@main, Chromium #1411864, Lighthouse #14521.

### Direction detection: dead ends

- **`animation-range`**: Tied to absolute scrollTop. Bars only reappear when scrollTop drops below range start. Incompatible with direction-based UX.
- **`scroll-state()` container queries**: Chrome 133+ only. WebKit has NO implementation or timeline. Would solve direction detection cleanly. Monitor.
- **Bramus direction hack**: Animates custom property `--scroll-direction`, reads via `@container style()`, uses `transition-delay: calc(infinity * 1s)`. But custom property animation forces main-thread resolution (per `var()` finding above).

### Safari Web Inspector debugging

No "is this composited?" flag. Use:

- **Layers tab**: compositing reasons, repaint count.
- **Paint flashing**: visualizes repainted regions.
- **Layout & Rendering timeline**: composite-only frames = good.
- **Frames view**: frame drops = main-thread fallback.

## Layout gap

### The problem

`translateY(-Npx)` on view-content shifts pixels but doesn't change layout. Results:

- **v28-v32** (with vc transform): gap at BOTTOM.
- **v33** (without vc transform): gap at TOP.

### No CSS-only layout reclamation

- `contain: layout size` doesn't prevent own-box reflow.
- `content-visibility: auto` doesn't change box model.
- `margin-top`/`height`/`max-height` via scroll-driven animations still trigger main-thread reflow.

### Rejected gap approaches

| Approach | Version | Result |
|---|---|---|
| `clip-path: inset(0 0 99px 0)` + transform | v35 | Visible strips above and below until scrollend. Timing misalignment. |
| Color-fill gap | v33 | Accept top gap, fill with `background-color: var(--background-primary)` on leaf-content. Gap disappears at `scrollend` when real layout change applied. Less broken than alternatives. |
| `background-color` on container | v43-v44 | Paint-ordering delay vs GPU-composited transforms — color fill lags behind transform, gap flickers. |
| `translateY` on view-content to close gap | v47 | Zero-sum: closes top gap but opens equivalent bottom gap. |
| Fixed overlay divs on `body` | v48 | Rendered below Obsidian's workspace stacking context — not visible. |
| `-webkit-mask-image` on scroll container | v50 | Kills momentum — paint-layer invalidation on compositor-managed element causes sync. Fade must live on a separate DOM element. |
| `position: sticky; top: 0` overlay | v51 | Anchors to scroll container top, not viewport top. `.view-content` starts below `.view-header` in flex flow (header still occupies layout space despite transform + opacity: 0). |

### Gap resolution (v49)

Moot. Instant layout (`margin-top: 0` with `transition: none`) eliminates the gap entirely — no two-phase architecture needed, no gap to mask.

### Safe area and top bar animation (v78–v80)

**Correction (v106)**: Native Obsidian immersive DOES hide the status bar bg — `is-hidden-nav` CSS handles it. Earlier conclusion that `.app-container` bg "cannot be animated" was wrong. The fix is to add `is-hidden-nav` immediately (not defer it). v78–v80 findings below apply to custom CSS approaches only, not to the native class toggle.

Earlier custom approaches to hide the safe area bg all failed:

| Version | Approach | Result |
|---|---|---|
| v78b | Opaque header/viewContent background | Visible strips between header and content |
| v78c | `overflow: visible` on parent | Still clipped by ancestor elements |
| v79 | Solid overlay on `document.body` | Covers actual UI — renders above workspace content |
| v80 | `::before` pseudo-element | Layout gap — pseudo-element occupies space in flex flow |

## Space reclaim constraint (v87–v98)

### The problem

When bars hide via compositor-only animation (transform + opacity), the header's flex allocation in `workspace-leaf-content` remains — an empty region showing `--background-primary`. Reclaiming this space requires layout mutations that conflict with iOS momentum scroll.

### Approaches exhausted

| Approach | Versions | Failure mode |
|---|---|---|
| Immediate layout change | v87 | `scrollTop` writes + margin changes kill momentum unconditionally |
| Deferred layout to `scrollend` | v88 | `scrollend` fires at finger-lift, before momentum begins |
| Deferred layout to scroll-idle debounce | v90 | Visible gap during momentum + visible scroll jump when layout fires |
| Transform bridge on scroll container | v89, v91 | Blank strips from parent `overflow` clipping chain |
| Fixed overlay mask | v93 | Same `--background-primary` as headers — no visual change. `position: fixed` breaks inside transformed ancestors |
| Absolute header + padding compensation | v94–v95 | Visible gap artifact between header and toolbar. Doesn't integrate with Obsidian's mobile flex layout |
| Touch-gated scrollTop compensation | v96 | `scrollTop` writes kill scroll in ALL states — active touch, momentum, idle. Not just momentum (strengthens v87) |
| Instant margin, no scrollTop compensation | v97 | Momentum survives (v49 confirmed in v84 architecture) but ~99px visual content jump — uncompensated margin shift |
| Transform bridge on `.view-content` | v98 | Kills momentum — first `transform` write on `.view-content` forces layer promotion (compositor sync). Subsequent transforms are fine (v99 diagnostic). |
| Pre-promoted transform bridge (`will-change`) | v100 | `will-change: transform` on `.view-content` breaks scroll event detection on child `.bases-view`. Hide never fires. |
| Pre-promoted transform bridge (`translateY(0)`) | v101 | Testing — `transform: translateY(0)` at init for pre-promotion. Also fixes: SHOW not touch-gated (momentum scroll-up must reveal bars). |

### Constraint

On floating-nav phones, the view-header is `position: fixed` — no flex allocation exists. The ~99px `margin-top` on `.view-content` is spacing compensation for the fixed overlay. Instant margin zeroing is momentum-safe (v97), but `scrollTop` compensation is impossible (v96). The remaining approach is transform bridging: cancel the margin shift with a compensating `translateY`, then animate to zero.

### `scrollend` on iOS

`scrollend` fires at finger-lift BEFORE momentum begins — NOT at true scroll-idle. Must use scroll debounce (no scroll events for N ms) for idle detection.

### Transform bridge

`translateY()` on a scroll container inside clipping parents creates blank strips at top (parent `overflow` clips the shifted content above bounds) and bottom (gap between shifted element bottom and parent bottom). The clipping chain is too deep for `overflow: visible` fixes.

### Deferred layout + scrollTop compensation

Even when `immersive-active` class toggle and `scrollTop` adjustment are synchronous in the same JS frame, WebKit may render them in separate composites — producing a visible scroll position jump.

## Space reclaim: gap zone analysis (v111–v145)

### overflow-anchor

`overflow-anchor: auto` is NOT supported in any shipping Safari/iOS version (March 2026). Only available in Safari Technology Preview. Padding-top migration approaches (v114) fail because without scroll anchoring, content jumps when padding changes inside a scroll container.

### The gap is blank space, not wrong color

v128 diagnostic (elementFromPoint sampling at y=0 through y=98 every 100ms during momentum) proved conclusively:

- ALL CSS overrides work correctly during momentum (header opacity:0, translateY(-91), bg transparent)
- elementFromPoint returns `workspace-leaf-content` with `bg=rgb(255,255,255)` at all Y positions
- Cover elements, bg-color overrides, and opacity changes are irrelevant
- The "header bg" is simply the blank 99px margin gap where card content should be
- Only filling the gap with actual content resolves the visual issue

### iOS status bar visual bounds

iOS status bar appearance is determined by visual bounds, not layout position:

- **v112**: `margin:0` on view-content (no transform on view-content) → status bar fixed. Content jumps.
- **v130**: `margin:0` + `translateY(+99)` on view-content → status bar NOT fixed. `getBoundingClientRect().top = 99` because transform shifts visual bounds.
- **Conclusion**: View-content must be at y=0 in BOTH layout AND visual (no transform on view-content itself). Transforms on children are acceptable.

### scrollTop correction at idle

v120 validated: `margin-top: 0` + `scrollTop -= marginTop` in the same synchronous tick at scroll-idle (150ms debounce) produces ZERO visual jump. scrollTop writes at idle are safe (no momentum to kill). Programmatic scroll guard prevents the scroll handler from misinterpreting the write.

v121 proved full-idle-defer (all changes at idle) is too slow — iOS momentum fires scroll events for 2-3 seconds.

### Continuous scroll-linked architecture

v129 introduced a fundamentally different approach: instead of toggling bars at a threshold and fixing the gap afterward, the gap fills GRADUALLY as the user scrolls (like Safari's address bar). translateY on view-content driven by scroll delta. Transform→margin swap at lock-in (zero visual jump, no scrollTop write).

However, this approach doesn't fix the status bar during the hiding phase because transforms don't affect the layout tree that iOS uses for status bar determination.

### Momentum-safe layout changes (expanded)

Builds on v49/v97 finding:

- **Instant `margin-top: 0`** (transition: none): momentum-safe (v49, v97)
- **Instant `translateY`** (no transition): momentum-safe after pre-promotion (v99, v116)
- **Animated `transition: transform`** on view-content parent: kills momentum (v115)
- **Instant `translateY` per scroll event** (continuous, no transition): momentum-safe (v129, v130)
- **Both instant parent transform + animated child transform**: individually momentum-safe (v118)

### Status bar requirements (v132b)

v132b confirmed the three required ingredients for iOS status bar update:

1. `margin-top: 0` on `.view-content` (layout position at y=0)
2. Toolbar flow collapse (`margin-bottom: -52px` on `.bases-header`) — without this, the invisible-but-in-flow toolbar sits at y=0 instead of the scroll container
3. Ancestor `background-color: var(--background-primary)` on body, `.app-container`, `.workspace`

All three must be applied via CSS class, not `is-hidden-nav`. `is-hidden-nav` was designed for markdown views without a toolbar between header and content.

### Scroll child bridge: Pareto optimum (v139–v144)

The best achievable architecture for immersive scroll on iOS:

1. **HIDE (immediate, momentum-safe)**: `translateY(+totalShift)` bridge on scroll child + `immersive-active` class toggle. No `scrollTop` writes.
2. **IDLE (150ms debounce)**: Remove bridge + `scrollTop -= totalShift`. Safe at idle (no momentum).
3. **SHOW pre-settle**: Remove bridge + remove class. No `scrollTop` write needed.
4. **SHOW post-settle**: Reverse bridge `translateY(-totalShift)` + remove class. Idle: `scrollTop += totalShift`.

The bridge produces zero visual jump MOST of the time but has **intermittent minor jumps from scroll viewport clipping artifact**. The scroll container resizes (grows taller from margin removal + toolbar collapse), and the bridge's `translateY` on the scroll child creates a visual discontinuity at viewport edges.

### Pareto frontier

A [Pareto frontier](https://en.wikipedia.org/wiki/Pareto_front) is the set of solutions where improving one objective requires degrading another. For immersive scroll on iOS WebKit, the three objectives are:

1. **Immediate status bar** — bars hide instantly, status bar bg updates in the same frame
2. **No content jump** — zero visual displacement of scroll content
3. **Preserved momentum** — iOS fling scroll continues uninterrupted

No solution can achieve all three simultaneously. Every approach sits on this frontier:

```
                No Jump
                  ▲
                  │
         v120 ●  │
       (delayed   │
        status)   │
                  │
──────────────────┼──────────────► Preserved Momentum
                  │
         v145 ●  │  ● v144
       (momentum  │  (minor jump,
        killed)   │   everything
                  │   else works)
                  │
           Immediate Status Bar
```

v144 is Pareto optimal — no other solution is better in ALL three dimensions. Improving any axis requires sacrificing another. Four independent bridge mechanisms (translateY, opacity+translateY, padding-top, spacer div) all produce identical intermittent jumps, confirming the issue is inherent to scroll container resize during momentum, not the compensation technique.

| Approach | Status bar | Jump | Momentum |
|---|---|---|---|
| Bridge + idle settle (v144) | Immediate | Minor, intermittent | Preserved |
| scrollTop in same tick (v145) | Immediate | None | **Killed** |
| Deferred margin (v120) | **Delayed** | None | Preserved |

The `overflow-anchor` CSS property (Safari Technology Preview 238+, estimated production Safari 27, fall 2026) will resolve this by handling scroll position compensation at the compositor level. Feature-detect with `CSS.supports('overflow-anchor', 'auto')`.

### Measurement ordering bug (v133–v137)

The `totalShift` measurement toggles the `immersive-active` class and reads `getBoundingClientRect().top` before/after. In v133–v137, this measurement ran BEFORE the `<style>` element defining the class rules was inserted into the DOM. Result: `totalShift=0`, no bridge compensation. Always insert CSS before measuring.

### scrollTop writes are unconditionally fatal (v145)

v145 confirmed: `scrollTop` writes in the same synchronous tick as `classList.add()` + instant layout changes still kill momentum. The compositor sync from `scrollTop` is a separate, non-cancelable operation that cannot be masked by batching with other changes. This strengthens v96's finding and closes the `scrollTop`-during-momentum approach permanently.

## Rejected approaches

| Version | Approach | Result |
|---|---|---|
| v2 | `max-height: 0` on toolbar | Background elements remain, not collapsed. |
| v4-v14 | (Various) | Testing error: user wasn't running cleanup between injections — CSS accumulated. |
| v6-v13 | `margin-top` transitions, inline styles, rAF deferral | All cause momentum interruption on WebKit. |
| v14 | `height: 100% !important` on flex `.view-content` | Broke scrolling (collapsed computed height). |
| v15-v17 | Inline `style.setProperty` without body class | Still jank. v17 showed HIDE/SHOW rapid cycling. |
| v18 | Touch-driven + WAAPI + deferred body class via `Promise.resolve().then()` | Still interrupts. |
| v29 | WAAPI `.animate()` with 16ms duration | Still jank during active scroll. |
| v30 (E) | `margin-top: 0` on view-content permanently | Toolbar pushed into status bar zone. |
| v31 | Pre-created WAAPI `.play()` at touchend | Still interrupts momentum. |
| v32 | rAF-batched `.play()` | Still janks + 143px bottom gap. |
| v33 | Drop vc transform, color-fill gap | Still scroll suspension on hide/reveal. |
| v34 | CSS scroll-driven animations with `var()` in keyframes + `timeline-scope` | Scroll hitch + gap persists for seconds. |
| v35 | Hardcoded keyframes + clip-path gap | Strips above/below content. Position-based UX inherent to scroll-driven animations. |
| v36 | `scrollend`-only direction detection + pre-created WAAPI | Jank-free but bars toggle only after momentum ends — unresponsive, feels broken. |
| v39 | Touch-gated classList toggle | Momentum killed by `transition: margin-top 0.3s` continuous relayout, not by classList itself. |
| v40 | Pure compositor (transform/opacity only, no layout) | Momentum-safe but layout gap remains (no margin changes). |
| v41 | Compositor + bg-color + mask + pointer-events | Momentum killed — one of the added paint properties caused compositor sync. |
| v42 | Compositor + scrollend layout | Momentum-safe but layout gap visible until scrollend fires. |
| v43-v44 | Background-color gap masking | Paint-ordering delay vs compositor transforms — color fill lags behind transform. |
| v45 | No touch gating | Works when combined with instant layout (validated after v49 finding). |
| v46 | Diagnostic build | Confirmed gap = container background + view-content background. |
| v47 | `translateY` gap closing on view-content | Zero-sum: top gap closes, bottom gap opens. |
| v48 | Fixed overlay divs on body | Below workspace stacking context — not visible. |
| v50 | `-webkit-mask-image` on scroll container | Kills momentum — paint-layer invalidation on compositor-managed element. |
| v51 | Sticky fade overlay (`position: sticky; top: 0`) | Anchors to scroll container top, not viewport. |
| v53-v55 | Navbar CSS transitions / inline styles / WAAPI | All appeared instant — Obsidian native hide is instant (`is-hidden-nav`) + `translateY(86px)` with ease-out moves below viewport in first frames. |
| v84 | Inline-only animation (CSS class handles layout only, visual animation via inline styles) | Works — CSS class/inline `!important` conflict resolved by separating concerns. Double-rAF needed for WebKit transition firing. Base architecture for v85+. |
| v87 | `scrollTop` compensation after layout change | Kills momentum — `scrollTop` writes force compositor sync unconditionally. |
| v88 | Deferred layout to `scrollend` + fallback timer | `scrollend` fires at finger-lift before momentum begins. Layout at scrollend still kills momentum. |
| v89 | Transform bridge on scroll container + scroll debounce | Blank strips at top (parent overflow clips) and bottom (gap below shifted element). Parent clipping chain too deep. |
| v90 | Pure scroll debounce, no transform bridge | Visible gap during momentum (header space shows bg). Visible scroll jump when layout fires at idle. |
| v91 | Zero-shift swap (transform cancels margin change) | Mathematically correct (net zero visual shift) but same blank strip artifacts from parent clipping as v89. |
| v92 | Extended gradient overlay covers header gap | Overlay only covers header zone, not toolbar. Deferred layout causes toolbar to appear only at scroll-idle. |
| v93 | No layout reclaim — overlay mask fills gap | Overlay uses same `--background-primary` as headers — visually indistinguishable. `position: fixed` inside transformed ancestor unreliable on iOS. |
| v94–v95 | Absolute header (`position: absolute` + padding-top) | Padding creates visible gap between view-header and bases-header. Header bg + gap persist when hidden. Doesn't integrate with Obsidian's mobile layout system. |
| v96 | Touch-gated `scrollTop` compensation (margin-top: 0 + scrollTop -= H during active touch) | `scrollTop` writes kill scroll in ALL states — active touch, momentum, idle. Also: `TOP_ZONE = headerOffset` (~99px) made hide threshold too high. |
| v97 | Instant margin reclaim, zero `scrollTop` writes | Momentum survives (v49 confirmed in v84 arch). ~99px visual jump — uncompensated layout shift. Proves instant margin is safe; jump is the remaining problem. |
| v98 | Transform bridge on `.view-content` (margin + compensating translateY + animated transition) | Kills momentum — first `transform` on `.view-content` forces layer promotion (compositor sync). |
| v99 | Diagnostic: instant margin + instant transform on `.view-content`, no animation | First scroll kills momentum (layer promotion). Subsequent scrolls survive. Confirms layer promotion is the one-time cost. |
| v111 | Transform bridge on scroll child + CSS class toggle (separate frames) | Bridge and class toggle in different rAFs — 2-frame timing mismatch. Jump persists. |
| v112-v113 | Transform bridge on scroll child in same synchronous block | Status bar fixed (margin:0 on view-content). Content jumps ~99px. Transform bridge fundamentally flawed: translateY on scroll child compensates within the scroll container's coordinate space, but the scroll viewport clipping boundary shifted. |
| v114 | Padding-top migration (margin → padding on scroll container) | Fails. `overflow-anchor: auto` NOT supported in any shipping Safari/iOS (March 2026). Only in Safari Technology Preview. |
| v115 | Animated `translateY` on `.view-content` (replacing margin-top) | Kills momentum — continuous `transition: transform` on parent causes compositor sync. User preferred the animated result over v116's instant jump. |
| v116 | Instant `translateY` on `.view-content` (no transition) | Momentum-safe. Content jumps instantly. User preferred v115's animation. |
| v117 | Two-phase: bars immediate, space reclaim deferred to scroll-idle | Status bar delayed — margin still 99px during momentum. |
| v118 | Instant `translateY` on view-content (parent) + animated `translateY` on scroll child | Both individually momentum-safe. Child bridge doesn't visually cancel parent shift (scroll viewport clipping mismatch). |
| v119 | Bridge on `.bases-view` (scroll container itself) | Animated the jump but choppily. User asked about reversing the animation direction. |
| v120 | `margin-top: 0` + `scrollTop -= marginTop` at scroll-idle (150ms debounce) | ZERO visual jump at idle. scrollTop writes safe at idle (no momentum). Status bar delayed (margin:0 deferred). |
| v121 | Everything deferred to scroll-idle | Too slow — iOS momentum fires scroll events for 2-3 seconds. Bars appear to respond only after full stop. |
| v122-v123 | v120 + bg-color overrides on ancestors + `is-hidden-nav` | Status bar bg persists until scroll-end. bg-color on ancestors doesn't change the visible gap — the gap IS empty space, not wrong color. |
| v124-v125 | margin↔padding swap (margin:0 + padding-top on same element) | Padding zone is visually identical to the margin gap — transparent, showing parent background. Doesn't fill the gap with content. v125 also had uncompensated toolbar collapse shift (~52px). |
| v126 | Solid fixed-position cover element over gap zone | `position: fixed` broken inside Obsidian's DOM — ancestor `transform` from workspace page transitions makes fixed positioning relative to the transformed ancestor. |
| v127 | Direct header opacity:0 + leafContent bg-primary | CSS overrides all applied correctly (v128 diagnostic confirmed), but the gap remains blank empty space. |
| v128 | Diagnostic: `elementFromPoint` + computed style sampling at y=0 through y=98 | ALL elements at y=0 are `workspace-leaf-content` with `bg=rgb(255,255,255)`. Header at opacity:0, translateY(-91). Proves the "header bg" issue is blank empty space (the margin gap), not a color problem. |
| v129 | Continuous scroll-linked gap fill (translateY on view-content, reduces with scroll) | Transform on view-content doesn't affect iOS layout tree. Status bar uses visual bounds (getBoundingClientRect), not layout position. Status bar not fixed during hiding phase. |
| v130 | margin:0 immediately + translateY(+99) on view-content | Status bar not fixed. Transform pushes visual bounds to y=99 — `getBoundingClientRect().top = 99`. iOS status bar responds to visual position, not layout position. |
| v131 | margin:0 on view-content + translateY on scroll child (v112 architecture with continuous reduction) | Status bar still not fixed. Contradicts v112 finding — under investigation. |
| v132 | v112 CSS class (margin:0 + toolbar collapse + bg-color) + v120 idle-settle bridge | Bridge only compensated marginTop (99px), not toolbar collapse (52px). Uncompensated 52px jump + scrollbar resize. |
| v132b | Control: faithful v112 reproduction (animated bridge, `immersive-active` class, no `is-hidden-nav`) | Status bar confirmed working. Validates that toolbar flow collapse + ancestor bg-color + margin:0 are the required ingredients. Content jump present (same as v112). |
| v133-v137 | Measured bridge + animated/idle settle | `totalShift=0` — measurement ran BEFORE `<style>` element insertion. All bridge values were zero. No compensation applied. |
| v138 | v137 fix: style insertion before measurement + setTimeout animated bridge | Animation fires correctly (`totalShift=151`). Perceived 2x scroll speed during 300ms bridge animation — bridge settle compounds with ongoing scroll velocity. |
| v139-v140 | Hold bridge until idle settle (no animation) | Content position correct most of the time. Intermittent minor jumps from scroll viewport clipping artifact. Best result so far. |
| v141 | scrollTop drift detection during hide | No drift detected (scrollBefore === scrollAfter on every hide). Eliminates auto-scrollTop-adjustment hypothesis. |
| v142 | Anti-flicker: 300ms cooldown + hysteresis (hide 30px / show 50px) + zero-reset accumulator | Cooldown works (events 600-800ms apart). Rapid cycling eliminated. Minor jumps persist. |
| v143 | Cached totalShift — no forced reflow in hide path | Eliminates getComputedStyle/offsetHeight during hide. Minor jumps persist. |
| v144 | Inline `transition: none` on view-content before class removal | Prevents margin-top transition on show. Minor jumps persist. |
| v145 | scrollTop correction in same sync tick as layout change (no bridge) | Momentum killed instantly. Confirms scrollTop writes are unconditionally fatal — even batched with layout changes. |

## Navbar hide behavior

### Native animation corrected (v72)

v58's conclusion that `is-hidden-nav` is instant was wrong. v72 instrumentation revealed native Obsidian DOES animate navbar hide — `transform 0.3s ease-out` + `opacity 0.2s ease-out` for BOTH hide and show directions. v58's `is-hidden-nav` toggle appeared instant due to WebKit's passive scroll listener optimization collapsing transition+target into a single style recalculation (see "Double-rAF pattern" above), not because native hide is unanimated.

- **Transform range**: 0 to 86px
- **`margin-bottom`**: Stays constant at 32px — no layout reclaim animation
- **Both directions animated**: Same `transform 0.3s ease-out` + `opacity 0.2s ease-out` for hide and show

### Animated hide (v84)

v84 correctly separates concerns: CSS class handles layout changes only, inline styles handle compositor animation (transform + opacity) via double-rAF pattern. No `translateY` in the initial animation frame — with ease-out, 86px of translation moves the element below the viewport in the first few frames. Show direction reverses the inline styles with matching transitions.

## Architecture evolution

### v59: single-phase (superseded)

Single-phase: all changes (compositor + layout) apply simultaneously via classList toggle. The two-phase model (compositor during scroll, layout at scrollend) is unnecessary — instant layout does not kill WebKit momentum.

| Concern | Implementation |
|---|---|
| **Layout** | `margin-top: 0` and `margin-bottom: -headerHeight` with `transition: none` (instant, momentum-safe) |
| **Compositor** | `transform` and `opacity` with CSS transitions (300ms/200ms) |
| **Navbar hide** | WAAPI opacity fade-out (250ms), then `is-hidden-nav` on finish |
| **Navbar show** | Native CSS transition on `is-hidden-nav` removal |
| **Top fade** | Fixed overlay div inside `workspace-leaf-content`, opacity toggled (NOT mask-image on scroll container) |
| **Direction detection** | Passive scroll listener with accumulated delta, 30px dead zone, 50px top zone auto-show |

### v84: inline-only animation (current)

v59's CSS class approach was superseded by v84's inline-only animation, which correctly separates CSS class (layout) from inline styles (compositor animation). CSS class handles layout mutations (margin, pointer-events). Inline `style.setProperty()` with double-rAF handles compositor animation (transform, opacity). This resolves the WebKit passive scroll listener optimization that collapsed v58's transitions.

**Current state**: Bar animations work correctly via double-rAF inline styles. Space reclaim uses bridge + idle settle architecture: `translateY(totalShift)` bridge on scroll child at hide time (momentum-safe), then `scrollTop -= totalShift` + bridge removal at scroll-idle (2s debounce). The 2s settle delay outlasts the iOS scroll indicator fade (~1.5s), making the settle invisible. Scroll container height is locked (`style.height`) to decouple `clientHeight` from flex layout changes — unlock-measure-relock at settle. Minor intermittent content jumps from scroll viewport clipping artifact are accepted as the Pareto optimum (see "Pareto frontier" above).

## Direction detection

### Temporal-spatial hybrid

Direction detection uses a combined threshold: accumulated scroll delta (spatial) must exceed a dead zone AND the direction must be sustained for a minimum duration (temporal). Constants in `shared/constants.ts`:

| Parameter | Value | Purpose |
|---|---|---|
| `IMMERSIVE_HIDE_DEAD_ZONE` | 30px | Accumulated downward scroll to trigger hide |
| `IMMERSIVE_SHOW_DEAD_ZONE` | 20px | Accumulated upward scroll to trigger show |
| `IMMERSIVE_SHOW_SUSTAIN_MS` | 80ms | Minimum sustained direction before triggering |
| `IMMERSIVE_TOP_ZONE` | 50px | `scrollTop` threshold — always show bars near top |
| `IMMERSIVE_TOGGLE_COOLDOWN_MS` | 300ms | Minimum interval between hide/show transitions |

On each scroll event: if the delta reverses direction, the accumulator resets to zero and `directionChangeTime` records the reversal timestamp. The sustain gate (`Date.now() - directionChangeTime >= 80ms`) prevents false triggers from deceleration bounce — short-lived delta reversals at the end of a fling.

### Why touch gate failed

Early prototypes gated show on `touchstart` (require active finger to reveal bars). iOS consumes `touchstart` during momentum stops — the event fires but the finger-down that halts momentum is not reliably delivered as a separate `touchstart` before scroll events resume. The sustain gate replaced the touch gate entirely.

### Sustain gate on both directions

The 80ms sustain gate applies to BOTH hide AND show. Deceleration bounce produces brief reversals in both directions:

- **Scroll-down deceleration**: brief upward delta → false show trigger
- **Scroll-up deceleration**: brief downward delta → false hide trigger

Without the sustain gate on hide, rapid hide→show cycling occurred during fast downward scrolls.

### Cooldown accumulator reset

During the 300ms cooldown after a toggle, scroll events still fire. The `immersive-showing` CSS class restores `margin-top: ~99px` on `.view-content`, which causes WebKit to fire layout-induced scroll deltas (~250px compensation). Without resetting the accumulator during cooldown, these synthetic deltas leak past the cooldown and immediately trigger the opposite transition. Fix: `accumulatedDelta = 0` on every scroll event during cooldown.

### Layout-induced scroll deltas

The `immersive-showing` class restores margin-top on `.view-content`. WebKit compensates by adjusting the scroll position, producing a large synthetic scroll delta (~250px, equal to `totalShift`). These deltas are not user-initiated but are indistinguishable from real scroll events. The cooldown accumulator reset (above) and the `programmaticScroll` guard during settle handle both sources.

## Settle architecture

### Bridge + idle settle

The settle resolves the gap between the immediate bridge (momentum-safe visual compensation) and the final layout state (correct scroll position without bridge). Sequence:

1. **HIDE**: `translateY(totalShift)` on scroll child + `immersive-active` class. Scroll container height locked.
2. **IDLE (2s debounce)**: Unlock height → remove bridge → `scrollTop -= totalShift` → re-measure → relock height.
3. **SHOW**: `immersive-showing` class override. If settled, reverse bridge `translateY(-totalShift)`.
4. **SHOW IDLE (2s debounce)**: Remove bridge → if settled, `scrollTop += totalShift` → remove classes → unlock → re-measure → relock.

### 2s settle delay

`IMMERSIVE_SCROLL_IDLE_MS = 2000`. The settle involves a `scrollTop` write and height unlock-relock, both of which cause the iOS native scroll indicator to flash. The 2s delay outlasts the scroll indicator's fade-out (~1.5s after last scroll event), so the settle is invisible to the user.

### Unlock-measure-relock

Scroll container height is locked via inline `style.height` to prevent `clientHeight` from changing during `immersive-active` (flex layout changes would resize the scroll container, causing scroll indicator teleport). At settle:

1. Remove inline `height` (unlock)
2. Remove bridge / adjust `scrollTop`
3. Read `offsetHeight` (measure true flex-calculated height)
4. Set inline `height` again (relock)

Direct height calculation (`currentHeight + totalShift`) was rejected — it compounded rounding errors across rapid hide/show cycles. The unlock-measure-relock approach reads the browser's authoritative value each time.

### `flex: 1` overrides inline `height`

The locked `height` doesn't truly constrain the scroll container because `.bases-view` has `flex: 1` in Obsidian's layout. The inline `height` acts as a `flex-basis` hint that WebKit respects during the brief transition period. True locking would require `flex: 0 0 auto`, but this was rejected — it creates a visible gap strip at the bottom of the viewport when bars are hidden (the flex container no longer stretches to fill available space).

### Scroll indicator jump

The scroll indicator jumps when bars hide/show because the scroll container's effective height changes (margin-top removal adds ~99px + toolbar collapse adds ~52px). This matches Safari's native address bar behavior — the scroll indicator repositions when the viewport resizes. Accepted as inherent to the architecture.

### Pareto frontier confirmed

Three objectives cannot all be achieved simultaneously on iOS WebKit:

1. **Immediate status bar** — status bar bg updates in the same frame as bar hide
2. **No content jump** — zero visual displacement
3. **Preserved momentum** — iOS fling continues uninterrupted

The bridge + idle settle architecture (v144) achieves immediate status bar + preserved momentum with minor intermittent jumps. See "Pareto frontier" section above for the full analysis and comparison table.

## SCSS implementation

### Toolbar collapse

```scss
// Hide state
transform: translateY(-100%);
margin-bottom: calc(var(--bases-header-height) * -1);
opacity: 0;

// Timing (matches native)
transition: transform 0.3s ease-in-out, opacity 0.2s ease-in-out;
```

### Implementation checklist

- Use `this.register(cleanup)` in constructor.
- Place setup after `this.scrollEl` assignment.
- Move thresholds to `shared/constants.ts`.
- Raise touch timeout to 150ms.

## Diagnostic tools

- **Safari Web Inspector**: Connect Mac to iOS device, inspect Obsidian's WKWebView via Safari Develop menu. Use Layers tab for compositing reasons, paint flashing for repaint visualization, and Frames view for main-thread fallback detection.
- **Chrome DevTools MCP**: Use `evaluate_script` for runtime instrumentation on desktop (scroll event logging, `getBoundingClientRect` sampling, `getComputedStyle` reads). Use `list_console_messages` to retrieve diagnostic output.
- **Cleanup convention**: Each diagnostic IIFE must call `window.__cleanupImmersive()` at the top before initializing. Cleanup is part of the script, not a separate manual step.
- **Listener leak** (v34 bug): anonymous scroll fallback never removed by cleanup. Always use named function references.
- **A/B isolation test**: Animate ONE target inside scroll container with anonymous `scroll(nearest)`, no `timeline-scope`. If smooth, topology/timeline-scope is the culprit.

## References

- headroom.js iOS issue #100 — documents iOS momentum-scroll jank as unsolvable
- WebKit Bug 303136 — scroll container compositor promotion
- WebKit Bug 303465 — threaded scroll-driven animations flag stabilization
- Bram.us 2023 — `var()` in `@keyframes` compositor blocking
- Chromium #1411864 — `var()` compositor blocking
- Lighthouse #14521 — `var()` compositor blocking
- WebKit commit 256893@main — `var()` spec-level main-thread requirement
- CSS Cascade Level 5 — animation/transition override semantics
- STP 234 — eligible properties for compositor-promoted scroll-driven animations
