/**
 * Touch scrubbing + shared visibility reset IO for multi-image thumbnails.
 */

import { getCachedBlobUrl, preloadImageBatch } from './slideshow';
import { isTouchPointer } from './hover-and-touch';
import { getOwnerWindow } from '../utils/owner-window';
import { markImageBroken } from './image-loader';
import { SCROLL_THROTTLE_MS, SLIDESHOW_ANIMATION_MS } from './constants';
import { isThumbnailLoopingDisabled } from '../utils/style-settings';

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

// ── Thumbnail animation state ────────────────────────────────────────────

interface ThumbnailAnimState {
  isAnimating: boolean;
  timeout: ReturnType<typeof setTimeout> | null;
  exitClass: string;
  enterClass: string;
}

/** Finish the current thumbnail animation immediately: remove classes, swap
 *  image roles, clear src on the now-next element, reset state. */
function finishThumbnailAnimation(
  state: ThumbnailAnimState,
  thumbEl: HTMLElement
): void {
  if (!state.isAnimating) return;

  if (state.timeout !== null) {
    clearTimeout(state.timeout);
    state.timeout = null;
  }

  const currImg = thumbEl.querySelector<HTMLImageElement>(
    '.slideshow-img-current'
  );
  const nextImg = thumbEl.querySelector<HTMLImageElement>(
    '.slideshow-img-next'
  );
  if (!currImg || !nextImg) {
    state.isAnimating = false;
    return;
  }

  // Remove animation classes
  if (state.exitClass) currImg.classList.remove(state.exitClass);
  if (state.enterClass) nextImg.classList.remove(state.enterClass);

  // Swap roles
  currImg.classList.remove('slideshow-img-current');
  currImg.classList.add('slideshow-img-next');
  nextImg.classList.remove('slideshow-img-next');
  nextImg.classList.add('slideshow-img-current');

  // Clear src on the now-next element
  currImg.src = '';

  state.exitClass = '';
  state.enterClass = '';
  state.isAnimating = false;
}

// ── Touch scrubbing lifecycle ─────────────────────────────────────────────

export interface TouchScrubOptions {
  thumbEl: HTMLElement;
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
 * One swipe = one image change. Swipe left = next, swipe right = previous (natural scrolling).
 * Returns a comprehensive reset function for IO scroll-out reset and cleanup. */
export function setupTouchScrubbing(opts: TouchScrubOptions): () => void {
  let touchStartX = 0;
  let touchScrubbing = false;
  /** Persistent index across swipes — reset by IO scroll-out observer. */
  let currentIndex = 0;

  const { thumbEl, imageUrls, signal } = opts;

  // Lazy-cached indicator — created after setupTouchScrubbing returns
  let indicator: HTMLElement | null = null;
  const scrollContainer = thumbEl.closest('.bases-view');

  // Read animation duration from CSS variable once at setup
  let animationDuration = SLIDESHOW_ANIMATION_MS;
  const cssValue = getOwnerWindow(thumbEl)
    .getComputedStyle(thumbEl)
    .getPropertyValue('--anim-duration-moderate');
  const parsed = parseInt(cssValue);
  if (!isNaN(parsed) && parsed > 0) {
    animationDuration = parsed;
  }

  const animState: ThumbnailAnimState = {
    isAnimating: false,
    timeout: null,
    exitClass: '',
    enterClass: '',
  };

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
      // Swipe left (negative deltaX) = next, swipe right = previous (natural scrolling)
      touchScrubbing = true;
      thumbEl.classList.add('scrub-hover');
      // Hide multi-image indicator during swipe (lazy query — indicator created after setup)
      indicator ??= thumbEl.querySelector<HTMLElement>('.thumbnail-indicator');
      if (indicator) indicator.classList.add('dynamic-views-icon-hidden');
      const len = imageUrls.length;
      let newIndex: number;
      if (isThumbnailLoopingDisabled()) {
        newIndex =
          deltaX > 0
            ? Math.max(currentIndex - 1, 0)
            : Math.min(currentIndex + 1, len - 1);
      } else {
        newIndex =
          deltaX > 0
            ? (currentIndex - 1 + len) % len
            : (currentIndex + 1) % len;
      }
      if (newIndex !== currentIndex) {
        // Cancel any in-flight animation before starting a new one
        if (animState.isAnimating) {
          finishThumbnailAnimation(animState, thumbEl);
        }

        const currImg = thumbEl.querySelector<HTMLImageElement>(
          '.slideshow-img-current'
        );
        const nextImg = thumbEl.querySelector<HTMLImageElement>(
          '.slideshow-img-next'
        );
        if (!currImg || !nextImg) {
          currentIndex = newIndex;
          return;
        }

        // Load the destination image into the next element
        nextImg.src = getCachedBlobUrl(imageUrls[newIndex]);

        // One-time error handler for the next image during animation
        nextImg.addEventListener(
          'error',
          () => {
            if (!nextImg.src || nextImg.src === window.location.href) return;
            markImageBroken(nextImg.src);
            const idx = imageUrls.indexOf(nextImg.src);
            if (idx !== -1) imageUrls.splice(idx, 1);
            if (imageUrls.length <= 1) {
              thumbEl.classList.remove('multi-image');
            }
            finishThumbnailAnimation(animState, thumbEl);
          },
          { once: true }
        );

        // Content follows finger: right swipe → exit-right + enter-right
        //                         left swipe  → exit-left + enter-left
        const slideLeft = deltaX < 0;
        animState.exitClass = slideLeft
          ? 'slideshow-exit-left'
          : 'slideshow-exit-right';
        animState.enterClass = slideLeft
          ? 'slideshow-enter-left'
          : 'slideshow-enter-right';
        animState.isAnimating = true;

        currImg.classList.add(animState.exitClass);
        nextImg.classList.add(animState.enterClass);

        currentIndex = newIndex;

        animState.timeout = setTimeout(() => {
          animState.timeout = null;
          finishThumbnailAnimation(animState, thumbEl);
          thumbEl.dataset.scrubbedSrc = getCachedBlobUrl(
            imageUrls[currentIndex]
          );
        }, animationDuration);
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

  // Restore indicator icon on next vertical scroll
  if (scrollContainer) {
    let lastScrollTime = 0;
    scrollContainer.addEventListener(
      'scroll',
      () => {
        const now = Date.now();
        if (now - lastScrollTime < SCROLL_THROTTLE_MS) return;
        lastScrollTime = now;
        indicator?.classList.remove('dynamic-views-icon-hidden');
      },
      { signal, passive: true }
    );
  }

  // Comprehensive reset: cancel animation, reset index, restore images
  return () => {
    if (animState.isAnimating) {
      finishThumbnailAnimation(animState, thumbEl);
    }
    currentIndex = 0;
    const currImg = thumbEl.querySelector<HTMLImageElement>(
      '.slideshow-img-current'
    );
    if (currImg) {
      currImg.removeClass('scrub-loading');
      currImg.removeClass('dynamic-views-hidden');
      if (imageUrls[0]) {
        currImg.src = getCachedBlobUrl(imageUrls[0]);
      }
    }
    const nextImg = thumbEl.querySelector<HTMLImageElement>(
      '.slideshow-img-next'
    );
    if (nextImg) nextImg.src = '';
    delete thumbEl.dataset.scrubbedSrc;
  };
}

// ── Shared IntersectionObserver for thumbnail visibility reset ─────────

const resetObservers = new WeakMap<Window, IntersectionObserver>();
const resetState = new WeakMap<
  HTMLElement,
  {
    wasHidden: boolean;
    onReset: () => void;
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
          state.onReset();
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
  onReset: () => void
): void {
  resetState.set(thumbEl, { wasHidden: false, onReset });
  getResetObserver(getOwnerWindow(thumbEl)).observe(thumbEl);
}

/** Stop observing a thumbnail for visibility-based image reset. */
export function unobserveThumbnailReset(thumbEl: HTMLElement): void {
  const win = getOwnerWindow(thumbEl);
  const observer = resetObservers.get(win);
  if (observer) observer.unobserve(thumbEl);
  resetState.delete(thumbEl);
}
