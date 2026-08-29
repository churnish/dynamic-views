import {
  App,
  Platform,
  PluginSettingTab,
  type SettingDefinitionItem,
} from 'obsidian';
import type DynamicViews from '../main';
import type { PluginSettings } from './types';
import { applyOpenFileActionClass } from './core/open-file-action';
import { getOwnerWindow } from './utils/owner-window';

/** Keys the declarative controls bind to, checked against the settings shape */
type SettingKey = Extract<keyof PluginSettings, string>;

// Plugin names (proper nouns, not subject to sentence case)
const PLUGIN_STYLE_SETTINGS = 'Style Settings';
const PLUGIN_NOTEBOOK_NAVIGATOR = 'Notebook Navigator';
const PLUGIN_AUTO_CARD_LINK = 'Auto Card Link';
const PLUGIN_LINK_EMBED = 'Link Embed';

// Default property names (lowercase by Obsidian convention, not subject to sentence case)
const DEFAULT_CREATED_TIME_PROPERTY = 'created time';
const DEFAULT_MODIFIED_TIME_PROPERTY = 'modified time';

// Description containing proper nouns (not subject to sentence case)
const OPEN_RANDOM_DESC = Platform.isPhone
  ? 'When opening a random file, open it in a new tab instead of the same tab.'
  : 'When opening a random file, open it in a new tab instead of the same tab. Hold Ctrl/Cmd to override.';
const CONTEXT_MENU_DESC =
  'Show commands to create new Grid or Masonry base in folder context menus.';

const FEEDBACK_URL = 'https://github.com/churnish/dynamic-views/issues';
const HELP_URL = 'https://github.com/churnish/dynamic-views/discussions';

/** Marks the sentence in the smart timestamp description that is shown only while it is on */
const SMART_TIMESTAMP_CAVEAT_CLASS = 'dynamic-views-smart-timestamp-caveat';

/** Community plugin directory, appended with a plugin ID */
const PLUGIN_DIRECTORY_URL = 'https://community.obsidian.md/plugins/';

/** Carries the target plugin ID on links that point at another plugin */
const PLUGIN_LINK_ATTR = 'data-dynamic-views-plugin-link';

/**
 * Containers Obsidian renders settings rows into — a page's content area, or
 * the tab's own root for rows outside any page.
 */
const SETTINGS_CONTAINER_SELECTOR =
  '.setting-page-content, .vertical-tab-content';

/** Text settings whose stored value is trimmed when the tab closes */
const TRIMMED_KEYS = ['createdTimeProperty', 'modifiedTimeProperty'] as const;

/**
 * Side effects that must run after a control writes a given key.
 *
 * Declarative controls have no per-control change callback, so `setControlValue`
 * is the single place these can live.
 */
const CASCADES: Partial<Record<SettingKey, (plugin: DynamicViews) => void>> = {
  openOnTitle: (plugin) => {
    const { openOnTitle } = plugin.persistenceManager.getPluginSettings();
    applyOpenFileActionClass(
      [document, ...plugin.getAllPopoutDocuments()],
      openOnTitle
    );
  },
};

export class DynamicViewsSettingTab extends PluginSettingTab {
  plugin: DynamicViews;

  constructor(app: App, plugin: DynamicViews) {
    super(app, plugin);
    this.plugin = plugin;
    this.icon = 'database-zap';
  }

  /**
   * Trim whitespace from text field settings
   */
  private async trimTextFieldSettings(): Promise<void> {
    const pluginSettings = this.plugin.persistenceManager.getPluginSettings();
    const trimmed: Partial<PluginSettings> = {};
    let hasChanges = false;

    for (const key of TRIMMED_KEYS) {
      const value = pluginSettings[key];
      if (value.trim() !== value) {
        trimmed[key] = value.trim();
        hasChanges = true;
      }
    }

    if (hasChanges) {
      await this.plugin.persistenceManager.setPluginSettings(trimmed);
      // Rendered controls never re-read stored values on their own — rebuild so
      // the fields show the trimmed text the next time the tab opens.
      this.update();
    }
  }

  /** Settings live in the persistence manager, not on a `settings` field */
  getControlValue(key: string): unknown {
    return this.plugin.persistenceManager.getPluginSettings()[
      key as SettingKey
    ];
  }

  /** Replaces the default write path, including its automatic save */
  async setControlValue(key: string, value: unknown): Promise<void> {
    await this.plugin.persistenceManager.setPluginSettings({
      [key]: value,
    });

    CASCADES[key as SettingKey]?.(this.plugin);

    // No definition's structure depends on another setting's value, so
    // re-evaluating predicates in place is enough — no rebuild needed
    this.refreshDomState();
  }

  /** Read live rather than at definition time — `visible` predicates re-run on refresh */
  private smartTimestampEnabled(): boolean {
    return this.plugin.persistenceManager.getPluginSettings().smartTimestamp;
  }

  /**
   * Link to a plugin's page in the community plugin directory.
   *
   * A plain web link on purpose: `obsidian://` URLs are inert inside the
   * settings window — its own popout since Obsidian 1.13, with no
   * custom-protocol handling — while ordinary `https` links work there.
   */
  private createPluginLink(
    parent: HTMLElement | DocumentFragment,
    pluginId: string,
    label: string
  ): void {
    parent.createEl('a', {
      text: label,
      href: `${PLUGIN_DIRECTORY_URL}${pluginId}`,
      attr: {
        [PLUGIN_LINK_ATTR]: pluginId,
      },
    });
  }

  /**
   * Keep a plugin reference inside Obsidian when it lets us, in two steps:
   *
   * 1. the plugin's own settings, when `preferSettings` asks for them — only
   *    possible while the plugin is installed and enabled, since nothing else
   *    has a tab
   * 2. its entry in the community plugin directory, still inside Obsidian
   *
   * Returns false when neither worked, leaving the caller its own fallback:
   * the community directory on the web. `app.setting` is undocumented and able
   * to disappear in any release, so a missing one is a miss, not a throw.
   */
  private routeToPlugin(
    pluginId: string,
    originEl: Element,
    preferSettings: boolean
  ): boolean {
    const setting = this.app.setting;
    if (preferSettings && setting?.openTabById?.(pluginId)) return true;
    if (typeof setting?.close !== 'function') return false;

    // Dispatched from the main window because the settings window has no
    // custom-protocol handling of its own.
    const mainWindow = getOwnerWindow(this.app.workspace.containerEl);

    // The directory entry opens as a modal over the settings pane, which only
    // works while the pane shares the main window. Comparing the origin
    // element's window is exact where the `settingsPopoutWindow` preference is
    // not: that key defaults to true and stays true on mobile, where
    // `canPopoutWindow` is false and settings never pops out — reading it
    // would close the pane on every press there.
    if (getOwnerWindow(originEl) !== mainWindow) setting.close();

    mainWindow.open(`obsidian://show-plugin?id=${pluginId}`);
    return true;
  }

  /**
   * Routes plugin links in descriptions to their directory entry inside
   * Obsidian, falling back to the link's own href on the web.
   *
   * Delegated rather than bound per link because `desc` fragments are cloned
   * before mounting, which keeps attributes but drops listeners.
   */
  private handlePluginLinkClick = (event: MouseEvent): void => {
    // A modifier-click is the user deliberately asking for a new tab or
    // window, which only the plain href can give them.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    const target = event.target as HTMLElement | null;
    const link = target?.closest?.(`[${PLUGIN_LINK_ATTR}]`);
    const pluginId = link?.getAttribute(PLUGIN_LINK_ATTR);
    if (!link || !pluginId) return;

    // Every link points at a plugin to read about, never one to configure —
    // the Appearance row's button is the only settings destination, and it
    // calls `routeToPlugin` directly.
    if (this.routeToPlugin(pluginId, link, false)) event.preventDefault();
  };

  getSettingDefinitions(): SettingDefinitionItem<SettingKey>[] {
    return [
      // Points at Style Settings rather than owning a setting of its own, so
      // it leads the page: appearance is the first thing users look for here,
      // and it is not here.
      {
        // `render` rather than `action` so the button keeps its label instead
        // of turning the whole row into a click target. The state probe below
        // lives inside `render` on purpose — definitions are rebuilt only by
        // `update()`, never on tab display, while render callbacks run again
        // every time the tab is shown, so the label is correct each time the
        // user opens the tab.
        name: 'Appearance options',
        desc: `Use the ${PLUGIN_STYLE_SETTINGS} plugin to tweak the appearance of plugin views.`,
        render: (setting) => {
          const pluginId = 'obsidian-style-settings';
          const installed = pluginId in this.app.plugins.manifests;
          const enabled = !!this.app.plugins.plugins[pluginId];

          // Last resort for both routed branches: the directory on the web,
          // the same destination the row's link used to carry as its href.
          const route = (preferSettings: boolean) => () => {
            if (
              !this.routeToPlugin(pluginId, setting.settingEl, preferSettings)
            ) {
              getOwnerWindow(setting.settingEl).open(
                `${PLUGIN_DIRECTORY_URL}${pluginId}`,
                '_blank'
              );
            }
          };

          setting.addButton((button) => {
            if (enabled) {
              button.setButtonText('Open').onClick(route(true));
              return;
            }

            if (installed) {
              button.setButtonText('Enable').onClick(async () => {
                await this.app.plugins.enablePluginAndSave(pluginId);
                // Unconditional: `update()` re-probes, so a failed enable
                // simply leaves the label on 'Enable'. Do NOT blur first —
                // `update()` only skips a focused row when that row has a
                // `control`, which this one does not, and it refocuses the
                // rebuilt button afterwards. Blurring forfeits that.
                this.update();
              });
              return;
            }

            button.setButtonText('Install').onClick(route(false));
          });

          // Mounted here because a `render` callback is the only hook that
          // hands back a live element in the settings window: `desc`
          // fragments offer none, and `display()` is skipped entirely once
          // getSettingDefinitions() returns rows. The button above needs no
          // delegation, so this mount exists purely for the plugin links in
          // Integrations — deleting or reordering THIS row silently drops
          // them to plain browser links. They still open, just in a browser.
          //
          // Bound to the enclosing container element, NEVER to a document:
          // Obsidian builds settings rows in the main document and adopts
          // the subtree into the settings window afterwards when that
          // window is separate — the default. Adoption rebinds
          // `ownerDocument` without migrating listeners bound to the old
          // document, so binding to `settingEl.ownerDocument` here lands on
          // the main document and never sees a click in the settings
          // window. Element listeners survive adoption.
          const host =
            setting.settingEl.closest(SETTINGS_CONTAINER_SELECTOR) ??
            setting.settingEl.ownerDocument;
          host.addEventListener('click', this.handlePluginLinkClick);
          return () =>
            host.removeEventListener('click', this.handlePluginLinkClick);
        },
      },

      // General settings (no heading, per Obsidian's convention)
      {
        name: 'Press title to open',
        desc: 'Open files by pressing the card title. Allows selecting card text.',
        control: { type: 'toggle', key: 'openOnTitle' },
      },
      {
        name: 'Folder commands',
        desc: CONTEXT_MENU_DESC,
        control: { type: 'toggle', key: 'folderCommands' },
      },
      {
        name: 'Open random file in new tab',
        desc: OPEN_RANDOM_DESC,
        control: { type: 'toggle', key: 'openRandomInNewTab' },
      },
      {
        // A `render` row rather than a `control`: the caveat is only true while
        // the properties below are on screen, and update() skips a focused row
        // when that row carries a `control` — which this row would, were the
        // toggle one, and it holds focus right after the user clicks it.
        // Toggling the sentence directly sidesteps that.
        name: 'Smart timestamp',
        render: (setting) => {
          setting.setDesc(
            createFragment((frag) => {
              frag.appendText(
                'Automatically switch between created time and modified time to match sort order.'
              );
              frag
                .createSpan({
                  cls: SMART_TIMESTAMP_CAVEAT_CLASS,
                  text: ' One of the properties below must be displayed.',
                })
                .toggleClass(
                  'dynamic-views-hidden',
                  !this.smartTimestampEnabled()
                );
            })
          );

          setting.addToggle((toggle) =>
            toggle
              .setValue(this.smartTimestampEnabled())
              .onChange(async (value) => {
                await this.setControlValue('smartTimestamp', value);
                setting.descEl
                  .querySelector(`.${SMART_TIMESTAMP_CAVEAT_CLASS}`)
                  ?.toggleClass('dynamic-views-hidden', !value);
              })
          );
        },
      },
      {
        name: 'Created time property',
        desc: 'Property with creation timestamps.',
        visible: () => this.smartTimestampEnabled(),
        control: {
          type: 'text',
          key: 'createdTimeProperty',
          placeholder: DEFAULT_CREATED_TIME_PROPERTY,
        },
      },
      {
        name: 'Modified time property',
        desc: 'Property with modification timestamps.',
        visible: () => this.smartTimestampEnabled(),
        control: {
          type: 'text',
          key: 'modifiedTimeProperty',
          placeholder: DEFAULT_MODIFIED_TIME_PROPERTY,
        },
      },
      {
        type: 'group',
        heading: 'Mobile',
        items: [
          {
            name: 'Full screen',
            desc: 'Automatically hide interface elements when scrolling down on phone.',
            control: { type: 'toggle', key: 'fullScreen' },
          },
          {
            name: 'Disable sidebar swipe',
            desc: 'Prevent sidebars from opening unintentionally when scrolling horizontally.',
            control: { type: 'toggle', key: 'preventSidebarSwipe' },
          },
        ],
      },

      {
        type: 'group',
        heading: 'Integrations',
        items: [
          {
            name: `Reveal in ${PLUGIN_NOTEBOOK_NAVIGATOR}`,
            desc: createFragment((frag) => {
              frag.appendText(
                'When pressing tags or file path segments, reveal in '
              );
              this.createPluginLink(
                frag,
                'notebook-navigator',
                PLUGIN_NOTEBOOK_NAVIGATOR
              );
              frag.appendText(' instead of the default file explorer.');
            }),
            control: {
              type: 'dropdown',
              key: 'revealInNotebookNavigator',
              defaultValue: 'disable',
              options: {
                'files-folders': 'Files & folders',
                tags: 'Tags',
                all: 'Files, folders & tags',
                disable: 'Disable',
              },
            },
          },
          {
            name: 'Show YouTube thumbnails',
            desc: 'Fetch preview images from YouTube embeds in notes.',
            control: { type: 'toggle', key: 'showYoutubeThumbnails' },
          },
          {
            name: 'Show card link images',
            desc: createFragment((frag) => {
              frag.appendText('Fetch cover images from ');
              this.createPluginLink(
                frag,
                'auto-card-link',
                PLUGIN_AUTO_CARD_LINK
              );
              frag.appendText(' or ');
              this.createPluginLink(
                frag,
                'obsidian-link-embed',
                PLUGIN_LINK_EMBED
              );
              frag.appendText(' blocks in notes.');
            }),
            control: { type: 'toggle', key: 'showCardLinkCovers' },
          },
        ],
      },

      {
        // Both rows address the plugin itself rather than any setting, so they
        // close out the page in their own box. Help leads because it is the
        // self-serve option — a user who finds an existing answer never needs
        // the row below it.
        type: 'group',
        heading: 'Support',
        items: [
          {
            // `render` rather than `action` so the button keeps its label
            // instead of turning the whole row into a click target.
            name: 'Help',
            desc: 'View discussions or ask a question.',
            render: (setting) => {
              setting.addButton((button) =>
                button.setButtonText('Open').onClick(() => {
                  getOwnerWindow(setting.settingEl).open(HELP_URL, '_blank');
                })
              );
            },
          },
          {
            name: 'Send feedback',
            desc: 'Request improvements or report bugs.',
            render: (setting) => {
              setting.addButton((button) =>
                button.setButtonText('Open').onClick(() => {
                  getOwnerWindow(setting.settingEl).open(
                    FEEDBACK_URL,
                    '_blank'
                  );
                })
              );
            },
          },
        ],
      },
    ];
  }

  hide(): void {
    // Trim whitespace from text fields on close
    void this.trimTextFieldSettings();
    super.hide();
  }
}
