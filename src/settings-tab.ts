import { App, PluginSettingTab, Setting, AbstractInputSuggest } from 'obsidian';
import type DynamicViewsPlugin from '../main';
import { getAllVaultProperties } from './utils/property';

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
		return this.properties.filter(prop =>
			prop.toLowerCase().includes(lowerQuery)
		);
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value || '(None)');
	}

	selectSuggestion(value: string): void {
		this.textInputEl.value = value;
		this.textInputEl.trigger('input');
		this.close();
	}
}

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
			.setName('Open random file in new pane')
			.setDesc('When opening a random file from Bases view, open it in a new pane instead of the same pane')
			.addToggle((toggle) =>
				toggle
					.setValue(settings.openRandomInNewPane)
					.onChange(async (value) => {
						await this.plugin.persistenceManager.setGlobalSettings({ openRandomInNewPane: value });
					})
			);

		new Setting(containerEl)
			.setName('Show "Shuffle" in ribbon')
			.setDesc('Display the shuffle button in the left sidebar ribbon. Reload plugin or Obsidian to apply.')
			.addToggle((toggle) =>
				toggle
					.setValue(settings.showShuffleInRibbon)
					.onChange(async (value) => {
						await this.plugin.persistenceManager.setGlobalSettings({ showShuffleInRibbon: value });
					})
			);

		new Setting(containerEl)
			.setName('Show "Open random note" in ribbon')
			.setDesc('Display the random note button in the left sidebar ribbon. Reload plugin or Obsidian to apply.')
			.addToggle((toggle) =>
				toggle
					.setValue(settings.showRandomInRibbon)
					.onChange(async (value) => {
						await this.plugin.persistenceManager.setGlobalSettings({ showRandomInRibbon: value });
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

		// Appearance section
		const appearanceHeading = new Setting(containerEl)
			.setName('Appearance')
			.setHeading();
		appearanceHeading.settingEl.addClass('dynamic-views-appearance-heading');

		const appearanceDesc = containerEl.createEl('p', { cls: 'setting-item-description' });
		appearanceDesc.appendText('Appearance settings can be configured via ');
		appearanceDesc.createEl('a', {
			text: 'Style Settings',
			href: 'obsidian://show-plugin?id=obsidian-style-settings'
		});
		appearanceDesc.appendText('.');

		const appearanceTip = containerEl.createEl('p', { cls: 'setting-item-description' });
		appearanceTip.appendText('Tip: Run ');
		appearanceTip.createEl('em').appendText('Show style settings view');
		appearanceTip.appendText(' command to open settings in a tab.');

		// Default settings for new views section
		new Setting(containerEl)
			.setName('Default settings for new views')
			.setHeading();

		const defaultViewSettings = this.plugin.persistenceManager.getDefaultViewSettings();

		// Get all vault properties for searchable dropdowns
		const allProperties = getAllVaultProperties(this.app);

		new Setting(containerEl)
			.setName('Metadata item one')
			.setDesc('Property to show in first metadata position')
			.addSearch((search) => {
				search
					.setPlaceholder('Search properties')
					.setValue(defaultViewSettings.metadataDisplay1)
					.onChange(async (value) => {
						await this.plugin.persistenceManager.setDefaultViewSettings({ metadataDisplay1: value });
					});
				new PropertySuggest(this.app, search.inputEl, allProperties);
			});

		new Setting(containerEl)
			.setName('Metadata item two')
			.setDesc('Property to show in second metadata position')
			.addSearch((search) => {
				search
					.setPlaceholder('Search properties')
					.setValue(defaultViewSettings.metadataDisplay2)
					.onChange(async (value) => {
						await this.plugin.persistenceManager.setDefaultViewSettings({ metadataDisplay2: value });
					});
				new PropertySuggest(this.app, search.inputEl, allProperties);
			});

		new Setting(containerEl)
			.setName('Show items one and two side-by-side')
			.setDesc('Display first two metadata items horizontally')
			.addToggle((toggle) =>
				toggle
					.setValue(defaultViewSettings.metadataLayout12SideBySide)
					.onChange(async (value) => {
						await this.plugin.persistenceManager.setDefaultViewSettings({ metadataLayout12SideBySide: value });
					})
			);

		new Setting(containerEl)
			.setName('Metadata item three')
			.setDesc('Property to show in third metadata position')
			.addSearch((search) => {
				search
					.setPlaceholder('Search properties')
					.setValue(defaultViewSettings.metadataDisplay3)
					.onChange(async (value) => {
						await this.plugin.persistenceManager.setDefaultViewSettings({ metadataDisplay3: value });
					});
				new PropertySuggest(this.app, search.inputEl, allProperties);
			});

		new Setting(containerEl)
			.setName('Metadata item four')
			.setDesc('Property to show in fourth metadata position')
			.addSearch((search) => {
				search
					.setPlaceholder('Search properties')
					.setValue(defaultViewSettings.metadataDisplay4)
					.onChange(async (value) => {
						await this.plugin.persistenceManager.setDefaultViewSettings({ metadataDisplay4: value });
					});
				new PropertySuggest(this.app, search.inputEl, allProperties);
			});

		new Setting(containerEl)
			.setName('Show items three and four side-by-side')
			.setDesc('Display third and fourth metadata items horizontally')
			.addToggle((toggle) =>
				toggle
					.setValue(defaultViewSettings.metadataLayout34SideBySide)
					.onChange(async (value) => {
						await this.plugin.persistenceManager.setDefaultViewSettings({ metadataLayout34SideBySide: value });
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
