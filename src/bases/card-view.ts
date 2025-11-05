/**
 * Bases Card View
 * Primary implementation using Bases API
 */

import { BasesView, TFile, setIcon } from 'obsidian';
import { CardData } from '../shared/card-renderer';
import { transformBasesEntries } from '../shared/data-transform';
import { readBasesSettings, getBasesViewOptions } from '../shared/settings-schema';
import { loadImageForFile, isExternalUrl, validateImageUrl } from '../utils/image';
import { sanitizeForPreview } from '../utils/preview';
import { getFirstBasesPropertyValue, getAllBasesImagePropertyValues } from '../utils/property';
import { formatTimestamp, getTimestampIcon } from '../shared/render-utils';
import type DynamicViewsPlugin from '../../main';

export const CARD_VIEW_TYPE = 'dynamic-views-card';

export class DynamicViewsCardView extends BasesView {
    readonly type = CARD_VIEW_TYPE;
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
        console.log('// DEBUG: card-view onDataUpdated() CALLED');
        const { app } = this;
        const entries = this.data.data;

        // Read settings from Bases config
        const settings = readBasesSettings(
            this.config,
            this.plugin.persistenceManager.getGlobalSettings(),
            this.plugin.persistenceManager.getDefaultViewSettings()
        );

        // Calculate grid columns
        const containerWidth = this.containerEl.clientWidth;
        const cardMinWidth = settings.minCardWidth;
        const minColumns = settings.minGridColumns;
        const gap = 8;
        const cols = Math.max(minColumns, Math.floor((containerWidth + gap) / (cardMinWidth + gap)));
        const cardWidth = (containerWidth - (gap * (cols - 1))) / cols;

        // Set CSS variables for grid layout
        this.containerEl.style.setProperty('--card-min-width', `${cardWidth}px`);
        this.containerEl.style.setProperty('--grid-columns', String(cols));

        // Save scroll position before re-rendering
        const savedScrollTop = this.containerEl.scrollTop;

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

        // Create cards feed container
        const feedEl = this.containerEl.createDiv('cards-feed');

        // Render each card
        for (let i = 0; i < cards.length; i++) {
            const card = cards[i];
            const entry = visibleEntries[i];
            this.renderCard(feedEl, card, entry, i, settings);
        }

        // Restore scroll position after rendering
        if (savedScrollTop > 0) {
            this.containerEl.scrollTop = savedScrollTop;
        }

        // Setup infinite scroll
        this.setupInfiniteScroll(entries.length);

        // Setup ResizeObserver for dynamic grid updates
        if (!this.resizeObserver) {
            this.resizeObserver = new ResizeObserver(() => {
                // Re-read settings to get current values
                const settings = readBasesSettings(
                    this.config,
                    this.plugin.persistenceManager.getGlobalSettings(),
                    this.plugin.persistenceManager.getDefaultViewSettings()
                );

                const containerWidth = this.containerEl.clientWidth;
                const cardMinWidth = settings.minCardWidth;
                const minColumns = settings.minGridColumns;
                const gap = 8;
                const cols = Math.max(minColumns, Math.floor((containerWidth + gap) / (cardMinWidth + gap)));
                const cardWidth = (containerWidth - (gap * (cols - 1))) / cols;

                this.containerEl.style.setProperty('--card-min-width', `${cardWidth}px`);
                this.containerEl.style.setProperty('--grid-columns', String(cols));
            });
            this.resizeObserver.observe(this.containerEl);
        }
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

    private getSortMethod(): string {
        // Get sort configuration from Bases
        const sortConfigs = this.config.getSort();

        console.log('// [Bases Sort Debug - Card View] getSort() returned:', sortConfigs);
        console.log('// [Bases Sort Debug - Card View] Array length:', sortConfigs?.length);

        if (sortConfigs && sortConfigs.length > 0) {
            const firstSort = sortConfigs[0];
            console.log('// [Bases Sort Debug - Card View] First sort config:', firstSort);
            console.log('// [Bases Sort Debug - Card View] Property:', firstSort.property);
            console.log('// [Bases Sort Debug - Card View] Direction:', firstSort.direction);

            const property = firstSort.property;
            const direction = firstSort.direction.toLowerCase();

            // Check for ctime/mtime in property
            if (property.includes('ctime')) {
                const result = `ctime-${direction}`;
                console.log('// [Bases Sort Debug - Card View] Detected:', result);
                return result;
            }
            if (property.includes('mtime')) {
                const result = `mtime-${direction}`;
                console.log('// [Bases Sort Debug - Card View] Detected:', result);
                return result;
            }
            console.log('// [Bases Sort Debug - Card View] Custom property sort, falling back to mtime-desc');
        } else {
            console.log('// [Bases Sort Debug - Card View] No sort config, using default mtime-desc');
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
                                        settings.thumbnailCacheSize
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
        // Clean up existing listener
        if (this.scrollListener) {
            this.containerEl.removeEventListener('scroll', this.scrollListener);
            this.scrollListener = null;
        }

        // Skip if all items already displayed
        if (this.displayedCount >= totalEntries) {
            console.log('// [InfiniteScroll] All items displayed, skipping setup');
            return;
        }

        console.log(`// [InfiniteScroll] Setting up scroll listener (${this.displayedCount}/${totalEntries} items)`);

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
            const isMobile = (this.app as any).isMobile;
            const viewportMultiplier = isMobile ? 1 : 2;
            const threshold = clientHeight * viewportMultiplier;

            // Check if should load more
            if (distanceFromBottom < threshold && this.displayedCount < totalEntries) {
                console.log(`// [InfiniteScroll] Loading more items (distance: ${distanceFromBottom.toFixed(0)}px, threshold: ${threshold.toFixed(0)}px)`);
                this.isLoading = true;

                // Dynamic batch size: 50 items (simple for card view)
                const batchSize = 50;
                this.displayedCount = Math.min(this.displayedCount + batchSize, totalEntries);
                console.log(`// [InfiniteScroll] New displayedCount: ${this.displayedCount}/${totalEntries}`);

                // Re-render (this will call setupInfiniteScroll again)
                this.onDataUpdated().then(() => {
                    this.isLoading = false;
                });
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
    }
}

/** Export options for registration */
export const cardViewOptions = getBasesViewOptions;
