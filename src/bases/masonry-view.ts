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
import { getMinMasonryColumns, getCardSpacing } from "../utils/style-settings";
import {
  calculateMasonryLayout,
  applyMasonryLayout,
} from "../utils/masonry-layout";
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

export const MASONRY_VIEW_TYPE = "dynamic-views-masonry";

export class DynamicViewsMasonryView extends BasesView {
  readonly type = MASONRY_VIEW_TYPE;
  private containerEl: HTMLElement;
  private plugin: DynamicViewsPlugin;
  private textPreviews: Record<string, string> = {};
  private images: Record<string, string | string[]> = {};
  private hasImageAvailable: Record<string, boolean> = {};
  private updateLayoutRef: { current: (() => void) | null } = { current: null };
  private isUpdatingLayout: boolean = false;
  private pendingLayoutUpdate: boolean = false;
  private focusableCardIndex: number = 0;
  private masonryContainer: HTMLElement | null = null;
  private displayedCount: number = 50;
  private isLoading: boolean = false;
  private scrollListener: (() => void) | null = null;
  private scrollThrottleTimeout: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private cardRenderer: SharedCardRenderer;
  isShuffled: boolean = false;
  shuffledOrder: string[] = [];
  private lastSortMethod: string | null = null;
  private containerRef: { current: HTMLElement | null } = { current: null };
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

      // Set CSS variable for image aspect ratio
      this.containerEl.style.setProperty(
        "--dynamic-views-image-aspect-ratio",
        String(settings.imageAspectRatio),
      );

      // Save scroll position before re-rendering
      const savedScrollTop = this.containerEl.scrollTop;

      // Try to find the first visible card to restore position more accurately
      let anchorCardPath: string | null = null;
      if (savedScrollTop > 0 && this.masonryContainer) {
        const cards = this.masonryContainer.querySelectorAll(".card");
        const containerTop = this.containerEl.getBoundingClientRect().top;
        for (const card of Array.from(cards)) {
          const cardTop = (card as HTMLElement).getBoundingClientRect().top;
          if (cardTop >= containerTop - 50) {
            // First card near or in viewport
            anchorCardPath = (card as HTMLElement).getAttribute("data-path");
            break;
          }
        }
      }

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

      // Create masonry container
      this.masonryContainer = this.containerEl.createDiv(
        "dynamic-views-masonry",
      );
      this.containerRef.current = this.masonryContainer;

      // Setup masonry layout
      this.setupMasonryLayout(settings);

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
        const groupEl = this.masonryContainer.createDiv("dynamic-views-group");

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

      // Initial layout calculation
      if (this.updateLayoutRef.current) {
        // Delay to allow images to start loading
        setTimeout(() => {
          if (this.updateLayoutRef.current) {
            this.updateLayoutRef.current();
          }

          // Restore scroll position AFTER masonry layout completes
          if (savedScrollTop > 0) {
            requestAnimationFrame(() => {
              // Try to scroll to anchor card if we found one
              if (anchorCardPath && this.masonryContainer) {
                const anchorCard = this.masonryContainer.querySelector(
                  `.card[data-path="${anchorCardPath}"]`,
                ) as HTMLElement;
                if (anchorCard) {
                  // Scroll to anchor card's position
                  const cardTop = anchorCard.offsetTop;
                  this.containerEl.scrollTop = Math.max(0, cardTop - 100);
                  return;
                }
              }
              // Fallback: restore saved scroll position
              this.containerEl.scrollTop = savedScrollTop;
            });
          }
        }, 50);
      } else {
        // No masonry layout, restore immediately
        if (savedScrollTop > 0) {
          this.containerEl.scrollTop = savedScrollTop;
        }
      }

      // Setup infinite scroll (may set isLoading = true if triggering batch)
      this.setupInfiniteScroll(allEntries.length, settings);
      // Note: Don't reset isLoading here - setupInfiniteScroll may have started a batch
    })();
  }

  private setupMasonryLayout(settings: Settings): void {
    if (!this.masonryContainer) return;

    const minColumns = getMinMasonryColumns();

    // Setup update function using shared masonry logic
    this.updateLayoutRef.current = () => {
      if (!this.masonryContainer) return;
      // Guard against reentrant calls - queue update if one is in progress
      if (this.isUpdatingLayout) {
        this.pendingLayoutUpdate = true;
        return;
      }
      this.isUpdatingLayout = true;

      try {
        const cards = Array.from(
          this.masonryContainer.querySelectorAll<HTMLElement>(".card"),
        );
        if (cards.length === 0) return;

        const containerWidth = this.masonryContainer.clientWidth;

        // Calculate layout using shared logic
        const result = calculateMasonryLayout({
          cards,
          containerWidth,
          cardSize: settings.cardSize,
          minColumns,
          gap: getCardSpacing(),
        });

        // Apply layout to DOM
        applyMasonryLayout(this.masonryContainer, cards, result);
      } finally {
        this.isUpdatingLayout = false;
        // Process any queued update
        if (this.pendingLayoutUpdate) {
          this.pendingLayoutUpdate = false;
          requestAnimationFrame(() => this.updateLayoutRef.current?.());
        }
      }
    };

    // Setup resize observer
    const resizeObserver = new ResizeObserver(() => {
      if (this.updateLayoutRef.current) {
        this.updateLayoutRef.current();
      }
    });
    resizeObserver.observe(this.masonryContainer);
    this.register(() => resizeObserver.disconnect());

    // Setup window resize listener
    const handleResize = () => {
      if (this.updateLayoutRef.current) {
        this.updateLayoutRef.current();
      }
    };
    window.addEventListener("resize", handleResize);
    this.register(() => window.removeEventListener("resize", handleResize));
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
      containerRef: this.containerRef,
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

  private async appendBatch(
    totalEntries: number,
    settings: Settings,
  ): Promise<void> {
    // Guard: return early if data not initialized or no masonry container
    if (!this.data || !this.masonryContainer) return;

    // Increment render version to cancel any stale onDataUpdated renders
    this.renderVersion++;

    const groupedData = this.data.groupedData;
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
        groupEl = this.masonryContainer.createDiv("dynamic-views-group");

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

    // Recalculate masonry layout for ALL cards (including new ones)
    // Use requestAnimationFrame to ensure DOM is updated before measuring
    if (this.updateLayoutRef.current) {
      requestAnimationFrame(() => {
        if (this.updateLayoutRef.current) {
          this.updateLayoutRef.current();
        }
      });
    }

    // Clear loading flag and re-setup infinite scroll
    this.isLoading = false;
    this.setupInfiniteScroll(totalEntries, settings);
  }

  private setupInfiniteScroll(totalEntries: number, settings?: Settings): void {
    // Find the actual scroll container (parent in Bases views)
    const scrollContainer = this.containerEl.parentElement || this.containerEl;
    // Clean up existing listeners
    if (this.scrollListener) {
      scrollContainer.removeEventListener("scroll", this.scrollListener);
      this.scrollListener = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
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
        const minColumns = getMinMasonryColumns();
        const containerWidth = this.masonryContainer?.clientWidth || 0;
        const gap = getCardSpacing();
        const cardSize = settings?.cardSize || 400;
        const columns = Math.max(
          minColumns,
          Math.floor((containerWidth + gap) / (cardSize + gap)),
        );
        const batchSize = Math.min(columns * ROWS_PER_COLUMN, MAX_BATCH_SIZE);
        this.displayedCount = Math.min(
          this.displayedCount + batchSize,
          totalEntries,
        );

        // Append new batch only (preserves existing DOM)
        if (settings) {
          void this.appendBatch(totalEntries, settings);
        } else {
          // Fallback to full re-render if settings not available
          this.onDataUpdated();
        }
      }
    };

    // Create scroll handler with throttling
    this.scrollListener = () => {
      // Throttle: skip if cooldown active
      if (this.scrollThrottleTimeout !== null) {
        return;
      }

      checkAndLoad();

      // Start throttle cooldown
      this.scrollThrottleTimeout = window.setTimeout(() => {
        this.scrollThrottleTimeout = null;
      }, 100);
    };

    // Attach scroll listener to scroll container
    scrollContainer.addEventListener("scroll", this.scrollListener);

    // Setup ResizeObserver on masonry container to detect layout changes
    if (this.masonryContainer) {
      this.resizeObserver = new ResizeObserver(() => {
        // Masonry layout completed, check if need more items
        checkAndLoad();
      });
      this.resizeObserver.observe(this.masonryContainer);
    }

    // Register cleanup
    this.register(() => {
      if (this.scrollListener) {
        scrollContainer.removeEventListener("scroll", this.scrollListener);
      }
      if (this.scrollThrottleTimeout !== null) {
        window.clearTimeout(this.scrollThrottleTimeout);
      }
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
      }
    });
  }

  onunload(): void {
    this.swipeAbortController?.abort();
    this.cardRenderer.cleanup();
  }

  focus(): void {
    this.containerEl.focus({ preventScroll: true });
  }
}

/** Export options for registration */
export const masonryViewOptions = getMasonryViewOptions;
