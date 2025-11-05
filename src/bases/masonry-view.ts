/**
 * Bases Masonry View
 * Masonry layout view using Bases API
 */

import { BasesView, TFile, setIcon } from 'obsidian';
import { CardData } from '../shared/card-renderer';
import { transformBasesEntries } from '../shared/data-transform';
import { readBasesSettings, getMasonryViewOptions } from '../shared/settings-schema';
import { loadImageForFile, isExternalUrl, validateImageUrl } from '../utils/image';
import { sanitizeForPreview } from '../utils/preview';
import { getFirstBasesPropertyValue, getAllBasesImagePropertyValues } from '../utils/property';
import { formatTimestamp, getTimestampIcon } from '../shared/render-utils';
import type DynamicViewsPlugin from '../../main';

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

    constructor(controller: any, containerEl: HTMLElement, plugin: DynamicViewsPlugin) {
        super(controller);
        this.containerEl = containerEl;
        this.plugin = plugin;
        // Add both classes - 'dynamic-views' for CSS styling, 'dynamic-views-bases-container' for identification
        this.containerEl.addClass('dynamic-views');
        this.containerEl.addClass('dynamic-views-bases-container');
        // Make container scrollable
        this.containerEl.style.overflowY = 'auto';
        this.containerEl.style.height = '100%';
        // Set initial batch size based on device
        this.displayedCount = (this.app as any).isMobile ? 25 : 50;
    }

    async onDataUpdated(): Promise<void> {
        const { app } = this;
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
            const cards = this.masonryContainer.querySelectorAll('.writing-card');
            const containerTop = this.containerEl.getBoundingClientRect().top;
            for (const card of Array.from(cards)) {
                const cardTop = (card as HTMLElement).getBoundingClientRect().top;
                if (cardTop >= containerTop - 50) { // First card near or in viewport
                    anchorCardPath = (card as HTMLElement).getAttribute('data-path');
                    break;
                }
            }
        }

        // Slice to displayed count for rendering
        const visibleEntries = entries.slice(0, this.displayedCount);

        // Load snippets and images ONLY for displayed entries
        await this.loadContentForEntries(visibleEntries, settings);

        // Transform to CardData (only visible entries)
        const sortMethod = this.getSortMethod();
        const cards = transformBasesEntries(
            visibleEntries,
            settings,
            sortMethod,
            false, // Bases views don't shuffle
            this.snippets,
            this.images,
            this.hasImageAvailable
        );

        // Clear and re-render
        this.containerEl.empty();

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
                            const anchorCard = this.masonryContainer.querySelector(`.writing-card[data-path="${anchorCardPath}"]`) as HTMLElement;
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
    }

    private setupMasonryLayout(settings: any): void {
        if (!this.masonryContainer) return;

        const minColumns = settings.minMasonryColumns;

        // Setup update function
        this.updateLayoutRef.current = () => {
            if (!this.masonryContainer) return;

            const cards = Array.from(this.masonryContainer.querySelectorAll('.writing-card')) as HTMLElement[];
            if (cards.length === 0) return;

            const containerWidth = this.masonryContainer.clientWidth;
            const cardMinWidth = settings.minCardWidth;
            const gap = 8;

            // Calculate number of columns
            const columns = Math.max(
                minColumns,
                Math.floor((containerWidth + gap) / (cardMinWidth + gap))
            );

            // Calculate actual card width based on columns
            const cardWidth = (containerWidth - (gap * (columns - 1))) / columns;

            // Initialize column heights
            const columnHeights = new Array(columns).fill(0);

            // Position each card
            cards.forEach((card, index) => {
                // Find shortest column
                const shortestColumn = columnHeights.indexOf(Math.min(...columnHeights));

                // Calculate position
                const left = shortestColumn * (cardWidth + gap);
                const top = columnHeights[shortestColumn];

                // Apply positioning
                card.style.width = `${cardWidth}px`;
                card.style.position = 'absolute';
                card.style.left = `${left}px`;
                card.style.top = `${top}px`;
                card.style.transition = index < 50 ? 'none' : 'all 0.3s ease';  // No transition for initial render

                // Update column height
                const cardHeight = card.offsetHeight;
                columnHeights[shortestColumn] += cardHeight + gap;
            });

            // Set container height
            const maxHeight = Math.max(...columnHeights);
            this.masonryContainer!.style.height = `${maxHeight}px`;
            this.masonryContainer!.style.position = 'relative';
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
        entry: any,
        index: number,
        settings: any
    ): void {
        const { app } = this;

        // Create card element
        const cardEl = container.createDiv('writing-card');
        cardEl.setAttribute('data-path', card.path);
        cardEl.style.cursor = 'pointer';

        // Handle card click
        cardEl.addEventListener('click', (e) => {
            if (settings.openFileAction === 'card' &&
                (e.target as HTMLElement).tagName !== 'A' &&
                !(e.target as HTMLElement).closest('a') &&
                (e.target as HTMLElement).tagName !== 'IMG') {
                const newLeaf = e.metaKey || e.ctrlKey;
                app.workspace.openLinkText(card.path, '', newLeaf);
            }
        });

        // Title
        const titleEl = cardEl.createDiv('writing-title');
        const linkEl = titleEl.createEl('a', {
            cls: 'internal-link card-title-link',
            href: card.path,
            attr: { 'data-href': card.path }
        });
        linkEl.createSpan({ cls: 'title-text', text: card.title });

        // Snippet and thumbnail container
        if ((settings.showTextPreview && card.snippet) ||
            (settings.showThumbnails && (card.imageUrl || card.hasImageAvailable))) {
            const snippetContainer = cardEl.createDiv('snippet-container');
            snippetContainer.addClass(`thumbnail-${settings.thumbnailPosition}`);

            // Text preview
            if (settings.showTextPreview && card.snippet) {
                snippetContainer.createDiv({ cls: 'writing-snippet', text: card.snippet });
            }

            // Thumbnail
            if (settings.showThumbnails && card.imageUrl) {
                const imageUrls = Array.isArray(card.imageUrl) ? card.imageUrl : [card.imageUrl];
                const thumbEl = snippetContainer.createDiv('card-thumbnail');

                if (imageUrls.length > 0) {
                    const imgEl = thumbEl.createEl('img', { attr: { src: imageUrls[0], alt: '' } });

                    // Handle image load for masonry layout
                    imgEl.addEventListener('load', () => {
                        if (this.updateLayoutRef.current) {
                            this.updateLayoutRef.current();
                        }
                    });
                }
            } else if (settings.showThumbnails && card.hasImageAvailable) {
                snippetContainer.createDiv('card-thumbnail-placeholder');
            }
        }

        // Metadata - left always wins when both are the same non-none value
        const isDuplicate = settings.metadataDisplayLeft !== 'none' &&
            settings.metadataDisplayLeft === settings.metadataDisplayRight;

        const effectiveLeft = settings.metadataDisplayLeft;
        const effectiveRight = isDuplicate ? 'none' : settings.metadataDisplayRight;

        if (effectiveLeft !== 'none' || effectiveRight !== 'none') {
            const metaEl = cardEl.createDiv('writing-meta');

            // Add class if only one side has content (for full-width styling)
            if (effectiveLeft === 'none' && effectiveRight !== 'none') {
                metaEl.addClass('meta-right-only');
            } else if (effectiveLeft !== 'none' && effectiveRight === 'none') {
                metaEl.addClass('meta-left-only');
            }

            // Left side
            const metaLeft = metaEl.createDiv('meta-left');
            this.renderMetadataContent(metaLeft, effectiveLeft, card, entry, settings);

            // Right side
            const metaRight = metaEl.createDiv('meta-right');
            this.renderMetadataContent(metaRight, effectiveRight, card, entry, settings);
        }
    }

    private renderMetadataContent(
        container: HTMLElement,
        displayType: 'none' | 'timestamp' | 'tags' | 'path',
        card: CardData,
        entry: any,
        settings: any
    ): void {
        if (displayType === 'none') return;

        if (displayType === 'timestamp') {
            // Use resolved displayTimestamp from CardData (already handles custom properties)
            const timestamp = card.displayTimestamp;

            if (timestamp) {
                const date = formatTimestamp(timestamp);
                if (settings.showTimestampIcon) {
                    const sortMethod = this.getSortMethod();
                    const iconName = getTimestampIcon(sortMethod);
                    const iconEl = container.createSpan('timestamp-icon');
                    setIcon(iconEl, iconName);
                }
                container.appendText(date);
            }
        } else if (displayType === 'tags' && card.tags.length > 0) {
            const tagsWrapper = container.createDiv('tags-wrapper');
            card.tags.forEach(tag => {
                tagsWrapper.createEl('a', {
                    cls: 'tag',
                    text: tag.replace(/^#/, ''),
                    href: '#'
                });
            });
        } else if (displayType === 'path' && card.folderPath.length > 0) {
            const pathWrapper = container.createDiv('path-wrapper');
            const folders = card.folderPath.split('/').filter(f => f);
            folders.forEach((folder, idx) => {
                const span = pathWrapper.createSpan();
                span.createSpan({ cls: 'path-segment file-path-segment', text: folder });
                if (idx < folders.length - 1) {
                    span.createSpan({ cls: 'path-separator', text: '/' });
                }
            });
        }
    }

    private getSortMethod(): string{
        // Get sort configuration from Bases
        const sortConfigs = this.config.getSort();

        console.log('// [Bases Sort Debug - Masonry View] getSort() returned:', sortConfigs);
        console.log('// [Bases Sort Debug - Masonry View] Array length:', sortConfigs?.length);

        if (sortConfigs && sortConfigs.length > 0) {
            const firstSort = sortConfigs[0];
            console.log('// [Bases Sort Debug - Masonry View] First sort config:', firstSort);
            console.log('// [Bases Sort Debug - Masonry View] Property:', firstSort.property);
            console.log('// [Bases Sort Debug - Masonry View] Direction:', firstSort.direction);

            const property = firstSort.property;
            const direction = firstSort.direction.toLowerCase();

            // Check for ctime/mtime in property
            if (property.includes('ctime')) {
                const result = `ctime-${direction}`;
                console.log('// [Bases Sort Debug - Masonry View] Detected:', result);
                return result;
            }
            if (property.includes('mtime')) {
                const result = `mtime-${direction}`;
                console.log('// [Bases Sort Debug - Masonry View] Detected:', result);
                return result;
            }
            console.log('// [Bases Sort Debug - Masonry View] Custom property sort, falling back to mtime-desc');
        } else {
            console.log('// [Bases Sort Debug - Masonry View] No sort config, using default mtime-desc');
        }
        return 'mtime-desc';
    }

    private async loadContentForEntries(entries: any[], settings: any): Promise<void> {
        // Load snippets for text preview
        if (settings.showTextPreview) {
            await Promise.all(
                entries.map(async (entry) => {
                    const path = entry.file.path;
                    if (!(path in this.snippets)) {
                        try {
                            // Try to get text preview from property first
                            const descValue = getFirstBasesPropertyValue(entry, settings.descriptionProperty);
                            const hasValidDesc = descValue && descValue.data != null && String(descValue.data).trim().length > 0;

                            if (hasValidDesc) {
                                // Use property value
                                this.snippets[path] = String(descValue.data).trim();
                            } else if (settings.fallbackToContent) {
                                // Fallback to note content
                                const file = this.app.vault.getAbstractFileByPath(path);
                                if (file instanceof TFile && file.extension === 'md') {
                                    const content = await this.app.vault.cachedRead(file);
                                    const snippet = sanitizeForPreview(
                                        content,
                                        settings.omitFirstLine
                                    );
                                    this.snippets[path] = snippet;
                                }
                            } else {
                                // No property and fallback disabled
                                this.snippets[path] = '';
                            }
                        } catch (error) {
                            console.error(`Failed to load snippet for ${path}:`, error);
                            this.snippets[path] = '';
                        }
                    }
                })
            );
        }

        // Load images for thumbnails
        if (settings.showThumbnails) {
            await Promise.all(
                entries.map(async (entry) => {
                    const path = entry.file.path;
                    if (!(path in this.images)) {
                        try {
                            // Get ALL images from ALL comma-separated properties
                            const imageValues = getAllBasesImagePropertyValues(entry, settings.imageProperty);
                            const validImages: string[] = [];

                            for (const imageStr of imageValues) {
                                // Handle external URLs
                                if (isExternalUrl(imageStr)) {
                                    const isValid = await validateImageUrl(imageStr);
                                    if (isValid) {
                                        validImages.push(imageStr);
                                    }
                                } else {
                                    // Handle internal file paths
                                    const result = await loadImageForFile(
                                        this.app,
                                        path,
                                        imageStr,
                                        settings.thumbnailCacheSize,
                                        settings.fallbackToEmbeds,
                                        settings.imageProperty
                                    );

                                    if (result) {
                                        // loadImageForFile can return string or string[]
                                        if (Array.isArray(result)) {
                                            validImages.push(...result);
                                        } else {
                                            validImages.push(result);
                                        }
                                    }
                                }
                            }

                            if (validImages.length > 0) {
                                // Store as array if multiple, string if single
                                this.images[path] = validImages.length > 1 ? validImages : validImages[0];
                                this.hasImageAvailable[path] = true;
                            }
                        } catch (error) {
                            console.error(`Failed to load image for ${path}:`, error);
                        }
                    }
                })
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
            console.log('// [InfiniteScroll] All items displayed, skipping setup');
            return;
        }

        console.log(`// [InfiniteScroll] Setting up scroll listener (${this.displayedCount}/${totalEntries} items)`);

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
            const isMobile = (this.app as any).isMobile;
            const viewportMultiplier = isMobile ? 1 : 2;
            const threshold = clientHeight * viewportMultiplier;

            // Check if should load more
            if (distanceFromBottom < threshold && this.displayedCount < totalEntries) {
                console.log(`// [InfiniteScroll] Loading more items [${trigger}] (distance: ${distanceFromBottom.toFixed(0)}px, threshold: ${threshold.toFixed(0)}px)`);
                this.isLoading = true;

                // Dynamic batch size based on masonry columns (estimate 3 columns avg, 10 rows per column)
                const batchSize = Math.min(30, 70);
                this.displayedCount = Math.min(this.displayedCount + batchSize, totalEntries);
                console.log(`// [InfiniteScroll] New displayedCount: ${this.displayedCount}/${totalEntries}`);

                // Re-render (this will call setupInfiniteScroll again)
                this.onDataUpdated().then(() => {
                    this.isLoading = false;
                });
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
}

/** Export options for registration */
export const masonryViewOptions = getMasonryViewOptions;
