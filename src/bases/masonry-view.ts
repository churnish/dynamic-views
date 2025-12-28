/**
 * Bases Masonry View
 * Masonry layout view using Bases API
 */

import { BasesView, BasesEntry, QueryController } from "obsidian";
import { CardData } from "../shared/card-renderer";
import { transformBasesEntries } from "../shared/data-transform";
import {
  readBasesSettings,
  getMasonryViewOptions,
} from "../shared/settings-schema";
import {
  getMinMasonryColumns,
  getCardSpacing,
  clearStyleSettingsCache,
  getCompactBreakpoint,
} from "../utils/style-settings";
import { initializeScrollGradients } from "../shared/scroll-gradient";
import {
  calculateMasonryLayout,
  calculateMasonryDimensions,
  calculateIncrementalMasonryLayout,
  type MasonryLayoutResult,
} from "../utils/masonry-layout";
import {
  SharedCardRenderer,
  initializeTitleTruncation,
} from "./shared-renderer";
import {
  getCachedAspectRatio,
  reapplyAmbientColors,
} from "../shared/image-loader";
import {
  PANE_MULTIPLIER,
  ROWS_PER_COLUMN,
  MAX_BATCH_SIZE,
  SCROLL_THROTTLE_MS,
  RESIZE_THROTTLE_MS,
} from "../shared/constants";
import {
  setupBasesSwipeInterception,
  setupStyleSettingsObserver,
  getSortMethod,
  loadContentForEntries,
  processGroups,
  renderGroupHeader,
  hasGroupBy,
  serializeGroupKey,
  setGroupKeyDataset,
  getGroupKeyDataset,
} from "./utils";
import { setupHoverKeyboardNavigation } from "../shared/keyboard-nav";
import {
  ScrollPreservation,
  getLeafProps,
} from "../shared/scroll-preservation";
import {
  PROPERTY_MEASURED_EVENT,
  cleanupVisibilityObserver,
  resetGapCache,
} from "../shared/property-measure";
import type DynamicViewsPlugin from "../../main";
import type {
  Settings,
  ContentCache,
  RenderState,
  LastGroupState,
  ScrollThrottleState,
  SortState,
  FocusState,
} from "../types";

export const MASONRY_VIEW_TYPE = "dynamic-views-masonry";

export class DynamicViewsMasonryView extends BasesView {
  readonly type = MASONRY_VIEW_TYPE;
  private scrollEl: HTMLElement;
  private leafId: string;
  private containerEl: HTMLElement;
  private plugin: DynamicViewsPlugin;
  private scrollPreservation: ScrollPreservation | null = null;
  private cardRenderer: SharedCardRenderer;

  // Consolidated state objects (shared patterns with grid-view)
  private contentCache: ContentCache = {
    textPreviews: {},
    images: {},
    hasImageAvailable: {},
  };
  private renderState: RenderState = {
    version: 0,
    abortController: null,
    lastRenderHash: "",
    lastSettingsHash: null,
  };
  private lastGroup: LastGroupState = { key: undefined, container: null };
  private scrollThrottle: ScrollThrottleState = {
    listener: null,
    timeoutId: null,
  };
  private sortState: SortState = {
    isShuffled: false,
    order: [],
    lastMethod: null,
  };
  private focusState: FocusState = { cardIndex: 0, hoveredEl: null };

  // Public accessors for sortState (used by randomize.ts)
  get isShuffled(): boolean {
    return this.sortState.isShuffled;
  }
  set isShuffled(value: boolean) {
    this.sortState.isShuffled = value;
  }
  get shuffledOrder(): string[] {
    return this.sortState.order;
  }
  set shuffledOrder(value: string[]) {
    this.sortState.order = value;
  }

  // Masonry-specific state
  private updateLayoutRef: { current: ((source?: string) => void) | null } = {
    current: null,
  };
  private isUpdatingLayout: boolean = false;
  private pendingLayoutUpdate: boolean = false;
  private lastLayoutWidth: number = 0;
  private masonryContainer: HTMLElement | null = null;
  private displayedCount: number = 50;
  private isLoading: boolean = false;
  private scrollResizeObserver: ResizeObserver | null = null;
  private containerRef: { current: HTMLElement | null } = { current: null };
  private swipeAbortController: AbortController | null = null;
  private previousDisplayedCount: number = 0;
  private layoutResizeObserver: ResizeObserver | null = null;
  private resizeRafId: number | null = null;
  private resizeThrottleTimeout: number | null = null;
  private groupLayoutResults: Map<string | undefined, MasonryLayoutResult> =
    new Map();
  private expectedIncrementalHeight: number | null = null;
  private totalEntries: number = 0;
  private displayedSoFar: number = 0;
  private propertyMeasuredTimeout: number | null = null;

  /** Calculate batch size based on current column count */
  private getBatchSize(settings: Settings): number {
    if (!this.masonryContainer) return MAX_BATCH_SIZE;
    const minColumns = getMinMasonryColumns();
    // Use getBoundingClientRect for actual rendered width (clientWidth rounds fractional pixels)
    const containerWidth = Math.floor(
      this.masonryContainer.getBoundingClientRect().width,
    );
    // Guard against zero width (element hidden/collapsed)
    if (containerWidth === 0) return MAX_BATCH_SIZE;
    const gap = getCardSpacing(this.containerEl);
    const columns = Math.max(
      minColumns,
      Math.floor((containerWidth + gap) / (settings.cardSize + gap)),
    );
    return Math.min(columns * ROWS_PER_COLUMN, MAX_BATCH_SIZE);
  }

  /** Calculate initial card count based on container dimensions */
  private calculateInitialCount(settings: Settings): number {
    // Use getBoundingClientRect for actual rendered width (clientWidth rounds fractional pixels)
    const containerWidth = Math.floor(
      this.containerEl.getBoundingClientRect().width,
    );
    const minColumns = getMinMasonryColumns();
    const gap = getCardSpacing(this.containerEl);
    const cardSize = settings.cardSize;

    if (containerWidth === 0) {
      // Fallback using minimum columns when container not yet laid out
      return Math.min(minColumns * ROWS_PER_COLUMN, MAX_BATCH_SIZE);
    }

    const calculatedColumns = Math.floor(
      (containerWidth + gap) / (cardSize + gap),
    );
    const columns = Math.max(minColumns, calculatedColumns);
    const rawCount = columns * ROWS_PER_COLUMN;
    return Math.min(rawCount, MAX_BATCH_SIZE);
  }

  /** Check if more content needed after layout completes, and load if so */
  private checkAndLoadMore(totalEntries: number, settings: Settings): void {
    // Skip if already loading or all items displayed
    if (this.isLoading || this.displayedCount >= totalEntries) return;

    const scrollContainer = this.scrollEl;
    if (!scrollContainer?.isConnected) return;

    const scrollTop = scrollContainer.scrollTop;
    const scrollHeight = scrollContainer.scrollHeight;
    const clientHeight = scrollContainer.clientHeight;
    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
    const threshold = clientHeight * PANE_MULTIPLIER;

    if (distanceFromBottom < threshold) {
      this.isLoading = true;
      const batchSize = this.getBatchSize(settings);
      this.displayedCount = Math.min(
        this.displayedCount + batchSize,
        totalEntries,
      );
      void this.appendBatch(totalEntries, settings);
    }
  }

  // Called by Obsidian when view settings change - trigger re-render
  setSettings = (): void => {
    this.onDataUpdated();
  };

  constructor(controller: QueryController, scrollEl: HTMLElement) {
    super(controller);
    // Store scroll parent reference
    this.scrollEl = scrollEl;
    // Find leaf by matching container (getLeaf() creates new leaf if pinned, activeLeaf is deprecated)
    this.leafId = "";
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view?.containerEl?.contains(scrollEl)) {
        this.leafId = getLeafProps(leaf).id ?? "";
      }
    });
    // Create container inside scroll parent
    this.containerEl = scrollEl.createDiv({
      cls: "dynamic-views dynamic-views-bases-container",
    });
    // Access plugin from controller's app
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    this.plugin = (this.app as any).plugins.plugins[
      "dynamic-views"
    ] as DynamicViewsPlugin;
    // Initialize shared card renderer
    this.cardRenderer = new SharedCardRenderer(
      this.app,
      this.plugin,
      this.updateLayoutRef,
    );

    // Get global settings for feature flags
    const globalSettings = this.plugin.persistenceManager.getGlobalSettings();

    // Placeholder - calculated dynamically on first render
    this.displayedCount = 0;

    // Setup swipe interception on mobile if enabled
    this.swipeAbortController = setupBasesSwipeInterception(
      this.containerEl,
      this.app,
      globalSettings,
    );

    // Watch for Dynamic Views Style Settings changes only
    const disconnectObserver = setupStyleSettingsObserver(() => {
      resetGapCache(); // Invalidate gap cache on settings change
      this.onDataUpdated();
    }, reapplyAmbientColors);
    this.register(disconnectObserver);

    // Setup hover-to-start keyboard navigation
    const cleanupKeyboard = setupHoverKeyboardNavigation(
      () => this.focusState.hoveredEl,
      () => this.containerRef.current,
      (index) => {
        this.focusState.cardIndex = index;
      },
    );
    this.register(cleanupKeyboard);

    // Listen for property measurement completion to trigger masonry relayout
    // (card heights may have changed during async property field measurement)
    // Debounce to batch multiple rapid-fire events, then run during browser idle
    const scheduleIdleCallback =
      typeof requestIdleCallback !== "undefined"
        ? requestIdleCallback
        : (fn: () => void) => setTimeout(fn, 16); // Fallback: next frame
    const handlePropertyMeasured = () => {
      if (this.propertyMeasuredTimeout !== null) {
        window.clearTimeout(this.propertyMeasuredTimeout);
      }
      this.propertyMeasuredTimeout = window.setTimeout(() => {
        this.propertyMeasuredTimeout = null;
        // Use idle callback to avoid blocking user interactions
        // Guard against view destruction during idle wait
        scheduleIdleCallback(() => {
          if (!this.containerEl?.isConnected) return;
          this.updateLayoutRef.current?.("property-measured");
        });
      }, 100);
    };
    document.addEventListener(PROPERTY_MEASURED_EVENT, handlePropertyMeasured);
    this.register(() => {
      document.removeEventListener(
        PROPERTY_MEASURED_EVENT,
        handlePropertyMeasured,
      );
      if (this.propertyMeasuredTimeout !== null) {
        window.clearTimeout(this.propertyMeasuredTimeout);
      }
    });

    // Setup scroll preservation (handles tab switching, scroll tracking, reset detection)
    if (this.leafId) {
      this.scrollPreservation = new ScrollPreservation({
        leafId: this.leafId,
        scrollEl: this.scrollEl,
        registerEvent: (e) => this.registerEvent(e),
        register: (c) => this.register(c),
        app: this.app,
      });
    }
  }

  onload(): void {
    // Ensure view is fully initialized before Obsidian renders it
    // This prevents race conditions when view is embedded in notes
    super.onload();
  }

  onDataUpdated(): void {
    void (async () => {
      // Guard: return early if data not yet initialized
      if (!this.data) {
        return;
      }

      // Guard: skip if batch loading in progress
      if (this.isLoading) {
        return;
      }

      // Increment render version to cancel any in-flight stale renders
      this.renderState.version++;
      const currentVersion = this.renderState.version;

      // Abort any previous async content loading
      if (this.renderState.abortController) {
        this.renderState.abortController.abort();
      }
      this.renderState.abortController = new AbortController();

      // Reset focusable card index to prevent out-of-bounds when card count changes
      this.focusState.cardIndex = 0;

      const groupedData = this.data.groupedData;
      const allEntries = this.data.data;

      // Track total entries for end indicator
      this.totalEntries = allEntries.length;

      // Read settings from Bases config (before hash check so we can include settings)
      const settings = readBasesSettings(
        this.config,
        this.plugin.persistenceManager.getGlobalSettings(),
        this.plugin.persistenceManager.getDefaultViewSettings(),
      );

      // Check if data or settings changed - skip re-render if not (prevents tab switch flash)
      // Use null byte delimiter (cannot appear in file paths) to avoid hash collisions
      const groupByProperty = hasGroupBy(this.config)
        ? this.config.groupBy?.property
        : undefined;
      const settingsHash = JSON.stringify(settings);
      const renderHash =
        allEntries.map((e: BasesEntry) => e.file.path).join("\0") +
        "\0\0" +
        settingsHash +
        "\0\0" +
        (groupByProperty ?? "");
      if (
        renderHash === this.renderState.lastRenderHash &&
        this.masonryContainer?.children.length
      ) {
        this.scrollPreservation?.restoreAfterRender();
        return;
      }

      // Calculate initial count for comparison and first render
      const initialCount = this.calculateInitialCount(settings);

      // Clear caches on settings change; reset scroll only if batches were appended
      // (avoids lag with many cards; skips scroll-to-top when only initial batch shown)
      const settingsChanged =
        this.renderState.lastSettingsHash !== null &&
        this.renderState.lastSettingsHash !== settingsHash;
      if (settingsChanged) {
        this.contentCache.textPreviews = {};
        this.contentCache.images = {};
        this.contentCache.hasImageAvailable = {};
        // Only scroll to top + reset if batches were appended
        if (this.displayedCount > initialCount) {
          this.displayedCount = 0;
          this.scrollEl.scrollTop = 0;
          this.scrollPreservation?.clearSavedPosition();
        }
      }
      this.renderState.lastSettingsHash = settingsHash;
      this.renderState.lastRenderHash = renderHash;

      // Set displayedCount when starting fresh (first render or after reset)
      if (this.displayedCount === 0) {
        this.displayedCount = initialCount;
      }

      // Set CSS variable for image aspect ratio
      this.containerEl.style.setProperty(
        "--dynamic-views-image-aspect-ratio",
        String(settings.imageAspectRatio),
      );

      // Transform to CardData (only visible entries)
      const sortMethod = getSortMethod(this.config);

      // Reset shuffle state if sort method changed
      if (
        this.sortState.lastMethod !== null &&
        this.sortState.lastMethod !== sortMethod
      ) {
        this.sortState.isShuffled = false;
        this.sortState.order = [];
      }
      this.sortState.lastMethod = sortMethod;

      // Process groups and apply shuffle within groups if enabled
      const processedGroups = processGroups(
        groupedData,
        this.sortState.isShuffled,
        this.sortState.order,
      );

      // Collect visible entries across all groups (up to displayedCount)
      const visibleEntries: BasesEntry[] = [];
      let remainingCount = this.displayedCount;

      for (const processedGroup of processedGroups) {
        if (remainingCount <= 0) break;
        const entriesToTake = Math.min(
          processedGroup.entries.length,
          remainingCount,
        );
        visibleEntries.push(...processedGroup.entries.slice(0, entriesToTake));
        remainingCount -= entriesToTake;
      }

      // Load text previews and images ONLY for displayed entries
      await loadContentForEntries(
        visibleEntries,
        settings,
        this.app,
        this.contentCache.textPreviews,
        this.contentCache.images,
        this.contentCache.hasImageAvailable,
      );

      // Abort if a newer render started or if aborted while we were loading
      if (
        this.renderState.version !== currentVersion ||
        this.renderState.abortController?.signal.aborted
      ) {
        return;
      }

      // Preserve height during clear to prevent parent scroll reset
      const currentHeight = this.containerEl.scrollHeight;
      this.containerEl.style.minHeight = `${currentHeight}px`;

      // Clear and re-render
      this.containerEl.empty();

      // Reset batch append state for full re-render
      this.previousDisplayedCount = 0;
      this.lastGroup.key = undefined;
      this.lastGroup.container = null;
      this.groupLayoutResults.clear();

      // Cleanup card renderer observers before re-rendering
      this.cardRenderer.cleanup();

      // Check if grouping is active and toggle is-grouped class
      const isGrouped = !!groupByProperty;
      this.containerEl.toggleClass("is-grouped", isGrouped);

      // Create masonry container
      // Ungrouped: needs masonry-container for CSS height:auto rule
      // Grouped: individual group containers get masonry-container class
      this.masonryContainer = this.containerEl.createDiv(
        `dynamic-views-masonry${isGrouped ? " bases-cards-container" : " masonry-container"}`,
      );
      this.containerRef.current = this.masonryContainer;

      // Setup masonry layout
      this.setupMasonryLayout(settings);

      // Clear CSS variable cache to pick up any style changes
      // (prevents layout thrashing from repeated getComputedStyle calls per card)
      clearStyleSettingsCache();

      // Render groups with headers (or ungrouped cards directly)
      let displayedSoFar = 0;
      for (const processedGroup of processedGroups) {
        if (displayedSoFar >= this.displayedCount) break;

        const entriesToDisplay = Math.min(
          processedGroup.entries.length,
          this.displayedCount - displayedSoFar,
        );
        if (entriesToDisplay === 0) continue;

        const groupEntries = processedGroup.entries.slice(0, entriesToDisplay);

        // Determine card container: group div (grouped) or masonry container (ungrouped)
        let cardContainer: HTMLElement;
        let groupKey: string | undefined;

        if (isGrouped) {
          // Render group header to masonry container (sibling to card group, matching vanilla)
          renderGroupHeader(
            this.masonryContainer,
            processedGroup.group,
            this.config,
            this.app,
          );

          // Create group container for cards
          cardContainer = this.masonryContainer.createDiv(
            "dynamic-views-group bases-cards-group masonry-container",
          );

          // Store group key for layout tracking
          groupKey = processedGroup.group.hasKey()
            ? serializeGroupKey(processedGroup.group.key)
            : undefined;
          setGroupKeyDataset(cardContainer, groupKey);
        } else {
          // Ungrouped: render directly to masonry container
          cardContainer = this.masonryContainer;
          groupKey = undefined;
        }

        // Render cards in this group
        const cards = transformBasesEntries(
          this.app,
          groupEntries,
          settings,
          sortMethod,
          false,
          this.contentCache.textPreviews,
          this.contentCache.images,
          this.contentCache.hasImageAvailable,
        );

        for (let i = 0; i < cards.length; i++) {
          const card = cards[i];
          const entry = groupEntries[i];
          this.renderCard(
            cardContainer,
            card,
            entry,
            displayedSoFar + i,
            settings,
          );
        }

        displayedSoFar += entriesToDisplay;

        // Track last group for batch append
        this.lastGroup.key = groupKey;
        this.lastGroup.container = cardContainer;
      }

      // Track state for batch append and end indicator
      this.previousDisplayedCount = displayedSoFar;
      this.displayedSoFar = displayedSoFar;

      // Initial layout calculation
      if (this.updateLayoutRef.current) {
        this.updateLayoutRef.current("initial-render");
      }

      // Batch-initialize scroll gradients and title truncation after layout is applied
      // (avoids layout thrashing from per-card measurements)
      if (this.masonryContainer) {
        initializeScrollGradients(this.masonryContainer);
        initializeTitleTruncation(this.masonryContainer);
      }

      // Setup infinite scroll outside setTimeout (c59fe2d pattern)
      this.setupInfiniteScroll(allEntries.length, settings);

      // Restore scroll position after render
      this.scrollPreservation?.restoreAfterRender();

      // Remove height preservation now that scroll is restored
      this.containerEl.style.minHeight = "";
    })();
  }

  private setupMasonryLayout(settings: Settings): void {
    if (!this.masonryContainer) return;

    const minColumns = getMinMasonryColumns();

    // Synchronous layout update - single pass, no chunking
    // Profiling showed chunked async caused layout thrashing (224 InvalidateLayout events)
    this.updateLayoutRef.current = (source?: string) => {
      if (!this.masonryContainer) return;
      // Cache width early to avoid double getBoundingClientRect() call (layout flush)
      const containerWidth = Math.floor(
        this.masonryContainer.getBoundingClientRect().width,
      );
      if (containerWidth === 0) return;

      // Guard against reentrant calls - queue update if one is in progress
      if (this.isUpdatingLayout) {
        this.pendingLayoutUpdate = true;
        return;
      }
      this.isUpdatingLayout = true;

      // Only hide cards on initial render (prevents flash at 0,0)
      const skipHiding = source !== "initial-render";

      try {
        const gap = getCardSpacing(this.containerEl);
        const isGrouped = this.containerEl.classList.contains("is-grouped");

        // Hide cards during initial render only
        if (!skipHiding) {
          this.masonryContainer.classList.add("masonry-resizing");
        }

        // Collect all cards
        let allCards: HTMLElement[];
        let groups: HTMLElement[] | null = null;

        if (isGrouped) {
          groups = Array.from(
            this.masonryContainer.querySelectorAll<HTMLElement>(
              ".bases-cards-group",
            ),
          );
          if (groups.length === 0) {
            this.isUpdatingLayout = false;
            return;
          }
          allCards = Array.from(
            this.masonryContainer.querySelectorAll<HTMLElement>(".card"),
          );
        } else {
          allCards = Array.from(
            this.masonryContainer.querySelectorAll<HTMLElement>(".card"),
          );
        }

        if (allCards.length === 0) {
          this.isUpdatingLayout = false;
          return;
        }

        // Calculate dimensions
        const { cardWidth } = calculateMasonryDimensions({
          containerWidth,
          cardSize: settings.cardSize,
          minColumns,
          gap,
        });

        // Phase 1: Set all widths (single pass)
        for (const card of allCards) {
          if (!skipHiding) {
            card.classList.remove("masonry-positioned");
          }
          card.style.setProperty("--masonry-width", `${cardWidth}px`);
        }

        // Phase 2: Single forced reflow
        void allCards[0]?.offsetHeight;

        // Phase 3: Read all heights (single pass)
        const heights = allCards.map((card) => card.offsetHeight);

        // Phase 4: Calculate and apply layout
        if (isGrouped && groups) {
          const groupCardsMap = new Map<HTMLElement, HTMLElement[]>();
          for (const groupEl of groups) {
            groupCardsMap.set(
              groupEl,
              Array.from(groupEl.querySelectorAll<HTMLElement>(".card")),
            );
          }

          let cardIndex = 0;
          for (const groupEl of groups) {
            const groupCards = groupCardsMap.get(groupEl) ?? [];
            if (groupCards.length === 0) continue;

            const groupHeights = heights.slice(
              cardIndex,
              cardIndex + groupCards.length,
            );
            const groupKey = getGroupKeyDataset(groupEl);

            const result = calculateMasonryLayout({
              cards: groupCards,
              containerWidth,
              cardSize: settings.cardSize,
              minColumns,
              gap,
              heights: groupHeights,
            });

            // Apply positions (single pass)
            for (let i = 0; i < groupCards.length; i++) {
              const pos = result.positions[i];
              groupCards[i].classList.add("masonry-positioned");
              groupCards[i].style.setProperty(
                "--masonry-left",
                `${pos.left}px`,
              );
              groupCards[i].style.setProperty("--masonry-top", `${pos.top}px`);
            }

            groupEl.classList.add("masonry-container");
            groupEl.style.setProperty(
              "--masonry-height",
              `${result.containerHeight}px`,
            );

            this.groupLayoutResults.set(groupKey, result);
            cardIndex += groupCards.length;
          }
        } else {
          // Ungrouped mode
          const result = calculateMasonryLayout({
            cards: allCards,
            containerWidth,
            cardSize: settings.cardSize,
            minColumns,
            gap,
            heights,
          });

          // Apply positions (single pass)
          for (let i = 0; i < allCards.length; i++) {
            const pos = result.positions[i];
            allCards[i].classList.add("masonry-positioned");
            allCards[i].style.setProperty("--masonry-left", `${pos.left}px`);
            allCards[i].style.setProperty("--masonry-top", `${pos.top}px`);
          }

          this.masonryContainer.style.setProperty(
            "--masonry-height",
            `${result.containerHeight}px`,
          );

          this.groupLayoutResults.set(undefined, result);
        }

        this.lastLayoutWidth = containerWidth;
      } finally {
        if (!skipHiding && this.masonryContainer?.isConnected) {
          this.masonryContainer.classList.remove("masonry-resizing");
        }

        // Show end indicator if all items displayed (skip if 0 results)
        requestAnimationFrame(() => {
          if (!this.containerEl?.isConnected) return;
          if (
            this.displayedSoFar >= this.totalEntries &&
            this.totalEntries > 0
          ) {
            this.showEndIndicator();
          }
        });

        this.isUpdatingLayout = false;

        // Process any queued update
        if (this.pendingLayoutUpdate) {
          this.pendingLayoutUpdate = false;
          requestAnimationFrame(() => {
            if (!this.containerEl?.isConnected) return;
            this.updateLayoutRef.current?.("queued-update");
          });
        }
      }
    };

    // Throttled resize handler - recalculates every RESIZE_THROTTLE_MS during resize
    // Uses trailing call pattern: if resize events arrive during throttle, trigger layout when throttle expires
    let pendingTrailingLayout = false;

    const throttledResize = (entries: ResizeObserverEntry[]) => {
      if (entries.length === 0) return;
      const entry = entries[0];
      const newWidth = Math.floor(entry?.contentRect?.width ?? 0);

      // Skip if width unchanged
      if (newWidth === this.lastLayoutWidth) {
        return;
      }

      // Throttle: only update if not in cooldown
      if (this.resizeThrottleTimeout === null) {
        pendingTrailingLayout = false;

        // Cancel any pending RAF
        if (this.resizeRafId !== null) {
          cancelAnimationFrame(this.resizeRafId);
        }

        // Update via double-RAF for smooth rendering
        this.resizeRafId = requestAnimationFrame(() => {
          if (!this.masonryContainer?.isConnected) return;
          this.resizeRafId = requestAnimationFrame(() => {
            if (!this.masonryContainer?.isConnected) return;
            if (this.updateLayoutRef.current) {
              this.updateLayoutRef.current("resize-observer");
            }
          });
        });

        // Start throttle cooldown with trailing call
        this.resizeThrottleTimeout = window.setTimeout(() => {
          this.resizeThrottleTimeout = null;
          // If resize events arrived during throttle, trigger layout now
          if (pendingTrailingLayout) {
            pendingTrailingLayout = false;
            if (this.updateLayoutRef.current) {
              this.updateLayoutRef.current("resize-trailing");
            }
          }
        }, RESIZE_THROTTLE_MS);
      } else {
        // Throttled - mark that we need a trailing layout
        pendingTrailingLayout = true;
      }
    };

    // Setup resize observer (only once, not per render)
    // ResizeObserver handles both pane and window resize (container resizes in both cases)
    if (!this.layoutResizeObserver) {
      this.layoutResizeObserver = new ResizeObserver(throttledResize);
      this.layoutResizeObserver.observe(this.masonryContainer);
      this.register(() => this.layoutResizeObserver?.disconnect());
    } else if (this.masonryContainer) {
      // Cancel any pending RAF before re-observing
      if (this.resizeRafId !== null) {
        cancelAnimationFrame(this.resizeRafId);
        this.resizeRafId = null;
      }
      // Re-observe if container was recreated
      this.layoutResizeObserver.disconnect();
      this.layoutResizeObserver.observe(this.masonryContainer);
    }
  }

  private renderCard(
    container: HTMLElement,
    card: CardData,
    entry: BasesEntry,
    index: number,
    settings: Settings,
  ): HTMLElement {
    return this.cardRenderer.renderCard(container, card, entry, settings, {
      index,
      focusableCardIndex: this.focusState.cardIndex,
      containerRef: this.containerRef,
      onFocusChange: (newIndex: number) => {
        this.focusState.cardIndex = newIndex;
      },
      onHoverStart: (el: HTMLElement) => {
        this.focusState.hoveredEl = el;
      },
      onHoverEnd: () => {
        this.focusState.hoveredEl = null;
      },
    });
  }

  private async appendBatch(
    totalEntries: number,
    settings: Settings,
  ): Promise<void> {
    // Guard: return early if data not initialized or no masonry container
    if (!this.data || !this.masonryContainer) return;

    // Increment render version to cancel any stale onDataUpdated renders
    this.renderState.version++;
    const currentVersion = this.renderState.version;

    const groupedData = this.data.groupedData;
    const sortMethod = getSortMethod(this.config);

    // Process groups with shuffle logic
    const processedGroups = processGroups(
      groupedData,
      this.sortState.isShuffled,
      this.sortState.order,
    );

    // Capture state at start - these may change during async operations
    const prevCount = this.previousDisplayedCount;
    const currCount = this.displayedCount;

    // Collect ONLY NEW entries (from prevCount to currCount)
    const newEntries: BasesEntry[] = [];
    let currentCount = 0;

    for (const processedGroup of processedGroups) {
      const groupStart = currentCount;
      const groupEnd = currentCount + processedGroup.entries.length;

      // Determine which entries from this group are new
      const newStartInGroup = Math.max(0, prevCount - groupStart);
      const newEndInGroup = Math.min(
        processedGroup.entries.length,
        currCount - groupStart,
      );

      if (
        newEndInGroup > newStartInGroup &&
        newStartInGroup < processedGroup.entries.length
      ) {
        newEntries.push(
          ...processedGroup.entries.slice(newStartInGroup, newEndInGroup),
        );
      }

      currentCount = groupEnd;
    }

    // Load content ONLY for new entries
    await loadContentForEntries(
      newEntries,
      settings,
      this.app,
      this.contentCache.textPreviews,
      this.contentCache.images,
      this.contentCache.hasImageAvailable,
    );

    // Abort if renderVersion changed during loading
    if (this.renderState.version !== currentVersion) {
      this.containerEl.querySelector(".dynamic-views-end-indicator")?.remove();
      this.isLoading = false;
      return;
    }

    // Clear CSS variable cache for this batch
    clearStyleSettingsCache();

    // Render new cards, handling group boundaries
    // Use captured prevCount/currCount to avoid race conditions
    let displayedSoFar = 0;
    let newCardsRendered = 0;
    const startIndex = prevCount;
    let groupsWithNewCards = 0; // Track how many groups received cards

    for (const processedGroup of processedGroups) {
      if (displayedSoFar >= currCount) break;

      const groupEntriesToDisplay = Math.min(
        processedGroup.entries.length,
        currCount - displayedSoFar,
      );

      // Skip groups that were fully rendered before
      if (displayedSoFar + groupEntriesToDisplay <= prevCount) {
        displayedSoFar += groupEntriesToDisplay;
        continue;
      }

      // Determine entries to render in this group
      // startInGroup: skip already-rendered entries
      // endInGroup: stop at currCount boundary
      const startInGroup = Math.max(0, prevCount - displayedSoFar);
      const endInGroup = groupEntriesToDisplay; // Already capped by currCount
      const groupEntries = processedGroup.entries.slice(
        startInGroup,
        endInGroup,
      );

      // Get or create group container
      let groupEl: HTMLElement;
      const currentGroupKey = processedGroup.group.hasKey()
        ? serializeGroupKey(processedGroup.group.key)
        : undefined;

      // Check if we can reuse the last group container
      if (
        currentGroupKey === this.lastGroup.key &&
        this.lastGroup.container?.isConnected
      ) {
        // Same group as last - append to existing container
        groupEl = this.lastGroup.container;
      } else {
        // Render group header to masonry container (sibling to card group, matching vanilla)
        renderGroupHeader(
          this.masonryContainer,
          processedGroup.group,
          this.config,
          this.app,
        );

        // New group - create container for cards
        groupEl = this.masonryContainer.createDiv(
          "dynamic-views-group bases-cards-group masonry-container",
        );
        setGroupKeyDataset(groupEl, currentGroupKey);

        // Update last group tracking
        this.lastGroup.key = currentGroupKey;
        this.lastGroup.container = groupEl;
      }

      // Transform and render cards
      const cards = transformBasesEntries(
        this.app,
        groupEntries,
        settings,
        sortMethod,
        false,
        this.contentCache.textPreviews,
        this.contentCache.images,
        this.contentCache.hasImageAvailable,
      );

      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        const entry = groupEntries[i];
        this.renderCard(
          groupEl,
          card,
          entry,
          startIndex + newCardsRendered,
          settings,
        );
        newCardsRendered++;
      }

      if (cards.length > 0) {
        groupsWithNewCards++;
      }

      displayedSoFar += groupEntriesToDisplay;
    }

    // Update state for next append - use currCount (captured at start)
    // to ensure consistency even if this.displayedCount changed during async
    this.previousDisplayedCount = currCount;
    this.displayedSoFar = displayedSoFar;

    // Batch-initialize scroll gradients and title truncation for newly rendered cards
    if (this.masonryContainer) {
      initializeScrollGradients(this.masonryContainer);
      initializeTitleTruncation(this.masonryContainer);
    }

    // Use incremental layout if we have previous state, otherwise fall back to full recalc
    // For grouped mode, use lastGroupKey; for ungrouped, use undefined
    const layoutKey = this.lastGroup.container ? this.lastGroup.key : undefined;
    const prevLayout = this.groupLayoutResults.get(layoutKey);
    const targetContainer = this.lastGroup.container ?? this.masonryContainer;

    // Ensure target container has masonry-container class for CSS height rule
    if (
      targetContainer &&
      !targetContainer.classList.contains("masonry-container")
    ) {
      targetContainer.classList.add("masonry-container");
    }

    if (groupsWithNewCards > 1) {
      // Batch spanned multiple groups - trigger full recalc to position all
      this.updateLayoutRef.current?.("multi-group-fallback");
    } else if (!prevLayout && newCardsRendered > 0) {
      // No previous layout for this container (new group) - trigger full recalc
      this.updateLayoutRef.current?.("new-group-fallback");
    } else if (prevLayout && newCardsRendered > 0 && targetContainer) {
      // Get only the newly rendered cards from the target container
      const allCards = Array.from(
        targetContainer.querySelectorAll<HTMLElement>(".card"),
      );
      const newCards =
        newCardsRendered > 0 ? allCards.slice(-newCardsRendered) : [];

      // Pre-set width on new cards BEFORE measuring heights
      // This ensures text wrapping is correct when we read offsetHeight
      const cardWidth = prevLayout.cardWidth;
      newCards.forEach((card) => {
        card.style.setProperty("--masonry-width", `${cardWidth}px`);
      });

      // Function to run incremental layout
      const runIncrementalLayout = () => {
        // Never hide during incremental layout - cards already positioned

        // Re-read prevLayout in case it was updated during async operations
        const currentPrevLayout = this.groupLayoutResults.get(layoutKey);

        // Validate refs are still valid after async delay
        if (!targetContainer?.isConnected || !currentPrevLayout) {
          return;
        }

        // If any card was disconnected, fall back to full recalc
        if (newCards.some((c) => !c.isConnected)) {
          this.updateLayoutRef.current?.("card-disconnected-fallback");
          return;
        }

        // Sync responsive classes before measuring (ResizeObservers are async)
        const compactBreakpoint = getCompactBreakpoint();

        newCards.forEach((card) => {
          const actualWidth = card.offsetWidth; // Force reflow

          // Sync compact-mode state
          card.classList.toggle(
            "compact-mode",
            actualWidth < compactBreakpoint,
          );

          // Sync thumbnail-stack state
          const thumb = card.querySelector<HTMLElement>(".card-thumbnail");
          if (thumb) {
            const thumbWidth = thumb.offsetWidth;
            const shouldStack = actualWidth < thumbWidth * 3;
            card.classList.toggle("thumbnail-stack", shouldStack);
          }
        });

        // Force synchronous reflow so heights reflect new widths
        void targetContainer.offsetHeight;

        const gap = getCardSpacing(this.containerEl);

        const result = calculateIncrementalMasonryLayout({
          newCards,
          columnHeights: currentPrevLayout.columnHeights,
          containerWidth: currentPrevLayout.containerWidth,
          cardWidth: currentPrevLayout.cardWidth,
          columns: currentPrevLayout.columns,
          gap,
        });

        // Apply positions to new cards only (width already set above)
        newCards.forEach((card, index) => {
          const pos = result.positions[index];
          card.classList.add("masonry-positioned");
          card.style.setProperty("--masonry-left", `${pos.left}px`);
          card.style.setProperty("--masonry-top", `${pos.top}px`);
        });

        // Track expected height so ResizeObserver can skip this change
        this.expectedIncrementalHeight = result.containerHeight;

        // Update container height (group container or main container)
        targetContainer.style.setProperty(
          "--masonry-height",
          `${result.containerHeight}px`,
        );

        // Store for next incremental append
        this.groupLayoutResults.set(layoutKey, result);

        // After layout completes, check if more content needed
        // (ResizeObserver skips expected heights, so we check here)
        // Guard: skip if render was cancelled while waiting for layout
        if (this.renderState.version === currentVersion) {
          this.checkAndLoadMore(totalEntries, settings);
          // Show end indicator if all items displayed (skip if 0 results)
          if (
            this.displayedSoFar >= this.totalEntries &&
            this.totalEntries > 0
          ) {
            this.showEndIndicator();
          }
        }
      };

      // Check if fixed cover height is enabled (heights are CSS-determined)
      const isFixedCoverHeight = document.body.classList.contains(
        "dynamic-views-masonry-fixed-cover-height",
      );

      // Double RAF ensures browser has completed layout calculation:
      // First RAF waits for pending style recalc, second ensures paint is complete
      // and all ResizeObserver callbacks have fired
      // Both RAFs guarded with isConnected to prevent execution on destroyed view
      const runAfterLayout = (fn: () => void) => {
        requestAnimationFrame(() => {
          if (!this.containerEl?.isConnected) return;
          requestAnimationFrame(() => {
            if (!this.containerEl?.isConnected) return;
            fn();
          });
        });
      };

      if (isFixedCoverHeight) {
        // Heights are CSS-determined, position after layout
        runAfterLayout(runIncrementalLayout);
      } else {
        // Need to wait for image heights to be known (covers and thumbnails)
        const newCardImages = newCards
          .flatMap((card) => [
            card.querySelector<HTMLImageElement>(
              ".dynamic-views-image-embed img",
            ),
            card.querySelector<HTMLImageElement>(".card-thumbnail img"),
          ])
          .filter((img): img is HTMLImageElement => img !== null);

        // Apply cached aspect ratios and collect images that need to load
        const uncachedImages = newCardImages.filter((img) => {
          const cachedRatio = getCachedAspectRatio(img.src);
          if (cachedRatio !== undefined) {
            // Apply cached aspect ratio - height will be correct
            const card = img.closest<HTMLElement>(".card");
            if (card) {
              card.style.setProperty(
                "--actual-aspect-ratio",
                cachedRatio.toString(),
              );
              // Mark as ready to prevent image-loader from triggering redundant layout update
              card.classList.add("cover-ready");
            }
            return false; // Don't need to wait
          }
          return true; // Need to wait for load
        });

        if (uncachedImages.length === 0) {
          // All images have cached aspect ratios (or no images)
          runAfterLayout(runIncrementalLayout);
        } else {
          // Wait for uncached images to load/error
          void Promise.all(
            uncachedImages.map(
              (img) =>
                new Promise<void>((resolve) => {
                  if (img.complete) {
                    resolve();
                    return;
                  }
                  img.addEventListener("load", () => resolve(), { once: true });
                  img.addEventListener("error", () => resolve(), {
                    once: true,
                  });
                }),
            ),
          ).then(() => {
            // Guard against view destruction or renderVersion change while waiting for images
            if (!this.containerEl?.isConnected) return;
            if (this.renderState.version !== currentVersion) return;
            runAfterLayout(runIncrementalLayout);
          });
        }
      }
    }
    // Note: else cases (newCardsRendered === 0 or missing targetContainer) are valid no-ops

    // Clear loading flag after layout completes
    // ResizeObserver on masonry container will trigger checkAndLoad when height changes
    this.isLoading = false;
  }

  private setupInfiniteScroll(totalEntries: number, settings?: Settings): void {
    const scrollContainer = this.scrollEl;
    // Clean up existing listeners and timeouts (don't use this.register() since this method is called multiple times)
    if (this.scrollThrottle.listener) {
      scrollContainer.removeEventListener(
        "scroll",
        this.scrollThrottle.listener,
      );
      this.scrollThrottle.listener = null;
    }
    if (this.scrollResizeObserver) {
      this.scrollResizeObserver.disconnect();
      this.scrollResizeObserver = null;
    }
    // Clear any pending throttle timeout to prevent stale callback execution
    if (this.scrollThrottle.timeoutId !== null) {
      window.clearTimeout(this.scrollThrottle.timeoutId);
      this.scrollThrottle.timeoutId = null;
    }

    // All items displayed - no need for scroll loading
    if (this.displayedCount >= totalEntries) {
      return;
    }

    // Shared load check function
    const checkAndLoad = () => {
      // Skip if container disconnected or already loading
      if (!scrollContainer.isConnected || this.isLoading) {
        return;
      }

      // Calculate distance from bottom
      const scrollTop = scrollContainer.scrollTop;
      const scrollHeight = scrollContainer.scrollHeight;
      const clientHeight = scrollContainer.clientHeight;
      const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);

      // Threshold: load when within PANE_MULTIPLIER × pane height from bottom
      const threshold = clientHeight * PANE_MULTIPLIER;

      // Check if should load more
      if (
        distanceFromBottom < threshold &&
        this.displayedCount < totalEntries
      ) {
        this.isLoading = true;

        // Dynamic batch size: columns × rows per column, capped
        const batchSize = settings
          ? this.getBatchSize(settings)
          : MAX_BATCH_SIZE;
        const newCount = Math.min(
          this.displayedCount + batchSize,
          totalEntries,
        );
        this.displayedCount = newCount;

        // Append new batch only (preserves existing DOM)
        if (settings) {
          void this.appendBatch(totalEntries, settings);
        } else {
          // Fallback to full re-render if settings not available
          this.onDataUpdated();
        }
      }
    };

    // Create scroll handler with throttling (scroll tracking is in constructor)
    // Uses leading+trailing pattern: runs immediately on first event, then again when throttle expires
    this.scrollThrottle.listener = () => {
      // Throttle: skip if cooldown active
      if (this.scrollThrottle.timeoutId !== null) {
        return;
      }

      checkAndLoad();

      // Start throttle cooldown with trailing call
      this.scrollThrottle.timeoutId = window.setTimeout(() => {
        this.scrollThrottle.timeoutId = null;
        checkAndLoad(); // Trailing call catches scroll position changes during throttle
      }, SCROLL_THROTTLE_MS);
    };

    // Attach scroll listener to scroll container
    scrollContainer.addEventListener("scroll", this.scrollThrottle.listener, {
      passive: true,
    });

    // Setup ResizeObserver on masonry container to detect layout changes
    if (this.masonryContainer) {
      let prevHeight = this.masonryContainer.offsetHeight;
      this.scrollResizeObserver = new ResizeObserver((entries) => {
        // Guard: skip if container disconnected from DOM
        if (!this.masonryContainer?.isConnected) return;

        const newHeight = entries[0]?.contentRect.height ?? 0;

        // Skip if this is the expected height from incremental layout
        // Clear expected height regardless of match to prevent stale values
        if (this.expectedIncrementalHeight !== null) {
          const isExpectedHeight =
            Math.abs(newHeight - this.expectedIncrementalHeight) < 1;
          this.expectedIncrementalHeight = null;
          if (isExpectedHeight) {
            prevHeight = newHeight;
            return;
          }
        }

        // Only trigger loading when height INCREASES (new content added)
        // Skip when height decreases (e.g., properties hidden)
        if (newHeight > prevHeight) {
          checkAndLoad();
        }
        prevHeight = newHeight;
      });
      this.scrollResizeObserver.observe(this.masonryContainer);
    }

    // Trigger initial check in case viewport already needs more content
    checkAndLoad();
  }

  /** Show end-of-content indicator when all items are displayed */
  private showEndIndicator(): void {
    // Guard against disconnected container (RAF callback after view destroyed)
    if (!this.containerEl?.isConnected) return;
    // Avoid duplicates
    if (this.containerEl.querySelector(".dynamic-views-end-indicator")) {
      return;
    }
    this.containerEl.createDiv("dynamic-views-end-indicator");
  }

  onunload(): void {
    this.scrollPreservation?.cleanup();
    this.swipeAbortController?.abort();
    this.renderState.abortController?.abort();
    if (this.resizeRafId !== null) {
      cancelAnimationFrame(this.resizeRafId);
    }
    if (this.resizeThrottleTimeout !== null) {
      window.clearTimeout(this.resizeThrottleTimeout);
    }
    // Clean up scroll-related resources
    if (this.scrollThrottle.listener) {
      this.scrollEl.removeEventListener("scroll", this.scrollThrottle.listener);
    }
    if (this.scrollThrottle.timeoutId !== null) {
      window.clearTimeout(this.scrollThrottle.timeoutId);
    }
    if (this.scrollResizeObserver) {
      this.scrollResizeObserver.disconnect();
    }
    // Clean up property measurement observer
    cleanupVisibilityObserver();
    this.cardRenderer.cleanup(true); // Force viewer cleanup on view destruction
  }

  focus(): void {
    this.containerEl.focus({ preventScroll: true });
  }
}

/** Export options for registration */
export const masonryViewOptions = getMasonryViewOptions;
