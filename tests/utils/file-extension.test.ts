import {
  getFileExtInfo,
  stripExtFromTitle,
  getFileTypeIcon,
} from '../../src/utils/file-extension';

vi.mock('../../src/utils/image', () => ({
  VALID_IMAGE_EXTENSIONS: [
    'png',
    'jpg',
    'jpeg',
    'gif',
    'svg',
    'webp',
    'bmp',
    'avif',
  ],
}));

describe('file-extension', () => {
  // ---------------------------------------------------------------------------
  // getFileExtInfo
  // ---------------------------------------------------------------------------
  describe('getFileExtInfo', () => {
    it('returns null for .md files by default', () => {
      expect(getFileExtInfo('notes/readme.md')).toBeNull();
    });

    it('returns { ext: ".md" } when forceShow is true', () => {
      expect(getFileExtInfo('notes/readme.md', true)).toEqual({
        ext: '.md',
      });
    });

    it('returns { ext: ".pdf" } for a pdf file', () => {
      expect(getFileExtInfo('docs/report.pdf')).toEqual({ ext: '.pdf' });
    });

    it('returns { ext: ".canvas" } for a canvas file', () => {
      expect(getFileExtInfo('diagrams/flow.canvas')).toEqual({
        ext: '.canvas',
      });
    });

    it('returns null for extensionless files', () => {
      expect(getFileExtInfo('Makefile')).toBeNull();
    });

    it('returns null for dotfiles', () => {
      expect(getFileExtInfo('.hidden')).toBeNull();
    });

    it('lowercases mixed-case extensions', () => {
      expect(getFileExtInfo('photo.PNG')).toEqual({ ext: '.png' });
    });

    it('works with deep paths', () => {
      expect(getFileExtInfo('a/b/c/file.txt')).toEqual({ ext: '.txt' });
    });
  });

  // ---------------------------------------------------------------------------
  // stripExtFromTitle
  // ---------------------------------------------------------------------------
  describe('stripExtFromTitle', () => {
    it('leaves .md titles unchanged by default', () => {
      expect(stripExtFromTitle('readme.md', 'notes/readme.md')).toBe(
        'readme.md'
      );
    });

    it('strips .md when forceStrip is true', () => {
      expect(stripExtFromTitle('readme.md', 'notes/readme.md', true)).toBe(
        'readme'
      );
    });

    it('strips non-md extensions', () => {
      expect(stripExtFromTitle('report.pdf', 'docs/report.pdf')).toBe('report');
    });

    it('leaves title unchanged when it does not end with the extension', () => {
      expect(stripExtFromTitle('Custom Title', 'docs/report.pdf')).toBe(
        'Custom Title'
      );
    });

    it('matches extensions case-insensitively', () => {
      expect(stripExtFromTitle('Photo.PNG', 'images/Photo.PNG')).toBe('Photo');
    });

    it('returns title unchanged for extensionless paths', () => {
      expect(stripExtFromTitle('Makefile', 'Makefile')).toBe('Makefile');
    });
  });

  // ---------------------------------------------------------------------------
  // getFileTypeIcon
  // ---------------------------------------------------------------------------
  describe('getFileTypeIcon', () => {
    it('returns null for .md files', () => {
      expect(getFileTypeIcon('notes/readme.md')).toBeNull();
    });

    it('returns "layout-dashboard" for .canvas', () => {
      expect(getFileTypeIcon('diagrams/flow.canvas')).toBe('layout-dashboard');
    });

    it('returns "layout-list" for .base', () => {
      expect(getFileTypeIcon('views/tasks.base')).toBe('layout-list');
    });

    it('returns "file-text" for .pdf', () => {
      expect(getFileTypeIcon('docs/report.pdf')).toBe('file-text');
    });

    it('returns "image" for image extensions', () => {
      expect(getFileTypeIcon('photos/cat.png')).toBe('image');
      expect(getFileTypeIcon('photos/dog.jpg')).toBe('image');
      expect(getFileTypeIcon('photos/banner.webp')).toBe('image');
    });

    it('returns "file" for unknown extensions', () => {
      expect(getFileTypeIcon('data/export.csv')).toBe('file');
    });

    it('returns null for extensionless files', () => {
      expect(getFileTypeIcon('Makefile')).toBeNull();
    });
  });
});
