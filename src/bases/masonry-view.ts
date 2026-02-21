/**
 * Bases Masonry View
 * Masonry layout view using Bases API
 */

import type { BasesViewConfig, ViewOption } from "obsidian";
import { BasesView, BasesEntry, QueryController, TFile } from "obsidian";
import { CardData } from "../shared/card-renderer";
import {
  basesEntryToCardData,
  transformBasesEntries,
} from "../shared/data-transform";
import {
  readBasesSettings,
  getMasonryViewOptions,
} from "../shared/settings-schema";
import {
  getCardSpacing,
  clearStyleSettingsCache,
} from "../utils/style-settings";
import {
  initializeScrollGradients,
  initializeScrollGradientsForCards,
} from "../shared/scroll-gradient";
import {
  calculateMasonryLayout,
  calculateMasonryDimensions,
  calculateIncrementalMasonryLayout,
  repositionWithStableColumns,
  computeGreedyColumnHeights,
  type MasonryLayoutResult,
} from "../utils/masonry-layout";
import {
  SharedCardRenderer,
  initializeTitleTruncation,
  initializeTitleTruncationForCards,
  syncResponsiveClasses,
  applyViewContainerStyles,
  type CardHandle,
} from "./shared-renderer";
import { getCachedAspectRatio } from "../shared/image-loader";
import {
  PANE_MULTIPLIER,
  ROWS_PER_COLUMN,
  MAX_BATCH_SIZE,
  SCROLL_THROTTLE_MS,
  MASONRY_CORRECTION_MS,
} from "../shared/constants";
import {
  setupBasesSwipePrevention,
  setupStyleSettingsObserver,
  getStyleSettingsHash,
  getSortMethod,
  loadContentForEntries,
  processGroups,
  renderGroupHeader,
  hasGroupBy,
  serializeGroupKey,
  setGroupKeyDataset,
  getGroupKeyDataset,
  UNDEFINED_GROUP_KEY_SENTINEL,
  cleanUpBaseFile,
  shouldProcessDataUpdate,
  handleTemplateToggle,
} from "./utils";
import {
  initializeContainerFocus,
  setupHoverKeyboardNavigation,
} from "../shared/keyboard-nav";
import {
  ScrollPreservation,
  getLeafProps,
} from "../shared/scroll-preservation";
import {
  PROPERTY_MEASURED_EVENT,
  cleanupVisibilityObserver,
  resetGapCache,
} from "../shared/property-measure";
import {
  buildDisplayToSyntaxMap,
  buildSyntaxToDisplayMap,
  normalizeSettingsPropertyNames,
} from "../utils/property";
import type DynamicViews from "../../main";
import type {
  BasesResolvedSettings,
  ContentCache,
  RenderState,
  LastGroupState,
  ScrollThrottleState,
  SortState,
  FocusState,
} from "../types";
import { CONTENT_HIDDEN_CLASS } from "../shared/content-visibility";
import { updateTextPreviewDOM } from "../shared/text-preview-dom";
import {
  type VirtualItem,
  measureScalableHeight,
  estimateUnmountedHeight,
} from "../shared/virtual-scroll";

// Extend Obsidian types
declare module "obsidian" {
  interface BasesView {
    file: TFile;
  }
}

export const MASONRY_VIEW_TYPE = "dynamic-views-masonry";

export class DynamicViewsMasonryView extends BasesView {
  readonly type = MASONRY_VIEW_TYPE;
  private scrollEl: HTMLElement;
  private leafId: string;
  private containerEl: HTMLElement;
  private plugin: DynamicViews;
  private scrollPreservation: ScrollPreservation | null = null;
  private cardRenderer: SharedCardRenderer;
  private _resolvedFile: TFile | null | undefined = undefined;
  private _collapsedGroupsLoaded = false;
  private _previousCustomClasses: string[] = [];

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
    lastPropertySetHash: null,
    lastSettingsHashExcludingOrder: null,
    lastMtimes: new Map(),
  };
  // Track last rendered settings to detect stale config (see readBasesSettings)
  private lastRenderedSettings: BasesResolvedSettings | null = null;
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
  private lastTitleProperty: string | null = null;
  private lastSubtitleProperty: string | null = null;
  private focusCleanup: (() => void) | null = null;
  private templateInitializedRef = { value: false };
  private templateCooldownRef = {
    value: null as ReturnType<typeof setTimeout> | null,
  };

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
  get viewScrollEl(): HTMLElement {
    return this.scrollEl;
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
  private batchLayoutPending: boolean = false;
  private pendingImageRelayout: boolean = false;
  private pendingDeferredResize = false;
  private resizeCorrectionTimeout: number | null = null;

  private scrollResizeObserver: ResizeObserver | null = null;
  private containerRef: { current: HTMLElement | null } = { current: null };
  private previousDisplayedCount: number = 0;
  private layoutResizeObserver: ResizeObserver | null = null;
  private cardResizeObserver: ResizeObserver | null = null;
  private observerWindow: (Window & typeof globalThis) | null = null;
  private cardResizeRafId: number | null = null;
  private groupLayoutResults: Map<string | undefined, MasonryLayoutResult> =
    new Map();
  private virtualItems: VirtualItem[] = [];
  private virtualItemsByGroup = new Map<string | undefined, VirtualItem[]>();
  private groupContainers: Map<string | undefined, HTMLElement> = new Map();
  private virtualScrollRafId: number | null = null;
  private scrollRemeasureTimeout: ReturnType<typeof setTimeout> | null = null;
  private hasExplicitScrollHeights = false;
  private isCompensatingScroll = false;
  private deferredRemeasureRafId: number | null = null;
  private hasUserScrolled = false;
  private expectedIncrementalHeight: number | null = null;
  private totalEntries: number = 0;
  private displayedSoFar: number = 0;
  /** Latest container width from ResizeObserver. Never reset — deferred resize
   *  at scroll-idle reads the most recent value, which is always the correct
   *  target width regardless of when the deferral was scheduled. */
  private pendingResizeWidth: number | null = null;
  private cachedGroupOffsets: Map<string | undefined, number> = new Map();
  private lastLayoutCardWidth: number = 0;
  private lastLayoutGap: number = 0;
  private lastLayoutMinColumns: number = 1;
  private lastLayoutIsGrouped: boolean = false;
  private propertyMeasuredTimeout: number | null = null;
  private lastDataUpdateTime = { value: 0 };
  private trailingUpdate: {
    timeoutId: number | null;
    callback: (() => void) | null;
    isTrailing?: boolean;
  } = {
    timeoutId: null,
    callback: null,
  };
  private collapsedGroups: Set<string> = new Set();
  private viewId: string | null = null;

  /** Get the current file by resolving from the leaf's view state (cached).
   *  controller.currentFile is a shared global that can return the wrong file. */
  private get currentFile(): TFile | null {
    if (this._resolvedFile !== undefined) return this._resolvedFile;
    this._resolvedFile = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view?.containerEl?.contains(this.scrollEl)) {
        const path = (leaf.view.getState() as { file?: string })?.file;
        if (path) {
          const abstract = this.app.vault.getAbstractFileByPath(path);
          this._resolvedFile = abstract instanceof TFile ? abstract : null;
        }
      }
    });
    return this._resolvedFile;
  }

  /** Get the collapse key for a group (sentinel for undefined keys) */
  private getCollapseKey(groupKey: string | undefined): string {
    return groupKey ?? UNDEFINED_GROUP_KEY_SENTINEL;
  }

  /** Toggle collapse state for a group and persist */
  private toggleGroupCollapse(
    collapseKey: string,
    headerEl: HTMLElement,
  ): void {
    const wasCollapsed = this.collapsedGroups.has(collapseKey);
    if (wasCollapsed) {
      this.collapsedGroups.delete(collapseKey);
      headerEl.removeClass("collapsed");
    } else {
      this.collapsedGroups.add(collapseKey);
      headerEl.addClass("collapsed");
    }

    // Persist collapse state (async — in-memory state is authoritative)
    void this.plugin.persistenceManager.setBasesState(
      this.viewId ?? undefined,
      {
        collapsedGroups: Array.from(this.collapsedGroups),
      },
    );

    const groupEl = headerEl.nextElementSibling as HTMLElement | null;
    if (wasCollapsed) {
      // Expanding: surgically populate only this group (avoids full re-render flash)
      if (groupEl && this.data) {
        void this.expandGroup(collapseKey, groupEl);
      }
    } else {
      // Collapsing: destroy cards, then scroll header to viewport top — all
      // synchronous so no paint occurs between removing sticky and adjusting
      // scroll (prevents flicker). Empty first so the measurement reflects
      // the final layout (group content removed).
      if (groupEl) groupEl.empty();
      this.renderState.lastRenderHash = "";
      const headerTop = headerEl.getBoundingClientRect().top;
      const scrollTop = this.scrollEl.getBoundingClientRect().top;
      // Only scroll when the header was stuck (now above the viewport)
      if (headerTop < scrollTop) {
        this.scrollEl.scrollTop += headerTop - scrollTop;
      }
      // Trigger scroll check — collapsing reduces height, may need to load more
      this.scrollEl.dispatchEvent(new Event("scroll"));
    }
  }

  /** Populate a single group's cards without re-rendering the entire view */
  private async expandGroup(
    collapseKey: string,
    groupEl: HTMLElement,
  ): Promise<void> {
    if (!this.data) return;
    const currentVersion = this.renderState.version;

    // Find the matching group in data
    const group = this.data.groupedData.find((g) => {
      const gk = g.hasKey() ? serializeGroupKey(g.key) : undefined;
      return this.getCollapseKey(gk) === collapseKey;
    });
    if (!group) return;

    const settings = readBasesSettings(
      this.config,
      this.plugin.persistenceManager.getPluginSettings(),
      "masonry",
      this.lastRenderedSettings ?? undefined,
    );

    // Normalize property names once — downstream code uses pre-normalized values
    const reverseMap = buildDisplayToSyntaxMap(this.config, this.allProperties);
    const displayNameMap = buildSyntaxToDisplayMap(
      this.config,
      this.allProperties,
    );
    normalizeSettingsPropertyNames(
      this.app,
      settings,
      reverseMap,
      displayNameMap,
    );

    const sortMethod = getSortMethod(this.config);

    // processGroups for shuffle-stable ordering
    const processed = processGroups(
      [group],
      this.sortState.isShuffled,
      this.sortState.order,
    );
    const entries = processed[0]?.entries ?? [];
    if (entries.length === 0) return;

    // Load content (cache-hit no-op for already-loaded entries)
    await loadContentForEntries(
      entries,
      settings,
      this.app,
      this.contentCache.textPreviews,
      this.contentCache.images,
      this.contentCache.hasImageAvailable,
    );

    // Bail if a new render started during content loading
    if (this.renderState.version !== currentVersion) return;

    const cards = transformBasesEntries(
      this.app,
      entries,
      settings,
      sortMethod,
      false,
      this.config.getOrder(),
      this.contentCache.textPreviews,
      this.contentCache.images,
      this.contentCache.hasImageAvailable,
    );

    // Count cards in preceding groups for correct card index
    const precedingCards = groupEl.parentElement
      ? Array.from(
          groupEl.parentElement.querySelectorAll<HTMLElement>(
            ".bases-cards-group",
          ),
        )
          .filter((el) => el !== groupEl)
          .reduce(
            (sum, el) =>
              sum +
              (el.compareDocumentPosition(groupEl) &
              Node.DOCUMENT_POSITION_FOLLOWING
                ? el.querySelectorAll(".card").length
                : 0),
            0,
          )
      : 0;

    const expandGroupKey = getGroupKeyDataset(groupEl);
    for (let i = 0; i < cards.length; i++) {
      const handle = this.renderCard(
        groupEl,
        cards[i],
        entries[i],
        precedingCards + i,
        settings,
      );
      this.virtualItems.push({
        index: precedingCards + i,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        measuredHeight: 0,
        measuredAtWidth: 0,
        scalableHeight: 0,
        fixedHeight: 0,
        col: 0,
        cardData: cards[i],
        entry: entries[i],
        groupKey: expandGroupKey,
        el: handle.el,
        handle,
      });
    }
    this.rebuildGroupIndex();

    // Masonry layout calculation + post-render hooks
    if (this.updateLayoutRef.current) {
      this.updateLayoutRef.current("expand-group");
    }
    const newCards = Array.from(groupEl.querySelectorAll<HTMLElement>(".card"));
    if (syncResponsiveClasses(newCards)) {
      this.updateLayoutRef.current?.("compact-mode-sync");
    }
    initializeScrollGradients(groupEl);
    initializeTitleTruncation(groupEl);

    // Invalidate render hash so next onDataUpdated() doesn't skip
    this.renderState.lastRenderHash = "";
  }

  /** Whether this view has grouped data */
  public get isGrouped(): boolean {
    return hasGroupBy(this.config) && (this.data?.groupedData?.length ?? 0) > 0;
  }

  /** Fold all groups — called by command palette */
  public foldAllGroups(): void {
    if (!this.data) return;
    // Collect all group keys from data (not DOM — infinite scroll may not have rendered all)
    for (const g of this.data.groupedData) {
      const groupKey = g.hasKey() ? serializeGroupKey(g.key) : undefined;
      this.collapsedGroups.add(this.getCollapseKey(groupKey));
    }
    void this.plugin.persistenceManager.setBasesState(
      this.viewId ?? undefined,
      {
        collapsedGroups: Array.from(this.collapsedGroups),
      },
    );
    this.renderState.lastRenderHash = "";
    this.onDataUpdated();
  }

  /** Unfold all groups — called by command palette */
  public unfoldAllGroups(): void {
    this.collapsedGroups.clear();
    void this.plugin.persistenceManager.setBasesState(
      this.viewId ?? undefined,
      {
        collapsedGroups: [],
      },
    );
    this.onDataUpdated();
  }

  /** Calculate batch size based on current column count */
  private getBatchSize(settings: BasesResolvedSettings): number {
    if (!this.masonryContainer) return MAX_BATCH_SIZE;
    const minColumns = settings.minimumColumns;
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
  private calculateInitialCount(settings: BasesResolvedSettings): number {
    // Use getBoundingClientRect for actual rendered width (clientWidth rounds fractional pixels)
    const containerWidth = Math.floor(
      this.containerEl.getBoundingClientRect().width,
    );
    const minColumns = settings.minimumColumns;
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
  private checkAndLoadMore(
    totalEntries: number,
    settings: BasesResolvedSettings,
  ): void {
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

  /** Apply CSS-only settings immediately for instant feedback (bypasses throttle) */
  private applyCssOnlySettings(): void {
    if (!this.config || !this.containerEl) return;

    const textPreviewLines = this.config.get("textPreviewLines");
    if (typeof textPreviewLines === "number") {
      this.containerEl.style.setProperty(
        "--dynamic-views-text-preview-lines",
        String(textPreviewLines),
      );
    }

    const titleLines = this.config.get("titleLines");
    if (typeof titleLines === "number") {
      this.containerEl.style.setProperty(
        "--dynamic-views-title-lines",
        String(titleLines),
      );
    }

    const imageRatio = this.config.get("imageRatio");
    if (typeof imageRatio === "number") {
      this.containerEl.style.setProperty(
        "--dynamic-views-image-aspect-ratio",
        String(imageRatio),
      );
    }

    const thumbnailSize = this.config.get("thumbnailSize");
    if (typeof thumbnailSize === "number") {
      this.containerEl.style.setProperty(
        "--dynamic-views-thumbnail-size",
        `${thumbnailSize}px`,
      );
    }
  }

  /**
   * Handle template toggle changes
   * Called from onDataUpdated() since Obsidian calls that for config changes
   */
  private handleTemplateToggleLocal(): void {
    handleTemplateToggle(
      this.config,
      "masonry",
      this.plugin,
      this.templateInitializedRef,
      this.templateCooldownRef,
    );
  }

  constructor(controller: QueryController, scrollEl: HTMLElement) {
    super(controller);
    // Note: this.config is undefined in constructor (assigned later by QueryController.update())
    // Template defaults are applied via schema defaults in getMasonryViewOptions()

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
    this.plugin = this.app.plugins.plugins["dynamic-views"] as DynamicViews;
    // Initialize shared card renderer
    this.cardRenderer = new SharedCardRenderer(
      this.app,
      this.plugin,
      this.updateLayoutRef,
    );

    // Get plugin settings for feature flags
    const pluginSettings = this.plugin.persistenceManager.getPluginSettings();

    // Placeholder - calculated dynamically on first render
    this.displayedCount = 0;

    // Setup swipe prevention on mobile if enabled
    setupBasesSwipePrevention(this.containerEl, this.app, pluginSettings);

    // Watch for Dynamic Views Style Settings changes only
    const disconnectObserver = setupStyleSettingsObserver(() => {
      resetGapCache(); // Invalidate gap cache on settings change
      this.onDataUpdated();
    });
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
          // Sync responsive classes and gradients after measurement (widths may have changed)
          if (this.masonryContainer) {
            const cards = Array.from(
              this.masonryContainer.querySelectorAll<HTMLElement>(".card"),
            );
            syncResponsiveClasses(cards);
            initializeScrollGradients(this.masonryContainer);
            initializeTitleTruncation(this.masonryContainer);
          }
        });
      }, 100);
    };
    const propertyEventDoc = this.containerEl.ownerDocument;
    propertyEventDoc.addEventListener(
      PROPERTY_MEASURED_EVENT,
      handlePropertyMeasured,
    );
    this.register(() => {
      propertyEventDoc.removeEventListener(
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
    // Handle template toggle changes (Obsidian calls onDataUpdated for config changes)
    this.handleTemplateToggleLocal();

    // CSS fast-path: apply CSS-only settings immediately (bypasses throttle)
    this.applyCssOnlySettings();

    // Delay reading config - Obsidian may fire onDataUpdated before updating config.getOrder()
    // Using queueMicrotask gives Obsidian time to finish updating config state.
    queueMicrotask(() => this.processDataUpdate());
  }

  /** Internal handler after config has settled */
  private processDataUpdate(): void {
    this.trailingUpdate.isTrailing = false;

    // Set callback for trailing calls (hybrid throttle)
    // Must call onDataUpdated (not processDataUpdate) to include CSS fast-path
    this.trailingUpdate.callback = () => this.onDataUpdated();

    // Throttle: Obsidian fires duplicate onDataUpdated calls with stale config.
    // Hybrid throttle: leading-edge for immediate response, trailing to catch coalesced updates.
    if (
      !shouldProcessDataUpdate(this.lastDataUpdateTime, this.trailingUpdate)
    ) {
      return;
    }

    void (async () => {
      // Only run cleanup on first render or when view is renamed.
      // Skipping on subsequent renders avoids vault.process() racing with
      // Obsidian's debounced config.set() file writes (overwrites pending settings).
      const viewName = this.config?.name;
      if (!this.viewId || (viewName && !this.viewId.endsWith(`-${viewName}`))) {
        const viewIds = await cleanUpBaseFile(
          this.app,
          this.currentFile,
          this.plugin,
          viewName,
        );
        this.viewId = (viewName && viewIds?.get(viewName)) ?? null;
      }

      // Load collapsed groups from persisted UI state only on first render.
      // After that, the in-memory Set is authoritative (toggleGroupCollapse persists changes).
      // Reloading on every onDataUpdated is unsafe: style-settings triggers onDataUpdated
      // with stale persistence or wrong-file lookups, wiping the in-memory state.
      if (!this._collapsedGroupsLoaded) {
        const basesState = this.plugin.persistenceManager.getBasesState(
          this.viewId ?? undefined,
        );
        this.collapsedGroups = new Set(basesState.collapsedGroups ?? []);
        this._collapsedGroupsLoaded = true;
      }

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

      // Template overrides for first render (config not yet populated from YAML).
      // For existing views, config.get() returns saved values so overrides are never reached.
      const templateOverrides = !this.lastRenderedSettings
        ? this.plugin.persistenceManager.getSettingsTemplate("masonry")
        : undefined;

      // Read settings — pass lastRenderedSettings for stale config fallback,
      // and templateOverrides so new views render with template values immediately
      const settings = readBasesSettings(
        this.config,
        this.plugin.persistenceManager.getPluginSettings(),
        "masonry",
        this.lastRenderedSettings ?? undefined,
        templateOverrides,
      );
      this.lastRenderedSettings = settings;

      // Normalize property names once — downstream code uses pre-normalized values
      const reverseMap = buildDisplayToSyntaxMap(
        this.config,
        this.allProperties,
      );
      const displayNameMap = buildSyntaxToDisplayMap(
        this.config,
        this.allProperties,
      );
      normalizeSettingsPropertyNames(
        this.app,
        settings,
        reverseMap,
        displayNameMap,
      );

      // Apply per-view CSS classes and variables to container
      applyViewContainerStyles(this.containerEl, settings);

      // Apply custom CSS classes from settings (mimics cssclasses frontmatter)
      const customClasses = settings.cssclasses
        .split(",")
        .map((cls) => cls.trim())
        .filter(Boolean);

      // Only update if classes changed (prevents unnecessary DOM mutations)
      const classesChanged =
        this._previousCustomClasses.length === 0 ||
        this._previousCustomClasses.length !== customClasses.length ||
        !this._previousCustomClasses.every(
          (cls, i) => cls === customClasses[i],
        );

      if (classesChanged) {
        // Clear previous custom classes
        if (this._previousCustomClasses.length > 0) {
          this._previousCustomClasses.forEach((cls: string) => {
            this.scrollEl.removeClass(cls);
          });
        }

        // Apply new custom classes
        customClasses.forEach((cls) => {
          this.scrollEl.addClass(cls);
        });

        // Store for next update
        this._previousCustomClasses = customClasses;
      }

      // Check if data or settings changed - skip re-render if not (prevents tab switch flash)
      // Use null byte delimiter (cannot appear in file paths) to avoid hash collisions
      const groupByProperty = hasGroupBy(this.config)
        ? this.config.groupBy?.property
        : undefined;
      const sortMethod = getSortMethod(this.config);
      const visibleProperties = this.config.getOrder();
      // Exclude CSS-only settings from hash — they're applied instantly via
      // applyCssOnlySettings() and don't need a full DOM rebuild
      const {
        textPreviewLines: _tpl,
        titleLines: _tl,
        imageRatio: _ir,
        thumbnailSize: _ts,
        ...hashableSettings
      } = settings;
      const settingsHash =
        JSON.stringify(hashableSettings) +
        "\0\0" +
        JSON.stringify(visibleProperties) +
        "\0\0" +
        sortMethod +
        "\0\0" +
        (groupByProperty ?? "");
      const propertySetHash = [...visibleProperties].sort().join("\0");
      // Further exclude order-derived settings for reorder detection
      // (titleProperty, subtitleProperty, _skipLeadingProperties change when
      // displayFirstAsTitle derives them from property order positions)
      const {
        titleProperty: _tp,
        subtitleProperty: _sp,
        _skipLeadingProperties: _slp,
        ...orderIndependentSettings
      } = hashableSettings;
      const settingsHashExcludingOrder =
        JSON.stringify(orderIndependentSettings) +
        "\0\0" +
        sortMethod +
        "\0\0" +
        (groupByProperty ?? "");
      const styleSettingsHash = getStyleSettingsHash();
      // Include mtime and sortMethod in hash so content/sort changes trigger updates
      const collapsedHash = Array.from(this.collapsedGroups).sort().join("\0");
      const renderHash =
        allEntries
          .map((e: BasesEntry) => `${e.file.path}:${e.file.stat.mtime}`)
          .join("\0") +
        "\0\0" +
        settingsHash +
        "\0\0" +
        (groupByProperty ?? "") +
        "\0\0" +
        sortMethod +
        "\0\0" +
        styleSettingsHash +
        "\0\0" +
        collapsedHash +
        "\0\0" +
        String(this.sortState.isShuffled) +
        "\0\0" +
        this.sortState.order.join("\0") +
        "\0\0" +
        JSON.stringify(visibleProperties);

      // Detect files with changed content (mtime changed but paths unchanged)
      const changedPaths = new Set<string>();
      const currentPaths = allEntries
        .map((e) => e.file.path)
        .sort()
        .join("\0");
      const lastPaths = Array.from(this.renderState.lastMtimes.keys())
        .sort()
        .join("\0");
      const pathsUnchanged = currentPaths === lastPaths;

      for (const entry of allEntries) {
        const path = entry.file.path;
        const mtime = entry.file.stat.mtime;
        const lastMtime = this.renderState.lastMtimes.get(path);
        if (lastMtime !== undefined && lastMtime !== mtime) {
          changedPaths.add(path);
        }
      }

      // Update mtime tracking
      this.renderState.lastMtimes.clear();
      for (const entry of allEntries) {
        this.renderState.lastMtimes.set(entry.file.path, entry.file.stat.mtime);
      }

      if (
        renderHash === this.renderState.lastRenderHash &&
        this.masonryContainer?.children.length
      ) {
        // Obsidian may fire onDataUpdated before config.getOrder() is updated.
        // Schedule delayed re-checks at increasing intervals to catch late config updates.
        const propsSnapshot = JSON.stringify(visibleProperties);
        const recheckDelays = [100, 250, 500];
        for (const delay of recheckDelays) {
          setTimeout(() => {
            const currentProps = this.config?.getOrder?.() ?? [];
            const currentPropsStr = JSON.stringify(currentProps);
            if (currentPropsStr !== propsSnapshot) {
              this.lastDataUpdateTime.value = 0;
              this.processDataUpdate();
            }
          }, delay);
        }
        this.scrollPreservation?.restoreAfterRender();
        return;
      }

      // Calculate initial count for comparison and first render
      const initialCount = this.calculateInitialCount(settings);

      // Check if settings changed (for cache clearing and in-place update logic)
      const settingsChanged =
        this.renderState.lastSettingsHash !== null &&
        this.renderState.lastSettingsHash !== settingsHash;

      // If only content changed (not paths/settings), update in-place
      if (changedPaths.size > 0 && !settingsChanged && pathsUnchanged) {
        await this.updateCardsInPlace(changedPaths, allEntries, settings);
        this.renderState.lastRenderHash = renderHash;
        return;
      }

      // Property reorder only: settings changed but only property ORDER differs.
      // Card heights are invariant under reorder — skip masonry layout.
      // Guard: invertPropertyPairing makes pairing position-dependent.
      const propertySetUnchanged =
        this.renderState.lastPropertySetHash !== null &&
        this.renderState.lastPropertySetHash === propertySetHash;
      const titleSubtitleUnchanged =
        this.lastTitleProperty !== null &&
        settings.titleProperty === this.lastTitleProperty &&
        settings.subtitleProperty === this.lastSubtitleProperty;
      const isPropertyReorderOnly =
        settingsChanged &&
        propertySetUnchanged &&
        !settings.invertPropertyPairing &&
        titleSubtitleUnchanged &&
        pathsUnchanged &&
        changedPaths.size === 0 &&
        settingsHashExcludingOrder ===
          this.renderState.lastSettingsHashExcludingOrder;

      if (isPropertyReorderOnly) {
        this.updatePropertyOrder(visibleProperties, settings, sortMethod);
        this.renderState.lastRenderHash = renderHash;
        this.renderState.lastSettingsHash = settingsHash;
        this.renderState.lastPropertySetHash = propertySetHash;
        this.renderState.lastSettingsHashExcludingOrder =
          settingsHashExcludingOrder;
        this.lastTitleProperty = settings.titleProperty;
        this.lastSubtitleProperty = settings.subtitleProperty;
        return;
      }

      // Clear caches on settings change; reset scroll only if batches were appended
      // (avoids lag with many cards; skips scroll-to-top when only initial batch shown)
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
      this.renderState.lastPropertySetHash = propertySetHash;
      this.renderState.lastSettingsHashExcludingOrder =
        settingsHashExcludingOrder;
      this.lastTitleProperty = settings.titleProperty;
      this.lastSubtitleProperty = settings.subtitleProperty;

      // Set displayedCount when starting fresh (first render or after reset)
      if (this.displayedCount === 0) {
        this.displayedCount = initialCount;
      }

      // Set CSS variable for image aspect ratio
      this.containerEl.style.setProperty(
        "--dynamic-views-image-aspect-ratio",
        String(settings.imageRatio),
      );

      // Transform to CardData (only visible entries)

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

      // Determine grouping state early — collapse state only applies when grouped
      const isGrouped = !!groupByProperty;

      // Collect visible entries across all groups (up to displayedCount), skipping collapsed
      const visibleEntries: BasesEntry[] = [];
      let remainingCount = this.displayedCount;

      for (const processedGroup of processedGroups) {
        if (remainingCount <= 0) break;
        const groupKey = processedGroup.group.hasKey()
          ? serializeGroupKey(processedGroup.group.key)
          : undefined;
        if (
          isGrouped &&
          this.collapsedGroups.has(this.getCollapseKey(groupKey))
        )
          continue;
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
      this.containerEl.setCssProps({
        "--dynamic-views-preserve-height": `${currentHeight}px`,
      });
      this.containerEl.addClass("dynamic-views-height-preserved");

      // Clear and re-render
      this.containerEl.empty();

      // Reset batch append state for full re-render
      this.previousDisplayedCount = 0;
      this.lastGroup.key = undefined;
      this.lastGroup.container = null;
      this.groupLayoutResults.clear();
      this.virtualItems = [];
      this.hasExplicitScrollHeights = false;
      this.pendingDeferredResize = false;
      this.virtualItemsByGroup.clear();
      this.groupContainers.clear();
      this.cachedGroupOffsets.clear();
      this.hasUserScrolled = false;

      // Cleanup card renderer observers before re-rendering
      this.cardRenderer.cleanup();

      // Toggle is-grouped class
      this.containerEl.toggleClass("is-grouped", isGrouped);

      // Create masonry container
      // Ungrouped: needs masonry-container for CSS height:auto rule
      // Grouped: individual group containers get masonry-container class
      this.masonryContainer = this.containerEl.createDiv(
        `dynamic-views-masonry${isGrouped ? " bases-cards-container" : " masonry-container"}`,
      );
      this.containerRef.current = this.masonryContainer;

      // Initialize focus management on container (cleanup previous first)
      this.focusCleanup?.();
      this.focusCleanup = initializeContainerFocus(this.masonryContainer);

      // Setup masonry layout
      this.setupMasonryLayout(settings);

      // Clear CSS variable cache to pick up any style changes
      // (prevents layout thrashing from repeated getComputedStyle calls per card)
      clearStyleSettingsCache();

      // Render groups with headers (or ungrouped cards directly)
      let displayedSoFar = 0;
      for (const processedGroup of processedGroups) {
        // Determine card container: group div (grouped) or masonry container (ungrouped)
        let cardContainer: HTMLElement;
        let groupKey: string | undefined;

        if (isGrouped) {
          groupKey = processedGroup.group.hasKey()
            ? serializeGroupKey(processedGroup.group.key)
            : undefined;
          const collapseKey = this.getCollapseKey(groupKey);
          const isCollapsed = this.collapsedGroups.has(collapseKey);

          // Budget check: stop rendering cards once limit reached,
          // but always render collapsed group headers (they cost 0 cards)
          if (displayedSoFar >= this.displayedCount && !isCollapsed) break;

          // Wrap header + group in a section so sticky scopes to the group's content
          const sectionEl = this.masonryContainer.createDiv(
            "dynamic-views-group-section",
          );

          // Render group header (always visible, with chevron)
          const headerEl = renderGroupHeader(
            sectionEl,
            processedGroup.group,
            this.config,
            this.app,
            processedGroup.entries.length,
            isCollapsed,
            () => {
              if (headerEl) this.toggleGroupCollapse(collapseKey, headerEl);
            },
          );

          // Create group container for cards (empty if collapsed, for DOM sibling structure)
          cardContainer = sectionEl.createDiv(
            "dynamic-views-group bases-cards-group masonry-container",
          );
          setGroupKeyDataset(cardContainer, groupKey);
          this.groupContainers.set(groupKey, cardContainer);

          // Skip card rendering for collapsed groups
          if (isCollapsed) continue;
        } else {
          // Ungrouped: no collapse, budget check applies normally
          if (displayedSoFar >= this.displayedCount) break;
          // Render directly to masonry container
          cardContainer = this.masonryContainer;
          groupKey = undefined;
          this.groupContainers.set(undefined, cardContainer);
        }

        const entriesToDisplay = Math.min(
          processedGroup.entries.length,
          this.displayedCount - displayedSoFar,
        );
        if (entriesToDisplay === 0) continue;

        const groupEntries = processedGroup.entries.slice(0, entriesToDisplay);

        // Render cards in this group
        const cards = transformBasesEntries(
          this.app,
          groupEntries,
          settings,
          sortMethod,
          false,
          visibleProperties,
          this.contentCache.textPreviews,
          this.contentCache.images,
          this.contentCache.hasImageAvailable,
        );

        for (let i = 0; i < cards.length; i++) {
          const card = cards[i];
          const entry = groupEntries[i];
          const handle = this.renderCard(
            cardContainer,
            card,
            entry,
            displayedSoFar + i,
            settings,
          );
          this.virtualItems.push({
            index: displayedSoFar + i,
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            measuredHeight: 0,
            measuredAtWidth: 0,
            scalableHeight: 0,
            fixedHeight: 0,
            col: 0,
            cardData: card,
            entry,
            groupKey,
            el: handle.el,
            handle,
          });
        }

        displayedSoFar += entriesToDisplay;

        // Track last group for batch append
        this.lastGroup.key = groupKey;
        this.lastGroup.container = cardContainer;
      }

      // Track state for batch append and end indicator
      this.previousDisplayedCount = displayedSoFar;
      this.displayedSoFar = displayedSoFar;
      this.rebuildGroupIndex();

      // Initial layout calculation (sets inline width on cards)
      if (this.updateLayoutRef.current) {
        this.updateLayoutRef.current("initial-render");
      }

      // Sync responsive classes after layout sets widths (ResizeObservers are async)
      // Must run before gradient init which checks compact-mode state
      if (this.masonryContainer) {
        const cards = Array.from(
          this.masonryContainer.querySelectorAll<HTMLElement>(".card"),
        );
        // Re-run layout only if responsive classes changed (affects card heights)
        if (syncResponsiveClasses(cards)) {
          this.updateLayoutRef.current?.("compact-mode-sync");
        }

        initializeScrollGradients(this.masonryContainer);
        initializeTitleTruncation(this.masonryContainer);

        // Cancel spurious cardResizeObserver RAF from initial card creation —
        // layout just measured all cards, no drift possible yet
        if (this.cardResizeRafId !== null) {
          cancelAnimationFrame(this.cardResizeRafId);
          this.cardResizeRafId = null;
        }
      }

      // Compute effective total (exclude collapsed groups)
      let effectiveTotal = 0;
      for (const pg of processedGroups) {
        const gk = pg.group.hasKey()
          ? serializeGroupKey(pg.group.key)
          : undefined;
        if (!isGrouped || !this.collapsedGroups.has(this.getCollapseKey(gk))) {
          effectiveTotal += pg.entries.length;
        }
      }

      // Update total entries for end indicator (excluding collapsed groups)
      this.totalEntries = effectiveTotal;

      // Setup infinite scroll outside setTimeout (c59fe2d pattern)
      this.setupInfiniteScroll(effectiveTotal, settings);

      // Restore scroll position after render
      this.scrollPreservation?.restoreAfterRender();

      // Remove height preservation now that scroll is restored
      this.containerEl.removeClass("dynamic-views-height-preserved");

      // Clear skip-cover-fade after cached image load events have fired.
      // Double-rAF lets the browser process queued load events for cached images
      // before removing the class (matching handleImageLoad's double-rAF timing).
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.scrollEl
            .closest(".workspace-leaf-content")
            ?.classList.remove("skip-cover-fade");
        });
      });
    })();
  }

  private setupMasonryLayout(settings: BasesResolvedSettings): void {
    if (!this.masonryContainer) return;

    const minColumns = settings.minimumColumns;

    // Synchronous layout update - single pass, no chunking
    // Profiling showed chunked async caused layout thrashing (224 InvalidateLayout events)
    this.updateLayoutRef.current = (source?: string) => {
      if (!this.masonryContainer) return;
      // Use cached width from ResizeObserver for resize sources (avoids forced reflow).
      // Other sources fall back to getBoundingClientRect.
      const containerWidth =
        (source === "resize-observer" || source === "resize-correction") &&
        this.pendingResizeWidth !== null
          ? this.pendingResizeWidth
          : Math.floor(this.masonryContainer.getBoundingClientRect().width);
      if (containerWidth === 0) return;

      // Suppress full relayouts while an incremental batch layout is pending.
      // Image load callbacks would corrupt groupLayoutResults by including
      // the new batch's cards before the incremental layout positions them.
      if (this.batchLayoutPending) return;

      // Defer non-critical full recalcs during active scroll.
      // Repositioning all cards mid-scroll causes visible snapping.
      if (this.scrollRemeasureTimeout !== null) {
        if (source === "property-measured") {
          // No new cards — scroll-idle remeasure handles height drift.
          return;
        }
        if (source === "resize-observer" || source === "resize-correction") {
          // Proportional resize repositions ALL cards — defer to scroll-idle.
          // pendingResizeWidth retains the latest width for the deferred pass.
          this.pendingDeferredResize = true;
          return;
        }
      }

      // Guard against relayout with partial DOM when virtual scroll has
      // unmounted cards. Full relayout would see only mounted cards and
      // scramble VirtualItem positions. Allow specific sources that need
      // full DOM by remounting all items first.
      const hasUnmountedItems = this.virtualItems.some(
        (v) => !v.el && v.height > 0,
      );

      if (hasUnmountedItems) {
        if (source === "expand-group") {
          // Remount all items for accurate full-DOM measurement
          for (const item of this.virtualItems) {
            if (!item.el && item.height > 0) {
              const container = this.groupContainers.get(item.groupKey);
              if (container && this.lastRenderedSettings) {
                this.mountVirtualItem(
                  item,
                  container,
                  this.lastRenderedSettings,
                );
              }
            }
          }
        } else if (
          source === "resize-observer" ||
          source === "resize-correction" ||
          source === "image-coalesced"
        ) {
          // Allow through — fast path measures mounted cards only.
          // Falls through to full measurement if no prior heights exist.
        } else {
          return;
        }
      }

      // Coalesce image-load relayouts — one layout per frame instead of one per image.
      // Without this, 60 cover images loading triggers 60 independent full relayouts.
      if (source === "image-load") {
        if (!this.pendingImageRelayout) {
          this.pendingImageRelayout = true;
          requestAnimationFrame(() => {
            if (!this.pendingImageRelayout) return;
            this.pendingImageRelayout = false;
            if (this.resizeCorrectionTimeout !== null) return;
            if (this.scrollRemeasureTimeout !== null) {
              console.debug(
                "[masonry:probe] image-load blocked by scrollRemeasureTimeout",
              );
              return;
            }
            if (this.batchLayoutPending) return;
            if (this.lastLayoutCardWidth <= 0) return;
            if (!this.lastRenderedSettings) return;
            const didWork = this.remeasureAndReposition(
              this.lastLayoutWidth,
              this.lastLayoutCardWidth,
              this.lastRenderedSettings,
              this.lastLayoutMinColumns,
              this.lastLayoutGap,
              this.lastLayoutIsGrouped,
            );
            if (didWork) this.scheduleDeferredRemeasure();
          });
        }
        return;
      }
      // A direct relayout (resize, initial-render) subsumes any pending image relayout
      this.pendingImageRelayout = false;

      // Guard against reentrant calls - queue update if one is in progress
      if (this.isUpdatingLayout) {
        this.pendingLayoutUpdate = true;
        return;
      }
      this.isUpdatingLayout = true;

      // Only hide cards on initial render (prevents flash at 0,0)
      const skipHiding = source !== "initial-render";
      let fastPathHandledSync = false;
      // Hoisted for access in finally block (post-correction re-measure)
      const gap = getCardSpacing(this.containerEl);
      const isGrouped = this.containerEl.classList.contains("is-grouped");
      let cardWidth = 0;
      try {
        // Hide cards during initial render only
        if (!skipHiding) {
          this.masonryContainer.classList.add("masonry-resizing");
        }

        // Collect all cards
        // Always use VirtualItem order — DOM order diverges after virtual scroll
        // mount/unmount cycles (remounted cards are appended at container end).
        // Using VirtualItem order keeps index alignment with groupLayoutResults
        // positions, preventing stable-column logic from mapping wrong columns.
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
        }

        allCards = this.virtualItems
          .filter((v) => v.el != null)
          .map((v) => v.el!);

        if (allCards.length === 0) {
          this.isUpdatingLayout = false;
          return;
        }

        // Calculate dimensions
        const dims = calculateMasonryDimensions({
          containerWidth,
          cardSize: settings.cardSize,
          minColumns,
          gap,
        });
        const columns = dims.columns;
        cardWidth = dims.cardWidth;

        // Store for syncVirtualScroll's post-mount remeasure
        this.lastLayoutCardWidth = cardWidth;
        this.lastLayoutGap = gap;
        this.lastLayoutMinColumns = minColumns;
        this.lastLayoutIsGrouped = isGrouped;

        // Fast path: skip full remount when unmounted cards have prior heights.
        // Two branches:
        // - resize-observer: pure proportional heights + explicit CSS height on
        //   mounted cards. Zero DOM reads — layout/render match is guaranteed by
        //   the explicit height constraint. ~3-5ms per frame.
        // - resize-correction / image-coalesced: DOM measurement of mounted cards
        //   (mixed heights). Correction clears explicit heights first so cards
        //   reflow to natural height for accurate reads.
        const useFastPath =
          source === "resize-observer" ||
          source === "resize-correction" ||
          source === "image-coalesced";
        if (useFastPath && hasUnmountedItems) {
          // Need prior heights for unmounted cards — fall through to full
          // measurement on first resize before any layout has run
          const hasPriorHeights = this.virtualItems.some(
            (v) => !v.el && v.height > 0,
          );
          if (hasPriorHeights) {
            if (source === "resize-observer") {
              // ── Proportional branch: single-pass, zero DOM reads ──
              // Inlines greedy placement + VirtualItem update + style writes
              // Pre-read scroll metrics before style writes to avoid forced reflow
              // in syncVirtualScroll (scrollTop + clientHeight trigger reflow
              // after inline style changes to child elements)
              const scrollTop = this.scrollEl.scrollTop;
              const paneHeight = this.scrollEl.clientHeight;
              for (const groupKey of this.virtualItemsByGroup.keys()) {
                const groupItems = this.virtualItemsByGroup.get(groupKey)!;
                if (groupItems.length === 0) continue;

                const existingResult = this.groupLayoutResults.get(groupKey);
                const { containerHeight, columnHeights, columnAssignments } =
                  this.proportionalResizeLayout(
                    groupItems,
                    cardWidth,
                    columns,
                    gap,
                    existingResult?.columns,
                  );

                const container = isGrouped
                  ? this.groupContainers.get(groupKey)
                  : this.masonryContainer;
                container?.style.setProperty(
                  "--masonry-height",
                  `${containerHeight}px`,
                );

                // Store result for appendBatch continuation and stable column guards.
                // Positions built from VirtualItems updated in-place by proportionalResizeLayout.
                // heights intentionally omitted — proportional values are scaled,
                // not original measured heights. appendBatch merge handles undefined.
                this.groupLayoutResults.set(groupKey, {
                  positions: groupItems.map((item) => ({
                    left: item.x,
                    top: item.y,
                  })),
                  columnHeights,
                  containerHeight,
                  containerWidth,
                  cardWidth,
                  columns,
                  columnAssignments,
                });
              }
              this.lastLayoutWidth = containerWidth;
              this.syncVirtualScroll({ scrollTop, paneHeight });
              fastPathHandledSync = true;
              return;
            } else {
              // ── DOM measurement branch: correction + image-coalesced ──
              // Clear explicit heights for correction so cards reflow to
              // natural height. image-coalesced must NOT clear mid-resize.
              if (source === "resize-correction") {
                for (const item of this.virtualItems) {
                  if (item.el) {
                    // eslint-disable-next-line obsidianmd/no-static-styles-assignment -- clearing inline layout height for DOM re-measurement
                    item.el.style.height = "";
                  }
                }
              }

              this.masonryContainer.classList.add("masonry-measuring");

              // Set width on mounted cards + force single reflow
              for (const item of this.virtualItems) {
                if (item.el) {
                  item.el.style.width = `${cardWidth}px`;
                }
              }
              const firstMounted = this.virtualItems.find((v) => v.el);
              if (firstMounted) void firstMounted.el!.offsetHeight;

              for (const groupKey of this.virtualItemsByGroup.keys()) {
                const groupItems = this.virtualItemsByGroup.get(groupKey)!;
                if (groupItems.length === 0) continue;

                // Mixed heights: mounted = DOM, unmounted = split proportional
                const heights = groupItems.map((item) => {
                  if (item.el) {
                    const h = item.el.offsetHeight;
                    item.scalableHeight = measureScalableHeight(item.el);
                    return h;
                  }
                  return estimateUnmountedHeight(item, cardWidth);
                });

                const existingResult = this.groupLayoutResults.get(groupKey);

                let result: MasonryLayoutResult;
                if (
                  existingResult &&
                  // Stricter than remeasureAndReposition's `columns > 0` — resize-correction
                  // may run after a column count change, where old column assignments are invalid.
                  existingResult.columns === columns &&
                  existingResult.positions.length >= groupItems.length
                ) {
                  const stable = repositionWithStableColumns({
                    columnAssignments: existingResult.columnAssignments,
                    existingPositions: existingResult.positions,
                    existingCardWidth: existingResult.cardWidth,
                    newHeights: heights,
                    columns,
                    cardWidth,
                    gap,
                  });

                  // Skip imbalance check for resize-correction — visual stability
                  // during resize outweighs column height imbalance. The guard is
                  // only needed for batch appends where stable columns amplify drift.
                  let useGreedy = false;
                  if (isGrouped && source !== "resize-correction") {
                    const stableRange =
                      Math.max(...stable.columnHeights) -
                      Math.min(...stable.columnHeights);
                    const greedyColHeights = computeGreedyColumnHeights(
                      heights,
                      columns,
                      gap,
                    );
                    const greedyRange =
                      Math.max(...greedyColHeights) -
                      Math.min(...greedyColHeights);
                    useGreedy =
                      stableRange > greedyRange * 1.5 &&
                      stableRange - greedyRange > gap * 8;
                  }

                  if (useGreedy) {
                    result = calculateMasonryLayout({
                      cards: Array.from<HTMLElement>({
                        length: groupItems.length,
                      }),
                      containerWidth,
                      cardSize: settings.cardSize,
                      minColumns,
                      gap,
                      heights,
                    });
                  } else {
                    result = {
                      ...existingResult,
                      positions: stable.positions,
                      columnHeights: stable.columnHeights,
                      containerHeight: stable.containerHeight,
                      columnAssignments: stable.columnAssignments,
                      containerWidth,
                      cardWidth,
                      heights,
                    };
                  }
                } else {
                  result = calculateMasonryLayout({
                    cards: Array.from<HTMLElement>({
                      length: groupItems.length,
                    }),
                    containerWidth,
                    cardSize: settings.cardSize,
                    minColumns,
                    gap,
                    heights,
                  });
                }

                for (let i = 0; i < groupItems.length; i++) {
                  const pos = result.positions[i];
                  if (groupItems[i].el) {
                    groupItems[i].el!.style.left = `${pos.left}px`;
                    groupItems[i].el!.style.top = `${pos.top}px`;
                  }
                }

                const container = isGrouped
                  ? this.groupContainers.get(groupKey)
                  : this.masonryContainer;
                container?.style.setProperty(
                  "--masonry-height",
                  `${result.containerHeight}px`,
                );

                // Correction updates baselines so future proportional scaling
                // starts from accurate DOM-measured values at the final width.
                if (source === "resize-correction") {
                  result.measuredAtCardWidth = cardWidth;
                }

                this.groupLayoutResults.set(groupKey, result);
                this.updateVirtualItemPositions(groupKey, result);
              }

              this.masonryContainer.classList.remove("masonry-measuring");
            }

            this.lastLayoutWidth = containerWidth;

            // DOM measurement branch handles its own sync — set flag so `finally` skips it.
            // Must sync after correction: re-measured heights shift positions, potentially
            // moving items in/out of viewport range.
            this.updateCachedGroupOffsets();
            this.syncVirtualScroll();
            fastPathHandledSync = true;
            return;
          }
          // No prior heights — fall through to full measurement
        }

        // Phase 1: Set all widths + force content rendering for accurate measurement
        // masonry-measuring overrides content-visibility (hidden on desktop, auto on mobile)
        // so off-screen cards render their content for accurate offsetHeight reads
        this.masonryContainer.classList.add("masonry-measuring");
        for (const card of allCards) {
          if (!skipHiding) {
            card.classList.remove("masonry-positioned");
          }
          card.style.width = `${cardWidth}px`;
          // Clear explicit scroll-mount heights so offsetHeight returns natural height.
          // mountVirtualItem sets explicit heights to prevent scroll-back drift;
          // full measurement needs natural heights for accurate layout.
          // eslint-disable-next-line obsidianmd/no-static-styles-assignment -- clearing inline layout height for DOM re-measurement
          card.style.height = "";
        }
        this.hasExplicitScrollHeights = false;

        // Phase 2: Single forced reflow
        void allCards[0]?.offsetHeight;

        // Phase 3: Read all heights (single pass)
        const heights = allCards.map((card) => card.offsetHeight);

        // Phase 3b: Measure scalable heights (still in same reflow — no style
        // writes since Phase 3, so child offsetHeight reads are free)
        for (const item of this.virtualItems) {
          if (item.el) {
            item.scalableHeight = measureScalableHeight(item.el);
          }
        }

        // Phase 4: Calculate and apply layout
        if (isGrouped && groups) {
          const groupCardsMap = new Map<HTMLElement, HTMLElement[]>();
          for (const groupEl of groups) {
            const groupKey = getGroupKeyDataset(groupEl);
            const groupCards = (this.virtualItemsByGroup.get(groupKey) ?? [])
              .filter((v) => v.el != null)
              .map((v) => v.el!);
            groupCardsMap.set(groupEl, groupCards);
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

            const existingResult = this.groupLayoutResults.get(groupKey);

            let result: MasonryLayoutResult;
            if (
              existingResult &&
              existingResult.columns === columns &&
              existingResult.positions.length >= groupCards.length
            ) {
              const stable = repositionWithStableColumns({
                columnAssignments: existingResult.columnAssignments,
                existingPositions: existingResult.positions,
                existingCardWidth: existingResult.cardWidth,
                newHeights: groupHeights,
                columns,
                cardWidth,
                gap,
              });

              // Skip imbalance check during resize — visual stability matters more.
              // Only check for non-resize sources (batch appends, group expand).
              const isResizeSource =
                source === "resize-observer" || source === "resize-correction";
              let useGreedy = false;
              if (!isResizeSource) {
                const stableRange =
                  Math.max(...stable.columnHeights) -
                  Math.min(...stable.columnHeights);
                const greedyColHeights = computeGreedyColumnHeights(
                  groupHeights,
                  columns,
                  gap,
                );
                const greedyRange =
                  Math.max(...greedyColHeights) - Math.min(...greedyColHeights);
                useGreedy =
                  stableRange > greedyRange * 1.5 &&
                  stableRange - greedyRange > gap * 8;
              }

              if (useGreedy) {
                result = calculateMasonryLayout({
                  cards: groupCards,
                  containerWidth,
                  cardSize: settings.cardSize,
                  minColumns,
                  gap,
                  heights: groupHeights,
                });
              } else {
                result = {
                  ...existingResult,
                  positions: stable.positions,
                  columnHeights: stable.columnHeights,
                  containerHeight: stable.containerHeight,
                  columnAssignments: stable.columnAssignments,
                  containerWidth,
                  cardWidth,
                  heights: groupHeights,
                };
              }
            } else {
              result = calculateMasonryLayout({
                cards: groupCards,
                containerWidth,
                cardSize: settings.cardSize,
                minColumns,
                gap,
                heights: groupHeights,
              });
            }

            // Apply positions (single pass)
            for (let i = 0; i < groupCards.length; i++) {
              const pos = result.positions[i];
              groupCards[i].classList.add("masonry-positioned");
              groupCards[i].style.left = `${pos.left}px`;
              groupCards[i].style.top = `${pos.top}px`;
            }

            groupEl.classList.add("masonry-container");
            groupEl.style.setProperty(
              "--masonry-height",
              `${result.containerHeight}px`,
            );

            result.measuredAtCardWidth = cardWidth;
            this.groupLayoutResults.set(groupKey, result);
            this.updateVirtualItemPositions(groupKey, result);
            cardIndex += groupCards.length;
          }
        } else {
          // Ungrouped mode
          const existingResult = this.groupLayoutResults.get(undefined);
          let result: MasonryLayoutResult;
          if (
            existingResult &&
            existingResult.columns === columns &&
            existingResult.positions.length >= allCards.length
          ) {
            const stable = repositionWithStableColumns({
              columnAssignments: existingResult.columnAssignments,
              existingPositions: existingResult.positions,
              existingCardWidth: existingResult.cardWidth,
              newHeights: heights,
              columns,
              cardWidth,
              gap,
            });

            result = {
              ...existingResult,
              positions: stable.positions,
              columnHeights: stable.columnHeights,
              containerHeight: stable.containerHeight,
              columnAssignments: stable.columnAssignments,
              containerWidth,
              cardWidth,
              heights,
            };
          } else {
            result = calculateMasonryLayout({
              cards: allCards,
              containerWidth,
              cardSize: settings.cardSize,
              minColumns,
              gap,
              heights,
            });
          }

          // Apply positions (single pass)
          for (let i = 0; i < allCards.length; i++) {
            const pos = result.positions[i];
            allCards[i].classList.add("masonry-positioned");
            allCards[i].style.left = `${pos.left}px`;
            allCards[i].style.top = `${pos.top}px`;
          }

          this.masonryContainer.style.setProperty(
            "--masonry-height",
            `${result.containerHeight}px`,
          );

          result.measuredAtCardWidth = cardWidth;

          this.groupLayoutResults.set(undefined, result);
          this.updateVirtualItemPositions(undefined, result);
        }

        this.lastLayoutWidth = containerWidth;
      } finally {
        this.masonryContainer?.classList.remove("masonry-measuring");

        if (!skipHiding && this.masonryContainer?.isConnected) {
          this.masonryContainer.classList.remove("masonry-resizing");
        }

        // Mount/unmount cards based on updated positions.
        // Fast path handles its own sync — skip here.
        if (!fastPathHandledSync) {
          this.updateCachedGroupOffsets();
          this.syncVirtualScroll();
        }

        // Catch post-measurement height drift (e.g. image load → aspect ratio
        // update, cover-ready class). Double-RAF matches handleImageLoad timing.
        if (source === "initial-render" || source === "compact-mode-sync") {
          this.scheduleDeferredRemeasure();
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

    // Synchronous resize handler — proportional scaling runs directly in
    // the ResizeObserver callback (RO fires at most once per frame).
    // DOM measurement correction 200ms after resize ends.
    const throttledResize = (entries: ResizeObserverEntry[]) => {
      if (entries.length === 0) return;
      const newWidth = Math.floor(entries[0].contentRect.width);
      if (newWidth === this.lastLayoutWidth) return;

      // Cache width for the layout function — avoids getBoundingClientRect reflow
      this.pendingResizeWidth = newWidth;

      // Disable top/left CSS transitions during active resize so cards
      // reposition instantly instead of lagging 140ms behind each frame
      this.masonryContainer?.classList.add("masonry-resize-active");
      if (this.resizeCorrectionTimeout !== null) {
        clearTimeout(this.resizeCorrectionTimeout);
      }
      this.resizeCorrectionTimeout = window.setTimeout(() => {
        this.resizeCorrectionTimeout = null;
        this.masonryContainer?.classList.remove("masonry-resize-active");
        this.masonryContainer?.classList.add("masonry-correcting");
        // Post-resize correction: re-measure mounted cards + update baselines
        this.updateLayoutRef.current?.("resize-correction");
        // Remove after transition completes
        window.setTimeout(() => {
          this.masonryContainer?.classList.remove("masonry-correcting");
        }, MASONRY_CORRECTION_MS);
      }, MASONRY_CORRECTION_MS);

      // Run layout synchronously — no RAF deferral.
      // Chromium throttles RAF for 400ms–3s after rapid setBounds,
      // causing stale layout after hotkey window resize.
      if (this.masonryContainer?.isConnected) {
        this.updateLayoutRef.current?.("resize-observer");
      }
    };

    // Electron popout windows have a separate V8 isolate — observers created
    // in the main window's context don't fire for popout DOM elements.
    const currentWindow = this.masonryContainer.ownerDocument.defaultView;
    if (currentWindow && this.observerWindow !== currentWindow) {
      this.layoutResizeObserver?.disconnect();
      this.layoutResizeObserver = null;
      this.cardResizeObserver?.disconnect();
      this.cardResizeObserver = null;
      this.observerWindow = currentWindow;
    }

    // Setup resize observer (only once, not per render)
    // ResizeObserver handles both pane and window resize (container resizes in both cases)
    if (!this.layoutResizeObserver) {
      this.layoutResizeObserver = new (
        this.observerWindow ?? window
      ).ResizeObserver(throttledResize);
      this.layoutResizeObserver.observe(this.masonryContainer);
      this.register(() => this.layoutResizeObserver?.disconnect());
    } else if (this.masonryContainer) {
      // Re-observe if container was recreated
      this.layoutResizeObserver.disconnect();
      this.layoutResizeObserver.observe(this.masonryContainer);
    }

    if (!this.cardResizeObserver) {
      this.cardResizeObserver = new (
        this.observerWindow ?? window
      ).ResizeObserver(() => {
        // Skip during active resize, scroll remeasure, batch layout, or pre-layout state
        if (
          this.resizeCorrectionTimeout !== null ||
          this.scrollRemeasureTimeout !== null ||
          this.batchLayoutPending ||
          this.lastLayoutCardWidth === 0 ||
          !this.lastRenderedSettings
        ) {
          return;
        }
        // RAF debounce — coalesce same-frame card height changes into one reflow
        if (this.cardResizeRafId !== null) {
          cancelAnimationFrame(this.cardResizeRafId);
        }
        this.cardResizeRafId = requestAnimationFrame(() => {
          this.cardResizeRafId = null;
          if (
            !this.containerEl.isConnected ||
            this.batchLayoutPending ||
            this.resizeCorrectionTimeout !== null ||
            this.scrollRemeasureTimeout !== null ||
            this.lastLayoutCardWidth === 0 ||
            !this.lastRenderedSettings
          )
            return;
          const didWork = this.remeasureAndReposition(
            this.lastLayoutWidth,
            this.lastLayoutCardWidth,
            this.lastRenderedSettings,
            this.lastLayoutMinColumns,
            this.lastLayoutGap,
            this.lastLayoutIsGrouped,
          );
          if (didWork) this.scheduleDeferredRemeasure();
        });
      });
      this.register(() => this.cardResizeObserver?.disconnect());
    }
  }

  /** Update VirtualItem positions from a layout result for a specific group */
  private updateVirtualItemPositions(
    groupKey: string | undefined,
    result: MasonryLayoutResult,
  ): void {
    const groupItems = this.virtualItemsByGroup.get(groupKey) ?? [];
    for (let i = 0; i < groupItems.length && i < result.positions.length; i++) {
      const item = groupItems[i];
      const pos = result.positions[i];
      item.x = pos.left;
      item.y = pos.top;
      item.width = result.cardWidth;
      item.height = result.heights?.[i] ?? item.height;
      // Store authoritative column index — used by proportionalResizeLayout
      // and repositionWithStableColumns to lock column during same-count resize
      if (i < result.columnAssignments.length) {
        item.col = result.columnAssignments[i];
      }
      // Only update baselines for mounted items — unmounted items retain
      // their original DOM-measured values for accurate proportional scaling.
      if (result.measuredAtCardWidth && item.el) {
        item.measuredHeight = item.height;
        item.measuredAtWidth = result.measuredAtCardWidth;
        item.fixedHeight = item.measuredHeight - item.scalableHeight;
      }
    }
  }

  /** Re-measure mounted cards and reposition after correction's sync mounts
   *  new items whose DOM heights differ from proportional layout heights.
   *  Only runs when at least one mounted card's DOM height differs by >1px.
   *  Returns true if repositioning was needed, false if skipped. */
  private remeasureAndReposition(
    containerWidth: number,
    cardWidth: number,
    settings: BasesResolvedSettings,
    minColumns: number,
    gap: number,
    isGrouped: boolean,
    skipTransition = false,
  ): boolean {
    // Clear explicit scroll heights so cards reflow to natural height for
    // accurate measurement. Without this, offsetHeight returns the explicit
    // value which always matches item.height — drift would never be detected.
    if (this.hasExplicitScrollHeights) {
      for (const item of this.virtualItems) {
        if (item.el) {
          // eslint-disable-next-line obsidianmd/no-static-styles-assignment -- clearing inline layout height for DOM re-measurement
          item.el.style.height = "";
        }
      }
      this.hasExplicitScrollHeights = false;
    }

    // Force content rendering for accurate offsetHeight reads.
    // Must be set BEFORE the drift check — without this, content-visibility: auto
    // returns contain-intrinsic-height fallback for fresh elements, causing
    // false-positive drift detection.
    this.masonryContainer?.classList.add("masonry-measuring");
    const firstMounted = this.virtualItems.find((v) => v.el);
    if (firstMounted) void firstMounted.el!.offsetHeight;

    // Quick check: does any mounted item need repositioning?
    let needsReposition = false;
    for (const item of this.virtualItems) {
      // 1px tolerance absorbs sub-pixel rounding from offsetHeight
      if (item.el && Math.abs(item.el.offsetHeight - item.height) > 1) {
        needsReposition = true;
        break;
      }
    }
    if (!needsReposition) {
      this.masonryContainer?.classList.remove("masonry-measuring");
      if (skipTransition) {
        requestAnimationFrame(() => {
          this.masonryContainer?.classList.remove("masonry-skip-transition");
        });
      }
      return false;
    }

    if (skipTransition) {
      this.masonryContainer?.classList.add("masonry-skip-transition");
    }

    if (!skipTransition) {
      this.masonryContainer?.classList.add("masonry-correcting");
    }

    // Scroll anchor: record absolute Y of first visible mounted card
    // so we can compensate scrollTop after positions shift
    const scrollTop = this.scrollEl.scrollTop;
    let anchorItem: VirtualItem | null = null;
    let anchorAbsY = 0;
    for (const item of this.virtualItems) {
      if (!item.el) continue;
      const offset = this.cachedGroupOffsets.get(item.groupKey) ?? 0;
      const absY = offset + item.y;
      if (absY + item.height > scrollTop) {
        anchorItem = item;
        anchorAbsY = absY;
        break;
      }
    }
    for (const groupKey of this.virtualItemsByGroup.keys()) {
      const groupItems = this.virtualItemsByGroup.get(groupKey)!;
      if (groupItems.length === 0) continue;

      const heights = groupItems.map((item) => {
        if (item.el) {
          const h = item.el.offsetHeight;
          item.scalableHeight = measureScalableHeight(item.el);
          return h;
        }
        return estimateUnmountedHeight(item, cardWidth);
      });

      const existingResult = this.groupLayoutResults.get(groupKey);

      // Stable column reposition when prior layout exists — prevents
      // cascading column switching from small height changes.
      let result: MasonryLayoutResult;
      if (
        existingResult &&
        existingResult.columns > 0 &&
        existingResult.positions.length >= groupItems.length
      ) {
        const stable = repositionWithStableColumns({
          columnAssignments: existingResult.columnAssignments,
          existingPositions: existingResult.positions,
          existingCardWidth: existingResult.cardWidth,
          newHeights: heights,
          columns: existingResult.columns,
          cardWidth,
          gap,
        });

        // In grouped mode, detect if stable reposition introduced excessive
        // column imbalance — prevents amplification across incremental batch
        // appends. Ungrouped mode skips this: visual stability during scroll
        // outweighs minor imbalance with a single group.
        let useGreedy = false;
        if (isGrouped) {
          const stableRange =
            Math.max(...stable.columnHeights) -
            Math.min(...stable.columnHeights);
          const greedyColHeights = computeGreedyColumnHeights(
            heights,
            existingResult.columns,
            gap,
          );
          const greedyRange =
            Math.max(...greedyColHeights) - Math.min(...greedyColHeights);
          // 1.5x relative threshold ignores negligible drift (e.g. 1px rounding);
          // 8×gap absolute threshold ensures the visual difference is noticeable
          // (empirically: gap=8px → 64px minimum visible imbalance).
          useGreedy =
            stableRange > greedyRange * 1.5 &&
            stableRange - greedyRange > gap * 8;
        }

        if (useGreedy) {
          result = calculateMasonryLayout({
            cards: Array.from<HTMLElement>({ length: groupItems.length }),
            containerWidth,
            cardSize: settings.cardSize,
            minColumns,
            gap,
            heights,
          });
        } else {
          result = {
            ...existingResult,
            positions: stable.positions,
            columnHeights: stable.columnHeights,
            containerHeight: stable.containerHeight,
            columnAssignments: stable.columnAssignments,
            heights,
          };
        }
      } else {
        result = calculateMasonryLayout({
          cards: Array.from<HTMLElement>({ length: groupItems.length }),
          containerWidth,
          cardSize: settings.cardSize,
          minColumns,
          gap,
          heights,
        });
      }

      for (let i = 0; i < groupItems.length; i++) {
        const pos = result.positions[i];
        if (groupItems[i].el) {
          groupItems[i].el!.style.left = `${pos.left}px`;
          groupItems[i].el!.style.top = `${pos.top}px`;
        }
      }
      const container = isGrouped
        ? this.groupContainers.get(groupKey)
        : this.masonryContainer;
      container?.style.setProperty(
        "--masonry-height",
        `${result.containerHeight}px`,
      );

      result.measuredAtCardWidth = cardWidth;
      this.groupLayoutResults.set(groupKey, result);
      this.updateVirtualItemPositions(groupKey, result);
    }
    this.masonryContainer?.classList.remove("masonry-measuring");
    this.updateCachedGroupOffsets();

    // Compensate scroll position so viewport content stays visually anchored.
    if (anchorItem) {
      const newOffset = this.cachedGroupOffsets.get(anchorItem.groupKey) ?? 0;
      const newAbsY = newOffset + anchorItem.y;
      const delta = newAbsY - anchorAbsY;
      if (delta !== 0) {
        this.isCompensatingScroll = true;
        this.scrollEl.scrollTop = scrollTop + delta;
      }
    }

    // Remove after transition completes
    if (skipTransition) {
      // Re-enable transitions after browser paints the instant correction
      requestAnimationFrame(() => {
        this.masonryContainer?.classList.remove("masonry-skip-transition");
      });
    } else {
      window.setTimeout(() => {
        this.masonryContainer?.classList.remove("masonry-correcting");
      }, MASONRY_CORRECTION_MS);
    }
    return true;
  }

  /** Rebuild the groupKey → VirtualItem[] index.
   *  Must be called after any mutation to virtualItems (push, reset). */
  private rebuildGroupIndex(): void {
    this.virtualItemsByGroup.clear();
    for (const item of this.virtualItems) {
      let group = this.virtualItemsByGroup.get(item.groupKey);
      if (!group) {
        group = [];
        this.virtualItemsByGroup.set(item.groupKey, group);
      }
      group.push(item);
    }
  }

  /** Proportional resize: single-pass layout with zero intermediate allocations.
   *  Inlines the greedy shortest-column algorithm, updates VirtualItems in-place,
   *  and writes styles to mounted cards — all in one iteration. */
  private proportionalResizeLayout(
    groupItems: VirtualItem[],
    cardWidth: number,
    columns: number,
    gap: number,
    priorColumns: number | undefined,
  ): {
    containerHeight: number;
    columnHeights: number[];
    columnAssignments: number[];
  } {
    const columnHeights = new Array(columns).fill(0) as number[];
    const stableColumns = priorColumns === columns;
    const columnAssignments: number[] = [];

    for (let i = 0; i < groupItems.length; i++) {
      const item = groupItems[i];

      // Split proportional height: cover scales with width, text stays fixed
      const height = estimateUnmountedHeight(item, cardWidth);

      let col: number;
      if (stableColumns && columns > 1) {
        // Read stored column index directly — no position/width derivation needed
        col = Math.min(item.col, columns - 1);
      } else {
        // Greedy shortest-column for first layout or column count change
        col = 0;
        let minH = columnHeights[0];
        for (let c = 1; c < columns; c++) {
          if (columnHeights[c] < minH) {
            minH = columnHeights[c];
            col = c;
          }
        }
      }
      const left = col * (cardWidth + gap);
      const top = columnHeights[col];
      columnHeights[col] += height + gap;
      columnAssignments.push(col);

      // Update VirtualItem in-place (replaces updateVirtualItemPositions)
      item.x = left;
      item.y = top;
      item.width = cardWidth;
      item.height = height;
      item.col = col;

      // Apply styles to mounted cards (replaces separate style-write loop)
      if (item.el) {
        item.el.style.width = `${cardWidth}px`;
        item.el.style.left = `${left}px`;
        item.el.style.top = `${top}px`;
        item.el.style.height = `${height}px`;
      }
    }

    const maxH = columns > 0 ? Math.max(...columnHeights) : 0;
    const containerHeight = Math.round(maxH > 0 ? maxH - gap : 0);
    return { containerHeight, columnHeights, columnAssignments };
  }

  /** Compute and cache container offsets for syncVirtualScroll.
   *  Must be called synchronously before syncVirtualScroll — offsets depend on
   *  current scrollTop and are only valid within the same synchronous block. */
  private updateCachedGroupOffsets(): void {
    const scrollRect = this.scrollEl.getBoundingClientRect();
    const scrollTop = this.scrollEl.scrollTop;
    this.cachedGroupOffsets.clear();
    for (const [groupKey, container] of this.groupContainers) {
      if (!container.isConnected) continue;
      const containerRect = container.getBoundingClientRect();
      this.cachedGroupOffsets.set(
        groupKey,
        containerRect.top - scrollRect.top + scrollTop,
      );
    }
  }

  /** Mount a virtual item: render card, apply stored position, set refs */
  private mountVirtualItem(
    item: VirtualItem,
    container: HTMLElement,
    settings: BasesResolvedSettings,
  ): void {
    const handle = this.renderCard(
      container,
      item.cardData,
      item.entry,
      item.index,
      settings,
    );
    handle.el.style.width = `${item.width}px`;
    handle.el.style.left = `${item.x}px`;
    handle.el.style.top = `${item.y}px`;
    handle.el.classList.add("masonry-positioned");
    // Set side cover dimensions synchronously to prevent 1-frame flash.
    // renderCoverWrapper defers updateWrapperDimensions to RAF (needs
    // offsetWidth not yet available during renderCard), but at this point
    // item.width is set and equals offsetWidth (border-box, no border).
    const wrapperRatio = handle.el.style.getPropertyValue(
      "--dynamic-views-wrapper-ratio",
    );
    if (wrapperRatio) {
      const targetWidth = Math.floor(parseFloat(wrapperRatio) * item.width);
      handle.el.style.setProperty(
        "--dynamic-views-side-cover-width",
        `${targetWidth}px`,
      );
      handle.el.style.setProperty(
        "--dynamic-views-side-cover-content-padding",
        `${targetWidth}px`,
      );
    }
    // Set explicit height to match stored layout height. Prevents height drift
    // in freshly rendered cards from triggering remeasureAndReposition during
    // scroll — small per-card differences cascade through columns, causing
    // visible jumping. Cleared when remeasureAndReposition runs at scroll-idle.
    handle.el.style.height = `${item.height}px`;
    this.hasExplicitScrollHeights = true;
    item.el = handle.el;
    item.handle = handle;
  }

  /** Unmount a virtual item: cleanup, remove from DOM, clear refs */
  private unmountVirtualItem(item: VirtualItem): void {
    if (this.focusState.hoveredEl === item.el) {
      this.focusState.hoveredEl = null;
    }
    item.handle?.cleanup();
    // eslint-disable-next-line obsidianmd/no-static-styles-assignment -- clearing inline layout height before DOM removal
    item.el!.style.height = "";
    this.cardResizeObserver?.unobserve(item.el!);
    item.el?.remove();
    item.el = null;
    item.handle = null;
  }

  /** Sync visible items based on scroll position — mount/unmount as needed */
  private syncVirtualScroll(cached?: {
    scrollTop: number;
    paneHeight: number;
  }): void {
    if (!this.virtualItems.length || !this.lastRenderedSettings) return;
    // Only sync after user has scrolled — prevents premature unmounting
    // during initial render and batch loading
    if (!this.hasUserScrolled) return;
    const scrollTop = cached?.scrollTop ?? this.scrollEl.scrollTop;
    const paneHeight = cached?.paneHeight ?? this.scrollEl.clientHeight;
    const settings = this.lastRenderedSettings;

    // Use cached container offsets — computed after layout updates, not every scroll frame
    if (this.cachedGroupOffsets.size === 0) return;
    const offsets = this.cachedGroupOffsets;

    // Buffer = 1x pane height above/below — scales with pane size
    const visibleTop = scrollTop - paneHeight;
    const visibleBottom = scrollTop + paneHeight + paneHeight;

    let mountedNew = false;
    for (const item of this.virtualItems) {
      // Skip items not yet positioned (height 0 = created but not laid out)
      if (item.height === 0) continue;

      const containerOffsetY = offsets.get(item.groupKey);
      if (containerOffsetY === undefined) continue;

      const itemTop = containerOffsetY + item.y;
      const itemBottom = itemTop + item.height;
      const inView = itemBottom > visibleTop && itemTop < visibleBottom;

      if (inView && !item.el) {
        const container = this.groupContainers.get(item.groupKey);
        if (container) {
          this.mountVirtualItem(item, container, settings);
          mountedNew = true;
        }
      } else if (!inView && item.el) {
        this.unmountVirtualItem(item);
      }
    }

    // Don't remeasure during active scroll — newly mounted cards' heights
    // change as images load (~24px cover drift), causing immediate and
    // deferred remeasures to fight each other (opposite 24px jumps within
    // ~32ms = visible flicker). Debounce: one remeasure + deferred pass
    // after scroll settles (200ms, matching resize correction delay).
    // Reset on every scroll tick (not just mounts) so the remeasure defers
    // until 200ms after the user stops scrolling entirely.
    const shouldScheduleRemeasure =
      this.scrollRemeasureTimeout !== null ||
      this.pendingDeferredResize ||
      (mountedNew &&
        this.resizeCorrectionTimeout === null &&
        this.lastLayoutCardWidth > 0 &&
        !this.batchLayoutPending);
    if (shouldScheduleRemeasure) {
      if (this.scrollRemeasureTimeout !== null) {
        clearTimeout(this.scrollRemeasureTimeout);
      }
      this.scrollRemeasureTimeout = setTimeout(() => {
        this.scrollRemeasureTimeout = null;
        this.onScrollIdle();
      }, MASONRY_CORRECTION_MS);
    }
  }

  /** Runs deferred layout work after scroll settles. Reschedules itself when
   *  blocked by a pending batch layout to avoid silently dropping work. */
  private onScrollIdle(): void {
    if (!this.containerEl?.isConnected) return;
    if (this.pendingDeferredResize) {
      if (this.batchLayoutPending) {
        this.scrollRemeasureTimeout = setTimeout(() => {
          this.scrollRemeasureTimeout = null;
          this.onScrollIdle();
        }, MASONRY_CORRECTION_MS);
        return;
      }
      this.pendingDeferredResize = false;
      this.masonryContainer?.classList.add("masonry-skip-transition");
      this.updateLayoutRef.current?.("resize-observer");
      this.scheduleDeferredRemeasure(true);
      return;
    }
    if (this.batchLayoutPending) {
      this.scrollRemeasureTimeout = setTimeout(() => {
        this.scrollRemeasureTimeout = null;
        this.onScrollIdle();
      }, MASONRY_CORRECTION_MS);
      return;
    }
    if (this.resizeCorrectionTimeout !== null) return;
    if (this.lastLayoutCardWidth <= 0) return;
    if (!this.lastRenderedSettings) return;
    const didWork = this.remeasureAndReposition(
      this.lastLayoutWidth,
      this.lastLayoutCardWidth,
      this.lastRenderedSettings,
      this.lastLayoutMinColumns,
      this.lastLayoutGap,
      this.lastLayoutIsGrouped,
      true,
    );
    if (didWork) this.scheduleDeferredRemeasure(true);
  }

  /** Schedule virtual scroll sync on next animation frame */
  private scheduleVirtualScrollSync(): void {
    if (this.virtualScrollRafId !== null) return;
    this.virtualScrollRafId = requestAnimationFrame(() => {
      this.virtualScrollRafId = null;
      this.updateCachedGroupOffsets();
      this.syncVirtualScroll();
    });
  }

  /** Schedule a deferred remeasure to catch post-measurement height drift.
   *  Uses double-RAF to run after async height changes (e.g. cover-ready,
   *  image aspect ratio updates) have settled. */
  private scheduleDeferredRemeasure(skipTransition = false): void {
    if (this.deferredRemeasureRafId !== null) return;
    this.deferredRemeasureRafId = requestAnimationFrame(() => {
      this.deferredRemeasureRafId = requestAnimationFrame(() => {
        this.deferredRemeasureRafId = null;
        const cleanupSkipTransition = () => {
          if (skipTransition) {
            requestAnimationFrame(() => {
              this.masonryContainer?.classList.remove(
                "masonry-skip-transition",
              );
            });
          }
        };
        if (!this.containerEl?.isConnected) {
          cleanupSkipTransition();
          return;
        }
        if (this.batchLayoutPending) {
          cleanupSkipTransition();
          return;
        }
        if (this.resizeCorrectionTimeout !== null) {
          cleanupSkipTransition();
          return;
        }
        if (this.scrollRemeasureTimeout !== null) {
          cleanupSkipTransition();
          return;
        }
        if (this.lastLayoutCardWidth <= 0) {
          cleanupSkipTransition();
          return;
        }
        if (!this.lastRenderedSettings) {
          cleanupSkipTransition();
          return;
        }
        this.remeasureAndReposition(
          this.lastLayoutWidth,
          this.lastLayoutCardWidth,
          this.lastRenderedSettings,
          this.lastLayoutMinColumns,
          this.lastLayoutGap,
          this.lastLayoutIsGrouped,
          skipTransition,
        );
      });
    });
  }

  /** Mount a specific virtual item by index (for keyboard nav to unmounted cards) */
  private mountVirtualItemByIndex(index: number): HTMLElement | null {
    const item = this.virtualItems.find((v) => v.index === index);
    if (!item || item.el || !this.lastRenderedSettings) return item?.el ?? null;
    const container = this.groupContainers.get(item.groupKey);
    if (!container) return null;
    this.mountVirtualItem(item, container, this.lastRenderedSettings);
    return item.el;
  }

  private renderCard(
    container: HTMLElement,
    card: CardData,
    entry: BasesEntry,
    index: number,
    settings: BasesResolvedSettings,
  ): CardHandle {
    const handle = this.cardRenderer.renderCard(
      container,
      card,
      entry,
      settings,
      {
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
        getVirtualRects: () =>
          this.virtualItems.map((v) => ({
            index: v.index,
            x: v.x,
            y: v.y,
            width: v.width,
            height: v.height,
            el: v.el,
          })),
        onMountItem: (idx: number) => this.mountVirtualItemByIndex(idx),
      },
    );
    this.cardResizeObserver?.observe(handle.el);
    return handle;
  }

  /** Surgical property reorder: rebuild CardData + update title/subtitle/property DOM */
  private updatePropertyOrder(
    visibleProperties: string[],
    settings: BasesResolvedSettings,
    sortMethod: string,
  ): void {
    for (const item of this.virtualItems) {
      // Rebuild CardData with new settings (cheap: property lookups only).
      // Preserves cached textPreview and imageUrl from previous render.
      item.cardData = basesEntryToCardData(
        this.app,
        item.entry,
        settings,
        sortMethod,
        this.sortState.isShuffled,
        visibleProperties,
        item.cardData.textPreview,
        item.cardData.imageUrl,
      );

      // Mounted cards: surgical DOM update (title/subtitle unchanged — guarded by caller)
      if (item.el) {
        this.cardRenderer.rerenderProperties(
          item.el,
          item.cardData,
          item.entry,
          settings,
        );
      }
      // Unmounted cards: cardData updated; next mount uses new order
    }

    if (this.masonryContainer) {
      initializeScrollGradients(this.masonryContainer);
    }
    this.scrollPreservation?.restoreAfterRender();
  }

  /** Update only changed cards in-place without full re-render */
  private async updateCardsInPlace(
    changedPaths: Set<string>,
    allEntries: BasesEntry[],
    settings: BasesResolvedSettings,
  ): Promise<void> {
    // Capture old heights for masonry relayout check
    const heightsBefore = new Map<string, number>();
    for (const path of changedPaths) {
      const cardEl = this.containerEl.querySelector<HTMLElement>(
        `[data-path="${CSS.escape(path)}"]`,
      );
      if (cardEl) heightsBefore.set(path, cardEl.offsetHeight);
    }

    // Clear cache for changed files only
    for (const path of changedPaths) {
      delete this.contentCache.textPreviews[path];
      delete this.contentCache.images[path];
      delete this.contentCache.hasImageAvailable[path];
    }

    // Load fresh content for changed files
    const changedEntries = allEntries.filter((e) =>
      changedPaths.has(e.file.path),
    );
    await loadContentForEntries(
      changedEntries,
      settings,
      this.app,
      this.contentCache.textPreviews,
      this.contentCache.images,
      this.contentCache.hasImageAvailable,
    );

    // Update each changed card's DOM (mounted) and VirtualItem data (unmounted)
    for (const path of changedPaths) {
      // Update mounted card DOM
      const cardEl = this.containerEl.querySelector<HTMLElement>(
        `[data-path="${CSS.escape(path)}"]`,
      );
      if (cardEl) {
        updateTextPreviewDOM(
          cardEl,
          this.contentCache.textPreviews[path] || "",
        );
      }

      // Update unmounted VirtualItem card data so remount uses fresh content
      for (const item of this.virtualItems) {
        if (item.cardData.path === path && !item.el) {
          item.cardData.textPreview =
            this.contentCache.textPreviews[path] || "";
        }
      }
    }

    // Check for height changes and trigger masonry relayout if needed
    let anyHeightChanged = false;
    for (const path of changedPaths) {
      const cardEl = this.containerEl.querySelector<HTMLElement>(
        `[data-path="${CSS.escape(path)}"]`,
      );
      if (cardEl && cardEl.offsetHeight !== heightsBefore.get(path)) {
        anyHeightChanged = true;
        break;
      }
    }

    if (
      anyHeightChanged &&
      this.lastLayoutCardWidth > 0 &&
      this.lastRenderedSettings &&
      !this.batchLayoutPending &&
      this.resizeCorrectionTimeout === null &&
      this.scrollRemeasureTimeout === null
    ) {
      const didWork = this.remeasureAndReposition(
        this.lastLayoutWidth,
        this.lastLayoutCardWidth,
        this.lastRenderedSettings,
        this.lastLayoutMinColumns,
        this.lastLayoutGap,
        this.lastLayoutIsGrouped,
      );
      if (didWork) this.scheduleDeferredRemeasure();
    }

    // Re-initialize gradients unconditionally (content changed even if height didn't)
    if (this.masonryContainer) {
      initializeScrollGradients(this.masonryContainer);
    }
  }

  private async appendBatch(
    totalEntries: number,
    settings: BasesResolvedSettings,
  ): Promise<void> {
    // Guard: return early if data not initialized or no masonry container
    if (!this.data || !this.masonryContainer) {
      this.isLoading = false;
      return;
    }

    try {
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

      // Collect ONLY NEW entries (from prevCount to currCount), skipping collapsed groups
      const newEntries: BasesEntry[] = [];
      let currentCount = 0;
      const isGrouped = hasGroupBy(this.config);

      for (const processedGroup of processedGroups) {
        const groupKey = processedGroup.group.hasKey()
          ? serializeGroupKey(processedGroup.group.key)
          : undefined;
        if (
          isGrouped &&
          this.collapsedGroups.has(this.getCollapseKey(groupKey))
        )
          continue;

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
        this.containerEl
          .querySelector(".dynamic-views-end-indicator")
          ?.remove();
        return;
      }

      // Clear CSS variable cache for this batch
      clearStyleSettingsCache();

      // Render new cards, handling group boundaries
      // Use captured prevCount/currCount to avoid race conditions
      let displayedSoFar = 0;
      let newCardsRendered = 0;
      const startIndex = prevCount;
      const newCardEls: HTMLElement[] = [];
      const newCardsPerGroup = new Map<string | undefined, HTMLElement[]>();

      for (const processedGroup of processedGroups) {
        if (displayedSoFar >= currCount) break;

        const currentGroupKey = processedGroup.group.hasKey()
          ? serializeGroupKey(processedGroup.group.key)
          : undefined;

        // Skip collapsed groups entirely (only when grouped)
        if (
          isGrouped &&
          this.collapsedGroups.has(this.getCollapseKey(currentGroupKey))
        )
          continue;

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

        // Check if we can reuse the last group container
        if (
          currentGroupKey === this.lastGroup.key &&
          this.lastGroup.container?.isConnected
        ) {
          // Same group as last - append to existing container
          groupEl = this.lastGroup.container;
        } else {
          // Wrap header + group in a section so sticky scopes to the group's content
          const sectionEl = this.masonryContainer.createDiv(
            "dynamic-views-group-section",
          );

          // Render group header
          const collapseKey = this.getCollapseKey(currentGroupKey);
          const headerEl = renderGroupHeader(
            sectionEl,
            processedGroup.group,
            this.config,
            this.app,
            processedGroup.entries.length,
            false, // not collapsed (we skipped collapsed groups above)
            () => {
              if (headerEl) this.toggleGroupCollapse(collapseKey, headerEl);
            },
          );

          // New group - create container for cards
          groupEl = sectionEl.createDiv(
            "dynamic-views-group bases-cards-group masonry-container",
          );
          setGroupKeyDataset(groupEl, currentGroupKey);
          this.groupContainers.set(currentGroupKey, groupEl);

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
          this.config.getOrder(),
          this.contentCache.textPreviews,
          this.contentCache.images,
          this.contentCache.hasImageAvailable,
        );

        for (let i = 0; i < cards.length; i++) {
          const card = cards[i];
          const entry = groupEntries[i];
          const handle = this.renderCard(
            groupEl,
            card,
            entry,
            startIndex + newCardsRendered,
            settings,
          );
          newCardEls.push(handle.el);
          if (!newCardsPerGroup.has(currentGroupKey)) {
            newCardsPerGroup.set(currentGroupKey, []);
          }
          newCardsPerGroup.get(currentGroupKey)!.push(handle.el);
          this.virtualItems.push({
            index: startIndex + newCardsRendered,
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            measuredHeight: 0,
            measuredAtWidth: 0,
            scalableHeight: 0,
            fixedHeight: 0,
            col: 0,
            cardData: card,
            entry,
            groupKey: currentGroupKey,
            el: handle.el,
            handle,
          });
          newCardsRendered++;
        }

        displayedSoFar += groupEntriesToDisplay;
      }

      // Update state for next append - use currCount (captured at start)
      // to ensure consistency even if this.displayedCount changed during async
      this.previousDisplayedCount = currCount;
      this.displayedSoFar = displayedSoFar;
      this.rebuildGroupIndex();

      if (newCardsRendered > 0 && newCardsPerGroup.size > 0) {
        this.batchLayoutPending = true;

        // Card width from last known layout (always available after initial render)
        const cardWidth = this.lastLayoutCardWidth;

        // Pre-set width on ALL new cards for correct text wrapping
        for (const cards of newCardsPerGroup.values()) {
          for (const card of cards) {
            card.style.width = `${cardWidth}px`;
          }
        }

        const runPerGroupLayout = () => {
          if (!this.containerEl?.isConnected) {
            this.batchLayoutPending = false;
            this.isLoading = false;
            return;
          }
          if (this.renderState.version !== currentVersion) {
            this.batchLayoutPending = false;
            this.isLoading = false;
            return;
          }

          // Bail out if any new card was disconnected — can't track virtualItem
          // alignment when cards are missing from the per-group arrays
          const allNewCards = [...newCardsPerGroup.values()].flat();
          if (allNewCards.some((c) => !c.isConnected)) {
            this.batchLayoutPending = false;
            this.isLoading = false;
            this.updateLayoutRef.current?.("card-disconnected-fallback");
            return;
          }

          this.masonryContainer?.classList.add("masonry-measuring");
          this.masonryContainer?.classList.add("masonry-skip-transition");

          try {
            // Force synchronous reflow so heights reflect new widths
            void this.masonryContainer?.offsetHeight;

            const gap = getCardSpacing(this.containerEl);

            for (const [groupKey, groupNewCards] of newCardsPerGroup) {
              const groupContainer =
                this.groupContainers.get(groupKey) ?? this.masonryContainer;
              if (!groupContainer?.isConnected) continue;

              if (groupNewCards.length === 0) continue;

              syncResponsiveClasses(groupNewCards);

              const currentPrevLayout = this.groupLayoutResults.get(groupKey);
              let result: MasonryLayoutResult;

              if (currentPrevLayout) {
                // Incremental: continue from previous column heights
                result = calculateIncrementalMasonryLayout({
                  newCards: groupNewCards,
                  columnHeights: currentPrevLayout.columnHeights,
                  containerWidth: currentPrevLayout.containerWidth,
                  cardWidth: currentPrevLayout.cardWidth,
                  columns: currentPrevLayout.columns,
                  gap,
                });

                // Merge with previous results
                const prevPositions = currentPrevLayout.positions ?? [];
                result.positions = [
                  ...prevPositions,
                  ...(result.positions ?? []),
                ];
                const prevHeights = currentPrevLayout.heights ?? [];
                result.heights = [...prevHeights, ...(result.heights ?? [])];
                const prevCols = currentPrevLayout.columnAssignments ?? [];
                result.columnAssignments = [
                  ...prevCols,
                  ...(result.columnAssignments ?? []),
                ];
              } else {
                // New group: full layout for just this group's cards
                const heights = groupNewCards.map((c) => c.offsetHeight);
                result = calculateMasonryLayout({
                  cards: groupNewCards,
                  containerWidth: this.lastLayoutWidth,
                  cardSize: settings.cardSize,
                  minColumns: settings.minimumColumns,
                  gap,
                  heights,
                });
                // calculateMasonryLayout doesn't set measuredAtCardWidth — add it
                // so virtualItem baselines are set for the resize fast path
                result.measuredAtCardWidth = result.cardWidth;
              }

              // Position new cards only
              const posOffset = currentPrevLayout
                ? (currentPrevLayout.positions?.length ?? 0)
                : 0;
              groupNewCards.forEach((card, index) => {
                const pos = result.positions[posOffset + index];
                card.classList.add("masonry-positioned");
                card.style.left = `${pos.left}px`;
                card.style.top = `${pos.top}px`;
              });

              // Ensure container has masonry-container class
              if (!groupContainer.classList.contains("masonry-container")) {
                groupContainer.classList.add("masonry-container");
              }

              // Update container height
              groupContainer.style.setProperty(
                "--masonry-height",
                `${result.containerHeight}px`,
              );

              // Track expected height for ungrouped mode (ResizeObserver skip)
              if (newCardsPerGroup.size === 1 && groupKey === undefined) {
                this.expectedIncrementalHeight = result.containerHeight;
              }

              // Store for next incremental append
              this.groupLayoutResults.set(groupKey, result);
            }

            // Update virtualItem positions for ALL new cards
            // (new cards are the last N items in virtualItems)
            const viOffset = this.virtualItems.length - newCardsRendered;
            let cardIdx = 0;
            for (const [groupKey, groupNewCards] of newCardsPerGroup) {
              const groupResult = this.groupLayoutResults.get(groupKey);
              if (!groupResult) {
                cardIdx += groupNewCards.length;
                continue;
              }

              const posOffset =
                (groupResult.positions?.length ?? 0) - groupNewCards.length;

              for (let i = 0; i < groupNewCards.length; i++) {
                const item = this.virtualItems[viOffset + cardIdx];
                if (item) {
                  const pos = groupResult.positions[posOffset + i];
                  item.x = pos.left;
                  item.y = pos.top;
                  item.width = groupResult.cardWidth;
                  item.height =
                    groupResult.heights?.[posOffset + i] ?? item.height;
                  if (
                    groupResult.columnAssignments &&
                    posOffset + i < groupResult.columnAssignments.length
                  ) {
                    item.col = groupResult.columnAssignments[posOffset + i];
                  }
                  if (groupResult.measuredAtCardWidth) {
                    item.measuredHeight = item.height;
                    item.measuredAtWidth = groupResult.measuredAtCardWidth;
                    item.scalableHeight = item.el
                      ? measureScalableHeight(item.el)
                      : 0;
                    item.fixedHeight =
                      item.measuredHeight - item.scalableHeight;
                  }
                }
                cardIdx++;
              }
            }
          } finally {
            this.masonryContainer?.classList.remove("masonry-measuring");
            // Clean up skip-transition in finally to avoid permanent stuck class on throw
            requestAnimationFrame(() => {
              this.masonryContainer?.classList.remove(
                "masonry-skip-transition",
              );
            });
          }

          this.batchLayoutPending = false;
          this.isLoading = false;

          this.updateCachedGroupOffsets();
          this.syncVirtualScroll();

          // Initialize gradients for new cards only
          const visibleNewCards = newCardEls.filter(
            (c) => !c.classList.contains(CONTENT_HIDDEN_CLASS),
          );
          initializeScrollGradientsForCards(visibleNewCards);
          initializeTitleTruncationForCards(visibleNewCards);

          if (this.renderState.version === currentVersion) {
            this.checkAndLoadMore(totalEntries, settings);
            if (
              this.displayedSoFar >= this.totalEntries &&
              this.totalEntries > 0
            ) {
              this.showEndIndicator();
            }
          }
        };

        // Schedule via image load + double RAF (same pattern as before)
        const isFixedCoverHeight = document.body.classList.contains(
          "dynamic-views-masonry-fixed-cover-height",
        );

        const allNewCards = [...newCardsPerGroup.values()].flat();
        const runAfterLayout = (fn: () => void) => {
          requestAnimationFrame(() => {
            if (!this.containerEl?.isConnected) {
              this.batchLayoutPending = false;
              this.isLoading = false;
              return;
            }
            requestAnimationFrame(() => {
              if (!this.containerEl?.isConnected) {
                this.batchLayoutPending = false;
                this.isLoading = false;
                return;
              }
              fn();
            });
          });
        };

        if (isFixedCoverHeight) {
          runAfterLayout(runPerGroupLayout);
        } else {
          const newCardImages = allNewCards
            .flatMap((card) => [
              card.querySelector<HTMLImageElement>(
                ".dynamic-views-image-embed img",
              ),
              card.querySelector<HTMLImageElement>(".card-thumbnail img"),
            ])
            .filter((img): img is HTMLImageElement => img !== null);

          const uncachedImages = newCardImages.filter((img) => {
            const cachedRatio = getCachedAspectRatio(img.src);
            if (cachedRatio !== undefined) {
              const card = img.closest<HTMLElement>(".card");
              if (card) {
                card.style.setProperty(
                  "--actual-aspect-ratio",
                  cachedRatio.toString(),
                );
              }
              return false;
            }
            return true;
          });

          if (uncachedImages.length === 0) {
            runAfterLayout(runPerGroupLayout);
          } else {
            void Promise.all(
              uncachedImages.map(
                (img) =>
                  new Promise<void>((resolve) => {
                    if (img.complete) {
                      resolve();
                      return;
                    }
                    img.addEventListener("load", () => resolve(), {
                      once: true,
                    });
                    img.addEventListener("error", () => resolve(), {
                      once: true,
                    });
                  }),
              ),
            ).then(() => {
              if (!this.containerEl?.isConnected) {
                this.batchLayoutPending = false;
                this.isLoading = false;
                return;
              }
              if (this.renderState.version !== currentVersion) {
                this.batchLayoutPending = false;
                this.isLoading = false;
                return;
              }
              runAfterLayout(runPerGroupLayout);
            });
          }
        }
      }
    } finally {
      // Clear loading flag for synchronous paths (no-op).
      // The per-group path clears isLoading when its deferred layout executes.
      if (!this.batchLayoutPending) {
        this.isLoading = false;
      }
    }
  }

  private setupInfiniteScroll(
    totalEntries: number,
    settings?: BasesResolvedSettings,
  ): void {
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

    const needsMoreItems = () => this.displayedCount < totalEntries;

    // Shared load check function
    const checkAndLoad = () => {
      // Skip if container disconnected, already loading, or all loaded
      if (!scrollContainer.isConnected || this.isLoading || !needsMoreItems()) {
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
      // Skip sync for programmatic scroll compensation — positions were
      // just recalculated, syncing would cascade into another remeasure
      if (this.isCompensatingScroll) {
        this.isCompensatingScroll = false;
        return;
      }
      // Activate virtual scrolling on first user scroll
      this.hasUserScrolled = true;

      // Virtual scroll sync (RAF-debounced, runs on every scroll)
      this.scheduleVirtualScrollSync();

      // Throttled infinite scroll check
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
    if (needsMoreItems() && this.masonryContainer) {
      let prevHeight = this.masonryContainer.offsetHeight;
      const RO = (this.masonryContainer.ownerDocument.defaultView ?? window)
        .ResizeObserver;
      this.scrollResizeObserver = new RO((entries) => {
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

    // Trigger initial checks
    checkAndLoad();
    this.updateCachedGroupOffsets();
    this.syncVirtualScroll();
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
    this.renderState.abortController?.abort();
    if (this.resizeCorrectionTimeout !== null) {
      clearTimeout(this.resizeCorrectionTimeout);
    }
    if (this.cardResizeRafId !== null) {
      cancelAnimationFrame(this.cardResizeRafId);
    }

    if (this.trailingUpdate.timeoutId !== null) {
      window.clearTimeout(this.trailingUpdate.timeoutId);
    }
    if (this.templateCooldownRef.value !== null) {
      clearTimeout(this.templateCooldownRef.value);
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
    // Clean up property measurement observer for this window only
    const cleanupWindow = this.containerEl.ownerDocument.defaultView;
    if (cleanupWindow) cleanupVisibilityObserver(cleanupWindow);
    if (this.virtualScrollRafId !== null) {
      cancelAnimationFrame(this.virtualScrollRafId);
    }
    if (this.scrollRemeasureTimeout !== null) {
      clearTimeout(this.scrollRemeasureTimeout);
    }
    if (this.deferredRemeasureRafId !== null) {
      cancelAnimationFrame(this.deferredRemeasureRafId);
    }
    this.focusCleanup?.();
    this.cardRenderer.cleanup(true); // Force viewer cleanup on view destruction
  }

  focus(): void {
    this.containerEl.focus({ preventScroll: true });
  }
}

/** Export options for registration — type assertion needed because Obsidian's
 * official type is `() => ViewOption[]` but runtime passes BasesViewConfig */
export const masonryViewOptions = ((config: BasesViewConfig) =>
  getMasonryViewOptions(config)) as unknown as () => ViewOption[];
