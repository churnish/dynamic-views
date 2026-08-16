import {
  invalidateCacheForFile,
  handleImageLoad,
  handleAllImagesFailed,
} from '../../src/core/image-loader';

// Mock slideshow module to prevent fetch calls during tests
vi.mock('../../src/core/slideshow', () => ({
  cacheExternalImage: vi.fn(),
}));

describe('image-loader', () => {
  describe('invalidateCacheForFile', () => {
    // Note: invalidateCacheForFile operates on an internal cache that we can't directly access
    // These tests verify the function doesn't throw and handles various inputs correctly

    it('should handle simple file paths', () => {
      // Should not throw for valid file paths
      expect(() => invalidateCacheForFile('images/photo.png')).not.toThrow();
      expect(() => invalidateCacheForFile('folder/image.jpg')).not.toThrow();
    });

    it('should handle file paths with spaces', () => {
      expect(() =>
        invalidateCacheForFile('My Folder/my image.png')
      ).not.toThrow();
    });

    it('should handle file paths with special characters', () => {
      expect(() =>
        invalidateCacheForFile('folder/image%20name.png')
      ).not.toThrow();
      expect(() => invalidateCacheForFile('folder/image(1).png')).not.toThrow();
    });

    it('should handle Windows-style path separators', () => {
      // The function checks for both / and \ separators
      expect(() =>
        invalidateCacheForFile('folder\\subfolder\\image.png')
      ).not.toThrow();
    });

    it('should handle nested paths', () => {
      expect(() => invalidateCacheForFile('a/b/c/d/e/image.png')).not.toThrow();
    });

    it('should handle root-level files', () => {
      expect(() => invalidateCacheForFile('image.png')).not.toThrow();
    });

    it('should handle empty string gracefully', () => {
      expect(() => invalidateCacheForFile('')).not.toThrow();
    });

    it('should handle file paths with timestamps in app:// URLs', () => {
      // The cache uses app://local/<path>?timestamp format
      // invalidateCacheForFile strips query params before matching
      expect(() =>
        invalidateCacheForFile('attachments/photo.jpg')
      ).not.toThrow();
    });

    it('should handle file paths matching multiple URL patterns', () => {
      // Function should handle files that might match multiple cache entries
      // with different timestamps
      expect(() => invalidateCacheForFile('common/image.png')).not.toThrow();
    });

    it('should handle Unicode characters in paths', () => {
      expect(() =>
        invalidateCacheForFile('folder/image_name.png')
      ).not.toThrow();
    });
  });

  describe('handleAllImagesFailed', () => {
    it('removes .card-poster so no fade paints over an empty box', () => {
      const cardEl = document.createElement('div');
      cardEl.className = 'card image-format-poster has-poster';
      const posterEl = document.createElement('div');
      posterEl.className = 'card-poster';
      posterEl.appendChild(document.createElement('img'));
      const gradient = document.createElement('div');
      gradient.className = 'poster-gradient';
      posterEl.appendChild(gradient);
      cardEl.appendChild(posterEl);
      document.body.appendChild(cardEl);

      handleAllImagesFailed(cardEl);

      expect(cardEl.querySelector('.card-poster')).toBeNull();
      expect(cardEl.querySelector('.poster-gradient')).toBeNull();
      expect(cardEl.classList.contains('has-poster')).toBe(false);
      expect(cardEl.classList.contains('no-valid-images')).toBe(true);
      cardEl.remove();
    });

    it('removes .card-backdrop for the same reason', () => {
      const cardEl = document.createElement('div');
      cardEl.className = 'card image-format-backdrop has-backdrop';
      const backdropEl = document.createElement('div');
      backdropEl.className = 'card-backdrop';
      backdropEl.appendChild(document.createElement('img'));
      cardEl.appendChild(backdropEl);
      document.body.appendChild(cardEl);

      handleAllImagesFailed(cardEl);

      expect(cardEl.querySelector('.card-backdrop')).toBeNull();
      expect(cardEl.classList.contains('has-backdrop')).toBe(false);
      cardEl.remove();
    });
  });

  describe('handleImageLoad', () => {
    it('defers image-ready via rAF when imgEl.complete is true (fade for cached first-mount)', () => {
      const cardEl = document.createElement('div');
      document.body.appendChild(cardEl);
      const imgEl = document.createElement('img');
      imgEl.src = 'test.jpg';
      Object.defineProperty(imgEl, 'complete', { value: true });
      Object.defineProperty(imgEl, 'naturalWidth', { value: 100 });
      Object.defineProperty(imgEl, 'naturalHeight', { value: 100 });

      handleImageLoad(imgEl, cardEl);
      expect(cardEl.classList.contains('image-ready')).toBe(false);
      cardEl.remove();
    });

    it('adds image-ready synchronously when card has skip-image-fade (remount)', () => {
      const cardEl = document.createElement('div');
      cardEl.classList.add('skip-image-fade');
      document.body.appendChild(cardEl);
      const imgEl = document.createElement('img');
      imgEl.src = 'test.jpg';
      Object.defineProperty(imgEl, 'complete', { value: true });
      Object.defineProperty(imgEl, 'naturalWidth', { value: 100 });
      Object.defineProperty(imgEl, 'naturalHeight', { value: 100 });

      handleImageLoad(imgEl, cardEl);
      expect(cardEl.classList.contains('image-ready')).toBe(true);
      cardEl.remove();
    });

    it('defers image-ready via rAF when imgEl.complete is false', () => {
      const cardEl = document.createElement('div');
      document.body.appendChild(cardEl);
      const imgEl = document.createElement('img');
      imgEl.src = 'test.jpg';
      Object.defineProperty(imgEl, 'complete', { value: false });
      Object.defineProperty(imgEl, 'naturalWidth', { value: 100 });
      Object.defineProperty(imgEl, 'naturalHeight', { value: 100 });

      handleImageLoad(imgEl, cardEl);
      expect(cardEl.classList.contains('image-ready')).toBe(false);
      cardEl.remove();
    });

    it('adds image-ready synchronously when ancestor has skip-cover-fade', () => {
      const wrapper = document.createElement('div');
      wrapper.classList.add('skip-cover-fade');
      const cardEl = document.createElement('div');
      wrapper.appendChild(cardEl);
      document.body.appendChild(wrapper);
      const imgEl = document.createElement('img');
      imgEl.src = 'test.jpg';
      Object.defineProperty(imgEl, 'complete', { value: false });
      Object.defineProperty(imgEl, 'naturalWidth', { value: 100 });
      Object.defineProperty(imgEl, 'naturalHeight', { value: 100 });

      handleImageLoad(imgEl, cardEl);
      expect(cardEl.classList.contains('image-ready')).toBe(true);
      wrapper.remove();
    });

    it('calls onLayoutUpdate synchronously when skip-image-fade is set', () => {
      const cardEl = document.createElement('div');
      cardEl.classList.add('skip-image-fade');
      document.body.appendChild(cardEl);
      const imgEl = document.createElement('img');
      imgEl.src = 'test.jpg';
      Object.defineProperty(imgEl, 'complete', { value: true });
      Object.defineProperty(imgEl, 'naturalWidth', { value: 100 });
      Object.defineProperty(imgEl, 'naturalHeight', { value: 100 });
      const onLayout = vi.fn();

      handleImageLoad(imgEl, cardEl, onLayout);
      expect(onLayout).toHaveBeenCalledOnce();
      cardEl.remove();
    });
  });
});
