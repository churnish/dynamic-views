/**
 * Touch scrubbing + shared visibility reset IO for multi-image thumbnails.
 */

import { getCachedBlobUrl, preloadImageBatch } from './slideshow';
import { isTouchPointer } from './hover-and-touch';
import { getOwnerWindow } from '../utils/owner-window';

// ── Pure helpers ──────────────────────────────────────────────────────────

/** Clamp-safe scrub index from pointer X position within a thumbnail of `width`. */
export function computeScrubIndex(
  x: number,
  width: number,
  count: number
): number {
  return Math.max(0, Math.min(Math.floor((x / width) * count), count - 1));
}

/** Resolve blob URL and apply to img element with loading state management. */
export function applyScrubImage(imgEl: HTMLImageElement, rawUrl: string): void {
  const resolvedUrl = getCachedBlobUrl(rawUrl);
  if (resolvedUrl === rawUrl && rawUrl.startsWith('http')) {
    // Uncached external — hide img so placeholder background shows
    if (imgEl.src !== resolvedUrl) {
      imgEl.addClass('scrub-loading');
      imgEl.src = resolvedUrl;
      imgEl.addEventListener('load', () => imgEl.removeClass('scrub-loading'), {
        once: true,
      });
    }
  } else {
    imgEl.removeClass('scrub-loading');
    imgEl.removeClass('dynamic-views-hidden');
    if (imgEl.src !== resolvedUrl) imgEl.src = resolvedUrl;
  }
}

// ── Touch scrubbing lifecycle ─────────────────────────────────────────────

export interface TouchScrubOptions {
  thumbEl: HTMLElement;
  imgEl: HTMLImageElement;
  cardEl: HTMLElement;
  /** Mutable array — spliced by brokenHandler when images fail validation. */
  imageUrls: string[];
  /** Touch listener cleanup signal. */
  signal: AbortSignal;
  /** preloadImageBatch signal. */
  preloadSignal: AbortSignal;
  preloadGuard: { done: boolean };
  brokenHandler: (url: string) => void;
}

/** Wire up pointerdown/move/up/cancel for touch swipe-to-advance on a thumbnail.
 * One swipe = one image change. Swipe right = next, swipe left = previous.
 * Returns a callback to reset the persistent swipe index (for IO scroll-out reset). */
export function setupTouchScrubbing(opts: TouchScrubOptions): () => void {
  let touchStartX = 0;
  let touchScrubbing = false;
  /** Persistent index across swipes — reset by IO scroll-out observer. */
  let currentIndex = 0;

  const { thumbEl, imgEl, imageUrls, signal } = opts;

  thumbEl.addEventListener(
    'pointerdown',
    (e: PointerEvent) => {
      if (!isTouchPointer(e)) return;
      touchStartX = e.clientX;
      touchScrubbing = false;
      // Preload images on first touch
      if (!opts.preloadGuard.done) {
        opts.preloadGuard.done = true;
        preloadImageBatch(imageUrls, opts.preloadSignal, opts.brokenHandler);
      }
    },
    { signal, passive: true }
  );

  thumbEl.addEventListener(
    'pointermove',
    (e: PointerEvent) => {
      if (!isTouchPointer(e) || touchScrubbing) return;
      const deltaX = e.clientX - touchStartX;
      if (Math.abs(deltaX) <= 10) return;

      // One swipe = one image change, then lock until pointerup
      touchScrubbing = true;
      thumbEl.classList.add('scrub-hover');
      const newIndex =
        deltaX > 0
          ? Math.min(currentIndex + 1, imageUrls.length - 1)
          : Math.max(currentIndex - 1, 0);
      if (newIndex !== currentIndex) {
        currentIndex = newIndex;
        applyScrubImage(imgEl, imageUrls[currentIndex]);
        thumbEl.dataset.scrubbedSrc = getCachedBlobUrl(imageUrls[currentIndex]);
      }
    },
    { signal, passive: true }
  );

  thumbEl.addEventListener(
    'pointerup',
    (e: PointerEvent) => {
      if (!isTouchPointer(e)) return;
      if (touchScrubbing) {
        thumbEl.classList.remove('scrub-hover');
        // Suppress next click (card open / image viewer)
        opts.cardEl.addEventListener(
          'click',
          (ev) => {
            ev.stopPropagation();
            ev.preventDefault();
          },
          { once: true, capture: true }
        );
      }
      touchScrubbing = false;
    },
    { signal, passive: true }
  );

  thumbEl.addEventListener(
    'pointercancel',
    (e: PointerEvent) => {
      if (!isTouchPointer(e)) return;
      thumbEl.classList.remove('scrub-hover');
      touchScrubbing = false;
    },
    { signal, passive: true }
  );

  return () => {
    currentIndex = 0;
  };
}

// ── Shared IntersectionObserver for thumbnail visibility reset ─────────

const resetObservers = new WeakMap<Window, IntersectionObserver>();
const resetState = new WeakMap<
  HTMLElement,
  {
    imgEl: HTMLImageElement;
    imageUrls: string[];
    wasHidden: boolean;
    onReset?: () => void;
  }
>();

/** Get or create a shared per-window IO for thumbnail visibility reset. */
function getResetObserver(
  win: Window & typeof globalThis
): IntersectionObserver {
  let observer = resetObservers.get(win);
  if (observer) return observer;

  observer = new win.IntersectionObserver(
    (entries) => {
      // Shared IO fires with batched entries — iterate ALL, not just [0]
      for (const entry of entries) {
        const state = resetState.get(entry.target as HTMLElement);
        if (!state) continue;
        if (!entry.isIntersecting) {
          state.wasHidden = true;
        } else if (state.wasHidden) {
          state.wasHidden = false;
          state.imgEl.removeClass('scrub-loading');
          const firstUrl = state.imageUrls[0];
          if (firstUrl) {
            state.imgEl.removeClass('dynamic-views-hidden');
            state.imgEl.src = getCachedBlobUrl(firstUrl);
          }
          delete (entry.target as HTMLElement).dataset.scrubbedSrc;
          state.onReset?.();
        }
      }
    },
    { threshold: 0 }
  );
  resetObservers.set(win, observer);
  return observer;
}

/** Start observing a thumbnail for visibility-based image reset. */
export function observeThumbnailReset(
  thumbEl: HTMLElement,
  imgEl: HTMLImageElement,
  imageUrls: string[],
  onReset?: () => void
): void {
  resetState.set(thumbEl, { imgEl, imageUrls, wasHidden: false, onReset });
  getResetObserver(getOwnerWindow(thumbEl)).observe(thumbEl);
}

/** Stop observing a thumbnail for visibility-based image reset. */
export function unobserveThumbnailReset(thumbEl: HTMLElement): void {
  const win = getOwnerWindow(thumbEl);
  const observer = resetObservers.get(win);
  if (observer) observer.unobserve(thumbEl);
  resetState.delete(thumbEl);
}
