/**
 * Bases Masonry View
 * Masonry layout view using Bases API
 */

import { BasesView, BasesEntry, TFile, setIcon, QueryController, Menu } from 'obsidian';
import { CardData } from '../shared/card-renderer';
import { transformBasesEntries, resolveBasesProperty } from '../shared/data-transform';
import { readBasesSettings, getMasonryViewOptions } from '../shared/settings-schema';
import { processImagePaths, resolveInternalImagePaths, extractEmbedImages } from '../utils/image';
import { loadFilePreview } from '../utils/preview';
import { getFirstBasesPropertyValue, getAllBasesImagePropertyValues } from '../utils/property';
import { getTimestampIcon } from '../shared/render-utils';
import { getMinCardWidth, getMinMasonryColumns, getTagStyle, showTimestampIcon, getCardSpacing } from '../utils/style-settings';
import { calculateMasonryLayout, applyMasonryLayout } from '../utils/masonry-layout';
import { setupImageLoadHandler } from '../shared/image-loader';
import { updateScrollGradient, setupScrollGradients } from '../shared/scroll-gradient-manager';
import { BATCH_SIZE, GAP_SIZE } from '../shared/constants';
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

        // Setup update function using shared masonry logic
        this.updateLayoutRef.current = () => {
            if (!this.masonryContainer) return;

            const cards = Array.from(this.masonryContainer.querySelectorAll<HTMLElement>('.writing-card'));
            if (cards.length === 0) return;

            const containerWidth = this.masonryContainer.clientWidth;

            // Calculate layout using shared logic
            const result = calculateMasonryLayout({
                cards,
                containerWidth,
                cardMinWidth: getMinCardWidth(),
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
        const { app } = this;

        // Create card element
        const cardEl = container.createDiv('writing-card');
        if (settings.imageFormat === 'cover') {
            cardEl.classList.add('image-format-cover');
        }
        cardEl.setAttribute('data-path', card.path);
        cardEl.setAttribute('data-href', card.path);
        cardEl.style.cursor = 'pointer';

        // Handle card click to open file
        cardEl.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            // Don't open if clicking on tags or other interactive elements
            const isTag = target.tagName === 'A' && target.classList.contains('tag');
            const isInsideTag = target.closest('.tag');
            const isImage = target.tagName === 'IMG';
            const expandOnClick = document.body.classList.contains('dynamic-views-thumbnail-expand-click');
            const shouldBlockImageClick = isImage && expandOnClick;

            if (!isTag && !isInsideTag && !shouldBlockImageClick) {
                const openOnCard = settings.openFileAction === 'card';
                const clickedOnTitle = target.closest('.writing-title');

                if (openOnCard || clickedOnTitle) {
                    const newLeaf = e.metaKey || e.ctrlKey;
                    void app.workspace.openLinkText(card.path, '', newLeaf);
                }
            }
        });

        // Handle hover for page preview
        cardEl.addEventListener('mouseover', (e) => {
            app.workspace.trigger('hover-link', {
                event: e,
                source: 'dynamic-views',
                hoverParent: this,
                targetEl: cardEl,
                linktext: card.path,
            });
        });

        // Handle right-click for context menu
        cardEl.addEventListener('contextmenu', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const menu = new Menu();

            // @ts-ignore - Trigger file-menu to add standard items
            app.workspace.trigger('file-menu', menu, entry.file, 'file-explorer');

            menu.showAtMouseEvent(e);
        });

        // Title - plain text, not a link (matching vanilla Bases)
        if (settings.showTitle) {
            const titleEl = cardEl.createDiv('writing-title');
            titleEl.createSpan({ cls: 'title-text', text: card.title });
        }

        // Snippet and thumbnail container
        // Create container if: text preview exists, OR thumbnails enabled with image, OR cover format (for placeholders)
        if ((settings.showTextPreview && card.snippet) ||
            (settings.imageFormat !== 'none' && (card.imageUrl || card.hasImageAvailable)) ||
            (settings.imageFormat === 'cover')) {
            const snippetContainer = cardEl.createDiv('snippet-container');

            // Text preview
            if (settings.showTextPreview && card.snippet) {
                snippetContainer.createDiv({ cls: 'writing-snippet', text: card.snippet });
            }

            // Thumbnail
            if (settings.imageFormat !== 'none' && card.imageUrl) {
                const imageUrls = Array.isArray(card.imageUrl) ? card.imageUrl : [card.imageUrl];
                const thumbEl = snippetContainer.createDiv('card-thumbnail');

                if (imageUrls.length > 0) {
                    const imageEmbedContainer = thumbEl.createDiv('image-embed');
                    const imgEl = imageEmbedContainer.createEl('img', {
                        attr: { src: imageUrls[0], alt: '' }
                    });
                    // Set CSS variable for letterbox blur background
                    imageEmbedContainer.style.setProperty('--cover-image-url', `url("${imageUrls[0]}")`);

                    // Handle image load for masonry layout and color extraction
                    const cardEl = thumbEl.closest('.writing-card') as HTMLElement;
                    if (cardEl) {
                        setupImageLoadHandler(
                            imgEl,
                            imageEmbedContainer,
                            cardEl,
                            this.updateLayoutRef.current || undefined
                        );
                    }
                }
            } else if (settings.imageFormat !== 'none') {
                // Always render placeholder when no image - CSS controls visibility
                snippetContainer.createDiv('card-thumbnail-placeholder');
            }
        }

        // Properties - 4-field rendering with 2-row layout
        this.renderProperties(cardEl, card, entry, settings);
    }

    private renderProperties(
        cardEl: HTMLElement,
        card: CardData,
        entry: BasesEntry,
        settings: Settings
    ): void {
        // Get all 4 property names
        const props = [
            settings.propertyDisplay1,
            settings.propertyDisplay2,
            settings.propertyDisplay3,
            settings.propertyDisplay4
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
            prop ? resolveBasesProperty(prop, entry, card, settings) : null
        );

        // Check if any row has content
        const row1HasContent = values[0] !== null || values[1] !== null;
        const row2HasContent = values[2] !== null || values[3] !== null;

        if (!row1HasContent && !row2HasContent) return;

        const metaEl = cardEl.createDiv('card-properties properties-4field');

        // Row 1
        if (row1HasContent) {
            const row1El = metaEl.createDiv('property-row property-row-1');
            if (settings.propertyLayout12SideBySide) {
                row1El.addClass('property-row-sidebyside');
            }

            const field1El = row1El.createDiv('property-field property-field-1');
            if (values[0]) this.renderPropertyContent(field1El, effectiveProps[0], values[0], card, entry, settings);

            const field2El = row1El.createDiv('property-field property-field-2');
            if (values[1]) this.renderPropertyContent(field2El, effectiveProps[1], values[1], card, entry, settings);

            // Check actual rendered content
            const has1 = field1El.children.length > 0 || field1El.textContent?.trim().length > 0;
            const has2 = field2El.children.length > 0 || field2El.textContent?.trim().length > 0;

            // Check if properties are actually set (not empty string from duplicate/empty slots)
            const prop1Set = effectiveProps[0] !== '';
            const prop2Set = effectiveProps[1] !== '';

            if (!has1 && !has2) {
                row1El.remove();
            } else if (has1 && !has2) {
                // Field 1 has content, field 2 empty - add placeholder ONLY if prop2 is set
                if (prop2Set) {
                    const placeholderContent = field2El.createDiv('property-content');
                    placeholderContent.textContent = '…';
                }
            } else if (!has1 && has2) {
                // Field 2 has content, field 1 empty - add placeholder ONLY if prop1 is set
                if (prop1Set) {
                    const placeholderContent = field1El.createDiv('property-content');
                    placeholderContent.textContent = '…';
                }
            }
            // Keep both fields in DOM for proper positioning (field 2 stays right-aligned)
        }

        // Row 2
        if (row2HasContent) {
            const row2El = metaEl.createDiv('property-row property-row-2');
            if (settings.propertyLayout34SideBySide) {
                row2El.addClass('property-row-sidebyside');
            }

            const field3El = row2El.createDiv('property-field property-field-3');
            if (values[2]) this.renderPropertyContent(field3El, effectiveProps[2], values[2], card, entry, settings);

            const field4El = row2El.createDiv('property-field property-field-4');
            if (values[3]) this.renderPropertyContent(field4El, effectiveProps[3], values[3], card, entry, settings);

            // Check actual rendered content
            const has3 = field3El.children.length > 0 || field3El.textContent?.trim().length > 0;
            const has4 = field4El.children.length > 0 || field4El.textContent?.trim().length > 0;

            // Check if properties are actually set (not empty string from duplicate/empty slots)
            const prop3Set = effectiveProps[2] !== '';
            const prop4Set = effectiveProps[3] !== '';

            if (!has3 && !has4) {
                row2El.remove();
            } else if (has3 && !has4) {
                // Field 3 has content, field 4 empty - add placeholder ONLY if prop4 is set
                if (prop4Set) {
                    const placeholderContent = field4El.createDiv('property-content');
                    placeholderContent.textContent = '…';
                }
            } else if (!has3 && has4) {
                // Field 4 has content, field 3 empty - add placeholder ONLY if prop3 is set
                if (prop3Set) {
                    const placeholderContent = field3El.createDiv('property-content');
                    placeholderContent.textContent = '…';
                }
            }
            // Keep both fields in DOM for proper positioning (field 4 stays right-aligned)
        }

        // Remove meta container if no rows remain
        if (metaEl.children.length === 0) {
            metaEl.remove();
        } else {
            // Measure side-by-side field widths
            this.measurePropertyFields(cardEl);
            // Setup scroll gradients for tags and paths
            setupScrollGradients(cardEl, this.propertyObservers, updateScrollGradient);
        }
    }

    private measureSideBySideRow(row: HTMLElement, field1: HTMLElement, field2: HTMLElement): void {
        // Enter measuring state to remove constraints
        row.addClass('property-measuring');

        // Force reflow
        void row.offsetWidth;

        // Measure property-content wrapper
        const content1 = field1.querySelector('.property-content') as HTMLElement;
        const content2 = field2.querySelector('.property-content') as HTMLElement;

        const width1 = content1 ? content1.scrollWidth : 0;
        const width2 = content2 ? content2.scrollWidth : 0;
        const containerWidth = row.clientWidth;
        const gap = GAP_SIZE;
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
        row.removeClass('property-measuring');
        row.style.setProperty('--field1-width', field1Width);
        row.style.setProperty('--field2-width', field2Width);
        row.addClass('property-measured');

        // Reset scroll position to 0 for both fields
        field1.scrollLeft = 0;
        field2.scrollLeft = 0;

        // Update scroll gradients after layout settles
        requestAnimationFrame(() => {
            updateScrollGradient(field1);
            updateScrollGradient(field2);
        });
    }

    private measurePropertyFields(container: HTMLElement): void {
        const rows = container.querySelectorAll('.property-row-sidebyside');
        rows.forEach(row => {
            const rowEl = row as HTMLElement;

            const field1 = rowEl.querySelector('.property-field-1, .property-field-3') as HTMLElement;
            const field2 = rowEl.querySelector('.property-field-2, .property-field-4') as HTMLElement;

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
                this.propertyObservers.push(observer);
            }
        });
    }


    private renderPropertyContent(
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

        // Early return for empty special properties
        if ((propertyName === 'file.tags' || propertyName === 'tags' || propertyName === 'file tags') && card.tags.length === 0) {
            return;
        }
        if ((propertyName === 'file.path' || propertyName === 'path' || propertyName === 'file path') && card.folderPath.length === 0) {
            return;
        }

        // Universal wrapper for all content types
        const metaContent = container.createDiv('property-content');

        // Handle timestamp properties - only show icons for known timestamp properties
        const isKnownTimestampProperty = propertyName === 'file.mtime' || propertyName === 'file.ctime' ||
            propertyName === 'modified time' || propertyName === 'created time';

        if (isKnownTimestampProperty) {
            // resolvedValue is already formatted by data-transform
            const timestampWrapper = metaContent.createSpan();
            if (showTimestampIcon()) {
                const iconName = getTimestampIcon(propertyName, settings);
                const iconEl = timestampWrapper.createSpan('timestamp-icon');
                setIcon(iconEl, iconName);
            }
            timestampWrapper.appendText(resolvedValue);
        } else if ((propertyName === 'file.tags' || propertyName === 'tags' || propertyName === 'file tags') && card.tags.length > 0) {
            const tagStyle = getTagStyle();
            const showHashPrefix = tagStyle === 'minimal';
            const tagsWrapper = metaContent.createDiv('tags-wrapper');
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
        } else if ((propertyName === 'file.path' || propertyName === 'path' || propertyName === 'file path') && card.path.length > 0) {
            const pathWrapper = metaContent.createDiv('path-wrapper');
            // Split full path including filename
            const segments = card.path.split('/').filter(f => f);
            segments.forEach((segment, idx) => {
                const span = pathWrapper.createSpan();
                const isLastSegment = idx === segments.length - 1;
                const segmentClass = isLastSegment ? 'path-segment filename-segment' : 'path-segment file-path-segment';
                const segmentEl = span.createSpan({ cls: segmentClass, text: segment });

                // Make clickable
                const cumulativePath = segments.slice(0, idx + 1).join('/');
                segmentEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (isLastSegment) {
                        // Last segment is filename - open the file
                        const file = this.app.vault.getAbstractFileByPath(card.path);
                        if (file instanceof TFile) {
                            void this.app.workspace.getLeaf(false).openFile(file);
                        }
                    } else {
                        // Folder segment - reveal in file explorer
                        const fileExplorer = this.app.internalPlugins?.plugins?.["file-explorer"];
                        if (fileExplorer?.instance?.revealInFolder) {
                            const folderFile = this.app.vault.getAbstractFileByPath(cumulativePath);
                            if (folderFile) {
                                fileExplorer.instance.revealInFolder(folderFile);
                            }
                        }
                    }
                });

                if (idx < segments.length - 1) {
                    span.createSpan({ cls: 'path-separator', text: '/' });
                }
            });
        } else if ((propertyName === 'file.folder' || propertyName === 'folder') && card.folderPath.length > 0) {
            const folderWrapper = metaContent.createDiv('path-wrapper');
            // Split folder path into segments
            const folders = card.folderPath.split('/').filter(f => f);
            folders.forEach((folder, idx) => {
                const span = folderWrapper.createSpan();
                const segmentEl = span.createSpan({ cls: 'path-segment folder-segment', text: folder });

                // Make clickable - reveal folder in file explorer
                const cumulativePath = folders.slice(0, idx + 1).join('/');
                segmentEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const fileExplorer = this.app.internalPlugins?.plugins?.["file-explorer"];
                    if (fileExplorer?.instance?.revealInFolder) {
                        const folderFile = this.app.vault.getAbstractFileByPath(cumulativePath);
                        if (folderFile) {
                            fileExplorer.instance.revealInFolder(folderFile);
                        }
                    }
                });

                if (idx < folders.length - 1) {
                    span.createSpan({ cls: 'path-separator', text: '/' });
                }
            });
        } else {
            // Generic property - wrap in div for proper scrolling (consistent with tags/paths)
            const textWrapper = metaContent.createDiv('text-wrapper');
            textWrapper.appendText(resolvedValue);
        }

        // Remove metaContent wrapper if it ended up empty (e.g., tags with no values)
        if (!metaContent.textContent || metaContent.textContent.trim().length === 0) {
            metaContent.remove();
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
        if (settings.imageFormat !== 'none') {
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

    onClose(): void {
        this.propertyObservers.forEach(obs => obs.disconnect());
        this.propertyObservers = [];
    }
}

/** Export options for registration */
export const masonryViewOptions = getMasonryViewOptions;
