/**
 * Bases Card View
 * Primary implementation using Bases API
 */

import { BasesView, BasesEntry, QueryController } from "obsidian";
import { CardData } from "../shared/card-renderer";
import { clearImageMetadataCache } from "../shared/image-loader";
import { transformBasesEntries } from "../shared/data-transform";
import {
  readBasesSettings,
  getBasesViewOptions,
} from "../shared/settings-schema";
import { getMinGridColumns, getCardSpacing } from "../utils/style-settings";
import { SharedCardRenderer } from "./shared-renderer";
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
import { setupHoverKeyboardNavigation } from "../shared/keyboard-nav";
import { ScrollPreservation } from "../shared/scroll-preservation";
import type DynamicViewsPlugin from "../../main";
import type { Settings } from "../types";

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
  private scrollPreservation: ScrollPreservation;
  private textPreviews: Record<string, string> = {};
  private images: Record<string, string | string[]> = {};
  private hasImageAvailable: Record<string, boolean> = {};
  private updateLayoutRef: { current: (() => void) | null } = { current: null };
  private focusableCardIndex: number = 0;
  private hoveredCardEl: HTMLElement | null = null;
  private displayedCount: number = 50;
  private isLoading: boolean = false;
  private scrollListener: (() => void) | null = null;
  private scrollThrottleTimeout: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private cardRenderer: SharedCardRenderer;
  private currentCardSize: number = 400;
  isShuffled: boolean = false;
  shuffledOrder: string[] = [];
  private lastSortMethod: string | null = null;
  private feedContainerRef: { current: HTMLElement | null } = { current: null };
  private swipeAbortController: AbortController | null = null;
  // Batch append state
  private previousDisplayedCount: number = 0;
  private lastGroupKey: string | undefined = undefined;
  private lastGroupContainer: HTMLElement | null = null;
  // Render version to cancel stale async renders
  private renderVersion: number = 0;
  // AbortController for async content loading
  private abortController: AbortController | null = null;
  // Guard against reentrant ResizeObserver callbacks (#13)
  private isUpdatingColumns: boolean = false;

  /** Calculate initial card count based on container dimensions */
  private calculateInitialCount(settings: Settings): number {
    const containerWidth = this.containerEl.clientWidth;
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

  // Style Settings compatibility - must be own property (not prototype)
  setSettings = (): void => {
    // No-op: MutationObserver handles updates
  };

  constructor(controller: QueryController, scrollEl: HTMLElement) {
    super(controller);
    // Store scroll parent reference
    this.scrollEl = scrollEl;
    // Get stable leaf ID
    const leaf = this.app.workspace.getLeaf();
    this.leafId = (leaf as unknown as { id: string })?.id ?? "";
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
    // Placeholder - calculated dynamically on first render
    this.displayedCount = 0;

    // Setup swipe interception on mobile if enabled
    const globalSettings = this.plugin.persistenceManager.getGlobalSettings();
    this.swipeAbortController = setupBasesSwipeInterception(
      this.containerEl,
      this.app,
      globalSettings,
    );

    // Watch for Dynamic Views Style Settings changes only
    const disconnectObserver = setupStyleSettingsObserver(
      () => this.onDataUpdated(),
      clearImageMetadataCache,
    );
    this.register(disconnectObserver);

    // Setup hover-to-start keyboard navigation
    const cleanupKeyboard = setupHoverKeyboardNavigation(
      () => this.hoveredCardEl,
      () => this.feedContainerRef.current,
      (index) => {
        this.focusableCardIndex = index;
      },
    );
    this.register(cleanupKeyboard);

    // Setup scroll preservation (handles tab switching, scroll tracking, reset detection)
    this.scrollPreservation = new ScrollPreservation({
      leafId: this.leafId,
      scrollEl: this.scrollEl,
      registerEvent: (e) => this.registerEvent(e),
      register: (c) => this.register(c),
      app: this.app,
    });
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
      this.renderVersion++;
      const currentVersion = this.renderVersion;

      // Abort any previous async content loading
      if (this.abortController) {
        this.abortController.abort();
      }
      this.abortController = new AbortController();

      // Reset focusable card index to prevent out-of-bounds when card count changes
      this.focusableCardIndex = 0;

      const groupedData = this.data.groupedData;
      const allEntries = this.data.data;

      // Read settings from Bases config
      const settings = readBasesSettings(
        this.config,
        this.plugin.persistenceManager.getGlobalSettings(),
        this.plugin.persistenceManager.getDefaultViewSettings(),
      );

      // Calculate initial count dynamically on first render
      if (this.displayedCount === 0) {
        this.displayedCount = this.calculateInitialCount(settings);
      }

      // Calculate grid columns
      const containerWidth = this.containerEl.clientWidth;
      // Card size represents minimum width; actual width may be larger to fill space
      this.currentCardSize = settings.cardSize;
      const cardSize = this.currentCardSize;
      const minColumns = getMinGridColumns();
      const gap = getCardSpacing(this.containerEl);
      const cols = Math.max(
        minColumns,
        Math.floor((containerWidth + gap) / (cardSize + gap)),
      );

      // Set CSS variables for grid layout
      this.containerEl.style.setProperty("--grid-columns", String(cols));
      this.containerEl.style.setProperty(
        "--dynamic-views-image-aspect-ratio",
        String(settings.imageAspectRatio),
      );

      // Transform to CardData (only visible entries)
      const sortMethod = getSortMethod(this.config);

      // Reset shuffle if sort method changed
      if (this.lastSortMethod !== null && this.lastSortMethod !== sortMethod) {
        this.isShuffled = false;
        this.shuffledOrder = [];
      }
      this.lastSortMethod = sortMethod;

      // Process groups and apply shuffle within groups if enabled
      const processedGroups = processGroups(
        groupedData,
        this.isShuffled,
        this.shuffledOrder,
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
        this.textPreviews,
        this.images,
        this.hasImageAvailable,
      );

      // Abort if a newer render started or if aborted while we were loading
      if (
        this.renderVersion !== currentVersion ||
        this.abortController?.signal.aborted
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
      this.lastGroupKey = undefined;
      this.lastGroupContainer = null;

      // Cleanup card renderer observers before re-rendering
      this.cardRenderer.cleanup();

      // Check if grouping is active and toggle is-grouped class
      const isGrouped =
        hasGroupBy(this.config) && !!this.config.groupBy?.property;
      this.containerEl.toggleClass("is-grouped", isGrouped);

      // Create cards feed container
      const feedEl = this.containerEl.createDiv(
        `dynamic-views-grid${isGrouped ? " bases-cards-container" : ""}`,
      );
      this.feedContainerRef.current = feedEl;

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
        renderGroupHeader(feedEl, processedGroup.group, this.config);

        // Create group container for cards
        const groupEl = feedEl.createDiv(
          "dynamic-views-group bases-cards-group",
        );

        // Store group key for consistency with masonry-view (#7)
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
          this.textPreviews,
          this.images,
          this.hasImageAvailable,
        );

        for (let i = 0; i < cards.length; i++) {
          const card = cards[i];
          const entry = groupEntries[i];
          this.renderCard(groupEl, card, entry, displayedSoFar + i, settings);
        }

        displayedSoFar += entriesToDisplay;

        // Track last group for batch append
        this.lastGroupKey = groupKey;
        this.lastGroupContainer = groupEl;
      }

      // Track state for batch append
      this.previousDisplayedCount = displayedSoFar;

      // Setup infinite scroll
      this.setupInfiniteScroll(allEntries.length, settings);

      // Setup ResizeObserver for dynamic grid updates
      if (!this.resizeObserver) {
        this.resizeObserver = new ResizeObserver(() => {
          // Guard: skip if container disconnected from DOM
          if (!this.containerEl?.isConnected) return;

          // Guard against reentrant calls (#13)
          if (this.isUpdatingColumns) return;
          this.isUpdatingColumns = true;

          try {
            const containerWidth = this.containerEl.clientWidth;
            // Card size represents minimum width; actual width may be larger to fill space
            const cardSize = this.currentCardSize;
            const minColumns = getMinGridColumns();
            const gap = getCardSpacing(this.containerEl);
            const cols = Math.max(
              minColumns,
              Math.floor((containerWidth + gap) / (cardSize + gap)),
            );

            this.containerEl.style.setProperty("--grid-columns", String(cols));
          } finally {
            this.isUpdatingColumns = false;
          }
        });
        this.resizeObserver.observe(this.containerEl);
        this.register(() => this.resizeObserver?.disconnect());
      }

      // Restore scroll position after render
      this.scrollPreservation.restoreAfterRender();

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
  ): void {
    this.cardRenderer.renderCard(container, card, entry, settings, {
      index,
      focusableCardIndex: this.focusableCardIndex,
      containerRef: this.feedContainerRef,
      onFocusChange: (newIndex: number) => {
        this.focusableCardIndex = newIndex;
      },
      onHoverStart: (el: HTMLElement) => {
        this.hoveredCardEl = el;
      },
      onHoverEnd: () => {
        this.hoveredCardEl = null;
      },
    });
  }

  private async appendBatch(totalEntries: number): Promise<void> {
    // Guard: return early if data not initialized or no feed container
    if (!this.data || !this.feedContainerRef.current) return;

    // Increment render version to cancel any stale onDataUpdated renders
    this.renderVersion++;
    const currentVersion = this.renderVersion;

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
      this.isShuffled,
      this.shuffledOrder,
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
      this.textPreviews,
      this.images,
      this.hasImageAvailable,
    );

    // Abort if renderVersion changed during loading
    if (this.renderVersion !== currentVersion) {
      return;
    }

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
        currentGroupKey === this.lastGroupKey &&
        this.lastGroupContainer?.isConnected
      ) {
        // Same group as last - append to existing container
        groupEl = this.lastGroupContainer;
      } else {
        // Render group header to feed container (sibling to card group, matching vanilla)
        renderGroupHeader(
          this.feedContainerRef.current,
          processedGroup.group,
          this.config,
        );

        // New group - create container for cards
        groupEl = this.feedContainerRef.current.createDiv(
          "dynamic-views-group bases-cards-group",
        );
        setGroupKeyDataset(groupEl, currentGroupKey);

        // Update last group tracking
        this.lastGroupKey = currentGroupKey;
        this.lastGroupContainer = groupEl;
      }

      // Transform and render cards
      const cards = transformBasesEntries(
        this.app,
        groupEntries,
        settings,
        sortMethod,
        false,
        this.textPreviews,
        this.images,
        this.hasImageAvailable,
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

    // Clear loading flag and re-setup infinite scroll
    this.isLoading = false;
    this.setupInfiniteScroll(totalEntries, settings);
  }

  private setupInfiniteScroll(totalEntries: number, settings?: Settings): void {
    const scrollContainer = this.scrollEl;

    // Clean up existing listener (don't use this.register() since this method is called multiple times)
    if (this.scrollListener) {
      scrollContainer.removeEventListener("scroll", this.scrollListener);
      this.scrollListener = null;
    }

    // Skip if all items already displayed
    if (this.displayedCount >= totalEntries) {
      return;
    }

    // Shared load check function
    const checkAndLoad = () => {
      // Skip if already loading
      if (this.isLoading) {
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
        const columns = settings
          ? Math.max(
              getMinGridColumns(),
              Math.floor(
                (this.containerEl.clientWidth +
                  getCardSpacing(this.containerEl)) /
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
    this.scrollListener = () => {
      // Throttle: skip if cooldown active
      if (this.scrollThrottleTimeout !== null) {
        return;
      }

      checkAndLoad();

      // Start throttle cooldown
      this.scrollThrottleTimeout = window.setTimeout(() => {
        this.scrollThrottleTimeout = null;
      }, SCROLL_THROTTLE_MS);
    };

    // Attach listener to scroll container
    scrollContainer.addEventListener("scroll", this.scrollListener);
  }

  onunload(): void {
    this.scrollPreservation.cleanup();
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    // Clean up scroll-related resources
    if (this.scrollListener) {
      this.scrollEl.removeEventListener("scroll", this.scrollListener);
    }
    if (this.scrollThrottleTimeout !== null) {
      window.clearTimeout(this.scrollThrottleTimeout);
    }
    this.swipeAbortController?.abort();
    this.abortController?.abort();
    this.cardRenderer.cleanup(true); // Force viewer cleanup on view destruction
  }

  focus(): void {
    this.containerEl.focus({ preventScroll: true });
  }
}

/** Export options for registration */
export const cardViewOptions = getBasesViewOptions;
