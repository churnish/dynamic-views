---
title: Image loading and caching pipeline
description: Image URL resolution, two-tier dedup cache, broken URL tracking, aspect ratio caching, and load handler wiring for both backends.
author: 🤖 Generated with Claude Code
updated: 2026-08-11
---
# Image loading and caching pipeline

See also: [`odkb/webkit-compositor-constraints.md`](https://github.com/churnish/odkb/blob/main/webkit-compositor-constraints.md), [`odkb/android-chromium-quirks.md`](https://github.com/churnish/odkb/blob/main/android-chromium-quirks.md)

The image loading pipeline resolves property values and in-note embeds into renderable URLs, deduplicates concurrent loads via a two-tier cache, tracks broken URLs to skip on re-render, caches aspect ratios to prevent layout flash, and orchestrates fade-in transitions via a double-rAF pattern.

## Files

| File                           | Role                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| `src/core/content-loader.ts` | Async image/text loading with two-tier dedup (in-flight + per-caller).                       |
| `src/core/image-loader.ts`   | Image load/error handlers, aspect ratio caching, broken URL tracking, placeholder injection. |
| `src/core/image.ts`           | Image path processing, embed extraction, YouTube thumbnail validation.                       |
| `src/core/opaque-scan.ts`     | Positions where Markdown syntax is literal — code and comments — plus cardlink block bodies. |
| `src/bases/shared-renderer.ts` | Imperative image load handler setup.                                                         |

## Two-tier deduplication

Two independent cache layers prevent redundant image loads.

### Tier 1: In-flight dedup (module-scoped)

Prevents concurrent requests for the same image with the same configuration across all views.

| Structure              | Type                                          | Scope  | Lifetime                            |
| ---------------------- | --------------------------------------------- | ------ | ----------------------------------- |
| `inFlightImages`       | `Map<compositeKey, Promise<ImageLoadResult>>` | Module | Entry deleted after Promise settles |
| `inFlightTextPreviews` | `Map<compositeKey, Promise<string>>`          | Module | Entry deleted after Promise settles |

**Composite key format** (image): `path|showFileImages|includeYoutube|includeCardLink|youtubeTargetWidth|maxImages`
**Composite key format** (text): `path|fallbackToContent|omitFirstLine|hasTextPreview[|fileName|titleString]|preserveHeadings|preserveNewlines`

Every parameter affecting output is encoded in the key. Same path with different config generates different entries.

### Tier 2: Per-caller cache (caller-scoped)

Deduplicates within a single batch. Each caller passes its own cache objects.

| Structure          | Type                               | Key    | Purpose                                                                                               |
| ------------------ | ---------------------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| `hasImageCache`    | `Record<path, boolean>`            | `path` | Tracks load completion per path — key present = attempted, `true` = images found, `false` = no images |
| `imageCache`       | `Record<path, string \| string[]>` | `path` | Resolved image URL(s)                                                                                 |
| `textPreviewCache` | `Record<path, string>`             | `path` | Resolved text preview                                                                                 |

Per-caller caches use plain `path` (not composite key) because each caller has unique cache objects.

### Cache interaction

```
loadImageForEntry(path, ...)
  1. Check per-caller cache (path in hasImageCache?) → return if hit
  2. Self-image check (sync) → return if image file with no property values
  3. Check in-flight map (compositeKey in inFlightImages?) → await if hit, assign to caller cache
  4. Create Promise, store in inFlightImages
  5. Resolve property images, then embeds → assign to caller cache
  6. Delete from inFlightImages
```

## Image path resolution

### Processing pipeline ([image.ts](../../src/core/image.ts))

| Step | Function                      | Sync/Async | What it does                                                                                     |
| ---- | ----------------------------- | ---------- | ------------------------------------------------------------------------------------------------ |
| 1    | `processImagePaths()`         | Sync       | Strips wikilink syntax, validates extensions, separates internal vs external, skips YouTube URLs |
| 2    | `resolveInternalImagePaths()` | Sync       | Resolves internal paths via `metadataCache.getFirstLinkpathDest()`, gets resource URLs           |
| 3    | Browser native                | Async      | External URLs passed through directly (browser handles load/error at render time)                |

**Valid extensions**: avif, bmp, gif, jpeg, jpg, png, svg, webp.

### Fallback chain

Order in `loadImageForEntry()`: Per-caller cache check -> Self-image check (sync, short-circuits) -> Property image processing -> Embed extraction (async) -> Empty string.

The self-image check runs BEFORE property processing. When `showFileImages !== 'never'`, no property values exist, and the file itself is an image, it returns the file's resource path immediately — skipping property processing and embed extraction entirely.

| `showFileImages` setting | Behavior                                             |
| -------------------------- | ---------------------------------------------------- |
| `'always'`                 | Property images + append in-note embeds              |
| `'if-unavailable'`         | Embeds only if property images array is empty        |
| `'never'`                  | Property images only, no embeds, no self-image check |

**Self-image**: Image files (extension in `VALID_IMAGE_EXTENSIONS`) use themselves as card image when no property images exist. Gated on `showFileImages !== 'never'` AND `imagePropertyValues.length === 0`. Synchronous (`getResourcePath`), bypasses in-flight dedup.

## Embed extraction (`extractImageEmbeds()`)

Parses file content to find image references not declared in properties.

### Processing steps

1. Read file content via `vault.cachedRead()`, truncate at 100KB on line boundary
2. Strip frontmatter (handles Unix `\n` and Windows `\r\n` line endings)
3. Build an opaque scan of the content via `scanOpaque()` (see [Opaque regions](#opaque-regions))
4. Extract three embed types sequentially (wikilink, markdown, cardlink), collect with document positions
5. Sort by document position, deduplicate by path
6. Resolve internal paths, validate YouTube thumbnails, limit to `maxImages`

### Opaque regions

`src/core/opaque-scan.ts` answers a single question for both the extractor and the text preview stripper: does syntax at this position render at all? Regions where it does not are "opaque" — fenced code, indented code, inline code, and comments (`%%` and `<!-- -->`). Embeds inside one are skipped, because Obsidian renders nothing there.

| Member | Used by | Purpose |
| --- | --- | --- |
| `isOpaque(position)` | `extractImageEmbeds()` | Skip a wikilink or Markdown embed found inside code or a comment |
| `cutComments()` | `stripMarkdownSyntax()` | Drop comment spans before Markdown patterns run |
| `cardlinkBlocks` | `extractImageEmbeds()` | Cardlink fence bodies to read `image:` from, minus any that are commented out |

Every pass is lazy and memoized — the scan runs per card, and most notes never need all of it.

Two details are load-bearing:

- **Cardlink fences are transparent to `isOpaque`, opaque to the comment scan.** The `image:` field is read from the block's own body by regex and never consults a position predicate, so transparency does not protect it — its only effect is that an `![[...]]` written in a cardlink body is extracted. The comment scan needs the opposite: a `%%` in a cardlink title or description is literal text, and reading it as an opener would start a comment that never closes and hide every image after it.
- **Comments have an inline form and a block form.** An opener with text before it on its line must close on that same line, or it is not a comment and renders literally. An opener that starts its own line, with nothing on the rest of it that could close it, opens a block comment whose closer may be anywhere — unclosed, it hides the remainder of the note.
- **Openers respect inline code, closers do not.** This is why `stripMarkdownSyntax()` cuts comments *before* it sets code spans aside: the scan must see the real backticks. Cutting a comment that ends inside a span leaves that span's opening backtick unpaired and visible, which is what the renderer does too.

### Embed types

| Type     | Pattern                        | Source                                  |
| -------- | ------------------------------ | --------------------------------------- |
| Wikilink | `![[path]]`, `![[path\|cap]]`  | Content outside code blocks             |
| Markdown | `![alt](url)`, `![](url "t")`  | Content outside code blocks             |
| Cardlink | `image: url` in cardlink fence | Inside `cardlink`/`embed` fenced blocks |

### YouTube thumbnail extraction

- Triggered for YouTube URLs in embeds (not in properties -- YouTube URLs in properties are skipped as non-images)
- Served as WebP from `i.ytimg.com/vi_webp`, roughly half the bytes of the JPEG at identical pixels
- Rungs, widest first: `maxresdefault` (1280x720) -> `sddefault` (640x480) -> `hqdefault` (480x360) -> `mqdefault` (320x180)
- Each rung validated with 5s timeout, `naturalWidth >= 320px` check (placeholders are 120x90)
- Returns `null` if all rungs fail

#### Rung selection

Selection starts at the **narrowest rung that covers the card's target width**, then descends. `mq`/`hq` exist for every live video; `sd`/`maxres` are conditional, which is what makes descent mandatory rather than an optimisation. A target wider than every rung uses the full ladder.

Targets come from **stable upper bounds, never live values** (`getYouTubeTargetWidth`):

| Format | Target (CSS px) |
| --- | --- |
| `thumbnail` | `128` (the slider maximum) x DPR |
| `cover` / `poster` / `backdrop` | `2 x cardSize` x DPR |

`thumbnailSize` is a CSS-only setting, so changing it re-renders nothing and re-extracts nothing -- a target read from its live value would be permanently stale. `cardSize` is a *minimum* column width, and a pane resize moves the rendered width with no settings change at all. Both bounds over-fetch slightly, which costs a rung at worst and can never go blurry.

DPR is read **in the view** via `getOwnerWindow(containerEl)` and threaded down as a number: bare `window` is prohibited in `src/core/` and `src/bases/`, and a popout on a differently-scaled monitor genuinely has a different ratio.

The `MIN_THUMBNAIL_WIDTH` check is load-bearing and applies on both hosts. A missing rung answers **HTTP 404 carrying a decodable 120x90 grey image**, and `<img>` decides load-vs-error by whether the bytes decode, not by status -- so the placeholder fires `onload` and only the width check rejects it.

The resolved-thumbnail memo is keyed by **video ID plus requested target width**. Keyed by ID alone, the first caller's rung would win for the whole session and a thumbnail-sized view would inherit a poster-sized view's 1280px image. The *resolved* rung cannot be the key -- it is unknown until the probe finishes.

Probes are pre-started concurrently before the resolution loop, keyed by **video ID** so `youtu.be/X` and `watch?v=X` share one (upstream dedup is by path). At most `maxImages` pre-start: a 100KB link dump admits thousands of YouTube embeds, and sequential requests for each would compete with real card images on a phone when only `maxImages` can be shown. Embeds past that bound resolve lazily inside the loop, which is reachable because a YouTube embed resolving to `null` fills no result slot.

## Broken URL tracking

| Structure         | Type          | Scope  | Lifetime       | Bounded by                |
| ----------------- | ------------- | ------ | -------------- | ------------------------- |
| `brokenImageUrls` | `Set<string>` | Module | Session-scoped | User's broken image count |

- `markImageBroken(url)`: Called on any load error
- `filterBrokenUrls(urls)`: Removes known-broken before render (early exit if Set empty)
- Cleared on plugin load and unload via `initExternalBlobCache()` / `cleanupExternalBlobCache()` in [slideshow.ts](../../src/core/slideshow.ts) (see [image-navigation.md](image-navigation.md) for the external blob cache lifecycle)

## Aspect ratio caching

| Structure            | Type                                 | Scope  | Bounded by               |
| -------------------- | ------------------------------------ | ------ | ------------------------ |
| `imageMetadataCache` | `Map<url, { aspectRatio?: number }>` | Module | User's vault image count |

- **Default**: `DEFAULT_ASPECT_RATIO = 0.75` (4:3 landscape), used on error or invalid dimensions
- **Set in** `handleImageLoad()` when `naturalWidth >= 1px` and `naturalHeight >= 1px`
- **Applied pre-render** via `applyCachedImageMetadata()` -> sets `--actual-aspect-ratio` CSS variable
- **Invalidated** on file modify via suffix matching decoded URL paths (`invalidateCacheForFile()`)
- **Lock flag**: `dataset.aspectRatioSet = '1'` prevents overwriting during slideshow navigation
- **Unbounded by design**: Entries ~20 bytes each; eviction cost (layout flash) outweighs growth

## Image load event handlers

### `setupImageLoadHandler()`

> For slideshow-specific image navigation, preloading, and failed image recovery, see [image-navigation.md](image-navigation.md).

1. Apply cached metadata upfront (`applyCachedImageMetadata`)
2. Check already-loaded state (`complete && naturalWidth > 0 && naturalHeight > 0 && !image-ready`)
3. If loaded: force reflow (unless `skip-cover-fade`), call `handleImageLoad()` immediately
4. Otherwise: register `load`/`error` listeners with `{ once: true }`
5. Return cleanup function for listener removal

### `handleImageLoad()`

Executed after successful image load.

1. Cache external image as blob URL (for slideshow navigation)
2. Validate natural dimensions (>= 1px)
3. Cache `aspectRatio = naturalHeight / naturalWidth`
4. Set `--actual-aspect-ratio` CSS variable on card element
5. Lock `dataset.aspectRatioSet` flag
6. Fade-in: if `.skip-cover-fade` ancestor, add `image-ready` immediately (no transition); otherwise double-rAF pattern
7. Guard `isConnected` during both rAF callbacks
8. Call optional `onLayoutUpdate` callback (masonry reflow)

### Double-rAF fade pattern

Single `requestAnimationFrame` can be batched with the initial render paint. Double-rAF guarantees a paint cycle between setting `opacity: 0` and adding `image-ready` (which transitions to `opacity: 1`).

```
rAF #1: Browser observes opacity:0 state
  rAF #2: Add image-ready class -> triggers CSS transition
```

Both callbacks guard `isConnected` to handle cards unmounted between frames.

## Backdrop multi-image fallback (`setupBackdropImageLoader()`)

Backdrop format supports multiple image URLs with sequential fallback on error.

1. Apply cached metadata, check already-loaded state
2. On error: mark broken, advance `currentIndex`, set next URL as `imgEl.src`
3. Repeat until success or all URLs exhausted
4. All listeners bound to `AbortSignal` for cleanup
5. Double-rAF pattern on final failure (all images broken)

**No placeholder injection**: Unlike cover/thumbnail, backdrop failure does NOT call `handleAllImagesFailed()`. The `<img>` is hidden and `image-ready` is added, but the backdrop wrapper remains without placeholder elements.

## Placeholder injection (`handleAllImagesFailed()`)

Called when all card images fail to load at runtime. First unconditionally adds `.no-valid-images` to the card element, then branches by image format:

| Image format | DOM mutation                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| Thumbnail    | Remove `.card-thumbnail`, inject `.card-thumbnail-placeholder` (removal ensures `:only-child` CSS collapse) |
| Cover        | Add `.card-cover-wrapper-placeholder` class, remove `.card-cover`, inject `.card-cover-placeholder`         |

## Guard conditions

| Guard                     | Prevents                                             | Location                                              |
| ------------------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| Per-caller cache hit      | Re-loading already-resolved path within a batch      | `loadImageForEntry()`                                 |
| In-flight dedup           | Concurrent same-config loads across views            | `loadImageForEntry()`                                 |
| `isConnected` check       | DOM access on unmounted cards during rAF             | `handleImageLoad()`, error handlers                   |
| `image-ready` class guard | Double-processing prevention                         | `setupImageLoadHandler()`                              |
| `AbortSignal` check       | Orphaned operations after teardown                   | `setupBackdropImageLoader()`                          |
| URL match on error        | Stale error handler after slideshow src swap         | `setupImageLoadHandler()` error                       |
| Dimension validation      | Bad aspect ratios from corrupt/broken images (< 1px) | `handleImageLoad()`                                   |

## Invariants

1. `hasImage` is always set (never `undefined`) -- differentiates "no images" from "not yet loaded"
2. Composite key includes all output-affecting params -- immutable contract
3. Self-image short-circuits before property processing; property images checked before embed fallback
4. Embeds appended after property images, never prepended (in `'always'` mode)
5. YouTube URLs in properties skipped as non-images (thumbnails only extracted from embeds)
6. Frontmatter stripped before embed parsing
7. `aspectRatioSet` flag prevents aspect ratio updates during slideshow navigation after first successful load
8. Embed paths deduplicated -- no image loaded twice even if referenced multiple ways
9. `image-ready` class is the single source of truth for "image processing complete" -- both success and error paths set it
10. Broken URL set is session-scoped and never persisted -- avoids stale entries across restarts
11. `skip-image-fade` (card-level, set inside `renderCard` before image handlers run) makes `handleImageLoad` add `image-ready` synchronously instead of deferring via double-rAF -- prevents re-fade on virtual scroll remount. `skip-cover-fade` (container-level, transient during shuffle) uses `transition: none !important` + `opacity: 1 !important` to suppress ALL image transitions during rearrange

## Reactive image updates (Bases)

When a file's content changes and the image URL differs between old and new `CardData`, the card views detect this via `SharedCardRenderer.hasImageChanged()`:

- Normalizes `imageUrl` (which may be `undefined`, `string`, or `string[]` for backdrop/slideshow) to arrays
- Compares length and element-wise equality

This drives the update strategy in `updateCardsInPlace`:
- **Image changed** → full card replacement via `renderCard` (image DOM is too intertwined with cover/slideshow/aspect-ratio to patch)
- **Image unchanged** → surgical `updateCardContent()` (title, subtitle, properties, text preview, URL icon, structural classes)
