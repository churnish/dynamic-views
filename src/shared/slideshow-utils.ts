/**
 * Shared slideshow utilities
 * Extracts common logic between card-renderer.tsx and shared-renderer.ts
 */

import { SLIDESHOW_ANIMATION_MS } from "./constants";

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
  navigate: (direction: 1 | -1) => void;
} {
  let currentIndex = 0;
  let isAnimating = false;

  const navigate = (direction: 1 | -1) => {
    if (isAnimating || signal.aborted) return;

    let newIndex = currentIndex + direction;
    if (newIndex < 0) newIndex = imageUrls.length - 1;
    if (newIndex >= imageUrls.length) newIndex = 0;

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

    // Detect wrap from last to first - animate in reverse to signal "rewind"
    // Only reverse for 3+ images; with 2 images alternating direction feels glitchy
    const isWrapToFirst =
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

    // Clean up timeout if aborted
    signal.addEventListener("abort", () => clearTimeout(timeoutId), {
      once: true,
    });
  };

  return { navigate };
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
