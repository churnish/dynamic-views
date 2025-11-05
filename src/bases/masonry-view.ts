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
import { getFirstBasesPropertyValue, getAllBasesImagePropertyValues, getFirstBasesDatePropertyValue } from '../utils/property';
import type DynamicViewsPlugin from '../../main';

export const MASONRY_VIEW_TYPE = 'dynamic-views-masonry';

export class DynamicViewsMasonryView extends BasesView {
    readonly type = MASONRY_VIEW_TYPE;
    private containerEl: HTMLElement;
    private snippets: Record<string, string> = {};
    private images: Record<string, string | string[]> = {};
    private hasImageAvailable: Record<string, boolean> = {};
    private updateLayoutRef: { current: (() => void) | null } = { current: null };
    private focusableCardIndex: number = 0;
    private masonryContainer: HTMLElement | null = null;

    constructor(controller: any, containerEl: HTMLElement, plugin: DynamicViewsPlugin) {
        super(controller);
        this.containerEl = containerEl;
        // Add both classes - 'dynamic-views' for CSS styling, 'dynamic-views-bases-container' for identification
        this.containerEl.addClass('dynamic-views');
        this.containerEl.addClass('dynamic-views-bases-container');
        // Make container scrollable
        this.containerEl.style.overflowY = 'auto';
        this.containerEl.style.height = '100%';
    }

    async onDataUpdated(): Promise<void> {
        const { app } = this;
        const entries = this.data.data;

        // Read settings from Bases config
        const settings = readBasesSettings(this.config);

        // Load snippets and images for visible entries
        await this.loadContentForEntries(entries, settings);

        // Transform to CardData
        const cards = transformBasesEntries(
            entries,
            settings,
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
            const entry = entries[i];
            this.renderCard(this.masonryContainer, card, entry, i, settings);
        }

        // Initial layout calculation
        if (this.updateLayoutRef.current) {
            // Delay to allow images to start loading
            setTimeout(() => {
                if (this.updateLayoutRef.current) {
                    this.updateLayoutRef.current();
                }
            }, 50);
        }
    }

    private setupMasonryLayout(settings: any): void {
        if (!this.masonryContainer) return;

        const minColumns = settings.minMasonryColumns || 1;

        // Setup update function
        this.updateLayoutRef.current = () => {
            if (!this.masonryContainer) return;

            const cards = Array.from(this.masonryContainer.querySelectorAll('.writing-card')) as HTMLElement[];
            if (cards.length === 0) return;

            const containerWidth = this.masonryContainer.clientWidth;
            const cardWidth = 346;  // Base card width
            const gap = 8;  // Gap between cards

            // Calculate number of columns
            const columns = Math.max(
                minColumns,
                Math.floor((containerWidth + gap) / (cardWidth + gap))
            );

            // Calculate actual card width accounting for gaps
            const actualCardWidth = (containerWidth - (gap * (columns - 1))) / columns;

            // Initialize column heights
            const columnHeights = new Array(columns).fill(0);

            // Position each card
            cards.forEach((card, index) => {
                // Find shortest column
                const shortestColumn = columnHeights.indexOf(Math.min(...columnHeights));

                // Calculate position
                const left = shortestColumn * (actualCardWidth + gap);
                const top = columnHeights[shortestColumn];

                // Apply positioning
                card.style.width = `${actualCardWidth}px`;
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
            const useCreatedTime = this.getSortMethod().startsWith('ctime');
            const customProperty = useCreatedTime ? settings.createdProperty : settings.modifiedProperty;
            const fallbackEnabled = useCreatedTime ? settings.fallbackToCtime : settings.fallbackToMtime;

            let timestamp: number | null = null;

            if (customProperty) {
                // Try to get first valid date from comma-separated properties
                const value = getFirstBasesDatePropertyValue(entry, customProperty);

                if (value && this.isDateValue(value)) {
                    // Found valid date property
                    timestamp = this.extractTimestamp(value);
                } else if (fallbackEnabled) {
                    // No valid property date found - fall back to file metadata if enabled
                    timestamp = useCreatedTime ? card.ctime : card.mtime;
                }
                // If no valid property and fallback disabled, timestamp remains null
            } else if (fallbackEnabled) {
                // No custom property configured - use file metadata if fallback enabled
                timestamp = useCreatedTime ? card.ctime : card.mtime;
            }

            if (timestamp) {
                const date = this.formatTimestamp(timestamp);
                if (settings.showTimestampIcon) {
                    const iconName = useCreatedTime ? 'calendar' : 'clock';
                    const iconEl = container.createSpan('timestamp-icon');
                    setIcon(iconEl, iconName);
                    iconEl.style.display = 'inline-block';
                    iconEl.style.width = '14px';
                    iconEl.style.height = '14px';
                    iconEl.style.verticalAlign = 'middle';
                    iconEl.style.marginRight = '4px';
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

    private isDateValue(value: any): boolean {
        return value?.date instanceof Date;
    }

    private extractTimestamp(value: any): number | null {
        if (this.isDateValue(value)) {
            return value.date.getTime();
        }
        return null;
    }

    private formatTimestamp(timestamp: number): string {
        const date = new Date(timestamp);
        const now = Date.now();
        const isRecent = now - timestamp < 86400000;

        const yyyy = date.getFullYear();
        const MM = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');

        if (isRecent) {
            const HH = String(date.getHours()).padStart(2, '0');
            const mm = String(date.getMinutes()).padStart(2, '0');
            return `${yyyy}-${MM}-${dd} ${HH}:${mm}`;
        }

        return `${yyyy}-${MM}-${dd}`;
    }

    private getSortMethod(): string{
        // Get sort from Bases config if available
        const sort = this.config.getOrder();
        if (sort && sort.length > 0) {
            const firstSort = sort[0];
            // Simple mapping - extend as needed
            if (firstSort.includes('ctime')) return 'ctime-desc';
            if (firstSort.includes('mtime')) return 'mtime-desc';
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
                                        settings.alwaysOmitFirstLine
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
}

/** Export options for registration */
export const masonryViewOptions = getMasonryViewOptions;
