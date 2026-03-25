import { vi } from 'vitest';
import {
  datacoreResultToCardData,
  basesEntryToCardData,
  transformDatacoreResults,
  transformBasesEntries,
  resolveBasesProperty,
  resolveDatacoreProperty,
  applySmartTimestamp,
} from '../../src/shared/data-transform';

import { App, TFile } from 'obsidian';

// Mock dependencies
vi.mock('../../src/utils/property');
vi.mock('../../src/shared/render-utils', () => ({
  formatTimestamp: vi.fn((ts: number) =>
    ts != null ? `formatted-${ts}` : null
  ),
  extractTimestamp: vi.fn(() => null),
  isDateValue: vi.fn(() => false),
  isTimestampToday: vi.fn(() => false),
}));

describe('data-transform', () => {
  let mockSettings: any;
  let mockApp: App;

  beforeEach(() => {
    mockSettings = {
      titleProperty: 'title',
      textPreviewProperty: 'description',
      imageProperty: 'cover',
      smartTimestamp: false,
      createdTimeProperty: 'created time',
      modifiedTimeProperty: 'modified time',
      fallbackToInNote: true,
      fallbackToEmbeds: 'always',
      pairProperties: true,
    } as any;

    mockApp = new App();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('datacoreResultToCardData', () => {
    it('should transform basic Datacore result to CardData', () => {
      const mockResult: any = {
        $path: 'test/file.md',
        $name: 'file',
        $tags: ['tag1', 'tag2'],
        $ctime: { toMillis: () => 1000000 },
        $mtime: { toMillis: () => 2000000 },
        value: vi.fn().mockReturnValue(['yaml-tag']),
        field: vi.fn().mockReturnValue({ value: ['yaml-tag'] }),
      };

      const mockDC: any = {
        coerce: {
          string: (val: any) => String(val),
        },
      };

      const result = datacoreResultToCardData(
        mockApp,
        mockResult,
        mockDC,
        mockSettings,
        'alphabetical',
        false
      );

      expect(result.path).toBe('test/file.md');
      expect(result.name).toBe('file');
      expect(result.ctime).toBe(1000000);
      expect(result.mtime).toBe(2000000);
      expect(result.tags).toEqual(['tag1', 'tag2']);
      expect(result.yamlTags).toEqual(['yaml-tag']);
    });

    it('should extract folder path correctly', () => {
      const mockResult: any = {
        $path: 'folder/subfolder/file.md',
        $name: 'file',
        $tags: [],
        $ctime: { toMillis: () => 0 },
        $mtime: { toMillis: () => 0 },
        value: vi.fn().mockReturnValue([]),
        field: vi.fn().mockReturnValue({ value: [] }),
      };

      const mockDC: any = {
        coerce: { string: (val: any) => String(val) },
      };

      const result = datacoreResultToCardData(
        mockApp,
        mockResult,
        mockDC,
        mockSettings,
        'alphabetical',
        false
      );

      expect(result.folderPath).toBe('folder/subfolder');
    });

    it('should handle missing timestamps', () => {
      const mockResult: any = {
        $path: 'file.md',
        $name: 'file',
        $tags: [],
        value: vi.fn().mockReturnValue([]),
        field: vi.fn().mockReturnValue({ value: [] }),
      };

      const mockDC: any = {
        coerce: { string: (val: any) => String(val) },
      };

      const result = datacoreResultToCardData(
        mockApp,
        mockResult,
        mockDC,
        mockSettings,
        'alphabetical',
        false
      );

      expect(result.ctime).toBe(0);
      expect(result.mtime).toBe(0);
    });

    it('should include textPreview and imageUrl when provided', () => {
      const mockResult: any = {
        $path: 'file.md',
        $name: 'file',
        $tags: [],
        $ctime: { toMillis: () => 0 },
        $mtime: { toMillis: () => 0 },
        value: vi.fn().mockReturnValue([]),
        field: vi.fn().mockReturnValue({ value: [] }),
      };

      const mockDC: any = {
        coerce: { string: (val: any) => String(val) },
      };

      const result = datacoreResultToCardData(
        mockApp,
        mockResult,
        mockDC,
        mockSettings,
        'alphabetical',
        false,
        'test textPreview',
        'image.png'
      );

      expect(result.textPreview).toBe('test textPreview');
      expect(result.imageUrl).toBe('image.png');
    });

    it('should handle array title property', async () => {
      const mockResult: any = {
        $path: 'file.md',
        $name: 'file',
        $tags: [],
        $ctime: { toMillis: () => 0 },
        $mtime: { toMillis: () => 0 },
        value: vi.fn().mockReturnValue([]),
        field: vi.fn().mockReturnValue({ value: [] }),
      };

      const mockDC: any = {
        coerce: { string: (val: any) => String(val) },
      };

      // Mock getFirstDatacorePropertyValue to return array
      const { getFirstDatacorePropertyValue } =
        (await import('../../src/utils/property')) as any;
      getFirstDatacorePropertyValue.mockReturnValue(['Title 1', 'Title 2']);

      const result = datacoreResultToCardData(
        mockApp,
        mockResult,
        mockDC,
        mockSettings,
        'alphabetical',
        false
      );

      // Should use first element
      expect(result.title).toBeTruthy();
    });
  });

  describe('basesEntryToCardData', () => {
    it('should transform basic Bases entry to CardData', () => {
      const mockEntry: any = {
        file: {
          path: 'test/file.md',
          name: 'file.md',
          basename: 'file',
          stat: {
            ctime: 1000000,
            mtime: 2000000,
          },
        },
        getValue: vi.fn(),
      };

      const result = basesEntryToCardData(
        mockApp,
        mockEntry,
        mockSettings,
        'alphabetical',
        false,
        []
      );

      expect(result.path).toBe('test/file.md');
      expect(result.name).toBe('file');
      expect(result.ctime).toBe(1000000);
      expect(result.mtime).toBe(2000000);
    });

    it('should extract folder path from file path', () => {
      const mockEntry: any = {
        file: {
          path: 'folder/subfolder/file.md',
          basename: 'file',
          stat: { ctime: 0, mtime: 0 },
        },
        getValue: vi.fn(),
      };

      const result = basesEntryToCardData(
        mockApp,
        mockEntry,
        mockSettings,
        'alphabetical',
        false,
        []
      );

      expect(result.folderPath).toBe('folder/subfolder');
    });

    it('should handle root folder files', () => {
      const mockEntry: any = {
        file: {
          path: 'file.md',
          basename: 'file',
          stat: { ctime: 0, mtime: 0 },
        },
        getValue: vi.fn(),
      };

      const result = basesEntryToCardData(
        mockApp,
        mockEntry,
        mockSettings,
        'alphabetical',
        false,
        []
      );

      expect(result.folderPath).toBe('');
    });

    it('should include textPreview and imageUrl when provided', () => {
      const mockEntry: any = {
        file: {
          path: 'file.md',
          basename: 'file',
          stat: { ctime: 0, mtime: 0 },
        },
        getValue: vi.fn(),
      };

      const result = basesEntryToCardData(
        mockApp,
        mockEntry,
        mockSettings,
        'alphabetical',
        false,
        [],
        'test textPreview',
        ['img1.png', 'img2.png']
      );

      expect(result.textPreview).toBe('test textPreview');
      expect(result.imageUrl).toEqual(['img1.png', 'img2.png']);
    });

    describe('_skipLeadingProperties slicing', () => {
      const createEntry = (): any => ({
        file: {
          path: 'test/file.md',
          basename: 'file',
          stat: { ctime: 0, mtime: 0 },
        },
        getValue: vi.fn(),
      });

      it('should include all properties when _skipLeadingProperties is 0', () => {
        const settings = { ...mockSettings, _skipLeadingProperties: 0 };
        const result = basesEntryToCardData(
          mockApp,
          createEntry(),
          settings,
          'alphabetical',
          false,
          ['file.path', 'file.ctime']
        );
        expect(result.properties.map((p: any) => p.name)).toEqual([
          'file.path',
          'file.ctime',
        ]);
      });

      it('should skip first property when _skipLeadingProperties is 1', () => {
        const settings = { ...mockSettings, _skipLeadingProperties: 1 };
        const result = basesEntryToCardData(
          mockApp,
          createEntry(),
          settings,
          'alphabetical',
          false,
          ['file.path', 'file.ctime']
        );
        expect(result.properties.map((p: any) => p.name)).toEqual([
          'file.ctime',
        ]);
      });

      it('should skip first two properties when _skipLeadingProperties is 2', () => {
        const settings = { ...mockSettings, _skipLeadingProperties: 2 };
        const result = basesEntryToCardData(
          mockApp,
          createEntry(),
          settings,
          'alphabetical',
          false,
          ['file.path', 'file.ctime', 'file.mtime']
        );
        expect(result.properties.map((p: any) => p.name)).toEqual([
          'file.mtime',
        ]);
      });

      it('should default to 0 when _skipLeadingProperties is undefined', () => {
        const { _skipLeadingProperties, ...settings } = {
          ...mockSettings,
          _skipLeadingProperties: undefined,
        };
        const result = basesEntryToCardData(
          mockApp,
          createEntry(),
          settings,
          'alphabetical',
          false,
          ['file.path', 'file.ctime']
        );
        expect(result.properties.map((p: any) => p.name)).toEqual([
          'file.path',
          'file.ctime',
        ]);
      });
    });
  });

  describe('transformDatacoreResults', () => {
    it('should transform array of Datacore results', () => {
      const mockResults: any[] = [
        {
          $path: 'file1.md',
          $name: 'file1',
          $tags: [],
          $ctime: { toMillis: () => 1000 },
          $mtime: { toMillis: () => 2000 },
          value: vi.fn().mockReturnValue([]),
          field: vi.fn().mockReturnValue({ value: [] }),
        },
        {
          $path: 'file2.md',
          $name: 'file2',
          $tags: [],
          $ctime: { toMillis: () => 3000 },
          $mtime: { toMillis: () => 4000 },
          value: vi.fn().mockReturnValue([]),
          field: vi.fn().mockReturnValue({ value: [] }),
        },
      ];

      const mockDC: any = {
        coerce: { string: (val: any) => String(val) },
      };

      const textPreviews = {
        'file1.md': 'textPreview 1',
        'file2.md': 'textPreview 2',
      };

      const images = {
        'file1.md': 'img1.png',
        'file2.md': 'img2.png',
      };

      const hasImageAvailable = {
        'file1.md': true,
        'file2.md': true,
      };

      const result = transformDatacoreResults(
        mockApp,
        mockResults,
        mockDC,
        mockSettings,
        'alphabetical',
        false,
        textPreviews,
        images,
        hasImageAvailable
      );

      expect(result).toHaveLength(2);
      expect(result[0].path).toBe('file1.md');
      expect(result[0].textPreview).toBe('textPreview 1');
      expect(result[0].imageUrl).toBe('img1.png');
      expect(result[1].path).toBe('file2.md');
      expect(result[1].textPreview).toBe('textPreview 2');
      expect(result[1].imageUrl).toBe('img2.png');
    });

    it('should handle empty results array', () => {
      const mockDC: any = {
        coerce: { string: (val: any) => String(val) },
      };

      const result = transformDatacoreResults(
        mockApp,
        [],
        mockDC,
        mockSettings,
        'alphabetical',
        false
      );

      expect(result).toEqual([]);
    });

    it('should work without textPreviews and images maps', () => {
      const mockResults: any[] = [
        {
          $path: 'file.md',
          $name: 'file',
          $tags: [],
          $ctime: { toMillis: () => 0 },
          $mtime: { toMillis: () => 0 },
          value: vi.fn().mockReturnValue([]),
          field: vi.fn().mockReturnValue({ value: [] }),
        },
      ];

      const mockDC: any = {
        coerce: { string: (val: any) => String(val) },
      };

      const result = transformDatacoreResults(
        mockApp,
        mockResults,
        mockDC,
        mockSettings,
        'alphabetical',
        false,
        {},
        {},
        {}
      );

      expect(result).toHaveLength(1);
      expect(result[0].textPreview).toBeUndefined();
      expect(result[0].imageUrl).toBeUndefined();
    });
  });

  describe('transformBasesEntries', () => {
    it('should transform array of Bases entries', () => {
      const mockEntries: any[] = [
        {
          file: {
            path: 'file1.md',
            basename: 'file1',
            stat: { ctime: 1000, mtime: 2000 },
          },
          getValue: vi.fn(),
        },
        {
          file: {
            path: 'file2.md',
            basename: 'file2',
            stat: { ctime: 3000, mtime: 4000 },
          },
          getValue: vi.fn(),
        },
      ];

      const textPreviews = {
        'file1.md': 'textPreview 1',
        'file2.md': 'textPreview 2',
      };

      const images = {
        'file1.md': 'img1.png',
        'file2.md': 'img2.png',
      };

      const hasImageAvailable = {
        'file1.md': true,
        'file2.md': false,
      };

      const result = transformBasesEntries(
        mockApp,
        mockEntries,
        mockSettings,
        'alphabetical',
        false,
        [],
        textPreviews,
        images,
        hasImageAvailable
      );

      expect(result).toHaveLength(2);
      expect(result[0].path).toBe('file1.md');
      expect(result[0].textPreview).toBe('textPreview 1');
      expect(result[1].path).toBe('file2.md');
      expect(result[1].textPreview).toBe('textPreview 2');
    });

    it('should handle empty entries array', () => {
      const result = transformBasesEntries(
        mockApp,
        [],
        mockSettings,
        'alphabetical',
        false,
        [],
        {},
        {},
        {}
      );

      expect(result).toEqual([]);
    });
  });

  describe('resolveBasesProperty', () => {
    it('should resolve file.path property', () => {
      const mockEntry: any = {
        file: { path: 'test/folder/file.md' },
      };

      const mockCardData: any = {
        path: 'test/folder/file.md',
        folderPath: 'test/folder',
        tags: [],
        yamlTags: [],
        ctime: 1000000,
        mtime: 2000000,
      };

      const result = resolveBasesProperty(
        mockApp,
        'file.path',
        mockEntry,
        mockCardData,
        mockSettings
      );

      expect(result).toBe('test/folder/file.md');
    });

    it('should resolve file path property with space variant', () => {
      const mockEntry: any = {
        file: { path: 'test/folder/file.md' },
      };

      const mockCardData: any = {
        path: 'test/folder/file.md',
        folderPath: 'test/folder',
        tags: [],
        yamlTags: [],
        ctime: 1000000,
        mtime: 2000000,
      };

      const result = resolveBasesProperty(
        mockApp,
        'file path',
        mockEntry,
        mockCardData,
        mockSettings
      );

      expect(result).toBe('test/folder/file.md');
    });

    it('should return null for empty file.path', () => {
      const mockEntry: any = {
        file: { path: '' },
      };

      const mockCardData: any = {
        path: '',
        folderPath: '',
        tags: [],
        yamlTags: [],
        ctime: 1000000,
        mtime: 2000000,
      };

      const result = resolveBasesProperty(
        mockApp,
        'file.path',
        mockEntry,
        mockCardData,
        mockSettings
      );

      expect(result).toBeNull();
    });

    it('should resolve file.folder with nested path', () => {
      const mockEntry: any = {
        file: { path: 'folder/subfolder/file.md' },
      };

      const mockCardData: any = {
        path: 'folder/subfolder/file.md',
        folderPath: 'folder/subfolder',
        tags: [],
        yamlTags: [],
        ctime: 1000000,
        mtime: 2000000,
      };

      const result = resolveBasesProperty(
        mockApp,
        'file.folder',
        mockEntry,
        mockCardData,
        mockSettings
      );

      expect(result).toBe('folder/subfolder');
    });

    it("should resolve file.folder with root file (empty folderPath) as '/'", () => {
      const mockEntry: any = {
        file: { path: 'file.md' },
      };

      const mockCardData: any = {
        path: 'file.md',
        folderPath: '',
        tags: [],
        yamlTags: [],
        ctime: 1000000,
        mtime: 2000000,
      };

      const result = resolveBasesProperty(
        mockApp,
        'file.folder',
        mockEntry,
        mockCardData,
        mockSettings
      );

      expect(result).toBe('/');
    });

    it("should resolve 'folder' variant same as file.folder", () => {
      const mockEntry: any = {
        file: { path: 'projects/readme.md' },
      };

      const mockCardData: any = {
        path: 'projects/readme.md',
        folderPath: 'projects',
        tags: [],
        yamlTags: [],
        ctime: 1000000,
        mtime: 2000000,
      };

      const result = resolveBasesProperty(
        mockApp,
        'folder',
        mockEntry,
        mockCardData,
        mockSettings
      );

      expect(result).toBe('projects');
    });

    it('should resolve file.tags property', () => {
      mockApp.metadataCache.getFileCache = vi.fn().mockReturnValue({
        tags: [{ tag: '#tag1' }, { tag: '#tag2' }],
      });

      const mockEntry: any = {
        file: { path: 'file.md' },
      };

      const mockCardData: any = {
        folderPath: '',
        tags: ['tag1', 'tag2'],
        yamlTags: [],
        ctime: 1000000,
        mtime: 2000000,
      };

      const result = resolveBasesProperty(
        mockApp,
        'file.tags',
        mockEntry,
        mockCardData,
        mockSettings
      );

      expect(result).toBe('tags');
    });

    it('should handle null/undefined property values', () => {
      const mockEntry: any = {
        file: { path: 'file.md' },
        getValue: vi.fn().mockReturnValue(null),
      };

      const mockCardData: any = {
        folderPath: '',
        tags: [],
        yamlTags: [],
        ctime: 1000000,
        mtime: 2000000,
      };

      const result = resolveBasesProperty(
        mockApp,
        'customProp',
        mockEntry,
        mockCardData,
        mockSettings
      );

      // Should return null for missing property
      expect(result).toBeNull();
    });

    describe('empty vs missing property detection (Bases)', () => {
      it('should return null for missing property (not in frontmatter)', async () => {
        const { getFirstBasesPropertyValue } =
          (await import('../../src/utils/property')) as any;
        // Missing property returns null
        getFirstBasesPropertyValue.mockReturnValue(null);

        const mockEntry: any = {
          file: { path: 'test.md' },
          getValue: vi.fn(),
        };

        const mockCardData: any = {
          path: 'test.md',
          folderPath: '',
          tags: [],
          yamlTags: [],
          ctime: 1000000,
          mtime: 2000000,
        };

        const result = resolveBasesProperty(
          mockApp,
          'nonExistentProp',
          mockEntry,
          mockCardData,
          mockSettings
        );

        // Missing property returns null
        expect(result).toBeNull();
      });

      it('should return empty string for property that exists but is empty', async () => {
        const { getFirstBasesPropertyValue, isCheckboxProperty } =
          (await import('../../src/utils/property')) as any;
        // Property exists but has null data (empty value in frontmatter)
        getFirstBasesPropertyValue.mockReturnValue({ data: null });
        // Not a checkbox
        isCheckboxProperty.mockReturnValue(false);

        const mockEntry: any = {
          file: { path: 'test.md' },
          getValue: vi.fn(),
        };

        const mockCardData: any = {
          path: 'test.md',
          folderPath: '',
          tags: [],
          yamlTags: [],
          ctime: 1000000,
          mtime: 2000000,
        };

        const result = resolveBasesProperty(
          mockApp,
          'emptyProp',
          mockEntry,
          mockCardData,
          mockSettings
        );

        // Empty property returns empty string to distinguish from missing
        expect(result).toBe('');
      });

      it('should return empty string for property with empty string value', async () => {
        const { getFirstBasesPropertyValue, isCheckboxProperty } =
          (await import('../../src/utils/property')) as any;
        // Property exists with empty string data
        getFirstBasesPropertyValue.mockReturnValue({ data: '' });
        isCheckboxProperty.mockReturnValue(false);

        const mockEntry: any = {
          file: { path: 'test.md' },
          getValue: vi.fn(),
        };

        const mockCardData: any = {
          path: 'test.md',
          folderPath: '',
          tags: [],
          yamlTags: [],
          ctime: 1000000,
          mtime: 2000000,
        };

        const result = resolveBasesProperty(
          mockApp,
          'emptyStringProp',
          mockEntry,
          mockCardData,
          mockSettings
        );

        expect(result).toBe('');
      });

      it('should return empty string for property with empty array', async () => {
        const { getFirstBasesPropertyValue, isCheckboxProperty } =
          (await import('../../src/utils/property')) as any;
        // Property exists with empty array data
        getFirstBasesPropertyValue.mockReturnValue({ data: [] });
        isCheckboxProperty.mockReturnValue(false);

        const mockEntry: any = {
          file: { path: 'test.md' },
          getValue: vi.fn(),
        };

        const mockCardData: any = {
          path: 'test.md',
          folderPath: '',
          tags: [],
          yamlTags: [],
          ctime: 1000000,
          mtime: 2000000,
        };

        const result = resolveBasesProperty(
          mockApp,
          'emptyArrayProp',
          mockEntry,
          mockCardData,
          mockSettings
        );

        // Empty arrays indicate property exists but is empty
        expect(result).toBe('');
      });
    });

    describe('checkbox property handling (Bases)', () => {
      it('should create checkbox marker for boolean true', async () => {
        const { getFirstBasesPropertyValue } =
          (await import('../../src/utils/property')) as any;
        getFirstBasesPropertyValue.mockReturnValue({ data: true });

        const mockEntry: any = {
          file: { path: 'test.md' },
          getValue: vi.fn(),
        };

        const mockCardData: any = {
          path: 'test.md',
          folderPath: '',
          tags: [],
          yamlTags: [],
          ctime: 1000000,
          mtime: 2000000,
        };

        const result = resolveBasesProperty(
          mockApp,
          'done',
          mockEntry,
          mockCardData,
          mockSettings
        );

        expect(result).toBe('{"type":"checkbox","checked":true}');
      });

      it('should create checkbox marker for boolean false', async () => {
        const { getFirstBasesPropertyValue } =
          (await import('../../src/utils/property')) as any;
        getFirstBasesPropertyValue.mockReturnValue({ data: false });

        const mockEntry: any = {
          file: { path: 'test.md' },
          getValue: vi.fn(),
        };

        const mockCardData: any = {
          path: 'test.md',
          folderPath: '',
          tags: [],
          yamlTags: [],
          ctime: 1000000,
          mtime: 2000000,
        };

        const result = resolveBasesProperty(
          mockApp,
          'done',
          mockEntry,
          mockCardData,
          mockSettings
        );

        expect(result).toBe('{"type":"checkbox","checked":false}');
      });

      it('should create indeterminate marker when checkbox property has null data', async () => {
        const { getFirstBasesPropertyValue, isCheckboxProperty } =
          (await import('../../src/utils/property')) as any;
        // Property exists but has null data (empty value)
        getFirstBasesPropertyValue.mockReturnValue({ data: null });
        // Property is registered as checkbox widget
        isCheckboxProperty.mockReturnValue(true);

        const mockEntry: any = {
          file: { path: 'test.md' },
          getValue: vi.fn(),
        };

        const mockCardData: any = {
          path: 'test.md',
          folderPath: '',
          tags: [],
          yamlTags: [],
          ctime: 1000000,
          mtime: 2000000,
        };

        const result = resolveBasesProperty(
          mockApp,
          'done',
          mockEntry,
          mockCardData,
          mockSettings
        );

        expect(result).toBe('{"type":"checkbox","indeterminate":true}');
      });

      it('should return empty string for non-checkbox property with null data', async () => {
        const { getFirstBasesPropertyValue, isCheckboxProperty } =
          (await import('../../src/utils/property')) as any;
        // Property exists but has null data (empty value)
        getFirstBasesPropertyValue.mockReturnValue({ data: null });
        // Property is not a checkbox
        isCheckboxProperty.mockReturnValue(false);

        const mockEntry: any = {
          file: { path: 'test.md' },
          getValue: vi.fn(),
        };

        const mockCardData: any = {
          path: 'test.md',
          folderPath: '',
          tags: [],
          yamlTags: [],
          ctime: 1000000,
          mtime: 2000000,
        };

        const result = resolveBasesProperty(
          mockApp,
          'someProperty',
          mockEntry,
          mockCardData,
          mockSettings
        );

        // Empty string indicates property exists but is empty
        expect(result).toBe('');
      });
    });
  });

  describe('resolveDatacoreProperty', () => {
    // Mock app for all resolveDatacoreProperty tests
    const mockApp: any = {
      vault: {
        getAbstractFileByPath: vi.fn(),
        getResourcePath: vi.fn(),
      },
      metadataCache: {
        getFileCache: vi.fn(),
      },
    };

    it('should resolve file.path property', () => {
      const mockPage: any = {
        $path: 'test/folder/file.md',
        value: vi.fn(),
      };

      const mockCardData: any = {
        path: 'test/folder/file.md',
        folderPath: 'test/folder',
        tags: [],
        yamlTags: [],
        ctime: 1000000,
        mtime: 2000000,
      };

      const mockDC: any = {
        coerce: { string: (val: any) => String(val) },
      };

      const result = resolveDatacoreProperty(
        mockApp,
        'file.path',
        mockPage,
        mockCardData,
        mockSettings,
        mockDC
      );

      expect(result).toBe('test/folder/file.md');
    });

    it('should resolve file path property with space variant', () => {
      const mockPage: any = {
        $path: 'test/folder/file.md',
        value: vi.fn(),
      };

      const mockCardData: any = {
        path: 'test/folder/file.md',
        folderPath: 'test/folder',
        tags: [],
        yamlTags: [],
        ctime: 1000000,
        mtime: 2000000,
      };

      const mockDC: any = {
        coerce: { string: (val: any) => String(val) },
      };

      const result = resolveDatacoreProperty(
        mockApp,
        'file path',
        mockPage,
        mockCardData,
        mockSettings,
        mockDC
      );

      expect(result).toBe('test/folder/file.md');
    });

    it('should return null for empty file.path', () => {
      const mockPage: any = {
        $path: '',
        value: vi.fn(),
      };

      const mockCardData: any = {
        path: '',
        folderPath: '',
        tags: [],
        yamlTags: [],
        ctime: 1000000,
        mtime: 2000000,
      };

      const mockDC: any = {
        coerce: { string: (val: any) => String(val) },
      };

      const result = resolveDatacoreProperty(
        mockApp,
        'file.path',
        mockPage,
        mockCardData,
        mockSettings,
        mockDC
      );

      expect(result).toBeNull();
    });

    it('should resolve tags property', () => {
      const mockPage: any = {
        $tags: ['tag1', 'tag2'],
        value: vi.fn(),
      };

      const mockCardData: any = {
        folderPath: '',
        tags: [],
        yamlTags: ['tag1', 'tag2'],
        ctime: 1000000,
        mtime: 2000000,
      };

      const mockDC: any = {
        coerce: { string: (val: any) => String(val) },
      };

      const result = resolveDatacoreProperty(
        mockApp,
        'tags',
        mockPage,
        mockCardData,
        mockSettings,
        mockDC
      );

      expect(result).toBe('tags');
    });

    it('should handle null/undefined property values', () => {
      const mockPage: any = {
        value: vi.fn().mockReturnValue(null),
      };

      const mockCardData: any = {
        folderPath: '',
        tags: [],
        yamlTags: [],
        ctime: 1000000,
        mtime: 2000000,
      };

      const mockDC: any = {
        coerce: { string: (val: any) => String(val) },
      };

      const result = resolveDatacoreProperty(
        mockApp,
        'customProp',
        mockPage,
        mockCardData,
        mockSettings,
        mockDC
      );

      // Should return null or string for missing property (depends on custom timestamp settings)
      expect(result === null || typeof result === 'string').toBe(true);
    });

    describe('file.links property', () => {
      it('should return array of wikilinks from metadataCache', () => {
        const mockFile = Object.assign(new TFile(), { path: 'test.md' });
        mockApp.vault.getAbstractFileByPath = vi.fn().mockReturnValue(mockFile);
        mockApp.metadataCache.getFileCache = vi.fn().mockReturnValue({
          links: [{ link: 'Page One' }, { link: 'Page Two' }],
        });

        const mockPage: any = { value: vi.fn() };
        const mockCardData: any = {
          path: 'test.md',
          folderPath: '',
          tags: [],
          yamlTags: [],
          ctime: 1000000,
          mtime: 2000000,
        };
        const mockDC: any = { coerce: { string: (val: any) => String(val) } };

        const result = resolveDatacoreProperty(
          mockApp,
          'file.links',
          mockPage,
          mockCardData,
          mockSettings,
          mockDC
        );

        expect(result).toBe(
          '{"type":"array","items":["[[Page One]]","[[Page Two]]"]}'
        );
      });

      it('should return null for empty links array', () => {
        const mockFile = Object.assign(new TFile(), { path: 'test.md' });
        mockApp.vault.getAbstractFileByPath = vi.fn().mockReturnValue(mockFile);
        mockApp.metadataCache.getFileCache = vi.fn().mockReturnValue({
          links: [],
        });

        const mockPage: any = { value: vi.fn() };
        const mockCardData: any = {
          path: 'test.md',
          folderPath: '',
          tags: [],
          yamlTags: [],
          ctime: 1000000,
          mtime: 2000000,
        };
        const mockDC: any = { coerce: { string: (val: any) => String(val) } };

        const result = resolveDatacoreProperty(
          mockApp,
          'file.links',
          mockPage,
          mockCardData,
          mockSettings,
          mockDC
        );

        expect(result).toBeNull();
      });

      it('should return null when file not found', () => {
        mockApp.vault.getAbstractFileByPath = vi.fn().mockReturnValue(null);

        const mockPage: any = { value: vi.fn() };
        const mockCardData: any = {
          path: 'nonexistent.md',
          folderPath: '',
          tags: [],
          yamlTags: [],
          ctime: 1000000,
          mtime: 2000000,
        };
        const mockDC: any = { coerce: { string: (val: any) => String(val) } };

        const result = resolveDatacoreProperty(
          mockApp,
          'file.links',
          mockPage,
          mockCardData,
          mockSettings,
          mockDC
        );

        expect(result).toBeNull();
      });

      it("should support space variant 'file links'", () => {
        const mockFile = Object.assign(new TFile(), { path: 'test.md' });
        mockApp.vault.getAbstractFileByPath = vi.fn().mockReturnValue(mockFile);
        mockApp.metadataCache.getFileCache = vi.fn().mockReturnValue({
          links: [{ link: 'Some Page' }],
        });

        const mockPage: any = { value: vi.fn() };
        const mockCardData: any = {
          path: 'test.md',
          folderPath: '',
          tags: [],
          yamlTags: [],
          ctime: 1000000,
          mtime: 2000000,
        };
        const mockDC: any = { coerce: { string: (val: any) => String(val) } };

        const result = resolveDatacoreProperty(
          mockApp,
          'file links',
          mockPage,
          mockCardData,
          mockSettings,
          mockDC
        );

        expect(result).toBe('{"type":"array","items":["[[Some Page]]"]}');
      });
    });

    describe('file.embeds property', () => {
      it('should return array of wikilinks from metadataCache embeds', () => {
        const mockFile = Object.assign(new TFile(), { path: 'test.md' });
        mockApp.vault.getAbstractFileByPath = vi.fn().mockReturnValue(mockFile);
        mockApp.metadataCache.getFileCache = vi.fn().mockReturnValue({
          embeds: [{ link: 'image.png' }, { link: 'attachment.pdf' }],
        });

        const mockPage: any = { value: vi.fn() };
        const mockCardData: any = {
          path: 'test.md',
          folderPath: '',
          tags: [],
          yamlTags: [],
          ctime: 1000000,
          mtime: 2000000,
        };
        const mockDC: any = { coerce: { string: (val: any) => String(val) } };

        const result = resolveDatacoreProperty(
          mockApp,
          'file.embeds',
          mockPage,
          mockCardData,
          mockSettings,
          mockDC
        );

        expect(result).toBe(
          '{"type":"array","items":["[[image.png]]","[[attachment.pdf]]"]}'
        );
      });

      it('should return null for empty embeds array', () => {
        const mockFile = Object.assign(new TFile(), { path: 'test.md' });
        mockApp.vault.getAbstractFileByPath = vi.fn().mockReturnValue(mockFile);
        mockApp.metadataCache.getFileCache = vi.fn().mockReturnValue({
          embeds: [],
        });

        const mockPage: any = { value: vi.fn() };
        const mockCardData: any = {
          path: 'test.md',
          folderPath: '',
          tags: [],
          yamlTags: [],
          ctime: 1000000,
          mtime: 2000000,
        };
        const mockDC: any = { coerce: { string: (val: any) => String(val) } };

        const result = resolveDatacoreProperty(
          mockApp,
          'file.embeds',
          mockPage,
          mockCardData,
          mockSettings,
          mockDC
        );

        expect(result).toBeNull();
      });

      it("should support space variant 'file embeds'", () => {
        const mockFile = Object.assign(new TFile(), { path: 'test.md' });
        mockApp.vault.getAbstractFileByPath = vi.fn().mockReturnValue(mockFile);
        mockApp.metadataCache.getFileCache = vi.fn().mockReturnValue({
          embeds: [{ link: 'doc.pdf' }],
        });

        const mockPage: any = { value: vi.fn() };
        const mockCardData: any = {
          path: 'test.md',
          folderPath: '',
          tags: [],
          yamlTags: [],
          ctime: 1000000,
          mtime: 2000000,
        };
        const mockDC: any = { coerce: { string: (val: any) => String(val) } };

        const result = resolveDatacoreProperty(
          mockApp,
          'file embeds',
          mockPage,
          mockCardData,
          mockSettings,
          mockDC
        );

        expect(result).toBe('{"type":"array","items":["[[doc.pdf]]"]}');
      });

      it('should filter out empty link strings', () => {
        const mockFile = Object.assign(new TFile(), { path: 'test.md' });
        mockApp.vault.getAbstractFileByPath = vi.fn().mockReturnValue(mockFile);
        mockApp.metadataCache.getFileCache = vi.fn().mockReturnValue({
          embeds: [
            { link: 'valid.png' },
            { link: '' },
            { link: '   ' },
            { link: 'also-valid.jpg' },
          ],
        });

        const mockPage: any = { value: vi.fn() };
        const mockCardData: any = {
          path: 'test.md',
          folderPath: '',
          tags: [],
          yamlTags: [],
          ctime: 1000000,
          mtime: 2000000,
        };
        const mockDC: any = { coerce: { string: (val: any) => String(val) } };

        const result = resolveDatacoreProperty(
          mockApp,
          'file.embeds',
          mockPage,
          mockCardData,
          mockSettings,
          mockDC
        );

        expect(result).toBe(
          '{"type":"array","items":["[[valid.png]]","[[also-valid.jpg]]"]}'
        );
      });
    });

    describe('checkbox property handling', () => {
      it('should create checkbox marker for boolean true', async () => {
        // Mock getFirstDatacorePropertyValue to return boolean true
        const { getFirstDatacorePropertyValue } =
          (await import('../../src/utils/property')) as any;
        getFirstDatacorePropertyValue.mockReturnValue(true);

        const mockPage: any = {
          value: vi.fn(),
        };

        const mockCardData: any = {
          path: 'test.md',
          folderPath: '',
          tags: [],
          yamlTags: [],
          ctime: 1000000,
          mtime: 2000000,
        };

        const mockDC: any = {
          coerce: { string: (val: any) => String(val) },
        };

        const result = resolveDatacoreProperty(
          mockApp,
          'done',
          mockPage,
          mockCardData,
          mockSettings,
          mockDC
        );

        expect(result).toBe('{"type":"checkbox","checked":true}');
      });

      it('should create checkbox marker for boolean false', async () => {
        // Mock getFirstDatacorePropertyValue to return boolean false
        const { getFirstDatacorePropertyValue } =
          (await import('../../src/utils/property')) as any;
        getFirstDatacorePropertyValue.mockReturnValue(false);

        const mockPage: any = {
          value: vi.fn(),
        };

        const mockCardData: any = {
          path: 'test.md',
          folderPath: '',
          tags: [],
          yamlTags: [],
          ctime: 1000000,
          mtime: 2000000,
        };

        const mockDC: any = {
          coerce: { string: (val: any) => String(val) },
        };

        const result = resolveDatacoreProperty(
          mockApp,
          'done',
          mockPage,
          mockCardData,
          mockSettings,
          mockDC
        );

        expect(result).toBe('{"type":"checkbox","checked":false}');
      });

      it('should create indeterminate marker when checkbox property has null value', async () => {
        // Mock getFirstDatacorePropertyValue to return null (property exists but empty)
        const { getFirstDatacorePropertyValue, isCheckboxProperty } =
          (await import('../../src/utils/property')) as any;
        getFirstDatacorePropertyValue.mockReturnValue(null);
        // Mock isCheckboxProperty to return true (property is registered as checkbox widget)
        isCheckboxProperty.mockReturnValue(true);

        const mockPage: any = {
          value: vi.fn(),
        };

        const mockCardData: any = {
          path: 'test.md',
          folderPath: '',
          tags: [],
          yamlTags: [],
          ctime: 1000000,
          mtime: 2000000,
        };

        const mockDC: any = {
          coerce: { string: (val: any) => String(val) },
        };

        const result = resolveDatacoreProperty(
          mockApp,
          'done',
          mockPage,
          mockCardData,
          mockSettings,
          mockDC
        );

        expect(result).toBe('{"type":"checkbox","indeterminate":true}');
      });

      it('should return null for non-checkbox property with null value', async () => {
        // Mock getFirstDatacorePropertyValue to return null
        const { getFirstDatacorePropertyValue, isCheckboxProperty } =
          (await import('../../src/utils/property')) as any;
        getFirstDatacorePropertyValue.mockReturnValue(null);
        // Mock isCheckboxProperty to return false (property is not a checkbox)
        isCheckboxProperty.mockReturnValue(false);

        const mockPage: any = {
          value: vi.fn(),
        };

        const mockCardData: any = {
          path: 'test.md',
          folderPath: '',
          tags: [],
          yamlTags: [],
          ctime: 1000000,
          mtime: 2000000,
        };

        const mockDC: any = {
          coerce: { string: (val: any) => String(val) },
        };

        const result = resolveDatacoreProperty(
          mockApp,
          'someProperty',
          mockPage,
          mockCardData,
          mockSettings,
          mockDC
        );

        expect(result).toBeNull();
      });
    });
  });

  describe('applySmartTimestamp', () => {
    // Provide real implementations for pure helpers used by applySmartTimestamp
    beforeEach(async () => {
      const { stripNotePrefix, toDisplayName, toSyntaxName } =
        (await import('../../src/utils/property')) as any;
      stripNotePrefix.mockImplementation((name: string) =>
        name.startsWith('note.') ? name.slice(5) : name
      );
      const displayMap: Record<string, string> = {
        'file.ctime': 'created time',
        'file.mtime': 'modified time',
      };
      toDisplayName.mockImplementation(
        (name: string) => displayMap[name] ?? name
      );
      const syntaxMap: Record<string, string> = {
        'created time': 'file.ctime',
        'modified time': 'file.mtime',
      };
      toSyntaxName.mockImplementation(
        (name: string) => syntaxMap[name] ?? name
      );
    });

    function makeSettings(overrides: Record<string, unknown> = {}) {
      return {
        smartTimestamp: true,
        createdTimeProperty: 'created time',
        modifiedTimeProperty: 'modified time',
        ...overrides,
      } as any;
    }

    it('should return props unchanged when smartTimestamp is false', () => {
      const props = ['created time'];
      const result = applySmartTimestamp(
        props,
        'modified time-desc',
        makeSettings({ smartTimestamp: false })
      );
      expect(result).toEqual(['created time']);
    });

    it('should return props unchanged when createdTimeProperty is empty', () => {
      const props = ['modified time'];
      const result = applySmartTimestamp(
        props,
        'modified time-desc',
        makeSettings({ createdTimeProperty: '' })
      );
      expect(result).toEqual(['modified time']);
    });

    it('should return props unchanged when modifiedTimeProperty is empty', () => {
      const props = ['created time'];
      const result = applySmartTimestamp(
        props,
        'created time-asc',
        makeSettings({ modifiedTimeProperty: '' })
      );
      expect(result).toEqual(['created time']);
    });

    it("should return props unchanged when sortMethod is 'none'", () => {
      const props = ['created time'];
      const result = applySmartTimestamp(props, 'none', makeSettings());
      expect(result).toEqual(['created time']);
    });

    it("should return props unchanged when sortMethod is 'name-asc'", () => {
      const props = ['created time'];
      const result = applySmartTimestamp(props, 'name-asc', makeSettings());
      expect(result).toEqual(['created time']);
    });

    it("should replace 'created time' with 'modified time' when sorting by modified time", () => {
      const props = ['created time'];
      const result = applySmartTimestamp(
        props,
        'modified time-desc',
        makeSettings()
      );
      expect(result).toEqual(['modified time']);
    });

    it("should replace 'modified time' with 'created time' when sorting by created time", () => {
      const props = ['modified time'];
      const result = applySmartTimestamp(
        props,
        'created time-asc',
        makeSettings()
      );
      expect(result).toEqual(['created time']);
    });

    it('should not replace when both timestamps are in props', () => {
      const props = ['created time', 'modified time'];
      const result = applySmartTimestamp(
        props,
        'modified time-desc',
        makeSettings()
      );
      expect(result).toEqual(['created time', 'modified time']);
    });

    it('should not replace when neither timestamp is in props', () => {
      const props = ['tags', 'author'];
      const result = applySmartTimestamp(
        props,
        'modified time-desc',
        makeSettings()
      );
      expect(result).toEqual(['tags', 'author']);
    });

    it('should handle custom property names', () => {
      const props = ['updated'];
      const result = applySmartTimestamp(
        props,
        'created-desc',
        makeSettings({
          createdTimeProperty: 'created',
          modifiedTimeProperty: 'updated',
        })
      );
      expect(result).toEqual(['created']);
    });

    it('should NOT match Datacore ctime sort with custom property names', () => {
      // Custom names don't match the default "file.ctime"/"created time" guard
      const props = ['updated'];
      const result = applySmartTimestamp(
        props,
        'ctime-desc',
        makeSettings({
          createdTimeProperty: 'created',
          modifiedTimeProperty: 'updated',
        })
      );
      expect(result).toEqual(['updated']);
    });

    it("should match Datacore ctime sort with default 'file.ctime' property", () => {
      const props = ['file.mtime'];
      const result = applySmartTimestamp(
        props,
        'ctime-desc',
        makeSettings({
          createdTimeProperty: 'file.ctime',
          modifiedTimeProperty: 'file.mtime',
        })
      );
      expect(result).toEqual(['file.ctime']);
    });

    it('should match note.-prefixed property via stripNotePrefix', () => {
      const props = ['created time'];
      const result = applySmartTimestamp(
        props,
        'modified time-desc',
        makeSettings({
          createdTimeProperty: 'note.created time',
          modifiedTimeProperty: 'note.modified time',
        })
      );
      // sortMethod "modified time-desc" matches stripped "modified time"
      // props contain "created time" which matches stripped "created time"
      // So "created time" gets replaced with "note.modified time" (the full prop)
      expect(result).toEqual(['note.modified time']);
    });

    it('should match sort by internal name when setting uses display name', () => {
      // Setting: "modified time", sort method: "file.mtime-desc" (alias match)
      const props = ['created time'];
      const result = applySmartTimestamp(
        props,
        'file.mtime-desc',
        makeSettings()
      );
      expect(result).toEqual(['modified time']);
    });

    it('should match sort by display name when setting uses internal name', () => {
      // Setting: "file.mtime", sort method: "modified time-desc" (alias match)
      const props = ['file.ctime'];
      const result = applySmartTimestamp(
        props,
        'modified time-desc',
        makeSettings({
          createdTimeProperty: 'file.ctime',
          modifiedTimeProperty: 'file.mtime',
        })
      );
      expect(result).toEqual(['file.mtime']);
    });

    it('should replace internal-name prop when setting uses display name (Bases path)', () => {
      // Bases visible properties use internal names (file.mtime),
      // settings use display names (modified time)
      const props = ['file.mtime'];
      const result = applySmartTimestamp(
        props,
        'created time-asc',
        makeSettings()
      );
      expect(result).toEqual(['created time']);
    });

    it('should detect both-present guard across name forms', () => {
      // Props contain internal names, settings use display names
      const props = ['file.ctime', 'file.mtime'];
      const result = applySmartTimestamp(
        props,
        'created time-asc',
        makeSettings()
      );
      expect(result).toEqual(['file.ctime', 'file.mtime']);
    });

    it('should replace note.-prefixed prop from Bases getOrder()', () => {
      // Bases getOrder() returns "note.upd", setting stores "upd"
      const props = ['note.upd'];
      const result = applySmartTimestamp(
        props,
        'ctd-desc',
        makeSettings({
          createdTimeProperty: 'ctd',
          modifiedTimeProperty: 'upd',
        })
      );
      expect(result).toEqual(['ctd']);
    });
  });
});
