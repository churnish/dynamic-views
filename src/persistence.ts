import { Plugin } from "obsidian";
import type {
  PluginData,
  PluginSettings,
  ViewDefaults,
  BasesUIState,
  DatacoreState,
  SettingsTemplate,
} from "./types";
import {
  PLUGIN_SETTINGS,
  VIEW_DEFAULTS,
  DATACORE_DEFAULTS,
  DEFAULT_BASES_STATE,
  DEFAULT_DATACORE_STATE,
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
  rightPropertyPosition: ["left", "column", "right"],
  minimumColumns: ["one", "two"],
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

    // Reset stale enum values to first valid value
    const validValues = VALID_VIEW_VALUES[key as keyof ViewDefaults];
    if (validValues && !validValues.includes(String(settings[key]) as never)) {
      settings[key] = validValues[0];
      changed = true;
    }
  }

  // Remove keys that match VIEW_DEFAULTS (sparse templates)
  for (const key of Object.keys(VIEW_DEFAULTS) as (keyof ViewDefaults)[]) {
    if (settings[key] === undefined) continue;

    // minimumColumns: view-type-specific default (templates store numbers)
    if (key === "minimumColumns") {
      const minColDefault = viewType === "masonry" ? 2 : 1;
      if (settings[key] === minColDefault) {
        delete settings[key];
        changed = true;
      }
      continue;
    }

    // All other keys: compare to VIEW_DEFAULTS
    if (settings[key] === VIEW_DEFAULTS[key]) {
      delete settings[key];
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
      basesStates: {},
      datacoreStates: {},
    };
  }

  async load(): Promise<void> {
    const loadedData =
      (await this.plugin.loadData()) as Partial<PluginData> | null;

    if (loadedData) {
      this.data = {
        pluginSettings: loadedData.pluginSettings || {},
        templates: loadedData.templates || {},
        basesStates: loadedData.basesStates || {},
        datacoreStates: loadedData.datacoreStates || {},
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
    if (Object.keys(this.data.basesStates).length > 0)
      sparse.basesStates = this.data.basesStates;
    if (Object.keys(this.data.datacoreStates).length > 0)
      sparse.datacoreStates = this.data.datacoreStates;
    await this.plugin.saveData(sparse);
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

  // ============================================================================
  // Bases State (collapsedGroups only, keyed by view ID)
  // ============================================================================

  getBasesState(viewId?: string): BasesUIState {
    if (!viewId) return { ...DEFAULT_BASES_STATE };
    const state = this.data.basesStates[viewId];
    return state ? { ...state } : { ...DEFAULT_BASES_STATE };
  }

  async setBasesState(
    viewId: string | undefined,
    state: Partial<BasesUIState>,
  ): Promise<void> {
    if (!viewId) return;

    // Sanitize collapsedGroups array
    const collapsedGroups = (state.collapsedGroups ?? [])
      .map((item) => (typeof item === "string" ? sanitizeString(item) : item))
      .filter((s): s is string => s !== null);

    // Sparse: delete entry if empty, otherwise store
    if (collapsedGroups.length === 0) {
      delete this.data.basesStates[viewId];
    } else {
      this.data.basesStates[viewId] = { collapsedGroups };
    }
    await this.save();
  }

  /**
   * Migrate basesState from old view ID to new ID (used for view renames).
   * Moves the state and deletes the old key.
   */
  async migrateBasesState(oldId: string, newId: string): Promise<void> {
    const oldState = this.data.basesStates[oldId];
    if (!oldState) return;

    this.data.basesStates[newId] = oldState;
    delete this.data.basesStates[oldId];
    await this.save();
  }

  // ============================================================================
  // Datacore State (UI + settings, keyed by queryId only)
  // ============================================================================

  /**
   * Get Datacore state for a query.
   * @param queryId - Unique ID for the query (required for persistence)
   * @returns DatacoreState — defaults if no queryId provided
   */
  getDatacoreState(queryId?: string): DatacoreState {
    if (!queryId) return { ...DEFAULT_DATACORE_STATE };
    const state = this.data.datacoreStates[queryId];
    if (!state) return { ...DEFAULT_DATACORE_STATE };

    // Sparse: merge stored fields with defaults
    const merged = { ...DEFAULT_DATACORE_STATE, ...state };

    // Convert minimumColumns string to number for internal use (Bases parity)
    if (merged.settings?.minimumColumns) {
      const val = merged.settings.minimumColumns as unknown;
      if (val === "one") merged.settings.minimumColumns = 1;
      else if (val === "two") merged.settings.minimumColumns = 2;
    }

    return merged;
  }

  /**
   * Set Datacore state for a query.
   * @param queryId - Unique ID for the query (required for persistence)
   * @param state - Partial state to merge
   */
  async setDatacoreState(
    queryId: string | undefined,
    state: Partial<DatacoreState>,
  ): Promise<void> {
    if (!queryId) return; // No persistence without queryId

    const current = this.data.datacoreStates[queryId] || {};

    // Sanitize string fields
    const sanitized: Partial<DatacoreState> = {};
    for (const [k, v] of Object.entries(state)) {
      const stateKey = k as keyof DatacoreState;
      if (k === "searchQuery" && typeof v === "string") {
        (sanitized as Record<string, string>)[stateKey] = sanitizeString(
          v.slice(0, 500),
        );
      } else if (typeof v === "string") {
        (sanitized as Record<string, string>)[stateKey] = sanitizeString(v);
      } else if (k === "settings" && typeof v === "object" && v !== null) {
        const settingsObj = sanitizeObject(v as Record<string, unknown>);
        // Convert minimumColumns to string for Bases parity
        if (typeof settingsObj.minimumColumns === "number") {
          settingsObj.minimumColumns =
            settingsObj.minimumColumns === 1 ? "one" : "two";
        }
        (sanitized as Record<string, unknown>)[stateKey] = settingsObj;
      } else {
        (sanitized as Record<string, unknown>)[stateKey] = v;
      }
    }

    const merged = { ...current, ...sanitized };

    // Sparse: only keep fields that differ from defaults
    const sparse: Partial<DatacoreState> = {};
    for (const [k, v] of Object.entries(merged)) {
      if (v !== DEFAULT_DATACORE_STATE[k as keyof DatacoreState]) {
        (sparse as Record<string, unknown>)[k] = v;
      }
    }

    // Delete entry if all defaults, otherwise store sparse
    if (Object.keys(sparse).length === 0) {
      delete this.data.datacoreStates[queryId];
    } else {
      this.data.datacoreStates[queryId] = sparse as DatacoreState;
    }
    await this.save();
  }

  getSettingsTemplate(
    viewType: "grid" | "masonry" | "datacore",
  ): SettingsTemplate | undefined {
    const template = this.data.templates[viewType];
    if (!template?.settings) return template;

    // Convert minimumColumns string to number for internal use (Bases parity)
    const val = template.settings.minimumColumns as unknown;
    if (val === "one") template.settings.minimumColumns = 1;
    else if (val === "two") template.settings.minimumColumns = 2;

    return template;
  }

  async setSettingsTemplate(
    viewType: "grid" | "masonry" | "datacore",
    template: SettingsTemplate | null,
  ): Promise<void> {
    if (template?.settings) {
      // Convert minimumColumns to string for Bases parity
      if (typeof template.settings.minimumColumns === "number") {
        (template.settings as Record<string, unknown>).minimumColumns =
          template.settings.minimumColumns === 1 ? "one" : "two";
      }
      this.data.templates[viewType] = template;
    } else if (template) {
      this.data.templates[viewType] = template;
    } else {
      delete this.data.templates[viewType];
    }
    await this.save();
  }
}
