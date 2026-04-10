import { vi } from 'vitest';
import {
  buildDisplayToSyntaxMap,
  buildSyntaxToDisplayMap,
} from '../../src/core/property-mapping';
import type { BasesViewConfig, BasesPropertyId } from 'obsidian';

describe('property-mapping', () => {
  describe('buildDisplayToSyntaxMap', () => {
    function mockConfig(displayNames: Record<string, string>): BasesViewConfig {
      return {
        getDisplayName: (id: string) => displayNames[id] ?? '',
      } as unknown as BasesViewConfig;
    }

    it('should map display names to syntax names', () => {
      const config = mockConfig({
        'file.name': 'filename123',
        'note.prop123': 'display-name',
        'formula.Untitled': 'smile more',
      });
      const allProperties = [
        'file.name',
        'note.prop123',
        'formula.Untitled',
      ] as BasesPropertyId[];

      const map = buildDisplayToSyntaxMap(config, allProperties);

      expect(map['filename123']).toBe('file.name');
      expect(map['display-name']).toBe('note.prop123');
      expect(map['smile more']).toBe('formula.Untitled');
    });

    it('should only map display names, not bare formula keys', () => {
      const config = mockConfig({
        'formula.Untitled': 'smile more',
      });
      const allProperties = ['formula.Untitled'] as BasesPropertyId[];

      const map = buildDisplayToSyntaxMap(config, allProperties);

      // Display name maps; bare key doesn't (syntax format resolves via pass-through)
      expect(map['smile more']).toBe('formula.Untitled');
      expect(map['Untitled']).toBeUndefined();
    });

    it('should handle empty allProperties', () => {
      const config = mockConfig({});
      const map = buildDisplayToSyntaxMap(config, []);
      expect(Object.keys(map)).toHaveLength(0);
    });

    it('should skip properties with empty display name', () => {
      const config = mockConfig({ 'file.name': '' });
      const allProperties = ['file.name'] as BasesPropertyId[];

      const map = buildDisplayToSyntaxMap(config, allProperties);

      expect(Object.keys(map)).toHaveLength(0);
    });
  });

  describe('buildSyntaxToDisplayMap', () => {
    function mockConfig(displayNames: Record<string, string>): BasesViewConfig {
      return {
        getDisplayName: (id: string) => displayNames[id] ?? '',
      } as unknown as BasesViewConfig;
    }

    it('should map syntax names to display names', () => {
      const config = mockConfig({
        'file.name': 'filename123',
        'formula.Untitled': 'smile more',
      });
      const allProperties = [
        'file.name',
        'formula.Untitled',
      ] as BasesPropertyId[];

      const map = buildSyntaxToDisplayMap(config, allProperties);

      expect(map['file.name']).toBe('filename123');
      expect(map['formula.Untitled']).toBe('smile more');
    });

    it('should skip properties with empty display name', () => {
      const config = mockConfig({ 'file.name': '' });
      const allProperties = ['file.name'] as BasesPropertyId[];

      const map = buildSyntaxToDisplayMap(config, allProperties);

      expect(Object.keys(map)).toHaveLength(0);
    });
  });
});
