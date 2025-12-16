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
import { getCachedAspectRatio } from "../shared/image-loader";
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
} from "./utils";
import { setupHoverKeyboardNavigation } from "../shared/keyboard-nav";
import type DynamicViewsPlugin from "../../main";
import type { Settings } from "../types";

export const MASONRY_VIEW_TYPE = "dynamic-views-masonry";

// Module-level storage for first visible card - survives view instance recreation
// Keyed by leaf.id (stable across tab switches)
interface SavedScrollState {
  path: string;
  offset: number;
  width: number;
  height: number;
}
const savedScrollState = new Map<string, SavedScrollState>();

export class DynamicViewsMasonryView extends BasesView {
  readonly type = MASONRY_VIEW_TYPE;
  private scrollEl: HTMLElement;
  private leafId: string;
  private containerEl: HTMLElement;
  private plugin: DynamicViewsPlugin;
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
  // Last layout result for incremental append
  private lastLayoutResult: MasonryLayoutResult | null = null;
  // Skip ResizeObserver after incremental layout (height change is expected)
  private skipNextResize: boolean = false;
  // Track scroll state for restoration
  private savedState: SavedScrollState | null = null;
  // Flag to skip scroll save during tab switch (prevents corrupted saves)
  private isTabSwitching: boolean = false;

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
    // Store scroll parent reference for scroll preservation across tab switches
    this.scrollEl = scrollEl;
    // Get stable leaf ID for scroll position storage
    const leaf = this.app.workspace.getLeaf();
    this.leafId = (leaf as unknown as { id: string })?.id ?? "";
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
    const disconnectObserver = setupStyleSettingsObserver(() =>
      this.onDataUpdated(),
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

    // Listen for tab switches to prevent scroll save during reset
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.isTabSwitching = true;
        // Re-enable after scroll reset completes
        setTimeout(() => {
          this.isTabSwitching = false;
        }, 100);
      }),
    );

    // Track first visible card on scroll (more reliable than pixel position)
    const scrollSaveHandler = () => {
      // Skip save during tab switch (scroll resets to 0 during switch, would corrupt saved position)
      if (
        !this.masonryContainer ||
        this.scrollEl.scrollTop === 0 ||
        this.isTabSwitching
      )
        return;

      // Find topmost-leftmost visible card
      const cards =
        this.masonryContainer.querySelectorAll<HTMLElement>(".card");
      const scrollTop = this.scrollEl.scrollTop;
      const viewportBottom = scrollTop + this.scrollEl.clientHeight;

      let firstVisible: { path: string; top: number; left: number } | null =
        null;

      for (const card of cards) {
        const rect = card.getBoundingClientRect();
        const containerRect = this.scrollEl.getBoundingClientRect();
        const cardTop = rect.top - containerRect.top + scrollTop;
        const cardBottom = cardTop + rect.height;

        // Card is visible if any part is in viewport
        if (cardBottom > scrollTop && cardTop < viewportBottom) {
          const path = card.dataset.path;
          if (path) {
            if (
              !firstVisible ||
              cardTop < firstVisible.top ||
              (cardTop === firstVisible.top && rect.left < firstVisible.left)
            ) {
              firstVisible = { path, top: cardTop, left: rect.left };
            }
          }
        }
      }

      if (firstVisible) {
        const offset = scrollTop - firstVisible.top;
        const state: SavedScrollState = {
          path: firstVisible.path,
          offset,
          width: this.scrollEl.clientWidth,
          height: this.scrollEl.clientHeight,
        };
        this.savedState = state;
        if (this.leafId) {
          savedScrollState.set(this.leafId, state);
        }
        console.log(
          "MASONRY save - card:",
          firstVisible.path,
          "offset:",
          offset,
          "dims:",
          state.width,
          "x",
          state.height,
        );
      }
    };
    this.scrollEl.addEventListener("scroll", scrollSaveHandler, {
      passive: true,
    });
    this.register(() =>
      this.scrollEl.removeEventListener("scroll", scrollSaveHandler),
    );

    // Restore savedState from Map for cross-tab-switch restoration
    const saved = this.leafId ? savedScrollState.get(this.leafId) : null;
    if (saved) {
      this.savedState = saved;
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

      // Guard: skip full re-render if content already exists (returning to tab)
      if (this.masonryContainer?.children.length && this.savedState) {
        const dimsMatch =
          this.scrollEl.clientWidth === this.savedState.width &&
          this.scrollEl.clientHeight === this.savedState.height;

        console.log(
          "MASONRY onDataUpdated - hasContainer: true, savedCard:",
          this.savedState.path,
          "dimsMatch:",
          dimsMatch,
        );

        // Hide scrollbar during restoration to prevent flicker
        this.scrollEl.classList.add("dynamic-views-restoring-scroll");

        if (dimsMatch) {
          // Dims unchanged - positions valid, restore immediately with offset
          const card = this.masonryContainer.querySelector<HTMLElement>(
            `.card[data-path="${CSS.escape(this.savedState.path)}"]`,
          );
          if (card) {
            const containerRect = this.scrollEl.getBoundingClientRect();
            const cardRect = card.getBoundingClientRect();
            const cardTop =
              cardRect.top - containerRect.top + this.scrollEl.scrollTop;
            const targetScroll = cardTop + this.savedState.offset;
            this.scrollEl.scrollTop = targetScroll;
          }
          // Show scrollbar after restoration
          requestAnimationFrame(() => {
            this.scrollEl.classList.remove("dynamic-views-restoring-scroll");
          });
        } else {
          // Dims changed - must recalculate layout before reading positions
          // Use double RAF: first RAF waits for resize, second ensures layout applied
          const savedPath = this.savedState.path;
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (!this.masonryContainer || !this.updateLayoutRef.current) {
                this.scrollEl.classList.remove(
                  "dynamic-views-restoring-scroll",
                );
                return;
              }

              // Call layout twice - first sets widths, second reads correct heights
              this.updateLayoutRef.current();
              void this.masonryContainer.offsetHeight; // Force reflow
              this.updateLayoutRef.current();

              const card = this.masonryContainer.querySelector<HTMLElement>(
                `.card[data-path="${CSS.escape(savedPath)}"]`,
              );
              if (card) {
                const containerRect = this.scrollEl.getBoundingClientRect();
                const cardRect = card.getBoundingClientRect();
                const cardTop =
                  cardRect.top - containerRect.top + this.scrollEl.scrollTop;
                const gap = getCardSpacing(this.containerEl);
                const maxScroll =
                  this.scrollEl.scrollHeight - this.scrollEl.clientHeight;
                const targetScroll = Math.min(
                  Math.floor(cardTop - gap),
                  maxScroll,
                );
                this.scrollEl.scrollTop = targetScroll;
              }
              // Show scrollbar after restoration
              this.scrollEl.classList.remove("dynamic-views-restoring-scroll");
            });
          });
        }
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

      // Save scroll state before clearing DOM
      const savedStateSnapshot = this.savedState;

      // Clear and re-render
      this.containerEl.empty();

      // Reset batch append state for full re-render
      this.previousDisplayedCount = 0;
      this.lastGroupKey = undefined;
      this.lastGroupContainer = null;
      this.lastLayoutResult = null;

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
        renderGroupHeader(groupEl, processedGroup.group, this.config);

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

      // Initial layout calculation (c59fe2d timing - no double RAF to prevent flash)
      if (this.updateLayoutRef.current) {
        // Delay to allow images to start loading
        this.layoutTimeoutId = setTimeout(() => {
          if (this.updateLayoutRef.current) {
            this.updateLayoutRef.current();
          }
          // Restore by scrolling to saved card AFTER layout
          if (savedStateSnapshot && this.masonryContainer) {
            const card = this.masonryContainer.querySelector<HTMLElement>(
              `.card[data-path="${CSS.escape(savedStateSnapshot.path)}"]`,
            );
            console.log(
              "MASONRY setTimeout restore - card found:",
              !!card,
              "path:",
              savedStateSnapshot.path,
            );
            if (card) {
              const containerRect = this.scrollEl.getBoundingClientRect();
              const cardRect = card.getBoundingClientRect();
              const cardTop =
                cardRect.top - containerRect.top + this.scrollEl.scrollTop;

              // Check if dimensions changed - determines restore strategy
              const dimsMatch =
                this.scrollEl.clientWidth === savedStateSnapshot.width &&
                this.scrollEl.clientHeight === savedStateSnapshot.height;

              // If dims match, use offset; if dims changed, scroll to card top with gap visible
              const gap = getCardSpacing(this.containerEl);
              const maxScroll =
                this.scrollEl.scrollHeight - this.scrollEl.clientHeight;
              const targetScroll = dimsMatch
                ? cardTop + savedStateSnapshot.offset
                : Math.min(Math.floor(cardTop - gap), maxScroll);

              console.log(
                "MASONRY setTimeout restore - cardTop:",
                cardTop,
                "dimsMatch:",
                dimsMatch,
                "target:",
                targetScroll,
              );
              this.scrollEl.scrollTop = targetScroll;
            }
          }
        }, 50);
      } else if (savedStateSnapshot && this.masonryContainer) {
        // Fallback: no layout function, try restore anyway
        const card = this.masonryContainer.querySelector<HTMLElement>(
          `.card[data-path="${CSS.escape(savedStateSnapshot.path)}"]`,
        );
        if (card) {
          const containerRect = this.scrollEl.getBoundingClientRect();
          const cardRect = card.getBoundingClientRect();
          const cardTop =
            cardRect.top - containerRect.top + this.scrollEl.scrollTop;

          const dimsMatch =
            this.scrollEl.clientWidth === savedStateSnapshot.width &&
            this.scrollEl.clientHeight === savedStateSnapshot.height;
          const gap = getCardSpacing(this.containerEl);
          const maxScroll =
            this.scrollEl.scrollHeight - this.scrollEl.clientHeight;
          this.scrollEl.scrollTop = dimsMatch
            ? cardTop + savedStateSnapshot.offset
            : Math.min(Math.floor(cardTop - gap), maxScroll);
        }
      }

      // Setup infinite scroll outside setTimeout (c59fe2d pattern)
      this.setupInfiniteScroll(allEntries.length, settings);
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
          gap: getCardSpacing(this.containerEl),
        });

        // Apply layout to DOM
        applyMasonryLayout(this.masonryContainer, cards, result);

        // Store result for incremental append
        this.lastLayoutResult = result;
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
        ? processedGroup.group.key?.toString()
        : undefined;

      if (currentGroupKey === this.lastGroupKey && this.lastGroupContainer) {
        // Same group as last - append to existing container
        groupEl = this.lastGroupContainer;
      } else {
        // New group - create container
        groupEl = this.masonryContainer.createDiv("dynamic-views-group");

        // Render group header if key exists
        renderGroupHeader(groupEl, processedGroup.group, this.config);

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
    if (
      this.lastLayoutResult &&
      newCardsRendered > 0 &&
      this.masonryContainer
    ) {
      // Get only the newly rendered cards (guard against slice(-0) returning entire array)
      const allCards = Array.from(
        this.masonryContainer.querySelectorAll<HTMLElement>(".card"),
      );
      const newCards =
        newCardsRendered > 0 ? allCards.slice(-newCardsRendered) : [];

      // Pre-set width on new cards BEFORE measuring heights
      // This ensures text wrapping is correct when we read offsetHeight
      const cardWidth = this.lastLayoutResult.cardWidth;
      newCards.forEach((card) => {
        card.style.setProperty("--masonry-width", `${cardWidth}px`);
      });

      // Function to run incremental layout
      const runIncrementalLayout = () => {
        if (!this.masonryContainer || !this.lastLayoutResult) return;

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
        void this.masonryContainer.offsetHeight;

        const gap = getCardSpacing(this.containerEl);

        const result = calculateIncrementalMasonryLayout({
          newCards,
          columnHeights: this.lastLayoutResult.columnHeights,
          containerWidth: this.lastLayoutResult.containerWidth,
          cardWidth: this.lastLayoutResult.cardWidth,
          columns: this.lastLayoutResult.columns,
          gap,
        });

        // Apply positions to new cards only (width already set above)
        newCards.forEach((card, index) => {
          const pos = result.positions[index];
          card.classList.add("masonry-positioned");
          card.style.setProperty("--masonry-left", `${pos.left}px`);
          card.style.setProperty("--masonry-top", `${pos.top}px`);
        });

        // Skip ResizeObserver triggers from this height change
        this.skipNextResize = true;
        setTimeout(() => {
          this.skipNextResize = false;
        }, 200);

        // Update container height
        this.masonryContainer.style.setProperty(
          "--masonry-height",
          `${result.containerHeight}px`,
        );

        // Store for next incremental append
        this.lastLayoutResult = result;
      };

      // Check if fixed cover height is enabled (heights are CSS-determined)
      const isFixedCoverHeight = document.body.classList.contains(
        "dynamic-views-masonry-fixed-cover-height",
      );

      // Helper to run layout after DOM is fully rendered
      // Double RAF ensures browser has completed layout calculation
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
    // Find the actual scroll container (parent in Bases views)
    const scrollContainer = this.containerEl.parentElement || this.containerEl;
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
      // Skip if already loading or if resize triggered by incremental layout
      if (this.isLoading || this.skipNextResize) {
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
    // Don't delete scroll position from Map - we need it for tab switch restoration
    // Map entries are cleaned up when leaf is actually closed (not on tab switch)
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
      const scrollContainer =
        this.containerEl.parentElement || this.containerEl;
      scrollContainer.removeEventListener("scroll", this.scrollListener);
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
