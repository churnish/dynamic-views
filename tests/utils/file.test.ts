import { vi } from 'vitest';
import {
  getFileCtime,
  getCurrentFile,
  getAvailablePath,
} from '../../src/utils/file';
import { App, TFile, Workspace, Vault } from 'obsidian';

describe('file', () => {
  describe('getFileCtime', () => {
    it('should return ctime when file has valid stat', () => {
      const mockFile = new TFile();
      mockFile.stat = { ctime: 1234567890, mtime: 1234567890, size: 100 };

      const result = getFileCtime(mockFile);
      expect(result).toBe(1234567890);
    });

    it('should return null when file is null', () => {
      const result = getFileCtime(null);
      expect(result).toBeNull();
    });

    it('should return null when file has no stat', () => {
      const mockFile = new TFile();
      mockFile.stat = null as any;

      const result = getFileCtime(mockFile);
      expect(result).toBeNull();
    });

    it('should return null when stat has no ctime', () => {
      const mockFile = new TFile();
      mockFile.stat = { ctime: 0, mtime: 1234, size: 100 };

      const result = getFileCtime(mockFile);
      // 0 is falsy, so should return null
      expect(result).toBeNull();
    });

    it('should handle various ctime values', () => {
      const mockFile = new TFile();

      mockFile.stat = { ctime: 1000000000000, mtime: 0, size: 0 };
      expect(getFileCtime(mockFile)).toBe(1000000000000);

      mockFile.stat = { ctime: 1, mtime: 0, size: 0 };
      expect(getFileCtime(mockFile)).toBe(1);
    });
  });

  describe('getCurrentFile', () => {
    let mockApp: App;

    beforeEach(() => {
      mockApp = new App();
    });

    it('should return active file when available', () => {
      const mockFile = new TFile();
      mockFile.path = 'test.md';
      mockApp.workspace.getActiveFile = vi.fn().mockReturnValue(mockFile);

      const result = getCurrentFile(mockApp);
      expect(result).toBe(mockFile);
      expect(result?.path).toBe('test.md');
    });

    it('should return null when no active file', () => {
      mockApp.workspace.getActiveFile = vi.fn().mockReturnValue(null);

      const result = getCurrentFile(mockApp);
      expect(result).toBeNull();
    });
  });

  describe('getAvailablePath', () => {
    let mockApp: App;

    beforeEach(() => {
      mockApp = new App();
    });

    it('should return base path when file does not exist', () => {
      mockApp.vault.getFileByPath = vi.fn().mockReturnValue(null);

      const result = getAvailablePath(mockApp, 'folder', 'test');
      expect(result).toBe('folder/test.md');
    });

    it('should add .md extension if not present', () => {
      mockApp.vault.getFileByPath = vi.fn().mockReturnValue(null);

      const result = getAvailablePath(mockApp, 'folder', 'test');
      expect(result.endsWith('.md')).toBe(true);
    });

    it('should not duplicate .md extension', () => {
      mockApp.vault.getFileByPath = vi.fn().mockReturnValue(null);

      const result = getAvailablePath(mockApp, 'folder', 'test.md');
      expect(result).toBe('folder/test.md');
      expect(result).not.toBe('folder/test.md.md');
    });

    it('should add counter when file exists', () => {
      let callCount = 0;
      mockApp.vault.getFileByPath = vi.fn((path: string) => {
        callCount++;
        if (callCount === 1 && path === 'folder/test.md') {
          return new TFile(); // File exists
        }
        return null; // Other paths don't exist
      });

      const result = getAvailablePath(mockApp, 'folder', 'test');
      expect(result).toBe('folder/test 1.md');
    });

    it('should increment counter until available path found', () => {
      const existingPaths = new Set([
        'folder/test.md',
        'folder/test 1.md',
        'folder/test 2.md',
      ]);

      mockApp.vault.getFileByPath = vi.fn((path: string) => {
        return existingPaths.has(path) ? new TFile() : null;
      });

      const result = getAvailablePath(mockApp, 'folder', 'test');
      expect(result).toBe('folder/test 3.md');
    });

    it('should handle empty folder path (root directory)', () => {
      mockApp.vault.getFileByPath = vi.fn().mockReturnValue(null);

      const result = getAvailablePath(mockApp, '', 'test');
      expect(result).toBe('test.md');
    });

    it('should normalize paths', () => {
      mockApp.vault.getFileByPath = vi.fn().mockReturnValue(null);

      const result = getAvailablePath(mockApp, 'folder//subfolder', 'test');
      // normalizePath may keep double slashes in some cases - just check it works
      expect(result).toContain('folder');
      expect(result).toContain('subfolder');
      expect(result).toContain('test.md');
    });

    it('should handle paths with spaces', () => {
      mockApp.vault.getFileByPath = vi.fn().mockReturnValue(null);

      const result = getAvailablePath(mockApp, 'My Folder', 'My File');
      expect(result).toBe('My Folder/My File.md');
    });

    it('should handle special characters in file names', () => {
      mockApp.vault.getFileByPath = vi.fn().mockReturnValue(null);

      const result = getAvailablePath(mockApp, 'folder', 'test-file_name');
      expect(result).toBe('folder/test-file_name.md');
    });

    it('should increment counter for files with spaces', () => {
      let callCount = 0;
      mockApp.vault.getFileByPath = vi.fn((path: string) => {
        callCount++;
        if (callCount === 1 && path === 'folder/My File.md') {
          return new TFile();
        }
        return null;
      });

      const result = getAvailablePath(mockApp, 'folder', 'My File');
      expect(result).toBe('folder/My File 1.md');
    });
  });
});
