/* eslint-disable @typescript-eslint/no-misused-promises */
import {
  App,
  PluginSettingTab,
  Setting,
  SettingGroup,
  Notice,
  setIcon,
} from "obsidian";
import type DynamicViews from "../main";
import { ClearSettingsModal } from "./modals";
import { DEFAULT_SETTINGS, DEFAULT_VIEW_SETTINGS } from "./constants";
import type { Settings, DefaultViewSettings } from "./types";

export class DynamicViewsSettingTab extends PluginSettingTab {
  plugin: DynamicViews;

  constructor(app: App, plugin: DynamicViews) {
    super(app, plugin);
    this.plugin = plugin;
    this.icon = "database-zap";
  }

  /**
   * Trim whitespace from all text field settings
   */
  private async trimTextFieldSettings(): Promise<void> {
    const globalSettings = this.plugin.persistenceManager.getGlobalSettings();
    const defaultViewSettings =
      this.plugin.persistenceManager.getDefaultViewSettings();

    // Trim global settings
    const trimmedGlobalSettings: Partial<typeof globalSettings> = {};
    let hasGlobalChanges = false;

    if (
      globalSettings.createdTimeProperty.trim() !==
      globalSettings.createdTimeProperty
    ) {
      trimmedGlobalSettings.createdTimeProperty =
        globalSettings.createdTimeProperty.trim();
      hasGlobalChanges = true;
    }
    if (
      globalSettings.modifiedTimeProperty.trim() !==
      globalSettings.modifiedTimeProperty
    ) {
      trimmedGlobalSettings.modifiedTimeProperty =
        globalSettings.modifiedTimeProperty.trim();
      hasGlobalChanges = true;
    }

    // Trim default view settings
    const trimmedDefaultViewSettings: Partial<typeof defaultViewSettings> = {};
    let hasDefaultViewChanges = false;

    if (
      defaultViewSettings.titleProperty.trim() !==
      defaultViewSettings.titleProperty
    ) {
      trimmedDefaultViewSettings.titleProperty =
        defaultViewSettings.titleProperty.trim();
      hasDefaultViewChanges = true;
    }
    if (
      defaultViewSettings.textPreviewProperty.trim() !==
      defaultViewSettings.textPreviewProperty
    ) {
      trimmedDefaultViewSettings.textPreviewProperty =
        defaultViewSettings.textPreviewProperty.trim();
      hasDefaultViewChanges = true;
    }
    if (
      defaultViewSettings.imageProperty.trim() !==
      defaultViewSettings.imageProperty
    ) {
      trimmedDefaultViewSettings.imageProperty =
        defaultViewSettings.imageProperty.trim();
      hasDefaultViewChanges = true;
    }

    // Save if changes detected
    if (hasGlobalChanges) {
      await this.plugin.persistenceManager.setGlobalSettings(
        trimmedGlobalSettings,
      );
    }
    if (hasDefaultViewChanges) {
      await this.plugin.persistenceManager.setDefaultViewSettings(
        trimmedDefaultViewSettings,
      );
    }
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    // Trim whitespace from text fields on open
    void this.trimTextFieldSettings();

    const settings = this.plugin.persistenceManager.getGlobalSettings();

    // Smart timestamp variables - declared before SettingGroup for use in callbacks
    let smartTimestampSetting: Setting | undefined;
    let conditionalText: HTMLSpanElement;
    // eslint-disable-next-line prefer-const
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
        text: "Style Settings",
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
                await this.plugin.persistenceManager.setGlobalSettings({
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
                await this.plugin.persistenceManager.setGlobalSettings({
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
                await this.plugin.persistenceManager.setGlobalSettings({
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
                await this.plugin.persistenceManager.setGlobalSettings({
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
            await this.plugin.persistenceManager.setGlobalSettings({
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
            await this.plugin.persistenceManager.setGlobalSettings({
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
            await this.plugin.persistenceManager.setGlobalSettings({
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
          .setName("Reveal in Notebook Navigator")
          .then((s) => {
            const desc = s.descEl;
            desc.empty();
            desc.appendText(
              "When pressing tags or file path segments, reveal in ",
            );
            desc.createEl("a", {
              text: "Notebook Navigator",
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
                await this.plugin.persistenceManager.setGlobalSettings({
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
                await this.plugin.persistenceManager.setGlobalSettings({
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
              text: "Auto Card Link",
              href: "obsidian://show-plugin?id=auto-card-link",
            });
            desc.appendText(" or ");
            desc.createEl("a", {
              text: "Link Embed",
              href: "obsidian://show-plugin?id=obsidian-link-embed",
            });
            desc.appendText(" blocks in notes.");
          })
          .addToggle((toggle) =>
            toggle
              .setValue(settings.showCardLinkCovers)
              .onChange(async (value) => {
                await this.plugin.persistenceManager.setGlobalSettings({
                  showCardLinkCovers: value,
                });
              }),
          ),
      );

    // Configuration section
    new SettingGroup(containerEl)
      .setHeading("Configuration")
      .addSetting((s) =>
        s
          .setName("Manage settings")
          .setDesc("Back up plugin settings to a file or restore from backup.")
          .addButton((button) =>
            button.setButtonText("Import...").onClick(() => {
              const input = document.createElement("input");
              input.setAttrs({
                type: "file",
                accept: ".json",
              });

              input.onchange = () => {
                const selectedFile = input.files?.[0];

                if (!selectedFile) {
                  input.remove();
                  return;
                }

                const reader = new FileReader();
                reader.readAsText(selectedFile, "UTF-8");

                reader.onerror = () => {
                  new Notice("Failed to read import file");
                  input.remove();
                };

                reader.onload = async (readerEvent) => {
                  let importedJson:
                    | {
                        globalSettings?: Partial<Settings>;
                        defaultViewSettings?: Partial<DefaultViewSettings>;
                      }
                    | undefined;
                  const content = readerEvent.target?.result;
                  if (typeof content === "string") {
                    try {
                      importedJson = JSON.parse(content) as {
                        globalSettings?: Partial<Settings>;
                        defaultViewSettings?: Partial<DefaultViewSettings>;
                      };
                    } catch {
                      new Notice("Invalid import file");
                      console.error("Invalid import file");
                      input.remove();
                      return;
                    }
                  }

                  if (importedJson) {
                    // Merge imported settings with DEFAULT_SETTINGS structure
                    const newGlobalSettings: Settings = Object.assign(
                      {},
                      DEFAULT_SETTINGS,
                    );
                    const newDefaultViewSettings: DefaultViewSettings =
                      Object.assign({}, DEFAULT_VIEW_SETTINGS);

                    // Import global settings
                    if (importedJson.globalSettings) {
                      for (const setting in importedJson.globalSettings) {
                        if (setting in newGlobalSettings) {
                          (
                            newGlobalSettings as unknown as Record<
                              string,
                              unknown
                            >
                          )[setting] = (
                            importedJson.globalSettings as Record<
                              string,
                              unknown
                            >
                          )[setting];
                        }
                      }
                    }

                    // Import default view settings
                    if (importedJson.defaultViewSettings) {
                      for (const setting in importedJson.defaultViewSettings) {
                        if (setting in newDefaultViewSettings) {
                          (
                            newDefaultViewSettings as unknown as Record<
                              string,
                              unknown
                            >
                          )[setting] = (
                            importedJson.defaultViewSettings as Record<
                              string,
                              unknown
                            >
                          )[setting];
                        }
                      }
                    }

                    // Save both settings - need to set the full objects
                    await this.plugin.persistenceManager.setGlobalSettings(
                      newGlobalSettings,
                    );
                    await this.plugin.persistenceManager.setDefaultViewSettings(
                      newDefaultViewSettings,
                    );

                    // Show notification
                    new Notice("Settings imported");

                    // Re-render settings tab
                    this.display();
                  }

                  input.remove();
                };
              };

              input.click();
            }),
          )
          .addButton((button) =>
            button.setButtonText("Export...").onClick(async () => {
              const globalSettings =
                this.plugin.persistenceManager.getGlobalSettings();
              const defaultViewSettings =
                this.plugin.persistenceManager.getDefaultViewSettings();

              const settingsText = JSON.stringify(
                {
                  globalSettings,
                  defaultViewSettings,
                },
                null,
                2,
              );
              const fileName = "dynamic-views-settings.json";

              // Try navigator.share() for mobile (iOS/Android)
              if (navigator.share && navigator.canShare) {
                try {
                  const blob = new Blob([settingsText], {
                    type: "application/json",
                  });
                  const file = new File([blob], fileName, {
                    type: "application/json",
                  });

                  if (navigator.canShare({ files: [file] })) {
                    await navigator.share({
                      files: [file],
                      title: "Dynamic Views Settings",
                    });
                    return;
                  }
                } catch (error) {
                  console.error("Share failed:", error);
                  // Fall through to download link
                }
              }

              // Fallback for desktop: download link
              const exportLink = document.createElement("a");
              exportLink.setAttrs({
                download: fileName,
                href: `data:application/json;charset=utf-8,${encodeURIComponent(settingsText)}`,
              });
              exportLink.click();
            }),
          ),
      )
      .addSetting((s) =>
        s
          .setName("Clear settings")
          .setDesc("Reset all plugin settings to their default values.")
          .addButton((button) => {
            button.buttonEl.addClass("mod-warning");
            button.setButtonText("Clear").onClick(() => {
              new ClearSettingsModal(this.app, this.plugin, async () => {
                // Reset all settings to defaults with deep copy
                const newGlobalSettings: Settings = JSON.parse(
                  JSON.stringify(DEFAULT_SETTINGS),
                ) as Settings;
                const newDefaultViewSettings: DefaultViewSettings = JSON.parse(
                  JSON.stringify(DEFAULT_VIEW_SETTINGS),
                ) as DefaultViewSettings;

                // Save the cleared settings
                await this.plugin.persistenceManager.setGlobalSettings(
                  newGlobalSettings,
                );
                await this.plugin.persistenceManager.setDefaultViewSettings(
                  newDefaultViewSettings,
                );

                // Show notification
                new Notice("Settings cleared");

                // Re-render settings tab
                this.display();
              }).open();
            });
          }),
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
