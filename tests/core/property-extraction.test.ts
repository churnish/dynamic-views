import { vi } from 'vitest';
import {
  getFirstBasesPropertyValue,
  getAllBasesImagePropertyValues,
} from '../../src/core/property-extraction';
import { App } from 'obsidian';

describe('property-extraction', () => {
  describe('getFirstBasesPropertyValue', () => {
    let mockApp: App;
    let mockEntry: any;

    beforeEach(() => {
      mockApp = new App();
      mockEntry = {
        getValue: vi.fn(),
      };
    });

    it('should return null for empty property string', () => {
      expect(getFirstBasesPropertyValue(mockApp, mockEntry, '')).toBeNull();
      expect(getFirstBasesPropertyValue(mockApp, mockEntry, '   ')).toBeNull();
    });

    it('should return first property with valid value', () => {
      mockEntry.getValue = vi
        .fn()
        .mockReturnValueOnce(null) // First property doesn't exist
        .mockReturnValueOnce({ data: 'test value' }); // Second property exists

      const result = getFirstBasesPropertyValue(
        mockApp,
        mockEntry,
        'prop1, prop2'
      );
      expect(result).toEqual({ data: 'test value' });
    });

    it('should not try formula prefix for bare names', () => {
      mockEntry.getValue = vi.fn().mockReturnValue({ icon: 'error' });

      const result = getFirstBasesPropertyValue(
        mockApp,
        mockEntry,
        'customProp'
      );
      expect(mockEntry.getValue).toHaveBeenCalledWith('customProp');
      expect(mockEntry.getValue).not.toHaveBeenCalledWith('formula.customProp');
      expect(result).toBeNull();
    });

    it('should handle comma-separated properties', () => {
      mockEntry.getValue = vi
        .fn()
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce({ data: 'third value' });

      const result = getFirstBasesPropertyValue(mockApp, mockEntry, 'a, b, c');
      expect(result).toEqual({ data: 'third value' });
    });

    it('should return null when no properties have values', () => {
      mockEntry.getValue = vi.fn().mockReturnValue(null);

      const result = getFirstBasesPropertyValue(
        mockApp,
        mockEntry,
        'prop1, prop2, prop3'
      );
      expect(result).toBeNull();
    });

    it('should trim property names', () => {
      mockEntry.getValue = vi.fn().mockReturnValue({ data: 'value' });

      getFirstBasesPropertyValue(mockApp, mockEntry, '  prop1  ,  prop2  ');
      expect(mockEntry.getValue).toHaveBeenCalledWith('prop1');
    });
  });

  describe('getFirstBasesPropertyValue date validation', () => {
    let mockApp: App;
    let mockEntry: any;

    beforeEach(() => {
      mockApp = new App();
      mockEntry = {
        getValue: vi.fn(),
        file: { path: 'test.md' },
      };
    });

    it('should accept valid date object with Date instance', () => {
      const validDate = new Date('2024-01-01');
      mockEntry.getValue = vi.fn().mockReturnValue({
        icon: 'calendar',
        date: validDate,
        time: null,
      });

      const result = getFirstBasesPropertyValue(mockApp, mockEntry, 'dateProp');
      expect(result).toEqual({ icon: 'calendar', date: validDate, time: null });
    });

    it('should reject malformed date object with string date', () => {
      mockEntry.getValue = vi.fn().mockReturnValue({
        icon: 'calendar',
        date: '2024-01-01', // String, not Date
        time: null,
      });

      // Should fall through to other checks, not return malformed value
      const result = getFirstBasesPropertyValue(mockApp, mockEntry, 'dateProp');
      expect(result).not.toEqual(
        expect.objectContaining({ date: '2024-01-01' })
      );
    });

    it('should reject date object with invalid Date (NaN)', () => {
      const invalidDate = new Date('invalid');
      mockEntry.getValue = vi.fn().mockReturnValue({
        icon: 'calendar',
        date: invalidDate,
        time: null,
      });

      const result = getFirstBasesPropertyValue(mockApp, mockEntry, 'dateProp');
      // Invalid date should not be returned as valid date value
      expect(result).not.toEqual(
        expect.objectContaining({ date: invalidDate })
      );
    });
  });

  describe('getAllBasesImagePropertyValues', () => {
    let mockApp: App;
    let mockEntry: any;

    beforeEach(() => {
      mockApp = new App();
      mockEntry = {
        getValue: vi.fn(),
      };
    });

    it('should return empty array for empty property string', () => {
      expect(getAllBasesImagePropertyValues(mockApp, mockEntry, '')).toEqual(
        []
      );
    });

    it('should collect string values', () => {
      mockEntry.getValue = vi.fn().mockReturnValue({ data: 'image.png' });

      const result = getAllBasesImagePropertyValues(mockApp, mockEntry, 'img');
      expect(result).toEqual(['image.png']);
    });

    it('should collect array values', () => {
      mockEntry.getValue = vi.fn().mockReturnValue({
        data: ['img1.png', 'img2.jpg', 'img3.gif'],
      });

      const result = getAllBasesImagePropertyValues(
        mockApp,
        mockEntry,
        'images'
      );
      expect(result).toEqual(['img1.png', 'img2.jpg', 'img3.gif']);
    });

    it('should collect from multiple properties', () => {
      mockEntry.getValue = vi
        .fn()
        .mockReturnValueOnce({ data: 'img1.png' })
        .mockReturnValueOnce({ data: 'img2.png' });

      const result = getAllBasesImagePropertyValues(
        mockApp,
        mockEntry,
        'prop1, prop2'
      );
      expect(result).toEqual(['img1.png', 'img2.png']);
    });

    it('should skip null/empty values', () => {
      mockEntry.getValue = vi
        .fn()
        .mockReturnValueOnce({ data: null })
        .mockReturnValueOnce({ data: '' })
        .mockReturnValueOnce({ data: 'valid.png' });

      const result = getAllBasesImagePropertyValues(
        mockApp,
        mockEntry,
        'a, b, c'
      );
      expect(result).toEqual(['valid.png']);
    });

    it('should convert numbers to strings', () => {
      mockEntry.getValue = vi.fn().mockReturnValue({ data: 123 });

      const result = getAllBasesImagePropertyValues(mockApp, mockEntry, 'num');
      expect(result).toEqual(['123']);
    });

    it('should handle mixed arrays', () => {
      mockEntry.getValue = vi.fn().mockReturnValue({
        data: ['img1.png', 42, 'img2.jpg'],
      });

      const result = getAllBasesImagePropertyValues(
        mockApp,
        mockEntry,
        'mixed'
      );
      expect(result).toEqual(['img1.png', '42', 'img2.jpg']);
    });

    it('should not try formula prefix for bare names', () => {
      mockEntry.getValue = vi.fn().mockReturnValue({ icon: 'error' });

      const result = getAllBasesImagePropertyValues(mockApp, mockEntry, 'img');
      expect(mockEntry.getValue).toHaveBeenCalledWith('img');
      expect(mockEntry.getValue).not.toHaveBeenCalledWith('formula.img');
      expect(result).toEqual([]);
    });
  });
});
