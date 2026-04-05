/**
 * Obsidian module augmentations for undocumented APIs used by this plugin.
 */

import { TFile, Plugin, LinkCache } from 'obsidian';

declare module 'obsidian' {
  interface FileManager {
    /** Prompt user to rename a file (undocumented API) */
    promptForFileRename(file: TFile): Promise<void>;
  }
  interface App {
    /** Open file with system default app (undocumented API) */
    openWithDefaultApp(path: string): void;
    /** Access installed plugins by ID (undocumented API) */
    plugins: {
      plugins: Record<string, Plugin | undefined>;
    };
    /** Drag manager for file/link/folder drag operations (undocumented API) */
    dragManager: {
      dragFile(evt: DragEvent, file: TFile): unknown;
      dragLink(
        evt: DragEvent,
        linktext: string,
        sourcePath: string,
        title?: string,
        source?: string
      ): unknown;
      onDragStart(evt: DragEvent, dragData: unknown): void;
    };
    /** Debug: slow mount toggle for mount ordering work (temporary) */
    __slowMount?: (on?: boolean) => string;
    isMobile: boolean;
    internalPlugins: {
      plugins: Record<
        string,
        {
          enabled: boolean;
          instance?: {
            openGlobalSearch?: (query: string) => void;
            revealInFolder?: (file: unknown) => void;
          };
        }
      >;
      getPluginById(id: string): { instance?: unknown } | null;
    };
  }
  interface MetadataCache {
    /** Get all known property types across the vault (undocumented API) */
    getAllPropertyInfos():
      | Record<string, { type?: string; widget?: string }>
      | undefined;
    /** Get incoming links to a file (undocumented API) */
    getBacklinksForFile(file: TFile): { data: Map<string, LinkCache[]> } | null;
  }
  interface DataAdapter {
    /** Get absolute filesystem path (undocumented API) */
    getFullPath(path: string): string | undefined;
  }
}
