/**
 * YouTube thumbnail extraction
 * Extracts video IDs and validates thumbnail availability
 */

/**
 * YouTube thumbnail quality levels in order of preference
 */
const YOUTUBE_THUMBNAIL_QUALITIES = [
  'maxresdefault', // 1280x720
  'hqdefault', // 480x360
  'mqdefault', // 320x180
];

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

/**
 * Minimum width for valid YouTube thumbnail.
 * mqdefault (lowest quality we try) is 320px wide.
 * Placeholders are typically 120px wide.
 */
const MIN_THUMBNAIL_WIDTH = 320;

/**
 * Validate YouTube thumbnail URL and check it's not a placeholder
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
 * Resolved thumbnails, keyed by video ID, for the life of the plugin.
 *
 * Probing costs a network round trip per quality level, and callers re-run on
 * every re-render, so without this a scroll back to a card re-probes what was
 * already answered. Promises are stored rather than values so concurrent
 * callers share one probe. Entries are a URL or a null, so the map stays small
 * enough to leave unbounded — same rationale as `imageMetadataCache`.
 *
 * A miss is cached too: YouTube does eventually backfill `maxresdefault`, but
 * only over days, and this map does not outlive a plugin reload.
 */
const thumbnailCache = new Map<string, Promise<string | null>>();

/**
 * Get YouTube thumbnail URL with fallback through quality levels
 * Returns null if video has no thumbnail (only placeholder available)
 */
export function getYouTubeThumbnailUrl(
  videoId: string
): Promise<string | null> {
  const cached = thumbnailCache.get(videoId);
  if (cached) return cached;

  const resolution = (async () => {
    for (const quality of YOUTUBE_THUMBNAIL_QUALITIES) {
      const url = `https://img.youtube.com/vi/${videoId}/${quality}.jpg`;
      if (await validateYouTubeThumbnail(url)) {
        return url;
      }
    }
    return null;
  })();

  thumbnailCache.set(videoId, resolution);
  return resolution;
}

/** Drop every resolved thumbnail. Exposed for tests. */
export function clearYouTubeThumbnailCache(): void {
  thumbnailCache.clear();
}
