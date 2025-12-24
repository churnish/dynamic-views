import { App, TFile, Plugin, Keymap } from "obsidian";
import type { PaneType } from "obsidian";
import {
  Settings,
  UIState,
  ViewMode,
  WidthMode,
  DefaultViewSettings,
} from "../types";
import { DEFAULT_SETTINGS } from "../constants";
import {
  BATCH_SIZE,
  PANE_MULTIPLIER,
  ROWS_PER_COLUMN,
  MAX_BATCH_SIZE,
  WIDE_MODE_MULTIPLIER,
  SCROLL_THROTTLE_MS,
} from "../shared/constants";
import { PersistenceManager } from "../persistence";
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
import { getCurrentFile, getFileCtime, getAvailablePath } from "../utils/file";
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
  getMinMasonryColumns,
  getMinGridColumns,
  getCardSpacing,
  setupStyleSettingsObserver,
} from "../utils/style-settings";
import { clearImageMetadataCache } from "../shared/image-loader";
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

// Extend App type to include isMobile property
declare module "obsidian" {
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

export function View({
  plugin,
  app,
  dc,
  USER_QUERY = "",
}: ViewProps): JSX.Element {
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

  // Helper: get persisted settings
  const getPersistedSettings = dc.useCallback((): Settings => {
    if (!ctime || !persistenceManager) return DEFAULT_SETTINGS;

    const globalSettings = persistenceManager.getGlobalSettings();
    const defaultViewSettings = persistenceManager.getDefaultViewSettings();
    const viewSettings = persistenceManager.getViewSettings(ctime);

    // Start with global settings as base
    const baseSettings = { ...globalSettings };

    // For view-specific properties, merge: defaultViewSettings -> viewSettings (persisted)
    baseSettings.titleProperty =
      viewSettings.titleProperty ?? defaultViewSettings.titleProperty;
    baseSettings.textPreviewProperty =
      viewSettings.textPreviewProperty ??
      defaultViewSettings.textPreviewProperty;
    baseSettings.imageProperty =
      viewSettings.imageProperty ?? defaultViewSettings.imageProperty;
    baseSettings.subtitleProperty =
      viewSettings.subtitleProperty ?? defaultViewSettings.subtitleProperty;
    baseSettings.urlProperty =
      viewSettings.urlProperty ?? defaultViewSettings.urlProperty;
    baseSettings.propertyDisplay1 =
      viewSettings.propertyDisplay1 ?? defaultViewSettings.propertyDisplay1;
    baseSettings.propertyDisplay2 =
      viewSettings.propertyDisplay2 ?? defaultViewSettings.propertyDisplay2;
    baseSettings.propertyDisplay3 =
      viewSettings.propertyDisplay3 ?? defaultViewSettings.propertyDisplay3;
    baseSettings.propertyDisplay4 =
      viewSettings.propertyDisplay4 ?? defaultViewSettings.propertyDisplay4;
    baseSettings.propertyDisplay5 =
      viewSettings.propertyDisplay5 ?? defaultViewSettings.propertyDisplay5;
    baseSettings.propertyDisplay6 =
      viewSettings.propertyDisplay6 ?? defaultViewSettings.propertyDisplay6;
    baseSettings.propertyDisplay7 =
      viewSettings.propertyDisplay7 ?? defaultViewSettings.propertyDisplay7;
    baseSettings.propertyDisplay8 =
      viewSettings.propertyDisplay8 ?? defaultViewSettings.propertyDisplay8;
    baseSettings.propertyDisplay9 =
      viewSettings.propertyDisplay9 ?? defaultViewSettings.propertyDisplay9;
    baseSettings.propertyDisplay10 =
      viewSettings.propertyDisplay10 ?? defaultViewSettings.propertyDisplay10;
    baseSettings.propertyDisplay11 =
      viewSettings.propertyDisplay11 ?? defaultViewSettings.propertyDisplay11;
    baseSettings.propertyDisplay12 =
      viewSettings.propertyDisplay12 ?? defaultViewSettings.propertyDisplay12;
    baseSettings.propertyDisplay13 =
      viewSettings.propertyDisplay13 ?? defaultViewSettings.propertyDisplay13;
    baseSettings.propertyDisplay14 =
      viewSettings.propertyDisplay14 ?? defaultViewSettings.propertyDisplay14;
    baseSettings.propertyGroup1SideBySide =
      viewSettings.propertyGroup1SideBySide ??
      defaultViewSettings.propertyGroup1SideBySide;
    baseSettings.propertyGroup2SideBySide =
      viewSettings.propertyGroup2SideBySide ??
      defaultViewSettings.propertyGroup2SideBySide;
    baseSettings.propertyGroup3SideBySide =
      viewSettings.propertyGroup3SideBySide ??
      defaultViewSettings.propertyGroup3SideBySide;
    baseSettings.propertyGroup4SideBySide =
      viewSettings.propertyGroup4SideBySide ??
      defaultViewSettings.propertyGroup4SideBySide;
    baseSettings.propertyGroup5SideBySide =
      viewSettings.propertyGroup5SideBySide ??
      defaultViewSettings.propertyGroup5SideBySide;
    baseSettings.propertyGroup6SideBySide =
      viewSettings.propertyGroup6SideBySide ??
      defaultViewSettings.propertyGroup6SideBySide;
    baseSettings.propertyGroup7SideBySide =
      viewSettings.propertyGroup7SideBySide ??
      defaultViewSettings.propertyGroup7SideBySide;
    baseSettings.propertyGroup1Position =
      viewSettings.propertyGroup1Position ??
      defaultViewSettings.propertyGroup1Position;
    baseSettings.propertyGroup2Position =
      viewSettings.propertyGroup2Position ??
      defaultViewSettings.propertyGroup2Position;
    baseSettings.propertyGroup3Position =
      viewSettings.propertyGroup3Position ??
      defaultViewSettings.propertyGroup3Position;
    baseSettings.propertyGroup4Position =
      viewSettings.propertyGroup4Position ??
      defaultViewSettings.propertyGroup4Position;
    baseSettings.propertyGroup5Position =
      viewSettings.propertyGroup5Position ??
      defaultViewSettings.propertyGroup5Position;
    baseSettings.propertyGroup6Position =
      viewSettings.propertyGroup6Position ??
      defaultViewSettings.propertyGroup6Position;
    baseSettings.propertyGroup7Position =
      viewSettings.propertyGroup7Position ??
      defaultViewSettings.propertyGroup7Position;
    baseSettings.propertyLabels =
      viewSettings.propertyLabels ?? defaultViewSettings.propertyLabels;
    baseSettings.showTitle =
      viewSettings.showTitle ?? defaultViewSettings.showTitle;
    baseSettings.showTextPreview =
      viewSettings.showTextPreview ?? defaultViewSettings.showTextPreview;
    baseSettings.fallbackToContent =
      viewSettings.fallbackToContent ?? defaultViewSettings.fallbackToContent;
    baseSettings.fallbackToEmbeds =
      viewSettings.fallbackToEmbeds ?? defaultViewSettings.fallbackToEmbeds;
    baseSettings.imageFormat =
      viewSettings.imageFormat ?? defaultViewSettings.imageFormat;
    baseSettings.imageFit =
      viewSettings.imageFit ?? defaultViewSettings.imageFit;
    baseSettings.imageAspectRatio =
      viewSettings.imageAspectRatio ?? defaultViewSettings.imageAspectRatio;
    baseSettings.queryHeight =
      viewSettings.queryHeight ?? defaultViewSettings.queryHeight;
    baseSettings.listMarker =
      viewSettings.listMarker ?? defaultViewSettings.listMarker;
    baseSettings.cardSize =
      viewSettings.cardSize ?? defaultViewSettings.cardSize;

    return baseSettings;
  }, [ctime, persistenceManager]);

  // Helper: get persisted UI state value
  const getFilePersistedValue = dc.useCallback(
    <K extends keyof UIState>(key: K, defaultValue: UIState[K]): UIState[K] => {
      if (!ctime || !persistenceManager) return defaultValue;
      const state = persistenceManager.getUIState(ctime);
      return state[key] ?? defaultValue;
    },
    [ctime, persistenceManager],
  );

  // Initialize state
  const [sortMethod, setSortMethod] = dc.useState(
    getFilePersistedValue("sortMethod", "mtime-desc"),
  );
  const [searchQuery, setSearchQuery] = dc.useState(
    getFilePersistedValue("searchQuery", ""),
  );
  const [viewMode, setViewMode] = dc.useState(
    getFilePersistedValue("viewMode", "card") as ViewMode,
  );
  const [widthMode, setWidthMode] = dc.useState(
    getFilePersistedValue("widthMode", "normal") as WidthMode,
  );
  const [resultLimit, setResultLimit] = dc.useState(
    getFilePersistedValue("resultLimit", ""),
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
    if (!ctime || !persistenceManager) return;

    const handleLayoutChange = () => {
      const state = persistenceManager.getUIState(ctime);
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
  }, [ctime, persistenceManager, app.workspace]);

  // Persist UI state changes (only if different from persisted value to avoid overwriting on mount)
  dc.useEffect(() => {
    if (ctime && persistenceManager) {
      const persisted = persistenceManager.getUIState(ctime);
      if (persisted.sortMethod !== sortMethod) {
        void persistenceManager.setUIState(ctime, { sortMethod });
      }
    }
  }, [sortMethod, ctime, persistenceManager]);

  dc.useEffect(() => {
    if (ctime && persistenceManager) {
      const persisted = persistenceManager.getUIState(ctime);
      if (persisted.viewMode !== viewMode) {
        void persistenceManager.setUIState(ctime, { viewMode });
      }
    }
  }, [viewMode, ctime, persistenceManager]);

  dc.useEffect(() => {
    if (ctime && persistenceManager) {
      const persisted = persistenceManager.getUIState(ctime);
      if (persisted.widthMode !== widthMode) {
        void persistenceManager.setUIState(ctime, { widthMode });
      }
    }
  }, [widthMode, ctime, persistenceManager]);

  // Apply width mode class to section on mount and when widthMode changes
  dc.useEffect(() => {
    if (!explorerRef.current) return;

    const section = explorerRef.current.closest(
      ".markdown-source-view, .markdown-preview-view, .markdown-reading-view",
    );
    if (!section) return;

    // Remove existing width classes
    section.classList.remove("datacore-wide", "datacore-max");

    // Apply new class based on widthMode
    if (widthMode === "wide") {
      section.classList.add("datacore-wide");
    } else if (widthMode === "max") {
      section.classList.add("datacore-max");
    }

    // Cleanup on unmount or mode change
    return () => {
      section.classList.remove("datacore-wide", "datacore-max");
    };
  }, [widthMode]);

  // Live Preview: constrain expanded width to pane when pane is narrower than expanded width
  dc.useEffect(() => {
    if (widthMode === "normal" || !explorerRef.current) return;

    const section = explorerRef.current.closest(".markdown-source-view");
    if (!section) return; // Only applies to Live Preview

    const codeBlock = section.querySelector<HTMLElement>(
      ".cm-preview-code-block:has(.block-language-datacorejsx)",
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

      // Max mode: always fill pane (minus margins)
      // Wide mode: use WIDE_MODE_MULTIPLIER x line width, constrain if pane is narrower
      if (widthMode === "max") {
        // Max = fill pane width with margins
        const constrainedWidth = sectionRect.width - fileMargins * 2;
        const offsetLeft = sectionRect.left - contentRect.left + fileMargins;
        codeBlock.style.setProperty(
          "width",
          `${constrainedWidth}px`,
          "important",
        );
        codeBlock.style.setProperty(
          "max-width",
          `${constrainedWidth}px`,
          "important",
        );
        codeBlock.style.setProperty(
          "transform",
          `translateX(${offsetLeft}px)`,
          "important",
        );
        return;
      }

      // Wide mode: target is WIDE_MODE_MULTIPLIER x line width
      const targetWidth = WIDE_MODE_MULTIPLIER * fileLineWidth;

      // Available space is pane width minus margins on both sides
      const availableWidth = sectionRect.width - fileMargins * 2;

      // Update whether we can expand to max (has room to grow beyond wide)
      setCanExpandToMax(availableWidth > targetWidth);

      // Check if currently constrained (has inline width set)
      const isConstrained = codeBlock.style.width !== "";

      // Constrain when available space < target width
      // When constrained, require 40px more available space to expand back (hysteresis)
      const buffer = isConstrained ? 40 : 0;

      // Check if available space is less than target + buffer
      if (availableWidth < targetWidth + buffer) {
        // Constrain to pane width with margins
        const constrainedWidth = sectionRect.width - fileMargins * 2;
        const offsetLeft = sectionRect.left - contentRect.left + fileMargins;
        codeBlock.style.setProperty(
          "width",
          `${constrainedWidth}px`,
          "important",
        );
        codeBlock.style.setProperty(
          "max-width",
          `${constrainedWidth}px`,
          "important",
        );
        codeBlock.style.setProperty(
          "transform",
          `translateX(${offsetLeft}px)`,
          "important",
        );
      } else {
        // Remove inline overrides, let CSS handle it
        codeBlock.style.removeProperty("width");
        codeBlock.style.removeProperty("max-width");
        codeBlock.style.removeProperty("transform");
      }
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

  // Track canExpandToMax for Reading View (Live Preview is handled above)
  dc.useEffect(() => {
    if (!explorerRef.current) return;

    // Skip if in Live Preview (handled by the effect above)
    if (explorerRef.current.closest(".markdown-source-view")) return;

    const section = explorerRef.current.closest(
      ".markdown-preview-view, .markdown-reading-view",
    );
    if (!section) return;

    const checkCanExpand = () => {
      const cs = getComputedStyle(section);
      const fileLineWidth =
        parseFloat(cs.getPropertyValue("--file-line-width")) || 700;
      const fileMargins =
        parseFloat(cs.getPropertyValue("--file-margins")) || 16;
      const targetWidth = WIDE_MODE_MULTIPLIER * fileLineWidth;
      const availableWidth =
        section.getBoundingClientRect().width - fileMargins * 2;
      setCanExpandToMax(availableWidth > targetWidth);
    };

    checkCanExpand();

    const resizeObserver = new ResizeObserver(checkCanExpand);
    resizeObserver.observe(section);

    return () => resizeObserver.disconnect();
  }, [widthMode]);

  dc.useEffect(() => {
    if (ctime && persistenceManager) {
      const persisted = persistenceManager.getUIState(ctime);
      if (persisted.searchQuery !== searchQuery) {
        void persistenceManager.setUIState(ctime, { searchQuery });
      }
    }
  }, [searchQuery, ctime, persistenceManager]);

  dc.useEffect(() => {
    if (ctime && persistenceManager) {
      const persisted = persistenceManager.getUIState(ctime);
      if (persisted.resultLimit !== resultLimit) {
        void persistenceManager.setUIState(ctime, { resultLimit });
      }
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
          textPreviewProperty: settings.textPreviewProperty,
          imageProperty: settings.imageProperty,
          subtitleProperty: settings.subtitleProperty,
          urlProperty: settings.urlProperty,
          propertyDisplay1: settings.propertyDisplay1,
          propertyDisplay2: settings.propertyDisplay2,
          propertyDisplay3: settings.propertyDisplay3,
          propertyDisplay4: settings.propertyDisplay4,
          propertyDisplay5: settings.propertyDisplay5,
          propertyDisplay6: settings.propertyDisplay6,
          propertyDisplay7: settings.propertyDisplay7,
          propertyDisplay8: settings.propertyDisplay8,
          propertyDisplay9: settings.propertyDisplay9,
          propertyDisplay10: settings.propertyDisplay10,
          propertyDisplay11: settings.propertyDisplay11,
          propertyDisplay12: settings.propertyDisplay12,
          propertyDisplay13: settings.propertyDisplay13,
          propertyDisplay14: settings.propertyDisplay14,
          propertyGroup1SideBySide: settings.propertyGroup1SideBySide,
          propertyGroup2SideBySide: settings.propertyGroup2SideBySide,
          propertyGroup3SideBySide: settings.propertyGroup3SideBySide,
          propertyGroup4SideBySide: settings.propertyGroup4SideBySide,
          propertyGroup5SideBySide: settings.propertyGroup5SideBySide,
          propertyGroup6SideBySide: settings.propertyGroup6SideBySide,
          propertyGroup7SideBySide: settings.propertyGroup7SideBySide,
          propertyGroup1Position: settings.propertyGroup1Position,
          propertyGroup2Position: settings.propertyGroup2Position,
          propertyGroup3Position: settings.propertyGroup3Position,
          propertyGroup4Position: settings.propertyGroup4Position,
          propertyGroup5Position: settings.propertyGroup5Position,
          propertyGroup6Position: settings.propertyGroup6Position,
          propertyGroup7Position: settings.propertyGroup7Position,
          propertyLabels: settings.propertyLabels,
          showTitle: settings.showTitle,
          showTextPreview: settings.showTextPreview,
          fallbackToContent: settings.fallbackToContent,
          fallbackToEmbeds: settings.fallbackToEmbeds,
          imageFormat: settings.imageFormat,
          imageFit: settings.imageFit,
          imageAspectRatio: settings.imageAspectRatio,
          queryHeight: settings.queryHeight,
          listMarker: settings.listMarker,
          cardSize: settings.cardSize,
        };
        void persistenceManager.setViewSettings(ctime, viewSettings);
      }
    }, 300);
  }, [settings, ctime, persistenceManager]);

  // Setup swipe interception on mobile if enabled (Datacore is always embedded)
  // Note: preventSidebarSwipe intentionally omitted from deps - global settings require restart
  dc.useEffect(() => {
    const globalSettings = persistenceManager.getGlobalSettings();
    if (
      app.isMobile &&
      globalSettings.preventSidebarSwipe === "all-views" &&
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
      clearImageMetadataCache,
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
      debounceTimeout = setTimeout(runQuery, 150);
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
      propertyDisplay1: settings.propertyDisplay1,
      propertyDisplay2: settings.propertyDisplay2,
      propertyDisplay3: settings.propertyDisplay3,
      propertyDisplay4: settings.propertyDisplay4,
      propertyDisplay5: settings.propertyDisplay5,
      propertyDisplay6: settings.propertyDisplay6,
      propertyDisplay7: settings.propertyDisplay7,
      propertyDisplay8: settings.propertyDisplay8,
      propertyDisplay9: settings.propertyDisplay9,
      propertyDisplay10: settings.propertyDisplay10,
      propertyDisplay11: settings.propertyDisplay11,
      propertyDisplay12: settings.propertyDisplay12,
      propertyDisplay13: settings.propertyDisplay13,
      propertyDisplay14: settings.propertyDisplay14,
      propertyLabels: settings.propertyLabels,
      showTitle: settings.showTitle,
      showTextPreview: settings.showTextPreview,
      imageFormat: settings.imageFormat,
      imageFit: settings.imageFit,
      imageAspectRatio: settings.imageAspectRatio,
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
        propertyDisplay1: settings.propertyDisplay1,
        propertyDisplay2: settings.propertyDisplay2,
        propertyDisplay3: settings.propertyDisplay3,
        propertyDisplay4: settings.propertyDisplay4,
        propertyDisplay5: settings.propertyDisplay5,
        propertyDisplay6: settings.propertyDisplay6,
        propertyDisplay7: settings.propertyDisplay7,
        propertyDisplay8: settings.propertyDisplay8,
        propertyDisplay9: settings.propertyDisplay9,
        propertyDisplay10: settings.propertyDisplay10,
        propertyDisplay11: settings.propertyDisplay11,
        propertyDisplay12: settings.propertyDisplay12,
        propertyDisplay13: settings.propertyDisplay13,
        propertyDisplay14: settings.propertyDisplay14,
        propertyLabels: settings.propertyLabels,
        showTitle: settings.showTitle,
        showTextPreview: settings.showTextPreview,
        imageFormat: settings.imageFormat,
        imageFit: settings.imageFit,
        imageAspectRatio: settings.imageAspectRatio,
      } as Settings;
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
          hasImageAvailable: hasImageAvailable[path] || false,
        };
      }

      // Transform and cache
      const cardData = datacoreResultToCardData(
        file,
        dc,
        settings,
        sortMethod,
        isShuffled,
        textPreviews[path],
        images[path],
        hasImageAvailable[path],
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
    // Skip entirely if both previews and thumbnails are off
    if (!settings.showTextPreview && settings.imageFormat === "none") {
      setTextPreviews({});
      setImages({});
      setHasImageAvailable({});
      return;
    }

    const loadTextPreviews = async () => {
      const newTextPreviews: Record<string, string> = {};
      const newImages: Record<string, string | string[]> = {};
      const newHasImageAvailable: Record<string, boolean> = {};

      // Get current result paths for cache preservation
      const currentPaths = new Set(
        sorted.slice(0, displayedCount).map((p) => p.$path),
      );

      // Prepare entries for text preview loading
      if (settings.showTextPreview) {
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

      // Prepare entries for image loading
      if (settings.imageFormat !== "none") {
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

        await loadImagesForEntries(
          imageEntries,
          settings.fallbackToEmbeds,
          app,
          newImages,
          newHasImageAvailable,
        );
      }

      setTextPreviews(newTextPreviews);
      setImages(newImages);
      setHasImageAvailable(newHasImageAvailable);
    };

    void loadTextPreviews();
  }, [
    sorted,
    displayedCount,
    settings.showTextPreview,
    settings.imageFormat,
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
      if (!container) return;
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

        const containerWidth = container.clientWidth;
        if (containerWidth < 100) return;

        const cardSize = settings.cardSize;
        const minColumns = getMinMasonryColumns();
        const gap = getCardSpacing();

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

    // Window resize handler
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(updateLayout, 100);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      window.removeEventListener("resize", handleResize);
    };
  }, [viewMode, settings.cardSize, _styleRevision, dc]);

  // Apply dynamic grid layout (all width modes)
  dc.useEffect(() => {
    if (viewMode !== "card") return;

    const container = containerRef.current;
    if (!container) return;

    const updateGrid = () => {
      const containerWidth = container.clientWidth;
      // Card size represents minimum width; actual width may be larger to fill space
      const cardSize = settings.cardSize;
      const minColumns = getMinGridColumns();
      const gap = getCardSpacing();
      const cols = Math.max(
        minColumns,
        Math.floor((containerWidth + gap) / (cardSize + gap)),
      );

      container.style.setProperty("--grid-columns", String(cols));
      // Set CSS variable for image aspect ratio
      const imageAspectRatio =
        plugin.persistenceManager.getGlobalSettings().imageAspectRatio;
      container.style.setProperty(
        "--dynamic-views-image-aspect-ratio",
        String(imageAspectRatio),
      );
    };

    updateGrid();

    const resizeObserver = new ResizeObserver(updateGrid);
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [viewMode, settings.cardSize, _styleRevision, dc]);

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
    // Determine next mode based on current mode and whether we can expand
    let nextMode: WidthMode;
    if (widthMode === "normal") {
      nextMode = "wide";
    } else if (widthMode === "wide") {
      // Skip max if there's no room to expand beyond wide
      nextMode = canExpandToMax ? "max" : "normal";
    } else {
      // max -> normal
      nextMode = "normal";
    }
    setWidthMode(nextMode);

    // Find all sections containing dynamic views (handles multiple views/splits)
    const sections = document.querySelectorAll(
      ".markdown-source-view, .markdown-preview-view, .markdown-reading-view",
    );
    sections.forEach((section) => {
      // Only apply to sections that contain a dynamic view
      if (section.querySelector(".dynamic-views")) {
        // Remove all width helper classes
        section.classList.remove("datacore-wide", "datacore-max");

        // Apply new helper class (Minimal pattern)
        if (nextMode === "wide") {
          section.classList.add("datacore-wide");
        } else if (nextMode === "max") {
          section.classList.add("datacore-max");
        }
      }
    });
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
  }, []);

  const handleSetSortMethod = dc.useCallback((method: string) => {
    setSortMethod(method);
    setShowSortDropdown(false);
    setIsShuffled(false);
  }, []);

  const handleSearchChange = dc.useCallback(
    (query: string) => {
      setSearchQuery(query);
      setDisplayedCount(app.isMobile ? BATCH_SIZE * 0.5 : BATCH_SIZE);
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
  }, []);

  const handleResetLimit = dc.useCallback((): void => {
    setResultLimit("");
    setShowLimitDropdown(false);
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
    },
    [resultLimit, sorted],
  );

  const handleSettingsChange = dc.useCallback(
    (newSettings: Partial<Settings>) => {
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
        <div className="bases-toolbar-menu-item-info">
          <div className="bases-toolbar-menu-item-info-icon">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="svg-icon lucide-copy"
            >
              <rect x="8" y="8" width="14" height="14" rx="2" ry="2" />
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
            </svg>
          </div>
          <div className="bases-toolbar-menu-item-name">Copy to clipboard</div>
        </div>
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

  return (
    <div ref={explorerRef} className={`dynamic-views ${widthClass}`}>
      <div
        ref={toolbarRef}
        className={`controls-wrapper${isResultsScrolled ? " scrolled" : ""}`}
      >
        <Toolbar
          dc={dc}
          app={app}
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
      </div>

      <div ref={loadMoreRef} />
    </div>
  );
}
