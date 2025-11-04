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

    constructor(controller: any, containerEl: HTMLElement) {
        super(controller);
        this.containerEl = containerEl;
        this.containerEl.addClass('dynamic-views-bases-container');
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
            this.renderCard(this.masonryContainer, card, i, settings);
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

        // Metadata (timestamp + tags/path)
        const useCreatedTime = this.getSortMethod().startsWith('ctime');
        const timestamp = useCreatedTime ? card.ctime : card.mtime;
        const hasTimestamp = settings.showTimestamp && timestamp;
        const hasMetadata = (settings.cardBottomDisplay === 'tags' && card.tags.length > 0) ||
                           (settings.cardBottomDisplay === 'path' && card.folderPath.length > 0);

        if (hasTimestamp || hasMetadata) {
            const metaEl = cardEl.createDiv('writing-meta');
            if (!hasTimestamp) metaEl.addClass('no-timestamp');

            // Timestamp
            const metaLeft = metaEl.createSpan('meta-left');
            if (hasTimestamp) {
                const date = this.formatTimestamp(timestamp);
                if (settings.showTimestampIcon) {
                    const iconName = useCreatedTime ? 'calendar' : 'clock';
                    const iconEl = metaLeft.createSpan('timestamp-icon');
                    // Use Obsidian's setIcon function
                    setIcon(iconEl, iconName);
                    iconEl.style.display = 'inline-block';
                    iconEl.style.width = '14px';
                    iconEl.style.height = '14px';
                    iconEl.style.verticalAlign = 'middle';
                    iconEl.style.marginRight = '4px';
                }
                metaLeft.appendText(date);
            }

            // Tags or path
            const metaRight = metaEl.createDiv('meta-right');
            if (settings.cardBottomDisplay === 'tags' && card.tags.length > 0) {
                const tagsWrapper = metaRight.createDiv('tags-wrapper');
                card.tags.forEach(tag => {
                    tagsWrapper.createEl('a', {
                        cls: 'tag',
                        text: tag.replace(/^#/, ''),
                        href: '#'
                    });
                });
            } else if (settings.cardBottomDisplay === 'path' && card.folderPath.length > 0) {
                const pathWrapper = metaRight.createDiv('path-wrapper');
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

    private getSortMethod(): string {
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
                            const file = this.app.vault.getAbstractFileByPath(path);
                            if (file instanceof TFile && file.extension === 'md') {
                                const content = await this.app.vault.cachedRead(file);
                                const snippet = sanitizeForPreview(
                                    content,
                                    settings.alwaysOmitFirstLine
                                );
                                this.snippets[path] = snippet;
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
                            // Get image from property
                            const imageValue = entry.getValue(settings.imageProperty);

                            if (imageValue != null && imageValue !== '') {
                                const imageStr = String(imageValue);

                                // Handle external URLs
                                if (isExternalUrl(imageStr)) {
                                    const isValid = await validateImageUrl(imageStr);
                                    if (isValid) {
                                        this.images[path] = imageStr;
                                        this.hasImageAvailable[path] = true;
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
                                        this.images[path] = result;
                                        this.hasImageAvailable[path] = true;
                                    }
                                }
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
