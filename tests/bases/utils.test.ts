import { vi } from 'vitest';
import type { Mock } from 'vitest';
import {
  serializeGroupKey,
  handleTemplateToggle,
  getSortMethod,
  setupBasesSwipePrevention,
} from '../../src/bases/utils';
import { Notice } from 'obsidian';

// Mock extractBasesTemplate — returns a sparse template object
vi.mock('../../src/shared/settings-schema', () => ({
  extractBasesTemplate: vi.fn(() => ({ cardSize: 250 })),
}));

// Mock modules that handleTemplateToggle doesn't use but utils.ts imports
vi.mock('../../src/shared/data-transform', () => ({
  resolveTimestampProperty: vi.fn(),
}));
vi.mock('../../src/utils/property', () => ({
  getFirstBasesPropertyValue: vi.fn(),
  getAllBasesImagePropertyValues: vi.fn(),
}));
vi.mock('../../src/shared/content-loader', () => ({
  loadTextPreviewsForEntries: vi.fn(),
  loadImagesForEntries: vi.fn(),
}));
vi.mock('../../src/utils/notebook-navigator', () => ({
  shouldUseNotebookNavigator: vi.fn(),
  navigateToTagInNotebookNavigator: vi.fn(),
  navigateToFolderInNotebookNavigator: vi.fn(),
}));

// activeWindow is an Obsidian global (maps to the current window)
(global as any).activeWindow = window;

/** Create a mock BasesConfigInit backed by a plain Map */
function createMockConfig(initial: Record<string, unknown> = {}): {
  get: Mock;
  set: Mock;
  getOrder: Mock;
} {
  const store = new Map(Object.entries(initial));
  return {
    get: vi.fn((key: string) => store.get(key)),
    set: vi.fn((key: string, value: unknown) => {
      if (value === undefined) store.delete(key);
      else store.set(key, value);
    }),
    getOrder: vi.fn(() => []),
  };
}

/** Create a mock plugin with persistenceManager.setSettingsTemplate */
function createMockPlugin(): {
  persistenceManager: { setSettingsTemplate: Mock };
} {
  return {
    persistenceManager: {
      setSettingsTemplate: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe('handleTemplateToggle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('first call (initialization)', () => {
    it('should set initializedRef and return without action when isTemplate is false', () => {
      const config = createMockConfig({ isTemplate: false });
      const plugin = createMockPlugin();
      const initializedRef = { value: false };
      const cooldownRef = {
        value: null as ReturnType<typeof setTimeout> | null,
      };

      handleTemplateToggle(
        config as any,
        'grid',
        plugin as any,
        initializedRef,
        cooldownRef
      );

      expect(initializedRef.value).toBe(true);
      expect(config.set).not.toHaveBeenCalled();
      expect(cooldownRef.value).toBeNull();
    });

    it('should reset stale isTemplate and start cooldown on first call', () => {
      const config = createMockConfig({ isTemplate: true });
      const plugin = createMockPlugin();
      const initializedRef = { value: false };
      const cooldownRef = {
        value: null as ReturnType<typeof setTimeout> | null,
      };

      handleTemplateToggle(
        config as any,
        'grid',
        plugin as any,
        initializedRef,
        cooldownRef
      );

      expect(initializedRef.value).toBe(true);
      expect(config.set).toHaveBeenCalledWith('isTemplate', undefined);
      expect(cooldownRef.value).not.toBeNull();
      // Should NOT save template or show notice on first call
      expect(
        plugin.persistenceManager.setSettingsTemplate
      ).not.toHaveBeenCalled();
    });

    it('should clear cooldown after 3s timeout', () => {
      const config = createMockConfig({ isTemplate: true });
      const plugin = createMockPlugin();
      const initializedRef = { value: false };
      const cooldownRef = {
        value: null as ReturnType<typeof setTimeout> | null,
      };

      handleTemplateToggle(
        config as any,
        'grid',
        plugin as any,
        initializedRef,
        cooldownRef
      );
      expect(cooldownRef.value).not.toBeNull();

      vi.advanceTimersByTime(3000);
      expect(cooldownRef.value).toBeNull();
    });
  });

  describe('normal toggle (after initialization)', () => {
    it('should skip when isTemplate is false', () => {
      const config = createMockConfig({ isTemplate: false });
      const plugin = createMockPlugin();
      const initializedRef = { value: true };
      const cooldownRef = {
        value: null as ReturnType<typeof setTimeout> | null,
      };

      handleTemplateToggle(
        config as any,
        'grid',
        plugin as any,
        initializedRef,
        cooldownRef
      );

      expect(config.set).not.toHaveBeenCalled();
      expect(
        plugin.persistenceManager.setSettingsTemplate
      ).not.toHaveBeenCalled();
    });

    it('should save template, show notice, and start cooldown on toggle ON', () => {
      const config = createMockConfig({ isTemplate: true });
      const plugin = createMockPlugin();
      const initializedRef = { value: true };
      const cooldownRef = {
        value: null as ReturnType<typeof setTimeout> | null,
      };

      handleTemplateToggle(
        config as any,
        'grid',
        plugin as any,
        initializedRef,
        cooldownRef
      );

      // Resets the one-shot toggle
      expect(config.set).toHaveBeenCalledWith('isTemplate', undefined);
      // Saves template
      expect(
        plugin.persistenceManager.setSettingsTemplate
      ).toHaveBeenCalledWith('grid', expect.any(Object));
      // Starts cooldown
      expect(cooldownRef.value).not.toBeNull();
    });

    it('should use correct label for masonry view type', () => {
      const config = createMockConfig({ isTemplate: true });
      const plugin = createMockPlugin();
      const initializedRef = { value: true };
      const cooldownRef = {
        value: null as ReturnType<typeof setTimeout> | null,
      };

      handleTemplateToggle(
        config as any,
        'masonry',
        plugin as any,
        initializedRef,
        cooldownRef
      );

      expect(
        plugin.persistenceManager.setSettingsTemplate
      ).toHaveBeenCalledWith('masonry', expect.any(Object));
    });
  });

  describe('cooldown suppression', () => {
    it('should reset isTemplate but skip save/notice during cooldown', () => {
      const config = createMockConfig({ isTemplate: true });
      const plugin = createMockPlugin();
      const initializedRef = { value: true };
      const cooldownRef = {
        value: setTimeout(() => {}, 9999) as ReturnType<typeof setTimeout>,
      };

      handleTemplateToggle(
        config as any,
        'grid',
        plugin as any,
        initializedRef,
        cooldownRef
      );

      // Still resets the toggle (one-shot)
      expect(config.set).toHaveBeenCalledWith('isTemplate', undefined);
      // But does NOT save or show notice
      expect(
        plugin.persistenceManager.setSettingsTemplate
      ).not.toHaveBeenCalled();
    });

    it('should save template after cooldown expires', () => {
      const config = createMockConfig({ isTemplate: true });
      const plugin = createMockPlugin();
      const initializedRef = { value: true };
      const cooldownRef = {
        value: null as ReturnType<typeof setTimeout> | null,
      };

      // First toggle — starts cooldown
      handleTemplateToggle(
        config as any,
        'grid',
        plugin as any,
        initializedRef,
        cooldownRef
      );
      expect(
        plugin.persistenceManager.setSettingsTemplate
      ).toHaveBeenCalledTimes(1);

      // Expire the cooldown
      vi.advanceTimersByTime(3000);
      expect(cooldownRef.value).toBeNull();

      // Second toggle — should save again
      config.get.mockReturnValue(true);
      handleTemplateToggle(
        config as any,
        'grid',
        plugin as any,
        initializedRef,
        cooldownRef
      );
      expect(
        plugin.persistenceManager.setSettingsTemplate
      ).toHaveBeenCalledTimes(2);
    });
  });

  describe('notice container re-attach', () => {
    it('should re-attach disconnected notice container to document body', () => {
      const config = createMockConfig({ isTemplate: true });
      const plugin = createMockPlugin();
      const initializedRef = { value: true };
      const cooldownRef = {
        value: null as ReturnType<typeof setTimeout> | null,
      };

      // Create a detached container to simulate the stale cache bug
      const noticeContainer = document.createElement('div');
      const containerEl = document.createElement('div');
      noticeContainer.appendChild(containerEl);
      // noticeContainer is NOT in the document — isConnected will be false

      // Override Notice prototype to set containerEl on instances
      const originalConstructor = Notice.prototype.constructor;
      Object.defineProperty(Notice.prototype, 'containerEl', {
        value: containerEl,
        writable: true,
        configurable: true,
      });

      handleTemplateToggle(
        config as any,
        'grid',
        plugin as any,
        initializedRef,
        cooldownRef
      );

      // The detached container should now be in document.body
      expect(noticeContainer.isConnected).toBe(true);

      // Restore
      delete (Notice.prototype as any).containerEl;
    });
  });
});

describe('serializeGroupKey', () => {
  describe('primitives', () => {
    it('should return undefined for null', () => {
      expect(serializeGroupKey(null)).toBeUndefined();
    });

    it('should return undefined for undefined', () => {
      expect(serializeGroupKey(undefined)).toBeUndefined();
    });

    it('should return string as-is', () => {
      expect(serializeGroupKey('test')).toBe('test');
      expect(serializeGroupKey('')).toBe('');
      expect(serializeGroupKey('hello world')).toBe('hello world');
    });

    it('should convert number to string', () => {
      expect(serializeGroupKey(123)).toBe('123');
      expect(serializeGroupKey(0)).toBe('0');
      expect(serializeGroupKey(-42)).toBe('-42');
      expect(serializeGroupKey(3.14)).toBe('3.14');
    });

    it('should convert boolean to string', () => {
      expect(serializeGroupKey(true)).toBe('true');
      expect(serializeGroupKey(false)).toBe('false');
    });
  });

  describe('Bases Value objects with .data', () => {
    it('should extract string from .data', () => {
      expect(serializeGroupKey({ icon: '📁', data: 'folder' })).toBe('folder');
      expect(serializeGroupKey({ data: 'value' })).toBe('value');
    });

    it('should extract number from .data and convert to string', () => {
      expect(serializeGroupKey({ icon: '🔢', data: 462 })).toBe('462');
      expect(serializeGroupKey({ data: 0 })).toBe('0');
      expect(serializeGroupKey({ data: -1 })).toBe('-1');
    });

    it('should extract boolean from .data and convert to string', () => {
      expect(serializeGroupKey({ icon: '✓', data: true })).toBe('true');
      expect(serializeGroupKey({ data: false })).toBe('false');
    });

    it('should return undefined for null .data', () => {
      expect(serializeGroupKey({ icon: '❌', data: null })).toBeUndefined();
    });

    it('should return undefined for undefined .data', () => {
      expect(
        serializeGroupKey({ icon: '❌', data: undefined })
      ).toBeUndefined();
    });

    it('should handle empty string in .data', () => {
      expect(serializeGroupKey({ data: '' })).toBe('');
    });

    it('should return undefined for empty arrays in .data', () => {
      expect(serializeGroupKey({ data: [] })).toBeUndefined();
    });

    it('should join primitive arrays in .data with comma separator', () => {
      const result = serializeGroupKey({ data: [1, 2, 3] });
      expect(result).toBe('1, 2, 3');
    });

    it('should stringify nested objects in .data', () => {
      const result = serializeGroupKey({ data: { nested: 'value' } });
      expect(result).toBe('{"nested":"value"}');
    });
  });

  describe('Bases date Value objects', () => {
    it('should format Date object to ISO string', () => {
      const date = new Date('2024-06-15T10:30:00Z');
      const result = serializeGroupKey({ date });
      expect(result).toBe('2024-06-15T10:30:00.000Z');
    });

    it('should format Date object with additional properties to ISO string', () => {
      // Additional properties like `time` are ignored - only .date matters
      const date = new Date('2024-06-15T00:00:00Z');
      const result = serializeGroupKey({ date, time: false, extra: 'ignored' });
      expect(result).toBe('2024-06-15T00:00:00.000Z');
    });
  });

  describe('plain objects and arrays', () => {
    it('should stringify plain objects', () => {
      expect(serializeGroupKey({ key: 'value' })).toBe('{"key":"value"}');
    });

    it('should return undefined for empty arrays', () => {
      expect(serializeGroupKey([])).toBeUndefined();
    });

    it('should join string arrays with comma separator', () => {
      expect(serializeGroupKey(['a', 'b', 'c'])).toBe('a, b, c');
    });

    it('should join number arrays with comma separator', () => {
      expect(serializeGroupKey([1, 2, 3])).toBe('1, 2, 3');
    });

    it('should extract .data from arrays of Bases Value objects (tags)', () => {
      const tags = [
        { icon: 'lucide-text', data: '#tag1' },
        { icon: 'lucide-text', data: '#tag2' },
      ];
      expect(serializeGroupKey(tags)).toBe('#tag1, #tag2');
    });
  });

  describe('edge cases', () => {
    it('should handle circular references gracefully', () => {
      const obj: Record<string, unknown> = {};
      obj.self = obj;
      const result = serializeGroupKey(obj);
      expect(result).toMatch(/^\[object:/);
    });

    it('should not confuse regular objects with .data as Bases Values', () => {
      // Object with .data that contains null should return undefined
      expect(serializeGroupKey({ data: null })).toBeUndefined();
      // Object with .data that contains a value should extract it
      expect(serializeGroupKey({ data: 'extracted' })).toBe('extracted');
    });

    it('should handle mixed primitive types in arrays', () => {
      expect(serializeGroupKey([1, 'two', true])).toBe('1, two, true');
    });

    it('should recursively process nested .data properties', () => {
      expect(serializeGroupKey({ data: { data: 'nested' } })).toBe('nested');
    });

    it('should convert NaN to string', () => {
      expect(serializeGroupKey(NaN)).toBe('NaN');
    });

    it('should convert Infinity to string', () => {
      expect(serializeGroupKey(Infinity)).toBe('Infinity');
    });

    it('should handle arrays with null elements', () => {
      // Arrays with null stringify to JSON
      expect(serializeGroupKey([1, null, 3])).toBe('[1,null,3]');
    });
  });
});

describe('getSortMethod', () => {
  it("should return 'property-direction' string from sort config", () => {
    const config = {
      getSort: () => [{ property: 'file.mtime', direction: 'DESC' }],
      getDisplayName: (p: string) => p,
    };
    expect(getSortMethod(config)).toBe('file.mtime-desc');
  });

  it("should return 'none' when getSort() returns null", () => {
    const config = {
      getSort: () => null,
      getDisplayName: (p: string) => p,
    };
    expect(getSortMethod(config)).toBe('none');
  });

  it("should return 'none' when getSort() returns empty array", () => {
    const config = {
      getSort: () => [],
      getDisplayName: (p: string) => p,
    };
    expect(getSortMethod(config)).toBe('none');
  });

  it('should use display name from config.getDisplayName()', () => {
    const config = {
      getSort: () => [{ property: 'file.mtime', direction: 'DESC' }],
      getDisplayName: (p: string) => (p === 'file.mtime' ? 'modified time' : p),
    };
    expect(getSortMethod(config)).toBe('modified time-desc');
  });
});

describe('setupBasesSwipePrevention', () => {
  /** Create a minimal mock App with isMobile */
  function createMockApp(isMobile: boolean) {
    return { isMobile } as unknown as Parameters<
      typeof setupBasesSwipePrevention
    >[1];
  }

  /** Create a minimal mock PluginSettings with preventSidebarSwipe */
  function createMockPluginSettings(preventSidebarSwipe: boolean) {
    return { preventSidebarSwipe } as unknown as Parameters<
      typeof setupBasesSwipePrevention
    >[2];
  }

  it('should set data-ignore-swipe when mobile + enabled', () => {
    const container = document.createElement('div');
    setupBasesSwipePrevention(
      container,
      createMockApp(true),
      createMockPluginSettings(true)
    );
    expect(container.dataset.ignoreSwipe).toBe('true');
  });

  it('should NOT set data-ignore-swipe when desktop', () => {
    const container = document.createElement('div');
    setupBasesSwipePrevention(
      container,
      createMockApp(false),
      createMockPluginSettings(true)
    );
    expect(container.dataset.ignoreSwipe).toBeUndefined();
  });

  it('should remove existing data-ignore-swipe when disabled', () => {
    const container = document.createElement('div');
    container.dataset.ignoreSwipe = 'true';

    setupBasesSwipePrevention(
      container,
      createMockApp(true),
      createMockPluginSettings(false)
    );
    expect(container.dataset.ignoreSwipe).toBeUndefined();
  });

  it('should remove existing data-ignore-swipe when switching from mobile to desktop', () => {
    const container = document.createElement('div');
    container.dataset.ignoreSwipe = 'true';

    setupBasesSwipePrevention(
      container,
      createMockApp(false),
      createMockPluginSettings(true)
    );
    expect(container.dataset.ignoreSwipe).toBeUndefined();
  });
});
