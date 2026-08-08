import {
  Plugin,
  Notice,
  QueryController,
  TFile,
  TFolder,
  PaneType,
  type MenuItem,
} from 'obsidian';
import { PersistenceManager } from './src/persistence';
import { getAvailableBasePath } from './src/core/file';
import {
  DynamicViewsGridView,
  GRID_VIEW_TYPE,
  cardViewOptions,
} from './src/bases/grid-view';
import {
  DynamicViewsMasonryView,
  MASONRY_VIEW_TYPE,
  masonryViewOptions,
} from './src/bases/masonry-view';
import { DynamicViewsSettingTab } from './src/plugin-settings';
import {
  initExternalBlobCache,
  cleanupExternalBlobCache,
  setDocumentProvider,
} from './src/core/slideshow';
import {
  openRandomFile,
  toggleShuffleActiveView,
  getPaneType,
} from './src/core/randomize';
import {
  clearInFlightLoads,
  invalidateContentCacheForPath,
} from './src/core/content-loader';
import { installDropTextPatch } from './src/core/drag';
import { invalidateCacheForFile } from './src/core/image-loader';
import { getNotebookNavigatorAPI } from './src/core/notebook-navigator';
import type { OwnerWindow } from './src/utils/owner-window';

/** Undocumented Bases view shape — used only by __slowMount debug utility */
interface DebugBasesView {
  controller?: {
    view?: {
      virtualItems?: unknown[];
      debugSlowMount?: boolean;
    };
  };
}

// Plugin/feature names (proper nouns, not subject to sentence case)
const GRID = 'Grid';
const MASONRY = 'Masonry';
const NEW_GRID_BASE = 'New Grid base';
const NEW_MASONRY_BASE = 'New Masonry base';

export default class DynamicViews extends Plugin {
  persistenceManager: PersistenceManager;
  /** Tracks which NN API instance we registered menus with */
  private nnRegisteredApi: unknown = null;

  async onload() {
    initExternalBlobCache();
    setDocumentProvider(() => [document, ...this.getAllPopoutDocuments()]);
    this.register(installDropTextPatch(this.app));
    this.persistenceManager = new PersistenceManager(this);
    await this.persistenceManager.load();

    // Set initial body classes for settings
    const settings = this.persistenceManager.getPluginSettings();
    document.body.classList.add(
      `dynamic-views-open-on-${settings.openFileAction}`
    );

    // Register settings tab
    this.addSettingTab(new DynamicViewsSettingTab(this.app, this));

    // Register Bases views
    // Note: Named "Grid" to differentiate from built-in Bases "Cards" view
    this.registerBasesView('dynamic-views-grid', {
      name: 'Grid',
      icon: 'lucide-grid-2x-2',
      factory: (controller: QueryController, scrollEl: HTMLElement) =>
        new DynamicViewsGridView(controller, scrollEl),
      options: cardViewOptions,
    });

    this.registerBasesView('dynamic-views-masonry', {
      name: 'Masonry',
      icon: 'panels-right-bottom',
      factory: (controller: QueryController, scrollEl: HTMLElement) =>
        new DynamicViewsMasonryView(controller, scrollEl),
      options: masonryViewOptions,
    });

    // Notify Style Settings to parse our CSS (applies stored class-select values).
    this.app.workspace.trigger('parse-style-settings');

    // TEMP DEBUG — kept intentionally for ongoing mount ordering work.
    // Console: __slowMount() / __slowMount(false). Auditors: ignore.
    this.app.__slowMount = (on = true) => {
      let count = 0;
      for (const leaf of this.app.workspace.getLeavesOfType('bases')) {
        const view = (leaf.view as unknown as DebugBasesView).controller?.view;
        if (view && view.virtualItems && view.virtualItems.length > 0) {
          view.debugSlowMount = on;
          count++;
        }
      }
      return count
        ? `${on ? 'ON' : 'OFF'} for ${count} view(s)`
        : 'No views found';
    };

    // Add ribbon icons
    this.addRibbonIcon(
      'lucide-grid-2x-2',
      `Create new ${GRID} base`,
      async (evt: MouseEvent) => {
        await this.createBaseFile(
          'dynamic-views-grid',
          'Grid',
          getPaneType(evt, false)
        );
      }
    );

    this.addRibbonIcon(
      'panels-right-bottom',
      `Create new ${MASONRY} base`,
      async (evt: MouseEvent) => {
        await this.createBaseFile(
          'dynamic-views-masonry',
          'Masonry',
          getPaneType(evt, false)
        );
      }
    );

    this.addRibbonIcon('shuffle', 'Shuffle base', () => {
      this.closeAllZoomedImages();
      toggleShuffleActiveView(this.app);
    });

    this.addRibbonIcon(
      'dices',
      'Open random file from base',
      async (evt: MouseEvent) => {
        this.closeAllZoomedImages();
        const openInNewTab =
          this.persistenceManager.getPluginSettings().openRandomInNewTab;
        await openRandomFile(this.app, getPaneType(evt, openInNewTab));
      }
    );

    // Add commands for Random and Shuffle
    this.addCommand({
      id: 'open-random-file',
      name: 'Open random file from base',
      icon: 'dices',
      callback: async () => {
        this.closeAllZoomedImages();
        const openInNewTab =
          this.persistenceManager.getPluginSettings().openRandomInNewTab;
        await openRandomFile(this.app, openInNewTab);
      },
    });

    this.addCommand({
      id: 'shuffle-base',
      name: 'Shuffle base',
      icon: 'shuffle',
      callback: () => {
        this.closeAllZoomedImages();
        toggleShuffleActiveView(this.app);
      },
    });

    this.addCommand({
      id: 'fold-groups',
      name: 'Fold all groups',
      icon: 'lucide-minimize-2',
      checkCallback: (checking) => {
        const view = this.getActiveDynamicViewsGroupedView();
        if (!view) return false;
        if (!checking) view.foldAllGroups();
        return true;
      },
    });

    this.addCommand({
      id: 'unfold-groups',
      name: 'Unfold all groups',
      icon: 'lucide-maximize-2',
      checkCallback: (checking) => {
        const view = this.getActiveDynamicViewsGroupedView();
        if (!view) return false;
        if (!checking) view.unfoldAllGroups();
        return true;
      },
    });

    this.addCommand({
      id: 'create-grid-base',
      name: `Create new ${GRID} base`,
      icon: 'lucide-grid-2x-2',
      callback: async () => {
        await this.createBaseFile('dynamic-views-grid', 'Grid', false);
      },
    });

    this.addCommand({
      id: 'create-masonry-base',
      name: `Create new ${MASONRY} base`,
      icon: 'panels-right-bottom',
      callback: async () => {
        await this.createBaseFile('dynamic-views-masonry', 'Masonry', false);
      },
    });

    // Invalidate image metadata cache when vault files are modified (#17)
    // Only invalidate for image files to avoid unnecessary cache clears
    const IMAGE_EXTENSIONS = new Set([
      'png',
      'jpg',
      'jpeg',
      'gif',
      'webp',
      'svg',
      'bmp',
      'ico',
    ]);
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile) {
          invalidateContentCacheForPath(file.path);
          const ext = file.extension.toLowerCase();
          if (IMAGE_EXTENSIONS.has(ext)) {
            invalidateCacheForFile(file.path);
          }
        }
      })
    );

    // Handle editor-drop events for plugin cards
    this.registerEvent(
      this.app.workspace.on('editor-drop', (evt, editor, view) => {
        // Another handler already claimed this drop — don't double-handle it.
        if (evt.defaultPrevented) return;

        const data = evt.dataTransfer?.getData('text/plain');

        // Check if it's an obsidian:// URI from our plugin
        if (data && data.startsWith('obsidian://open?vault=')) {
          // Extract file path from URI
          const url = new URL(data);
          const filePath = url.searchParams.get('file');

          if (filePath) {
            // Decode path and get TFile object
            const decodedPath = decodeURIComponent(filePath);
            const file = this.app.vault.getAbstractFileByPath(
              decodedPath + '.md'
            );

            if (file instanceof TFile) {
              // Generate link respecting user's link format settings
              const sourcePath = view.file?.path || '';
              const link = this.app.fileManager.generateMarkdownLink(
                file,
                sourcePath
              );

              // Insert link at cursor position
              editor.replaceSelection(link);

              // Prevent default behavior
              evt.preventDefault();
            }
          }
        }
      })
    );

    // Add "New Grid/Masonry base" to folder context menus
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (!(file instanceof TFolder)) return;
        if (!this.persistenceManager.getPluginSettings().folderCommands) return;

        menu.addItem((item) =>
          item
            .setTitle(NEW_GRID_BASE)
            .setIcon('lucide-grid-2x-2')
            .setSection('action-primary')
            .onClick(async () => {
              await this.createBaseFile(
                'dynamic-views-grid',
                'Grid',
                false,
                file.path
              );
            })
        );

        menu.addItem((item) =>
          item
            .setTitle(NEW_MASONRY_BASE)
            .setIcon('panels-right-bottom')
            .setSection('action-primary')
            .onClick(async () => {
              await this.createBaseFile(
                'dynamic-views-masonry',
                'Masonry',
                false,
                file.path
              );
            })
        );
      })
    );

    // Register folder context menus in Notebook Navigator.
    // NN's async onload may not finish before onLayoutReady — retry briefly.
    // registerInterval auto-clears on plugin unload.
    this.app.workspace.onLayoutReady(() => {
      if (!this.registerNotebookNavigatorMenus()) {
        // NN not installed — skip retry loop
        if (!this.app.plugins?.plugins?.['notebook-navigator']) return;
        const deadline = Date.now() + 10_000;
        const id = this.registerInterval(
          window.setInterval(() => {
            if (
              this.registerNotebookNavigatorMenus() ||
              Date.now() >= deadline
            ) {
              window.clearInterval(id);
            }
          }, 500)
        );
      }
    });
  }

  async createBaseFile(
    viewType: string,
    viewName: string,
    paneType: PaneType | boolean,
    folderPath?: string
  ) {
    try {
      if (!folderPath) {
        const activeFile = this.app.workspace.getActiveFile();
        folderPath = this.app.fileManager.getNewFileParent(
          activeFile?.path ?? ''
        ).path;
      }
      const filePath = getAvailableBasePath(this.app, folderPath, 'Untitled');
      const minCol = viewType === 'dynamic-views-masonry' ? 'two' : 'one';
      const content = `views:\n  - type: ${viewType}\n    name: ${viewName}\n    minimumColumns: ${minCol}\n`;

      await this.app.vault.create(filePath, content);

      const file = this.app.vault.getFileByPath(filePath);
      if (file) {
        const leaf = this.app.workspace.getLeaf(paneType);
        await leaf.openFile(file, { eState: { rename: 'all' } });
      }
    } catch (error) {
      new Notice(`Failed to create file.`);
      console.error('Base file creation failed:', error);
    }
  }

  /**
   * Register "New Grid/Masonry base" in Notebook Navigator folder menus.
   * Skips if already registered with the same API instance.
   * Re-registers when NN is disabled/re-enabled (new API instance).
   */
  private registerNotebookNavigatorMenus(): boolean {
    const nnApi = getNotebookNavigatorAPI(this.app);
    if (!nnApi) return false;
    if (nnApi === this.nnRegisteredApi) return true;
    this.nnRegisteredApi = nnApi;

    const dispose = nnApi.menus.registerFolderMenu(({ addItem, folder }) => {
      if (!this.persistenceManager.getPluginSettings().folderCommands) return;

      const added: MenuItem[] = [];
      addItem((item) => {
        item
          .setTitle(NEW_GRID_BASE)
          .setIcon('lucide-grid-2x-2')
          .onClick(async () => {
            await this.createBaseFile(
              'dynamic-views-grid',
              'Grid',
              false,
              folder.path
            );
          });
        added.push(item);
      });
      addItem((item) => {
        item
          .setTitle(NEW_MASONRY_BASE)
          .setIcon('panels-right-bottom')
          .onClick(async () => {
            await this.createBaseFile(
              'dynamic-views-masonry',
              'Masonry',
              false,
              folder.path
            );
          });
        added.push(item);

        // NN's extension API appends items near the bottom of the menu.
        // Obsidian's Menu.addItem pushes to items[] before calling the
        // callback, so both items are in the array now. Splice them into
        // the creation group (before the first separator) synchronously
        // — before the menu is shown.
        // Uses undocumented MenuItem.menu and Menu.items (stable since 1.0).
        const menu = (item as MenuItem & { menu?: { items: MenuItem[] } }).menu;
        if (!menu) return;
        const items = menu.items as (MenuItem & { titleEl?: HTMLElement })[];
        for (const a of added) {
          const idx = items.indexOf(a);
          if (idx >= 0) items.splice(idx, 1);
        }
        const firstSep = items.findIndex((i) => !i.titleEl);
        if (firstSep >= 0) {
          items.splice(firstSep, 0, ...added);
        }
      });
    });

    this.register(dispose);
    return true;
  }

  private getActiveDynamicViewsGroupedView():
    | DynamicViewsGridView
    | DynamicViewsMasonryView
    | null {
    const leaf = this.app.workspace.getMostRecentLeaf();
    if (!leaf) return null;
    const view = leaf.view as unknown as {
      controller?: {
        view?: DynamicViewsGridView | DynamicViewsMasonryView;
      };
    };
    const dynamicViewsView = view?.controller?.view;
    if (!dynamicViewsView) return null;
    if (
      (dynamicViewsView.type === GRID_VIEW_TYPE ||
        dynamicViewsView.type === MASONRY_VIEW_TYPE) &&
      dynamicViewsView.isGrouped
    ) {
      return dynamicViewsView;
    }
    return null;
  }

  /** Refresh card width debug badges (idempotent, live-updating via ResizeObserver) */
  debugWidths() {
    const ATTR = 'data-dynamic-views-debug-widths';
    // Collect documents from all windows (main + popouts)
    const docs = [document, ...this.getAllPopoutDocuments()];

    // Remove existing badges before reapplying (idempotent)
    docs.forEach((d) =>
      d.querySelectorAll(`[${ATTR}]`).forEach((badge) => {
        (badge as HTMLElement & { _ro?: ResizeObserver })._ro?.disconnect();
        badge.remove();
      })
    );

    let count = 0;
    docs.forEach((d) =>
      d.querySelectorAll('.dynamic-views .card').forEach((card) => {
        const badge = card.createDiv();
        badge.setAttribute(ATTR, '');
        Object.assign(badge.style, {
          position: 'absolute',
          top: '2px',
          right: '2px',
          background: 'rgba(0,0,0,.75)',
          color: '#fff',
          fontSize: '11px',
          padding: '1px 4px',
          borderRadius: '3px',
          zIndex: '9999',
          pointerEvents: 'none',
          fontFamily: 'monospace',
        });
        const update = () => {
          badge.textContent = `${(card as HTMLElement).offsetWidth}px`;
        };
        const win: OwnerWindow = card.ownerDocument.defaultView ?? window;
        const ro = new win.ResizeObserver(update);
        ro.observe(card);
        (badge as HTMLElement & { _ro?: ResizeObserver })._ro = ro;
        update();
        count++;
      })
    );
    console.debug(`refreshed width badges (${count} cards)`);
  }

  private closeAllZoomedImages(): void {
    const docs = [document, ...this.getAllPopoutDocuments()];
    for (const doc of docs) {
      doc
        .querySelectorAll('.dynamic-views-image-embed.is-zoomed')
        .forEach((el) => el.classList.remove('is-zoomed'));
    }
  }

  getAllPopoutDocuments(): Document[] {
    const floating = (
      this.app.workspace as unknown as {
        floatingSplit?: { children: { doc: Document }[] };
      }
    ).floatingSplit?.children;
    return floating ? floating.map((w) => w.doc) : [];
  }

  onunload() {
    delete this.app.__slowMount;

    // Remove body classes added during load
    const settings = this.persistenceManager.getPluginSettings();
    document.body.classList.remove(
      `dynamic-views-open-on-${settings.openFileAction}`
    );
    document.body.classList.remove(
      'dynamic-views-file-type-flair',
      'dynamic-views-file-type-icon',
      'dynamic-views-file-type-none'
    );

    clearInFlightLoads();
    cleanupExternalBlobCache();
  }
}
