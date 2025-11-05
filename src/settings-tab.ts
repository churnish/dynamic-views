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
			.setName('Minimum card width')
			.setDesc('Minimum width of cards in pixels')
			.addSlider((slider) =>
				slider
					.setLimits(50, 800, 10)
					.setValue(settings.minCardWidth)
					.setDynamicTooltip()
					.onChange(async (value) => {
						await this.plugin.persistenceManager.setGlobalSettings({ minCardWidth: value });
					})
			);

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
			.setName('Minimum grid columns')
			.setDesc('Minimum number of columns in grid view')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('1', 'One')
					.addOption('2', 'Two')
					.setValue(String(settings.minGridColumns))
					.onChange(async (value: string) => {
						await this.plugin.persistenceManager.setGlobalSettings({ minGridColumns: Number(value) });
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

		// Default settings for new views section
		containerEl.createEl('h2', { text: 'Default settings for new views' });

		const defaultViewSettings = this.plugin.persistenceManager.getDefaultViewSettings();

		new Setting(containerEl)
			.setName('Metadata display (left)')
			.setDesc('Default metadata to show on left side of cards')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('timestamp', 'Timestamp')
					.addOption('path', 'File path')
					.addOption('tags', 'File tags')
					.addOption('none', 'None')
					.setValue(defaultViewSettings.metadataDisplayLeft)
					.onChange(async (value: 'none' | 'timestamp' | 'tags' | 'path') => {
						await this.plugin.persistenceManager.setDefaultViewSettings({ metadataDisplayLeft: value });
					})
			);

		new Setting(containerEl)
			.setName('Metadata display (right)')
			.setDesc('Default metadata to show on right side of cards')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('timestamp', 'Timestamp')
					.addOption('path', 'File path')
					.addOption('tags', 'File tags')
					.addOption('none', 'None')
					.setValue(defaultViewSettings.metadataDisplayRight)
					.onChange(async (value: 'none' | 'timestamp' | 'tags' | 'path') => {
						await this.plugin.persistenceManager.setDefaultViewSettings({ metadataDisplayRight: value });
					})
			);

		new Setting(containerEl)
			.setName('Title property')
			.setDesc('Default property to show as file title')
			.addText((text) =>
				text
					.setPlaceholder('Comma-separated if multiple')
					.setValue(defaultViewSettings.titleProperty)
					.onChange(async (value) => {
						await this.plugin.persistenceManager.setDefaultViewSettings({ titleProperty: value });
					})
			);

		new Setting(containerEl)
			.setName('Show text preview')
			.setDesc('Show text preview by default')
			.addToggle((toggle) =>
				toggle
					.setValue(defaultViewSettings.showTextPreview)
					.onChange(async (value) => {
						await this.plugin.persistenceManager.setDefaultViewSettings({ showTextPreview: value });
					})
			);

		new Setting(containerEl)
			.setName('Text preview property')
			.setDesc('Default property to show as text preview')
			.addText((text) =>
				text
					.setPlaceholder('Comma-separated if multiple')
					.setValue(defaultViewSettings.descriptionProperty)
					.onChange(async (value) => {
						await this.plugin.persistenceManager.setDefaultViewSettings({ descriptionProperty: value });
					})
			);

		new Setting(containerEl)
			.setName('Use note content if text preview property unavailable')
			.setDesc('Fall back to note content when text preview property is not set')
			.addToggle((toggle) =>
				toggle
					.setValue(defaultViewSettings.fallbackToContent)
					.onChange(async (value) => {
						await this.plugin.persistenceManager.setDefaultViewSettings({ fallbackToContent: value });
					})
			);

		new Setting(containerEl)
			.setName('Show thumbnails')
			.setDesc('Show thumbnails by default')
			.addToggle((toggle) =>
				toggle
					.setValue(defaultViewSettings.showThumbnails)
					.onChange(async (value) => {
						await this.plugin.persistenceManager.setDefaultViewSettings({ showThumbnails: value });
					})
			);

		new Setting(containerEl)
			.setName('Image property')
			.setDesc('Default property to show as thumbnail')
			.addText((text) =>
				text
					.setPlaceholder('Comma-separated if multiple')
					.setValue(defaultViewSettings.imageProperty)
					.onChange(async (value) => {
						await this.plugin.persistenceManager.setDefaultViewSettings({ imageProperty: value });
					})
			);

		new Setting(containerEl)
			.setName('Use in-note images if image property unavailable')
			.setDesc('Fall back to image embeds from note content')
			.addToggle((toggle) =>
				toggle
					.setValue(defaultViewSettings.fallbackToEmbeds)
					.onChange(async (value) => {
						await this.plugin.persistenceManager.setDefaultViewSettings({ fallbackToEmbeds: value });
					})
			);

		new Setting(containerEl)
			.setName('List marker')
			.setDesc('Default marker style for list view')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('bullet', 'Bullet')
					.addOption('number', 'Number')
					.addOption('none', 'None')
					.setValue(defaultViewSettings.listMarker)
					.onChange(async (value: string) => {
						await this.plugin.persistenceManager.setDefaultViewSettings({ listMarker: value });
					})
			);

		new Setting(containerEl)
			.setName('View height')
			.setDesc('Default maximum height of results area in pixels. Set to 0 for unlimited.')
			.addText((text) =>
				text
					.setPlaceholder('500')
					.setValue(String(defaultViewSettings.queryHeight))
					.onChange(async (value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num >= 0) {
							await this.plugin.persistenceManager.setDefaultViewSettings({ queryHeight: num });
						}
					})
			);
	}
}
