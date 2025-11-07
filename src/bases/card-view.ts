/**
 * Bases Card View
 * Primary implementation using Bases API
 */

import { BasesView, BasesEntry, TFile, setIcon, QueryController } from 'obsidian';
import { CardData } from '../shared/card-renderer';
import { transformBasesEntries, resolveBasesMetadataProperty } from '../shared/data-transform';
import { readBasesSettings, getBasesViewOptions } from '../shared/settings-schema';
import { processImagePaths, resolveInternalImagePaths, extractEmbedImages } from '../utils/image';
import { loadFilePreview } from '../utils/preview';
import { getFirstBasesPropertyValue, getAllBasesImagePropertyValues } from '../utils/property';
import { formatTimestamp, getTimestampIcon } from '../shared/render-utils';
import { getMinCardWidth, getMinGridColumns, getTagStyle, showTimestampIcon } from '../utils/style-settings';
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
            const entries = this.data.data;

        // Read settings from Bases config
        const settings = readBasesSettings(
            this.config,
            this.plugin.persistenceManager.getGlobalSettings(),
            this.plugin.persistenceManager.getDefaultViewSettings()
        );

        // Calculate grid columns
        const containerWidth = this.containerEl.clientWidth;
        const cardMinWidth = getMinCardWidth();
        const minColumns = getMinGridColumns();
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
                const containerWidth = this.containerEl.clientWidth;
                const cardMinWidth = getMinCardWidth();
                const minColumns = getMinGridColumns();
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

        // Metadata - 4-field rendering with 2-row layout
        this.renderMetadata(cardEl, card, entry, settings);
    }

    private renderMetadata(
        cardEl: HTMLElement,
        card: CardData,
        entry: BasesEntry,
        settings: Settings
    ): void {
        // Get all 4 property names
        const props = [
            settings.metadataDisplay1,
            settings.metadataDisplay2,
            settings.metadataDisplay3,
            settings.metadataDisplay4
        ];

        // Detect duplicates (priority: 1 > 2 > 3 > 4)
        const seen = new Set<string>();
        const effectiveProps = props.map(prop => {
            if (!prop || prop === '') return '';
            if (seen.has(prop)) return ''; // Duplicate, skip
            seen.add(prop);
            return prop;
        });

        // Resolve property values
        const values = effectiveProps.map(prop =>
            prop ? resolveBasesMetadataProperty(prop, entry, card, settings) : null
        );

        // Check if any row has content
        const row1HasContent = values[0] !== null || values[1] !== null;
        const row2HasContent = values[2] !== null || values[3] !== null;

        if (!row1HasContent && !row2HasContent) return;

        const metaEl = cardEl.createDiv('writing-meta meta-4field');

        // Row 1
        if (row1HasContent) {
            const row1El = metaEl.createDiv('meta-row meta-row-1');
            if (settings.metadataLayout12SideBySide) {
                row1El.addClass('meta-row-sidebyside');
            }

            const field1El = row1El.createDiv('meta-field meta-field-1');
            if (values[0]) this.renderMetadataContent(field1El, effectiveProps[0], values[0], card, entry, settings);

            const field2El = row1El.createDiv('meta-field meta-field-2');
            if (values[1]) this.renderMetadataContent(field2El, effectiveProps[1], values[1], card, entry, settings);

            // Check actual rendered content
            const has1 = field1El.children.length > 0 || field1El.textContent?.trim().length > 0;
            const has2 = field2El.children.length > 0 || field2El.textContent?.trim().length > 0;

            if (!has1 && !has2) {
                row1El.remove();
            } else if (has1 && !has2) {
                row1El.addClass('meta-row-single');
            } else if (!has1 && has2) {
                row1El.addClass('meta-row-single');
            }
        }

        // Row 2
        if (row2HasContent) {
            const row2El = metaEl.createDiv('meta-row meta-row-2');
            if (settings.metadataLayout34SideBySide) {
                row2El.addClass('meta-row-sidebyside');
            }

            const field3El = row2El.createDiv('meta-field meta-field-3');
            if (values[2]) this.renderMetadataContent(field3El, effectiveProps[2], values[2], card, entry, settings);

            const field4El = row2El.createDiv('meta-field meta-field-4');
            if (values[3]) this.renderMetadataContent(field4El, effectiveProps[3], values[3], card, entry, settings);

            // Check actual rendered content
            const has3 = field3El.children.length > 0 || field3El.textContent?.trim().length > 0;
            const has4 = field4El.children.length > 0 || field4El.textContent?.trim().length > 0;

            if (!has3 && !has4) {
                row2El.remove();
            } else if (has3 && !has4) {
                row2El.addClass('meta-row-single');
            } else if (!has3 && has4) {
                row2El.addClass('meta-row-single');
            }
        }

        // Remove meta container if no rows remain
        if (metaEl.children.length === 0) {
            metaEl.remove();
        } else {
            // Measure side-by-side field widths
            this.measureMetadataFields(cardEl);
            // Setup scroll gradients for tags and paths
            this.setupScrollGradients(cardEl);
        }
    }

    private updateScrollGradient(element: HTMLElement): void {
        // Apply gradient classes directly to the scrollable .meta-field element
        const isScrollable = element.scrollWidth > element.clientWidth;

        if (!isScrollable) {
            // Not scrollable - remove all gradient classes
            element.removeClass('scroll-gradient-left');
            element.removeClass('scroll-gradient-right');
            element.removeClass('scroll-gradient-both');
            return;
        }

        const scrollLeft = element.scrollLeft;
        const scrollWidth = element.scrollWidth;
        const clientWidth = element.clientWidth;
        const atStart = scrollLeft <= 1; // Allow 1px tolerance
        const atEnd = scrollLeft + clientWidth >= scrollWidth - 1; // Allow 1px tolerance

        // Remove all gradient classes first
        element.removeClass('scroll-gradient-left');
        element.removeClass('scroll-gradient-right');
        element.removeClass('scroll-gradient-both');

        // Apply appropriate gradient based on position
        if (atStart && !atEnd) {
            // At start, content extends right
            element.addClass('scroll-gradient-right');
        } else if (atEnd && !atStart) {
            // At end, content extends left
            element.addClass('scroll-gradient-left');
        } else if (!atStart && !atEnd) {
            // In middle, content extends both directions
            element.addClass('scroll-gradient-both');
        }
        // If atStart && atEnd, content fits fully - no gradient
    }

    private measureSideBySideRow(row: HTMLElement, field1: HTMLElement, field2: HTMLElement): void {
        // Enter measuring state to remove constraints
        row.addClass('meta-measuring');

        // Force reflow
        void row.offsetWidth;

        // Measure inner content (first child element)
        const inner1 = field1.querySelector('.tags-wrapper, .path-wrapper, .property-value, span') as HTMLElement;
        const inner2 = field2.querySelector('.tags-wrapper, .path-wrapper, .property-value, span') as HTMLElement;

        const width1 = inner1 ? inner1.scrollWidth : 0;
        const width2 = inner2 ? inner2.scrollWidth : 0;
        const containerWidth = row.clientWidth;
        const gap = 8;
        const availableWidth = containerWidth - gap;

        const percent1 = (width1 / availableWidth) * 100;
        const percent2 = (width2 / availableWidth) * 100;

        // Calculate optimal widths using smart strategy
        let field1Width: string;
        let field2Width: string;

        if (percent1 <= 50 && percent2 <= 50) {
            // Both fit: field1 gets exact width, field2 fills remainder (maximizes field2 content space)
            field1Width = `${width1}px`;
            field2Width = `${availableWidth - width1}px`;
        } else if (percent1 <= 50 && percent2 > 50) {
            // Field1 small, field2 needs more: field1 exact, field2 fills
            field1Width = `${width1}px`;
            field2Width = `${availableWidth - width1}px`;
        } else if (percent1 > 50 && percent2 <= 50) {
            // Field2 small, field1 needs more: field2 exact, field1 fills
            field1Width = `${availableWidth - width2}px`;
            field2Width = `${width2}px`;
        } else {
            // Both > 50%: split 50-50
            const half = availableWidth / 2;
            field1Width = `${half}px`;
            field2Width = `${half}px`;
        }

        // Exit measuring state, apply calculated values
        row.removeClass('meta-measuring');
        row.style.setProperty('--field1-width', field1Width);
        row.style.setProperty('--field2-width', field2Width);
        row.addClass('meta-measured');

        // Reset scroll position to 0 for both fields
        field1.scrollLeft = 0;
        field2.scrollLeft = 0;

        // Update scroll gradients after layout settles
        requestAnimationFrame(() => {
            this.updateScrollGradient(field1);
            this.updateScrollGradient(field2);
        });
    }

    private measureMetadataFields(container: HTMLElement): void {
        const rows = container.querySelectorAll('.meta-row-sidebyside');
        rows.forEach(row => {
            const rowEl = row as HTMLElement;
            // Skip if already measured or is single-field
            if (rowEl.classList.contains('meta-row-single')) return;

            const field1 = rowEl.querySelector('.meta-field-1, .meta-field-3') as HTMLElement;
            const field2 = rowEl.querySelector('.meta-field-2, .meta-field-4') as HTMLElement;

            if (field1 && field2) {
                // Initial measurement
                requestAnimationFrame(() => {
                    this.measureSideBySideRow(rowEl, field1, field2);
                });

                // Re-measure on resize
                const observer = new ResizeObserver(() => {
                    this.measureSideBySideRow(rowEl, field1, field2);
                });
                observer.observe(rowEl);
            }
        });
    }

    private setupScrollGradients(container: HTMLElement): void {
        // Find all scrollable metadata field containers
        const scrollables = container.querySelectorAll('.meta-row-sidebyside .meta-field');

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
        propertyName: string,
        resolvedValue: string,
        card: CardData,
        entry: BasesEntry,
        settings: Settings
    ): void {
        if (propertyName === '' || !resolvedValue) {
            return;
        }

        // Handle special properties by property name
        if (propertyName === 'file.mtime' || propertyName === 'file.ctime' ||
            propertyName === 'timestamp' || propertyName === 'modified time' || propertyName === 'created time') {
            // Use resolved displayTimestamp from CardData (already handles custom properties)
            const timestamp = card.displayTimestamp;

            if (timestamp) {
                const date = formatTimestamp(timestamp);
                // Wrap in span for proper measurement
                const timestampWrapper = container.createSpan();
                if (showTimestampIcon()) {
                    const sortMethod = this.getSortMethod();
                    const iconName = getTimestampIcon(sortMethod);
                    const iconEl = timestampWrapper.createSpan('timestamp-icon');
                    setIcon(iconEl, iconName);
                }
                timestampWrapper.appendText(date);
            }
        } else if ((propertyName === 'file.tags' || propertyName === 'tags' || propertyName === 'file tags') && card.tags.length > 0) {
            const tagStyle = getTagStyle();
            const showHashPrefix = tagStyle === 'minimal';
            const tagsWrapper = container.createDiv('tags-wrapper');
            card.tags.forEach(tag => {
                const tagEl = tagsWrapper.createEl('a', {
                    cls: 'tag',
                    text: showHashPrefix ? '#' + tag : tag,
                    href: '#'
                });
                tagEl.addEventListener('click', (e) => {
                    e.preventDefault();
                    const searchPlugin = this.plugin.app.internalPlugins.plugins["global-search"];
                    if (searchPlugin?.instance?.openGlobalSearch) {
                        searchPlugin.instance.openGlobalSearch("tag:" + tag);
                    }
                });
            });
        } else if ((propertyName === 'file.path' || propertyName === 'path' || propertyName === 'file path') && card.folderPath.length > 0) {
            const pathWrapper = container.createDiv('path-wrapper');
            const folders = card.folderPath.split('/').filter(f => f);
            folders.forEach((folder, idx) => {
                const span = pathWrapper.createSpan();
                span.createSpan({ cls: 'path-segment file-path-segment', text: folder });
                if (idx < folders.length - 1) {
                    span.createSpan({ cls: 'path-separator', text: '/' });
                }
            });
        } else {
            // Generic property: wrap in span for measurement and scrolling
            const wrapper = container.createSpan('property-value');
            wrapper.appendText(resolvedValue);
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

    setSettings(): void {
        // Style Settings compatibility - trigger layout recalculation
        try {
            if (this.containerEl && this.resizeObserver) {
                // Trigger resize observer to recalculate grid with new CSS variables
                const containerWidth = this.containerEl.clientWidth;
                const cardMinWidth = getMinCardWidth();
                const minColumns = getMinGridColumns();
                const gap = 8;
                const cols = Math.max(minColumns, Math.floor((containerWidth + gap) / (cardMinWidth + gap)));
                const cardWidth = (containerWidth - (gap * (cols - 1))) / cols;

                this.containerEl.style.setProperty('--card-min-width', `${cardWidth}px`);
                this.containerEl.style.setProperty('--grid-columns', String(cols));
            }
        } catch (error) {
            console.warn('Dynamic Views: Failed to update layout on settings change', error);
        }
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
