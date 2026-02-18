import type { RefObject } from "../datacore/types";
import { cacheExternalImage, markImageBroken } from "./slideshow";

// Cache aspect ratio by image URL to avoid layout flash on re-render
// Unbounded cache growth is intentional and harmless - entries are small (~20 bytes each)
// and bounded by user's vault image count; eviction would cause re-measurement flash
const imageMetadataCache = new Map<string, { aspectRatio?: number }>();

// Default aspect ratio for failed images to prevent layout issues
export const DEFAULT_ASPECT_RATIO = 0.75; // 4:3 landscape

/**
 * Get cached aspect ratio for an image URL
 * Used by masonry layout to determine if card height is known before image loads
 */
export function getCachedAspectRatio(imgSrc: string): number | undefined {
  return imageMetadataCache.get(imgSrc)?.aspectRatio;
}

/**
 * Invalidate cache entries for a modified file (#17)
 * Call when vault file is modified to prevent stale aspect ratio
 * @param filePath - Vault-relative path of the modified file
 */
export function invalidateCacheForFile(filePath: string): void {
  // Cache keys are app:// URLs with timestamps, e.g., app://local/<path>?123456
  // Strip query params and decode to get the path for matching
  for (const key of imageMetadataCache.keys()) {
    try {
      // Strip query params (timestamps) and decode URL
      const urlPath = decodeURIComponent(key.split("?")[0]);
      // Match if URL path ends with the vault-relative file path
      // Use separator prefix to avoid partial filename matches (e.g., "image.png" shouldn't match "myimage.png")
      if (
        urlPath.endsWith("/" + filePath) ||
        urlPath.endsWith("\\" + filePath)
      ) {
        imageMetadataCache.delete(key);
      }
    } catch {
      // Skip malformed URLs
    }
  }
}

/**
 * Apply cached aspect ratio to card immediately
 * Called before image loads to prevent layout flash on re-render
 */
export function applyCachedImageMetadata(
  imgSrc: string,
  cardEl: HTMLElement,
): void {
  const cached = imageMetadataCache.get(imgSrc);
  if (!cached) return;

  // Guard against unmounted elements
  if (!cardEl.isConnected) return;

  if (cached.aspectRatio !== undefined) {
    cardEl.style.setProperty(
      "--actual-aspect-ratio",
      cached.aspectRatio.toString(),
    );
  }
  // Don't add cover-ready here - wait for actual image load to trigger fade-in
}

/**
 * Core logic for handling image load
 * Caches aspect ratio and triggers layout update
 * Can be called from both addEventListener and JSX onLoad handlers
 *
 * @param imgEl - The image element
 * @param cardEl - The card element
 * @param onLayoutUpdate - Optional callback to trigger layout update (for masonry)
 */
export function handleImageLoad(
  imgEl: HTMLImageElement,
  cardEl: HTMLElement,
  onLayoutUpdate?: (() => void) | null,
): void {
  // Guard against null/empty src
  if (!imgEl.src) return;

  // Cache external images as blob URLs for future slideshow navigation
  cacheExternalImage(imgEl);

  // Calculate aspect ratio with validation (always needed for masonry)
  // Require minimum 1px dimensions to catch broken/corrupt images
  const aspectRatio =
    imgEl.naturalWidth >= 1 && imgEl.naturalHeight >= 1
      ? imgEl.naturalHeight / imgEl.naturalWidth
      : undefined;

  // Cache for future re-renders
  if (imgEl.src && aspectRatio !== undefined) {
    imageMetadataCache.set(imgEl.src, { aspectRatio });
    // Lock aspect ratio to first successful image (for slideshow contain mode)
    cardEl.dataset.aspectRatioSet = "1";
  }

  // Set actual aspect ratio for masonry contain mode (used when "Fixed cover height" is OFF)
  // Use default ratio for invalid/missing dimensions to prevent layout issues
  cardEl.style.setProperty(
    "--actual-aspect-ratio",
    (aspectRatio ?? DEFAULT_ASPECT_RATIO).toString(),
  );

  // Shuffle re-render: skip transition by adding cover-ready immediately.
  // Browser batches opacity:0 + cover-ready opacity:1 into one paint → no visible fade.
  if (cardEl.closest(".skip-cover-fade")) {
    cardEl.classList.add("cover-ready");
    if (onLayoutUpdate) {
      onLayoutUpdate();
    }
  } else {
    // Double rAF ensures browser paints initial state before triggering transitions
    // Single rAF can be batched with initial render; double guarantees a paint cycle
    requestAnimationFrame(() => {
      // Guard against card unmounted during first rAF
      if (!cardEl.isConnected) return;
      requestAnimationFrame(() => {
        // Guard against card unmounted during second rAF
        if (!cardEl.isConnected) return;
        cardEl.classList.add("cover-ready");
        if (onLayoutUpdate) {
          onLayoutUpdate();
        }
      });
    });
  }
}

/**
 * Sets up image load event handler for card images (for imperative DOM / Bases)
 * Handles aspect ratio caching and layout updates
 *
 * @param imgEl - The image element
 * @param cardEl - The card element
 * @param onLayoutUpdate - Optional callback to trigger layout update (for masonry)
 * @returns Cleanup function to remove event listeners
 */
export function setupImageLoadHandler(
  imgEl: HTMLImageElement,
  cardEl: HTMLElement,
  onLayoutUpdate?: () => void,
): () => void {
  // Apply cached metadata immediately to prevent flash on re-render
  if (imgEl.src && !cardEl.classList.contains("cover-ready")) {
    applyCachedImageMetadata(imgEl.src, cardEl);
  }

  // Handle already-loaded images (skip if already processed via cache)
  // Force reflow to ensure initial opacity:0 is computed before triggering transition
  if (
    imgEl.complete &&
    imgEl.naturalWidth > 0 &&
    imgEl.naturalHeight > 0 &&
    !cardEl.classList.contains("cover-ready")
  ) {
    // Force reflow only when fade is needed (skip during shuffle re-render)
    if (!cardEl.closest(".skip-cover-fade")) {
      void cardEl.offsetHeight;
    }
    handleImageLoad(imgEl, cardEl, onLayoutUpdate);
    return () => {}; // No cleanup needed
  }

  // Event handlers for cleanup
  // Guard against double-processing if cache was applied
  const loadHandler = () => {
    if (cardEl.classList.contains("cover-ready")) return;
    handleImageLoad(imgEl, cardEl, onLayoutUpdate);
  };
  const errorHandler = () => {
    if (cardEl.classList.contains("cover-ready")) return;
    const failedSrc = imgEl.src;
    markImageBroken(failedSrc);

    // Double rAF for cover-ready (consistent with multi-image error handlers)
    requestAnimationFrame(() => {
      if (!cardEl.isConnected || !imgEl.isConnected) return;
      requestAnimationFrame(() => {
        if (!cardEl.isConnected || !imgEl.isConnected) return;
        // Skip if src changed — another handler (e.g. slideshow first-image
        // error in shared-renderer.ts) already advanced to the next image
        if (imgEl.src !== failedSrc) return;
        // Hide broken image to prevent placeholder icon
        imgEl.addClass("dynamic-views-hidden");
        cardEl.classList.add("cover-ready");
        // Set default aspect ratio on error
        cardEl.style.setProperty(
          "--actual-aspect-ratio",
          DEFAULT_ASPECT_RATIO.toString(),
        );
        if (onLayoutUpdate) {
          onLayoutUpdate();
        }
      });
    });
  };

  // Add load/error listeners for pending images
  imgEl.addEventListener("load", loadHandler, { once: true });
  imgEl.addEventListener("error", errorHandler, { once: true });

  // Return cleanup function
  return () => {
    imgEl.removeEventListener("load", loadHandler);
    imgEl.removeEventListener("error", errorHandler);
  };
}

/**
 * JSX ref callback for image elements
 * Handles already-cached images immediately on mount
 * Uses idempotency guard to prevent double-processing
 */
export function handleJsxImageRef(
  imgEl: HTMLImageElement | null,
  updateLayoutRef: RefObject<(() => void) | null>,
): void {
  if (!imgEl) return;

  const cardEl = imgEl.closest(".card");
  if (!cardEl || !(cardEl instanceof HTMLElement)) return;

  // Apply cached metadata immediately to prevent flash on re-render
  if (imgEl.src && !cardEl.classList.contains("cover-ready")) {
    applyCachedImageMetadata(imgEl.src, cardEl);
  }

  // Handle already-loaded images
  // Force reflow to ensure initial opacity:0 is computed before triggering transition
  if (
    imgEl.complete &&
    imgEl.naturalWidth > 0 &&
    imgEl.naturalHeight > 0 &&
    !cardEl.classList.contains("cover-ready")
  ) {
    // Force reflow only when fade is needed (skip during shuffle re-render)
    if (!cardEl.closest(".skip-cover-fade")) {
      void cardEl.offsetHeight;
    }
    handleImageLoad(imgEl, cardEl, updateLayoutRef.current);
  } else if (!imgEl.complete) {
    // #18: Fallback listener if image loads before JSX onLoad handler attaches
    // Uses { once: true } to auto-cleanup; cover-ready guard prevents double-processing
    imgEl.addEventListener(
      "load",
      () => {
        if (cardEl.classList.contains("cover-ready")) return;
        handleImageLoad(imgEl, cardEl, updateLayoutRef.current);
      },
      { once: true },
    );
  }
}

/**
 * JSX onLoad handler for image elements
 * Uses idempotency guard to prevent double-processing if ref already handled
 */
export function handleJsxImageLoad(
  e: Event,
  updateLayoutRef: RefObject<(() => void) | null>,
): void {
  const imgEl = e.currentTarget as HTMLImageElement;

  const cardEl = imgEl.closest(".card");
  if (
    !cardEl ||
    !(cardEl instanceof HTMLElement) ||
    cardEl.classList.contains("cover-ready")
  )
    return;

  handleImageLoad(imgEl, cardEl, updateLayoutRef.current);
}

/**
 * JSX onError handler for image elements
 * Ensures cover-ready is set even on error so layout doesn't wait indefinitely
 * Hides broken images and marks external URLs as failed
 */
export function handleJsxImageError(
  e: Event,
  updateLayoutRef: RefObject<(() => void) | null>,
): void {
  const imgEl = e.currentTarget as HTMLImageElement;

  // Hide broken image to prevent placeholder icon
  imgEl.addClass("dynamic-views-hidden");

  // Fix null assertions
  const cardEl = imgEl.closest(".card");
  if (
    !cardEl ||
    !(cardEl instanceof HTMLElement) ||
    cardEl.classList.contains("cover-ready")
  )
    return;

  cardEl.classList.add("cover-ready");
  // Set default aspect ratio on error
  cardEl.style.setProperty(
    "--actual-aspect-ratio",
    DEFAULT_ASPECT_RATIO.toString(),
  );
  if (updateLayoutRef.current) updateLayoutRef.current();
}

/**
 * Setup backdrop image loader with AbortSignal support and multi-image fallback
 * Consolidates backdrop-specific handling from shared-renderer.ts
 *
 * @param imgEl - The backdrop image element
 * @param cardEl - The card element
 * @param imageUrls - Array of image URLs for fallback
 * @param onLayoutUpdate - Optional callback to trigger layout update
 * @param signal - AbortSignal for cleanup
 */
export function setupBackdropImageLoader(
  imgEl: HTMLImageElement,
  cardEl: HTMLElement,
  imageUrls: string[],
  onLayoutUpdate?: (() => void) | null,
  signal?: AbortSignal,
): void {
  // Apply cached metadata immediately (prevents flash on re-render)
  applyCachedImageMetadata(imgEl.src, cardEl);

  // Handle already-loaded images synchronously (enables skip-cover-fade during shuffle)
  if (
    imgEl.complete &&
    imgEl.naturalWidth > 0 &&
    imgEl.naturalHeight > 0 &&
    !cardEl.classList.contains("cover-ready")
  ) {
    if (!cardEl.closest(".skip-cover-fade")) {
      void cardEl.offsetHeight;
    }
    handleImageLoad(imgEl, cardEl, onLayoutUpdate);
    return;
  }

  // Load handler - handleImageLoad has internal double-rAF, just guard abort here
  imgEl.addEventListener(
    "load",
    () => {
      if (signal?.aborted) return;
      handleImageLoad(imgEl, cardEl, onLayoutUpdate);
    },
    { signal },
  );

  // Multi-image fallback
  if (imageUrls.length > 1) {
    let currentIndex = 0;
    const tryNextImage = () => {
      if (signal?.aborted) return;
      markImageBroken(imgEl.src);
      currentIndex++;
      if (currentIndex < imageUrls.length) {
        if (signal?.aborted || !cardEl.isConnected || !imgEl.isConnected)
          return;
        imgEl.removeClass("dynamic-views-hidden");
        imgEl.src = imageUrls[currentIndex];
        return;
      }
      // All images failed - cleanup with double rAF
      if (signal?.aborted) return;
      requestAnimationFrame(() => {
        if (signal?.aborted || !cardEl.isConnected || !imgEl.isConnected)
          return;
        requestAnimationFrame(() => {
          if (signal?.aborted || !cardEl.isConnected || !imgEl.isConnected)
            return;
          imgEl.addClass("dynamic-views-hidden");
          cardEl.classList.add("cover-ready");
          onLayoutUpdate?.();
        });
      });
    };
    imgEl.addEventListener("error", tryNextImage, { signal });
  } else {
    // Single image error handler
    imgEl.addEventListener(
      "error",
      () => {
        if (signal?.aborted) return;
        markImageBroken(imgEl.src);
        requestAnimationFrame(() => {
          if (signal?.aborted || !cardEl.isConnected || !imgEl.isConnected)
            return;
          requestAnimationFrame(() => {
            if (signal?.aborted || !cardEl.isConnected || !imgEl.isConnected)
              return;
            imgEl.addClass("dynamic-views-hidden");
            cardEl.classList.add("cover-ready");
            onLayoutUpdate?.();
          });
        });
      },
      { signal },
    );
  }
}
