import {
  App,
  PluginSettingTab,
  Setting,
  AbstractInputSuggest,
  Notice,
  setIcon,
} from "obsidian";
import type DynamicViewsPlugin from "../main";
import { getAllVaultProperties } from "./utils/property";
import { ClearSettingsModal } from "./modals";
import { DEFAULT_SETTINGS, DEFAULT_VIEW_SETTINGS } from "./constants";
import type { Settings, DefaultViewSettings } from "./types";

/**
 * Property suggester for searchable property dropdowns
 */
class PropertySuggest extends AbstractInputSuggest<string> {
  private properties: string[];
  private textInputEl: HTMLInputElement;

  constructor(app: App, inputEl: HTMLInputElement, properties: string[]) {
    super(app, inputEl);
    this.properties = properties;
    this.textInputEl = inputEl;
  }

  getSuggestions(query: string): string[] {
    const lowerQuery = query.toLowerCase();
    return this.properties.filter((prop) =>
      prop.toLowerCase().includes(lowerQuery),
    );
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value || "(None)");
  }

  selectSuggestion(value: string): void {
    this.textInputEl.value = value;
    this.textInputEl.trigger("input");
    this.close();
  }
}

export class DynamicViewsSettingTab extends PluginSettingTab {
  plugin: DynamicViewsPlugin;

  constructor(app: App, plugin: DynamicViewsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
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

    new Setting(containerEl)
      .setName("Open file action")
      .setDesc("How files should open when clicked")
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
      );

    new Setting(containerEl)
      .setName("Thumbnail cache size")
      .setDesc("Size of cached thumbnails (affects performance and quality)")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("minimal", "Minimal")
          .addOption("small", "Small")
          .addOption("balanced", "Balanced")
          .addOption("large", "Large")
          .addOption("unlimited", "Unlimited")
          .setValue(settings.thumbnailCacheSize)
          .onChange(
            async (
              value: "minimal" | "small" | "balanced" | "large" | "unlimited",
            ) => {
              await this.plugin.persistenceManager.setGlobalSettings({
                thumbnailCacheSize: value,
              });
            },
          ),
      );

    new Setting(containerEl)
      .setName("Omit first line in text preview")
      .setDesc(
        "Always skip first line in text previews (in addition to automatic omission when first line matches title/filename)",
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.omitFirstLine).onChange(async (value) => {
          await this.plugin.persistenceManager.setGlobalSettings({
            omitFirstLine: value,
          });
        }),
      );

    new Setting(containerEl)
      .setName("Prevent sidebar swipe on mobile")
      .setDesc(
        "Disable mobile sidebar gestures when a plugin view is open. Prevents unintentional triggers when scrolling horizontally.",
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
      );

    // Smart timestamp section
    const smartTimestampSetting = new Setting(containerEl)
      .setName("Smart timestamp")
      .addToggle((toggle) =>
        toggle.setValue(settings.smartTimestamp).onChange(async (value) => {
          await this.plugin.persistenceManager.setGlobalSettings({
            smartTimestamp: value,
          });
          if (value) {
            conditionalText.show();
            smartTimestampSubSettings.show();
          } else {
            conditionalText.hide();
            smartTimestampSubSettings.hide();
          }
        }),
      );

    const smartTimestampDesc = smartTimestampSetting.descEl;
    smartTimestampDesc.createSpan({
      text: "Automatically show the created or modified time when sorting by that property. ",
    });
    const conditionalText = smartTimestampDesc.createSpan({
      text: "One of the properties below must be shown in one of the property fields below.",
    });

    // Create container for child settings with indentation
    const smartTimestampSubSettings = containerEl.createDiv(
      "smart-timestamp-sub-settings",
    );

    // Track text field values for conditional fallback visibility
    let createdTimeValue = settings.createdTimeProperty;
    let modifiedTimeValue = settings.modifiedTimeProperty;
    // eslint-disable-next-line prefer-const
    let fallbackSetting: Setting;

    // Helper to update fallback setting visibility
    const updateFallbackVisibility = () => {
      const hasValue =
        createdTimeValue.trim() !== "" || modifiedTimeValue.trim() !== "";
      if (hasValue) {
        fallbackSetting.settingEl.show();
      } else {
        fallbackSetting.settingEl.hide();
      }
    };

    new Setting(smartTimestampSubSettings)
      .setName("Created time property")
      .setDesc("Leave blank to use file metadata.")
      .addText((text) =>
        text
          .setPlaceholder("created")
          .setValue(settings.createdTimeProperty)
          .onChange(async (value) => {
            createdTimeValue = value;
            await this.plugin.persistenceManager.setGlobalSettings({
              createdTimeProperty: value,
            });
            updateFallbackVisibility();
          }),
      );

    new Setting(smartTimestampSubSettings)
      .setName("Modified time property")
      .setDesc("Leave blank to use file metadata.")
      .addText((text) =>
        text
          .setPlaceholder("modified")
          .setValue(settings.modifiedTimeProperty)
          .onChange(async (value) => {
            modifiedTimeValue = value;
            await this.plugin.persistenceManager.setGlobalSettings({
              modifiedTimeProperty: value,
            });
            updateFallbackVisibility();
          }),
      );

    fallbackSetting = new Setting(smartTimestampSubSettings)
      .setName("Fall back to file metadata")
      .setDesc("Use file metadata if a property above is missing or empty.")
      .addToggle((toggle) =>
        toggle
          .setValue(settings.fallbackToFileMetadata)
          .onChange(async (value) => {
            await this.plugin.persistenceManager.setGlobalSettings({
              fallbackToFileMetadata: value,
            });
          }),
      );

    // Initialize fallback visibility
    updateFallbackVisibility();

    // Initialize visibility
    if (settings.smartTimestamp) {
      conditionalText.show();
      smartTimestampSubSettings.show();
    } else {
      conditionalText.hide();
      smartTimestampSubSettings.hide();
    }

    new Setting(containerEl)
      .setName("Show 'shuffle' ribbon icon")
      .setDesc(
        "Display the shuffle button in the left sidebar ribbon. Reload plugin or Obsidian to apply.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(settings.showShuffleInRibbon)
          .onChange(async (value) => {
            await this.plugin.persistenceManager.setGlobalSettings({
              showShuffleInRibbon: value,
            });
          }),
      );

    new Setting(containerEl)
      .setName("Show 'open random file' ribbon icon")
      .setDesc(
        "Display the random file button in the left sidebar ribbon. Reload plugin or Obsidian to apply.",
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.showRandomInRibbon).onChange(async (value) => {
          await this.plugin.persistenceManager.setGlobalSettings({
            showRandomInRibbon: value,
          });
        }),
      );

    new Setting(containerEl)
      .setName("Open random file in new tab")
      .setDesc(
        "When opening a random file, open it in a new tab instead of the same tab",
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.openRandomInNewTab).onChange(async (value) => {
          await this.plugin.persistenceManager.setGlobalSettings({
            openRandomInNewTab: value,
          });
        }),
      );

    // Appearance section
    const appearanceHeading = new Setting(containerEl)
      .setName("Appearance")
      .setHeading();
    appearanceHeading.settingEl.addClass("dynamic-views-appearance-heading");

    const appearanceDesc = containerEl.createEl("p", {
      cls: "setting-item-description",
    });
    appearanceDesc.appendText("Appearance settings can be configured in ");
    appearanceDesc.createEl("a", {
      text: "Style Settings",
      href: "obsidian://show-plugin?id=obsidian-style-settings",
    });
    appearanceDesc.appendText(". Some options may need a reload to apply.");

    const appearanceTip = containerEl.createEl("p", {
      cls: "setting-item-description",
    });
    appearanceTip.appendText("Tip: Run ");
    appearanceTip.createEl("em").appendText("Show style settings view");
    appearanceTip.appendText(
      " in the Command palette to open settings in a tab.",
    );

    // Default settings for new views section
    new Setting(containerEl).setName("Default for new views").setHeading();

    const defaultViewSettings =
      this.plugin.persistenceManager.getDefaultViewSettings();

    // Get all vault properties for searchable dropdowns
    const allProperties = getAllVaultProperties(this.app);

    new Setting(containerEl)
      .setName("First property")
      .setDesc("Property to show in first position")
      .addSearch((search) => {
        search
          .setPlaceholder("Search properties")
          .setValue(defaultViewSettings.propertyDisplay1)
          .onChange(async (value) => {
            await this.plugin.persistenceManager.setDefaultViewSettings({
              propertyDisplay1: value,
            });
          });
        new PropertySuggest(this.app, search.inputEl, allProperties);
      });

    new Setting(containerEl)
      .setName("Second property")
      .setDesc("Property to show in second position")
      .addSearch((search) => {
        search
          .setPlaceholder("Search properties")
          .setValue(defaultViewSettings.propertyDisplay2)
          .onChange(async (value) => {
            await this.plugin.persistenceManager.setDefaultViewSettings({
              propertyDisplay2: value,
            });
          });
        new PropertySuggest(this.app, search.inputEl, allProperties);
      });

    new Setting(containerEl)
      .setName("Pair first and second properties")
      .setDesc("Display first two properties horizontally")
      .addToggle((toggle) =>
        toggle
          .setValue(defaultViewSettings.propertyGroup1SideBySide)
          .onChange(async (value) => {
            await this.plugin.persistenceManager.setDefaultViewSettings({
              propertyGroup1SideBySide: value,
            });
          }),
      );

    new Setting(containerEl)
      .setName("Third property")
      .setDesc("Property to show in third position")
      .addSearch((search) => {
        search
          .setPlaceholder("Search properties")
          .setValue(defaultViewSettings.propertyDisplay3)
          .onChange(async (value) => {
            await this.plugin.persistenceManager.setDefaultViewSettings({
              propertyDisplay3: value,
            });
          });
        new PropertySuggest(this.app, search.inputEl, allProperties);
      });

    new Setting(containerEl)
      .setName("Fourth property")
      .setDesc("Property to show in fourth position")
      .addSearch((search) => {
        search
          .setPlaceholder("Search properties")
          .setValue(defaultViewSettings.propertyDisplay4)
          .onChange(async (value) => {
            await this.plugin.persistenceManager.setDefaultViewSettings({
              propertyDisplay4: value,
            });
          });
        new PropertySuggest(this.app, search.inputEl, allProperties);
      });

    new Setting(containerEl)
      .setName("Pair third and fourth properties")
      .setDesc("Display third and fourth properties horizontally")
      .addToggle((toggle) =>
        toggle
          .setValue(defaultViewSettings.propertyGroup2SideBySide)
          .onChange(async (value) => {
            await this.plugin.persistenceManager.setDefaultViewSettings({
              propertyGroup2SideBySide: value,
            });
          }),
      );

    new Setting(containerEl)
      .setName("Title property")
      .setDesc("Default property to show as file title")
      .addText((text) =>
        text
          .setPlaceholder("Comma-separated if multiple")
          .setValue(defaultViewSettings.titleProperty)
          .onChange(async (value) => {
            await this.plugin.persistenceManager.setDefaultViewSettings({
              titleProperty: value,
            });
          }),
      );

    new Setting(containerEl)
      .setName("Show text preview")
      .setDesc("Show text preview by default")
      .addToggle((toggle) =>
        toggle
          .setValue(defaultViewSettings.showTextPreview)
          .onChange(async (value) => {
            await this.plugin.persistenceManager.setDefaultViewSettings({
              showTextPreview: value,
            });
          }),
      );

    new Setting(containerEl)
      .setName("Text preview property")
      .setDesc("Default property to show as text preview")
      .addText((text) =>
        text
          .setPlaceholder("Comma-separated if multiple")
          .setValue(defaultViewSettings.textPreviewProperty)
          .onChange(async (value) => {
            await this.plugin.persistenceManager.setDefaultViewSettings({
              textPreviewProperty: value,
            });
          }),
      );

    new Setting(containerEl)
      .setName("Use note content if text preview property unavailable")
      .setDesc(
        "Fall back to note content when text preview property is not set",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(defaultViewSettings.fallbackToContent)
          .onChange(async (value) => {
            await this.plugin.persistenceManager.setDefaultViewSettings({
              fallbackToContent: value,
            });
          }),
      );

    new Setting(containerEl)
      .setName("Format")
      .setDesc("Default image format for cards")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("thumbnail-left", "Thumbnail left")
          .addOption("thumbnail-right", "Thumbnail right")
          .addOption("cover-top", "Cover top")
          .addOption("cover-bottom", "Cover bottom")
          .addOption("cover-left", "Cover left")
          .addOption("cover-right", "Cover right")
          .addOption("none", "No image")
          .setValue(defaultViewSettings.imageFormat)
          .onChange(
            async (
              value:
                | "none"
                | "thumbnail-left"
                | "thumbnail-right"
                | "cover-top"
                | "cover-bottom"
                | "cover-left"
                | "cover-right",
            ) => {
              await this.plugin.persistenceManager.setDefaultViewSettings({
                imageFormat: value,
              });
            },
          ),
      );

    new Setting(containerEl)
      .setName("Cover fit mode")
      .setDesc("Default fit mode for cover images")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("crop", "Crop")
          .addOption("contain", "Contain")
          .setValue(defaultViewSettings.coverFitMode)
          .onChange(async (value: "crop" | "contain") => {
            await this.plugin.persistenceManager.setDefaultViewSettings({
              coverFitMode: value,
            });
          }),
      );

    new Setting(containerEl)
      .setName("Image property")
      .setDesc("Default property to use for card images")
      .addText((text) =>
        text
          .setPlaceholder("Comma-separated if multiple")
          .setValue(defaultViewSettings.imageProperty)
          .onChange(async (value) => {
            await this.plugin.persistenceManager.setDefaultViewSettings({
              imageProperty: value,
            });
          }),
      );

    new Setting(containerEl)
      .setName("Show image embeds")
      .setDesc(
        "Control when in-note image embeds are shown alongside image property values",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("always", "Always")
          .addOption("if-empty", "If property missing or empty")
          .addOption("never", "Never")
          .setValue(defaultViewSettings.fallbackToEmbeds)
          .onChange(async (value) => {
            await this.plugin.persistenceManager.setDefaultViewSettings({
              fallbackToEmbeds: value as "always" | "if-empty" | "never",
            });
          }),
      );

    new Setting(containerEl)
      .setName("List marker")
      .setDesc("Default marker style for list view")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("bullet", "Bullet")
          .addOption("number", "Number")
          .addOption("none", "None")
          .setValue(defaultViewSettings.listMarker)
          .onChange(async (value: string) => {
            await this.plugin.persistenceManager.setDefaultViewSettings({
              listMarker: value,
            });
          }),
      );

    new Setting(containerEl)
      .setName("View height")
      .setDesc(
        "Default maximum height of results area in pixels. Set to 0 for unlimited.",
      )
      .addText((text) =>
        text
          .setPlaceholder("500")
          .setValue(String(defaultViewSettings.queryHeight))
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num >= 0) {
              await this.plugin.persistenceManager.setDefaultViewSettings({
                queryHeight: num,
              });
            }
          }),
      );

    // Configuration section
    new Setting(containerEl).setName("Configuration").setHeading();

    new Setting(containerEl)
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

            if (selectedFile) {
              const reader = new FileReader();
              reader.readAsText(selectedFile, "UTF-8");
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
                          importedJson.globalSettings as Record<string, unknown>
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
            }
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
          exportLink.remove();
        }),
      );

    new Setting(containerEl)
      .setName("Clear settings")
      .setDesc("Reset all plugin settings to their default values.")
      .addButton((button) => {
        button
          .setButtonText("Clear")
          .setWarning()
          .onClick(() => {
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
      });

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
