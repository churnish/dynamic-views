/**
 * Shared slideshow utilities
 * Extracts common logic between card-renderer.tsx and shared-renderer.ts
 */

import {
  SLIDESHOW_ANIMATION_MS,
  SWIPE_DETECT_THRESHOLD,
  SCROLL_THROTTLE_MS,
} from "./constants";

// Time window to detect "undo" navigation (First→Last→First)
// If user wraps backward (First→Last) then forward (Last→First) within this window,
// animation direction is NOT reversed (treats it as accidental undo, not intentional wrap)
// Value chosen to match typical rapid navigation time while avoiding false positives
const UNDO_WINDOW_MS = 2500;

// Gesture detection thresholds
const WHEEL_SWIPE_THRESHOLD = 5; // Accumulated deltaX to trigger navigation
const WHEEL_GESTURE_GAP_MS = 150; // Quiet period fallback to detect gesture end
const TOUCH_SWIPE_THRESHOLD = 30; // Distance to trigger navigation

// Gesture boundary detection via peak + decay phase:
// After navigating, track peak |deltaX|. Enter "decay" when |dX| drops below
// peak × DECAY_RATIO. After DECAY_MIN_EVENTS in decay, detect new gesture when
// |dX| rises to ≥ decay minimum × RESUME_RATIO and ≥ RESUME_DELTA.
// Brief dips (< DECAY_MIN_EVENTS) are ignored as fluctuations in sustained swipes.
const WHEEL_DECAY_RATIO = 0.3;
const WHEEL_DECAY_MIN_EVENTS = 5;
const WHEEL_RESUME_RATIO = 3;
const WHEEL_RESUME_DELTA = 15;

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
export function createSlideshowNavigator(
  imageUrls: string[],
  getElements: () => SlideshowElements | null,
  signal: AbortSignal,
  callbacks?: SlideshowCallbacks,
): {
  navigate: (
    direction: 1 | -1,
    honorGestureDirection?: boolean,
    skipAnimation?: boolean,
  ) => void;
  reset: () => void;
} {
  let currentIndex = 0;
  let isAnimating = false;
  let lastWrapFromFirstTimestamp: number | null = null;

  // Read animation duration from CSS variable at runtime
  // Falls back to SLIDESHOW_ANIMATION_MS if variable not defined or invalid
  let animationDuration = SLIDESHOW_ANIMATION_MS;
  const elements = getElements();
  if (elements) {
    const cssValue = getComputedStyle(elements.imageEmbed).getPropertyValue(
      "--anim-duration-moderate",
    );
    const parsed = parseInt(cssValue);
    if (!isNaN(parsed) && parsed > 0) {
      animationDuration = parsed;
    }
  }

  // Track all pending timeouts for consolidated cleanup on abort
  const pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();

  // Track active animation state for cancel-and-restart
  let activeAnimationTimeout: ReturnType<typeof setTimeout> | null = null;
  let activeExitClass = "";
  let activeEnterClass = "";
  let activeNewIndex = 0;

  /**
   * Finishes the current animation immediately: removes classes, swaps image roles,
   * updates state. Called by normal timeout completion, cancel-and-restart, and abort.
   */
  const finishAnimation = () => {
    if (!isAnimating) return;

    const els = getElements();
    if (!els) {
      isAnimating = false;
      return;
    }
    const { currImg, nextImg } = els;

    // Clear the animation timeout
    if (activeAnimationTimeout !== null) {
      clearTimeout(activeAnimationTimeout);
      activeAnimationTimeout = null;
    }

    // Remove animation classes
    if (activeExitClass) currImg.classList.remove(activeExitClass);
    if (activeEnterClass) nextImg.classList.remove(activeEnterClass);

    // Swap roles
    currImg.classList.remove("slideshow-img-current");
    currImg.classList.add("slideshow-img-next");
    nextImg.classList.remove("slideshow-img-next");
    nextImg.classList.add("slideshow-img-current");

    // Clear src on the now-next element
    currImg.src = "";

    currentIndex = activeNewIndex;
    isAnimating = false;
  };

  signal.addEventListener(
    "abort",
    () => {
      finishAnimation();
      pendingTimeouts.forEach(clearTimeout);
      pendingTimeouts.clear();
    },
    { once: true },
  );

  // Track failed image indices to prevent infinite loop when all images fail
  const failedIndices = new Set<number>();

  const navigate = (
    direction: 1 | -1,
    honorGestureDirection = false,
    skipAnimation = false,
  ) => {
    if (signal.aborted || imageUrls.length <= 1) return;

    // Cancel-and-restart: snap current animation to end state
    if (isAnimating) {
      finishAnimation();
    }

    // Calculate next index with wraparound
    const current = currentIndex;
    let newIndex = current + direction;
    if (newIndex < 0) newIndex = imageUrls.length - 1;
    if (newIndex >= imageUrls.length) newIndex = 0;

    const elements = getElements();
    if (!elements) return;

    const { currImg, nextImg } = elements;
    const newUrl = imageUrls[newIndex];

    isAnimating = true;
    activeNewIndex = newIndex;

    // Notify about slide change
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

    // Handle failed images: hide and auto-advance
    // Use event target for URL comparison to avoid race with rapid navigation
    nextImg.addEventListener(
      "error",
      (e) => {
        if (signal.aborted) return;
        // Ignore errors from src being cleared (resolves to index.html) or changed
        // Only handle errors for the URL we actually set (use event target, not element ref)
        const targetSrc = (e.target as HTMLImageElement).src;
        if (targetSrc !== newUrl) return;

        // Track failed index to prevent infinite loop
        failedIndices.add(newIndex);
        if (failedIndices.size >= imageUrls.length) {
          // All images failed - stop trying
          isAnimating = false;
          return;
        }

        nextImg.addClass("dynamic-views-hidden");

        // After animation completes, try to advance to next slide
        const timeoutId = setTimeout(() => {
          pendingTimeouts.delete(timeoutId);
          if (!signal.aborted) {
            nextImg.removeClass("dynamic-views-hidden");
            isAnimating = false;
            navigate(direction, honorGestureDirection);
          }
        }, animationDuration + 50);
        pendingTimeouts.add(timeoutId);
      },
      { once: true, signal },
    );

    // Skip animation: directly update current image
    if (skipAnimation) {
      currImg.src = newUrl;
      currImg.removeClass("dynamic-views-hidden");
      currentIndex = newIndex;
      isAnimating = false;
      if (callbacks?.onSlideChange) {
        currImg.addEventListener(
          "load",
          () => {
            if (!signal.aborted) {
              callbacks.onSlideChange!(newIndex, currImg);
            }
          },
          { once: true, signal },
        );
      }
      return;
    }

    nextImg.src = newUrl;

    // Check if this is an "undo" of recent First→Last navigation
    // Must check BEFORE updating the timestamp
    const isRecentUndo =
      lastWrapFromFirstTimestamp !== null &&
      Date.now() - lastWrapFromFirstTimestamp < UNDO_WINDOW_MS;

    // Track wrap from first to last (for detecting "undo" sequences)
    const isWrapFromFirst =
      direction === -1 && current === 0 && newIndex === imageUrls.length - 1;

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
      current === imageUrls.length - 1 &&
      newIndex === 0 &&
      imageUrls.length >= 3;

    // Normal: next=left, prev=right. Last→first wrap: reverse direction
    const slideLeft = direction === 1 && !isWrapToFirst;
    activeExitClass = slideLeft
      ? "slideshow-exit-left"
      : "slideshow-exit-right";
    activeEnterClass = slideLeft
      ? "slideshow-enter-left"
      : "slideshow-enter-right";

    currImg.classList.add(activeExitClass);
    nextImg.classList.add(activeEnterClass);

    activeAnimationTimeout = setTimeout(() => {
      activeAnimationTimeout = null;
      if (signal.aborted) return;

      finishAnimation();

      if (callbacks?.onAnimationComplete) {
        callbacks.onAnimationComplete();
      }
    }, animationDuration);
  };

  // Reset to first slide (called when view becomes visible)
  const reset = () => {
    if (isAnimating) return;
    currentIndex = 0;
    lastWrapFromFirstTimestamp = null;
    failedIndices.clear();
    const elements = getElements();
    if (elements) {
      elements.currImg.src = imageUrls[0];
      // Trigger onSlideChange callback on reset
      if (callbacks?.onSlideChange) {
        elements.currImg.addEventListener(
          "load",
          () => {
            if (!signal.aborted) callbacks.onSlideChange!(0, elements.currImg);
          },
          { once: true, signal },
        );
      }
    }
  };

  return { navigate, reset };
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
  let gestureResetTimeout: ReturnType<typeof setTimeout> | null = null;
  // Peak + decay tracking for gesture boundary detection
  let peakSinceNav = 0;
  let inDecayPhase = false;
  let decayEventCount = 0;
  let minSinceDecay = Infinity;

  const resetGestureState = () => {
    peakSinceNav = 0;
    inDecayPhase = false;
    decayEventCount = 0;
    minSinceDecay = Infinity;
  };

  // Clean up gesture timeout on abort
  signal.addEventListener(
    "abort",
    () => {
      if (gestureResetTimeout) clearTimeout(gestureResetTimeout);
    },
    { once: true },
  );

  // Wheel events capture trackpad swipes
  coverEl.addEventListener(
    "wheel",
    (e) => {
      // Ignore predominantly vertical scrolling
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) return;

      const deltaX = e.deltaX;
      const absDelta = Math.abs(deltaX);

      // Quiet period: no wheel events for 150ms = gesture ended
      if (gestureResetTimeout) clearTimeout(gestureResetTimeout);
      gestureResetTimeout = setTimeout(() => {
        accumulatedDeltaX = 0;
        navigatedThisGesture = false;
        resetGestureState();
        gestureResetTimeout = null;
      }, WHEEL_GESTURE_GAP_MS);

      // Track peak |deltaX| since last navigation
      if (absDelta > peakSinceNav) peakSinceNav = absDelta;

      // Decay phase detection: |deltaX| dropped below 30% of peak
      const decayThreshold = peakSinceNav * WHEEL_DECAY_RATIO;
      if (!inDecayPhase && navigatedThisGesture && absDelta < decayThreshold) {
        inDecayPhase = true;
        decayEventCount = 0;
        minSinceDecay = absDelta;
      } else if (inDecayPhase) {
        decayEventCount++;
        if (absDelta < minSinceDecay) minSinceDecay = absDelta;

        // Brief fluctuation: delta rises back before enough events — not real decay
        if (
          absDelta >= decayThreshold &&
          decayEventCount < WHEEL_DECAY_MIN_EVENTS
        ) {
          inDecayPhase = false;
        }

        // Boundary: sustained decay + meaningful acceleration = new gesture
        if (
          decayEventCount >= WHEEL_DECAY_MIN_EVENTS &&
          absDelta >= minSinceDecay * WHEEL_RESUME_RATIO &&
          absDelta >= WHEEL_RESUME_DELTA
        ) {
          accumulatedDeltaX = 0;
          navigatedThisGesture = false;
          resetGestureState();
        }
      }

      // Direction change within a gesture is always intentional
      const directionChanged =
        lastDeltaX !== 0 && Math.sign(deltaX) !== Math.sign(lastDeltaX);
      if (directionChanged) {
        accumulatedDeltaX = 0;
        navigatedThisGesture = false;
        resetGestureState();
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
      if (!isHorizontalSwipe && Math.abs(deltaX) > SWIPE_DETECT_THRESHOLD) {
        isHorizontalSwipe = Math.abs(deltaX) > Math.abs(deltaY);
      }

      // Prevent vertical scroll and sidebar swipe for horizontal swipes
      if (isHorizontalSwipe) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        // Hide indicator on horizontal swipe (mobile only)
        if (
          isMobile &&
          indicator &&
          !indicator.hasClass("dynamic-views-indicator-hidden")
        ) {
          indicator.addClass("dynamic-views-indicator-hidden");
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
  // Throttle to prevent battery drain from high-frequency scroll events
  if (isMobile) {
    const viewContainer = coverEl.closest(".dynamic-views");
    if (viewContainer) {
      let lastScrollTime = 0;
      viewContainer.addEventListener(
        "scroll",
        () => {
          const now = Date.now();
          if (now - lastScrollTime < SCROLL_THROTTLE_MS) return;
          lastScrollTime = now;
          if (indicator)
            indicator.removeClass("dynamic-views-indicator-hidden");
        },
        { signal, passive: true },
      );
    }
  }
}

/**
 * Preload images on first hover
 * Uses browser's native image cache for both internal and external URLs
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
          new Image().src = url;
        });
      }
    },
    { once: true, signal },
  );
}

/**
 * Setup hover zoom eligibility tracking for slideshow
 * Only the image visible when hover starts gets zoom effect
 * Returns a function to call after slide animation completes to clear old image's class
 */
export function setupHoverZoomEligibility(
  slideshowEl: HTMLElement,
  imageEmbed: HTMLElement,
  signal: AbortSignal,
): () => void {
  slideshowEl.addEventListener(
    "mouseenter",
    () => {
      const currImg = imageEmbed.querySelector(".slideshow-img-current");
      currImg?.classList.add("hover-zoom-eligible");
    },
    { signal },
  );
  slideshowEl.addEventListener(
    "mouseleave",
    () => {
      imageEmbed
        .querySelectorAll(".slideshow-img")
        .forEach((img) => img.classList.remove("hover-zoom-eligible"));
    },
    { signal },
  );

  // Return function to clear class from old image after animation
  // (the element that just became .slideshow-img-next still has the class)
  return () => {
    const nextImg = imageEmbed.querySelector(".slideshow-img-next");
    nextImg?.classList.remove("hover-zoom-eligible");
  };
}
