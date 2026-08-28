/** Poster image format utilities — smart content clipping for static mode and scroll reset for interactive mode. */

import {
  applyParagraphClamp,
  clearParagraphClampState,
  measureParagraphClamp,
  type ParagraphClampMeasurement,
} from './text-preview-dom';
import { getOwnerWindow, type OwnerWindow } from '../utils/owner-window';
import { CONTENT_HIDDEN_CLASS } from './content-visibility';
import { URL_ICON_SELECTOR } from './constants';
import { setInteractSource } from './hover-and-touch';

const CLIP_HIDDEN_CLASS = 'poster-clip-hidden';
const HAS_PARAGRAPHS_CLASS = 'has-paragraphs';
const TEXT_PREVIEW_LINES_VAR = '--dynamic-views-text-preview-lines';
const TITLE_LINES_VAR = '--dynamic-views-title-lines';
const SUBTITLE_LINES_VAR = '--dynamic-views-subtitle-lines';
const INTERACTIVE_SELECTOR =
  'a, button, input, select, textarea, .tag, .path-segment, .path-separator, .clickable-icon, .multi-select-pill, .checkbox-container';
const TEXT_TARGET_SELECTOR =
  '.card-subtitle, .card-text-preview-text, .card-text-preview p, .property-name, .property-name-inline, .property-content';

/**
 * Calculates how many full lines fit in the available height and applies
 * a line clamp via CSS variable. Returns the applied line count, or 0 if
 * not even one line fits.
 *
 * `cap` is the inherited line count from the container — clipping may only ever
 * reduce a line count, never raise it above what the user configured. `NaN` means
 * no container value exists, so the fitted count wins.
 */
function clampToFit(
  el: HTMLElement,
  availableHeight: number,
  lineHeight: number,
  cssVar: string,
  cap: number
): number {
  if (!lineHeight || lineHeight <= 0) return 0;
  const fits = Math.floor(availableHeight / lineHeight);
  if (fits < 1) return 0;
  const applied = isNaN(cap) ? fits : Math.min(fits, cap);
  el.setCssProps({ [cssVar]: String(applied) });
  return applied;
}

/** Handles poster tap-to-reveal toggle. Returns true if the event was consumed. */
export function handlePosterTapReveal(
  e: MouseEvent,
  cardEl: HTMLElement,
  openOnTitle: boolean
): boolean {
  if (!cardEl.querySelector('.card-poster')) return false;

  const target = e.target as HTMLElement;
  const isInteractive = target.closest(INTERACTIVE_SELECTOR);
  const win = getOwnerWindow(cardEl);
  const hasTextSelection = (win.getSelection()?.toString().length ?? 0) > 0;
  const isTextTarget = openOnTitle && target.closest(TEXT_TARGET_SELECTOR);

  if (!cardEl.classList.contains('poster-revealed')) {
    e.preventDefault();
    e.stopPropagation();
    const prevRevealed = cardEl
      .closest('.dynamic-views')
      ?.querySelector<HTMLElement>('.card.poster-revealed');
    if (prevRevealed) {
      prevRevealed.classList.remove('poster-revealed');
      setInteractSource(prevRevealed, 'reveal', false);
      resetPosterScroll(prevRevealed);
    }
    cardEl.classList.add('poster-revealed');
    // The reveal source, never the hover source — a finger tap must not turn on
    // the image zoom that keys on interact-hover.
    setInteractSource(cardEl, 'reveal', true);
    return true;
  }

  if (!isInteractive && !isTextTarget && !hasTextSelection) {
    e.stopPropagation();
    cardEl.classList.remove('poster-revealed');
    setInteractSource(cardEl, 'reveal', false);
    resetPosterScroll(cardEl);
    return true;
  }

  return false;
}

// -- Internal types for batched poster clipping --

interface PosterClipPrepared {
  contentEl: HTMLElement;
  titleEl: HTMLElement | null;
  subtitleEl: HTMLElement | null;
  clippable: HTMLElement[];
  textPreviewEl: HTMLElement | null;
  textPreviewWrapper: HTMLElement | null;
  /** Empty unless keep-newlines split the preview into <p> children. */
  paragraphs: HTMLElement[];
}

/** Inherited line-count caps from the view container — clipping may only reduce, never raise. */
interface PosterLineCaps {
  titleLinesCap: number;
  subtitleLinesCap: number;
  textPreviewLinesCap: number;
}

interface PosterClipMeasured extends PosterLineCaps {
  clipBottom: number;
  rects: DOMRect[];
  titleRect: DOMRect | undefined;
  textPreviewLineHeight: number;
  subtitleLineHeight: number;
  titleLineHeight: number;
}

/**
 * Reads the container's line-count caps. Hoisted out of the per-card measure so a
 * batch pays one container style read instead of K. See poster.md invariant 12.
 */
function readPosterLineCaps(
  containerEl: Element | null,
  win: OwnerWindow
): PosterLineCaps {
  const containerStyle = containerEl ? win.getComputedStyle(containerEl) : null;
  const readCap = (v: string) =>
    parseInt(containerStyle?.getPropertyValue(v) ?? '', 10);
  return {
    titleLinesCap: readCap(TITLE_LINES_VAR),
    subtitleLinesCap: readCap(SUBTITLE_LINES_VAR),
    textPreviewLinesCap: readCap(TEXT_PREVIEW_LINES_VAR),
  };
}

/** Clears previous clip state and collects clippable elements. Returns null if clipping is inapplicable. */
function clearPosterClipState(cardEl: HTMLElement): PosterClipPrepared | null {
  // Content-hidden cards measure at zero height, so clipping them is meaningless
  // work — the same guard the card ResizeObserver applies. Consequence: a hidden
  // card now keeps whatever clip state it had rather than having it cleared. Both
  // states are wrong (nothing re-clips on reveal — the IntersectionObserver only
  // toggles the class), but stale clipping is the cheaper of the two.
  if (cardEl.classList.contains(CONTENT_HIDDEN_CLASS)) return null;

  for (const el of cardEl.querySelectorAll<HTMLElement>(
    `.${CLIP_HIDDEN_CLASS}`
  )) {
    el.classList.remove(CLIP_HIDDEN_CLASS);
  }

  const contentEl = cardEl.querySelector<HTMLElement>('.card-content');
  if (!contentEl) return null;

  const titleEl = contentEl.querySelector<HTMLElement>('.card-title');
  if (titleEl) titleEl.style.removeProperty(TITLE_LINES_VAR);

  const clippable: HTMLElement[] = [];

  let subtitleEl: HTMLElement | null = null;
  const header = contentEl.querySelector('.card-header');
  if (header) {
    subtitleEl = header.querySelector<HTMLElement>('.card-subtitle');
    if (subtitleEl) {
      subtitleEl.style.removeProperty(SUBTITLE_LINES_VAR);
      clippable.push(subtitleEl);
    }
    const urlIcon = header.querySelector<HTMLElement>(URL_ICON_SELECTOR);
    if (urlIcon) clippable.push(urlIcon);
  }

  const propsTop = contentEl.querySelector('.card-properties-top');
  if (propsTop) {
    for (const child of propsTop.children) {
      clippable.push(child as HTMLElement);
    }
  }

  const textPreviewWrapper = contentEl.querySelector<HTMLElement>(
    '.card-text-preview-wrapper'
  );
  if (textPreviewWrapper) clippable.push(textPreviewWrapper);

  const propsBottom = contentEl.querySelector('.card-properties-bottom');
  if (propsBottom) {
    for (const child of propsBottom.children) {
      clippable.push(child as HTMLElement);
    }
  }

  if (clippable.length === 0 && !titleEl) return null;

  const textPreviewEl =
    textPreviewWrapper?.querySelector<HTMLElement>('.card-text-preview') ??
    null;
  let paragraphs: HTMLElement[] = [];
  if (textPreviewEl) {
    textPreviewEl.style.removeProperty(TEXT_PREVIEW_LINES_VAR);
    if (textPreviewEl.classList.contains(HAS_PARAGRAPHS_CLASS)) {
      // Clear only — the paragraph re-clamp is deferred to its own read/write
      // pair so a batch does not interleave reads into this write phase.
      paragraphs = clearParagraphClampState(textPreviewEl);
    }
  }

  return {
    contentEl,
    titleEl,
    subtitleEl,
    clippable,
    textPreviewEl,
    textPreviewWrapper,
    paragraphs,
  };
}

/** Read phase — paragraph clamp inputs for a prepared card. Null when the preview has no paragraphs. */
function measurePreparedParagraphClamp(
  prepared: PosterClipPrepared
): ParagraphClampMeasurement | null {
  const { textPreviewEl, paragraphs } = prepared;
  if (!textPreviewEl || paragraphs.length === 0) return null;
  return measureParagraphClamp(textPreviewEl, paragraphs);
}

/** Reads all geometry needed for clip decisions. Returns null if no overflow. */
function measurePosterClipGeometry(
  cardEl: HTMLElement,
  prepared: PosterClipPrepared,
  caps: PosterLineCaps
): PosterClipMeasured | null {
  const { contentEl, titleEl, subtitleEl, clippable, textPreviewEl } = prepared;

  if (contentEl.scrollHeight <= contentEl.clientHeight) return null;

  const clipBottom =
    contentEl.getBoundingClientRect().top + contentEl.clientHeight;

  const rects = clippable.map((el) => el.getBoundingClientRect());
  const titleRect = titleEl?.getBoundingClientRect();

  const win = getOwnerWindow(cardEl);
  const textPreviewLineHeight = textPreviewEl
    ? parseFloat(win.getComputedStyle(textPreviewEl).lineHeight)
    : 0;
  const subtitleLineHeight = subtitleEl
    ? parseFloat(win.getComputedStyle(subtitleEl).lineHeight)
    : 0;
  const titleLineHeight = titleEl
    ? parseFloat(win.getComputedStyle(titleEl).lineHeight)
    : 0;

  return {
    clipBottom,
    rects,
    titleRect,
    textPreviewLineHeight,
    subtitleLineHeight,
    titleLineHeight,
    ...caps,
  };
}

/** Applies hide/clamp decisions based on pre-measured geometry. */
function applyPosterClipDecisions(
  prepared: PosterClipPrepared,
  measured: PosterClipMeasured,
  paragraphClamp: ParagraphClampMeasurement | null
): void {
  const { titleEl, subtitleEl, clippable, textPreviewEl, textPreviewWrapper } =
    prepared;
  const {
    clipBottom,
    rects,
    titleRect,
    textPreviewLineHeight,
    subtitleLineHeight,
    titleLineHeight,
    titleLinesCap,
    subtitleLinesCap,
    textPreviewLinesCap,
  } = measured;

  for (let i = clippable.length - 1; i >= 0; i--) {
    const rect = rects[i];
    if (rect.bottom <= clipBottom) break;

    const el = clippable[i];

    if (rect.top < clipBottom) {
      const availableHeight = clipBottom - rect.top;

      if (el === textPreviewWrapper && textPreviewEl) {
        const fittedLines = clampToFit(
          textPreviewEl,
          availableHeight,
          textPreviewLineHeight,
          TEXT_PREVIEW_LINES_VAR,
          textPreviewLinesCap
        );
        if (fittedLines > 0) {
          // Re-clamp from the paragraph heights measured before any clamp was
          // applied — they are budget-independent, so the reduced fitted count
          // needs no second measure pass inside this write phase.
          if (paragraphClamp) applyParagraphClamp(paragraphClamp, fittedLines);
          continue;
        }
      }

      if (
        el === subtitleEl &&
        clampToFit(
          el,
          availableHeight,
          subtitleLineHeight,
          SUBTITLE_LINES_VAR,
          subtitleLinesCap
        ) > 0
      ) {
        continue;
      }
    }

    el.classList.add(CLIP_HIDDEN_CLASS);
  }

  if (titleEl && titleRect && titleRect.bottom > clipBottom) {
    const availableHeight = clipBottom - titleRect.top;
    if (availableHeight > 0) {
      clampToFit(
        titleEl,
        availableHeight,
        titleLineHeight,
        TITLE_LINES_VAR,
        titleLinesCap
      );
    }
  }
}

/**
 * Measures card-content and hides bottom-up elements that don't fit.
 * For partially-visible text elements, reduces line clamp instead of hiding.
 */
export function clipPosterStaticOverflow(cardEl: HTMLElement): void {
  const prepared = clearPosterClipState(cardEl);
  if (!prepared) return;
  const paragraphClamp = measurePreparedParagraphClamp(prepared);
  // Paragraphs must carry their container-budget clamp before the poster
  // geometry read — measuring unclamped text inflates scrollHeight and shifts
  // every rect below the preview, changing which elements get hidden.
  if (paragraphClamp) applyParagraphClamp(paragraphClamp);
  const caps = readPosterLineCaps(
    cardEl.closest('.dynamic-views'),
    getOwnerWindow(cardEl)
  );
  const measured = measurePosterClipGeometry(cardEl, prepared, caps);
  if (!measured) return;
  applyPosterClipDecisions(prepared, measured, paragraphClamp);
}

/**
 * Batched version — five phases across all cards, two forced reflows total:
 * clear → read paragraph metrics → clamp paragraphs → read poster geometry → clip.
 */
export function clipPosterStaticOverflowBatch(cards: HTMLElement[]): void {
  // Phase 1 (write): clear poster overrides and paragraph clamp state
  const prepared = cards.map((c) => clearPosterClipState(c));

  // Phase 2 (read): paragraph line heights, budgets and unclamped heights
  const paragraphClamps = prepared.map((p) =>
    p ? measurePreparedParagraphClamp(p) : null
  );

  // Phase 3 (write): clamp paragraphs to the container budget
  for (const clamp of paragraphClamps) {
    if (clamp) applyParagraphClamp(clamp);
  }

  // Caps are per-container, and a compact-stacked batch is collected per document
  // — it can span two views with different line settings, so memoize instead of
  // reading once off the first card.
  const capsByContainer = new Map<Element | null, PosterLineCaps>();
  const capsFor = (cardEl: HTMLElement): PosterLineCaps => {
    const containerEl = cardEl.closest('.dynamic-views');
    let caps = capsByContainer.get(containerEl);
    if (!caps) {
      caps = readPosterLineCaps(containerEl, getOwnerWindow(cardEl));
      capsByContainer.set(containerEl, caps);
    }
    return caps;
  };

  // Phase 4 (read): poster geometry and container caps
  const measured = prepared.map((p, i) =>
    p ? measurePosterClipGeometry(cards[i], p, capsFor(cards[i])) : null
  );

  // Phase 5 (write): clip decisions
  for (let i = 0; i < cards.length; i++) {
    if (prepared[i] && measured[i])
      applyPosterClipDecisions(prepared[i]!, measured[i]!, paragraphClamps[i]);
  }
}

/**
 * Removes all poster clip state, restoring original visibility. Takes an array
 * because its only call site loops over every poster card in a container — the
 * paragraph re-clamp reads layout, so a per-card variant would cost K reflows.
 */
export function resetPosterClipping(cards: HTMLElement[]): void {
  // Phase 1 (write): drop every clip override and paragraph clamp
  const paragraphTargets: Array<{
    el: HTMLElement;
    paragraphs: HTMLElement[];
  }> = [];

  for (const cardEl of cards) {
    for (const el of cardEl.querySelectorAll<HTMLElement>(
      `.${CLIP_HIDDEN_CLASS}`
    )) {
      el.classList.remove(CLIP_HIDDEN_CLASS);
    }

    // Reset text preview line clamp override
    const textPreviewEl =
      cardEl.querySelector<HTMLElement>('.card-text-preview');
    if (textPreviewEl) {
      textPreviewEl.style.removeProperty(TEXT_PREVIEW_LINES_VAR);
      if (textPreviewEl.classList.contains(HAS_PARAGRAPHS_CLASS)) {
        paragraphTargets.push({
          el: textPreviewEl,
          paragraphs: clearParagraphClampState(textPreviewEl),
        });
      }
    }

    // Reset title line clamp override
    const titleEl = cardEl.querySelector<HTMLElement>('.card-title');
    if (titleEl) {
      titleEl.style.removeProperty(TITLE_LINES_VAR);
    }

    // Reset subtitle line clamp override
    const subtitleEl = cardEl.querySelector<HTMLElement>('.card-subtitle');
    if (subtitleEl) {
      subtitleEl.style.removeProperty(SUBTITLE_LINES_VAR);
    }
  }

  // Phase 2 (read): paragraph metrics at the restored container budget
  const clamps: ParagraphClampMeasurement[] = [];
  for (const { el, paragraphs } of paragraphTargets) {
    const clamp = measureParagraphClamp(el, paragraphs);
    if (clamp) clamps.push(clamp);
  }

  // Phase 3 (write): re-clamp paragraphs
  for (const clamp of clamps) {
    applyParagraphClamp(clamp);
  }
}

/** Resets vertical and horizontal scroll positions on a poster card after the exit transition finishes. */
export function resetPosterScroll(cardEl: HTMLElement): void {
  const contentEl = cardEl.querySelector<HTMLElement>('.card-content');
  if (!contentEl) return;

  const reset = () => {
    contentEl.scrollTop = 0;
    for (const wrapper of cardEl.querySelectorAll(
      '.property-content-wrapper'
    )) {
      wrapper.scrollLeft = 0;
    }
  };

  // Defer until the exit transition (opacity + transform) completes.
  // Timeout fallback in case transitionend doesn't fire (element removed, display: none, etc.)
  const win = getOwnerWindow(contentEl);
  const duration =
    parseFloat(win.getComputedStyle(contentEl).transitionDuration) * 1000 ||
    300;
  let settled = false;
  const fallback = window.setTimeout(() => {
    if (!settled) {
      settled = true;
      reset();
    }
  }, duration + 50);

  const onEnd = (e: TransitionEvent) => {
    if (e.target !== contentEl) return;
    if (settled) return;
    settled = true;
    window.clearTimeout(fallback);
    contentEl.removeEventListener('transitionend', onEnd);
    reset();
  };
  contentEl.addEventListener('transitionend', onEnd);
}
