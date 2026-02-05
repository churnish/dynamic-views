/**
 * Bases Grid View
 * Primary implementation using Bases API
 */

import { BasesView, BasesEntry, QueryController, TFile } from "obsidian";
import { CardData } from "../shared/card-renderer";
import { reapplyAmbientColors } from "../shared/image-loader";
import { transformBasesEntries } from "../shared/data-transform";
import {
  readBasesSettings,
  getBasesViewOptions,
  extractBasesTemplate,
} from "../shared/settings-schema";
import {
  getCardSpacing,
  clearStyleSettingsCache,
} from "../utils/style-settings";
import { initializeScrollGradients } from "../shared/scroll-gradient";
import {
  SharedCardRenderer,
  initializeTitleTruncation,
  syncResponsiveClasses,
  applyViewContainerStyles,
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
  getStyleSettingsHash,
  getSortMethod,
  loadContentForEntries,
  processGroups,
  renderGroupHeader,
  hasGroupBy,
  serializeGroupKey,
  setGroupKeyDataset,
  UNDEFINED_GROUP_KEY_SENTINEL,
  cleanupBaseFile,
  clearOldTemplateToggles,
  isCurrentTemplateView,
  shouldProcessDataUpdate,
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
import { VIEW_DEFAULTS } from "../constants";
import { showTipOnce } from "../utils/tips";

// Extend Obsidian types
declare module "obsidian" {
  interface App {
    isMobile: boolean;
  }
  interface BasesView {
    file: TFile;
  }
}

export const GRID_VIEW_TYPE = "dynamic-views-grid";

export class DynamicViewsGridView extends BasesView {
  readonly type = GRID_VIEW_TYPE;
  private scrollEl: HTMLElement;
  private leafId: string;
  private containerEl: HTMLElement;
  private plugin: DynamicViews;
  private _resolvedFile: TFile | null | undefined = undefined;
  private _collapsedGroupsLoaded = false;
  private scrollPreservation: ScrollPreservation | null = null;
  private cardRenderer: SharedCardRenderer;
  private _previousCustomClasses: string[] = [];

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
    lastMtimes: new Map(),
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
  private previousIsTemplate: boolean | undefined = undefined;

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

  // Grid-specific state
  private updateLayoutRef: { current: (() => void) | null } = { current: null };
  private displayedCount: number = 50;
  private isLoading: boolean = false;
  private resizeObserver: ResizeObserver | null = null;
  private currentCardSize: number = 400;
  private currentMinColumns: number = 1;
  private feedContainerRef: { current: HTMLElement | null } = { current: null };
  private swipeAbortController: AbortController | null = null;
  private previousDisplayedCount: number = 0;
  private isUpdatingColumns: boolean = false;
  private lastColumnCount: number = 0;
  private resizeRafId: number | null = null;
  private lastObservedWidth: number = 0;
  private hasBatchAppended: boolean = false;
  private collapsedGroups: Set<string> = new Set();
  private viewId: string | null = null;
  private lastDataUpdateTime = { value: 0 };
  private trailingUpdate: {
    timeoutId: number | null;
    callback: (() => void) | null;
    isTrailing?: boolean;
  } = {
    timeoutId: null,
    callback: null,
  };

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

    // Post-render hooks scoped to this group
    syncResponsiveClasses(
      Array.from(groupEl.querySelectorAll<HTMLElement>(".card")),
    );
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

  /** Calculate grid column count based on container width and card size */
  private calculateColumnCount(): number {
    // Use getBoundingClientRect for actual rendered width (clientWidth rounds fractional pixels)
    const containerWidth = Math.floor(
      this.containerEl.getBoundingClientRect().width,
    );
    const cardSize = this.currentCardSize;
    const minColumns = this.currentMinColumns;
    const gap = getCardSpacing(this.containerEl);
    return Math.max(
      minColumns,
      Math.floor((containerWidth + gap) / (cardSize + gap)),
    );
  }

  /**
   * Handle template toggle changes
   * Called from onDataUpdated() since Obsidian calls that for config changes
   */
  private handleTemplateToggle(): void {
    const isTemplate = this.config.get("isTemplate") === true;

    // Only process if isTemplate actually changed
    if (this.previousIsTemplate === isTemplate) {
      return;
    }
    this.previousIsTemplate = isTemplate;

    if (isTemplate) {
      const existingTimestamp = this.config.get("templateSetAt") as
        | number
        | undefined;

      if (existingTimestamp !== undefined) {
        // View loaded with existing toggle — validate it's not stale
        const isStale = !isCurrentTemplateView(
          this.config,
          "grid",
          this.plugin,
        );
        if (isStale) {
          this.config.set("isTemplate", false);
          this.previousIsTemplate = false;
          return;
        }
        // Valid template — no action needed on load
      } else {
        // User just enabled toggle — set timestamp + clear other views
        const timestamp = Date.now();
        this.config.set("templateSetAt", timestamp);
        clearOldTemplateToggles(this.app, GRID_VIEW_TYPE, this);

        // Save settings template
        const templateSettings = extractBasesTemplate(
          this.config,
          VIEW_DEFAULTS,
        );
        void this.plugin.persistenceManager.setSettingsTemplate("grid", {
          settings: templateSettings,
          setAt: timestamp,
        });
      }
    } else {
      // Toggle turned OFF — clear template if this view was the template
      const hadTimestamp = this.config.get("templateSetAt") !== undefined;
      if (hadTimestamp) {
        this.config.set("templateSetAt", undefined);
        void this.plugin.persistenceManager.setSettingsTemplate("grid", null);
      }
    }
  }

  constructor(controller: QueryController, scrollEl: HTMLElement) {
    super(controller);
    // Note: this.config is undefined in constructor (assigned later by QueryController.update())
    // Template defaults are applied via schema defaults in getBasesViewOptions()

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
    ] as DynamicViews;
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

    // Setup swipe interception on mobile if enabled
    this.swipeAbortController = setupBasesSwipeInterception(
      this.containerEl,
      this.app,
      pluginSettings,
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
    super.onload();
  }

  onDataUpdated(): void {
    // Handle template toggle changes (Obsidian calls onDataUpdated for config changes)
    this.handleTemplateToggle();

    // CSS fast-path: apply CSS-only settings immediately (bypasses throttle)
    this.applyCssOnlySettings();

    // Delay reading config - Obsidian may fire onDataUpdated before updating config.getOrder()
    // Using queueMicrotask gives Obsidian time to finish updating config state.
    queueMicrotask(() => this.processDataUpdate());
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
  }

  /** Internal handler after config has settled */
  private processDataUpdate(): void {
    // Capture trailing flag before reset — used to detect stale-settings reverts
    const isTrailing = this.trailingUpdate.isTrailing ?? false;
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
      // Ensure all views in file have valid ids, get this view's id
      const viewIds = await cleanupBaseFile(
        this.app,
        this.currentFile,
        this.plugin,
      );
      const viewName = this.config?.name;
      this.viewId = (viewName && viewIds?.get(viewName)) ?? null;

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

      // Read settings from Bases config (schema defaults include template values)
      const settings = readBasesSettings(
        this.config,
        this.plugin.persistenceManager.getPluginSettings(),
      );

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
        !this._previousCustomClasses ||
        this._previousCustomClasses.length !== customClasses.length ||
        !this._previousCustomClasses.every(
          (cls, i) => cls === customClasses[i],
        );

      if (classesChanged) {
        // Clear previous custom classes
        if (this._previousCustomClasses) {
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
      const settingsHash =
        JSON.stringify(settings) +
        "\0\0" +
        visibleProperties.join("\0") +
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
        visibleProperties.join("\0");

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
        this.feedContainerRef.current?.children.length
      ) {
        // Obsidian may fire onDataUpdated before config.getOrder() is updated.
        // Schedule delayed re-checks at increasing intervals to catch late config updates.
        const propsSnapshot = visibleProperties.join("\0");
        const recheckDelays = [100, 250, 500];
        for (const delay of recheckDelays) {
          setTimeout(() => {
            const currentProps = this.config?.getOrder?.() ?? [];
            const currentPropsStr = currentProps.join("\0");
            if (currentPropsStr !== propsSnapshot) {
              // Reset throttle to allow this re-render
              this.lastDataUpdateTime.value = 0;
              this.processDataUpdate();
            }
          }, delay);
        }

        // Restore column CSS (may be lost on tab switch)
        // Only set if actually changed to avoid triggering observers
        const currentGridColumns = this.containerEl.style.getPropertyValue(
          "--dynamic-views-grid-columns",
        );
        const targetGridColumns = String(this.lastColumnCount);
        if (currentGridColumns !== targetGridColumns) {
          this.containerEl.style.setProperty(
            "--dynamic-views-grid-columns",
            targetGridColumns,
          );
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

      // Skip stale trailing: settings changed but no data changes
      // Prevents Obsidian's stale duplicate events from reverting user's setting changes
      if (
        isTrailing &&
        settingsChanged &&
        pathsUnchanged &&
        changedPaths.size === 0
      ) {
        return;
      }

      // If only content changed (not paths/settings), update in-place
      if (changedPaths.size > 0 && !settingsChanged && pathsUnchanged) {
        await this.updateCardsInPlace(changedPaths, allEntries, settings);
        this.renderState.lastRenderHash = renderHash;
        return;
      }

      // Reset to initial batch if settings changed AND infinite scroll has appended batches
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
        if (settings.imageFormat === "poster") {
          showTipOnce(
            "tipPosterFormat",
            "Tip: Press on poster card to view details. Press again to hide.",
          );
        }
      }
      this.renderState.lastSettingsHash = settingsHash;
      this.renderState.lastRenderHash = renderHash;

      // Set displayedCount when starting fresh (first render or after reset)
      if (this.displayedCount === 0) {
        this.displayedCount = initialCount;
      }

      // Update card size and min columns before calculating columns
      this.currentCardSize = settings.cardSize;
      this.currentMinColumns = settings.minimumColumns;
      const cols = this.calculateColumnCount();

      // Set CSS variables for grid layout
      this.lastColumnCount = cols;
      this.containerEl.style.setProperty(
        "--dynamic-views-grid-columns",
        String(cols),
      );
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
      this.hasBatchAppended = false;
      this.lastObservedWidth = 0;

      // Cleanup card renderer observers before re-rendering
      this.cardRenderer.cleanup();

      // Toggle is-grouped class
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
        const groupKey = processedGroup.group.hasKey()
          ? serializeGroupKey(processedGroup.group.key)
          : undefined;
        const collapseKey = this.getCollapseKey(groupKey);
        // Collapse state only applies when grouped — ungrouped views use
        // a single group with the sentinel key, which may match a previously
        // collapsed group's persisted state.
        const isCollapsed = isGrouped && this.collapsedGroups.has(collapseKey);

        // Budget check: stop rendering cards once limit reached,
        // but always render collapsed group headers (they cost 0 cards)
        if (displayedSoFar >= this.displayedCount && !isCollapsed) break;

        // Wrap header + group in a section so sticky scopes to the group's content
        const sectionEl = feedEl.createDiv("dynamic-views-group-section");

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
        const groupEl = sectionEl.createDiv(
          "dynamic-views-group bases-cards-group",
        );
        setGroupKeyDataset(groupEl, groupKey);

        // Skip card rendering for collapsed groups
        if (isCollapsed) continue;

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
      // Sync responsive classes before gradient init (ResizeObservers are async)
      syncResponsiveClasses(
        Array.from(feedEl.querySelectorAll<HTMLElement>(".card")),
      );
      initializeScrollGradients(feedEl);
      initializeTitleTruncation(feedEl);

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

      // Setup infinite scroll
      this.setupInfiniteScroll(effectiveTotal, settings);

      // Show end indicator if all items fit in initial render (skip if 0 results)
      if (displayedSoFar >= effectiveTotal && effectiveTotal > 0) {
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
                  "--dynamic-views-grid-columns",
                  String(cols),
                );
                if (scrollBefore > 0) {
                  this.scrollEl.scrollTop = scrollBefore;
                }

                // Re-initialize gradients after column change (card widths changed)
                const feed = this.feedContainerRef.current;
                if (feed) {
                  requestAnimationFrame(() => {
                    // Guard: skip if stale render or disconnected
                    if (!feed.isConnected) return;

                    // Sync responsive classes before gradient init
                    syncResponsiveClasses(
                      Array.from(feed.querySelectorAll<HTMLElement>(".card")),
                    );
                    initializeScrollGradients(feed);
                  });
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

      // Note: Don't reset isLoading here - scroll listener may have started a batch
    })();
  }

  private renderCard(
    container: HTMLElement,
    card: CardData,
    entry: BasesEntry,
    index: number,
    settings: BasesResolvedSettings,
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

  /** Update only changed cards in-place without full re-render */
  private async updateCardsInPlace(
    changedPaths: Set<string>,
    allEntries: BasesEntry[],
    settings: BasesResolvedSettings,
  ): Promise<void> {
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

    // Grid: CSS auto-handles row height changes, no relayout needed
  }

  private async appendBatch(totalEntries: number): Promise<void> {
    // Guard: return early if data not initialized or no feed container
    if (!this.data || !this.feedContainerRef.current) return;

    // Increment render version to cancel any stale onDataUpdated renders
    this.renderState.version++;
    const currentVersion = this.renderState.version;

    const groupedData = this.data.groupedData;

    // Read settings (schema defaults include template values)
    const settings = readBasesSettings(
      this.config,
      this.plugin.persistenceManager.getPluginSettings(),
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
      if (isGrouped && this.collapsedGroups.has(this.getCollapseKey(groupKey)))
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
      const startInGroup = Math.max(0, prevCount - displayedSoFar);
      const groupEntries = processedGroup.entries.slice(
        startInGroup,
        groupEntriesToDisplay,
      );

      // Get or create group container
      let groupEl: HTMLElement;

      if (
        currentGroupKey === this.lastGroup.key &&
        this.lastGroup.container?.isConnected
      ) {
        // Same group as last - append to existing container
        groupEl = this.lastGroup.container;
      } else {
        // Wrap header + group in a section so sticky scopes to the group's content
        const sectionEl = this.feedContainerRef.current.createDiv(
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
        groupEl = sectionEl.createDiv("dynamic-views-group bases-cards-group");
        setGroupKeyDataset(groupEl, currentGroupKey);

        // Update last group tracking
        this.lastGroup.key = currentGroupKey;
        this.lastGroup.container = groupEl;
      }

      // Transform and render cards, collecting refs for batch init
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

      displayedSoFar += groupEntriesToDisplay;
    }

    // Update state for next append - use currCount (captured at start)
    // to ensure consistency even if this.displayedCount changed during async
    this.previousDisplayedCount = currCount;

    // Batch-initialize scroll gradients and title truncation for newly rendered cards only
    if (newCardEls.length > 0) {
      // Sync responsive classes before gradient init (ResizeObservers are async)
      syncResponsiveClasses(newCardEls);
      // Initialize gradients/truncation (uses caching to skip already-processed fields)
      if (this.feedContainerRef.current) {
        initializeScrollGradients(this.feedContainerRef.current);
        initializeTitleTruncation(this.feedContainerRef.current);
      }
    }

    // Mark that batch append occurred (for end indicator)
    this.hasBatchAppended = true;

    // Clear loading flag - existing scroll listener handles future loads
    this.isLoading = false;
  }

  private setupInfiniteScroll(
    totalEntries: number,
    settings?: BasesResolvedSettings,
  ): void {
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
              settings.minimumColumns,
              Math.floor(
                (containerWidth + getCardSpacing(this.containerEl)) /
                  (settings.cardSize + getCardSpacing(this.containerEl)),
              ),
            )
          : parseInt(
              this.containerEl.style.getPropertyValue(
                "--dynamic-views-grid-columns",
              ) || "2",
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
export const cardViewOptions = () => getBasesViewOptions("grid");
