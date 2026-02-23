# SCSS audit results

Generated 2026-02-23. Audit of all SCSS partials in `styles/`.

## Bugs

| File                        | Lines                | Issue                                                                                                                                                                                                                          |
| --------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `_grid-masonry-shared.scss` | 198-200              | **Relative color syntax** (`rgb(from var(...) calc(r-15) ...)`) — CSS Color Module 4 feature with limited browser support. May fail silently on older targets.                                                                 |
| `datacore/_settings.scss`   | 114                  | **Missing `-webkit-user-select: none`** — iOS Safari ignores unprefixed `user-select`.                                                                                                                                         |
| `datacore/_toolbar.scss`    | 114, 187             | **Missing `@media (hover: hover)` guard** on `:hover` selectors — causes persistent hover states on touch devices. Other hover rules in the same file (line 273) correctly use the guard.                                      |
| `_style-settings.scss`      | 1495-1498, 1508-1511 | **Over-broad sibling hiding** — `~ .setting-item` hides ALL subsequent settings when image viewer or slideshow is disabled. Likely hides unrelated settings too.                                                               |
| `_hover-states.scss`        | ~270                 | **Fragile attribute substring selector** — `body:not([class*="dynamic-views-card-background-hover-"])` will break if any unrelated class contains that substring. Use explicit class list instead.                             |
| `_slideshow.scss`           | 22-24                | **Fragile negative selector chain** — `.slideshow-img-next:not(.slideshow-enter-left):not(.slideshow-enter-right)` must be updated whenever new animation classes are added. A positive idle-state class would be more robust. |
| `_masonry-view.scss`        | 49                   | **`margin-top: auto` in absolute positioning** — may not have intended effect since masonry cards use `position: absolute`. Verify this works in practice.                                                                     |

## Misplaced rules

| File                       | Lines    | Content                                                      | Move to                                            |
| -------------------------- | -------- | ------------------------------------------------------------ | -------------------------------------------------- |
| `_variables.scss`          | 45-64    | `.dynamic-views-appearance-group` UI styling                 | `_style-settings.scss`                             |
| `_hover-states.scss`       | ~348-487 | Paired property ordering/content justification               | `_properties.scss`                                 |
| `_hover-states.scss`       | ~493-659 | Gradient mask utilities (horizontal + vertical)              | New `_scroll-gradients.scss` or `_utilities.scss`  |
| `_hover-states.scss`       | 298-346  | Cursor gating rules (default, clickable, tags, poster, text) | Distribute to component files or `_utilities.scss` |
| `datacore/_list-view.scss` | 45       | `.list-link:hover` outside `.dynamic-views` nesting block    | Move inside the block                              |

## Comment issues

| File                        | Lines | Issue                                                                                                                            |
| --------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------- |
| `_cover.scss`               | 2     | "Base card setup" — uses "base" to mean "foundation". Should be "Core card setup".                                               |
| `_header.scss`              | 387   | "base CSS" — should be "standard CSS" or "initial".                                                                              |
| `_variables.scss`           | 13-42 | HSL hover color derivation uses magic numbers (`-3` hue, `*1.02` saturation, `*1.15` lightness) without explaining the strategy. |
| `_container.scss`           | 26    | `80px` fade gradient height is a magic number.                                                                                   |
| `_grid-masonry-shared.scss` | 197   | Placeholder color comment "(light 15, dark 25)" is cryptic.                                                                      |

## Questionable `!important` usage

| File                      | Lines        | Context                                                                                  |
| ------------------------- | ------------ | ---------------------------------------------------------------------------------------- |
| `datacore/_settings.scss` | 28-57        | 10+ `!important` flags on flex layout — suggests specificity fight with Obsidian styles. |
| `datacore/_toolbar.scss`  | 329, 420     | Margin reset and padding on buttons.                                                     |
| `_compact.scss`           | 64-74, 81-90 | Blanket `!important` overrides in compact mode that may break custom settings.           |
| `_utilities.scss`         | 78-81        | Link hover color and text-decoration.                                                    |

## Split candidates

| File                   | Content                                                     | Suggested new file                |
| ---------------------- | ----------------------------------------------------------- | --------------------------------- |
| `_hover-states.scss`   | Gradient masks (~170 lines)                                 | `_scroll-gradients.scss`          |
| `_properties.scss`     | Gradient masks (same content, also ~170 lines)              | Same — deduplicate first          |
| `_style-settings.scss` | Conditional visibility rules (~90 lines, highly repetitive) | Keep but refactor with SCSS mixin |

## Maintainability

| File                       | Lines     | Issue                                                                                                                                                                                                        |
| -------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `_hover-states.scss`       | 25-250    | `color-mix(in hsl, var(...), white 15%)` repeated 4+ times — mixin candidate.                                                                                                                                |
| `_style-settings.scss`     | 1479-1566 | 23+ repetitions of `body:not(...) .style-settings-container .setting-item[data-id="..."]` — SCSS mixin would halve the line count.                                                                           |
| `_side-cover-spacing.scss` | All       | Left/right rules nearly identical — mixin candidate but readable as-is.                                                                                                                                      |
| `_compact.scss`            | 93-164    | Thumbnail reordering duplicated for `.dynamic-views` and `.bases-view` — extract to shared rule.                                                                                                             |
| `_tags.scss`               | 150-155   | Custom fallback rule duplicates the general application rule at lines 158-162.                                                                                                                               |
| `_grid-view.scss`          | 5-73      | Gap rules duplicated across `.bases-embed` and `.workspace-leaf-content` contexts.                                                                                                                           |
| `_grid-view.scss`          | 91        | Fragile negative selector `.card:not(.card-cover-bottom):not(.card-cover-top.image-format-cover)` — breaks when new formats are added.                                                                       |
| `_properties.scss`         | 131-134   | Unmeasured paired property default `flex: 0 1 auto` with `max-width: 50%` — `flex-grow: 0` contradicts "natural content width" comment. Verify intent.                                                       |
| `_properties.scss`         | 240-253   | CSS variable `--dynamic-views-text-preview-color` set inside `.card-text-preview` via `--dynamic-views-text-preview-color-value` — potential circular dependency if value isn't set. Same pattern for title. |

## Clean files (no findings)

- `_property-colors.scss`
- `_backdrop.scss`
- `_side-cover-spacing.scss` (repetitive but correct)

## Foundation layer details

### `_variables.scss`

- **Lines 45-64 (misplaced)**: `.dynamic-views-appearance-group` styling is Style Settings UI configuration — belongs in `_style-settings.scss`, not variables.
- **Lines 13-42 (comment)**: Magic numbers in HSL hover calculations lack explanation. Add comment: "Hover colors: slight hue shift, minimal saturation boost, noticeable lightness increase."
- **Line 20 (questionable)**: `calc(var(...-s) * 1.02)` — 2% saturation increase is very subtle. Document rationale.

### `_focus.scss`

- **Line 2 (questionable)**: `box-shadow: none !important;` should explain why — overrides Obsidian button defaults.
- **Line 39 (questionable)**: Inconsistent `body` prefix on `.card:focus-visible::after` vs. earlier rules that don't use `body` prefix.
- **Line 26 (questionable)**: Hardcoded `border-radius: 5px` for menu items — document or parameterize.

### `_container.scss`

- **Lines 61-64 (questionable)**: CodeMirror internal class names (`.cm-contentContainer`, `.cm-content`) used with `!important` — fragile if CodeMirror updates class names.
- **Lines 52-56 (questionable)**: Container query declarations could use `:is()` for consistency with later rules.

### `_style-settings.scss`

- **Lines 1495-1498, 1508-1511 (bug)**: `~ .setting-item` sibling combinator hides ALL subsequent settings when image viewer or slideshow is disabled. Likely over-broad.
- **Lines 1479-1566 (maintainability)**: 23+ repetitions of same selector pattern. SCSS mixin would consolidate:
  ```scss
  @mixin hide-custom-settings($base-class, $setting-id) {
    body:not(#{$base-class}-custom)
      .style-settings-container
      .setting-item[data-id="#{$setting-id}-custom"] {
      display: none !important;
    }
  }
  ```
- **Lines 1479-1566 (comment)**: Rules lack grouping comments by feature area.

## Datacore UI + View layout details

### `datacore/_toolbar.scss`

- **Lines 114, 187 (bug)**: `:hover` without `@media (hover: hover)` guard — touch devices show persistent hover.
- **Line 329 (questionable)**: `margin-bottom: 0 !important` — resolve specificity conflict at source.
- **Line 420 (questionable)**: `padding: 6px !important` unnecessary — direct rule should win cascade.
- **Line 558 (questionable)**: `max-width: 400px` magic number on `.search-controls`.

### `datacore/_query-editor.scss`

- **Line 31 (questionable)**: `max-width: 900px` on inner `.query-editor` exceeds line 15's `max-width: min(675px, ...)` on outer wrapper — inner can be wider than container.
- **Line 106 (comment)**: "pre-wrapped scrolling" is vague — clarify that it preserves error indentation while wrapping long lines.

### `datacore/_settings.scss`

- **Lines 28-57 (questionable)**: 10+ `!important` flags suggest specificity fight with Obsidian styles.
- **Line 114 (bug)**: Missing `-webkit-user-select: none;` — iOS bug.
- **Lines 136-138 (comment)**: Chevron rotation `-90deg` is a magic angle — document direction logic.

### `datacore/_list-view.scss`

- **Lines 7-28 (redundant)**: `list-style-position: outside` repeated 3 times for bullet, numbered, none. The "none" variant doesn't need it. Bullet and numbered could share via merged selector.
- **Line 45 (misplaced)**: `.list-link:hover` outside `.dynamic-views` nesting block — inconsistent with other rules.

### `_grid-masonry-shared.scss`

- **Lines 198-200 (bug)**: Relative color syntax `rgb(from var(--card-bg) calc(r - 15) ...)` — CSS Color Module 4, limited support. Consider fallback.
- **Line 153 (bug)**: Uses `var(--color-accent)` but standard Obsidian token is `var(--interactive-accent)`. May not match theme.
- **Line 195-200 (comment)**: "(light 15, dark 25)" is cryptic — clarify: "Placeholder background is 15/25 RGB units darker on light/dark themes."
- **Line 207 (comment)**: "1px offset for border" should explain: prevents cover from overlapping inset border drawn by ::after.

### `_grid-view.scss`

- **Lines 5-73 (redundant)**: Gap rules duplicated across `.bases-embed` and `.workspace-leaf-content` contexts.
- **Line 91 (questionable)**: Complex negative selector `.card:not(.card-cover-bottom):not(.card-cover-top.image-format-cover)` — fragile when new formats added.
- **Line 142 (comment)**: `height: 0` with `padding-top` aspect ratio trick should have a "why" comment.

### `_masonry-view.scss`

- **Lines 9-35 (maintainability)**: `.card-previews` flex-direction set multiple times for different formats — scattered and hard to track.
- **Line 49 (bug)**: `margin-top: auto` in absolute positioning context may not work as intended.
- **Line 89 (comment)**: JS dependency for inline width/height should be documented more clearly.

## Card internals details

### `card/_core.scss`

- No significant findings. Well-structured.

### `card/_content.scss`

- **Lines 21-108 (maintainability)**: Hover border color presets mirror base presets in `_core.scss` (lines 129-175). Color values defined in two places — acceptable but worth noting.

### `card/_header.scss`

- **Line 387 (comment)**: "base CSS" should be "standard CSS".

### `card/_thumbnail.scss`

- **Lines 148-165 (questionable)**: Mobile multi-image shadow removal (`filter: none`) overlaps with `dynamic-views-hide-thumbnail-shadow` setting. Layering is fragile — mobile rule should have lower specificity so setting can override.

### `card/_image-viewer.scss`

- **Line 149-156 (comment)**: `-webkit-user-drag: none` is WebKit-specific — document this.

### `card/_masonry-covers.scss`

- **Lines 68-98 (questionable)**: Crop mode uses `!important` but contain mode doesn't — inconsistency should be documented.

### `card/_cover.scss`

- **Line 2 (comment)**: "Base card setup" should be "Core card setup" — avoids "base" ambiguity.

### `card/_cover-elements.scss`

- No significant findings beyond the hover zoom property difference (intentional — `transform` vs `scale`).

### `card/_cover-placeholders.scss`

- **Lines 39-76 (maintainability)**: Deeply nested `:not()` chains repeated across rules. Verbose but logically sound.

### `card/_slideshow.scss`

- **Lines 22-24 (bug)**: Fragile negative selector — needs updating when new animation classes added.
- **Line 128 (comment)**: Good "why" comment explaining scale vs transform choice.

### `card/_poster.scss`

- **Lines 173-175 (questionable)**: `:not(.dynamic-views-grid)` negative selector — fragile if new view types added. Positive `[data-view-type]` selector would be more robust.

## Data display + Overrides details

### `_properties.scss`

- **Lines 493-659 (misplaced)**: Gradient mask utilities (~170 lines) belong in `_scroll-gradients.scss` or `_utilities.scss`.
- **Lines 274-301 (misplaced)**: Timestamp icon positioning for compact mode (~28 lines) mixes layout concerns — candidate for dedicated section.
- **Lines 131-134 (maintainability)**: `flex: 0 1 auto; max-width: 50%` contradicts "natural content width" comment — `flex-grow: 0` prevents growth.
- **Lines 240-253 (bug)**: CSS variable set inside element via another variable — potential circular dependency if value variable isn't set.

### `_property-colors.scss`

No findings. Well-organized, consistent pattern.

### `_tags.scss`

- **Lines 150-155 (redundant)**: Custom fallback rule duplicates general application rule at lines 158-162.
- **Lines 116-147 (maintainability)**: Named color presets set `--dynamic-views-tag-color-value` on `body` without descendant selector — fragile if DOM structure changes. Add comment.

### `_hover-states.scss`

- **Lines ~348-487 (misplaced)**: Paired property ordering/content justification — belongs in `_properties.scss`.
- **Lines ~493-659 (misplaced)**: Gradient mask utilities — belongs in new `_scroll-gradients.scss` or `_utilities.scss`.
- **Lines 298-346 (misplaced)**: Cursor gating rules — distribute to component files.
- **Line ~270 (bug)**: `[class*="..."]` attribute substring matching is fragile.
- **Lines 25-250 (maintainability)**: `color-mix(in hsl, var(...), white 15%)` repeated 4+ times — mixin candidate.

### `_compact.scss`

- **Lines 64-74 (questionable)**: `!important` overrides in compact mode may break custom settings.
- **Lines 93-164 (redundant)**: Thumbnail reordering duplicated for `.dynamic-views` and `.bases-view`.
- **Lines 20-25 (comment)**: `visibility: hidden` during tab transitions — explain why not `display: none`.

### `_utilities.scss`

- **Lines 32-47 (questionable)**: `.setting-sub-items::before` vertical separator — comment says "currently inactive." Remove dead code or document future intent.
- **Lines 128-132 (questionable)**: `.dynamic-views-viewer-fixed { inset: auto; }` — unusual, needs comment.
- **Lines 78-81 (questionable)**: `!important` on link hover — specificity conflict with Obsidian link styles.
- **Lines 121-140 (comment)**: "Programmatic utility classes" is vague — add per-class JS-managed purpose comments.
