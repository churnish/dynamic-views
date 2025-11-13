/**
 * Shared Card Renderer for Bases Views
 * Consolidates duplicate card rendering logic from Grid and Masonry views
 */

import { App, TFile, TFolder, setIcon, Menu, BasesEntry } from 'obsidian';
import { CardData } from '../shared/card-renderer';
import { resolveBasesProperty } from '../shared/data-transform';
import { setupImageLoadHandler } from '../shared/image-loader';
import { updateScrollGradient, setupScrollGradients } from '../shared/scroll-gradient-manager';
import { getTimestampIcon } from '../shared/render-utils';
import { getTagStyle, showTimestampIcon } from '../utils/style-settings';
import { getPropertyLabel } from '../utils/property';
import { GAP_SIZE } from '../shared/constants';
import type DynamicViewsPlugin from '../../main';
import type { Settings } from '../types';

export class SharedCardRenderer {
    constructor(
        protected app: App,
        protected plugin: DynamicViewsPlugin,
        protected propertyObservers: ResizeObserver[],
        protected updateLayoutRef: { current: (() => void) | null }
    ) {}

    /**
     * Renders a complete card with all sub-components
     * @param container - Container to append card to
     * @param card - Card data
     * @param entry - Bases entry
     * @param settings - View settings
     * @param hoverParent - Parent object for hover-link event
     */
    renderCard(
        container: HTMLElement,
        card: CardData,
        entry: BasesEntry,
        settings: Settings,
        hoverParent: unknown
    ): void {
        // Create card element
        const cardEl = container.createDiv('card');
        if (settings.imageFormat === 'cover') {
            cardEl.classList.add('image-format-cover');
        }
        cardEl.setAttribute('data-path', card.path);
        cardEl.setAttribute('data-href', card.path);
        cardEl.style.cursor = 'pointer';

        // Handle card click to open file
        cardEl.addEventListener('click', (e) => {
            // Only handle card-level clicks when openFileAction is 'card'
            // When openFileAction is 'title', the title link handles its own clicks
            if (settings.openFileAction === 'card') {
                const target = e.target as HTMLElement;
                // Don't open if clicking on links, tags, or other interactive elements
                const isLink = target.tagName === 'A' || target.closest('a');
                const isTag = target.classList.contains('tag') || target.closest('.tag');
                const isImage = target.tagName === 'IMG';
                const expandOnClick = document.body.classList.contains('dynamic-views-thumbnail-expand-click');
                const shouldBlockImageClick = isImage && expandOnClick;

                if (!isLink && !isTag && !shouldBlockImageClick) {
                    const newLeaf = e.metaKey || e.ctrlKey;
                    void this.app.workspace.openLinkText(card.path, '', newLeaf);
                }
            }
        });

        // Handle hover for page preview
        cardEl.addEventListener('mouseover', (e) => {
            this.app.workspace.trigger('hover-link', {
                event: e,
                source: 'dynamic-views',
                hoverParent: hoverParent,
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
            this.app.workspace.trigger('file-menu', menu, entry.file, 'file-explorer');

            menu.showAtMouseEvent(e);
        });

        // Title - render as link when openFileAction is 'title', otherwise plain text
        if (settings.showTitle) {
            const titleEl = cardEl.createDiv('card-title');

            if (settings.openFileAction === 'title') {
                // Render as clickable link
                const link = titleEl.createEl('a', {
                    cls: 'internal-link',
                    text: card.title,
                    attr: { 'data-href': card.path, href: card.path }
                });

                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const newLeaf = e.metaKey || e.ctrlKey;
                    void this.app.workspace.openLinkText(card.path, '', newLeaf);
                });
            } else {
                // Render as plain text
                titleEl.appendText(card.title);
            }
        }

        // Content container (for text preview and thumbnail/cover)
        // Create container if: text preview exists, OR thumbnails enabled with image, OR cover format (for placeholders)
        if ((settings.showTextPreview && card.snippet) ||
            (settings.imageFormat !== 'none' && (card.imageUrl || card.hasImageAvailable)) ||
            (settings.imageFormat === 'cover')) {
            const contentContainer = cardEl.createDiv('card-content');

            // Text preview
            if (settings.showTextPreview && card.snippet) {
                contentContainer.createDiv({ cls: 'card-text-preview', text: card.snippet });
            }

            // Thumbnail or cover
            if (settings.imageFormat !== 'none' && card.imageUrl) {
                const rawUrls = Array.isArray(card.imageUrl) ? card.imageUrl : [card.imageUrl];
                // Filter out empty/invalid URLs
                const imageUrls = rawUrls.filter(url => url && typeof url === 'string' && url.trim().length > 0);

                const imageClassName = settings.imageFormat === 'cover' ? 'card-cover' : 'card-thumbnail';
                const imageEl = contentContainer.createDiv(imageClassName);

                if (imageUrls.length > 0) {
                    // Multi-image carousel (covers only, not thumbnails)
                    if (imageUrls.length > 1 && settings.imageFormat === 'cover') {
                        const carouselContainer = imageEl.createDiv('image-carousel-container');
                        carouselContainer.dataset.carouselIndex = '0';
                        carouselContainer.dataset.carouselCount = String(imageUrls.length);

                        // Image embed with dual images
                        const imageEmbedContainer = carouselContainer.createDiv('image-embed');

                        // Current image (initially visible, showing first image)
                        const currentImg = imageEmbedContainer.createEl('img', {
                            cls: 'carousel-img carousel-img-current',
                            attr: { src: imageUrls[0], alt: '', 'data-img-slot': '0' }
                        });

                        // Next image (initially hidden, empty)
                        const nextImg = imageEmbedContainer.createEl('img', {
                            cls: 'carousel-img carousel-img-next',
                            attr: { alt: '', 'data-img-slot': '1' }
                        });

                        imageEmbedContainer.style.setProperty('--cover-image-url', `url("${imageUrls[0]}")`);

                        // Navigation arrows
                        const leftArrow = carouselContainer.createDiv('carousel-nav-left');
                        setIcon(leftArrow, 'lucide-chevron-left');

                        const rightArrow = carouselContainer.createDiv('carousel-nav-right');
                        setIcon(rightArrow, 'lucide-chevron-right');

                        // Multi-image indicator
                        const indicator = carouselContainer.createDiv('carousel-indicator');
                        setIcon(indicator, 'lucide-images');

                        // Setup navigation
                        this.setupCarouselNavigation(
                            carouselContainer,
                            imageEmbedContainer,
                            currentImg,
                            nextImg,
                            imageUrls
                        );

                        // Handle image load for masonry layout and color extraction
                        const cardEl = imageEl.closest('.card') as HTMLElement;
                        if (cardEl) {
                            setupImageLoadHandler(
                                currentImg,
                                imageEmbedContainer,
                                cardEl,
                                this.updateLayoutRef.current || undefined
                            );
                        }
                    }
                    // Single image (existing code path)
                    else {
                        const imageEmbedContainer = imageEl.createDiv('image-embed');
                        const imgEl = imageEmbedContainer.createEl('img', {
                            attr: { src: imageUrls[0], alt: '' }
                        });
                        // Set CSS variable for letterbox blur background
                        imageEmbedContainer.style.setProperty('--cover-image-url', `url("${imageUrls[0]}")`);

                        // Handle image load for masonry layout and color extraction
                        const cardEl = imageEl.closest('.card') as HTMLElement;
                        if (cardEl) {
                            setupImageLoadHandler(
                                imgEl,
                                imageEmbedContainer,
                                cardEl,
                                this.updateLayoutRef.current || undefined
                            );
                        }
                    }
                }
            } else if (settings.imageFormat !== 'none') {
                // Always render placeholder when no image - CSS controls visibility
                const placeholderClassName = settings.imageFormat === 'cover' ? 'card-cover-placeholder' : 'card-thumbnail-placeholder';
                contentContainer.createDiv(placeholderClassName);
            }
        }

        // Properties - 4-field rendering with 2-row layout
        this.renderProperties(cardEl, card, entry, settings);
    }

    /**
     * Renders property fields for a card
     */
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
        // When labels are enabled, show row if property is configured (even if value is empty)
        // When labels are hidden, only show row if value exists
        const row1HasContent = settings.propertyLabels !== 'hide'
            ? (effectiveProps[0] !== '' || effectiveProps[1] !== '')
            : (values[0] !== null || values[1] !== null);
        const row2HasContent = settings.propertyLabels !== 'hide'
            ? (effectiveProps[2] !== '' || effectiveProps[3] !== '')
            : (values[2] !== null || values[3] !== null);

        if (!row1HasContent && !row2HasContent) return;

        const metaEl = cardEl.createDiv('card-properties properties-4field');

        // Row 1
        if (row1HasContent) {
            const row1El = metaEl.createDiv('property-row property-row-1');
            if (settings.propertyLayout12SideBySide) {
                row1El.addClass('property-row-sidebyside');
            }

            const field1El = row1El.createDiv('property-field property-field-1');
            if (effectiveProps[0]) this.renderPropertyContent(field1El, effectiveProps[0], values[0], card, entry, settings);

            const field2El = row1El.createDiv('property-field property-field-2');
            if (effectiveProps[1]) this.renderPropertyContent(field2El, effectiveProps[1], values[1], card, entry, settings);

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
            if (effectiveProps[2]) this.renderPropertyContent(field3El, effectiveProps[2], values[2], card, entry, settings);

            const field4El = row2El.createDiv('property-field property-field-4');
            if (effectiveProps[3]) this.renderPropertyContent(field4El, effectiveProps[3], values[3], card, entry, settings);

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

    /**
     * Renders individual property content
     */
    private renderPropertyContent(
        container: HTMLElement,
        propertyName: string,
        resolvedValue: string | null,
        card: CardData,
        entry: BasesEntry,
        settings: Settings
    ): void {
        if (propertyName === '') {
            return;
        }

        // If no value and labels are hidden, render nothing
        if (!resolvedValue && settings.propertyLabels === 'hide') {
            return;
        }

        // Early return for empty special properties when labels are hidden
        if (settings.propertyLabels === 'hide') {
            if ((propertyName === 'tags' || propertyName === 'note.tags') && card.yamlTags.length === 0) {
                return;
            }
            if ((propertyName === 'file.tags' || propertyName === 'file tags') && card.tags.length === 0) {
                return;
            }
            if ((propertyName === 'file.path' || propertyName === 'path' || propertyName === 'file path') && card.folderPath.length === 0) {
                return;
            }
        }

        // Render label if property labels are enabled
        if (settings.propertyLabels === 'above') {
            const labelEl = container.createDiv('property-label');
            labelEl.textContent = getPropertyLabel(propertyName);
        }

        // Add inline label if enabled (as sibling, before property-content)
        if (settings.propertyLabels === 'inline') {
            const labelSpan = container.createSpan('property-label-inline');
            labelSpan.textContent = getPropertyLabel(propertyName) + ' ';
        }

        // Universal wrapper for all content types
        const metaContent = container.createDiv('property-content');

        // If no value but labels are enabled, show placeholder
        if (!resolvedValue) {
            metaContent.appendText('…');
            return;
        }

        // Handle timestamp properties - only show icons for known timestamp properties
        const isKnownTimestampProperty = propertyName === 'file.mtime' || propertyName === 'file.ctime' ||
            propertyName === 'modified time' || propertyName === 'created time';

        if (isKnownTimestampProperty) {
            // resolvedValue is already formatted by data-transform
            const timestampWrapper = metaContent.createSpan();
            if (showTimestampIcon() && settings.propertyLabels === 'hide') {
                const iconName = getTimestampIcon(propertyName, settings);
                const iconEl = timestampWrapper.createSpan('timestamp-icon');
                setIcon(iconEl, iconName);
            }
            timestampWrapper.appendText(resolvedValue);
        } else if ((propertyName === 'tags' || propertyName === 'note.tags') && card.yamlTags.length > 0) {
            // YAML tags only
            const tagStyle = getTagStyle();
            const showHashPrefix = tagStyle === 'minimal';
            const tagsWrapper = metaContent.createDiv('tags-wrapper');
            card.yamlTags.forEach(tag => {
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
        } else if ((propertyName === 'file.tags' || propertyName === 'file tags') && card.tags.length > 0) {
            // tags in YAML + note body
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

                // Add context menu for folder segments
                if (!isLastSegment) {
                    segmentEl.addEventListener('contextmenu', (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        const folderFile = this.app.vault.getAbstractFileByPath(cumulativePath);
                        if (folderFile instanceof TFolder) {
                            const menu = new Menu();
                            this.app.workspace.trigger('file-menu', menu, folderFile, 'file-explorer');
                            menu.showAtMouseEvent(e);
                        }
                    });
                }

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

                // Add context menu for folder segments
                segmentEl.addEventListener('contextmenu', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const folderFile = this.app.vault.getAbstractFileByPath(cumulativePath);
                    if (folderFile instanceof TFolder) {
                        const menu = new Menu();
                        this.app.workspace.trigger('file-menu', menu, folderFile, 'file-explorer');
                        menu.showAtMouseEvent(e);
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

    /**
     * Measures property fields for side-by-side layout
     */
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

    /**
     * Measures and applies widths for side-by-side row
     */
    private measureSideBySideRow(row: HTMLElement, field1: HTMLElement, field2: HTMLElement): void {
        // Enter measuring state to remove constraints
        row.addClass('property-measuring');

        // Force reflow
        void row.offsetWidth;

        // Measure property-content wrapper
        const content1 = field1.querySelector('.property-content') as HTMLElement;
        const content2 = field2.querySelector('.property-content') as HTMLElement;

        // Measure inline labels if present
        const label1 = field1.querySelector('.property-label-inline') as HTMLElement;
        const label2 = field2.querySelector('.property-label-inline') as HTMLElement;

        // Total width = content width + label width (if inline label exists)
        let width1 = content1 ? content1.scrollWidth : 0;
        let width2 = content2 ? content2.scrollWidth : 0;

        if (label1) {
            width1 += label1.scrollWidth;
        }
        if (label2) {
            width2 += label2.scrollWidth;
        }

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

    /**
     * Sets up carousel navigation for multi-image cards using dual-image choreography
     */
    private setupCarouselNavigation(
        carouselContainer: HTMLElement,
        imageEmbedContainer: HTMLElement,
        currentImg: HTMLImageElement,
        nextImg: HTMLImageElement,
        imageUrls: string[]
    ): void {
        // Preload all images on card hover
        let preloaded = false;
        const cardEl = carouselContainer.closest('.card') as HTMLElement;

        if (cardEl) {
            cardEl.addEventListener('mouseenter', () => {
                if (!preloaded) {
                    preloaded = true;
                    // Preload all images (except first which is already loaded)
                    imageUrls.slice(1).forEach((url) => {
                        const img = new Image();
                        img.src = url;
                    });
                }
            }, { once: true });
        }

        const navigate = (direction: 1 | -1) => {
            const currentIndex = parseInt(carouselContainer.dataset.carouselIndex || '0');
            const count = parseInt(carouselContainer.dataset.carouselCount || '1');

            // Calculate new index (wrap around)
            let newIndex = currentIndex + direction;
            if (newIndex < 0) newIndex = count - 1;
            if (newIndex >= count) newIndex = 0;

            const newUrl = imageUrls[newIndex];

            // Query DOM for current images (handles swapping correctly)
            const currentImgEl = imageEmbedContainer.querySelector('.carousel-img-current') as HTMLImageElement;
            const nextImgEl = imageEmbedContainer.querySelector('.carousel-img-next') as HTMLImageElement;

            if (!currentImgEl || !nextImgEl) return;

            // Set next image src (loads instantly from cache)
            nextImgEl.src = newUrl;
            imageEmbedContainer.style.setProperty('--cover-image-url', `url("${newUrl}")`);

            // Determine animation classes based on direction
            const exitClass = direction === 1 ? 'carousel-exit-left' : 'carousel-exit-right';
            const enterClass = direction === 1 ? 'carousel-enter-left' : 'carousel-enter-right';

            // Animate both images simultaneously
            currentImgEl.classList.add(exitClass);
            nextImgEl.classList.add(enterClass);

            // After animation completes, clean up and swap roles
            setTimeout(() => {
                // Remove animation classes
                currentImgEl.classList.remove(exitClass);
                nextImgEl.classList.remove(enterClass);

                // Swap z-index to make next image the new current
                currentImgEl.classList.remove('carousel-img-current');
                currentImgEl.classList.add('carousel-img-next');
                nextImgEl.classList.remove('carousel-img-next');
                nextImgEl.classList.add('carousel-img-current');

                // Update index
                carouselContainer.dataset.carouselIndex = String(newIndex);

                // Clear the now-next (old current) image to save memory
                currentImgEl.src = '';

                // Trigger layout update for masonry (new image may have different dimensions)
                if (this.updateLayoutRef.current) {
                    this.updateLayoutRef.current();
                }
            }, 300);
        };

        // Arrow click handlers
        const leftArrow = carouselContainer.querySelector('.carousel-nav-left') as HTMLElement;
        const rightArrow = carouselContainer.querySelector('.carousel-nav-right') as HTMLElement;

        if (leftArrow) {
            leftArrow.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation(); // Don't trigger card click
                navigate(-1);
            });
        }

        if (rightArrow) {
            rightArrow.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                navigate(1);
            });
        }
    }
}
