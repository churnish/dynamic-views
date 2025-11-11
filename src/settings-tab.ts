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

	/**
	 * Trim whitespace from all text field settings
	 */
	private async trimTextFieldSettings(): Promise<void> {
		const globalSettings = this.plugin.persistenceManager.getGlobalSettings();
		const defaultViewSettings = this.plugin.persistenceManager.getDefaultViewSettings();

		// Trim global settings
		const trimmedGlobalSettings: Partial<typeof globalSettings> = {};
		let hasGlobalChanges = false;

		if (globalSettings.timestampFormat.trim() !== globalSettings.timestampFormat) {
			trimmedGlobalSettings.timestampFormat = globalSettings.timestampFormat.trim();
			hasGlobalChanges = true;
		}
		if (globalSettings.createdTimeProperty.trim() !== globalSettings.createdTimeProperty) {
			trimmedGlobalSettings.createdTimeProperty = globalSettings.createdTimeProperty.trim();
			hasGlobalChanges = true;
		}
		if (globalSettings.modifiedTimeProperty.trim() !== globalSettings.modifiedTimeProperty) {
			trimmedGlobalSettings.modifiedTimeProperty = globalSettings.modifiedTimeProperty.trim();
			hasGlobalChanges = true;
		}

		// Trim default view settings
		const trimmedDefaultViewSettings: Partial<typeof defaultViewSettings> = {};
		let hasDefaultViewChanges = false;

		if (defaultViewSettings.titleProperty.trim() !== defaultViewSettings.titleProperty) {
			trimmedDefaultViewSettings.titleProperty = defaultViewSettings.titleProperty.trim();
			hasDefaultViewChanges = true;
		}
		if (defaultViewSettings.descriptionProperty.trim() !== defaultViewSettings.descriptionProperty) {
			trimmedDefaultViewSettings.descriptionProperty = defaultViewSettings.descriptionProperty.trim();
			hasDefaultViewChanges = true;
		}
		if (defaultViewSettings.imageProperty.trim() !== defaultViewSettings.imageProperty) {
			trimmedDefaultViewSettings.imageProperty = defaultViewSettings.imageProperty.trim();
			hasDefaultViewChanges = true;
		}

		// Save if changes detected
		if (hasGlobalChanges) {
			await this.plugin.persistenceManager.setGlobalSettings(trimmedGlobalSettings);
		}
		if (hasDefaultViewChanges) {
			await this.plugin.persistenceManager.setDefaultViewSettings(trimmedDefaultViewSettings);
		}
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		// Trim whitespace from text fields on open
		void this.trimTextFieldSettings();

		const settings = this.plugin.persistenceManager.getGlobalSettings();

		new Setting(containerEl)
			.setName('Open file action')
			.setDesc('How files should open when clicked')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('card', 'Press on title or card')
					.addOption('title', 'Press on title')
					.setValue(settings.openFileAction)
					.onChange(async (value: 'card' | 'title') => {
						await this.plugin.persistenceManager.setGlobalSettings({ openFileAction: value });
						// Update body classes for CSS and MutationObserver detection
						document.body.classList.remove('dynamic-views-open-on-card', 'dynamic-views-open-on-title');
						document.body.classList.add(`dynamic-views-open-on-${value}`);
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
			.setName('Expand images on click')
			.setDesc('Click and hold on images (thumbnails and covers) to view full-screen. Desktop only.')
			.addToggle((toggle) =>
				toggle
					.setValue(settings.expandImagesOnClick)
					.onChange(async (value) => {
						await this.plugin.persistenceManager.setGlobalSettings({ expandImagesOnClick: value });
						// Update body class for CSS
						if (value) {
							document.body.classList.add('dynamic-views-thumbnail-expand-click');
						} else {
							document.body.classList.remove('dynamic-views-thumbnail-expand-click');
						}
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
			.setName('Omit first line in text preview')
			.setDesc('Always skip first line in text previews (in addition to automatic omission when first line matches title/filename)')
			.addToggle((toggle) =>
				toggle
					.setValue(settings.omitFirstLine)
					.onChange(async (value) => {
						await this.plugin.persistenceManager.setGlobalSettings({ omitFirstLine: value });
					})
			);

		const timestampFormatSetting = new Setting(containerEl)
			.setName('Timestamp format')
			.addText((text) =>
				text
					.setPlaceholder('YYYY-MM-DD HH:mm')
					.setValue(settings.timestampFormat)
					.onChange(async (value) => {
						await this.plugin.persistenceManager.setGlobalSettings({ timestampFormat: value });
					})
			);

		const timestampFormatDesc = timestampFormatSetting.descEl;
		timestampFormatDesc.createEl('a', {
			text: 'Moment.js',
			href: 'https://momentjs.com/docs/#/displaying/format/'
		});
		timestampFormatDesc.appendText(' format for displaying date properties.');

		// Smart timestamp section
		const smartTimestampSetting = new Setting(containerEl)
			.setName('Smart timestamp')
			.addToggle((toggle) =>
				toggle
					.setValue(settings.smartTimestamp)
					.onChange(async (value) => {
						await this.plugin.persistenceManager.setGlobalSettings({ smartTimestamp: value });
						if (value) {
							conditionalText.show();
							smartTimestampSubSettings.show();
						} else {
							conditionalText.hide();
							smartTimestampSubSettings.hide();
						}
					})
			);

		const smartTimestampDesc = smartTimestampSetting.descEl;
		smartTimestampDesc.createSpan({
			text: 'Automatically show the created or modified time when sorting by that property. '
		});
		const conditionalText = smartTimestampDesc.createSpan({
			text: 'One of the properties below must be shown in one of the property fields below.'
		});

		// Create container for child settings with indentation
		const smartTimestampSubSettings = containerEl.createDiv('smart-timestamp-sub-settings');

		// Track text field values for conditional fallback visibility
		let createdTimeValue = settings.createdTimeProperty;
		let modifiedTimeValue = settings.modifiedTimeProperty;
		// eslint-disable-next-line prefer-const
		let fallbackSetting: Setting;

		// Helper to update fallback setting visibility
		const updateFallbackVisibility = () => {
			const hasValue = createdTimeValue.trim() !== '' || modifiedTimeValue.trim() !== '';
			if (hasValue) {
				fallbackSetting.settingEl.show();
			} else {
				fallbackSetting.settingEl.hide();
			}
		};

		new Setting(smartTimestampSubSettings)
			.setName('Created time property')
			.setDesc('Leave blank to use file metadata.')
			.addText((text) =>
				text
					.setPlaceholder('created')
					.setValue(settings.createdTimeProperty)
					.onChange(async (value) => {
						createdTimeValue = value;
						await this.plugin.persistenceManager.setGlobalSettings({ createdTimeProperty: value });
						updateFallbackVisibility();
					})
			);

		new Setting(smartTimestampSubSettings)
			.setName('Modified time property')
			.setDesc('Leave blank to use file metadata.')
			.addText((text) =>
				text
					.setPlaceholder('modified')
					.setValue(settings.modifiedTimeProperty)
					.onChange(async (value) => {
						modifiedTimeValue = value;
						await this.plugin.persistenceManager.setGlobalSettings({ modifiedTimeProperty: value });
						updateFallbackVisibility();
					})
			);

		fallbackSetting = new Setting(smartTimestampSubSettings)
			.setName('Fall back to file metadata')
			.setDesc('Use file metadata if a property above is missing or empty.')
			.addToggle((toggle) =>
				toggle
					.setValue(settings.fallbackToFileMetadata)
					.onChange(async (value) => {
						await this.plugin.persistenceManager.setGlobalSettings({ fallbackToFileMetadata: value });
					})
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
			.setName('First property')
			.setDesc('Property to show in first position')
			.addSearch((search) => {
				search
					.setPlaceholder('Search properties')
					.setValue(defaultViewSettings.propertyDisplay1)
					.onChange(async (value) => {
						await this.plugin.persistenceManager.setDefaultViewSettings({ propertyDisplay1: value });
					});
				new PropertySuggest(this.app, search.inputEl, allProperties);
			});

		new Setting(containerEl)
			.setName('Second property')
			.setDesc('Property to show in second position')
			.addSearch((search) => {
				search
					.setPlaceholder('Search properties')
					.setValue(defaultViewSettings.propertyDisplay2)
					.onChange(async (value) => {
						await this.plugin.persistenceManager.setDefaultViewSettings({ propertyDisplay2: value });
					});
				new PropertySuggest(this.app, search.inputEl, allProperties);
			});

		new Setting(containerEl)
			.setName('Show first and second properties side-by-side')
			.setDesc('Display first two properties horizontally')
			.addToggle((toggle) =>
				toggle
					.setValue(defaultViewSettings.propertyLayout12SideBySide)
					.onChange(async (value) => {
						await this.plugin.persistenceManager.setDefaultViewSettings({ propertyLayout12SideBySide: value });
					})
			);

		new Setting(containerEl)
			.setName('Third property')
			.setDesc('Property to show in third position')
			.addSearch((search) => {
				search
					.setPlaceholder('Search properties')
					.setValue(defaultViewSettings.propertyDisplay3)
					.onChange(async (value) => {
						await this.plugin.persistenceManager.setDefaultViewSettings({ propertyDisplay3: value });
					});
				new PropertySuggest(this.app, search.inputEl, allProperties);
			});

		new Setting(containerEl)
			.setName('Fourth property')
			.setDesc('Property to show in fourth position')
			.addSearch((search) => {
				search
					.setPlaceholder('Search properties')
					.setValue(defaultViewSettings.propertyDisplay4)
					.onChange(async (value) => {
						await this.plugin.persistenceManager.setDefaultViewSettings({ propertyDisplay4: value });
					});
				new PropertySuggest(this.app, search.inputEl, allProperties);
			});

		new Setting(containerEl)
			.setName('Show third and fourth properties side-by-side')
			.setDesc('Display third and fourth properties horizontally')
			.addToggle((toggle) =>
				toggle
					.setValue(defaultViewSettings.propertyLayout34SideBySide)
					.onChange(async (value) => {
						await this.plugin.persistenceManager.setDefaultViewSettings({ propertyLayout34SideBySide: value });
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
			.setName('Card image')
			.setDesc('Default image format for cards')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('none', 'No image')
					.addOption('thumbnail', 'Thumbnail')
					.addOption('cover', 'Cover')
					.setValue(defaultViewSettings.imageFormat)
					.onChange(async (value: 'none' | 'thumbnail' | 'cover') => {
						await this.plugin.persistenceManager.setDefaultViewSettings({ imageFormat: value });
					})
			);

		new Setting(containerEl)
			.setName('Image property')
			.setDesc('Default property to use for card images')
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

	hide(): void {
		// Trim whitespace from text fields on close
		void this.trimTextFieldSettings();
	}
}
