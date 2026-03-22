# Undocumented Obsidian APIs

Useful internal APIs discovered through runtime inspection. Not part of the public API and may break between versions.

## Body classes (mobile)

| Class | Set when | Platform |
|---|---|---|
| `auto-full-screen` | User enables "Hide toolbar on scroll" in Settings > Appearance | Phone |
| `is-hidden-nav` | Obsidian hides the navigation bar during scroll | Phone |
| `is-floating-nav` | Navigation bar is in floating mode | Phone |

## CSS variables (mobile layout)

| Variable | Description | Typical value |
|---|---|---|
| `--view-header-height` | Height of the view header tab bar | `44` (px, unitless) |
| `--safe-area-inset-top` | iOS safe area (notch/Dynamic Island) | `47` (px, unitless) |
| `--navbar-height` | Height of the bottom navigation bar | `52` (px, unitless) |
| `--safe-area-inset-bottom` | iOS safe area (home indicator) | `34` (px, unitless) |

These variables are unitless numbers set on `document.body` by Obsidian's mobile shell. Use `parseFloat(getComputedStyle(body).getPropertyValue('--navbar-height'))` to read them.
