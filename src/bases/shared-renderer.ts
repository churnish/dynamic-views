/**
 * Shared Card Renderer for Bases Views
 * Consolidates duplicate card rendering logic from Grid and Masonry
 */

/** Hover parent type — Obsidian stores the active HoverPopover here and auto-dismisses on replacement. */
type HoverParent = { hoverPopover: { unload(): void } | null };

import {
  App,
  TFile,
  TFolder,
  setIcon,
  BasesEntry,
  Platform,
  Scope,
  Menu,
  Keymap,
} from 'obsidian';
import type { BasesViewConfig } from 'obsidian';
import { CardData, type CardHandle } from '../core/card-data';
import {
  setTextPreviewContent,
  updateTextPreviewDOM,
  applyPerParagraphClamp,
} from '../core/text-preview-dom';
import {
  setupImageLoadHandler,
  setupBackdropImageLoader,
  handleImageLoad,
  handleAllImagesFailed,
  setKnownAspectRatio,
  DEFAULT_ASPECT_RATIO,
  filterBrokenUrls,
  markImageBroken,
} from '../core/image-loader';
import { showFileContextMenu } from '../core/context-menu';
import {
  updateScrollGradient,
  setupScrollGradients,
  setupElementScrollGradient,
  setupVerticalScrollGradient,
} from '../core/scroll-gradient';
import {
  getTimestampIcon,
  isTimestampProperty,
  splitDateSegments,
} from '../core/render-utils';
import {
  createCardDragHandler,
  createExternalLinkDragHandler,
  createTagDragHandler,
  createUrlButtonDragHandlers,
} from '../core/drag';
import {
  showTagHashPrefix,
  clearStyleSettingsCache,
  getHideEmptyMode,
  type HideEmptyMode,
  getEmptyValueMarker,
  shouldHideMissingProperties,
  getListSeparator,
  isSlideshowEnabled,
  isSlideshowIconEnabled,
  isThumbnailScrubbingDisabled,
  isCoverScrubMode,
  getCompactBreakpoint,
} from '../utils/style-settings';
import {
  getPropertyDisplayName,
  parsePropertyList,
  stripNotePrefix,
} from '../core/property-display';
import { findLinksInText, type ParsedLink } from '../utils/link-parser';
import {
  handleImageViewerTrigger,
  cleanupAllViewers,
  setViewerImageSet,
} from '../core/image-viewer';
import { applyIconOpticalOffset } from '../core/icon-alignment';
import { getFileExtInfo, getFileTypeIcon } from '../utils/file-extension';
import type DynamicViews from '../../main';
import type { ResolvedSettings, LayoutSource } from '../types';
import {
  cancelHoverZoom,
  createPreloadBrokenHandler,
  createSlideshowNavigator,
  getCachedBlobUrl,
  setupHoverZoomEligibility,
  setupImagePreload,
  setupSwipeGestures,
} from '../core/slideshow';
import {
  canHover,
  canPrimaryHover,
  deferContainerHoverDrop,
  isHoverPointer,
  markContainerHoverCard,
  setupHoverIntent,
  setupTouchPress,
} from '../core/hover-and-touch';
import {
  setupTouchSwipeNavigation,
  observeScrubReset,
  unobserveScrubReset,
  computeScrubIndex,
  applyScrubImage,
} from '../core/multi-image-nav';
import {
  handleArrowNavigation,
  isArrowKey,
  isImageViewerBlockingNav,
  type VirtualCardRect,
} from '../core/keyboard-nav';
import {
  CHECKBOX_MARKER_PREFIX,
  CONTEXT_MENU_SUPPRESS_MS,
  MAX_MULTI_IMAGES,
  PHONE_CARD_GAP,
  THUMBNAIL_STACK_MULTIPLIER,
  TOUCH_TAP_THRESHOLD_MS,
  URL_ICON_SELECTOR,
  VISIBLE_BODY_SELECTOR,
} from '../core/constants';
import {
  shouldUseNotebookNavigator,
  navigateToTagInNotebookNavigator,
  navigateToFolderInNotebookNavigator,
  revealFileInNotebookNavigator,
} from '../core/notebook-navigator';
import {
  measurePropertyFields,
  remeasureCardPairs,
} from '../core/property-measure';
import { CONTENT_HIDDEN_CLASS } from '../core/content-visibility';
import {
  isTagProperty,
  isFileProperty,
  isFormulaProperty,
  shouldCollapseField,
  computeInvertPairs,
  queueCompactStackedCheck,
  cancelCompactStackedCheck,
  invalidateCompactStackedCache,
} from '../core/property-helpers';
import { getOwnerWindow } from '../utils/owner-window';
import {
  clipPosterStaticOverflow,
  clipPosterStaticOverflowBatch,
  handlePosterTapReveal,
  resetPosterClipping,
  resetPosterScroll,
} from '../core/poster';

type InkRect = { left: number; top: number; right: number; bottom: number };

/** Measure per-line bounding rects of visible text and inline elements inside a title link. */
function measureTitleInkRects(link: HTMLElement): InkRect[] {
  const ownerDoc = link.ownerDocument;
  const win = getOwnerWindow(link);
  const linkRect = link.getBoundingClientRect();
  // Small tolerance for clamp boundary — text at the edge of the clamp may extend fractionally past
  const visibleBottom = linkRect.bottom + 0.5;
  const rects: InkRect[] = [];

  const pushRect = (rect: DOMRect) => {
    if (rect.width <= 0 || rect.height <= 0 || rect.bottom > visibleBottom)
      return;
    rects.push({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    });
  };

  const walker = ownerDoc.createTreeWalker(
    link,
    win.NodeFilter.SHOW_TEXT | win.NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          return node.textContent?.trim()
            ? win.NodeFilter.FILTER_ACCEPT
            : win.NodeFilter.FILTER_REJECT;
        }
        return (node as Element).matches(
          '.card-title-icon, .card-title-ext, .card-title-ext-suffix'
        )
          ? win.NodeFilter.FILTER_ACCEPT
          : win.NodeFilter.FILTER_SKIP;
      },
    }
  );

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      const range = ownerDoc.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) pushRect(rect);
    } else {
      pushRect((node as Element).getBoundingClientRect());
    }
  }

  return rects;
}

export type { CardHandle } from '../core/card-data';

const PAIRED_PROPERTY_CLASSES = [
  'dynamic-views-paired-property-left',
  'dynamic-views-paired-property-right',
  'dynamic-views-paired-property-column',
] as const;

/** Obsidian's own inset variable — the plugin's SCSS seeds it, per-view gap overrides it */
const VIEW_PADDING_VAR = '--bases-view-padding';

/** Fixed inset the view chrome is measured against; also the floor for the above */
const CHROME_INSET_VAR = '--dynamic-views-chrome-inset';

/* Mirrors the SCSS seed (--size-4-3). Only reached if the token read fails, which
   means the stylesheet has not applied — a plain length is still required here
   because overflow-clip-margin rejects calc(). */
const DEFAULT_CHROME_INSET = 12;

/** Platform-resolved card gap, for CSS that needs the value without an .is-phone branch */
/* applyViewContainerStyles writes this before first paint, so the fallbacks in
   the consuming CSS are dead paths kept only to keep the rules readable */
const CARD_GAP_VAR = '--dynamic-views-card-gap';

/**
 * Line-count and display-mode values for the view container.
 *
 * Every field is optional: an absent field skips BOTH its variable write and its
 * class toggle. That is how the CSS fast-path keeps its per-key type guards —
 * it omits keys Bases returned a non-number for instead of writing a default.
 */
interface LineAndModeValues {
  titleLines?: number;
  subtitleLines?: number;
  textPreviewLines?: number;
  imageRatio?: number;
  thumbnailSize?: number;
  posterDisplayMode?: 'fade' | 'overlay';
  imageFit?: 'crop' | 'contain';
}

/**
 * Write the container's line-count variables and display-mode classes.
 *
 * Shared by applyViewContainerStyles (values from ResolvedSettings) and
 * applyCssOnlySettings (values straight from config.get()). The poster-static
 * toggle and its clipping transitions deliberately stay in the callers — they
 * are stateful, not a plain value-to-variable mapping.
 */
function applyLineAndModeVariables(
  el: HTMLElement,
  values: LineAndModeValues
): void {
  if (values.titleLines !== undefined) {
    el.style.setProperty(
      '--dynamic-views-title-lines',
      String(values.titleLines)
    );
    el.classList.toggle('title-single-line', values.titleLines === 1);
  }

  if (values.subtitleLines !== undefined) {
    el.style.setProperty(
      '--dynamic-views-subtitle-lines',
      String(values.subtitleLines)
    );
    // Scroll mode only applies to single-line subtitles — a wrapped subtitle has
    // nothing to scroll, so the wrap rules must stay live in that state.
    // Body-class read is the sanctioned popout exception (Style Settings syncs
    // its classes to every document).
    el.classList.toggle(
      'subtitle-scroll',
      values.subtitleLines === 1 &&
        document.body.classList.contains(
          'dynamic-views-subtitle-overflow-scroll'
        )
    );
  }

  if (values.textPreviewLines !== undefined) {
    el.style.setProperty(
      '--dynamic-views-text-preview-lines',
      String(values.textPreviewLines)
    );
  }

  if (values.imageRatio !== undefined) {
    el.style.setProperty(
      '--dynamic-views-image-aspect-ratio',
      String(values.imageRatio)
    );
  }

  if (values.thumbnailSize !== undefined) {
    el.style.setProperty(
      '--dynamic-views-thumbnail-size',
      `${values.thumbnailSize}px`
    );
  }

  // Both swaps run on every onDataUpdated(), so compare before touching
  // classList — an unconditional remove+add invalidates style for every card.
  if (values.posterDisplayMode !== undefined) {
    const prevMode = readPosterDisplayMode(el);
    if (prevMode !== values.posterDisplayMode) {
      el.classList.remove('poster-mode-fade', 'poster-mode-overlay');
      el.classList.add(`poster-mode-${values.posterDisplayMode}`);
    }
  }

  if (values.imageFit !== undefined) {
    const prevFit = el.classList.contains('image-fit-contain')
      ? 'contain'
      : el.classList.contains('image-fit-crop')
        ? 'crop'
        : null;
    if (prevFit !== values.imageFit) {
      el.classList.remove('image-fit-crop', 'image-fit-contain');
      el.classList.add(`image-fit-${values.imageFit}`);
    }
  }
}

/** Append a formatted date with its separator runs wrapped for dimming */
function appendDateSegments(parent: HTMLElement, formatted: string): void {
  const wrapper = parent.createSpan('date-wrapper');
  for (const segment of splitDateSegments(formatted)) {
    if (segment.isSeparator) {
      // Runs carrying their own whitespace (`, `, or the space before AM/PM) are
      // already spaced — padding them too would double the gap.
      const cls = /\s/.test(segment.text)
        ? 'date-separator date-separator-spaced'
        : 'date-separator';
      wrapper.createSpan({ cls, text: segment.text });
    } else {
      wrapper.appendText(segment.text);
    }
  }
}

/** Current poster display mode from container classes. `null` means neither class is set yet (first call). */
function readPosterDisplayMode(el: HTMLElement): 'fade' | 'overlay' | null {
  if (el.classList.contains('poster-mode-overlay')) return 'overlay';
  if (el.classList.contains('poster-mode-fade')) return 'fade';
  return null;
}

/**
 * Apply per-view CSS classes and variables from settings to the view container
 * Replaces body-level Style Settings classes with view-scoped equivalents
 */
export function applyViewContainerStyles(
  container: HTMLElement,
  settings: ResolvedSettings
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

  // Line counts, image sizing, and display-mode classes — shared with the CSS
  // fast-path so both entry points leave the container in the same state.
  applyLineAndModeVariables(container, {
    titleLines: settings.titleLines,
    subtitleLines: settings.subtitleLines,
    textPreviewLines: settings.textPreviewLines,
    imageRatio: settings.imageRatio,
    thumbnailSize: settings.thumbnailSize,
    posterDisplayMode: settings.posterDisplayMode,
    imageFit: settings.imageFit,
  });

  // Gap feeds both the CSS `gap` rules and getCardSpacing()'s layout math, so it
  // is written once here. Compare before writing: clearing the spacing cache on
  // every render would force getStyleSettingsHash's ~13 body reads to re-run.
  const gapVar = Platform.isPhone
    ? '--dynamic-views-card-spacing-phone'
    : '--dynamic-views-card-spacing-desktop';
  const gapValue = `${Platform.isPhone ? PHONE_CARD_GAP : settings.cardGapDesktop}px`;
  if (container.style.getPropertyValue(gapVar) !== gapValue) {
    container.style.setProperty(gapVar, gapValue);
    clearStyleSettingsCache();
  }

  // Platform-resolved alias. The -desktop/-phone pair above is what the `gap`
  // declarations and getCardSpacing() read; consumers that only need the resolved
  // number use this instead of duplicating every rule behind an .is-phone variant.
  if (container.style.getPropertyValue(CARD_GAP_VAR) !== gapValue) {
    container.style.setProperty(CARD_GAP_VAR, gapValue);
  }

  // Edge inset follows the gap so spacing reads evenly from card to card and from
  // card to pane edge, but floored at the standard inset — gaps below it would
  // otherwise crowd the cards against the pane, and the gap reaches 0.
  //
  // The floor is resolved to a plain length HERE rather than written as a CSS
  // `max()`: Masonry feeds this variable to overflow-clip-margin, which accepts
  // only a plain length and rejects calc()/max() outright — computing 0 and
  // clipping the sticky group header's background at the container edge instead
  // of letting it reach the pane edge. Verified in Chromium: even calc(12px) is
  // rejected. The floor is read from the token rather than hardcoded so it stays
  // tied to --size-4-3, and the dataset guard keeps that to one computed-style
  // read per gap change rather than one per render.
  //
  // Scoped to the scroll element because --bases-view-padding lives there.
  // Skipped inside embeds: an embedded .bases-view keeps a 1px inset no matter
  // what this variable says, so writing the gap would desync it from the group
  // heading, whose width and negative margins cancel the inset by reading the
  // same variable — at gap 64 that overflowed the heading 51px on each side.
  const scrollEl = container.closest<HTMLElement>('.bases-view');
  const isEmbedded = !!container.closest('.bases-embed');
  const gapPx = Platform.isPhone ? PHONE_CARD_GAP : settings.cardGapDesktop;
  if (
    scrollEl &&
    !isEmbedded &&
    scrollEl.dataset.dynamicViewsGap !== gapValue
  ) {
    const chromeInset =
      parseFloat(
        getComputedStyle(scrollEl).getPropertyValue(CHROME_INSET_VAR)
      ) || DEFAULT_CHROME_INSET;
    scrollEl.style.setProperty(
      VIEW_PADDING_VAR,
      `${Math.max(chromeInset, gapPx)}px`
    );
    scrollEl.dataset.dynamicViewsGap = gapValue;
  }

  // Stays here rather than in applyLineAndModeVariables: the CSS fast-path pairs
  // this toggle with clip/reset transitions that have no counterpart on the
  // full-render path, where cards are rebuilt from scratch anyway.
  container.classList.toggle('poster-static', !settings.posterInteractToReveal);
}

/**
 * Release the inline --bases-view-padding override at view teardown.
 *
 * Obsidian creates .bases-view once per query controller and reuses it for
 * whatever view type replaces this one, emptying its children but keeping its
 * inline styles. Inline style outranks the per-view-type rules in app.css, so
 * leaving the override behind hands this view's gap to a native Table, List or
 * Cards view as its padding until the leaf is closed and reopened.
 *
 * The dataset guard goes with it: the element outlives the view, so a stale
 * marker would make the next view skip the write and inherit whatever padding
 * happened to be left behind.
 */
export function clearViewContainerStyles(container: HTMLElement): void {
  const scrollEl = container.closest<HTMLElement>('.bases-view');
  if (!scrollEl) return;
  scrollEl.style.removeProperty(VIEW_PADDING_VAR);
  delete scrollEl.dataset.dynamicViewsGap;
}

/**
 * Last text preview line count a clip batch ran for, per container.
 *
 * config.get() falls back to schema defaults, so `textPreviewLines` is always a
 * number — its typeof test is a shape check, not a change test, and without this
 * map the clip batch would run on every onDataUpdated().
 */
const lastClippedTextPreviewLines = new WeakMap<HTMLElement, number>();

/** Apply CSS-only settings immediately for instant feedback (bypasses throttle) */
export function applyCssOnlySettings(
  config: BasesViewConfig,
  containerEl: HTMLElement
): void {
  if (!config || !containerEl) return;

  const readNumber = (key: string): number | undefined => {
    const value = config.get(key);
    return typeof value === 'number' ? value : undefined;
  };

  const rawPosterMode = config.get('posterDisplayMode');
  const posterDisplayMode =
    rawPosterMode === 'fade' || rawPosterMode === 'overlay'
      ? rawPosterMode
      : 'fade';
  const rawImageFit = config.get('imageFit');
  const imageFit =
    rawImageFit === 'crop' || rawImageFit === 'contain' ? rawImageFit : 'crop';

  // Read before the swap — the re-clip decision below needs the outgoing mode.
  const prevMode = readPosterDisplayMode(containerEl);

  const textPreviewLines = readNumber('textPreviewLines');
  applyLineAndModeVariables(containerEl, {
    titleLines: readNumber('titleLines'),
    subtitleLines: readNumber('subtitleLines'),
    textPreviewLines,
    imageRatio: readNumber('imageRatio'),
    thumbnailSize: readNumber('thumbnailSize'),
    posterDisplayMode,
    imageFit,
  });

  // Recorded outside the poster-static branch too, so re-entering static mode
  // doesn't fire one spurious batch on the first update after the toggle.
  if (
    textPreviewLines !== undefined &&
    lastClippedTextPreviewLines.get(containerEl) !== textPreviewLines
  ) {
    lastClippedTextPreviewLines.set(containerEl, textPreviewLines);
    // Imageless Grid cards are clipped outside static mode too, so their re-clip
    // cannot hang off the poster-static gate — textPreviewLines is CSS-only and
    // never re-renders, so a skipped batch leaves a stale clamp forever.
    const wasStaticBeforeToggle =
      containerEl.classList.contains('poster-static');
    const cards = [
      ...containerEl.querySelectorAll<HTMLElement>('.card.image-format-poster'),
    ].filter((c) =>
      c.classList.contains('has-poster')
        ? wasStaticBeforeToggle
        : !!c.closest('.dynamic-views-grid')
    );
    if (cards.length > 0) clipPosterStaticOverflowBatch(cards);
  }

  // Poster static mode — bidirectional: reset clipping on transition, re-clip if entering static
  const wasStatic = containerEl.classList.contains('poster-static');
  containerEl.classList.toggle(
    'poster-static',
    config.get('posterInteractToReveal') !== true
  );
  const isStatic = containerEl.classList.contains('poster-static');

  if (wasStatic !== isStatic) {
    const posterCards = containerEl.querySelectorAll<HTMLElement>(
      '.card.image-format-poster.has-poster'
    );
    if (isStatic) {
      clipPosterStaticOverflowBatch([...posterCards]);
    } else {
      resetPosterClipping([...posterCards]);
    }
  } else if (isStatic && prevMode !== null && posterDisplayMode !== prevMode) {
    // Display mode changed while static — content area size differs (fade has max-height: 70%)
    const win = getOwnerWindow(containerEl);
    win.requestAnimationFrame(() => {
      const posterCards = containerEl.querySelectorAll<HTMLElement>(
        '.card.image-format-poster'
      );
      clipPosterStaticOverflowBatch([...posterCards]);
    });
  }
}

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

/**
 * Derive the card's structural classes from its current DOM (replaces CSS
 * `:has()` selectors, which invalidate upward across every card).
 *
 * Runs at render time and again after every in-place content update, so all
 * five classes stay truthful when properties, previews, the header or the URL
 * icon come and go. `toggle(name, condition)` throughout — the function must be
 * idempotent and must clear a class as readily as it sets one.
 *
 * `bodyEl` is nullable only for cards whose body never existed; callers that
 * have a card in hand must look it up rather than pass `null`, or
 * `has-body-content` goes stale and the body stays `display: none`.
 */
export function syncStructuralClasses(
  cardEl: HTMLElement,
  bodyEl: HTMLElement | null
): void {
  // has-body-content: body has visible properties or previews.
  // Drives card-body display:none when empty (prevents gap below subtitle).
  bodyEl?.classList.toggle(
    'has-body-content',
    !!bodyEl.querySelector(VISIBLE_BODY_SELECTOR)
  );
  // has-card-content: card-level flag for cover padding and title divider CSS rules.
  cardEl.classList.toggle(
    'has-card-content',
    !!cardEl.querySelector(VISIBLE_BODY_SELECTOR)
  );
  cardEl.classList.toggle(
    'has-properties-bottom',
    !!cardEl.querySelector('.card-properties-bottom')
  );
  // Prevents cover-only padding reset from zeroing padding on title-only cards.
  cardEl.classList.toggle('has-header', !!cardEl.querySelector('.card-header'));
  // Gates the poster header's icon containment strips — see _header.scss.
  // Derived from the DOM rather than from hasValidUrl: a valid URL on a card
  // with no header renders no icon, and the class must track the icon.
  cardEl.classList.toggle(
    'has-url-icon',
    !!cardEl.querySelector(URL_ICON_SELECTOR)
  );
  // Distinguishes a header holding only the URL button from one that also carries
  // text. The icon alone is the case that collapses onto the cover; a title or
  // subtitle must keep the content area in flow or it would be hidden with it.
  cardEl.classList.toggle(
    'has-title-block',
    !!cardEl.querySelector('.card-title-block')
  );
}

/**
 * Insert an empty `.card-header` as the first child of `.card-content`.
 *
 * Needed when a URL appears on a card that rendered without a header — the case
 * whenever `displayFirstAsTitle` is OFF, since `readBasesSettings` then blanks
 * the title and subtitle properties and `createHeader` has nothing to render. A
 * bare header is complete there: `.card-title-block` only exists when a title or
 * subtitle does.
 *
 * Returns null when the card has no `.card-content`. Unreachable in practice —
 * every card renders one unconditionally — so this is defence, not a live case.
 */
function prependHeader(cardEl: HTMLElement): HTMLElement | null {
  const contentEl = cardEl.querySelector<HTMLElement>('.card-content');
  if (!contentEl) return null;
  const headerEl = contentEl.createDiv('card-header');
  contentEl.prepend(headerEl);
  return headerEl;
}

/**
 * Property ids whose text is already rendered elsewhere on the card, and so must
 * not also appear as a property row.
 *
 * Membership is limited to settings that render the property's **text**: the text
 * preview shows it as prose, the URL button shows it as a link. Membership is also
 * unconditional — setting one of those declares the property's role, so the row is
 * dropped whether or not the value actually renders. Making it conditional on the
 * other rendering having failed would tie the row's presence to async load state
 * and change card height after render, which is layout shift for a corner case.
 *
 * The image property is deliberately absent (#437) — an image is not a rendering
 * of the property's text, and excluding it made the value invisible whenever no
 * image resolved: a broken reference produced no image, no placeholder and no row.
 * Users who do not want the row simply leave the property out of the view's
 * property order, which is how visibility is controlled for every other property.
 *
 * Ids are compared against `CardData.properties[].name`, which comes straight from
 * `config.getOrder()` — so both sides are the qualified form (`note.image`), never
 * the bare one.
 */
export function getPropertiesRenderedElsewhere(
  settings: Pick<ResolvedSettings, 'textPreviewProperty' | 'urlProperty'>
): Set<string> {
  const excluded = new Set<string>();
  if (settings.textPreviewProperty) excluded.add(settings.textPreviewProperty);
  if (settings.urlProperty) excluded.add(settings.urlProperty);
  return excluded;
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
  // Shared across all cards so Obsidian auto-dismisses the previous popover (including edit mode) when a new hover-link fires on the same parent, matching native Bases behavior.
  private hoverParent: HoverParent = { hoverPopover: null };

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
    // Internal link (wikilink or Markdown internal)
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
      // Subpath is stripped before resolving — '#heading' and '#^block' are not part
      // of the file path, and a bare subpath targets the source note itself.
      const linkPath = link.url.split('#')[0];
      if (
        linkPath &&
        !this.app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath)
      ) {
        el.classList.add('is-unresolved');
      }
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
          // file.path, not link.url: a linktext carries no extension, and the
          // path argument reaches openWithDefaultApp().
          showFileContextMenu(e, this.app, file, file.path);
        },
        { signal }
      );
      el.addEventListener(
        'mouseenter',
        (e) => {
          this.app.workspace.trigger('hover-link', {
            event: e,
            source: 'bases',
            hoverParent: this.hoverParent,
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
      // draggable: 'false' does not suppress WebKit's long-press image drag — it
      // retargets it to the nearest draggable ancestor, which is the card or the
      // link wrapping this image. That retargeting IS the fix: the gesture then
      // produces the card or link drag the user expects instead of a bare image
      // payload. Every <img> the plugin creates carries it for this reason.
      const img = container.createEl('img', {
        cls: 'external-embed',
        attr: { src: link.url, alt: link.caption, draggable: 'false' },
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
      createExternalLinkDragHandler(this.app, link.caption, link.url),
      { signal }
    );
    el.addEventListener(
      'contextmenu',
      (e) => {
        const file = this.app.vault.getAbstractFileByPath(sourcePath);
        if (!(file instanceof TFile)) return;
        showFileContextMenu(e, this.app, file, sourcePath, link.url);
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
   * @param renderOptions - Optional render-time behavior overrides
   */
  renderCard(
    container: HTMLElement,
    card: CardData,
    entry: BasesEntry,
    settings: ResolvedSettings,
    keyboardNav?: {
      index: number;
      focusableCardIndex: number;
      containerRef: { current: HTMLElement | null };
      onFocusChange?: (index: number) => void;
      onHoverStart?: (el: HTMLElement) => void;
      onHoverEnd?: () => void;
      getVirtualRects?: () => readonly VirtualCardRect[];
      onMountItem?: (index: number) => HTMLElement | null;
    },
    renderOptions?: {
      skipImageFade?: boolean;
    }
  ): CardHandle {
    // Snapshot instance array lengths for per-card resource collection
    const observersBefore = this.propertyObservers.length;
    const slideshowsBefore = this.slideshowCleanups.length;

    // Resolved up front because the open-on-title fallback below has to know
    // whether a title will render at all. Pure and cheap, and the single result
    // feeds both the fallback and the header — no extra work on this hot path.
    const { displayTitle, isTitleEmpty } =
      SharedCardRenderer.resolveTitleDisplay(card, entry, settings);

    // Create card element
    const cardEl = container.createDiv('card');

    // Virtual scroll remount: set skip-image-fade before image handlers run
    // synchronously, so handleImageLoad sees the class immediately.
    if (renderOptions?.skipImageFade) {
      cardEl.classList.add('skip-image-fade');
    }

    const format = settings.imageFormat;
    const position = settings.imagePosition;

    // Poster: force title-as-link and card context menu (click toggles reveal, not file open)
    const isPoster = format === 'poster';

    // Check if any image source is configured (property or embeds)
    const hasImageSource =
      !!settings.imageProperty?.trim() || settings.showFileImages !== 'never';

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
      settings.posterInteractToReveal &&
      this.app.isMobile;

    // Open-on-title leaves a card with no title nothing to press, so the file could not be
    // opened at all. Such a card opens on card press instead.
    const effectiveOpenOnTitle = settings.openOnTitle && !!displayTitle;

    const isCardClickable = !effectiveOpenOnTitle && !isPosterClickReveal;
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

      // Create scope for Cmd/Ctrl+Enter handling
      // Pass app.scope as parent so unhandled keys bubble up to Obsidian
      cardScope = new Scope(this.app.scope);
      cardScope.register(['Mod'], 'Enter', () => {
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
        // Suppress click after context menu or long touch.
        // Long touches that miss Android's contextmenu threshold
        // would otherwise open the file on lift.
        if (Date.now() - lastContextMenuTime < CONTEXT_MENU_SUPPRESS_MS) return;
        if (
          touchDownTime &&
          Date.now() - touchDownTime > TOUCH_TAP_THRESHOLD_MS
        )
          return;

        if (
          isPosterClickReveal &&
          handlePosterTapReveal(e, cardEl, effectiveOpenOnTitle)
        ) {
          return;
        }

        // Card-level click-to-open: mobile except poster cards with images (poster with image uses tap-to-reveal)
        if (!effectiveOpenOnTitle && !isPosterClickReveal) {
          // A drag-select over card text ends in a click on release. Opening the
          // file would throw the selection away — same guard as
          // handlePosterTapReveal, which the poster path takes instead.
          if (
            (getOwnerWindow(cardEl).getSelection()?.toString().length ?? 0) > 0
          )
            return;

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
    if (canHover(cardEl)) {
      setupHoverIntent(
        cardEl,
        () => {
          // interact-hover is the hover-only half of interact. setupHoverIntent
          // filters every event through isHoverPointer, so reaching here proves
          // the input was a mouse or a pen in hover range — never a finger.
          // Image zoom keys on it so the gate is the input that produced the
          // event, not the device: a tablet with a trackpad still zooms, and a
          // finger on that same tablet does not. setupTouchPress must never set
          // this class — its absence there is the whole mechanism.
          cardEl.classList.add('interact', 'interact-hover');
          markContainerHoverCard(cardEl);
          keyboardNav?.onHoverStart?.(cardEl);
        },
        () => {
          // Image viewer overlay triggers pointerleave — keep hover state
          if (cardEl.classList.contains('viewer-active')) return;
          cardEl.classList.remove('interact', 'interact-hover');
          deferContainerHoverDrop(cardEl);
          keyboardNav?.onHoverEnd?.();
        },
        signal
      );
    }

    setupTouchPress(
      cardEl,
      () => {
        cardEl.classList.add('interact');
        markContainerHoverCard(cardEl);
      },
      () => {
        cardEl.classList.remove('interact');
        deferContainerHoverDrop(cardEl);
      },
      signal,
      // Open-on-title on mobile: only the title opens the file, so a tap on the
      // rest of the card must not light the card up as if it were actionable.
      // Matches the dead-zone click handler's target — the whole .card-title,
      // not just the link, since that is the mobile tap region.
      effectiveOpenOnTitle && this.app.isMobile
        ? (e) => Boolean((e.target as HTMLElement)?.closest?.('.card-title'))
        : undefined
    );

    // Poster hover intent: require mousemove before activating (ignores scroll-triggered hovers)
    // Gates content reveal (via CSS) and scroll access on desktop.
    if (
      isPoster &&
      settings.posterInteractToReveal &&
      canPrimaryHover(cardEl)
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
        () => {
          if (cardEl.classList.contains('viewer-active')) return;
          cardEl.classList.remove('poster-hover-active');
          resetPosterScroll(cardEl);
        },
        signal
      );
    }

    // Handle hover for page preview (only on card when open-on-title is off)
    // Use mouseenter (not mouseover) to prevent multiple triggers from child elements
    if (!effectiveOpenOnTitle) {
      cardEl.addEventListener(
        'mouseenter',
        (e) => {
          this.app.workspace.trigger('hover-link', {
            event: e,
            source: 'bases',
            hoverParent: this.hoverParent,
            targetEl: cardEl,
            linktext: card.path,
            sourcePath: card.path,
          });
        },
        { signal }
      );
    }

    // Touch press timing — suppresses file-open for presses that exceed
    // TOUCH_TAP_THRESHOLD_MS but fall short of Android's native
    // CONTEXT_MENU_SUPPRESS_MS. Without this, users attempting a
    // long-press get an accidental file-open on lift. Desktop clicks
    // (pointerType !== 'touch') bypass the check entirely.
    let touchDownTime = 0;
    if (this.app.isMobile) {
      cardEl.addEventListener(
        'pointerdown',
        (e) => {
          touchDownTime = e.pointerType === 'touch' ? Date.now() : 0;
        },
        { signal, passive: true }
      );
    }

    // Context menu handler for file. Tracks open time so click handlers
    // can suppress the synthesized click on platforms that fire one.
    let lastContextMenuTime = 0;
    const handleContextMenu = (e: MouseEvent) => {
      lastContextMenuTime = Date.now();
      showFileContextMenu(e, this.app, entry.file, card.path);
    };

    // Attach context menu to card when open-on-title is off
    if (!effectiveOpenOnTitle) {
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
      const icon = getFileTypeIcon(card.path);
      const isFullname = settings.titleProperty === 'file.fullname';
      const extInfo = getFileExtInfo(card.path, isFullname);
      const extNoDot = extInfo?.ext.slice(1) || '';

      // Add title text
      if (effectiveOpenOnTitle || isPosterClickReveal) {
        // Render as clickable, draggable link
        const link = titleEl.createEl('a', {
          cls: 'internal-link card-title-text',
          attr: {
            'data-href': card.path,
            href: card.path,
            draggable: 'true',
            'data-ext': extNoDot,
            tabindex: '-1',
          },
        });

        // Icon and badge inside link (before text)
        if (icon) {
          const iconEl = link.createSpan({ cls: 'card-title-icon' });
          setIcon(iconEl, icon);
        }
        if (extInfo) {
          link.createSpan({
            cls: 'card-title-ext',
            attr: { 'data-ext': extNoDot },
          });
        }
        link.append(displayTitle);
        if (isTitleEmpty) link.classList.add('empty-value-marker');

        // Precise ink-rect state — hoisted for click/contextmenu access
        const isPreciseHover = effectiveOpenOnTitle && !this.app.isMobile;
        let inkRects: InkRect[] = [];

        const checkInkHit = (e: MouseEvent): boolean =>
          inkRects.some(
            (r) =>
              e.clientX >= r.left &&
              e.clientX <= r.right &&
              e.clientY >= r.top &&
              e.clientY <= r.bottom
          );

        link.addEventListener(
          'click',
          (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Desktop open-on-title: only open file when clicking on text
            if (isPreciseHover && !checkInkHit(e)) return;
            // Suppress context-menu / long-touch click — see touchDownTime setup
            if (Date.now() - lastContextMenuTime < CONTEXT_MENU_SUPPRESS_MS)
              return;
            if (
              touchDownTime &&
              Date.now() - touchDownTime > TOUCH_TAP_THRESHOLD_MS
            )
              return;
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
        // (isPosterClickReveal + open-on-card = card mouseenter handles it)
        // Also skip desktop open-on-title — precise hover handler below manages it
        if (
          !(isPosterClickReveal && !effectiveOpenOnTitle) &&
          !(!this.app.isMobile && effectiveOpenOnTitle)
        ) {
          link.addEventListener(
            'mouseenter',
            (e) => {
              this.app.workspace.trigger('hover-link', {
                event: e,
                source: 'bases',
                hoverParent: this.hoverParent,
                targetEl: link,
                linktext: card.path,
                sourcePath: card.path,
              });
            },
            { signal }
          );
        }

        // Precise hover: only activate hover color/underline over actual text glyphs.
        // -webkit-box fills available width; this prevents hover on dead space.
        if (isPreciseHover) {
          // CSS uses this class to gate :active opacity behind ink-rect hit.
          // Desktop-only — mobile never sets this regardless of connected pointer.
          link.classList.add('precise-hover');

          // Block Obsidian's delegated mouseover handler on .internal-link — it
          // fires page preview on the full -webkit-box area. Our own fireHoverLink()
          // (triggered from mouseenter/mousemove) handles preview gated by ink rects.
          link.addEventListener('mouseover', (e) => e.stopPropagation(), {
            signal,
          });

          let dirty = false;
          let hoverHit = false;

          // Per-link hoverParent so we can dismiss the popover when leaving
          // text without affecting other cards' popovers.
          const linkHoverParent: HoverParent = { hoverPopover: null };

          // Re-measure when title text changes in-place (updateTitleText path)
          const observer = new (getOwnerWindow(link).MutationObserver)(() => {
            dirty = true;
          });
          observer.observe(link, { characterData: true, subtree: true });
          signal.addEventListener('abort', () => observer.disconnect());

          const fireHoverLink = (e: MouseEvent) => {
            this.app.workspace.trigger('hover-link', {
              event: e,
              source: 'bases',
              hoverParent: linkHoverParent,
              targetEl: link,
              linktext: card.path,
              sourcePath: card.path,
            });
          };

          // Cancel pending page preview: synthetic mouseover from non-link
          // parent triggers Obsidian's document-level cancel handler.
          // Already-visible popovers are dismissed by Obsidian's own
          // checkHover() when the cursor leaves the target + popover area.
          const cancelPendingPreview = () => {
            titleEl.dispatchEvent(
              new MouseEvent('mouseover', { bubbles: true })
            );
          };

          link.addEventListener(
            'mouseenter',
            (e) => {
              inkRects = measureTitleInkRects(link);
              dirty = false;
              const hit = checkInkHit(e);
              if (hit !== hoverHit) {
                hoverHit = hit;
                link.classList.toggle('is-title-hover-hit', hit);
              }
              if (hit) fireHoverLink(e);
            },
            { signal }
          );

          link.addEventListener(
            'mousemove',
            (e: MouseEvent) => {
              if (dirty) {
                inkRects = measureTitleInkRects(link);
                dirty = false;
              }
              const hit = checkInkHit(e);
              if (hit !== hoverHit) {
                hoverHit = hit;
                link.classList.toggle('is-title-hover-hit', hit);
                if (hit) fireHoverLink(e);
                else cancelPendingPreview();
              }
            },
            { signal, passive: true } as AddEventListenerOptions
          );

          link.addEventListener(
            'mouseleave',
            () => {
              hoverHit = false;
              link.classList.remove('is-title-hover-hit');
              cancelPendingPreview();
            },
            { signal }
          );
        }

        // Open context menu on right-click
        link.addEventListener(
          'contextmenu',
          (e) => {
            if (isPreciseHover && !checkInkHit(e)) return;
            handleContextMenu(e);
          },
          { signal }
        );

        // Make title draggable when open-on-title is on
        link.addEventListener('dragstart', handleDrag, { signal });

        // Dead zone: clicks/contextmenu on .card-title that miss the link.
        // Mobile only — fat-finger tap targets. Desktop uses precise link clicks.
        // Only for open-on-title — in press mode, only the link itself is clickable.
        if (effectiveOpenOnTitle && this.app.isMobile) {
          titleEl.addEventListener(
            'click',
            (e) => {
              // Suppress context-menu / long-touch click — see touchDownTime setup
              if (Date.now() - lastContextMenuTime < CONTEXT_MENU_SUPPRESS_MS)
                return;
              if (
                touchDownTime &&
                Date.now() - touchDownTime > TOUCH_TAP_THRESHOLD_MS
              )
                return;
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
        if (extInfo) {
          link.createSpan({
            cls: 'card-title-ext-suffix',
            text: `.${extNoDot}`,
          });
        }
      } else {
        // Render as plain text span (line-clamp host for truncation)
        const titleSpan = titleEl.createSpan({
          cls: 'card-title-text',
          attr: { 'data-ext': extNoDot },
        });
        if (icon) {
          const iconEl = titleSpan.createSpan({ cls: 'card-title-icon' });
          setIcon(iconEl, icon);
        }
        if (extInfo) {
          titleSpan.createSpan({
            cls: 'card-title-ext',
            attr: { 'data-ext': extNoDot },
          });
        }
        titleSpan.append(displayTitle);
        if (isTitleEmpty) titleSpan.classList.add('empty-value-marker');
        if (extInfo) {
          titleSpan.createSpan({
            cls: 'card-title-ext-suffix',
            text: `.${extNoDot}`,
          });
        }
      }

      // Setup scroll gradients for title if scroll mode is enabled. Matches the
      // CSS, which only scrolls single-line titles — a multi-line title wraps
      // and has nothing to scroll.
      if (
        settings.titleLines === 1 &&
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
        { ...settings, propertyNames: 'hide' },
        shouldHideMissingProperties(),
        getHideEmptyMode(),
        signal,
        true,
        // isTimestampProperty covers file timestamps only; the flag catches a
        // frontmatter date property
        isTimestampProperty(subtitleProperty, settings) ||
          card.subtitleIsDate === true
      );

      // Setup scroll gradients if scroll mode is enabled. Matches the CSS, which
      // only scrolls single-line subtitles — a wrapped subtitle has nothing to scroll.
      if (
        settings.subtitleLines === 1 &&
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
        settings,
        effectiveOpenOnTitle,
        card,
        signal
      );
    }

    // Universal content wrapper: header + body
    const cardContent = cardEl.createDiv('card-content');

    // Title, Subtitle, and URL button — always wrapped in card-header.
    // Header always placed in card-content — poster header scrolls with
    // content since card-content is the scroll container.
    const createHeader = (parent: HTMLElement): void => {
      if (!(hasTitle || hasSubtitle || (card.hasValidUrl && card.urlValue)))
        return;

      const headerEl = parent.createDiv('card-header');

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
        this.createUrlIcon(headerEl, card.urlValue, card.path, signal);
      }
    };

    // Header in card-content (before body) — all formats
    createHeader(cardContent);

    // Make card draggable when open-on-title is off
    if (!effectiveOpenOnTitle) {
      cardEl.addEventListener('dragstart', handleDrag, { signal });
    }

    // POSTER: absolute-positioned image fills entire card, content hidden until hover
    if (format === 'poster' && hasImage) {
      const bgWrapper = cardEl.createDiv('card-poster');
      cardEl.classList.add('has-poster');
      // draggable: 'false' retargets the WebKit long-press drag — see the
      // external-embed img in renderLink().
      const img = bgWrapper.createEl('img', {
        attr: { src: imageUrls[0], alt: '', draggable: 'false' },
      });
      // Real DOM gradient overlay (replaces ::after pseudo-element).
      // ::after forces WebKit to create a separate compositor layer on fresh DOM
      // insertion, causing 1-3 frame blank flash on virtual scroll remount.
      // A real element in the initial render tree avoids async layer creation.
      bgWrapper.createDiv('poster-gradient');
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
      // draggable: 'false' retargets the WebKit long-press drag — see the
      // external-embed img in renderLink().
      const img = bgWrapper.createEl('img', {
        attr: { src: imageUrls[0], alt: '', draggable: 'false' },
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

    // Poster: scroll gradient on card-content (header + body scroll together)
    if (format === 'poster') {
      setupVerticalScrollGradient(cardContent, signal);
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
        setTextPreviewContent(previewDiv, card.textPreview);
      }

      // Thumbnail (all positions now inside card-previews)
      if (showThumbnail) {
        if (hasImage) {
          const imageEl = previewsEl.createDiv('card-thumbnail');
          this.renderImage(
            imageEl,
            imageUrls,
            'thumbnail',
            settings,
            effectiveOpenOnTitle,
            cardEl,
            signal,
            format === 'thumbnail' &&
              imageUrls.length > 1 &&
              !isThumbnailScrubbingDisabled()
              ? imageUrls.slice(0, MAX_MULTI_IMAGES)
              : null
          );

          // Multi-image indicator for scrubbable thumbnails.
          // No "Hide icon" gate here, unlike the cover icon, which has one in
          // JS as well as in CSS. Neither toggle is in getStyleSettingsHash(),
          // so flipping one re-renders nothing and the CSS rule is what hides
          // the icon on cards already on screen — see card/_previews.scss. The
          // cover's JS gate only spares the node on the next render; it is a
          // saving, not the mechanism, so the thumbnail needs no twin.
          if (imageUrls.length > 1 && !isThumbnailScrubbingDisabled()) {
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
        settings,
        effectiveOpenOnTitle,
        card,
        signal
      );
    }

    syncStructuralClasses(cardEl, bodyEl);

    // Masonry cards don't have final dimensions at render time (width/height set later
    // by masonry positioning) — the per-card ResizeObserver handles clipping for masonry.
    // Imageless Grid cards clip regardless of static mode: aspect-ratio constrains
    // their height, so content overflows with nothing to reveal it. Kept as one
    // condition — an imageless static card satisfies both arms, and two calls
    // would pay two clear→measure→apply cycles for the same result.
    if (
      format === 'poster' &&
      cardEl.closest('.dynamic-views-grid') &&
      (!settings.posterInteractToReveal ||
        !cardEl.classList.contains('has-poster'))
    ) {
      clipPosterStaticOverflow(cardEl);
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

    let lastClipWidth = 0;
    let lastClipHeight = 0;
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

        // Re-clip poster content on resize (card dimensions changed).
        // Imageless cards clip in Grid only — that is where aspect-ratio
        // constrains their height. Selecting on has-poster rather than or-ing
        // the two arms is what makes that true, and matches the batch call
        // sites: a bare .poster-static test also caught imageless Masonry
        // cards, whose height is free, and there the clipper hid the URL button
        // for the 4px its border box legitimately overhangs the header.
        if (
          format === 'poster' &&
          (cardEl.classList.contains('has-poster')
            ? cardEl.closest('.poster-static')
            : cardEl.closest('.dynamic-views-grid'))
        ) {
          const h = cardEl.offsetHeight;
          if (cardWidth !== lastClipWidth || h !== lastClipHeight) {
            lastClipWidth = cardWidth;
            lastClipHeight = h;
            clipPosterStaticOverflow(cardEl);
          }
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

  /** Creates cover wrapper. Only called when format === "cover". */
  private renderCoverWrapper(
    cardEl: HTMLElement,
    imageUrls: string[],
    hasImage: boolean,
    settings: ResolvedSettings,
    /**
     * renderCard's title-aware open mode. Threaded rather than read from
     * `settings` because with the image viewer disabled this value decides
     * whether an image click opens the file, and the trigger stops
     * propagation — the card-level handler cannot compensate.
     */
    effectiveOpenOnTitle: boolean,
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
      const slideshowUrls = imageUrls.slice(0, MAX_MULTI_IMAGES);
      const isMulti = isSlideshowEnabled() && slideshowUrls.length >= 2;
      const shouldScrub = isMulti && isCoverScrubMode();
      const shouldShowSlideshow = isMulti && !shouldScrub;

      if (shouldShowSlideshow) {
        const slideshowEl = coverWrapper.createDiv(
          'card-cover card-cover-slideshow'
        );
        this.renderSlideshow(
          slideshowEl,
          slideshowUrls,
          'cover',
          settings,
          effectiveOpenOnTitle,
          card.path
        );
      } else {
        const imageEl = coverWrapper.createDiv('card-cover');
        this.renderImage(
          imageEl,
          imageUrls,
          'cover',
          settings,
          effectiveOpenOnTitle,
          cardEl,
          signal,
          shouldScrub ? slideshowUrls : null
        );
        if (shouldScrub && isSlideshowIconEnabled()) {
          const iconEl = imageEl.createDiv('slideshow-icon');
          setIcon(iconEl, 'lucide-copy');
        }
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
    settings: ResolvedSettings,
    /**
     * renderCard's title-aware open mode. Threaded rather than read from
     * `settings` because with the image viewer disabled this value decides
     * whether an image click opens the file, and the trigger stops
     * propagation — the card-level handler cannot compensate.
     */
    effectiveOpenOnTitle: boolean,
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

    // imageUrls is already capped by MAX_MULTI_IMAGES at the call site
    setViewerImageSet(imageEmbedContainer, imageUrls);

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
          effectiveOpenOnTitle
        );
      },
      { signal }
    );

    // Create two persistent img elements (current and next).
    // draggable: 'false' retargets the WebKit long-press drag — see the
    // external-embed img in renderLink().
    const currentImg = imageEmbedContainer.createEl('img', {
      cls: 'slideshow-img slideshow-img-current',
      attr: { src: imageUrls[0], alt: '', draggable: 'false' },
    });

    // Next image starts with empty src (draggable: 'false' as above)
    imageEmbedContainer.createEl('img', {
      cls: 'slideshow-img slideshow-img-next',
      attr: { src: '', alt: '', draggable: 'false' },
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

    // Multi-image icon
    if (isSlideshowIconEnabled()) {
      const iconEl = slideshowEl.createDiv('slideshow-icon');
      setIcon(iconEl, 'lucide-copy');
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
    setupSwipeGestures(slideshowEl, cardEl, navigate, signal);
  }

  /**
   * Renders image (cover or thumbnail) with all necessary handlers
   */
  private renderImage(
    imageEl: HTMLElement,
    imageUrls: string[],
    format: 'thumbnail' | 'cover',
    settings: ResolvedSettings,
    /**
     * renderCard's title-aware open mode. Threaded rather than read from
     * `settings` because with the image viewer disabled this value decides
     * whether an image click opens the file, and the trigger stops
     * propagation — the card-level handler cannot compensate.
     */
    effectiveOpenOnTitle: boolean,
    cardEl: HTMLElement,
    signal?: AbortSignal,
    /** Images to scrub through, or null for a plain single image. The caller owns
     *  the gate — thumbnails check their own setting, covers check navigation mode. */
    scrubUrls: string[] | null = null
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
          effectiveOpenOnTitle
        );
      },
      signal ? { signal } : undefined
    );

    // draggable: 'false' retargets the WebKit long-press drag — see the
    // external-embed img in renderLink().
    const imgEl = imageEmbedContainer.createEl('img', {
      attr: { src: imageUrls[0], alt: '', draggable: 'false' },
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

    // Scrubbable array aliased here so tryNextImage can splice broken URLs.
    // null when scrubbing not active (single image, or disabled by setting).
    const scrubbableUrls = scrubUrls;

    // Degrading to one valid image drops the multi-image affordances. Covers
    // additionally take `.slideshow-single`, which hides the slideshow icon.
    const markSingle = () => {
      imageEl.classList.remove('multi-image');
      if (format === 'cover') imageEl.addClass('slideshow-single');
    };

    // Hover zoom survives only until the displayed frame first changes. One flag,
    // no seed: the frame the session started on is whatever is already on screen,
    // which the src comparison reads directly.
    // Covers only, matching the setupHoverZoomEligibility gate below: thumbnails
    // never zoom, and no rule consumes the zoom-cancel class on one.
    let zoomCleared = false;
    const dropZoomOnFrameChange = () => {
      if (format !== 'cover' || zoomCleared) return;
      zoomCleared = true;
      cancelHoverZoom(imageEmbedContainer);
    };

    // scrubbableUrls already encodes the format + multi-image + navigation gate
    if (scrubbableUrls) {
      setViewerImageSet(imageEmbedContainer, scrubbableUrls);
    }

    // Fallback to next valid image if current fails (for multi-image cards)
    if (imageUrls.length > 1) {
      // Non-scrubbing fallback uses sequential index (covers, disabled scrubbing)
      let currentUrlIndex = 0;
      const tryNextImage = () => {
        if (signal?.aborted) return;
        const failedSrc = imgEl.src;
        // Ignore spurious errors from src='' during slideshow role swap
        if (!failedSrc || failedSrc === getOwnerWindow(imgEl).location.href)
          return;
        imgEl.removeClass('scrub-loading');
        markImageBroken(failedSrc);
        if (scrubbableUrls) {
          const idx = scrubbableUrls.indexOf(failedSrc);
          if (idx !== -1) scrubbableUrls.splice(idx, 1);
          if (scrubbableUrls.length <= 1) {
            markSingle();
          }
          // Show first remaining valid image
          if (scrubbableUrls.length > 0) {
            if (signal?.aborted || !imgEl.isConnected) return;
            imgEl.removeClass('dynamic-views-hidden');
            imgEl.src = getCachedBlobUrl(scrubbableUrls[0]);
            dropZoomOnFrameChange();
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
              // Failed images still need a known ratio, or the cover stays collapsed
              setKnownAspectRatio(cardEl, DEFAULT_ASPECT_RATIO);
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

    // Scrubbing for covers and thumbnails (hover + touch), capped at MAX_MULTI_IMAGES
    if (scrubbableUrls) {
      imageEl.classList.add('multi-image');
      imgEl.classList.add('slideshow-img', 'slideshow-img-current');

      // Thumbnails do not zoom, so only covers need the eligibility wiring. The
      // card — not the image — is the hover-session boundary: moving between the
      // image and card content is an ordinary excursion that must not restart it.
      if (format === 'cover') {
        setupHoverZoomEligibility(cardEl, imageEmbedContainer, signal!);
        cardEl.addEventListener(
          'mouseenter',
          () => {
            zoomCleared = false;
          },
          { signal }
        );
      }

      // Second image element for swipe animation (touch only)
      // (draggable: 'false' as on the current image above)
      const nextImg = imageEmbedContainer.createEl('img', {
        cls: ['slideshow-img', 'slideshow-img-next'],
        attr: { src: '', alt: '', draggable: 'false' },
      });
      nextImg.addEventListener(
        'error',
        () => {
          if (!nextImg.src || nextImg.src === window.location.href) return;
          markImageBroken(nextImg.src);
          const idx = scrubbableUrls.indexOf(nextImg.src);
          if (idx !== -1) scrubbableUrls.splice(idx, 1);
          if (scrubbableUrls.length <= 1) markSingle();
        },
        signal ? { signal } : undefined
      );

      // Touch + hover preload dedup
      const preloadGuard = { done: false };

      // Shared broken handler for both hover preload and touch scrub
      const scrubBrokenHandler = createPreloadBrokenHandler(
        scrubbableUrls,
        cardEl,
        markSingle
      );

      // Preload on hover — splice broken URLs from scrubbable array immediately
      if (signal) {
        setupImagePreload(
          cardEl,
          scrubbableUrls,
          signal,
          scrubBrokenHandler,
          preloadGuard
        );
      }

      // Touch scrub reset — declared before hover handlers so closures can call it
      let resetSwipeNavigation: (() => void) | null = null;

      // Cache bounding rect on pointerenter to avoid layout thrashing on every pointermove
      // Closure and DOMRect freed when event listeners are removed via { signal }
      let cachedRect: DOMRect | null = null;
      // undefined = not measured yet, null = measured and this card has none.
      let cachedDeadRect: DOMRect | null | undefined;

      const pointInRect = (e: PointerEvent, rect: DOMRect): boolean =>
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;

      /**
       * The region around the URL button that scrubbing ignores, in client
       * coordinates — null when this card has no URL button over its image.
       *
       * Every edge is read from a live rect: the card's padding is a Style
       * Settings slider and the icon's box is bigger on mobile, so any literal
       * would be wrong at most settings.
       */
      const getDeadRect = (): DOMRect | null => {
        if (cachedDeadRect !== undefined) return cachedDeadRect;
        const urlButtonEl =
          cardEl.querySelector<HTMLElement>(URL_ICON_SELECTOR);
        const urlButtonRect = urlButtonEl?.getBoundingClientRect();
        const coverRect = (cachedRect ??= imageEl.getBoundingClientRect());
        // An intersection test rather than a position-class check: the layouts
        // that park the icon in the header away from the image are exactly the
        // ones that need no dead zone, and naming none of them keeps layouts
        // nobody has thought of yet correct for free.
        if (
          !urlButtonRect ||
          urlButtonRect.right <= coverRect.left ||
          urlButtonRect.left >= coverRect.right ||
          urlButtonRect.bottom <= coverRect.top ||
          urlButtonRect.top >= coverRect.bottom
        ) {
          cachedDeadRect = null;
          return null;
        }
        const cardRect = cardEl.getBoundingClientRect();
        // Flush to the card's top and right edges, inset from the icon on the
        // left and bottom by that same edge's own gap, so the zone reads as the
        // button's own margin at any padding or URL button size.
        const gapTop = urlButtonRect.top - cardRect.top;
        const gapRight = cardRect.right - urlButtonRect.right;
        // Clipped to the image, which is also what lets pointerleave tell the
        // two exits apart: moving onto the icon stacked over the image reports
        // a point inside the image, while a geometric exit reports one outside
        // it altogether.
        const left = Math.max(urlButtonRect.left - gapRight, coverRect.left);
        const top = Math.max(cardRect.top, coverRect.top);
        const right = Math.min(cardRect.right, coverRect.right);
        const bottom = Math.min(
          urlButtonRect.bottom + gapTop,
          coverRect.bottom
        );
        cachedDeadRect = new DOMRect(left, top, right - left, bottom - top);
        return cachedDeadRect;
      };

      imageEl.addEventListener(
        'pointerenter',
        (e: PointerEvent) => {
          if (!isHoverPointer(e)) return;
          cachedRect = imageEl.getBoundingClientRect();
          // Invalidated with cachedRect: a URL button that updateUrlButton added
          // or removed since the last hover must not leave a stale zone behind.
          cachedDeadRect = undefined;
          imageEl.classList.add('scrub-hover');
        },
        { signal }
      );

      imageEl.addEventListener(
        'pointermove',
        (e: PointerEvent) => {
          if (!isHoverPointer(e)) return;
          if (signal?.aborted || scrubbableUrls.length === 0) return;
          // Movement near the URL button drives nothing — the icon and a matching margin
          // around it are dead for scrubbing, so a pointer travelling to the button does
          // not drag the frame with it. Frozen, not reset: the frame the user scrubbed to
          // is still the one they want when they come back.
          const deadRect = getDeadRect();
          if (deadRect && pointInRect(e, deadRect)) return;
          // Use cached rect, or cache on first mousemove if mouseenter didn't fire
          const rect = (cachedRect ??= imageEl.getBoundingClientRect());
          const x = e.clientX - rect.left;
          const index = computeScrubIndex(x, rect.width, scrubbableUrls.length);
          const curr = imageEmbedContainer.querySelector<HTMLImageElement>(
            '.slideshow-img-current'
          );
          if (!curr) return;
          // A changed src means a visibly different frame — except when
          // cacheExternalImage has just swapped this same frame's raw URL for a
          // blob:, which always has beforeSrc equal to the raw target.
          const target = scrubbableUrls[index];
          const beforeSrc = curr.src;
          applyScrubImage(curr, target);
          if (curr.src !== beforeSrc && beforeSrc !== target)
            dropZoomOnFrameChange();
        },
        { signal, passive: true }
      );

      imageEl.addEventListener(
        'pointerleave',
        (e: PointerEvent) => {
          if (!isHoverPointer(e)) return;
          // Don't reset while image viewer is open (overlay triggers pointerleave)
          if (this.viewerClones.has(imageEmbedContainer)) return;
          // pointerleave fires when the pointer moves onto the URL button, which is not a
          // descendant of the cover. Leaving into the dead zone is not leaving the cover.
          const deadRect = getDeadRect();
          if (deadRect && pointInRect(e, deadRect)) return;
          imageEl.classList.remove('scrub-hover');
          // Invalidate cached rect for next hover (handles resize)
          cachedRect = null;
          cachedDeadRect = undefined;
          const curr = imageEmbedContainer.querySelector<HTMLImageElement>(
            '.slideshow-img-current'
          );
          if (!curr) return;
          curr.removeClass('scrub-loading');
          const firstUrl = scrubbableUrls[0];
          if (!firstUrl) return;
          // First image is pre-validated, always show it
          curr.removeClass('dynamic-views-hidden');
          const beforeSrc = curr.src;
          curr.src = getCachedBlobUrl(firstUrl);
          if (curr.src !== beforeSrc && beforeSrc !== firstUrl)
            dropZoomOnFrameChange();
          // Sync touch state back to index 0
          resetSwipeNavigation?.();
        },
        { signal }
      );

      // Touch scrubbing: horizontal swipe across a multi-image cover or thumbnail
      const scrubAnimDuration = (() => {
        const v = parseInt(
          getComputedStyle(imageEl).getPropertyValue('--anim-duration-moderate')
        );
        return !isNaN(v) && v > 0 ? v : undefined;
      })();
      resetSwipeNavigation = setupTouchSwipeNavigation({
        scrubEl: imageEl,
        cardEl,
        imageUrls: scrubbableUrls,
        signal: signal!,
        preloadSignal: signal!,
        preloadGuard,
        animationDuration: scrubAnimDuration,
        brokenHandler: scrubBrokenHandler,
        onReduced: markSingle,
        onFrameChange: dropZoomOnFrameChange,
      });
      observeScrubReset(imageEl, resetSwipeNavigation);
      signal?.addEventListener(
        'abort',
        () => {
          resetSwipeNavigation?.();
          unobserveScrubReset(imageEl);
        },
        { once: true }
      );
    }
  }

  /** Update title text node without destroying child elements (extension suffix) */
  public updateTitleText(
    cardEl: HTMLElement,
    card: CardData,
    entry: BasesEntry,
    settings: ResolvedSettings
  ): void {
    const titleTextEl = cardEl.querySelector<HTMLElement>('.card-title-text');
    if (!titleTextEl) return;

    const { displayTitle, isTitleEmpty } =
      SharedCardRenderer.resolveTitleDisplay(card, entry, settings);

    // Find first text node — preserves child elements (.card-title-ext-suffix)
    const textNode = Array.from(titleTextEl.childNodes).find(
      (n) => n.nodeType === Node.TEXT_NODE
    );
    if (textNode) {
      textNode.textContent = displayTitle || '';
    } else if (displayTitle) {
      const extSuffix = titleTextEl.querySelector('.card-title-ext-suffix');
      const newTextNode = cardEl.ownerDocument.createTextNode(displayTitle);
      if (extSuffix) {
        titleTextEl.insertBefore(newTextNode, extSuffix);
      } else {
        titleTextEl.appendChild(newTextNode);
      }
    }

    titleTextEl.classList.toggle('empty-value-marker', isTitleEmpty);
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
    settings: ResolvedSettings
  ): void {
    this.updateTitleText(cardEl, card, entry, settings);
    this.rerenderSubtitle(cardEl, card, entry, settings);
    this.rerenderProperties(cardEl, card, entry, settings);
    updateTextPreviewDOM(cardEl, card.textPreview || '');
    const previewEl = cardEl.querySelector<HTMLElement>('.card-text-preview');
    if (previewEl) applyPerParagraphClamp(previewEl);
    this.updateUrlButton(cardEl, card);
    // Last — updateUrlButton() is the final body mutation, and every class here
    // is derived from the DOM the calls above just rewrote.
    syncStructuralClasses(
      cardEl,
      cardEl.querySelector<HTMLElement>('.card-body')
    );
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

  /** Resolve display title, detecting empty values for the marker. */
  private static resolveTitleDisplay(
    card: CardData,
    entry: BasesEntry,
    settings: ResolvedSettings
  ): { displayTitle: string; isTitleEmpty: boolean } {
    const titleProp = settings.titleProperty || '';
    const titleHasExtension =
      titleProp === 'file.name' || titleProp === 'file.fullname';
    const rawTitle = titleHasExtension ? entry.file.basename : card.title;
    const isTitleEmpty = !rawTitle && !!settings.titleProperty;
    const displayTitle = isTitleEmpty ? getEmptyValueMarker() : rawTitle;
    return { displayTitle, isTitleEmpty };
  }

  /**
   * Build the URL button anchor inside a card header.
   *
   * Shared by the render path and updateUrlButton(). The caller owns the
   * listener lifecycle and passes its own signal — the per-render controller at
   * render time, the per-card urlButtonRerenderController on update — so the two
   * lifecycles stay distinct without branching in here.
   */
  /**
   * Point an existing URL button at a URL: href, tooltip label, external-link
   * attributes, drag ghost text, and the dataset copy the drag and
   * context-menu handlers read so a surgical update needs no re-binding.
   *
   * `clearNonWebAttrs` is the one real difference between the two callers. A
   * freshly created anchor has no target/rel to remove, while one being updated
   * may still carry them from a web URL that has since become a custom URI.
   */
  private static applyUrlToButton(
    iconEl: HTMLAnchorElement,
    urlValue: string,
    clearNonWebAttrs: boolean
  ): void {
    iconEl.href = urlValue;
    iconEl.setAttribute('aria-label', urlValue);
    if (/^https?:\/\//i.test(urlValue)) {
      iconEl.target = '_blank';
      iconEl.rel = 'noopener noreferrer';
    } else if (clearNonWebAttrs) {
      iconEl.removeAttribute('target');
      iconEl.removeAttribute('rel');
    }
    const dragText = iconEl.querySelector('.dynamic-views-drag-text');
    if (dragText) dragText.textContent = urlValue;
    iconEl.dataset.dynamicViewsUrlValue = urlValue;
  }

  private createUrlIcon(
    headerEl: HTMLElement,
    urlValue: string,
    cardPath: string,
    signal: AbortSignal
  ): HTMLAnchorElement {
    const iconEl = headerEl.createEl('a', {
      cls: 'card-title-url-icon text-icon-button svg-icon',
    });
    setIcon(iconEl, 'arrow-up-right');
    // Hidden text for native link drag ghost — Chromium uses textContent
    // to generate the 2-line ghost (title + URL). Without text, only the
    // SVG icon appears as the ghost. Created before the applier fills it, and
    // after setIcon(), which owns the element's existing children.
    iconEl.createSpan('dynamic-views-drag-text');
    SharedCardRenderer.applyUrlToButton(iconEl, urlValue, false);

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
        const file = this.app.vault.getAbstractFileByPath(cardPath);
        if (!(file instanceof TFile)) return;
        showFileContextMenu(
          e,
          this.app,
          file,
          cardPath,
          iconEl.dataset.dynamicViewsUrlValue ?? urlValue
        );
      },
      { signal }
    );
    const urlDrag = createUrlButtonDragHandlers(this.app, iconEl, urlValue);
    iconEl.addEventListener('dragstart', urlDrag.onDragStart, { signal });
    iconEl.addEventListener('dragend', urlDrag.onDragEnd, { signal });
    iconEl.addEventListener('touchstart', urlDrag.onTouchStart, {
      signal,
      passive: true,
    });
    return iconEl;
  }

  /** Surgically update URL button in card header */
  private updateUrlButton(cardEl: HTMLElement, card: CardData): void {
    const headerEl = cardEl.querySelector<HTMLElement>('.card-header');
    const existingIcon =
      cardEl.querySelector<HTMLAnchorElement>(URL_ICON_SELECTOR);

    if (card.hasValidUrl && card.urlValue) {
      if (existingIcon) {
        SharedCardRenderer.applyUrlToButton(existingIcon, card.urlValue, true);
      } else {
        // A card with no header is the displayFirstAsTitle-OFF case: nothing was
        // renderable at render time, so the header has to be created now or the
        // URL button never appears until a full re-render.
        const targetEl = headerEl ?? prependHeader(cardEl);
        if (targetEl) {
          this.urlButtonRerenderController.get(cardEl)?.abort();
          const urlButtonAbort = new AbortController();
          this.urlButtonRerenderController.set(cardEl, urlButtonAbort);
          this.createUrlIcon(
            targetEl,
            card.urlValue,
            card.path,
            urlButtonAbort.signal
          );
        }
      }
    } else if (existingIcon) {
      this.urlButtonRerenderController.get(cardEl)?.abort();
      this.urlButtonRerenderController.delete(cardEl);
      existingIcon.remove();
      // Mirror of the creation path: a header the URL button was the sole
      // occupant of would otherwise keep holding its --size-2-3 gap open forever.
      if (headerEl && headerEl.childElementCount === 0) headerEl.remove();
    }

    // has-url-icon / has-header are re-derived by syncStructuralClasses(),
    // which updateCardContent() runs after this call.
  }

  /**
   * Surgically replace property DOM within an existing card.
   * Used by property-reorder fast path to avoid full card re-render.
   */
  public rerenderProperties(
    cardEl: HTMLElement,
    card: CardData,
    entry: BasesEntry,
    settings: ResolvedSettings
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
    settings: ResolvedSettings
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
      { ...settings, propertyNames: 'hide' },
      shouldHideMissingProperties(),
      getHideEmptyMode(),
      propAbort.signal,
      true,
      // isTimestampProperty covers file timestamps only; the flag catches a
      // frontmatter date property
      isTimestampProperty(settings.subtitleProperty, settings) ||
        card.subtitleIsDate === true
    );

    // Restore scroll gradients on subtitle. Same single-line gate as the initial
    // render — the CSS only scrolls single-line subtitles.
    if (
      settings.subtitleLines === 1 &&
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
    settings: ResolvedSettings,
    signal: AbortSignal
  ): void {
    const props = card.properties;
    if (!props || props.length === 0) return;

    // Parse override lists for O(1) lookup
    const invertPairingSet = parsePropertyList(settings.invertPropertyPairing);

    const excludeSet = getPropertiesRenderedElsewhere(settings);

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
      isDate?: boolean;
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
          settings.propertyNames
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
        isDate?: boolean;
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
    const namesAbove = settings.propertyNames === 'above';
    const topPropertiesEl =
      topSets.length > 0
        ? cardEl.createDiv(
            `card-properties card-properties-top${namesAbove ? ' names-above' : ''}`
          )
        : null;
    const bottomPropertiesEl =
      bottomSets.length > 0
        ? cardEl.createDiv(
            `card-properties card-properties-bottom${namesAbove ? ' names-above' : ''}`
          )
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
            settings.propertyNames
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
      } else if (settings.propertyNames === 'hide') {
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
                signal,
                false,
                isTimestampProperty(item.name, settings) || item.isDate === true
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
              signal,
              false,
              isTimestampProperty(item.name, settings) || item.isDate === true
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
    settings: ResolvedSettings,
    hideMissing: boolean,
    hideEmptyMode: HideEmptyMode,
    signal: AbortSignal,
    preserveNewlines = false,
    // Splits a formatted date into segments so separators can be dimmed — set for
    // both property rows and subtitles
    renderDateSegments = false
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
      if (hideEmptyMode === 'names-hidden' && settings.propertyNames === 'hide')
        return;
    }

    // Render property name if property names are enabled
    if (settings.propertyNames === 'above') {
      const labelEl = container.createDiv('property-name');
      labelEl.textContent = getPropertyDisplayName(
        propertyName,
        settings._displayNameMap
      );
      container.addClass('has-name');
    }

    // Add inline name if enabled (as sibling, before property-content)
    if (settings.propertyNames === 'inline') {
      const labelSpan = container.createSpan('property-name-inline');
      labelSpan.textContent =
        getPropertyDisplayName(propertyName, settings._displayNameMap) + ' ';
      container.addClass('has-name-inline');
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
      if (settings.propertyNames === 'hide') {
        const iconName = getTimestampIcon(propertyName, settings);
        const iconEl = timestampWrapper.createSpan('timestamp-icon');
        setIcon(iconEl, iconName);
        timestampWrapper.classList.add('has-timestamp-icon');
      }
      if (renderDateSegments) {
        appendDateSegments(timestampWrapper, stringValue);
      } else {
        timestampWrapper.appendText(stringValue);
      }

      // One-shot: measure icon alignment from first real timestamp
      // Deferred to rAF so the browser has laid out the new elements
      if (settings.propertyNames === 'hide' && !this.iconAlignmentMeasured) {
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
      // Strip newlines from regular property values (subtitles preserve them — CSS handles display)
      const renderedValue = preserveNewlines
        ? stringValue
        : stringValue.replace(/\n/g, ' ');
      if (renderDateSegments) {
        // A formatted date carries no links, so link parsing is skipped
        appendDateSegments(textWrapper, renderedValue);
      } else {
        this.renderTextWithLinks(textWrapper, renderedValue, card.path, signal);
      }
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
