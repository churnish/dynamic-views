import { Plugin, TFile } from "obsidian";
import type {
  PluginData,
  PluginSettings,
  ViewDefaults,
  DatacoreDefaults,
  UIState,
  SettingsTemplate,
} from "./types";
import { PLUGIN_SETTINGS, DEFAULT_UI_STATE } from "./constants";
import { sanitizeObject, sanitizeString } from "./utils/sanitize";

export class PersistenceManager {
  private plugin: Plugin;
  private data: PluginData;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.data = {
      pluginSettings: {},
      templates: {},
      queryStates: {},
      viewSettings: {},
    };
  }

  async load(): Promise<void> {
    const loadedData =
      (await this.plugin.loadData()) as Partial<PluginData> | null;
    if (loadedData) {
      this.data = {
        pluginSettings: loadedData.pluginSettings || {},
        templates: loadedData.templates || {},
        queryStates: loadedData.queryStates || {},
        viewSettings: loadedData.viewSettings || {},
      };
    }
  }

  async save(): Promise<void> {
    await this.plugin.saveData(this.data);
  }

  /**
   * Extract storage key (ctime) from TFile
   * @private
   */
  private getFileKey(file: TFile | null): string | null {
    if (!file?.stat?.ctime) return null;
    return file.stat.ctime.toString();
  }

  /** Returns fully resolved plugin settings (sparse overrides merged with defaults) */
  getPluginSettings(): PluginSettings {
    return { ...PLUGIN_SETTINGS, ...this.data.pluginSettings };
  }

  /** Stores only non-default plugin settings (sparse) */
  async setPluginSettings(settings: Partial<PluginSettings>): Promise<void> {
    const sanitized = sanitizeObject(settings);
    const merged = { ...this.data.pluginSettings, ...sanitized };

    // Diff against defaults — only persist non-default values
    const sparse: Partial<PluginSettings> = {};
    for (const key of Object.keys(merged) as (keyof PluginSettings)[]) {
      if (merged[key] !== PLUGIN_SETTINGS[key]) {
        (sparse as Record<string, unknown>)[key] = merged[key];
      }
    }

    this.data.pluginSettings = sparse;
    await this.save();
  }

  getUIState(file: TFile | null): UIState {
    const key = this.getFileKey(file);
    if (!key) return { ...DEFAULT_UI_STATE };
    const state = this.data.queryStates[key];
    return state ? { ...state } : { ...DEFAULT_UI_STATE };
  }

  async setUIState(file: TFile | null, state: Partial<UIState>): Promise<void> {
    const key = this.getFileKey(file);
    if (!key) return;

    const current = this.data.queryStates[key] || { ...DEFAULT_UI_STATE };

    // Sanitize and truncate searchQuery
    const sanitized: Partial<UIState> = {};
    for (const [k, v] of Object.entries(state)) {
      const key = k as keyof UIState;
      if (k === "searchQuery" && typeof v === "string") {
        (sanitized as Record<string, string>)[key] = sanitizeString(
          v.slice(0, 500),
        );
      } else if (typeof v === "string") {
        (sanitized as Record<string, string>)[key] = sanitizeString(v);
      } else if (Array.isArray(v)) {
        (sanitized as Record<string, unknown>)[key] = v.map((item) =>
          typeof item === "string" ? sanitizeString(item) : item,
        );
      } else {
        (sanitized as Record<string, unknown>)[key] = v;
      }
    }

    this.data.queryStates[key] = { ...current, ...sanitized };
    await this.save();
  }

  async clearUIState(file: TFile | null): Promise<void> {
    const key = this.getFileKey(file);
    if (!key) return;
    delete this.data.queryStates[key];
    await this.save();
  }

  getViewSettings(
    file: TFile | null,
  ): Partial<ViewDefaults & DatacoreDefaults> {
    const key = this.getFileKey(file);
    if (!key) return {};
    const settings = this.data.viewSettings[key];
    return settings ? { ...settings } : {};
  }

  async setViewSettings(
    file: TFile | null,
    settings: Partial<ViewDefaults & DatacoreDefaults>,
  ): Promise<void> {
    const key = this.getFileKey(file);
    if (!key) return;

    const current = this.data.viewSettings[key] || {};
    const sanitized = sanitizeObject(settings);

    this.data.viewSettings[key] = { ...current, ...sanitized };
    await this.save();
  }

  async clearViewSettings(file: TFile | null): Promise<void> {
    const key = this.getFileKey(file);
    if (!key) return;
    delete this.data.viewSettings[key];
    await this.save();
  }

  getSettingsTemplate(
    viewType: "grid" | "masonry" | "datacore",
  ): SettingsTemplate | undefined {
    return this.data.templates[viewType];
  }

  async setSettingsTemplate(
    viewType: "grid" | "masonry" | "datacore",
    template: SettingsTemplate | null,
  ): Promise<void> {
    console.log(
      `[PersistenceManager] setSettingsTemplate(${viewType}):`,
      template ? `saving (timestamp: ${template.setAt})` : "clearing",
    );
    if (template) {
      this.data.templates[viewType] = template;
    } else {
      delete this.data.templates[viewType];
    }
    await this.save();
  }
}
