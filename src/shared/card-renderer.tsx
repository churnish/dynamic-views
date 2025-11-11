/**
 * Shared card renderer - Pure rendering component
 * Works with both Bases and Datacore by accepting normalized card data
 */

import type { App } from 'obsidian';
import type { Settings } from '../types';
import type { RefObject } from '../types/datacore';
import { getTagStyle, showTimestampIcon } from '../utils/style-settings';
import { extractAverageColor } from '../utils/image-color';

// Extend App type to include isMobile property
declare module 'obsidian' {
    interface App {
        isMobile: boolean;
        internalPlugins: {
            plugins: Record<string, { enabled: boolean; instance?: { openGlobalSearch?: (query: string) => void; revealInFolder?: (file: unknown) => void } }>;
            getPluginById(id: string): { instance?: unknown } | null;
        };
    }
}

/** Normalized card data structure (framework-agnostic) */
export interface CardData {
    path: string;
    name: string;
    title: string;
    tags: string[];
    ctime: number;  // milliseconds
    mtime: number;  // milliseconds
    folderPath: string;
    snippet?: string;
    imageUrl?: string | string[];
    hasImageAvailable: boolean;
    // Property names (for rendering special properties)
    propertyName1?: string;
    propertyName2?: string;
    propertyName3?: string;
    propertyName4?: string;
    // Resolved property values (null if missing/empty)
    property1?: string | null;
    property2?: string | null;
    property3?: string | null;
    property4?: string | null;
}

export interface CardRendererProps {
    cards: CardData[];
    settings: Settings;
    viewMode: 'card' | 'masonry';
    sortMethod: string;
    isShuffled: boolean;
    focusableCardIndex: number;
    containerRef: RefObject<HTMLElement | null>;
    updateLayoutRef: RefObject<(() => void) | null>;
    app: App;
    onCardClick?: (path: string, newLeaf: boolean) => void;
    onFocusChange?: (index: number) => void;
}

/**
 * Helper function to render property content based on display type
 */
function renderPropertyContent(
    propertyName: string,
    card: CardData,
    resolvedValue: string,
    timeIcon: 'calendar' | 'clock',
    settings: Settings,
    app: App
): unknown {
    if (propertyName === '' || !resolvedValue) {
        return null;
    }

    // Handle special properties by property name
    // For timestamps: file.mtime, file.ctime, or legacy formats
    if (propertyName === 'file.mtime' || propertyName === 'file.ctime' ||
        propertyName === 'timestamp' || propertyName === 'modified time' || propertyName === 'created time') {
        return (
            <div className="property-content">
                <span>
                    {showTimestampIcon() && (
                        <svg className="timestamp-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            {timeIcon === "calendar" ? (
                                <>
                                    <path d="M8 2v4"/>
                                    <path d="M16 2v4"/>
                                    <rect width="18" height="18" x="3" y="4" rx="2"/>
                                    <path d="M3 10h18"/>
                                </>
                            ) : (
                                <>
                                    <circle cx="12" cy="12" r="10"/>
                                    <polyline points="12 6 12 12 16 14"/>
                                </>
                            )}
                        </svg>
                    )}
                    <span>{resolvedValue}</span>
                </span>
            </div>
        );
    } else if ((propertyName === 'file.tags' || propertyName === 'tags' || propertyName === 'file tags') && card.tags.length > 0) {
        const tagStyle = getTagStyle();
        const showHashPrefix = tagStyle === 'minimal';

        return (
            <div className="property-content">
                <div className="tags-wrapper">
                    {card.tags.map((tag): JSX.Element => (
                        <a
                            key={tag}
                            href="#"
                            className="tag"
                            onClick={(e: MouseEvent) => {
                                e.preventDefault();
                                const searchPlugin = app.internalPlugins.plugins["global-search"];
                                if (searchPlugin?.instance?.openGlobalSearch) {
                                    searchPlugin.instance.openGlobalSearch("tag:" + tag);
                                }
                            }}
                        >
                            {showHashPrefix ? '#' + tag : tag}
                        </a>
                    ))}
                </div>
            </div>
        );
    } else if ((propertyName === 'file.path' || propertyName === 'path' || propertyName === 'file path') && resolvedValue) {
        return (
            <div className="property-content">
                <div className="path-wrapper">
                    {resolvedValue.split('/').filter(f => f).map((folder, idx, array): JSX.Element => {
                        const allParts = resolvedValue.split('/').filter(f => f);
                        const cumulativePath = allParts.slice(0, idx + 1).join('/');
                        return (
                            <span key={idx} style={{ display: 'inline-flex', alignItems: 'center' }}>
                                <span
                                    className="path-segment file-path-segment"
                                    onClick={(e: MouseEvent) => {
                                        e.stopPropagation();
                                        const fileExplorer = app.internalPlugins?.plugins?.["file-explorer"];
                                        if (fileExplorer?.instance?.revealInFolder) {
                                            const folder = app.vault.getAbstractFileByPath(cumulativePath);
                                            if (folder) {
                                                fileExplorer.instance.revealInFolder(folder);
                                            }
                                        }
                                    }}
                                >
                                    {folder}
                                </span>
                                {idx < array.length - 1 && <span className="path-separator">/</span>}
                            </span>
                        );
                    })}
                </div>
            </div>
        );
    }

    // Generic property: just render the resolved value as text
    return (
        <div className="property-content">
            <span>{resolvedValue}</span>
        </div>
    );
}

export function CardRenderer({
    cards,
    settings,
    viewMode,
    sortMethod,
    isShuffled,
    focusableCardIndex,
    containerRef,
    updateLayoutRef,
    app,
    onCardClick,
    onFocusChange
}: CardRendererProps): unknown {
    return (
        <div
            ref={containerRef}
            className={viewMode === "masonry" ? "cards-masonry" : "cards-feed"}
            style={settings.queryHeight > 0 ? { maxHeight: `${settings.queryHeight}px`, overflowY: 'auto' } : {}}
        >
            {cards.map((card, index): JSX.Element =>
                <Card
                    key={card.path}
                    card={card}
                    index={index}
                    settings={settings}
                    viewMode={viewMode}
                    sortMethod={sortMethod}
                    isShuffled={isShuffled}
                    focusableCardIndex={focusableCardIndex}
                    containerRef={containerRef}
                    updateLayoutRef={updateLayoutRef}
                    app={app}
                    onCardClick={onCardClick}
                    onFocusChange={onFocusChange}
                />
            )}
        </div>
    );
}

interface CardProps {
    key?: string;  // React/Preact key for element reconciliation
    card: CardData;
    index: number;
    settings: Settings;
    viewMode: 'card' | 'masonry';
    sortMethod: string;
    isShuffled: boolean;
    focusableCardIndex: number;
    containerRef: RefObject<HTMLElement | null>;
    updateLayoutRef: RefObject<(() => void) | null>;
    app: App;
    onCardClick?: (path: string, newLeaf: boolean) => void;
    onFocusChange?: (index: number) => void;
}

function Card({
    card,
    index,
    settings,
    viewMode,
    sortMethod,
    isShuffled,
    focusableCardIndex,
    containerRef,
    updateLayoutRef,
    app,
    onCardClick,
    onFocusChange
}: CardProps): unknown {
    // Determine which timestamp to show
    const useCreatedTime = sortMethod.startsWith('ctime') && !isShuffled;
    // Determine time icon (calendar for ctime, clock for mtime)
    const timeIcon = useCreatedTime ? "calendar" : "clock";

    // Handle images
    const isArray = Array.isArray(card.imageUrl);
    const imageArray: string[] = isArray
        ? (card.imageUrl as (string | string[])[])
            .flat()
            .filter((url): url is string => typeof url === 'string' && url.length > 0)
        : (card.imageUrl ? [card.imageUrl as string] : []);

    // Track hovered image index (for multi-image thumbnails)
    // TODO: Implement image cycling on hover
    // const hoveredImageIndex = 0;

    return (
        <div
            className={`writing-card ${settings.imageFormat === 'cover' ? 'image-format-cover' : ''}`}
            data-path={card.path}
            tabIndex={index === focusableCardIndex ? 0 : -1}
            onClick={(e: MouseEvent) => {
                if (settings.openFileAction === 'card') {
                    const target = e.target as HTMLElement;
                    // Allow clicks on title link and its children when openFileAction is 'card'
                    const isInsideTitleLink = target.closest('.card-title-link');
                    // Don't open if clicking on other links or images
                    const isOtherLink = target.tagName === 'A' && !target.classList.contains('card-title-link');
                    const isInsideOtherLink = target.closest('a') && !isInsideTitleLink;
                    const isImage = target.tagName === 'IMG';
                    const expandOnClick = document.body.classList.contains('dynamic-views-thumbnail-expand-click');
                    const shouldBlockImageClick = isImage && expandOnClick;

                    if (!isOtherLink && !isInsideOtherLink && !shouldBlockImageClick) {
                        const newLeaf = e.metaKey || e.ctrlKey;
                        if (onCardClick) {
                            onCardClick(card.path, newLeaf);
                        } else {
                            void app.workspace.openLinkText(card.path, "", newLeaf);
                        }
                    }
                }
            }}
            onFocus={() => {
                if (onFocusChange) {
                    onFocusChange(index);
                }
            }}
            onKeyDown={(e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (settings.openFileAction === 'card') {
                        const newLeaf = e.metaKey || e.ctrlKey;
                        if (onCardClick) {
                            onCardClick(card.path, newLeaf);
                        } else {
                            void app.workspace.openLinkText(card.path, "", newLeaf);
                        }
                    }
                } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                    e.preventDefault();
                    handleArrowKey(e, index, viewMode, containerRef, onFocusChange);
                } else if (e.key === 'Tab') {
                    e.preventDefault();
                }
            }}
            onMouseEnter={(e: MouseEvent) => {
                // Trigger Obsidian's hover preview
                app.workspace.trigger('hover-link', {
                    event: e,
                    source: 'dynamic-views',
                    hoverParent: e.currentTarget,
                    targetEl: e.currentTarget,
                    linktext: card.path,
                    sourcePath: card.path
                });
                // Reset hover index to 0
                const imgEl = (e.currentTarget as HTMLElement).querySelector('.card-thumbnail img');
                const firstImage = imageArray[0];
                if (imgEl && firstImage) {
                    (imgEl as HTMLImageElement).src = firstImage;
                }
            }}
            style={{ cursor: 'pointer' }}
        >
            {/* Title */}
            {settings.showTitle && (
                <div className="writing-title">
                    <a
                        href={card.path}
                        className="internal-link card-title-link"
                        data-href={card.path}
                        onClick={(e: MouseEvent) => {
                            e.preventDefault();
                            if (settings.openFileAction === 'title') {
                                const newLeaf = e.metaKey || e.ctrlKey;
                                void app.workspace.openLinkText(card.path, "", newLeaf);
                            }
                            // Otherwise prevent default and let card handler deal with it
                        }}
                    >
                        <span className="title-text">{card.title}</span>
                    </a>
                </div>
            )}

            {/* Snippet and Thumbnail */}
            {((settings.showTextPreview && card.snippet) || (settings.showThumbnails && (imageArray.length > 0 || card.hasImageAvailable))) && (
                <div className="snippet-container">
                    {settings.showTextPreview && card.snippet && (
                        <div className="writing-snippet">{card.snippet}</div>
                    )}
                    {settings.showThumbnails && (
                        imageArray.length > 0 ? (
                            <div
                                className={`card-thumbnail ${isArray && imageArray.length > 1 ? 'multi-image' : ''}`}
                                onMouseMove={!app.isMobile && isArray && imageArray.length > 1 ? ((e: MouseEvent) => {
                                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                    const x = e.clientX - rect.left;
                                    const section = Math.floor((x / rect.width) * imageArray.length);
                                    const newIndex = Math.min(section, imageArray.length - 1);
                                    const imgEl = (e.currentTarget as HTMLElement).querySelector('img');
                                    const newSrc = imageArray[newIndex];
                                    if (imgEl && newSrc) {
                                        const currentSrc = imgEl.src;
                                        if (currentSrc !== newSrc) {
                                            imgEl.src = newSrc;
                                        }
                                    }
                                }) : undefined}
                                onMouseLeave={!app.isMobile ? ((e: MouseEvent) => {
                                    const imgEl = (e.currentTarget as HTMLElement).querySelector('img');
                                    const firstSrc = imageArray[0];
                                    if (imgEl && firstSrc) {
                                        imgEl.src = firstSrc;
                                    }
                                }) : undefined}
                            >
                                <div
                                    className="image-embed"
                                    style={{ '--cover-image-url': `url("${imageArray[0] || ''}")` }}
                                >
                                    <img
                                        src={imageArray[0] || ''}
                                        alt=""
                                        onLoad={(e: Event) => {
                                            // Extract ambient color for letterbox background
                                            const imgEl = e.currentTarget as HTMLImageElement;
                                            const ambientColor = extractAverageColor(imgEl);
                                            const imageEmbedEl = imgEl.parentElement;
                                            if (imageEmbedEl) {
                                                imageEmbedEl.style.setProperty('--ambient-color', ambientColor);

                                                // Set aspect ratio for flexible cover height (masonry only)
                                                const thumbEl = imageEmbedEl.parentElement;
                                                if (thumbEl && imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0) {
                                                    const imgAspect = imgEl.naturalHeight / imgEl.naturalWidth;
                                                    const containerMaxAspect = parseFloat(
                                                        getComputedStyle(document.body).getPropertyValue('--dynamic-views-image-aspect-ratio') || '0.55'
                                                    );

                                                    // If image is wider (lower aspect ratio), use its ratio
                                                    if (imgAspect < containerMaxAspect) {
                                                        const cardEl = thumbEl.closest('.writing-card') as HTMLElement;
                                                        if (cardEl) {
                                                            cardEl.style.setProperty('--actual-aspect-ratio', imgAspect.toString());
                                                        }
                                                    }
                                                }
                                            }

                                            if (updateLayoutRef.current) {
                                                updateLayoutRef.current();
                                            }
                                        }}
                                    />
                                </div>
                            </div>
                        ) : (
                            // Always render placeholder when no image - CSS controls visibility
                            <div className="card-thumbnail-placeholder"></div>
                        )
                    )}
                </div>
            )}

            {/* Properties - 4-field rendering with 2-row layout */}
            {(() => {
                // Check if any row has content
                const row1HasContent = card.property1 !== null || card.property2 !== null;
                const row2HasContent = card.property3 !== null || card.property4 !== null;

                if (!row1HasContent && !row2HasContent) return null;

                // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- JSX.Element resolves to any due to Datacore's JSX runtime
                return (
                    <div className="card-properties properties-4field">
                        {/* Row 1 */}
                        {row1HasContent && (
                            <div className={`property-row property-row-1${settings.propertyLayout12SideBySide ? ' property-row-sidebyside' : ''}${
                                (card.property1 === null && card.property2 !== null) || (card.property1 !== null && card.property2 === null) ? ' property-row-single' : ''
                            }`}>
                                <div className="property-field property-field-1">
                                    {card.property1 && renderPropertyContent(card.propertyName1 || '', card, card.property1, timeIcon, settings, app)}
                                </div>
                                <div className="property-field property-field-2">
                                    {card.property2 && renderPropertyContent(card.propertyName2 || '', card, card.property2, timeIcon, settings, app)}
                                </div>
                            </div>
                        )}
                        {/* Row 2 */}
                        {row2HasContent && (
                            <div className={`property-row property-row-2${settings.propertyLayout34SideBySide ? ' property-row-sidebyside' : ''}${
                                (card.property3 === null && card.property4 !== null) || (card.property3 !== null && card.property4 === null) ? ' property-row-single' : ''
                            }`}>
                                <div className="property-field property-field-3">
                                    {card.property3 && renderPropertyContent(card.propertyName3 || '', card, card.property3, timeIcon, settings, app)}
                                </div>
                                <div className="property-field property-field-4">
                                    {card.property4 && renderPropertyContent(card.propertyName4 || '', card, card.property4, timeIcon, settings, app)}
                                </div>
                            </div>
                        )}
                    </div>
                );
            })()}
        </div>
    );
}

// Helper function for arrow key navigation
function handleArrowKey(
    e: KeyboardEvent,
    currentIndex: number,
    viewMode: 'card' | 'masonry',
    containerRef: RefObject<HTMLElement | null>,
    onFocusChange?: (index: number) => void
): void {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- querySelectorAll returns Element[], need HTMLElement[] for navigation
    const cards = Array.from(containerRef.current?.querySelectorAll('.writing-card') || []) as HTMLElement[];
    const currentCard = e.currentTarget as HTMLElement;
    const actualIndex = cards.indexOf(currentCard);

    if (actualIndex === -1) return;

    const currentRect = currentCard.getBoundingClientRect();
    const currentX = currentRect.left + currentRect.width / 2;
    const currentY = currentRect.top + currentRect.height / 2;

    let targetCard: HTMLElement | null = null;
    let minDistance = Infinity;

    if (viewMode === 'masonry') {
        // 2D navigation based on actual positions
        cards.forEach((card, idx) => {
            if (idx === actualIndex) return;

            const rect = card.getBoundingClientRect();
            const cardX = rect.left + rect.width / 2;
            const cardY = rect.top + rect.height / 2;

            let isValid = false;
            let distance = 0;

            if (e.key === 'ArrowDown' && cardY > currentY) {
                if (rect.left !== currentRect.left) return;
                const verticalDist = cardY - currentY;
                const horizontalDist = Math.abs(cardX - currentX);
                distance = verticalDist + horizontalDist * 0.5;
                isValid = true;
            } else if (e.key === 'ArrowUp' && cardY < currentY) {
                if (rect.left !== currentRect.left) return;
                const verticalDist = currentY - cardY;
                const horizontalDist = Math.abs(cardX - currentX);
                distance = verticalDist + horizontalDist * 0.5;
                isValid = true;
            } else if (e.key === 'ArrowRight' && cardX > currentX) {
                const horizontalDist = cardX - currentX;
                const verticalDist = Math.abs(cardY - currentY);
                distance = horizontalDist + verticalDist * 0.5;
                isValid = true;
            } else if (e.key === 'ArrowLeft' && cardX < currentX) {
                const horizontalDist = currentX - cardX;
                const verticalDist = Math.abs(cardY - currentY);
                distance = horizontalDist + verticalDist * 0.5;
                isValid = true;
            }

            if (isValid && distance < minDistance) {
                minDistance = distance;
                targetCard = card;
            }
        });
    } else {
        // Sequential navigation for card view
        let targetIndex = actualIndex;
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
            targetIndex = actualIndex + 1;
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
            targetIndex = actualIndex - 1;
        }
        if (targetIndex >= 0 && targetIndex < cards.length) {
            targetCard = cards[targetIndex];
        }
    }

    if (targetCard) {
        const targetIndex = cards.indexOf(targetCard);
        if (onFocusChange) {
            onFocusChange(targetIndex);
        }
        targetCard.focus();
        targetCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

