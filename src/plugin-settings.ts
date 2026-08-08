import {
  App,
  Platform,
  PluginSettingTab,
  type SettingDefinitionItem,
} from 'obsidian';
import type DynamicViews from '../main';
import type { PluginSettings } from './types';
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

/** Marks the sentence in the smart timestamp description that is shown only while it is on */
const SMART_TIMESTAMP_CAVEAT_CLASS = 'dynamic-views-smart-timestamp-caveat';

/** Community plugin directory, appended with a plugin ID */
const PLUGIN_DIRECTORY_URL = 'https://community.obsidian.md/plugins/';

/** Carries the target plugin ID on links that point at another plugin */
const PLUGIN_LINK_ATTR = 'data-dynamic-views-plugin-link';

/** Picks whether a plugin link opens that plugin's settings or its directory entry */
const PLUGIN_LINK_DESTINATION_ATTR = 'data-dynamic-views-plugin-link-target';

/**
 * Side effects that must run after a control writes a given key.
 *
 * Declarative controls have no per-control change callback, so `setControlValue`
 * is the single place these can live.
 */
const CASCADES: Partial<Record<SettingKey, (plugin: DynamicViews) => void>> = {
  openFileAction: (plugin) => {
    const { openFileAction } = plugin.persistenceManager.getPluginSettings();
    const docs = [document, ...plugin.getAllPopoutDocuments()];
    for (const doc of docs) {
      doc.body.classList.remove(
        'dynamic-views-open-on-card',
        'dynamic-views-open-on-title'
      );
      doc.body.classList.add(`dynamic-views-open-on-${openFileAction}`);
    }
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

    if (
      pluginSettings.createdTimeProperty.trim() !==
      pluginSettings.createdTimeProperty
    ) {
      trimmed.createdTimeProperty = pluginSettings.createdTimeProperty.trim();
      hasChanges = true;
    }
    if (
      pluginSettings.modifiedTimeProperty.trim() !==
      pluginSettings.modifiedTimeProperty
    ) {
      trimmed.modifiedTimeProperty = pluginSettings.modifiedTimeProperty.trim();
      hasChanges = true;
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
    } as Partial<PluginSettings>);

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
    label: string,
    destination: 'settings' | 'directory'
  ): void {
    parent.createEl('a', {
      text: label,
      href: `${PLUGIN_DIRECTORY_URL}${pluginId}`,
      attr: {
        [PLUGIN_LINK_ATTR]: pluginId,
        [PLUGIN_LINK_DESTINATION_ATTR]: destination,
      },
    });
  }

  /**
   * Keep plugin links inside Obsidian when it lets us, in three steps:
   *
   * 1. the plugin's own settings, for links that ask for them — only possible
   *    while the plugin is installed and enabled, since nothing else has a tab
   * 2. its entry in the community plugin directory, still inside Obsidian
   * 3. the link's own href, opening that entry on the web
   *
   * Each step is a best-effort enhancement over the one below it, so a missing
   * `app.setting` — undocumented, and able to disappear in any release — just
   * leaves the click alone and lets the browser handle it.
   *
   * Delegated rather than bound per link because `desc` fragments are cloned
   * before mounting, which keeps attributes but drops listeners.
   */
  private handlePluginLinkClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    const link = target?.closest?.(`[${PLUGIN_LINK_ATTR}]`);
    const pluginId = link?.getAttribute(PLUGIN_LINK_ATTR);
    if (!link || !pluginId) return;

    const setting = this.app.setting;

    const wantsSettings =
      link.getAttribute(PLUGIN_LINK_DESTINATION_ATTR) === 'settings';
    if (wantsSettings && setting?.openTabById?.(pluginId)) {
      event.preventDefault();
      return;
    }

    const mainWindow = getOwnerWindow(this.app.workspace?.containerEl);
    if (typeof setting?.close !== 'function' || !mainWindow) return;

    event.preventDefault();
    // The directory entry opens as a modal over the settings pane. That only
    // works while the pane shares the main window — when settings lives in its
    // own window the dispatch is ignored, so close it and let the URI reopen
    // settings on the directory. Treat an unreadable config as the popout case,
    // which works either way at the cost of an extra window.
    const settingsSharesMainWindow =
      this.app.vault.getConfig?.('settingsPopoutWindow') === false;
    if (!settingsSharesMainWindow) setting.close();

    mainWindow.open(`obsidian://show-plugin?id=${pluginId}`);
  };

  getSettingDefinitions(): SettingDefinitionItem<SettingKey>[] {
    return [
      // Appearance — informational only, no settings of its own
      {
        type: 'group',
        cls: 'dynamic-views-appearance-group',
        items: [
          {
            // An empty name keeps this decorative row out of settings search.
            // A definition with no control/render/action is dropped by the
            // renderer, so the paragraphs are mounted through `render`.
            name: '',
            render: (setting) => {
              setting.setDesc(
                createFragment((frag) => {
                  const intro = frag.createEl('p');
                  intro.appendText('Appearance settings can be configured in ');
                  // The one link that points at a plugin to configure, so it
                  // opens that plugin's settings rather than its listing
                  this.createPluginLink(
                    intro,
                    'obsidian-style-settings',
                    PLUGIN_STYLE_SETTINGS,
                    'settings'
                  );
                  intro.appendText('.');

                  const tip = frag.createEl('p');
                  tip.appendText('Tip: Run ');
                  tip.createEl('strong', { text: 'Show style settings view' });
                  tip.appendText(
                    ' in the Command palette to open settings in a tab.'
                  );
                })
              );

              // Delegated from here because `desc` fragments offer no render
              // hook of their own. Bound to this row's document so it follows
              // the settings window, which is recreated on every open.
              const doc = setting.settingEl.ownerDocument;
              doc.addEventListener('click', this.handlePluginLinkClick);
              return () =>
                doc.removeEventListener('click', this.handlePluginLinkClick);
            },
          },
        ],
      },

      // General settings (no heading, per Obsidian's convention)
      {
        name: 'Open file action',
        desc: createFragment((frag) => {
          frag.appendText('How files should open. ');
          frag.createEl('strong', { text: 'Press on title' });
          frag.appendText(' enables card text selection.');
        }),
        control: {
          type: 'dropdown',
          key: 'openFileAction',
          defaultValue: 'card',
          options: { card: 'Press on card', title: 'Press on title' },
        },
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
        // the properties below are on screen, and update() skips the row holding
        // DOM focus — which is exactly this row after the user clicks its toggle.
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
                PLUGIN_NOTEBOOK_NAVIGATOR,
                'directory'
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
                PLUGIN_AUTO_CARD_LINK,
                'directory'
              );
              frag.appendText(' or ');
              this.createPluginLink(
                frag,
                'obsidian-link-embed',
                PLUGIN_LINK_EMBED,
                'directory'
              );
              frag.appendText(' blocks in notes.');
            }),
            control: { type: 'toggle', key: 'showCardLinkCovers' },
          },
        ],
      },

      {
        // `render` rather than `action` so the button keeps its label instead of
        // turning the whole row into a click target.
        name: 'Send feedback',
        desc: 'Request features or report bugs.',
        render: (setting) => {
          setting.addButton((button) =>
            button.setButtonText('Open').onClick(() => {
              getOwnerWindow(setting.settingEl).open(FEEDBACK_URL, '_blank');
            })
          );
        },
      },
    ];
  }

  hide(): void {
    // Trim whitespace from text fields on close
    void this.trimTextFieldSettings();
    super.hide();
  }
}
