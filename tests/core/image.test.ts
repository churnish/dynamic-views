import { vi } from 'vitest';
import {
  isExternalUrl,
  getVaultPathFromResourceUrl,
  getImageDisplayName,
  stripWikilinkSyntax,
  processImagePaths,
  resolveInternalImagePaths,
} from '../../src/core/image';
import { App, TFile } from 'obsidian';

describe('image', () => {
  describe('isExternalUrl', () => {
    it('should return true for http URLs', () => {
      expect(isExternalUrl('http://example.com/image.png')).toBe(true);
    });

    it('should return true for https URLs', () => {
      expect(isExternalUrl('https://example.com/image.png')).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(isExternalUrl('HTTP://example.com/image.png')).toBe(true);
      expect(isExternalUrl('HTTPS://example.com/image.png')).toBe(true);
    });

    it('should return false for relative paths', () => {
      expect(isExternalUrl('images/photo.png')).toBe(false);
      expect(isExternalUrl('./images/photo.png')).toBe(false);
      expect(isExternalUrl('../images/photo.png')).toBe(false);
    });

    it('should return false for absolute paths', () => {
      expect(isExternalUrl('/images/photo.png')).toBe(false);
    });

    it('should return false for wikilinks', () => {
      expect(isExternalUrl('[[image.png]]')).toBe(false);
    });

    it('should return false for other protocols', () => {
      expect(isExternalUrl('ftp://example.com/file.png')).toBe(false);
      expect(isExternalUrl('file:///path/to/file.png')).toBe(false);
    });

    it('should return false for Android Capacitor local file URLs', () => {
      expect(
        isExternalUrl(
          'http://localhost/_capacitor_file_/storage/emulated/0/Obsidian/Dev/img.jpg'
        )
      ).toBe(false);
    });
  });

  describe('stripWikilinkSyntax', () => {
    it('should strip basic wikilink syntax', () => {
      expect(stripWikilinkSyntax('[[image.png]]')).toBe('image.png');
    });

    it('should strip embed wikilink syntax', () => {
      expect(stripWikilinkSyntax('![[image.png]]')).toBe('image.png');
    });

    it('should strip wikilink with caption', () => {
      expect(stripWikilinkSyntax('[[image.png|My Caption]]')).toBe('image.png');
    });

    it('should strip embed wikilink with caption', () => {
      expect(stripWikilinkSyntax('![[image.png|Caption]]')).toBe('image.png');
    });

    it('should return unchanged path without wikilink syntax', () => {
      expect(stripWikilinkSyntax('image.png')).toBe('image.png');
      expect(stripWikilinkSyntax('path/to/image.png')).toBe(
        'path/to/image.png'
      );
    });

    it('should trim whitespace from extracted path', () => {
      expect(stripWikilinkSyntax('[[ image.png ]]')).toBe('image.png');
      expect(stripWikilinkSyntax('![[  image.png  |caption]]')).toBe(
        'image.png'
      );
    });

    it('should handle paths with folders', () => {
      expect(stripWikilinkSyntax('[[folder/image.png]]')).toBe(
        'folder/image.png'
      );
    });

    it('should not match partial wikilink syntax', () => {
      expect(stripWikilinkSyntax('[[image.png')).toBe('[[image.png');
      expect(stripWikilinkSyntax('image.png]]')).toBe('image.png]]');
    });

    it('should strip heading fragments', () => {
      expect(stripWikilinkSyntax('[[image.png#heading]]')).toBe('image.png');
      expect(stripWikilinkSyntax('![[photo.jpg#section]]')).toBe('photo.jpg');
    });

    it('should strip block references', () => {
      expect(stripWikilinkSyntax('![[photo.jpg#^block-id]]')).toBe('photo.jpg');
      expect(stripWikilinkSyntax('[[image.png#^abc123]]')).toBe('image.png');
    });

    it('should handle fragment and caption together', () => {
      expect(stripWikilinkSyntax('[[image.png#heading|caption]]')).toBe(
        'image.png'
      );
      expect(stripWikilinkSyntax('![[photo.jpg#^block|alt text]]')).toBe(
        'photo.jpg'
      );
    });

    it('should handle surrounding whitespace', () => {
      expect(stripWikilinkSyntax('  [[image.png]]  ')).toBe('image.png');
      expect(stripWikilinkSyntax('\t![[photo.jpg]]\n')).toBe('photo.jpg');
    });

    it('should return null/undefined as empty string', () => {
      expect(stripWikilinkSyntax(null)).toBe('');
      expect(stripWikilinkSyntax(undefined)).toBe('');
    });
  });

  describe('processImagePaths', () => {
    it('should separate internal paths and external URLs', () => {
      const paths = ['image.png', 'https://example.com/image.jpg'];
      const result = processImagePaths(paths);

      expect(result.internalPaths).toEqual(['image.png']);
      expect(result.externalUrls).toEqual(['https://example.com/image.jpg']);
    });

    it('should strip wikilink syntax', () => {
      const paths = ['[[image.png]]', '![[photo.jpg]]'];
      const result = processImagePaths(paths);

      expect(result.internalPaths).toContain('image.png');
      expect(result.internalPaths).toContain('photo.jpg');
    });

    it('should validate image extensions for internal paths only', () => {
      const paths = ['image.png', 'document.pdf', 'photo.jpg'];
      const result = processImagePaths(paths);

      expect(result.internalPaths).toContain('image.png');
      expect(result.internalPaths).toContain('photo.jpg');
      expect(result.internalPaths).not.toContain('document.pdf');
    });

    it('should pass through external URLs without validation', () => {
      const paths = [
        'https://example.com/valid.png',
        'https://example.com/other.png',
      ];
      const result = processImagePaths(paths);

      // All external URLs pass through - browser handles load/error at render time
      expect(result.externalUrls).toEqual([
        'https://example.com/valid.png',
        'https://example.com/other.png',
      ]);
    });

    it('should skip empty paths', () => {
      const paths = ['', '  ', 'image.png'];
      const result = processImagePaths(paths);

      expect(result.internalPaths).toEqual(['image.png']);
    });

    it('should handle empty array', () => {
      const result = processImagePaths([]);

      expect(result.internalPaths).toEqual([]);
      expect(result.externalUrls).toEqual([]);
    });

    it('should pass through external URLs with query parameters', () => {
      const paths = ['https://example.com/image.png?size=large&v=2'];
      const result = processImagePaths(paths);

      expect(result.externalUrls).toEqual([
        'https://example.com/image.png?size=large&v=2',
      ]);
    });

    it('should pass through external URLs without file extensions', () => {
      const paths = [
        'https://picsum.photos/200',
        'https://api.example.com/image/123',
      ];
      const result = processImagePaths(paths);

      expect(result.externalUrls).toContain('https://picsum.photos/200');
      expect(result.externalUrls).toContain(
        'https://api.example.com/image/123'
      );
    });
  });

  describe('resolveInternalImagePaths', () => {
    let mockApp: App;

    beforeEach(() => {
      mockApp = new App();
    });

    it('should resolve internal image paths to resource URLs', () => {
      const mockFile = { extension: 'png' } as TFile;
      mockApp.metadataCache.getFirstLinkpathDest = vi
        .fn()
        .mockReturnValue(mockFile);
      mockApp.vault.getResourcePath = vi
        .fn()
        .mockReturnValue('app://local/image.png');

      const result = resolveInternalImagePaths(
        ['image.png'],
        'note.md',
        mockApp
      );

      expect(result).toEqual(['app://local/image.png']);
      expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
        'image.png',
        'note.md'
      );
    });

    it('should filter out non-image files', () => {
      const mockFile = { extension: 'pdf' } as TFile;
      mockApp.metadataCache.getFirstLinkpathDest = vi
        .fn()
        .mockReturnValue(mockFile);

      const result = resolveInternalImagePaths(
        ['document.pdf'],
        'note.md',
        mockApp
      );

      expect(result).toEqual([]);
    });

    it('should skip files that cannot be found', () => {
      mockApp.metadataCache.getFirstLinkpathDest = vi
        .fn()
        .mockReturnValue(null);

      const result = resolveInternalImagePaths(
        ['missing.png'],
        'note.md',
        mockApp
      );

      expect(result).toEqual([]);
    });

    it('should handle multiple paths', () => {
      const mockFile1 = { extension: 'png' } as TFile;
      const mockFile2 = { extension: 'jpg' } as TFile;

      mockApp.metadataCache.getFirstLinkpathDest = vi
        .fn()
        .mockReturnValueOnce(mockFile1)
        .mockReturnValueOnce(mockFile2);

      mockApp.vault.getResourcePath = vi
        .fn()
        .mockReturnValueOnce('app://local/image1.png')
        .mockReturnValueOnce('app://local/image2.jpg');

      const result = resolveInternalImagePaths(
        ['image1.png', 'image2.jpg'],
        'note.md',
        mockApp
      );

      expect(result).toEqual([
        'app://local/image1.png',
        'app://local/image2.jpg',
      ]);
    });

    it('should accept all valid image extensions', () => {
      const extensions = [
        'avif',
        'bmp',
        'gif',
        'jpeg',
        'jpg',
        'png',
        'svg',
        'webp',
      ];

      extensions.forEach((ext) => {
        const mockFile = { extension: ext } as TFile;
        mockApp.metadataCache.getFirstLinkpathDest = vi
          .fn()
          .mockReturnValue(mockFile);
        mockApp.vault.getResourcePath = vi
          .fn()
          .mockReturnValue(`app://local/image.${ext}`);

        const result = resolveInternalImagePaths(
          [`image.${ext}`],
          'note.md',
          mockApp
        );

        expect(result.length).toBe(1);
      });
    });
  });

  describe('getVaultPathFromResourceUrl', () => {
    // Pathname format: /<vault-id-segment>/<vault-path>
    // The function skips the leading slash and the first path segment (vault ID)
    it('should extract vault path from modern app:// URL', () => {
      expect(
        getVaultPathFromResourceUrl('app://abc123/vault-id/path/to/image.png')
      ).toBe('path/to/image.png');
    });

    it('should extract vault path from legacy app://local/ URL', () => {
      expect(
        getVaultPathFromResourceUrl('app://local/vault-id/path/to/image.png')
      ).toBe('path/to/image.png');
    });

    it('should decode URL-encoded characters', () => {
      expect(
        getVaultPathFromResourceUrl(
          'app://id/vault-id/path%20with%20spaces/img.png'
        )
      ).toBe('path with spaces/img.png');
    });

    it('should handle deep paths', () => {
      expect(getVaultPathFromResourceUrl('app://id/vault-id/a/b/c/d.png')).toBe(
        'a/b/c/d.png'
      );
    });

    it('should return null for non-app protocol', () => {
      expect(getVaultPathFromResourceUrl('https://example.com')).toBeNull();
    });

    it('should return null when no path after ID', () => {
      expect(getVaultPathFromResourceUrl('app://id')).toBeNull();
    });

    it('should return null for malformed input', () => {
      expect(getVaultPathFromResourceUrl('not-a-url')).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(getVaultPathFromResourceUrl('')).toBeNull();
    });
  });

  describe('getImageDisplayName', () => {
    it('should return the basename of a vault resource URL', () => {
      expect(
        getImageDisplayName('app://abc123/Users/me/vault/Assets/photo.png')
      ).toBe('photo.png');
    });

    it('should ignore the query string appended to vault resource URLs', () => {
      expect(
        getImageDisplayName('app://abc123/vault/photo.png?1712345678')
      ).toBe('photo.png');
    });

    it('should return the basename of an external URL', () => {
      expect(getImageDisplayName('https://example.com/a/b/cover.jpg')).toBe(
        'cover.jpg'
      );
    });

    it('should ignore the query string on an external URL', () => {
      expect(
        getImageDisplayName('https://example.com/cover.jpg?w=800&h=600')
      ).toBe('cover.jpg');
    });

    it('should decode percent-encoded file names', () => {
      expect(getImageDisplayName('app://abc123/vault/my%20photo%202.png')).toBe(
        'my photo 2.png'
      );
    });

    it('should return empty string for data URIs', () => {
      expect(getImageDisplayName('data:image/png;base64,iVBORw0KGgo=')).toBe(
        ''
      );
    });

    it('should return empty string for blob URLs with no path basename', () => {
      expect(getImageDisplayName('not-a-url')).toBe('');
    });

    it('should return empty string for empty input', () => {
      expect(getImageDisplayName('')).toBe('');
    });
  });
});
