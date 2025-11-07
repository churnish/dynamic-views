/**
 * Bases Masonry View
 * Masonry layout view using Bases API
 */

import { BasesView, BasesEntry, TFile, setIcon, QueryController } from 'obsidian';
import { CardData } from '../shared/card-renderer';
import { transformBasesEntries, resolveBasesMetadataProperty } from '../shared/data-transform';
import { readBasesSettings, getMasonryViewOptions } from '../shared/settings-schema';
import { processImagePaths, resolveInternalImagePaths, extractEmbedImages } from '../utils/image';
import { loadFilePreview } from '../utils/preview';
import { getFirstBasesPropertyValue, getAllBasesImagePropertyValues } from '../utils/property';
import { formatTimestamp, getTimestampIcon } from '../shared/render-utils';
import { getMinCardWidth, getMinMasonryColumns, getTagStyle, showTimestampIcon } from '../utils/style-settings';
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
        // Make container scrollable
        this.containerEl.style.overflowY = 'auto';
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

        // Transform to CardData (only visible entries)
        const sortMethod = this.getSortMethod();

        console.log('// [Shuffle Debug] masonry-view onDataUpdated - sortMethod:', sortMethod);
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
        this.metadataObservers.forEach(obs => obs.disconnect());
        this.metadataObservers = [];

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

        // Clear loading flag after async work completes
        this.isLoading = false;
        })();
    }

    private setupMasonryLayout(settings: Settings): void {
        if (!this.masonryContainer) return;

        const minColumns = getMinMasonryColumns();

        // Setup update function
        this.updateLayoutRef.current = () => {
            if (!this.masonryContainer) return;

            const cards = Array.from(this.masonryContainer.querySelectorAll<HTMLElement>('.writing-card'));
            if (cards.length === 0) return;

            const containerWidth = this.masonryContainer.clientWidth;
            const cardMinWidth = getMinCardWidth();
            const gap = 8;

            // Calculate number of columns
            const columns = Math.max(
                minColumns,
                Math.floor((containerWidth + gap) / (cardMinWidth + gap))
            );

            // Calculate actual card width based on columns
            const cardWidth = (containerWidth - (gap * (columns - 1))) / columns;

            // Initialize column heights
            const columnHeights: number[] = new Array(columns).fill(0) as number[];

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
                card.style.transition = 'none';  // No transitions
                // card.style.transition = (index < 50 || this.isShuffled) ? 'none' : 'all 0.3s ease';  // No transition for initial render or shuffle

                // Update column height
                const cardHeight = card.offsetHeight;
                columnHeights[shortestColumn] += cardHeight + gap;
            });

            // Set container height
            const maxHeight = Math.max(...columnHeights);
            this.masonryContainer.style.height = `${maxHeight}px`;
            this.masonryContainer.style.position = 'relative';
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

    private getSortMethod(): string{
        // Get sort configuration from Bases
        const sortConfigs = this.config.getSort();

        // console.log('// [Bases Sort Debug - Masonry View] getSort() returned:', sortConfigs);
        // console.log('// [Bases Sort Debug - Masonry View] Array length:', sortConfigs?.length);

        if (sortConfigs && sortConfigs.length > 0) {
            const firstSort = sortConfigs[0];
            // console.log('// [Bases Sort Debug - Masonry View] First sort config:', firstSort);
            // console.log('// [Bases Sort Debug - Masonry View] Property:', firstSort.property);
            // console.log('// [Bases Sort Debug - Masonry View] Direction:', firstSort.direction);

            const property = firstSort.property;
            const direction = firstSort.direction.toLowerCase();

            // Check for ctime/mtime in property
            if (property.includes('ctime')) {
                const result = `ctime-${direction}`;
                // console.log('// [Bases Sort Debug - Masonry View] Detected:', result);
                return result;
            }
            if (property.includes('mtime')) {
                const result = `mtime-${direction}`;
                // console.log('// [Bases Sort Debug - Masonry View] Detected:', result);
                return result;
            }
            // console.log('// [Bases Sort Debug - Masonry View] Custom property sort, falling back to mtime-desc');
        } else {
            // console.log('// [Bases Sort Debug - Masonry View] No sort config, using default mtime-desc');
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
            // console.log('// [InfiniteScroll] All items displayed, skipping setup');
            return;
        }

        // console.log(`// [InfiniteScroll] Setting up scroll listener (${this.displayedCount}/${totalEntries} items)`);

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
                // console.log(`// [InfiniteScroll] Loading more items [${trigger}] (distance: ${distanceFromBottom.toFixed(0)}px, threshold: ${threshold.toFixed(0)}px)`);
                this.isLoading = true;

                // Dynamic batch size based on masonry columns (estimate 3 columns avg, 10 rows per column)
                const batchSize = Math.min(30, 70);
                this.displayedCount = Math.min(this.displayedCount + batchSize, totalEntries);
                // console.log(`// [InfiniteScroll] New displayedCount: ${this.displayedCount}/${totalEntries}`);

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

    setSettings(): void {
        // Style Settings compatibility - trigger layout recalculation
        try {
            if (this.updateLayoutRef && this.updateLayoutRef.current) {
                this.updateLayoutRef.current();
            }
        } catch (error) {
            console.warn('Dynamic Views: Failed to update layout on settings change', error);
        }
    }

    onClose(): void {
        this.metadataObservers.forEach(obs => obs.disconnect());
        this.metadataObservers = [];
    }
}

/** Export options for registration */
export const masonryViewOptions = getMasonryViewOptions;
