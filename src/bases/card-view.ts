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
import { BATCH_SIZE } from "../shared/constants";
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
  private snippets: Record<string, string> = {};
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
    this.displayedCount = this.app.isMobile ? 25 : BATCH_SIZE;

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
      const processedGroups = groupedData.map((group) => {
        let groupEntries = [...group.entries];

        if (this.isShuffled && this.shuffledOrder.length > 0) {
          // Sort by shuffled order within this group
          groupEntries = groupEntries.sort((a, b) => {
            const indexA = this.shuffledOrder.indexOf(a.file.path);
            const indexB = this.shuffledOrder.indexOf(b.file.path);
            return indexA - indexB;
          });
        }

        return { group, entries: groupEntries };
      });

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

      // Load snippets and images ONLY for displayed entries
      await loadContentForEntries(
        visibleEntries,
        settings,
        this.app,
        this.snippets,
        this.images,
        this.hasImageAvailable,
      );

      // Clear and re-render
      this.containerEl.empty();

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
        if (processedGroup.group.hasKey()) {
          const headerEl = groupEl.createDiv("bases-group-heading");

          // Add group property label if groupBy is configured
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
          const groupBy = (this.config as any).groupBy;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          if (groupBy?.property) {
            const propertyEl = headerEl.createDiv("bases-group-property");
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
            const propertyName = this.config.getDisplayName(groupBy.property);
            propertyEl.setText(propertyName);
          }

          // Add group value
          const valueEl = headerEl.createDiv("bases-group-value");
          const keyValue = processedGroup.group.key?.toString() || "";
          valueEl.setText(keyValue);
        }

        // Render cards in this group
        const cards = transformBasesEntries(
          this.app,
          groupEntries,
          settings,
          sortMethod,
          false,
          this.snippets,
          this.images,
          this.hasImageAvailable,
        );

        for (let i = 0; i < cards.length; i++) {
          const card = cards[i];
          const entry = groupEntries[i];
          this.renderCard(groupEl, card, entry, displayedSoFar + i, settings);
        }

        displayedSoFar += entriesToDisplay;
      }

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

      // Clear loading flag after async work completes
      this.isLoading = false;
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

  private setupInfiniteScroll(totalEntries: number): void {
    // Clean up existing listener
    if (this.scrollListener) {
      this.containerEl.removeEventListener("scroll", this.scrollListener);
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

      // Calculate distance from bottom
      const scrollTop = this.containerEl.scrollTop;
      const scrollHeight = this.containerEl.scrollHeight;
      const clientHeight = this.containerEl.clientHeight;
      const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);

      // Dynamic threshold based on viewport and device
      const isMobile = this.app.isMobile;
      const viewportMultiplier = isMobile ? 1 : 2;
      const threshold = clientHeight * viewportMultiplier;

      // Check if should load more
      if (
        distanceFromBottom < threshold &&
        this.displayedCount < totalEntries
      ) {
        this.isLoading = true;

        // Dynamic batch size: 50 items (simple for card view)
        const batchSize = 50;
        this.displayedCount = Math.min(
          this.displayedCount + batchSize,
          totalEntries,
        );

        // Re-render (this will call setupInfiniteScroll again)
        this.onDataUpdated();
      }

      // Start throttle cooldown
      this.scrollThrottleTimeout = window.setTimeout(() => {
        this.scrollThrottleTimeout = null;
      }, 100);
    };

    // Attach listener
    this.containerEl.addEventListener("scroll", this.scrollListener);

    // Register cleanup
    this.register(() => {
      if (this.scrollListener) {
        this.containerEl.removeEventListener("scroll", this.scrollListener);
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
