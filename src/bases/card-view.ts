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
import type DynamicViewsPlugin from '../../main';

export const CARD_VIEW_TYPE = 'dynamic-views-card';

export class DynamicViewsCardView extends BasesView {
    readonly type = CARD_VIEW_TYPE;
    private plugin: DynamicViewsPlugin;
    private viewId: string;
    private containerEl: HTMLElement;
    private snippets: Record<string, string> = {};
    private images: Record<string, string | string[]> = {};
    private hasImageAvailable: Record<string, boolean> = {};
    private updateLayoutRef: { current: (() => void) | null } = { current: null };
    private focusableCardIndex: number = 0;
    private previousSettings: { metadataDisplayLeft: string; metadataDisplayRight: string } | null = null;
    private metadataDisplayWinner: 'left' | 'right' | null = null;

    constructor(controller: any, containerEl: HTMLElement, plugin: DynamicViewsPlugin) {
        super(controller);
        this.plugin = plugin;
        // Generate stable view ID from source file ctime (survives renames/moves) and view type
        const ctime = controller.source?.stat?.ctime || Date.now();
        this.viewId = `${ctime}:${CARD_VIEW_TYPE}`;
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

        // Track previous settings to determine winner when both match
        if (this.previousSettings) {
            const leftChanged = settings.metadataDisplayLeft !== this.previousSettings.metadataDisplayLeft;
            const rightChanged = settings.metadataDisplayRight !== this.previousSettings.metadataDisplayRight;

            // Check if both are now the same non-none value
            if (settings.metadataDisplayLeft !== 'none' &&
                settings.metadataDisplayLeft === settings.metadataDisplayRight) {
                // Determine which one changed (the one that changed loses, the one that stayed wins)
                if (leftChanged && !rightChanged) {
                    this.metadataDisplayWinner = 'right'; // Right had it first
                    await this.plugin.persistenceManager.setBasesViewMetadataWinner(this.viewId, 'right');
                } else if (rightChanged && !leftChanged) {
                    this.metadataDisplayWinner = 'left'; // Left had it first
                    await this.plugin.persistenceManager.setBasesViewMetadataWinner(this.viewId, 'left');
                } else {
                    // Both changed simultaneously - shouldn't happen in normal use
                    // Keep existing winner if set
                    if (this.metadataDisplayWinner === null) {
                        this.metadataDisplayWinner = 'left';
                        await this.plugin.persistenceManager.setBasesViewMetadataWinner(this.viewId, 'left');
                    }
                }
            } else {
                // No duplicate, clear winner
                if (this.metadataDisplayWinner !== null) {
                    this.metadataDisplayWinner = null;
                    await this.plugin.persistenceManager.setBasesViewMetadataWinner(this.viewId, null);
                }
            }
        } else {
            // First load - load saved winner or default to left if duplicate exists
            if (settings.metadataDisplayLeft !== 'none' &&
                settings.metadataDisplayLeft === settings.metadataDisplayRight) {
                // Try to load saved winner
                const savedWinner = this.plugin.persistenceManager.getBasesViewMetadataWinner(this.viewId);
                this.metadataDisplayWinner = savedWinner || 'left';
                // Save if we used default
                if (!savedWinner) {
                    await this.plugin.persistenceManager.setBasesViewMetadataWinner(this.viewId, 'left');
                }
            }
        }

        // Update previous settings for next comparison
        this.previousSettings = {
            metadataDisplayLeft: settings.metadataDisplayLeft,
            metadataDisplayRight: settings.metadataDisplayRight
        };

        // Load snippets and images for visible entries
        await this.loadContentForEntries(entries, settings);

        // DEBUG: Always log to diagnose
        console.log('// DEBUG: onDataUpdated called');
        console.log('//   Entries count:', entries.length);
        console.log('//   createdProperty setting:', settings.createdProperty);
        console.log('//   modifiedProperty setting:', settings.modifiedProperty);

        // DEBUG: Test date property format
        if (entries.length > 0) {
            const testEntry = entries[0];
            console.log('//   Test entry exists:', !!testEntry);

            if (settings.createdProperty) {
                const createdValue = testEntry.getValue(settings.createdProperty as any);
                console.log('// DEBUG: Created property test');
                console.log('//   Property name:', settings.createdProperty);
                console.log('//   Value:', createdValue);
                console.log('//   Value type:', typeof createdValue);
                console.log('//   Value constructor:', createdValue?.constructor?.name);
                console.log('//   Value.data:', (createdValue as any)?.data);
                console.log('//   Value.type:', (createdValue as any)?.type);
                console.log('//   Value.toString():', createdValue?.toString());
                console.log('//   Has isEmpty():', typeof (createdValue as any)?.isEmpty === 'function');
                if (typeof (createdValue as any)?.isEmpty === 'function') {
                    console.log('//   isEmpty() result:', (createdValue as any).isEmpty());
                }
            }
            if (settings.modifiedProperty) {
                const modifiedValue = testEntry.getValue(settings.modifiedProperty as any);
                console.log('// DEBUG: Modified property test');
                console.log('//   Property name:', settings.modifiedProperty);
                console.log('//   Value:', modifiedValue);
                console.log('//   Value type:', typeof modifiedValue);
                console.log('//   Value constructor:', modifiedValue?.constructor?.name);
                console.log('//   Value.data:', (modifiedValue as any)?.data);
                console.log('//   Value.type:', (modifiedValue as any)?.type);
                console.log('//   Value.toString():', modifiedValue?.toString());
                console.log('//   Has isEmpty():', typeof (modifiedValue as any)?.isEmpty === 'function');
                if (typeof (modifiedValue as any)?.isEmpty === 'function') {
                    console.log('//   isEmpty() result:', (modifiedValue as any).isEmpty());
                }
            }
        }

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

        // Metadata - apply winner logic
        const effectiveLeft = this.metadataDisplayWinner === 'right' &&
            settings.metadataDisplayLeft !== 'none' &&
            settings.metadataDisplayLeft === settings.metadataDisplayRight
                ? 'none'
                : settings.metadataDisplayLeft;

        const effectiveRight = this.metadataDisplayWinner === 'left' &&
            settings.metadataDisplayRight !== 'none' &&
            settings.metadataDisplayLeft === settings.metadataDisplayRight
                ? 'none'
                : settings.metadataDisplayRight;

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
            this.renderMetadataContent(metaLeft, effectiveLeft, card, settings);

            // Right side
            const metaRight = metaEl.createDiv('meta-right');
            this.renderMetadataContent(metaRight, effectiveRight, card, settings);
        }
    }

    private renderMetadataContent(
        container: HTMLElement,
        displayType: 'none' | 'timestamp' | 'tags' | 'path',
        card: CardData,
        settings: any
    ): void {
        if (displayType === 'none') return;

        if (displayType === 'timestamp') {
            const useCreatedTime = this.getSortMethod().startsWith('ctime');
            const timestamp = useCreatedTime ? card.ctime : card.mtime;
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
