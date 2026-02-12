/**
 * Bases Masonry View
 * Masonry layout view using Bases API
 */

import { BasesView, BasesEntry, QueryController, TFile } from "obsidian";
import { CardData } from "../shared/card-renderer";
import { transformBasesEntries } from "../shared/data-transform";
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
  type MasonryLayoutResult,
} from "../utils/masonry-layout";
import {
  SharedCardRenderer,
  initializeTitleTruncation,
  initializeTitleTruncationForCards,
  syncResponsiveClasses,
  applyViewContainerStyles,
} from "./shared-renderer";
import { getCachedAspectRatio } from "../shared/image-loader";
import {
  PANE_MULTIPLIER,
  ROWS_PER_COLUMN,
  MAX_BATCH_SIZE,
  SCROLL_THROTTLE_MS,
  RESIZE_THROTTLE_MS,
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
  autoUpdateSettingsTemplate,
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
import {
  setupContentVisibility,
  CONTENT_HIDDEN_CLASS,
} from "../shared/content-visibility";

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
  private focusCleanup: (() => void) | null = null;
  private previousIsTemplateRef = { value: undefined as boolean | undefined };

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
  private scrollResizeObserver: ResizeObserver | null = null;
  private containerRef: { current: HTMLElement | null } = { current: null };
  private previousDisplayedCount: number = 0;
  private contentVisibility: ReturnType<typeof setupContentVisibility> | null =
    null;
  private layoutResizeObserver: ResizeObserver | null = null;
  private resizeRafId: number | null = null;
  private resizeThrottleTimeout: number | null = null;
  private groupLayoutResults: Map<string | undefined, MasonryLayoutResult> =
    new Map();
  private expectedIncrementalHeight: number | null = null;
  private totalEntries: number = 0;
  private displayedSoFar: number = 0;
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

    for (let i = 0; i < cards.length; i++) {
      this.renderCard(
        groupEl,
        cards[i],
        entries[i],
        precedingCards + i,
        settings,
      );
    }

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
      MASONRY_VIEW_TYPE,
      this.plugin,
      this.app,
      this,
      this.previousIsTemplateRef,
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
            ?.settings
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

      autoUpdateSettingsTemplate(this.config, "masonry", this.plugin);

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

          // Skip card rendering for collapsed groups
          if (isCollapsed) continue;
        } else {
          // Ungrouped: no collapse, budget check applies normally
          if (displayedSoFar >= this.displayedCount) break;
          // Render directly to masonry container
          cardContainer = this.masonryContainer;
          groupKey = undefined;
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

      // Initial layout calculation (sets --masonry-width on cards)
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

        // Phase 1: Set all widths + force content rendering for accurate measurement
        // masonry-measuring overrides content-visibility: auto on positioned cards
        // so off-screen cards render their content for accurate offsetHeight reads
        this.masonryContainer.classList.add("masonry-measuring");
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
        // Restore content-visibility (CSS rule takes over for off-screen cards)
        this.masonryContainer?.classList.remove("masonry-measuring");

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
      const newWidth = Math.floor(entry.contentRect.width);

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
    settings: BasesResolvedSettings,
  ): HTMLElement {
    const cardEl = this.cardRenderer.renderCard(
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
      },
    );
    this.contentVisibility?.observe(cardEl);
    return cardEl;
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

    // Update each changed card's DOM
    for (const path of changedPaths) {
      const cardEl = this.containerEl.querySelector<HTMLElement>(
        `[data-path="${CSS.escape(path)}"]`,
      );
      if (!cardEl) continue;

      // Update text preview
      const previewEl = cardEl.querySelector(".card-text-preview");
      if (previewEl) {
        previewEl.textContent = this.contentCache.textPreviews[path] || "";
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

    if (anyHeightChanged && this.updateLayoutRef.current) {
      this.updateLayoutRef.current("content-update");
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
    if (!this.data || !this.masonryContainer) return;

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
      let groupsWithNewCards = 0; // Track how many groups received cards
      const newCardEls: HTMLElement[] = [];

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
          const cardEl = this.renderCard(
            groupEl,
            card,
            entry,
            startIndex + newCardsRendered,
            settings,
          );
          newCardEls.push(cardEl);
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

      // Use incremental layout if we have previous state, otherwise fall back to full recalc
      // For grouped mode, use lastGroupKey; for ungrouped, use undefined
      const layoutKey = this.lastGroup.container
        ? this.lastGroup.key
        : undefined;
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
        // Initialize gradients for new cards only (avoids re-scanning old hidden cards)
        initializeScrollGradientsForCards(newCardEls);
        initializeTitleTruncationForCards(newCardEls);
      } else if (!prevLayout && newCardsRendered > 0) {
        // No previous layout for this container (new group) - trigger full recalc
        this.updateLayoutRef.current?.("new-group-fallback");
        // Initialize gradients for new cards only
        initializeScrollGradientsForCards(newCardEls);
        initializeTitleTruncationForCards(newCardEls);
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
          syncResponsiveClasses(newCards);

          // Force content rendering for accurate measurement
          // (iOS WebKit returns intrinsic fallback for content-visibility: auto)
          this.masonryContainer?.classList.add("masonry-measuring");
          let result: MasonryLayoutResult;
          try {
            // Force synchronous reflow so heights reflect new widths
            void targetContainer.offsetHeight;

            const gap = getCardSpacing(this.containerEl);

            result = calculateIncrementalMasonryLayout({
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
          } finally {
            this.masonryContainer?.classList.remove("masonry-measuring");
          }

          // Track expected height so ResizeObserver can skip this change
          this.expectedIncrementalHeight = result.containerHeight;

          // Update container height (group container or main container)
          targetContainer.style.setProperty(
            "--masonry-height",
            `${result.containerHeight}px`,
          );

          // Store for next incremental append
          this.groupLayoutResults.set(layoutKey, result);

          // Initialize gradients for new cards only (filter out cards that
          // became content-hidden during the double-RAF wait for image load)
          const visibleNewCards = newCardEls.filter(
            (c) => !c.classList.contains(CONTENT_HIDDEN_CLASS),
          );
          initializeScrollGradientsForCards(visibleNewCards);
          initializeTitleTruncationForCards(visibleNewCards);

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
              // Apply cached aspect ratio - height will be correct for layout
              const card = img.closest<HTMLElement>(".card");
              if (card) {
                card.style.setProperty(
                  "--actual-aspect-ratio",
                  cachedRatio.toString(),
                );
              }
              return false; // Don't need to wait for layout (ratio is known)
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
                    img.addEventListener("load", () => resolve(), {
                      once: true,
                    });
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
    } finally {
      // Always clear loading flag — ResizeObserver handles future loads
      this.isLoading = false;
    }
  }

  private setupInfiniteScroll(
    totalEntries: number,
    settings?: BasesResolvedSettings,
  ): void {
    const scrollContainer = this.scrollEl;

    // Recreate content-visibility observer (old IO entries auto-cleaned on DOM wipe)
    this.contentVisibility?.disconnect();
    this.contentVisibility = setupContentVisibility(scrollContainer);
    // Observe all cards already rendered (initial render happens before this call)
    for (const card of this.containerEl.querySelectorAll<HTMLElement>(
      ".card",
    )) {
      this.contentVisibility.observe(card);
    }

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
    this.renderState.abortController?.abort();
    if (this.resizeRafId !== null) {
      cancelAnimationFrame(this.resizeRafId);
    }
    if (this.resizeThrottleTimeout !== null) {
      window.clearTimeout(this.resizeThrottleTimeout);
    }
    if (this.trailingUpdate.timeoutId !== null) {
      window.clearTimeout(this.trailingUpdate.timeoutId);
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
    this.contentVisibility?.disconnect();
    this.focusCleanup?.();
    this.cardRenderer.cleanup(true); // Force viewer cleanup on view destruction
  }

  focus(): void {
    this.containerEl.focus({ preventScroll: true });
  }
}

/** Export options for registration */
export const masonryViewOptions = getMasonryViewOptions;
