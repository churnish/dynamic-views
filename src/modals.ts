import { Modal, App } from "obsidian";
import type DynamicViews from "../main";

export class ClearSettingsModal extends Modal {
  plugin: DynamicViews;
  onConfirm: () => Promise<void>;

  constructor(app: App, plugin: DynamicViews, onConfirm: () => Promise<void>) {
    super(app);
    this.plugin = plugin;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    this.setTitle("Caution");
    contentEl.createEl("p", {
      text: "This will reset all plugin settings to their default values. This action cannot be undone.",
      cls: "mod-warning",
    });

    const buttonContainer = contentEl.createDiv({
      cls: "modal-button-container",
    });

    const clearButton = buttonContainer.createEl("button", {
      text: "Clear",
    });
    clearButton.addClass("mod-warning");
    clearButton.onclick = async () => {
      this.close();
      await this.onConfirm();
    };

    const cancelButton = buttonContainer.createEl("button", { text: "Cancel" });
    cancelButton.onclick = () => this.close();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
