import { App, TFile, Plugin, Keymap } from 'obsidian';
import { Settings, UIState, ViewMode, WidthMode } from '../types';
import { DEFAULT_SETTINGS } from '../constants';
import { PersistenceManager } from '../persistence';
import { CardView } from './card-view';
import { MasonryView } from './masonry-view';
import { ListView } from './list-view';
import { Toolbar } from './toolbar';
import { getCurrentFile, getFileCtime } from '../utils/file';
import { ensurePageSelector, updateQueryInBlock, findQueryInBlock } from '../utils/query-sync';

interface ViewProps {
    plugin: Plugin;
    app: App;
    dc: any;
    USER_QUERY?: string;
    USER_SETTINGS?: Partial<Settings>;
}

export function View({ plugin, app, dc, USER_QUERY = '', USER_SETTINGS = {} }: ViewProps) {
    // Get file containing this query (memoized to prevent re-fetching on every render)
    // This is used to exclude the query note itself from results
    const currentFile = dc.useMemo(() => {
        const file = getCurrentFile(app);
        return file;
    }, [app]);

    const currentFilePath = currentFile?.path;
    const ctime = getFileCtime(currentFile);

    // Access PersistenceManager from plugin
    const persistenceManager = (plugin as any).persistenceManager as PersistenceManager;

    // Markdown stripping patterns - compiled once for performance
    const markdownPatterns = dc.useMemo(() => [
        /```[\s\S]*?```/g,                           // Code blocks
        /%%[\s\S]*?%%/g,                             // Obsidian comments
        /`[^`]+`/g,                                  // Inline code
        /!\[.*?\]\([^)]+\)/g,                        // Images
        /!\[\[.*?\]\]/g,                             // Wiki embeds
        /#[\w\-/]+(?=\s|$)/g,                        // Tags
        /\*\*\*((?:(?!\*\*\*).)+)\*\*\*/g,           // Bold italic
        /\*\*((?:(?!\*\*).)+)\*\*/g,                 // Bold
        /\*((?:(?!\*).)+)\*/g,                       // Italic
        /__((?:(?!__).)+)__/g,                       // Bold underscores
        /_((?:(?!_).)+)_/g,                          // Italic underscores
        /~~((?:(?!~~).)+)~~/g,                       // Strikethrough
        /==((?:(?!==).)+)==/g,                       // Highlight
        /\[([^\]]+)\]\([^)]+\)/g,                    // Links
        /\[\[[^\]|]+\|([^\]]+)\]\]/g,                // Wiki links with display
        /\[\[([^\]]+)\]\]/g,                         // Wiki links
        /^[-*+]\s+/gm,                               // Bullet list markers
        /^#{1,6}\s+.+$/gm,                           // Heading lines (full removal)
        /^\s*(?:[-_*])\s*(?:[-_*])\s*(?:[-_*])[\s\-_*]*$/gm, // Horizontal rules
        /^\s*\|.*\|.*$/gm,                           // Tables
        /\^\[[^\]]*?]/g,                             // Inline footnotes
        /\[\^[^\]]+]/g,                              // Footnote references
        /^\s*\[\^[^\]]+]:.*$/gm,                     // Footnote definitions
        /<([a-z][a-z0-9]*)\b[^>]*>(.*?)<\/\1>/gi,    // HTML tag pairs
        /<[^>]+>/g                                   // Remaining HTML tags
    ], []);

    // Valid image extensions for thumbnail extraction
    const validImageExtensions = ['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp'];

    const stripMarkdownSyntax = dc.useCallback((text: string) => {
        if (!text || text.trim().length === 0) return '';

        // First pass: remove callout title lines only
        text = text.replace(/^>\s*\[![\w-]+\][+-]?.*$/gm, '');
        // Second pass: strip > prefix from remaining blockquote lines
        text = text.replace(/^>\s?/gm, '');

        let result = text;

        // Apply each pattern
        markdownPatterns.forEach((pattern) => {
            result = result.replace(pattern, (match, ...groups) => {
                // Special handling for HTML tag pairs - return content (group 2)
                if (match.match(/<[a-z][a-z0-9]*\b[^>]*>.*?<\//i)) {
                    return groups[1] || '';
                }

                // For patterns with capture groups, return the captured content
                if (groups.length > 0 && groups[0] !== undefined) {
                    for (let i = 0; i < groups.length - 2; i++) {
                        if (groups[i] !== undefined) {
                            return groups[i];
                        }
                    }
                }
                return '';
            });
        });

        return result;
    }, [markdownPatterns]);

    // Helper: get persisted settings
    const getPersistedSettings = dc.useCallback((): Settings => {
        if (!ctime || !persistenceManager) return { ...DEFAULT_SETTINGS, ...USER_SETTINGS };

        const uiState = persistenceManager.getUIState(ctime);
        const globalSettings = persistenceManager.getGlobalSettings();

        // Check if settings should be localized
        // Note: localizeSettings is stored in the UI state, not settings
        // For now, we'll use global settings merged with USER_SETTINGS
        return { ...globalSettings, ...USER_SETTINGS };
    }, [ctime, persistenceManager, USER_SETTINGS]);

    // Helper: get persisted UI state value
    const getFilePersistedValue = dc.useCallback(<K extends keyof UIState>(
        key: K,
        defaultValue: UIState[K]
    ): UIState[K] => {
        if (!ctime || !persistenceManager) return defaultValue;
        const state = persistenceManager.getUIState(ctime);
        return state[key] ?? defaultValue;
    }, [ctime, persistenceManager]);

    // Initialize state
    const [sortMethod, setSortMethod] = dc.useState(
        getFilePersistedValue('sortMethod', 'mtime-desc')
    );
    const [searchQuery, setSearchQuery] = dc.useState(
        getFilePersistedValue('searchQuery', '')
    );
    const [viewMode, setViewMode] = dc.useState(
        getFilePersistedValue('viewMode', 'card') as ViewMode
    );
    const [widthMode, setWidthMode] = dc.useState(
        getFilePersistedValue('widthMode', 'normal') as WidthMode
    );
    const [resultLimit, setResultLimit] = dc.useState(
        getFilePersistedValue('resultLimit', '')
    );

    // Query state - extract query from between DQL markers if present
    const cleanQuery = (USER_QUERY || '')
        .split('\n')
        .filter(line => !line.includes('QUERY START') && !line.includes('QUERY END'))
        .join('\n')
        .trim();

    const [query, setQuery] = dc.useState(cleanQuery);
    const [draftQuery, setDraftQuery] = dc.useState(cleanQuery);
    const [appliedQuery, setAppliedQuery] = dc.useState(cleanQuery);
    const [isShuffled, setIsShuffled] = dc.useState(false);
    const [shuffledOrder, setShuffledOrder] = dc.useState([]);
    const [showQueryEditor, setShowQueryEditor] = dc.useState(false);
    const [showLimitDropdown, setShowLimitDropdown] = dc.useState(false);
    const [showSettings, setShowSettings] = dc.useState(false);
    const [showSortDropdown, setShowSortDropdown] = dc.useState(false);
    const [showViewDropdown, setShowViewDropdown] = dc.useState(false);
    const [isPinned, setIsPinned] = dc.useState(false);
    const [queryError, setQueryError] = dc.useState(null);
    const [displayedCount, setDisplayedCount] = dc.useState((app as any).isMobile ? 25 : 50);
    const [focusableCardIndex, setFocusableCardIndex] = dc.useState(0);
    const [isResultsScrolled, setIsResultsScrolled] = dc.useState(false);
    const [isScrolledToBottom, setIsScrolledToBottom] = dc.useState(true);
    const [localizeSettings, setLocalizeSettings] = dc.useState(false);

    // Settings state
    const [settings, setSettings] = dc.useState(getPersistedSettings());

    // Refs
    const explorerRef = dc.useRef(null);
    const toolbarRef = dc.useRef(null);
    const containerRef = dc.useRef(null);
    const updateLayoutRef = dc.useRef(null);
    const loadMoreRef = dc.useRef(null);
    const isLoadingRef = dc.useRef(false);
    const loadAttemptsRef = dc.useRef(0);
    const settingsTimeoutRef = dc.useRef(null);
    const initialToolbarOffset = dc.useRef(0);
    const isSyncing = dc.useRef(false);

    const [stickyTop, setStickyTop] = dc.useState(0);
    const [toolbarDimensions, setToolbarDimensions] = dc.useState({ width: 0, height: 0, left: 0 });

    // Persist UI state changes
    dc.useEffect(() => {
        if (ctime && persistenceManager) {
            persistenceManager.setUIState(ctime, { sortMethod });
        }
    }, [sortMethod, ctime, persistenceManager]);

    dc.useEffect(() => {
        if (ctime && persistenceManager) {
            persistenceManager.setUIState(ctime, { viewMode });
        }
    }, [viewMode, ctime, persistenceManager]);

    dc.useEffect(() => {
        if (ctime && persistenceManager) {
            persistenceManager.setUIState(ctime, { widthMode });
        }
    }, [widthMode, ctime, persistenceManager]);

    dc.useEffect(() => {
        if (ctime && persistenceManager) {
            persistenceManager.setUIState(ctime, { searchQuery });
        }
    }, [searchQuery, ctime, persistenceManager]);

    dc.useEffect(() => {
        if (ctime && persistenceManager) {
            persistenceManager.setUIState(ctime, { resultLimit });
        }
    }, [resultLimit, ctime, persistenceManager]);

    // Persist settings changes
    dc.useEffect(() => {
        if (localizeSettings) {
            // TODO: Write settings to USER_SETTINGS in file (requires file modification)
            // For now, just save to global settings
            if (settingsTimeoutRef.current) {
                clearTimeout(settingsTimeoutRef.current);
            }
            settingsTimeoutRef.current = setTimeout(() => {
                if (persistenceManager) {
                    persistenceManager.setGlobalSettings(settings);
                }
            }, 300);
        } else {
            // Save to global settings immediately
            if (persistenceManager) {
                persistenceManager.setGlobalSettings(settings);
            }
        }
    }, [settings, localizeSettings, persistenceManager]);

    // Calculate sticky toolbar positioning
    dc.useEffect(() => {
        if (isPinned && toolbarRef.current) {
            const scrollContainer = toolbarRef.current.closest('.markdown-preview-view, .markdown-reading-view, .markdown-source-view');

            if (!scrollContainer) {
                setStickyTop(0);
                return;
            }

            const updateStickyTop = () => {
                const containerRect = scrollContainer.getBoundingClientRect();
                const headerHeight = containerRect.top;
                setStickyTop(Math.max(0, headerHeight));

                if (toolbarRef.current && explorerRef.current) {
                    const explorerRect = explorerRef.current.getBoundingClientRect();
                    setToolbarDimensions({
                        width: explorerRect.width,
                        height: toolbarRef.current.offsetHeight,
                        left: explorerRect.left
                    });
                }
            };

            updateStickyTop();
            window.addEventListener('resize', updateStickyTop);
            scrollContainer.addEventListener('scroll', updateStickyTop);

            return () => {
                window.removeEventListener('resize', updateStickyTop);
                scrollContainer.removeEventListener('scroll', updateStickyTop);
            };
        }
    }, [isPinned]);

    // Validate and fallback query
    const validatedQuery = dc.useMemo(() => {
        const q = appliedQuery.trim();
        if (!q || q.length === 0) {
            setQueryError(null);
            return '@page';  // Default: show all pages
        }
        setQueryError(null);
        return ensurePageSelector(q);
    }, [appliedQuery]);

    // Workaround: Direct Datacore event subscription (fires AFTER reindexing completes)
    const [indexRevision, setIndexRevision] = dc.useState(0);

    dc.useEffect(() => {
        // Access Datacore core directly
        const core = (window as any).datacore?.core;
        if (!core) {
            return;
        }

        // Subscribe to update event (fires AFTER index changes complete)
        const updateRef = core.on("update", (revision: number) => {
            setIndexRevision(revision);
        });

        // Set initial revision
        const initialRevision = core.revision || 0;
        setIndexRevision(initialRevision);

        return () => {
            core.offref(updateRef);
        };
    }, [app, dc]);

    // Execute query - indexRevision ensures re-execution AFTER Datacore reindexes
    let pages: any[] = [];
    try {
        pages = dc.useQuery(validatedQuery) || [];
    } catch (error: any) {
        setQueryError(error?.message || 'Query error');
        pages = [];
    }

    // Parse search terms
    const parsedSearchTerms = dc.useMemo(() => {
        if (!searchQuery?.trim()) return null;

        const terms = searchQuery.toLowerCase().trim().split(/\s+/);
        const positiveTerms = terms.filter(t => !t.startsWith("-"));
        const negativeTerms = terms.filter(t => t.startsWith("-")).map(t => t.slice(1));

        return {
            posTagTerms: positiveTerms.filter(t => t.startsWith("#")),
            posNameTerms: positiveTerms.filter(t => !t.startsWith("#")),
            negTagTerms: negativeTerms.filter(t => t.startsWith("#")),
            negNameTerms: negativeTerms.filter(t => !t.startsWith("#"))
        };
    }, [searchQuery]);

    // Apply sorting and filtering
    const { sorted, totalCount } = dc.useMemo(() => {
        const pagesArray = Array.isArray(pages) ? [...pages] : [];

        // Exclude current file
        let filtered = currentFilePath
            ? pagesArray.filter(p => p.$path !== currentFilePath)
            : pagesArray;

        // Filter by search query
        if (parsedSearchTerms) {
            const { posTagTerms, posNameTerms, negTagTerms, negNameTerms } = parsedSearchTerms;

            filtered = filtered.filter(p => {
                const fileName = (p.$name || "").toLowerCase();
                const fileTags = (p.$tags || []).map((t: string) => t.toLowerCase());

                const posNameMatch = posNameTerms.every(term => fileName.includes(term));
                const posTagMatch = posTagTerms.every(term =>
                    fileTags.some((fileTag: string) => fileTag === term)
                );

                const negNameMatch = negNameTerms.some(term => fileName.includes(term));
                const negTagMatch = negTagTerms.some(term =>
                    fileTags.some((fileTag: string) => fileTag === term)
                );

                return posNameMatch && posTagMatch && !negNameMatch && !negTagMatch;
            });
        }

        // Sort the filtered results
        let sorted: any[];
        if (isShuffled) {
            sorted = filtered.sort((a, b) => {
                const indexA = shuffledOrder.indexOf(a.$path);
                const indexB = shuffledOrder.indexOf(b.$path);
                return indexA - indexB;
            });
        } else {
            switch (sortMethod) {
                case "name-asc":
                    sorted = filtered.sort((a, b) => (a.$name || "").localeCompare(b.$name || ""));
                    break;
                case "name-desc":
                    sorted = filtered.sort((a, b) => (b.$name || "").localeCompare(a.$name || ""));
                    break;
                case "mtime-asc":
                    sorted = filtered.sort((a, b) => (a.$mtime?.toMillis() || 0) - (b.$mtime?.toMillis() || 0));
                    break;
                case "mtime-desc":
                    sorted = filtered.sort((a, b) => (b.$mtime?.toMillis() || 0) - (a.$mtime?.toMillis() || 0));
                    break;
                case "ctime-asc":
                    sorted = filtered.sort((a, b) => (a.$ctime?.toMillis() || 0) - (b.$ctime?.toMillis() || 0));
                    break;
                case "ctime-desc":
                    sorted = filtered.sort((a, b) => (b.$ctime?.toMillis() || 0) - (a.$ctime?.toMillis() || 0));
                    break;
                default:
                    sorted = filtered.sort((a, b) => (b.$mtime?.toMillis() || 0) - (a.$mtime?.toMillis() || 0));
            }
        }

        const totalCount = sorted.length;
        const limit = parseInt(resultLimit);
        if (limit > 0 && sorted.length > limit) {
            return { sorted: sorted.slice(0, limit), totalCount };
        }

        return { sorted, totalCount };
    }, [pages, sortMethod, parsedSearchTerms, isShuffled, shuffledOrder, resultLimit, currentFilePath]);

    // State to store file snippets and images
    const [snippets, setSnippets] = dc.useState({});
    const [images, setImages] = dc.useState({});
    const [hasImageAvailable, setHasImageAvailable] = dc.useState({});

    // Load file contents asynchronously (only for displayed items)
    dc.useEffect(() => {
        // Skip entirely if both previews and thumbnails are off
        if (!settings.showTextPreview && !settings.showThumbnails) {
            setSnippets({});
            setImages({});
            setHasImageAvailable({});
            return;
        }

        const loadSnippets = async () => {
            const newSnippets: Record<string, string> = {};
            const newImages: Record<string, string | string[]> = {};
            const newHasImageAvailable: Record<string, boolean> = {};

            for (const p of sorted.slice(0, displayedCount)) {
                try {
                    const file = app.vault.getAbstractFileByPath(p.$path) as any;
                    if (file) {
                        // Check if property values are actually useful (not empty/whitespace)
                        const descFromProp = p.value(settings.descriptionProperty);
                        const hasValidDesc = descFromProp && String(descFromProp).trim().length > 0;

                        // Check if image property contains valid image link(s)
                        const imgFromProp = p.value(settings.imageProperty);

                        // Extract ALL property image paths (handle arrays)
                        const propertyImagePaths: string[] = [];
                        if (imgFromProp) {
                            // Handle array values (process ALL elements)
                            const propValues = Array.isArray(imgFromProp) ? imgFromProp : [imgFromProp];

                            for (const propValue of propValues) {
                                let imgStr = '';

                                // If it's a Link object with a path property, extract the path
                                if (typeof propValue === 'object' && propValue !== null && 'path' in propValue) {
                                    imgStr = String(propValue.path).trim();
                                } else {
                                    imgStr = String(propValue).trim();
                                }

                                // Strip wikilink syntax if present: [[path]] or ![[path]] or [[path|caption]]
                                const wikilinkMatch = imgStr.match(/^!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/);
                                if (wikilinkMatch) {
                                    imgStr = wikilinkMatch[1].trim();
                                }

                                // Validate image extension
                                const imageExtensions = /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i;
                                const hasValidImg = imgStr.length > 0 && imageExtensions.test(imgStr);

                                if (hasValidImg) {
                                    propertyImagePaths.push(imgStr);
                                }
                            }
                        }

                        const hasValidImg = propertyImagePaths.length > 0;

                        // Only read file if we need snippets or images from content
                        const needsFileRead =
                            (settings.showTextPreview && !hasValidDesc) ||
                            (settings.showThumbnails && !hasValidImg);

                        const text = needsFileRead ? await app.vault.read(file) : '';

                        // Process text preview only if enabled
                        if (settings.showTextPreview) {
                            // Try to get description from property first
                            let description = hasValidDesc ? descFromProp : null;
                            if (!description && text) {
                                // Fallback: extract from file content
                                const cleaned = text.replace(/^---[\s\S]*?---/, "").trim();
                                let stripped = stripMarkdownSyntax(cleaned);

                                // Check if first line matches filename or title property
                                const firstLineEnd = stripped.indexOf('\n');
                                const firstLine = (firstLineEnd !== -1 ? stripped.substring(0, firstLineEnd) : stripped).trim();
                                const fileName = p.$name;
                                let titleValue = p.value(settings.titleProperty);
                                if (Array.isArray(titleValue)) titleValue = titleValue[0];

                                // Omit first line if it matches filename/title or if alwaysOmitFirstLine enabled
                                if (firstLine === fileName || (titleValue && firstLine === dc.coerce.string(titleValue)) || settings.alwaysOmitFirstLine) {
                                    stripped = firstLineEnd !== -1 ? stripped.substring(firstLineEnd + 1).trim() : '';
                                }

                                const normalized = stripped
                                    .replace(/\^[a-zA-Z0-9-]+/g, '') // Remove block IDs
                                    .replace(/\\/g, '') // Remove backslashes
                                    .split(/\s+/)
                                    .filter(word => word)
                                    .join(' ')
                                    .trim()
                                    .replace(/\.{2,}/g, match => match.replace(/\./g, '\u2024'));

                                const wasTruncated = normalized.length > 500;
                                description = normalized.substring(0, 500);

                                if (wasTruncated) {
                                    description += '…';
                                }
                            }
                            // Always set snippet value, even if empty (to prevent perpetual "Loading...")
                            newSnippets[p.$path] = description || '';
                        }

                        // Process thumbnails only if enabled
                        if (settings.showThumbnails) {
                            // Phase A: Convert property image paths to resource paths
                            const propertyResourcePaths: string[] = [];
                            for (const propPath of propertyImagePaths) {
                                const imageFile = app.metadataCache.getFirstLinkpathDest(propPath, p.$path);
                                if (imageFile && validImageExtensions.includes(imageFile.extension)) {
                                    const resourcePath = app.vault.getResourcePath(imageFile);
                                    propertyResourcePaths.push(resourcePath);
                                }
                            }

                            // Phase B: Extract body embed resource paths
                            const metadata = app.metadataCache.getFileCache(file);
                            if (!metadata) continue;

                            const imageEmbeds = metadata.embeds?.filter((embed: any) => {
                                const targetFile = app.metadataCache.getFirstLinkpathDest(embed.link, p.$path);
                                return targetFile && validImageExtensions.includes(targetFile.extension);
                            }) || [];

                            const bodyResourcePaths: string[] = [];
                            for (const embed of imageEmbeds) {
                                const imageFile = app.metadataCache.getFirstLinkpathDest(embed.link, p.$path);
                                if (imageFile && validImageExtensions.includes(imageFile.extension)) {
                                    const resourcePath = app.vault.getResourcePath(imageFile);
                                    bodyResourcePaths.push(resourcePath);
                                }
                            }

                            // Phase C: Merge property images first, then body embeds
                            const allResourcePaths = [...propertyResourcePaths, ...bodyResourcePaths];

                            // Phase D: Store combined result
                            if (allResourcePaths.length > 0) {
                                // Store as array if multiple, string if single
                                newImages[p.$path] = allResourcePaths.length > 1 ? allResourcePaths : allResourcePaths[0];
                                newHasImageAvailable[p.$path] = true;
                            }
                        }
                    } else {
                        if (settings.showTextPreview) {
                            newSnippets[p.$path] = "(File not found)";
                        }
                    }
                } catch (e: any) {
                    console.error("Error reading file:", p.$path, e.message || e);
                    if (settings.showTextPreview) {
                        newSnippets[p.$path] = "(Error reading file)";
                    }
                }
            }

            setSnippets(newSnippets);
            setImages(newImages);
            setHasImageAvailable(newHasImageAvailable);
        };

        loadSnippets();
    }, [sorted, displayedCount, stripMarkdownSyntax, settings.showTextPreview, settings.showThumbnails, settings, app, dc]);

    // Masonry layout
    const [columnCount, setColumnCount] = dc.useState(1);
    const [columnHeights, setColumnHeights] = dc.useState([]);
    const columnHeightsRef = dc.useRef([]);
    const lastPositionedCountRef = dc.useRef(0);
    const lastContainerWidthRef = dc.useRef(0);

    // Masonry layout effect
    dc.useEffect(() => {
        if (viewMode !== 'masonry') return;

        // Reset state
        setColumnCount(1);
        setColumnHeights([]);
        columnHeightsRef.current = [];
        lastPositionedCountRef.current = 0;
        lastContainerWidthRef.current = 0;

        const updateLayout = () => {
            const container = containerRef.current;
            if (!container) return;

            const cards = container.querySelectorAll('.writing-card');
            const containerWidth = container.clientWidth;

            // Skip if container not visible
            if (containerWidth < 100) return;

            const cardMinWidth = 320;
            const gap = 8;

            // Calculate columns
            const cols = Math.max(settings.minMasonryColumns, Math.floor((containerWidth + gap) / (cardMinWidth + gap)));
            setColumnCount(cols);

            // Calculate card width
            const totalGapWidth = (cols - 1) * gap;
            const cardWidth = (containerWidth - totalGapWidth) / cols;

            if (cards.length === 0) return;

            // Determine if incremental update possible
            const previousCount = lastPositionedCountRef.current || 0;
            const widthChanged = Math.abs(containerWidth - lastContainerWidthRef.current) > 1;
            const isIncremental = previousCount > 0 &&
                                  previousCount < cards.length &&
                                  !widthChanged &&
                                  columnHeightsRef.current.length === cols;

            // Batch DOM operations
            requestAnimationFrame(() => {
                const cardsToProcess = isIncremental ?
                    Array.from(cards).slice(previousCount) :
                    Array.from(cards);

                // Set widths
                cardsToProcess.forEach((card: any) => {
                    card.style.width = `${cardWidth}px`;
                });

                // Force reflow
                container.offsetHeight;

                // Read heights
                const cardHeights = cardsToProcess.map((card: any) => card.offsetHeight);

                // Calculate positions
                const heights = isIncremental ?
                    [...columnHeightsRef.current] :
                    new Array(cols).fill(0);
                const positions: any[] = [];

                cardHeights.forEach((cardHeight) => {
                    const shortestCol = heights.indexOf(Math.min(...heights));
                    positions.push({
                        left: shortestCol * (cardWidth + gap),
                        top: heights[shortestCol]
                    });
                    heights[shortestCol] += cardHeight + gap;
                });

                // Apply positions
                requestAnimationFrame(() => {
                    cardsToProcess.forEach((card: any, i: number) => {
                        const pos = positions[i];
                        card.style.position = 'absolute';
                        card.style.transition = 'none';
                        card.style.left = `${pos.left}px`;
                        card.style.top = `${pos.top}px`;
                    });

                    // Set container height
                    const newContainerHeight = Math.max(...heights);
                    container.style.height = `${newContainerHeight}px`;
                    setColumnHeights(heights);

                    // Store state
                    columnHeightsRef.current = heights;
                    lastPositionedCountRef.current = cards.length;
                    lastContainerWidthRef.current = containerWidth;
                });
            });
        };

        // Store update function
        updateLayoutRef.current = updateLayout;

        // Debounced layout
        let layoutTimeout: any;
        const debouncedLayout = () => {
            clearTimeout(layoutTimeout);
            layoutTimeout = setTimeout(updateLayout, 16);
        };

        debouncedLayout();

        // Observers
        const intersectionObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    debouncedLayout();
                }
            });
        });
        if (containerRef.current) {
            intersectionObserver.observe(containerRef.current);
        }

        const resizeObserver = new ResizeObserver(debouncedLayout);
        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }

        const handleResize = () => {
            setTimeout(updateLayout, 100);
        };
        window.addEventListener('resize', handleResize);

        return () => {
            intersectionObserver.disconnect();
            resizeObserver.disconnect();
            window.removeEventListener('resize', handleResize);
            clearTimeout(layoutTimeout);

            // Clean up inline styles when leaving masonry view
            const container = containerRef.current;
            if (container) {
                const cards = container.querySelectorAll('.writing-card');
                cards.forEach((card: any) => {
                    card.style.position = '';
                    card.style.left = '';
                    card.style.top = '';
                    card.style.width = '';
                    card.style.transition = '';
                });
                container.style.height = '';
            }
        };
    }, [sorted, viewMode, settings.minMasonryColumns, dc]);

    // Track scroll position for toolbar shadow and fade effect
    dc.useEffect(() => {
        const container = containerRef.current;
        if (!container || settings.queryHeight === 0) {
            setIsResultsScrolled(false);
            setIsScrolledToBottom(true);
            return;
        }

        const handleScroll = () => {
            setIsResultsScrolled(container.scrollTop > 10);
            const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 1;
            setIsScrolledToBottom(isAtBottom);
        };

        handleScroll(); // Check initial state
        container.addEventListener('scroll', handleScroll);
        return () => container.removeEventListener('scroll', handleScroll);
    }, [settings.queryHeight, displayedCount, sorted.length, viewMode]);

    // Auto-reload: Watch for USER_QUERY prop changes (Datacore re-renders on code block edits)
    dc.useEffect(() => {
        const newCleanQuery = (USER_QUERY || '')
            .split('\n')
            .filter(line => !line.includes('QUERY START') && !line.includes('QUERY END'))
            .join('\n')
            .trim();

        // Only update if query changed
        if (newCleanQuery !== appliedQuery) {
            setQuery(newCleanQuery);
            setDraftQuery(newCleanQuery);
            setAppliedQuery(newCleanQuery);
        }
    }, [USER_QUERY]);

    // Handlers
    const handleTogglePin = dc.useCallback(() => {
        setIsPinned(!isPinned);
    }, [isPinned]);

    const handleToggleWidth = dc.useCallback(() => {
        const modes: WidthMode[] = ['normal', 'wide', 'max'];
        const currentIndex = modes.indexOf(widthMode);
        const nextMode = modes[(currentIndex + 1) % modes.length];
        setWidthMode(nextMode);

        // Find all sections containing dynamic views (handles multiple views/splits)
        const sections = document.querySelectorAll('.markdown-source-view, .markdown-preview-view, .markdown-reading-view');
        sections.forEach(section => {
            // Only apply to sections that contain a dynamic view
            if (section.querySelector('.dynamic-views')) {
                // Remove all width helper classes
                section.classList.remove('dc-wide', 'dc-max');

                // Apply new helper class (Minimal pattern)
                if (nextMode === 'wide') {
                    section.classList.add('dc-wide');
                } else if (nextMode === 'max') {
                    section.classList.add('dc-max');
                }
            }
        });
    }, [widthMode]);

    const handleToggleSettings = dc.useCallback(() => {
        setShowSettings(prev => !prev);
    }, []);

    const handleToggleViewDropdown = dc.useCallback(() => {
        setShowViewDropdown(!showViewDropdown);
        if (!showViewDropdown) {
            setShowSortDropdown(false);
            setShowLimitDropdown(false);
        }
    }, [showViewDropdown]);

    const handleToggleSortDropdown = dc.useCallback(() => {
        setShowSortDropdown(!showSortDropdown);
        if (!showSortDropdown) {
            setShowViewDropdown(false);
            setShowLimitDropdown(false);
        }
    }, [showSortDropdown]);

    const handleToggleLimitDropdown = dc.useCallback(() => {
        setShowLimitDropdown(!showLimitDropdown);
        if (!showLimitDropdown) {
            setShowViewDropdown(false);
            setShowSortDropdown(false);
        }
    }, [showLimitDropdown]);

    const handleSetViewMode = dc.useCallback((mode: ViewMode) => {
        setViewMode(mode);
        setShowViewDropdown(false);
        setIsShuffled(false);
    }, []);

    const handleSetSortMethod = dc.useCallback((method: string) => {
        setSortMethod(method);
        setShowSortDropdown(false);
        setIsShuffled(false);
    }, []);

    const handleSearchChange = dc.useCallback((query: string) => {
        setSearchQuery(query);
        setDisplayedCount((app as any).isMobile ? 25 : 50);
    }, [(app as any).isMobile]);

    const handleSearchFocus = dc.useCallback(() => {
        setShowViewDropdown(false);
        setShowSortDropdown(false);
        setShowLimitDropdown(false);
    }, []);

    const handleClearSearch = dc.useCallback(() => {
        setSearchQuery('');
    }, []);

    const handleShuffle = dc.useCallback(() => {
        // Shuffle the results
        const paths = sorted.map(p => p.$path);
        const shuffled = [...paths];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        setShuffledOrder(shuffled);
        setIsShuffled(true);
        setShowSortDropdown(false);
    }, [sorted]);

    const handleOpenRandom = dc.useCallback((event: MouseEvent) => {
        if (sorted.length === 0) return;
        const randomIndex = Math.floor(Math.random() * sorted.length);
        const randomPath = sorted[randomIndex].$path;
        const file = app.vault.getAbstractFileByPath(randomPath);
        if (file) {
            const newLeaf = Keymap.isModEvent(event);
            app.workspace.getLeaf(newLeaf).openFile(file as TFile);
        }
    }, [sorted, app]);

    const handleToggleCode = dc.useCallback(() => {
        setShowQueryEditor(!showQueryEditor);
    }, [showQueryEditor]);

    const handleDraftQueryChange = dc.useCallback((query: string) => {
        setDraftQuery(query);
    }, []);

    const syncQueryToCodeBlock = dc.useCallback(async (queryToSave: string) => {
        if (isSyncing.current || !currentFile) return;
        isSyncing.current = true;

        try {
            // Read current content to check if query changed
            const currentContent = await app.vault.read(currentFile);
            const currentQueryMatch = findQueryInBlock(currentContent);
            const currentQuery = currentQueryMatch?.query || '';

            // Only update if query actually changed
            if (currentQuery !== queryToSave) {
                await app.vault.process(currentFile, (content) => {
                    return updateQueryInBlock(content, queryToSave);
                });
            }
        } catch (error) {
            console.error('Failed to sync query to code block:', error);
        } finally {
            isSyncing.current = false;
        }
    }, [currentFile, app]);

    const handleApplyQuery = dc.useCallback(async () => {
        const processedQuery = ensurePageSelector(draftQuery.trim());
        setDraftQuery(processedQuery);  // Update editor to show processed query
        setAppliedQuery(processedQuery);
        setQuery(processedQuery);
        setShowQueryEditor(false);

        if (currentFile) {
            try {
                await syncQueryToCodeBlock(processedQuery);
            } catch (error) {
                console.error('Failed to sync query to code block:', error);
            }
        }
    }, [draftQuery, currentFile, syncQueryToCodeBlock]);

    const handleClearQuery = dc.useCallback(async () => {
        setDraftQuery('');
        setAppliedQuery('');
        setQuery('');

        // Save empty query to code block
        if (currentFile) {
            try {
                await syncQueryToCodeBlock('');
            } catch (error) {
                console.error('Failed to sync cleared query to code block:', error);
            }
        }
    }, [currentFile, syncQueryToCodeBlock]);

    const handleResultLimitChange = dc.useCallback((limit: string) => {
        setResultLimit(limit);
    }, []);

    const handleResetLimit = dc.useCallback(() => {
        setResultLimit('');
        setShowLimitDropdown(false);
    }, []);

    const handleCreateNote = dc.useCallback(async (event: MouseEvent) => {
        // TODO: Implement note creation
        const fileName = `Untitled ${Date.now()}.md`;
        const file = await app.vault.create(fileName, '');
        const newLeaf = Keymap.isModEvent(event);
        app.workspace.getLeaf(newLeaf).openFile(file);
    }, [app]);

    const handleCardClick = dc.useCallback((path: string, newLeaf: boolean) => {
        const file = app.vault.getAbstractFileByPath(path);
        if (file) {
            if (settings.openFileAction === 'card') {
                app.workspace.getLeaf(newLeaf).openFile(file as TFile);
            } else if (settings.openFileAction === 'title') {
                // Only open on title click (handled in CardView)
            }
        }
    }, [app, settings.openFileAction]);

    const handleCopyToClipboard = dc.useCallback((e: MouseEvent) => {
        e.stopPropagation();
        const limit = parseInt(resultLimit);
        const count = limit > 0 && totalCount > limit ? limit : totalCount;
        const text = `Copied ${count} result${count === 1 ? '' : 's'} to clipboard`;

        const links = sorted.slice(0, limit > 0 ? limit : sorted.length)
            .map(p => `[[${p.$name}]]`)
            .join('\n');

        navigator.clipboard.writeText(links);

        // TODO: Show notification
        console.log(text);
    }, [resultLimit, totalCount, sorted]);

    const handleSettingsChange = dc.useCallback((newSettings: Partial<Settings>) => {
        setSettings(prev => ({ ...prev, ...newSettings }));
    }, []);

    const handleLocalizeSettingsToggle = dc.useCallback(() => {
        setLocalizeSettings(!localizeSettings);
    }, [localizeSettings]);

    // Copy menu item for Toolbar
    const copyMenuItem = dc.useMemo(() => (
        <div
            className="bases-toolbar-menu-item"
            onClick={handleCopyToClipboard}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleCopyToClipboard(e as any);
                }
            }}
            tabIndex={0}
            role="menuitem"
        >
            <div className="bases-toolbar-menu-item-info">
                <div className="bases-toolbar-menu-item-info-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="svg-icon lucide-copy">
                        <rect x="8" y="8" width="14" height="14" rx="2" ry="2"/>
                        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
                    </svg>
                </div>
                <div className="bases-toolbar-menu-item-name">Copy to clipboard</div>
            </div>
        </div>
    ), [handleCopyToClipboard]);

    // Render appropriate view component
    const renderView = () => {
        const commonProps = {
            results: sorted,
            displayedCount: Math.min(displayedCount, sorted.length),
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
            onCardClick: handleCardClick,
            onFocusChange: setFocusableCardIndex
        };

        if (viewMode === 'list') {
            return <ListView {...commonProps} />;
        } else if (viewMode === 'masonry') {
            return <MasonryView {...commonProps} />;
        } else {
            return <CardView {...commonProps} />;
        }
    };

    // Apply width mode class
    const widthClass = widthMode === 'max' ? 'max-width' : widthMode === 'wide' ? 'wide-width' : '';

    return (
        <div
            ref={explorerRef}
            className={`dynamic-views ${widthClass}${!settings.addCardBackground ? ' no-card-background' : ''}`}
        >
            <div
                ref={toolbarRef}
                className={`controls-wrapper${isPinned ? ' pinned' : ''}${isResultsScrolled ? ' scrolled' : ''}`}
                style={isPinned ? {
                    position: 'fixed',
                    top: `${stickyTop}px`,
                    width: `${toolbarDimensions.width}px`,
                    left: `${toolbarDimensions.left}px`,
                } : {}}
            >
                <Toolbar
                    dc={dc}
                    viewMode={viewMode}
                    showViewDropdown={showViewDropdown}
                    onToggleViewDropdown={handleToggleViewDropdown}
                    onSetViewCard={() => handleSetViewMode('card')}
                    onSetViewMasonry={() => handleSetViewMode('masonry')}
                    onSetViewList={() => handleSetViewMode('list')}
                    sortMethod={sortMethod}
                    isShuffled={isShuffled}
                    showSortDropdown={showSortDropdown}
                    onToggleSortDropdown={handleToggleSortDropdown}
                    onSetSortNameAsc={() => handleSetSortMethod('name-asc')}
                    onSetSortNameDesc={() => handleSetSortMethod('name-desc')}
                    onSetSortMtimeDesc={() => handleSetSortMethod('mtime-desc')}
                    onSetSortMtimeAsc={() => handleSetSortMethod('mtime-asc')}
                    onSetSortCtimeDesc={() => handleSetSortMethod('ctime-desc')}
                    onSetSortCtimeAsc={() => handleSetSortMethod('ctime-asc')}
                    searchQuery={searchQuery}
                    onSearchChange={handleSearchChange}
                    onSearchFocus={handleSearchFocus}
                    onClearSearch={handleClearSearch}
                    settings={settings}
                    onShuffle={handleShuffle}
                    onOpenRandom={handleOpenRandom}
                    showQueryEditor={showQueryEditor}
                    draftQuery={draftQuery}
                    onToggleCode={handleToggleCode}
                    onDraftQueryChange={handleDraftQueryChange}
                    onApplyQuery={handleApplyQuery}
                    onClearQuery={handleClearQuery}
                    totalCount={totalCount}
                    displayedCount={Math.min(displayedCount, sorted.length)}
                    resultLimit={resultLimit}
                    showLimitDropdown={showLimitDropdown}
                    onToggleLimitDropdown={handleToggleLimitDropdown}
                    onResultLimitChange={handleResultLimitChange}
                    onResetLimit={handleResetLimit}
                    copyMenuItem={copyMenuItem}
                    onCreateNote={handleCreateNote}
                    isPinned={isPinned}
                    widthMode={widthMode}
                    queryHeight={settings.queryHeight}
                    onTogglePin={handleTogglePin}
                    onToggleWidth={handleToggleWidth}
                    onToggleSettings={handleToggleSettings}
                    showSettings={showSettings}
                    localizeSettings={localizeSettings}
                    onLocalizeSettingsChange={handleLocalizeSettingsToggle}
                    onSettingsChange={handleSettingsChange}
                />
            </div>

            {queryError && (
                <div className="query-error">
                    {queryError}
                </div>
            )}

            <div
                className={`results-container${settings.queryHeight > 0 && !isScrolledToBottom ? ' with-fade' : ''}`}
                style={settings.queryHeight > 0 ? { maxHeight: `${settings.queryHeight}px`, overflowY: 'auto' } : {}}
            >
                {renderView()}
            </div>

            <div ref={loadMoreRef} style={{ height: '1px', width: '100%' }} />
        </div>
    );
}
