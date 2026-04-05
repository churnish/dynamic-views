import { Plugin } from 'obsidian';
import type {
  PluginData,
  PluginSettings,
  ViewDefaults,
  BasesUIState,
  SettingsTemplate,
} from './types';
import {
  BASES_DEFAULTS,
  PLUGIN_SETTINGS,
  PLUGIN_SETTINGS_CHANGE,
  VIEW_DEFAULTS,
  DEFAULT_BASES_STATE,
} from './constants';
import { sanitizeObject, sanitizeString } from './utils/sanitize';
import {
  VALID_VIEW_VALUES,
  VIEW_DEFAULTS_TYPES,
} from './shared/view-validation';
import { getMinimumColumnsDefault } from './shared/settings-schema';

const VIEW_DEFAULTS_KEYS = new Set(Object.keys(VIEW_DEFAULTS));

/**
 * Strip stale keys, wrong-typed values, and invalid enum values from a template's settings.
 * Only ViewDefaults keys are allowed.
 * Returns true if any changes were made.
 */
function cleanupTemplateSettings(
  settings: Record<string, unknown>,
  viewType: 'grid' | 'masonry'
): boolean {
  let changed = false;

  for (const key of Object.keys(settings)) {
    // Remove keys not in allowed set
    if (!VIEW_DEFAULTS_KEYS.has(key)) {
      delete settings[key];
      changed = true;
      continue;
    }

    // Delete values whose type doesn't match VIEW_DEFAULTS
    // (skipping minimumColumns — has special handling below)
    const expectedType = VIEW_DEFAULTS_TYPES[key];
    if (
      expectedType &&
      key !== 'minimumColumns' &&
      typeof settings[key] !== expectedType
    ) {
      delete settings[key];
      changed = true;
      continue;
    }

    // Reset stale enum values to first valid value
    // Skip minimumColumns — Bases uses string values ('one'/'two')
    const validValues = VALID_VIEW_VALUES[key as keyof ViewDefaults];
    if (
      key !== 'minimumColumns' &&
      validValues &&
      !validValues.includes(String(settings[key]) as never)
    ) {
      settings[key] = validValues[0];
      changed = true;
    }
  }

  // Remove keys that match VIEW_DEFAULTS (sparse templates).
  // Skip keys where BASES_DEFAULTS overrides VIEW_DEFAULTS
  // (same guard as cleanUpBaseFile in utils.ts).
  for (const key of Object.keys(VIEW_DEFAULTS) as (keyof ViewDefaults)[]) {
    if (key in BASES_DEFAULTS) continue;
    if (settings[key] === undefined) continue;

    // minimumColumns: view-type-specific default (templates store numbers)
    if (key === 'minimumColumns') {
      const minColDefault = getMinimumColumnsDefault(viewType);
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
      };
    }

    // Migrate preventSidebarSwipe: stale string → boolean
    let pluginSettingsDirty = false;
    const swipeVal = this.data.pluginSettings.preventSidebarSwipe;
    if (typeof swipeVal === 'string') {
      if (swipeVal === 'disabled') {
        (
          this.data.pluginSettings as Record<string, unknown>
        ).preventSidebarSwipe = false;
      } else {
        // Any other string maps to true (the default) — remove for sparse storage
        delete (this.data.pluginSettings as Record<string, unknown>)
          .preventSidebarSwipe;
      }
      pluginSettingsDirty = true;
    }

    // Clean up stale keys/values in templates
    let templatesDirty = false;
    for (const viewType of ['grid', 'masonry'] as const) {
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

    if (pluginSettingsDirty || templatesDirty) {
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
    this.plugin.app.workspace.trigger(PLUGIN_SETTINGS_CHANGE);
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
    state: Partial<BasesUIState>
  ): Promise<void> {
    if (!viewId) return;

    // Sanitize collapsedGroups array
    const collapsedGroups = (state.collapsedGroups ?? [])
      .map((item) => (typeof item === 'string' ? sanitizeString(item) : item))
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

  getSettingsTemplate(
    viewType: 'grid' | 'masonry'
  ): SettingsTemplate | undefined {
    return this.data.templates[viewType];
  }

  async setSettingsTemplate(
    viewType: 'grid' | 'masonry',
    template: SettingsTemplate | null
  ): Promise<void> {
    if (template) {
      this.data.templates[viewType] = template;
    } else {
      delete this.data.templates[viewType];
    }
    await this.save();
  }
}
