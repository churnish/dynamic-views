import { Modal, App } from "obsidian";
import type DynamicViewsPlugin from '../main';

export class ClearSettingsModal extends Modal {
	plugin: DynamicViewsPlugin;
	onConfirm: () => Promise<void>;

	constructor(app: App, plugin: DynamicViewsPlugin, onConfirm: () => Promise<void>) {
		super(app);
		this.plugin = plugin;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		this.setTitle('Caution');
		contentEl.createEl("p", {
			text: 'This will reset all plugin settings to their default values. This action cannot be undone.'
		});

		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

		const cancelButton = buttonContainer.createEl("button", { text: 'Cancel' });
		cancelButton.onclick = () => this.close();

		const clearButton = buttonContainer.createEl("button", { text: 'Clear settings' });
		clearButton.addClass("mod-warning");
		clearButton.onclick = async () => {
			this.close();
			await this.onConfirm();
		};
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
