import { App, TFile, Plugin, Keymap } from 'obsidian';
import { Settings, UIState, ViewMode, WidthMode, DefaultViewSettings } from '../types';
import { DEFAULT_SETTINGS } from '../constants';
import { PersistenceManager } from '../persistence';
import { CardView } from './card-view';
import { MasonryView } from './masonry-view';
import { ListView } from './list-view';
import { Toolbar } from './toolbar';
import { getCurrentFile, getFileCtime, getAvailablePath } from '../utils/file';
import { ensurePageSelector, updateQueryInBlock, findQueryInBlock } from '../utils/query-sync';
import { processImagePaths, resolveInternalImagePaths, extractEmbedImages } from '../utils/image';
import { loadFilePreview } from '../utils/preview';
import { getFirstDatacorePropertyValue, getAllDatacoreImagePropertyValues } from '../utils/property';
import type { DatacoreAPI, DatacoreFile } from '../types/datacore';

// Extend App type to include isMobile property
declare module 'obsidian' {
    interface App {
        isMobile: boolean;
    }
}

interface DynamicViewsPlugin extends Plugin {
    persistenceManager: PersistenceManager;
}

interface ViewProps {
    plugin: DynamicViewsPlugin;
    app: App;
    dc: DatacoreAPI;
    USER_QUERY?: string;
}

export function View({ plugin, app, dc, USER_QUERY = '' }: ViewProps): JSX.Element {
    // Get file containing this query (memoized to prevent re-fetching on every render)
    // This is used to exclude the query note itself from results
    const currentFile = dc.useMemo(() => {
        const file = getCurrentFile(app);
        return file;
    }, [app]);

    const currentFilePath = currentFile?.path;
    const ctime = getFileCtime(currentFile);

    // Access PersistenceManager from plugin
    const persistenceManager = plugin.persistenceManager;

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

    const stripMarkdownSyntax = dc.useCallback((text: string) => {
        if (!text || text.trim().length === 0) return '';

        // First pass: remove callout title lines only
        text = text.replace(/^>\s*\[![\w-]+\][+-]?.*$/gm, '');
        // Second pass: strip > prefix from remaining blockquote lines
        text = text.replace(/^>\s?/gm, '');

        let result = text;

        // Apply each pattern
        markdownPatterns.forEach((pattern) => {
            result = result.replace(pattern, (match: string, ...groups: string[]) => {
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
        if (!ctime || !persistenceManager) return DEFAULT_SETTINGS;

        const globalSettings = persistenceManager.getGlobalSettings();
        const defaultViewSettings = persistenceManager.getDefaultViewSettings();
        const viewSettings = persistenceManager.getViewSettings(ctime);

        // Start with global settings as base
        const baseSettings = { ...globalSettings };

        // For view-specific properties, merge: defaultViewSettings -> viewSettings (persisted)
        baseSettings.titleProperty = viewSettings.titleProperty ?? defaultViewSettings.titleProperty;
        baseSettings.descriptionProperty = viewSettings.descriptionProperty ?? defaultViewSettings.descriptionProperty;
        baseSettings.imageProperty = viewSettings.imageProperty ?? defaultViewSettings.imageProperty;
        baseSettings.metadataDisplayLeft = viewSettings.metadataDisplayLeft ?? defaultViewSettings.metadataDisplayLeft;
        baseSettings.metadataDisplayRight = viewSettings.metadataDisplayRight ?? defaultViewSettings.metadataDisplayRight;
        baseSettings.showTextPreview = viewSettings.showTextPreview ?? defaultViewSettings.showTextPreview;
        baseSettings.fallbackToContent = viewSettings.fallbackToContent ?? defaultViewSettings.fallbackToContent;
        baseSettings.showThumbnails = viewSettings.showThumbnails ?? defaultViewSettings.showThumbnails;
        baseSettings.fallbackToEmbeds = viewSettings.fallbackToEmbeds ?? defaultViewSettings.fallbackToEmbeds;
        baseSettings.queryHeight = viewSettings.queryHeight ?? defaultViewSettings.queryHeight;
        baseSettings.listMarker = viewSettings.listMarker ?? defaultViewSettings.listMarker;

        return baseSettings;
    }, [ctime, persistenceManager]);

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

    const [_query, setQuery] = dc.useState(cleanQuery);
    const [draftQuery, setDraftQuery] = dc.useState(cleanQuery);
    const [appliedQuery, setAppliedQuery] = dc.useState(cleanQuery);
    const [isShuffled, setIsShuffled] = dc.useState(false);
    const [shuffledOrder, setShuffledOrder] = dc.useState<string[]>([]);
    const [showQueryEditor, setShowQueryEditor] = dc.useState(false);
    const [showLimitDropdown, setShowLimitDropdown] = dc.useState(false);
    const [showSettings, setShowSettings] = dc.useState(false);
    const [showSortDropdown, setShowSortDropdown] = dc.useState(false);
    const [showViewDropdown, setShowViewDropdown] = dc.useState(false);
    const [isPinned, setIsPinned] = dc.useState(false);
    const [queryError, setQueryError] = dc.useState<string | null>(null);
    const [displayedCount, setDisplayedCount] = dc.useState(app.isMobile ? 25 : 50);
    const [focusableCardIndex, setFocusableCardIndex] = dc.useState(0);
    const [isResultsScrolled, setIsResultsScrolled] = dc.useState(false);
    const [isScrolledToBottom, setIsScrolledToBottom] = dc.useState(true);

    // Settings state
    const [settings, setSettings] = dc.useState(getPersistedSettings());

    // Refs
    const explorerRef = dc.useRef<HTMLElement | null>(null);
    const toolbarRef = dc.useRef<HTMLElement | null>(null);
    const containerRef = dc.useRef<HTMLElement | null>(null);
    const updateLayoutRef = dc.useRef<(() => void) | null>(null);
    const loadMoreRef = dc.useRef<(() => void) | null>(null);
    const isLoadingRef = dc.useRef(false);
    const columnCountRef = dc.useRef<number | null>(null);
    const displayedCountRef = dc.useRef(displayedCount);
    const settingsTimeoutRef = dc.useRef<ReturnType<typeof setTimeout> | null>(null);
    const isSyncing = dc.useRef(false);

    const [stickyTop, setStickyTop] = dc.useState(0);
    const [toolbarDimensions, setToolbarDimensions] = dc.useState({ width: 0, height: 0, left: 0 });

    // Persist UI state changes
    dc.useEffect(() => {
        if (ctime && persistenceManager) {
            void persistenceManager.setUIState(ctime, { sortMethod });
        }
    }, [sortMethod, ctime, persistenceManager]);

    dc.useEffect(() => {
        if (ctime && persistenceManager) {
            void persistenceManager.setUIState(ctime, { viewMode });
        }
    }, [viewMode, ctime, persistenceManager]);

    dc.useEffect(() => {
        if (ctime && persistenceManager) {
            void persistenceManager.setUIState(ctime, { widthMode });
        }
    }, [widthMode, ctime, persistenceManager]);

    dc.useEffect(() => {
        if (ctime && persistenceManager) {
            void persistenceManager.setUIState(ctime, { searchQuery });
        }
    }, [searchQuery, ctime, persistenceManager]);

    dc.useEffect(() => {
        if (ctime && persistenceManager) {
            void persistenceManager.setUIState(ctime, { resultLimit });
        }
    }, [resultLimit, ctime, persistenceManager]);

    // Persist settings changes
    dc.useEffect(() => {
        if (settingsTimeoutRef.current) {
            clearTimeout(settingsTimeoutRef.current);
        }
        settingsTimeoutRef.current = setTimeout(() => {
            if (ctime && persistenceManager) {
                // Extract only view-specific settings (those in DefaultViewSettings)
                const viewSettings: Partial<DefaultViewSettings> = {
                    titleProperty: settings.titleProperty,
                    descriptionProperty: settings.descriptionProperty,
                    imageProperty: settings.imageProperty,
                    metadataDisplayLeft: settings.metadataDisplayLeft,
                    metadataDisplayRight: settings.metadataDisplayRight,
                    showTextPreview: settings.showTextPreview,
                    fallbackToContent: settings.fallbackToContent,
                    showThumbnails: settings.showThumbnails,
                    fallbackToEmbeds: settings.fallbackToEmbeds,
                    queryHeight: settings.queryHeight,
                    listMarker: settings.listMarker
                };
                void persistenceManager.setViewSettings(ctime, viewSettings);
            }
        }, 300);
    }, [settings, ctime, persistenceManager]);

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
    const [_indexRevision, setIndexRevision] = dc.useState(0);

    dc.useEffect(() => {
        // Access Datacore core directly
        const core = (window as unknown as {
            datacore?: {
                core?: {
                    revision: number;
                    on: (event: string, callback: (revision: number) => void) => unknown;
                    offref: (ref: unknown) => void;
                }
            }
        }).datacore?.core;
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
    let pages: DatacoreFile[] = [];
    try {
        pages = dc.useQuery(validatedQuery) || [];
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Query error';
        setQueryError(errorMessage);
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
        let sorted: DatacoreFile[];
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
                    const file = app.vault.getAbstractFileByPath(p.$path);
                    if (file instanceof TFile) {
                        // Get property value for text preview
                        const descFromProp = getFirstDatacorePropertyValue(p, settings.descriptionProperty);
                        const descAsString = typeof descFromProp === 'string' || typeof descFromProp === 'number'
                            ? String(descFromProp)
                            : null;

                        // Get ALL image values from ALL comma-separated properties
                        const propertyImageValues = getAllDatacoreImagePropertyValues(p, settings.imageProperty);

                        // Process and validate image paths using shared utility
                        const { internalPaths: propertyImagePaths, externalUrls: propertyExternalUrls } =
                            await processImagePaths(propertyImageValues);

                        // Process text preview only if enabled
                        if (settings.showTextPreview) {
                            // Get title for first line comparison
                            let titleValue: unknown = p.value(settings.titleProperty);
                            if (Array.isArray(titleValue)) titleValue = titleValue[0] as unknown;
                            const titleString = titleValue ? dc.coerce.string(titleValue) : undefined;

                            // Use shared utility for preview loading
                            const description = await loadFilePreview(
                                file,
                                app,
                                descAsString,
                                {
                                    fallbackToContent: settings.fallbackToContent,
                                    omitFirstLine: settings.omitFirstLine
                                },
                                p.$name,
                                titleString
                            );

                            // Always set snippet value, even if empty (to prevent perpetual "Loading...")
                            newSnippets[p.$path] = description;
                        }

                        // Process thumbnails only if enabled
                        if (settings.showThumbnails) {
                            // Phase A: Convert property image paths to resource paths using shared utility
                            const propertyResourcePaths: string[] = [
                                ...resolveInternalImagePaths(propertyImagePaths, p.$path, app),
                                ...propertyExternalUrls  // External URLs already validated by processImagePaths
                            ];

                            // Phase B: Extract body embed resource paths using shared utility
                            const bodyResourcePaths = await extractEmbedImages(file, app);

                            // Phase C: Merge with fallback: property images first, then body embeds (if enabled)
                            const allResourcePaths = propertyResourcePaths.length > 0
                                ? propertyResourcePaths
                                : (settings.fallbackToEmbeds ? bodyResourcePaths : []);

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
                } catch (e: unknown) {
                    console.error("Error reading file:", p.$path, e instanceof Error ? e.message : e);
                    if (settings.showTextPreview) {
                        newSnippets[p.$path] = "(Error reading file)";
                    }
                }
            }

            setSnippets(newSnippets);
            setImages(newImages);
            setHasImageAvailable(newHasImageAvailable);
        };

        void loadSnippets();
    }, [sorted, displayedCount, stripMarkdownSyntax, settings.showTextPreview, settings.showThumbnails, settings, app, dc]);

    // Masonry layout
    const [columnCount, setColumnCount] = dc.useState(1);
    const [_columnHeights, setColumnHeights] = dc.useState<number[]>([]);
    const columnHeightsRef = dc.useRef<number[]>([]);
    const lastPositionedCountRef = dc.useRef(0);
    const lastContainerWidthRef = dc.useRef(0);

    // Masonry layout effect
    dc.useEffect(() => {
        // Clean up masonry styles if not in masonry mode
        if (viewMode !== 'masonry') {
            const container = containerRef.current;
            if (container) {
                const cards = container.querySelectorAll<HTMLElement>('.writing-card');
                cards.forEach((card) => {
                    card.style.position = '';
                    card.style.left = '';
                    card.style.top = '';
                    card.style.width = '';
                    card.style.transition = '';
                });
                container.style.height = '';
            }
            // Clear the ref so image onLoad handlers don't trigger masonry layout
            updateLayoutRef.current = null;
            return;
        }

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

            const cardMinWidth = settings.minCardWidth;
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
            const widthChanged = Math.abs(containerWidth - lastContainerWidthRef.current!) > 1;
            const isIncremental = previousCount > 0 &&
                                  previousCount < cards.length &&
                                  !widthChanged &&
                                  columnHeightsRef.current!.length === cols;

            // Batch DOM operations
            requestAnimationFrame(() => {
                const cardsToProcess = isIncremental ?
                    Array.from(cards).slice(previousCount) as HTMLElement[] :
                    Array.from(cards) as HTMLElement[];

                // Set widths
                cardsToProcess.forEach((card) => {
                    card.style.width = `${cardWidth}px`;
                });

                // Force reflow
                void container.offsetHeight;

                // Read heights
                const cardHeights = cardsToProcess.map((card) => card.offsetHeight);

                // Calculate positions
                const heights: number[] = isIncremental ?
                    [...columnHeightsRef.current!] :
                    new Array(cols).fill(0) as number[];
                const positions: { left: number; top: number }[] = [];

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
                    cardsToProcess.forEach((card: HTMLElement, i: number) => {
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
        let layoutTimeout: ReturnType<typeof setTimeout> | null = null;
        const debouncedLayout = () => {
            if (layoutTimeout) clearTimeout(layoutTimeout);
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
            if (layoutTimeout) clearTimeout(layoutTimeout);
        };
    }, [sorted, viewMode, settings.minMasonryColumns, settings.minCardWidth, dc]);

    // Apply dynamic grid layout (all width modes)
    dc.useEffect(() => {
        if (viewMode !== 'card') return;

        const container = containerRef.current;
        if (!container) return;

        const updateGrid = () => {
            const containerWidth = container.clientWidth;
            const cardMinWidth = settings.minCardWidth;
            const minColumns = settings.minGridColumns;
            const gap = 8;
            const cols = Math.max(minColumns, Math.floor((containerWidth + gap) / (cardMinWidth + gap)));
            const cardWidth = (containerWidth - (gap * (cols - 1))) / cols;

            container.style.setProperty('--card-min-width', `${cardWidth}px`);
            container.style.setProperty('--grid-columns', String(cols));
        };

        updateGrid();

        const resizeObserver = new ResizeObserver(updateGrid);
        resizeObserver.observe(container);

        return () => {
            resizeObserver.disconnect();
        };
    }, [viewMode, settings.minCardWidth, settings.minGridColumns, dc]);

    // Sync refs for callback access in infinite scroll
    dc.useEffect(() => {
        console.log('[InfiniteScroll:RefSync] columnCountRef updated:', columnCountRef.current, '→', columnCount);
        columnCountRef.current = columnCount;
    }, [columnCount, dc]);

    dc.useEffect(() => {
        console.log('[InfiniteScroll:RefSync] displayedCountRef updated:', displayedCountRef.current, '→', displayedCount);
        displayedCountRef.current = displayedCount;
    }, [displayedCount, dc]);

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

    // Infinite scroll: ResizeObserver + scroll + window resize
    dc.useEffect(() => {
        if (!containerRef.current) {
            // console.log('[InfiniteScroll] containerRef not available, skipping setup');
            return;
        }

        // console.log('[InfiniteScroll] Setting up infinite scroll system');

        // Configuration: preload distance multipliers
        const DESKTOP_VIEWPORT_MULTIPLIER = 2; // Load when within 2x viewport height from bottom
        const MOBILE_VIEWPORT_MULTIPLIER = Math.max(1, DESKTOP_VIEWPORT_MULTIPLIER * 0.5); // Mobile: 0.5x of desktop, minimum 1x

        // Find the element that actually scrolls
        let element: HTMLElement | null = containerRef.current;
        let scrollableElement: HTMLElement | Window | null = null;

        while (element && !scrollableElement) {
            if (element.scrollHeight > element.clientHeight) {
                scrollableElement = element;
            }
            element = element.parentElement;
        }

        if (!scrollableElement) {
            scrollableElement = window;
            // console.log('[InfiniteScroll] Using window as scroll container');
        } else {
            // console.log('[InfiniteScroll] Using element as scroll container:', scrollableElement.className);
        }

        // Core batch loading function
        const loadMoreItems = (trigger = 'unknown') => {
            // console.log(`[InfiniteScroll] loadMoreItems() called by: ${trigger}`);

            // Guard: already loading or no container
            if (isLoadingRef.current) {
                // console.log('[InfiniteScroll] Already loading, skipping');
                return false;
            }
            if (!containerRef.current) {
                // console.log('[InfiniteScroll] No container, skipping');
                return false;
            }

            // Get current count from ref (captures latest value)
            const currentCount = displayedCountRef.current!;
            if (currentCount >= sorted.length) {
                // console.log(`[InfiniteScroll] All items loaded (${currentCount}/${sorted.length})`);
                return false; // All items loaded
            }

            // Calculate distance from bottom using the scrollable element we already found
            let scrollTop, editorHeight, scrollHeight;

            if (scrollableElement === window) {
                scrollTop = window.scrollY || document.documentElement.scrollTop;
                editorHeight = window.innerHeight;
                scrollHeight = document.documentElement.scrollHeight;
            } else if (scrollableElement instanceof HTMLElement) {
                // TypeScript narrowing: must be HTMLElement here
                scrollTop = scrollableElement.scrollTop;
                editorHeight = scrollableElement.clientHeight;
                scrollHeight = scrollableElement.scrollHeight;
            } else {
                // Fallback if somehow scrollableElement is null (shouldn't happen)
                return false;
            }

            const distanceFromBottom = scrollHeight - (scrollTop + editorHeight);

            // Calculate threshold
            const threshold = editorHeight * (app.isMobile ? MOBILE_VIEWPORT_MULTIPLIER : DESKTOP_VIEWPORT_MULTIPLIER);

            // console.log(`[InfiniteScroll] Metrics: scrollTop=${scrollTop.toFixed(0)}px, editorHeight=${editorHeight}px, scrollHeight=${scrollHeight}px, distance=${distanceFromBottom.toFixed(0)}px, threshold=${threshold.toFixed(0)}px`);

            // Check if we should load
            if (distanceFromBottom > threshold) {
                // console.log(`[InfiniteScroll] Distance (${distanceFromBottom.toFixed(0)}px) > threshold (${threshold.toFixed(0)}px), not loading`);
                return false;
            }

            // Load batch
            // console.log('[InfiniteScroll] Distance within threshold, loading batch...');
            isLoadingRef.current = true;

            const currentCols = columnCountRef.current || 2;
            const rowsPerColumn = 10;
            const batchSize = Math.min(currentCols * rowsPerColumn, 7 * rowsPerColumn);
            const newCount = Math.min(currentCount + batchSize, sorted.length);

            // console.log(`[InfiniteScroll] Loading batch: ${currentCount} → ${newCount} (${batchSize} items, ${currentCols} cols × ${rowsPerColumn} rows)`);

            displayedCountRef.current = newCount;
            setDisplayedCount(newCount);

            return true; // Batch loaded
        };

        // Setup ResizeObserver (watches masonry container)
        // console.log('[InfiniteScroll] Setting up ResizeObserver on masonry container');
        const resizeObserver = new ResizeObserver(() => {
            // console.log('[InfiniteScroll] ResizeObserver: Masonry container height changed (layout completed)');

            // Masonry just completed layout, clear loading flag
            isLoadingRef.current = false;

            // Check if need more items
            loadMoreItems('ResizeObserver');
        });
        resizeObserver.observe(containerRef.current);

        // Setup window resize listener (handles viewport height changes)
        // console.log('[InfiniteScroll] Setting up window resize listener');
        const handleWindowResize = () => {
            // console.log('[InfiniteScroll] Window resized, checking if need more items');
            loadMoreItems('window.resize');
        };
        window.addEventListener('resize', handleWindowResize);

        // Setup scroll listener with leading-edge throttle
        // console.log('[InfiniteScroll] Setting up scroll listener with leading-edge throttle');
        let scrollTimer: ReturnType<typeof setTimeout> | null = null;
        const handleScroll = () => {
            if (scrollTimer) {
                // Cooldown active, ignore
                return;
            }

            // console.log('[InfiniteScroll] Scroll event (cooldown started)');

            // Check immediately (leading edge)
            loadMoreItems('scroll');

            // Start cooldown
            scrollTimer = setTimeout(() => {
                // console.log('[InfiniteScroll] Scroll cooldown ended');
                scrollTimer = null;
            }, 100);
        };
        scrollableElement.addEventListener('scroll', handleScroll, { passive: true });

        // console.log('[InfiniteScroll] All listeners attached, system ready');

        // Cleanup
        return () => {
            // console.log('[InfiniteScroll] Cleaning up all listeners');
            resizeObserver.disconnect();
            window.removeEventListener('resize', handleWindowResize);
            scrollableElement.removeEventListener('scroll', handleScroll);
            if (scrollTimer) clearTimeout(scrollTimer);
        };
    }, []); // Empty deps - only set up once on mount

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
        setDisplayedCount(app.isMobile ? 25 : 50);
    }, [app.isMobile]);

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
        if (file instanceof TFile) {
            const newLeaf = Keymap.isModEvent(event);
            void app.workspace.getLeaf(newLeaf).openFile(file);
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

    const handleApplyQuery = dc.useCallback(() => {
        void (async () => {
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
        })();
    }, [draftQuery, currentFile, syncQueryToCodeBlock]);

    const handleClearQuery = dc.useCallback(() => {
        void (async () => {
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
        })();
    }, [currentFile, syncQueryToCodeBlock]);

    const handleResultLimitChange = dc.useCallback((limit: string) => {
        setResultLimit(limit);
    }, []);

    const handleResetLimit = dc.useCallback((): void => {
        setResultLimit('');
        setShowLimitDropdown(false);
    }, []);

    const handleCreateNote = dc.useCallback((event: MouseEvent) => {
        void (async () => {
            const folderPath = currentFile?.parent?.path || '';
            const filePath = getAvailablePath(app, folderPath, 'Untitled');
            const file = await app.vault.create(filePath, '');
            const newLeaf = Keymap.isModEvent(event);
            void app.workspace.getLeaf(newLeaf).openFile(file);
        })();
    }, [app, currentFile]);

    const handleCardClick = dc.useCallback((path: string, newLeaf: boolean) => {
        const file = app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            if (settings.openFileAction === 'card') {
                void app.workspace.getLeaf(newLeaf).openFile(file);
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

        void navigator.clipboard.writeText(links);

        // TODO: Show notification
        console.log(text);
    }, [resultLimit, totalCount, sorted]);

    const handleSettingsChange = dc.useCallback((newSettings: Partial<Settings>) => {
        setSettings(prev => ({ ...prev, ...newSettings }));
    }, []);

    // Copy menu item for Toolbar
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Datacore useMemo lacks proper TypeScript types
    const copyMenuItem: JSX.Element = dc.useMemo((): JSX.Element => (
        <div
            className="bases-toolbar-menu-item"
            onClick={handleCopyToClipboard}
            onKeyDown={(e: unknown) => {
                const evt = e as KeyboardEvent;
                if (evt.key === 'Enter' || evt.key === ' ') {
                    evt.preventDefault();
                    handleCopyToClipboard(evt as unknown as MouseEvent);
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
    const renderView = (): JSX.Element => {
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
            return <CardView {...commonProps} viewMode="card" />;
        }
    };

    // Apply width mode class
    const widthClass = widthMode === 'max' ? 'max-width' : widthMode === 'wide' ? 'wide-width' : '';

    return (
        <div
            ref={explorerRef}
            className={`dynamic-views ${widthClass}${settings.addCardBackground === 'transparent' ? ' no-card-background' : ''}`}
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
                    copyMenuItem={copyMenuItem /* eslint-disable-line @typescript-eslint/no-unsafe-assignment */}
                    onCreateNote={handleCreateNote}
                    isPinned={isPinned}
                    widthMode={widthMode}
                    queryHeight={settings.queryHeight}
                    onTogglePin={handleTogglePin}
                    onToggleWidth={handleToggleWidth}
                    onToggleSettings={handleToggleSettings}
                    showSettings={showSettings}
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
