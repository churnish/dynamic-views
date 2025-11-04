import type { Settings } from '../types';

interface CardViewProps {
    results: any[];
    displayedCount: number;
    settings: Settings;
    viewMode: 'card' | 'masonry';
    sortMethod: string;
    isShuffled: boolean;
    snippets: Record<string, string>;
    images: Record<string, string | string[]>;
    hasImageAvailable: Record<string, boolean>;
    focusableCardIndex: number;
    containerRef: any;
    updateLayoutRef: any;
    app: any;
    dc: any;
    onCardClick?: (path: string, newLeaf: boolean) => void;
    onFocusChange?: (index: number) => void;
}

export function CardView({
    results,
    displayedCount,
    settings,
    viewMode,
    sortMethod,
    isShuffled,
    snippets,
    images,
    hasImageAvailable,
    focusableCardIndex,
    containerRef,
    updateLayoutRef,
    app,
    dc,
    onCardClick,
    onFocusChange
}: CardViewProps) {
    return (
        <div
            ref={containerRef}
            className={viewMode === "masonry" ? "cards-masonry" : "cards-feed"}
            style={settings.queryHeight > 0 ? { maxHeight: `${settings.queryHeight}px`, overflowY: 'auto' } : {}}
        >
            {results.slice(0, displayedCount).filter(p => p.$path).map((p, index) => {
                // Get title from property or fallback to filename - coerce to string to handle Literal objects
                let rawTitle = p.value(settings.titleProperty);
                if (Array.isArray(rawTitle)) rawTitle = rawTitle[0];
                const titleValue = dc.coerce.string(rawTitle || p.$name);

                // Determine which timestamp to show: ctime for Created sort, mtime for others (including shuffle)
                const useCreatedTime = sortMethod.startsWith('ctime') && !isShuffled;
                const customProperty = useCreatedTime ? settings.createdProperty : settings.modifiedProperty;

                let timestamp;
                let timestampMillis;
                let date = "";
                let isInvalid = false;

                if (customProperty) {
                    const propValue = p.value(customProperty);

                    // Check if property exists on note
                    // For Datacore: null/undefined means doesn't exist
                    // DateTime objects have toMillis() method
                    const propertyExists = propValue !== null && propValue !== undefined;

                    if (!propertyExists) {
                        // Property not set on this note - fall back to file metadata
                        timestamp = useCreatedTime ? p.$ctime : p.$mtime;
                        timestampMillis = timestamp?.toMillis() || 0;
                        const now = Date.now();
                        const isRecent = now - timestampMillis < 86400000;
                        date = timestamp ? (isRecent ? timestamp.toFormat("yyyy-MM-dd HH:mm") : timestamp.toFormat("yyyy-MM-dd")) : "";
                    } else if (propValue && typeof propValue === 'object' && 'toMillis' in propValue) {
                        // Property exists and is valid date/datetime (Datacore DateTime object)
                        timestamp = propValue;
                        timestampMillis = propValue.toMillis();
                        const now = Date.now();
                        const isRecent = now - timestampMillis < 86400000;
                        date = isRecent ? propValue.toFormat("yyyy-MM-dd HH:mm") : propValue.toFormat("yyyy-MM-dd");
                    } else {
                        // Property exists but is wrong type
                        isInvalid = true;
                        date = "Invalid";
                    }
                } else {
                    // No custom property configured - use file metadata
                    timestamp = useCreatedTime ? p.$ctime : p.$mtime;
                    timestampMillis = timestamp?.toMillis() || 0;
                    const now = Date.now();
                    const isRecent = now - timestampMillis < 86400000;
                    date = timestamp ? (isRecent ? timestamp.toFormat("yyyy-MM-dd HH:mm") : timestamp.toFormat("yyyy-MM-dd")) : "";
                }

                const timeIcon = useCreatedTime ? "calendar" : "clock";

                const snippet = p.$path in snippets ? snippets[p.$path] : "Loading...";
                const tags = p.$tags || [];
                const imageSrc = images[p.$path];

                // Get parent folder path (without filename)
                const folderPath = (p.$path || '').split('/').slice(0, -1).join('/');

                // Handle both single images and arrays
                const isArray = Array.isArray(imageSrc);
                const imageArray = isArray ? imageSrc : (imageSrc ? [imageSrc] : []);

                // State for tracking hovered image in multi-image mode
                const [hoveredImageIndex, setHoveredImageIndex] = dc.useState(0);

                return (
                    <div
                        key={p.$path}
                        className="writing-card"
                        data-path={p.$path}
                        tabIndex={index === focusableCardIndex ? 0 : -1}
                        onClick={(e: MouseEvent) => {
                            // Only open if clicking on the card itself, not on interactive elements or images
                            if (settings.openFileAction === 'card' && (e.target as HTMLElement).tagName !== 'A' && !(e.target as HTMLElement).closest('a') && (e.target as HTMLElement).tagName !== 'IMG' && p.$path) {
                                const newLeaf = e.metaKey || e.ctrlKey;
                                if (onCardClick) {
                                    onCardClick(p.$path, newLeaf);
                                } else {
                                    app.workspace.openLinkText(p.$path, "", newLeaf);
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
                                if (settings.openFileAction === 'card' && p.$path) {
                                    const newLeaf = e.metaKey || e.ctrlKey;
                                    if (onCardClick) {
                                        onCardClick(p.$path, newLeaf);
                                    } else {
                                        app.workspace.openLinkText(p.$path, "", newLeaf);
                                    }
                                }
                            } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                                e.preventDefault();
                                const cards = Array.from(containerRef.current?.querySelectorAll('.writing-card') || []) as HTMLElement[];
                                const currentIndex = cards.indexOf(e.currentTarget as HTMLElement);

                                if (currentIndex === -1) return;

                                const currentRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                const currentX = currentRect.left + currentRect.width / 2;
                                const currentY = currentRect.top + currentRect.height / 2;

                                let targetCard: HTMLElement | null = null;
                                let minDistance = Infinity;

                                if (viewMode === 'masonry') {
                                    // 2D navigation based on actual positions
                                    cards.forEach((card, idx) => {
                                        if (idx === currentIndex) return;

                                        const rect = card.getBoundingClientRect();
                                        const cardX = rect.left + rect.width / 2;
                                        const cardY = rect.top + rect.height / 2;

                                        let isValid = false;
                                        let distance = 0;

                                        if (e.key === 'ArrowDown' && cardY > currentY) {
                                            // Find closest card below - stay in same column
                                            if (rect.left !== currentRect.left) return;
                                            const verticalDist = cardY - currentY;
                                            const horizontalDist = Math.abs(cardX - currentX);
                                            distance = verticalDist + horizontalDist * 0.5; // Favor vertical proximity
                                            isValid = true;
                                        } else if (e.key === 'ArrowUp' && cardY < currentY) {
                                            // Find closest card above - stay in same column
                                            if (rect.left !== currentRect.left) return;
                                            const verticalDist = currentY - cardY;
                                            const horizontalDist = Math.abs(cardX - currentX);
                                            distance = verticalDist + horizontalDist * 0.5;
                                            isValid = true;
                                        } else if (e.key === 'ArrowRight' && cardX > currentX) {
                                            // Find closest card to the right
                                            const horizontalDist = cardX - currentX;
                                            const verticalDist = Math.abs(cardY - currentY);
                                            distance = horizontalDist + verticalDist * 0.5; // Favor horizontal proximity
                                            isValid = true;
                                        } else if (e.key === 'ArrowLeft' && cardX < currentX) {
                                            // Find closest card to the left
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
                                    // For card view (single column), sequential navigation
                                    let targetIndex = currentIndex;
                                    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                                        targetIndex = currentIndex + 1;
                                    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                                        targetIndex = currentIndex - 1;
                                    }
                                    if (targetIndex >= 0 && targetIndex < cards.length) {
                                        targetCard = cards[targetIndex];
                                    }
                                }

                                // Focus the target card if found
                                if (targetCard) {
                                    const targetIndex = cards.indexOf(targetCard);
                                    if (onFocusChange) {
                                        onFocusChange(targetIndex);
                                    }
                                    (targetCard as HTMLElement).focus();
                                    targetCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                                }
                            } else if (e.key === 'Tab') {
                                e.preventDefault(); // Prevent Tab navigation within grid - use arrows only
                            }
                        }}
                        onMouseEnter={(e: MouseEvent) => {
                            // Trigger Obsidian's hover preview
                            if (p.$path) {
                                app.workspace.trigger('hover-link', {
                                    event: e,
                                    source: 'dynamic-views',
                                    hoverParent: e.currentTarget,
                                    targetEl: e.currentTarget,
                                    linktext: p.$path,
                                    sourcePath: p.$path
                                });
                            }

                            // Reset to first image
                            setHoveredImageIndex(0);
                        }}
                        style={{ cursor: 'pointer' }}
                    >
                        <div className="writing-title">
                            <a
                                href={p.$path}
                                className="internal-link card-title-link"
                                data-href={p.$path}
                            >
                                <span className="title-text">{titleValue}</span>
                            </a>
                        </div>
                        {((settings.showTextPreview && snippet) || (settings.showThumbnails && (imageArray.length > 0 || hasImageAvailable[p.$path]))) && (
                            <div className="snippet-container">
                                {settings.showTextPreview && snippet && <div className="writing-snippet">{snippet}</div>}
                                {settings.showThumbnails && (
                                    imageArray.length > 0 ? (
                                        <div
                                            className={`card-thumbnail ${isArray && imageArray.length > 1 ? 'multi-image' : ''}`}
                                            onMouseMove={!app.isMobile && isArray && imageArray.length > 1 ? ((e: MouseEvent) => {
                                                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                                const x = e.clientX - rect.left;
                                                const section = Math.floor((x / rect.width) * imageArray.length);
                                                const newIndex = Math.min(section, imageArray.length - 1);
                                                if (newIndex !== hoveredImageIndex) {
                                                    setHoveredImageIndex(newIndex);
                                                }
                                            }) : undefined}
                                            onMouseLeave={!app.isMobile ? (() => setHoveredImageIndex(0)) : undefined}
                                        >
                                            <img
                                                src={imageArray[hoveredImageIndex] || imageArray[0] || ''}
                                                alt=""
                                                onLoad={() => {
                                                    // Trigger layout recalculation when image loads
                                                    if (updateLayoutRef.current) {
                                                        updateLayoutRef.current();
                                                    }
                                                }}
                                            />
                                        </div>
                                    ) : hasImageAvailable[p.$path] ? (
                                        <div className={`card-thumbnail-placeholder ${isArray && imageArray.length > 1 ? 'multi-image' : ''}`}></div>
                                    ) : null
                                )}
                            </div>
                        )}
                        {/* Metadata */}
                        {(() => {
                            // Apply winner logic: if both match and there's a winner, treat loser as 'none'
                            const effectiveLeft = settings.metadataDisplayWinner === 'right' &&
                                settings.metadataDisplayLeft !== 'none' &&
                                settings.metadataDisplayLeft === settings.metadataDisplayRight
                                    ? 'none'
                                    : settings.metadataDisplayLeft;

                            const effectiveRight = settings.metadataDisplayWinner === 'left' &&
                                settings.metadataDisplayRight !== 'none' &&
                                settings.metadataDisplayLeft === settings.metadataDisplayRight
                                    ? 'none'
                                    : settings.metadataDisplayRight;

                            return (effectiveLeft !== 'none' || effectiveRight !== 'none') && (
                                <div className={`writing-meta${
                                    effectiveLeft === 'none' && effectiveRight !== 'none' ? ' meta-right-only' :
                                    effectiveLeft !== 'none' && effectiveRight === 'none' ? ' meta-left-only' : ''
                                }`}>
                                    <div className="meta-left">
                                        {effectiveLeft === 'timestamp' && date ? (
                                        <>
                                            {settings.showTimestampIcon && (
                                                <svg className="timestamp-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                                            {date}
                                        </>
                                    ) : effectiveLeft === 'tags' && tags.length > 0 ? (
                                        <div className="tags-wrapper">
                                            {tags.map(tag => (
                                                <a
                                                    key={tag}
                                                    href="#"
                                                    className="tag"
                                                    onClick={(e: MouseEvent) => {
                                                        e.preventDefault();
                                                        const searchPlugin = app.internalPlugins.plugins["global-search"];
                                                        if (searchPlugin && searchPlugin.instance) {
                                                            searchPlugin.instance.openGlobalSearch("tag:" + tag);
                                                        }
                                                    }}
                                                >
                                                    {tag.replace(/^#/, '')}
                                                </a>
                                            ))}
                                        </div>
                                    ) : effectiveLeft === 'path' && folderPath.length > 0 ? (
                                        <div className="path-wrapper">
                                            {folderPath.split('/').filter(f => f).map((folder, index, array) => {
                                                const allParts = folderPath.split('/').filter(f => f);
                                                const cumulativePath = allParts.slice(0, index + 1).join('/');
                                                return (
                                                    <span key={index} style={{ display: 'inline-flex', alignItems: 'center' }}>
                                                        <span
                                                            className="path-segment file-path-segment"
                                                            onClick={(e: MouseEvent) => {
                                                                e.stopPropagation();
                                                                const fileExplorer = app.internalPlugins?.plugins?.["file-explorer"];
                                                                if (fileExplorer && fileExplorer.instance) {
                                                                    const folder = app.vault.getAbstractFileByPath(cumulativePath);
                                                                    if (folder) {
                                                                        fileExplorer.instance.revealInFolder(folder);
                                                                    }
                                                                }
                                                            }}
                                                        >
                                                            {folder}
                                                        </span>
                                                        {index < array.length - 1 && <span className="path-separator">/</span>}
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    ) : null}
                                </div>
                                <div className="meta-right">
                                    {effectiveRight === 'timestamp' && date ? (
                                        <>
                                            {settings.showTimestampIcon && (
                                                <svg className="timestamp-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                                            {date}
                                        </>
                                    ) : effectiveRight === 'tags' && tags.length > 0 ? (
                                        <div className="tags-wrapper">
                                            {tags.map(tag => (
                                                <a
                                                    key={tag}
                                                    href="#"
                                                    className="tag"
                                                    onClick={(e: MouseEvent) => {
                                                        e.preventDefault();
                                                        const searchPlugin = app.internalPlugins.plugins["global-search"];
                                                        if (searchPlugin && searchPlugin.instance) {
                                                            searchPlugin.instance.openGlobalSearch("tag:" + tag);
                                                        }
                                                    }}
                                                >
                                                    {tag.replace(/^#/, '')}
                                                </a>
                                            ))}
                                        </div>
                                    ) : effectiveRight === 'path' && folderPath.length > 0 ? (
                                        <div className="path-wrapper">
                                            {folderPath.split('/').filter(f => f).map((folder, index, array) => {
                                                const allParts = folderPath.split('/').filter(f => f);
                                                const cumulativePath = allParts.slice(0, index + 1).join('/');
                                                return (
                                                    <span key={index} style={{ display: 'inline-flex', alignItems: 'center' }}>
                                                        <span
                                                            className="path-segment file-path-segment"
                                                            onClick={(e: MouseEvent) => {
                                                                e.stopPropagation();
                                                                const fileExplorer = app.internalPlugins?.plugins?.["file-explorer"];
                                                                if (fileExplorer && fileExplorer.instance) {
                                                                    const folder = app.vault.getAbstractFileByPath(cumulativePath);
                                                                    if (folder) {
                                                                        fileExplorer.instance.revealInFolder(folder);
                                                                    }
                                                                }
                                                            }}
                                                        >
                                                            {folder}
                                                        </span>
                                                        {index < array.length - 1 && <span className="path-separator">/</span>}
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                            );
                        })()}
                    </div>
                );
            })}
        </div>
    );
}
