# iOS WebKit quirks

## content-visibility: hidden + IntersectionObserver loop

Toggling `content-visibility: hidden` via IntersectionObserver causes an infinite reflow loop on iOS WebKit (WKWebView). The cycle: IO callback toggles class → geometry changes → IO re-fires → class toggles back → repeat. Flickering is persistent and never stops, even after all user interaction ceases.

**Root cause**: iOS WebKit re-evaluates IntersectionObserver entries when `content-visibility: hidden` changes an observed element's geometry. Chromium does not.

**Fix**: Use `content-visibility: auto` (browser-managed) on mobile instead of IO-driven toggling. Guarded via `Platform.isMobile` in `src/shared/content-visibility.ts`.

**Discovered**: 2026-02-11, confirmed via git bisect on iPhone 13 with Safari Web Inspector. Culprit commit: `998b856`.

## CSS scroll-state() container queries

`CSS.supports('container-type', 'scroll-state')` returns `false` on iOS WebKit (tested 2026-02-11, Obsidian early access via TestFlight). The `@container scroll-state(stuck: top)` rule is silently ignored — progressive enhancement, no errors.
