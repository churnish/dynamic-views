import { STORAGE_KEY_PREFIX } from '../constants';

/**
 * Generate storage key for file-specific data using ctime
 * @param ctime - File creation timestamp
 * @param key - Data key (e.g., 'sortMethod', 'viewMode')
 * @returns Storage key string
 */
export function getStorageKey(ctime: number, key: string): string {
    return `${STORAGE_KEY_PREFIX}-${ctime}-${key}`;
}

/**
 * Generate storage key for global data
 * @param key - Data key
 * @returns Storage key string
 */
export function getGlobalStorageKey(key: string): string {
    return `${STORAGE_KEY_PREFIX}-global-${key}`;
}
