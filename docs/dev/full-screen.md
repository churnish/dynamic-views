---
title: Full screen
description: Empirical research for full screen mobile scrolling (GitHub #132) — WebKit compositor constraints, CSS scroll-driven animation findings, rejected approaches, the space reclaim constraint, Chrome/146 Android show flash compositor findings, Android WebView WAAPI workaround, and the spacer + overflow-anchor implementation era (transform bridge failures, show overlay system, Grid paint invalidation flash, Android long-press/drag-drop, landscape safe area oscillation, WAAPI patterns).
author: 🤖 Generated with Claude Code
updated: 2026-04-07
---
# Full screen

See also: [`odkb/webkit-compositor-constraints.md`](https://github.com/churnish/odkb/blob/main/webkit-compositor-constraints.md), [`odkb/android-chromium-quirks.md`](https://github.com/churnish/odkb/blob/main/android-chromium-quirks.md), [`odkb/undocumented-obsidian-apis.md`](https://github.com/churnish/odkb/blob/main/undocumented-obsidian-apis.md)

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
- **Status bar bg**: Must hide with the header — native Obsidian full screen hides it. Content or a matching background must fill the safe area zone when bars are hidden.
- **Momentum-safe**: During iOS momentum scroll, ONLY compositor-safe changes (transform, opacity) are allowed. `scrollTop` writes and layout-affecting style mutations (margin/padding changes via class toggles) both kill momentum by forcing WebKit compositor sync. All layout mutations must be deferred to a scroll-idle debounce — NOT `scrollend`, which fires at finger-lift before momentum begins.

## Native implementation

Extracted from Obsidian desktop v1.8.9 `obsidian.asar/app.js` (class `X6`, `mobileNavbar`) on 2026-03-28.

### Body classes

| Class | Meaning | Scope |
|---|---|---|
| `is-floating-nav` | Floating nav setting enabled | Phone only |
| `auto-full-screen` | Full screen appearance setting enabled | Phone only |
| `is-hidden-nav` | Bars currently hidden | Both (works in Bases views) |

Full screen only activates when `auto-full-screen` is present.

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

### Decompiled scroll handler

Native full screen is driven by internal `markdown-scroll` event (CodeMirror-level). Bases views don't fire this event — the plugin must implement its own scroll detection via passive `scroll` listener. Scroll values are LINE NUMBERS (fractional), not pixels — CM6 `getScroll()` returns line-based position from `scrollDOM.scrollTop` + `lineBlockAtHeight()`.

```javascript
e.prototype.onScroll = function (scrollElement, currentScroll) {
  var previousScroll = this.scrollTops.get(scrollElement) ?? 0;
  this.scrollTops.set(scrollElement, currentScroll);

  if (Platform.isPhone && !Platform.mobileSoftKeyboardVisible
      && this.app.vault.getConfig("autoFullScreen")) {
    var delta = currentScroll - previousScroll;

    // Guard 1: Both positions near top → skip
    if (currentScroll < 0.1 && previousScroll < 0.1) return;

    // Guard 2: Dead zone — less than 1/8 of a line (~2.6px) → skip
    if (Math.abs(delta) < 0.125) return;

    // Direction: positive delta = scrolling down → hide
    if (delta > 0) {
      this.hideNavigation();
    } else {
      this.restoreNavigation();
    }
  }
};

e.prototype.hideNavigation = function () {
  Platform.isPhone && (
    document.body.addClass("is-hidden-nav"),
    StatusBar?.hide()
  );
};

e.prototype.restoreNavigation = function (animate) {
  if (animate === undefined) animate = true;
  Platform.isPhone && document.body.hasClass("is-hidden-nav") && (
    document.body.removeClass("is-hidden-nav"),
    StatusBar?.show({ animation: animate ? Fade : None }),
    animate || (
      this.app.disableCssTransition(),
      setTimeout(() => this.app.enableCssTransition(), 0)
    )
  );
};
```

### Key differences from Dynamic Views

| Aspect | Native | Dynamic Views |
|---|---|---|
| Dead zone | 0.125 lines (~2.6px) | 30px accumulated |
| Accumulation | None — single-sample delta | Yes — builds over scroll events |
| Short-view guard | None — `scrollPastEnd` padding guarantees range | `range >= 3 * totalShift` |
| Cooldown | None | 300ms |
| Sustain gate | None | 80ms (iOS) |
| Scroll event | `markdown-scroll` (CM6-level) | Passive `scroll` listener |
| Visual hide | CSS class (`is-hidden-nav`) | CSS class + inline styles + WAAPI |
| Layout changes | Header + navbar transform only | Header + navbar + toolbar + search + gap fill |

### Native tap shield (empirically verified, Android Pixel 8a, 2026-04-02)

Native Obsidian does NOT reposition the header or add special classes for tap interception. The header stays at its natural CSS layout position — `transform` and `opacity` only affect visual rendering, not hit-testing.

**Bars-hidden header state** (no inline styles, no special classes):

| Property | Value |
|---|---|
| `position` | `fixed` |
| `top` | `0px` |
| `margin-top` | `46.095px` (safe-area-inset-top) |
| `height` | `44.38px` |
| `transform` | `translateY(-90.095px)` (shifted fully off-screen) |
| `opacity` | `0` |
| `pointer-events` | `auto` (unchanged from bars-shown) |
| `z-index` | `1` |
| `min-height` | `0px` |
| Visual rect | `top: -44, bottom: 0.4` (off-screen) |

**Hit-testing**: Chromium hit-tests `position: fixed` elements against their pre-transform **layout box**, not the post-transform visual rect. Layout box: `top: 0` + `margin-top: 46px` + `height: 44px` = **y=0 through y=90**. `elementFromPoint` confirms: y=0–90 returns `.view-header`, y=91+ returns `.cm-line` (scroll content).

**Mechanism**: The header's `touchend` / `mousedown` listener fires `restoreNavigation()`. No repositioning, no min-height inflation, no z-index changes. The invisible header at its natural layout position IS the tap shield.

**Dynamic Views equivalent**: `min-height: calc(safe-area-inset-top + view-header-height)` on `.view-header` during `full-screen-active` matches this 90px zone. The `dynamic-views-tap-shield` class adds `margin-top: 0` (overrides Obsidian's safe-area margin so shield starts at y=0), `transform: translateY(0)` (returns to layout position), and `z-index: 30` (above `::before` scrim at z-index 10/25 and scroll content). `pointer-events: none` on the base `full-screen-active` rule prevents the inflated header from intercepting toolbar taps during the show phase — only the tap-shield class restores `pointer-events: auto`.

### Restore triggers

Native Obsidian restores bars on:

- `mousedown` on `window` — unconditional, no velocity check (see below)
- `keyboardWillHide` event
- `active-leaf-change` (tab switch)
- `autoFullScreen` config changed to false

### Decompiled `mousedown` handler (v1.12.7, `app.js` line 169154)

```javascript
window.addEventListener("mousedown", function () {
  return t.restoreNavigation(!0);
});
```

Unconditionally calls `restoreNavigation(true)` on ANY `mousedown` anywhere in the window. No velocity check, no scroll state check, no guard of any kind.

### Emergent velocity discrimination

Native appears to "ignore" status bar taps during fast scroll and "respond" during slow scroll. This is emergent, not explicit — no velocity-aware code exists.

**Fast momentum**: `mousedown` → `restoreNavigation()` → `is-hidden-nav` removed (bars appear). But the next `onScroll` event fires within one frame (~16ms) with a positive delta above the 0.125 dead zone → `hideNavigation()` → `is-hidden-nav` re-added. The re-hide happens before the CSS transition renders a visible frame. The flash is invisible.

**Slow/dying momentum**: `mousedown` → `restoreNavigation()` → bars appear. The next scroll event has a delta below 0.125 lines (dead zone) → no action. Bars stay visible.

**Stationary**: `mousedown` → bars appear. No scroll events → bars stay.

The 0.125 line-unit dead zone IS the velocity discriminator. At default theme line height (24px on Android, similar on iOS): `0.125 × 24 = 3px`. Scroll events with per-event delta below 3px are considered dying momentum and do not trigger re-hide.

### Why Dynamic Views cannot copy this 1:1

Native's emergent approach relies on each scroll event independently deciding hide/show with no cooldown, no accumulator, and no sustain gate. Dynamic Views' scroll handler requires these guards because:

- **Accumulator + 30px dead zone**: Prevents toggling on tiny jitter deltas. Native's 0.125-line dead zone is sufficient because CM6 scroll events are smoother than raw passive `scroll` listener events.
- **300ms cooldown**: Prevents rapid hide/show cycling during deceleration. Native doesn't need this because its CSS-only transitions (class toggle) are cheap. Dynamic Views has WAAPI animations, bridge architecture, and inline style management that make rapid cycling expensive and visually jarring.
- **80ms sustain gate (iOS)**: Filters iOS deceleration bounce (reverse-direction noise at momentum end). Native doesn't fire `markdown-scroll` during bounce, so it's not exposed to this.

Stripping these guards to match native would reintroduce rapid cycling and bounce bugs. The deferred-timer approach on `onHeaderTap` achieves the same user-visible behavior without touching the scroll handler (see `architecture/full-screen.md` § "Header tap intercept").

### Short-view strategy

Native relies on CM6's `scrollPastEnd` extension adding ~50% viewport height as `padding-bottom` on `.cm-content`. Even a 1-line file has enough scroll range. No explicit short-view guard exists — if a view truly can't scroll, scroll events never fire and bars stay visible implicitly.

Dynamic Views card views use `margin-bottom: var(--view-bottom-spacing, 0px)` which only accounts for navbar + safe area (~84px), insufficient for full-screen scroll range on short views. The `range >= 3 * totalShift` guard prevents entering full screen when scroll range is too small.

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

These are layout changes (reflow), which cause scroll interruption. Markdown views don't need them. Native full screen works in markdown because content reflow is minimal (just header/navbar transform). In Bases views, toolbar collapse + gap reclamation amplifies jank to unacceptable levels.

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
- **WebKit caveat (v87)**: fires at finger-lift, BEFORE momentum begins — NOT at true scroll-idle. Layout mutations at `scrollend` still kill momentum. **Re-test candidate**: MDN spec says `scrollend` fires "when scrolling definitively completes" including after momentum. If WebKit aligned with spec in 26.2+, this could replace the 150ms idle debounce for more precise settle timing. Worth re-testing empirically.

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
- **`scroll-state()` container queries**: `scroll-state(stuck/snapped/scrollable)` shipped Chrome 133. `scroll-state(scrolled: top/bottom)` (direction detection) ships Chrome 144. WebKit standards-positions issue #261 open since Sept 2023 — zero WebKit engagement, no bugs filed, not in Interop 2026. Earliest plausible WebKit support: Interop 2027 cycle at best.
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

**Correction (v106)**: Native Obsidian full screen DOES hide the status bar bg — `is-hidden-nav` CSS handles it. Earlier conclusion that `.app-container` bg "cannot be animated" was wrong. The fix is to add `is-hidden-nav` immediately (not defer it). v78–v80 findings below apply to custom CSS approaches only, not to the native class toggle.

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

Even when `full-screen-active` class toggle and `scrollTop` adjustment are synchronous in the same JS frame, WebKit may render them in separate composites — producing a visible scroll position jump.

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
- **`:has()` in full-screen CSS**: `:has()` selector on ancestor causes upward style invalidation when descendant class changes during momentum scroll. WebKit re-evaluates the `:has()` ancestor chain, which kills UIScrollView momentum. Inline styles (no selector matching) survive. Fix: use inline `setProperty()` or pre-set classes, never `:has()` on elements that change during scroll.

### Status bar requirements (v132b)

v132b confirmed the three required ingredients for iOS status bar update:

1. `margin-top: 0` on `.view-content` (layout position at y=0)
2. Toolbar flow collapse (`margin-bottom: -52px` on `.bases-header`) — without this, the invisible-but-in-flow toolbar sits at y=0 instead of the scroll container
3. Ancestor `background-color: var(--background-primary)` on body, `.app-container`, `.workspace`

All three must be applied via CSS class, not `is-hidden-nav`. `is-hidden-nav` was designed for markdown views without a toolbar between header and content.

### Scroll child bridge: Pareto optimum (v139–v144)

The best achievable architecture for full screen on iOS:

1. **HIDE (immediate, momentum-safe)**: `translateY(+totalShift)` bridge on scroll child + `full-screen-active` class toggle. No `scrollTop` writes.
2. **IDLE (150ms debounce)**: Remove bridge + `scrollTop -= totalShift`. Safe at idle (no momentum).
3. **SHOW pre-settle**: Remove bridge + remove class. No `scrollTop` write needed.
4. **SHOW post-settle**: Reverse bridge `translateY(-totalShift)` + remove class. Idle: `scrollTop += totalShift`.

The bridge produces zero visual jump MOST of the time but has **intermittent minor jumps from scroll viewport clipping artifact**. The scroll container resizes (grows taller from margin removal + toolbar collapse), and the bridge's `translateY` on the scroll child creates a visual discontinuity at viewport edges.

**Root cause (confirmed via WebKit source)**: WebKit runs momentum scroll on a dedicated scrolling thread (UIScrollView), separate from the main thread. The scrolling thread and main thread synchronize via a commit handshake during display refresh. When the main thread changes scroll container geometry (margin removal, toolbar collapse), the scrolling thread continues decelerating with **stale bounds** until the next synchronization commit. WebKit Bug 218676 (changeset r269558, Simon Fraser) fixed this for **programmatic scrolls** by immediately committing geometry via `requestScrollPositionUpdate()`. But passive momentum deceleration has no equivalent path — no `requestScrollPositionUpdate()` is triggered. The stale-geometry window between main-thread layout and scrolling-tree commit is where the intermittent jump occurs. No CSS property (`contain`, `content-visibility`) prevents scrolling-tree geometry propagation. See `webkit-compositor-constraints.md` for the broader constraint catalog.

### Pareto frontier

A [Pareto frontier](https://en.wikipedia.org/wiki/Pareto_front) is the set of solutions where improving one objective requires degrading another. For full screen on iOS WebKit, the three objectives are:

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

The `overflow-anchor` CSS property will resolve this by handling scroll position compensation at the compositor level. Feature-detect with `CSS.supports('overflow-anchor', 'auto')`.

**`overflow-anchor` timeline (updated 2026-04-02)**: In WebKit trunk since Dec 2023 (`CSSScrollAnchoringEnabled`, commit `b19a8ec`). STP 239 (March 2026) still fixing shipping blockers — blank pages after dynamic content load (commit 308352) and negative scroll offsets (commit 308320). Not shipped in any Safari through 26.5. Rejected from both Interop 2025 and Interop 2026 (issues #826, #793). No external pressure accelerating release. Earliest plausible: Safari 27 (fall 2026), but could slip to a 27.x point release. **Tested iOS 26.4 (2026-04-02)**: intermittent jump unchanged — confirms Apple has not broadened the geometry commit path for passive momentum deceleration.

### Measurement ordering bug (v133–v137)

The `totalShift` measurement toggles the `full-screen-active` class and reads `getBoundingClientRect().top` before/after. In v133–v137, this measurement ran BEFORE the `<style>` element defining the class rules was inserted into the DOM. Result: `totalShift=0`, no bridge compensation. Always insert CSS before measuring.

### Mount-time `totalShift=0` bug

`getBoundingClientRect` at mount time returns 0 when `[data-type='bases']` CSS selectors don't match at construction time — the leaf hasn't received its `data-type` attribute yet, so the `full-screen-active` class toggle produces no layout change. Fix: `measureTotalShift()` method re-measures from live DOM (`getComputedStyle(viewContent).marginTop + toolbar.offsetHeight`). Called at guard evaluation time and inside `hideBarsUI()`. Gated on `!body.classList.contains('full-screen-active')` — otherwise `marginTop` reads as 0 from the class rule.

### scrollTop writes are unconditionally fatal (v145)

v145 confirmed: `scrollTop` writes in the same synchronous tick as `classList.add()` + instant layout changes still kill momentum. The compositor sync from `scrollTop` is a separate, non-cancelable operation that cannot be masked by batching with other changes. This strengthens v96's finding and closes the `scrollTop`-during-momentum approach permanently.

### Short-view guard

Views with insufficient scrollable range must not enter full screen — hiding bars increases viewport height by `totalShift`, shrinking the scrollable range. If the pre-hide range is too small, the post-hide range leaves near-zero scroll distance, causing immediate show-trigger or unusable scroll.

Empirical data (iPhone 13, 3 cards): `scrollableRange=352`, `totalShift=150`, post-hide range = `352 - 150 = 202`, remaining meaningful scroll = `202 - 150 = 52px` (below show dead zone threshold). With the 2x guard (`range >= 2 * totalShift`), hide was allowed but scroll felt broken. The 3x guard (`range >= 3 * totalShift = 450`) correctly blocks hide — `352 < 450`, no full screen.

Guard is evaluated only when `accumulatedDelta > FULL_SCREEN_HIDE_DEAD_ZONE && !barsHidden` — not on every scroll event.

### Bridge-less Android path

Chromium's compositor-based scrolling is fundamentally different from iOS WebKit — `scrollTop` writes during active scroll do NOT kill the scroll. This enables a much simpler architecture on Android: class toggle + `scrollTop` adjustment in the same synchronous tick, no bridge, no deferred settle.

**Hide path**: Pin header at visible position (inline styles) -> `full-screen-active` class toggle -> `scrollTop -= totalShift` -> `settled = true`. WAAPI `element.animate()` for header + navbar in rAF. Height relock deferred to idle.

**Show path**: CSS `full-screen-showing` restores header INSTANTLY via `!important` transform/opacity rules (matching iOS CSS-driven behavior). Android-specific CSS overrides defer margin-top, toolbar, and search row restoration to idle — prevents the 99px gap flash. Navbar animates via WAAPI. `showBridgeActive` flag signals hide/idle that scrollTop wasn't adjusted during show. At idle (500ms), class removal restores defaults + scrollTop compensation.

**Key empirical findings**:

- **White flash on direct class removal**: `classList.remove('full-screen-active')` on show causes a white flash — Chromium renders intermediate layout states within a single synchronous tick. The 99px `margin-top` gap appears as a white strip before `scrollTop` compensation takes effect. The `full-screen-showing` CSS override (higher specificity) avoids this by restoring bars visually without removing the layout class.
- **`programmaticScroll` deadlock**: `programmaticScroll = true` blocks ALL scroll events in `onScroll`. If not cleared promptly (via rAF), the idle timer never fires and `pendingLayout` never runs — bars can only hide once. The rAF clear is load-bearing.
- **iOS bottom-settle (superseded)**: The `translateY` bridge made the last `totalShift` px unreachable until settle (false bottom). The `margin-top` bridge (v146) eliminates this — `scrollHeight` adjusts in sync with visual displacement. Bottom-settle workaround removed.
- **`scrollTop +=` costs 22-26ms on show path**: Forced synchronous layout from `scrollTop += totalShift` exceeds one frame budget (16.67ms at 60fps). Measured via `performance.now()` on Pixel 8a. Root cause was the 99px gap, not scrollTop — fixed with CSS-based instant header restore.
- **CSS transitions drop 4-8 frames during hide**: Obsidian's native `transition: opacity 0.2s, transform 0.3s` on `.view-header` fires during `full-screen-active` class change, competing with scroll compositor. Frame gap data: 30-55ms gaps scattered throughout the 300ms animation window (not front-loaded).
- **WAAPI replaces CSS transitions**: `element.animate()` for navbar (both directions) and header (hide only). On the show path, the Android header is CSS-driven (`!important` transform/opacity in `full-screen-showing`) — WAAPI is not used. WAAPI cannot override `!important` CSS declarations (lower in the cascade) — Android CSS rules split to exclude transform/opacity, which are JS/WAAPI-controlled. `fill: 'forwards'` holds final frame (`onfinish` removed — `fill: forwards` is sufficient).
- **Split CSS rules**: iOS keeps `!important` transform/opacity in `full-screen-active`/`full-screen-showing` CSS. Android CSS only sets `pointer-events` + `transition: none` — transform/opacity controlled entirely via JS/WAAPI.
- **`will-change` pre-promotion**: `will-change: transform, opacity` on header (CSS, `.is-android` scoped) and navbar (inline at mount) pre-promotes to compositor layers, eliminating first-transform layer promotion stall.
- **Height relock deferred to idle**: `offsetHeight` forced layout moved out of the 300ms animation window to idle settle. When done in a nested rAF during animation, it caused mid-animation jank.

### WebView single-threaded compositor

**Observed**: 2026-03-27, Pixel 8a (Android WebView)

Android WebView uses a synchronous compositing model where the impl thread and UI thread are the same thread. There is no separate compositor thread for scroll and animation to run on independently. This is architecturally different from desktop Chrome (separate impl thread) and iOS WKWebView (separate render server process).

CSS transitions during active scroll compete with scroll processing for the same frame budget on the same thread, causing 30-55ms frame gaps scattered throughout the animation. WAAPI (`element.animate()`) gets somewhat better compositor scheduling but doesn't fully eliminate the contention — it's an architectural limitation, not a fixable bug.

Sources: Chromium WebView threading docs, synchronous compositing design doc, Chromium issue #40817676 (WebView performance slower than PWA), #40400865 (proposal to move WebView compositor to GPU thread). Facebook built a custom Chromium-based WebView to bypass this limitation.

### Android show flash investigation

**Observed**: 2026-03-27, Pixel 8a (Android WebView).

**Root cause**: When `full-screen-showing` restores `margin-top: 99px` on `.view-content`, it creates a gap above the scroll container. On Android WebView's single-threaded compositor, the header WAAPI animation (starting from opacity:0) may not cover this gap on the first rendered frame — a timing race causes intermittent white flash ("nearly every other reveal").

**Diagnostic evidence**:

- Magenta scrim (z-index 99999, position fixed) was NOT always visible during flash — 3 states observed: no flash, full-screen magenta, top-third red. Never both colors simultaneously.
- Red diagnostic background (replacing theme color on body/app-container/workspace) confirmed flash IS our background showing through the 99px gap.
- The intermittent pattern = timing race on single-threaded compositor.

**Failed approaches**:

1. Idle delay 150→500ms — fixed WAAPI cancel-before-complete, show flash persists
2. `:not(.full-screen-showing)` scoping on mask-image/::after — fixed bottom gradient, show flash persists
3. Removed `onfinish` callbacks — fixed cascade blocking, show flash persists
4. Start-before-cancel WAAPI ordering — eliminated cancel gap, show flash persists
5. Background-color NOT scoped to `:not(.full-screen-showing)` — prevents transparent intermediate, show flash persists
6. Reverse bridge `margin-top: -totalShift` — eliminated forced scrollTop layout, show flash persists
7. Batching class toggle + bridge + WAAPI into same rAF — eliminated inter-frame gap, show flash persists
8. `visibility:hidden` → `opacity:0` + `will-change:opacity` on toolbar — kept compositor layer cached, show flash persists
9. Deferred `capacitorStatusBar?.show()` to idle — moved system UI change, show flash persists
10. Defer ALL layout to idle with Android CSS overrides — eliminated gap flash BUT toolbar/search pop in 500ms later. User rejected.

**Fix**: CSS-based instant header restore on Android. `full-screen-showing` sets `transform: translateY(0) !important` + `opacity: 1 !important` on the Android header (matching iOS behavior). The header covers the 99px gap instantly — no timing race with WAAPI first frame. WAAPI still used for navbar (bottom bar). Header hide WAAPI still works because `full-screen-showing` is removed before hide animations start.

Android-specific CSS overrides also keep margin-top at 0 and toolbar/search hidden during the show state — these restore at idle when `full-screen-active` is removed. The `::before` gradient stays active during show on Android to cover the status bar area.

**Misidentified element lesson**: The handoff described the issue as 'toolbar/search' but the actual broken element was the header (view-header/title bar). This led to an unnecessary fix cycle (full-screen-showing class, CSS platform split) targeting the wrong elements. Always verify which specific element is broken with the user before implementing a fix.

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
| v132b | Control: faithful v112 reproduction (animated bridge, `full-screen-active` class, no `is-hidden-nav`) | Status bar confirmed working. Validates that toolbar flow collapse + ancestor bg-color + margin:0 are the required ingredients. Content jump present (same as v112). |
| v133-v137 | Measured bridge + animated/idle settle | `totalShift=0` — measurement ran BEFORE `<style>` element insertion. All bridge values were zero. No compensation applied. |
| v138 | v137 fix: style insertion before measurement + setTimeout animated bridge | Animation fires correctly (`totalShift=151`). Perceived 2x scroll speed during 300ms bridge animation — bridge settle compounds with ongoing scroll velocity. |
| v139-v140 | Hold bridge until idle settle (no animation) | Content position correct most of the time. Intermittent minor jumps from scroll viewport clipping artifact. Best result so far. |
| v141 | scrollTop drift detection during hide | No drift detected (scrollBefore === scrollAfter on every hide). Eliminates auto-scrollTop-adjustment hypothesis. |
| v142 | Anti-flicker: 300ms cooldown + hysteresis (hide 30px / show 50px) + zero-reset accumulator | Cooldown works (events 600-800ms apart). Rapid cycling eliminated. Minor jumps persist. |
| v143 | Cached totalShift — no forced reflow in hide path | Eliminates getComputedStyle/offsetHeight during hide. Minor jumps persist. |
| v144 | Inline `transition: none` on view-content before class removal | Prevents margin-top transition on show. Minor jumps persist. |
| v145 | scrollTop correction in same sync tick as layout change (no bridge) | Momentum killed instantly. Confirms scrollTop writes are unconditionally fatal — even batched with layout changes. |
| v146 | `margin-top` bridge on scroll child (replaces `translateY` bridge) | Replaces `translateY(totalShift)` with `margin-top: totalShift` on `.dynamic-views-bases-container`. Unlike `translateY`, `margin-top` adjusts `scrollHeight` in sync with visual displacement — eliminates false top/bottom at scroll boundaries. Reverse bridge initially used `margin-top: -totalShift` for settled show path but was removed on iOS — settled show relies on natural downward content shift as bars reappear (same as Safari address bar behavior). The reverse bridge remains in use on the Android show path, where `scrollTop += totalShift` exceeded one frame budget on Pixel 8a. Adaptive auto-show zone (`totalShift` threshold when bridge active + upward scroll) prevents false top gap from becoming visible. |
| — | CSS transitions (300ms, inline `style.transition`) on Android | 30-55ms frame gaps scattered throughout animation — main-thread style recalc every frame competes with scroll processing on WebView's single-threaded compositor. |
| — | Double-rAF animation start on Android | Absorbs scroll frame tail but doesn't help — contention is throughout the 300ms animation, not just at start. |
| — | `will-change: transform` alone on Android | Reduces per-frame paint cost (layer pre-promotion) but doesn't solve thread contention — compositor and scroll share the same thread on WebView. |
| — | WAAPI with inline `!important` set simultaneously | No animation visible — inline `!important` styles override WAAPI animation effects in the cascade. Fix: remove inline `!important` before `.animate()`, set persistent state via `onfinish`. |
| — | Reverse bridge (`margin-top: -totalShift`) on Android show | Eliminated forced scrollTop layout (22-26ms) but flash persisted — root cause was the 99px gap, not scrollTop. |
| — | Batch class toggle + bridge + WAAPI into single rAF on Android | Eliminated inter-frame gap between CSS activation and WAAPI start but flash persisted. |
| — | `visibility:hidden` → `opacity:0` + `will-change:opacity` on toolbar/search | Kept compositor layer cached for opacity flip but flash persisted — root cause was the margin gap, not rasterization. |
| — | Defer ALL layout to idle (Android CSS overrides) | Eliminated 99px gap flash but toolbar/search restored 500ms later. User rejected — worse than original. |

## Navbar hide behavior

### Native animation corrected (v72)

v58's conclusion that `is-hidden-nav` is instant was wrong. v72 instrumentation revealed native Obsidian DOES animate navbar hide — `transform 0.3s ease-out` + `opacity 0.2s ease-out` for BOTH hide and show directions. v58's `is-hidden-nav` toggle appeared instant due to WebKit's passive scroll listener optimization collapsing transition+target into a single style recalculation (see "Double-rAF pattern" above), not because native hide is unanimated.

- **Transform range**: 0 to 86px
- **`margin-bottom`**: Stays constant at 32px — no layout reclaim animation
- **Both directions animated**: Same `transform 0.3s ease-out` + `opacity 0.2s ease-out` for hide and show

### Animated hide (v84)

v84 correctly separates concerns: CSS class handles layout changes only, inline styles handle compositor animation (transform + opacity) via double-rAF pattern. No `translateY` in the initial animation frame — with ease-out, 86px of translation moves the element below the viewport in the first few frames. Show direction reverses the inline styles with matching transitions.

## Chrome/146 Android show flash

Empirical findings from investigating the Android WebView show flash on Pixel 8a, Vanadium WebView 146.0.7680.164 (first installed 2026-03-17). Web research confirmed no mask/compositor changes in the Chrome 146 release notes — the flash was always latent and surfaced from unrelated compositor timing changes. Confirmed empirically: the flash exists at commit 4362f15 (the commit that originally fixed it) with a full checkout — the same code that fit within the frame budget on the prior WebView version now exceeds it. Vanadium WebView 146.0.7680.164 was first installed 2026-03-17 on the test device.

### Compositor render surface lifecycle (mask-image)

- **`mask-image: none` destroys the compositor render surface** (~66MB GPU texture). Restoring the CSS gradient forces full subtree rasterization into a newly allocated surface.
- **Swapping between two gradient values** keeps the surface allocated — only the mask texture updates.
- **Applies regardless of timing** — show rAF, idle, nested rAF all flash when using `none`.
- **Obsidian's gradient**: `linear-gradient(to top, rgba(0,0,0,0.5) 0%, rgb(0,0,0) 36px)`.
- **Fix**: `OPAQUE_MASK` constant (`linear-gradient(rgb(0,0,0),rgb(0,0,0))`) on hide, cached gradient on show.

### scrollTop writes flash on Chrome/146

- **ANY `scrollTop` write triggers scroll layer tile re-rasterization** on Chrome/146 WebView.
- **No safe timing window** — synchronous, rAF, nested rAF, idle all flash.
- **Symptom**: Content disappears for one frame during tile re-rasterization, exposing `.workspace` background.
- **CSS background color override** masks the color but NOT the content blink.
- **Also kills Chromium flings**: Beyond the visual flash, ANY `scrollTop` write during an active Chromium compositor fling cancels the fling entirely, regardless of height lock state or whether other style invalidation is pending. The `scrollTop` write's forced layout is a separate, non-cancelable operation. This extends the iOS constraint (scrollTop kills momentum) to Android during flings.
- **Two-frame show pipeline**: Moving `setAttribute('data-dynamic-views-show')` from inside the rAF to synchronous (before the rAF) lets the scrim paint in the frame between the scroll event and the rAF. All expensive work (margin-top, scrollTop, WAAPI, clearHeaderInlines) runs behind the already-painted opaque scrim.
- **scrollTop confirmed as sole root cause**: Disabling the scrollTop write, height unlock, and `restoreMaskImage()` in the show rAF eliminates the flash entirely. The forced layout from `scrollTop` triggers a full scroll layer repaint — content disappears for one frame, exposing the `.workspace` background.
- **Fix**: Persistent `transform: translateY()` bridge defers all `scrollTop` writes to the next hide cycle, where they're batched with `full-screen-active` removal (no flash on hide).

### Custom property inheritance cost

- **Custom properties on an ancestor inherit to ALL descendants** — each property change marks every descendant for style recalc.
- **With ~100 card elements**, even 3-4 custom properties exceed Chrome/146's frame budget during show.
- **Fix**: `data-dynamic-views-show` attribute — attribute changes only trigger recalc for selectors containing `[data-dynamic-views-show]` (zero descendant invalidation).

### Layout inside vs outside scroll container

- **Layout changes OUTSIDE the scroll container** (viewContent margin-top, toolbar expansion) just reposition the container — no tile invalidation.
- **Layout changes INSIDE** (margin-top on container, scrollTop, height unlock) force scroll layer tile re-rasterization.
- **Negative `margin-top` on container inside scroll also flashes**: `margin-top: -totalShift` on the container (inside `.bases-view`) triggers the same raster invalidation as `scrollTop` — confirmed empirically when the reverse bridge approach was tested inside the scroll container.
- **`transform` on scroll child is compositor-only** — tiles are reused and repositioned on GPU.
- This distinction is key to understanding why the persistent transform bridge works.

### classList vs inline style recalc

- **`classList.add/remove`** triggers selector matching across ALL rules in ALL stylesheets.
- **`style.setProperty()`** bypasses selector matching entirely — only triggers recalc for the target element.
- On Android WebView's single-threaded compositor, the difference is between staying within and exceeding the frame budget.
- **Fix**: `applyShowInlines()`/`clearShowInlines()` pattern.

### `:has()` upward invalidation

`:has(.is-grouped)` on `[data-type='bases']::before` scrim rules triggered upward style invalidation during `applyShowInlines()` that exceeded Android WebView's single-threaded compositor frame budget — same root cause as classList invalidation. Even though `:has()` only checks a single ancestor, the evaluation during the show transition's style recalc adds enough overhead to render an intermediate frame. Fix: replaced with a JS-toggled `dynamic-views-grouped` class on the leaf content element, set alongside the existing `is-grouped` class on the container in `grid-view.ts` and `masonry-view.ts`.

### WAAPI fill:forwards stacking

- **During WAAPI `fill:forwards`**, elements are promoted to their own compositor layers. These layers paint above non-promoted elements regardless of z-index.
- **When `cancelAnimations()` removes fill:forwards**, elements drop back to normal stacking. This can cause toolbar/search to suddenly appear behind an opaque scrim.
- **Fix**: Remove scrim `data-dynamic-views-show` attribute at idle to collapse scrim height.

### Tap-shield fling interaction

The `position: fixed` header with `pointer-events: auto` (tap shield) intercepts `touchstart` during momentum scroll, causing Chromium to cancel the compositor fling. A `pointer-events` toggle during scroll (set `none` on first scroll event, restore at idle) was attempted but regressed the show animation — the unconditional idle timer broke the `pendingLayout`-gated timing the show path depends on. Currently accepted as a known limitation.

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

## Multi-controller race on Android (v147)

**Observed**: 2026-04-02, Pixel 8a, two Bases masonry leaves open simultaneously.

**Root cause**: On Android, `classTarget` was `document.body` — shared between all `FullScreenController` instances. When Leaf 0's constructor ran while Leaf 1 had `full-screen-active` on body:
1. `classList.add('full-screen-active')` — no-op (already present from Leaf 1)
2. `getBoundingClientRect` before/after — identical — `totalShift = 0`
3. `classList.remove('full-screen-active')` — clobbered Leaf 1's hidden state
4. `measureTotalShift()` guard blocked by the foreign class on body — 0 persisted

Diagnostic state snapshot: Leaf 0 `totalShift: 0, totalShiftMeasured: true`, Leaf 1 `totalShift: 150.095`, both `isActiveHider: true`.

**Fix**: Unified `classTarget = leafContent` on both platforms (matching iOS). `applyBackgroundInlines()`/`clearBackgroundInlines()` now run on both platforms (leaf-scoped class cannot reach body/app-container/workspace). The "multi-threaded compositor" rationale for Android body-class was wrong — Android WebView uses a single-threaded compositor, so leafContent scoping actually reduces invalidation scope from ~3000 to ~360 elements.

## Direction detection

### Why touch gate failed

Early prototypes gated show on `touchstart` (require active finger to reveal bars). iOS consumes `touchstart` during momentum stops — the event fires but the finger-down that halts momentum is not reliably delivered as a separate `touchstart` before scroll events resume. The sustain gate replaced the touch gate entirely.

### Sustain gate on both directions

The 80ms sustain gate applies to BOTH hide AND show. Deceleration bounce produces brief reversals in both directions:

- **Scroll-down deceleration**: brief upward delta → false show trigger
- **Scroll-up deceleration**: brief downward delta → false hide trigger

Without the sustain gate on hide, rapid hide→show cycling occurred during fast downward scrolls.

## Settle architecture

### Pareto frontier confirmed

Three objectives cannot all be achieved simultaneously on iOS WebKit:

1. **Immediate status bar** — status bar bg updates in the same frame as bar hide
2. **No content jump** — zero visual displacement
3. **Preserved momentum** — iOS fling continues uninterrupted

The bridge + idle settle architecture (v144) achieves immediate status bar + preserved momentum with minor intermittent jumps. See "Pareto frontier" section above for the full analysis and comparison table.

## Diagnostic tools

- **Safari Web Inspector**: Connect Mac to iOS device, inspect Obsidian's WKWebView via Safari Develop menu. Use Layers tab for compositing reasons, paint flashing for repaint visualization, and Frames view for main-thread fallback detection.
- **Chrome DevTools MCP**: Use `evaluate_script` for runtime instrumentation on desktop (scroll event logging, `getBoundingClientRect` sampling, `getComputedStyle` reads). Use `list_console_messages` to retrieve diagnostic output.
- **Cleanup convention**: Each diagnostic IIFE must call `window.__cleanupFullScreen()` at the top before initializing. Cleanup is part of the script, not a separate manual step.
- **Listener leak** (v34 bug): anonymous scroll fallback never removed by cleanup. Always use named function references.
- **A/B isolation test**: Animate ONE target inside scroll container with anonymous `scroll(nearest)`, no `timeline-scope`. If smooth, topology/timeline-scope is the culprit.
- **Android WebView cache busting**: CDP reload (`Network.setCacheDisabled` + `Page.reload ignoreCache`) does NOT reliably bust Android WebView's stylesheet cache for CSS changes. Full restart (`am force-stop` + `am start`) + cache-busting reload is required for CSS bisects. Without this, A/B test results are unreliable.

## References

- headroom.js iOS issue #100 — documents iOS momentum-scroll jank as unsolvable
- WebKit Bug 218676 — programmatic scrolls need updated scrolling geometry (stale scrolling-tree root cause)
- WebKit Bug 171099 — scroll anchoring implementation tracking (resolved dup of 307734)
- WebKit Bug 303136 — scroll container compositor promotion
- WebKit Bug 303465 — threaded scroll-driven animations flag stabilization
- WebKit commit b19a8ec — `CSSScrollAnchoringEnabled` set to stable/default:true (Dec 2023)
- WebKit changeset r269558 — geometry commit fix for programmatic scrolls (does not cover passive momentum)
- WebKit standards-positions #261 — CSS Scroll State Container Queries (open, no WebKit signal)
- Interop issues #826, #793 — `overflow-anchor` rejected from Interop 2025 and 2026
- STP 239 — active `overflow-anchor` bug fixes (blank pages, negative offsets), March 2026
- Safari 26.4 blog — threaded scroll-driven animations on compositor thread
- Bram.us 2023 — `var()` in `@keyframes` compositor blocking
- Bram.us 2024 — scroll-driven animations direction hack (custom property, main-thread)
- Bram.us 2025 — `scroll-state(scrolled)` clean solution (Chrome 144 only)
- Chromium #1411864 — `var()` compositor blocking
- Lighthouse #14521 — `var()` compositor blocking
- WebKit commit 256893@main — `var()` spec-level main-thread requirement
- CSS Cascade Level 5 — animation/transition override semantics
- STP 234 — eligible properties for compositor-promoted scroll-driven animations
- Motion.dev 2025 — web animation performance tier list (CSS variable paint penalty, Safari Core Animation de-optimization)

---

## Spacer + overflow-anchor implementation era

Everything below documents the spacer approach that succeeded after 10+ failed iterations across 3 sessions (see §7.29, §7.32 for genesis). The architecture doc (`docs/architecture/full-screen.md`) captures the stable system design. This section captures the "how we got here" — iterations, dead ends, empirical measurements, and platform quirks discovered during implementation.

Source session reports: `e29bdfb4` (11 §7 items), `cdac40be` (61 §7 items), and the current spacer implementation session (95 §7 items). Items marked with `§7.N` reference the current session report for traceability.

### Mechanism

Insert a spacer `<div>` inside `scrollEl` (before the cards container). On show: expand spacer from 0 to `totalShift` height — `overflow-anchor` adjusts `scrollTop` automatically, no transform on any element. On re-hide: collapse spacer to 0 (anchoring adjusts back). Resolve at top: synchronous spacer collapse + `full-screen-active` class removal = visual no-op (spacer shift cancels margin+toolbar shift in one layout cycle). (§7.1, §7.29)

### `overflow-anchor` platform support

Chromium (Android WebView) since Chrome 56. NOT supported in any shipping Safari/iOS (as of March 2026) — only in Safari Technology Preview. The iOS path remains unchanged (bridge+settle). Risk: anchoring may not fire during an active fling (compositor-driven), but show triggers during deceleration. (§7.4)

### Why the spacer approach succeeded

The spacer eliminates the fundamental problem that defeated all prior approaches: **there is no resolve step**. The spacer IS real scroll content — expanding it during show creates true scrollable space above the cards, and collapsing it during hide removes that space. `overflow-anchor` handles the `scrollTop` compensation at the browser level. No transform bridge, no deferred layout, no `scrollTop` writes, no two-phase settle. The "no-resolve" constraint that killed spike v3 (§7.27) is architecturally absent. (§7.29)

## Transform bridge constraints (pre-spacer failures)

The spacer approach was adopted after exhausting transform-based bridges across 3 sessions. These findings document why transforms inside a scroll container with `overflow: auto` cannot work for bar hide/show.

- **Overflow clipping kills bridge on scroll child**: `translateY(-bridgePx)` on `.dynamic-views-bases-container` (inside `.bases-view`) shifts sticky group headers above `.bases-view`'s box top edge. `.bases-view`'s `overflow: auto` clips at layout-space boundaries BEFORE transforms apply (CSSWG #3186, confirmed by Tab Atkins). No counter-transform rescues already-clipped pixels. (§7.23)
- **Transform on scroll container breaks appearance**: Moving the transform to `.bases-view` itself causes toolbar bg to go transparent and a large white strip at the bottom (the transformed box shifts the entire visible region). (§7.23)
- **Sticky `offsetTop` returns displaced position**: Chromium reports the displaced stuck position for `position: sticky` elements, not the natural flow position. `getScrollSpaceTop(section)` with `position: relative` wrappers was also unreliable — the container's bridge transform creates a containing block that affects the `offsetParent` chain. (§7.24)
- **Flex-item z-index unreliable on Android WebView**: `z-index: 26` on a `position: static` flex child with `container-type: inline-size` does NOT promote in the parent stacking context. `position: relative` alongside `z-index` is required. Chrome 129 removed implicit stacking context from `container-type: inline-size` (CSSWG #10544). (§7.25)
- **Complete constraint chain for group headers inside transformed container (10 iterations)**: (1) Real header behind overlay (z-index 20 < 26). (2) Wrong visual position from `translateY(-bridgePx)`. (3) Outgoing clone in fixed overlay doesn't scroll. (4) Non-stuck tracked clones wobble from bridgePx smoothstep. (5) Immediate restore = ~52px flash. (6) Keeping header hidden = embracing the bug. 10 approaches tried: z-index lift, scrollEl transform, blanket counter-transform, geometry classifier, reverse compensation, inline top pinning, proxy heading shell, fixed viewport overlay, scrollport transform, overlay toolbar. (§7.26)
- **Spike v3 resolve approaches exhausted**: (1) WAAPI viewContent animation — visible 150px slide. (2) scrollTop compensation — visible teleport. (3) No-resolve (keep overlay permanently) — user trapped at false top. All fail because spike v3 defers the 150px layout shift to resolve time. (§7.27)
- **Flex container defeats inline height on scroll container**: `height: Npx !important` on `.bases-view` (flex child with `flex: 1 1 auto`) is overridden by the flex algorithm. `min-height: !important` makes scrollEl overflow its parent upward, painting cards over toolbar. (§7.28)

## Spacer-preserved hide (abandoned after 5 iterations)

Attempted to reuse the show path's spacer+overflow-anchor mechanism for the hide direction. Failed and reverted to a threshold guard approach.

### Core failure: overflow-anchor is asynchronous

`overflow-anchor` does NOT fire during synchronous forced layout reads. Tested both `scrollEl.scrollTop` getter and `scrollEl.offsetHeight` — neither flushes anchor adjustment in Chromium during the same microtask. Anchor adjustment fires after the current task completes, between frames (during the pre-paint lifecycle step). Empirical data: `beforeExpand=79.6, afterExpand(offsetHeight flush)=79.6`. (§7.39)

### Failed iteration sequence

1. **Single-frame expand+collapse**: Chromium batches spacer expand+collapse into one layout pass (net-zero anchor). No compensation occurs. (§7.39)
2. **Two-frame approach**: Frame 1 expands spacer (anchor fires between frames), Frame 2 (rAF) adds `full-screen-active` + collapses spacer. Fixed content shift but introduced navbar flash + white strip. (§7.39, §7.42)
3. **WAAPI cancel-before-start flash**: Calling `cancelAnimations()` before starting hide WAAPI removes show `fill:forwards`, flashing navbar to CSS base state for one frame. Fix: start hide WAAPI first (wins by composite ordering per WAAPI §4.6), then cancel old. (§7.40)
4. **Mask-image must swap immediately**: Deferring mask-image swap to idle leaves the show gradient visible as a white strip during hide WAAPI fade. Must swap to opaque in the synchronous portion. (§7.41)
5. **External layout change can't be compensated by internal anchor**: `full-screen-active` collapses margin OUTSIDE the scroll container — overflow-anchor only compensates changes INSIDE the scroll container. (§7.42)

### Resolution: threshold guard

Reverted to suppressing hide when `effectiveTop < totalShift` (accounts for spacer offset). Ensures `scrollTop` compensation never clamps, eliminating content jumps. Trade-off: user must scroll past ~150px from content top before hide engages — acceptable since hiding bars at the very top serves no purpose. (§7.37, §7.42)

### Diagnostic data

`totalShift=150` (margin ~47 + toolbar ~44 + search ~59). First hide at scrollTop=93 → target=0 (57px jump). Spacer hide: resolve is net-zero (scrollTop 111→111), subsequent hide still clamps (111 < 150 → 39px jump). Root cause confirmed: `max(0, before - totalShift)` clamps when `before < totalShift`. (§7.37)

### Deferred: permanent `full-screen-active` approach

A second opinion (§7.43) proposed applying `full-screen-active` at mount, never removing it. Both hide and show become symmetric spacer operations. Eliminates external layout change entirely. Requires CSS refactor: every rule gated on `full-screen-active` needs a second state indicator (`data-bars-hidden` or similar). Deferred to a dedicated session.

## Show overlay system

During spacer show, `full-screen-active` layout stays active (margin-top:0, toolbar collapsed). Toolbar and search row are repositioned as `position: absolute` overlays on `leafContent`.

### Overlay positioning

`leafContent` gets `position: relative` inline to guarantee it's the containing block. Toolbar and search row get `position: absolute` at `top: originalMarginTop`. (§7.3)

### `toolbarBgEl` pattern

WAAPI `opacity: 0→1` on the toolbar fades the entire element including its `background`. To keep the background opaque from frame 1 while content fades, a separate `toolbarBgEl` div at z-index 28 (below toolbar at 29) provides the opaque backing. After WAAPI completes (`fill:forwards` holds opacity:1), the toolbar's own background is visible — removing the bg element during resolve is a visual no-op. (§7.8)

### `toolbarBgEl` height measurement bug

`applyShowOverlays()` read `searchRowEl.offsetHeight` during `full-screen-active` when the search row has CSS `height: 0 !important` — always returned 0. The bg element only covered the toolbar, not the search row. Fixed by using `totalShift - originalMarginTop` (pre-full-screen measurement from `measureTotalShift()`). (§7.16)

### `toolbarBgEl` z-index during hide

`toolbarBgEl` at z-index 28 paints above the `::before` scrim (z-index 10 ungrouped / 25 grouped). During hide, the white background covers the scrim gradient. Fix: use spacer's own `background` inline for the hide cover — the spacer is INSIDE the scroll container, so the scrim `::before` (on leafContent, outside) paints above it naturally. (§7.44)

### `toolbarBgEl` stale position after resize

`applyShowOverlays()` guards creation with `if (!this.toolbarBgEl)` — on re-entry after resize, the existing element retains portrait-era `top` and `height`. Fix: explicitly `remove()` + null `toolbarBgEl` before re-applying overlays in `remeasureAfterResize()`. (§7.81)

### Toolbar/search vanish instantly on hide

WAAPI-fading toolbar/search overlays makes them float visibly over the scrim during the 300ms transition. Fix: call `clearOverlayBars()` immediately in the rAF (same frame as hide WAAPI start), removing absolute positioning. CSS `full-screen-active` rules (opacity:0, height:0, negative margin) take over instantly. Only header and navbar get WAAPI hide transitions. (§7.45)

### WAAPI fade removed from spacer show path

The bridge show path WAAPI-faded toolbar/search (opacity 0→1) to match layout restoration. The spacer path positions them as fixed overlays — no transition needed. `applyShowOverlays()` sets inline `opacity: 1` which snaps them opaque instantly. WAAPI was overriding this with a 300ms fade, making the background appear to animate from transparent. (§7.7)

### View-header tap shield covers toolbar overlay

`clearHeaderInlines()` in the show rAF removes `min-height: 0` set by `applyShowOverlays()`, causing CSS rule `min-height: calc(safe-area + view-header-height) !important` (~90px) to take over. Header at z-index 30 covers toolbar at z-index 29 in the overlap zone (y=98–136). Fix: re-set `pointer-events: auto`, `min-height: 0`, and `z-index: 30` on the header AFTER `clearHeaderInlines()`. (§7.6)

### Header pointer-events during hide

Android CSS `full-screen-active .view-header` now has `pointer-events: none !important`. WAAPI `opacity:0` hides visually but doesn't block interaction — children still receive taps at status bar y-coordinates. Show path and tap-shield settle override with inline `pointer-events: auto !important`. (§7.13)

### Keyboard dismiss on hide

`hideBarsUI()` calls `activeElement.blur()` at the top to dismiss the soft keyboard. Uses `scrollEl.ownerDocument.activeElement` for popout safety. (§7.11)

### Live search height in show rAF

`totalShift` is measured once at mount. If search row is `display:none` at mount, `totalShift` excludes its 44px height. The show rAF computes `effectiveShift = originalMarginTop + toolbarEl.offsetHeight + searchRowEl.offsetHeight` after setting `height:auto !important` on the search row. One forced layout read per show — flushes inlines, acceptable since all writes complete before frame paint. (§7.18)

### Search-during-show interactions

- **Group header occlusion**: When search opens mid-show, `applySpacerHeadingTops()` has already used an `effectiveShift` excluding search height. Fix: `ResizeObserver` on search row fires `syncShowLayoutForSearch()` when size changes during `spacerActive` — re-syncs spacer height, group header tops, and toolbarBgEl. (§7.34)
- **Search toggle triggers false hide**: Opening search resizes the spacer via `syncShowLayoutForSearch`, which triggers `overflow-anchor` scrollTop adjustment. The scroll handler reads this as downward user scroll and triggers hide. Fix: set `programmaticScroll = true` before spacer resize, reset in rAF after overflow-anchor settles. (§7.35)

### `padding: unset` resolves to initial, not inherited

CSS `unset` on non-inheritable properties (like `padding`) resolves to `initial` (= 0), not the stylesheet value. To restore Obsidian's native `padding: 4px 8px` on `.bases-search-row`, the inline must use the explicit value — `unset` and `revert` both fail. (§7.19)

### Dead bridge code removal

~300 lines removed in ae50b75: `BridgeOverlaySection`/`BridgeOverlaySnapshot` types, `bridgePhaseActive`/`lastBridgePx`/all overlay fields, `applyShowInlines`/`clearShowInlines`/`commitBridgeResolve`/`unwindBridge`/`snapshotBridgeOverlay`/`captureBridgeOverlay`/`syncBridgeOverlay`/`clearBridgeOverlay`. Guard simplified from `!bridgePhaseActive && !wasSpacerActive` to `!wasSpacerActive`. (§7.12)

### Hide-from-top content jump

When `hideBarsUI()` collapses the spacer within `full-screen-active` (class already ON), overflow-anchor adjusts scrollTop downward. If scrollTop is in the spacer zone (< effectiveShift), anchor can't push below 0 — content jumps. Fix: resolve spacer to normal state first (spacer collapse + class removal = net zero in one layout cycle via batched DOM mutations with no forced layout between them), then the regular hide path adds `full-screen-active` with correct `max(0, before - totalShift)` compensation. (§7.36)

### Spacer-preserved hide: Case A and Case B

Two cases in `hideBarsUI()` Android branch:

- **Case A** (re-hide from show, `wasSpacerActive`): Spacer and `full-screen-active` already in place — zero layout changes, just WAAPI-fade bars out. Overlay cleanup deferred to `pendingLayout` (NOT `onfinish` — `cancelAnimations()` during rapid cycling prevents `onfinish`). (§7.38)
- **Case B** (first hide): Insert spacer at `totalShift`, force layout read (`void scrollEl.scrollTop`) to flush overflow-anchor, then add `full-screen-active` + collapse spacer in same synchronous block. Forced layout critical — without it, Chromium batches expand+collapse (net-zero anchor). After the forced read, anchor has already inflated scrollTop by `totalShift`, so subsequent class+collapse is net-zero. No `scrollTop` write needed in either case. (§7.38)

### Plan audit findings

8 issues from plan audit (§7.5): Critical — descendant combinator invariant violation (fixed with inline styles). High — missing `position: relative` on leafContent (added to `applyShowOverlays()`), double scrollTop adjustment on re-hide (`wasSpacerActive` guard). Medium — `clearShowInlines`/`clearShowOverlays` confusion (conditional on `wasSpacerActive`), `commitSpacerResolve` missing timer cleanup, incomplete unmount cleanup (spacer-aware branch). Low — sentinel fallback value, WAAPI idle cancellation.

### `[data-dynamic-views-show]` descendant combinator invariant

Descendant combinator selectors after this attribute are prohibited (`_full-screen.scss:179-181`). Subtree-wide style invalidation exceeds single-threaded Android WebView compositor frame budget. Group header top during spacer show uses inline `top` on each heading+sentinel, NOT CSS rules. (§7.2)

### Static inline styles and Obsidian review

The `setStyle()`/`setStyles()` wrappers bypass the eslint rule syntactically (arguments are variables, not literals), but values are still static — `'auto'`, `'0'`, `'none'`, `'4px 8px'`. The justification for keeping them inline is cascade necessity (inline `!important` overriding CSS `!important`), not that they're "dynamic." The `[data-dynamic-views-show]` descendant combinator invariant prevents the CSS alternative for most of them. (§7.22)

### Dead code: `data-dynamic-views-hide-spacer`

Planned in step 2 of the implementation plan but never needed. The approach changed to spacer background instead of `toolbarBgEl` for hide cover — no absolute-positioned children exist during hide state, so the containing block is unnecessary. (§7.46)

## Show flash investigation (Grid-specific)

The show flash investigation spanned multiple diagnostic rounds and ultimately traced to CSS Grid paint invalidation — a compositor-level issue, not a style/cascade error.

### Symptom

On each scroll start in Grid (not Masonry), the header and status bar bg briefly flashes transparent before repainting. Occurs in both show transition and steady show state. User sees CARDS through the header area (not black/system bg, not a debug color). (§7.54, §7.65)

### Root cause reframing

The bug is "right element missed its paint slot because Grid stole the frame" (compositor starvation), not "wrong element painted transparent." Grid-specific concurrent work during scroll (content-visibility IO toggling, CSS Grid relayout, container-type evaluation on every card) starves the single-threaded Android compositor, causing the `::before` scrim to miss its paint slot. Masonry avoids this by disabling content-hidden on mobile (`!Platform.isMobile` vs Grid's `!Platform.isIosApp`). (§7.66)

### Root cause confirmed: CSS Grid paint invalidation propagates to `::before` scrim

`display: flex` eliminates the flash (no flash with flexbox). `contain: paint` on `.bases-view` (scroll container) fixes it while keeping CSS Grid. The paint invalidation chain: `.card` (Grid child) → `.dynamic-views-grid` → `.dynamic-views-bases-container` → `.bases-view` → `.view-content` → `leafContent` (where `::before` scrim lives). `contain: paint` on `.bases-view` breaks this chain. Masonry is immune because `position: absolute` + `contain: layout style paint` on cards prevents upward propagation. This is NOT a timing/JS issue — it's a CSS compositor behavior where Grid relayout during scroll invalidates ancestor pseudo-element paint on Android WebView's single-threaded compositor. (§7.67)

### Diagnostic rounds

1. **First round** (§7.56): At `showBarsUI` sync-start, `hasTapShield: false` but `headerOpacity: "0"` — WAAPI `fill:forwards` from prior hide still holding. Inline opacity:0 fix redundant in this state. Flash likely from `data-dynamic-views-show` attribute setting in rAF causing style recalc the compositor can't process in the same frame as WAAPI startup.
2. **Frame-by-frame** (§7.58): HIDE path — header at opacity:1, transparent bg for 239ms while scrim switches from 98px opaque to 46px gradient in same rAF. 46–90px gap completely see-through. WAAPI doesn't tick for 239ms (compositor stalled by Grid CSS layout recalc). SHOW path — computed styles correct from frame 0, but 70ms+ gaps between frames.
3. **Pre-measure + header bg cover** (§7.61): Computed styles ARE correct but user still sees flash. Compositor stall reduced from 239ms to 65ms on hide. Confirms issue is at **compositor paint level** — style engine has correct values but single-threaded compositor hasn't rasterized them.
4. **GPU layer promotion** (§7.62): `will-change: transform, background, height` + `contain: strict` on `::before` scrim — no effect. Rules out `::before` paint lifecycle as sole cause.
5. **Capacitor StatusBar** (§7.63): Monkey-patched show/hide to no-ops. Flash persists. Not the system status bar API.
6. **display: flex test** (§7.67): Flash eliminated entirely. Confirmed CSS Grid is the trigger.
7. **`contain: paint` fix** (§7.67): Breaks the invalidation chain at `.bases-view`. Flash eliminated while keeping CSS Grid.

### Complete ruled-out causes

(1) CSS cascade/specificity — computed styles correct. (2) `::before` scrim paint lifecycle — GPU layer promotion no effect. (3) Header transparent bg — white bg set, still flashes. (4) Forced layout read in rAF — pre-measure reduced stall 239→65ms, didn't fix. (5) content-visibility toggling — disabled, no effect. (6) Capacitor StatusBar API — disabled, no effect. (7) mask-image swap. (8) body/app-container/workspace bg. (§7.64, §7.68)

### Grid-vs-Masonry content-hidden asymmetry

`content-hidden` toggling is active on Android Grid (`!Platform.isIosApp`) but disabled on Android Masonry (`!Platform.isMobile`). Grid's `syncVirtualScroll` rAF fires in the SAME frame as the show rAF, toggling `content-visibility: hidden` on cards which forces expensive CSS Grid row recalculation. Amplifies compositor cost but isn't the direct root cause. (§7.60)

### Show flash in `showBarsUI`

`showBarsUI()` removes `dynamic-views-tap-shield` class synchronously before the rAF. After settle, WAAPI is cancelled (no `fill:forwards`). Removing tap-shield exposes the header at `opacity: 1` with transparent bg for ~16ms until the show rAF starts WAAPI. Fix: set inline `opacity: 0` + `transform: translateY(-headerShift)` BEFORE removing the class. (§7.55)

### Settle timing gap

After show→idle, `pendingLayout` only calls `cancelAnimations()` — no tap-shield added. After hide Case A→idle, `settleAndroidSpacerHide()` adds tap-shield. During rapid cycling (hide→show before idle fires), neither settle runs — WAAPI `fill:forwards` is the only thing maintaining visual state. (§7.57)

### Fix approach (two-pronged)

(1) SHOW: pre-measure `effectiveShift` before the rAF (temporarily restore search row dimensions, read, revert) so the rAF is pure writes + WAAPI. (2) HIDE Case A: set header `background: var(--dynamic-views-background-primary)` in the rAF before WAAPI — covers the 46–90px gap between gradient scrim and transparent header bg during compositor stall. (§7.59)

### `::before` scrim painting verification

Earlier tests falsely concluded the pseudo wasn't rendering. The production CSS (specificity 0,4,1 + `!important`) overrode debug styles (0,3,1 + `!important`). A test with specificity 0,5,1 confirmed the `::before` renders correctly. The hide-mode gradient (white→transparent on white bg) is nearly invisible, explaining the visual impression of "no scrim." (§7.53)

## Group header z-index + sticky top

### Sticky top during spacer show

Changed from `totalShift - viewPadding` to `totalShift`. During spacer show, toolbar/search are absolute overlays — the group header must clear them entirely, not tuck behind them. (§7.15)

**Correction**: §7.15 was itself corrected by §7.17. Chromium applies sticky `top` AFTER the scroll container's `padding-top`. Actual stuck viewport position = `scrollContainer.y + paddingTop + stickyTop`. For a scroll container at y=0 with 12px padding, `stickyTop = totalShift - viewPadding` produces visual position `0 + 12 + (totalShift - 12) = totalShift` — exactly the toolbar bottom. Changing to `stickyTop = totalShift` produced a 12px gap. The `-viewPadding` compensation is correct. The `viewPadding` field was NOT removed as dead code (correcting §7.15's claim).

### Group header top inline `!important` persistence

`applySpacerHeadingTops()` sets heading `top` with `!important` priority during show state. The CSS hide-state rule does NOT use `!important`. Every state transition exiting show MUST explicitly call `clearSpacerHeadingTops()` — CSS cascade alone cannot recover. Must be cleared in the hide rAF, not deferred to settle (~2s later). Case B's `applySpacerHeadingTops()` was dead code — overlays set and cleared in one synchronous rAF, browser only paints final state. (§7.47, §7.48)

### z-index 20 insufficient in full-screen hide

In normal mode, group header z-index 20 works (headers stick at `top: -12px`, rarely overlapping cards). In full-screen hide, headers stick at ~33px (inside scrim area), directly overlapping scrolling cards. z-index 20 vs cards at z-index auto should work per CSS spec, but empirically cards paint above headings on Android WebView. z-index 100 confirmed fix. Additionally, `.has-hover-card` on masonry containers lifts to z-index 21 during touch press, covering ALL headings. Fix: z-index 24 in full-screen hide — above interact elevation (21), below scrim (25). Root cause of why z-index 20 < auto in Chromium WebView is unknown. (§7.49)

### z-index must be phone-wide, not full-screen-specific

Before the first hide/show cycle, `full-screen-active` isn't on the element — the full-screen CSS override never matches. Fix: `.is-phone &` rule in `_grid-masonry-shared.scss` sets z-index 24 unconditionally on phone. Desktop keeps z-index 20 (hover elevation to 21 is intentional desktop UX). (§7.50)

### `.has-hover-card` must outlive the card out-transition

Card scale/translate transitions are 140ms (`--dynamic-views-anim-duration-fast`). Removing `.has-hover-card` immediately on touch end drops the container z-index from 21 to auto while the card visually animates back — group header clips the shrinking card. Fix: `deferContainerHoverDrop()` delays removal by 150ms and re-checks that no other card has `.interact` before removing. Applies to both hover (desktop) and touch press (mobile) off-callbacks. (§7.51)

## Scrim and mask-image

### Scrim view-bg scope

Only hide-mode scrims (ungrouped gradient, grouped opaque) should use `--dynamic-views-view-bg-color`. The Android show scrim (`[data-dynamic-views-show]::before`) expands to cover the full bars area — must stay `--dynamic-views-background-primary` to match header/toolbar chrome. iOS show removes the scrim entirely (`content: none`). (§7.20)

### Grouped scrim specificity override in show

The grouped hide scrim (specificity 0,6,2 from `body:not(.x).is-android.is-phone ... .dynamic-views-grouped::before`) overrides the show scrim (0,5,1). During grouped show, the hide rule's `--dynamic-views-view-bg-color` wins. Fix: add explicit `background: var(--dynamic-views-background-primary)` to the grouped show rule (0,7,2). (§7.21)

### Grouped scrim + sticky gate

The opaque `::before` scrim (z-index 25) hides sticky group headers scrolling under the status bar. When sticky is disabled via Style Settings, headers scroll normally — the ungrouped gradient scrim (z-index 10) is correct. All three grouped `::before` overrides in `_full-screen.scss` gated on `body:not(.dynamic-views-disable-sticky-group-header)`. (§7.9)

## WAAPI patterns

### Cancel ordering (WAAPI §4.6)

Starting a new animation before cancelling the old one avoids a one-frame flash. The new animation wins by composite ordering per WAAPI §4.6. Same pattern used for both show and hide paths. (§7.40)

### `fill:forwards` lifecycle + inline fallback

WAAPI `fill: 'forwards'` holds the final keyframe until `cancel()` is called. Idle path calls `cancelAnimations()` after ~2s, removing the WAAPI effect. Without inline `opacity: 1` as fallback, toolbar reverts to CSS `opacity: 0` (from `full-screen-active`). Fix: set inline `opacity: 1` in `applyShowOverlays()`. WAAPI overrides inline during animation (higher cascade priority per Web Animations spec), so the 300ms fade still works. After cancellation, the inline persists. (§7.10)

### `fill:none` snap-back

Setting inline `transform: translateY(-shift)` as a "backup" for a WAAPI animation causes a flash. When WAAPI ends with `fill: none`, element reverts to inline value for one frame before `onfinish` removes it. Fix: remove inline transform entirely — WAAPI's first keyframe provides visual compensation in the same compositor frame. (§7.31)

### `position: fixed` on leafContent is safe on phone

On mobile, `leafContent` fills the viewport. Even if an ancestor has `transform` (creating a containing block), the containing block IS the viewport-sized element. BCR coordinates match because leafContent origin = viewport origin on single-leaf phone layout. (§7.30)

## Android long-press / drag-drop

### Event sequence

`pointerdown → touchstart → (hold ~500ms) → contextmenu → pointercancel → touchcancel`. The `pointercancel` after `contextmenu` means NO synthesized `click` fires. Touch duration gate: `pointerdown` timestamp tracked per card, clicks suppressed if duration > 200ms. Dead zone (200–500ms) where neither file-open nor context menu fires — user sees touch press feedback only. (§7.69)

### Click synthesis root cause

`onHeaderTap` touchend handler was `passive: true` — can't call `preventDefault()`. When the group-header-forward path returns early, the click-eater timeout never runs. Browser synthesizes click ~300ms later. Fix: non-passive listener + `preventDefault()` at the top of `onHeaderTap` to suppress click synthesis on ALL paths. CSS `pointer-events: none` on Android hide header kept as defense-in-depth. (§7.14)

### File-open on long-press root cause

Stack trace: `openLinkText ← handleDrop (app.js:1333533) ← handleDrop (app.js:1070986)`. On Android, long-press on `draggable="true"` element initiates native drag. When finger lifts, browser fires `drop` at same location. Obsidian's workspace `handleDrop` interprets this as a link drop and calls `openLinkText`. (§7.72)

The full-screen tap shield sets `pointer-events: auto` on `.view-header` (z-index 30, ~90px from top), making it a valid native drag/drop target. `e.target` inside the header passes the `headerEl.contains(e.target)` check. Fix: `e.preventDefault()` on `drop` events hitting the view-header when `barsHidden`. `canDropAnywhere` is confirmed `false` on Bases views. Vanilla Bases cards don't have this issue because vanilla doesn't have a full-screen tap shield expanding the header's interactive area. (§7.74)

### Drag still initiates in hide mode

The fix only prevents the DROP from being interpreted as file-open. Native drag initiation (`draggable="true"` + `dragstart`) is not suppressed. Blocking drag initiation would require removing `draggable` entirely, breaking desktop drag-and-drop. (§7.90)

### Scroll-to-top during context menu

Diagnostic data shows scrollTop jumping 5625→0 with `barsHidden` flipping, but NO `showBarsUI`, `commitSpacerResolve`, or `scrollTop` setter trap fired. The scroll container was replaced (view recreation from accidental file-open) rather than scrolled programmatically. (§7.70)

### Vanilla Bases drag setup comparison

Vanilla uses `dragManager.handleDrag()` (app.js:171119) — functionally identical to DV's manual `setAttribute('draggable', 'true') + addEventListener('dragstart', ...)`. `handleDrag` sets `.draggable = true` (JS property, not HTML attribute) and registers dragstart without AbortController. Mobile drag lifecycle: `onDragStart` stores `dragStart = { evt, moved: false }`, adds window touchend listener. `onDragEnd` dispatches synthetic contextmenu if `!moved`. (§7.73)

## Android landscape / CSS safe area

### `env()` safe-area-inset-top oscillation during rotation

Android Chromium fires multiple `resize` events during orientation change. `--safe-area-inset-top` transitions through intermediate values: portrait→landscape goes 46→0→28 (transient 0 lasts ~600ms), landscape→portrait goes 28→46 (no transient). No fixed debounce reliably captures settled values. (§7.76, §7.87, §7.91)

### Falsy-zero fallback bug

`parseFloat('0px') || 47` → 47. Landscape `--safe-area-inset-top` is legitimately 0px during the transient overshoot, but `||` treats it as missing. `headerShift` computes as 91 (44+47) instead of 44. Fix: use `isNaN()` guard or `??` on parsed float, not `||`. Same issue for `--safe-area-inset-bottom`. (§7.77)

### DOM measurement replaces CSS variable reads

`viewHeaderEl.offsetHeight` and `navbarEl.offsetHeight` are deterministic regardless of CSS safe area variable oscillation. Eliminates both the falsy-zero bug and the oscillation issue. (§7.79)

### `viewContent.marginTop` takes >500ms to settle

Diagnostic data: `origMT: 98.09` at 500ms debounce vs `origMT: 52` when fully settled (landscape). Neither 500ms nor 1000ms debounce is reliable. (§7.80)

### `viewHeaderEl.offsetHeight` is NOT a valid proxy for `originalMarginTop`

Portrait delta = -9.81 (origMT=80.19, headerH=90), landscape delta = +8 (origMT=52, headerH=44). Using headerH as toolbar position in landscape puts it 8px too high — header clips toolbar. (§7.85)

### CSS `calc()` toolbar positioning (final solution)

`top: calc(var(--safe-area-inset-top, env(safe-area-inset-top, 0px)) + var(--view-header-height, 44px) + ${marginTopOffset}px)` — browser resolves at paint time using live CSS variable values. Toolbar oscillates in lockstep with the CSS-driven scrim `::before`, eliminating JS/CSS mismatch during rotation. `marginTopOffset` (empirically 8px) is invariant: `origMT = headerH + safeArea + 8` verified across portrait (98.09 = 44 + 46.09 + 8), landscape (80.19 = 44 + 28.19 + 8), and transient (52 = 44 + 0 + 8). (§7.84, §7.89, §7.92)

### `toolbarBgEl` height

Changed from `effectiveShift - origMT` to direct `toolbarH + searchRowH` — stable, no safe-area dependency. (§7.84)

### Resize handler architecture

`onResize()` instant fix (reposition overlays using headerH) only fires when `spacerActive && !barsHidden`. But if bars are hidden during rotation and user scrolls up to trigger `showBarsUI()` after, the show path uses cached stale values. Fix: `resizeSettling` flag (true from resize start until 2s verification pass completes) makes `applyShowOverlays()` use `viewHeaderEl.offsetHeight` as toolbar top during the settling window. (§7.82)

### `remeasureAfterResize()` must clear timers

Must clear `pendingLayout` + `scrollIdleTimer`. Without this, a pending settle from pre-rotation can fire during the 500ms resize debounce window with stale values, causing scroll position jumps. (§7.94)

### Measurement settling timeline (empirical)

Portrait origMT=80.19, landscape origMT=52 (settled). At 500ms debounce: origMT=98.09 (stale intermediate). At 2s: origMT=52 (settled). `viewHeaderEl.offsetHeight` settles immediately: 90→44. Relationship between origMT and headerH is NOT fixed: portrait delta = -9.81, landscape delta = +8. (§7.83)

## iOS vs Android platform differences

### Settle timing

iOS uses bridge+settle architecture (§7.4 — `overflow-anchor` not supported). Android uses spacer+overflow-anchor for show, threshold guard for hide. iOS has 80ms sustain gate on both directions. Android's show path fires during deceleration (overflow-anchor risk during active fling is accepted). (§7.4)

### WAAPI framing

On Android WebView's single-threaded compositor, WAAPI animations and scroll processing compete for the same frame budget. CSS transitions during active scroll cause 30-55ms frame gaps. This is architectural — not fixable. (See "WebView single-threaded compositor" section above.)

### `scrollTop` safety

iOS: `scrollTop` writes kill scroll in ALL states — active touch, momentum, idle (v96). Android: `scrollTop` writes during active Chromium fling cancel the fling (Chrome/146 finding). Both platforms: `scrollTop` writes at true scroll-idle (150ms debounce, no scroll events) are safe.

### Content-hidden asymmetry

Grid enables content-visibility IO on Android (`!Platform.isIosApp`) but Masonry disables it on all mobile (`!Platform.isMobile`). This asymmetry is the reason Grid triggers the show flash and Masonry doesn't. (§7.60)

## Diagnostic methodology

### Android logcat does NOT capture WebView `console.log`

`adb logcat` with any tag filter (`chromium:V`, `*:S`, unfiltered) does not surface JavaScript console output from Obsidian's Chromium WebView. Use CDP (`Runtime.evaluate` to read stored globals, or `Console.enable` + `Console.messageAdded` events). (§7.86, §7.93)

### Diagnostic attachment to wrong leaf

`getLeavesOfType('bases')[0]` returns the first leaf in DOM order, which may be an inactive tab with zero-dimension scrollEl. Must filter by `scrollEl.scrollHeight > 0` to find the active leaf. Caused three rounds of empty diagnostic logs. (§7.52)

### Paired diagnostic entries from dual FullScreenController instances

Both `grid-view.ts` and `masonry-view.ts` create separate `FullScreenController` instances, each registering its own `resize` listener. A single rotation fires both, producing paired log entries. Second entry in each pair has `headerH=91` (fallback) and `totalShift=0` — the inactive view's `scrollEl` has zero dimensions. (§7.88)

### `::before` scrim verification methodology

Production CSS at specificity 0,4,1 + `!important` overrides debug styles at 0,3,1. Must use specificity 0,5,1+ for reliable debug overrides. Hide-mode gradient (white→transparent on white bg) is nearly invisible — visual impression of "no scrim" is misleading. (§7.53)

## End indicator regression

`this.totalEntries` only set in `onDataUpdated()`. Collapse/expand calls `toggleGroupCollapse`/`expandGroup` which don't call `onDataUpdated()`. Additionally, `setupInfiniteScroll` captured `totalEntries` in a closure — `checkAndLoadMore` used a stale value. Fix: new `recalculateTotalEntries()` helper called on collapse/expand, `totalEntries` parameter removed from closure (read from `this.totalEntries` directly). Secondary: masonry `appendBatch` end indicator check was inside `runPerGroupLayout` which skips when `newCardsRendered === 0` — added `else if` branch. (§7.33)

## Session wrap-up

Main full-screen controller work completed. The permanent `full-screen-active` approach (§7.43) — apply class at mount, never remove, make both hide and show symmetric spacer operations — is the architecturally correct next step but requires CSS refactor. Deferred to a dedicated session via `/handoff`. `hideBarsUI` decomposition (5.2.2) is worth doing now that the state model is stable. (§7.95)
