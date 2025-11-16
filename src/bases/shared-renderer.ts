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
import { getTagStyle, showTimestampIcon, getEmptyValueMarker, shouldHideMissingProperties, shouldHideEmptyProperties, getCardSpacing, getListSeparator } from '../utils/style-settings';
import { getPropertyLabel } from '../utils/property';
import type DynamicViewsPlugin from '../../main';
import type { Settings } from '../types';

// Extend App type to include dragManager
declare module 'obsidian' {
    interface App {
        dragManager: {
            dragFile(evt: DragEvent, file: TFile): unknown;
            onDragStart(evt: DragEvent, dragData: unknown): void;
        };
    }
}

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

        // Parse imageFormat to extract format and position
        const imageFormat = settings.imageFormat;
        let format: 'none' | 'thumbnail' | 'cover' = 'none';
        let position: 'left' | 'right' | 'top' | 'bottom' = 'right';

        if (imageFormat.startsWith('thumbnail-')) {
            format = 'thumbnail';
            position = imageFormat.split('-')[1] as 'left' | 'right';
        } else if (imageFormat.startsWith('cover-')) {
            format = 'cover';
            position = imageFormat.split('-')[1] as 'left' | 'right' | 'top' | 'bottom';
        }

        // Add format class
        if (format === 'cover') {
            cardEl.classList.add('image-format-cover');
        } else if (format === 'thumbnail') {
            cardEl.classList.add('image-format-thumbnail');
        }

        // Add position class
        if (format === 'thumbnail') {
            cardEl.classList.add(`card-thumbnail-${position}`);
        } else if (format === 'cover') {
            cardEl.classList.add(`card-cover-${position}`);
        }

        // Add cover fit mode class
        if (format === 'cover') {
            cardEl.classList.add(`card-cover-${settings.coverFitMode}`);
        }

        cardEl.setAttribute('data-path', card.path);

        // Only make card draggable when openFileAction is 'card'
        if (settings.openFileAction === 'card') {
            cardEl.setAttribute('draggable', 'true');
        }
        // Only show pointer cursor when entire card is clickable
        cardEl.classList.toggle('clickable-card', settings.openFileAction === 'card');

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
                const expandOnClick = document.body.classList.contains('dynamic-views-thumbnail-expand-click-hold') ||
                                     document.body.classList.contains('dynamic-views-thumbnail-expand-click-toggle');
                const shouldBlockImageClick = isImage && expandOnClick;

                if (!isLink && !isTag && !shouldBlockImageClick) {
                    const newLeaf = e.metaKey || e.ctrlKey;
                    const file = this.app.vault.getAbstractFileByPath(card.path);
                    if (file instanceof TFile) {
                        void this.app.workspace.getLeaf(newLeaf).openFile(file);
                    }
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

        // Drag handler function
        const handleDrag = (e: DragEvent) => {
            const file = this.app.vault.getAbstractFileByPath(card.path);
            if (!(file instanceof TFile)) return;

            const dragData = this.app.dragManager.dragFile(e, file);
            this.app.dragManager.onDragStart(e, dragData);
        };

        // Title - render as link when openFileAction is 'title', otherwise plain text
        if (settings.showTitle) {
            const titleEl = cardEl.createDiv('card-title');

            if (settings.openFileAction === 'title') {
                // Render as clickable, draggable link
                const link = titleEl.createEl('a', {
                    cls: 'internal-link',
                    text: card.title,
                    attr: { 'data-href': card.path, href: card.path, draggable: 'true' }
                });

                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const newLeaf = e.metaKey || e.ctrlKey;
                    void this.app.workspace.openLinkText(card.path, '', newLeaf);
                });

                // Make title draggable when openFileAction is 'title'
                link.addEventListener('dragstart', handleDrag);
            } else {
                // Render as plain text
                titleEl.appendText(card.title);
            }
        }

        // Make card draggable when openFileAction is 'card'
        if (settings.openFileAction === 'card') {
            cardEl.addEventListener('dragstart', handleDrag);
        }

        // Prepare image URLs if applicable
        const rawUrls = card.imageUrl ? (Array.isArray(card.imageUrl) ? card.imageUrl : [card.imageUrl]) : [];

        // Debug: Check for duplicates in raw URLs
        if (rawUrls.length > 1) {
            console.log('// [Debug] Raw URLs from card.imageUrl:', rawUrls.length, 'items');
            rawUrls.forEach((url, i) => {
                console.log(`//   [${i}]:`, url);
            });
        }

        // Filter and deduplicate URLs
        const imageUrls = Array.from(new Set(
            rawUrls.filter(url => url && typeof url === 'string' && url.trim().length > 0)
        ));
        const hasImage = format !== 'none' && imageUrls.length > 0;
        const hasImageAvailable = format !== 'none' && card.hasImageAvailable;

        // ALL COVERS: direct children of card (regardless of position)
        if (format === 'cover' && (hasImage || hasImageAvailable)) {
            if (hasImage) {
                const shouldShowCarousel =
                    (position === 'top' || position === 'bottom') &&
                    imageUrls.length >= 2;

                if (shouldShowCarousel) {
                    const carouselEl = cardEl.createDiv('card-cover card-cover-carousel');
                    this.renderCarousel(carouselEl, imageUrls, format, position, settings);
                } else {
                    const imageEl = cardEl.createDiv('card-cover');
                    this.renderImage(imageEl, imageUrls, format, position, settings);
                }
            } else {
                cardEl.createDiv('card-cover-placeholder');
            }
        }

        // Thumbnail-top: direct child of card
        if (format === 'thumbnail' && position === 'top' && (hasImage || hasImageAvailable)) {
            if (hasImage) {
                const imageEl = cardEl.createDiv('card-thumbnail');
                this.renderImage(imageEl, imageUrls, format, position, settings);
            } else {
                cardEl.createDiv('card-thumbnail-placeholder');
            }
        }

        // Determine if card-content will have children
        const hasTextPreview = settings.showTextPreview && card.snippet;
        const hasThumbnailInContent = format === 'thumbnail' && (position === 'left' || position === 'right') && (hasImage || hasImageAvailable);

        // Only create card-content if it will have children
        if (hasTextPreview || hasThumbnailInContent) {
            const contentContainer = cardEl.createDiv('card-content');

            if (hasTextPreview) {
                contentContainer.createDiv({ cls: 'card-text-preview', text: card.snippet });
            }

            if (hasThumbnailInContent && format === 'thumbnail') {
                if (hasImage) {
                    const imageEl = contentContainer.createDiv('card-thumbnail');
                    this.renderImage(imageEl, imageUrls, format, position, settings);
                } else {
                    contentContainer.createDiv('card-thumbnail-placeholder');
                }
            }
        }

        // Thumbnail-bottom: direct child of card
        if (format === 'thumbnail' && position === 'bottom' && (hasImage || hasImageAvailable)) {
            if (hasImage) {
                const imageEl = cardEl.createDiv('card-thumbnail');
                this.renderImage(imageEl, imageUrls, format, position, settings);
            } else {
                cardEl.createDiv('card-thumbnail-placeholder');
            }
        }

        // Properties - 4-field rendering with 2-row layout
        this.renderProperties(cardEl, card, entry, settings);
    }

    /**
     * Renders carousel for covers with multiple images
     */
    private renderCarousel(
        carouselEl: HTMLElement,
        imageUrls: string[],
        format: 'thumbnail' | 'cover',
        position: 'left' | 'right' | 'top' | 'bottom',
        settings: Settings
    ): void {
        let currentSlide = 0;

        console.log('// CAROUSEL INIT:', { totalSlides: imageUrls.length, urls: imageUrls });

        // Create slides container
        const slidesContainer = carouselEl.createDiv('carousel-slides');

        // Create all slides
        const slideElements = imageUrls.map((url, index) => {
            const slideEl = slidesContainer.createDiv('carousel-slide');
            if (index === 0) {
                slideEl.addClass('is-active');
            }
            // Don't add position classes to non-active slides - let transition logic handle it

            const imageEmbedContainer = slideEl.createDiv('image-embed');
            const imgEl = imageEmbedContainer.createEl('img', {
                attr: { src: url, alt: '' }
            });
            imageEmbedContainer.style.setProperty('--cover-image-url', `url("${url}")`);

            // Handle image load for masonry layout and color extraction
            const cardEl = carouselEl.closest('.card') as HTMLElement;
            if (cardEl && index === 0) { // Only setup for first image
                setupImageLoadHandler(
                    imgEl,
                    imageEmbedContainer,
                    cardEl,
                    this.updateLayoutRef.current || undefined
                );
            }

            return slideEl;
        });

        // Update slide with direction
        const updateSlide = (newIndex: number, direction: 'next' | 'prev') => {
            const oldSlide = slideElements[currentSlide];
            const newSlide = slideElements[newIndex];

            console.log('// CAROUSEL TRANSITION:', {
                from: currentSlide,
                to: newIndex,
                direction,
                oldClasses: oldSlide.className,
                newClasses: newSlide.className
            });

            // Position new slide off-screen in the direction it will enter from
            newSlide.removeClass('is-active', 'slide-left', 'slide-right');
            newSlide.addClass(direction === 'next' ? 'slide-right' : 'slide-left');

            console.log('// After positioning new slide:', newSlide.className);

            // Force reflow to ensure position is set before transition
            void newSlide.offsetHeight;

            // Move old slide out and new slide in
            oldSlide.removeClass('is-active', 'slide-left', 'slide-right');
            oldSlide.addClass(direction === 'next' ? 'slide-left' : 'slide-right');

            // Add is-active class (keep positioning class, CSS will handle the transition)
            newSlide.addClass('is-active');

            console.log('// After transition:', {
                oldClasses: oldSlide.className,
                newClasses: newSlide.className
            });

            currentSlide = newIndex;
        };

        // Navigation buttons
        const prevBtn = carouselEl.createEl('button', {
            cls: 'carousel-nav-button carousel-nav-prev',
            attr: { 'aria-label': 'Previous slide' }
        });
        prevBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
        prevBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const newIndex = currentSlide === 0 ? imageUrls.length - 1 : currentSlide - 1;
            // Direction based on visual progression: wrapping forward (last->first) should look like going forward
            const direction = currentSlide === 0 ? 'next' : 'prev';
            updateSlide(newIndex, direction);
        });

        const nextBtn = carouselEl.createEl('button', {
            cls: 'carousel-nav-button carousel-nav-next',
            attr: { 'aria-label': 'Next slide' }
        });
        nextBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';
        nextBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const newIndex = currentSlide === imageUrls.length - 1 ? 0 : currentSlide + 1;
            // Direction based on visual progression: wrapping back (last->first) should look like going backward
            const direction = currentSlide === imageUrls.length - 1 ? 'prev' : 'next';
            updateSlide(newIndex, direction);
        });
    }

    /**
     * Renders image (cover or thumbnail) with all necessary handlers
     */
    private renderImage(
        imageEl: HTMLElement,
        imageUrls: string[],
        format: 'thumbnail' | 'cover',
        position: 'left' | 'right' | 'top' | 'bottom',
        settings: Settings
    ): void {
        const imageEmbedContainer = imageEl.createDiv('image-embed');

            // Add zoom handler
            imageEmbedContainer.addEventListener('click', (e) => {
                const isToggleMode = document.body.classList.contains('dynamic-views-thumbnail-expand-click-toggle');
                const isHoldMode = document.body.classList.contains('dynamic-views-thumbnail-expand-click-hold');

                if (isToggleMode || isHoldMode) {
                    e.stopPropagation();

                    if (isToggleMode) {
                        const embedEl = e.currentTarget as HTMLElement;
                        const isZoomed = embedEl.classList.contains('is-zoomed');

                        if (isZoomed) {
                            // Close zoom
                            embedEl.classList.remove('is-zoomed');
                        } else {
                            // Close all other zoomed images first
                            document.querySelectorAll('.image-embed.is-zoomed').forEach(el => {
                                el.classList.remove('is-zoomed');
                            });
                            // Open this one
                            embedEl.classList.add('is-zoomed');

                            // Add listeners for closing
                            const closeZoom = (evt: Event) => {
                                const target = evt.target as HTMLElement;
                                // Don't close if clicking on the zoomed image itself
                                if (!embedEl.contains(target)) {
                                    embedEl.classList.remove('is-zoomed');
                                    document.removeEventListener('click', closeZoom);
                                    document.removeEventListener('keydown', handleEscape);
                                }
                            };

                            const handleEscape = (evt: KeyboardEvent) => {
                                if (evt.key === 'Escape') {
                                    embedEl.classList.remove('is-zoomed');
                                    document.removeEventListener('click', closeZoom);
                                    document.removeEventListener('keydown', handleEscape);
                                }
                            };

                            // Delay adding listeners to avoid immediate trigger
                            setTimeout(() => {
                                document.addEventListener('click', closeZoom);
                                document.addEventListener('keydown', handleEscape);
                            }, 0);
                        }
                    }
                }
            });

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
            prop ? resolveBasesProperty(this.app, prop, entry, card, settings) : null
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
                // Field 1 has content, field 2 empty
                // Add placeholder ONLY if prop2 is set AND not hidden by toggles
                if (prop2Set) {
                    const shouldHide = (values[1] === null && shouldHideMissingProperties()) ||
                                      (values[1] === '' && shouldHideEmptyProperties());
                    if (!shouldHide) {
                        const placeholderContent = field2El.createDiv('property-content');
                        const markerSpan = placeholderContent.createSpan('empty-value-marker');
                        markerSpan.textContent = getEmptyValueMarker();
                    }
                }
            } else if (!has1 && has2) {
                // Field 2 has content, field 1 empty
                // Add placeholder ONLY if prop1 is set AND not hidden by toggles
                if (prop1Set) {
                    const shouldHide = (values[0] === null && shouldHideMissingProperties()) ||
                                      (values[0] === '' && shouldHideEmptyProperties());
                    if (!shouldHide) {
                        const placeholderContent = field1El.createDiv('property-content');
                        const markerSpan = placeholderContent.createSpan('empty-value-marker');
                        markerSpan.textContent = getEmptyValueMarker();
                    }
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
                // Field 3 has content, field 4 empty
                // Add placeholder ONLY if prop4 is set AND not hidden by toggles
                if (prop4Set) {
                    const shouldHide = (values[3] === null && shouldHideMissingProperties()) ||
                                      (values[3] === '' && shouldHideEmptyProperties());
                    if (!shouldHide) {
                        const placeholderContent = field4El.createDiv('property-content');
                        const markerSpan = placeholderContent.createSpan('empty-value-marker');
                        markerSpan.textContent = getEmptyValueMarker();
                    }
                }
            } else if (!has3 && has4) {
                // Field 4 has content, field 3 empty
                // Add placeholder ONLY if prop3 is set AND not hidden by toggles
                if (prop3Set) {
                    const shouldHide = (values[2] === null && shouldHideMissingProperties()) ||
                                      (values[2] === '' && shouldHideEmptyProperties());
                    if (!shouldHide) {
                        const placeholderContent = field3El.createDiv('property-content');
                        const markerSpan = placeholderContent.createSpan('empty-value-marker');
                        markerSpan.textContent = getEmptyValueMarker();
                    }
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

        // Hide missing properties if toggle enabled (resolvedValue is null for missing properties)
        if (resolvedValue === null && shouldHideMissingProperties()) {
            return;
        }

        // Hide empty properties if toggle enabled (resolvedValue is '' for empty properties)
        if (resolvedValue === '' && shouldHideEmptyProperties()) {
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

        // Wrapper for scrolling content (gradients applied here)
        const contentWrapper = container.createDiv('property-content-wrapper');

        // Content container (actual property value)
        const metaContent = contentWrapper.createDiv('property-content');

        // If no value, show placeholder
        if (!resolvedValue) {
            const markerSpan = metaContent.createSpan('empty-value-marker');
            markerSpan.textContent = getEmptyValueMarker();
            return;
        }

        // Handle array properties - render as individual spans with separators
        if (resolvedValue.startsWith('{"type":"array","items":[')) {
            try {
                const arrayData = JSON.parse(resolvedValue) as { type: string; items: string[] };
                if (arrayData.type === 'array' && Array.isArray(arrayData.items)) {
                    const listWrapper = metaContent.createSpan('list-wrapper');
                    const separator = getListSeparator();
                    arrayData.items.forEach((item, idx) => {
                        const span = listWrapper.createSpan();
                        span.createSpan({ cls: 'list-item', text: item });
                        if (idx < arrayData.items.length - 1) {
                            span.createSpan({ cls: 'list-separator', text: separator });
                        }
                    });
                    return;
                }
            } catch {
                // Fall through to regular text rendering if JSON parse fails
            }
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

        // Measure property-content-wrapper (expands to content width in measuring mode)
        const wrapper1 = field1.querySelector('.property-content-wrapper') as HTMLElement;
        const wrapper2 = field2.querySelector('.property-content-wrapper') as HTMLElement;

        // Measure inline labels if present
        const label1 = field1.querySelector('.property-label-inline') as HTMLElement;
        const label2 = field2.querySelector('.property-label-inline') as HTMLElement;

        // Total width = wrapper width + label width (if inline label exists)
        // During measuring mode, wrapper has overflow-x: visible and expands to content width
        let width1 = wrapper1 ? wrapper1.scrollWidth : 0;
        let width2 = wrapper2 ? wrapper2.scrollWidth : 0;

        if (label1) {
            width1 += label1.scrollWidth;
        }
        if (label2) {
            width2 += label2.scrollWidth;
        }

        const containerWidth = row.clientWidth;
        const gap = getCardSpacing();
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

        // Reset scroll position to 0 for both wrappers (reuse variables from measurement)
        if (wrapper1) wrapper1.scrollLeft = 0;
        if (wrapper2) wrapper2.scrollLeft = 0;

        // Update scroll gradients after layout settles
        // Use double RAF to ensure CSS variables are fully applied before checking scrollability
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                updateScrollGradient(field1);
                updateScrollGradient(field2);
            });
        });
    }

}
