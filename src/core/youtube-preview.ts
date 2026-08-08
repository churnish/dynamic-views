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

/**
 * Extract YouTube video ID from a URL
 * Supports: youtube.com/watch?v=, youtu.be/, youtube.com/embed/, youtube.com/shorts/
 */
export function getYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^(www\.|m\.)/, '');

    if (host === 'youtu.be') {
      const id = parsed.pathname.slice(1); // /VIDEO_ID
      return id || null; // Return null for empty ID (e.g., youtu.be/)
    }
    if (host === 'youtube.com') {
      // /watch?v=ID, /embed/ID, /shorts/ID, /v/ID
      if (parsed.searchParams.has('v')) return parsed.searchParams.get('v');
      const segments = parsed.pathname.split('/');
      // Check segment exists (length check handles edge case of ID "0")
      if (
        ['embed', 'shorts', 'v'].includes(segments[1]) &&
        segments.length > 2
      ) {
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
 * Get YouTube thumbnail URL with fallback through quality levels
 * Returns null if video has no thumbnail (only placeholder available)
 */
export async function getYouTubeThumbnailUrl(
  videoId: string
): Promise<string | null> {
  for (const quality of YOUTUBE_THUMBNAIL_QUALITIES) {
    const url = `https://img.youtube.com/vi/${videoId}/${quality}.jpg`;
    if (await validateYouTubeThumbnail(url)) {
      return url;
    }
  }
  return null;
}
