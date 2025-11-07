/**
 * Bases Card View
 * Primary implementation using Bases API
 */

import { BasesView, BasesEntry, TFile, setIcon, QueryController } from 'obsidian';
import { CardData } from '../shared/card-renderer';
import { transformBasesEntries } from '../shared/data-transform';
import { readBasesSettings, getBasesViewOptions } from '../shared/settings-schema';
import { processImagePaths, resolveInternalImagePaths, extractEmbedImages } from '../utils/image';
import { loadFilePreview } from '../utils/preview';
import { getFirstBasesPropertyValue, getAllBasesImagePropertyValues } from '../utils/property';
import { formatTimestamp, getTimestampIcon } from '../shared/render-utils';
import type DynamicViewsPlugin from '../../main';
import type { Settings } from '../types';

// Extend App type to include isMobile property
declare module 'obsidian' {
    interface App {
        isMobile: boolean;
    }
}

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
    private metadataObservers: ResizeObserver[] = [];
    isShuffled: boolean = false;
    shuffledOrder: string[] = [];
    private lastSortMethod: string | null = null;

    constructor(controller: QueryController, containerEl: HTMLElement, plugin: DynamicViewsPlugin) {
        super(controller);
        this.containerEl = containerEl;
        this.plugin = plugin;
        // Add both classes - 'dynamic-views' for CSS styling, 'dynamic-views-bases-container' for identification
        this.containerEl.addClass('dynamic-views');
        this.containerEl.addClass('dynamic-views-bases-container');
        // Make container scrollable vertically, hidden horizontally
        this.containerEl.style.overflowY = 'auto';
        this.containerEl.style.overflowX = 'hidden';
        this.containerEl.style.height = '100%';
        // Set initial batch size based on device
        this.displayedCount = this.app.isMobile ? 25 : 50;
    }

    onDataUpdated(): void {
        void (async () => {
            console.log('// DEBUG: card-view onDataUpdated() CALLED');
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

        // Transform to CardData (only visible entries)
        const sortMethod = this.getSortMethod();

        console.log('// [Shuffle Debug] card-view onDataUpdated - sortMethod:', sortMethod);
        console.log('// [Shuffle Debug] lastSortMethod:', this.lastSortMethod);
        console.log('// [Shuffle Debug] isShuffled:', this.isShuffled);
        console.log('// [Shuffle Debug] shuffledOrder.length:', this.shuffledOrder.length);

        // Reset shuffle if sort method changed
        if (this.lastSortMethod !== null && this.lastSortMethod !== sortMethod) {
            console.log('// [Shuffle Debug] Sort method changed, resetting shuffle');
            this.isShuffled = false;
            this.shuffledOrder = [];
        }
        this.lastSortMethod = sortMethod;

        // Apply shuffled order if enabled
        let orderedEntries = entries;
        if (this.isShuffled && this.shuffledOrder.length > 0) {
            console.log('// [Shuffle Debug] Applying shuffled order to', entries.length, 'entries');
            // Sort by shuffled order
            orderedEntries = [...entries].sort((a, b) => {
                const indexA = this.shuffledOrder.indexOf(a.file.path);
                const indexB = this.shuffledOrder.indexOf(b.file.path);
                return indexA - indexB;
            });
            console.log('// [Shuffle Debug] First 3 ordered paths:', orderedEntries.slice(0, 3).map(e => e.file.path));
        } else {
            console.log('// [Shuffle Debug] NOT applying shuffle - isShuffled:', this.isShuffled, 'shuffledOrder.length:', this.shuffledOrder.length);
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

        // Disconnect old metadata observers before re-rendering
        console.log('// [MetadataLayout] Cleaning up', this.metadataObservers.length, 'observers before re-render');
        this.metadataObservers.forEach(obs => obs.disconnect());
        this.metadataObservers = [];

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

        // Clear loading flag after async work completes
        this.isLoading = false;
        })();
    }

    private measureMetadataLayout(metaEl: HTMLElement, metaLeft: HTMLElement, metaRight: HTMLElement): void {
        // Step 1: Enter measuring state to remove ALL constraints
        metaEl.removeClass('meta-measured');
        metaEl.addClass('meta-measuring');

        // Step 2: Force reflow to apply measuring state
        void metaEl.offsetWidth;

        // Step 3: Measure TRUE unconstrained content widths
        // Measure inner content containers, not outer wrappers
        const leftInner = metaLeft.querySelector('.tags-wrapper, .path-wrapper, span') as HTMLElement;
        const rightInner = metaRight.querySelector('.tags-wrapper, .path-wrapper, span') as HTMLElement;

        const leftScrollWidth = leftInner ? leftInner.scrollWidth : 0;
        const rightScrollWidth = rightInner ? rightInner.scrollWidth : 0;
        const containerWidth = metaEl.clientWidth;

        const leftPercent = (leftScrollWidth / containerWidth) * 100;
        const rightPercent = (rightScrollWidth / containerWidth) * 100;

        console.log(`// [MetadataLayout] TRUE unconstrained measurement: containerWidth=${containerWidth}px, leftScrollWidth=${leftScrollWidth}px (${leftPercent.toFixed(1)}%), rightScrollWidth=${rightScrollWidth}px (${rightPercent.toFixed(1)}%)`);

        // Step 4: Calculate optimal widths based on conditional logic
        let leftWidth: string;
        let rightWidth: string;
        let strategy: string;

        if (leftPercent <= 50 && rightPercent <= 50) {
            // Both content fits: left gets exact size, right fills remainder to ensure full width
            leftWidth = `${leftScrollWidth}px`;
            rightWidth = `${containerWidth - leftScrollWidth}px`;
            strategy = 'both-fit';
        } else if (leftPercent <= 50 && rightPercent > 50) {
            // Left small, right needs more: left gets exact size, right fills remainder
            leftWidth = `${leftScrollWidth}px`;
            rightWidth = `${containerWidth - leftScrollWidth}px`;
            strategy = 'left-small';
        } else if (leftPercent > 50 && rightPercent <= 50) {
            // Right small, left needs more: right gets exact size, left fills remainder
            leftWidth = `${containerWidth - rightScrollWidth}px`;
            rightWidth = `${rightScrollWidth}px`;
            strategy = 'right-small';
        } else {
            // Both >50%: split 50-50
            const half = containerWidth / 2;
            leftWidth = `${half}px`;
            rightWidth = `${half}px`;
            strategy = '50-50';
        }

        // Step 5: Exit measuring state, apply calculated values
        metaEl.removeClass('meta-measuring');
        metaEl.style.setProperty('--meta-left-width', leftWidth);
        metaEl.style.setProperty('--meta-right-width', rightWidth);
        metaEl.addClass('meta-measured');

        console.log('// [MetadataLayout] Strategy:', strategy);
        console.log('// [MetadataLayout] Set widths:', leftWidth, rightWidth);
        console.log('// [MetadataLayout] New grid template:', getComputedStyle(metaEl).gridTemplateColumns);

        // Step 6: Verify layout after applying measured widths
        requestAnimationFrame(() => {
            console.log('// [MetadataLayout] Grid item actual widths:', metaLeft.clientWidth, metaRight.clientWidth);
            console.log('// [MetadataLayout] Inner container widths:', leftInner?.clientWidth, rightInner?.clientWidth);
            console.log('// [MetadataLayout] Overflow detected:',
                leftInner && leftInner.scrollWidth > leftInner.clientWidth,
                rightInner && rightInner.scrollWidth > rightInner.clientWidth);
        });
    }

    private renderCard(
        container: HTMLElement,
        card: CardData,
        entry: BasesEntry,
        index: number,
        settings: Settings
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
                void app.workspace.openLinkText(card.path, '', newLeaf);
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

        console.log(`// [DEBUG Setup] File: ${card.path}, effectiveLeft: ${effectiveLeft}, effectiveRight: ${effectiveRight}, isDuplicate: ${isDuplicate}`);

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

            // Check if content actually rendered (not just settings configured)
            const hasLeftContent = metaLeft.children.length > 0 || metaLeft.textContent?.trim().length > 0;
            const hasRightContent = metaRight.children.length > 0 || metaRight.textContent?.trim().length > 0;

            console.log(`// [DEBUG Content] File: ${card.path}, hasLeftContent: ${hasLeftContent}, hasRightContent: ${hasRightContent}`);

            // Update classes based on actual content
            if (!hasLeftContent && hasRightContent) {
                metaEl.removeClass('meta-left-only');
                metaEl.addClass('meta-right-only');
            } else if (hasLeftContent && !hasRightContent) {
                metaEl.removeClass('meta-right-only');
                metaEl.addClass('meta-left-only');
            }

            // Setup dynamic layout measurement only if both sides actually have content
            console.log(`// [DEBUG Condition] Checking: hasLeftContent=${hasLeftContent} && hasRightContent=${hasRightContent} =`, hasLeftContent && hasRightContent);
            if (hasLeftContent && hasRightContent) {
                const cardPath = cardEl.getAttribute('data-path');
                console.log('// [MetadataLayout] Setting up measurement for card:', cardPath);

                // Initial measurement after DOM paint
                requestAnimationFrame(() => {
                    console.log('// [MetadataLayout] Initial measurement (requestAnimationFrame) for:', cardPath);
                    this.measureMetadataLayout(metaEl, metaLeft, metaRight);
                });

                // Re-measure on resize
                const observer = new ResizeObserver(() => {
                    console.log('// [MetadataLayout] ResizeObserver triggered for:', cardPath);
                    this.measureMetadataLayout(metaEl, metaLeft, metaRight);
                });
                observer.observe(metaEl);

                // Store for cleanup
                this.metadataObservers.push(observer);
                console.log('// [MetadataLayout] Observer count:', this.metadataObservers.length);
            }

            // Setup scroll gradients for tags and paths
            this.setupScrollGradients(cardEl);
        }
    }

    private updateScrollGradient(element: HTMLElement): void {
        // Apply gradient classes to parent container, not scrollable element
        const parent = element.parentElement;
        if (!parent) return;

        const isScrollable = element.scrollWidth > element.clientWidth;

        if (!isScrollable) {
            // Not scrollable - remove all gradient classes from parent
            parent.removeClass('scroll-gradient-left');
            parent.removeClass('scroll-gradient-right');
            parent.removeClass('scroll-gradient-both');
            return;
        }

        const scrollLeft = element.scrollLeft;
        const scrollWidth = element.scrollWidth;
        const clientWidth = element.clientWidth;
        const atStart = scrollLeft <= 1; // Allow 1px tolerance
        const atEnd = scrollLeft + clientWidth >= scrollWidth - 1; // Allow 1px tolerance

        // Remove all gradient classes first from parent
        parent.removeClass('scroll-gradient-left');
        parent.removeClass('scroll-gradient-right');
        parent.removeClass('scroll-gradient-both');

        // Apply appropriate gradient based on position to parent
        if (atStart && !atEnd) {
            // At start, content extends right
            parent.addClass('scroll-gradient-right');
        } else if (atEnd && !atStart) {
            // At end, content extends left
            parent.addClass('scroll-gradient-left');
        } else if (!atStart && !atEnd) {
            // In middle, content extends both directions
            parent.addClass('scroll-gradient-both');
        }
        // If atStart && atEnd, content fits fully - no gradient
    }

    private setupScrollGradients(container: HTMLElement): void {
        // Find all scrollable elements (tags and paths)
        const scrollables = container.querySelectorAll('.tags-wrapper, .path-wrapper');

        scrollables.forEach((el) => {
            const element = el as HTMLElement;

            // Initial gradient update
            this.updateScrollGradient(element);

            // Update on scroll
            element.addEventListener('scroll', () => {
                this.updateScrollGradient(element);
            });
        });
    }

    private renderMetadataContent(
        container: HTMLElement,
        displayType: 'none' | 'timestamp' | 'tags' | 'path',
        card: CardData,
        entry: BasesEntry,
        settings: Settings
    ): void {
        console.log(`// [DEBUG Render] File: ${card.path}, displayType: ${displayType}, tags:`, card.tags, 'length:', card.tags.length);
        if (displayType === 'none') return;

        if (displayType === 'timestamp') {
            // Use resolved displayTimestamp from CardData (already handles custom properties)
            const timestamp = card.displayTimestamp;

            if (timestamp) {
                const date = formatTimestamp(timestamp);
                // Wrap in span for proper measurement
                const timestampWrapper = container.createSpan();
                if (settings.showTimestampIcon) {
                    const sortMethod = this.getSortMethod();
                    const iconName = getTimestampIcon(sortMethod);
                    const iconEl = timestampWrapper.createSpan('timestamp-icon');
                    setIcon(iconEl, iconName);
                }
                timestampWrapper.appendText(date);
            }
        } else if (displayType === 'tags' && card.tags.length > 0) {
            console.log(`// [DEBUG Render] Rendering tags for ${card.path}:`, card.tags);
            const tagsWrapper = container.createDiv('tags-wrapper');
            card.tags.forEach(tag => {
                tagsWrapper.createEl('a', {
                    cls: 'tag',
                    text: tag.replace(/^#/, ''),
                    href: '#'
                });
            });
        } else if (displayType === 'tags') {
            console.log(`// [DEBUG Render] Tags displayType but no tags for ${card.path}, tags.length:`, card.tags.length);
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

        // console.log('// [Bases Sort Debug - Card View] getSort() returned:', sortConfigs);
        // console.log('// [Bases Sort Debug - Card View] Array length:', sortConfigs?.length);

        if (sortConfigs && sortConfigs.length > 0) {
            const firstSort = sortConfigs[0];
            // console.log('// [Bases Sort Debug - Card View] First sort config:', firstSort);
            // console.log('// [Bases Sort Debug - Card View] Property:', firstSort.property);
            // console.log('// [Bases Sort Debug - Card View] Direction:', firstSort.direction);

            const property = firstSort.property;
            const direction = firstSort.direction.toLowerCase();

            // Check for ctime/mtime in property
            if (property.includes('ctime')) {
                const result = `ctime-${direction}`;
                // console.log('// [Bases Sort Debug - Card View] Detected:', result);
                return result;
            }
            if (property.includes('mtime')) {
                const result = `mtime-${direction}`;
                // console.log('// [Bases Sort Debug - Card View] Detected:', result);
                return result;
            }
            // console.log('// [Bases Sort Debug - Card View] Custom property sort, falling back to mtime-desc');
        } else {
            // console.log('// [Bases Sort Debug - Card View] No sort config, using default mtime-desc');
        }
        return 'mtime-desc';
    }

    private async loadContentForEntries(entries: BasesEntry[], settings: Settings): Promise<void> {
        // Load snippets for text preview
        if (settings.showTextPreview) {
            await Promise.all(
                entries.map(async (entry) => {
                    const path = entry.file.path;
                    if (!(path in this.snippets)) {
                        try {
                            const file = this.app.vault.getAbstractFileByPath(path);
                            if (file instanceof TFile && file.extension === 'md') {
                                // Get property value
                                const descValue = getFirstBasesPropertyValue(entry, settings.descriptionProperty) as { data?: unknown } | null;
                                const descData = descValue?.data;

                                // Use shared utility for preview loading
                                this.snippets[path] = await loadFilePreview(
                                    file,
                                    this.app,
                                    descData,
                                    {
                                        fallbackToContent: settings.fallbackToContent,
                                        omitFirstLine: settings.omitFirstLine
                                    }
                                );
                            } else {
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

                            // Process and validate image paths using shared utility
                            const { internalPaths, externalUrls } = await processImagePaths(imageValues);

                            // Convert internal paths to resource URLs using shared utility
                            let validImages: string[] = [
                                ...resolveInternalImagePaths(internalPaths, path, this.app),
                                ...externalUrls  // External URLs already validated by processImagePaths
                            ];

                            // If no property images and fallback enabled, extract embed images
                            if (validImages.length === 0 && settings.fallbackToEmbeds) {
                                const file = this.app.vault.getAbstractFileByPath(path);
                                if (file instanceof TFile) {
                                    validImages = await extractEmbedImages(file, this.app);
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
            // console.log('// [InfiniteScroll] All items displayed, skipping setup');
            return;
        }

        // console.log(`// [InfiniteScroll] Setting up scroll listener (${this.displayedCount}/${totalEntries} items)`);

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
                // console.log(`// [InfiniteScroll] Loading more items (distance: ${distanceFromBottom.toFixed(0)}px, threshold: ${threshold.toFixed(0)}px)`);
                this.isLoading = true;

                // Dynamic batch size: 50 items (simple for card view)
                const batchSize = 50;
                this.displayedCount = Math.min(this.displayedCount + batchSize, totalEntries);
                // console.log(`// [InfiniteScroll] New displayedCount: ${this.displayedCount}/${totalEntries}`);

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
        this.metadataObservers.forEach(obs => obs.disconnect());
        this.metadataObservers = [];
    }
}

/** Export options for registration */
export const cardViewOptions = getBasesViewOptions;
