/** Poster image format utilities — smart content clipping for static mode and scroll reset for interactive mode. */

import { applyPerParagraphClamp } from './text-preview-dom';
import { getOwnerWindow } from '../utils/owner-window';

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
 * a line clamp via CSS variable. Returns true if at least 1 line fits.
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
): boolean {
  if (!lineHeight || lineHeight <= 0) return false;
  const fits = Math.floor(availableHeight / lineHeight);
  if (fits < 1) return false;
  el.setCssProps({ [cssVar]: String(isNaN(cap) ? fits : Math.min(fits, cap)) });
  return true;
}

/** Handles poster tap-to-reveal toggle. Returns true if the event was consumed. */
export function handlePosterTapReveal(
  e: MouseEvent,
  cardEl: HTMLElement,
  openFileAction: string
): boolean {
  if (!cardEl.querySelector('.card-poster')) return false;

  const target = e.target as HTMLElement;
  const isInteractive = target.closest(INTERACTIVE_SELECTOR);
  // ownerDocument.defaultView per AGENTS.md safe exception for text selection
  const win = cardEl.ownerDocument.defaultView ?? window;
  const hasTextSelection = (win.getSelection()?.toString().length ?? 0) > 0;
  const isTextTarget =
    openFileAction === 'title' && target.closest(TEXT_TARGET_SELECTOR);

  if (!cardEl.classList.contains('poster-revealed')) {
    e.preventDefault();
    e.stopPropagation();
    const prevRevealed = cardEl
      .closest('.dynamic-views')
      ?.querySelector('.card.poster-revealed');
    if (prevRevealed) {
      prevRevealed.classList.remove('poster-revealed', 'interact');
      resetPosterScroll(prevRevealed as HTMLElement);
    }
    cardEl.classList.add('poster-revealed', 'interact');
    return true;
  }

  if (!isInteractive && !isTextTarget && !hasTextSelection) {
    e.stopPropagation();
    cardEl.classList.remove('poster-revealed', 'interact');
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
}

interface PosterClipMeasured {
  clipBottom: number;
  rects: DOMRect[];
  titleRect: DOMRect | undefined;
  textPreviewLineHeight: number;
  subtitleLineHeight: number;
  titleLineHeight: number;
  titleLinesCap: number;
  subtitleLinesCap: number;
  textPreviewLinesCap: number;
}

/** Clears previous clip state and collects clippable elements. Returns null if clipping is inapplicable. */
function clearPosterClipState(cardEl: HTMLElement): PosterClipPrepared | null {
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
    const urlIcon = header.querySelector<HTMLElement>('.card-title-url-icon');
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
  if (textPreviewEl) {
    textPreviewEl.style.removeProperty(TEXT_PREVIEW_LINES_VAR);
    if (textPreviewEl.classList.contains(HAS_PARAGRAPHS_CLASS)) {
      applyPerParagraphClamp(textPreviewEl);
    }
  }

  return {
    contentEl,
    titleEl,
    subtitleEl,
    clippable,
    textPreviewEl,
    textPreviewWrapper,
  };
}

/** Reads all geometry needed for clip decisions. Returns null if no overflow. */
function measurePosterClipGeometry(
  cardEl: HTMLElement,
  prepared: PosterClipPrepared
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

  // Inherited line-count caps — read once here (read phase) so the write phase
  // stays free of style reads. See poster.md invariant 6.
  const containerEl = cardEl.closest('.dynamic-views');
  const containerStyle = containerEl ? win.getComputedStyle(containerEl) : null;
  const readCap = (v: string) =>
    parseInt(containerStyle?.getPropertyValue(v) ?? '', 10);

  return {
    clipBottom,
    rects,
    titleRect,
    textPreviewLineHeight,
    subtitleLineHeight,
    titleLineHeight,
    titleLinesCap: readCap(TITLE_LINES_VAR),
    subtitleLinesCap: readCap(SUBTITLE_LINES_VAR),
    textPreviewLinesCap: readCap(TEXT_PREVIEW_LINES_VAR),
  };
}

/** Applies hide/clamp decisions based on pre-measured geometry. */
function applyPosterClipDecisions(
  prepared: PosterClipPrepared,
  measured: PosterClipMeasured
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

      if (el === textPreviewWrapper) {
        if (
          textPreviewEl &&
          clampToFit(
            textPreviewEl,
            availableHeight,
            textPreviewLineHeight,
            TEXT_PREVIEW_LINES_VAR,
            textPreviewLinesCap
          )
        ) {
          if (textPreviewEl.classList.contains(HAS_PARAGRAPHS_CLASS)) {
            applyPerParagraphClamp(textPreviewEl);
          }
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
        )
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
  const measured = measurePosterClipGeometry(cardEl, prepared);
  if (!measured) return;
  applyPosterClipDecisions(prepared, measured);
}

/** Batched version — separates clear/measure/apply phases across all cards to reduce layout thrashing. */
export function clipPosterStaticOverflowBatch(cards: HTMLElement[]): void {
  const prepared = cards.map((c) => clearPosterClipState(c));
  const measured = prepared.map((p, i) =>
    p ? measurePosterClipGeometry(cards[i], p) : null
  );
  for (let i = 0; i < cards.length; i++) {
    if (prepared[i] && measured[i])
      applyPosterClipDecisions(prepared[i]!, measured[i]!);
  }
}

/** Removes all poster clip state from a card, restoring original visibility. */
export function resetPosterClipping(cardEl: HTMLElement): void {
  for (const el of cardEl.querySelectorAll<HTMLElement>(
    `.${CLIP_HIDDEN_CLASS}`
  )) {
    el.classList.remove(CLIP_HIDDEN_CLASS);
  }

  // Reset text preview line clamp override
  const textPreviewEl = cardEl.querySelector<HTMLElement>('.card-text-preview');
  if (textPreviewEl) {
    textPreviewEl.style.removeProperty(TEXT_PREVIEW_LINES_VAR);
    if (textPreviewEl.classList.contains(HAS_PARAGRAPHS_CLASS)) {
      applyPerParagraphClamp(textPreviewEl);
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
