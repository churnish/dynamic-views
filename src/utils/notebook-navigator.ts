import { App, MenuItem, TFile, TFolder } from 'obsidian';
import type { ResolvedSettings } from '../types';

/**
 * Notebook Navigator API interface (v2.0.0)
 * Minimal type definition for the methods we use.
 * Navigation methods internally ensure the view is open and ready.
 */
interface NotebookNavigatorAPI {
  navigation: {
    reveal(file: TFile): Promise<boolean>;
    navigateToFolder(folder: TFolder): Promise<boolean>;
    navigateToTag(tag: string): Promise<boolean>;
  };
  menus: {
    registerFolderMenu(
      callback: (context: {
        addItem: (cb: (item: MenuItem) => void) => void;
        folder: TFolder;
      }) => void
    ): () => void;
  };
}

export function getNotebookNavigatorAPI(app: App): NotebookNavigatorAPI | null {
  const plugin = app.plugins?.plugins?.['notebook-navigator'];
  const api = (plugin as unknown as { api?: NotebookNavigatorAPI } | undefined)
    ?.api;
  return api ?? null;
}

/**
 * Get current revealInNotebookNavigator setting from plugin
 * Reads dynamically so setting changes take effect immediately
 */
function getCurrentSetting(
  app: App
): ResolvedSettings['revealInNotebookNavigator'] | null {
  const plugin = app.plugins?.plugins?.['dynamic-views'] as
    | { persistenceManager?: { getPluginSettings(): ResolvedSettings } }
    | undefined;
  return (
    plugin?.persistenceManager?.getPluginSettings()
      ?.revealInNotebookNavigator ?? null
  );
}

/**
 * Check if NN should handle based on setting and element type
 * Reads setting dynamically so changes take effect immediately
 */
export function shouldUseNotebookNavigator(
  app: App,
  type: 'file' | 'folder' | 'tag'
): boolean {
  const setting = getCurrentSetting(app);
  if (!setting || setting === 'disable') return false;
  if (setting === 'all') return true;
  if (setting === 'files-folders' && (type === 'file' || type === 'folder')) {
    return true;
  }
  if (setting === 'tags' && type === 'tag') return true;
  return false;
}

export function revealFileInNotebookNavigator(app: App, file: TFile): boolean {
  const api = getNotebookNavigatorAPI(app);
  if (!api) return false;
  void api.navigation.reveal(file);
  return true;
}

export function navigateToFolderInNotebookNavigator(
  app: App,
  folder: TFolder
): boolean {
  const api = getNotebookNavigatorAPI(app);
  if (!api) return false;
  void api.navigation.navigateToFolder(folder);
  return true;
}

export function navigateToTagInNotebookNavigator(
  app: App,
  tag: string
): boolean {
  const api = getNotebookNavigatorAPI(app);
  if (!api) return false;
  void api.navigation.navigateToTag(tag);
  return true;
}
