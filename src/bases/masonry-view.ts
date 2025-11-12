/**
 * Bases Masonry View
 * Masonry layout view using Bases API
 */

import { BasesView, BasesEntry, TFile, QueryController } from 'obsidian';
import { CardData } from '../shared/card-renderer';
import { transformBasesEntries } from '../shared/data-transform';
import { readBasesSettings, getMasonryViewOptions } from '../shared/settings-schema';
import { getFirstBasesPropertyValue, getAllBasesImagePropertyValues } from '../utils/property';
import { getMinCardWidthMasonry, getMinMasonryColumns, getCardSpacing } from '../utils/style-settings';
import { calculateMasonryLayout, applyMasonryLayout } from '../utils/masonry-layout';
import { loadSnippetsForEntries, loadImagesForEntries } from '../shared/content-loader';
import { SharedCardRenderer } from './shared-renderer';
import { BATCH_SIZE } from '../shared/constants';
import type DynamicViewsPlugin from '../../main';
import type { Settings } from '../types';

export const MASONRY_VIEW_TYPE = 'dynamic-views-masonry';

export class DynamicViewsMasonryView extends BasesView {
    readonly type = MASONRY_VIEW_TYPE;
    private containerEl: HTMLElement;
    private plugin: DynamicViewsPlugin;
    private snippets: Record<string, string> = {};
    private images: Record<string, string | string[]> = {};
    private hasImageAvailable: Record<string, boolean> = {};
    private updateLayoutRef: { current: (() => void) | null } = { current: null };
    private focusableCardIndex: number = 0;
    private masonryContainer: HTMLElement | null = null;
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
        // Make container scrollable
        this.containerEl.style.overflowY = 'auto';
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
            const entries = this.data.data;

        // Read settings from Bases config
        const settings = readBasesSettings(
            this.config,
            this.plugin.persistenceManager.getGlobalSettings(),
            this.plugin.persistenceManager.getDefaultViewSettings()
        );

        // Save scroll position before re-rendering
        const savedScrollTop = this.containerEl.scrollTop;

        // Try to find the first visible card to restore position more accurately
        let anchorCardPath: string | null = null;
        if (savedScrollTop > 0 && this.masonryContainer) {
            const cards = this.masonryContainer.querySelectorAll('.card');
            const containerTop = this.containerEl.getBoundingClientRect().top;
            for (const card of Array.from(cards)) {
                const cardTop = (card as HTMLElement).getBoundingClientRect().top;
                if (cardTop >= containerTop - 50) { // First card near or in viewport
                    anchorCardPath = (card as HTMLElement).getAttribute('data-path');
                    break;
                }
            }
        }

        // Transform to CardData (only visible entries)
        const sortMethod = this.getSortMethod();


        // Reset shuffle if sort method changed
        if (this.lastSortMethod !== null && this.lastSortMethod !== sortMethod) {
            this.isShuffled = false;
            this.shuffledOrder = [];
        }
        this.lastSortMethod = sortMethod;

        // Apply shuffled order if enabled
        let orderedEntries = entries;
        if (this.isShuffled && this.shuffledOrder.length > 0) {
            // Sort by shuffled order
            orderedEntries = [...entries].sort((a, b) => {
                const indexA = this.shuffledOrder.indexOf(a.file.path);
                const indexB = this.shuffledOrder.indexOf(b.file.path);
                return indexA - indexB;
            });
        }

        // Slice to displayed count for rendering
        const visibleEntries = orderedEntries.slice(0, this.displayedCount);

        // Load snippets and images ONLY for displayed entries
        await this.loadContentForEntries(visibleEntries, settings);

        const cards = transformBasesEntries(
            visibleEntries,
            settings,
            sortMethod,
            false, // Don't shuffle in transform, we already applied order above
            this.snippets,
            this.images,
            this.hasImageAvailable
        );

        // Clear and re-render
        this.containerEl.empty();

        // Disconnect old property observers before re-rendering
        this.propertyObservers.forEach(obs => obs.disconnect());
        this.propertyObservers = [];

        // Create masonry container
        this.masonryContainer = this.containerEl.createDiv('cards-masonry');

        // Setup masonry layout
        this.setupMasonryLayout(settings);

        // Render each card
        for (let i = 0; i < cards.length; i++) {
            const card = cards[i];
            const entry = visibleEntries[i];
            this.renderCard(this.masonryContainer, card, entry, i, settings);
        }

        // Initial layout calculation
        if (this.updateLayoutRef.current) {
            // Delay to allow images to start loading
            setTimeout(() => {
                if (this.updateLayoutRef.current) {
                    this.updateLayoutRef.current();
                }

                // Restore scroll position AFTER masonry layout completes
                if (savedScrollTop > 0) {
                    requestAnimationFrame(() => {
                        // Try to scroll to anchor card if we found one
                        if (anchorCardPath && this.masonryContainer) {
                            const anchorCard = this.masonryContainer.querySelector(`.card[data-path="${anchorCardPath}"]`) as HTMLElement;
                            if (anchorCard) {
                                // Scroll to anchor card's position
                                const cardTop = anchorCard.offsetTop;
                                this.containerEl.scrollTop = Math.max(0, cardTop - 100);
                                return;
                            }
                        }
                        // Fallback: restore saved scroll position
                        this.containerEl.scrollTop = savedScrollTop;
                    });
                }
            }, 50);
        } else {
            // No masonry layout, restore immediately
            if (savedScrollTop > 0) {
                this.containerEl.scrollTop = savedScrollTop;
            }
        }

        // Setup infinite scroll
        this.setupInfiniteScroll(entries.length);

        // Clear loading flag after async work completes
        this.isLoading = false;
        })();
    }

    private setupMasonryLayout(settings: Settings): void {
        if (!this.masonryContainer) return;

        const minColumns = getMinMasonryColumns();

        // Setup update function using shared masonry logic
        this.updateLayoutRef.current = () => {
            if (!this.masonryContainer) return;

            const cards = Array.from(this.masonryContainer.querySelectorAll<HTMLElement>('.card'));
            if (cards.length === 0) return;

            const containerWidth = this.masonryContainer.clientWidth;

            // Calculate layout using shared logic
            const result = calculateMasonryLayout({
                cards,
                containerWidth,
                cardMinWidth: getMinCardWidthMasonry(),
                minColumns,
                gap: getCardSpacing()
            });

            // Apply layout to DOM
            applyMasonryLayout(this.masonryContainer, cards, result);
        };

        // Setup resize observer
        const resizeObserver = new ResizeObserver(() => {
            if (this.updateLayoutRef.current) {
                this.updateLayoutRef.current();
            }
        });
        resizeObserver.observe(this.masonryContainer);
        this.register(() => resizeObserver.disconnect());

        // Setup window resize listener
        const handleResize = () => {
            if (this.updateLayoutRef.current) {
                this.updateLayoutRef.current();
            }
        };
        window.addEventListener('resize', handleResize);
        this.register(() => window.removeEventListener('resize', handleResize));
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

    private getSortMethod(): string{
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
        // Clean up existing listeners
        if (this.scrollListener) {
            this.containerEl.removeEventListener('scroll', this.scrollListener);
            this.scrollListener = null;
        }
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

        // Skip if all items already displayed
        if (this.displayedCount >= totalEntries) {
            return;
        }


        // Shared load check function
        const checkAndLoad = (trigger: string) => {
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

                // Dynamic batch size based on masonry columns (estimate 3 columns avg, 10 rows per column)
                const batchSize = Math.min(30, 70);
                this.displayedCount = Math.min(this.displayedCount + batchSize, totalEntries);

                // Re-render (this will call setupInfiniteScroll again)
                this.onDataUpdated();
            }
        };

        // Create scroll handler with throttling
        this.scrollListener = () => {
            // Throttle: skip if cooldown active
            if (this.scrollThrottleTimeout !== null) {
                return;
            }

            checkAndLoad('scroll');

            // Start throttle cooldown
            this.scrollThrottleTimeout = window.setTimeout(() => {
                this.scrollThrottleTimeout = null;
            }, 100);
        };

        // Attach scroll listener
        this.containerEl.addEventListener('scroll', this.scrollListener);

        // Setup ResizeObserver on masonry container to detect layout changes
        if (this.masonryContainer) {
            this.resizeObserver = new ResizeObserver(() => {
                // Masonry layout completed, check if need more items
                checkAndLoad('resize');
            });
            this.resizeObserver.observe(this.masonryContainer);
        }

        // Register cleanup
        this.register(() => {
            if (this.scrollListener) {
                this.containerEl.removeEventListener('scroll', this.scrollListener);
            }
            if (this.scrollThrottleTimeout !== null) {
                window.clearTimeout(this.scrollThrottleTimeout);
            }
            if (this.resizeObserver) {
                this.resizeObserver.disconnect();
            }
        });
    }

    onClose(): void {
        this.propertyObservers.forEach(obs => obs.disconnect());
        this.propertyObservers = [];
    }
}

/** Export options for registration */
export const masonryViewOptions = getMasonryViewOptions;
