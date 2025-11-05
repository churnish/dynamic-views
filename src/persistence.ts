import { Plugin } from 'obsidian';
import { PluginData, Settings, UIState, DefaultViewSettings } from './types';
import { DEFAULT_SETTINGS, DEFAULT_UI_STATE, DEFAULT_VIEW_SETTINGS } from './constants';
import { sanitizeObject, sanitizeString } from './utils/sanitize';

export class PersistenceManager {
    private plugin: Plugin;
    private data: PluginData;

    constructor(plugin: Plugin) {
        this.plugin = plugin;
        this.data = {
            globalSettings: { ...DEFAULT_SETTINGS },
            defaultViewSettings: { ...DEFAULT_VIEW_SETTINGS },
            queryStates: {},
            basesViewMetadataWinners: {}
        };
    }

    async load(): Promise<void> {
        const loadedData = await this.plugin.loadData();
        if (loadedData) {
            this.data = {
                globalSettings: { ...DEFAULT_SETTINGS, ...loadedData.globalSettings },
                defaultViewSettings: { ...DEFAULT_VIEW_SETTINGS, ...loadedData.defaultViewSettings },
                queryStates: loadedData.queryStates || {},
                basesViewMetadataWinners: loadedData.basesViewMetadataWinners || {}
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

    async setDefaultViewSettings(settings: Partial<DefaultViewSettings>): Promise<void> {
        const sanitized = sanitizeObject(settings);
        this.data.defaultViewSettings = { ...this.data.defaultViewSettings, ...sanitized };
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
            if (k === 'searchQuery' && typeof v === 'string') {
                sanitized[k as keyof UIState] = sanitizeString(v.slice(0, 500)) as any;
            } else if (typeof v === 'string') {
                sanitized[k as keyof UIState] = sanitizeString(v) as any;
            } else {
                sanitized[k as keyof UIState] = v as any;
            }
        }

        this.data.queryStates[key] = { ...current, ...sanitized };
        await this.save();
    }

    async clearUIState(ctime: number): Promise<void> {
        delete this.data.queryStates[ctime.toString()];
        await this.save();
    }

    getBasesViewMetadataWinner(viewId: string): 'left' | 'right' | null {
        return this.data.basesViewMetadataWinners[viewId] ?? null;
    }

    async setBasesViewMetadataWinner(viewId: string, winner: 'left' | 'right' | null): Promise<void> {
        if (winner === null) {
            delete this.data.basesViewMetadataWinners[viewId];
        } else {
            this.data.basesViewMetadataWinners[viewId] = winner;
        }
        await this.save();
    }
}
