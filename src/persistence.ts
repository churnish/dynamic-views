import { Plugin, TFile } from "obsidian";
import type {
  PluginData,
  PluginSettings,
  ViewDefaults,
  DatacoreDefaults,
  UIState,
  SettingsTemplate,
} from "./types";
import {
  PLUGIN_SETTINGS,
  VIEW_DEFAULTS,
  DATACORE_DEFAULTS,
  DEFAULT_UI_STATE,
} from "./constants";
import { sanitizeObject, sanitizeString } from "./utils/sanitize";

/** Valid enum values for ViewDefaults fields — shared with cleanupBaseFile in utils.ts */
const VALID_VIEW_VALUES: Partial<
  Record<keyof ViewDefaults, readonly string[]>
> = {
  fallbackToEmbeds: ["always", "if-unavailable", "never"],
  imageFormat: ["thumbnail", "cover", "poster", "backdrop"],
  thumbnailSize: ["compact", "standard", "expanded"],
  imagePosition: ["left", "right", "top", "bottom"],
  imageFit: ["crop", "contain"],
  propertyLabels: ["hide", "inline", "above"],
  pairedPropertyLayout: ["left", "column", "right"],
  ambientBackground: ["subtle", "dramatic", "disable"],
};

const VIEW_DEFAULTS_KEYS = new Set(Object.keys(VIEW_DEFAULTS));
const DATACORE_DEFAULTS_KEYS = new Set(Object.keys(DATACORE_DEFAULTS));

/**
 * Strip stale keys and invalid enum values from a template's settings.
 * Grid/masonry templates: only ViewDefaults keys allowed.
 * Datacore templates: ViewDefaults + DatacoreDefaults keys allowed.
 * Returns true if any changes were made.
 */
function cleanupTemplateSettings(
  settings: Record<string, unknown>,
  viewType: "grid" | "masonry" | "datacore",
): boolean {
  let changed = false;
  const allowDatacore = viewType === "datacore";

  for (const key of Object.keys(settings)) {
    // Remove keys not in allowed set
    if (
      !VIEW_DEFAULTS_KEYS.has(key) &&
      !(allowDatacore && DATACORE_DEFAULTS_KEYS.has(key))
    ) {
      delete settings[key];
      changed = true;
      continue;
    }

    // Reset stale enum values to defaults
    const validValues = VALID_VIEW_VALUES[key as keyof ViewDefaults];
    if (
      validValues &&
      typeof settings[key] === "string" &&
      !validValues.includes(settings[key] as string)
    ) {
      settings[key] = VIEW_DEFAULTS[key as keyof ViewDefaults];
      changed = true;
    }
  }

  return changed;
}

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

    // Clean up stale keys/values in templates
    let templatesDirty = false;
    for (const viewType of ["grid", "masonry", "datacore"] as const) {
      const template = this.data.templates[viewType];
      if (!template?.settings) continue;
      if (
        cleanupTemplateSettings(
          template.settings as Record<string, unknown>,
          viewType,
        )
      ) {
        // Remove template entirely if no settings remain after cleanup
        if (Object.keys(template.settings).length === 0) {
          delete this.data.templates[viewType];
        }
        templatesDirty = true;
      }
    }
    if (templatesDirty) {
      await this.save();
    }
  }

  async save(): Promise<void> {
    // Only persist non-empty top-level keys
    const sparse: Record<string, unknown> = {};
    if (Object.keys(this.data.pluginSettings).length > 0)
      sparse.pluginSettings = this.data.pluginSettings;
    if (Object.keys(this.data.templates).length > 0)
      sparse.templates = this.data.templates;
    if (Object.keys(this.data.queryStates).length > 0)
      sparse.queryStates = this.data.queryStates;
    if (Object.keys(this.data.viewSettings).length > 0)
      sparse.viewSettings = this.data.viewSettings;
    await this.plugin.saveData(sparse);
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
