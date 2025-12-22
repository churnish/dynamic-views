/**
 * Shared slideshow utilities
 * Extracts common logic between card-renderer.tsx and shared-renderer.ts
 */

import { SLIDESHOW_ANIMATION_MS } from "./constants";

// Gesture detection thresholds
const WHEEL_SWIPE_THRESHOLD = 5; // Accumulated deltaX to trigger navigation
const WHEEL_ACCEL_THRESHOLD = 5; // Minimum deltaX to detect acceleration
const WHEEL_ACCEL_OFFSET = 2; // Delta increase to count as acceleration
const TOUCH_DETECT_THRESHOLD = 10; // Movement to determine swipe direction
const TOUCH_SWIPE_THRESHOLD = 30; // Distance to trigger navigation

export interface SlideshowElements {
  imageEmbed: HTMLElement;
  currImg: HTMLImageElement;
  nextImg: HTMLImageElement;
}

export interface SlideshowCallbacks {
  onSlideChange?: (newIndex: number, nextImg: HTMLImageElement) => void;
  onAnimationComplete?: () => void;
}

/**
 * Creates a slideshow navigator with shared logic
 * Returns navigate function and current state
 */
// Time window to detect "undo" navigation (First→Last→First)
const UNDO_WINDOW_MS = 2500;

export function createSlideshowNavigator(
  imageUrls: string[],
  getElements: () => SlideshowElements | null,
  signal: AbortSignal,
  callbacks?: SlideshowCallbacks,
): {
  navigate: (direction: 1 | -1, honorGestureDirection?: boolean) => void;
} {
  let currentIndex = 0;
  let isAnimating = false;
  let lastWrapFromFirstTimestamp: number | null = null;

  const navigate = (direction: 1 | -1, honorGestureDirection = false) => {
    if (isAnimating || signal.aborted || imageUrls.length === 0) return;

    let newIndex = currentIndex + direction;
    if (newIndex < 0) newIndex = imageUrls.length - 1;
    if (newIndex >= imageUrls.length) newIndex = 0;

    // Skip animation for single-image slideshows
    if (newIndex === currentIndex) return;

    const elements = getElements();
    if (!elements) {
      isAnimating = false;
      return;
    }

    const { imageEmbed, currImg, nextImg } = elements;
    const newUrl = imageUrls[newIndex];

    isAnimating = true;

    // Notify about slide change (for ambient color, etc.)
    if (callbacks?.onSlideChange) {
      nextImg.addEventListener(
        "load",
        () => {
          if (!signal.aborted) {
            callbacks.onSlideChange!(newIndex, nextImg);
          }
        },
        { once: true, signal },
      );
    }

    // Set next image src and CSS variable
    nextImg.src = newUrl;
    imageEmbed.style.setProperty("--cover-image-url", `url("${newUrl}")`);

    // Check if this is an "undo" of recent First→Last navigation
    // Must check BEFORE updating the timestamp
    const isRecentUndo =
      lastWrapFromFirstTimestamp !== null &&
      Date.now() - lastWrapFromFirstTimestamp < UNDO_WINDOW_MS;

    // Track wrap from first to last (for detecting "undo" sequences)
    const isWrapFromFirst =
      direction === -1 &&
      currentIndex === 0 &&
      newIndex === imageUrls.length - 1;

    // Update timestamp: set when wrapping First→Last, clear otherwise
    if (isWrapFromFirst) {
      lastWrapFromFirstTimestamp = Date.now();
    } else {
      lastWrapFromFirstTimestamp = null;
    }

    // Detect wrap from last to first - animate in reverse to signal "rewind"
    // Only reverse for 3+ images; with 2 images alternating direction feels glitchy
    // Skip reversal when honoring gesture direction (scroll/swipe)
    // Skip reversal when undoing recent First→Last navigation
    const isWrapToFirst =
      !honorGestureDirection &&
      !isRecentUndo &&
      direction === 1 &&
      currentIndex === imageUrls.length - 1 &&
      newIndex === 0 &&
      imageUrls.length >= 3;

    // Normal: next=left, prev=right. Last→first wrap: reverse direction
    const slideLeft = direction === 1 && !isWrapToFirst;
    const exitClass = slideLeft
      ? "slideshow-exit-left"
      : "slideshow-exit-right";
    const enterClass = slideLeft
      ? "slideshow-enter-left"
      : "slideshow-enter-right";

    currImg.classList.add(exitClass);
    nextImg.classList.add(enterClass);

    const timeoutId = setTimeout(() => {
      if (signal.aborted) return;

      // Remove animation classes
      currImg.classList.remove(exitClass);
      nextImg.classList.remove(enterClass);

      // Swap roles
      currImg.classList.remove("slideshow-img-current");
      currImg.classList.add("slideshow-img-next");
      nextImg.classList.remove("slideshow-img-next");
      nextImg.classList.add("slideshow-img-current");

      // Clear src on the now-next element
      currImg.src = "";

      currentIndex = newIndex;
      isAnimating = false;

      if (callbacks?.onAnimationComplete) {
        callbacks.onAnimationComplete();
      }
    }, SLIDESHOW_ANIMATION_MS);

    // Clean up on abort: clear timeout and remove animation classes
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeoutId);
        currImg.classList.remove(exitClass);
        nextImg.classList.remove(enterClass);
      },
      { once: true },
    );
  };

  return { navigate };
}

/**
 * Setup swipe gestures for slideshow navigation
 */
export function setupSwipeGestures(
  coverEl: HTMLElement,
  navigate: (direction: 1 | -1, honorGestureDirection?: boolean) => void,
  signal: AbortSignal,
): void {
  let accumulatedDeltaX = 0;
  let lastDeltaX = 0;
  let navigatedThisGesture = false;

  // Wheel events capture trackpad swipes
  coverEl.addEventListener(
    "wheel",
    (e) => {
      // Ignore predominantly vertical scrolling
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) return;

      const deltaX = e.deltaX;

      // Detect new gesture: direction change or acceleration (new swipe starts faster)
      const directionChanged =
        lastDeltaX !== 0 && Math.sign(deltaX) !== Math.sign(lastDeltaX);
      const accelerated =
        Math.abs(deltaX) > Math.abs(lastDeltaX) + WHEEL_ACCEL_OFFSET &&
        Math.abs(deltaX) > WHEEL_ACCEL_THRESHOLD;

      if (directionChanged || accelerated) {
        accumulatedDeltaX = 0;
        navigatedThisGesture = false;
      }

      lastDeltaX = deltaX;
      accumulatedDeltaX += deltaX;

      // Navigate once per gesture when threshold hit
      // Positive deltaX = next slide (trackpad convention)
      if (
        !navigatedThisGesture &&
        Math.abs(accumulatedDeltaX) >= WHEEL_SWIPE_THRESHOLD
      ) {
        navigate(accumulatedDeltaX > 0 ? 1 : -1, true);
        navigatedThisGesture = true;
      }

      // Prevent vertical scroll for horizontal swipes
      e.preventDefault();
    },
    { signal },
  );

  // Touch swipes for mobile
  let touchStartX = 0;
  let touchStartY = 0;
  let touchNavigated = false;
  let isHorizontalSwipe = false;

  // Get indicator element for hiding during swipe (mobile only)
  const indicator = coverEl.querySelector(
    ".slideshow-indicator",
  ) as HTMLElement;
  const isMobile = document.body.classList.contains("is-mobile");

  coverEl.addEventListener(
    "touchstart",
    (e) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchNavigated = false;
      isHorizontalSwipe = false;
      // Stop sidebar from detecting swipe start
      e.stopPropagation();
      e.stopImmediatePropagation();
    },
    { signal, capture: true },
  );

  coverEl.addEventListener(
    "touchmove",
    (e) => {
      const deltaX = e.touches[0].clientX - touchStartX;
      const deltaY = e.touches[0].clientY - touchStartY;

      // Determine swipe direction on first significant movement
      if (!isHorizontalSwipe && Math.abs(deltaX) > TOUCH_DETECT_THRESHOLD) {
        isHorizontalSwipe = Math.abs(deltaX) > Math.abs(deltaY);
      }

      // Prevent vertical scroll and sidebar swipe for horizontal swipes
      if (isHorizontalSwipe) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        // Hide indicator on horizontal swipe (mobile only)
        if (isMobile && indicator && indicator.style.opacity !== "0") {
          indicator.style.opacity = "0";
        }

        // Navigate once threshold is hit
        // Swipe right (positive deltaX) = previous slide (natural scrolling convention)
        if (!touchNavigated && Math.abs(deltaX) >= TOUCH_SWIPE_THRESHOLD) {
          navigate(deltaX > 0 ? -1 : 1, true);
          touchNavigated = true;
        }
      }
    },
    { signal, capture: true },
  );

  // Show indicator again when view is scrolled vertically (mobile only)
  if (isMobile) {
    const viewContainer = coverEl.closest(".dynamic-views");
    if (viewContainer) {
      viewContainer.addEventListener(
        "scroll",
        () => {
          if (indicator) indicator.style.opacity = "1";
        },
        { signal, passive: true },
      );
    }
  }
}

/**
 * Preload images on first hover
 */
export function setupImagePreload(
  cardEl: HTMLElement,
  imageUrls: string[],
  signal: AbortSignal,
): void {
  let preloaded = false;

  cardEl.addEventListener(
    "mouseenter",
    () => {
      if (!preloaded) {
        preloaded = true;
        imageUrls.slice(1).forEach((url) => {
          const img = new Image();
          img.src = url;
        });
      }
    },
    { once: true, signal },
  );
}
