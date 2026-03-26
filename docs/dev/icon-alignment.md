---
title: Icon optical vertical alignment
description: Empirical findings, failed approaches, and constraints for aligning SVG timestamp icons with digit text across desktop, iOS, and Android — covers canvas TextMetrics limitations, Android text autosizing pitfalls, and the offscreen measurement exemption.
author: "\U0001F916 Generated with Claude Code"
updated: 2026-03-26
---
# Icon optical vertical alignment

Timestamp icons (calendar/clock SVGs) and file type icons in card views need to be optically vertically centered with adjacent text. Flex `align-items: center` aligns geometric centers, but text glyphs (especially digits without descenders) concentrate visual weight above the geometric center, making icons appear ~0.3-0.5px too low.

## Two icon contexts

| Context | Layout | Icon height | Natural geometric offset | Needs correction? |
|---|---|---|---|---|
| **Timestamp** (properties) | `inline-flex` + `align-items: center` | `calc(1lh / line-height-tight)` = font-size | 0.45px desktop, 0.34px Android | Yes |
| **File type** (title) | Inline + `vertical-align: bottom` | `1lh` (fills line box) | 0px (icon fills line box) | No |

The file type icon at `height: 1lh` spans the entire line box, so its visual center and the text's geometric center coincide by construction. Only the timestamp icon (shorter than the line box) has a measurable offset.

## Icon sizing (solved)

All font-relative CSS units except `lh` resolve to **pre-boost** values on Android:

| Unit | Android value (14.99px specified) | Reflects boosting? |
|---|---|---|
| `1em` | 14.99px | No |
| `1cap` | 12.25px | No |
| `1ex` | 9.11px | No |
| `1ic` | 14.99px | No |
| `1lh` | 22.41px | **Yes** |

**Source**: Chromium `css_to_length_conversion_data.cc` — `1em` resolves via `SpecifiedFontSize()` (pre-boost), `1lh` via `ComputedLineHeight()` (post-boost).

**Fix**: `calc(1lh / var(--dynamic-views-line-height-tight))` = boosted font-size (17.23px on Android, 13px = `1em` on desktop). Algebraically sound and confirmed via CDP measurement.

## Hard constraints

1. **CSS calc can't divide lengths**: `cap/em` → dimensionless ratio is impossible. No pure-CSS formula can compute the boosted cap-height.
2. **`text-size-adjust: 100%` has no effect** on Android WebView. `none` works but disables a11y font scaling.
3. **Flex items have built-in boost suppression** (`IsFlexItem()` check in Chromium), but empirically the text IS still boosted in the timestamp wrapper. (crbug.com/163359, crbug.com/779409)
4. **No `is-android` body class** in Obsidian. Target Android via `body.is-mobile:not(.is-ios)`.

## Failed approaches

### Pure CSS

| # | Approach | Result |
|---|---|---|
| 1 | `width/height: 1em` | Correct desktop, undersized Android |
| 2 | `width/height: 1lh` | Oversized all platforms |
| 3 | `width: 1em; height: 1lh` + SVG viewBox | Correct size, alignment still off |
| 4 | `vertical-align: text-bottom` | Worse |
| 5 | `vertical-align: middle` | No improvement |
| 6 | `text-size-adjust: 100%` | No effect on Android WebView |
| 7 | `margin-top: -1px` (universal) | Too much desktop, too little Android |
| 8 | `margin-top: -1.5px/-0.5px` (platform split) | No single value bridges the platform gap |
| 9 | `translateY(calc(0.5cap - 0.5em))` | Overcorrects desktop/iOS, undercorrects Android (`cap`/`em` are pre-boost) |

### Canvas TextMetrics formulas

| # | Formula | Result |
|---|---|---|
| 10 | `(fontBBA - fontBBD - actualBBA + actualBBD) / 2` | Sign depends on font: positive for SF Pro, negative for Roboto. Wrong direction on one platform. |
| 11 | Negated formula | Correct direction for SF Pro, wrong for Roboto |
| 12 | `abs(formula) * 3/4` | Desktop correct, Android still below center |
| 13 | `-(fontBBA - actualBBA) / 8` (ascender excess) | Desktop correct (0.453 vs 0.45 needed), Android correct geometrically (0.350 vs 0.34 needed) but perceptually still below |
| 14 | Canvas metrics cross-platform comparison | **Android returns integer-rounded values** AND different proportions for the same font (Georgia: desktop actualBBA=8.09, Android actualBBA=13 at comparable sizes). No canvas formula can be consistent cross-platform. |

### DOM measurement (offscreen element)

| # | Approach | Result |
|---|---|---|
| 15 | Temp `inline-flex` row with `visibility: hidden; position: absolute` | Desktop/iOS: correct. Android: correction undersized. |

**Root cause (hypothesis)**: Chromium's TextAutosizer likely **skips offscreen elements** — `visibility: hidden` + `position: absolute` elements are outside normal text flow clusters. The synthetic measurement doesn't reflect the actual boosted rendering. Not directly confirmed by Chromium source, but consistent with the autosizer's cluster-based architecture (it processes text in normal document flow).

## Chromium TextAutosizer internals

From Chromium source code analysis (`text_autosizer.cc`, `computed_style.cc`, `simple_font_data.cc`):

- **Multiplier application**: `ApplyMultiplier()` modifies `ComputedSize` on `FontDescription`. Font metrics (ascent, descent, line-spacing) scale proportionally — Skia creates a new `SkFont` at the boosted size.
- **Line-height scaling**: Fixed (px) line-heights are also run through `ComputeAutosizedFontSize()`. Percentage and `normal` line-heights derive from the boosted font metrics naturally.
- **Range rect accuracy**: `Range.getBoundingClientRect()` reads from the layout tree which uses boosted geometry — rects ARE accurate for boosted text. No visual-vs-measurement discrepancy.
- **Flex item suppression**: `IsFlexItem()` check in `BlockSuppressesAutosizing()` explicitly suppresses block-level flex items. Tracked via `WebFeature::kTextAutoSizingDisabledOnFlexbox`.
- **`getComputedStyle().fontSize`**: Returns the boosted value on Android (confirmed by W3C mailing list: Philip Rogers + Boris Zbarsky).

### Autosizing suppression triggers

| Trigger | Mechanism |
|---|---|
| Flex items (`IsFlexItem()`) | Block-level direct children of flex containers |
| `text-size-adjust: none` or `100%` | Forces multiplier to 1 (also disables a11y font scale) |
| `max-height` constraint | `BlockHeightConstrained()` check |
| `white-space: nowrap` | `ShouldWrapLine()` returns false |
| Form controls | Explicit suppression |
| Row of links (3+ inline links) | Heuristic suppression |

### `text-size-adjust` details

- `none` and `100%` are equivalent in Chromium — both force multiplier to 1
- **Disables a11y font scaling too** — use on narrowest possible scope
- Inherited — descendants also get suppressed unless overridden with `auto`
- No effect on desktop browsers (they don't run text inflation)
- Chromium issue 340389272 tracks decoupling `text-size-adjust` from the autosizer

## Implemented solution

**Live DOM measurement from the first real rendered timestamp** (`src/shared/icon-alignment.ts`).

### Measurement

- Find first `.has-timestamp-icon` wrapper via `querySelector`
- Measure icon center (`getBoundingClientRect`) vs text center (`Range.getBoundingClientRect` for Bases text nodes, `getBoundingClientRect` for Datacore span elements)
- Store delta as px value in `--dynamic-views-icon-optical-offset` on the container
- CSS: `transform: translateY(var(--dynamic-views-icon-optical-offset, 0px))`

### Android boost scaling

On Android (`Platform.isAndroidApp`), scale delta by `boostRatio²`:
- `width: 1em` probe gives pre-boost font-size (CSS `1em` = `SpecifiedFontSize`)
- `getComputedStyle().fontSize` gives post-boost value
- `boostRatio = postBoost / preBoost`, gated at > 1.02 to filter rounding noise
- Quadratic scaling matches desktop perceptual correction (see `android-chromium-quirks.md`)

### Timing

- **Bases**: One-shot via `requestAnimationFrame` after first timestamp renders in `SharedCardRenderer.renderPropertyRow`. `iconAlignmentMeasured` flag prevents re-measurement; reset in `cleanup()`.
- **Datacore**: Container ref callback with `WeakSet` guard. Only marks as measured when `applyIconOpticalOffset` returns true (found timestamps). Retries on subsequent re-renders until timestamps exist.

### Backend differences

- **Bases**: Timestamp text is a bare text node (`nodeType === 3`). `Range.getBoundingClientRect` returns the content area (asymmetric within line box) → non-zero delta (~0.45px on desktop).
- **Datacore**: Timestamp text is a `<span>` element (`nodeType === 1`, checked via `nodeType` not `instanceof` for cross-window safety). `getBoundingClientRect` returns the line-height box (symmetric) → delta = 0, no correction needed.

### Rejected alternative: `text-size-adjust: none` on timestamp wrapper

Suppress boosting entirely for the icon+text pair. Eliminates the problem at the root but disables a11y font scaling for the element. Kept as a fallback if the measurement approach proves insufficient.

## Key references

- **Chromium source**: `text_autosizer.cc` (multiplier, suppression), `computed_style.cc` (line-height scaling), `simple_font_data.cc` (font metrics from Skia), `css_to_length_conversion_data.cc` (unit resolution)
- **Chromium bugs**: crbug.com/163359, crbug.com/779409 (flex suppression), crbug.com/512989 (line-height affected), issues.chromium.org/340389272 (text-size-adjust decoupling)
- **W3C**: CSS Mobile Text Size Adjustment spec Section 3, www-style mailing list 2016 (Rogers/Zbarsky on getComputedStyle)
- **Prior sessions**: `844490b0` (icon sizing), `10d39cce` (optical alignment)
- **Android measurement**: Pixel 8a, USB debugging, CDP via `adb forward`
- **CDP screenshot quirk**: `clip` param unreliable over ADB WebSocket. Use full-page screenshots.
