import { vi } from 'vitest';
import {
  getPropertyDisplayName,
  stripNotePrefix,
  isSameProperty,
  isCheckboxProperty,
  normalizePropertyName,
  normalizeSettingsPropertyNames,
  parsePropertyList,
  toDisplayName,
  toSyntaxName,
} from '../../src/core/property-display';
import { App } from 'obsidian';

describe('property-display', () => {
  describe('getPropertyDisplayName', () => {
    it('should return empty string for empty input', () => {
      expect(getPropertyDisplayName('')).toBe('');
    });

    it('should map file.path to "file path"', () => {
      expect(getPropertyDisplayName('file.path')).toBe('file path');
      expect(getPropertyDisplayName('path')).toBe('file path');
    });

    it('should map file.tags to "file tags"', () => {
      expect(getPropertyDisplayName('file.tags')).toBe('file tags');
    });

    it('should map ctime/mtime to human-readable names', () => {
      expect(getPropertyDisplayName('file.ctime')).toBe('created time');
      expect(getPropertyDisplayName('file.mtime')).toBe('modified time');
    });

    it('should handle case-insensitive mapping', () => {
      expect(getPropertyDisplayName('FILE.PATH')).toBe('file path');
      expect(getPropertyDisplayName('File.Tags')).toBe('file tags');
    });

    it('should strip note. prefix', () => {
      expect(getPropertyDisplayName('note.customProp')).toBe('customProp');
      expect(getPropertyDisplayName('note.title')).toBe('title');
    });

    it('should strip formula. prefix', () => {
      expect(getPropertyDisplayName('formula.myCalc')).toBe('myCalc');
    });

    it('should preserve custom property names as-is', () => {
      expect(getPropertyDisplayName('MyCustomProperty')).toBe(
        'MyCustomProperty'
      );
      expect(getPropertyDisplayName('some_property')).toBe('some_property');
    });

    it('should map all file properties correctly', () => {
      expect(getPropertyDisplayName('file.name')).toBe('file name');
      expect(getPropertyDisplayName('file.basename')).toBe('file base name');
      expect(getPropertyDisplayName('file.extension')).toBe('file extension');
      expect(getPropertyDisplayName('file.size')).toBe('file size');
      expect(getPropertyDisplayName('folder')).toBe('folder');
    });

    it('should use displayNameMap when provided', () => {
      const displayNameMap = {
        'formula.Untitled': 'smile more',
        'file.name': 'filename123',
        'note.prop123': 'display-name',
      };
      expect(getPropertyDisplayName('formula.Untitled', displayNameMap)).toBe(
        'smile more'
      );
      expect(getPropertyDisplayName('file.name', displayNameMap)).toBe(
        'filename123'
      );
      expect(getPropertyDisplayName('note.prop123', displayNameMap)).toBe(
        'display-name'
      );
    });

    it('should fall back to default behavior when property not in displayNameMap', () => {
      const displayNameMap = { 'formula.Untitled': 'smile more' };
      // file.path not in map → falls back to PROPERTY_LABEL_MAP
      expect(getPropertyDisplayName('file.path', displayNameMap)).toBe(
        'file path'
      );
      // note.title not in map → falls back to prefix stripping
      expect(getPropertyDisplayName('note.title', displayNameMap)).toBe(
        'title'
      );
    });

    it('should fall back to default behavior when displayNameMap is undefined', () => {
      expect(getPropertyDisplayName('formula.Untitled', undefined)).toBe(
        'Untitled'
      );
      expect(getPropertyDisplayName('file.name', undefined)).toBe('file name');
    });
  });

  describe('stripNotePrefix', () => {
    it('should strip note. prefix', () => {
      expect(stripNotePrefix('note.title')).toBe('title');
      expect(stripNotePrefix('note.author')).toBe('author');
    });

    it('should return unchanged if no note. prefix', () => {
      expect(stripNotePrefix('title')).toBe('title');
      expect(stripNotePrefix('file.path')).toBe('file.path');
      expect(stripNotePrefix('formula.test')).toBe('formula.test');
    });

    it('should handle empty string', () => {
      expect(stripNotePrefix('')).toBe('');
    });

    it('should handle note. as entire string', () => {
      expect(stripNotePrefix('note.')).toBe('');
    });
  });

  describe('isSameProperty', () => {
    it('should match identical names', () => {
      expect(isSameProperty('ctd', 'ctd')).toBe(true);
    });

    it('should match single prefix on left', () => {
      expect(isSameProperty('note.ctd', 'ctd')).toBe(true);
    });

    it('should match single prefix on right', () => {
      expect(isSameProperty('ctd', 'note.ctd')).toBe(true);
    });

    it('should match double prefix against single prefix', () => {
      expect(isSameProperty('note.note.created', 'note.created')).toBe(true);
    });

    it('should match double prefix reversed', () => {
      expect(isSameProperty('note.created', 'note.note.created')).toBe(true);
    });

    it('should match both with same prefix', () => {
      expect(isSameProperty('note.ctd', 'note.ctd')).toBe(true);
    });

    it('should not match different properties', () => {
      expect(isSameProperty('ctd', 'upd')).toBe(false);
    });

    it('should not match prefixed different properties', () => {
      expect(isSameProperty('note.ctd', 'note.upd')).toBe(false);
    });

    it('should not false-positive with file. prefix', () => {
      expect(isSameProperty('file.mtime', 'file.ctime')).toBe(false);
    });
  });

  describe('isCheckboxProperty', () => {
    let mockApp: App;

    beforeEach(() => {
      mockApp = new App();
    });

    it('should return true for checkbox widget', () => {
      (mockApp.metadataCache as any).getAllPropertyInfos = vi
        .fn()
        .mockReturnValue({
          done: { widget: 'checkbox' },
          completed: { widget: 'checkbox' },
        });

      expect(isCheckboxProperty(mockApp, 'done')).toBe(true);
      expect(isCheckboxProperty(mockApp, 'completed')).toBe(true);
    });

    it('should return false for non-checkbox widget', () => {
      (mockApp.metadataCache as any).getAllPropertyInfos = vi
        .fn()
        .mockReturnValue({
          title: { widget: 'text' },
          date: { widget: 'date' },
        });

      expect(isCheckboxProperty(mockApp, 'title')).toBe(false);
      expect(isCheckboxProperty(mockApp, 'date')).toBe(false);
    });

    it('should strip note. prefix before checking', () => {
      (mockApp.metadataCache as any).getAllPropertyInfos = vi
        .fn()
        .mockReturnValue({
          done: { widget: 'checkbox' },
        });

      expect(isCheckboxProperty(mockApp, 'note.done')).toBe(true);
    });

    it('should return false for missing property', () => {
      (mockApp.metadataCache as any).getAllPropertyInfos = vi
        .fn()
        .mockReturnValue({});

      expect(isCheckboxProperty(mockApp, 'missing')).toBe(false);
    });

    it('should handle missing getAllPropertyInfos method', () => {
      delete (mockApp.metadataCache as any).getAllPropertyInfos;

      expect(isCheckboxProperty(mockApp, 'done')).toBe(false);
    });
  });

  describe('normalizePropertyName', () => {
    let mockApp: App;

    beforeEach(() => {
      mockApp = new App();
      // Mock workspace.getLeavesOfType to return empty (API unavailable)
      mockApp.workspace.getLeavesOfType = vi.fn().mockReturnValue([]);
    });

    it('should pass through syntax format properties', () => {
      expect(normalizePropertyName(mockApp, 'file.path')).toBe('file.path');
      expect(normalizePropertyName(mockApp, 'file.mtime')).toBe('file.mtime');
      expect(normalizePropertyName(mockApp, 'formula.test')).toBe(
        'formula.test'
      );
      expect(normalizePropertyName(mockApp, 'note.title')).toBe('note.title');
    });

    it('should use hardcoded fallback when no reverseMap', () => {
      expect(normalizePropertyName(mockApp, 'file name')).toBe('file.name');
      expect(normalizePropertyName(mockApp, 'created time')).toBe('file.ctime');
      expect(normalizePropertyName(mockApp, 'modified time')).toBe(
        'file.mtime'
      );
      expect(normalizePropertyName(mockApp, 'folder')).toBe('file.folder');
    });

    it('should use reverseMap when provided (Bases path)', () => {
      const reverseMap = {
        'my title': 'note.title',
        'smile more': 'formula.Untitled',
        filename123: 'file.name',
      };
      expect(normalizePropertyName(mockApp, 'my title', reverseMap)).toBe(
        'note.title'
      );
      expect(normalizePropertyName(mockApp, 'smile more', reverseMap)).toBe(
        'formula.Untitled'
      );
      expect(normalizePropertyName(mockApp, 'filename123', reverseMap)).toBe(
        'file.name'
      );
    });

    it('should not fall back to hardcoded defaults when reverseMap is provided', () => {
      const reverseMap = {};
      // "file name" normally maps to "file.name" via hardcoded defaults
      // but with an empty reverseMap, it should return as-is
      expect(normalizePropertyName(mockApp, 'file name', reverseMap)).toBe(
        'file name'
      );
    });

    it('should return custom properties as-is', () => {
      expect(normalizePropertyName(mockApp, 'customProp')).toBe('customProp');
      expect(normalizePropertyName(mockApp, 'my_property')).toBe('my_property');
    });

    it('should handle empty/whitespace input', () => {
      expect(normalizePropertyName(mockApp, '')).toBe('');
      expect(normalizePropertyName(mockApp, '   ')).toBe('   ');
    });

    it('should trim input', () => {
      expect(normalizePropertyName(mockApp, '  file.path  ')).toBe('file.path');
    });
  });

  describe('normalizeSettingsPropertyNames', () => {
    let mockApp: App;

    beforeEach(() => {
      mockApp = new App();
    });

    it('should normalize all property settings fields', () => {
      const reverseMap = {
        filename123: 'file.name',
        'smile more': 'formula.Untitled',
      };
      const displayNameMap = {
        'file.name': 'filename123',
        'formula.Untitled': 'smile more',
      };
      const settings: Record<string, unknown> = {
        titleProperty: 'filename123',
        subtitleProperty: 'smile more',
        textPreviewProperty: '',
        imageProperty: 'file.name',
        urlProperty: 'url',
      };

      normalizeSettingsPropertyNames(
        mockApp,
        settings,
        reverseMap,
        displayNameMap
      );

      expect(settings.titleProperty).toBe('file.name');
      expect(settings.subtitleProperty).toBe('formula.Untitled');
      expect(settings.textPreviewProperty).toBe(''); // empty → untouched
      expect(settings.imageProperty).toBe('file.name'); // already syntax → pass through
      expect(settings.urlProperty).toBe('url'); // unknown → as-is
    });

    it('should handle comma-separated values', () => {
      const reverseMap = {
        filename123: 'file.name',
        'created time': 'file.ctime',
      };
      const settings: Record<string, unknown> = {
        titleProperty: 'filename123, created time',
      };

      normalizeSettingsPropertyNames(mockApp, settings, reverseMap, {});

      expect(settings.titleProperty).toBe('file.name,file.ctime');
    });

    it('should attach displayNameMap to settings', () => {
      const displayNameMap = { 'file.name': 'filename123' };
      const settings: Record<string, unknown> = {};

      normalizeSettingsPropertyNames(mockApp, settings, {}, displayNameMap);

      expect((settings as any)._displayNameMap).toBe(displayNameMap);
    });
  });

  describe('parsePropertyList', () => {
    it('should parse comma-separated names into a Set', () => {
      expect(parsePropertyList('a, b, c')).toEqual(new Set(['a', 'b', 'c']));
    });

    it('should trim whitespace from items', () => {
      expect(parsePropertyList('  spaced , items ')).toEqual(
        new Set(['spaced', 'items'])
      );
    });

    it('should return empty Set for empty string', () => {
      expect(parsePropertyList('').size).toBe(0);
    });

    it('should return empty Set for only commas', () => {
      expect(parsePropertyList(',,,,').size).toBe(0);
    });

    it('should handle a single value', () => {
      expect(parsePropertyList('single')).toEqual(new Set(['single']));
    });
  });

  describe('toDisplayName', () => {
    it('should map file.mtime to modified time', () => {
      expect(toDisplayName('file.mtime')).toBe('modified time');
    });

    it('should map file.ctime to created time', () => {
      expect(toDisplayName('file.ctime')).toBe('created time');
    });

    it('should map file.folder to folder', () => {
      expect(toDisplayName('file.folder')).toBe('folder');
    });

    it('should pass through unmapped properties', () => {
      expect(toDisplayName('customProp')).toBe('customProp');
    });
  });

  describe('toSyntaxName', () => {
    it('should map modified time to file.mtime', () => {
      expect(toSyntaxName('modified time')).toBe('file.mtime');
    });

    it('should map created time to file.ctime', () => {
      expect(toSyntaxName('created time')).toBe('file.ctime');
    });

    it('should pass through unmapped properties', () => {
      expect(toSyntaxName('customProp')).toBe('customProp');
    });
  });
});
