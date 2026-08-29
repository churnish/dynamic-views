import { vi } from 'vitest';
import type { Mock } from 'vitest';
import {
  cleanUpBaseFile,
  serializeGroupKey,
  handleTemplateToggle,
  getSortMethod,
  setupBasesSwipePrevention,
  estimatePaneRange,
  getTopmostVisibleGroupIndex,
  scrollToGroupIndex,
} from '../../src/bases/utils';
import { Notice } from 'obsidian';

// Mock extractBasesTemplate — returns a sparse template object
vi.mock('../../src/core/settings-schema', () => ({
  extractBasesTemplate: vi.fn(() => ({ cardSize: 250 })),
}));

// Mock modules that handleTemplateToggle doesn't use but utils.ts imports
vi.mock('../../src/core/data-transform', () => ({
  resolveTimestampProperty: vi.fn(),
}));
vi.mock('../../src/core/property-extraction', () => ({
  getFirstBasesPropertyValue: vi.fn(),
  getAllBasesImagePropertyValues: vi.fn(),
}));
vi.mock('../../src/core/content-loader', () => ({
  loadTextPreviewsForEntries: vi.fn(),
  loadImagesForEntries: vi.fn(),
}));
vi.mock('../../src/core/notebook-navigator', () => ({
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
        value: null as number | null,
      };

      handleTemplateToggle(
        config,
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
        value: null as number | null,
      };

      handleTemplateToggle(
        config,
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
        value: null as number | null,
      };

      handleTemplateToggle(
        config,
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
        value: null as number | null,
      };

      handleTemplateToggle(
        config,
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
        value: null as number | null,
      };

      handleTemplateToggle(
        config,
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

    it('should use correct label for Masonry view type', () => {
      const config = createMockConfig({ isTemplate: true });
      const plugin = createMockPlugin();
      const initializedRef = { value: true };
      const cooldownRef = {
        value: null as number | null,
      };

      handleTemplateToggle(
        config,
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
        value: window.setTimeout(() => {}, 9999),
      };

      handleTemplateToggle(
        config,
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
        value: null as number | null,
      };

      // First toggle — starts cooldown
      handleTemplateToggle(
        config,
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
        config,
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
        value: null as number | null,
      };

      // Create a detached container to simulate the stale cache bug
      const noticeContainer = document.createElement('div');
      const containerEl = document.createElement('div');
      noticeContainer.appendChild(containerEl);
      // noticeContainer is NOT in the document — isConnected will be false

      // Override Notice prototype to set containerEl on instances
      Object.defineProperty(Notice.prototype, 'containerEl', {
        value: containerEl,
        writable: true,
        configurable: true,
      });

      // finally, not a trailing statement — the patch is on a prototype shared by every
      // later test in this file, so an early throw here would leak into all of them.
      try {
        handleTemplateToggle(
          config,
          'grid',
          plugin as any,
          initializedRef,
          cooldownRef
        );

        // The detached container should now be in document.body
        expect(noticeContainer.isConnected).toBe(true);
      } finally {
        delete (Notice.prototype as any).containerEl;
      }
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

describe('estimatePaneRange', () => {
  it('returns full range when ephemeral height is 0', () => {
    const [start, end] = estimatePaneRange({ top: 500, height: 0 }, 1000, 100);
    expect(start).toBe(0);
    expect(end).toBe(100);
  });

  it('clamps endIdx to totalCount', () => {
    const [start, end] = estimatePaneRange(
      { top: 9500, height: 10000 },
      1000,
      100
    );
    expect(end).toBeLessThanOrEqual(100);
    expect(start).toBeGreaterThanOrEqual(0);
  });

  it('estimates pane range for middle scroll position', () => {
    const [start, end] = estimatePaneRange(
      { top: 5000, height: 10000 },
      1000,
      1000
    );
    // startFraction = (5000-2000)/10000 = 0.3 → floor(300)
    // endFraction = (5000+3000)/10000 = 0.8 → ceil(800)
    expect(start).toBe(300);
    expect(end).toBe(800);
  });

  it('starts at 0 for top of scroll', () => {
    const [start, end] = estimatePaneRange(
      { top: 0, height: 10000 },
      1000,
      1000
    );
    expect(start).toBe(0);
    expect(end).toBeGreaterThan(0);
  });

  it('reaches totalCount for bottom of scroll', () => {
    const [, end] = estimatePaneRange({ top: 9000, height: 10000 }, 1000, 1000);
    expect(end).toBe(1000);
  });
});

describe('cleanUpBaseFile — card gap keys', () => {
  /** Run cleanUpBaseFile against an in-memory .base file and return the rewritten view entry */
  async function cleanView(
    viewEntry: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    let content = JSON.stringify({ views: [viewEntry] });
    const app = {
      vault: {
        process: vi.fn(
          async (
            _file: unknown,
            fn: (c: string) => string
          ): Promise<string> => {
            content = fn(content);
            return content;
          }
        ),
      },
    } as any;
    const file = { path: 'Test.base' } as any;
    const plugin = {
      persistenceManager: {
        getSettingsTemplate: vi.fn(() => undefined),
        migrateBasesState: vi.fn().mockResolvedValue(undefined),
      },
    } as any;

    await cleanUpBaseFile(app, file, plugin, 'Cards');
    return (JSON.parse(content) as { views: Record<string, unknown>[] })
      .views[0];
  }

  const baseView = {
    type: 'dynamic-views-grid',
    name: 'Cards',
    id: 'abc123-Cards',
  };

  it('preserves a non-default desktop gap and strips the retired phone gap', async () => {
    const view = await cleanView({
      ...baseView,
      cardGapDesktop: 20,
      cardGapPhone: 14,
    });

    expect(view.cardGapDesktop).toBe(20);
    expect('cardGapPhone' in view).toBe(false);
  });

  it('deletes a non-numeric gap value via the type check', async () => {
    const view = await cleanView({
      ...baseView,
      cardGapDesktop: 'wide',
      cardGapPhone: 14,
    });

    expect('cardGapDesktop' in view).toBe(false);
    expect('cardGapPhone' in view).toBe(false);
  });

  // cardGapDesktop is dropped as sparse (matches its default); cardGapPhone is
  // dropped as an unrecognised key, since the phone gap is no longer a setting.
  it('drops a default desktop gap and the retired phone gap', async () => {
    const view = await cleanView({
      ...baseView,
      cardGapDesktop: 8,
      cardGapPhone: 6,
    });

    expect('cardGapDesktop' in view).toBe(false);
    expect('cardGapPhone' in view).toBe(false);
  });
});

/** jsdom does no layout, so every rect is zeros unless stubbed. */
function stubRectTop(el: HTMLElement, top: () => number): void {
  el.getBoundingClientRect = () => ({ top: top() }) as unknown as DOMRect;
}

/** Mirrors the real nesting — `.dynamic-views` > `.dynamic-views-grid` > sections.
 *  A flat stub would pass even against a `:scope >` query. The pane sits at viewport
 *  y=0, so each section reports its absolute top minus the current scroll. */
function buildGroupedView(
  sectionTops: number[],
  grouped = true
): { scrollEl: HTMLElement; container: HTMLElement } {
  const scrollEl = document.createElement('div');
  scrollEl.className = 'bases-view';
  stubRectTop(scrollEl, () => 0);

  const container = document.createElement('div');
  container.className = 'dynamic-views dynamic-views-bases-container';
  if (grouped) container.classList.add('is-grouped');
  scrollEl.appendChild(container);

  const layout = document.createElement('div');
  layout.className = 'dynamic-views-grid';
  container.appendChild(layout);

  for (const top of sectionTops) {
    const section = document.createElement('div');
    section.className = 'dynamic-views-group-section';
    stubRectTop(section, () => top - scrollEl.scrollTop);
    layout.appendChild(section);
  }

  return { scrollEl, container };
}

describe('getTopmostVisibleGroupIndex', () => {
  it('returns null when the container is not grouped', () => {
    const { scrollEl, container } = buildGroupedView([0, 1000], false);
    expect(getTopmostVisibleGroupIndex(scrollEl, container)).toBeNull();
  });

  it('returns null when a grouped container has no sections', () => {
    const { scrollEl, container } = buildGroupedView([]);
    expect(getTopmostVisibleGroupIndex(scrollEl, container)).toBeNull();
  });

  it('returns 0 when the pane is at the top', () => {
    const { scrollEl, container } = buildGroupedView([0, 1000, 2000]);
    scrollEl.scrollTop = 0;
    expect(getTopmostVisibleGroupIndex(scrollEl, container)).toBe(0);
  });

  it('returns 1 when the pane is scrolled into the second section', () => {
    const { scrollEl, container } = buildGroupedView([0, 1000, 2000]);
    scrollEl.scrollTop = 1200;
    expect(getTopmostVisibleGroupIndex(scrollEl, container)).toBe(1);
  });

  it('returns the last index when the pane is past the last section top', () => {
    const { scrollEl, container } = buildGroupedView([0, 1000, 2000]);
    scrollEl.scrollTop = 2500;
    expect(getTopmostVisibleGroupIndex(scrollEl, container)).toBe(2);
  });

  it('falls back to 0 when the pane sits above the first section top', () => {
    const { scrollEl, container } = buildGroupedView([40, 1000]);
    scrollEl.scrollTop = 0;
    expect(getTopmostVisibleGroupIndex(scrollEl, container)).toBe(0);
  });
});

describe('scrollToGroupIndex', () => {
  it('scrolls to the absolute top of a section in range', () => {
    const { scrollEl, container } = buildGroupedView([12, 1000, 2000]);
    scrollEl.scrollTop = 500;
    scrollToGroupIndex(scrollEl, container, 2);
    expect(scrollEl.scrollTop).toBe(2000);
  });

  it('leaves scrollTop untouched for an out-of-range index', () => {
    const { scrollEl, container } = buildGroupedView([12, 1000]);
    scrollEl.scrollTop = 500;
    scrollToGroupIndex(scrollEl, container, 5);
    expect(scrollEl.scrollTop).toBe(500);
  });
});
