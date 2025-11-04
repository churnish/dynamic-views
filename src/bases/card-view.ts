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

export const CARD_VIEW_TYPE = 'dynamic-views-card';

export class DynamicViewsCardView extends BasesView {
    readonly type = CARD_VIEW_TYPE;
    private containerEl: HTMLElement;
    private snippets: Record<string, string> = {};
    private images: Record<string, string | string[]> = {};
    private hasImageAvailable: Record<string, boolean> = {};
    private updateLayoutRef: { current: (() => void) | null } = { current: null };
    private focusableCardIndex: number = 0;

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

        // Create cards feed container
        const feedEl = this.containerEl.createDiv('cards-feed');

        // Render each card
        for (let i = 0; i < cards.length; i++) {
            const card = cards[i];
            this.renderCard(feedEl, card, i, settings);
        }
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
export const cardViewOptions = getBasesViewOptions;
