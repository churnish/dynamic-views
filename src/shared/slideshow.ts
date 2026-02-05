/**
 * Shared slideshow utilities
 * Extracts common logic between card-renderer.tsx and shared-renderer.ts
 */

import { requestUrl } from "obsidian";
import {
  SLIDESHOW_ANIMATION_MS,
  SWIPE_DETECT_THRESHOLD,
  SCROLL_THROTTLE_MS,
} from "./constants";
import { isExternalUrl } from "../utils/image";

// Blob URL cache for external images to prevent re-downloads
// Uses Obsidian's requestUrl to bypass CORS restrictions
const externalBlobCache = new Map<string, string>();
// Cache capacity limit - evicts oldest entry (by insertion order) when exceeded
// Note: This is insertion-order eviction, not true LRU (accessed items aren't moved to end)
const BLOB_CACHE_LIMIT = 150;
// Track in-flight fetch requests to prevent duplicate concurrent fetches
const pendingFetches = new Map<string, Promise<string | null>>();
// Track URLs that failed validation to prevent retrying broken images
const failedValidationUrls = new Set<string>();
// Flag to prevent orphaned blob URLs during cleanup
let isCleanedUp = false;
// Time window to detect "undo" navigation (First→Last→First)
// If user wraps backward (First→Last) then forward (Last→First) within this window,
// animation direction is NOT reversed (treats it as accidental undo, not intentional wrap)
// Value chosen to match typical rapid navigation time while avoiding false positives
const UNDO_WINDOW_MS = 2500;

/**
 * Validate blob URL loads as an image
 * Returns true if image loads successfully with valid dimensions
 */
function validateBlobUrl(blobUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    const cleanup = (result: boolean) => {
      img.onload = null;
      img.onerror = null;
      img.src = "";
      resolve(result);
    };
    img.onload = () => cleanup(img.naturalWidth > 0 && img.naturalHeight > 0);
    img.onerror = () => cleanup(false);
    img.src = blobUrl;
  });
}

/**
 * Get cached blob URL for external image (sync)
 * Returns cached blob URL if available, otherwise original URL
 */
export function getCachedBlobUrl(url: string): string {
  return externalBlobCache.get(url) ?? url;
}

/**
 * Check if URL is ready to display (internal or cached external)
 * Use before updating img.src to avoid loading uncached external images
 */
export function isCachedOrInternal(url: string): boolean {
  if (!isExternalUrl(url)) return true;
  return externalBlobCache.has(url);
}

/**
 * Initialize blob URL cache state
 * Call on plugin load to reset cleanup flag from previous session
 */
export function initExternalBlobCache(): void {
  isCleanedUp = false;
}

/**
 * Clean up blob URL cache and revoke all blob URLs
 * Call on plugin unload to prevent memory leaks
 * Sets cleanup flag to prevent orphaned blob URLs from in-flight fetches
 */
export function cleanupExternalBlobCache(): void {
  isCleanedUp = true;
  externalBlobCache.forEach((blobUrl) => URL.revokeObjectURL(blobUrl));
  externalBlobCache.clear();
  pendingFetches.clear();
  failedValidationUrls.clear();
}

/**
 * Get blob URL for external image, fetching and caching if needed
 * Uses Obsidian's requestUrl to bypass CORS restrictions
 * Returns null if fetch fails, blob URL if valid, original URL for non-external
 * Deduplicates concurrent requests for same URL
 */
export async function getExternalBlobUrl(url: string): Promise<string | null> {
  // Skip if cleanup already happened (plugin unloaded)
  if (isCleanedUp) return null;
  if (!isExternalUrl(url)) return url;
  if (externalBlobCache.has(url)) return externalBlobCache.get(url)!;

  // Skip URLs that previously failed validation to avoid wasted network requests
  if (failedValidationUrls.has(url)) return null;

  // Deduplicate concurrent requests (check cleanup flag to prevent orphaned blob URLs)
  if (pendingFetches.has(url)) {
    if (isCleanedUp) return null;
    return pendingFetches.get(url)!;
  }

  const fetchPromise = (async (): Promise<string | null> => {
    try {
      const response = await requestUrl(url);
      // Include content-type for proper rendering (especially SVGs)
      // Safe access: headers may be undefined in edge cases
      const contentType =
        response.headers?.["content-type"] ?? "application/octet-stream";
      const blob = new Blob([response.arrayBuffer], { type: contentType });
      const blobUrl = URL.createObjectURL(blob);

      // Validate blob loads as image before caching
      const isValid = await validateBlobUrl(blobUrl);
      if (!isValid) {
        URL.revokeObjectURL(blobUrl);
        failedValidationUrls.add(url); // Track failed URL to prevent retries
        return null;
      }

      // Only cache if cleanup hasn't happened during fetch
      if (isCleanedUp) {
        URL.revokeObjectURL(blobUrl); // Prevent orphan
        return null;
      }

      // LRU eviction: remove oldest entry if cache is full
      if (externalBlobCache.size >= BLOB_CACHE_LIMIT) {
        const oldest = externalBlobCache.keys().next().value as
          | string
          | undefined;
        if (oldest) {
          URL.revokeObjectURL(externalBlobCache.get(oldest)!);
          externalBlobCache.delete(oldest);
        }
      }

      externalBlobCache.set(url, blobUrl);
      return blobUrl;
    } catch {
      // Fetch failed (network error, etc.)
      return null;
    } finally {
      pendingFetches.delete(url);
    }
  })();

  pendingFetches.set(url, fetchPromise);
  return fetchPromise;
}

/**
 * Cache an external image by fetching as blob (fire-and-forget)
 * Called when the first slideshow image loads
 */
export function cacheExternalImage(imgEl: HTMLImageElement): void {
  const url = imgEl.src;
  if (url && isExternalUrl(url) && !externalBlobCache.has(url)) {
    // Fire and forget - cache for future navigations
    void getExternalBlobUrl(url);
  }
}

// Gesture detection thresholds
const WHEEL_SWIPE_THRESHOLD = 5; // Accumulated deltaX to trigger navigation
const WHEEL_ACCEL_THRESHOLD = 5; // Minimum deltaX to detect acceleration
const WHEEL_ACCEL_OFFSET = 2; // Delta increase to count as acceleration
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
  signal.addEventListener(
    "abort",
    () => {
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
    if (isAnimating || signal.aborted || imageUrls.length <= 1) return;

    // Calculate next index with wraparound
    const current = currentIndex;
    let newIndex = current + direction;
    if (newIndex < 0) newIndex = imageUrls.length - 1;
    if (newIndex >= imageUrls.length) newIndex = 0;

    const elements = getElements();
    if (!elements) return;

    const { currImg, nextImg } = elements;
    const newUrl = imageUrls[newIndex];
    // Check if this is an uncached external image
    const isUncachedExternal = !isCachedOrInternal(newUrl);
    // Get effective URL early (used by error handler and image src)
    const effectiveUrl = getCachedBlobUrl(newUrl);

    isAnimating = true;

    // For uncached external images: show placeholder, fetch in background
    if (isUncachedExternal) {
      nextImg.addClass("dynamic-views-hidden");
      void getExternalBlobUrl(newUrl).then((blobUrl) => {
        if (signal.aborted) return;
        if (!blobUrl) {
          // Fetch failed - track and auto-advance (unless all failed)
          failedIndices.add(newIndex);
          if (failedIndices.size >= imageUrls.length) return; // All failed, stop
          nextImg.removeClass("dynamic-views-hidden");
          isAnimating = false;
          navigate(direction);
          return;
        }
        nextImg.src = blobUrl;
        nextImg.removeClass("dynamic-views-hidden");
      });
    }

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

    // Handle failed images: hide and auto-advance
    // Use event target for URL comparison to avoid race with rapid navigation
    nextImg.addEventListener(
      "error",
      (e) => {
        if (signal.aborted) return;
        // Ignore errors from src being cleared (resolves to index.html) or changed
        // Only handle errors for the URL we actually set (use event target, not element ref)
        const targetSrc = (e.target as HTMLImageElement).src;
        if (targetSrc !== effectiveUrl) return;

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
      currImg.src = effectiveUrl;
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

    // Only set src if cached (uncached external handled above with placeholder)
    if (!isUncachedExternal) {
      nextImg.src = effectiveUrl;
    }

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
    const exitClass = slideLeft
      ? "slideshow-exit-left"
      : "slideshow-exit-right";
    const enterClass = slideLeft
      ? "slideshow-enter-left"
      : "slideshow-enter-right";

    currImg.classList.add(exitClass);
    nextImg.classList.add(enterClass);

    const animTimeoutId = setTimeout(() => {
      pendingTimeouts.delete(animTimeoutId);
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
    }, animationDuration);
    pendingTimeouts.add(animTimeoutId);

    // Remove animation classes on abort (timeout already cleared by central handler)
    signal.addEventListener(
      "abort",
      () => {
        currImg.classList.remove(exitClass);
        nextImg.classList.remove(enterClass);
      },
      { once: true },
    );
  };

  // Reset to first slide (called when view becomes visible)
  const reset = () => {
    if (isAnimating) return;
    currentIndex = 0;
    lastWrapFromFirstTimestamp = null;
    failedIndices.clear();
    const elements = getElements();
    if (elements) {
      const firstUrl = getCachedBlobUrl(imageUrls[0]);
      elements.currImg.src = firstUrl;
      // Trigger onSlideChange for ambient color update
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
 * External images are fetched and cached as blob URLs to prevent re-downloads
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
          if (isExternalUrl(url)) {
            // Fetch and cache as blob URL (fire-and-forget)
            void getExternalBlobUrl(url);
          } else {
            // Internal images: just trigger browser preload
            const img = new Image();
            img.src = url;
          }
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
