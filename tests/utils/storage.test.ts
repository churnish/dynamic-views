import { vi } from 'vitest';
import { getStorageKey, getGlobalStorageKey } from '../../src/utils/storage';

// Mock the constants module
vi.mock('../../src/constants', () => ({
  STORAGE_KEY_PREFIX: 'dynamic-views',
}));

describe('storage', () => {
  describe('getStorageKey', () => {
    it('should generate storage key with ctime and key', () => {
      const result = getStorageKey(1234567890, 'sortMethod');
      expect(result).toBe('dynamic-views-1234567890-sortMethod');
    });

    it('should handle different ctimes', () => {
      expect(getStorageKey(1000000000, 'test')).toBe(
        'dynamic-views-1000000000-test'
      );
      expect(getStorageKey(999999999999, 'test')).toBe(
        'dynamic-views-999999999999-test'
      );
      expect(getStorageKey(0, 'test')).toBe('dynamic-views-0-test');
    });

    it('should handle different keys', () => {
      const ctime = 1234567890;
      expect(getStorageKey(ctime, 'viewMode')).toBe(
        'dynamic-views-1234567890-viewMode'
      );
      expect(getStorageKey(ctime, 'filterState')).toBe(
        'dynamic-views-1234567890-filterState'
      );
      expect(getStorageKey(ctime, 'customKey')).toBe(
        'dynamic-views-1234567890-customKey'
      );
    });

    it('should handle special characters in key', () => {
      const result = getStorageKey(12345, 'my-key_with-chars');
      expect(result).toBe('dynamic-views-12345-my-key_with-chars');
    });

    it('should handle empty key', () => {
      const result = getStorageKey(12345, '');
      expect(result).toBe('dynamic-views-12345-');
    });

    it('should create unique keys for different ctimes', () => {
      const key1 = getStorageKey(1000, 'data');
      const key2 = getStorageKey(2000, 'data');
      expect(key1).not.toBe(key2);
    });

    it('should create unique keys for different key names', () => {
      const key1 = getStorageKey(1000, 'data1');
      const key2 = getStorageKey(1000, 'data2');
      expect(key1).not.toBe(key2);
    });
  });

  describe('getGlobalStorageKey', () => {
    it('should generate global storage key', () => {
      const result = getGlobalStorageKey('settings');
      expect(result).toBe('dynamic-views-global-settings');
    });

    it('should handle different global keys', () => {
      expect(getGlobalStorageKey('theme')).toBe('dynamic-views-global-theme');
      expect(getGlobalStorageKey('preferences')).toBe(
        'dynamic-views-global-preferences'
      );
      expect(getGlobalStorageKey('config')).toBe('dynamic-views-global-config');
    });

    it('should handle special characters in key', () => {
      const result = getGlobalStorageKey('my-global_key');
      expect(result).toBe('dynamic-views-global-my-global_key');
    });

    it('should handle empty key', () => {
      const result = getGlobalStorageKey('');
      expect(result).toBe('dynamic-views-global-');
    });

    it('should create different keys than file-specific keys', () => {
      const globalKey = getGlobalStorageKey('data');
      const fileKey = getStorageKey(1000, 'data');
      expect(globalKey).not.toBe(fileKey);
    });

    it('should always include global marker', () => {
      const keys = [
        getGlobalStorageKey('a'),
        getGlobalStorageKey('b'),
        getGlobalStorageKey('xyz'),
      ];

      keys.forEach((key) => {
        expect(key).toContain('-global-');
      });
    });
  });
});
