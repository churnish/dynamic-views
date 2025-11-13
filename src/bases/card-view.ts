/**
 * Bases Card View
 * Primary implementation using Bases API
 */

import { BasesView, BasesEntry, TFile, QueryController } from 'obsidian';
import { CardData } from '../shared/card-renderer';
import { transformBasesEntries } from '../shared/data-transform';
import { readBasesSettings, getBasesViewOptions } from '../shared/settings-schema';
import { getFirstBasesPropertyValue, getAllBasesImagePropertyValues } from '../utils/property';
import { getMinCardWidthGrid, getMinGridColumns } from '../utils/style-settings';
import { loadSnippetsForEntries, loadImagesForEntries } from '../shared/content-loader';
import { SharedCardRenderer } from './shared-renderer';
import { BATCH_SIZE, GAP_SIZE } from '../shared/constants';
import type DynamicViewsPlugin from '../../main';
import type { Settings } from '../types';

// Extend App type to include isMobile property
declare module 'obsidian' {
    interface App {
        isMobile: boolean;
    }
}

export const GRID_VIEW_TYPE = 'dynamic-views-grid';

export class DynamicViewsCardView extends BasesView {
    readonly type = GRID_VIEW_TYPE;
    private containerEl: HTMLElement;
    private plugin: DynamicViewsPlugin;
    private snippets: Record<string, string> = {};
    private images: Record<string, string | string[]> = {};
    private hasImageAvailable: Record<string, boolean> = {};
    private updateLayoutRef: { current: (() => void) | null } = { current: null };
    private focusableCardIndex: number = 0;
    private displayedCount: number = 50;
    private isLoading: boolean = false;
    private scrollListener: (() => void) | null = null;
    private scrollThrottleTimeout: number | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private propertyObservers: ResizeObserver[] = [];
    private cardRenderer: SharedCardRenderer;
    isShuffled: boolean = false;
    shuffledOrder: string[] = [];
    private lastSortMethod: string | null = null;

    // Style Settings compatibility - must be own property (not prototype)
    setSettings = (): void => {
        // No-op: MutationObserver handles updates
    };

    constructor(controller: QueryController, containerEl: HTMLElement, plugin: DynamicViewsPlugin) {
        super(controller);
        this.containerEl = containerEl;
        this.plugin = plugin;
        // Initialize shared card renderer
        this.cardRenderer = new SharedCardRenderer(
            this.app,
            this.plugin,
            this.propertyObservers,
            this.updateLayoutRef
        );
        // Add both classes - 'dynamic-views' for CSS styling, 'dynamic-views-bases-container' for identification
        this.containerEl.addClass('dynamic-views');
        this.containerEl.addClass('dynamic-views-bases-container');
        // Make container scrollable vertically, hidden horizontally
        this.containerEl.style.overflowY = 'auto';
        this.containerEl.style.overflowX = 'hidden';
        this.containerEl.style.height = '100%';
        // Set initial batch size based on device
        this.displayedCount = this.app.isMobile ? 25 : BATCH_SIZE;

        // Watch for Dynamic Views Style Settings changes only
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    // Check if any dynamic-views class changed
                    const oldClasses = mutation.oldValue?.split(' ') || [];
                    const newClasses = document.body.className.split(' ');
                    const dynamicViewsChanged =
                        oldClasses.filter(c => c.startsWith('dynamic-views-')).sort().join() !==
                        newClasses.filter(c => c.startsWith('dynamic-views-')).sort().join();

                    if (dynamicViewsChanged) {
                        this.onDataUpdated();
                        break;
                    }
                }
            }
        });

        observer.observe(document.body, {
            attributes: true,
            attributeOldValue: true,
            attributeFilter: ['class']
        });

        this.register(() => observer.disconnect());
    }

    onDataUpdated(): void {
        void (async () => {
            const groupedData = this.data.groupedData;
            const allEntries = this.data.data;

        // Read settings from Bases config
        const settings = readBasesSettings(
            this.config,
            this.plugin.persistenceManager.getGlobalSettings(),
            this.plugin.persistenceManager.getDefaultViewSettings()
        );

        // Calculate grid columns
        const containerWidth = this.containerEl.clientWidth;
        const cardMinWidth = getMinCardWidthGrid();
        const minColumns = getMinGridColumns();
        const gap = GAP_SIZE;
        const cols = Math.max(minColumns, Math.floor((containerWidth + gap) / (cardMinWidth + gap)));
        const cardWidth = (containerWidth - (gap * (cols - 1))) / cols;

        // Set CSS variables for grid layout
        this.containerEl.style.setProperty('--card-min-width', `${cardWidth}px`);
        this.containerEl.style.setProperty('--grid-columns', String(cols));

        // Save scroll position before re-rendering
        const savedScrollTop = this.containerEl.scrollTop;

        // Transform to CardData (only visible entries)
        const sortMethod = this.getSortMethod();


        // Reset shuffle if sort method changed
        if (this.lastSortMethod !== null && this.lastSortMethod !== sortMethod) {
            this.isShuffled = false;
            this.shuffledOrder = [];
        }
        this.lastSortMethod = sortMethod;

        // Process groups and apply shuffle within groups if enabled
        const processedGroups = groupedData.map(group => {
            let groupEntries = [...group.entries];

            if (this.isShuffled && this.shuffledOrder.length > 0) {
                // Sort by shuffled order within this group
                groupEntries = groupEntries.sort((a, b) => {
                    const indexA = this.shuffledOrder.indexOf(a.file.path);
                    const indexB = this.shuffledOrder.indexOf(b.file.path);
                    return indexA - indexB;
                });
            }

            return { group, entries: groupEntries };
        });

        // Collect visible entries across all groups (up to displayedCount)
        const visibleEntries: BasesEntry[] = [];
        let remainingCount = this.displayedCount;

        for (const processedGroup of processedGroups) {
            if (remainingCount <= 0) break;
            const entriesToTake = Math.min(processedGroup.entries.length, remainingCount);
            visibleEntries.push(...processedGroup.entries.slice(0, entriesToTake));
            remainingCount -= entriesToTake;
        }

        // Load snippets and images ONLY for displayed entries
        await this.loadContentForEntries(visibleEntries, settings);

        // Clear and re-render
        this.containerEl.empty();

        // Disconnect old property observers before re-rendering
        this.propertyObservers.forEach(obs => obs.disconnect());
        this.propertyObservers = [];

        // Create cards feed container
        const feedEl = this.containerEl.createDiv('dynamic-views-grid');

        // Render groups with headers
        let displayedSoFar = 0;
        for (const processedGroup of processedGroups) {
            if (displayedSoFar >= this.displayedCount) break;

            const entriesToDisplay = Math.min(processedGroup.entries.length, this.displayedCount - displayedSoFar);
            if (entriesToDisplay === 0) continue;

            const groupEntries = processedGroup.entries.slice(0, entriesToDisplay);

            // Create group container
            const groupEl = feedEl.createDiv('dynamic-views-group');

            // Render group header if key exists
            if (processedGroup.group.hasKey()) {
                const headerEl = groupEl.createDiv('bases-group-heading');

                // Add group property label if groupBy is configured
                // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
                const groupBy = (this.config as any).groupBy;
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                if (groupBy?.property) {
                    const propertyEl = headerEl.createDiv('bases-group-property');
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
                    const propertyName = this.config.getDisplayName(groupBy.property);
                    propertyEl.setText(propertyName);
                }

                // Add group value
                const valueEl = headerEl.createDiv('bases-group-value');
                const keyValue = processedGroup.group.key?.toString() || '';
                valueEl.setText(keyValue);
            }

            // Render cards in this group
            const cards = transformBasesEntries(
                groupEntries,
                settings,
                sortMethod,
                false,
                this.snippets,
                this.images,
                this.hasImageAvailable
            );

            for (let i = 0; i < cards.length; i++) {
                const card = cards[i];
                const entry = groupEntries[i];
                this.renderCard(groupEl, card, entry, displayedSoFar + i, settings);
            }

            displayedSoFar += entriesToDisplay;
        }

        // Restore scroll position after rendering
        if (savedScrollTop > 0) {
            this.containerEl.scrollTop = savedScrollTop;
        }

        // Setup infinite scroll
        this.setupInfiniteScroll(allEntries.length);

        // Setup ResizeObserver for dynamic grid updates
        if (!this.resizeObserver) {
            this.resizeObserver = new ResizeObserver(() => {
                const containerWidth = this.containerEl.clientWidth;
                const cardMinWidth = getMinCardWidthGrid();
                const minColumns = getMinGridColumns();
                const gap = GAP_SIZE;
                const cols = Math.max(minColumns, Math.floor((containerWidth + gap) / (cardMinWidth + gap)));
                const cardWidth = (containerWidth - (gap * (cols - 1))) / cols;

                this.containerEl.style.setProperty('--card-min-width', `${cardWidth}px`);
                this.containerEl.style.setProperty('--grid-columns', String(cols));
            });
            this.resizeObserver.observe(this.containerEl);
        }

        // Clear loading flag after async work completes
        this.isLoading = false;
        })();
    }

    private renderCard(
        container: HTMLElement,
        card: CardData,
        entry: BasesEntry,
        index: number,
        settings: Settings
    ): void {
        this.cardRenderer.renderCard(container, card, entry, settings, this);
    }

    private getSortMethod(): string {
        // Get sort configuration from Bases
        const sortConfigs = this.config.getSort();


        if (sortConfigs && sortConfigs.length > 0) {
            const firstSort = sortConfigs[0];

            const property = firstSort.property;
            const direction = firstSort.direction.toLowerCase();

            // Check for ctime/mtime in property
            if (property.includes('ctime')) {
                const result = `ctime-${direction}`;
                return result;
            }
            if (property.includes('mtime')) {
                const result = `mtime-${direction}`;
                return result;
            }
        }
        return 'mtime-desc';
    }

    private async loadContentForEntries(entries: BasesEntry[], settings: Settings): Promise<void> {
        // Load snippets for text preview
        if (settings.showTextPreview) {
            // Prepare entries for snippet loading
            const snippetEntries = entries
                .filter(entry => !(entry.file.path in this.snippets))
                .map(entry => {
                    const file = this.app.vault.getAbstractFileByPath(entry.file.path);
                    if (!(file instanceof TFile)) return null;

                    const descValue = getFirstBasesPropertyValue(entry, settings.descriptionProperty) as { data?: unknown } | null;
                    return {
                        path: entry.file.path,
                        file,
                        descriptionData: descValue?.data
                    };
                })
                .filter((e): e is { path: string; file: TFile; descriptionData: unknown } => e !== null);

            await loadSnippetsForEntries(
                snippetEntries,
                settings.fallbackToContent,
                settings.omitFirstLine,
                this.app,
                this.snippets
            );
        }

        // Load images for thumbnails
        if (settings.imageFormat !== 'none') {
            // Prepare entries for image loading
            const imageEntries = entries
                .filter(entry => !(entry.file.path in this.images))
                .map(entry => {
                    const file = this.app.vault.getAbstractFileByPath(entry.file.path);
                    if (!(file instanceof TFile)) return null;

                    const imagePropertyValues = getAllBasesImagePropertyValues(entry, settings.imageProperty);
                    return {
                        path: entry.file.path,
                        file,
                        imagePropertyValues: imagePropertyValues as unknown[]
                    };
                })
                .filter((e): e is NonNullable<typeof e> => e !== null);

            await loadImagesForEntries(
                imageEntries,
                settings.fallbackToEmbeds,
                this.app,
                this.images,
                this.hasImageAvailable
            );
        }
    }

    private setupInfiniteScroll(totalEntries: number): void {
        // Clean up existing listener
        if (this.scrollListener) {
            this.containerEl.removeEventListener('scroll', this.scrollListener);
            this.scrollListener = null;
        }

        // Skip if all items already displayed
        if (this.displayedCount >= totalEntries) {
            return;
        }


        // Create scroll handler with throttling
        this.scrollListener = () => {
            // Throttle: skip if cooldown active
            if (this.scrollThrottleTimeout !== null) {
                return;
            }

            // Skip if already loading
            if (this.isLoading) {
                return;
            }

            // Calculate distance from bottom
            const scrollTop = this.containerEl.scrollTop;
            const scrollHeight = this.containerEl.scrollHeight;
            const clientHeight = this.containerEl.clientHeight;
            const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);

            // Dynamic threshold based on viewport and device
            const isMobile = this.app.isMobile;
            const viewportMultiplier = isMobile ? 1 : 2;
            const threshold = clientHeight * viewportMultiplier;

            // Check if should load more
            if (distanceFromBottom < threshold && this.displayedCount < totalEntries) {
                this.isLoading = true;

                // Dynamic batch size: 50 items (simple for card view)
                const batchSize = 50;
                this.displayedCount = Math.min(this.displayedCount + batchSize, totalEntries);

                // Re-render (this will call setupInfiniteScroll again)
                this.onDataUpdated();
            }

            // Start throttle cooldown
            this.scrollThrottleTimeout = window.setTimeout(() => {
                this.scrollThrottleTimeout = null;
            }, 100);
        };

        // Attach listener
        this.containerEl.addEventListener('scroll', this.scrollListener);

        // Register cleanup
        this.register(() => {
            if (this.scrollListener) {
                this.containerEl.removeEventListener('scroll', this.scrollListener);
            }
            if (this.scrollThrottleTimeout !== null) {
                window.clearTimeout(this.scrollThrottleTimeout);
            }
        });
    }

    onClose(): void {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
        this.propertyObservers.forEach(obs => obs.disconnect());
        this.propertyObservers = [];
    }
}

/** Export options for registration */
export const cardViewOptions = getBasesViewOptions;
