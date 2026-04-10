import { vi } from 'vitest';
import {
  getYouTubeVideoId,
  getYouTubeThumbnailUrl,
} from '../../src/core/youtube-preview';

describe('youtube-preview', () => {
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

    it('should return maxresdefault URL when image loads', async () => {
      const promise = getYouTubeThumbnailUrl('dQw4w9WgXcQ');

      const img = (global as any).__lastImage;
      if (img && img.onload) img.onload();

      const result = await promise;
      expect(result).toBe(
        'https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg'
      );
    });

    it('should fall back to hqdefault when maxres fails', async () => {
      const promise = getYouTubeThumbnailUrl('dQw4w9WgXcQ');

      // First image fails (maxres)
      let img = (global as any).__imageInstances[0];
      if (img && img.onerror) img.onerror();

      await Promise.resolve();

      // Second image loads (hqdefault)
      img = (global as any).__imageInstances[1];
      if (img && img.onload) img.onload();

      const result = await promise;
      expect(result).toBe(
        'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
      );
    });

    it('should return null when all thumbnails are below mqdefault width (320px)', async () => {
      const promise = getYouTubeThumbnailUrl('jNQXAC9IVRw');

      // All three quality levels return placeholder (below 320px)
      for (let i = 0; i < 3; i++) {
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
});
