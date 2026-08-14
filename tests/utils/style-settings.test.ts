import { vi } from 'vitest';
import type { MockInstance } from 'vitest';
import {
  getCardSpacing,
  shouldShowRecentTimeOnly,
  shouldShowOlderDateOnly,
  getListSeparator,
  getEmptyValueMarker,
  shouldHideMissingProperties,
  getHideEmptyMode,
  clearStyleSettingsCache,
  getOmitFirstLineMode,
  preserveTextPreviewHeadings,
  preserveTextPreviewNewlines,
  getStyleSettingsLayoutHash,
  getCompactBreakpoint,
} from '../../src/utils/style-settings';

describe('style-settings', () => {
  let mockGetComputedStyle: MockInstance;
  let mockClassList: Set<string>;

  beforeEach(() => {
    // Clear CSS variable cache to ensure fresh reads in each test
    clearStyleSettingsCache();

    // Mock getComputedStyle
    mockGetComputedStyle = vi
      .spyOn(window, 'getComputedStyle')
      .mockReturnValue({
        getPropertyValue: (name: string) => '',
      } as CSSStyleDeclaration);

    // Mock body classList
    mockClassList = new Set<string>();
    Object.defineProperty(document.body, 'classList', {
      value: {
        contains: (className: string) => mockClassList.has(className),
        add: (className: string) => mockClassList.add(className),
        remove: (className: string) => mockClassList.delete(className),
      },
      configurable: true,
    });
  });

  afterEach(() => {
    mockGetComputedStyle.mockRestore();
    mockClassList.clear();
  });

  describe('getCardSpacing', () => {
    it('should return default value of 8 on desktop', () => {
      expect(getCardSpacing()).toBe(8);
    });

    it('should return default value of 6 on phone', () => {
      mockClassList.add('is-phone');
      expect(getCardSpacing()).toBe(6);
    });

    it('should return custom desktop value from CSS variable', () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === '--dynamic-views-card-spacing-desktop' ? '16' : '',
      } as CSSStyleDeclaration);

      expect(getCardSpacing()).toBe(16);
    });

    it('should return custom phone value from CSS variable', () => {
      mockClassList.add('is-phone');
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === '--dynamic-views-card-spacing-phone' ? '10px' : '',
      } as CSSStyleDeclaration);

      expect(getCardSpacing()).toBe(10);
    });

    it('should handle zero value', () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === '--dynamic-views-card-spacing-desktop' ? '0' : '',
      } as CSSStyleDeclaration);

      expect(getCardSpacing()).toBe(0);
    });

    it('should return Obsidian spacing for embeds when the container has no gap', () => {
      const mockContainer = document.createElement('div');
      mockContainer.closest = vi.fn((selector: string) =>
        selector === '.internal-embed' ? document.createElement('div') : null
      );

      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) => (name === '--size-4-2' ? '8' : ''),
      } as CSSStyleDeclaration);

      expect(getCardSpacing(mockContainer)).toBe(8);
    });

    // The per-view gap setting is authoritative — CSS gap rules apply in embeds too,
    // so the JS layout math must agree with them
    it('should prefer the container gap over Obsidian spacing inside an embed', () => {
      const mockContainer = document.createElement('div');
      mockContainer.closest = vi.fn((selector: string) =>
        selector === '.internal-embed' ? document.createElement('div') : null
      );

      mockGetComputedStyle.mockImplementation(
        (el: Element) =>
          ({
            getPropertyValue: (name: string) => {
              if (
                name === '--dynamic-views-card-spacing-desktop' &&
                el === mockContainer
              ) {
                return '24px';
              }
              return name === '--size-4-2' ? '8' : '';
            },
          }) as CSSStyleDeclaration
      );

      expect(getCardSpacing(mockContainer)).toBe(24);
    });

    it('should return custom spacing when container has CSS variable', () => {
      const mockContainer = document.createElement('div');
      mockContainer.closest = vi.fn().mockReturnValue(null);

      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === '--dynamic-views-card-spacing-desktop' ? '12' : '',
      } as CSSStyleDeclaration);

      expect(getCardSpacing(mockContainer)).toBe(12);
    });

    it('should prefer container-local CSS variable over body', () => {
      const mockContainer = document.createElement('div');
      mockContainer.closest = vi.fn().mockReturnValue(null);

      // Mock getComputedStyle to return different values for body vs container
      mockGetComputedStyle.mockImplementation(
        (el: Element) =>
          ({
            getPropertyValue: (name: string) => {
              if (name === '--dynamic-views-card-spacing-desktop') {
                return el === mockContainer ? '20' : '8';
              }
              return '';
            },
          }) as CSSStyleDeclaration
      );

      expect(getCardSpacing(mockContainer)).toBe(20);
    });

    it('should fall through to body when container has no CSS variable', () => {
      const mockContainer = document.createElement('div');
      mockContainer.closest = vi.fn().mockReturnValue(null);

      mockGetComputedStyle.mockImplementation(
        (el: Element) =>
          ({
            getPropertyValue: (name: string) => {
              if (name === '--dynamic-views-card-spacing-desktop') {
                return el === mockContainer ? '' : '16';
              }
              return '';
            },
          }) as CSSStyleDeclaration
      );

      expect(getCardSpacing(mockContainer)).toBe(16);
    });
  });

  describe('shouldShowRecentTimeOnly', () => {
    it('should return true by default (time only is default behavior)', () => {
      expect(shouldShowRecentTimeOnly()).toBe(true);
    });

    it('should return false when full timestamp class is present', () => {
      mockClassList.add('dynamic-views-timestamp-recent-full');
      expect(shouldShowRecentTimeOnly()).toBe(false);
    });
  });

  describe('shouldShowOlderDateOnly', () => {
    it('should return true by default (date only is default behavior)', () => {
      expect(shouldShowOlderDateOnly()).toBe(true);
    });

    it('should return false when full timestamp class is present', () => {
      mockClassList.add('dynamic-views-timestamp-past-full');
      expect(shouldShowOlderDateOnly()).toBe(false);
    });
  });

  describe('getListSeparator', () => {
    it('should return default ", " (comma space)', () => {
      expect(getListSeparator()).toBe(', ');
    });

    it('should return custom value from CSS variable', () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === '--dynamic-views-list-separator' ? '" | "' : '',
      } as CSSStyleDeclaration);

      expect(getListSeparator()).toBe(' | ');
    });

    it('should strip double quotes', () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === '--dynamic-views-list-separator' ? '" • "' : '',
      } as CSSStyleDeclaration);

      expect(getListSeparator()).toBe(' • ');
    });

    it('should strip single quotes', () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === '--dynamic-views-list-separator' ? "' / '" : '',
      } as CSSStyleDeclaration);

      expect(getListSeparator()).toBe(' / ');
    });

    it('should return default when value is only whitespace (trimmed to empty)', () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === '--dynamic-views-list-separator' ? '   ' : '',
      } as CSSStyleDeclaration);

      // Whitespace-only is trimmed to empty, so falls back to default
      expect(getListSeparator()).toBe(', ');
    });

    it('should not strip quotes if only one side matches', () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === '--dynamic-views-list-separator' ? '"hello' : '',
      } as CSSStyleDeclaration);

      expect(getListSeparator()).toBe('"hello');
    });

    it('should handle empty string after quote stripping', () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === '--dynamic-views-list-separator' ? '""' : '',
      } as CSSStyleDeclaration);

      expect(getListSeparator()).toBe(', '); // Falls back to default
    });
  });

  describe('getCompactBreakpoint', () => {
    const withValue = (value: string) =>
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === '--dynamic-views-compact-breakpoint' ? value : '',
      } as CSSStyleDeclaration);

    it('should return 390 when unset', () => {
      expect(getCompactBreakpoint()).toBe(390);
    });

    it.each([
      ['bare number', '420'],
      ['number with px', '420px'],
      ['quoted bare number', '"420"'],
      ['quoted number with px', '"420px"'],
      ['single-quoted number with px', "'420px'"],
      ['padded value', '  420px  '],
    ])('should accept a %s', (_label, value) => {
      withValue(value);
      expect(getCompactBreakpoint()).toBe(420);
    });

    it('should accept other length units', () => {
      withValue('30rem');
      expect(getCompactBreakpoint()).toBe(30);
    });

    it('should accept 0, which disables compact mode', () => {
      withValue('0');
      expect(getCompactBreakpoint()).toBe(0);
    });

    it('should fall back to 390 when unparseable', () => {
      withValue('"wide"');
      expect(getCompactBreakpoint()).toBe(390);
    });
  });

  describe('getEmptyValueMarker', () => {
    it('should return default "—" (em dash)', () => {
      expect(getEmptyValueMarker()).toBe('—');
    });

    it('should return custom value from CSS variable', () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === '--dynamic-views-empty-value-marker' ? 'N/A' : '',
      } as CSSStyleDeclaration);

      expect(getEmptyValueMarker()).toBe('N/A');
    });

    it('should strip double quotes', () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === '--dynamic-views-empty-value-marker' ? '"..."' : '',
      } as CSSStyleDeclaration);

      expect(getEmptyValueMarker()).toBe('...');
    });

    it('should strip single quotes', () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === '--dynamic-views-empty-value-marker' ? "'—'" : '',
      } as CSSStyleDeclaration);

      expect(getEmptyValueMarker()).toBe('—');
    });

    it('should handle empty string after quote stripping', () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === '--dynamic-views-empty-value-marker' ? '""' : '',
      } as CSSStyleDeclaration);

      expect(getEmptyValueMarker()).toBe('—'); // Falls back to default
    });

    it('should preserve special characters', () => {
      mockGetComputedStyle.mockReturnValue({
        getPropertyValue: (name: string) =>
          name === '--dynamic-views-empty-value-marker' ? '∅' : '',
      } as CSSStyleDeclaration);

      expect(getEmptyValueMarker()).toBe('∅');
    });
  });

  describe('shouldHideMissingProperties', () => {
    it('should return false by default', () => {
      expect(shouldHideMissingProperties()).toBe(false);
    });

    it('should return true when class is present', () => {
      mockClassList.add('dynamic-views-hide-missing-properties');
      expect(shouldHideMissingProperties()).toBe(true);
    });
  });

  describe('getHideEmptyMode', () => {
    it('should return names-hidden by default', () => {
      expect(getHideEmptyMode()).toBe('names-hidden');
    });

    it('should return show when show class is present', () => {
      mockClassList.add('dynamic-views-empty-properties-show');
      expect(getHideEmptyMode()).toBe('show');
    });

    it('should return all when all class is present', () => {
      mockClassList.add('dynamic-views-empty-properties-hide');
      expect(getHideEmptyMode()).toBe('all');
    });
  });

  describe('getOmitFirstLineMode', () => {
    it('should return "always" when always class is present', () => {
      mockClassList.add('dynamic-views-omit-first-line-always');
      expect(getOmitFirstLineMode()).toBe('always');
    });

    it('should return "never" when never class is present', () => {
      mockClassList.add('dynamic-views-omit-first-line-never');
      expect(getOmitFirstLineMode()).toBe('never');
    });

    it('should return "ifMatchesTitle" when neither class is present', () => {
      expect(getOmitFirstLineMode()).toBe('ifMatchesTitle');
    });
  });

  describe('preserveTextPreviewHeadings', () => {
    it('should return true when preserve-headings class is present', () => {
      mockClassList.add('dynamic-views-text-preview-preserve-headings');
      expect(preserveTextPreviewHeadings()).toBe(true);
    });

    it('should return false when class is absent', () => {
      expect(preserveTextPreviewHeadings()).toBe(false);
    });
  });

  describe('preserveTextPreviewNewlines', () => {
    it('should return true when preserve-line-breaks class is present', () => {
      mockClassList.add('dynamic-views-text-preview-preserve-line-breaks');
      expect(preserveTextPreviewNewlines()).toBe(true);
    });

    it('should return false when class is absent', () => {
      expect(preserveTextPreviewNewlines()).toBe(false);
    });
  });

  // getStyleSettingsLayoutHash reads body.className directly, which the shared
  // classList mock does not cover — set and reset className per test
  describe('getStyleSettingsLayoutHash', () => {
    afterEach(() => {
      document.body.className = '';
    });

    it('should return an empty string when no preset classes are present', () => {
      document.body.className = 'theme-dark is-phone';
      expect(getStyleSettingsLayoutHash()).toBe('');
    });

    it('should return the single preset class that is present', () => {
      document.body.className = 'theme-dark dynamic-views-title-size-large';
      expect(getStyleSettingsLayoutHash()).toBe(
        'dynamic-views-title-size-large'
      );
    });

    it('should return multiple preset classes sorted and comma-joined', () => {
      document.body.className =
        'dynamic-views-title-size-large dynamic-views-property-name-size-tiny';
      expect(getStyleSettingsLayoutHash()).toBe(
        'dynamic-views-property-name-size-tiny,dynamic-views-title-size-large'
      );
    });

    it('should change when a preset is switched', () => {
      document.body.className = 'dynamic-views-title-size-large';
      const before = getStyleSettingsLayoutHash();
      document.body.className = 'dynamic-views-title-size-small';
      expect(getStyleSettingsLayoutHash()).not.toBe(before);
    });

    // group-property must not be swallowed by the shorter `property` alternative
    it('should match group header presets without colliding with the property preset', () => {
      document.body.className =
        'dynamic-views-group-property-size-large dynamic-views-group-count-size-tiny';
      expect(getStyleSettingsLayoutHash()).toBe(
        'dynamic-views-group-count-size-tiny,dynamic-views-group-property-size-large'
      );
    });

    it('should match the group value preset', () => {
      document.body.className = 'dynamic-views-group-value-size-medium';
      expect(getStyleSettingsLayoutHash()).toBe(
        'dynamic-views-group-value-size-medium'
      );
    });

    it.each([
      ['dynamic-views-title-bold'],
      ['dynamic-views-subtitle-italic'],
      ['dynamic-views-text-preview-small-caps'],
      ['dynamic-views-property-bold'],
      ['dynamic-views-property-name-italic'],
      ['dynamic-views-tag-small-caps'],
      ['dynamic-views-group-value-bold'],
      ['dynamic-views-group-property-italic'],
      ['dynamic-views-group-count-small-caps'],
    ])('should match the metric-affecting toggle %s', (cls) => {
      document.body.className = cls;
      expect(getStyleSettingsLayoutHash()).toBe(cls);
    });

    it.each([
      ['dynamic-views-title-case-uppercase'],
      ['dynamic-views-property-name-case-title'],
      ['dynamic-views-tag-case-lowercase'],
      ['dynamic-views-group-count-case-preserve'],
    ])('should match the case transform %s', (cls) => {
      document.body.className = cls;
      expect(getStyleSettingsLayoutHash()).toBe(cls);
    });

    // Colour, style and alignment settings do not change text metrics
    it.each([
      ['dynamic-views-title-color-red'],
      ['dynamic-views-title-hover-color-accent'],
      ['dynamic-views-tag-style-outline'],
      ['dynamic-views-tag-color-faint'],
      ['dynamic-views-subtitle-align-left'],
      ['dynamic-views-hide-group-count'],
    ])('should ignore the non-metric class %s', (cls) => {
      document.body.className = cls;
      expect(getStyleSettingsLayoutHash()).toBe('');
    });

    it('should combine size, toggle and case classes for one element', () => {
      document.body.className =
        'dynamic-views-title-bold dynamic-views-title-size-large dynamic-views-title-case-uppercase';
      expect(getStyleSettingsLayoutHash()).toBe(
        'dynamic-views-title-bold,dynamic-views-title-case-uppercase,dynamic-views-title-size-large'
      );
    });

    it('should not let the subtitle stem swallow the title toggle', () => {
      document.body.className =
        'dynamic-views-subtitle-bold dynamic-views-title-bold';
      expect(getStyleSettingsLayoutHash()).toBe(
        'dynamic-views-subtitle-bold,dynamic-views-title-bold'
      );
    });
  });
});
