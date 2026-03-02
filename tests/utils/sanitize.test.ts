import { sanitizeString, sanitizeObject } from '../../src/utils/sanitize';

describe('sanitize', () => {
  describe('sanitizeString', () => {
    it('should remove control characters (0x00-0x08)', () => {
      const input = 'Hello\x00\x01\x02\x03\x04\x05\x06\x07\x08World';
      const result = sanitizeString(input);
      expect(result).toBe('HelloWorld');
    });

    it('should remove control characters (0x0B, 0x0C)', () => {
      const input = 'Test\x0B\x0CString';
      const result = sanitizeString(input);
      expect(result).toBe('TestString');
    });

    it('should remove control characters (0x0E-0x1F)', () => {
      const input =
        'Data\x0E\x0F\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1A\x1B\x1C\x1D\x1E\x1FEnd';
      const result = sanitizeString(input);
      expect(result).toBe('DataEnd');
    });

    it('should preserve normal text', () => {
      const input =
        'This is a normal string with numbers 123 and symbols !@#$%';
      const result = sanitizeString(input);
      expect(result).toBe(input);
    });

    it('should preserve newlines and tabs', () => {
      const input = 'Line 1\nLine 2\tTabbed';
      const result = sanitizeString(input);
      expect(result).toBe(input);
    });

    it('should handle empty strings', () => {
      const result = sanitizeString('');
      expect(result).toBe('');
    });

    it('should handle strings with only control characters', () => {
      const input = '\x00\x01\x02\x03';
      const result = sanitizeString(input);
      expect(result).toBe('');
    });

    it('should handle non-string values gracefully', () => {
      const result = sanitizeString(123 as any);
      expect(result).toBe(123);
    });

    it('should handle null and undefined', () => {
      expect(sanitizeString(null as any)).toBe(null);
      expect(sanitizeString(undefined as any)).toBe(undefined);
    });

    it('should preserve Unicode characters', () => {
      const input = 'Hello 世界 🌍 Ñoño';
      const result = sanitizeString(input);
      expect(result).toBe(input);
    });

    it('should handle mixed content with control characters', () => {
      const input = 'Valid\x00Text\x01With\x02Control\x03Chars';
      const result = sanitizeString(input);
      expect(result).toBe('ValidTextWithControlChars');
    });
  });

  describe('sanitizeObject', () => {
    it('should sanitize string properties', () => {
      const input = {
        name: 'Test\x00Name',
        description: 'Test\x01Description',
        title: 'Normal Title',
      };

      const result = sanitizeObject(input);

      expect(result.name).toBe('TestName');
      expect(result.description).toBe('TestDescription');
      expect(result.title).toBe('Normal Title');
    });

    it('should preserve non-string values', () => {
      const input = {
        count: 42,
        enabled: true,
        data: null,
        items: ['a', 'b', 'c'],
        nested: { key: 'value' },
      };

      const result = sanitizeObject(input);

      expect(result.count).toBe(42);
      expect(result.enabled).toBe(true);
      expect(result.data).toBe(null);
      expect(result.items).toEqual(['a', 'b', 'c']);
      expect(result.nested).toEqual({ key: 'value' });
    });

    it('should handle empty objects', () => {
      const result = sanitizeObject({});
      expect(result).toEqual({});
    });

    it('should return a new object (not mutate original)', () => {
      const input = {
        text: 'Test\x00String',
        value: 123,
      };

      const result = sanitizeObject(input);

      expect(result).not.toBe(input);
      expect(input.text).toBe('Test\x00String'); // Original unchanged
      expect(result.text).toBe('TestString'); // Result sanitized
    });

    it('should handle mixed string and non-string properties', () => {
      const input = {
        id: 'abc\x00def',
        count: 10,
        name: 'Item\x01Name',
        active: false,
        tags: ['tag1', 'tag2'],
      };

      const result = sanitizeObject(input);

      expect(result.id).toBe('abcdef');
      expect(result.count).toBe(10);
      expect(result.name).toBe('ItemName');
      expect(result.active).toBe(false);
      expect(result.tags).toEqual(['tag1', 'tag2']);
    });

    it('should handle objects with undefined values', () => {
      const input = {
        defined: 'value\x00test',
        undefined: undefined,
      };

      const result = sanitizeObject(input);

      expect(result.defined).toBe('valuetest');
      expect(result.undefined).toBe(undefined);
    });

    it('should handle all string properties with control chars', () => {
      const input = {
        a: '\x00a',
        b: '\x01b',
        c: '\x02c',
      };

      const result = sanitizeObject(input);

      expect(result).toEqual({
        a: 'a',
        b: 'b',
        c: 'c',
      });
    });

    it('should preserve empty string values', () => {
      const input = {
        empty: '',
        normal: 'text',
      };

      const result = sanitizeObject(input);

      expect(result.empty).toBe('');
      expect(result.normal).toBe('text');
    });
  });
});
