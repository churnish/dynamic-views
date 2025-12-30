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
// Track URLs that failed to load (404, invalid image, etc.)
const failedUrls = new Set<string>();
// Track in-flight fetch requests to prevent duplicate concurrent fetches
const pendingFetches = new Map<string, Promise<string>>();
// Flag to prevent orphaned blob URLs during cleanup
let isCleanedUp = false;

/**
 * Validate blob URL loads as an image
 * Returns true if image loads successfully with valid dimensions
 */
function validateBlobUrl(blobUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0 && img.naturalHeight > 0);
    img.onerror = () => resolve(false);
    img.src = blobUrl;
  });
}

/**
 * Check if an external URL has failed to load
 */
export function isFailedExternalUrl(url: string): boolean {
  return failedUrls.has(url);
}

/**
 * Mark an external URL as failed (called from onerror handlers)
 */
export function markExternalUrlAsFailed(url: string): void {
  if (isExternalUrl(url)) {
    failedUrls.add(url);
  }
}

/**
 * Get cached blob URL for external image (sync)
 * Returns cached blob URL if available, otherwise original URL
 */
export function getCachedBlobUrl(url: string): string {
  return externalBlobCache.get(url) ?? url;
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
  failedUrls.clear();
  pendingFetches.clear();
}

/**
 * Get blob URL for external image, fetching and caching if needed
 * Uses Obsidian's requestUrl to bypass CORS restrictions
 * Returns original URL if fetch fails or for non-external URLs
 * Deduplicates concurrent requests for same URL
 */
export async function getExternalBlobUrl(url: string): Promise<string> {
  // Skip if cleanup already happened (plugin unloaded)
  if (isCleanedUp) return url;
  if (!isExternalUrl(url)) return url;
  if (externalBlobCache.has(url)) return externalBlobCache.get(url)!;
  // Skip already-failed URLs
  if (failedUrls.has(url)) return url;

  // Deduplicate concurrent requests
  if (pendingFetches.has(url)) return pendingFetches.get(url)!;

  const fetchPromise = (async () => {
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
        failedUrls.add(url);
        return url;
      }

      // Only cache if cleanup hasn't happened during fetch
      if (isCleanedUp) {
        URL.revokeObjectURL(blobUrl); // Prevent orphan
        return url;
      }

      externalBlobCache.set(url, blobUrl);
      return blobUrl;
    } catch {
      // Fetch failed (network error, etc.) - mark as failed
      failedUrls.add(url);
      return url;
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
// Time window to detect "undo" navigation (First→Last→First)
const UNDO_WINDOW_MS = 2500;

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
} {
  let currentIndex = 0;
  let isAnimating = false;
  let lastWrapFromFirstTimestamp: number | null = null;

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

  const navigate = (
    direction: 1 | -1,
    honorGestureDirection = false,
    skipAnimation = false,
  ) => {
    if (isAnimating || signal.aborted || imageUrls.length === 0) return;

    // Find next valid (non-failed) URL in the given direction
    let newIndex = currentIndex;
    for (let i = 0; i < imageUrls.length; i++) {
      newIndex += direction;
      if (newIndex < 0) newIndex = imageUrls.length - 1;
      if (newIndex >= imageUrls.length) newIndex = 0;

      // Stop if we found a valid URL or looped back to start
      if (!failedUrls.has(imageUrls[newIndex]) || newIndex === currentIndex) {
        break;
      }
    }

    // Skip animation for single-image slideshows or if all URLs are failed
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

    // Handle failed images: mark as failed, hide, and auto-advance
    nextImg.addEventListener(
      "error",
      () => {
        if (signal.aborted) return;
        // Ignore errors from src being cleared (resolves to index.html) or changed
        // Only handle errors for the URL we actually set
        const failedUrl = imageUrls[newIndex];
        const expectedUrl = getCachedBlobUrl(failedUrl);
        if (nextImg.src !== expectedUrl) return;
        failedUrls.add(failedUrl);
        nextImg.style.display = "none";

        // After animation completes, try to advance to next valid slide
        const timeoutId = setTimeout(() => {
          pendingTimeouts.delete(timeoutId);
          if (!signal.aborted) {
            nextImg.style.display = "";
            navigate(direction, honorGestureDirection);
          }
        }, SLIDESHOW_ANIMATION_MS + 50);
        pendingTimeouts.add(timeoutId);
      },
      { once: true, signal },
    );

    // Set next image src and CSS variable (use cached blob URL if available)
    const effectiveUrl = getCachedBlobUrl(newUrl);
    imageEmbed.style.setProperty("--cover-image-url", `url("${effectiveUrl}")`);

    // Skip animation: directly update current image
    if (skipAnimation) {
      currImg.src = effectiveUrl;
      currImg.style.display = "";
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

    nextImg.src = effectiveUrl;

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

      // Don't clear src - it triggers error events that consume { once: true } handlers
      // The element is hidden via CSS anyway (visibility: hidden on .slideshow-img-next)

      currentIndex = newIndex;
      isAnimating = false;

      if (callbacks?.onAnimationComplete) {
        callbacks.onAnimationComplete();
      }
    }, SLIDESHOW_ANIMATION_MS);
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
      if (!isHorizontalSwipe && Math.abs(deltaX) > SWIPE_DETECT_THRESHOLD) {
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
          if (indicator) indicator.style.opacity = "1";
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
