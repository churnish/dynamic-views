import { App, TFile, Keymap, Notice } from "obsidian";
import type { PaneType } from "obsidian";
import type DynamicViews from "../../main";
import {
  ResolvedSettings,
  DatacoreState,
  ViewMode,
  WidthMode,
  ViewDefaults,
  DatacoreDefaults,
} from "../types";
import {
  resolveSettings,
  VIEW_DEFAULTS,
  DATACORE_DEFAULTS,
} from "../constants";
import {
  BATCH_SIZE,
  PANE_MULTIPLIER,
  ROWS_PER_COLUMN,
  MAX_BATCH_SIZE,
  WIDE_MODE_MULTIPLIER,
  SCROLL_THROTTLE_MS,
  RESIZE_THROTTLE_MS,
} from "../shared/constants";
import { CardView } from "./card-view";
import {
  cleanupAllCardObservers,
  cleanupAllCardScrollListeners,
  cleanupAllImageViewers,
} from "../shared/card-renderer";
import { remeasurePropertyFields } from "../shared/property-measure";
import { MasonryView } from "./masonry-view";
import { ListView } from "./list-view";
import { Toolbar } from "./toolbar";
import { getCurrentFile, getAvailablePath } from "../utils/file";
import {
  ensurePageSelector,
  updateQueryInBlock,
  findQueryInBlock,
} from "../utils/query-sync";
import { getPaneType } from "../utils/randomize";
import {
  loadTextPreviewsForEntries,
  loadImagesForEntries,
} from "../shared/content-loader";
import {
  getFirstDatacorePropertyValue,
  getAllDatacoreImagePropertyValues,
} from "../utils/property";
import {
  getCardSpacing,
  setupStyleSettingsObserver,
} from "../utils/style-settings";
import { reapplyAmbientColors } from "../shared/image-loader";
import {
  calculateMasonryLayout,
  calculateIncrementalMasonryLayout,
  applyMasonryLayout,
  type MasonryLayoutResult,
} from "../utils/masonry-layout";
import type { DatacoreAPI, DatacoreFile } from "./types";
import {
  resolveTimestampProperty,
  datacoreResultToCardData,
} from "../shared/data-transform";
import type { CardData } from "../shared/card-renderer";
import { setupSwipeInterception } from "../bases/swipe-interceptor";
import { setupHoverKeyboardNavigation } from "../shared/keyboard-nav";
import { initializeScrollGradients } from "../shared/scroll-gradient";
import {
  initializeTitleTruncation,
  syncResponsiveClasses,
} from "../bases/shared-renderer";

// Thumbnail size CSS values
const THUMBNAIL_SIZE_MAP: Record<string, string> = {
  compact: "64px",
  standard: "80px",
  expanded: "94.5px",
};

// Extend App type to include isMobile property
declare module "obsidian" {
  interface App {
    isMobile: boolean;
  }
}

interface ViewProps {
  plugin: DynamicViews;
  app: App;
  dc: DatacoreAPI;
  USER_QUERY?: string;
  QUERY_ID?: string;
}

export function View({
  plugin,
  app,
  dc,
  USER_QUERY = "",
  QUERY_ID,
}: ViewProps): JSX.Element {
  // Get file containing this query (memoized to prevent re-fetching on every render)
  // This is used to exclude the query note itself from results
  const currentFile = dc.useMemo(() => {
    const file = getCurrentFile(app);
    return file;
  }, [app]);

  const currentFilePath = currentFile?.path;

  // Access PersistenceManager from plugin
  const persistenceManager = plugin.persistenceManager;

  // Helper: get persisted settings
  const getPersistedSettings = dc.useCallback((): ResolvedSettings => {
    if (!persistenceManager) return resolveSettings({} as Partial<never>);

    const pluginSettings = persistenceManager.getPluginSettings();
    const template = persistenceManager.getSettingsTemplate("datacore");
    const datacoreState = persistenceManager.getDatacoreState(QUERY_ID);

    return resolveSettings(pluginSettings, VIEW_DEFAULTS, DATACORE_DEFAULTS, {
      ...template?.settings,
      ...datacoreState.settings,
    });
  }, [persistenceManager, QUERY_ID]);

  // Helper: get persisted UI state value
  const getPersistedValue = dc.useCallback(
    <K extends keyof DatacoreState>(
      key: K,
      defaultValue: DatacoreState[K],
    ): DatacoreState[K] => {
      if (!persistenceManager) return defaultValue;
      const state = persistenceManager.getDatacoreState(QUERY_ID);
      return state[key] ?? defaultValue;
    },
    [persistenceManager, QUERY_ID],
  );

  // Initialize state
  const [sortMethod, setSortMethod] = dc.useState(
    getPersistedValue("sortMethod", "mtime-desc"),
  );
  const [searchQuery, setSearchQuery] = dc.useState(
    getPersistedValue("searchQuery", ""),
  );
  const [viewMode, setViewMode] = dc.useState(
    getPersistedValue("viewMode", "card") as ViewMode,
  );
  const [widthMode, setWidthMode] = dc.useState(
    getPersistedValue("widthMode", "normal") as WidthMode,
  );
  const [resultLimit, setResultLimit] = dc.useState(
    getPersistedValue("resultLimit", ""),
  );

  // Query state - extract query from between DQL markers if present
  const cleanQuery = (USER_QUERY || "")
    .split("\n")
    .filter(
      (line) => !line.includes("QUERY START") && !line.includes("QUERY END"),
    )
    .join("\n")
    .trim();

  const [draftQuery, setDraftQuery] = dc.useState(cleanQuery);
  const [appliedQuery, setAppliedQuery] = dc.useState(cleanQuery);
  const [isShuffled, setIsShuffled] = dc.useState(false);
  const [shuffledOrder, setShuffledOrder] = dc.useState<string[]>([]);
  const [showQueryEditor, setShowQueryEditor] = dc.useState(false);
  const [showLimitDropdown, setShowLimitDropdown] = dc.useState(false);
  const [showSettings, setShowSettings] = dc.useState(false);
  const [showSortDropdown, setShowSortDropdown] = dc.useState(false);
  const [showViewDropdown, setShowViewDropdown] = dc.useState(false);
  const [queryError, setQueryError] = dc.useState<string | null>(null);
  const [displayedCount, setDisplayedCount] = dc.useState(
    app.isMobile ? BATCH_SIZE * 0.5 : BATCH_SIZE,
  );
  const [focusableCardIndex, setFocusableCardIndex] = dc.useState(0);
  const [isResultsScrolled, setIsResultsScrolled] = dc.useState(false);
  const [isScrolledToBottom, setIsScrolledToBottom] = dc.useState(true);
  const [canExpandToMax, setCanExpandToMax] = dc.useState(true);

  // Settings state
  const [settings, setSettings] = dc.useState(getPersistedSettings());

  // Refs
  const explorerRef = dc.useRef<HTMLElement | null>(null);
  const toolbarRef = dc.useRef<HTMLElement | null>(null);
  const containerRef = dc.useRef<HTMLElement | null>(null);
  const hoveredCardRef = dc.useRef<HTMLElement | null>(null);
  const resultsContainerRef = dc.useRef<HTMLElement | null>(null);
  const updateLayoutRef = dc.useRef<(() => void) | null>(null);
  const loadMoreRef = dc.useRef<(() => void) | null>(null);
  const isLoadingRef = dc.useRef(false);
  const columnCountRef = dc.useRef<number | null>(null);
  const displayedCountRef = dc.useRef(displayedCount);
  const sortedLengthRef = dc.useRef<number>(0);
  const hasBatchAppendedRef = dc.useRef(false);
  const settingsTimeoutRef = dc.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const isSyncing = dc.useRef(false);

  // Stable pages reference - prevents re-renders when Datacore returns new array with same content
  const prevPagesKeyRef = dc.useRef<string>("");

  // Debounce pages updates to prevent render cascade
  const [stablePages, setStablePages] = dc.useState<DatacoreFile[]>([]);

  // Incremental masonry layout tracking
  const lastLayoutResultRef = dc.useRef<MasonryLayoutResult | null>(null);
  const lastLayoutWidthRef = dc.useRef<number>(0);
  const prevMasonryCountRef = dc.useRef(0);
  const prevCardSizeRef = dc.useRef(settings.cardSize);
  const prevStyleRevisionRef = dc.useRef(0);

  // Cleanup ResizeObservers, scroll listeners, and image viewers on unmount
  dc.useEffect(() => {
    return () => {
      cleanupAllCardObservers();
      cleanupAllCardScrollListeners();
      cleanupAllImageViewers();
    };
  }, []);

  // Re-read state from persistence on layout change (Live Preview <-> Reading View sync)
  dc.useEffect(() => {
    if (!QUERY_ID || !persistenceManager) return;

    const handleLayoutChange = () => {
      const state = persistenceManager.getDatacoreState(QUERY_ID);
      // Always set from persistence - React will bail out if values are the same
      if (state.sortMethod !== undefined) setSortMethod(state.sortMethod);
      if (state.viewMode !== undefined) setViewMode(state.viewMode as ViewMode);
      if (state.widthMode !== undefined)
        setWidthMode(state.widthMode as WidthMode);
      if (state.searchQuery !== undefined) setSearchQuery(state.searchQuery);
      if (state.resultLimit !== undefined) setResultLimit(state.resultLimit);
    };

    app.workspace.on("layout-change", handleLayoutChange);
    return () => {
      app.workspace.off("layout-change", handleLayoutChange);
    };
  }, [QUERY_ID, persistenceManager, app.workspace]);

  // Persist UI state changes (only if different from persisted value to avoid overwriting on mount)
  dc.useEffect(() => {
    if (QUERY_ID && persistenceManager) {
      const persisted = persistenceManager.getDatacoreState(QUERY_ID);
      if (persisted.sortMethod !== sortMethod) {
        void persistenceManager.setDatacoreState(QUERY_ID, { sortMethod });
      }
    }
  }, [sortMethod, QUERY_ID, persistenceManager]);

  dc.useEffect(() => {
    if (QUERY_ID && persistenceManager) {
      const persisted = persistenceManager.getDatacoreState(QUERY_ID);
      if (persisted.viewMode !== viewMode) {
        void persistenceManager.setDatacoreState(QUERY_ID, { viewMode });
      }
    }
  }, [viewMode, QUERY_ID, persistenceManager]);

  dc.useEffect(() => {
    if (QUERY_ID && persistenceManager) {
      const persisted = persistenceManager.getDatacoreState(QUERY_ID);
      if (persisted.widthMode !== widthMode) {
        void persistenceManager.setDatacoreState(QUERY_ID, { widthMode });
      }
    }
  }, [widthMode, QUERY_ID, persistenceManager]);

  // Live Preview: apply inline width styles to this query's code block
  dc.useEffect(() => {
    if (widthMode === "normal" || !explorerRef.current) return;

    const section = explorerRef.current.closest(".markdown-source-view");
    if (!section) return; // Only applies to Live Preview

    const codeBlock = explorerRef.current.closest<HTMLElement>(
      ".cm-preview-code-block",
    );
    if (!codeBlock) return;

    const cmContent = section.querySelector<HTMLElement>(".cm-content");
    if (!cmContent) return;

    const updateWidth = () => {
      const sectionRect = section.getBoundingClientRect();
      const contentRect = cmContent.getBoundingClientRect();
      const cs = getComputedStyle(section);
      const fileLineWidth =
        parseFloat(cs.getPropertyValue("--file-line-width")) || 700;
      const fileMargins =
        parseFloat(cs.getPropertyValue("--file-margins")) || 16;
      const availableWidth = sectionRect.width - fileMargins * 2;
      const targetWidth = WIDE_MODE_MULTIPLIER * fileLineWidth;

      setCanExpandToMax(availableWidth > targetWidth);

      // Determine effective width and offset
      let effectiveWidth: number;
      if (widthMode === "max") {
        effectiveWidth = availableWidth;
      } else {
        // Wide mode: use target width, constrained to available space (with hysteresis)
        const isConstrained = codeBlock.style.width !== "";
        const buffer = isConstrained ? 40 : 0;
        effectiveWidth =
          availableWidth < targetWidth + buffer ? availableWidth : targetWidth;
      }

      const offsetLeft = sectionRect.left - contentRect.left + fileMargins;
      codeBlock.style.setProperty("width", `${effectiveWidth}px`, "important");
      codeBlock.style.setProperty(
        "max-width",
        `${effectiveWidth}px`,
        "important",
      );
      codeBlock.style.setProperty(
        "transform",
        `translateX(${offsetLeft}px)`,
        "important",
      );
    };

    updateWidth();

    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(section);

    return () => {
      resizeObserver.disconnect();
      // Clean up inline styles on unmount
      if (codeBlock) {
        codeBlock.style.removeProperty("width");
        codeBlock.style.removeProperty("max-width");
        codeBlock.style.removeProperty("transform");
      }
    };
  }, [widthMode]);

  // Reading View: apply inline width styles to this query's .el-pre block
  dc.useEffect(() => {
    if (!explorerRef.current) return;

    // Skip if in Live Preview (handled by the effect above)
    if (explorerRef.current.closest(".markdown-source-view")) return;

    const elPre = explorerRef.current.closest<HTMLElement>(".el-pre");
    if (!elPre) return;

    const section = explorerRef.current.closest(
      ".markdown-preview-view, .markdown-reading-view",
    );
    if (!section) return;

    if (widthMode === "normal") {
      elPre.style.removeProperty("width");
      elPre.style.removeProperty("max-width");
      elPre.style.removeProperty("margin-left");
      return;
    }

    const updateWidth = () => {
      const cs = getComputedStyle(section);
      const fileLineWidth =
        parseFloat(cs.getPropertyValue("--file-line-width")) || 700;
      const fileMargins =
        parseFloat(cs.getPropertyValue("--file-margins")) || 16;
      const targetWidth = WIDE_MODE_MULTIPLIER * fileLineWidth;
      const availableWidth =
        section.getBoundingClientRect().width - fileMargins * 2;

      setCanExpandToMax(availableWidth > targetWidth);

      const effectiveWidth =
        widthMode === "max"
          ? availableWidth
          : Math.min(targetWidth, availableWidth);
      const offset = (effectiveWidth - fileLineWidth) / 2;

      elPre.style.setProperty("width", `${effectiveWidth}px`, "important");
      elPre.style.setProperty("max-width", `${effectiveWidth}px`, "important");
      elPre.style.setProperty("margin-left", `-${offset}px`, "important");
    };

    updateWidth();

    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(section);

    return () => {
      resizeObserver.disconnect();
      elPre.style.removeProperty("width");
      elPre.style.removeProperty("max-width");
      elPre.style.removeProperty("margin-left");
    };
  }, [widthMode]);

  dc.useEffect(() => {
    if (QUERY_ID && persistenceManager) {
      const persisted = persistenceManager.getDatacoreState(QUERY_ID);
      if (persisted.searchQuery !== searchQuery) {
        void persistenceManager.setDatacoreState(QUERY_ID, { searchQuery });
      }
    }
  }, [searchQuery, QUERY_ID, persistenceManager]);

  dc.useEffect(() => {
    if (QUERY_ID && persistenceManager) {
      const persisted = persistenceManager.getDatacoreState(QUERY_ID);
      if (persisted.resultLimit !== resultLimit) {
        void persistenceManager.setDatacoreState(QUERY_ID, { resultLimit });
      }
    }
  }, [resultLimit, QUERY_ID, persistenceManager]);

  // Persist settings changes (debounced)
  // Only saves fields that differ from resolved defaults (ViewDefaults + DatacoreDefaults)
  dc.useEffect(() => {
    if (settingsTimeoutRef.current) {
      clearTimeout(settingsTimeoutRef.current);
    }
    settingsTimeoutRef.current = setTimeout(() => {
      if (QUERY_ID && persistenceManager) {
        const defaults = { ...VIEW_DEFAULTS, ...DATACORE_DEFAULTS };
        const overrides: Partial<ViewDefaults & DatacoreDefaults> = {};
        for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
          if (settings[key] !== defaults[key]) {
            (overrides as Record<string, unknown>)[key] = settings[key];
          }
        }
        void persistenceManager.setDatacoreState(
          QUERY_ID,
          Object.keys(overrides).length > 0 ? { settings: overrides } : {},
        );
      }
    }, 300);
    return () => {
      if (settingsTimeoutRef.current) {
        clearTimeout(settingsTimeoutRef.current);
      }
    };
  }, [settings, QUERY_ID, persistenceManager]);

  // Setup swipe interception on mobile if enabled (Datacore is always embedded)
  // Note: preventSidebarSwipe intentionally omitted from deps - global settings require restart
  dc.useEffect(() => {
    const pluginSettings = persistenceManager.getPluginSettings();
    if (
      app.isMobile &&
      pluginSettings.preventSidebarSwipe === "all-views" &&
      explorerRef.current
    ) {
      const controller = new AbortController();
      setupSwipeInterception(explorerRef.current, controller.signal);
      return () => controller.abort();
    }
  }, [app.isMobile, persistenceManager]);

  // Setup hover-to-start keyboard navigation
  dc.useEffect(() => {
    const cleanup = setupHoverKeyboardNavigation(
      () => hoveredCardRef.current,
      () => containerRef.current,
      setFocusableCardIndex,
    );
    return cleanup;
  }, []);

  // Setup Style Settings observer - re-render when CSS variables change
  dc.useEffect(() => {
    const disconnect = setupStyleSettingsObserver(
      () => setStyleRevision((r) => r + 1),
      reapplyAmbientColors,
    );
    return disconnect;
  }, []);

  // Validate and fallback query
  const validatedQuery = dc.useMemo(() => {
    const q = appliedQuery.trim();
    if (!q || q.length === 0) {
      setQueryError(null);
      return "@page"; // Default: show all pages
    }
    setQueryError(null);
    return ensurePageSelector(q);
  }, [appliedQuery]);

  // Style Settings revision - triggers re-render when CSS variables change
  const [_styleRevision, setStyleRevision] = dc.useState(0);

  // Computed key for property settings - triggers gradient re-init when properties change
  const propertySettingsKey = [settings.omitFirstLine].join("|");

  // Ref to always capture latest validatedQuery for debounced callbacks
  const validatedQueryRef = dc.useRef(validatedQuery);
  validatedQueryRef.current = validatedQuery;

  // Execute query with debounced updates
  // Use dc.query() (sync, non-reactive) instead of dc.useQuery() to control render timing
  dc.useEffect(() => {
    const runQuery = () => {
      try {
        // Use ref to always get latest query (avoids stale closure in debounce)
        const query = validatedQueryRef.current;
        if (!query) return;
        const rawPages = dc.query(query) || [];
        const pagesKey =
          rawPages.length +
          ":" +
          rawPages
            .map((p) => p.$path)
            .sort()
            .join("|");
        if (pagesKey !== prevPagesKeyRef.current) {
          prevPagesKeyRef.current = pagesKey;
          setStablePages(rawPages);
        }
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Query error";
        setQueryError(errorMessage);
        setStablePages([]);
        prevPagesKeyRef.current = ""; // Reset for recovery
      }
    };

    // Run immediately on mount/query change
    runQuery();

    // Subscribe to index updates with debounce
    /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
    const core = (app as any).plugins?.plugins?.datacore?.api?.core;
    if (!core) {
      return () => {}; // Empty cleanup when core unavailable
    }

    let debounceTimeout: ReturnType<typeof setTimeout> | null = null;
    const updateRef = core.on("update", () => {
      if (debounceTimeout) clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(runQuery, 500);
    });
    return () => {
      if (debounceTimeout) clearTimeout(debounceTimeout);
      core.offref(updateRef);
    };
    /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
  }, [validatedQuery, app, dc]);

  const pages = stablePages;

  // Parse search terms
  const parsedSearchTerms = dc.useMemo(() => {
    if (!searchQuery?.trim()) return null;

    const terms = searchQuery.toLowerCase().trim().split(/\s+/);
    const positiveTerms = terms.filter((t) => !t.startsWith("-"));
    const negativeTerms = terms
      .filter((t) => t.startsWith("-"))
      .map((t) => t.slice(1));

    return {
      posTagTerms: positiveTerms.filter((t) => t.startsWith("#")),
      posNameTerms: positiveTerms.filter((t) => !t.startsWith("#")),
      negTagTerms: negativeTerms.filter((t) => t.startsWith("#")),
      negNameTerms: negativeTerms.filter((t) => !t.startsWith("#")),
    };
  }, [searchQuery]);

  // Apply sorting and filtering
  const { sorted, totalCount } = dc.useMemo(() => {
    const pagesArray = Array.isArray(pages) ? [...pages] : [];

    // Exclude current file
    let filtered = currentFilePath
      ? pagesArray.filter((p) => p.$path !== currentFilePath)
      : pagesArray;

    // Filter by search query
    if (parsedSearchTerms) {
      const { posTagTerms, posNameTerms, negTagTerms, negNameTerms } =
        parsedSearchTerms;

      filtered = filtered.filter((p) => {
        const fileName = (p.$name || "").toLowerCase();
        const fileTags = (p.$tags || []).map((t: string) => t.toLowerCase());

        const posNameMatch = posNameTerms.every((term) =>
          fileName.includes(term),
        );
        const posTagMatch = posTagTerms.every((term) =>
          fileTags.some((fileTag: string) => fileTag === term),
        );

        const negNameMatch = negNameTerms.some((term) =>
          fileName.includes(term),
        );
        const negTagMatch = negTagTerms.some((term) =>
          fileTags.some((fileTag: string) => fileTag === term),
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
          sorted = filtered.sort((a, b) =>
            (a.$name || "").localeCompare(b.$name || ""),
          );
          break;
        case "name-desc":
          sorted = filtered.sort((a, b) =>
            (b.$name || "").localeCompare(a.$name || ""),
          );
          break;
        case "mtime-asc":
          sorted = filtered.sort(
            (a, b) => (a.$mtime?.toMillis() || 0) - (b.$mtime?.toMillis() || 0),
          );
          break;
        case "mtime-desc":
          sorted = filtered.sort(
            (a, b) => (b.$mtime?.toMillis() || 0) - (a.$mtime?.toMillis() || 0),
          );
          break;
        case "ctime-asc":
          sorted = filtered.sort(
            (a, b) => (a.$ctime?.toMillis() || 0) - (b.$ctime?.toMillis() || 0),
          );
          break;
        case "ctime-desc":
          sorted = filtered.sort(
            (a, b) => (b.$ctime?.toMillis() || 0) - (a.$ctime?.toMillis() || 0),
          );
          break;
        default:
          sorted = filtered.sort(
            (a, b) => (b.$mtime?.toMillis() || 0) - (a.$mtime?.toMillis() || 0),
          );
      }
    }

    const totalCount = sorted.length;
    const limit = parseInt(resultLimit);
    if (limit > 0 && sorted.length > limit) {
      return { sorted: sorted.slice(0, limit), totalCount };
    }

    return { sorted, totalCount };
  }, [
    pages,
    sortMethod,
    parsedSearchTerms,
    isShuffled,
    shuffledOrder,
    resultLimit,
    currentFilePath,
  ]);

  // State to store file text previews and images
  const [textPreviews, setTextPreviews] = dc.useState<Record<string, string>>(
    {},
  );
  const [images, setImages] = dc.useState<Record<string, string | string[]>>(
    {},
  );
  const [hasImageAvailable, setHasImageAvailable] = dc.useState<
    Record<string, boolean>
  >({});

  // CardData cache - stores transformed card data by path:mtime key
  // Avoids re-transforming unchanged files on displayedCount changes
  const cardDataCache = dc.useRef<Map<string, CardData>>(new Map());

  // Track current content loading effect to prevent race conditions
  const currentContentLoadRef = dc.useRef<string | null>(null);

  // Clear cache when settings change (they affect card transformation)
  const prevSettingsRef = dc.useRef(settings);
  dc.useEffect(() => {
    // Compare relevant settings properties that affect card transformation
    const relevantSettings = JSON.stringify({
      titleProperty: settings.titleProperty,
      textPreviewProperty: settings.textPreviewProperty,
      imageProperty: settings.imageProperty,
      subtitleProperty: settings.subtitleProperty,
      urlProperty: settings.urlProperty,
      propertyLabels: settings.propertyLabels,
      imageFormat: settings.imageFormat,
      imagePosition: settings.imagePosition,
      imageFit: settings.imageFit,
      imageRatio: settings.imageRatio,
    });

    const prevSettings = JSON.stringify(prevSettingsRef.current);
    if (cardDataCache.current && prevSettings !== relevantSettings) {
      cardDataCache.current.clear();
      prevSettingsRef.current = {
        titleProperty: settings.titleProperty,
        textPreviewProperty: settings.textPreviewProperty,
        imageProperty: settings.imageProperty,
        subtitleProperty: settings.subtitleProperty,
        urlProperty: settings.urlProperty,
        propertyLabels: settings.propertyLabels,
        imageFormat: settings.imageFormat,
        imagePosition: settings.imagePosition,
        imageFit: settings.imageFit,
        imageRatio: settings.imageRatio,
      } as ResolvedSettings;
    }
  }, [settings]);

  // Transform sorted results to CardData with caching
  const allCards = dc.useMemo(() => {
    const cache = cardDataCache.current;
    return sorted.map((file) => {
      const path = file.$path || "";
      const mtime = file.$mtime?.toMillis?.() || 0;
      const ctime = file.$ctime?.toMillis?.() || 0;
      const cacheKey = `${path}:${mtime}:${ctime}`;

      // Check cache first
      const cached = cache?.get(cacheKey);
      if (cached) {
        // Return new object instead of mutating cached object
        return {
          ...cached,
          textPreview: textPreviews[path],
          imageUrl: images[path],
        };
      }

      // Transform and cache
      const cardData = datacoreResultToCardData(
        app,
        file,
        dc,
        settings,
        sortMethod,
        isShuffled,
        textPreviews[path],
        images[path],
      );
      cache?.set(cacheKey, cardData);
      return cardData;
    });
  }, [
    sorted,
    settings,
    sortMethod,
    isShuffled,
    textPreviews,
    images,
    hasImageAvailable,
    app,
    dc,
  ]);

  // Prune stale cache entries
  dc.useEffect(() => {
    const cache = cardDataCache.current;
    if (!cache) return;
    const currentKeys = new Set(
      sorted.map((f) => {
        const mtime = f.$mtime?.toMillis?.() || 0;
        const ctime = f.$ctime?.toMillis?.() || 0;
        return `${f.$path}:${mtime}:${ctime}`;
      }),
    );
    for (const key of cache.keys()) {
      if (!currentKeys.has(key)) cache.delete(key);
    }
  }, [sorted]);

  // Load file contents asynchronously (only for displayed items)
  dc.useEffect(() => {
    // Skip text loading if both text preview sources are off
    // (images always load since there's always a format)

    const effectId = Math.random().toString(36).slice(2);
    currentContentLoadRef.current = effectId;

    const loadTextPreviews = async () => {
      const newTextPreviews: Record<string, string> = {};
      const newImages: Record<string, string | string[]> = {};
      const newHasImageAvailable: Record<string, boolean> = {};

      // Get current result paths for cache preservation
      const currentPaths = new Set(
        sorted.slice(0, displayedCount).map((p) => p.$path),
      );

      // Prepare entries for text preview loading
      if (settings.textPreviewProperty || settings.fallbackToContent) {
        // Copy existing cached entries that are still in results
        for (const path of currentPaths) {
          const cached = textPreviews[path];
          if (cached !== undefined) {
            newTextPreviews[path] = cached;
          }
        }

        const textPreviewEntries = sorted
          .slice(0, displayedCount)
          .filter((p) => !(p.$path in newTextPreviews)) // Skip already cached
          .map((p) => {
            try {
              const file = app.vault.getAbstractFileByPath(p.$path);
              if (!(file instanceof TFile)) {
                newTextPreviews[p.$path] = "(File not found)";
                return null;
              }

              // Resolve text preview property - check timestamps first
              let textPreviewValue: string | null = null;
              if (settings.textPreviewProperty) {
                const ctime = p.$ctime?.toMillis?.() || 0;
                const mtime = p.$mtime?.toMillis?.() || 0;
                const textPreviewProps = settings.textPreviewProperty
                  .split(",")
                  .map((prop) => prop.trim());
                for (const prop of textPreviewProps) {
                  // Try timestamp property first
                  const timestamp = resolveTimestampProperty(
                    prop,
                    ctime,
                    mtime,
                  );
                  if (timestamp) {
                    textPreviewValue = timestamp;
                    break;
                  }
                  // Try regular property
                  const textPreviewPropValue = getFirstDatacorePropertyValue(
                    p,
                    prop,
                  );
                  if (
                    typeof textPreviewPropValue === "string" ||
                    typeof textPreviewPropValue === "number"
                  ) {
                    textPreviewValue = String(textPreviewPropValue);
                    break;
                  }
                }
              }

              // Get title for first line comparison
              let titleValue: unknown = p.value(settings.titleProperty);
              if (Array.isArray(titleValue))
                titleValue = titleValue[0] as unknown;
              const titleString = titleValue
                ? dc.coerce.string(titleValue)
                : undefined;

              return {
                path: p.$path,
                file,
                textPreviewData: textPreviewValue as unknown,
                fileName: p.$name,
                titleString,
              };
            } catch (e: unknown) {
              console.error(
                "Error reading file:",
                p.$path,
                e instanceof Error ? e.message : e,
              );
              newTextPreviews[p.$path] = "(Error reading file)";
              return null;
            }
          })
          .filter((e): e is NonNullable<typeof e> => e !== null);

        await loadTextPreviewsForEntries(
          textPreviewEntries,
          settings.fallbackToContent,
          settings.omitFirstLine,
          app,
          newTextPreviews,
        );
      }

      // Skip image loading if effect became stale during text preview loading
      if (currentContentLoadRef.current !== effectId) {
        return;
      }

      // Prepare entries for image loading
      {
        // Copy existing cached entries that are still in results
        for (const path of currentPaths) {
          const cachedImage = images[path];
          if (cachedImage !== undefined) {
            newImages[path] = cachedImage;
          }
          const cachedHasImage = hasImageAvailable[path];
          if (cachedHasImage !== undefined) {
            newHasImageAvailable[path] = cachedHasImage;
          }
        }

        const imageEntries = sorted
          .slice(0, displayedCount)
          .filter((p) => !(p.$path in newHasImageAvailable)) // Skip already checked
          .map((p) => {
            try {
              const file = app.vault.getAbstractFileByPath(p.$path);
              if (!(file instanceof TFile)) return null;

              const imagePropertyValues = getAllDatacoreImagePropertyValues(
                p,
                settings.imageProperty,
              );
              return {
                path: p.$path,
                file,
                imagePropertyValues: imagePropertyValues as unknown[],
              };
            } catch (e: unknown) {
              console.error(
                "Error reading file:",
                p.$path,
                e instanceof Error ? e.message : e,
              );
              newHasImageAvailable[p.$path] = false; // Prevent retry loop
              return null;
            }
          })
          .filter((e): e is NonNullable<typeof e> => e !== null);

        const pluginSettings = persistenceManager.getPluginSettings();
        await loadImagesForEntries(
          imageEntries,
          settings.fallbackToEmbeds,
          app,
          newImages,
          newHasImageAvailable,
          {
            includeYoutube: pluginSettings.showYoutubeThumbnails,
            includeCardLink: pluginSettings.showCardLinkCovers,
          },
        );
      }

      // Skip state update if a newer effect has started (prevents race condition)
      if (currentContentLoadRef.current !== effectId) {
        return;
      }

      setTextPreviews(newTextPreviews);
      setImages(newImages);
      setHasImageAvailable(newHasImageAvailable);
    };

    void loadTextPreviews();
  }, [
    sorted,
    displayedCount,
    settings.imageFormat,
    settings.imagePosition,
    settings.textPreviewProperty,
    settings.titleProperty,
    settings.imageProperty,
    settings.fallbackToContent,
    settings.omitFirstLine,
    settings.fallbackToEmbeds,
    app,
    dc,
  ]);

  // Masonry layout - Direct DOM manipulation (no React re-renders on shuffle)
  dc.useEffect(() => {
    // Clean up masonry styles if not in masonry mode
    if (viewMode !== "masonry") {
      const container = containerRef.current;
      if (container) {
        const cards = container.querySelectorAll<HTMLElement>(".card");
        cards.forEach((card) => {
          card.classList.remove("masonry-positioned");
          card.style.removeProperty("--masonry-width");
          card.style.removeProperty("--masonry-left");
          card.style.removeProperty("--masonry-top");
        });
        container.classList.remove("masonry-container");
        container.style.removeProperty("--masonry-height");
      }
      updateLayoutRef.current = null;
      // Clear incremental cache when leaving masonry mode
      lastLayoutResultRef.current = null;
      prevMasonryCountRef.current = 0;
      return;
    }

    // Clear incremental cache only when layout params changed (not displayedCount)
    const cardSizeChanged = settings.cardSize !== prevCardSizeRef.current;
    const styleRevisionChanged =
      _styleRevision !== prevStyleRevisionRef.current;
    if (cardSizeChanged || styleRevisionChanged) {
      lastLayoutResultRef.current = null;
      prevMasonryCountRef.current = 0;
      prevCardSizeRef.current = settings.cardSize;
      prevStyleRevisionRef.current = _styleRevision;
    }

    // Setup masonry layout function using shared logic
    let isUpdatingLayout = false;
    let pendingLayoutUpdate = false;
    const updateLayout = () => {
      const container = containerRef.current;
      if (!container?.isConnected) return;
      // Guard against reentrant calls - queue update if one is in progress
      if (isUpdatingLayout) {
        pendingLayoutUpdate = true;
        return;
      }
      isUpdatingLayout = true;

      try {
        const cards = Array.from(
          container.querySelectorAll<HTMLElement>(".card"),
        );
        if (cards.length === 0) return;

        // Use getBoundingClientRect for actual rendered width (clientWidth rounds fractional pixels)
        const containerWidth = Math.floor(
          container.getBoundingClientRect().width,
        );
        if (containerWidth < 100) return;

        const cardSize = settings.cardSize;
        const minColumns = settings.minimumColumns;
        const gap = getCardSpacing();

        // Set CSS variables (same for both incremental and full paths)
        container.style.setProperty(
          "--dynamic-views-text-preview-lines",
          String(settings.textPreviewLines),
        );
        container.style.setProperty(
          "--dynamic-views-thumbnail-size",
          THUMBNAIL_SIZE_MAP[settings.thumbnailSize] ?? "80px",
        );

        const lastResult = lastLayoutResultRef.current;
        const prevCount = prevMasonryCountRef.current ?? 0;

        // Incremental path: new cards added, same container width
        if (
          lastResult &&
          cards.length > prevCount &&
          containerWidth === lastResult.containerWidth
        ) {
          const newCards = cards.slice(prevCount);

          // Pre-set width on new cards before measuring
          newCards.forEach((card) =>
            card.style.setProperty(
              "--masonry-width",
              `${lastResult.cardWidth}px`,
            ),
          );

          const result = calculateIncrementalMasonryLayout({
            newCards,
            columnHeights: lastResult.columnHeights,
            containerWidth: lastResult.containerWidth,
            cardWidth: lastResult.cardWidth,
            columns: lastResult.columns,
            gap,
          });

          // Apply to new cards only
          applyMasonryLayout(container, newCards, result);

          // Update container height (applyMasonryLayout sets it, but we update it explicitly)
          container.style.setProperty(
            "--masonry-height",
            `${result.containerHeight}px`,
          );

          lastLayoutResultRef.current = result;
          prevMasonryCountRef.current = cards.length;
          columnCountRef.current = result.columns;
          lastLayoutWidthRef.current = containerWidth;
          return;
        }

        // Full recalculation
        const result = calculateMasonryLayout({
          cards,
          containerWidth,
          cardSize,
          minColumns,
          gap,
        });

        applyMasonryLayout(container, cards, result);

        // Store for incremental updates
        lastLayoutResultRef.current = result;
        prevMasonryCountRef.current = cards.length;
        columnCountRef.current = result.columns;
        lastLayoutWidthRef.current = containerWidth;
      } finally {
        isUpdatingLayout = false;
        // Process any queued update
        if (pendingLayoutUpdate) {
          pendingLayoutUpdate = false;
          requestAnimationFrame(updateLayout);
        }
      }
    };

    // Store update function for external calls (shuffle, image load)
    updateLayoutRef.current = updateLayout;

    // Initial layout
    updateLayout();

    // Initialize gradients after layout sets card widths (double-RAF for CSS property paint)
    const container = containerRef.current;
    if (container) {
      requestAnimationFrame(() => {
        if (!container.isConnected) return;
        requestAnimationFrame(() => {
          if (!container.isConnected) return;
          // Sync responsive classes (same pattern as Bases)
          syncResponsiveClasses(
            Array.from(container.querySelectorAll<HTMLElement>(".card")),
          );
          initializeScrollGradients(container);
          initializeTitleTruncation(container);
        });
      });
    }

    // Throttled resize handler (double-RAF)
    // ResizeObserver handles both pane and window resize (container resizes in both cases)
    let resizeRafId: number | null = null;
    let trailingRafId: number | null = null;
    let staleWidthRafId: number | null = null;
    let resizeThrottleTimeout: ReturnType<typeof setTimeout> | null = null;
    const throttledResize = (entries: ResizeObserverEntry[]) => {
      if (entries.length === 0) return;
      const entry = entries[0];
      // Use Math.floor for consistency with getBoundingClientRect measurements
      const newWidth = Math.floor(entry.contentRect.width);

      // Skip if width unchanged
      if (newWidth === lastLayoutWidthRef.current) return;

      // Throttle: only process if not in cooldown
      if (resizeThrottleTimeout === null) {
        if (resizeRafId !== null) {
          cancelAnimationFrame(resizeRafId);
        }
        resizeRafId = requestAnimationFrame(() => {
          const innerRafId = requestAnimationFrame(() => {
            resizeRafId = null;
            if (!containerRef.current?.isConnected) return;
            updateLayout();

            // Check if width changed during async execution (stale width detection)
            const currentWidth = containerRef.current
              ? Math.floor(containerRef.current.getBoundingClientRect().width)
              : 0;
            if (
              currentWidth > 0 &&
              currentWidth !== lastLayoutWidthRef.current
            ) {
              if (staleWidthRafId !== null)
                cancelAnimationFrame(staleWidthRafId);
              staleWidthRafId = requestAnimationFrame(() => {
                staleWidthRafId = null;
                updateLayout();
              });
            }
          });
          resizeRafId = innerRafId; // Track inner RAF for cancellation
        });
        resizeThrottleTimeout = setTimeout(() => {
          resizeThrottleTimeout = null;
          // Trailing edge: check if width changed during throttle cooldown
          if (!containerRef.current?.isConnected) return;
          const trailingWidth = Math.floor(
            containerRef.current.getBoundingClientRect().width,
          );
          if (
            trailingWidth > 0 &&
            trailingWidth !== lastLayoutWidthRef.current
          ) {
            if (trailingRafId !== null) {
              cancelAnimationFrame(trailingRafId);
            }
            trailingRafId = requestAnimationFrame(() => {
              const innerTrailingRafId = requestAnimationFrame(() => {
                trailingRafId = null;
                if (!containerRef.current?.isConnected) return;
                updateLayout();
              });
              trailingRafId = innerTrailingRafId; // Track inner RAF
            });
          }
        }, RESIZE_THROTTLE_MS);
      }
    };

    const resizeObserver = new ResizeObserver(throttledResize);
    resizeObserver.observe(containerRef.current!);

    return () => {
      if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
      if (trailingRafId !== null) cancelAnimationFrame(trailingRafId);
      if (staleWidthRafId !== null) cancelAnimationFrame(staleWidthRafId);
      if (resizeThrottleTimeout !== null) clearTimeout(resizeThrottleTimeout);
      resizeObserver.disconnect();
    };
  }, [
    viewMode,
    settings.cardSize,
    settings.minimumColumns,
    settings.textPreviewLines,
    settings.thumbnailSize,
    _styleRevision,
    sorted.length,
    propertySettingsKey,
    dc,
  ]);

  // Apply dynamic grid layout (all width modes)
  dc.useEffect(() => {
    if (viewMode !== "card") return;

    const container = containerRef.current;
    if (!container) return;

    const updateGrid = () => {
      if (!container.isConnected) return;
      // Use getBoundingClientRect for actual rendered width (clientWidth rounds fractional pixels)
      const containerWidth = Math.floor(
        container.getBoundingClientRect().width,
      );
      // Skip if container is hidden or collapsed
      if (containerWidth < 100) return;
      // Card size represents minimum width; actual width may be larger to fill space
      const cardSize = settings.cardSize;
      const minColumns = settings.minimumColumns;
      const gap = getCardSpacing();
      const cols = Math.max(
        minColumns,
        Math.floor((containerWidth + gap) / (cardSize + gap)),
      );

      container.style.setProperty("--grid-columns", String(cols));
      // Set CSS variable for image aspect ratio
      container.style.setProperty(
        "--dynamic-views-image-aspect-ratio",
        String(settings.imageRatio),
      );
      // Set CSS variable for text preview line count
      container.style.setProperty(
        "--dynamic-views-text-preview-lines",
        String(settings.textPreviewLines),
      );
      // Set CSS variable for thumbnail size
      container.style.setProperty(
        "--dynamic-views-thumbnail-size",
        THUMBNAIL_SIZE_MAP[settings.thumbnailSize] ?? "80px",
      );
    };

    updateGrid();

    // Debounced resize handler (double-RAF)
    let resizeRafId: number | null = null;
    const debouncedResize = () => {
      if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
      resizeRafId = requestAnimationFrame(() => {
        resizeRafId = requestAnimationFrame(() => {
          resizeRafId = null; // Clear after use
          updateGrid();
        });
      });
    };

    const resizeObserver = new ResizeObserver(debouncedResize);
    resizeObserver.observe(container);

    return () => {
      if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
      resizeObserver.disconnect();
    };
  }, [
    viewMode,
    settings.cardSize,
    settings.minimumColumns,
    settings.textPreviewLines,
    settings.thumbnailSize,
    _styleRevision,
    dc,
  ]);

  // Initialize scroll gradients and title truncation after cards render
  // Uses double-RAF to ensure layout calculations complete first
  // Note: masonry mode handles this inside its layout useEffect
  dc.useEffect(() => {
    // Skip for list (no cards) and masonry (handled in layout effect)
    if (viewMode !== "card") return;

    const container = containerRef.current;
    if (!container) return;

    let rafId: number | null = null;
    let rafId2: number | null = null;

    // Double-RAF: wait for layout useEffects to complete
    rafId = requestAnimationFrame(() => {
      rafId2 = requestAnimationFrame(() => {
        if (!container.isConnected) return;

        // Sync responsive classes before gradient init (ResizeObservers are async)
        syncResponsiveClasses(
          Array.from(container.querySelectorAll<HTMLElement>(".card")),
        );

        initializeScrollGradients(container);
        initializeTitleTruncation(container);
      });
    });

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (rafId2 !== null) cancelAnimationFrame(rafId2);
    };
  }, [
    viewMode,
    displayedCount,
    settings.cardSize,
    _styleRevision,
    propertySettingsKey,
    dc,
  ]);

  // Sync refs for callback access in infinite scroll
  dc.useEffect(() => {
    displayedCountRef.current = displayedCount;
  }, [displayedCount, dc]);

  dc.useEffect(() => {
    sortedLengthRef.current = sorted.length;
  }, [sorted.length, dc]);

  // Apply results container styles
  dc.useEffect(() => {
    const resultsContainer = resultsContainerRef.current;
    if (!resultsContainer) return;

    if (settings.queryHeight > 0) {
      resultsContainer.style.setProperty(
        "max-height",
        `${settings.queryHeight}px`,
      );
      resultsContainer.style.setProperty("overflow-y", "auto");
    } else {
      resultsContainer.style.removeProperty("max-height");
      resultsContainer.style.removeProperty("overflow-y");
    }
  }, [settings.queryHeight]);

  // Track scroll position for toolbar shadow and fade effect
  dc.useEffect(() => {
    const container = resultsContainerRef.current;
    if (!container || settings.queryHeight === 0) {
      setIsResultsScrolled(false);
      setIsScrolledToBottom(true);
      return;
    }

    const handleScroll = () => {
      setIsResultsScrolled(container.scrollTop > 10);
      const isAtBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight <
        1;
      setIsScrolledToBottom(isAtBottom);
    };

    // Delay initial check to ensure DOM is painted (especially for ListView)
    // Attach listener inside RAF so initial check completes before scroll events fire
    const rafId = requestAnimationFrame(() => {
      handleScroll();
      container.addEventListener("scroll", handleScroll);
    });
    return () => {
      cancelAnimationFrame(rafId);
      container.removeEventListener("scroll", handleScroll);
    };
  }, [settings.queryHeight, viewMode]);

  // Infinite scroll: ResizeObserver + scroll + window resize
  dc.useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    // PANE_MULTIPLIER imported from shared/constants

    // Find the element that actually scrolls
    let scrollableElement: HTMLElement | null = null;

    // When queryHeight > 0, resultsContainer is the scrollable element
    if (settings.queryHeight > 0 && resultsContainerRef.current) {
      scrollableElement = resultsContainerRef.current;
    } else {
      // Walk up DOM to find scrollable ancestor
      let element: HTMLElement | null = containerRef.current;
      while (element && !scrollableElement) {
        const style = window.getComputedStyle(element);
        const overflowY = style.overflowY;
        const hasOverflow = overflowY === "auto" || overflowY === "scroll";

        if (hasOverflow && element.scrollHeight > element.clientHeight) {
          scrollableElement = element;
        }
        element = element.parentElement;
      }
    }

    if (!scrollableElement) {
      return;
    }

    // Core batch loading function
    const loadMoreItems = () => {
      // Guard: already loading or no container
      if (isLoadingRef.current) {
        return false;
      }
      if (!containerRef.current) {
        return false;
      }

      // Get current count from ref (captures latest value)
      const currentCount = displayedCountRef.current!;
      const totalLength = sortedLengthRef.current;
      if (totalLength !== null && currentCount >= totalLength) {
        // All items fit - set flag so end indicator shows
        hasBatchAppendedRef.current = true;
        return false; // All items loaded
      }

      // Calculate distance from bottom
      const scrollTop = scrollableElement.scrollTop;
      const clientHeight = scrollableElement.clientHeight;
      const scrollHeight = scrollableElement.scrollHeight;
      const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);

      // Calculate threshold
      const threshold = clientHeight * PANE_MULTIPLIER;

      // Check if we should load
      if (distanceFromBottom > threshold) {
        return false;
      }

      // Load batch
      isLoadingRef.current = true;

      const currentCols = columnCountRef.current || 2;
      const batchSize = Math.min(currentCols * ROWS_PER_COLUMN, MAX_BATCH_SIZE);
      const newCount = Math.min(currentCount + batchSize, totalLength!);

      displayedCountRef.current = newCount;
      setDisplayedCount(newCount);
      hasBatchAppendedRef.current = true;

      return true; // Batch loaded
    };

    // Setup ResizeObserver (watches masonry container)
    const resizeObserver = new ResizeObserver(() => {
      // Only clear loading flag - don't trigger auto-loading to prevent cascade
      isLoadingRef.current = false;
    });
    resizeObserver.observe(containerRef.current);

    // One-time initial check after layout settles (if viewport isn't filled)
    const initialCheckTimeout = setTimeout(() => {
      loadMoreItems();
    }, 300);

    // Setup window resize listener (handles viewport height changes)
    const handleWindowResize = () => {
      loadMoreItems();
    };
    window.addEventListener("resize", handleWindowResize);

    // Setup scroll listener with leading-edge throttle
    let scrollTimer: ReturnType<typeof setTimeout> | null = null;
    const handleScroll = () => {
      if (scrollTimer) {
        // Cooldown active, ignore
        return;
      }

      // Check immediately (leading edge)
      loadMoreItems();

      // Start cooldown with trailing call
      scrollTimer = setTimeout(() => {
        scrollTimer = null;
        loadMoreItems(); // Trailing call catches scroll position changes during throttle
      }, SCROLL_THROTTLE_MS);
    };
    scrollableElement.addEventListener("scroll", handleScroll, {
      passive: true,
    });

    // Cleanup
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleWindowResize);
      scrollableElement.removeEventListener("scroll", handleScroll);
      if (scrollTimer) clearTimeout(scrollTimer);
      clearTimeout(initialCheckTimeout);
    };
  }, [settings.queryHeight]); // Re-run when queryHeight changes (affects scrollable element)

  // Auto-reload: Watch for USER_QUERY prop changes (Datacore re-renders on code block edits)
  dc.useEffect(() => {
    const newCleanQuery = (USER_QUERY || "")
      .split("\n")
      .filter(
        (line) => !line.includes("QUERY START") && !line.includes("QUERY END"),
      )
      .join("\n")
      .trim();

    // Only update if query changed
    if (newCleanQuery !== appliedQuery) {
      setDraftQuery(newCleanQuery);
      setAppliedQuery(newCleanQuery);
    }
  }, [USER_QUERY]);

  // Handlers
  const handleToggleWidth = dc.useCallback(() => {
    let nextMode: WidthMode;
    if (widthMode === "normal") {
      nextMode = "wide";
    } else if (widthMode === "wide") {
      nextMode = canExpandToMax ? "max" : "normal";
    } else {
      nextMode = "normal";
    }
    setWidthMode(nextMode);
  }, [widthMode, canExpandToMax]);

  const handleToggleSettings = dc.useCallback(() => {
    setShowSettings((prev) => !prev);
    // Close all other dropdowns
    if (!showSettings) {
      setShowViewDropdown(false);
      setShowSortDropdown(false);
      setShowLimitDropdown(false);
      setShowQueryEditor(false);
    }
  }, [showSettings]);

  const handleToggleViewDropdown = dc.useCallback(() => {
    setShowViewDropdown(!showViewDropdown);
    // Close all other dropdowns
    if (!showViewDropdown) {
      setShowSortDropdown(false);
      setShowLimitDropdown(false);
      setShowQueryEditor(false);
      setShowSettings(false);
    }
  }, [showViewDropdown]);

  const handleToggleSortDropdown = dc.useCallback(() => {
    setShowSortDropdown(!showSortDropdown);
    // Close all other dropdowns
    if (!showSortDropdown) {
      setShowViewDropdown(false);
      setShowLimitDropdown(false);
      setShowQueryEditor(false);
      setShowSettings(false);
    }
  }, [showSortDropdown]);

  const handleToggleLimitDropdown = dc.useCallback(() => {
    setShowLimitDropdown(!showLimitDropdown);
    // Close all other dropdowns
    if (!showLimitDropdown) {
      setShowViewDropdown(false);
      setShowSortDropdown(false);
      setShowQueryEditor(false);
      setShowSettings(false);
    }
  }, [showLimitDropdown]);

  const handleSetViewMode = dc.useCallback((mode: ViewMode) => {
    setViewMode(mode);
    setShowViewDropdown(false);
    setIsShuffled(false);
    hasBatchAppendedRef.current = false;
  }, []);

  const handleSetSortMethod = dc.useCallback((method: string) => {
    setSortMethod(method);
    setShowSortDropdown(false);
    setIsShuffled(false);
    hasBatchAppendedRef.current = false;
  }, []);

  const handleSearchChange = dc.useCallback(
    (query: string) => {
      setSearchQuery(query);
      setDisplayedCount(app.isMobile ? BATCH_SIZE * 0.5 : BATCH_SIZE);
      hasBatchAppendedRef.current = false;
    },
    [app.isMobile],
  );

  const handleSearchFocus = dc.useCallback(() => {
    setShowViewDropdown(false);
    setShowSortDropdown(false);
    setShowLimitDropdown(false);
  }, []);

  const handleClearSearch = dc.useCallback(() => {
    setSearchQuery("");
    hasBatchAppendedRef.current = false;
  }, []);

  const handleShuffle = dc.useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    // For masonry: directly reorder DOM and reposition
    if (viewMode === "masonry") {
      const cards = Array.from(
        container.querySelectorAll<HTMLElement>(".card"),
      );

      // Shuffle array of DOM elements
      const shuffled = [...cards];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      // Reorder in DOM
      shuffled.forEach((card) => container.appendChild(card));

      // Trigger immediate layout update
      if (updateLayoutRef.current) {
        updateLayoutRef.current();
      }

      setShowSortDropdown(false);
      hasBatchAppendedRef.current = false;
      return;
    }

    // For other views: use React state to trigger re-render
    const paths = sorted.map((p) => p.$path);
    const shuffled = [...paths];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    setShuffledOrder(shuffled);
    setIsShuffled(true);
    setShowSortDropdown(false);
    hasBatchAppendedRef.current = false;
  }, [sorted, viewMode]);

  const handleOpenRandom = dc.useCallback(
    (event: MouseEvent) => {
      if (sorted.length === 0) return;
      const randomIndex = Math.floor(Math.random() * sorted.length);
      const randomPath = sorted[randomIndex].$path;
      const file = app.vault.getAbstractFileByPath(randomPath);
      if (file instanceof TFile) {
        const paneType = getPaneType(event, settings.openRandomInNewTab);
        void app.workspace.getLeaf(paneType).openFile(file);
      }
    },
    [sorted, app, settings.openRandomInNewTab],
  );

  const handleToggleCode = dc.useCallback(() => {
    setShowQueryEditor(!showQueryEditor);
    // Close all other dropdowns
    if (!showQueryEditor) {
      setShowViewDropdown(false);
      setShowSortDropdown(false);
      setShowLimitDropdown(false);
      setShowSettings(false);
    }
  }, [showQueryEditor]);

  const handleDraftQueryChange = dc.useCallback((query: string) => {
    setDraftQuery(query);
  }, []);

  const syncQueryToCodeBlock = dc.useCallback(
    async (queryToSave: string) => {
      if (isSyncing.current || !currentFile) return;
      isSyncing.current = true;

      try {
        // Read current content to check if query changed
        const currentContent = await app.vault.read(currentFile);
        const currentQueryMatch = findQueryInBlock(currentContent);
        const currentQuery = currentQueryMatch?.query || "";

        // Only update if query actually changed
        if (currentQuery !== queryToSave) {
          await app.vault.process(currentFile, (content) => {
            return updateQueryInBlock(content, queryToSave);
          });
        }
      } catch (error) {
        console.error("Failed to sync query to code block:", error);
      } finally {
        isSyncing.current = false;
      }
    },
    [currentFile, app],
  );

  const handleApplyQuery = dc.useCallback(() => {
    void (async () => {
      const processedQuery = ensurePageSelector(draftQuery.trim());
      setDraftQuery(processedQuery); // Update editor to show processed query
      setAppliedQuery(processedQuery);
      setShowQueryEditor(false);

      if (currentFile) {
        try {
          await syncQueryToCodeBlock(processedQuery);
        } catch (error) {
          console.error("Failed to sync query to code block:", error);
        }
      }
    })();
  }, [draftQuery, currentFile, syncQueryToCodeBlock]);

  const handleClearQuery = dc.useCallback(() => {
    void (async () => {
      setDraftQuery("");
      setAppliedQuery("");

      // Save empty query to code block
      if (currentFile) {
        try {
          await syncQueryToCodeBlock("");
        } catch (error) {
          console.error("Failed to sync cleared query to code block:", error);
        }
      }
    })();
  }, [currentFile, syncQueryToCodeBlock]);

  const handleResultLimitChange = dc.useCallback((limit: string) => {
    setResultLimit(limit);
    hasBatchAppendedRef.current = false;
  }, []);

  const handleResetLimit = dc.useCallback((): void => {
    setResultLimit("");
    setShowLimitDropdown(false);
    hasBatchAppendedRef.current = false;
  }, []);

  const handleCreateNote = dc.useCallback(
    (event: MouseEvent) => {
      void (async () => {
        const folderPath = currentFile?.parent?.path || "";
        const filePath = getAvailablePath(app, folderPath, "Untitled");
        const file = await app.vault.create(filePath, "");
        const newLeaf = Keymap.isModEvent(event);
        void app.workspace.getLeaf(newLeaf).openFile(file);
      })();
    },
    [app, currentFile],
  );

  const handleCardClick = dc.useCallback(
    (path: string, paneType: PaneType | boolean) => {
      const file = app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        if (settings.openFileAction === "card") {
          void app.workspace.getLeaf(paneType).openFile(file);
        } else if (settings.openFileAction === "title") {
          // Only open on title click (handled in CardView)
        }
      }
    },
    [app, settings.openFileAction],
  );

  const handleCopyToClipboard = dc.useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      const limit = parseInt(resultLimit);

      const links = sorted
        .slice(0, limit > 0 ? limit : sorted.length)
        .map((p) => `[[${p.$name}]]`)
        .join("\n");

      void navigator.clipboard.writeText(links);
      setShowLimitDropdown(false);
      new Notice("Copied to your clipboard");
    },
    [resultLimit, sorted],
  );

  const handleSettingsChange = dc.useCallback(
    (newSettings: Partial<ResolvedSettings>) => {
      setSettings((prev) => ({ ...prev, ...newSettings }));
    },
    [],
  );

  // Re-measure property fields when label mode changes
  dc.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Use double RAF to ensure DOM has updated after settings change
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        remeasurePropertyFields(container);
      });
    });
  }, [settings.propertyLabels, viewMode, settings.cardSize]);

  // Copy menu item for Toolbar

  const copyMenuItem: JSX.Element = dc.useMemo(
    (): JSX.Element => (
      <div
        className="bases-toolbar-menu-item"
        onClick={handleCopyToClipboard}
        onKeyDown={(e: unknown) => {
          const evt = e as KeyboardEvent;
          if (evt.key === "Enter" || evt.key === " ") {
            evt.preventDefault();
            handleCopyToClipboard(evt as unknown as MouseEvent);
          }
        }}
        tabIndex={0}
        role="menuitem"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="8" y="8" width="14" height="14" rx="2" ry="2" />
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
        </svg>
        <span>Copy to clipboard</span>
      </div>
    ),
    [handleCopyToClipboard],
  );

  // Render appropriate view component
  const renderView = (): JSX.Element => {
    // Slice allCards to displayedCount for rendering
    const cards = allCards.slice(0, Math.min(displayedCount, allCards.length));

    const commonProps = {
      cards,
      settings,
      sortMethod,
      isShuffled,
      focusableCardIndex,
      hoveredCardRef,
      containerRef,
      updateLayoutRef,
      app,
      onCardClick: handleCardClick,
      onFocusChange: setFocusableCardIndex,
    };

    if (viewMode === "list") {
      // ListView has different props - needs raw DatacoreFile for tag handlers
      return (
        <ListView
          results={sorted}
          displayedCount={displayedCount}
          settings={settings}
          containerRef={containerRef}
          app={app}
          dc={dc}
          onLinkClick={handleCardClick}
        />
      );
    } else if (viewMode === "masonry") {
      return <MasonryView {...commonProps} />;
    } else {
      return <CardView {...commonProps} viewMode="card" />;
    }
  };

  // Apply width mode class
  const widthClass =
    widthMode === "max"
      ? "max-width"
      : widthMode === "wide"
        ? "wide-width"
        : "";

  // Apply ambient background class
  const ambientClass =
    settings.ambientBackground === "subtle"
      ? "dynamic-views-ambient-bg-subtle"
      : settings.ambientBackground === "dramatic"
        ? "dynamic-views-adaptive-text"
        : "dynamic-views-ambient-bg-off";

  return (
    <div
      ref={explorerRef}
      className={`dynamic-views ${widthClass} ${ambientClass}`}
    >
      <div
        ref={toolbarRef}
        className={`controls-wrapper${isResultsScrolled ? " scrolled" : ""}`}
      >
        <Toolbar
          dc={dc}
          app={app}
          plugin={plugin}
          currentFile={currentFile}
          viewMode={viewMode}
          showViewDropdown={showViewDropdown}
          onToggleViewDropdown={handleToggleViewDropdown}
          onSetViewCard={() => handleSetViewMode("card")}
          onSetViewMasonry={() => handleSetViewMode("masonry")}
          onSetViewList={() => handleSetViewMode("list")}
          sortMethod={sortMethod}
          isShuffled={isShuffled}
          showSortDropdown={showSortDropdown}
          onToggleSortDropdown={handleToggleSortDropdown}
          onSetSortNameAsc={() => handleSetSortMethod("name-asc")}
          onSetSortNameDesc={() => handleSetSortMethod("name-desc")}
          onSetSortMtimeDesc={() => handleSetSortMethod("mtime-desc")}
          onSetSortMtimeAsc={() => handleSetSortMethod("mtime-asc")}
          onSetSortCtimeDesc={() => handleSetSortMethod("ctime-desc")}
          onSetSortCtimeAsc={() => handleSetSortMethod("ctime-asc")}
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
          isPinned={false}
          widthMode={widthMode}
          canExpandToMax={canExpandToMax}
          queryHeight={settings.queryHeight}
          onTogglePin={() => {}}
          onToggleWidth={handleToggleWidth}
          onToggleSettings={handleToggleSettings}
          showSettings={showSettings}
          onSettingsChange={handleSettingsChange}
        />
      </div>

      {queryError && <div className="query-error">{queryError}</div>}

      <div
        ref={resultsContainerRef}
        className={`results-container${settings.queryHeight > 0 && !isScrolledToBottom ? " with-fade" : ""}`}
      >
        {renderView()}
        {displayedCount >= sorted.length &&
          sorted.length > 0 &&
          hasBatchAppendedRef.current && (
            <div className="dynamic-views-end-indicator" />
          )}
      </div>

      <div ref={loadMoreRef} />
    </div>
  );
}
