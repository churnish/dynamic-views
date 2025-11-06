/**
 * Type definitions for Datacore API
 *
 * Datacore is an Obsidian plugin that provides a rich API for querying vault data
 * and rendering interactive views using Preact (React-like) components.
 *
 * Documentation: https://github.com/blacksmithgu/datacore
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Preact component type
 */
export type ComponentType<P = {}> = (props: P) => any;

/**
 * Preact virtual node
 */
export interface VNode {
    type: string | ComponentType<any>;
    props: Record<string, any> | null;
    key: any;
}

/**
 * Preact ref object
 */
export interface RefObject<T> {
    current: T | null;
}

/**
 * Datacore Preact bundle - provides access to the Preact library
 * that Datacore uses internally for rendering views.
 */
export interface DatacorePreact {
    /**
     * The Preact h() function for creating virtual DOM nodes.
     * Equivalent to React.createElement()
     */
    h: (
        type: string | ComponentType<any>,
        props: Record<string, any> | null,
        ...children: any[]
    ) => VNode;

    /**
     * Preact Fragment component for grouping elements without a wrapper
     */
    Fragment: ComponentType<{ children?: any }>;

    /**
     * Other Preact exports (Component, render, etc.)
     */
    [key: string]: any;
}

/**
 * Datacore date value with toMillis method
 */
export interface DatacoreDate {
    toMillis(): number;
}

/**
 * Datacore file metadata object representing a file in the vault.
 * Files have both system properties (prefixed with $) and user-defined frontmatter.
 */
export interface DatacoreFile {
    /** Full path to the file */
    $path: string;

    /** File name without extension */
    $name: string;

    /** File extension */
    $extension: string;

    /** File size in bytes */
    $size: number;

    /** File creation time */
    $ctime: DatacoreDate;

    /** File modification time */
    $mtime: DatacoreDate;

    /** Tags on the file (from frontmatter and inline tags) */
    $tags: string[];

    /** Links in the file */
    $links: any[];

    /** Backlinks to this file */
    $backlinks: any[];

    /** Get a metadata value by key */
    value(key: string): any;

    /** User-defined frontmatter properties */
    [key: string]: any;
}

/**
 * Main Datacore API object passed to codeblock views.
 * Provides React-like hooks and utilities for building interactive views.
 */
export interface DatacoreAPI {
    /**
     * Preact library bundle for JSX rendering
     */
    preact: DatacorePreact;

    // ========== State Management Hooks ==========

    /**
     * React-like useState hook for managing component state.
     * Returns a tuple of [value, setter function].
     * Setter accepts either a new value or a function that receives the previous value.
     */
    useState<T>(initialValue: T): [T, (newValue: T | ((prev: T) => T)) => void];

    /**
     * React-like useRef hook for creating mutable refs.
     * Useful for storing values that persist across renders without causing re-renders.
     */
    useRef<T>(initialValue: T): RefObject<T>;

    /**
     * React-like useMemo hook for memoizing expensive computations.
     * Only recomputes when dependencies change.
     */
    useMemo<T>(factory: () => T, deps: any[]): T;

    /**
     * React-like useCallback hook for memoizing callback functions.
     * Only recreates the function when dependencies change.
     */
    useCallback<T extends (...args: any[]) => any>(
        callback: T,
        deps: any[]
    ): T;

    /**
     * React-like useEffect hook for side effects.
     * Runs after render and optionally returns a cleanup function.
     */
    useEffect(
        effect: () => void | (() => void),
        deps?: any[]
    ): void;

    // ========== Datacore-Specific Hooks ==========

    /**
     * Query the Datacore index with a Datacore query string.
     * Returns matching files and updates when the index changes.
     *
     * @example
     * const games = dc.useQuery("#game and @page and rating > 7");
     */
    useQuery(query: string): DatacoreFile[];

    /**
     * Get metadata for the currently active file.
     * Updates when the active file changes.
     */
    useCurrentFile(): DatacoreFile;

    /**
     * Get metadata for a specific file by path.
     * Updates when that file's metadata changes.
     *
     * @param path - Path to the file in the vault
     */
    useFile(path: string): DatacoreFile | undefined;

    /**
     * Hook that triggers re-render on every index update.
     * Use for advanced cases where you need to manually react to index changes.
     */
    useIndexUpdates(): void;

    // ========== Non-Hook APIs ==========

    /**
     * Synchronous query API (non-hook version).
     * Does not automatically update on index changes.
     *
     * @param query - Datacore query string
     * @returns Array of matching files
     */
    query(query: string): DatacoreFile[];

    /**
     * Import code from a file or codeblock in the vault.
     * Can import from .js/.ts files or from named codeblocks.
     *
     * @param path - Path to file or header link to codeblock
     * @returns Whatever the imported code exports/returns
     */
    require(path: string | any): Promise<any>;

    /**
     * Create a link to a header in a file.
     * Used with dc.require() to import code from codeblocks.
     *
     * @param filePath - Path to the file
     * @param headerName - Name of the header/section
     */
    headerLink(filePath: string, headerName: string): any;

    /**
     * Type coercion utilities for converting Datacore values to specific types
     */
    coerce: {
        /**
         * Coerce a value to a string
         */
        string(value: any): string;

        /**
         * Coerce a value to a number
         */
        number(value: any): number;

        /**
         * Coerce a value to a boolean
         */
        boolean(value: any): boolean;

        /**
         * Coerce a value to a date
         */
        date(value: any): Date | null;

        /**
         * Other coercion methods
         */
        [key: string]: (value: any) => any;
    };

    /**
     * Additional Datacore APIs that may exist
     */
    [key: string]: any;
}

