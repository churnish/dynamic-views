import { Plugin, TFile } from "obsidian";
import {
  PluginData,
  Settings,
  UIState,
  DefaultViewSettings,
  SettingsTemplate,
} from "./types";
import {
  DEFAULT_SETTINGS,
  DEFAULT_UI_STATE,
  DEFAULT_VIEW_SETTINGS,
  DEFAULT_TEMPLATE_VIEWS,
} from "./constants";
import { sanitizeObject, sanitizeString } from "./utils/sanitize";

export class PersistenceManager {
  private plugin: Plugin;
  private data: PluginData;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.data = {
      globalSettings: { ...DEFAULT_SETTINGS },
      defaultViewSettings: { ...DEFAULT_VIEW_SETTINGS },
      queryStates: {},
      viewSettings: {},
      defaultTemplateViews: { ...DEFAULT_TEMPLATE_VIEWS },
    };
  }

  async load(): Promise<void> {
    const loadedData =
      (await this.plugin.loadData()) as Partial<PluginData> | null;
    if (loadedData) {
      const defaultTemplateViews = loadedData.defaultTemplateViews || {
        ...DEFAULT_TEMPLATE_VIEWS,
      };

      this.data = {
        globalSettings: {
          ...DEFAULT_SETTINGS,
          ...(loadedData.globalSettings || {}),
        },
        defaultViewSettings: {
          ...DEFAULT_VIEW_SETTINGS,
          ...(loadedData.defaultViewSettings || {}),
        },
        queryStates: loadedData.queryStates || {},
        viewSettings: loadedData.viewSettings || {},
        defaultTemplateViews,
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

  getGlobalSettings(): Settings {
    return { ...this.data.globalSettings };
  }

  async setGlobalSettings(settings: Partial<Settings>): Promise<void> {
    const sanitized = sanitizeObject(settings);
    this.data.globalSettings = { ...this.data.globalSettings, ...sanitized };
    await this.save();
  }

  getDefaultViewSettings(): DefaultViewSettings {
    return { ...this.data.defaultViewSettings };
  }

  async setDefaultViewSettings(
    settings: Partial<DefaultViewSettings>,
  ): Promise<void> {
    const sanitized = sanitizeObject(settings);
    this.data.defaultViewSettings = {
      ...this.data.defaultViewSettings,
      ...sanitized,
    };
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

  getViewSettings(file: TFile | null): Partial<DefaultViewSettings> {
    const key = this.getFileKey(file);
    if (!key) return {};
    const settings = this.data.viewSettings[key];
    return settings ? { ...settings } : {};
  }

  async setViewSettings(
    file: TFile | null,
    settings: Partial<DefaultViewSettings>,
  ): Promise<void> {
    const key = this.getFileKey(file);
    if (!key) return;

    const current = this.data.viewSettings[key] || {};

    // Sanitize settings
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
  ): SettingsTemplate | null {
    const template = this.data.defaultTemplateViews[viewType];
    if (!template) return null;
    return template;
  }

  async setSettingsTemplate(
    viewType: "grid" | "masonry" | "datacore",
    template: SettingsTemplate | null,
  ): Promise<void> {
    console.log(
      `[PersistenceManager] setSettingsTemplate(${viewType}):`,
      template ? `saving (timestamp: ${template.setAt})` : "clearing",
    );
    this.data.defaultTemplateViews[viewType] = template;
    await this.save();
  }
}
