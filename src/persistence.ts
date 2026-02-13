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
  BASES_DEFAULTS,
  PLUGIN_SETTINGS,
  VIEW_DEFAULTS,
  DATACORE_DEFAULTS,
  DEFAULT_BASES_STATE,
  DEFAULT_DATACORE_STATE,
} from "./constants";
import { sanitizeObject, sanitizeString } from "./utils/sanitize";
import {
  VALID_VIEW_VALUES,
  VIEW_DEFAULTS_TYPES,
} from "./shared/view-validation";

const VIEW_DEFAULTS_KEYS = new Set(Object.keys(VIEW_DEFAULTS));
const DATACORE_DEFAULTS_KEYS = new Set(Object.keys(DATACORE_DEFAULTS));

/**
 * Strip stale keys, wrong-typed values, and invalid enum values from a template's settings.
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

    // Delete values whose type doesn't match VIEW_DEFAULTS
    // (skipping minimumColumns — has special handling below)
    const expectedType = VIEW_DEFAULTS_TYPES[key];
    if (
      expectedType &&
      key !== "minimumColumns" &&
      typeof settings[key] !== expectedType
    ) {
      delete settings[key];
      changed = true;
      continue;
    }

    // Reset stale enum values to first valid value
    // Skip minimumColumns - Bases uses strings, Datacore uses numbers
    const validValues = VALID_VIEW_VALUES[key as keyof ViewDefaults];
    if (
      key !== "minimumColumns" &&
      validValues &&
      !validValues.includes(String(settings[key]) as never)
    ) {
      settings[key] = validValues[0];
      changed = true;
    }
  }

  // Remove keys that match VIEW_DEFAULTS (sparse templates).
  // For Bases views, skip keys where BASES_DEFAULTS overrides VIEW_DEFAULTS
  // (same guard as cleanUpBaseFile in utils.ts).
  const isBases = viewType !== "datacore";
  for (const key of Object.keys(VIEW_DEFAULTS) as (keyof ViewDefaults)[]) {
    if (isBases && key in BASES_DEFAULTS) continue;
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
      if (!template) continue;
      if (
        cleanupTemplateSettings(template as Record<string, unknown>, viewType)
      ) {
        // Remove template entirely if no settings remain after cleanup
        if (Object.keys(template).length === 0) {
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
    // Sparse: merge stored fields with defaults
    return state
      ? { ...DEFAULT_DATACORE_STATE, ...state }
      : { ...DEFAULT_DATACORE_STATE };
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
        (sanitized as Record<string, unknown>)[stateKey] = sanitizeObject(
          v as Record<string, unknown>,
        );
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
    return this.data.templates[viewType];
  }

  async setSettingsTemplate(
    viewType: "grid" | "masonry" | "datacore",
    template: SettingsTemplate | null,
  ): Promise<void> {
    if (template) {
      this.data.templates[viewType] = template;
    } else {
      delete this.data.templates[viewType];
    }
    await this.save();
  }
}
