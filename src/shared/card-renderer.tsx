/**
 * Shared card renderer - Pure rendering component
 * Works with both Bases and Datacore by accepting normalized card data
 */

import type { App } from 'obsidian';
import type { Settings } from '../types';
import type { RefObject } from '../types/datacore';
import { getTagStyle, showTimestampIcon } from '../utils/style-settings';

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
    displayTimestamp?: number;  // Resolved timestamp after custom property extraction (milliseconds)
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
 * Helper function to render metadata content based on display type
 */
function renderMetadataContent(
    displayType: 'none' | 'timestamp' | 'tags' | 'path',
    card: CardData,
    date: string | null,
    timeIcon: 'calendar' | 'clock',
    settings: Settings,
    app: App
): unknown {
    if (displayType === 'none') return null;

    if (displayType === 'timestamp' && date) {
        return (
            <>
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
                <span>{date}</span>
            </>
        );
    } else if (displayType === 'tags' && card.tags.length > 0) {
        const tagStyle = getTagStyle();
        const showHashPrefix = tagStyle === 'minimal';

        return (
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
                        {showHashPrefix ? tag : tag.replace(/^#/, '')}
                    </a>
                ))}
            </div>
        );
    } else if (displayType === 'path' && card.folderPath.length > 0) {
        return (
            <div className="path-wrapper">
                {card.folderPath.split('/').filter(f => f).map((folder, idx, array): JSX.Element => {
                    const allParts = card.folderPath.split('/').filter(f => f);
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
        );
    }

    return null;
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
    // Use displayTimestamp if available (already resolved with custom properties), otherwise fall back to ctime/mtime
    const timestamp = card.displayTimestamp !== undefined ? card.displayTimestamp : (useCreatedTime ? card.ctime : card.mtime);

    // Format timestamp
    const now = Date.now();
    const isRecent = now - timestamp < 86400000;
    const date = timestamp ? (isRecent ? formatDate(timestamp, "yyyy-MM-dd HH:mm") : formatDate(timestamp, "yyyy-MM-dd")) : "";
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
            key={card.path}
            className="writing-card"
            data-path={card.path}
            tabIndex={index === focusableCardIndex ? 0 : -1}
            onClick={(e: MouseEvent) => {
                if (settings.openFileAction === 'card' && (e.target as HTMLElement).tagName !== 'A' && !(e.target as HTMLElement).closest('a') && (e.target as HTMLElement).tagName !== 'IMG') {
                    const newLeaf = e.metaKey || e.ctrlKey;
                    if (onCardClick) {
                        onCardClick(card.path, newLeaf);
                    } else {
                        void app.workspace.openLinkText(card.path, "", newLeaf);
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
            <div className="writing-title">
                <a
                    href={card.path}
                    className="internal-link card-title-link"
                    data-href={card.path}
                >
                    <span className="title-text">{card.title}</span>
                </a>
            </div>

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
                                <img
                                    src={imageArray[0] || ''}
                                    alt=""
                                    onLoad={() => {
                                        if (updateLayoutRef.current) {
                                            updateLayoutRef.current();
                                        }
                                    }}
                                />
                            </div>
                        ) : card.hasImageAvailable ? (
                            <div className="card-thumbnail-placeholder"></div>
                        ) : null
                    )}
                </div>
            )}

            {/* Metadata */}
            {(() => {
                // Left always wins: if both match and are non-none, suppress right
                const effectiveLeft = settings.metadataDisplayLeft;
                const effectiveRight = settings.metadataDisplayLeft !== 'none' &&
                    settings.metadataDisplayRight !== 'none' &&
                    settings.metadataDisplayLeft === settings.metadataDisplayRight
                        ? 'none'
                        : settings.metadataDisplayRight;

                // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- JSX.Element resolves to any due to Datacore's JSX runtime
                return (effectiveLeft !== 'none' || effectiveRight !== 'none') && (
                    <div className={`writing-meta${
                        effectiveLeft === 'none' && effectiveRight !== 'none' ? ' meta-right-only' :
                        effectiveLeft !== 'none' && effectiveRight === 'none' ? ' meta-left-only' : ''
                    }`}>
                        <div className="meta-left">
                            {renderMetadataContent(effectiveLeft, card, date, timeIcon, settings, app)}
                        </div>
                        <div className="meta-right">
                            {renderMetadataContent(effectiveRight, card, date, timeIcon, settings, app)}
                        </div>
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

// Simple date formatter
function formatDate(timestamp: number, format: string): string {
    const date = new Date(timestamp);
    const yyyy = date.getFullYear();
    const MM = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const HH = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');

    if (format === "yyyy-MM-dd HH:mm") {
        return `${yyyy}-${MM}-${dd} ${HH}:${mm}`;
    } else {
        return `${yyyy}-${MM}-${dd}`;
    }
}
