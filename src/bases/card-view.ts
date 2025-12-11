/**
 * Bases Card View
 * Primary implementation using Bases API
 */

import { BasesView, BasesEntry, QueryController } from "obsidian";
import { CardData } from "../shared/card-renderer";
import { transformBasesEntries } from "../shared/data-transform";
import {
  readBasesSettings,
  getBasesViewOptions,
} from "../shared/settings-schema";
import { getMinGridColumns, getCardSpacing } from "../utils/style-settings";
import { SharedCardRenderer } from "./shared-renderer";
import {
  BATCH_SIZE,
  PANE_MULTIPLIER,
  ROWS_PER_COLUMN,
  MAX_BATCH_SIZE,
} from "../shared/constants";
import {
  setupBasesSwipeInterception,
  setupStyleSettingsObserver,
  getSortMethod,
  loadContentForEntries,
} from "./bases-utils";
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
  private containerEl: HTMLElement;
  private plugin: DynamicViewsPlugin;
  private textPreviews: Record<string, string> = {};
  private images: Record<string, string | string[]> = {};
  private hasImageAvailable: Record<string, boolean> = {};
  private updateLayoutRef: { current: (() => void) | null } = { current: null };
  private focusableCardIndex: number = 0;
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

  // Style Settings compatibility - must be own property (not prototype)
  setSettings = (): void => {
    // No-op: MutationObserver handles updates
  };

  constructor(controller: QueryController, scrollEl: HTMLElement) {
    super(controller);
    // Create container inside scroll parent (critical for embedded views)
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
    // Set initial batch size based on device
    this.displayedCount = this.app.isMobile ? BATCH_SIZE * 0.5 : BATCH_SIZE;

    // Setup swipe interception on mobile if enabled
    const globalSettings = this.plugin.persistenceManager.getGlobalSettings();
    this.swipeAbortController = setupBasesSwipeInterception(
      this.containerEl,
      this.app,
      globalSettings,
    );

    // Watch for Dynamic Views Style Settings changes only
    const disconnectObserver = setupStyleSettingsObserver(() =>
      this.onDataUpdated(),
    );
    this.register(disconnectObserver);
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

      // Calculate grid columns
      const containerWidth = this.containerEl.clientWidth;
      // Card size represents minimum width; actual width may be larger to fill space
      this.currentCardSize = settings.cardSize;
      const cardSize = this.currentCardSize;
      const minColumns = getMinGridColumns();
      const gap = getCardSpacing();
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

      // Save scroll position before re-rendering
      const savedScrollTop = this.containerEl.scrollTop;

      // Transform to CardData (only visible entries)
      const sortMethod = getSortMethod(this.config);

      // Reset shuffle if sort method changed
      if (this.lastSortMethod !== null && this.lastSortMethod !== sortMethod) {
        this.isShuffled = false;
        this.shuffledOrder = [];
      }
      this.lastSortMethod = sortMethod;

      // Process groups and apply shuffle within groups if enabled
      const processedGroups = this.processGroups(groupedData);

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

      // Abort if a newer render started while we were loading
      if (this.renderVersion !== currentVersion) {
        return;
      }

      // Clear and re-render
      this.containerEl.empty();

      // Reset batch append state for full re-render
      this.previousDisplayedCount = 0;
      this.lastGroupKey = undefined;
      this.lastGroupContainer = null;

      // Cleanup card renderer observers before re-rendering
      this.cardRenderer.cleanup();

      // Create cards feed container
      const feedEl = this.containerEl.createDiv("dynamic-views-grid");
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

        // Create group container
        const groupEl = feedEl.createDiv("dynamic-views-group");

        // Render group header if key exists
        this.renderGroupHeader(groupEl, processedGroup.group);

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
        this.lastGroupKey = processedGroup.group.hasKey()
          ? processedGroup.group.key?.toString()
          : undefined;
        this.lastGroupContainer = groupEl;
      }

      // Track state for batch append
      this.previousDisplayedCount = displayedSoFar;

      // Restore scroll position after rendering
      if (savedScrollTop > 0) {
        this.containerEl.scrollTop = savedScrollTop;
      }

      // Setup infinite scroll
      this.setupInfiniteScroll(allEntries.length);

      // Setup ResizeObserver for dynamic grid updates
      if (!this.resizeObserver) {
        this.resizeObserver = new ResizeObserver(() => {
          const containerWidth = this.containerEl.clientWidth;
          // Card size represents minimum width; actual width may be larger to fill space
          const cardSize = this.currentCardSize;
          const minColumns = getMinGridColumns();
          const gap = getCardSpacing();
          const cols = Math.max(
            minColumns,
            Math.floor((containerWidth + gap) / (cardSize + gap)),
          );

          this.containerEl.style.setProperty("--grid-columns", String(cols));
        });
        this.resizeObserver.observe(this.containerEl);
      }
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
    this.cardRenderer.renderCard(container, card, entry, settings, this, {
      index,
      focusableCardIndex: this.focusableCardIndex,
      containerRef: this.feedContainerRef,
      onFocusChange: (newIndex: number) => {
        this.focusableCardIndex = newIndex;
      },
    });
  }

  /** Process groups with shuffle logic applied */
  private processGroups<
    T extends { entries: BasesEntry[]; hasKey(): boolean; key?: unknown },
  >(groupedData: T[]): Array<{ group: T; entries: BasesEntry[] }> {
    return groupedData.map((group) => {
      let groupEntries = [...group.entries];
      if (this.isShuffled && this.shuffledOrder.length > 0) {
        groupEntries = groupEntries.sort((a, b) => {
          const indexA = this.shuffledOrder.indexOf(a.file.path);
          const indexB = this.shuffledOrder.indexOf(b.file.path);
          return indexA - indexB;
        });
      }
      return { group, entries: groupEntries };
    });
  }

  /** Render group header if group has a key */
  private renderGroupHeader(
    groupEl: HTMLElement,
    group: { hasKey(): boolean; key?: unknown },
  ): void {
    if (!group.hasKey()) return;

    const headerEl = groupEl.createDiv("bases-group-heading");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const groupBy = (this.config as any).groupBy;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (groupBy?.property) {
      const propertyEl = headerEl.createDiv("bases-group-property");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
      const propertyName = this.config.getDisplayName(groupBy.property);
      propertyEl.setText(propertyName);
    }

    const valueEl = headerEl.createDiv("bases-group-value");
    const keyValue = group.key?.toString() || "";
    valueEl.setText(keyValue);
  }

  private async appendBatch(totalEntries: number): Promise<void> {
    // Guard: return early if data not initialized or no feed container
    if (!this.data || !this.feedContainerRef.current) return;

    // Increment render version to cancel any stale onDataUpdated renders
    this.renderVersion++;

    const groupedData = this.data.groupedData;

    // Read settings
    const settings = readBasesSettings(
      this.config,
      this.plugin.persistenceManager.getGlobalSettings(),
      this.plugin.persistenceManager.getDefaultViewSettings(),
    );

    const sortMethod = getSortMethod(this.config);

    // Process groups with shuffle logic
    const processedGroups = this.processGroups(groupedData);

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
        ? processedGroup.group.key?.toString()
        : undefined;

      if (currentGroupKey === this.lastGroupKey && this.lastGroupContainer) {
        // Same group as last - append to existing container
        groupEl = this.lastGroupContainer;
      } else {
        // New group - create container
        groupEl = this.feedContainerRef.current.createDiv(
          "dynamic-views-group",
        );

        // Render group header if key exists
        this.renderGroupHeader(groupEl, processedGroup.group);

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
    this.setupInfiniteScroll(totalEntries);
  }

  private setupInfiniteScroll(totalEntries: number): void {
    // Find the actual scroll container (parent in Bases views)
    const scrollContainer = this.containerEl.parentElement || this.containerEl;

    // Clean up existing listener
    if (this.scrollListener) {
      scrollContainer.removeEventListener("scroll", this.scrollListener);
      this.scrollListener = null;
    }

    // Skip if all items already displayed
    if (this.displayedCount >= totalEntries) {
      return;
    }

    // Create scroll handler with throttling
    this.scrollListener = () => {
      // Throttle: skip if cooldown active
      if (this.scrollThrottleTimeout !== null) {
        return;
      }

      // Skip if already loading
      if (this.isLoading) {
        return;
      }

      // Calculate distance from bottom (use scrollContainer, not containerEl)
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
        const columns =
          parseInt(
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

      // Start throttle cooldown
      this.scrollThrottleTimeout = window.setTimeout(() => {
        this.scrollThrottleTimeout = null;
      }, 100);
    };

    // Attach listener to scroll container
    scrollContainer.addEventListener("scroll", this.scrollListener);

    // Register cleanup
    this.register(() => {
      if (this.scrollListener) {
        scrollContainer.removeEventListener("scroll", this.scrollListener);
      }
      if (this.scrollThrottleTimeout !== null) {
        window.clearTimeout(this.scrollThrottleTimeout);
      }
    });
  }

  onunload(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    this.swipeAbortController?.abort();
    this.cardRenderer.cleanup();
  }

  focus(): void {
    this.containerEl.focus({ preventScroll: true });
  }
}

/** Export options for registration */
export const cardViewOptions = getBasesViewOptions;
