import { App, TFile, normalizePath } from 'obsidian';

/**
 * Get the creation timestamp (ctime) of a file
 * @param file - TFile object
 * @returns Creation timestamp in milliseconds, or null if unavailable
 */
export function getFileCtime(file: TFile | null): number | null {
    if (!file?.stat?.ctime) return null;
    return file.stat.ctime;
}

/**
 * Get the currently active file
 * @param app - Obsidian App instance
 * @returns Active TFile or null
 */
export function getCurrentFile(app: App): TFile | null {
    return app.workspace.getActiveFile();
}

/**
 * Get an available file path with automatic deduplication
 * @param app - Obsidian App instance
 * @param folderPath - The folder path where the file should be created
 * @param baseName - The base name for the file (without .md extension)
 * @returns A normalized, unique file path
 */
export function getAvailablePath(app: App, folderPath: string, baseName: string): string {
    const name = baseName.replace(/\.md$/, '');
    let filePath = folderPath ? `${folderPath}/${name}.md` : `${name}.md`;
    filePath = normalizePath(filePath);

    let counter = 1;
    while (app.vault.getFileByPath(filePath)) {
        const unnormalizedPath = folderPath
            ? `${folderPath}/${name} ${counter}.md`
            : `${name} ${counter}.md`;
        filePath = normalizePath(unnormalizedPath);
        counter++;
    }

    return filePath;
}
