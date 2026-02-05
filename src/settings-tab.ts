/* eslint-disable @typescript-eslint/no-misused-promises */
import {
  App,
  PluginSettingTab,
  Setting,
  SettingGroup,
  setIcon,
} from "obsidian";
import type DynamicViews from "../main";

// Plugin names (proper nouns, not subject to sentence case)
const PLUGIN_STYLE_SETTINGS = "Style Settings";
const PLUGIN_NOTEBOOK_NAVIGATOR = "Notebook Navigator";
const PLUGIN_AUTO_CARD_LINK = "Auto Card Link";
const PLUGIN_LINK_EMBED = "Link Embed";

export class DynamicViewsSettingTab extends PluginSettingTab {
  plugin: DynamicViews;

  constructor(app: App, plugin: DynamicViews) {
    super(app, plugin);
    this.plugin = plugin;
    this.icon = "database-zap";
  }

  /**
   * Trim whitespace from text field settings
   */
  private async trimTextFieldSettings(): Promise<void> {
    const pluginSettings = this.plugin.persistenceManager.getPluginSettings();
    const trimmed: Partial<typeof pluginSettings> = {};
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
    }
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    // Trim whitespace from text fields on open
    void this.trimTextFieldSettings();

    const settings = this.plugin.persistenceManager.getPluginSettings();

    // Smart timestamp variables - declared before SettingGroup for use in callbacks
    let smartTimestampSetting: Setting | undefined;
    let conditionalText: HTMLSpanElement;
    let smartTimestampSubSettingsEl: HTMLDivElement;

    // Helper function to update smart timestamp visibility
    const updateSmartTimestampVisibility = (enabled: boolean) => {
      smartTimestampSubSettingsEl.toggleClass("dynamic-views-hidden", !enabled);
      conditionalText.toggleClass("dynamic-views-hidden", !enabled);
    };

    // Appearance section - description text only, no settings
    new SettingGroup(containerEl).addClass("dynamic-views-appearance-group");

    // Add description paragraphs inside the setting-items container
    const appearanceItems = containerEl.querySelector(
      ".dynamic-views-appearance-group .setting-items",
    );
    if (appearanceItems) {
      const appearanceDesc = appearanceItems.createEl("p", {
        cls: "setting-item-description",
      });
      appearanceDesc.appendText("Appearance settings can be configured in ");
      appearanceDesc.createEl("a", {
        text: PLUGIN_STYLE_SETTINGS,
        href: "obsidian://show-plugin?id=obsidian-style-settings",
      });
      appearanceDesc.appendText(".");

      const appearanceTip = appearanceItems.createEl("p", {
        cls: "setting-item-description",
      });
      appearanceTip.appendText("Tip: Run ");
      appearanceTip.createEl("em").appendText("Show style settings view");
      appearanceTip.appendText(
        " in the Command palette to open settings in a tab.",
      );
    }

    // General settings (no heading)
    new SettingGroup(containerEl)
      .addClass("dynamic-views-general-group")
      .addSetting((s) =>
        s
          .setName("Open file action")
          .setDesc("How files should open when clicked.")
          .addDropdown((dropdown) =>
            dropdown
              .addOption("card", "Press on title or card")
              .addOption("title", "Press on title")
              .setValue(settings.openFileAction)
              .onChange(async (value: "card" | "title") => {
                await this.plugin.persistenceManager.setPluginSettings({
                  openFileAction: value,
                });
                // Update body classes for CSS and MutationObserver detection
                document.body.classList.remove(
                  "dynamic-views-open-on-card",
                  "dynamic-views-open-on-title",
                );
                document.body.classList.add(`dynamic-views-open-on-${value}`);
              }),
          ),
      )
      .addSetting((s) =>
        s
          .setName("Omit first line in text preview")
          .setDesc("Control when the first line is removed from text preview.")
          .addDropdown((dropdown) =>
            dropdown
              .addOption("always", "Always")
              .addOption("ifMatchesTitle", "If matches title")
              .addOption("never", "Never")
              .setValue(settings.omitFirstLine)
              .onChange(async (value) => {
                await this.plugin.persistenceManager.setPluginSettings({
                  omitFirstLine: value as "always" | "ifMatchesTitle" | "never",
                });
              }),
          ),
      )
      .addSetting((s) =>
        s
          .setName("Prevent sidebar swipe on mobile")
          .setDesc(
            "Prevent sidebars from opening unintentionally when scrolling horizontally in a plugin view.",
          )
          .addDropdown((dropdown) =>
            dropdown
              .addOption("all-views", "In all views")
              .addOption("base-files", "In base files")
              .addOption("disabled", "Disabled")
              .setValue(settings.preventSidebarSwipe)
              .onChange(async (value) => {
                await this.plugin.persistenceManager.setPluginSettings({
                  preventSidebarSwipe: value as
                    | "disabled"
                    | "base-files"
                    | "all-views",
                });
              }),
          ),
      )
      .addSetting((s) =>
        s
          .setName("Open random file in new tab")
          .setDesc(
            "When opening a random file, open it in a new tab instead of the same tab.",
          )
          .addToggle((toggle) =>
            toggle
              .setValue(settings.openRandomInNewTab)
              .onChange(async (value) => {
                await this.plugin.persistenceManager.setPluginSettings({
                  openRandomInNewTab: value,
                });
              }),
          ),
      )
      // Smart timestamp toggle (sub-settings in separate container below)
      .addSetting((s) => {
        smartTimestampSetting = s;
        s.setName("Smart timestamp").addToggle((toggle) =>
          toggle.setValue(settings.smartTimestamp).onChange(async (value) => {
            await this.plugin.persistenceManager.setPluginSettings({
              smartTimestamp: value,
            });
            updateSmartTimestampVisibility(value);
          }),
        );
      });

    if (smartTimestampSetting) {
      const smartTimestampDesc = smartTimestampSetting.descEl;
      smartTimestampDesc.createSpan({
        text: "Automatically switch between created time and modified time to match sort order. ",
      });
      conditionalText = smartTimestampDesc.createSpan({
        text: "One of the properties below must be displayed.",
      });
    }

    // Create container for child settings inside the General SettingGroup
    const generalGroupItems = containerEl.querySelector(
      ".dynamic-views-general-group .setting-items",
    );
    smartTimestampSubSettingsEl = (generalGroupItems ?? containerEl).createDiv(
      "setting-sub-items",
    );

    new Setting(smartTimestampSubSettingsEl)
      .setName("Created time property")
      .setDesc("Property with creation timestamps.")
      .addText((text) =>
        text
          .setPlaceholder("created time")
          .setValue(settings.createdTimeProperty)
          .onChange(async (value) => {
            await this.plugin.persistenceManager.setPluginSettings({
              createdTimeProperty: value,
            });
          }),
      );

    new Setting(smartTimestampSubSettingsEl)
      .setName("Modified time property")
      .setDesc("Property with modification timestamps.")
      .addText((text) =>
        text
          .setPlaceholder("modified time")
          .setValue(settings.modifiedTimeProperty)
          .onChange(async (value) => {
            await this.plugin.persistenceManager.setPluginSettings({
              modifiedTimeProperty: value,
            });
          }),
      );

    // Initialize visibility
    updateSmartTimestampVisibility(settings.smartTimestamp);

    new SettingGroup(containerEl)
      .setHeading("Integrations")
      .addSetting((s) =>
        s
          .setName(`Reveal in ${PLUGIN_NOTEBOOK_NAVIGATOR}`)
          .then((s) => {
            const desc = s.descEl;
            desc.empty();
            desc.appendText(
              "When pressing tags or file path segments, reveal in ",
            );
            desc.createEl("a", {
              text: PLUGIN_NOTEBOOK_NAVIGATOR,
              href: "obsidian://show-plugin?id=notebook-navigator",
            });
            desc.appendText(" instead of the default file explorer.");
          })
          .addDropdown((dropdown) =>
            dropdown
              .addOption("files-folders", "Files & folders")
              .addOption("tags", "Tags")
              .addOption("all", "Files, folders & tags")
              .addOption("disable", "Disable")
              .setValue(settings.revealInNotebookNavigator)
              .onChange(async (value) => {
                await this.plugin.persistenceManager.setPluginSettings({
                  revealInNotebookNavigator: value as
                    | "disable"
                    | "files-folders"
                    | "tags"
                    | "all",
                });
              }),
          ),
      )
      .addSetting((s) =>
        s
          .setName("Fetch YouTube thumbnails")
          .setDesc("Extract thumbnail images from YouTube embeds in notes.")
          .addToggle((toggle) =>
            toggle
              .setValue(settings.showYoutubeThumbnails)
              .onChange(async (value) => {
                await this.plugin.persistenceManager.setPluginSettings({
                  showYoutubeThumbnails: value,
                });
              }),
          ),
      )
      .addSetting((s) =>
        s
          .setName("Fetch card link images")
          .then((s) => {
            const desc = s.descEl;
            desc.appendText("Extract cover images from ");
            desc.createEl("a", {
              text: PLUGIN_AUTO_CARD_LINK,
              href: "obsidian://show-plugin?id=auto-card-link",
            });
            desc.appendText(" or ");
            desc.createEl("a", {
              text: PLUGIN_LINK_EMBED,
              href: "obsidian://show-plugin?id=obsidian-link-embed",
            });
            desc.appendText(" blocks in notes.");
          })
          .addToggle((toggle) =>
            toggle
              .setValue(settings.showCardLinkCovers)
              .onChange(async (value) => {
                await this.plugin.persistenceManager.setPluginSettings({
                  showCardLinkCovers: value,
                });
              }),
          ),
      );

    // Feedback button
    const feedbackContainer = containerEl.createEl("div", {
      cls: "dynamic-views-feedback-container",
    });

    const button = feedbackContainer.createEl("button", {
      cls: "mod-cta dynamic-views-feedback-button",
    });
    button.addEventListener("click", () => {
      window.open(
        "https://github.com/greetclammy/dynamic-views/issues",
        "_blank",
      );
    });

    const iconDiv = button.createEl("div");
    setIcon(iconDiv, "message-square-reply");
    button.appendText("Leave feedback");
  }

  hide(): void {
    // Trim whitespace from text fields on close
    void this.trimTextFieldSettings();
  }
}
