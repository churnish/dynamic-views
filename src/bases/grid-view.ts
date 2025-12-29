/**
 * Bases Card View
 * Primary implementation using Bases API
 */

import { BasesView, BasesEntry, QueryController } from "obsidian";
import { CardData } from "../shared/card-renderer";
import { reapplyAmbientColors } from "../shared/image-loader";
import { transformBasesEntries } from "../shared/data-transform";
import {
  readBasesSettings,
  getBasesViewOptions,
} from "../shared/settings-schema";
import {
  getMinGridColumns,
  getCardSpacing,
  clearStyleSettingsCache,
} from "../utils/style-settings";
import { initializeScrollGradients } from "../shared/scroll-gradient";
import {
  SharedCardRenderer,
  initializeTitleTruncation,
} from "./shared-renderer";
import {
  PANE_MULTIPLIER,
  ROWS_PER_COLUMN,
  MAX_BATCH_SIZE,
  SCROLL_THROTTLE_MS,
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
} from "./utils";
import {
  initializeContainerFocus,
  setupHoverKeyboardNavigation,
} from "../shared/keyboard-nav";
import {
  ScrollPreservation,
  getLeafProps,
} from "../shared/scroll-preservation";
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

// Extend App type to include isMobile property
declare module "obsidian" {
  interface App {
    isMobile: boolean;
  }
}

export const GRID_VIEW_TYPE = "dynamic-views-grid";

export class DynamicViewsCardView extends BasesView {
  readonly type = GRID_VIEW_TYPE;
  private scrollEl: HTMLElement;
  private leafId: string;
  private containerEl: HTMLElement;
  private plugin: DynamicViewsPlugin;
  private scrollPreservation: ScrollPreservation | null = null;
  private cardRenderer: SharedCardRenderer;

  // Consolidated state objects (shared patterns with masonry-view)
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
  private focusCleanup: (() => void) | null = null;

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

  // Grid-specific state
  private updateLayoutRef: { current: (() => void) | null } = { current: null };
  private displayedCount: number = 50;
  private isLoading: boolean = false;
  private resizeObserver: ResizeObserver | null = null;
  private currentCardSize: number = 400;
  private feedContainerRef: { current: HTMLElement | null } = { current: null };
  private swipeAbortController: AbortController | null = null;
  private previousDisplayedCount: number = 0;
  private isUpdatingColumns: boolean = false;
  private lastColumnCount: number = 0;
  private resizeRafId: number | null = null;
  private lastObservedWidth: number = 0;
  private hasBatchAppended: boolean = false;

  /** Calculate initial card count based on container dimensions */
  private calculateInitialCount(settings: Settings): number {
    // Use getBoundingClientRect for actual rendered width (clientWidth rounds fractional pixels)
    const containerWidth = Math.floor(
      this.containerEl.getBoundingClientRect().width,
    );
    const minColumns = getMinGridColumns();
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

  /** Calculate grid column count based on container width and card size */
  private calculateColumnCount(): number {
    // Use getBoundingClientRect for actual rendered width (clientWidth rounds fractional pixels)
    const containerWidth = Math.floor(
      this.containerEl.getBoundingClientRect().width,
    );
    const cardSize = this.currentCardSize;
    const minColumns = getMinGridColumns();
    const gap = getCardSpacing(this.containerEl);
    return Math.max(
      minColumns,
      Math.floor((containerWidth + gap) / (cardSize + gap)),
    );
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
    const disconnectObserver = setupStyleSettingsObserver(
      () => this.onDataUpdated(),
      reapplyAmbientColors,
    );
    this.register(disconnectObserver);

    // Setup hover-to-start keyboard navigation
    const cleanupKeyboard = setupHoverKeyboardNavigation(
      () => this.focusState.hoveredEl,
      () => this.feedContainerRef.current,
      (index) => {
        this.focusState.cardIndex = index;
      },
    );
    this.register(cleanupKeyboard);

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
      // Guard: return early if data not yet initialized (race condition with MutationObserver)
      if (!this.data) {
        return;
      }

      // Guard: skip if batch loading in progress to prevent race conditions
      // The batch append will handle rendering new entries
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
        this.feedContainerRef.current?.children.length
      ) {
        // Restore column CSS (may be lost on tab switch)
        this.containerEl.style.setProperty(
          "--grid-columns",
          String(this.lastColumnCount),
        );
        this.scrollPreservation?.restoreAfterRender();
        return;
      }

      // Calculate initial count for comparison and first render
      const initialCount = this.calculateInitialCount(settings);

      // Reset to initial batch if settings changed AND infinite scroll has appended batches
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

      // Update card size before calculating columns
      this.currentCardSize = settings.cardSize;
      const cols = this.calculateColumnCount();

      // Set CSS variables for grid layout
      this.lastColumnCount = cols;
      this.containerEl.style.setProperty("--grid-columns", String(cols));
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
      this.hasBatchAppended = false;
      this.lastObservedWidth = 0;

      // Cleanup card renderer observers before re-rendering
      this.cardRenderer.cleanup();

      // Check if grouping is active and toggle is-grouped class
      const isGrouped = !!groupByProperty;
      this.containerEl.toggleClass("is-grouped", isGrouped);

      // Create cards feed container
      const feedEl = this.containerEl.createDiv(
        `dynamic-views-grid${isGrouped ? " bases-cards-container" : ""}`,
      );
      this.feedContainerRef.current = feedEl;

      // Initialize focus management on container (cleanup previous first)
      this.focusCleanup?.();
      this.focusCleanup = initializeContainerFocus(feedEl);

      // Clear CSS variable cache to pick up any style changes
      // (prevents layout thrashing from repeated getComputedStyle calls per card)
      clearStyleSettingsCache();

      // Render groups with headers
      let displayedSoFar = 0;
      for (const processedGroup of processedGroups) {
        if (displayedSoFar >= this.displayedCount) break;

        const entriesToDisplay = Math.min(
          processedGroup.entries.length,
          this.displayedCount - displayedSoFar,
        );
        if (entriesToDisplay === 0) continue;

        const groupEntries = processedGroup.entries.slice(0, entriesToDisplay);

        // Render group header to feed container (sibling to card group, matching vanilla)
        renderGroupHeader(feedEl, processedGroup.group, this.config, this.app);

        // Create group container for cards
        const groupEl = feedEl.createDiv(
          "dynamic-views-group bases-cards-group",
        );

        // Store group key for consistency with masonry-view
        const groupKey = processedGroup.group.hasKey()
          ? serializeGroupKey(processedGroup.group.key)
          : undefined;
        setGroupKeyDataset(groupEl, groupKey);

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
          this.renderCard(groupEl, card, entry, displayedSoFar + i, settings);
        }

        displayedSoFar += entriesToDisplay;

        // Track last group for batch append
        this.lastGroup.key = groupKey;
        this.lastGroup.container = groupEl;
      }

      // Track state for batch append
      this.previousDisplayedCount = displayedSoFar;

      // Batch-initialize scroll gradients and title truncation after all cards rendered
      // (avoids layout thrashing from per-card measurements)
      initializeScrollGradients(feedEl);
      initializeTitleTruncation(feedEl);

      // Setup infinite scroll
      this.setupInfiniteScroll(allEntries.length, settings);

      // Show end indicator if all items fit in initial render (skip if 0 results)
      if (displayedSoFar >= allEntries.length && allEntries.length > 0) {
        this.showEndIndicator();
      }

      // Setup ResizeObserver for dynamic grid updates (double-RAF debounce)
      if (!this.resizeObserver) {
        this.resizeObserver = new ResizeObserver((entries) => {
          const width = entries[0]?.contentRect.width ?? 0;

          // Column update logic (extracted for reuse)
          const updateColumns = () => {
            // Guard: skip if container disconnected from DOM
            if (!this.containerEl?.isConnected) return;

            // Guard against reentrant calls
            if (this.isUpdatingColumns) return;
            this.isUpdatingColumns = true;

            try {
              const cols = this.calculateColumnCount();

              // Only update if changed
              if (cols !== this.lastColumnCount) {
                // Save scroll before CSS change, restore after (prevents reflow reset)
                const scrollBefore = this.scrollEl.scrollTop;
                this.lastColumnCount = cols;
                this.containerEl.style.setProperty(
                  "--grid-columns",
                  String(cols),
                );
                if (scrollBefore > 0) {
                  this.scrollEl.scrollTop = scrollBefore;
                }
              }
            } finally {
              this.isUpdatingColumns = false;
            }
          };

          // Skip debounce on tab switch (width 0→positive) to prevent flash
          if (width > 0 && this.lastObservedWidth === 0) {
            if (this.resizeRafId !== null)
              cancelAnimationFrame(this.resizeRafId);
            this.resizeRafId = null;
            updateColumns();
          } else if (width > 0) {
            // Normal resize: double-RAF debounce to coalesce rapid events
            if (this.resizeRafId !== null)
              cancelAnimationFrame(this.resizeRafId);
            this.resizeRafId = requestAnimationFrame(() => {
              this.resizeRafId = requestAnimationFrame(() => {
                updateColumns();
              });
            });
          }
          this.lastObservedWidth = width;
        });
        this.resizeObserver.observe(this.containerEl);
        this.register(() => this.resizeObserver?.disconnect());
      }

      // Restore scroll position after render
      this.scrollPreservation?.restoreAfterRender();

      // Remove height preservation now that scroll is restored
      this.containerEl.style.minHeight = "";
      // Note: Don't reset isLoading here - scroll listener may have started a batch
    })();
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
      containerRef: this.feedContainerRef,
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

  private async appendBatch(totalEntries: number): Promise<void> {
    // Guard: return early if data not initialized or no feed container
    if (!this.data || !this.feedContainerRef.current) return;

    // Increment render version to cancel any stale onDataUpdated renders
    this.renderState.version++;
    const currentVersion = this.renderState.version;

    const groupedData = this.data.groupedData;

    // Read settings
    const settings = readBasesSettings(
      this.config,
      this.plugin.persistenceManager.getGlobalSettings(),
      this.plugin.persistenceManager.getDefaultViewSettings(),
    );

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
      const startInGroup = Math.max(0, prevCount - displayedSoFar);
      const groupEntries = processedGroup.entries.slice(
        startInGroup,
        groupEntriesToDisplay,
      );

      // Get or create group container
      let groupEl: HTMLElement;
      const currentGroupKey = processedGroup.group.hasKey()
        ? serializeGroupKey(processedGroup.group.key)
        : undefined;

      if (
        currentGroupKey === this.lastGroup.key &&
        this.lastGroup.container?.isConnected
      ) {
        // Same group as last - append to existing container
        groupEl = this.lastGroup.container;
      } else {
        // Render group header to feed container (sibling to card group, matching vanilla)
        renderGroupHeader(
          this.feedContainerRef.current,
          processedGroup.group,
          this.config,
          this.app,
        );

        // New group - create container for cards
        groupEl = this.feedContainerRef.current.createDiv(
          "dynamic-views-group bases-cards-group",
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

      displayedSoFar += groupEntriesToDisplay;
    }

    // Update state for next append - use currCount (captured at start)
    // to ensure consistency even if this.displayedCount changed during async
    this.previousDisplayedCount = currCount;

    // Batch-initialize scroll gradients and title truncation for newly rendered cards
    if (this.feedContainerRef.current) {
      initializeScrollGradients(this.feedContainerRef.current);
      initializeTitleTruncation(this.feedContainerRef.current);
    }

    // Mark that batch append occurred (for end indicator)
    this.hasBatchAppended = true;

    // Clear loading flag - existing scroll listener handles future loads
    this.isLoading = false;
  }

  private setupInfiniteScroll(totalEntries: number, settings?: Settings): void {
    const scrollContainer = this.scrollEl;

    // Clean up existing listener (don't use this.register() since this method is called multiple times)
    if (this.scrollThrottle.listener) {
      scrollContainer.removeEventListener(
        "scroll",
        this.scrollThrottle.listener,
      );
      this.scrollThrottle.listener = null;
    }

    // Clear any pending throttle timeout to prevent stale callback execution
    if (this.scrollThrottle.timeoutId !== null) {
      window.clearTimeout(this.scrollThrottle.timeoutId);
      this.scrollThrottle.timeoutId = null;
    }

    // Show end indicator only after batch append completed all items (skip if 0 results)
    if (this.displayedCount >= totalEntries && totalEntries > 0) {
      if (this.hasBatchAppended) {
        this.showEndIndicator();
      }
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
        // Use getBoundingClientRect for actual rendered width (clientWidth rounds fractional pixels)
        const containerWidth = Math.floor(
          this.containerEl.getBoundingClientRect().width,
        );
        // Guard against zero width (element hidden/collapsed)
        if (containerWidth === 0) {
          this.isLoading = false;
          return;
        }
        const columns = settings
          ? Math.max(
              getMinGridColumns(),
              Math.floor(
                (containerWidth + getCardSpacing(this.containerEl)) /
                  (settings.cardSize + getCardSpacing(this.containerEl)),
              ),
            )
          : parseInt(
              this.containerEl.style.getPropertyValue("--grid-columns") || "2",
            ) || 2;
        const batchSize = Math.min(columns * ROWS_PER_COLUMN, MAX_BATCH_SIZE);
        this.displayedCount = Math.min(
          this.displayedCount + batchSize,
          totalEntries,
        );

        // Append new batch only (preserves existing DOM)
        void this.appendBatch(totalEntries);
      }
    };

    // Create scroll handler with throttling (scroll tracking is in constructor)
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

    // Attach listener to scroll container
    scrollContainer.addEventListener("scroll", this.scrollThrottle.listener, {
      passive: true,
    });

    // Trigger initial check in case viewport already needs more content
    checkAndLoad();
  }

  /** Show end-of-content indicator when all items are displayed */
  private showEndIndicator(): void {
    // Guard against disconnected container (RAF callback after view destroyed)
    if (!this.containerEl?.isConnected) return;
    // Avoid duplicates
    if (this.containerEl.querySelector(".dynamic-views-end-indicator")) return;
    this.containerEl.createDiv("dynamic-views-end-indicator");
  }

  onunload(): void {
    this.scrollPreservation?.cleanup();
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.resizeRafId !== null) {
      cancelAnimationFrame(this.resizeRafId);
    }
    // Clean up scroll-related resources
    if (this.scrollThrottle.listener) {
      this.scrollEl.removeEventListener("scroll", this.scrollThrottle.listener);
    }
    if (this.scrollThrottle.timeoutId !== null) {
      window.clearTimeout(this.scrollThrottle.timeoutId);
    }
    this.swipeAbortController?.abort();
    this.renderState.abortController?.abort();
    this.focusCleanup?.();
    this.cardRenderer.cleanup(true); // Force viewer cleanup on view destruction
  }

  focus(): void {
    this.containerEl.focus({ preventScroll: true });
  }
}

/** Export options for registration */
export const cardViewOptions = getBasesViewOptions;
