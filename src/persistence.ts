import { Plugin } from "obsidian";
import { PluginData, Settings, UIState, DefaultViewSettings } from "./types";
import {
  DEFAULT_SETTINGS,
  DEFAULT_UI_STATE,
  DEFAULT_VIEW_SETTINGS,
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
    };
  }

  async load(): Promise<void> {
    const loadedData =
      (await this.plugin.loadData()) as Partial<PluginData> | null;
    if (loadedData) {
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
      };
    }
  }

  async save(): Promise<void> {
    await this.plugin.saveData(this.data);
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

  getUIState(ctime: number): UIState {
    const state = this.data.queryStates[ctime.toString()];
    return state ? { ...state } : { ...DEFAULT_UI_STATE };
  }

  async setUIState(ctime: number, state: Partial<UIState>): Promise<void> {
    const key = ctime.toString();
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

  async clearUIState(ctime: number): Promise<void> {
    delete this.data.queryStates[ctime.toString()];
    await this.save();
  }

  getViewSettings(ctime: number): Partial<DefaultViewSettings> {
    const settings = this.data.viewSettings[ctime.toString()];
    return settings ? { ...settings } : {};
  }

  async setViewSettings(
    ctime: number,
    settings: Partial<DefaultViewSettings>,
  ): Promise<void> {
    const key = ctime.toString();
    const current = this.data.viewSettings[key] || {};

    // Sanitize settings
    const sanitized = sanitizeObject(settings);

    this.data.viewSettings[key] = { ...current, ...sanitized };
    await this.save();
  }

  async clearViewSettings(ctime: number): Promise<void> {
    delete this.data.viewSettings[ctime.toString()];
    await this.save();
  }
}
