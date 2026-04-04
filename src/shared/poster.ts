/** Poster image format utilities — smart content clipping for static mode and scroll reset for interactive mode. */

import { applyPerParagraphClamp } from './text-preview-dom';
import { getOwnerWindow } from '../utils/owner-window';

const CLIP_HIDDEN_CLASS = 'poster-clip-hidden';
const CLIP_CLAMPED_CLASS = 'poster-clip-clamped';
const HAS_PARAGRAPHS_CLASS = 'has-paragraphs';
const TEXT_PREVIEW_LINES_VAR = '--dynamic-views-text-preview-lines';
const TITLE_LINES_VAR = '--dynamic-views-title-lines';
const SUBTITLE_LINES_VAR = '--dynamic-views-subtitle-lines';

/**
 * Calculates how many full lines fit in the available height and applies
 * a line clamp via CSS variable. Returns true if at least 1 line fits.
 */
function clampToFit(
  el: HTMLElement,
  availableHeight: number,
  win: Window,
  cssVar: string
): boolean {
  const lineHeight = parseFloat(win.getComputedStyle(el).lineHeight);
  if (!lineHeight || lineHeight <= 0) return false;
  const maxLines = Math.floor(availableHeight / lineHeight);
  if (maxLines < 1) return false;
  el.setCssProps({ [cssVar]: String(maxLines) });
  return true;
}

/**
 * Measures card-content and hides bottom-up elements that don't fit.
 * For partially-visible text elements, reduces line clamp instead of hiding.
 */
export function clipPosterStaticOverflow(cardEl: HTMLElement): void {
  const contentEl = cardEl.querySelector<HTMLElement>('.card-content');
  if (!contentEl) return;
  if (!cardEl.classList.contains('has-poster')) return;
  if (contentEl.scrollHeight <= contentEl.clientHeight) return;

  const win = getOwnerWindow(cardEl);
  const clipBottom =
    contentEl.getBoundingClientRect().top + contentEl.clientHeight;

  // Title is always visible but can be line-clamped to fit
  const titleEl = contentEl.querySelector<HTMLElement>('.card-title');

  // Collect clippable elements in DOM order (title handled separately)
  const clippable: HTMLElement[] = [];

  const header = contentEl.querySelector('.card-header');
  if (header) {
    const subtitle = header.querySelector<HTMLElement>('.card-subtitle');
    if (subtitle) clippable.push(subtitle);
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

  if (clippable.length === 0 && !titleEl) return;

  // Batch-read all rects (one forced reflow)
  const rects = clippable.map((el) => el.getBoundingClientRect());
  const titleRect = titleEl?.getBoundingClientRect();

  // Iterate reverse: hide elements whose bottom exceeds the clip boundary
  for (let i = clippable.length - 1; i >= 0; i--) {
    const rect = rects[i];
    if (rect.bottom <= clipBottom) break;

    const el = clippable[i];

    // Partially visible: try line-clamping text elements instead of hiding
    if (rect.top < clipBottom) {
      const availableHeight = clipBottom - rect.top;

      if (el === textPreviewWrapper) {
        const textPreviewEl =
          el.querySelector<HTMLElement>('.card-text-preview');
        if (
          textPreviewEl &&
          clampToFit(
            textPreviewEl,
            availableHeight,
            win,
            TEXT_PREVIEW_LINES_VAR
          )
        ) {
          if (textPreviewEl.classList.contains(HAS_PARAGRAPHS_CLASS)) {
            applyPerParagraphClamp(textPreviewEl);
          }
          continue;
        }
      }

      if (el.classList.contains('card-subtitle')) {
        if (clampToFit(el, availableHeight, win, SUBTITLE_LINES_VAR)) {
          el.classList.add(CLIP_CLAMPED_CLASS);
          continue;
        }
      }
    }

    el.classList.add(CLIP_HIDDEN_CLASS);
  }

  // Title: never hidden, but reduce line clamp if it overflows
  if (titleEl && titleRect && titleRect.bottom > clipBottom) {
    const availableHeight = clipBottom - titleRect.top;
    if (availableHeight > 0) {
      clampToFit(titleEl, availableHeight, win, TITLE_LINES_VAR);
    }
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
    subtitleEl.classList.remove(CLIP_CLAMPED_CLASS);
    subtitleEl.style.removeProperty(SUBTITLE_LINES_VAR);
  }
}

/** Resets vertical and horizontal scroll positions on a poster card after the exit transition finishes. */
export function resetPosterScroll(cardEl: HTMLElement): void {
  const contentEl = cardEl.querySelector<HTMLElement>('.card-content');
  if (!contentEl) return;

  const reset = () => {
    contentEl.scrollTop = 0;
    for (const wrapper of cardEl.querySelectorAll('.property-content-wrapper')) {
      wrapper.scrollLeft = 0;
    }
  };

  // Defer until the exit transition (opacity + transform) completes.
  // Timeout fallback in case transitionend doesn't fire (element removed, display: none, etc.)
  const duration = parseFloat(getComputedStyle(contentEl).transitionDuration) * 1000 || 300;
  let settled = false;
  const fallback = setTimeout(() => {
    if (!settled) {
      settled = true;
      reset();
    }
  }, duration + 50);

  contentEl.addEventListener(
    'transitionend',
    (e) => {
      if (e.target !== contentEl) return;
      if (settled) return;
      settled = true;
      clearTimeout(fallback);
      reset();
    },
    { once: true }
  );
}
