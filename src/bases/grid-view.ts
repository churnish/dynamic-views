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

// Extend App type to include isMobile property
declare module "obsidian" {
  interface App {
    isMobile: boolean;
  }
}

export const GRID_VIEW_TYPE = "dynamic-views-grid";

// Module-level storage for first visible card - survives view instance recreation
// Keyed by leaf.id (stable across tab switches)
interface SavedScrollState {
  path: string;
  offset: number;
  width: number;
  height: number;
}
const savedScrollState = new Map<string, SavedScrollState>();

export class DynamicViewsCardView extends BasesView {
  readonly type = GRID_VIEW_TYPE;
  private scrollEl: HTMLElement;
  private leafId: string;
  private containerEl: HTMLElement;
  private plugin: DynamicViewsPlugin;
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
  // Track scroll state for restoration
  private savedState: SavedScrollState | null = null;
  // Flag to skip scroll save during tab switch (prevents corrupted saves)
  private isTabSwitching: boolean = false;

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
      () => this.feedContainerRef.current,
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
        !this.feedContainerRef.current ||
        this.scrollEl.scrollTop === 0 ||
        this.isTabSwitching
      )
        return;

      // Find topmost-leftmost visible card
      const cards =
        this.feedContainerRef.current.querySelectorAll<HTMLElement>(".card");
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
      if (this.feedContainerRef.current?.children.length && this.savedState) {
        const dimsMatch =
          this.scrollEl.clientWidth === this.savedState.width &&
          this.scrollEl.clientHeight === this.savedState.height;

        // Hide scrollbar during restoration to prevent flicker
        this.scrollEl.classList.add("dynamic-views-restoring-scroll");

        if (dimsMatch) {
          // Dims unchanged - positions valid, restore immediately with offset
          const card = this.feedContainerRef.current.querySelector<HTMLElement>(
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
          // Dims changed - grid auto-adjusts columns, just need to find card and scroll
          // Use double RAF to ensure layout has settled after resize
          const savedPath = this.savedState.path;
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (!this.feedContainerRef.current) {
                this.scrollEl.classList.remove(
                  "dynamic-views-restoring-scroll",
                );
                return;
              }

              const card =
                this.feedContainerRef.current.querySelector<HTMLElement>(
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

      // Setup infinite scroll
      this.setupInfiniteScroll(allEntries.length, settings);

      // Setup ResizeObserver for dynamic grid updates
      if (!this.resizeObserver) {
        this.resizeObserver = new ResizeObserver(() => {
          // Guard: skip if container disconnected from DOM
          if (!this.containerEl?.isConnected) return;

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
        });
        this.resizeObserver.observe(this.containerEl);
        this.register(() => this.resizeObserver?.disconnect());
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

    // Clear loading flag and re-setup infinite scroll
    this.isLoading = false;
    this.setupInfiniteScroll(totalEntries, settings);
  }

  private setupInfiniteScroll(totalEntries: number, settings?: Settings): void {
    // Find the actual scroll container (parent in Bases views)
    const scrollContainer = this.containerEl.parentElement || this.containerEl;

    // Clean up existing listener (don't use this.register() since this method is called multiple times)
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

      // Start throttle cooldown
      this.scrollThrottleTimeout = window.setTimeout(() => {
        this.scrollThrottleTimeout = null;
      }, SCROLL_THROTTLE_MS);
    };

    // Attach listener to scroll container
    scrollContainer.addEventListener("scroll", this.scrollListener);
  }

  onunload(): void {
    // Don't delete scroll position from Map - we need it for tab switch restoration
    // Map entries are cleaned up when leaf is actually closed (not on tab switch)
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
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
