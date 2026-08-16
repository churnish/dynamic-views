import { vi } from 'vitest';
import {
  basesEntryToCardData,
  transformBasesEntries,
  resolveBasesProperty,
  applySmartTimestamp,
} from '../../src/core/data-transform';

import { App, TFile } from 'obsidian';

// Mock dependencies
vi.mock('../../src/core/property-display', async () => {
  return {
    isCheckboxProperty: vi.fn().mockReturnValue(false),
    isSameProperty: vi.fn((a: string, b: string) => a === b),
    stripNotePrefix: vi.fn((s: string) => s),
    toDisplayName: vi.fn(),
    toSyntaxName: vi.fn(),
  };
});
vi.mock('../../src/core/property-extraction', async () => {
  return {
    getFirstBasesPropertyValue: vi.fn(),
  };
});
vi.mock('../../src/core/render-utils', () => ({
  formatTimestamp: vi.fn((ts: number) =>
    ts != null ? `formatted-${ts}` : null
  ),
  extractTimestamp: vi.fn(() => null),
  isBasesDateValue: vi.fn(() => false),
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
      showFileImages: 'always',
      pairProperties: true,
    } as any;

    mockApp = new App();
  });

  afterEach(() => {
    vi.clearAllMocks();
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

  describe('URI validation (isValidUri)', () => {
    function createUrlEntry(urlValue: string): any {
      return {
        file: {
          path: 'test/file.md',
          basename: 'file',
          stat: { ctime: 0, mtime: 0 },
        },
        getValue: vi.fn(),
      };
    }

    function makeUrlSettings(overrides: Record<string, unknown> = {}): any {
      return {
        titleProperty: '',
        smartTimestamp: false,
        createdTimeProperty: '',
        modifiedTimeProperty: '',
        urlProperty: 'url',
        ...overrides,
      };
    }

    it('should set hasValidUrl true for valid https URL', async () => {
      const { getFirstBasesPropertyValue } =
        (await import('../../src/core/property-extraction')) as any;
      getFirstBasesPropertyValue.mockReturnValueOnce({
        data: 'https://example.com',
      });

      const result = basesEntryToCardData(
        mockApp,
        createUrlEntry('https://example.com'),
        makeUrlSettings(),
        'alphabetical',
        false,
        []
      );

      expect(result.hasValidUrl).toBe(true);
      expect(result.urlValue).toBe('https://example.com');
    });

    it('should set hasValidUrl true for obsidian:// scheme', async () => {
      const { getFirstBasesPropertyValue } =
        (await import('../../src/core/property-extraction')) as any;
      getFirstBasesPropertyValue.mockReturnValueOnce({
        data: 'obsidian://open?vault=test',
      });

      const result = basesEntryToCardData(
        mockApp,
        createUrlEntry('obsidian://open?vault=test'),
        makeUrlSettings(),
        'alphabetical',
        false,
        []
      );

      expect(result.hasValidUrl).toBe(true);
    });

    it('should set hasValidUrl false for non-URI string', async () => {
      const { getFirstBasesPropertyValue } =
        (await import('../../src/core/property-extraction')) as any;
      getFirstBasesPropertyValue.mockReturnValueOnce({ data: 'not-a-uri' });

      const result = basesEntryToCardData(
        mockApp,
        createUrlEntry('not-a-uri'),
        makeUrlSettings(),
        'alphabetical',
        false,
        []
      );

      expect(result.hasValidUrl).toBe(false);
    });

    it('should set hasValidUrl false for dangerous javascript: scheme', async () => {
      const { getFirstBasesPropertyValue } =
        (await import('../../src/core/property-extraction')) as any;
      getFirstBasesPropertyValue.mockReturnValueOnce({
        data: 'javascript://alert(1)',
      });

      const result = basesEntryToCardData(
        mockApp,
        createUrlEntry('javascript://alert(1)'),
        makeUrlSettings(),
        'alphabetical',
        false,
        []
      );

      expect(result.hasValidUrl).toBe(false);
    });

    it('should not set hasValidUrl when urlProperty value is empty', async () => {
      const { getFirstBasesPropertyValue } =
        (await import('../../src/core/property-extraction')) as any;
      getFirstBasesPropertyValue.mockReturnValueOnce({ data: '' });

      const result = basesEntryToCardData(
        mockApp,
        createUrlEntry(''),
        makeUrlSettings(),
        'alphabetical',
        false,
        []
      );

      expect(result.hasValidUrl).toBe(false);
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
          (await import('../../src/core/property-extraction')) as any;
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
        const { getFirstBasesPropertyValue } =
          (await import('../../src/core/property-extraction')) as any;
        const { isCheckboxProperty } =
          (await import('../../src/core/property-display')) as any;
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
        const { getFirstBasesPropertyValue } =
          (await import('../../src/core/property-extraction')) as any;
        const { isCheckboxProperty } =
          (await import('../../src/core/property-display')) as any;
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
        const { getFirstBasesPropertyValue } =
          (await import('../../src/core/property-extraction')) as any;
        const { isCheckboxProperty } =
          (await import('../../src/core/property-display')) as any;
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
          (await import('../../src/core/property-extraction')) as any;
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
          (await import('../../src/core/property-extraction')) as any;
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
        const { getFirstBasesPropertyValue } =
          (await import('../../src/core/property-extraction')) as any;
        const { isCheckboxProperty } =
          (await import('../../src/core/property-display')) as any;
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
        const { getFirstBasesPropertyValue } =
          (await import('../../src/core/property-extraction')) as any;
        const { isCheckboxProperty } =
          (await import('../../src/core/property-display')) as any;
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

    describe('file-typed values (Bases)', () => {
      const mockCardData: any = {
        path: 'test.md',
        folderPath: '',
        tags: [],
        yamlTags: [],
        ctime: 1000000,
        mtime: 2000000,
      };

      it('should render a file-typed value as a wikilink with basename display', async () => {
        const { getFirstBasesPropertyValue } =
          (await import('../../src/core/property-extraction')) as any;
        const file = new TFile();
        file.path = 'Notes/Test.md';
        file.basename = 'Test';
        getFirstBasesPropertyValue.mockReturnValue({
          icon: 'file',
          app: mockApp,
          file,
        });

        const mockEntry: any = {
          file: { path: 'test.md' },
          getValue: vi.fn(),
        };

        const result = resolveBasesProperty(
          mockApp,
          'formula.file',
          mockEntry,
          mockCardData,
          mockSettings
        );

        expect(result).toBe('[[Notes/Test.md|Test]]');
      });

      it('should leave values carrying .data unchanged', async () => {
        const { getFirstBasesPropertyValue } =
          (await import('../../src/core/property-extraction')) as any;
        getFirstBasesPropertyValue.mockReturnValue({ data: 'plain value' });

        const mockEntry: any = {
          file: { path: 'test.md' },
          getValue: vi.fn(),
        };

        const result = resolveBasesProperty(
          mockApp,
          'someProp',
          mockEntry,
          mockCardData,
          mockSettings
        );

        expect(result).toBe('plain value');
      });
    });
  });

  describe('applySmartTimestamp', () => {
    // Provide real implementations for pure helpers used by applySmartTimestamp
    beforeEach(async () => {
      const { stripNotePrefix, toDisplayName, toSyntaxName } =
        (await import('../../src/core/property-display')) as any;
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

    it('should not match bare ctime sort keyword with custom property names', () => {
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
