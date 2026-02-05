import { App, TFile, TFolder } from "obsidian";
import type { ResolvedSettings } from "../types";

/** Delay after storage-ready for NN view to render */
const VIEW_RENDER_DELAY_MS = 200;

/**
 * Notebook Navigator API interface (v1.1.0)
 * Minimal type definition for the methods we use
 */
interface NotebookNavigatorAPI {
  navigation: {
    reveal(file: TFile): Promise<void>;
    navigateToFolder(folder: TFolder): Promise<void>;
    navigateToTag(tag: string): Promise<void>;
  };
  isStorageReady(): boolean;
  once(event: string, callback: () => void): unknown;
  off(ref: unknown): void;
}

function getNotebookNavigatorAPI(app: App): NotebookNavigatorAPI | null {
  const api = app.plugins?.plugins?.["notebook-navigator"]?.api as
    | NotebookNavigatorAPI
    | undefined;
  return api ?? null;
}

function revealNotebookNavigatorLeaf(app: App): void {
  const leaves = app.workspace.getLeavesOfType("notebook-navigator");
  if (leaves.length > 0) {
    void app.workspace.revealLeaf(leaves[0]);
  }
}

/**
 * Wait for NN storage to be ready (max 5s timeout)
 * Also adds delay for view to render after storage-ready
 */
async function waitForStorageReady(api: NotebookNavigatorAPI): Promise<void> {
  if (api.isStorageReady()) return;

  await new Promise<void>((resolve) => {
    const eventRef = api.once("storage-ready", () => {
      clearTimeout(timeout);
      resolve();
    });
    const timeout = setTimeout(() => {
      api.off(eventRef);
      resolve();
    }, 5000);
  });

  await new Promise((resolve) => setTimeout(resolve, VIEW_RENDER_DELAY_MS));
}

/**
 * Get current revealInNotebookNavigator setting from plugin
 * Reads dynamically so setting changes take effect immediately
 */
function getCurrentSetting(
  app: App,
): ResolvedSettings["revealInNotebookNavigator"] | null {
  const plugin = app.plugins?.plugins?.["dynamic-views"] as
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
  type: "file" | "folder" | "tag",
): boolean {
  const setting = getCurrentSetting(app);
  if (!setting || setting === "disable") return false;
  if (setting === "all") return true;
  if (setting === "files-folders" && (type === "file" || type === "folder")) {
    return true;
  }
  if (setting === "tags" && type === "tag") return true;
  return false;
}

export function revealFileInNotebookNavigator(app: App, file: TFile): boolean {
  const api = getNotebookNavigatorAPI(app);
  if (!api) return false;

  revealNotebookNavigatorLeaf(app);
  waitForStorageReady(api)
    .then(() => api.navigation.reveal(file))
    .catch(() => {});

  return true;
}

export function navigateToFolderInNotebookNavigator(
  app: App,
  folder: TFolder,
): boolean {
  const api = getNotebookNavigatorAPI(app);
  if (!api) return false;

  revealNotebookNavigatorLeaf(app);
  waitForStorageReady(api)
    .then(() => api.navigation.navigateToFolder(folder))
    .catch(() => {});

  return true;
}

export function navigateToTagInNotebookNavigator(
  app: App,
  tag: string,
): boolean {
  const api = getNotebookNavigatorAPI(app);
  if (!api) return false;

  revealNotebookNavigatorLeaf(app);
  waitForStorageReady(api)
    .then(() => api.navigation.navigateToTag(tag))
    .catch(() => {});

  return true;
}
