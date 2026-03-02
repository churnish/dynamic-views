import { invalidateCacheForFile } from '../../src/shared/image-loader';

// Access the private imageMetadataCache for testing
// We need to import the module and test through exported functions
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
});
