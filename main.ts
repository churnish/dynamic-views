import { Plugin, Notice, Editor, MarkdownView, QueryController } from 'obsidian';
import { PersistenceManager } from './src/persistence';
import { View } from './src/components/view';
import { setDatacorePreact } from './src/jsx-runtime';
import { getAvailablePath } from './src/utils/file';
import './src/jsx-runtime'; // Ensure h and Fragment are globally available
import { DynamicViewsCardView, cardViewOptions } from './src/bases/card-view';
import { DynamicViewsMasonryView, masonryViewOptions } from './src/bases/masonry-view';
import { DynamicViewsSettingTab } from './src/settings-tab';
import { setPluginInstance } from './src/shared/settings-schema';
import type { DatacoreAPI } from './src/types/datacore';
import { openRandomFile, toggleShuffleActiveView } from './src/utils/randomize';

export default class DynamicViewsPlugin extends Plugin {
	persistenceManager: PersistenceManager;

	// Helper function for datacorejsx blocks
	createView(dc: DatacoreAPI, userQuery?: string) {
		// Initialize jsxRuntime with Datacore's Preact BEFORE returning component
		// This allows all compiled JSX in our components to use Datacore's h function
		setDatacorePreact(dc.preact);

		// Return arrow function component for Datacore to render (preserves 'this' context)
		return (): JSX.Element => {
			// View and all child components now use our h() proxy which delegates to dc.preact.h
			return View({
				plugin: this,
				app: this.app,
				dc,
				USER_QUERY: userQuery || '@page'
			});
		};
	}

	async onload() {
		this.persistenceManager = new PersistenceManager(this);
		await this.persistenceManager.load();

		// Set plugin instance for Bases view options to access template settings
		setPluginInstance(this);

		// Notify Style Settings to parse our CSS
		this.app.workspace.trigger("parse-style-settings");

		// Register settings tab
		this.addSettingTab(new DynamicViewsSettingTab(this.app, this));

		// Register Bases views
		// Note: Named "Grid" to differentiate from built-in Bases "Cards" view
		this.registerBasesView('dynamic-views-card', {
			name: 'Grid',
			icon: 'lucide-grid-2x-2',
			factory: (controller: QueryController, containerEl: HTMLElement) => {
				return new DynamicViewsCardView(controller, containerEl, this);
			},
			options: cardViewOptions,
		});

		this.registerBasesView('dynamic-views-masonry', {
			name: 'Masonry',
			icon: 'panels-right-bottom',
			factory: (controller: QueryController, containerEl: HTMLElement) => {
				return new DynamicViewsMasonryView(controller, containerEl, this);
			},
			options: masonryViewOptions,
		});

		this.addCommand({
			id: 'create-dynamic-view',
			name: 'Create note with query',
			callback: async () => {
				await this.createExplorerFile();
			}
		});

		this.addCommand({
			id: 'insert-dynamic-view-at-cursor',
			name: 'Insert query at cursor position',
			editorCheckCallback: (checking: boolean, editor: Editor, view: MarkdownView) => {
				const cursor = editor.getCursor();
				const lineContent = editor.getLine(cursor.line);
				const isEmptyLine = lineContent.trim().length === 0;

				if (isEmptyLine) {
					if (!checking) {
						const template = this.getQueryTemplate();
						editor.replaceRange(template, cursor);
					}
					return true;
				}

				return false;
			}
		});

		// Add ribbon icons for Random and Shuffle
		this.addRibbonIcon('dices', 'Open random file from Bases view', async () => {
			const openInNewPane = this.persistenceManager.getGlobalSettings().openRandomInNewPane;
			await openRandomFile(this.app, openInNewPane);
		});

		this.addRibbonIcon('shuffle', 'Shuffle Bases view', () => {
			toggleShuffleActiveView(this.app);
		});

		// Add commands for Random and Shuffle
		this.addCommand({
			id: 'random-file-from-bases',
			name: 'Open random file from Bases view',
			callback: async () => {
				const openInNewPane = this.persistenceManager.getGlobalSettings().openRandomInNewPane;
				await openRandomFile(this.app, openInNewPane);
			}
		});

		this.addCommand({
			id: 'shuffle-bases-view',
			name: 'Shuffle Bases view',
			callback: () => {
				toggleShuffleActiveView(this.app);
			}
		});
	}

	getQueryTemplate(): string {
		return `\`\`\`datacorejsx
const USER_QUERY = \`
// ––––– DQL QUERY START –––––

// ––––– DQL QUERY END –––––
\`;

const dv = app.plugins.plugins['dynamic-views'];
return dv.createView(dc, USER_QUERY);
\`\`\`\n`;
	}

	async createExplorerFile() {
		try {
			const activeFile = this.app.workspace.getActiveFile();
			const folderPath = activeFile?.parent?.path
				?? this.app.fileManager.getNewFileParent('').path;
			const filePath = getAvailablePath(this.app, folderPath, 'Dynamic view');
			const template = this.getQueryTemplate();

			await this.app.vault.create(filePath, template);

			const file = this.app.vault.getFileByPath(filePath);
			if (file) {
				const leaf = this.app.workspace.getLeaf('tab');
				await leaf.openFile(file);
				const view = leaf.view;
				if (view instanceof MarkdownView) {
					const viewState = view.getState();
					viewState.mode = 'preview';
					await view.setState(viewState, { history: false });
				}
			}
		} catch (error) {
			new Notice(`Failed to create file. Check console for details.`);
			console.error('File creation failed:', error);
		}
	}

	onunload() {
	}
}
