/**
 * Touch scrubbing + shared visibility reset IO for multi-image thumbnails.
 */

import { getCachedBlobUrl, preloadImageBatch } from './slideshow';
import { isTouchPointer } from './hover-and-touch';
import { getOwnerWindow } from '../utils/owner-window';
import { markImageBroken } from './image-loader';
import {
  SCRUB_DIRECTION_THRESHOLD,
  SCROLL_THROTTLE_MS,
  SLIDESHOW_ANIMATION_MS,
} from './constants';
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
  /** Pre-read animation duration (ms). Avoids per-card getComputedStyle. */
  animationDuration?: number;
}

/** Wire up pointerdown/move/up/cancel for touch swipe-to-advance on a thumbnail.
 * One swipe = one image change. Swipe left = next, swipe right = previous (natural scrolling).
 * Returns a comprehensive reset function for IO scroll-out reset and cleanup. */
export function setupTouchScrubbing(opts: TouchScrubOptions): () => void {
  let touchStartX = 0;
  let touchStartY = 0;
  let touchScrubbing = false;
  /** Once gesture direction is decided (horizontal or vertical), lock it for the touch. */
  let directionLocked = false;
  /** Persistent index across swipes — reset by IO scroll-out observer. */
  let currentIndex = 0;

  const { thumbEl, imageUrls, signal } = opts;

  // Lazy-cached indicator — created after setupTouchScrubbing returns
  let indicator: HTMLElement | null = null;
  const scrollContainer = thumbEl.closest<HTMLElement>('.bases-view');

  const animationDuration = opts.animationDuration ?? SLIDESHOW_ANIMATION_MS;

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
      touchStartY = e.clientY;
      touchScrubbing = false;
      directionLocked = false;
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
      if (!isTouchPointer(e) || directionLocked) return;
      const deltaX = e.clientX - touchStartX;
      const deltaY = e.clientY - touchStartY;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);
      if (
        absX <= SCRUB_DIRECTION_THRESHOLD &&
        absY <= SCRUB_DIRECTION_THRESHOLD
      )
        return;
      // First axis to cross threshold wins — vertical locks out scrub entirely
      directionLocked = true;
      if (absY >= absX) return;

      // One swipe = one image change, then lock until pointerup
      // Swipe left (negative deltaX) = next, swipe right = previous (natural scrolling)
      touchScrubbing = true;
      // Freeze scroll container to prevent vertical drift during horizontal swipe
      if (scrollContainer)
        scrollContainer.classList.add('dynamic-views-scroll-locked');
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
        if (scrollContainer)
          scrollContainer.classList.remove('dynamic-views-scroll-locked');
        // Suppress the click synthesized from this touch (card open / image viewer).
        // Auto-remove after 300ms — swipes don't always generate a click on iOS,
        // so a stale handler would eat the user's next deliberate tap.
        const suppress = (ev: MouseEvent) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        opts.cardEl.addEventListener('click', suppress, {
          once: true,
          capture: true,
        });
        setTimeout(
          () =>
            opts.cardEl.removeEventListener('click', suppress, {
              capture: true,
            }),
          300
        );
      }
      touchScrubbing = false;
      directionLocked = false;
    },
    { signal, passive: true }
  );

  thumbEl.addEventListener(
    'pointercancel',
    (e: PointerEvent) => {
      if (!isTouchPointer(e)) return;
      thumbEl.classList.remove('scrub-hover');
      if (scrollContainer)
        scrollContainer.classList.remove('dynamic-views-scroll-locked');
      touchScrubbing = false;
      directionLocked = false;
    },
    { signal, passive: true }
  );

  // Block vertical scroll during active horizontal scrub (direction lock prevents false positives)
  thumbEl.addEventListener(
    'touchmove',
    (e: TouchEvent) => {
      if (touchScrubbing) e.preventDefault();
    },
    { signal, passive: false }
  );

  // Restore indicator icon on next vertical scroll
  if (scrollContainer) {
    addScrollIndicatorRestore(
      scrollContainer,
      () => indicator?.classList.remove('dynamic-views-icon-hidden'),
      signal
    );
  }

  // Comprehensive reset: cancel animation, reset index, restore images and scroll state
  return () => {
    if (animState.isAnimating) {
      finishThumbnailAnimation(animState, thumbEl);
    }
    thumbEl.classList.remove('scrub-hover');
    if (scrollContainer)
      scrollContainer.classList.remove('dynamic-views-scroll-locked');
    touchScrubbing = false;
    directionLocked = false;
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

// ── Shared scroll listener for indicator icon restore ───────────────────

const scrollIndicatorCallbacks = new WeakMap<Element, Set<() => void>>();
const scrollThrottleState = new WeakMap<Element, number>();

function addScrollIndicatorRestore(
  scrollContainer: Element,
  callback: () => void,
  signal: AbortSignal
): void {
  let callbacks = scrollIndicatorCallbacks.get(scrollContainer);
  if (!callbacks) {
    callbacks = new Set();
    scrollIndicatorCallbacks.set(scrollContainer, callbacks);
    scrollContainer.addEventListener(
      'scroll',
      () => {
        const now = Date.now();
        const last = scrollThrottleState.get(scrollContainer) ?? 0;
        if (now - last < SCROLL_THROTTLE_MS) return;
        scrollThrottleState.set(scrollContainer, now);
        const cbs = scrollIndicatorCallbacks.get(scrollContainer);
        if (cbs) for (const cb of cbs) cb();
      },
      { passive: true }
    );
  }
  callbacks.add(callback);
  signal.addEventListener('abort', () => callbacks.delete(callback), {
    once: true,
  });
}
