/**
 * Shared Card Renderer for Bases Views
 * Consolidates duplicate card rendering logic from Grid and Masonry
 */

/** Per-card hover parent — new popovers on the same parent auto-dismiss the previous one. */
const cardHoverParents = new WeakMap<HTMLElement, { hoverPopover: null }>();

import {
  App,
  TFile,
  TFolder,
  setIcon,
  BasesEntry,
  Scope,
  Menu,
  Keymap,
} from 'obsidian';
import type { BasesViewConfig } from 'obsidian';
import { CardData } from '../shared/card-renderer';
import {
  setPreviewContent,
  updateTextPreviewDOM,
  applyPerParagraphClamp,
} from '../shared/text-preview-dom';
import {
  setupImageLoadHandler,
  setupBackdropImageLoader,
  handleImageLoad,
  handleAllImagesFailed,
  DEFAULT_ASPECT_RATIO,
  filterBrokenUrls,
  markImageBroken,
} from '../shared/image-loader';
import {
  showFileContextMenu,
  showExternalLinkContextMenu,
} from '../shared/context-menu';
import {
  updateScrollGradient,
  setupScrollGradients,
  setupElementScrollGradient,
  setupVerticalScrollGradient,
} from '../shared/scroll-gradient';
import { getTimestampIcon, isTimestampProperty } from '../shared/render-utils';
import {
  createCardDragHandler,
  createExternalLinkDragHandler,
  createTagDragHandler,
  createUrlButtonDragHandlers,
} from '../shared/drag';
import {
  showTagHashPrefix,
  getHideEmptyMode,
  type HideEmptyMode,
  getEmptyValueMarker,
  shouldHideMissingProperties,
  getListSeparator,
  isSlideshowEnabled,
  isSlideshowIndicatorEnabled,
  isThumbnailScrubbingDisabled,
  getSlideshowMaxImages,
  getCompactBreakpoint,
  hasBodyClass,
  isExtensionMode,
} from '../utils/style-settings';
import {
  getPropertyLabel,
  parsePropertyList,
  stripNotePrefix,
} from '../utils/property';
import { findLinksInText, type ParsedLink } from '../utils/link-parser';
import {
  handleImageViewerTrigger,
  cleanupAllViewers,
} from '../shared/image-viewer';
import { applyIconOpticalOffset } from '../shared/icon-alignment';
import { getFileExtInfo, getFileTypeIcon } from '../utils/file-extension';
import type DynamicViews from '../../main';
import type { BasesResolvedSettings, LayoutSource } from '../types';
import {
  createPreloadBrokenHandler,
  createSlideshowNavigator,
  getCachedBlobUrl,
  setupHoverZoomEligibility,
  setupImagePreload,
  setupSwipeGestures,
} from '../shared/slideshow';
import { setupHoverIntent } from '../shared/hover-intent';
import {
  handleArrowNavigation,
  isArrowKey,
  isImageViewerBlockingNav,
  type VirtualCardRect,
} from '../shared/keyboard-nav';
import {
  CHECKBOX_MARKER_PREFIX,
  THUMBNAIL_STACK_MULTIPLIER,
} from '../shared/constants';
import {
  shouldUseNotebookNavigator,
  navigateToTagInNotebookNavigator,
  navigateToFolderInNotebookNavigator,
  revealFileInNotebookNavigator,
} from '../utils/notebook-navigator';
import {
  measurePropertyFields,
  remeasureCardPairs,
} from '../shared/property-measure';
import { CONTENT_HIDDEN_CLASS } from '../shared/content-visibility';
import {
  isTagProperty,
  isFileProperty,
  isFormulaProperty,
  shouldCollapseField,
  computeInvertPairs,
  queueCompactStackedCheck,
  cancelCompactStackedCheck,
  invalidateCompactStackedCache,
} from '../shared/property-helpers';
import { getOwnerWindow } from '../utils/owner-window';

/** Selector for visible body children — shared with card-renderer.tsx. */
const VISIBLE_BODY_SELECTOR =
  '.card-properties-top, .card-properties-bottom, .card-previews:not(.thumbnail-placeholder-only)';

/** Per-card cleanup handle for individual card teardown (virtual scrolling) */
export interface CardHandle {
  el: HTMLElement;
  cleanup: () => void;
}

/**
 * Shared canvas for text measurement (avoids layout reads)
 */
let measureCanvas: HTMLCanvasElement | null = null;
let measureCtx: CanvasRenderingContext2D | null = null;

function getMeasureContext(): CanvasRenderingContext2D {
  if (!measureCanvas) {
    measureCanvas = document.createElement('canvas');
    measureCtx = measureCanvas.getContext('2d');
  }
  return measureCtx!;
}

/**
 * Truncate title text using canvas measureText (no layout reads).
 * Called with pre-read measurements to avoid layout thrashing.
 */
function truncateTitleWithCanvas(
  textEl: HTMLElement | Text,
  fullText: string,
  containerWidth: number,
  font: string,
  maxLines: number,
  suffixText = ''
): void {
  if (!fullText || containerWidth <= 0 || maxLines <= 0) return;

  const ctx = getMeasureContext();
  ctx.font = font;

  const ellipsis = '…';
  const ellipsisWidth = ctx.measureText(ellipsis).width;
  const suffixWidth = suffixText ? ctx.measureText(suffixText).width : 0;
  // Total width available across all lines, minus ellipsis and extension suffix
  const availableWidth =
    containerWidth * maxLines - ellipsisWidth - suffixWidth;

  // Measure full text width
  const fullWidth = ctx.measureText(fullText).width;
  if (fullWidth <= availableWidth) {
    // No truncation needed
    return;
  }

  // Binary search for truncation point using canvas (no layout reads)
  let low = 1;
  let high = fullText.length;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const testText = fullText.slice(0, mid);
    const testWidth = ctx.measureText(testText).width;

    if (testWidth <= availableWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  // Apply truncated text
  textEl.textContent = fullText.slice(0, low).trimEnd() + ellipsis;
}

const PAIRED_PROPERTY_CLASSES = [
  'dynamic-views-paired-property-left',
  'dynamic-views-paired-property-right',
  'dynamic-views-paired-property-column',
] as const;

/**
 * Apply per-view CSS classes and variables from settings to the view container
 * Replaces body-level Style Settings classes with view-scoped equivalents
 */
export function applyViewContainerStyles(
  container: HTMLElement,
  settings: BasesResolvedSettings
): void {
  // Paired property layout
  container.classList.remove(...PAIRED_PROPERTY_CLASSES);
  switch (settings.rightPropertyPosition) {
    case 'left':
      container.classList.add('dynamic-views-paired-property-left');
      break;
    case 'right':
      container.classList.add('dynamic-views-paired-property-right');
      break;
    case 'column':
      container.classList.add('dynamic-views-paired-property-column');
      break;
  }

  // CSS variables
  container.style.setProperty(
    '--dynamic-views-thumbnail-size',
    `${settings.thumbnailSize}px`
  );
  container.style.setProperty(
    '--dynamic-views-text-preview-lines',
    String(settings.textPreviewLines)
  );
  container.style.setProperty(
    '--dynamic-views-title-lines',
    String(settings.titleLines)
  );

  // Poster display mode — container class
  container.classList.remove('poster-mode-fade', 'poster-mode-overlay');
  container.classList.add(`poster-mode-${settings.posterDisplayMode}`);

  // Image fit — container class
  container.classList.remove('image-fit-crop', 'image-fit-contain');
  container.classList.add(`image-fit-${settings.imageFit}`);
}

/** Apply CSS-only settings immediately for instant feedback (bypasses throttle) */
export function applyCssOnlySettings(
  config: BasesViewConfig,
  containerEl: HTMLElement
): void {
  if (!config || !containerEl) return;

  const textPreviewLines = config.get('textPreviewLines');
  if (typeof textPreviewLines === 'number') {
    containerEl.style.setProperty(
      '--dynamic-views-text-preview-lines',
      String(textPreviewLines)
    );
  }

  const titleLines = config.get('titleLines');
  if (typeof titleLines === 'number') {
    containerEl.style.setProperty(
      '--dynamic-views-title-lines',
      String(titleLines)
    );
  }

  const imageRatio = config.get('imageRatio');
  if (typeof imageRatio === 'number') {
    containerEl.style.setProperty(
      '--dynamic-views-image-aspect-ratio',
      String(imageRatio)
    );
  }

  const thumbnailSize = config.get('thumbnailSize');
  if (typeof thumbnailSize === 'number') {
    containerEl.style.setProperty(
      '--dynamic-views-thumbnail-size',
      `${thumbnailSize}px`
    );
  }

  // Poster display mode — container class
  containerEl.classList.remove('poster-mode-fade', 'poster-mode-overlay');
  const rawPosterMode = config.get('posterDisplayMode') as string;
  const posterDisplayMode =
    rawPosterMode === 'fade' || rawPosterMode === 'overlay'
      ? rawPosterMode
      : 'fade';
  containerEl.classList.add(`poster-mode-${posterDisplayMode}`);

  // Image fit — container class
  containerEl.classList.remove('image-fit-crop', 'image-fit-contain');
  const imageFit = (config.get('imageFit') as string) ?? 'crop';
  containerEl.classList.add(`image-fit-${imageFit}`);
}

/**
 * Batch-initialize title truncation for all cards in container.
 * Uses read-then-write pattern to avoid layout thrashing:
 * - Phase 1: Read all title dimensions (1 layout recalc)
 * - Phase 2: Calculate and apply truncations (no layout reads)
 *
 * Only runs when extension mode is ON (CSS can't preserve extension).
 */
/**
 * Core title truncation for a set of title elements.
 * Uses read-then-write pattern to avoid layout thrashing.
 */
function truncateTitleElements(titles: Iterable<HTMLElement>): void {
  // Phase 1: Read all dimensions (forces 1 layout recalc)
  const measurements: Array<{
    textEl: HTMLElement;
    fullText: string;
    width: number;
    font: string;
    maxLines: number;
    suffixText: string;
  }> = [];

  for (const titleEl of titles) {
    // Skip titles in content-hidden cards (dimension reads trigger Chromium warnings)
    if (titleEl.closest('.card')?.classList.contains(CONTENT_HIDDEN_CLASS))
      continue;

    const textEl = titleEl.querySelector<HTMLElement>('.card-title-text');
    if (!textEl) continue;

    const fullText = (textEl.textContent || '').trim();
    if (!fullText) continue;

    const style = getOwnerWindow(titleEl).getComputedStyle(titleEl);
    const width = titleEl.offsetWidth;

    // Skip if not visible
    if (width <= 0) continue;

    const suffixEl = titleEl.querySelector('.card-title-ext-suffix');
    measurements.push({
      textEl,
      fullText,
      width,
      font: style.font,
      maxLines:
        parseInt(style.getPropertyValue('--dynamic-views-title-lines')) || 2,
      suffixText: suffixEl?.textContent || '',
    });
  }

  // Phase 2: Calculate and apply truncations (no layout reads)
  for (const m of measurements) {
    truncateTitleWithCanvas(
      m.textEl,
      m.fullText,
      m.width,
      m.font,
      m.maxLines,
      m.suffixText
    );
  }
}

export function initializeTitleTruncation(container: HTMLElement): void {
  // Only run in Extension mode (max-height truncation via canvas measurement)
  if (!isExtensionMode()) return;

  // Skip if scroll mode is enabled (no truncation)
  if (document.body.classList.contains('dynamic-views-title-overflow-scroll')) {
    return;
  }

  const titles = container.querySelectorAll<HTMLElement>('.card-title');
  if (titles.length === 0) return;

  truncateTitleElements(titles);
}

/**
 * Card-scoped variant — truncates titles for specific cards only.
 * Use in appendBatch to avoid re-scanning old hidden cards in the container.
 */
export function initializeTitleTruncationForCards(cards: HTMLElement[]): void {
  if (cards.length === 0) return;

  // Only run in Extension mode (max-height truncation via canvas measurement)
  if (!isExtensionMode()) return;

  // Skip if scroll mode is enabled (no truncation)
  if (document.body.classList.contains('dynamic-views-title-overflow-scroll')) {
    return;
  }

  const titles: HTMLElement[] = [];
  for (const card of cards) {
    const title = card.querySelector<HTMLElement>('.card-title');
    if (title) titles.push(title);
  }

  if (titles.length === 0) return;
  truncateTitleElements(titles);
}

// dragManager type declared in datacore/types.d.ts

/**
 * Batch-sync responsive classes (compact-mode, thumbnail-stack) for cards.
 * Uses read-then-write pattern to avoid layout thrashing:
 * - Phase 1: Read all card/thumbnail dimensions (1 layout recalc)
 * - Phase 2: Apply all class changes (no layout reads)
 *
 * @param cards - Array of card elements to sync
 * @returns true if any classes were changed (layout may need recalc)
 */
export function syncResponsiveClasses(cards: HTMLElement[]): boolean {
  const compactBreakpoint = getCompactBreakpoint();
  if (compactBreakpoint === 0 || cards.length === 0) return false;

  // Phase 1: Read all dimensions and current classes (forces 1 layout recalc)
  const measurements: Array<{
    card: HTMLElement;
    cardWidth: number;
    thumb: HTMLElement | null;
    thumbWidth: number;
    wasCompact: boolean;
    wasStacked: boolean;
  }> = [];

  for (const card of cards) {
    // Skip content-hidden cards (dimension reads trigger Chromium warnings)
    if (card.classList.contains(CONTENT_HIDDEN_CLASS)) continue;
    const cardWidth = card.offsetWidth;
    if (cardWidth <= 0) continue;

    const thumb = card.querySelector<HTMLElement>(
      '.card-thumbnail, .card-thumbnail-placeholder'
    );
    const thumbWidth = thumb?.offsetWidth ?? 0;
    const wasCompact = card.classList.contains('compact-mode');
    const wasStacked = card.classList.contains('thumbnail-stack');

    measurements.push({
      card,
      cardWidth,
      thumb,
      thumbWidth,
      wasCompact,
      wasStacked,
    });
  }

  // Phase 2: Apply all class changes (no layout reads)
  let anyChanged = false;
  const exitedCompact: HTMLElement[] = [];
  for (const {
    card,
    cardWidth,
    thumb,
    thumbWidth,
    wasCompact,
    wasStacked,
  } of measurements) {
    const shouldBeCompact = cardWidth < compactBreakpoint;
    const shouldBeStacked =
      thumb !== null &&
      thumbWidth > 0 &&
      cardWidth < thumbWidth * THUMBNAIL_STACK_MULTIPLIER;

    if (shouldBeCompact !== wasCompact) {
      card.classList.toggle('compact-mode', shouldBeCompact);
      if (!shouldBeCompact) {
        cancelCompactStackedCheck(card);
        exitedCompact.push(card);
      }
      anyChanged = true;
    }
    if (thumb && shouldBeStacked !== wasStacked) {
      card.classList.toggle('thumbnail-stack', shouldBeStacked);
      anyChanged = true;
    }
  }

  // Phase 3: Trigger property measurement on cards that exited compact mode.
  // The property RO may have already fired and skipped (compact guard) with no
  // subsequent event — card width didn't change, only the class was removed.
  for (const card of exitedCompact) {
    remeasureCardPairs(card);
  }

  // Compact-stacked wrapping detection is handled by RAF-batched
  // queueCompactStackedCheck() in property-helpers.ts (per-card RO queues).

  return anyChanged;
}

export class SharedCardRenderer {
  private propertyObservers: ResizeObserver[] = [];
  private viewerCleanupFns: Map<HTMLElement, () => void> = new Map();
  private viewerClones: Map<HTMLElement, HTMLElement> = new Map();
  private slideshowCleanups: (() => void)[] = [];
  private cardScopes: Scope[] = [];
  private cardAbortControllers: AbortController[] = [];
  private propertyRerenderController = new Map<HTMLElement, AbortController>();
  private subtitleRerenderController = new Map<HTMLElement, AbortController>();
  private urlButtonRerenderController = new Map<HTMLElement, AbortController>();
  private activeScope: Scope | null = null;
  private iconAlignmentMeasured = false;

  constructor(
    protected app: App,
    protected plugin: DynamicViews,
    protected updateLayoutRef: {
      current: ((source?: LayoutSource) => void) | null;
    }
  ) {}

  // Wrapper that tags image-load relayouts with source for coalescing in masonry
  private imageLayoutCallback = (): void => {
    this.updateLayoutRef.current?.('image-load');
  };

  /**
   * Cleanup observers, scopes, event listeners, and zoom state when renderer is destroyed
   */
  public cleanup(forceViewerCleanup = false): void {
    this.iconAlignmentMeasured = false;
    this.propertyObservers.forEach((obs) => obs.disconnect());
    this.propertyObservers = [];

    // Cleanup slideshow event listeners
    this.slideshowCleanups.forEach((cleanup) => cleanup());
    this.slideshowCleanups = [];

    // Pop any active scope to prevent scope leak on unmount
    if (this.activeScope) {
      this.app.keymap.popScope(this.activeScope);
      this.activeScope = null;
    }

    // Clear scope references
    this.cardScopes = [];

    // Abort all card event listeners
    this.cardAbortControllers.forEach((controller) => controller.abort());
    this.cardAbortControllers = [];

    // Abort all rerender-specific controllers
    for (const map of [
      this.propertyRerenderController,
      this.subtitleRerenderController,
      this.urlButtonRerenderController,
    ]) {
      map.forEach((c) => c.abort());
      map.clear();
    }

    // Cleanup viewers only on view destruction (viewer persists across re-renders)
    if (forceViewerCleanup) {
      cleanupAllViewers(this.viewerCleanupFns, this.viewerClones);
    }
  }

  /** Abort all rerender controllers for a card (property, subtitle, URL button) */
  public abortCardRerenderControllers(cardEl: HTMLElement): void {
    for (const map of [
      this.propertyRerenderController,
      this.subtitleRerenderController,
      this.urlButtonRerenderController,
    ]) {
      map.get(cardEl)?.abort();
      map.delete(cardEl);
    }
  }

  /**
   * Render text with link detection
   * Uses parseLink utility for comprehensive link detection
   */
  private renderTextWithLinks(
    container: HTMLElement,
    text: string,
    sourcePath: string,
    signal?: AbortSignal
  ): void {
    const segments = findLinksInText(text);

    for (const segment of segments) {
      if (segment.type === 'text') {
        // Wrap text in span to preserve whitespace in flex containers
        container.createSpan({ text: segment.content });
      } else {
        this.renderLink(container, segment.link, sourcePath, signal);
      }
    }
  }

  private renderLink(
    container: HTMLElement,
    link: ParsedLink,
    sourcePath: string,
    signal?: AbortSignal
  ): void {
    // Internal link (wikilink or markdown internal)
    if (link.type === 'internal') {
      if (link.isEmbed) {
        // Embedded internal link - render as embed container
        const embed = container.createSpan({ cls: 'internal-embed' });
        embed.dataset.src = link.url;
        embed.setText(link.caption);
        embed.addEventListener(
          'click',
          (e) => {
            e.preventDefault();
            e.stopPropagation();
            const newLeaf = e.metaKey || e.ctrlKey;
            void this.app.workspace.openLinkText(link.url, '', newLeaf);
          },
          { signal }
        );
        return;
      }
      // Regular internal link
      const el = container.createEl('a', {
        cls: 'internal-link',
        text: link.caption,
        href: link.url,
      });
      el.dataset.href = link.url;
      el.tabIndex = -1;
      el.draggable = true;
      el.addEventListener(
        'click',
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          const newLeaf = e.metaKey || e.ctrlKey;
          void this.app.workspace.openLinkText(link.url, '', newLeaf);
        },
        { signal }
      );
      el.addEventListener(
        'dragstart',
        (e) => {
          e.stopPropagation();
          const file = this.app.metadataCache.getFirstLinkpathDest(
            link.url,
            ''
          );
          if (!(file instanceof TFile)) return;
          const dragData = this.app.dragManager.dragLink(e, link.url, '');
          this.app.dragManager.onDragStart(e, dragData);
        },
        { signal }
      );
      el.addEventListener(
        'contextmenu',
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          const file = this.app.metadataCache.getFirstLinkpathDest(
            link.url,
            ''
          );
          if (!(file instanceof TFile)) return;
          showFileContextMenu(e, this.app, file, link.url);
        },
        { signal }
      );
      el.addEventListener(
        'mouseenter',
        (e) => {
          const card = el.closest('.card');
          const hp =
            card instanceof HTMLElement
              ? cardHoverParents.get(card)
              : undefined;
          if (!hp) return;
          this.app.workspace.trigger('hover-link', {
            event: e,
            source: 'bases',
            hoverParent: hp,
            targetEl: el,
            linktext: link.url,
            sourcePath,
          });
        },
        { signal }
      );
      return;
    }

    // External link
    if (link.isEmbed) {
      // Embedded external link (image)
      const img = container.createEl('img', {
        cls: 'external-embed',
        attr: { src: link.url, alt: link.caption },
      });
      img.addEventListener(
        'click',
        (e) => {
          e.stopPropagation();
        },
        { signal }
      );
      img.addEventListener(
        'error',
        () => {
          if (signal?.aborted) return; // Guard against race with cleanup
          img.addClass('dynamic-views-hidden');
        },
        { signal, once: true }
      );
      return;
    }
    // Regular external link
    // Only open in new tab for web URLs, not custom URIs like obsidian://
    const el = container.createEl('a', {
      cls: 'external-link',
      text: link.caption,
      href: link.url,
    });
    el.tabIndex = -1;
    if (link.isWebUrl) {
      el.target = '_blank';
      el.rel = 'noopener noreferrer';
    }
    el.addEventListener(
      'click',
      (e) => {
        e.stopPropagation();
      },
      { signal }
    );
    el.addEventListener(
      'dragstart',
      createExternalLinkDragHandler(el, link.caption, link.url),
      { signal }
    );
    el.addEventListener(
      'contextmenu',
      (e) => {
        showExternalLinkContextMenu(
          e,
          link.url,
          link.isMarkdownLink ? link.caption : undefined
        );
      },
      { signal }
    );
  }

  /**
   * Renders a complete card with all sub-components
   * @param container - Container to append card to
   * @param card - Card data
   * @param entry - Bases entry
   * @param settings - View settings
   * @param keyboardNav - Optional keyboard navigation config
   */
  renderCard(
    container: HTMLElement,
    card: CardData,
    entry: BasesEntry,
    settings: BasesResolvedSettings,
    keyboardNav?: {
      index: number;
      focusableCardIndex: number;
      containerRef: { current: HTMLElement | null };
      onFocusChange?: (index: number) => void;
      onHoverStart?: (el: HTMLElement) => void;
      onHoverEnd?: () => void;
      getVirtualRects?: () => readonly VirtualCardRect[];
      onMountItem?: (index: number) => HTMLElement | null;
    }
  ): CardHandle {
    // Snapshot instance array lengths for per-card resource collection
    const observersBefore = this.propertyObservers.length;
    const slideshowsBefore = this.slideshowCleanups.length;

    // Create card element
    const cardEl = container.createDiv('card');

    // Shared hover parent — new popovers on the same parent auto-dismiss the previous one
    const hoverParent: { hoverPopover: null } = { hoverPopover: null };
    cardHoverParents.set(cardEl, hoverParent);

    const format = settings.imageFormat;
    const position = settings.imagePosition;

    // Poster: force title-as-link and card context menu (click toggles reveal, not file open)
    const isPoster = format === 'poster';

    // Check if any image source is configured (property or embeds)
    const hasImageSource =
      !!settings.imageProperty?.trim() || settings.fallbackToEmbeds !== 'never';

    // Add format/position classes only when an image source is configured
    if (hasImageSource) {
      if (format === 'cover') {
        cardEl.classList.add('image-format-cover');
      } else if (format === 'thumbnail') {
        cardEl.classList.add('image-format-thumbnail');
      } else if (format === 'poster') {
        cardEl.classList.add('image-format-poster');
      } else if (format === 'backdrop') {
        cardEl.classList.add('image-format-backdrop');
      }

      if (format === 'thumbnail') {
        cardEl.classList.add(`card-thumbnail-${position}`);
      } else if (format === 'cover') {
        cardEl.classList.add(`card-cover-${position}`);
      }
    }

    cardEl.setAttribute('data-path', card.path);

    const isPosterClickReveal =
      isPoster &&
      hasImageSource &&
      card.imageUrl &&
      (this.app.isMobile || hasBodyClass('dynamic-views-poster-reveal-press'));

    const isCardClickable =
      settings.openFileAction === 'card' && !isPosterClickReveal;
    if (isCardClickable) {
      cardEl.setAttribute('draggable', 'true');
    }
    cardEl.classList.toggle('clickable-card', isCardClickable);

    // Create AbortController for event listener cleanup
    const abortController = new AbortController();
    this.cardAbortControllers.push(abortController);
    const { signal } = abortController;

    // Keyboard navigation setup (roving tabindex pattern)
    // Hoisted for per-card cleanup closure (scope leak prevention on unmount)
    let cardScope: Scope | null = null;
    if (keyboardNav) {
      cardEl.tabIndex =
        keyboardNav.index === keyboardNav.focusableCardIndex ? 0 : -1;

      // Create scope for Cmd/Ctrl+Enter and Cmd/Ctrl+Space handling
      // Pass app.scope as parent so unhandled keys bubble up to Obsidian
      cardScope = new Scope(this.app.scope);
      cardScope.register(['Mod'], 'Enter', () => {
        void this.app.workspace.openLinkText(card.path, '', 'tab');
        return false;
      });
      cardScope.register(['Mod'], ' ', () => {
        void this.app.workspace.openLinkText(card.path, '', 'tab');
        return false;
      });
      this.cardScopes.push(cardScope);

      // Update focus state and push scope when card receives focus
      cardEl.addEventListener(
        'focus',
        () => {
          if (keyboardNav.onFocusChange) {
            keyboardNav.onFocusChange(keyboardNav.index);
          }
          // Pop previous scope if exists and different (handles rapid focus switching)
          if (this.activeScope && this.activeScope !== cardScope) {
            this.app.keymap.popScope(this.activeScope);
          }
          this.activeScope = cardScope;
          this.app.keymap.pushScope(cardScope!);
        },
        { signal }
      );

      // Pop scope when card loses focus
      cardEl.addEventListener(
        'blur',
        () => {
          // Only pop if this card's scope is the active one
          if (this.activeScope === cardScope) {
            this.app.keymap.popScope(cardScope!);
            this.activeScope = null;
          }
        },
        { signal }
      );

      // Handle keyboard events (Enter/Space, arrows, Tab, Escape)
      cardEl.addEventListener(
        'keydown',
        (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            // Open file (Mod+key handled by scope above)
            if (!e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              void this.app.workspace.openLinkText(card.path, '', false);
            }
          } else if (isArrowKey(e.key)) {
            if (isImageViewerBlockingNav(keyboardNav.containerRef.current))
              return;
            // Arrow key navigation
            e.preventDefault();
            const container = keyboardNav.containerRef.current as
              | (HTMLElement & {
                  _keyboardNavActive?: boolean;
                  _intentionalFocus?: boolean;
                })
              | null;
            if (container?.isConnected) {
              container._intentionalFocus = true;
              handleArrowNavigation(
                e,
                cardEl,
                container,
                (_targetCard, targetIndex) => {
                  container._keyboardNavActive = true;
                  if (keyboardNav.onFocusChange) {
                    keyboardNav.onFocusChange(targetIndex);
                  }
                },
                keyboardNav.getVirtualRects?.(),
                keyboardNav.onMountItem
              );
              // Clear immediately after navigation completes (synchronous)
              container._intentionalFocus = false;
            }
          } else if (e.key === 'Escape') {
            // Exit keyboard nav mode and unfocus card
            const container = keyboardNav.containerRef.current as
              | (HTMLElement & { _keyboardNavActive?: boolean })
              | null;
            if (container?.isConnected) {
              container._keyboardNavActive = false;
            }
            cardEl.blur();
          }
        },
        { signal }
      );
    }

    // Exit keyboard nav mode on mouse click (focus via mouse, not keyboard)
    // Use capture phase so this fires before child element stopPropagation
    if (keyboardNav?.containerRef) {
      cardEl.addEventListener(
        'mousedown',
        () => {
          const container = keyboardNav.containerRef.current as
            | (HTMLElement & { _keyboardNavActive?: boolean })
            | null;
          if (container) {
            container._keyboardNavActive = false;
          }
        },
        { signal, capture: true }
      );
    }

    // Handle card click to open file
    cardEl.addEventListener(
      'click',
      (e) => {
        // Poster tap toggle: mobile or desktop press mode
        // Uses outer isPosterClickReveal + DOM guard (poster element may be removed after render)
        if (isPosterClickReveal && cardEl.querySelector('.card-poster')) {
          const target = e.target as HTMLElement;
          const isInteractive = target.closest(
            'a, button, input, select, textarea, .tag, .path-segment, .path-separator, .clickable-icon, .multi-select-pill, .checkbox-container'
          );
          // Don't dismiss if user has selected text (drag-select or double-click)
          const hasTextSelection =
            ((cardEl.ownerDocument.defaultView ?? window)
              .getSelection()
              ?.toString().length ?? 0) > 0;
          // Don't dismiss if click landed on text-selectable content —
          // prevents double-click word selection from being swallowed by dismiss
          const isTextTarget =
            settings.openFileAction === 'title' &&
            target.closest(
              '.card-subtitle, .card-text-preview-text, .card-text-preview p, .property-label, .property-label-inline, .property-content'
            );

          if (!cardEl.classList.contains('poster-revealed')) {
            e.preventDefault();
            e.stopPropagation();
            // Dismiss any other revealed card in the same view
            cardEl
              .closest('.dynamic-views')
              ?.querySelector('.card.poster-revealed')
              ?.classList.remove('poster-revealed');
            cardEl.classList.add('poster-revealed');
            // Press acts as hover intent — ungate pointer cursors
            cardEl.classList.add('hover-intent-active');
            return;
          } else if (!isInteractive && !isTextTarget && !hasTextSelection) {
            e.stopPropagation();
            cardEl.classList.remove('poster-revealed');
            return;
          }
        }

        // Card-level click-to-open: mobile except poster cards with images (poster with image uses tap-to-reveal)
        if (
          settings.openFileAction === 'card' &&
          !(
            isPoster &&
            card.imageUrl &&
            (this.app.isMobile ||
              hasBodyClass('dynamic-views-poster-reveal-press'))
          )
        ) {
          const target = e.target as HTMLElement;
          // Don't open if clicking on links, tags, path segments, or images (when zoom enabled)
          const isLink = target.tagName === 'A' || target.closest('a');
          const isTag =
            target.classList.contains('tag') || target.closest('.tag');
          const isPathSegment =
            target.classList.contains('path-segment') ||
            target.closest('.path-segment') ||
            target.classList.contains('path-separator');
          const isImage = target.tagName === 'IMG';
          const isZoomEnabled = !document.body.classList.contains(
            'dynamic-views-image-viewer-disabled'
          );

          if (
            !isLink &&
            !isTag &&
            !isPathSegment &&
            !(isImage && isZoomEnabled)
          ) {
            const paneType = Keymap.isModEvent(e);
            const file = this.app.vault.getAbstractFileByPath(card.path);
            if (file instanceof TFile) {
              void this.app.workspace.getLeaf(paneType || false).openFile(file);
            }
          }
        }
      },
      { signal }
    );

    // Card-level hover intent: gates cursor, link hover effects, and keyboard nav
    if (getOwnerWindow(cardEl).matchMedia('(hover: hover)').matches) {
      setupHoverIntent(
        cardEl,
        () => {
          cardEl.classList.add('hover-intent-active');
          cardEl.closest('.masonry-container')?.classList.add('has-hover-card');
          keyboardNav?.onHoverStart?.(cardEl);
        },
        () => {
          cardEl.classList.remove('hover-intent-active');
          cardEl
            .closest('.masonry-container')
            ?.classList.remove('has-hover-card');
          keyboardNav?.onHoverEnd?.();
        },
        signal
      );
    }

    // Poster hover intent: require mousemove before activating (ignores scroll-triggered hovers)
    // Gates content reveal (via CSS) and scroll access on desktop.
    if (
      isPoster &&
      getOwnerWindow(cardEl).matchMedia('(hover: hover)').matches &&
      !hasBodyClass('dynamic-views-poster-reveal-press')
    ) {
      setupHoverIntent(
        cardEl,
        () => {
          cardEl
            .closest('.dynamic-views')
            ?.querySelector('.card.poster-hover-active')
            ?.classList.remove('poster-hover-active');
          cardEl.classList.add('poster-hover-active');
        },
        () => cardEl.classList.remove('poster-hover-active'),
        signal
      );
    }

    // Handle hover for page preview (only on card when openFileAction is 'card')
    // Use mouseenter (not mouseover) to prevent multiple triggers from child elements
    if (settings.openFileAction === 'card') {
      cardEl.addEventListener(
        'mouseenter',
        (e) => {
          this.app.workspace.trigger('hover-link', {
            event: e,
            source: 'bases',
            hoverParent,
            targetEl: cardEl,
            linktext: card.path,
            sourcePath: card.path,
          });
        },
        { signal }
      );
    }

    // Context menu handler for file
    const handleContextMenu = (e: MouseEvent) => {
      showFileContextMenu(e, this.app, entry.file, card.path);
    };

    // Attach context menu to card when openFileAction is 'card'
    if (settings.openFileAction === 'card') {
      cardEl.addEventListener(
        'contextmenu',
        (e: MouseEvent) => {
          // Poster click-reveal: context menu on title text only.
          // Mobile: .card-title (full wrapper — fat finger). Desktop: .card-title-text (precise).
          if (
            isPosterClickReveal &&
            !(e.target as HTMLElement).closest(
              this.app.isMobile ? '.card-title' : '.card-title-text'
            )
          )
            return;
          handleContextMenu(e);
        },
        { signal }
      );
    }

    // Drag handler — use dragLink (not dragFile) to match vanilla Bases ghost icon
    const handleDrag = createCardDragHandler(this.app, card.path);

    // Helper to render title content into a container
    const renderTitleContent = (titleEl: HTMLElement) => {
      // Add file type icon first (hidden by default, shown via CSS when Icon mode selected)
      const icon = getFileTypeIcon(card.path);
      if (icon) {
        const iconEl = titleEl.createSpan({ cls: 'card-title-icon' });
        setIcon(iconEl, icon);
      }

      // Add file format indicator before title text (for Flair mode float:left)
      const extInfo = getFileExtInfo(card.path, isFullname);
      const extNoDot = extInfo?.ext.slice(1) || '';
      if (extInfo) {
        titleEl.createSpan({
          cls: 'card-title-ext',
          attr: { 'data-ext': extNoDot },
        });
      }

      // Add title text
      if (settings.openFileAction === 'title' || isPosterClickReveal) {
        // Render as clickable, draggable link
        const link = titleEl.createEl('a', {
          cls: 'internal-link card-title-text',
          text: displayTitle,
          attr: {
            'data-href': card.path,
            href: card.path,
            draggable: 'true',
            'data-ext': extNoDot,
            tabindex: '-1',
          },
        });

        link.addEventListener(
          'click',
          (e) => {
            e.preventDefault();
            e.stopPropagation();
            const paneType = Keymap.isModEvent(e);
            void this.app.workspace.openLinkText(
              card.path,
              '',
              paneType || false
            );
          },
          { signal }
        );

        // Page preview on hover — skip when card handler already covers it
        // (isPosterClickReveal + openFileAction 'card' = card mouseenter handles it)
        if (!(isPosterClickReveal && settings.openFileAction === 'card')) {
          link.addEventListener(
            'mouseenter',
            (e) => {
              this.app.workspace.trigger('hover-link', {
                event: e,
                source: 'bases',
                hoverParent,
                targetEl: link,
                linktext: card.path,
                sourcePath: card.path,
              });
            },
            { signal }
          );
        }

        // Open context menu on right-click
        link.addEventListener('contextmenu', handleContextMenu, { signal });

        // Make title draggable when openFileAction is 'title'
        link.addEventListener('dragstart', handleDrag, { signal });

        // Dead zone: clicks/contextmenu on .card-title that miss the link.
        // Mobile only — fat-finger tap targets. Desktop uses precise link clicks.
        // Only for open-on-title — in press mode, only the link itself is clickable.
        if (settings.openFileAction === 'title' && this.app.isMobile) {
          titleEl.addEventListener(
            'click',
            (e) => {
              if (!link.contains(e.target as Node)) {
                e.stopPropagation();
                const paneType = Keymap.isModEvent(e);
                void this.app.workspace.openLinkText(
                  card.path,
                  '',
                  paneType || false
                );
              }
            },
            { signal }
          );

          titleEl.addEventListener(
            'contextmenu',
            (e) => {
              if (!link.contains(e.target as Node)) {
                handleContextMenu(e);
              }
            },
            { signal }
          );
        }

        // Add extension suffix inside link for Extension mode
        if (extInfo && isExtensionMode()) {
          link.createSpan({
            cls: 'card-title-ext-suffix',
            text: `.${extNoDot}`,
          });
        }
      } else {
        // Render as plain text in a span for truncation
        titleEl.createSpan({
          cls: 'card-title-text',
          text: displayTitle,
          attr: { 'data-ext': extNoDot },
        });

        // Add extension suffix for Extension mode
        if (extInfo && isExtensionMode()) {
          titleEl.createSpan({
            cls: 'card-title-ext-suffix',
            text: `.${extNoDot}`,
          });
        }
      }

      // Setup scroll gradients for title if scroll mode is enabled
      if (
        document.body.classList.contains('dynamic-views-title-overflow-scroll')
      ) {
        setupElementScrollGradient(titleEl, signal);
      }
    };

    // Helper to render subtitle content into a container
    const renderSubtitleContent = (
      subtitleEl: HTMLElement,
      subtitleProperty: string
    ) => {
      this.renderPropertyContent(
        subtitleEl,
        subtitleProperty,
        card.subtitle,
        card,
        entry,
        { ...settings, propertyLabels: 'hide' },
        shouldHideMissingProperties(),
        getHideEmptyMode(),
        signal
      );

      // Setup scroll gradients if scroll mode is enabled
      if (
        document.body.classList.contains(
          'dynamic-views-subtitle-overflow-scroll'
        )
      ) {
        setupElementScrollGradient(subtitleEl, signal);
      }

      // Setup scroll gradients for inner wrapper (works in wrap mode too)
      const subtitleWrapper = subtitleEl.querySelector(
        '.property-content-wrapper'
      ) as HTMLElement;
      if (subtitleWrapper) {
        setupElementScrollGradient(subtitleWrapper, signal);
      }
    };

    // Prepare image URLs if applicable
    const rawUrls = card.imageUrl
      ? Array.isArray(card.imageUrl)
        ? card.imageUrl
        : [card.imageUrl]
      : [];

    // Filter broken, empty, and duplicate URLs
    const imageUrls = filterBrokenUrls(
      Array.from(
        new Set(
          rawUrls.filter(
            (url) => url && typeof url === 'string' && url.trim().length > 0
          )
        )
      )
    );
    const hasImage = imageUrls.length > 0;

    // Check if title or subtitle will be rendered
    // In Ext/Flair/Icon modes, use basename when title property includes an
    // extension — the extension is shown via a separate element (suffix/badge/icon).
    // In None mode, keep the full title since no separate indicator exists.
    const showsExtSeparately = !document.body.classList.contains(
      'dynamic-views-file-type-none'
    );
    const titleProp = settings.titleProperty || '';
    const titleHasExtension =
      titleProp === 'file.name' || titleProp === 'file.fullname';
    const isFullname = titleProp === 'file.fullname';
    const displayTitle =
      showsExtSeparately && titleHasExtension
        ? entry.file.basename
        : card.title;
    const hasTitle = !!displayTitle;
    const hasSubtitle = settings.subtitleProperty && card.subtitle;

    // Covers: create wrapper BEFORE .card-content for top/left position
    if (
      format === 'cover' &&
      (hasImage || hasImageSource) &&
      (position === 'top' || position === 'left')
    ) {
      this.renderCoverWrapper(
        cardEl,
        imageUrls,
        hasImage,
        position,
        settings,
        card,
        signal
      );
    }

    // Universal content wrapper: header + body
    const cardContent = cardEl.createDiv('card-content');

    // Title, Subtitle, and URL button — always wrapped in card-header
    if (hasTitle || hasSubtitle || (card.hasValidUrl && card.urlValue)) {
      const headerEl = cardContent.createDiv('card-header');

      if (hasTitle || hasSubtitle) {
        const groupEl = headerEl.createDiv('card-title-block');

        if (hasTitle) {
          const titleEl = groupEl.createDiv('card-title');
          titleEl.tabIndex = -1;
          renderTitleContent(titleEl);
        }

        if (hasSubtitle) {
          const subtitleEl = groupEl.createDiv('card-subtitle');
          subtitleEl.tabIndex = -1;
          renderSubtitleContent(subtitleEl, settings.subtitleProperty);
        }
      }

      if (card.hasValidUrl && card.urlValue) {
        const iconEl = headerEl.createEl('a', {
          cls: 'card-title-url-icon text-icon-button svg-icon',
          href: card.urlValue,
        });
        iconEl.setAttribute('aria-label', card.urlValue);
        if (/^https?:\/\//i.test(card.urlValue)) {
          iconEl.target = '_blank';
          iconEl.rel = 'noopener noreferrer';
        }
        setIcon(iconEl, 'arrow-up-right');
        // Hidden text for native link drag ghost — Chromium uses textContent
        // to generate the 2-line ghost (title + URL). Without text, only the
        // SVG icon appears as the ghost.
        const dragText = iconEl.createSpan('dynamic-views-drag-text');
        dragText.textContent = card.urlValue;
        // Store for freshness — surgical updates refresh this without
        // re-binding event listeners
        iconEl.dataset.dvUrlValue = card.urlValue;

        iconEl.addEventListener(
          'click',
          (e) => {
            e.stopPropagation();
            iconEl.ownerDocument.body.querySelector('.tooltip')?.remove();
          },
          { signal }
        );
        iconEl.addEventListener(
          'contextmenu',
          (e) => {
            showExternalLinkContextMenu(
              e,
              (iconEl.dataset.dvUrlValue ?? card.urlValue) as string
            );
          },
          { signal }
        );
        const urlDrag = createUrlButtonDragHandlers(iconEl, card.urlValue);
        iconEl.addEventListener('dragstart', urlDrag.onDragStart, { signal });
        iconEl.addEventListener('dragend', urlDrag.onDragEnd, { signal });
        iconEl.addEventListener('touchstart', urlDrag.onTouchStart, {
          signal,
          passive: true,
        });
      }
    }

    // Make card draggable when settings.openFileAction is 'card'
    if (settings.openFileAction === 'card') {
      cardEl.addEventListener('dragstart', handleDrag, { signal });
    }

    // POSTER: absolute-positioned image fills entire card, content hidden until hover
    if (format === 'poster' && hasImage) {
      const bgWrapper = cardEl.createDiv('card-poster');
      cardEl.classList.add('has-poster');
      const img = bgWrapper.createEl('img', {
        attr: { src: imageUrls[0], alt: '' },
      });
      setupBackdropImageLoader(
        img,
        cardEl,
        imageUrls,
        this.imageLayoutCallback,
        signal
      );
    }

    // BACKDROP: absolute-positioned image fills entire card
    if (format === 'backdrop' && hasImage) {
      const bgWrapper = cardEl.createDiv('card-backdrop');
      cardEl.classList.add('has-backdrop');
      const img = bgWrapper.createEl('img', {
        attr: { src: imageUrls[0], alt: '' },
      });
      setupBackdropImageLoader(
        img,
        cardEl,
        imageUrls,
        this.imageLayoutCallback,
        signal
      );
    }

    // Universal card-body: contains properties and previews
    const bodyEl = cardContent.createDiv('card-body');

    // Poster: vertical scroll gradient on card-body
    if (format === 'poster') {
      setupVerticalScrollGradient(bodyEl, signal);
    }

    // Properties - 4-field rendering with 2-set layout (creates top/bottom containers)
    this.renderProperties(bodyEl, card, entry, settings, signal);

    // Determine if card-previews will have children
    const hasTextPreview = card.textPreview;
    const isThumbnailFormat = format === 'thumbnail';
    // Only show thumbnail placeholder when an image source is configured
    const showThumbnail = isThumbnailFormat && (hasImage || hasImageSource);

    // Only create card-previews if it will have children
    let previewsEl: HTMLElement | null = null;
    if (hasTextPreview || showThumbnail) {
      // Insert before .card-properties-bottom if it exists (DOM order: top → previews → bottom)
      const bottomProps = bodyEl.querySelector('.card-properties-bottom');
      previewsEl = bodyEl.createDiv('card-previews');
      if (bottomProps) {
        bodyEl.insertBefore(previewsEl, bottomProps);
      } else {
        bodyEl.appendChild(previewsEl);
      }

      if (hasTextPreview && card.textPreview) {
        previewsEl.classList.add('has-text-preview');
        const wrapper = previewsEl.createDiv('card-text-preview-wrapper');
        const previewDiv = wrapper.createDiv('card-text-preview');
        setPreviewContent(previewDiv, card.textPreview);

        // has-paragraphs: mark when text preview contains <p> children
        if (previewDiv.querySelector('p')) {
          previewDiv.classList.add('has-paragraphs');
        }
      }

      // Thumbnail (all positions now inside card-previews)
      if (showThumbnail) {
        if (hasImage) {
          const imageEl = previewsEl.createDiv('card-thumbnail');
          this.renderImage(
            imageEl,
            imageUrls,
            'thumbnail',
            position,
            settings,
            cardEl,
            signal
          );

          // Multi-image indicator for scrubbable thumbnails
          if (
            imageUrls.length > 1 &&
            !this.app.isMobile &&
            !isThumbnailScrubbingDisabled()
          ) {
            const indicator = imageEl.createDiv('thumbnail-indicator');
            setIcon(indicator, 'lucide-copy');
          }
        } else {
          previewsEl.createDiv('card-thumbnail-placeholder');
          // Only a placeholder child — mark for CSS targeting
          if (!hasTextPreview) {
            previewsEl.classList.add('thumbnail-placeholder-only');
          }
        }
      }

      // text-only: previews has text but no image elements
      if (hasTextPreview && !showThumbnail) {
        previewsEl.classList.add('text-only');
      }
    }

    // Covers: create wrapper AFTER .card-content for bottom/right position
    if (
      format === 'cover' &&
      (hasImage || hasImageSource) &&
      (position === 'bottom' || position === 'right')
    ) {
      this.renderCoverWrapper(
        cardEl,
        imageUrls,
        hasImage,
        position,
        settings,
        card,
        signal
      );
    }

    // Structural content classes (replace CSS :has() selectors).
    // has-body-content: body has visible properties or previews.
    // Drives card-body display:none when empty (prevents gap below subtitle).
    if (bodyEl.querySelector(VISIBLE_BODY_SELECTOR)) {
      bodyEl.classList.add('has-body-content');
    }
    // has-card-content: card-level flag for cover padding and title divider CSS rules.
    if (cardEl.querySelector(VISIBLE_BODY_SELECTOR)) {
      cardEl.classList.add('has-card-content');
    }
    if (cardEl.querySelector('.card-properties-bottom')) {
      cardEl.classList.add('has-properties-bottom');
    }
    // Prevents cover-only padding reset from zeroing padding on title-only cards.
    if (cardEl.querySelector('.card-header')) {
      cardEl.classList.add('has-header');
    }

    // Card-level responsive behaviors (single ResizeObserver)
    // Use cached breakpoint to avoid getComputedStyle per card
    const breakpoint = getCompactBreakpoint();

    // Check if thumbnail stacking is applicable (class toggle for all, DOM move only with text preview)
    const needsThumbnailStacking =
      format === 'thumbnail' && (position === 'left' || position === 'right');

    const thumbnailEl = needsThumbnailStacking
      ? (bodyEl.querySelector(
          '.card-thumbnail, .card-thumbnail-placeholder'
        ) as HTMLElement)
      : null;

    // DOM movement only when text preview exists (otherwise card-previews would be left empty)
    const canMoveThumbnail = needsThumbnailStacking && card.textPreview;

    // Thumbnail starts inside previews; stacking moves it to a sibling of previews in card-body
    let isStacked = canMoveThumbnail && thumbnailEl?.parentElement === bodyEl;

    const RO = getOwnerWindow(cardEl).ResizeObserver;
    const cardObserver = new RO((entries) => {
      // Guard against race with cleanup or element removal
      if (signal.aborted || !cardEl.isConnected) return;
      // Skip content-hidden cards (dimension reads trigger Chromium warnings).
      // Invalidate cache so wrapping is re-evaluated when the card becomes visible.
      if (cardEl.classList.contains(CONTENT_HIDDEN_CLASS)) {
        invalidateCompactStackedCache(cardEl);
        return;
      }
      for (const entry of entries) {
        // Use offsetWidth (border-box, rounded) to match syncResponsiveClasses.
        // contentRect.width is content-box subpixel — at boundary widths (e.g.
        // 389.5 vs offsetWidth 406) the two disagree and create an infinite toggle loop.
        const cardWidth = (entry.target as HTMLElement).offsetWidth;

        // Skip if card hasn't been sized yet (masonry sets width)
        if (cardWidth <= 0) continue;

        // Compact mode + wrapping detection
        if (breakpoint > 0) {
          const isCompact = cardWidth < breakpoint;
          cardEl.classList.toggle('compact-mode', isCompact);
          if (isCompact) {
            queueCompactStackedCheck(cardEl, cardWidth);
          } else {
            cancelCompactStackedCheck(cardEl);
          }
        }

        // Thumbnail stacking: class toggle + optional DOM move
        if (thumbnailEl && thumbnailEl.isConnected) {
          const thumbnailWidth = thumbnailEl.offsetWidth;
          const shouldStack =
            thumbnailWidth > 0 &&
            cardWidth < thumbnailWidth * THUMBNAIL_STACK_MULTIPLIER;

          if (canMoveThumbnail && previewsEl) {
            // Cards with text preview: move thumbnail between card-previews and card-body
            if (shouldStack && !isStacked) {
              if (cardEl.classList.contains('card-thumbnail-left')) {
                bodyEl.insertBefore(thumbnailEl, previewsEl);
              } else {
                previewsEl.after(thumbnailEl);
              }
              isStacked = true;
            } else if (!shouldStack && isStacked) {
              previewsEl.appendChild(thumbnailEl);
              isStacked = false;
            }
          }

          cardEl.classList.toggle('thumbnail-stack', shouldStack);
        }
      }
    });
    // Cleanup via this.propertyObservers.forEach(obs => obs.disconnect()) in cleanup()
    cardObserver.observe(cardEl);
    this.propertyObservers.push(cardObserver);

    // Collect per-card resources added during rendering (observers, slideshows)
    const cardObservers = this.propertyObservers.slice(observersBefore);
    const cardSlideshows = this.slideshowCleanups.slice(slideshowsBefore);

    // Per-card cleanup for individual teardown (virtual scrolling)
    // All operations are idempotent — safe if batch cleanup() also runs
    const cleanup = () => {
      abortController.abort();
      for (const obs of cardObservers) obs.disconnect();
      for (const fn of cardSlideshows) fn();
      // Pop scope if this card was focused (blur listener removed by abort, so popScope never fires)
      if (cardScope && this.activeScope === cardScope) {
        this.app.keymap.popScope(cardScope);
        this.activeScope = null;
      }
    };

    return { el: cardEl, cleanup };
  }

  /**
   * Creates a cover wrapper element on the card with image/slideshow/placeholder.
   * Also sets up side cover dimension observers for left/right positions.
   */
  /** Creates cover wrapper. Only called when format === "cover". */
  private renderCoverWrapper(
    cardEl: HTMLElement,
    imageUrls: string[],
    hasImage: boolean,
    position: 'left' | 'right' | 'top' | 'bottom',
    settings: BasesResolvedSettings,
    card: CardData,
    signal: AbortSignal
  ): void {
    const coverWrapper = cardEl.createDiv(
      hasImage
        ? 'card-cover-wrapper'
        : 'card-cover-wrapper card-cover-wrapper-placeholder'
    );

    if (hasImage) {
      cardEl.classList.add('has-cover');
      const maxSlideshow = getSlideshowMaxImages();
      const slideshowUrls = imageUrls.slice(0, maxSlideshow);
      const shouldShowSlideshow =
        isSlideshowEnabled() &&
        (position === 'top' || position === 'bottom') &&
        slideshowUrls.length >= 2;

      if (shouldShowSlideshow) {
        const slideshowEl = coverWrapper.createDiv(
          'card-cover card-cover-slideshow'
        );
        this.renderSlideshow(
          slideshowEl,
          slideshowUrls,
          'cover',
          position,
          settings,
          card.path
        );
      } else {
        const imageEl = coverWrapper.createDiv('card-cover');
        this.renderImage(
          imageEl,
          imageUrls,
          'cover',
          position,
          settings,
          cardEl,
          signal
        );
      }
    } else {
      cardEl.classList.add(
        'has-cover-placeholder',
        'has-cover-wrapper-placeholder'
      );
      coverWrapper.createDiv('card-cover-placeholder');
    }
  }

  /**
   * Renders slideshow for covers with multiple images
   * Uses two-image swap with keyframe animations (0.4.0 carousel approach)
   */
  private renderSlideshow(
    slideshowEl: HTMLElement,
    imageUrls: string[],
    format: 'thumbnail' | 'cover',
    position: 'left' | 'right' | 'top' | 'bottom',
    settings: BasesResolvedSettings,
    cardPath: string
  ): void {
    // Create AbortController for cleanup
    const controller = new AbortController();
    const { signal } = controller;
    this.slideshowCleanups.push(() => controller.abort());

    // Create image embed with two stacked images
    const imageEmbedContainer = slideshowEl.createDiv(
      'dynamic-views-image-embed'
    );

    // Add zoom handler
    const cardEl = slideshowEl.closest('.card') as HTMLElement;
    imageEmbedContainer.addEventListener(
      'click',
      (e) => {
        handleImageViewerTrigger(
          e,
          cardPath,
          this.app,
          this.viewerCleanupFns,
          this.viewerClones,
          settings.openFileAction
        );
      },
      { signal }
    );

    // Create two persistent img elements (current and next)
    const currentImg = imageEmbedContainer.createEl('img', {
      cls: 'slideshow-img slideshow-img-current',
      attr: { src: imageUrls[0], alt: '' },
    });

    // Next image starts with empty src
    imageEmbedContainer.createEl('img', {
      cls: 'slideshow-img slideshow-img-next',
      attr: { src: '', alt: '' },
    });

    // Shared handler for both hover preload and navigator preload —
    // both mutate the same imageUrls array, so a single instance deduplicates splices
    const preloadBrokenHandler = createPreloadBrokenHandler(
      imageUrls,
      cardEl,
      () => {
        imageEmbedContainer.parentElement?.addClass('slideshow-single');
      }
    );
    const preloadGuard = { done: false };

    // Handle image load for masonry layout
    if (cardEl) {
      setupImageLoadHandler(currentImg, cardEl, this.imageLayoutCallback);

      // Setup image preloading
      setupImagePreload(
        cardEl,
        imageUrls,
        signal,
        preloadBrokenHandler,
        preloadGuard
      );
    }

    // Hover zoom eligibility: only first hovered slide gets zoom effect.
    const clearHoverZoom = setupHoverZoomEligibility(
      cardEl,
      imageEmbedContainer,
      signal
    );

    // Create navigator with shared logic
    const { navigate, reset } = createSlideshowNavigator(
      imageUrls,
      () => {
        const currImg = imageEmbedContainer.querySelector(
          '.slideshow-img-current'
        ) as HTMLImageElement;
        const nextImg = imageEmbedContainer.querySelector(
          '.slideshow-img-next'
        ) as HTMLImageElement;
        if (!currImg || !nextImg) return null;
        return { imageEmbed: imageEmbedContainer, currImg, nextImg };
      },
      signal,
      {
        onSlideChange: (_newIndex, nextImg) => {
          // Only set aspect ratio if not yet set by a successful image load
          // (first image may have failed and set default ratio)
          if (cardEl && !cardEl.dataset.aspectRatioSet) {
            handleImageLoad(nextImg, cardEl, this.imageLayoutCallback);
          }
        },
        onAnimationComplete: () => {
          clearHoverZoom();
        },
        onAllFailed: () => {
          handleAllImagesFailed(cardEl);
        },
        onBroken: preloadBrokenHandler,
        preloadGuard,
      }
    );

    // Reset to slide 1 when view becomes visible (reading/editing views are separate DOMs)
    const IO = getOwnerWindow(slideshowEl).IntersectionObserver;
    let wasHidden = false;
    const visibilityObserver = new IO(
      (entries) => {
        if (!entries[0]?.isIntersecting) {
          wasHidden = true;
        } else if (wasHidden) {
          wasHidden = false;
          reset();
        }
      },
      { threshold: 0 }
    );
    visibilityObserver.observe(slideshowEl);
    signal.addEventListener('abort', () => visibilityObserver.disconnect(), {
      once: true,
    });

    // Auto-advance if first image fails to load (skip animation for instant display)
    const expectedFirstUrl = imageUrls[0];
    currentImg.addEventListener(
      'error',
      (e) => {
        if (signal.aborted || !cardEl.isConnected) return;
        // Only handle errors for the URL we set (ignore cleared src or changed URL)
        const targetSrc = (e.target as HTMLImageElement).src;
        if (targetSrc !== expectedFirstUrl) return;
        markImageBroken(expectedFirstUrl);
        currentImg.addClass('dynamic-views-hidden');
        navigate(1, false, true);
      },
      { once: true, signal }
    );

    // Multi-image indicator
    if (isSlideshowIndicatorEnabled()) {
      const indicator = slideshowEl.createDiv('slideshow-indicator');
      setIcon(indicator, 'lucide-copy');
    }

    // Navigation arrows
    const leftArrow = slideshowEl.createDiv('slideshow-nav-left');
    setIcon(leftArrow, 'lucide-chevron-left');

    const rightArrow = slideshowEl.createDiv('slideshow-nav-right');
    setIcon(rightArrow, 'lucide-chevron-right');

    leftArrow.addEventListener(
      'click',
      (e) => {
        e.stopPropagation();
        navigate(-1);
      },
      { signal }
    );

    rightArrow.addEventListener(
      'click',
      (e) => {
        e.stopPropagation();
        navigate(1);
      },
      { signal }
    );

    // Setup swipe gestures
    setupSwipeGestures(slideshowEl, navigate, signal);
  }

  /**
   * Renders image (cover or thumbnail) with all necessary handlers
   */
  private renderImage(
    imageEl: HTMLElement,
    imageUrls: string[],
    format: 'thumbnail' | 'cover',
    position: 'left' | 'right' | 'top' | 'bottom',
    settings: BasesResolvedSettings,
    cardEl: HTMLElement,
    signal?: AbortSignal
  ): void {
    const imageEmbedContainer = imageEl.createDiv('dynamic-views-image-embed');

    // Add zoom handler with cleanup via AbortController
    imageEmbedContainer.addEventListener(
      'click',
      (e) => {
        handleImageViewerTrigger(
          e,
          cardEl.getAttribute('data-path') || '',
          this.app,
          this.viewerCleanupFns,
          this.viewerClones,
          settings.openFileAction
        );
      },
      signal ? { signal } : undefined
    );

    const imgEl = imageEmbedContainer.createEl('img', {
      attr: { src: imageUrls[0], alt: '' },
    });

    // Handle image load for masonry layout
    // Only pass layout callback for covers (thumbnails have fixed CSS height)
    if (cardEl) {
      setupImageLoadHandler(
        imgEl,
        cardEl,
        format === 'cover' ? this.imageLayoutCallback : undefined
      );
    }

    // Scrubbable array declared here so tryNextImage can splice broken URLs.
    // null when scrubbing not active (cover format, mobile, disabled).
    const scrubbableUrls =
      format === 'thumbnail' &&
      imageUrls.length > 1 &&
      !this.app.isMobile &&
      !isThumbnailScrubbingDisabled()
        ? imageUrls.slice(0, 10)
        : null;

    // Fallback to next valid image if current fails (for multi-image cards)
    if (imageUrls.length > 1) {
      // Non-scrubbing fallback uses sequential index (covers, disabled scrubbing)
      let currentUrlIndex = 0;
      const tryNextImage = () => {
        if (signal?.aborted) return;
        imgEl.removeClass('scrub-loading');
        const failedSrc = imgEl.src;
        markImageBroken(failedSrc);
        if (scrubbableUrls) {
          const idx = scrubbableUrls.indexOf(failedSrc);
          if (idx !== -1) scrubbableUrls.splice(idx, 1);
          if (scrubbableUrls.length <= 1) {
            imageEl.classList.remove('multi-image');
          }
          // Show first remaining valid image
          if (scrubbableUrls.length > 0) {
            if (signal?.aborted || !imgEl.isConnected) return;
            imgEl.removeClass('dynamic-views-hidden');
            imgEl.src = getCachedBlobUrl(scrubbableUrls[0]);
            return;
          }
        } else {
          // Sequential fallback for covers / disabled scrubbing
          currentUrlIndex++;
          if (currentUrlIndex < imageUrls.length) {
            if (signal?.aborted || !imgEl.isConnected) return;
            imgEl.removeClass('dynamic-views-hidden');
            imgEl.src = getCachedBlobUrl(imageUrls[currentUrlIndex]);
            return;
          }
        }
        // All images failed
        if (signal?.aborted) return;
        getOwnerWindow(cardEl).requestAnimationFrame(() => {
          if (signal?.aborted || !cardEl.isConnected) return;
          getOwnerWindow(cardEl).requestAnimationFrame(() => {
            if (signal?.aborted || !cardEl.isConnected) return;
            handleAllImagesFailed(cardEl);
            if (!cardEl.classList.contains('image-ready')) {
              cardEl.classList.add('image-ready');
              cardEl.style.setProperty(
                '--actual-aspect-ratio',
                DEFAULT_ASPECT_RATIO.toString()
              );
              if (format === 'cover') this.imageLayoutCallback();
            }
          });
        });
      };
      imgEl.addEventListener(
        'error',
        tryNextImage,
        signal ? { signal } : undefined
      );
    }

    // Thumbnail scrubbing (desktop only, max 10 images)
    if (scrubbableUrls) {
      imageEl.classList.add('multi-image');

      // Preload on hover — splice broken URLs from scrubbable array immediately
      if (signal) {
        setupImagePreload(
          cardEl,
          scrubbableUrls,
          signal,
          createPreloadBrokenHandler(scrubbableUrls, cardEl, () => {
            imageEl.classList.remove('multi-image');
          })
        );
      }

      // Cache bounding rect on mouseenter to avoid layout thrashing on every mousemove
      // Closure and DOMRect freed when event listeners are removed via { signal }
      let cachedRect: DOMRect | null = null;
      imageEl.addEventListener(
        'mouseenter',
        () => {
          cachedRect = imageEl.getBoundingClientRect();
          imageEl.classList.add('scrub-hover');
        },
        { signal }
      );

      imageEl.addEventListener(
        'mousemove',
        (e) => {
          if (signal?.aborted || scrubbableUrls.length === 0) return;
          // Use cached rect, or cache on first mousemove if mouseenter didn't fire
          const rect = (cachedRect ??= imageEl.getBoundingClientRect());
          const x = e.clientX - rect.left;
          const index = Math.max(
            0,
            Math.min(
              Math.floor((x / rect.width) * scrubbableUrls.length),
              scrubbableUrls.length - 1
            )
          );
          const rawUrl = scrubbableUrls[index];
          const resolvedUrl = getCachedBlobUrl(rawUrl);
          if (resolvedUrl === rawUrl && rawUrl.startsWith('http')) {
            // Uncached external — hide img so placeholder background shows
            if (imgEl.src !== resolvedUrl) {
              imgEl.addClass('scrub-loading');
              imgEl.src = resolvedUrl;
              imgEl.addEventListener(
                'load',
                () => imgEl.removeClass('scrub-loading'),
                { once: true }
              );
            }
          } else {
            imgEl.removeClass('scrub-loading');
            imgEl.removeClass('dynamic-views-hidden');
            if (imgEl.src !== resolvedUrl) {
              imgEl.src = resolvedUrl;
            }
          }
        },
        { signal }
      );

      imageEl.addEventListener(
        'mouseleave',
        () => {
          // Don't reset while image viewer is open (overlay triggers mouseleave)
          if (this.viewerClones.has(imageEmbedContainer)) return;
          imageEl.classList.remove('scrub-hover');
          // Invalidate cached rect for next hover (handles resize)
          cachedRect = null;
          imgEl.removeClass('scrub-loading');
          const firstUrl = scrubbableUrls[0];
          if (!firstUrl) return;
          // First image is pre-validated, always show it
          imgEl.removeClass('dynamic-views-hidden');
          imgEl.src = getCachedBlobUrl(firstUrl);
        },
        { signal }
      );
    }
  }

  /** Update title text node without destroying child elements (extension suffix) */
  public updateTitleText(
    cardEl: HTMLElement,
    card: CardData,
    entry: BasesEntry,
    settings: BasesResolvedSettings
  ): void {
    const titleTextEl = cardEl.querySelector<HTMLElement>('.card-title-text');
    if (!titleTextEl) return;

    // Mirror title resolution from renderCard — strip extension when a
    // separate indicator (suffix/badge/icon) shows it. None mode keeps it.
    const showsExtSeparately = !document.body.classList.contains(
      'dynamic-views-file-type-none'
    );
    const titleProp = settings.titleProperty || '';
    const titleHasExtension =
      titleProp === 'file.name' || titleProp === 'file.fullname';
    const displayTitle =
      showsExtSeparately && titleHasExtension
        ? entry.file.basename
        : card.title;

    // Find first text node — preserves child elements (.card-title-ext-suffix)
    const textNode = Array.from(titleTextEl.childNodes).find(
      (n) => n.nodeType === Node.TEXT_NODE
    );
    if (textNode) {
      textNode.textContent = displayTitle || '';
    } else if (displayTitle) {
      titleTextEl.insertBefore(
        cardEl.ownerDocument.createTextNode(displayTitle),
        titleTextEl.firstChild
      );
    }
  }

  /**
   * Surgically update title, subtitle, properties, and text preview DOM
   * for an existing card. Callers MUST rebuild CardData via
   * basesEntryToCardData() BEFORE calling this — passing stale CardData
   * renders outdated title, subtitle, and properties with no error signal.
   */
  public updateCardContent(
    cardEl: HTMLElement,
    card: CardData,
    entry: BasesEntry,
    settings: BasesResolvedSettings
  ): void {
    this.updateTitleText(cardEl, card, entry, settings);
    this.rerenderSubtitle(cardEl, card, entry, settings);
    this.rerenderProperties(cardEl, card, entry, settings);
    initializeTitleTruncationForCards([cardEl]);
    updateTextPreviewDOM(cardEl, card.textPreview || '');
    const previewEl = cardEl.querySelector<HTMLElement>('.card-text-preview');
    if (previewEl) applyPerParagraphClamp(previewEl);
    this.updateUrlButton(cardEl, card);
  }

  /** Compare old/new CardData image URLs to detect image changes */
  static hasImageChanged(
    oldCard: CardData | undefined,
    newCard: CardData
  ): boolean {
    const oldUrl = oldCard?.imageUrl;
    const newUrl = newCard.imageUrl;
    if (!oldUrl && !newUrl) return false;
    if (!oldUrl || !newUrl) return true;
    const oldArr = Array.isArray(oldUrl) ? oldUrl : [oldUrl];
    const newArr = Array.isArray(newUrl) ? newUrl : [newUrl];
    if (oldArr.length !== newArr.length) return true;
    return oldArr.some((url, i) => url !== newArr[i]);
  }

  /** Surgically update URL button in card header */
  private updateUrlButton(cardEl: HTMLElement, card: CardData): void {
    const headerEl = cardEl.querySelector<HTMLElement>('.card-header');
    const existingIcon = cardEl.querySelector<HTMLAnchorElement>(
      '.card-title-url-icon'
    );

    if (card.hasValidUrl && card.urlValue) {
      if (existingIcon) {
        existingIcon.href = card.urlValue;
        existingIcon.setAttribute('aria-label', card.urlValue);
        if (/^https?:\/\//i.test(card.urlValue)) {
          existingIcon.target = '_blank';
          existingIcon.rel = 'noopener noreferrer';
        } else {
          existingIcon.removeAttribute('target');
          existingIcon.removeAttribute('rel');
        }
        const dragText = existingIcon.querySelector('.dynamic-views-drag-text');
        if (dragText) dragText.textContent = card.urlValue;
        existingIcon.dataset.dvUrlValue = card.urlValue;
      } else if (headerEl) {
        this.urlButtonRerenderController.get(cardEl)?.abort();
        const urlButtonAbort = new AbortController();
        this.urlButtonRerenderController.set(cardEl, urlButtonAbort);
        const { signal } = urlButtonAbort;
        const iconEl = headerEl.createEl('a', {
          cls: 'card-title-url-icon text-icon-button svg-icon',
          href: card.urlValue,
        });
        iconEl.setAttribute('aria-label', card.urlValue);
        if (/^https?:\/\//i.test(card.urlValue)) {
          iconEl.target = '_blank';
          iconEl.rel = 'noopener noreferrer';
        }
        setIcon(iconEl, 'arrow-up-right');
        const dragText = iconEl.createSpan('dynamic-views-drag-text');
        dragText.textContent = card.urlValue;
        // Store for freshness — contextmenu handler reads from dataset
        iconEl.dataset.dvUrlValue = card.urlValue;

        iconEl.addEventListener(
          'click',
          (e) => {
            e.stopPropagation();
            iconEl.ownerDocument.body.querySelector('.tooltip')?.remove();
          },
          { signal }
        );
        iconEl.addEventListener(
          'contextmenu',
          (e) => {
            showExternalLinkContextMenu(
              e,
              (iconEl.dataset.dvUrlValue ?? card.urlValue) as string
            );
          },
          { signal }
        );
        const urlDrag = createUrlButtonDragHandlers(iconEl, card.urlValue);
        iconEl.addEventListener('dragstart', urlDrag.onDragStart, { signal });
        iconEl.addEventListener('dragend', urlDrag.onDragEnd, { signal });
        iconEl.addEventListener('touchstart', urlDrag.onTouchStart, {
          signal,
          passive: true,
        });
      }
    } else if (existingIcon) {
      this.urlButtonRerenderController.get(cardEl)?.abort();
      this.urlButtonRerenderController.delete(cardEl);
      existingIcon.remove();
    }
  }

  /**
   * Surgically replace property DOM within an existing card.
   * Used by property-reorder fast path to avoid full card re-render.
   */
  public rerenderProperties(
    cardEl: HTMLElement,
    card: CardData,
    entry: BasesEntry,
    settings: BasesResolvedSettings
  ): void {
    const bodyEl = cardEl.querySelector<HTMLElement>('.card-body');
    if (!bodyEl) return;

    // Remove old property containers
    for (const el of bodyEl.querySelectorAll(
      '.card-properties-top, .card-properties-bottom'
    )) {
      el.remove();
    }

    // Abort previous property controller, create fresh signal
    this.propertyRerenderController.get(cardEl)?.abort();
    const propAbort = new AbortController();
    this.propertyRerenderController.set(cardEl, propAbort);

    // Re-render properties (appends new containers at end of bodyEl;
    // internally calls measurePropertyFieldsForCard + setupScrollGradients)
    this.renderProperties(bodyEl, card, entry, settings, propAbort.signal);

    // Fix DOM order: card-properties-top must be BEFORE card-previews
    // (renderProperties appends both containers at end of bodyEl)
    const previewsEl = bodyEl.querySelector('.card-previews');
    const topEl = bodyEl.querySelector('.card-properties-top');
    if (previewsEl && topEl) {
      bodyEl.insertBefore(topEl, previewsEl);
    }
  }

  /**
   * Surgically replace subtitle DOM within an existing card.
   * Handles three transitions: subtitle appeared, disappeared, or changed value.
   */
  public rerenderSubtitle(
    cardEl: HTMLElement,
    card: CardData,
    entry: BasesEntry,
    settings: BasesResolvedSettings
  ): void {
    const subtitleEl = cardEl.querySelector<HTMLElement>('.card-subtitle');
    const hasSubtitle = !!(settings.subtitleProperty && card.subtitle);

    // Subtitle disappeared: remove stale element and abort its controller
    if (subtitleEl && !hasSubtitle) {
      this.subtitleRerenderController.get(cardEl)?.abort();
      this.subtitleRerenderController.delete(cardEl);
      subtitleEl.remove();
      return;
    }

    // No subtitle before or after: nothing to do
    if (!hasSubtitle) return;

    // Subtitle appeared: create element inside .card-title-block
    let targetEl = subtitleEl;
    if (!targetEl) {
      const titleBlock = cardEl.querySelector<HTMLElement>('.card-title-block');
      if (!titleBlock) return;
      targetEl = titleBlock.createDiv('card-subtitle');
      targetEl.tabIndex = -1;
    } else {
      // Subtitle changed: clear old content
      targetEl.empty();
    }

    // Abort previous subtitle controller, create fresh signal
    this.subtitleRerenderController.get(cardEl)?.abort();
    const propAbort = new AbortController();
    this.subtitleRerenderController.set(cardEl, propAbort);

    this.renderPropertyContent(
      targetEl,
      settings.subtitleProperty,
      card.subtitle,
      card,
      entry,
      { ...settings, propertyLabels: 'hide' },
      shouldHideMissingProperties(),
      getHideEmptyMode(),
      propAbort.signal
    );

    // Restore scroll gradients on subtitle
    if (
      document.body.classList.contains('dynamic-views-subtitle-overflow-scroll')
    ) {
      setupElementScrollGradient(targetEl, propAbort.signal);
    }
    const wrapper = targetEl.querySelector<HTMLElement>(
      '.property-content-wrapper'
    );
    if (wrapper) {
      setupElementScrollGradient(wrapper, propAbort.signal);
    }
  }

  /**
   * Renders property fields for a card using dynamic property array
   */
  private renderProperties(
    cardEl: HTMLElement,
    card: CardData,
    entry: BasesEntry,
    settings: BasesResolvedSettings,
    signal: AbortSignal
  ): void {
    const props = card.properties;
    if (!props || props.length === 0) return;

    // Parse override lists for O(1) lookup
    const invertPairingSet = parsePropertyList(settings.invertPropertyPairing);

    // Properties rendered elsewhere — exclude from property rows
    const excludeSet = new Set<string>();
    if (settings.textPreviewProperty)
      excludeSet.add(settings.textPreviewProperty);
    if (settings.urlProperty) excludeSet.add(settings.urlProperty);
    if (settings.imageProperty) excludeSet.add(settings.imageProperty);

    // Pre-compute hide settings (needed before pairing to exclude collapsed)
    const hideMissing = shouldHideMissingProperties();
    const hideEmptyMode = getHideEmptyMode();

    // Find text preview property position in the original property list (before filtering)
    // Used for position-based top/bottom split
    const textPreviewIndex = settings.textPreviewProperty
      ? props.findIndex((p) => p.name === settings.textPreviewProperty)
      : -1;

    // Pre-filter: exclude collapsed, excluded, and padding properties
    const visibleProps: Array<{
      name: string;
      value: unknown;
      fieldIndex: number;
      originalIndex: number;
    }> = [];
    for (let idx = 0; idx < props.length; idx++) {
      const prop = props[idx];
      // Empty-name properties are padding slots — exclude them
      if (!prop.name) continue;
      // Skip properties rendered elsewhere (text preview, URL button)
      if (excludeSet.has(prop.name)) continue;
      const stringValue = typeof prop.value === 'string' ? prop.value : null;
      if (
        shouldCollapseField(
          stringValue,
          prop.name,
          hideMissing,
          hideEmptyMode,
          settings.propertyLabels
        )
      ) {
        continue;
      }
      visibleProps.push({ ...prop, fieldIndex: idx + 1, originalIndex: idx }); // fieldIndex is 1-based
    }

    // Group visible properties into sets using pairing algorithm
    const sets: Array<{
      items: Array<{
        name: string;
        value: unknown;
        fieldIndex: number;
        originalIndex: number;
      }>;
      paired: boolean;
    }> = [];

    // Pre-compute pairs when pairProperties OFF
    const invertPairs = settings.pairProperties
      ? null
      : computeInvertPairs(props, invertPairingSet);

    let i = 0;
    while (i < visibleProps.length) {
      const current = visibleProps[i];
      const next = i + 1 < visibleProps.length ? visibleProps[i + 1] : null;

      let shouldPair = false;
      if (settings.pairProperties) {
        // ON: pair unless either inverted
        shouldPair =
          next !== null &&
          !invertPairingSet.has(current.name) &&
          !invertPairingSet.has(next.name);
      } else if (invertPairs) {
        // OFF: check pre-computed pairs (uses original indices)
        shouldPair =
          next !== null &&
          invertPairs.get(current.fieldIndex - 1) === next.fieldIndex - 1;
      }

      if (shouldPair && next) {
        sets.push({
          items: [current, next],
          paired: true,
        });
        i += 2;
      } else {
        sets.push({
          items: [current],
          paired: false,
        });
        i += 1;
      }
    }

    // Position-based split: properties before textPreviewProperty → top, rest → bottom
    const topSets: typeof sets = [];
    const bottomSets: typeof sets = [];

    for (const set of sets) {
      // When textPreviewProperty is selected, properties appearing before it in the
      // property picker order go above the text preview, the rest go below
      const isTop =
        textPreviewIndex >= 0 &&
        set.items.every((item) => item.originalIndex < textPreviewIndex);
      (isTop ? topSets : bottomSets).push(set);
    }

    if (topSets.length === 0 && bottomSets.length === 0) return;

    // Create containers as needed
    const topPropertiesEl =
      topSets.length > 0
        ? cardEl.createDiv('card-properties card-properties-top')
        : null;
    const bottomPropertiesEl =
      bottomSets.length > 0
        ? cardEl.createDiv('card-properties card-properties-bottom')
        : null;

    // Helper to check if element has rendered content
    const hasRenderedContent = (el: HTMLElement): boolean =>
      el.children.length > 0 || (el.textContent?.trim().length ?? 0) > 0;

    // Helper to handle empty field (collapse or show marker)
    const handleEmptyField = (
      fieldEl: HTMLElement,
      propName: string,
      propValue: unknown
    ): void => {
      if (propName) {
        const stringValue = typeof propValue === 'string' ? propValue : null;
        if (
          shouldCollapseField(
            stringValue,
            propName,
            hideMissing,
            hideEmptyMode,
            settings.propertyLabels
          )
        ) {
          fieldEl.addClass('property-collapsed');
          fieldEl
            .closest('.property-pair')
            ?.classList.add('pair-has-collapsed');
        } else {
          const placeholderContent = fieldEl.createDiv('property-content');
          const markerSpan =
            placeholderContent.createSpan('empty-value-marker');
          markerSpan.textContent = getEmptyValueMarker();
        }
      } else if (settings.propertyLabels === 'hide') {
        fieldEl.addClass('property-collapsed');
        fieldEl.closest('.property-pair')?.classList.add('pair-has-collapsed');
      }
    };

    // Render sets into their containers
    // Returns pair count for offset tracking across top/bottom
    const renderSetsInto = (
      container: HTMLElement,
      setsToRender: typeof sets,
      pairIndexOffset: number
    ): number => {
      let pairNum = pairIndexOffset;

      for (const set of setsToRender) {
        if (set.paired) {
          // Paired: create wrapper
          pairNum++;
          const pairEl = container.createDiv(
            `property-pair property-pair-${pairNum}`
          );
          if (!container.classList.contains('has-pairs')) {
            container.classList.add('has-pairs');
          }

          const fieldEls: HTMLElement[] = [];
          const hasContent: boolean[] = [];

          for (let i = 0; i < set.items.length; i++) {
            const item = set.items[i];
            const posClass = i === 0 ? 'pair-left' : 'pair-right';
            const fieldEl = pairEl.createDiv(
              `property property-${item.fieldIndex} ${posClass}`
            );
            fieldEls.push(fieldEl);

            if (item.name) {
              this.renderPropertyContent(
                fieldEl,
                item.name,
                item.value,
                card,
                entry,
                settings,
                hideMissing,
                hideEmptyMode,
                signal
              );
            }
            hasContent.push(hasRenderedContent(fieldEl));
          }

          // Handle empty fields in pair
          if (!hasContent[0] && !hasContent[1]) {
            pairEl.remove();
          } else if (hasContent[0] && !hasContent[1]) {
            handleEmptyField(
              fieldEls[1],
              set.items[1].name,
              set.items[1].value
            );
          } else if (!hasContent[0] && hasContent[1]) {
            handleEmptyField(
              fieldEls[0],
              set.items[0].name,
              set.items[0].value
            );
          }
        } else {
          // Unpaired: direct child, no wrapper
          const item = set.items[0];
          const fieldEl = container.createDiv(
            `property property-${item.fieldIndex}`
          );

          if (item.name) {
            this.renderPropertyContent(
              fieldEl,
              item.name,
              item.value,
              card,
              entry,
              settings,
              hideMissing,
              hideEmptyMode,
              signal
            );
          }

          // Handle empty unpaired field
          if (!hasRenderedContent(fieldEl)) {
            fieldEl.remove();
          }
        }
      }

      return pairNum;
    };

    if (topPropertiesEl && topSets.length > 0) {
      const topPairCount = renderSetsInto(topPropertiesEl, topSets, 0);
      if (bottomPropertiesEl && bottomSets.length > 0) {
        renderSetsInto(bottomPropertiesEl, bottomSets, topPairCount);
      }
    } else if (bottomPropertiesEl && bottomSets.length > 0) {
      renderSetsInto(bottomPropertiesEl, bottomSets, 0);
    }

    // Remove empty property containers
    if (topPropertiesEl && topPropertiesEl.children.length === 0) {
      topPropertiesEl.remove();
    }
    if (bottomPropertiesEl && bottomPropertiesEl.children.length === 0) {
      bottomPropertiesEl.remove();
    }

    // If any properties remain, setup measurements and gradients
    if (
      (topPropertiesEl && topPropertiesEl.children.length > 0) ||
      (bottomPropertiesEl && bottomPropertiesEl.children.length > 0)
    ) {
      // Measure paired field widths
      this.measurePropertyFieldsForCard(cardEl);
      // Setup scroll gradients for tags and paths
      setupScrollGradients(cardEl, updateScrollGradient, signal);
    }
  }

  /**
   * Renders individual property content
   */
  private renderPropertyContent(
    container: HTMLElement,
    propertyName: string,
    resolvedValue: unknown,
    card: CardData,
    entry: BasesEntry,
    settings: BasesResolvedSettings,
    hideMissing: boolean,
    hideEmptyMode: HideEmptyMode,
    signal: AbortSignal
  ): void {
    if (propertyName === '') {
      return;
    }

    // Coerce unknown to string for rendering (handles Bases Value objects)
    const stringValue =
      typeof resolvedValue === 'string' ? resolvedValue : null;

    // Hide missing properties if toggle enabled (stringValue is null for missing properties)
    // File/formula/tag properties can never be "missing" - they always exist or are computed
    if (
      stringValue === null &&
      hideMissing &&
      !isFileProperty(propertyName) &&
      !isFormulaProperty(propertyName) &&
      !isTagProperty(propertyName)
    ) {
      return;
    }

    // Check if this is an empty property that should be hidden based on dropdown mode
    // Empty = no displayable value (null, undefined, or empty string)
    const isEmpty = !stringValue;
    if (isEmpty) {
      if (hideEmptyMode === 'all') return;
      if (
        hideEmptyMode === 'labels-hidden' &&
        settings.propertyLabels === 'hide'
      )
        return;
    }

    // Render label if property labels are enabled
    if (settings.propertyLabels === 'above') {
      const labelEl = container.createDiv('property-label');
      labelEl.textContent = getPropertyLabel(
        propertyName,
        settings._displayNameMap
      );
      container.addClass('has-label');
    }

    // Add inline label if enabled (as sibling, before property-content)
    if (settings.propertyLabels === 'inline') {
      const labelSpan = container.createSpan('property-label-inline');
      labelSpan.textContent =
        getPropertyLabel(propertyName, settings._displayNameMap) + ' ';
      container.addClass('has-label-inline');
    }

    // Wrapper for scrolling content (gradients applied here)
    // tabIndex -1 prevents scrollable div from being in Tab order
    const contentWrapper = container.createDiv('property-content-wrapper');
    contentWrapper.tabIndex = -1;

    // Content container (actual property value)
    const propertyContent = contentWrapper.createDiv('property-content');

    // If no value, show placeholder
    if (!stringValue) {
      const markerSpan = propertyContent.createSpan('empty-value-marker');
      markerSpan.textContent = getEmptyValueMarker();
      return;
    }

    // Handle array properties - render as individual spans with separators
    if (stringValue.startsWith('{"type":"array","items":[')) {
      try {
        const arrayData = JSON.parse(stringValue) as {
          type: string;
          items: string[];
        };
        if (arrayData.type === 'array' && Array.isArray(arrayData.items)) {
          // Filter out empty strings to avoid rendering separators between invisible items
          const nonEmptyItems = arrayData.items.filter(
            (item) => item.trim().length > 0
          );
          if (nonEmptyItems.length === 0) return;
          const listWrapper = propertyContent.createSpan('list-wrapper');
          const separator = getListSeparator();
          nonEmptyItems.forEach((item, idx) => {
            const span = listWrapper.createSpan();
            const listItem = span.createSpan({ cls: 'list-item' });
            this.renderTextWithLinks(listItem, item, card.path, signal);
            if (idx < nonEmptyItems.length - 1) {
              span.createSpan({ cls: 'list-separator', text: separator });
            }
          });
          return;
        }
      } catch {
        // Fall through to regular text rendering if JSON parse fails
      }
    }

    // Handle checkbox properties - render as native Obsidian checkbox
    if (stringValue.startsWith(CHECKBOX_MARKER_PREFIX)) {
      try {
        const checkboxData = JSON.parse(stringValue) as {
          type: string;
          checked?: boolean;
          indeterminate?: boolean;
        };
        if (checkboxData.type === 'checkbox') {
          const checkboxEl = propertyContent.createEl('input', {
            cls: 'metadata-input-checkbox',
            type: 'checkbox',
          });
          if (checkboxData.indeterminate) {
            checkboxEl.indeterminate = true;
            checkboxEl.dataset.indeterminate = 'true';
          } else {
            checkboxEl.checked = checkboxData.checked ?? false;
            checkboxEl.dataset.indeterminate = 'false';
          }
          // Make interactive - toggle frontmatter on click
          checkboxEl.addEventListener(
            'click',
            (e) => {
              e.stopPropagation();
              const file = this.app.vault.getAbstractFileByPath(card.path);
              if (!(file instanceof TFile)) return;
              const fmProp = stripNotePrefix(propertyName);
              // Clear indeterminate state on click
              checkboxEl.indeterminate = false;
              checkboxEl.dataset.indeterminate = 'false';
              void this.app.fileManager
                .processFrontMatter(
                  file,
                  (frontmatter: Record<string, unknown>) => {
                    frontmatter[fmProp] = checkboxEl.checked;
                  }
                )
                .catch((error: unknown) => {
                  console.error(
                    'Dynamic Views: failed to update checkbox property',
                    error
                  );
                });
            },
            { signal }
          );
          return;
        }
      } catch {
        // Fall through to regular text rendering if JSON parse fails
      }
    }

    if (isTimestampProperty(propertyName, settings)) {
      // stringValue is already formatted by data-transform
      const timestampWrapper = propertyContent.createSpan();
      if (settings.propertyLabels === 'hide') {
        const iconName = getTimestampIcon(propertyName, settings);
        const iconEl = timestampWrapper.createSpan('timestamp-icon');
        setIcon(iconEl, iconName);
        timestampWrapper.classList.add('has-timestamp-icon');
      }
      timestampWrapper.appendText(stringValue);

      // One-shot: measure icon alignment from first real timestamp
      // Deferred to rAF so the browser has laid out the new elements
      if (settings.propertyLabels === 'hide' && !this.iconAlignmentMeasured) {
        const containerEl =
          timestampWrapper.closest<HTMLElement>('.dynamic-views');
        if (containerEl) {
          this.iconAlignmentMeasured = true;
          getOwnerWindow(containerEl).requestAnimationFrame(() =>
            applyIconOpticalOffset(containerEl)
          );
        }
      }
    } else if (
      (propertyName === 'tags' || propertyName === 'note.tags') &&
      card.yamlTags.length > 0
    ) {
      // YAML tags only
      const showHashPrefix = showTagHashPrefix();
      const tagsWrapper = propertyContent.createDiv('tags-wrapper');
      card.yamlTags.forEach((tag) => {
        const tagEl = tagsWrapper.createEl('a', {
          cls: 'tag',
          text: showHashPrefix ? '#' + tag : tag,
          href: '#',
        });
        tagEl.draggable = true;
        tagEl.tabIndex = -1;
        tagEl.addEventListener(
          'dragstart',
          createTagDragHandler(this.app, tag),
          { signal }
        );
        tagEl.addEventListener(
          'click',
          (e) => {
            e.preventDefault();
            if (
              shouldUseNotebookNavigator(this.app, 'tag') &&
              navigateToTagInNotebookNavigator(this.app, tag)
            ) {
              return;
            }
            const searchPlugin =
              this.plugin.app.internalPlugins.plugins['global-search'];
            if (searchPlugin?.instance?.openGlobalSearch) {
              searchPlugin.instance.openGlobalSearch('tag:' + tag);
            }
          },
          { signal }
        );
      });
    } else if (
      (propertyName === 'file.tags' || propertyName === 'file tags') &&
      card.tags.length > 0
    ) {
      // tags in YAML + note body
      const showHashPrefix = showTagHashPrefix();
      const tagsWrapper = propertyContent.createDiv('tags-wrapper');
      card.tags.forEach((tag) => {
        const tagEl = tagsWrapper.createEl('a', {
          cls: 'tag',
          text: showHashPrefix ? '#' + tag : tag,
          href: '#',
        });
        tagEl.draggable = true;
        tagEl.tabIndex = -1;
        tagEl.addEventListener(
          'dragstart',
          createTagDragHandler(this.app, tag),
          { signal }
        );
        tagEl.addEventListener(
          'click',
          (e) => {
            e.preventDefault();
            if (
              shouldUseNotebookNavigator(this.app, 'tag') &&
              navigateToTagInNotebookNavigator(this.app, tag)
            ) {
              return;
            }
            const searchPlugin =
              this.plugin.app.internalPlugins.plugins['global-search'];
            if (searchPlugin?.instance?.openGlobalSearch) {
              searchPlugin.instance.openGlobalSearch('tag:' + tag);
            }
          },
          { signal }
        );
      });
    } else if (
      (propertyName === 'file.path' ||
        propertyName === 'path' ||
        propertyName === 'file path') &&
      card.path.length > 0
    ) {
      const pathWrapper = propertyContent.createDiv('path-wrapper');
      // Split full path including filename
      const segments = card.path.split('/').filter((f) => f);
      segments.forEach((segment, idx) => {
        const span = pathWrapper.createSpan();
        const isLastSegment = idx === segments.length - 1;
        const segmentClass = isLastSegment
          ? 'path-segment filename-segment'
          : 'path-segment folder-segment';
        const segmentEl = span.createSpan({ cls: segmentClass, text: segment });

        // Make clickable
        const cumulativePath = segments.slice(0, idx + 1).join('/');
        segmentEl.addEventListener(
          'click',
          (e) => {
            e.stopPropagation();
            if (isLastSegment) {
              // Filename segment - reveal file
              if (shouldUseNotebookNavigator(this.app, 'file')) {
                const file = this.app.vault.getAbstractFileByPath(card.path);
                if (
                  file instanceof TFile &&
                  revealFileInNotebookNavigator(this.app, file)
                ) {
                  return;
                }
              }
            } else {
              // Folder segment - navigate to folder
              if (shouldUseNotebookNavigator(this.app, 'folder')) {
                const folder =
                  this.app.vault.getAbstractFileByPath(cumulativePath);
                if (
                  folder instanceof TFolder &&
                  navigateToFolderInNotebookNavigator(this.app, folder)
                ) {
                  return;
                }
              }
            }
            // Fallback to file explorer
            const pathToReveal = isLastSegment ? card.path : cumulativePath;
            const fileExplorer =
              this.app.internalPlugins?.plugins?.['file-explorer'];
            if (fileExplorer?.instance?.revealInFolder) {
              const target = this.app.vault.getAbstractFileByPath(pathToReveal);
              if (target) {
                fileExplorer.instance.revealInFolder(target);
              }
            }
          },
          { signal }
        );

        // Add context menu for all segments
        segmentEl.addEventListener(
          'contextmenu',
          (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (isLastSegment) {
              // Filename segment - show file context menu
              const file = this.app.vault.getAbstractFileByPath(card.path);
              if (file instanceof TFile) {
                showFileContextMenu(e, this.app, file, card.path);
              }
            } else {
              // Folder segment - show folder context menu
              const folderFile =
                this.app.vault.getAbstractFileByPath(cumulativePath);
              if (folderFile instanceof TFolder) {
                const menu = new Menu();
                this.app.workspace.trigger(
                  'file-menu',
                  menu,
                  folderFile,
                  'file-explorer'
                );
                menu.showAtMouseEvent(e);
              }
            }
          },
          { signal }
        );

        if (idx < segments.length - 1) {
          span.createSpan({ cls: 'path-separator', text: '/' });
        }
      });
    } else if (
      (propertyName === 'file.folder' || propertyName === 'folder') &&
      card.folderPath.length > 0
    ) {
      const folderWrapper = propertyContent.createDiv('path-wrapper');
      // Split folder path into segments
      const folders = card.folderPath.split('/').filter((f) => f);
      folders.forEach((folder, idx) => {
        const span = folderWrapper.createSpan();
        const segmentEl = span.createSpan({
          cls: 'path-segment folder-segment',
          text: folder,
        });

        // Make clickable - reveal folder in file explorer
        const cumulativePath = folders.slice(0, idx + 1).join('/');
        segmentEl.addEventListener(
          'click',
          (e) => {
            e.stopPropagation();
            if (shouldUseNotebookNavigator(this.app, 'folder')) {
              const folderObj =
                this.app.vault.getAbstractFileByPath(cumulativePath);
              if (
                folderObj instanceof TFolder &&
                navigateToFolderInNotebookNavigator(this.app, folderObj)
              ) {
                return;
              }
            }
            // Fallback to file explorer
            const fileExplorer =
              this.app.internalPlugins?.plugins?.['file-explorer'];
            if (fileExplorer?.instance?.revealInFolder) {
              const folderFile =
                this.app.vault.getAbstractFileByPath(cumulativePath);
              if (folderFile) {
                fileExplorer.instance.revealInFolder(folderFile);
              }
            }
          },
          { signal }
        );

        // Add context menu for folder segments
        segmentEl.addEventListener(
          'contextmenu',
          (e) => {
            e.stopPropagation();
            e.preventDefault();
            const folderFile =
              this.app.vault.getAbstractFileByPath(cumulativePath);
            if (folderFile instanceof TFolder) {
              const menu = new Menu();
              this.app.workspace.trigger(
                'file-menu',
                menu,
                folderFile,
                'file-explorer'
              );
              menu.showAtMouseEvent(e);
            }
          },
          { signal }
        );

        if (idx < folders.length - 1) {
          span.createSpan({ cls: 'path-separator', text: '/' });
        }
      });
    } else {
      // Generic property - wrap in div for proper scrolling (consistent with tags/paths)
      const textWrapper = propertyContent.createDiv('text-wrapper');
      this.renderTextWithLinks(textWrapper, stringValue, card.path, signal);
    }

    // Remove propertyContent wrapper if it ended up empty (e.g., tags with no values)
    if (
      !propertyContent.textContent ||
      propertyContent.textContent.trim().length === 0
    ) {
      propertyContent.remove();
    }
  }

  /**
   * Measures property fields for paired layout (delegates to shared utility)
   */
  private measurePropertyFieldsForCard(container: HTMLElement): void {
    const observers = measurePropertyFields(container);
    this.propertyObservers.push(...observers);
  }
}
