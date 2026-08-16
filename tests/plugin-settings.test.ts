import { vi, describe, it, expect, afterEach } from 'vitest';
import { DynamicViewsSettingTab } from '../src/plugin-settings';

const PLUGIN_LINK_ATTR = 'data-dynamic-views-plugin-link';
const PLUGIN_LINK_DESTINATION_ATTR =
  'data-dynamic-views-plugin-link-destination';

const OPEN_ON_CARD = 'dynamic-views-open-on-card';
const OPEN_ON_TITLE = 'dynamic-views-open-on-title';

interface HarnessOptions {
  openFileAction?: 'card' | 'title';
  openTabById?: (id: string) => { id: string } | null;
  /** `null` drops `close` from `app.setting`, which must leave the click alone. */
  close?: (() => void) | null;
  settingsPopoutWindow?: unknown;
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
    openFileAction: options.openFileAction ?? 'card',
  };
  const setPluginSettings = vi.fn(async (patch: Record<string, unknown>) => {
    Object.assign(stored, patch);
  });

  const popoutDocs = [makePopoutDocument(), makePopoutDocument()];
  const openTabById = vi.fn(options.openTabById ?? (() => null));
  const close = vi.fn(options.close ?? (() => {}));

  const app = {
    workspace: { containerEl: document.createElement('div') },
    vault: { getConfig: vi.fn(() => options.settingsPopoutWindow) },
    setting: options.close === null ? { openTabById } : { openTabById, close },
  };

  const plugin = {
    persistenceManager: {
      getPluginSettings: () => ({ ...stored }),
      setPluginSettings,
    },
    getAllPopoutDocuments: () => popoutDocs,
  };

  const tab = new DynamicViewsSettingTab(app as any, plugin as any);
  return { tab, setPluginSettings, popoutDocs, openTabById, close };
}

function makePluginLink(
  pluginId: string,
  destination: 'settings' | 'directory'
): HTMLAnchorElement {
  const link = document.createElement('a');
  link.href = `https://community.obsidian.md/plugins/${pluginId}`;
  link.setAttribute(PLUGIN_LINK_ATTR, pluginId);
  link.setAttribute(PLUGIN_LINK_DESTINATION_ATTR, destination);
  document.body.appendChild(link);
  return link;
}

/** Dispatches through the delegated handler directly — `desc` fragments drop listeners. */
function clickPluginLink(
  tab: DynamicViewsSettingTab,
  link: HTMLAnchorElement
): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'target', { value: link });
  (tab as any).handlePluginLinkClick(event);
  return event;
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
    const { tab } = createHarness({ openFileAction: 'card' });

    await tab.setControlValue('openFileAction', 'title');

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
    const { tab } = createHarness({ openFileAction: 'card' });
    document.body.classList.add(OPEN_ON_CARD);

    await tab.setControlValue('openFileAction', 'title');

    expect(document.body.classList.contains(OPEN_ON_CARD)).toBe(false);
  });
});

describe('openFileAction cascade', () => {
  it('applies the class to the main document and every popout', async () => {
    const { tab, popoutDocs } = createHarness({ openFileAction: 'card' });
    for (const doc of [document, ...popoutDocs]) {
      doc.body.classList.add(OPEN_ON_CARD);
    }

    await tab.setControlValue('openFileAction', 'title');

    for (const doc of [document, ...popoutDocs]) {
      expect(doc.body.classList.contains(OPEN_ON_TITLE)).toBe(true);
      expect(doc.body.classList.contains(OPEN_ON_CARD)).toBe(false);
    }
  });

  it('swaps back without leaving both classes set', async () => {
    const { tab, popoutDocs } = createHarness({ openFileAction: 'title' });
    for (const doc of [document, ...popoutDocs]) {
      doc.body.classList.add(OPEN_ON_TITLE);
    }

    await tab.setControlValue('openFileAction', 'card');

    for (const doc of [document, ...popoutDocs]) {
      expect(doc.body.classList.contains(OPEN_ON_CARD)).toBe(true);
      expect(doc.body.classList.contains(OPEN_ON_TITLE)).toBe(false);
    }
  });
});

describe('plugin link clicks', () => {
  const URI = 'obsidian://show-plugin?id=obsidian-style-settings';

  it('keeps a settings link inside Obsidian when the tab exists', () => {
    const openWindow = vi.spyOn(window, 'open').mockReturnValue(null);
    const { tab, close, openTabById } = createHarness({
      openTabById: (id) => ({ id }),
    });

    const event = clickPluginLink(
      tab,
      makePluginLink('obsidian-style-settings', 'settings')
    );

    expect(openTabById).toHaveBeenCalledWith('obsidian-style-settings');
    expect(event.defaultPrevented).toBe(true);
    expect(close).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('falls through to the directory when no settings tab exists', () => {
    const openWindow = vi.spyOn(window, 'open').mockReturnValue(null);
    const { tab } = createHarness({ openTabById: () => null });

    const event = clickPluginLink(
      tab,
      makePluginLink('obsidian-style-settings', 'settings')
    );

    expect(event.defaultPrevented).toBe(true);
    expect(openWindow).toHaveBeenCalledWith(URI);
  });

  it('leaves the settings pane open when it shares the main window', () => {
    const openWindow = vi.spyOn(window, 'open').mockReturnValue(null);
    const { tab, close } = createHarness({ settingsPopoutWindow: false });

    const event = clickPluginLink(
      tab,
      makePluginLink('obsidian-style-settings', 'directory')
    );

    expect(close).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(openWindow).toHaveBeenCalledWith(URI);
  });

  it('closes a popped-out settings pane before dispatching the URI', () => {
    const openWindow = vi.spyOn(window, 'open').mockReturnValue(null);
    const { tab, close } = createHarness({ settingsPopoutWindow: true });

    clickPluginLink(
      tab,
      makePluginLink('obsidian-style-settings', 'directory')
    );

    expect(close).toHaveBeenCalledTimes(1);
    expect(openWindow).toHaveBeenCalledWith(URI);
  });

  // An unreadable config is treated as the popout case — it works either way.
  it('closes the settings pane when the config is unreadable', () => {
    const openWindow = vi.spyOn(window, 'open').mockReturnValue(null);
    const { tab, close } = createHarness({ settingsPopoutWindow: undefined });

    clickPluginLink(
      tab,
      makePluginLink('obsidian-style-settings', 'directory')
    );

    expect(close).toHaveBeenCalledTimes(1);
    expect(openWindow).toHaveBeenCalledWith(URI);
  });

  it('leaves the click alone when the settings pane cannot be closed', () => {
    const openWindow = vi.spyOn(window, 'open').mockReturnValue(null);
    const { tab } = createHarness({ close: null });

    const event = clickPluginLink(
      tab,
      makePluginLink('obsidian-style-settings', 'directory')
    );

    expect(event.defaultPrevented).toBe(false);
    expect(openWindow).not.toHaveBeenCalled();
  });
});
