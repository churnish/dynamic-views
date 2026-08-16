/**
 * YouTube thumbnail extraction
 * Extracts video IDs and validates thumbnail availability
 */

import { VIEW_DEFAULTS_RANGES } from './view-validation';

/**
 * Thumbnail rungs, widest first.
 *
 * `mq` and `hq` exist for every live video; `sd` and `maxres` are conditional.
 * That is why rung selection always descends on failure rather than trusting the
 * requested rung to exist. (`default`, at 120x90, is unreachable — it is
 * narrower than `MIN_THUMBNAIL_WIDTH`, which is what rejects the placeholder.)
 */
const YOUTUBE_THUMBNAIL_RUNGS = [
  { name: 'maxresdefault', width: 1280 },
  { name: 'sddefault', width: 640 },
  { name: 'hqdefault', width: 480 },
  { name: 'mqdefault', width: 320 },
] as const;

/** Path segments that carry the video ID directly after them */
const YOUTUBE_ID_SEGMENTS = ['embed', 'shorts', 'v', 'live'];

/**
 * Extract YouTube video ID from a URL
 * Supports: youtube.com/watch?v=, youtu.be/, /embed/, /shorts/, /v/, /live/
 */
export function getYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    // Any subdomain counts — music. and gaming. serve the same videos as www.
    // A fully-qualified name may carry a trailing dot, which never matches
    const host = parsed.hostname.toLowerCase().replace(/\.+$/, '');

    if (host === 'youtu.be') {
      // Trailing slashes would otherwise land in the ID and 404 the thumbnail
      const id = parsed.pathname.replace(/^\/+|\/+$/g, '');
      return id || null; // Return null for empty ID (e.g., youtu.be/)
    }
    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      if (parsed.searchParams.has('v')) return parsed.searchParams.get('v');
      const segments = parsed.pathname.split('/');
      // Check segment exists (length check handles edge case of ID "0")
      if (YOUTUBE_ID_SEGMENTS.includes(segments[1]) && segments.length > 2) {
        return segments[2] || null; // Return null if empty segment
      }
    }
  } catch {
    /* invalid URL */
  }
  return null;
}

/** Thumbnail path on either serving host: /vi/<id>/<rung>.jpg, /vi_webp/… */
const THUMBNAIL_PATH_REGEX =
  /^\/vi(?:_webp)?\/([^/]+)\/[A-Za-z0-9]+\.(?:jpg|webp)$/;

/**
 * Recover a video ID from a thumbnail URL this module produced.
 *
 * `getYouTubeVideoId` cannot do this: `vi` is not a video-ID segment, and the
 * WebP host is not a youtube.com name at all. The viewer needs the ID to
 * re-resolve a card's downscaled rung at full resolution, and the card only ever
 * holds the thumbnail URL.
 *
 * Deliberately limited to the two hosts this module emits — its only job is to
 * recognise our own URLs, not to classify arbitrary ytimg links.
 */
export function getVideoIdFromThumbnailUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/\.+$/, '');
    if (host !== 'img.youtube.com' && host !== 'i.ytimg.com') return null;
    return THUMBNAIL_PATH_REGEX.exec(parsed.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Build the serving URL for a rung.
 *
 * WebP costs roughly half the bytes of the JPEG for identical pixels (measured
 * across six videos at every rung). `i.ytimg.com/vi_webp` was verified to carry
 * a rung wherever `img.youtube.com/vi` carries it, and to answer a miss with the
 * same 120x90 placeholder — so the width check below applies unchanged.
 */
function buildThumbnailUrl(videoId: string, rung: string): string {
  return `https://i.ytimg.com/vi_webp/${videoId}/${rung}.webp`;
}

/**
 * Minimum width for valid YouTube thumbnail.
 * mqdefault (lowest quality we try) is 320px wide.
 * Placeholders are typically 120px wide.
 */
const MIN_THUMBNAIL_WIDTH = 320;

/**
 * Validate YouTube thumbnail URL and check it's not a placeholder
 *
 * A miss is HTTP 404 carrying a decodable 120x90 grey image, and `<img>` decides
 * load-vs-error by whether the bytes decode, not by status — so the placeholder
 * fires `onload` and only the width check rejects it. Verified on both hosts.
 */
function validateYouTubeThumbnail(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    let resolved = false;
    const cleanup = (result: boolean) => {
      if (resolved) return;
      resolved = true;
      window.clearTimeout(timeoutId);
      img.onload = null;
      img.onerror = null;
      img.src = '';
      resolve(result);
    };
    img.onload = () => cleanup(img.naturalWidth >= MIN_THUMBNAIL_WIDTH);
    img.onerror = () => cleanup(false);
    const timeoutId = window.setTimeout(() => cleanup(false), 5000);
    img.src = url;
  });
}

/**
 * Widest a thumbnail-format image can ever render, in CSS px. Read from the
 * slider bound rather than hardcoded so the two cannot drift apart.
 */
const THUMBNAIL_MAX_CSS_WIDTH = VIEW_DEFAULTS_RANGES.thumbnailSize[1];

/**
 * Widest display width a card of this format can reach, in device px.
 *
 * **Derived from stable upper bounds, never from live measurement.**
 * `thumbnailSize` is a CSS-only setting, so changing it re-renders nothing and
 * re-extracts nothing — a target read from its current value would be
 * permanently stale. `cardSize` is a *minimum* column width, and the rendered
 * width runs up to nearly twice it; a pane resize moves it with no settings
 * change at all. Both bounds therefore over-fetch slightly, which costs a rung
 * at worst and can never go blurry or stale.
 *
 * A non-finite `cardSize` yields a non-finite target, which `selectRungs` reads
 * as "wider than every rung" and answers with the full ladder — the safe
 * direction, and the reason this needs no explicit guard.
 */
export function getYouTubeTargetWidth(
  imageFormat: string,
  cardSize: number,
  devicePixelRatio: number
): number {
  const dpr =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
  const cssWidth =
    imageFormat === 'thumbnail' ? THUMBNAIL_MAX_CSS_WIDTH : cardSize * 2;
  return Math.ceil(cssWidth * dpr);
}

/**
 * Rungs to probe, in order, for a target display width.
 *
 * Picks the narrowest rung that still covers the target, then descends — a rung
 * wider than the target costs bytes for pixels that are scaled away, and the
 * conditional rungs make descent mandatory. A target wider than every rung falls
 * back to the full ladder. An omitted target keeps the historic maxres-first
 * walk, for callers that have no display size to offer.
 */
function selectRungs(
  targetWidth?: number
): readonly (typeof YOUTUBE_THUMBNAIL_RUNGS)[number][] {
  if (targetWidth === undefined) return YOUTUBE_THUMBNAIL_RUNGS;

  let startIndex = 0;
  // Walk narrowest-first so the first rung that covers the target is the
  // smallest one that does
  for (let i = YOUTUBE_THUMBNAIL_RUNGS.length - 1; i >= 0; i--) {
    if (YOUTUBE_THUMBNAIL_RUNGS[i].width >= targetWidth) {
      startIndex = i;
      break;
    }
  }
  return YOUTUBE_THUMBNAIL_RUNGS.slice(startIndex);
}

/**
 * Resolved thumbnails, keyed by video ID **and requested target width**, for the
 * life of the plugin.
 *
 * Probing costs a network round trip per rung, and callers re-run on every
 * re-render, so without this a scroll back to a card re-probes what was already
 * answered. Promises are stored rather than values so concurrent callers share
 * one probe. Entries are a URL or a null, so the map stays small enough to leave
 * unbounded — same rationale as `imageMetadataCache`.
 *
 * The target width is part of the key because it selects the rung. Keyed by
 * video ID alone, the first caller's rung would win for the whole session and a
 * thumbnail-sized view would inherit a poster-sized view's 1280px image (or the
 * reverse). The *resolved* rung cannot serve as the key — it is unknown until
 * the probe finishes.
 *
 * A miss is cached too: YouTube does eventually backfill `maxresdefault`, but
 * only over days, and this map does not outlive a plugin reload.
 */
const thumbnailCache = new Map<string, Promise<string | null>>();

/**
 * Get YouTube thumbnail URL, resolving the smallest rung that covers
 * `targetWidth` and descending through narrower rungs on failure.
 * Returns null if video has no thumbnail (only placeholder available)
 */
export function getYouTubeThumbnailUrl(
  videoId: string,
  targetWidth?: number
): Promise<string | null> {
  const cacheKey = `${videoId}|${targetWidth ?? 'max'}`;
  const cached = thumbnailCache.get(cacheKey);
  if (cached) return cached;

  const resolution = (async () => {
    for (const rung of selectRungs(targetWidth)) {
      const url = buildThumbnailUrl(videoId, rung.name);
      if (await validateYouTubeThumbnail(url)) {
        return url;
      }
    }
    return null;
  })();

  thumbnailCache.set(cacheKey, resolution);
  return resolution;
}

/** Drop every resolved thumbnail. Exposed for tests. */
export function clearYouTubeThumbnailCache(): void {
  thumbnailCache.clear();
}
