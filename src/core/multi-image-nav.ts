/**
 * Touch swipe navigation + shared visibility reset IO for multi-image covers
 * and thumbnails.
 *
 * Touch and hover are different interactions here: touch commits one image per
 * swipe (this file), while positional scrubbing is hover-only and lives in the
 * renderer's pointermove handler. `computeScrubIndex` and `applyScrubImage`
 * serve that hover path; everything else here is swipe.
 */

import { getCachedBlobUrl, preloadImageBatch } from './slideshow';
import { isTouchPointer } from './hover-and-touch';
import { getOwnerWindow, type OwnerWindow } from '../utils/owner-window';
import { markImageBroken } from './image-loader';
import {
  addScrollIndicatorRestore,
  claimIndicator,
  releaseIndicator,
} from './multi-image-icon';
import { SCRUB_DIRECTION_THRESHOLD, SLIDESHOW_ANIMATION_MS } from './constants';

// ── Pure helpers ──────────────────────────────────────────────────────────

/** Clamp-safe scrub index from pointer X position within an element of `width`. */
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

// ── Slide animation state ───────────────────────────────────────────────

interface ThumbnailAnimState {
  isAnimating: boolean;
  timeout: number | null;
  exitClass: string;
  enterClass: string;
}

/** Finish the current slide animation immediately: remove classes, swap
 *  image roles, clear src on the now-next element, reset state. */
function finishSlideAnimation(
  state: ThumbnailAnimState,
  scrubEl: HTMLElement
): void {
  if (!state.isAnimating) return;

  if (state.timeout !== null) {
    window.clearTimeout(state.timeout);
    state.timeout = null;
  }

  const currImg = scrubEl.querySelector<HTMLImageElement>(
    '.slideshow-img-current'
  );
  const nextImg = scrubEl.querySelector<HTMLImageElement>(
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

// ── Touch swipe lifecycle ─────────────────────────────────────────────────

export interface TouchSwipeOptions {
  scrubEl: HTMLElement;
  cardEl: HTMLElement;
  /** Mutable array — spliced by brokenHandler when images fail validation. */
  imageUrls: string[];
  /** Touch listener cleanup signal. */
  signal: AbortSignal;
  /** preloadImageBatch signal. */
  preloadSignal: AbortSignal;
  preloadGuard: { done: boolean };
  brokenHandler: (url: string) => void;
  /** Called when the set drops to one valid image, so the caller can strip the
   *  multi-image affordances its format needs. */
  onReduced?: () => void;
  /** Called when a swipe commits a new frame, so the caller can drop hover-zoom
   *  eligibility. Matters on hybrid devices where a trackpad hover and a touch
   *  swipe both reach the same card. */
  onFrameChange?: () => void;
  /** Pre-read animation duration (ms). Avoids per-card getComputedStyle. */
  animationDuration?: number;
}

/** Wire up pointerdown/move/up/cancel for touch swipe-to-advance on a cover or thumbnail.
 * One swipe = one image change. Swipe left = next, swipe right = previous (natural scrolling).
 * Returns a comprehensive reset function for IO scroll-out reset and cleanup. */
export function setupTouchSwipeNavigation(opts: TouchSwipeOptions): () => void {
  let touchStartX = 0;
  let touchStartY = 0;
  let swipeActive = false;
  /** Once gesture direction is decided (horizontal or vertical), lock it for the touch. */
  let directionLocked = false;
  /** Persistent index across swipes — reset by IO scroll-out observer. */
  let currentIndex = 0;

  const { scrubEl, imageUrls, signal } = opts;

  // Lazy-cached indicator — created after setupTouchSwipeNavigation returns
  let indicator: HTMLElement | null = null;
  const scrollContainer = scrubEl.closest<HTMLElement>('.bases-view');

  const animationDuration = opts.animationDuration ?? SLIDESHOW_ANIMATION_MS;

  const animState: ThumbnailAnimState = {
    isAnimating: false,
    timeout: null,
    exitClass: '',
    enterClass: '',
  };

  scrubEl.addEventListener(
    'pointerdown',
    (e: PointerEvent) => {
      if (!isTouchPointer(e)) return;
      touchStartX = e.clientX;
      touchStartY = e.clientY;
      swipeActive = false;
      directionLocked = false;
      // Preload images on first touch
      if (!opts.preloadGuard.done) {
        opts.preloadGuard.done = true;
        preloadImageBatch(imageUrls, opts.preloadSignal, opts.brokenHandler);
      }
    },
    { signal, passive: true }
  );

  scrubEl.addEventListener(
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
      // First axis to cross threshold wins — vertical locks out the swipe entirely
      directionLocked = true;
      if (absY >= absX) return;

      // A zero-length set would make the wrap modulo below produce NaN. The hover
      // path guards this at its own entry; this path had no equivalent.
      if (imageUrls.length === 0) return;

      // One swipe = one image change, then lock until pointerup
      // Swipe left (negative deltaX) = next, swipe right = previous (natural scrolling)
      swipeActive = true;
      // Freeze scroll container to prevent vertical drift during horizontal swipe
      if (scrollContainer)
        scrollContainer.classList.add('dynamic-views-scroll-locked');
      scrubEl.classList.add('scrub-hover');
      // Hide multi-image indicator during the swipe (lazy query — indicator created after setup).
      // claimIndicator restores the previously hidden indicator (exclusivity).
      indicator ??= scrubEl.querySelector<HTMLElement>(
        '.thumbnail-indicator, .slideshow-icon'
      );
      if (indicator) {
        claimIndicator(indicator);
        indicator.classList.add('dynamic-views-icon-hidden');
      }
      const len = imageUrls.length;
      // A swipe always wraps, unlike the hover path, which clamps
      const newIndex =
        deltaX > 0 ? (currentIndex - 1 + len) % len : (currentIndex + 1) % len;
      if (newIndex !== currentIndex) {
        // Cancel any in-flight animation before starting a new one
        if (animState.isAnimating) {
          finishSlideAnimation(animState, scrubEl);
        }

        const currImg = scrubEl.querySelector<HTMLImageElement>(
          '.slideshow-img-current'
        );
        const nextImg = scrubEl.querySelector<HTMLImageElement>(
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
              opts.onReduced?.();
            }
            finishSlideAnimation(animState, scrubEl);
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
        opts.onFrameChange?.();

        animState.timeout = window.setTimeout(() => {
          animState.timeout = null;
          finishSlideAnimation(animState, scrubEl);
          scrubEl.dataset.scrubbedSrc = getCachedBlobUrl(
            imageUrls[currentIndex]
          );
        }, animationDuration);
      }
    },
    { signal, passive: true }
  );

  scrubEl.addEventListener(
    'pointerup',
    (e: PointerEvent) => {
      if (!isTouchPointer(e)) return;
      if (swipeActive) {
        scrubEl.classList.remove('scrub-hover');
        if (scrollContainer)
          scrollContainer.classList.remove('dynamic-views-scroll-locked');
        // Suppress the click synthesized from this touch (card open / image viewer).
        // Auto-remove after 300ms — swipes don't always generate a click on WebKit,
        // so a stale handler would eat the user's next deliberate tap.
        const suppress = (ev: MouseEvent) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        opts.cardEl.addEventListener('click', suppress, {
          once: true,
          capture: true,
        });
        window.setTimeout(
          () =>
            opts.cardEl.removeEventListener('click', suppress, {
              capture: true,
            }),
          300
        );
      }
      swipeActive = false;
      directionLocked = false;
    },
    { signal, passive: true }
  );

  scrubEl.addEventListener(
    'pointercancel',
    (e: PointerEvent) => {
      if (!isTouchPointer(e)) return;
      scrubEl.classList.remove('scrub-hover');
      if (scrollContainer)
        scrollContainer.classList.remove('dynamic-views-scroll-locked');
      swipeActive = false;
      directionLocked = false;
    },
    { signal, passive: true }
  );

  // Block vertical scroll during an active horizontal swipe (direction lock prevents false positives)
  scrubEl.addEventListener(
    'touchmove',
    (e: TouchEvent) => {
      if (swipeActive) e.preventDefault();
    },
    { signal, passive: false }
  );

  // Restore indicator icon on next vertical scroll
  if (scrollContainer) {
    addScrollIndicatorRestore(
      scrollContainer,
      () => releaseIndicator(indicator),
      signal
    );
  }

  // Comprehensive reset: cancel animation, reset index, restore images and scroll state
  return () => {
    if (animState.isAnimating) {
      finishSlideAnimation(animState, scrubEl);
    }
    scrubEl.classList.remove('scrub-hover');
    if (scrollContainer)
      scrollContainer.classList.remove('dynamic-views-scroll-locked');
    swipeActive = false;
    directionLocked = false;
    currentIndex = 0;
    const currImg = scrubEl.querySelector<HTMLImageElement>(
      '.slideshow-img-current'
    );
    if (currImg) {
      currImg.removeClass('scrub-loading');
      currImg.removeClass('dynamic-views-hidden');
      if (imageUrls[0]) {
        currImg.src = getCachedBlobUrl(imageUrls[0]);
      }
    }
    const nextImg = scrubEl.querySelector<HTMLImageElement>(
      '.slideshow-img-next'
    );
    if (nextImg) nextImg.src = '';
    delete scrubEl.dataset.scrubbedSrc;
  };
}

// ── Shared IntersectionObserver for scrub visibility reset ─────────────

const resetObservers = new WeakMap<Window, IntersectionObserver>();
const resetState = new WeakMap<
  HTMLElement,
  {
    wasHidden: boolean;
    onReset: () => void;
  }
>();

/** Get or create a shared per-window IO for scrub visibility reset. */
function getResetObserver(win: OwnerWindow): IntersectionObserver {
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

/** Start observing a cover or thumbnail for visibility-based image reset. */
export function observeScrubReset(
  thumbEl: HTMLElement,
  onReset: () => void
): void {
  resetState.set(thumbEl, { wasHidden: false, onReset });
  getResetObserver(getOwnerWindow(thumbEl)).observe(thumbEl);
}

/** Stop observing a cover or thumbnail for visibility-based image reset. */
export function unobserveScrubReset(thumbEl: HTMLElement): void {
  const win = getOwnerWindow(thumbEl);
  const observer = resetObservers.get(win);
  if (observer) observer.unobserve(thumbEl);
  resetState.delete(thumbEl);
}
