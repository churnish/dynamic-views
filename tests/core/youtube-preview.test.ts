import { vi } from 'vitest';
import {
  getYouTubeVideoId,
  getVideoIdFromThumbnailUrl,
  getYouTubeTargetWidth,
  getYouTubeThumbnailUrl,
  clearYouTubeThumbnailCache,
} from '../../src/core/youtube-preview';

/** Serving URL for a rung — mirrors the module's own builder */
const rungUrl = (id: string, rung: string) =>
  `https://i.ytimg.com/vi_webp/${id}/${rung}.webp`;

describe('youtube-preview', () => {
  // Resolved thumbnails persist for the life of the module, so fixtures reusing
  // a video ID would otherwise inherit the previous test's answer
  beforeEach(() => {
    clearYouTubeThumbnailCache();
  });

  describe('getYouTubeVideoId', () => {
    it('should extract video ID from standard watch URL', () => {
      expect(getYouTubeVideoId('https://youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
        'dQw4w9WgXcQ'
      );
      expect(
        getYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
      ).toBe('dQw4w9WgXcQ');
    });

    it('should extract video ID from short URL', () => {
      expect(getYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe(
        'dQw4w9WgXcQ'
      );
    });

    it('should extract video ID from mobile URL', () => {
      expect(
        getYouTubeVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')
      ).toBe('dQw4w9WgXcQ');
    });

    it('should extract video ID from embed URL', () => {
      expect(getYouTubeVideoId('https://youtube.com/embed/dQw4w9WgXcQ')).toBe(
        'dQw4w9WgXcQ'
      );
    });

    it('should extract video ID from shorts URL', () => {
      expect(getYouTubeVideoId('https://youtube.com/shorts/dQw4w9WgXcQ')).toBe(
        'dQw4w9WgXcQ'
      );
    });

    it('should extract video ID from any YouTube subdomain', () => {
      expect(
        getYouTubeVideoId('https://music.youtube.com/watch?v=dQw4w9WgXcQ')
      ).toBe('dQw4w9WgXcQ');
      expect(
        getYouTubeVideoId('https://gaming.youtube.com/watch?v=dQw4w9WgXcQ')
      ).toBe('dQw4w9WgXcQ');
    });

    it('should ignore a trailing dot in a fully-qualified host', () => {
      expect(
        getYouTubeVideoId('https://www.youtube.com./watch?v=dQw4w9WgXcQ')
      ).toBe('dQw4w9WgXcQ');
    });

    it('should extract video ID from a live URL', () => {
      expect(getYouTubeVideoId('https://youtube.com/live/dQw4w9WgXcQ')).toBe(
        'dQw4w9WgXcQ'
      );
    });

    it('should ignore trailing slashes on a short URL', () => {
      // A slash left in the ID produces a thumbnail URL that 404s
      expect(getYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ/')).toBe(
        'dQw4w9WgXcQ'
      );
    });

    it('should not treat a lookalike host as YouTube', () => {
      expect(
        getYouTubeVideoId('https://notyoutube.com/watch?v=dQw4w9WgXcQ')
      ).toBeNull();
      expect(
        getYouTubeVideoId('https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ')
      ).toBeNull();
    });

    it('should return null for non-YouTube URLs', () => {
      expect(getYouTubeVideoId('https://example.com/video')).toBeNull();
      expect(getYouTubeVideoId('https://vimeo.com/123456')).toBeNull();
    });

    it('should return null for invalid URLs', () => {
      expect(getYouTubeVideoId('not-a-url')).toBeNull();
    });

    it('should return null for empty URL', () => {
      expect(getYouTubeVideoId('')).toBeNull();
    });

    it('should return null for YouTube URL without video ID', () => {
      expect(getYouTubeVideoId('https://youtube.com/')).toBeNull();
      expect(getYouTubeVideoId('https://youtube.com/watch')).toBeNull();
    });

    it('should handle URL with timestamp parameter', () => {
      expect(
        getYouTubeVideoId('https://youtube.com/watch?v=dQw4w9WgXcQ&t=120')
      ).toBe('dQw4w9WgXcQ');
    });
  });

  describe('getYouTubeThumbnailUrl', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      (global as any).__imageInstances = [];
      (global as any).__lastImage = null;
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should serve WebP from the vi_webp host', async () => {
      const promise = getYouTubeThumbnailUrl('dQw4w9WgXcQ');

      const img = (global as any).__lastImage;
      if (img && img.onload) img.onload();

      expect(await promise).toBe(rungUrl('dQw4w9WgXcQ', 'maxresdefault'));
    });

    it('should return maxresdefault URL when image loads', async () => {
      const promise = getYouTubeThumbnailUrl('dQw4w9WgXcQ');

      const img = (global as any).__lastImage;
      if (img && img.onload) img.onload();

      const result = await promise;
      expect(result).toBe(rungUrl('dQw4w9WgXcQ', 'maxresdefault'));
    });

    it('should descend maxres to sd to hq when the wider rungs fail', async () => {
      const promise = getYouTubeThumbnailUrl('dQw4w9WgXcQ');

      // maxres, then sd, both missing
      for (let level = 0; level < 2; level++) {
        const img = (global as any).__imageInstances[level];
        if (img && img.onerror) img.onerror();
        await Promise.resolve();
      }

      // hqdefault loads
      const img = (global as any).__imageInstances[2];
      if (img && img.onload) img.onload();

      expect(await promise).toBe(rungUrl('dQw4w9WgXcQ', 'hqdefault'));
    });

    it('should start at the narrowest rung that covers the target width', async () => {
      // 384px (a 128px thumbnail at DPR 3) is covered by hqdefault's 480px
      const promise = getYouTubeThumbnailUrl('dQw4w9WgXcQ', 384);

      const img = (global as any).__imageInstances[0];
      expect(img.src).toBe(rungUrl('dQw4w9WgXcQ', 'hqdefault'));
      img.onload();

      expect(await promise).toBe(rungUrl('dQw4w9WgXcQ', 'hqdefault'));
      // One probe, not a walk down from maxres
      expect((global as any).__imageInstances.length).toBe(1);
    });

    it('should descend below the target rung when it is missing', async () => {
      const promise = getYouTubeThumbnailUrl('dQw4w9WgXcQ', 384);

      // hqdefault missing for this video
      let img = (global as any).__imageInstances[0];
      img.onerror();
      await Promise.resolve();

      img = (global as any).__imageInstances[1];
      expect(img.src).toBe(rungUrl('dQw4w9WgXcQ', 'mqdefault'));
      img.onload();

      expect(await promise).toBe(rungUrl('dQw4w9WgXcQ', 'mqdefault'));
    });

    it('should never probe above the target rung', async () => {
      // 128px at DPR 1 is covered by mqdefault, the narrowest rung
      const promise = getYouTubeThumbnailUrl('dQw4w9WgXcQ', 128);

      const img = (global as any).__imageInstances[0];
      expect(img.src).toBe(rungUrl('dQw4w9WgXcQ', 'mqdefault'));
      img.onerror();

      expect(await promise).toBeNull();
      expect((global as any).__imageInstances.length).toBe(1);
    });

    it('should use the full ladder for a target wider than every rung', async () => {
      const promise = getYouTubeThumbnailUrl('dQw4w9WgXcQ', 4000);

      const img = (global as any).__imageInstances[0];
      expect(img.src).toBe(rungUrl('dQw4w9WgXcQ', 'maxresdefault'));
      img.onload();

      expect(await promise).toBe(rungUrl('dQw4w9WgXcQ', 'maxresdefault'));
    });

    it('should key the memo by target width, not video ID alone', async () => {
      // Keyed by ID alone, the first caller's rung would win for the session
      const wide = getYouTubeThumbnailUrl('dQw4w9WgXcQ', 1280);
      (global as any).__imageInstances[0].onload();
      expect(await wide).toBe(rungUrl('dQw4w9WgXcQ', 'maxresdefault'));

      const narrow = getYouTubeThumbnailUrl('dQw4w9WgXcQ', 384);
      const img = (global as any).__imageInstances[1];
      expect(img).toBeDefined();
      expect(img.src).toBe(rungUrl('dQw4w9WgXcQ', 'hqdefault'));
      img.onload();
      expect(await narrow).toBe(rungUrl('dQw4w9WgXcQ', 'hqdefault'));
    });

    it('should reuse a resolved thumbnail without probing again', async () => {
      const first = getYouTubeThumbnailUrl('dQw4w9WgXcQ');
      const img = (global as any).__imageInstances[0];
      img.naturalWidth = 1280;
      img.onload();
      expect(await first).toBe(rungUrl('dQw4w9WgXcQ', 'maxresdefault'));

      const probesAfterFirst = (global as any).__imageInstances.length;
      const second = getYouTubeThumbnailUrl('dQw4w9WgXcQ');

      expect(await second).toBe(await first);
      expect((global as any).__imageInstances.length).toBe(probesAfterFirst);
    });

    it('should reuse a miss without probing again', async () => {
      const first = getYouTubeThumbnailUrl('jNQXAC9IVRw');
      // Every rung returns the 120px placeholder
      for (let level = 0; level < 4; level++) {
        const img = (global as any).__imageInstances[level];
        img.naturalWidth = 120;
        img.onload();
        await Promise.resolve();
      }
      expect(await first).toBeNull();

      const probesAfterFirst = (global as any).__imageInstances.length;
      expect(await getYouTubeThumbnailUrl('jNQXAC9IVRw')).toBeNull();
      expect((global as any).__imageInstances.length).toBe(probesAfterFirst);
    });

    it('should return null when all thumbnails are below mqdefault width (320px)', async () => {
      const promise = getYouTubeThumbnailUrl('jNQXAC9IVRw');

      // The 404 placeholder decodes, so it fires onload — only the width check
      // rejects it. Verified 120x90 on both the JPEG and WebP hosts.
      for (let i = 0; i < 4; i++) {
        await Promise.resolve();
        const img = (global as any).__imageInstances[i];
        if (img) {
          img.naturalWidth = 120;
          img.naturalHeight = 90;
          if (img.onload) img.onload();
        }
      }

      const result = await promise;
      expect(result).toBeNull();
    });
  });

  describe('getVideoIdFromThumbnailUrl', () => {
    it('should recover the ID from a WebP thumbnail URL', () => {
      expect(
        getVideoIdFromThumbnailUrl(rungUrl('dQw4w9WgXcQ', 'hqdefault'))
      ).toBe('dQw4w9WgXcQ');
    });

    it('should recover the ID from a legacy JPEG thumbnail URL', () => {
      expect(
        getVideoIdFromThumbnailUrl(
          'https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg'
        )
      ).toBe('dQw4w9WgXcQ');
    });

    it('should reject hosts this module never emits', () => {
      expect(
        getVideoIdFromThumbnailUrl(
          'https://evil.test/vi_webp/dQw4w9WgXcQ/hqdefault.webp'
        )
      ).toBeNull();
      expect(
        getVideoIdFromThumbnailUrl(
          'https://i.ytimg.com.evil.test/vi/dQw4w9WgXcQ/hqdefault.jpg'
        )
      ).toBeNull();
    });

    it('should return null for a watch URL, an ordinary image, and junk', () => {
      // The forward parser handles watch URLs; this one must not
      expect(
        getVideoIdFromThumbnailUrl('https://youtube.com/watch?v=dQw4w9WgXcQ')
      ).toBeNull();
      expect(
        getVideoIdFromThumbnailUrl('https://example.com/photo.jpg')
      ).toBeNull();
      expect(getVideoIdFromThumbnailUrl('not-a-url')).toBeNull();
      expect(getVideoIdFromThumbnailUrl('')).toBeNull();
    });
  });

  describe('getYouTubeTargetWidth', () => {
    it('should bound a thumbnail by the slider maximum, not its current size', () => {
      // thumbnailSize is CSS-only — a live value would never re-extract
      expect(getYouTubeTargetWidth('thumbnail', 300, 1)).toBe(128);
      expect(getYouTubeTargetWidth('thumbnail', 800, 3)).toBe(384);
    });

    it('should bound other formats by twice cardSize', () => {
      // cardSize is a minimum column width; rendered width approaches double it
      expect(getYouTubeTargetWidth('cover', 300, 1)).toBe(600);
      expect(getYouTubeTargetWidth('poster', 300, 2)).toBe(1200);
      expect(getYouTubeTargetWidth('backdrop', 50, 1)).toBe(100);
    });

    it('should fall back to a ratio of 1 for a nonsense DPR', () => {
      expect(getYouTubeTargetWidth('cover', 300, 0)).toBe(600);
      expect(getYouTubeTargetWidth('cover', 300, NaN)).toBe(600);
      expect(getYouTubeTargetWidth('cover', 300, -2)).toBe(600);
    });

    it('should round a fractional DPR up rather than down', () => {
      // Rounding down would ask for fewer pixels than the card renders
      expect(getYouTubeTargetWidth('thumbnail', 300, 1.5)).toBe(192);
      expect(getYouTubeTargetWidth('cover', 301, 1.25)).toBe(753);
    });
  });
});
