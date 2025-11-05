import { Plugin, Notice, Editor, MarkdownView } from 'obsidian';
import { PersistenceManager } from './src/persistence';
import { View } from './src/components/view';
import { setDatacorePreact } from './src/jsx-runtime';
import { getAvailablePath } from './src/utils/file';
import './src/jsx-runtime'; // Ensure h and Fragment are globally available
import { DynamicViewsCardView, cardViewOptions } from './src/bases/card-view';
import { DynamicViewsMasonryView, masonryViewOptions } from './src/bases/masonry-view';
import { DynamicViewsSettingTab } from './src/settings-tab';
import { setPluginInstance } from './src/shared/settings-schema';

export default class DynamicViewsPlugin extends Plugin {
	persistenceManager: PersistenceManager;

	// Helper function for datacorejsx blocks
	createView(dc: any, userQuery?: string, userSettings?: any) {
		const plugin = this;
		const app = this.app;

		// Initialize jsxRuntime with Datacore's Preact BEFORE returning component
		// This allows all compiled JSX in our components to use Datacore's h function
		setDatacorePreact(dc.preact);

		// Return function component for Datacore to render
		return function DynamicView() {
			// View and all child components now use our h() proxy which delegates to dc.preact.h
			return View({
				plugin,
				app,
				dc,
				USER_QUERY: userQuery || '@page',
				USER_SETTINGS: userSettings || {}
			});
		};
	}

	async onload() {
		this.persistenceManager = new PersistenceManager(this);
		await this.persistenceManager.load();

		// Set plugin instance for Bases view options to access template settings
		setPluginInstance(this);

		// Register settings tab
		this.addSettingTab(new DynamicViewsSettingTab(this.app, this));

		// Register Bases views
		// Note: Named "Grid" to differentiate from built-in Bases "Cards" view
		this.registerBasesView('dynamic-views-card', {
			name: 'Grid',
			icon: 'rows-2',
			factory: (controller: any, containerEl: HTMLElement) => {
				return new DynamicViewsCardView(controller, containerEl, this);
			},
			options: cardViewOptions,
		});

		this.registerBasesView('dynamic-views-masonry', {
			name: 'Masonry',
			icon: 'panels-right-bottom',
			factory: (controller: any, containerEl: HTMLElement) => {
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
