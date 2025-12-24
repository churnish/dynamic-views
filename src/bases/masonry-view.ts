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
  calculateIncrementalMasonryLayout,
  type MasonryLayoutResult,
} from "../utils/masonry-layout";
import { SharedCardRenderer } from "./shared-renderer";
import {
  getCachedAspectRatio,
  clearImageMetadataCache,
} from "../shared/image-loader";
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
  getGroupKeyDataset,
} from "./utils";
import { setupHoverKeyboardNavigation } from "../shared/keyboard-nav";
import { ScrollPreservation } from "../shared/scroll-preservation";
import type DynamicViewsPlugin from "../../main";
import type { Settings } from "../types";

export const MASONRY_VIEW_TYPE = "dynamic-views-masonry";

export class DynamicViewsMasonryView extends BasesView {
  readonly type = MASONRY_VIEW_TYPE;
  private scrollEl: HTMLElement;
  private leafId: string;
  private containerEl: HTMLElement;
  private plugin: DynamicViewsPlugin;
  private scrollPreservation: ScrollPreservation;
  private textPreviews: Record<string, string> = {};
  private images: Record<string, string | string[]> = {};
  private hasImageAvailable: Record<string, boolean> = {};
  private updateLayoutRef: { current: (() => void) | null } = { current: null };
  private isUpdatingLayout: boolean = false;
  private pendingLayoutUpdate: boolean = false;
  private focusableCardIndex: number = 0;
  private hoveredCardEl: HTMLElement | null = null;
  private masonryContainer: HTMLElement | null = null;
  private displayedCount: number = 50;
  private isLoading: boolean = false;
  private scrollListener: (() => void) | null = null;
  private scrollThrottleTimeout: number | null = null;
  private scrollResizeObserver: ResizeObserver | null = null;
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
  // AbortController for async content loading
  private abortController: AbortController | null = null;
  // Timeout ID for masonry layout delay
  private layoutTimeoutId: ReturnType<typeof setTimeout> | null = null;
  // RAF ID for debounced resize handling
  private resizeRafId: number | null = null;
  // Layout results per group for incremental append (undefined key = ungrouped)
  private groupLayoutResults: Map<string | undefined, MasonryLayoutResult> =
    new Map();
  // Expected container height after incremental layout (for ResizeObserver skip)
  private expectedIncrementalHeight: number | null = null;

  /** Calculate batch size based on current column count */
  private getBatchSize(settings: Settings): number {
    if (!this.masonryContainer) return MAX_BATCH_SIZE;
    const minColumns = getMinMasonryColumns();
    const containerWidth = this.masonryContainer.clientWidth;
    const gap = getCardSpacing(this.containerEl);
    const columns = Math.max(
      minColumns,
      Math.floor((containerWidth + gap) / (settings.cardSize + gap)),
    );
    return Math.min(columns * ROWS_PER_COLUMN, MAX_BATCH_SIZE);
  }

  /** Calculate initial card count based on container dimensions */
  private calculateInitialCount(settings: Settings): number {
    const containerWidth = this.containerEl.clientWidth;
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
      () => this.containerRef.current,
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
      // Guard: return early if data not yet initialized
      if (!this.data) {
        return;
      }

      // Guard: skip if batch loading in progress
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

      // Set CSS variable for image aspect ratio
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
      this.groupLayoutResults.clear();

      // Cleanup card renderer observers before re-rendering
      this.cardRenderer.cleanup();

      // Check if grouping is active and toggle is-grouped class
      const isGrouped =
        hasGroupBy(this.config) && !!this.config.groupBy?.property;
      this.containerEl.toggleClass("is-grouped", isGrouped);

      // Create masonry container
      this.masonryContainer = this.containerEl.createDiv(
        `dynamic-views-masonry${isGrouped ? " bases-cards-container" : ""}`,
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

        // Render group header to masonry container (sibling to card group, matching vanilla)
        renderGroupHeader(
          this.masonryContainer,
          processedGroup.group,
          this.config,
          this.app,
        );

        // Create group container for cards
        const groupEl = this.masonryContainer.createDiv(
          "dynamic-views-group bases-cards-group",
        );

        // Store group key for layout tracking
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

      // Initial layout calculation - explicit call ensures immediate positioning
      // before async ResizeObserver fires (ResizeObserver is async, this is sync) (#11)
      if (this.updateLayoutRef.current) {
        this.updateLayoutRef.current();
      }

      // Setup infinite scroll outside setTimeout (c59fe2d pattern)
      this.setupInfiniteScroll(allEntries.length, settings);

      // Restore scroll position after render
      this.scrollPreservation.restoreAfterRender();

      // Remove height preservation now that scroll is restored
      this.containerEl.style.minHeight = "";
    })();
  }

  private setupMasonryLayout(settings: Settings): void {
    if (!this.masonryContainer) return;

    const minColumns = getMinMasonryColumns();

    // Setup update function using shared masonry logic (c59fe2d simple version)
    this.updateLayoutRef.current = () => {
      if (!this.masonryContainer) return;
      // Guard against reentrant calls - queue update if one is in progress
      if (this.isUpdatingLayout) {
        this.pendingLayoutUpdate = true;
        return;
      }
      this.isUpdatingLayout = true;

      try {
        const containerWidth = this.masonryContainer.clientWidth;
        const gap = getCardSpacing(this.containerEl);

        // Check grouped mode via class (source of truth set in onDataUpdated)
        const isGrouped = this.containerEl.classList.contains("is-grouped");

        if (isGrouped) {
          // Get all group containers
          const groups = Array.from(
            this.masonryContainer.querySelectorAll<HTMLElement>(
              ".bases-cards-group",
            ),
          );
          if (groups.length === 0) return;
          // Phase 1: Pre-measure all card heights (single reflow for all groups)
          const heightMap = new Map<HTMLElement, number>();
          for (const groupEl of groups) {
            const cards = groupEl.querySelectorAll<HTMLElement>(".card");
            for (const card of cards) {
              heightMap.set(card, card.offsetHeight);
            }
          }

          // Phase 2: Calculate and apply layout per group (no reflows)
          for (const groupEl of groups) {
            const cards = Array.from(
              groupEl.querySelectorAll<HTMLElement>(".card"),
            );
            if (cards.length === 0) continue;

            // Get pre-measured heights for this group's cards
            const heights = cards.map((card) => heightMap.get(card)!);

            const result = calculateMasonryLayout({
              cards,
              containerWidth,
              cardSize: settings.cardSize,
              minColumns,
              gap,
              heights,
            });

            applyMasonryLayout(groupEl, cards, result);

            // Store result for incremental append (keyed by group)
            const groupKey = getGroupKeyDataset(groupEl);
            this.groupLayoutResults.set(groupKey, result);
          }
        } else {
          // Ungrouped mode: single layout for all cards
          const cards = Array.from(
            this.masonryContainer.querySelectorAll<HTMLElement>(".card"),
          );
          if (cards.length === 0) return;

          const result = calculateMasonryLayout({
            cards,
            containerWidth,
            cardSize: settings.cardSize,
            minColumns,
            gap,
          });

          applyMasonryLayout(this.masonryContainer, cards, result);
          this.groupLayoutResults.set(undefined, result);
        }
      } finally {
        this.isUpdatingLayout = false;
        // Process any queued update
        if (this.pendingLayoutUpdate) {
          this.pendingLayoutUpdate = false;
          requestAnimationFrame(() => this.updateLayoutRef.current?.());
        }
      }
    };

    // Setup resize observer (c59fe2d simple version)
    const resizeObserver = new ResizeObserver(() => {
      if (this.updateLayoutRef.current) {
        this.updateLayoutRef.current();
      }
    });
    resizeObserver.observe(this.masonryContainer);
    this.register(() => resizeObserver.disconnect());

    // Setup window resize listener (c59fe2d had this)
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
    this.cardRenderer.renderCard(container, card, entry, settings, {
      index,
      focusableCardIndex: this.focusableCardIndex,
      containerRef: this.containerRef,
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

  private async appendBatch(
    totalEntries: number,
    settings: Settings,
  ): Promise<void> {
    // Guard: return early if data not initialized or no masonry container
    if (!this.data || !this.masonryContainer) return;

    // Increment render version to cancel any stale onDataUpdated renders
    this.renderVersion++;
    const currentVersion = this.renderVersion;

    const groupedData = this.data.groupedData;
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

      // For ungrouped mode (no group key), use masonryContainer directly
      // to match initial render structure
      if (currentGroupKey === undefined) {
        groupEl = this.masonryContainer;
        this.lastGroupKey = undefined;
        this.lastGroupContainer = this.masonryContainer;
      } else if (
        currentGroupKey === this.lastGroupKey &&
        this.lastGroupContainer?.isConnected
      ) {
        // Same group as last - append to existing container
        groupEl = this.lastGroupContainer;
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

    // Use incremental layout if we have previous state, otherwise fall back to full recalc
    // For grouped mode, use lastGroupKey; for ungrouped, use undefined
    const layoutKey = this.lastGroupContainer ? this.lastGroupKey : undefined;
    const prevLayout = this.groupLayoutResults.get(layoutKey);
    const targetContainer = this.lastGroupContainer ?? this.masonryContainer;

    // Ensure target container has masonry-container class for CSS height rule
    if (
      targetContainer &&
      !targetContainer.classList.contains("masonry-container")
    ) {
      targetContainer.classList.add("masonry-container");
    }

    if (prevLayout && newCardsRendered > 0 && targetContainer) {
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
        // Re-read prevLayout in case it was updated during async operations (#4)
        const currentPrevLayout = this.groupLayoutResults.get(layoutKey);

        // Validate refs are still valid after async delay (#5)
        if (!targetContainer?.isConnected || !currentPrevLayout) {
          return;
        }

        // If any card was disconnected, fall back to full recalc
        if (newCards.some((c) => !c.isConnected)) {
          this.updateLayoutRef.current?.();
          return;
        }

        // Sync responsive classes before measuring (ResizeObservers are async)
        const compactBreakpoint =
          parseFloat(
            getComputedStyle(document.body).getPropertyValue(
              "--dynamic-views-compact-breakpoint",
            ),
          ) || 400;

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

        // Track expected height so ResizeObserver can skip this change (#9)
        this.expectedIncrementalHeight = result.containerHeight;

        // Update container height (group container or main container)
        targetContainer.style.setProperty(
          "--masonry-height",
          `${result.containerHeight}px`,
        );

        // Store for next incremental append
        this.groupLayoutResults.set(layoutKey, result);
      };

      // Check if fixed cover height is enabled (heights are CSS-determined)
      const isFixedCoverHeight = document.body.classList.contains(
        "dynamic-views-masonry-fixed-cover-height",
      );

      // Double RAF ensures browser has completed layout calculation:
      // First RAF waits for pending style recalc, second ensures paint is complete
      // and all ResizeObserver callbacks have fired (#15)
      const runAfterLayout = (fn: () => void) => {
        requestAnimationFrame(() => requestAnimationFrame(fn));
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
            runAfterLayout(runIncrementalLayout);
          });
        }
      }
    }

    // Clear loading flag and re-setup infinite scroll
    this.isLoading = false;
    this.setupInfiniteScroll(totalEntries, settings);
  }

  private setupInfiniteScroll(totalEntries: number, settings?: Settings): void {
    const scrollContainer = this.scrollEl;
    // Clean up existing listeners (don't use this.register() since this method is called multiple times)
    if (this.scrollListener) {
      scrollContainer.removeEventListener("scroll", this.scrollListener);
      this.scrollListener = null;
    }
    if (this.scrollResizeObserver) {
      this.scrollResizeObserver.disconnect();
      this.scrollResizeObserver = null;
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
    this.scrollListener = () => {
      // Throttle: skip if cooldown active
      if (this.scrollThrottleTimeout !== null) {
        return;
      }

      checkAndLoad();

      // Start throttle cooldown with trailing call
      this.scrollThrottleTimeout = window.setTimeout(() => {
        this.scrollThrottleTimeout = null;
        checkAndLoad(); // Trailing call catches scroll position changes during throttle
      }, SCROLL_THROTTLE_MS);
    };

    // Attach scroll listener to scroll container
    scrollContainer.addEventListener("scroll", this.scrollListener);

    // Setup ResizeObserver on masonry container to detect layout changes
    if (this.masonryContainer) {
      let prevHeight = this.masonryContainer.offsetHeight;
      this.scrollResizeObserver = new ResizeObserver((entries) => {
        // Guard: skip if container disconnected from DOM
        if (!this.masonryContainer?.isConnected) return;

        const newHeight = entries[0]?.contentRect.height ?? 0;

        // Skip if this is the expected height from incremental layout (#9)
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
  }

  onunload(): void {
    this.scrollPreservation.cleanup();
    this.swipeAbortController?.abort();
    this.abortController?.abort();
    if (this.layoutTimeoutId) {
      clearTimeout(this.layoutTimeoutId);
    }
    if (this.resizeRafId !== null) {
      cancelAnimationFrame(this.resizeRafId);
    }
    // Clean up scroll-related resources
    if (this.scrollListener) {
      this.scrollEl.removeEventListener("scroll", this.scrollListener);
    }
    if (this.scrollThrottleTimeout !== null) {
      window.clearTimeout(this.scrollThrottleTimeout);
    }
    if (this.scrollResizeObserver) {
      this.scrollResizeObserver.disconnect();
    }
    this.cardRenderer.cleanup(true); // Force viewer cleanup on view destruction
  }

  focus(): void {
    this.containerEl.focus({ preventScroll: true });
  }
}

/** Export options for registration */
export const masonryViewOptions = getMasonryViewOptions;
