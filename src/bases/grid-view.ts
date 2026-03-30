/**
 * Bases Grid View
 * Primary implementation using Bases API
 */

import type { BasesViewConfig, BasesAllOptions } from 'obsidian';
import {
  BasesView,
  BasesEntry,
  Events,
  Platform,
  QueryController,
  TFile,
} from 'obsidian';
import { CardData } from '../shared/card-renderer';
import {
  basesEntryToCardData,
  transformBasesEntries,
} from '../shared/data-transform';
import {
  readBasesSettings,
  getBasesViewOptions,
} from '../shared/settings-schema';
import {
  getCardSpacing,
  getCompactBreakpoint,
  clearStyleSettingsCache,
} from '../utils/style-settings';
import {
  CSS_ONLY_SETTINGS_KEYS,
  ORDER_DERIVED_SETTINGS_KEYS,
  PLUGIN_SETTINGS_CHANGE,
} from '../constants';
import { FullScreenController } from './full-screen';
import {
  initializeScrollGradients,
  initializeScrollGradientsForCards,
} from '../shared/scroll-gradient';
import { resetPersistentWidthCache } from '../shared/property-measure';
import {
  SharedCardRenderer,
  syncResponsiveClasses,
  applyViewContainerStyles,
  applyCssOnlySettings,
  type CardHandle,
} from './shared-renderer';
import {
  PANE_MULTIPLIER,
  ROWS_PER_COLUMN,
  MAX_BATCH_SIZE,
  SCROLL_THROTTLE_MS,
  MOUNT_REMEASURE_MS,
  MOMENTUM_GUARD_MS,
  HIDDEN_BUFFER_MULTIPLIER,
  FIXED_COVER_HEIGHT_GRID,
  FIXED_COVER_HEIGHT_BOTH,
  computeHoverScale,
  DIRECTION_ACCUM_THRESHOLD,
  HIGH_VELOCITY_THRESHOLD,
} from '../shared/constants';
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
  UNDEFINED_GROUP_KEY_SENTINEL,
  cleanUpBaseFile,
  shouldProcessDataUpdate,
  handleTemplateToggle,
} from './utils';
import {
  initializeContainerFocus,
  setupHoverKeyboardNavigation,
  type VirtualCardRect,
} from '../shared/keyboard-nav';
import {
  ScrollPreservation,
  getLeafProps,
} from '../shared/scroll-preservation';
import {
  buildDisplayToSyntaxMap,
  buildSyntaxToDisplayMap,
  normalizeSettingsPropertyNames,
} from '../utils/property';
import type DynamicViews from '../../main';
import type {
  BasesResolvedSettings,
  ContentCache,
  RenderState,
  LastGroupState,
  ScrollThrottleState,
  SortState,
  FocusState,
} from '../types';
import {
  VirtualItem,
  measureScalableHeight,
  estimateUnmountedHeight,
} from '../shared/virtual-scroll';
import { setupStickyHeadingObserver } from './sticky-heading';
import {
  initializeTextPreviewClamp,
  initializeTextPreviewClampForCards,
} from '../shared/text-preview-dom';
import { CONTENT_HIDDEN_CLASS } from '../shared/content-visibility';

// Extend Obsidian types
declare module 'obsidian' {
  interface App {
    isMobile: boolean;
  }
  interface BasesView {
    file: TFile;
  }
}

export const GRID_VIEW_TYPE = 'dynamic-views-grid';

function setHoverScaleForCards(cards: HTMLElement[]): void {
  if (cards.length === 0) return;
  const scaleX = computeHoverScale(cards[0].offsetWidth);
  const heights = cards.map((c) => c.offsetHeight);
  for (let i = 0; i < cards.length; i++) {
    if (heights[i] > 0) {
      cards[i].style.setProperty('--hover-scale-x', scaleX);
      cards[i].style.setProperty(
        '--hover-scale-y',
        computeHoverScale(heights[i])
      );
    }
  }
}

export class DynamicViewsGridView extends BasesView {
  // #region State & field declarations
  readonly type = GRID_VIEW_TYPE;
  private scrollEl: HTMLElement;
  private leafId: string;
  private containerEl: HTMLElement;
  /** Embedded .base views (via ![[file.base]]) skip the end indicator */
  private isEmbedded: boolean;
  /** Resolves from registry each time — survives hot-reload / plugin re-enable */
  private get plugin(): DynamicViews {
    return this.app.plugins.plugins['dynamic-views'] as DynamicViews;
  }
  private _resolvedFile: TFile | null | undefined = undefined;
  private _collapsedGroupsLoaded = false;
  private scrollPreservation: ScrollPreservation | null = null;
  private cardRenderer: SharedCardRenderer;
  private _previousCustomClasses: string[] = [];
  private currentDoc: Document = document;
  private disconnectStyleObserver: (() => void) | null = null;

  // Consolidated state objects (shared patterns with masonry-view)
  private contentCache: ContentCache = {
    textPreviews: {},
    images: {},
    hasImageAvailable: {},
  };
  private renderState: RenderState = {
    version: 0,
    abortController: null,
    lastRenderHash: '',
    lastSettingsHash: null,
    lastPropertySetHash: null,
    lastSettingsHashExcludingOrder: null,
    lastStyleSettingsHash: null,
    lastMtimes: new Map(),
  };
  // Track last rendered settings to detect stale config (see readBasesSettings)
  private lastRenderedSettings: BasesResolvedSettings | null = null;
  // Per-card data for surgical property reorder (avoids full re-render)
  private cardDataByPath = new Map<
    string,
    { cardData: CardData; entry: BasesEntry }
  >();
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
  private keyboardNav: { cleanup: () => void; reattach: () => void } | null =
    null;
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

  // Grid-specific state
  private updateLayoutRef: { current: (() => void) | null } = { current: null };
  private displayedCount: number = 50;
  private isLoading: boolean = false;
  private resizeObserver: ResizeObserver | null = null;
  private observerWindow: (Window & typeof globalThis) | null = null;
  private get win(): Window & typeof globalThis {
    return this.observerWindow ?? window;
  }
  private currentCardSize: number = 400;
  private currentMinColumns: number = 1;
  private feedContainerRef: { current: HTMLElement | null } = { current: null };
  private previousDisplayedCount: number = 0;
  private isUpdatingColumns: boolean = false;
  private lastColumnCount: number = 0;
  private resizeRafId: number | null = null;
  private lastObservedWidth: number = 0;
  private stickyHeadings: ReturnType<typeof setupStickyHeadingObserver> | null =
    null;
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

  // Virtual scroll state
  private virtualItems: VirtualItem[] = [];
  private virtualItemsByGroup = new Map<string | undefined, VirtualItem[]>();
  private virtualItemByPath = new Map<string, VirtualItem>();
  private groupContainers = new Map<string | undefined, HTMLElement>();
  private placeholderEls = new Map<VirtualItem, HTMLElement>();
  private cachedGroupOffsets = new Map<string | undefined, number>();
  private groupOffsetsDirty = true;
  private hasUserScrolled = false;
  private compensatingScrollCount = 0;
  private committedRow: {
    groupKey: string | undefined;
    rowStart: number;
    reverse: boolean;
  } | null = null;
  // Scroll direction + velocity tracking (Phase 1 committed-row ordering)
  private lastSyncScrollTop = 0;
  private lastSyncTime = 0;
  private hasCommittedAnyRow = false;
  private jumpPending = false;
  private lastScrollDown = true;
  private scrollDirectionAccum = 0;
  private isLayoutBusy = false;
  private virtualScrollRafId: number | null = null;
  private totalEntries = 0;
  private cardResizeObserver: ResizeObserver | null = null;
  private cardResizeRafId: number | null = null;
  private cardResizeDirty = false;
  private mountRemeasureTimeout: ReturnType<typeof setTimeout> | null = null;
  private isMountRemeasuring = false;
  private newlyMountedEls: HTMLElement[] = [];
  private lastMeasuredCardWidth = 0;
  private cardVerticalPadding: number | null = null;
  // iOS momentum mitigation state (all gated on this.measureLane)
  private measureLane: HTMLElement | null = null;
  private scrollMountLockedEls = new Set<HTMLElement>();
  private scrollIdleTimeout: ReturnType<typeof setTimeout> | null = null;
  private touchActive = true;
  private lastTouchEndTime = 0;
  private touchAbort: AbortController | null = null;
  private fullScreen: FullScreenController | null = null;

  // #endregion State & field declarations
  // #region Group collapse/expand
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
    headerEl: HTMLElement
  ): void {
    const wasCollapsed = this.collapsedGroups.has(collapseKey);
    if (wasCollapsed) {
      this.collapsedGroups.delete(collapseKey);
      headerEl.removeClass('collapsed');
    } else {
      this.collapsedGroups.add(collapseKey);
      headerEl.addClass('collapsed');
    }

    // Persist collapse state (async — in-memory state is authoritative)
    void this.plugin.persistenceManager.setBasesState(
      this.viewId ?? undefined,
      {
        collapsedGroups: Array.from(this.collapsedGroups),
      }
    );

    const groupEl =
      headerEl
        .closest('.dynamic-views-group-section')
        ?.querySelector<HTMLElement>('.dynamic-views-group') ?? null;
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

      // Find matching groupKey for VirtualItem cleanup
      let matchingGroupKey: string | undefined;
      let foundGroup = false;
      for (const k of this.groupContainers.keys()) {
        if (this.getCollapseKey(k) === collapseKey) {
          matchingGroupKey = k;
          foundGroup = true;
          break;
        }
      }
      if (foundGroup) {
        // Cleanup VirtualItems for collapsed group
        for (const item of this.virtualItems) {
          if (item.groupKey === matchingGroupKey) {
            if (item.el) {
              item.handle?.cleanup();
              this.cardResizeObserver?.unobserve(item.el);
              if (this.focusState.hoveredEl === item.el)
                this.focusState.hoveredEl = null;
            }
            const placeholder = this.placeholderEls.get(item);
            if (placeholder) {
              placeholder.remove();
              this.placeholderEls.delete(item);
            }
            this.virtualItemByPath.delete(item.cardData.path);
          }
        }

        // Remove from virtualItemsByGroup and rebuild order
        this.virtualItemsByGroup.delete(matchingGroupKey);
        this.rebuildVirtualItemsOrder();
        this.groupContainers.delete(matchingGroupKey);
        this.rebuildGroupIndex();

        // Refresh offsets — later groups moved up
        this.refreshGroupOffsets();
      }

      this.renderState.lastRenderHash = '';
      const headerTop = headerEl.getBoundingClientRect().top;
      const scrollTop = this.scrollEl.getBoundingClientRect().top;
      // Only scroll when the header was stuck (now above the viewport)
      if (headerTop < scrollTop) {
        this.scrollEl.scrollTop += headerTop - scrollTop;
      }
      // Trigger scroll check — collapsing reduces height, may need to load more
      this.scrollEl.dispatchEvent(new Event('scroll'));
    }
  }

  /** Populate a single group's cards without re-rendering the entire view */
  private async expandGroup(
    collapseKey: string,
    groupEl: HTMLElement
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
      'grid',
      this.lastRenderedSettings ?? undefined
    );

    // Normalize property names once — downstream code uses pre-normalized values
    const reverseMap = buildDisplayToSyntaxMap(this.config, this.allProperties);
    const displayNameMap = buildSyntaxToDisplayMap(
      this.config,
      this.allProperties
    );
    normalizeSettingsPropertyNames(
      this.app,
      settings,
      reverseMap,
      displayNameMap
    );

    const sortMethod = getSortMethod(this.config);

    // processGroups for shuffle-stable ordering
    const processed = processGroups(
      [group],
      this.sortState.isShuffled,
      this.sortState.order
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
      this.contentCache.hasImageAvailable
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
      this.contentCache.hasImageAvailable
    );

    // Count cards in preceding groups for correct card index
    const precedingCards = groupEl.parentElement
      ? Array.from(
          groupEl.parentElement.querySelectorAll<HTMLElement>(
            '.bases-cards-group'
          )
        )
          .filter((el) => el !== groupEl)
          .reduce(
            (sum, el) =>
              sum +
              (el.compareDocumentPosition(groupEl) &
              Node.DOCUMENT_POSITION_FOLLOWING
                ? el.querySelectorAll('.card').length
                : 0),
            0
          )
      : 0;

    this.isLayoutBusy = true;

    const groupKey =
      collapseKey === UNDEFINED_GROUP_KEY_SENTINEL ? undefined : collapseKey;
    const newItems: VirtualItem[] = [];

    for (let i = 0; i < cards.length; i++) {
      const handle = this.renderCard(
        groupEl,
        cards[i],
        entries[i],
        precedingCards + i,
        settings
      );
      const item: VirtualItem = {
        index: 0,
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
        groupKey,
        el: handle.el,
        handle,
      };
      newItems.push(item);
      this.virtualItemByPath.set(cards[i].path, item);
      this.cardResizeObserver?.observe(handle.el);
    }

    this.groupContainers.set(groupKey, groupEl);
    this.virtualItemsByGroup.set(groupKey, newItems);
    this.rebuildVirtualItemsOrder(); // Splice in DOM order
    this.rebuildGroupIndex(); // Refresh cached item.index values

    // Post-render hooks scoped to this group
    const groupCards = Array.from(
      groupEl.querySelectorAll<HTMLElement>('.card')
    );
    syncResponsiveClasses(groupCards);
    initializeScrollGradients(groupEl);
    initializeTextPreviewClamp(groupEl);
    setHoverScaleForCards(groupCards);

    // Measure new card positions
    for (const item of newItems) {
      if (item.el && item.height === 0) {
        this.cacheCardVerticalPadding(item.el);
        const groupContainer = this.groupContainers.get(item.groupKey);
        item.y = item.el.offsetTop - (groupContainer?.offsetTop ?? 0);
        item.x = item.el.offsetLeft - (groupContainer?.offsetLeft ?? 0);
        item.height = item.el.offsetHeight;
        item.width = item.el.offsetWidth;
        item.measuredHeight = item.height;
        item.measuredAtWidth = item.width;
        item.scalableHeight = measureScalableHeight(item.el);
        item.fixedHeight = item.measuredHeight - item.scalableHeight;
      }
    }
    this.refreshGroupOffsets();

    this.isLayoutBusy = false;
    // Immediate cull: expanding a large group can dump many cards into DOM
    if (this.hasUserScrolled) this.syncVirtualScroll();

    // Observe newly expanded heading for sticky stuck detection
    const newHeading = groupEl
      .closest('.dynamic-views-group-section')
      ?.querySelector<HTMLElement>('.bases-group-heading:not(.collapsed)');
    if (newHeading) this.stickyHeadings?.observe(newHeading);

    // Invalidate render hash so next onDataUpdated() doesn't skip
    this.renderState.lastRenderHash = '';
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
      }
    );
    this.renderState.lastRenderHash = '';
    this.onDataUpdated();
  }

  /** Unfold all groups — called by command palette */
  public unfoldAllGroups(): void {
    this.collapsedGroups.clear();
    void this.plugin.persistenceManager.setBasesState(
      this.viewId ?? undefined,
      {
        collapsedGroups: [],
      }
    );
    this.onDataUpdated();
  }
  // #endregion Group collapse/expand
  // #region Batch sizing
  /** Calculate batch size based on current column count */
  private getBatchSize(settings: BasesResolvedSettings): number {
    // Use getBoundingClientRect for actual rendered width (clientWidth rounds fractional pixels)
    const containerWidth = Math.floor(
      this.containerEl.getBoundingClientRect().width
    );
    const minColumns = settings.minimumColumns;
    const gap = getCardSpacing(this.containerEl);
    const cardSize = settings.cardSize;

    if (containerWidth === 0) {
      // Fallback when container not yet laid out — caller guards via isLoading/scroll threshold
      return MAX_BATCH_SIZE;
    }

    const calculatedColumns = Math.floor(
      (containerWidth + gap) / (cardSize + gap)
    );
    const columns = Math.max(minColumns, calculatedColumns);
    const rawCount = columns * ROWS_PER_COLUMN;
    return Math.min(rawCount, MAX_BATCH_SIZE);
  }

  /** Calculate initial card count based on container dimensions */
  private calculateInitialCount(settings: BasesResolvedSettings): number {
    return this.getBatchSize(settings);
  }

  /** Calculate grid column count based on container width and card size */
  private calculateColumnCount(): number {
    // Use getBoundingClientRect for actual rendered width (clientWidth rounds fractional pixels)
    const containerWidth = Math.floor(
      this.containerEl.getBoundingClientRect().width
    );
    const cardSize = this.currentCardSize;
    const minColumns = this.currentMinColumns;
    const gap = getCardSpacing(this.containerEl);
    return Math.max(
      minColumns,
      Math.floor((containerWidth + gap) / (cardSize + gap))
    );
  }
  // #endregion Batch sizing
  // #region Lifecycle
  /**
   * Handle template toggle changes
   * Called from onDataUpdated() since Obsidian calls that for config changes
   */
  private handleTemplateToggleLocal(): void {
    handleTemplateToggle(
      this.config,
      'grid',
      this.plugin,
      this.templateInitializedRef,
      this.templateCooldownRef
    );
  }

  constructor(controller: QueryController, scrollEl: HTMLElement) {
    super(controller);
    // Note: this.config is undefined in constructor (assigned later by QueryController.update())
    // Template defaults are applied via schema defaults in getBasesViewOptions()

    // Store scroll parent reference
    this.scrollEl = scrollEl;
    this.isEmbedded = !!scrollEl.closest('.internal-embed');
    // Find leaf by matching container (getLeaf() creates new leaf if pinned, activeLeaf is deprecated)
    this.leafId = '';
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view?.containerEl?.contains(scrollEl)) {
        this.leafId = getLeafProps(leaf).id ?? '';
      }
    });

    // Create container inside scroll parent
    this.containerEl = scrollEl.createDiv({
      cls: 'dynamic-views dynamic-views-bases-container',
    });

    // Initialize shared card renderer
    this.cardRenderer = new SharedCardRenderer(
      this.app,
      this.plugin,
      this.updateLayoutRef
    );

    // Get plugin settings for feature flags
    const pluginSettings = this.plugin.persistenceManager.getPluginSettings();

    // Placeholder - calculated dynamically on first render
    this.displayedCount = 0;

    // Setup swipe prevention on mobile if enabled
    setupBasesSwipePrevention(this.containerEl, this.app, pluginSettings);

    // Setup full screen mobile scrolling (deferred — navbar may not exist yet on Android)
    if (Platform.isPhone) this.initFullScreen();

    // Watch for Style Settings and plugin settings changes
    this.disconnectStyleObserver = setupStyleSettingsObserver(() => {
      resetPersistentWidthCache();
      this.onDataUpdated();
    }, this.containerEl);
    this.register(() => this.disconnectStyleObserver?.());

    // Detect popout move: sync body classes + rebind observer to new document
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        const ownerDoc = this.containerEl.ownerDocument;
        if (ownerDoc !== this.currentDoc) {
          this.currentDoc = ownerDoc;
          this.handleDocumentChange(ownerDoc);
          // Re-render to recalculate layout with new window context
          resetPersistentWidthCache();
          this.onDataUpdated();
        }
      })
    );

    // Re-render when plugin settings change from the settings tab
    this.registerEvent(
      (this.app.workspace as Events).on(PLUGIN_SETTINGS_CHANGE, () => {
        const newSettings = this.plugin.persistenceManager.getPluginSettings();
        setupBasesSwipePrevention(this.containerEl, this.app, newSettings);
        if (this.fullScreen) {
          if (newSettings.fullScreen) {
            this.fullScreen.mount();
          } else {
            this.fullScreen.unmount();
          }
        }
        resetPersistentWidthCache();
        this.onDataUpdated();
      })
    );

    // Setup hover-to-start keyboard navigation
    this.keyboardNav = setupHoverKeyboardNavigation(
      () => this.focusState.hoveredEl,
      () => this.feedContainerRef.current,
      (index) => {
        this.focusState.cardIndex = index;
      }
    );
    this.register(this.keyboardNav.cleanup);

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

  /** Lazy-init full screen controller. Called from constructor and retried
   *  from onDataUpdated() — on Android, .mobile-navbar may not exist yet at
   *  construction time (FUSE filesystem delays DOM assembly). */
  private initFullScreen(): void {
    if (this.fullScreen) return;
    const ownerDoc = this.scrollEl.ownerDocument;
    const viewContent = this.scrollEl.closest<HTMLElement>('.view-content');
    const navbarEl = ownerDoc.querySelector<HTMLElement>('.mobile-navbar');
    if (!viewContent || !navbarEl) return;

    this.fullScreen = new FullScreenController({
      scrollEl: this.scrollEl,
      container: this.containerEl,
      viewContent,
      navbarEl,
    });
    const pluginSettings = this.plugin.persistenceManager.getPluginSettings();
    if (pluginSettings.fullScreen) {
      this.fullScreen.mount();
    }
    this.register(() => this.fullScreen?.unmount());
  }

  /** Cancel pending RAFs and timeouts, disconnect observers, and clear window reference.
   *  RAFs must be canceled BEFORE nullifying observerWindow — IDs are per-window. */
  private teardownObservers(): void {
    if (this.virtualScrollRafId !== null) {
      this.win.cancelAnimationFrame(this.virtualScrollRafId);
      this.virtualScrollRafId = null;
    }
    if (this.cardResizeRafId !== null) {
      this.win.cancelAnimationFrame(this.cardResizeRafId);
      this.cardResizeRafId = null;
    }
    if (this.resizeRafId !== null) {
      this.win.cancelAnimationFrame(this.resizeRafId);
      this.resizeRafId = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.cardResizeObserver?.disconnect();
    this.cardResizeObserver = null;
    if (this.mountRemeasureTimeout !== null) {
      clearTimeout(this.mountRemeasureTimeout);
      this.mountRemeasureTimeout = null;
    }
    this.observerWindow = null;
  }

  /** Handle view moving to a different document (popout window).
   *  Unlike masonry's (oldDoc, newDoc) signature, grid doesn't need oldDoc
   *  because it has no document-level event listeners to rebind (no
   *  PROPERTY_MEASURED — CSS Grid auto-reflows when property widths change). */
  private handleDocumentChange(newDoc: Document): void {
    // Sync body classes from main window so CSS rules match immediately
    if (newDoc !== document) {
      for (const cls of document.body.classList) {
        if (
          cls.startsWith('dynamic-views-') ||
          cls === 'css-settings-manager'
        ) {
          newDoc.body.classList.add(cls);
        }
      }
    }
    // Rebind style observer to new document's body
    this.disconnectStyleObserver?.();
    this.disconnectStyleObserver = setupStyleSettingsObserver(() => {
      resetPersistentWidthCache();
      this.onDataUpdated();
    }, this.containerEl);

    this.teardownObservers();

    // Rebind keydown listener to the new document (was on old document)
    this.keyboardNav?.reattach();

    // Force processDataUpdate to fall through to full render (which
    // recreates observers in the new window context). Without this, the
    // renderHash early return prevents observer recreation — infinite
    // scroll and card resize detection stay broken in the popout.
    this.renderState.lastRenderHash = '';
  }

  onload(): void {
    super.onload();
  }

  onDataUpdated(): void {
    // Retry full screen init if constructor missed it (Android: navbar not yet in DOM)
    if (Platform.isPhone && !this.fullScreen) this.initFullScreen();

    // Defensive: catch stale document after popout drag-back
    // (layout-change handler may miss the document swap due to timing)
    const ownerDoc = this.containerEl.ownerDocument;
    if (ownerDoc !== this.currentDoc) {
      this.currentDoc = ownerDoc;
      this.handleDocumentChange(ownerDoc);
    }

    // Handle template toggle changes (Obsidian calls onDataUpdated for config changes)
    this.handleTemplateToggleLocal();

    // CSS fast-path: apply CSS-only settings immediately (bypasses throttle)
    applyCssOnlySettings(this.config, this.containerEl);
    // Re-measure per-paragraph clamps after CSS variable change (keep-newlines only)
    initializeTextPreviewClamp(this.containerEl);

    // Delay reading config - Obsidian may fire onDataUpdated before updating config.getOrder()
    // Using queueMicrotask gives Obsidian time to finish updating config state.
    queueMicrotask(() => this.processDataUpdate());
  }

  /** Clear all virtual scroll state for a full re-render. */
  private resetVirtualState(): void {
    this.virtualItems = [];
    this.virtualItemsByGroup.clear();
    this.virtualItemByPath.clear();
    this.groupContainers.clear();
    this.placeholderEls.clear();
    this.cachedGroupOffsets.clear();
    this.groupOffsetsDirty = true;
    this.committedRow = null;
    this.hasCommittedAnyRow = false;
    this.jumpPending = false;
    this.lastScrollDown = true;
    this.scrollDirectionAccum = 0;
    this.lastSyncScrollTop = 0;
    this.lastSyncTime = 0;
    this.cardVerticalPadding = null;
    this.hasUserScrolled = false;
    this.isLayoutBusy = false;
    this.cardResizeDirty = false;
    this.newlyMountedEls = [];
    this.scrollMountLockedEls.clear();
    if (this.scrollIdleTimeout !== null) {
      clearTimeout(this.scrollIdleTimeout);
      this.scrollIdleTimeout = null;
    }
    if (this.virtualScrollRafId !== null) {
      this.win.cancelAnimationFrame(this.virtualScrollRafId);
      this.virtualScrollRafId = null;
    }
    if (this.mountRemeasureTimeout !== null) {
      clearTimeout(this.mountRemeasureTimeout);
      this.mountRemeasureTimeout = null;
    }
    if (this.cardResizeRafId !== null) {
      this.win.cancelAnimationFrame(this.cardResizeRafId);
      this.cardResizeRafId = null;
    }
  }
  // #endregion Lifecycle
  // #region Data processing
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
      let isNewView = false;
      if (!this.viewId || (viewName && !this.viewId.endsWith(`-${viewName}`))) {
        const viewIds = await cleanUpBaseFile(
          this.app,
          this.currentFile,
          this.plugin,
          viewName
        );
        const viewInfo = viewName ? viewIds?.get(viewName) : undefined;
        this.viewId = viewInfo?.id ?? null;
        isNewView = viewInfo?.isNew ?? false;
      }

      // Load collapsed groups from persisted UI state only on first render.
      // After that, the in-memory Set is authoritative (toggleGroupCollapse persists changes).
      // Reloading on every onDataUpdated is unsafe: style-settings triggers onDataUpdated
      // with stale persistence or wrong-file lookups, wiping the in-memory state.
      if (!this._collapsedGroupsLoaded) {
        const basesState = this.plugin.persistenceManager.getBasesState(
          this.viewId ?? undefined
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

      // Template overrides only for genuinely new views (not existing views on app restart).
      // Existing views have their settings saved in YAML — template should not override them.
      const templateOverrides = isNewView
        ? this.plugin.persistenceManager.getSettingsTemplate('grid')
        : undefined;

      // Read settings — pass lastRenderedSettings for stale config fallback,
      // and templateOverrides so new views render with template values immediately
      const settings = readBasesSettings(
        this.config,
        this.plugin.persistenceManager.getPluginSettings(),
        'grid',
        this.lastRenderedSettings ?? undefined,
        templateOverrides
      );
      this.lastRenderedSettings = settings;

      // Normalize property names once — downstream code uses pre-normalized values
      const reverseMap = buildDisplayToSyntaxMap(
        this.config,
        this.allProperties
      );
      const displayNameMap = buildSyntaxToDisplayMap(
        this.config,
        this.allProperties
      );
      normalizeSettingsPropertyNames(
        this.app,
        settings,
        reverseMap,
        displayNameMap
      );

      // Apply per-view CSS classes and variables to container
      applyViewContainerStyles(this.containerEl, settings);

      // Apply custom CSS classes from settings (mimics cssclasses frontmatter)
      const customClasses = settings.cssclasses
        .split(',')
        .map((cls) => cls.trim())
        .filter(Boolean);

      // Only update if classes changed (prevents unnecessary DOM mutations)
      const classesChanged =
        this._previousCustomClasses.length === 0 ||
        this._previousCustomClasses.length !== customClasses.length ||
        !this._previousCustomClasses.every(
          (cls, i) => cls === customClasses[i]
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
      const hashableSettings = Object.fromEntries(
        Object.entries(settings).filter(([k]) => !CSS_ONLY_SETTINGS_KEYS.has(k))
      );
      const settingsHash =
        JSON.stringify(hashableSettings) +
        '\0\0' +
        JSON.stringify(visibleProperties) +
        '\0\0' +
        sortMethod +
        '\0\0' +
        (groupByProperty ?? '');
      const propertySetHash = [...visibleProperties].sort().join('\0');
      // Further exclude order-derived settings for reorder detection
      // (titleProperty, subtitleProperty, _skipLeadingProperties change when
      // displayFirstAsTitle derives them from property order positions)
      const orderIndependentSettings = Object.fromEntries(
        Object.entries(hashableSettings).filter(
          ([k]) => !ORDER_DERIVED_SETTINGS_KEYS.has(k)
        )
      );
      const settingsHashExcludingOrder =
        JSON.stringify(orderIndependentSettings) +
        '\0\0' +
        sortMethod +
        '\0\0' +
        (groupByProperty ?? '');
      const styleSettingsHash = getStyleSettingsHash();

      // Clear text preview cache when style settings change (e.g., keep headings/newlines toggled)
      // without a full settings change — styleSettingsHash is part of renderHash but not settingsHash,
      // so settingsChanged won't fire for these toggles
      if (
        this.renderState.lastStyleSettingsHash !== null &&
        this.renderState.lastStyleSettingsHash !== styleSettingsHash
      ) {
        this.contentCache.textPreviews = {};
      }
      this.renderState.lastStyleSettingsHash = styleSettingsHash;

      // Include mtime and sortMethod in hash so content/sort changes trigger updates
      const collapsedHash = Array.from(this.collapsedGroups).sort().join('\0');
      const renderHash =
        allEntries
          .map((e: BasesEntry) => `${e.file.path}:${e.file.stat.mtime}`)
          .join('\0') +
        '\0\0' +
        settingsHash +
        '\0\0' +
        (groupByProperty ?? '') +
        '\0\0' +
        sortMethod +
        '\0\0' +
        styleSettingsHash +
        '\0\0' +
        collapsedHash +
        '\0\0' +
        String(this.sortState.isShuffled) +
        '\0\0' +
        this.sortState.order.join('\0') +
        '\0\0' +
        JSON.stringify(visibleProperties);

      // Detect files with changed content (mtime changed but paths unchanged)
      const changedPaths = new Set<string>();
      const currentPaths = allEntries.map((e) => e.file.path);
      const lastKeys = Array.from(this.renderState.lastMtimes.keys());
      const pathsUnchanged =
        currentPaths.length === lastKeys.length &&
        currentPaths.every((p) => this.renderState.lastMtimes.has(p));
      // Detect sort-order changes: when a sort-relevant property is edited,
      // Bases re-sorts allEntries AND updates mtime, so changedPaths is
      // non-empty and the renderHash early-exit is bypassed. This check is
      // the only gate that prevents the in-place path from preserving stale
      // DOM positions when the sort order has actually changed.
      const orderUnchanged =
        lastKeys.length === currentPaths.length &&
        currentPaths.every((p, i) => p === lastKeys[i]);

      for (const entry of allEntries) {
        const path = entry.file.path;
        const mtime = entry.file.stat.mtime;
        const lastMtime = this.renderState.lastMtimes.get(path);
        if (lastMtime !== undefined && lastMtime !== mtime) {
          changedPaths.add(path);
        }
      }

      // Update mtime tracking — insertion order must match allEntries (Bases
      // sort order) so the next render's orderUnchanged check works correctly.
      this.renderState.lastMtimes.clear();
      for (const entry of allEntries) {
        this.renderState.lastMtimes.set(entry.file.path, entry.file.stat.mtime);
      }

      if (
        renderHash === this.renderState.lastRenderHash &&
        this.feedContainerRef.current?.children.length &&
        changedPaths.size === 0
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
              // Reset throttle to allow this re-render
              this.lastDataUpdateTime.value = 0;
              this.processDataUpdate();
            }
          }, delay);
        }

        // Restore column CSS (may be lost on tab switch)
        // Only set if actually changed to avoid triggering observers
        const currentGridColumns = this.containerEl.style.getPropertyValue(
          '--dynamic-views-grid-columns'
        );
        const targetGridColumns = String(this.lastColumnCount);
        if (currentGridColumns !== targetGridColumns) {
          this.containerEl.style.setProperty(
            '--dynamic-views-grid-columns',
            targetGridColumns
          );
        }
        this.scrollPreservation?.restoreAfterRender();

        // Viewport may be underfilled after CSS-only setting change or
        // duplicate onDataUpdated killing the batch chain mid-append
        this.checkAndLoadMore(this.totalEntries);
        return;
      }

      // Calculate initial count for comparison and first render
      const initialCount = this.calculateInitialCount(settings);

      // Check if settings changed (for cache clearing and in-place update logic)
      const settingsChanged =
        this.renderState.lastSettingsHash !== null &&
        this.renderState.lastSettingsHash !== settingsHash;

      // If only content changed (not paths/settings/order), update in-place
      if (
        changedPaths.size > 0 &&
        !settingsChanged &&
        pathsUnchanged &&
        orderUnchanged
      ) {
        await this.updateCardsInPlace(
          changedPaths,
          allEntries,
          settings,
          sortMethod,
          visibleProperties
        );
        if (this.renderState.version !== currentVersion) return;
        this.renderState.lastRenderHash = renderHash;
        return;
      }

      // Property reorder only: settings changed but only property ORDER differs.
      // Card heights are invariant under reorder — skip full re-render.
      // Guard: invertPropertyPairing makes pairing position-dependent.
      const propertySetUnchanged =
        this.renderState.lastPropertySetHash !== null &&
        this.renderState.lastPropertySetHash === propertySetHash;
      const isPropertyReorderOnly =
        settingsChanged &&
        propertySetUnchanged &&
        !settings.invertPropertyPairing &&
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
      }
      this.renderState.lastSettingsHash = settingsHash;
      this.renderState.lastRenderHash = renderHash;
      this.renderState.lastPropertySetHash = propertySetHash;
      this.renderState.lastSettingsHashExcludingOrder =
        settingsHashExcludingOrder;

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
        '--dynamic-views-grid-columns',
        String(cols)
      );
      this.containerEl.style.setProperty(
        '--dynamic-views-image-aspect-ratio',
        String(settings.imageRatio)
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
        this.sortState.order
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
          remainingCount
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
        this.contentCache.hasImageAvailable
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
        '--dynamic-views-preserve-height': `${currentHeight}px`,
      });
      this.containerEl.addClass('dynamic-views-height-preserved');

      // Reset virtual scroll state
      this.resetVirtualState();

      // Clear and re-render
      this.containerEl.empty();
      this.measureLane = null;
      this.cardDataByPath.clear();

      // Pre-measurement lane for WebKit — render cards offscreen at column width,
      // run all deferred passes, read final height before grid insertion.
      // Eliminates secondary height drift that causes scrollTop compensation writes
      // (which kill WebKit compositor-driven momentum deceleration).
      if (Platform.isIosApp) {
        const gap = getCardSpacing(this.containerEl);
        const containerWidth = Math.floor(
          this.containerEl.getBoundingClientRect().width
        );
        const laneWidth = (containerWidth - (cols - 1) * gap) / cols;
        this.measureLane = this.containerEl.createDiv(
          'dynamic-views-measure-lane dynamic-views-grid'
        );
        this.measureLane.style.width = `${laneWidth}px`;
      }

      // Reset batch append state for full re-render
      this.previousDisplayedCount = 0;
      this.lastGroup.key = undefined;
      this.lastGroup.container = null;
      this.hasBatchAppended = false;
      this.lastObservedWidth = 0;

      // Cleanup card renderer observers before re-rendering
      this.cardRenderer.cleanup();

      // Toggle is-grouped class
      this.containerEl.toggleClass('is-grouped', isGrouped);

      // Create cards feed container
      const feedEl = this.containerEl.createDiv(
        `dynamic-views-grid${isGrouped ? ' bases-cards-container' : ''}`
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
        const sectionEl = feedEl.createDiv('dynamic-views-group-section');

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
          }
        );

        // Create group container for cards (empty if collapsed, for DOM sibling structure)
        const groupEl = sectionEl.createDiv(
          'dynamic-views-group bases-cards-group'
        );
        setGroupKeyDataset(groupEl, groupKey);
        this.groupContainers.set(groupKey, groupEl);

        // Skip card rendering for collapsed groups
        if (isCollapsed) continue;

        const entriesToDisplay = Math.min(
          processedGroup.entries.length,
          this.displayedCount - displayedSoFar
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
          this.contentCache.hasImageAvailable
        );

        for (let i = 0; i < cards.length; i++) {
          const card = cards[i];
          const entry = groupEntries[i];
          this.cardDataByPath.set(card.path, { cardData: card, entry });
          const handle = this.renderCard(
            groupEl,
            card,
            entry,
            displayedSoFar + i,
            settings
          );
          const item: VirtualItem = {
            index: 0, // Unused by grid — array position is the identity
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
          };
          this.virtualItems.push(item);
          this.virtualItemByPath.set(card.path, item);
        }

        displayedSoFar += entriesToDisplay;

        // Track last group for batch append
        this.lastGroup.key = groupKey;
        this.lastGroup.container = groupEl;
      }

      // Track state for batch append
      this.previousDisplayedCount = displayedSoFar;

      // Batch-initialize scroll gradients after all cards rendered
      // Sync responsive classes before gradient init (ResizeObservers are async)
      syncResponsiveClasses(
        Array.from(feedEl.querySelectorAll<HTMLElement>('.card'))
      );
      initializeScrollGradients(feedEl);
      initializeTextPreviewClamp(feedEl);
      setHoverScaleForCards(
        Array.from(feedEl.querySelectorAll<HTMLElement>('.card'))
      );

      // Measure card positions and build group index for virtual scrolling
      this.rebuildGroupIndex();
      this.measureAllCardPositions();
      this.refreshGroupOffsets();

      // Setup cardResizeObserver and observe all initial cards
      this.setupCardResizeObserver();
      for (const item of this.virtualItems) {
        if (item.el) this.cardResizeObserver!.observe(item.el);
      }

      // Rebuild sticky heading observer for all non-collapsed group headings
      this.stickyHeadings?.disconnect();
      this.stickyHeadings = setupStickyHeadingObserver(this.scrollEl);
      feedEl
        .querySelectorAll<HTMLElement>('.bases-group-heading:not(.collapsed)')
        .forEach((h) => this.stickyHeadings!.observe(h));

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

      this.totalEntries = effectiveTotal;

      // Setup infinite scroll
      this.setupInfiniteScroll(effectiveTotal);

      // Show end indicator if all items fit in initial render (skip if 0 results)
      if (displayedSoFar >= effectiveTotal && effectiveTotal > 0) {
        this.showEndIndicator();
      }

      // Setup ResizeObserver for dynamic grid updates (double-RAF debounce)
      const currentWindow = this.containerEl.ownerDocument.defaultView;
      if (currentWindow && this.observerWindow !== currentWindow) {
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.observerWindow = currentWindow;
      }

      if (!this.resizeObserver) {
        this.resizeObserver = new this.win.ResizeObserver((entries) => {
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

              // Sync measurement lane width (iOS only)
              if (this.measureLane) {
                const gap = getCardSpacing(this.containerEl);
                const containerWidth = Math.floor(
                  this.containerEl.getBoundingClientRect().width
                );
                const laneWidth = (containerWidth - (cols - 1) * gap) / cols;
                this.measureLane.style.width = `${laneWidth}px`;
              }

              // Only update if changed
              if (cols !== this.lastColumnCount) {
                // Save scroll before CSS change, restore after (prevents reflow reset)
                const scrollBefore = this.scrollEl.scrollTop;
                this.lastColumnCount = cols;
                this.committedRow = null;
                this.containerEl.style.setProperty(
                  '--dynamic-views-grid-columns',
                  String(cols)
                );
                if (scrollBefore > 0) {
                  this.scrollEl.scrollTop = scrollBefore;
                }

                // Remount-and-cull: column change invalidates height estimates
                this.isLayoutBusy = true;
                this.win.requestAnimationFrame(() => {
                  if (!this.containerEl?.isConnected) {
                    this.isLayoutBusy = false;
                    return;
                  }

                  const rvSettings = this.lastRenderedSettings;
                  if (!rvSettings) {
                    this.isLayoutBusy = false;
                    return;
                  }

                  // Refresh group offsets — column change reflows CSS Grid
                  this.refreshGroupOffsets();

                  // Unmount content-hidden cards: can't measure at new width
                  for (const item of this.virtualItems) {
                    if (item.el?.classList.contains(CONTENT_HIDDEN_CLASS)) {
                      this.unmountVirtualItem(item);
                    }
                  }

                  const rvScrollTop = this.scrollEl.scrollTop;
                  const paneHeight = this.scrollEl.clientHeight;
                  const visibleTop = rvScrollTop - paneHeight;
                  const visibleBottom = rvScrollTop + paneHeight + paneHeight;

                  // Phase 1: Mount all items in viewport + buffer
                  for (const item of this.virtualItems) {
                    if (!item.el && item.height > 0) {
                      const containerOffsetY = this.cachedGroupOffsets.get(
                        item.groupKey
                      );
                      if (containerOffsetY === undefined) continue;
                      const itemTop = containerOffsetY + item.y;
                      const itemBottom = itemTop + item.height;
                      if (itemBottom > visibleTop && itemTop < visibleBottom) {
                        this.mountVirtualItem(item, rvSettings);
                      }
                    }
                  }

                  // Phase 2: Measure actual heights and positions
                  // Read from DOM — item.width is stale (from pre-resize).
                  const newCardWidth =
                    this.virtualItems.find((v) => v.el)?.el?.offsetWidth ?? 0;
                  this.lastMeasuredCardWidth = newCardWidth;
                  for (const item of this.virtualItems) {
                    if (item.el) {
                      const groupEl = this.groupContainers.get(item.groupKey);
                      item.x = item.el.offsetLeft - (groupEl?.offsetLeft ?? 0);
                      item.height = item.el.offsetHeight;
                      item.width = item.el.offsetWidth;
                      item.measuredHeight = item.height;
                      item.measuredAtWidth = item.width;
                      item.scalableHeight = measureScalableHeight(item.el);
                      item.fixedHeight =
                        item.measuredHeight - item.scalableHeight;
                    } else if (newCardWidth > 0) {
                      item.height = estimateUnmountedHeight(item, newCardWidth);
                      item.measuredHeight = item.height;
                    }
                  }

                  this.recomputeYPositions();

                  // Update placeholder heights BEFORE group offsets
                  for (const item of this.virtualItems) {
                    if (!item.el) {
                      const placeholder = this.placeholderEls.get(item);
                      if (placeholder) {
                        placeholder.style.height = `${item.height}px`;
                        placeholder.style.minHeight = `${item.height}px`;
                      }
                    }
                  }

                  this.refreshGroupOffsets();

                  // Phase 3: Cull — unmount items now outside viewport
                  for (const item of this.virtualItems) {
                    if (!item.el) continue;
                    const containerOffsetY = this.cachedGroupOffsets.get(
                      item.groupKey
                    );
                    if (containerOffsetY === undefined) continue;
                    const itemTop = containerOffsetY + item.y;
                    const itemBottom = itemTop + item.height;
                    if (!(itemBottom > visibleTop && itemTop < visibleBottom)) {
                      this.unmountVirtualItem(item);
                    }
                  }

                  // Sync responsive classes on mounted cards only
                  const mountedCards = this.virtualItems
                    .filter((v) => v.el)
                    .map((v) => v.el!);
                  setHoverScaleForCards(mountedCards);
                  syncResponsiveClasses(mountedCards);
                  initializeScrollGradients(this.feedContainerRef.current!);

                  this.isLayoutBusy = false;

                  // Run deferred passes inline so height changes settle
                  // before syncVirtualScroll — no visible jump.
                  if (this.newlyMountedEls.length > 0) {
                    this.onMountRemeasure();
                  }

                  this.syncVirtualScroll();
                });
              } else {
                // Card width may change within same column count — re-sync
                const feed = this.feedContainerRef.current;
                if (feed?.isConnected) {
                  this.win.requestAnimationFrame(() => {
                    if (!feed.isConnected) return;
                    const cards = Array.from(
                      feed.querySelectorAll<HTMLElement>('.card')
                    );
                    setHoverScaleForCards(cards);
                    syncResponsiveClasses(cards);
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
              this.win.cancelAnimationFrame(this.resizeRafId);
            this.resizeRafId = null;
            updateColumns();
          } else if (width > 0) {
            // Normal resize: double-RAF debounce to coalesce rapid events
            if (this.resizeRafId !== null)
              this.win.cancelAnimationFrame(this.resizeRafId);
            this.resizeRafId = this.win.requestAnimationFrame(() => {
              this.resizeRafId = this.win.requestAnimationFrame(() => {
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
      this.containerEl.removeClass('dynamic-views-height-preserved');

      // Re-check viewport fill — preserved height inflates scrollHeight,
      // masking underfill from the initial checkAndLoadMore in setupInfiniteScroll
      this.checkAndLoadMore(this.totalEntries);

      // Clear skip-cover-fade after cached image load events have fired.
      // Double-rAF lets the browser process queued load events for cached images
      // before removing the class (matching handleImageLoad's double-rAF timing).
      this.win.requestAnimationFrame(() => {
        this.win.requestAnimationFrame(() => {
          this.scrollEl
            .closest('.workspace-leaf-content')
            ?.classList.remove('skip-cover-fade');
        });
      });

      // Note: Don't reset isLoading here - scroll listener may have started a batch
    })();
  }
  // #endregion Data processing
  // #region Card rendering
  private renderCard(
    container: HTMLElement,
    card: CardData,
    entry: BasesEntry,
    index: number,
    settings: BasesResolvedSettings
  ): CardHandle {
    const handle = this.cardRenderer.renderCard(
      container,
      card,
      entry,
      settings,
      {
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
        getVirtualRects: () => this.getVirtualRects(),
        onMountItem: (idx: number) => this.mountVirtualItemByIndex(idx),
      }
    );
    // Caller is responsible for cardResizeObserver.observe() —
    // mountVirtualItem, appendBatch, expandGroup, and content update
    // each observe at the appropriate point in their flow.
    return handle;
  }

  /** Surgical property reorder: rebuild CardData + update title/subtitle/property DOM */
  private updatePropertyOrder(
    visibleProperties: string[],
    settings: BasesResolvedSettings,
    sortMethod: string
  ): void {
    for (const item of this.virtualItems) {
      const stored = this.cardDataByPath.get(item.cardData.path);
      if (!stored) continue;

      stored.cardData = basesEntryToCardData(
        this.app,
        stored.entry,
        settings,
        sortMethod,
        this.sortState.isShuffled,
        visibleProperties,
        stored.cardData.textPreview,
        stored.cardData.imageUrl
      );
      item.cardData = stored.cardData;

      // Only update DOM for mounted cards
      if (item.el) {
        this.cardRenderer.updateTitleText(
          item.el,
          stored.cardData,
          stored.entry,
          settings
        );
        this.cardRenderer.rerenderSubtitle(
          item.el,
          stored.cardData,
          stored.entry,
          settings
        );
        this.cardRenderer.rerenderProperties(
          item.el,
          stored.cardData,
          stored.entry,
          settings
        );
      }
    }

    const feedEl = this.feedContainerRef.current;
    if (feedEl) initializeScrollGradients(feedEl);
    this.scrollPreservation?.restoreAfterRender();
  }

  /** Update only changed cards in-place without full re-render */
  private async updateCardsInPlace(
    changedPaths: Set<string>,
    allEntries: BasesEntry[],
    settings: BasesResolvedSettings,
    sortMethod: string,
    visibleProperties: string[]
  ): Promise<void> {
    // Clear cache for changed files only
    for (const path of changedPaths) {
      delete this.contentCache.textPreviews[path];
      delete this.contentCache.images[path];
      delete this.contentCache.hasImageAvailable[path];
    }

    // Load fresh content for changed files
    const changedEntries = allEntries.filter((e) =>
      changedPaths.has(e.file.path)
    );
    await loadContentForEntries(
      changedEntries,
      settings,
      this.app,
      this.contentCache.textPreviews,
      this.contentCache.images,
      this.contentCache.hasImageAvailable
    );

    // Rebuild CardData and update DOM for each changed card
    const replacedCardEls: HTMLElement[] = [];

    for (const path of changedPaths) {
      const stored = this.cardDataByPath.get(path);
      const freshEntry = changedEntries.find((e) => e.file.path === path);
      if (!freshEntry) continue;

      const oldCard = stored?.cardData;
      const newCard = basesEntryToCardData(
        this.app,
        freshEntry,
        settings,
        sortMethod,
        this.sortState.isShuffled,
        visibleProperties,
        this.contentCache.textPreviews[path],
        this.contentCache.images[path]
      );

      if (stored) {
        stored.cardData = newCard;
        stored.entry = freshEntry;
      }

      const vItem = this.virtualItemByPath.get(path);
      if (vItem) {
        vItem.cardData = newCard;
        vItem.entry = freshEntry;
      }

      // Unmounted: skip DOM update (next mount uses fresh cardData)
      if (!vItem?.el) continue;

      const cardEl = vItem.el; // Non-null — continue above guarantees el exists

      if (SharedCardRenderer.hasImageChanged(oldCard, newCard)) {
        const groupEl = vItem.el.parentElement;
        if (!groupEl) continue;
        const nextSibling = vItem.el.nextSibling;

        // Cleanup old card
        vItem.handle?.cleanup();
        this.cardRenderer.abortCardRerenderControllers(vItem.el);
        this.cardResizeObserver?.unobserve(vItem.el);
        vItem.el.remove();

        // Render into connected group container (appends at end for offsetWidth reads),
        // then move to correct slot. Uses cached index instead of hardcoded 0.
        const handle = this.renderCard(
          groupEl,
          newCard,
          freshEntry,
          vItem.index,
          settings
        );
        if (nextSibling) {
          groupEl.insertBefore(handle.el, nextSibling);
        }
        // If was last child, renderCard already appended at correct position.

        vItem.el = handle.el;
        vItem.handle = handle;
        this.cardResizeObserver?.observe(handle.el);

        // Height-lock + deferred passes (same as mountVirtualItem)
        handle.el.style.height = `${vItem.height}px`;
        handle.el.addClass('dynamic-views-height-locked');
        syncResponsiveClasses([handle.el]);
        setHoverScaleForCards([handle.el]);
        this.newlyMountedEls.push(handle.el);
        this.scheduleMountRemeasure();

        replacedCardEls.push(handle.el);
      } else {
        this.cardRenderer.updateCardContent(
          cardEl,
          newCard,
          freshEntry,
          settings
        );
      }
    }

    // Re-initialize scroll gradients (property widths may have changed)
    const feedEl = this.feedContainerRef.current;
    if (feedEl) initializeScrollGradients(feedEl);
  }
  // #endregion Card rendering
  // #region Infinite scroll
  /** Check if more content needed after layout completes, and load if so */
  private checkAndLoadMore(totalEntries: number): void {
    const settings = this.lastRenderedSettings;
    if (!settings) return;
    if (this.isLoading || this.displayedCount >= totalEntries) return;

    const scrollContainer = this.scrollEl;
    if (!scrollContainer?.isConnected) return;

    const distanceFromBottom =
      scrollContainer.scrollHeight -
      (scrollContainer.scrollTop + scrollContainer.clientHeight);
    const threshold = scrollContainer.clientHeight * PANE_MULTIPLIER;

    if (distanceFromBottom < threshold) {
      this.isLoading = true;
      const batchSize = this.getBatchSize(settings);
      this.displayedCount = Math.min(
        this.displayedCount + batchSize,
        totalEntries
      );
      void this.appendBatch(totalEntries);
    }
  }

  private async appendBatch(totalEntries: number): Promise<void> {
    // Guard: return early if data not initialized or no feed container
    if (
      !this.data ||
      !this.feedContainerRef.current ||
      !this.lastRenderedSettings
    ) {
      this.isLoading = false;
      return;
    }

    // Increment render version to cancel any stale onDataUpdated renders
    this.renderState.version++;
    const currentVersion = this.renderState.version;

    this.isLayoutBusy = true;

    try {
      const groupedData = this.data.groupedData;

      // Reuse settings from the initial render — they don't change between batches.
      // Re-reading from config would miss templateOverrides (not yet written to YAML).
      const settings = this.lastRenderedSettings;

      const sortMethod = getSortMethod(this.config);

      // Process groups with shuffle logic
      const processedGroups = processGroups(
        groupedData,
        this.sortState.isShuffled,
        this.sortState.order
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
          currCount - groupStart
        );

        if (
          newEndInGroup > newStartInGroup &&
          newStartInGroup < processedGroup.entries.length
        ) {
          newEntries.push(
            ...processedGroup.entries.slice(newStartInGroup, newEndInGroup)
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
        this.contentCache.hasImageAvailable
      );

      // Abort if renderVersion changed during loading
      if (this.renderState.version !== currentVersion) {
        this.containerEl
          .querySelector('.dynamic-views-end-indicator')
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
          currCount - displayedSoFar
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
          groupEntriesToDisplay
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
            'dynamic-views-group-section'
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
            }
          );

          // New group - create container for cards
          groupEl = sectionEl.createDiv(
            'dynamic-views-group bases-cards-group'
          );
          setGroupKeyDataset(groupEl, currentGroupKey);

          // Observe new heading for sticky stuck detection (after group
          // container so sentinel doesn't break heading + group adjacency)
          if (headerEl) this.stickyHeadings?.observe(headerEl);

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
          this.contentCache.hasImageAvailable
        );

        for (let i = 0; i < cards.length; i++) {
          const card = cards[i];
          const entry = groupEntries[i];
          this.cardDataByPath.set(card.path, { cardData: card, entry });
          const handle = this.renderCard(
            groupEl,
            card,
            entry,
            startIndex + newCardsRendered,
            settings
          );
          newCardEls.push(handle.el);

          const item: VirtualItem = {
            index: 0,
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
          };
          this.virtualItems.push(item);
          this.virtualItemByPath.set(card.path, item);
          this.cardResizeObserver?.observe(handle.el);
          newCardsRendered++;
        }

        if (!this.groupContainers.has(currentGroupKey)) {
          this.groupContainers.set(currentGroupKey, groupEl);
        }

        displayedSoFar += groupEntriesToDisplay;
      }

      // Update state for next append - use currCount (captured at start)
      // to ensure consistency even if this.displayedCount changed during async
      this.previousDisplayedCount = currCount;

      // Batch-initialize scroll gradients for newly rendered cards only
      if (newCardEls.length > 0) {
        // Sync responsive classes before gradient init (ResizeObservers are async)
        syncResponsiveClasses(newCardEls);
        // Initialize gradients for new cards only (avoids
        // re-scanning old content-hidden cards in the container)
        initializeScrollGradientsForCards(newCardEls);
        initializeTextPreviewClampForCards(newCardEls);
        setHoverScaleForCards(newCardEls);
      }

      this.rebuildGroupIndex();
      // Measure new cards (single reflow after batch)
      for (const item of this.virtualItems) {
        if (item.el && item.height === 0) {
          this.cacheCardVerticalPadding(item.el);
          const groupContainer = this.groupContainers.get(item.groupKey);
          item.y = item.el.offsetTop - (groupContainer?.offsetTop ?? 0);
          item.x = item.el.offsetLeft - (groupContainer?.offsetLeft ?? 0);
          item.height = item.el.offsetHeight;
          item.width = item.el.offsetWidth;
          item.measuredHeight = item.height;
          item.measuredAtWidth = item.width;
          item.scalableHeight = measureScalableHeight(item.el);
          item.fixedHeight = item.measuredHeight - item.scalableHeight;
        }
      }
      this.refreshGroupOffsets();

      // Clear guard, then sync
      this.isLayoutBusy = false;
      if (this.hasUserScrolled) this.syncVirtualScroll();

      // Mark that batch append occurred (for end indicator)
      this.hasBatchAppended = true;

      // Show end indicator if all items displayed (skip if 0 results)
      if (this.displayedCount >= totalEntries && totalEntries > 0) {
        this.showEndIndicator();
      }
    } finally {
      this.isLoading = false;
    }
    // Only chain if this batch wasn't aborted by a new render
    if (this.renderState.version === currentVersion) {
      this.checkAndLoadMore(totalEntries);
    }
  }

  private setupInfiniteScroll(totalEntries: number): void {
    const scrollContainer = this.scrollEl;

    // Clean up existing listener (don't use this.register() since this method is called multiple times)
    if (this.scrollThrottle.listener) {
      scrollContainer.removeEventListener(
        'scroll',
        this.scrollThrottle.listener
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
    }

    // Create scroll handler: virtual scroll sync + infinite scroll throttle
    this.scrollThrottle.listener = () => {
      // Skip sync for programmatic scroll compensation — positions were
      // just recalculated, syncing would cascade into another remeasure
      if (this.compensatingScrollCount > 0) {
        this.compensatingScrollCount--;
        return;
      }

      if (!this.hasUserScrolled) {
        this.hasUserScrolled = true;
      }

      this.scheduleVirtualScrollSync();

      // Schedule height-lock release after scroll quiesces (iOS only).
      // Cards mounted during scroll are locked to placeholder height to
      // prevent CSS Grid row reflows. Release once scrolling stops.
      if (this.measureLane) {
        if (this.scrollIdleTimeout !== null) {
          clearTimeout(this.scrollIdleTimeout);
        }
        this.scrollIdleTimeout = setTimeout(() => {
          this.scrollIdleTimeout = null;
          this.releaseScrollMountLocks();
        }, MOUNT_REMEASURE_MS);
      }

      // Infinite scroll check (no-op when all loaded)
      if (this.scrollThrottle.timeoutId !== null) return;
      this.checkAndLoadMore(totalEntries);
      this.scrollThrottle.timeoutId = window.setTimeout(() => {
        this.scrollThrottle.timeoutId = null;
        this.checkAndLoadMore(totalEntries);
      }, SCROLL_THROTTLE_MS);
    };

    // Attach listener to scroll container
    scrollContainer.addEventListener('scroll', this.scrollThrottle.listener, {
      passive: true,
    });

    // WebKit momentum guard — track touch state to suppress scrollTop writes
    // during inertial deceleration (kills compositor momentum)
    if (Platform.isIosApp) {
      this.touchAbort?.abort();
      this.touchActive = true;
      this.touchAbort = new AbortController();
      const signal = this.touchAbort.signal;

      scrollContainer.addEventListener(
        'touchstart',
        () => {
          this.touchActive = true;
          // Flush deferred remeasure from updateCardsInPlace image-change path
          if (this.mountRemeasureTimeout !== null) {
            clearTimeout(this.mountRemeasureTimeout);
            this.mountRemeasureTimeout = null;
            this.onMountRemeasure();
          }
          // User touch cancels momentum — flush all deferred work
          if (this.scrollIdleTimeout !== null) {
            clearTimeout(this.scrollIdleTimeout);
            this.scrollIdleTimeout = null;
          }
          this.releaseScrollMountLocks();
        },
        { passive: true, signal }
      );

      scrollContainer.addEventListener(
        'touchend',
        () => {
          this.touchActive = false;
          this.lastTouchEndTime = performance.now();
        },
        { passive: true, signal }
      );

      scrollContainer.addEventListener(
        'touchcancel',
        () => {
          this.touchActive = false;
          this.lastTouchEndTime = performance.now();
        },
        { passive: true, signal }
      );
    }

    // Trigger initial check in case viewport already needs more content
    this.checkAndLoadMore(totalEntries);
  }
  // #endregion Infinite scroll
  // #region Virtual scroll
  // ---------------------------------------------------------------------------
  // Virtual scroll infrastructure
  // ---------------------------------------------------------------------------

  private rebuildGroupIndex(): void {
    this.virtualItemsByGroup.clear();
    for (let i = 0; i < this.virtualItems.length; i++) {
      const item = this.virtualItems[i];
      item.index = i; // Cache flat index — avoids O(n) indexOf per mount
      let group = this.virtualItemsByGroup.get(item.groupKey);
      if (!group) {
        group = [];
        this.virtualItemsByGroup.set(item.groupKey, group);
      }
      group.push(item);
    }
  }

  /** Rebuild virtualItems array in DOM group order (call after expand/collapse) */
  private rebuildVirtualItemsOrder(): void {
    const containers =
      this.feedContainerRef.current?.querySelectorAll<HTMLElement>(
        ':scope > .dynamic-views-group-section > .dynamic-views-group'
      );
    if (!containers) return;
    this.virtualItems = [];
    for (const container of containers) {
      for (const [gk, el] of this.groupContainers) {
        if (el === container) {
          const items = this.virtualItemsByGroup.get(gk);
          if (items) this.virtualItems.push(...items);
          break;
        }
      }
    }
  }

  /** Cache card vertical padding from the first measured card. */
  private cacheCardVerticalPadding(el: HTMLElement): void {
    if (this.cardVerticalPadding !== null) return;
    const win = el.ownerDocument.defaultView;
    if (!win) return;
    const cs = win.getComputedStyle(el);
    this.cardVerticalPadding =
      parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  }

  private measureAllCardPositions(): void {
    // Both card and groupContainer share .dynamic-views-group-section as
    // offsetParent (has position: relative). Subtraction gives position
    // relative to the .dynamic-views-group (cards container).
    for (const item of this.virtualItems) {
      if (!item.el) continue;
      this.cacheCardVerticalPadding(item.el);
      const groupContainer = this.groupContainers.get(item.groupKey);
      item.y = item.el.offsetTop - (groupContainer?.offsetTop ?? 0);
      item.x = item.el.offsetLeft - (groupContainer?.offsetLeft ?? 0);
      item.height = item.el.offsetHeight;
      item.width = item.el.offsetWidth;
      item.measuredHeight = item.height;
      item.measuredAtWidth = item.width;
      item.scalableHeight = measureScalableHeight(item.el);
      item.fixedHeight = item.measuredHeight - item.scalableHeight;
    }
    this.lastMeasuredCardWidth = this.virtualItems[0]?.width ?? 0;
  }

  private updateCachedGroupOffsets(force = false): void {
    if (!force && !this.groupOffsetsDirty) return;
    this.groupOffsetsDirty = false;
    const scrollRect = this.scrollEl.getBoundingClientRect();
    const scrollTop = this.scrollEl.scrollTop;
    this.cachedGroupOffsets.clear();
    for (const [groupKey, container] of this.groupContainers) {
      if (!container.isConnected) continue;
      const containerRect = container.getBoundingClientRect();
      this.cachedGroupOffsets.set(
        groupKey,
        containerRect.top - scrollRect.top + scrollTop
      );
    }
  }

  /** Mark group offsets stale and recompute from DOM. */
  private refreshGroupOffsets(): void {
    this.groupOffsetsDirty = true;
    this.updateCachedGroupOffsets();
  }

  private unmountVirtualItem(item: VirtualItem): void {
    if (!item.el) return;
    if (this.focusState.hoveredEl === item.el) {
      this.focusState.hoveredEl = null;
    }

    const placeholder = item.el.ownerDocument.createElement('div');
    placeholder.className = 'dynamic-views-grid-placeholder';
    placeholder.style.height = `${item.height}px`;
    placeholder.style.minHeight = `${item.height}px`;

    item.el.replaceWith(placeholder);
    this.placeholderEls.set(item, placeholder);

    item.handle?.cleanup();
    this.cardRenderer.abortCardRerenderControllers(item.el);
    this.cardResizeObserver?.unobserve(item.el);
    this.scrollMountLockedEls.delete(item.el);
    item.el = null;
    item.handle = null;
  }

  private mountVirtualItem(
    item: VirtualItem,
    settings: BasesResolvedSettings
  ): void {
    const placeholder = this.placeholderEls.get(item);
    if (!placeholder?.isConnected) return;

    const renderTarget = this.measureLane ?? placeholder.parentElement!;

    const handle = this.renderCard(
      renderTarget,
      item.cardData,
      item.entry,
      item.index,
      settings
    );

    if (this.measureLane) {
      // iOS: render into measurement lane, run ALL deferred passes, read height
      syncResponsiveClasses([handle.el]);
      setHoverScaleForCards([handle.el]);
      initializeScrollGradientsForCards([handle.el]);
      initializeTextPreviewClampForCards([handle.el]);

      const measuredHeight = handle.el.offsetHeight;
      const measuredWidth = handle.el.offsetWidth;
      const scalableHeight = measureScalableHeight(handle.el);

      // Height-lock to placeholder height before grid insertion (Mechanism 2)
      handle.el.style.height = `${item.height}px`;
      handle.el.classList.add('dynamic-views-height-locked');
      this.scrollMountLockedEls.add(handle.el);

      placeholder.replaceWith(handle.el);
      this.placeholderEls.delete(item);

      item.el = handle.el;
      item.handle = handle;
      item.measuredHeight = measuredHeight;
      item.height = measuredHeight; // Normalized to row height by recomputeYPositions
      item.measuredAtWidth = measuredWidth;
      item.scalableHeight = scalableHeight;
      item.fixedHeight = measuredHeight - scalableHeight;
    } else {
      // Desktop: height-lock + cached responsive state (no layout reads).
      // Deferred passes (gradients, clamp) in onMountRemeasure.
      placeholder.replaceWith(handle.el);
      this.placeholderEls.delete(item);

      handle.el.style.height = `${item.height}px`;
      handle.el.classList.add('dynamic-views-height-locked');
      handle.el.classList.add('card-fade-in');

      item.el = handle.el;
      item.handle = handle;

      // Hover scale from cached dimensions (masonry parity) — avoids
      // offsetWidth/Height reads that force CSS Grid layout recalculation
      handle.el.style.setProperty(
        '--hover-scale-x',
        computeHoverScale(item.width)
      );
      handle.el.style.setProperty(
        '--hover-scale-y',
        computeHoverScale(item.height)
      );

      // Compact-mode from cached card width — avoids offsetWidth read
      const compactBreakpoint = getCompactBreakpoint();
      if (
        compactBreakpoint > 0 &&
        this.lastMeasuredCardWidth > 0 &&
        this.lastMeasuredCardWidth < compactBreakpoint
      ) {
        handle.el.classList.add('compact-mode');
      }

      this.newlyMountedEls.push(handle.el);
    }

    // Defer ResizeObserver for async height changes (image loads)
    const elToObserve = handle.el;
    this.win.requestAnimationFrame(() => {
      if (elToObserve.isConnected && this.cardResizeObserver) {
        this.cardResizeObserver.observe(elToObserve);
      }
    });
  }

  private syncVirtualScroll(): void {
    if (!this.virtualItems.length || !this.lastRenderedSettings) return;
    if (!this.hasUserScrolled) return;
    if (this.isLayoutBusy) return;

    const scrollTop = this.scrollEl.scrollTop;
    const paneHeight = this.scrollEl.clientHeight;

    // Tier 1 (mount zone): viewport ± 1× paneHeight
    const visibleTop = scrollTop - paneHeight;
    const visibleBottom = scrollTop + paneHeight + paneHeight;

    // Hysteresis: wider unmount zone (0.25× gap) prevents boundary oscillation
    // during WebKit momentum deceleration (card enters mount zone → mounts →
    // next frame exits → unmounts → flicker). Only affects unmount decisions.
    const unmountTop = scrollTop - paneHeight * 1.25;
    const unmountBottom = scrollTop + paneHeight * 2.25;

    // Tier 2 (content-hidden zone): viewport ± HIDDEN_BUFFER_MULTIPLIER × paneHeight
    // WebKit reflow loop with content-visibility toggling — skip on WebKit
    const useContentHidden = !Platform.isIosApp;
    const hiddenTop = scrollTop - paneHeight * HIDDEN_BUFFER_MULTIPLIER;
    const hiddenBottom =
      scrollTop + paneHeight * (HIDDEN_BUFFER_MULTIPLIER + 1);

    let mountedNew = false;
    let mountCount = 0;
    const settings = this.lastRenderedSettings;
    const len = this.virtualItems.length;
    const columns = this.lastColumnCount || 1;
    const paneCenter = scrollTop + paneHeight / 2;

    // Velocity gate: suppress new row commits during rapid scrollTop changes
    // (scrollbar drag, trackpad flick). Finish current committed row but
    // don't start new ones at transient intermediate positions.
    const now = performance.now();
    const dt = now - this.lastSyncTime;
    const scrollDelta = scrollTop - this.lastSyncScrollTop;
    const velocity = dt > 0 ? (Math.abs(scrollDelta) / dt) * 1000 : 0;
    // Accumulated delta with direction-change reset (same pattern as
    // full-screen bar hide/show). Filters trackpad micro-reversals (19-39px)
    // during deceleration that would flip row selection order momentarily.
    if (
      (this.scrollDirectionAccum > 0 && scrollDelta < 0) ||
      (this.scrollDirectionAccum < 0 && scrollDelta > 0)
    ) {
      this.scrollDirectionAccum = 0;
    }
    this.scrollDirectionAccum += scrollDelta;
    if (this.scrollDirectionAccum > DIRECTION_ACCUM_THRESHOLD) {
      this.lastScrollDown = true;
      this.scrollDirectionAccum = DIRECTION_ACCUM_THRESHOLD;
    } else if (this.scrollDirectionAccum < -DIRECTION_ACCUM_THRESHOLD) {
      this.lastScrollDown = false;
      this.scrollDirectionAccum = -DIRECTION_ACCUM_THRESHOLD;
    }
    this.lastSyncScrollTop = scrollTop;
    this.lastSyncTime = now;
    const highVelocity = velocity > HIGH_VELOCITY_THRESHOLD;
    // Scrollbar jump or fast flick — treat landing position as fresh start.
    // Pre-jump direction and committed row are irrelevant at the new position.
    // Jump detection: high velocity AND delta > paneHeight = scrollbar
    // click-to-position or equivalent. Reset to cold start (topmost-first).
    // Fast flicks have high velocity but delta ≤ paneHeight — stay directional.
    const isJump = highVelocity && Math.abs(scrollDelta) > paneHeight;
    if (isJump) {
      this.jumpPending = true;
      this.committedRow = null;
      this.scrollDirectionAccum = 0;
    }

    // Phase 1: Committed-row lock — mount up to ROW_BUDGET complete rows per
    // frame. Each loop iteration: validate committed row → mount it → or pick
    // the next row. Rows complete atomically before the next one starts.
    const ROW_BUDGET = 2;

    for (let rowPass = 0; rowPass < ROW_BUDGET; rowPass++) {
      let rowMountedThisPass = false;

      // Step 1: Validate committed row (still has unmounted items in mount zone?)
      if (this.committedRow) {
        const groupItems = this.virtualItemsByGroup.get(
          this.committedRow.groupKey
        );
        if (groupItems) {
          const rowStart = this.committedRow.rowStart;
          const rowEnd = Math.min(rowStart + columns, groupItems.length);
          const off = this.cachedGroupOffsets.get(this.committedRow.groupKey);
          let hasWork = false;
          if (off !== undefined) {
            for (let j = rowStart; j < rowEnd; j++) {
              const it = groupItems[j];
              if (!it.el && it.height > 0) {
                const top = off + it.y;
                if (top + it.height > visibleTop && top < visibleBottom) {
                  hasWork = true;
                  break;
                }
              }
            }
          }
          if (!hasWork) this.committedRow = null;
        } else {
          this.committedRow = null;
        }
      }

      // Step 2: Mount from committed row
      if (this.committedRow) {
        const groupItems = this.virtualItemsByGroup.get(
          this.committedRow.groupKey
        )!;
        const rowStart = this.committedRow.rowStart;
        const rowEnd = Math.min(rowStart + columns, groupItems.length);
        const off = this.cachedGroupOffsets.get(this.committedRow.groupKey)!;
        const reverse = this.committedRow.reverse;

        const step2 = this.mountRowRange(
          groupItems,
          rowStart,
          rowEnd,
          off,
          reverse,
          settings,
          visibleTop,
          visibleBottom,
          columns
        );
        if (step2.mountedNew) mountedNew = true;
        mountCount += step2.mounted;
        if (step2.mounted > 0) rowMountedThisPass = true;
      }

      // Step 3: If no committed row, find closest unmounted row.
      // Cold start (first open or jump): visible rows topmost-first, left-to-right.
      // Continuous scroll: directional — topmost for scroll-down, bottommost for
      // scroll-up. Suppressed during high velocity to avoid transient positions —
      // except jumps, which ARE the final position (single discrete event).
      if (!this.committedRow && (!highVelocity || isJump)) {
        // Cold start: first open (!hasCommittedAnyRow) or jump (jumpPending).
        // jumpPending stays active until all visible rows are mounted — prevents
        // premature switch to directional after the first cold start row commits.
        const coldStart = this.jumpPending || !this.hasCommittedAnyRow;

        let bestGroupKey: string | undefined;
        let bestRowStart = -1;
        let bestRowTop = Infinity;
        let bestRowBottom = -Infinity;
        let bestDist = Infinity;
        let bestIsVisible = false;
        let hasVisibleUnmounted = false;

        for (const [groupKey, groupItems] of this.virtualItemsByGroup) {
          const off = this.cachedGroupOffsets.get(groupKey);
          if (off === undefined) continue;

          for (let i = 0; i < groupItems.length; i += columns) {
            const rowEnd = Math.min(i + columns, groupItems.length);
            let hasUnmounted = false;
            let rowTop = Infinity;
            let rowBottom = -Infinity;

            for (let j = i; j < rowEnd; j++) {
              const it = groupItems[j];
              if (it.height === 0) continue;
              const top = off + it.y;
              const bot = top + it.height;
              if (top < rowTop) rowTop = top;
              if (bot > rowBottom) rowBottom = bot;
              if (!it.el) hasUnmounted = true;
            }

            if (!hasUnmounted) continue;
            if (rowBottom <= visibleTop || rowTop >= visibleBottom) continue;

            // Actual viewport (not mount zone) — prioritize rows the user can see
            const isVisible =
              rowTop < scrollTop + paneHeight && rowBottom > scrollTop;
            if (isVisible) hasVisibleUnmounted = true;
            const dist = Math.abs((rowTop + rowBottom) / 2 - paneCenter);

            if (coldStart) {
              // Cold start (first open or jump): visible rows topmost-first,
              // then buffer by center proximity. Always top-to-bottom.
              if (isVisible && !bestIsVisible) {
                bestIsVisible = true;
                bestRowTop = rowTop;
                bestDist = dist;
                bestGroupKey = groupKey;
                bestRowStart = i;
              } else if (isVisible && bestIsVisible && rowTop < bestRowTop) {
                bestRowTop = rowTop;
                bestGroupKey = groupKey;
                bestRowStart = i;
              } else if (!isVisible && !bestIsVisible && dist < bestDist) {
                bestDist = dist;
                bestGroupKey = groupKey;
                bestRowStart = i;
              }
            } else {
              // Continuous scroll: directional — topmost for scroll-down,
              // bottommost for scroll-up.
              if (this.lastScrollDown) {
                if (rowTop < bestRowTop) {
                  bestRowTop = rowTop;
                  bestGroupKey = groupKey;
                  bestRowStart = i;
                }
              } else {
                if (rowBottom > bestRowBottom) {
                  bestRowBottom = rowBottom;
                  bestGroupKey = groupKey;
                  bestRowStart = i;
                }
              }
            }
          }
        }

        // Clear jumpPending once all visible rows are mounted — transition
        // from cold start (topmost-first) to directional for buffer rows.
        if (this.jumpPending && !hasVisibleUnmounted) {
          this.jumpPending = false;
        }

        if (bestRowStart >= 0) {
          const groupItems = this.virtualItemsByGroup.get(bestGroupKey)!;
          const rowEnd = Math.min(bestRowStart + columns, groupItems.length);
          const off = this.cachedGroupOffsets.get(bestGroupKey)!;
          const rowBtm =
            off + groupItems[bestRowStart].y + groupItems[bestRowStart].height;
          this.committedRow = {
            groupKey: bestGroupKey,
            rowStart: bestRowStart,
            reverse: coldStart ? rowBtm <= scrollTop : !this.lastScrollDown,
          };
          this.hasCommittedAnyRow = true;
          const reverse = this.committedRow.reverse;

          const step3 = this.mountRowRange(
            groupItems,
            bestRowStart,
            rowEnd,
            off,
            reverse,
            settings,
            visibleTop,
            visibleBottom,
            columns
          );
          if (step3.mountedNew) mountedNew = true;
          mountCount += step3.mounted;
          if (step3.mounted > 0) rowMountedThisPass = true;
        }
      }

      if (!rowMountedThisPass) break;
    }

    // Phase 2: Content-hidden, unmount, restore, budgetExhausted detection.
    // Order-independent — forward scan.
    let budgetExhausted = false;

    for (let i = 0; i < len; i++) {
      const item = this.virtualItems[i];
      if (item.height === 0) continue;
      const containerOffsetY = this.cachedGroupOffsets.get(item.groupKey);
      if (containerOffsetY === undefined) continue;

      const itemTop = containerOffsetY + item.y;
      const itemBottom = itemTop + item.height;
      const inMountZone = itemBottom > visibleTop && itemTop < visibleBottom;

      if (inMountZone) {
        if (!item.el) {
          budgetExhausted = true;
        } else if (item.el.classList.contains(CONTENT_HIDDEN_CLASS)) {
          item.el.classList.remove(CONTENT_HIDDEN_CLASS);
          item.el.style.removeProperty('contain-intrinsic-height');
        }
      } else if (
        useContentHidden &&
        itemBottom > hiddenTop &&
        itemTop < hiddenBottom
      ) {
        if (item.el && !item.el.classList.contains(CONTENT_HIDDEN_CLASS)) {
          item.el.classList.add(CONTENT_HIDDEN_CLASS);
          item.el.style.setProperty(
            'contain-intrinsic-height',
            `${Math.max(0, item.height - (this.cardVerticalPadding ?? 0))}px`
          );
        }
      } else if (itemTop >= unmountBottom || itemBottom <= unmountTop) {
        if (item.el) {
          this.unmountVirtualItem(item);
        }
      }
      // Items between mount zone and unmount zone: leave as-is (hysteresis)
    }

    // Run deferred passes inline (same RAF) so height changes + scroll
    // compensation happen before browser paints — invisible to the user.
    if (mountedNew) {
      if (this.measureLane) {
        // Pre-measured cards: recompute row heights, sync placeholders
        this.recomputeYPositions();
        for (const item of this.virtualItems) {
          if (item.el && this.scrollMountLockedEls.has(item.el)) {
            item.el.style.height = `${item.height}px`;
          } else if (!item.el) {
            const ph = this.placeholderEls.get(item);
            if (ph) {
              ph.style.height = `${item.height}px`;
              ph.style.minHeight = `${item.height}px`;
            }
          }
        }
        this.groupOffsetsDirty = true;
        this.updateCachedGroupOffsets();
      } else {
        this.onMountRemeasure();
      }
    }

    // Budget exceeded — schedule another sync frame to mount remaining cards.
    // Skip during high velocity: the scroll handler will re-trigger sync anyway,
    // and rescheduling causes wasted O(N) loops with no mounting. Jumps are
    // exempt — single discrete event with no follow-up scroll to re-trigger.
    if (budgetExhausted && (!highVelocity || isJump)) {
      this.scheduleVirtualScrollSync();
    }
  }

  private scheduleMountRemeasure(): void {
    if (this.mountRemeasureTimeout !== null) return;
    if (this.isLayoutBusy) return;
    this.mountRemeasureTimeout = setTimeout(() => {
      this.mountRemeasureTimeout = null;
      this.onMountRemeasure();
    }, MOUNT_REMEASURE_MS);
  }

  /** Mount items in [rowStart, rowEnd) that fall inside the mount zone, up to remainingBudget. */
  private mountRowRange(
    groupItems: VirtualItem[],
    rowStart: number,
    rowEnd: number,
    off: number,
    reverse: boolean,
    settings: BasesResolvedSettings,
    visibleTop: number,
    visibleBottom: number,
    remainingBudget: number
  ): { mounted: number; mountedNew: boolean } {
    let mounted = 0;
    let mountedNew = false;
    for (
      let j = reverse ? rowEnd - 1 : rowStart;
      reverse ? j >= rowStart : j < rowEnd;
      reverse ? j-- : j++
    ) {
      if (mounted >= remainingBudget) break;
      const it = groupItems[j];
      if (it.el || it.height === 0) continue;
      const top = off + it.y;
      if (top + it.height > visibleTop && top < visibleBottom) {
        this.mountVirtualItem(it, settings);
        mountedNew = true;
        mounted++;
      }
    }
    return { mounted, mountedNew };
  }

  // TEMP DEBUG — kept intentionally for ongoing mount ordering work.
  // Toggle: __slowMount() / __slowMount(false). Auditors: ignore.
  debugSlowMount = false;

  private scheduleVirtualScrollSync(): void {
    if (this.virtualScrollRafId !== null) return;
    const delay = this.debugSlowMount ? 15 : 1;
    let remaining = delay;
    const step = () => {
      if (--remaining > 0) {
        this.win.requestAnimationFrame(step);
        return;
      }
      this.virtualScrollRafId = null;
      this.updateCachedGroupOffsets();
      this.syncVirtualScroll();
    };
    this.virtualScrollRafId = this.win.requestAnimationFrame(step);
  }

  private setupCardResizeObserver(): void {
    const currentWindow = this.containerEl.ownerDocument.defaultView ?? window;
    if (this.cardResizeObserver && this.observerWindow === currentWindow)
      return;

    this.observerWindow = currentWindow;
    this.cardResizeObserver?.disconnect();
    this.cardResizeObserver = new currentWindow.ResizeObserver(() => {
      if (this.lastMeasuredCardWidth === 0 || !this.lastRenderedSettings)
        return;
      if (this.isLayoutBusy) {
        this.cardResizeDirty = true;
        return;
      }
      // During mount remeasure: set dirty flag, don't double-remeasure.
      // onMountRemeasure will check the flag and reschedule.
      if (this.mountRemeasureTimeout !== null || this.isMountRemeasuring) {
        this.cardResizeDirty = true;
        return;
      }
      // WebKit momentum: defer all remeasure work — CSS Grid row reflow
      // from height reads/writes causes visible content shifting during
      // compositor-driven inertial deceleration
      if (
        this.measureLane &&
        !this.touchActive &&
        performance.now() - this.lastTouchEndTime < MOMENTUM_GUARD_MS
      ) {
        this.cardResizeDirty = true;
        return;
      }

      if (this.cardResizeRafId !== null) {
        this.win.cancelAnimationFrame(this.cardResizeRafId);
      }
      this.cardResizeRafId = this.win.requestAnimationFrame(() => {
        this.cardResizeRafId = null;
        if (!this.containerEl?.isConnected) return;
        if (this.lastMeasuredCardWidth === 0 || !this.lastRenderedSettings)
          return;
        if (this.isLayoutBusy) {
          this.cardResizeDirty = true;
          return;
        }
        // Re-check momentum inside RAF — may have entered momentum between
        // the outer callback and this frame
        if (
          this.measureLane &&
          !this.touchActive &&
          performance.now() - this.lastTouchEndTime < MOMENTUM_GUARD_MS
        ) {
          this.cardResizeDirty = true;
          return;
        }
        this.remeasureMountedCards();
        this.equalizeRowCoverHeights();
      });
    });
  }

  /** Release height locks from scroll mounts (iOS only).
   *  Deferred during WebKit momentum — row reflow from lock release causes
   *  visible content shifts during compositor deceleration. */
  private releaseScrollMountLocks(): void {
    if (this.scrollMountLockedEls.size === 0 && !this.cardResizeDirty) return;

    // Defer until momentum ends
    if (
      !this.touchActive &&
      performance.now() - this.lastTouchEndTime < MOMENTUM_GUARD_MS
    ) {
      const remaining =
        MOMENTUM_GUARD_MS - (performance.now() - this.lastTouchEndTime) + 50;
      this.scrollIdleTimeout = setTimeout(() => {
        this.scrollIdleTimeout = null;
        this.releaseScrollMountLocks();
      }, remaining);
      return;
    }

    for (const el of this.scrollMountLockedEls) {
      if (el.isConnected) {
        el.style.removeProperty('height');
        el.removeClass('dynamic-views-height-locked');
      }
    }
    this.scrollMountLockedEls.clear();
    this.cardResizeDirty = false;
    this.remeasureMountedCards();
    this.equalizeRowCoverHeights();
  }

  private remeasureMountedCards(): void {
    const feedEl = this.feedContainerRef.current;
    if (!feedEl?.isConnected) return;

    // Check for height drift in mounted cards
    let needsReposition = false;
    for (const item of this.virtualItems) {
      if (item.el && Math.abs(item.el.offsetHeight - item.height) > 1) {
        needsReposition = true;
        break;
      }
    }
    if (!needsReposition) return;

    // Scroll anchoring: record first visible mounted card
    const scrollTop = this.scrollEl.scrollTop;
    let anchorItem: VirtualItem | null = null;
    let anchorOldY = 0;

    for (const item of this.virtualItems) {
      if (!item.el) continue;
      const offset = this.cachedGroupOffsets.get(item.groupKey) ?? 0;
      const absY = offset + item.y;
      if (absY + item.height > scrollTop) {
        anchorItem = item;
        anchorOldY = absY;
        break;
      }
    }

    // Remeasure all mounted cards, keep estimates for unmounted
    for (const item of this.virtualItems) {
      if (item.el) {
        item.height = item.el.offsetHeight;
        item.measuredHeight = item.height;
        item.measuredAtWidth = item.el.offsetWidth;
        item.scalableHeight = measureScalableHeight(item.el);
        item.fixedHeight = item.measuredHeight - item.scalableHeight;
      }
    }

    // Recompute y positions from row heights
    this.recomputeYPositions();

    // Update placeholder heights BEFORE group offsets (order matters)
    for (const item of this.virtualItems) {
      if (!item.el) {
        const placeholder = this.placeholderEls.get(item);
        if (placeholder) {
          placeholder.style.height = `${item.height}px`;
          placeholder.style.minHeight = `${item.height}px`;
        }
      }
    }

    // Update group offsets AFTER placeholders (depends on correct DOM heights)
    this.refreshGroupOffsets();

    // Scroll compensation
    if (anchorItem) {
      const newOffset = this.cachedGroupOffsets.get(anchorItem.groupKey) ?? 0;
      const newAbsY = newOffset + anchorItem.y;
      const delta = newAbsY - anchorOldY;
      if (Math.abs(delta) > 1) {
        // WebKit: skip scrollTop writes during momentum — kills compositor deceleration.
        // DOM mutations are safe (confirmed empirically), only scrollTop writes kill momentum.
        if (
          this.measureLane &&
          !this.touchActive &&
          performance.now() - this.lastTouchEndTime < MOMENTUM_GUARD_MS
        ) {
          // Skip — momentum active. Compensation deferred to lock release.
        } else {
          this.compensatingScrollCount++;
          this.scrollEl.scrollTop = scrollTop + delta;
        }
        // Clear committed row only when compensation shifted scrollTop —
        // syncVirtualScroll will re-select the topmost visible row at the new position.
        this.committedRow = null;
      }
    }

    // Recursive sync is NOT redundant — recomputeYPositions shifted item.y,
    // refreshGroupOffsets shifted cachedGroupOffsets, and scroll compensation
    // shifted scrollTop. All three zone-boundary inputs changed, so items may
    // now belong to different zones. The needsReposition early-exit above
    // ensures this only runs when heights actually drifted.
    this.syncVirtualScroll();

    // Viewport may be underfilled after cards shrank (e.g., CSS-only setting change)
    this.checkAndLoadMore(this.totalEntries);
  }

  private recomputeYPositions(): void {
    const columns = this.lastColumnCount;
    const gap = getCardSpacing(this.containerEl);

    for (const [, groupItems] of this.virtualItemsByGroup) {
      let y = 0;
      for (let i = 0; i < groupItems.length; i += columns) {
        const rowEnd = Math.min(i + columns, groupItems.length);
        let rowHeight = 0;
        for (let j = i; j < rowEnd; j++) {
          rowHeight = Math.max(rowHeight, groupItems[j].measuredHeight);
        }
        for (let j = i; j < rowEnd; j++) {
          groupItems[j].y = y;
          groupItems[j].height = rowHeight; // Stretch normalization
        }
        y += rowHeight + gap;
      }
    }
  }

  /**
   * When fixed cover height is OFF in Grid, equalize cover aspect ratios
   * within each row so all covers match the tallest image.
   * Batch reads then writes to avoid interleaved reflows.
   */
  private equalizeRowCoverHeights(): void {
    if (!this.containerEl?.isConnected) return;

    const body = this.containerEl.ownerDocument.body;
    const isGridFixedHeight =
      body.classList.contains(FIXED_COVER_HEIGHT_GRID) ||
      body.classList.contains(FIXED_COVER_HEIGHT_BOTH);

    // Collect all mounted cover cards
    const coverCards: HTMLElement[] = [];
    for (const [, groupItems] of this.virtualItemsByGroup) {
      for (const item of groupItems) {
        if (
          item.el?.isConnected &&
          (item.el.classList.contains('card-cover-top') ||
            item.el.classList.contains('card-cover-bottom')) &&
          item.el.classList.contains('image-format-cover')
        ) {
          coverCards.push(item.el);
        }
      }
    }

    if (isGridFixedHeight) {
      // Clear stale values when fixed height is active
      for (const card of coverCards) {
        card.style.removeProperty('--row-cover-aspect-ratio');
      }
      return;
    }

    const columns = this.lastColumnCount;
    if (columns <= 0) return;

    // Process each group's cards by row
    for (const [, groupItems] of this.virtualItemsByGroup) {
      // Collect cover cards with their indices for row grouping
      const indexedCovers: { index: number; el: HTMLElement }[] = [];
      for (let i = 0; i < groupItems.length; i++) {
        const el = groupItems[i].el;
        if (
          el?.isConnected &&
          (el.classList.contains('card-cover-top') ||
            el.classList.contains('card-cover-bottom')) &&
          el.classList.contains('image-format-cover')
        ) {
          indexedCovers.push({ index: i, el });
        }
      }

      // Read phase: batch all getComputedStyle reads
      const ratios: { index: number; el: HTMLElement; ratio: number }[] = [];
      for (const { index, el } of indexedCovers) {
        const raw = this.win
          .getComputedStyle(el)
          .getPropertyValue('--actual-aspect-ratio');
        const ratio = parseFloat(raw);
        ratios.push({ index, el, ratio: isNaN(ratio) ? 0 : ratio });
      }

      // Group by row and find max per row
      const rowMaxes = new Map<number, number>();
      for (const { index, ratio } of ratios) {
        const row = Math.floor(index / columns);
        const current = rowMaxes.get(row) ?? 0;
        if (ratio > current) rowMaxes.set(row, ratio);
      }

      // Write phase: set --row-cover-aspect-ratio on each card
      for (const { index, el, ratio } of ratios) {
        const row = Math.floor(index / columns);
        const maxRatio = rowMaxes.get(row) ?? 0;
        if (maxRatio > 0 && maxRatio !== ratio) {
          el.style.setProperty('--row-cover-aspect-ratio', maxRatio.toString());
        } else {
          el.style.removeProperty('--row-cover-aspect-ratio');
        }
      }
    }
  }

  private onMountRemeasure(): void {
    if (!this.containerEl?.isConnected) return;
    if (this.lastMeasuredCardWidth <= 0) return;
    if (!this.lastRenderedSettings) return;
    if (this.isLayoutBusy) {
      // Reschedule — layout-modifying operation in progress
      this.scheduleMountRemeasure();
      return;
    }

    this.isMountRemeasuring = true;

    // Run deferred expensive passes on newly mounted cards only
    const newEls = this.newlyMountedEls.filter((el) => el.isConnected);
    this.newlyMountedEls = [];

    if (newEls.length) {
      // Release height locks BEFORE deferred passes — passes must see natural
      // card height (matching initial render order). Running passes while
      // height-locked produces different text clamp/gradient results → drift.
      for (const el of newEls) {
        el.style.removeProperty('height');
        el.removeClass('dynamic-views-height-locked');
      }

      // Full responsive sync + hover scale after lock release — corrects
      // cached approximations from mountVirtualItem. Batched: 1 forced
      // layout for all newly mounted cards instead of per-card.
      syncResponsiveClasses(newEls);
      setHoverScaleForCards(newEls);

      initializeScrollGradientsForCards(newEls);
      initializeTextPreviewClampForCards(newEls);
    }

    this.remeasureMountedCards();
    this.equalizeRowCoverHeights();

    // Defer clearing — ResizeObserver callbacks from lock release fire
    // between RAF and paint (same frame). Previously-mounted cards in
    // the same row also resize when the row height changes. Keep the
    // guard active so those RO callbacks set cardResizeDirty instead
    // of triggering a second (oscillating) remeasure.
    this.win.requestAnimationFrame(() => {
      this.isMountRemeasuring = false;
      if (this.cardResizeDirty) {
        this.cardResizeDirty = false;
        this.remeasureMountedCards();
        this.equalizeRowCoverHeights();
      }
    });
  }
  // #endregion Virtual scroll
  // #region Keyboard navigation
  private getVirtualRects(): VirtualCardRect[] {
    return this.virtualItems.map((item, arrayIndex) => {
      // Add group offset to y for absolute positioning.
      // Without this, all groups overlap near y=0.
      const groupOffsetY = this.cachedGroupOffsets.get(item.groupKey) ?? 0;
      return {
        index: arrayIndex, // Array position — stable identity
        x: item.x, // Already absolute (groups span full width via subgrid)
        y: item.y + groupOffsetY, // Convert group-local to absolute
        width: item.width,
        height: item.height,
        el: item.el,
      };
    });
  }

  private mountVirtualItemByIndex(arrayIndex: number): HTMLElement | null {
    const item = this.virtualItems[arrayIndex];
    if (!item) return null;
    if (item.el) return item.el;
    if (!this.lastRenderedSettings) return null;
    this.mountVirtualItem(item, this.lastRenderedSettings);
    if (item.el) this.scheduleMountRemeasure();
    return item.el;
  }
  // #endregion Keyboard navigation
  // #region Cleanup
  /** Show end-of-content indicator when all items are displayed (standalone .base files only) */
  private showEndIndicator(): void {
    if (this.isEmbedded) return;
    // Guard against disconnected container (RAF callback after view destroyed)
    if (!this.containerEl?.isConnected) return;
    // Avoid duplicates
    if (this.containerEl.querySelector('.dynamic-views-end-indicator')) return;
    this.containerEl.createDiv('dynamic-views-end-indicator');
  }

  onunload(): void {
    this.scrollPreservation?.cleanup();
    this.teardownObservers();
    if (this.trailingUpdate.timeoutId !== null) {
      window.clearTimeout(this.trailingUpdate.timeoutId);
    }
    if (this.templateCooldownRef.value !== null) {
      clearTimeout(this.templateCooldownRef.value);
    }
    // Clean up scroll-related resources
    if (this.scrollThrottle.listener) {
      this.scrollEl.removeEventListener('scroll', this.scrollThrottle.listener);
    }
    if (this.scrollThrottle.timeoutId !== null) {
      window.clearTimeout(this.scrollThrottle.timeoutId);
    }
    this.stickyHeadings?.disconnect();
    this.measureLane?.remove();
    this.measureLane = null;
    this.scrollMountLockedEls.clear();
    if (this.scrollIdleTimeout !== null) {
      clearTimeout(this.scrollIdleTimeout);
      this.scrollIdleTimeout = null;
    }
    this.touchAbort?.abort();
    this.renderState.abortController?.abort();
    this.focusCleanup?.();
    this.cardRenderer.cleanup(true); // Force viewer cleanup on view destruction
  }

  focus(): void {
    this.containerEl.focus({ preventScroll: true });
  }
  // #endregion Cleanup
}

/** Export options for registration — type assertion needed because Obsidian's
 * official type is `() => BasesAllOptions[]` but runtime passes BasesViewConfig */
export const cardViewOptions = ((config: BasesViewConfig) =>
  getBasesViewOptions('grid', config)) as unknown as () => BasesAllOptions[];
