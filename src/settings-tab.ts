import { App, PluginSettingTab, Setting } from 'obsidian';
import type DynamicViewsPlugin from '../main';

export class DynamicViewsSettingTab extends PluginSettingTab {
	plugin: DynamicViewsPlugin;

	constructor(app: App, plugin: DynamicViewsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		const settings = this.plugin.persistenceManager.getGlobalSettings();

		new Setting(containerEl)
			.setName('Open file action')
			.setDesc('How files should open when clicked')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('card', 'Press on card')
					.addOption('title', 'Press on title')
					.setValue(settings.openFileAction)
					.onChange(async (value: 'card' | 'title') => {
						await this.plugin.persistenceManager.setGlobalSettings({ openFileAction: value });
					})
			);

		new Setting(containerEl)
			.setName('Thumbnail cache size')
			.setDesc('Size of cached thumbnails (affects performance and quality)')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('minimal', 'Minimal')
					.addOption('small', 'Small')
					.addOption('balanced', 'Balanced')
					.addOption('large', 'Large')
					.addOption('unlimited', 'Unlimited')
					.setValue(settings.thumbnailCacheSize)
					.onChange(async (value: 'minimal' | 'small' | 'balanced' | 'large' | 'unlimited') => {
						await this.plugin.persistenceManager.setGlobalSettings({ thumbnailCacheSize: value });
					})
			);

		new Setting(containerEl)
			.setName('Minimum masonry columns')
			.setDesc('Minimum number of columns in masonry view')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('1', 'One')
					.addOption('2', 'Two')
					.setValue(String(settings.minMasonryColumns))
					.onChange(async (value: string) => {
						await this.plugin.persistenceManager.setGlobalSettings({ minMasonryColumns: Number(value) });
					})
			);

		new Setting(containerEl)
			.setName('Card background')
			.setDesc('Card background appearance')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('tinted', 'Tinted')
					.addOption('transparent', 'Transparent')
					.setValue(settings.addCardBackground)
					.onChange(async (value: 'tinted' | 'transparent') => {
						await this.plugin.persistenceManager.setGlobalSettings({ addCardBackground: value });
					})
			);

		new Setting(containerEl)
			.setName('Thumbnail position')
			.setDesc('Position of thumbnail relative to text preview')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('left', 'Left')
					.addOption('right', 'Right')
					.setValue(settings.thumbnailPosition)
					.onChange(async (value: 'left' | 'right') => {
						await this.plugin.persistenceManager.setGlobalSettings({ thumbnailPosition: value });
					})
			);

		new Setting(containerEl)
			.setName('Show timestamp icon')
			.setDesc('Show icon to differentiate between modified and created timestamps')
			.addToggle((toggle) =>
				toggle
					.setValue(settings.showTimestampIcon)
					.onChange(async (value) => {
						await this.plugin.persistenceManager.setGlobalSettings({ showTimestampIcon: value });
					})
			);

		new Setting(containerEl)
			.setName('Timestamp reflects')
			.setDesc('Which timestamp to display in card metadata')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('mtime', 'Modified time')
					.addOption('ctime', 'Created time')
					.addOption('sort-based', 'Sort method')
					.setValue(settings.timestampDisplay)
					.onChange(async (value: 'ctime' | 'mtime' | 'sort-based') => {
						await this.plugin.persistenceManager.setGlobalSettings({ timestampDisplay: value });
					})
			);

		new Setting(containerEl)
			.setName('Omit first line in text preview')
			.setDesc('Always skip first line in text previews (in addition to automatic omission when first line matches title/filename)')
			.addToggle((toggle) =>
				toggle
					.setValue(settings.omitFirstLine)
					.onChange(async (value) => {
						await this.plugin.persistenceManager.setGlobalSettings({ omitFirstLine: value });
					})
			);

		new Setting(containerEl)
			.setName('Date created property')
			.setDesc('Set property to show as created timestamp. Will use file created time if unavailable. Must be a date or datetime property.')
			.addText((text) =>
				text
					.setPlaceholder('Comma-separated if multiple')
					.setValue(settings.createdProperty)
					.onChange(async (value) => {
						await this.plugin.persistenceManager.setGlobalSettings({ createdProperty: value });
					})
			);

		new Setting(containerEl)
			.setName('Date modified property')
			.setDesc('Set property to show as modified timestamp. Will use file modified time if unavailable. Must be a date or datetime property.')
			.addText((text) =>
				text
					.setPlaceholder('Comma-separated if multiple')
					.setValue(settings.modifiedProperty)
					.onChange(async (value) => {
						await this.plugin.persistenceManager.setGlobalSettings({ modifiedProperty: value });
					})
			);
	}
}
