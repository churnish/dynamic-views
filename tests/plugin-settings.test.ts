import { vi, describe, it, expect, afterEach, beforeAll } from 'vitest';
import { DynamicViewsSettingTab } from '../src/plugin-settings';

// Obsidian injects `createFragment` at runtime and jsdom has no equivalent, so
// definitions whose `desc` is a fragment cannot be read at all without it.
// `createEl` already comes from the Node.prototype polyfill in setup.ts —
// `appendText` is the one helper a real DocumentFragment lacks.
beforeAll(() => {
  globalThis.createFragment = (callback?: (frag: DocumentFragment) => void) => {
    const fragment = document.createDocumentFragment();
    fragment.appendText = (text: string) => {
      fragment.appendChild(document.createTextNode(text));
    };
    callback?.(fragment);
    return fragment;
  };
});

const PLUGIN_LINK_ATTR = 'data-dynamic-views-plugin-link';

const OPEN_ON_CARD = 'dynamic-views-open-on-card';
const OPEN_ON_TITLE = 'dynamic-views-open-on-title';

const STYLE_SETTINGS_ID = 'obsidian-style-settings';

interface HarnessOptions {
  openOnTitle?: boolean;
  openTabById?: (id: string) => { id: string } | null;
  /** `null` drops `close` from `app.setting`, which must leave the click alone. */
  close?: (() => void) | null;
  /** Install state of Style Settings, which the Appearance row's button label tracks. */
  styleSettings?: 'enabled' | 'installed' | 'absent';
}

/**
 * Detached documents stand in for popout windows — `createHTMLDocument` gives a
 * real body with a real classList, so the cascade can be asserted per document.
 */
function makePopoutDocument(): Document {
  return document.implementation.createHTMLDocument('popout');
}

function createHarness(options: HarnessOptions = {}) {
  const stored: Record<string, unknown> = {
    openOnTitle: options.openOnTitle ?? false,
  };
  const setPluginSettings = vi.fn(async (patch: Record<string, unknown>) => {
    Object.assign(stored, patch);
  });

  const popoutDocs = [makePopoutDocument(), makePopoutDocument()];
  const openTabById = vi.fn(options.openTabById ?? (() => null));
  const close = vi.fn(options.close ?? (() => {}));

  // Installed-but-disabled is the middle state: a manifest with no live
  // instance, which is exactly how Obsidian reports a disabled plugin.
  const styleSettings = options.styleSettings ?? 'enabled';
  const enablePluginAndSave = vi.fn(async () => true);

  const app = {
    workspace: { containerEl: document.createElement('div') },
    setting: options.close === null ? { openTabById } : { openTabById, close },
    plugins: {
      manifests:
        styleSettings === 'absent'
          ? {}
          : { [STYLE_SETTINGS_ID]: { id: STYLE_SETTINGS_ID } },
      plugins: styleSettings === 'enabled' ? { [STYLE_SETTINGS_ID]: {} } : {},
      enablePluginAndSave,
    },
  };

  const plugin = {
    persistenceManager: {
      getPluginSettings: () => ({ ...stored }),
      setPluginSettings,
    },
    getAllPopoutDocuments: () => popoutDocs,
  };

  const tab = new DynamicViewsSettingTab(app as any, plugin as any);
  return {
    tab,
    setPluginSettings,
    popoutDocs,
    openTabById,
    close,
    enablePluginAndSave,
  };
}

function makePluginLink(
  pluginId: string,
  hostDoc: Document = document
): HTMLAnchorElement {
  const link = hostDoc.createElement('a');
  link.href = `https://community.obsidian.md/plugins/${pluginId}`;
  link.setAttribute(PLUGIN_LINK_ATTR, pluginId);
  hostDoc.body.appendChild(link);
  return link;
}

/**
 * A document standing in for the settings window.
 *
 * `createHTMLDocument` leaves `defaultView` null, which `getOwnerWindow` maps
 * back to the main `window` — so the window comparison would see no
 * difference. Giving it a distinct `defaultView` is what makes it read as a
 * separate window.
 */
function makeSettingsWindowDocument(): Document {
  const doc = document.implementation.createHTMLDocument('settings');
  Object.defineProperty(doc, 'defaultView', { value: { open: vi.fn() } });
  return doc;
}

/** Dispatches through the delegated handler directly — `desc` fragments drop listeners. */
function clickPluginLink(
  tab: DynamicViewsSettingTab,
  link: HTMLAnchorElement,
  init: MouseEventInit = {}
): MouseEvent {
  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  Object.defineProperty(event, 'target', { value: link });
  (tab as any).handlePluginLinkClick(event);
  return event;
}

interface SupportRow {
  name?: string;
  render: (setting: never) => void | (() => void);
}

/** The Support group closes out the page, so the last definition is it. */
function getSupportGroup(): {
  type?: string;
  heading?: string;
  items: SupportRow[];
} {
  const { tab } = createHarness();
  const definitions = tab.getSettingDefinitions();
  return definitions[definitions.length - 1] as unknown as {
    type?: string;
    heading?: string;
    items: SupportRow[];
  };
}

/**
 * The Appearance row leads the page, so the first definition is it.
 *
 * Hands back the whole harness rather than just the row: the button routes
 * through the same spies, and the Enable case needs the very tab instance
 * whose row was rendered.
 */
function getAppearanceRow(options: HarnessOptions = {}) {
  const harness = createHarness(options);
  const [row] = harness.tab.getSettingDefinitions();
  return { ...harness, row: row as unknown as SupportRow };
}

/** Drives a `render` callback without pulling in a real Setting. */
function captureButton(render: SupportRow['render']) {
  const button = {
    text: '',
    clickHandler: undefined as undefined | (() => void | Promise<void>),
    /** Teardown the `render` callback returned, when it returned one. */
    cleanup: undefined as undefined | (() => void),
    setButtonText(value: string) {
      button.text = value;
      return button;
    },
    onClick(handler: () => void | Promise<void>) {
      button.clickHandler = handler;
      return button;
    },
  };
  const setting = {
    // Owned by the main document, so the button's `getOwnerWindow` call lands
    // on `window` and the spy below sees the opened URL.
    settingEl: document.createElement('div'),
    addButton(cb: (b: typeof button) => unknown) {
      cb(button);
      return setting;
    },
  };
  const teardown = render(setting as never);
  button.cleanup = typeof teardown === 'function' ? teardown : undefined;
  return button;
}

afterEach(() => {
  document.body.classList.remove(OPEN_ON_CARD, OPEN_ON_TITLE);
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
  vi.restoreAllMocks();
});

describe('DynamicViewsSettingTab.setControlValue', () => {
  it('persists only the key that changed', async () => {
    const { tab, setPluginSettings } = createHarness();

    await tab.setControlValue('folderCommands', true);

    expect(setPluginSettings).toHaveBeenCalledTimes(1);
    expect(setPluginSettings).toHaveBeenCalledWith({ folderCommands: true });
  });

  it('runs the cascade registered for that key', async () => {
    const { tab } = createHarness({ openOnTitle: false });

    await tab.setControlValue('openOnTitle', true);

    expect(document.body.classList.contains(OPEN_ON_TITLE)).toBe(true);
  });

  it('re-evaluates predicates in place instead of rebuilding definitions', async () => {
    const { tab } = createHarness();
    const refreshDomState = vi.spyOn(tab, 'refreshDomState');
    const update = vi.spyOn(tab, 'update');

    await tab.setControlValue('folderCommands', true);

    expect(refreshDomState).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('writes before the cascade reads the stored value back', async () => {
    const { tab } = createHarness({ openOnTitle: false });
    document.body.classList.add(OPEN_ON_CARD);

    await tab.setControlValue('openOnTitle', true);

    expect(document.body.classList.contains(OPEN_ON_CARD)).toBe(false);
  });
});

describe('openOnTitle cascade', () => {
  it('applies the class to the main document and every popout', async () => {
    const { tab, popoutDocs } = createHarness({ openOnTitle: false });
    for (const doc of [document, ...popoutDocs]) {
      doc.body.classList.add(OPEN_ON_CARD);
    }

    await tab.setControlValue('openOnTitle', true);

    for (const doc of [document, ...popoutDocs]) {
      expect(doc.body.classList.contains(OPEN_ON_TITLE)).toBe(true);
      expect(doc.body.classList.contains(OPEN_ON_CARD)).toBe(false);
    }
  });

  it('swaps back without leaving both classes set', async () => {
    const { tab, popoutDocs } = createHarness({ openOnTitle: true });
    for (const doc of [document, ...popoutDocs]) {
      doc.body.classList.add(OPEN_ON_TITLE);
    }

    await tab.setControlValue('openOnTitle', false);

    for (const doc of [document, ...popoutDocs]) {
      expect(doc.body.classList.contains(OPEN_ON_CARD)).toBe(true);
      expect(doc.body.classList.contains(OPEN_ON_TITLE)).toBe(false);
    }
  });
});

describe('plugin link clicks', () => {
  const URI = 'obsidian://show-plugin?id=obsidian-style-settings';

  // Every link is a directory link now, so the settings tab is never a
  // candidate — even when the target plugin has one open.
  it('goes to the directory without consulting the settings tab', () => {
    const openWindow = vi.spyOn(window, 'open').mockReturnValue(null);
    const { tab, openTabById } = createHarness({
      openTabById: (id) => ({ id }),
    });

    const event = clickPluginLink(
      tab,
      makePluginLink('obsidian-style-settings')
    );

    expect(openTabById).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(openWindow).toHaveBeenCalledWith(URI);
  });

  // The pane shares the main window, so closing it would lose the user's place
  // for nothing. This is the case the `settingsPopoutWindow` preference got
  // wrong on mobile, where the key stays true but settings never pops out.
  it('leaves the settings pane open when it shares the main window', () => {
    const openWindow = vi.spyOn(window, 'open').mockReturnValue(null);
    const { tab, close } = createHarness();

    const event = clickPluginLink(
      tab,
      makePluginLink('obsidian-style-settings')
    );

    expect(close).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(openWindow).toHaveBeenCalledWith(URI);
  });

  it('closes a popped-out settings pane before dispatching the URI', () => {
    const openWindow = vi.spyOn(window, 'open').mockReturnValue(null);
    const { tab, close } = createHarness();

    clickPluginLink(
      tab,
      makePluginLink('obsidian-style-settings', makeSettingsWindowDocument())
    );

    expect(close).toHaveBeenCalledTimes(1);
    expect(openWindow).toHaveBeenCalledWith(URI);
  });

  it('leaves the click alone when the settings pane cannot be closed', () => {
    const openWindow = vi.spyOn(window, 'open').mockReturnValue(null);
    const { tab } = createHarness({ close: null });

    const event = clickPluginLink(
      tab,
      makePluginLink('obsidian-style-settings')
    );

    expect(event.defaultPrevented).toBe(false);
    expect(openWindow).not.toHaveBeenCalled();
  });

  // A modifier-click asks for a new tab or window, which only the plain href
  // can deliver — so the router must not intercept it.
  it.each(['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const)(
    'leaves a %s click to the browser',
    (modifier) => {
      const openWindow = vi.spyOn(window, 'open').mockReturnValue(null);
      const { tab, close } = createHarness();

      const event = clickPluginLink(
        tab,
        makePluginLink('obsidian-style-settings'),
        { [modifier]: true }
      );

      expect(event.defaultPrevented).toBe(false);
      expect(close).not.toHaveBeenCalled();
      expect(openWindow).not.toHaveBeenCalled();
    }
  );
});

// `captureButton`'s `settingEl` is detached, so the delegated listener lands on
// the shared jsdom document, which `afterEach` never clears — every case runs
// its captured cleanup to keep handlers from stacking up across the file.
describe('Appearance row', () => {
  const URI = 'obsidian://show-plugin?id=obsidian-style-settings';
  const DIRECTORY_URL =
    'https://community.obsidian.md/plugins/obsidian-style-settings';

  it('opens the plugin’s own settings while it is enabled', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    // Without an overridden `openTabById` the harness returns null and the
    // click would fall through to `window.open` instead.
    const { row, openTabById, close } = getAppearanceRow({
      openTabById: (id) => ({ id }),
    });

    const button = captureButton(row.render);
    expect(button.text).toBe('Open');

    // `void` because the handler type admits the async Enable variant; this
    // branch's handler is synchronous and returns nothing to await.
    void button.clickHandler?.();

    expect(openTabById).toHaveBeenCalledWith(STYLE_SETTINGS_ID);
    expect(close).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();

    button.cleanup?.();
  });

  it('enables an installed plugin and rebuilds the row', async () => {
    const { row, tab, enablePluginAndSave } = getAppearanceRow({
      styleSettings: 'installed',
    });
    const update = vi.spyOn(tab, 'update');

    const button = captureButton(row.render);
    expect(button.text).toBe('Enable');

    await button.clickHandler?.();

    expect(enablePluginAndSave).toHaveBeenCalledWith(STYLE_SETTINGS_ID);
    expect(update).toHaveBeenCalledTimes(1);

    button.cleanup?.();
  });

  it('opens the directory entry while the plugin is not installed', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { row, openTabById } = getAppearanceRow({ styleSettings: 'absent' });

    const button = captureButton(row.render);
    expect(button.text).toBe('Install');

    void button.clickHandler?.();

    expect(openTabById).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(URI);

    button.cleanup?.();
  });

  it('falls back to the web directory when routing inside Obsidian fails', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { row } = getAppearanceRow({ close: null });

    const button = captureButton(row.render);
    void button.clickHandler?.();

    expect(open).toHaveBeenCalledWith(DIRECTORY_URL, '_blank');

    button.cleanup?.();
  });
});

describe('Support group', () => {
  it('closes the page with a Support group holding both outbound rows', () => {
    const group = getSupportGroup();

    expect(group.type).toBe('group');
    expect(group.heading).toBe('Support');
    expect(group.items).toHaveLength(2);
  });

  // Order is load-bearing: self-serve help before the escalation path.
  it('names both rows, which is what keeps them in the settings search index', () => {
    expect(getSupportGroup().items.map((row) => row.name)).toEqual([
      'Help',
      'Send feedback',
    ]);
  });

  it('opens the discussions board when the help button is clicked', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const [row] = getSupportGroup().items;

    const button = captureButton(row.render);
    expect(button.text).toBe('Open');

    void button.clickHandler?.();
    expect(open).toHaveBeenCalledWith(
      'https://github.com/churnish/dynamic-views/discussions',
      '_blank'
    );
  });

  it('opens the plugin issue tracker when the feedback button is clicked', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const [, row] = getSupportGroup().items;

    const button = captureButton(row.render);
    expect(button.text).toBe('Open');

    void button.clickHandler?.();
    expect(open).toHaveBeenCalledWith(
      'https://github.com/churnish/dynamic-views/issues',
      '_blank'
    );
  });
});
