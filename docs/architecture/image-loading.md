---
title: Image loading and caching pipeline
description: Image URL resolution, two-tier dedup cache, broken URL tracking, aspect ratio caching, and load handler wiring for both backends.
author: 🤖 Generated with Claude Code
updated: 2026-03-06
---
# Image loading and caching pipeline

The image loading pipeline resolves property values and in-note embeds into renderable URLs, deduplicates concurrent loads via a two-tier cache, tracks broken URLs to skip on re-render, caches aspect ratios to prevent layout flash, and orchestrates fade-in transitions via a double-rAF pattern. Bases and Datacore share the same core logic but diverge in handler wiring (imperative listeners vs JSX ref callbacks).

## Files

| File                           | Role                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| `src/shared/content-loader.ts` | Async image/text loading with two-tier dedup (in-flight + per-caller).                       |
| `src/shared/image-loader.ts`   | Image load/error handlers, aspect ratio caching, broken URL tracking, placeholder injection. |
| `src/utils/image.ts`           | Image path processing, embed extraction, YouTube thumbnail validation.                       |
| `src/shared/card-renderer.tsx` | JSX image ref callbacks and error/load handlers (Datacore path).                             |
| `src/bases/shared-renderer.ts` | Imperative image load handler setup (Bases path).                                            |

## Two-tier deduplication

Two independent cache layers prevent redundant image loads.

### Tier 1: In-flight dedup (module-scoped)

Prevents concurrent requests for the same image with the same configuration across all views.

| Structure              | Type                                          | Scope  | Lifetime                            |
| ---------------------- | --------------------------------------------- | ------ | ----------------------------------- |
| `inFlightImages`       | `Map<compositeKey, Promise<ImageLoadResult>>` | Module | Entry deleted after Promise settles |
| `inFlightTextPreviews` | `Map<compositeKey, Promise<string>>`          | Module | Entry deleted after Promise settles |

**Composite key format** (image): `path|fallbackToEmbeds|includeYoutube|includeCardLink`
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

### Processing pipeline ([image.ts](../../src/utils/image.ts))

| Step | Function                      | Sync/Async | What it does                                                                                     |
| ---- | ----------------------------- | ---------- | ------------------------------------------------------------------------------------------------ |
| 1    | `processImagePaths()`         | Sync       | Strips wikilink syntax, validates extensions, separates internal vs external, skips YouTube URLs |
| 2    | `resolveInternalImagePaths()` | Sync       | Resolves internal paths via `metadataCache.getFirstLinkpathDest()`, gets resource URLs           |
| 3    | Browser native                | Async      | External URLs passed through directly (browser handles load/error at render time)                |

**Valid extensions**: avif, bmp, gif, jpeg, jpg, png, svg, webp.

### Fallback chain

Order in `loadImageForEntry()`: Per-caller cache check -> Self-image check (sync, short-circuits) -> Property image processing -> Embed extraction (async) -> Empty string.

The self-image check runs BEFORE property processing. When `fallbackToEmbeds !== 'never'`, no property values exist, and the file itself is an image, it returns the file's resource path immediately — skipping property processing and embed extraction entirely.

| `fallbackToEmbeds` setting | Behavior                                             |
| -------------------------- | ---------------------------------------------------- |
| `'always'`                 | Property images + append in-note embeds              |
| `'if-unavailable'`         | Embeds only if property images array is empty        |
| `'never'`                  | Property images only, no embeds, no self-image check |

**Self-image**: Image files (extension in `VALID_IMAGE_EXTENSIONS`) use themselves as card image when no property images exist. Gated on `fallbackToEmbeds !== 'never'` AND `imagePropertyValues.length === 0`. Synchronous (`getResourcePath`), bypasses in-flight dedup.

## Embed extraction (`extractImageEmbeds()`)

Parses file content to find image references not declared in properties.

### Processing steps

1. Read file content via `vault.cachedRead()`, truncate at 100KB on line boundary
2. Strip frontmatter (handles Unix `\n` and Windows `\r\n` line endings)
3. Multi-pass code detection: fenced code blocks -> indented code blocks -> inline code
4. Extract three embed types sequentially (wikilink, markdown, cardlink), collect with document positions
5. Sort by document position, deduplicate by path
6. Resolve internal paths, validate YouTube thumbnails, limit to `maxImages`

### Embed types

| Type     | Pattern                        | Source                                  |
| -------- | ------------------------------ | --------------------------------------- |
| Wikilink | `![[path]]`, `![[path\|cap]]`  | Content outside code blocks             |
| Markdown | `![alt](url)`, `![](url "t")`  | Content outside code blocks             |
| Cardlink | `image: url` in cardlink fence | Inside `cardlink`/`embed` fenced blocks |

### YouTube thumbnail extraction

- Triggered for YouTube URLs in embeds (not in properties -- YouTube URLs in properties are skipped as non-images)
- Quality cascade: `maxresdefault` (1280x720) -> `hqdefault` (480x360) -> `mqdefault` (320x180)
- Each quality validated with 5s timeout, `naturalWidth >= 320px` check (placeholders are ~120px)
- Returns `null` if all qualities fail

## Broken URL tracking

| Structure         | Type          | Scope  | Lifetime       | Bounded by                |
| ----------------- | ------------- | ------ | -------------- | ------------------------- |
| `brokenImageUrls` | `Set<string>` | Module | Session-scoped | User's broken image count |

- `markImageBroken(url)`: Called on any load error
- `filterBrokenUrls(urls)`: Removes known-broken before render (early exit if Set empty)
- Cleared on plugin load and unload via `initExternalBlobCache()` / `cleanupExternalBlobCache()` in [slideshow.ts](../../src/shared/slideshow.ts) (see [slideshow.md](slideshow.md) for the external blob cache lifecycle)

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

### Bases path (`setupImageLoadHandler()`)

> For slideshow-specific image navigation, preloading, and failed image recovery, see [slideshow.md](slideshow.md).

1. Apply cached metadata upfront (`applyCachedImageMetadata`)
2. Check already-loaded state (`complete && naturalWidth > 0 && naturalHeight > 0 && !image-ready`)
3. If loaded: force reflow (unless `skip-cover-fade`), call `handleImageLoad()` immediately
4. Otherwise: register `load`/`error` listeners with `{ once: true }`
5. Return cleanup function for listener removal

### Datacore path (JSX ref callbacks)

| Function                | Role                                                                                                                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handleJsxImageRef()`   | Ref callback: applies cached metadata, handles already-loaded, adds fallback load listener. Edge case: `complete && naturalWidth === 0` falls through silently (neither immediate handling nor fallback listener fires) |
| `handleJsxImageLoad()`  | `onLoad`: idempotency guard via `image-ready` class, calls shared `handleImageLoad()`                                                                                                                                   |
| `handleJsxImageError()` | `onError`: hides broken img, marks URL broken via `markImageBroken()`, sets default aspect ratio, calls `handleAllImagesFailed()`                                                                                       |

### Shared core (`handleImageLoad()`)

Executed by both backends after successful image load.

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
| `image-ready` class guard | Double-processing in JSX (ref + onLoad race)         | `handleJsxImageLoad/Ref()`, `setupImageLoadHandler()` |
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
11. `skip-image-fade` (card-level, persistent on remount) MUST NOT use `transition: none` -- it kills hover zoom `transform` transitions. `opacity: 1 !important` alone is sufficient because `skip-image-fade` + `image-ready` are always added in the same JS frame (no 0→1 change to animate). `skip-cover-fade` (container-level, transient during shuffle) MAY use `transition: none` because it's removed before hover interaction occurs

## Reactive image updates (Bases)

When a file's content changes and the image URL differs between old and new `CardData`, the card views detect this via `SharedCardRenderer.hasImageChanged()`:

- Normalizes `imageUrl` (which may be `undefined`, `string`, or `string[]` for backdrop/slideshow) to arrays
- Compares length and element-wise equality

This drives the update strategy in `updateCardsInPlace`:
- **Image changed** → full card replacement via `renderCard` (image DOM is too intertwined with cover/slideshow/aspect-ratio to patch)
- **Image unchanged** → surgical `updateCardContent()` (title, subtitle, properties, text preview, URL icon)
