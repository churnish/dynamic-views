/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Mock implementation of Obsidian API for testing
 * Based on obsidian.d.ts from obsidianmd/obsidian-api
 */

export class App {
  vault = new Vault();
  workspace = new Workspace();
  metadataCache = new MetadataCache();
  fileManager = new FileManager();

  loadLocalStorage(key: string): string | null {
    return localStorage.getItem(key);
  }

  saveLocalStorage(key: string, data: string | null): void {
    if (data === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, data);
    }
  }
}

export class Vault {
  adapter = {
    exists: jest.fn().mockResolvedValue(true),
    read: jest.fn().mockResolvedValue(""),
    readBinary: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
  };

  read(file: TFile): Promise<string> {
    return Promise.resolve("");
  }

  cachedRead(file: TFile): Promise<string> {
    return Promise.resolve("");
  }

  async process(file: TFile, fn: (content: string) => string): Promise<string> {
    const content = await this.read(file);
    return fn(content);
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    return null;
  }

  getFiles(): TFile[] {
    return [];
  }
}

export class Workspace {
  on(name: string, callback: (...args: any[]) => any): void {
    // Mock event registration
  }

  off(name: string, callback: (...args: any[]) => any): void {
    // Mock event removal
  }

  getMostRecentLeaf(): WorkspaceLeaf | null {
    return null;
  }
}

export class WorkspaceLeaf {
  view: View = new View();
}

export class View {
  getViewType(): string {
    return "";
  }
}

export class MetadataCache {
  getFileCache(file: TFile): CachedMetadata | null {
    return null;
  }

  getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null {
    return null;
  }
}

export class FileManager {
  processFrontMatter(
    file: TFile,
    fn: (frontmatter: any) => void,
  ): Promise<void> {
    return Promise.resolve();
  }
}

export abstract class TAbstractFile {
  vault!: Vault;
  path!: string;
  name!: string;
  parent!: TFolder | null;
}

export class TFile extends TAbstractFile {
  stat!: { ctime: number; mtime: number; size: number };
  basename!: string;
  extension!: string;
}

export class TFolder extends TAbstractFile {
  children!: TAbstractFile[];
  isRoot(): boolean {
    return !this.parent;
  }
}

export interface CachedMetadata {
  frontmatter?: Record<string, any>;
  links?: Array<{ link: string; displayText: string }>;
  embeds?: Array<{ link: string }>;
  tags?: Array<{ tag: string }>;
  headings?: Array<{ heading: string; level: number }>;
}

export class Component {
  _loaded = false;

  load(): void {
    this._loaded = true;
  }

  onload(): void {
    // Override in subclass
  }

  unload(): void {
    this._loaded = false;
  }

  onunload(): void {
    // Override in subclass
  }

  register(cb: () => any): void {
    // Mock registration
  }

  registerEvent(eventRef: any): void {
    // Mock event registration
  }

  registerDomEvent(el: HTMLElement, type: string, callback: any): void {
    // Mock DOM event registration
  }

  addChild(component: Component): Component {
    component.load();
    return component;
  }

  removeChild(component: Component): Component {
    component.unload();
    return component;
  }
}

export abstract class BasesView extends Component {
  abstract type: string;
  app!: App;
  config!: any;
  allProperties: any[] = [];
  data: any = { entries: [] };

  abstract onDataUpdated(): void;

  createFileForView(
    baseFileName: string,
    frontmatterProcessor?: (frontmatter: any) => void,
  ): void {
    // Mock file creation
  }
}

export class Plugin extends Component {
  app!: App;
  manifest!: PluginManifest;

  addRibbonIcon(
    icon: string,
    title: string,
    callback: () => void,
  ): HTMLElement {
    return document.createElement("div");
  }

  addCommand(command: Command): Command {
    return command;
  }

  registerView(type: string, viewCreator: (leaf: any) => any): void {
    // Mock view registration
  }

  registerMarkdownCodeBlockProcessor(language: string, handler: any): void {
    // Mock code block processor
  }

  loadData(): Promise<any> {
    return Promise.resolve({});
  }

  saveData(data: any): Promise<void> {
    return Promise.resolve();
  }
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  minAppVersion: string;
  description: string;
  author: string;
  authorUrl?: string;
  isDesktopOnly?: boolean;
}

export interface Command {
  id: string;
  name: string;
  callback?: () => void;
  checkCallback?: (checking: boolean) => boolean | void;
  hotkeys?: Hotkey[];
}

export interface Hotkey {
  modifiers: string[];
  key: string;
}

// Preact/React exports (h function for JSX)
export const h = (type: any, props: any, ...children: any[]) => {
  return { type, props: { ...props, children } };
};

export const Fragment = ({ children }: { children: any }) => children;

// Mock Notice
export class Notice {
  constructor(message: string, timeout?: number) {
    console.log(`Notice: ${message}`);
  }
}

// Mock requestUrl
export function requestUrl(request: string | { url: string }): Promise<any> {
  return Promise.resolve({
    status: 200,
    text: "",
    json: {},
    arrayBuffer: new ArrayBuffer(0),
  });
}

// Mock normalizePath
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

// Mock setIcon
export function setIcon(parent: HTMLElement, iconId: string): void {
  parent.setAttribute("data-icon", iconId);
}

// Mock YAML helpers — use JSON for test simplicity
export function parseYaml(content: string): unknown {
  return JSON.parse(content);
}

export function stringifyYaml(obj: unknown): string {
  return JSON.stringify(obj);
}

// Export commonly used types
export type { CachedMetadata };
