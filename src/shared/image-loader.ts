import {
  extractDominantColor,
  formatAmbientColor,
  calculateLuminanceFromTuple,
  type RGBTuple,
} from "../utils/ambient-color";
import { LUMINANCE_LIGHT_THRESHOLD } from "./constants";
import {
  isCardBackgroundAmbient,
  isCoverBackgroundAmbient,
  getCardAmbientOpacity,
  shouldUseBackdropLuminance,
  shouldUsePosterLuminance,
} from "../utils/style-settings";
import { isExternalUrl } from "../utils/image";
import { cacheExternalImage, getCachedBlobUrl } from "./slideshow";
import type { RefObject } from "../datacore/types";

// Cache image metadata (RGB tuple + aspect ratio) by URL to avoid flash on re-render
// Store RGB without alpha so we can apply different opacities for card vs cover
// Unbounded cache growth is intentional and harmless - entries are small (~50 bytes each)
// and bounded by user's vault image count; eviction would cause re-extraction flash
const imageMetadataCache = new Map<
  string,
  {
    rgb?: RGBTuple;
    theme?: "light" | "dark";
    luminance?: number;
    aspectRatio?: number;
  }
>();

// Default aspect ratio for failed images to prevent layout issues
export const DEFAULT_ASPECT_RATIO = 0.75; // 4:3 landscape

/**
 * Re-apply ambient colors to all cards using cached RGB with current opacity settings
 * Called when ambient opacity changes (e.g., subtle↔dramatic)
 */
export function reapplyAmbientColors(): void {
  document
    .querySelectorAll(".dynamic-views .card.cover-ready")
    .forEach((card) => {
      if (!(card instanceof HTMLElement)) return;

      // Optimized: query container once, then get img from it
      const imageEmbedEl = card.querySelector<HTMLElement>(
        ".dynamic-views-image-embed",
      );
      if (!imageEmbedEl) return;

      const imgEl = imageEmbedEl.querySelector<HTMLImageElement>("img");
      if (!imgEl?.src) return;

      const cached = imageMetadataCache.get(imgEl.src);
      if (!cached?.rgb || !cached?.theme) return;

      // Guard against unmounted elements during iteration
      if (!card.isConnected || !imageEmbedEl.isConnected) return;

      const isCoverImage = card.classList.contains("image-format-cover");
      applyAmbientStyles(
        cached.rgb,
        cached.theme,
        cached.luminance,
        imageEmbedEl,
        card,
        isCoverImage,
      );
    });
}

/**
 * Get cached aspect ratio for an image URL
 * Used by masonry layout to determine if card height is known before image loads
 */
export function getCachedAspectRatio(imgSrc: string): number | undefined {
  return imageMetadataCache.get(imgSrc)?.aspectRatio;
}

/**
 * Invalidate cache entries for a modified file (#17)
 * Call when vault file is modified to prevent stale RGB/aspect ratio
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
 * Apply ambient color styles to card and container (#6 - extracted shared function)
 */
function applyAmbientStyles(
  rgb: RGBTuple,
  theme: "light" | "dark",
  luminance: number | undefined,
  imageEmbedContainer: HTMLElement,
  cardEl: HTMLElement,
  isCoverImage: boolean,
): void {
  // Guard against unmounted elements
  if (!cardEl.isConnected) return;

  // Card background uses setting-defined opacity, cover background uses 0.33
  const cardOpacity = getCardAmbientOpacity(cardEl);
  const coverOpacity = 0.33;

  const cardColor = formatAmbientColor(rgb, cardOpacity);
  const coverColor = formatAmbientColor(rgb, coverOpacity);

  // Cover container gets subtle opacity for letterbox
  // Set on .card-cover (parent of imageEmbedContainer), not imageEmbedContainer itself
  const cardCover = imageEmbedContainer.closest(".card-cover");
  if (cardCover instanceof HTMLElement && cardCover.isConnected) {
    cardCover.style.setProperty("--ambient-color", coverColor);
  }
  // Card gets opacity based on card ambient setting
  cardEl.style.setProperty(
    "--ambient-color",
    isCoverImage && !isCardBackgroundAmbient(cardEl) ? coverColor : cardColor,
  );
  cardEl.setAttribute("data-adaptive-text", theme);
  if (luminance !== undefined) {
    cardEl.style.setProperty("--ambient-luminance", luminance.toFixed(3));
  }
}

/**
 * Clear ambient color styles from card and container
 * Used when switching to external images in slideshows
 */
function clearAmbientStyles(
  imageEmbedContainer: HTMLElement,
  cardEl: HTMLElement,
): void {
  // Guard against unmounted elements
  if (!cardEl.isConnected) return;

  const cardCover = imageEmbedContainer.closest(".card-cover");
  if (cardCover instanceof HTMLElement && cardCover.isConnected) {
    cardCover.style.removeProperty("--ambient-color");
  }
  cardEl.style.removeProperty("--ambient-color");
  cardEl.removeAttribute("data-adaptive-text");
  cardEl.style.removeProperty("--ambient-luminance");
}

/**
 * Apply cached image metadata (ambient color + aspect ratio) to card immediately
 * Called before image loads to prevent flash on re-render
 */
export function applyCachedImageMetadata(
  imgSrc: string,
  imageEmbedContainer: HTMLElement,
  cardEl: HTMLElement,
  isCoverImage?: boolean,
  isBackdropImage?: boolean,
): void {
  const cached = imageMetadataCache.get(imgSrc);
  if (!cached) return;

  // Guard against unmounted elements
  if (!cardEl.isConnected || !imageEmbedContainer.isConnected) return;

  // Don't apply ambient styles here - let handleImageLoad apply them in double rAF
  // so the transition animates. Aspect ratio can be applied immediately.

  // Apply cached backdrop/poster theme for luminance-based adaptive text
  if (isBackdropImage && cached.theme) {
    const useLuminance = cardEl.classList.contains("image-format-poster")
      ? shouldUsePosterLuminance()
      : shouldUseBackdropLuminance();
    if (useLuminance) {
      cardEl.setAttribute("data-adaptive-text", cached.theme);
    }
  }

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
 * Extracts ambient color and triggers layout update
 * Can be called from both addEventListener and JSX onLoad handlers
 *
 * @param imgEl - The image element
 * @param imageEmbedContainer - Container for the image embed (for CSS variables)
 * @param cardEl - The card element
 * @param onLayoutUpdate - Optional callback to trigger layout update (for masonry)
 * @param isCoverImage - Pre-computed cover check to avoid DOM query
 * @param isBackdropImage - Whether this is a backdrop image (for luminance-based adaptive text)
 */
export function handleImageLoad(
  imgEl: HTMLImageElement,
  imageEmbedContainer: HTMLElement,
  cardEl: HTMLElement,
  onLayoutUpdate?: (() => void) | null,
  isCoverImage?: boolean,
  isBackdropImage?: boolean,
): void {
  // Guard against null/empty src
  if (!imgEl.src) return;

  // Calculate aspect ratio with validation (always needed for masonry)
  // Require minimum 1px dimensions to catch broken/corrupt images
  const aspectRatio =
    imgEl.naturalWidth >= 1 && imgEl.naturalHeight >= 1
      ? imgEl.naturalHeight / imgEl.naturalWidth
      : undefined;

  // Cache external images for slideshow to prevent re-downloads
  cacheExternalImage(imgEl);

  // Only extract ambient color if needed by current settings
  // - Card bg ambient: needs color for all images (cover + thumbnail)
  // - Cover bg ambient: only needs color for cover images
  let rgb: RGBTuple | undefined;
  let colorTheme: "light" | "dark" | undefined;
  let luminance: number | undefined;

  const isCover =
    isCoverImage ?? cardEl.classList.contains("image-format-cover");
  const needsAmbient =
    !isBackdropImage &&
    (isCardBackgroundAmbient(cardEl) ||
      (isCover && isCoverBackgroundAmbient()));

  // Backdrop/poster needs luminance when tint disabled or overlay transparent
  const needsBackdropLuminance =
    isBackdropImage &&
    (cardEl.classList.contains("image-format-poster")
      ? shouldUsePosterLuminance()
      : shouldUseBackdropLuminance());

  if (needsAmbient || needsBackdropLuminance) {
    // Skip non-cached external images - blob URLs (cached via requestUrl) work
    // since they're same-origin, but original external URLs would taint canvas
    if (!isExternalUrl(imgEl.src)) {
      const extracted = extractDominantColor(imgEl);
      if (extracted) {
        rgb = extracted;
        // Calculate luminance directly from tuple (no string conversion)
        luminance = calculateLuminanceFromTuple(rgb);
        // Invert: light image needs dark text, dark image needs light text
        colorTheme = luminance > LUMINANCE_LIGHT_THRESHOLD ? "dark" : "light";
      }
    }
  }

  // Cache for future re-renders (only cache if rgb extracted or aspectRatio valid)
  if (imgEl.src && (rgb || aspectRatio !== undefined)) {
    imageMetadataCache.set(imgEl.src, {
      rgb,
      theme: colorTheme,
      luminance,
      aspectRatio,
    });
  }

  // Set actual aspect ratio for masonry contain mode (used when "Fixed cover height" is OFF)
  // Use default ratio for invalid/missing dimensions to prevent layout issues
  cardEl.style.setProperty(
    "--actual-aspect-ratio",
    (aspectRatio ?? DEFAULT_ASPECT_RATIO).toString(),
  );

  // Apply backdrop theme immediately (no animation needed)
  if (isBackdropImage && colorTheme && needsBackdropLuminance) {
    cardEl.setAttribute("data-adaptive-text", colorTheme);
  } else if (isBackdropImage && isExternalUrl(imgEl.src)) {
    cardEl.removeAttribute("data-adaptive-text");
  }

  // Shuffle re-render: skip transition by adding cover-ready immediately.
  // Browser batches opacity:0 + cover-ready opacity:1 into one paint → no visible fade.
  if (cardEl.closest(".skip-cover-fade")) {
    cardEl.classList.add("cover-ready");
    if (onLayoutUpdate) {
      onLayoutUpdate();
    }
    if (rgb && colorTheme && imageEmbedContainer.isConnected) {
      applyAmbientStyles(
        rgb,
        colorTheme,
        luminance,
        imageEmbedContainer,
        cardEl,
        isCover,
      );
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
        // Apply ambient color in same frame - both transitions start together
        // cardEl.isConnected checked at rAF entry; imageEmbedContainer used for closest() query
        if (rgb && colorTheme && imageEmbedContainer.isConnected) {
          applyAmbientStyles(
            rgb,
            colorTheme,
            luminance,
            imageEmbedContainer,
            cardEl,
            isCover,
          );
        }
      });
    });
  }

  if (
    !rgb &&
    needsAmbient &&
    isExternalUrl(imgEl.src) &&
    cardEl.isConnected &&
    imageEmbedContainer.isConnected
  ) {
    clearAmbientStyles(imageEmbedContainer, cardEl);
  }
}

/**
 * Sets up image load event handler for card images (for imperative DOM / Bases)
 * Handles ambient color extraction and layout updates
 *
 * @param imgEl - The image element
 * @param imageEmbedContainer - Container for the image embed (for CSS variables)
 * @param cardEl - The card element
 * @param onLayoutUpdate - Optional callback to trigger layout update (for masonry)
 * @returns Cleanup function to remove event listeners
 */
export function setupImageLoadHandler(
  imgEl: HTMLImageElement,
  imageEmbedContainer: HTMLElement,
  cardEl: HTMLElement,
  onLayoutUpdate?: () => void,
): () => void {
  const isCoverImage = cardEl.classList.contains("image-format-cover");

  // Apply cached metadata immediately to prevent flash on re-render
  if (imgEl.src && !cardEl.classList.contains("cover-ready")) {
    applyCachedImageMetadata(
      imgEl.src,
      imageEmbedContainer,
      cardEl,
      isCoverImage,
    );
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
    handleImageLoad(
      imgEl,
      imageEmbedContainer,
      cardEl,
      onLayoutUpdate,
      isCoverImage,
    );
    return () => {}; // No cleanup needed
  }

  // Event handlers for cleanup
  // Guard against double-processing if cache was applied
  const loadHandler = () => {
    if (cardEl.classList.contains("cover-ready")) return;
    handleImageLoad(
      imgEl,
      imageEmbedContainer,
      cardEl,
      onLayoutUpdate,
      isCoverImage,
    );
  };
  const errorHandler = () => {
    if (cardEl.classList.contains("cover-ready")) return;

    // Double rAF for cover-ready (consistent with multi-image error handlers)
    requestAnimationFrame(() => {
      if (!cardEl.isConnected || !imgEl.isConnected) return;
      requestAnimationFrame(() => {
        if (!cardEl.isConnected || !imgEl.isConnected) return;
        // Hide broken image to prevent placeholder icon
        imgEl.style.display = "none";
        cardEl.classList.add("cover-ready");
        // Set default aspect ratio on error
        cardEl.style.setProperty(
          "--actual-aspect-ratio",
          DEFAULT_ASPECT_RATIO.toString(),
        );
        // Clear any stale backdrop theme from previous image
        cardEl.removeAttribute("data-adaptive-text");
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

  // Fix null assertions
  const cardEl = imgEl.closest(".card");
  if (!cardEl || !(cardEl instanceof HTMLElement)) return;

  // Check for backdrop/poster image
  const backdropEl =
    imgEl.closest(".card-backdrop") || imgEl.closest(".card-poster");
  const isBackdropImage = !!backdropEl;

  // Get container - backdrop/poster or image embed
  const imageEmbedEl =
    backdropEl ?? imgEl.closest(".dynamic-views-image-embed");
  if (!imageEmbedEl || !(imageEmbedEl instanceof HTMLElement)) return;

  const isCoverImage = cardEl.classList.contains("image-format-cover");

  // Apply cached metadata immediately to prevent flash on re-render
  if (imgEl.src && !cardEl.classList.contains("cover-ready")) {
    applyCachedImageMetadata(
      imgEl.src,
      imageEmbedEl,
      cardEl,
      isCoverImage,
      isBackdropImage,
    );
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
    handleImageLoad(
      imgEl,
      imageEmbedEl,
      cardEl,
      updateLayoutRef.current,
      isCoverImage,
      isBackdropImage,
    );
  } else if (!imgEl.complete) {
    // #18: Fallback listener if image loads before JSX onLoad handler attaches
    // Uses { once: true } to auto-cleanup; cover-ready guard prevents double-processing
    imgEl.addEventListener(
      "load",
      () => {
        if (cardEl.classList.contains("cover-ready")) return;
        handleImageLoad(
          imgEl,
          imageEmbedEl,
          cardEl,
          updateLayoutRef.current,
          isCoverImage,
          isBackdropImage,
        );
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

  // Fix null assertions
  const cardEl = imgEl.closest(".card");
  if (
    !cardEl ||
    !(cardEl instanceof HTMLElement) ||
    cardEl.classList.contains("cover-ready")
  )
    return;

  // Check for backdrop/poster image
  const backdropEl =
    imgEl.closest(".card-backdrop") || imgEl.closest(".card-poster");
  const isBackdropImage = !!backdropEl;

  // Get container - backdrop/poster or image embed
  const imageEmbedEl =
    backdropEl ?? imgEl.closest(".dynamic-views-image-embed");
  if (!imageEmbedEl || !(imageEmbedEl instanceof HTMLElement)) return;

  const isCoverImage = cardEl.classList.contains("image-format-cover");
  handleImageLoad(
    imgEl,
    imageEmbedEl,
    cardEl,
    updateLayoutRef.current,
    isCoverImage,
    isBackdropImage,
  );
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
  imgEl.style.display = "none";

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
  // Clear any stale adaptive text from previous image
  cardEl.removeAttribute("data-adaptive-text");
  if (updateLayoutRef.current) updateLayoutRef.current();
}

/**
 * Setup backdrop image loader with AbortSignal support and multi-image fallback
 * Consolidates backdrop-specific handling from shared-renderer.ts
 *
 * @param imgEl - The backdrop image element
 * @param containerEl - The .card-backdrop container
 * @param cardEl - The card element
 * @param imageUrls - Array of image URLs for fallback
 * @param onLayoutUpdate - Optional callback to trigger layout update
 * @param signal - AbortSignal for cleanup
 */
export function setupBackdropImageLoader(
  imgEl: HTMLImageElement,
  containerEl: HTMLElement,
  cardEl: HTMLElement,
  imageUrls: string[],
  onLayoutUpdate?: (() => void) | null,
  signal?: AbortSignal,
): void {
  // Apply cached metadata immediately (prevents flash on re-render)
  applyCachedImageMetadata(imgEl.src, containerEl, cardEl, false, true);

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
    handleImageLoad(imgEl, containerEl, cardEl, onLayoutUpdate, false, true);
    return;
  }

  // Load handler - handleImageLoad has internal double-rAF, just guard abort here
  imgEl.addEventListener(
    "load",
    () => {
      if (signal?.aborted) return;
      handleImageLoad(imgEl, containerEl, cardEl, onLayoutUpdate, false, true);
    },
    { signal },
  );

  // Multi-image fallback
  if (imageUrls.length > 1) {
    let currentIndex = 0;
    const tryNextImage = () => {
      if (signal?.aborted) return;
      currentIndex++;
      if (currentIndex < imageUrls.length) {
        if (signal?.aborted || !cardEl.isConnected || !imgEl.isConnected)
          return;
        imgEl.style.display = "";
        imgEl.src = getCachedBlobUrl(imageUrls[currentIndex]);
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
          imgEl.style.display = "none";
          cardEl.removeAttribute("data-adaptive-text");
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
        requestAnimationFrame(() => {
          if (signal?.aborted || !cardEl.isConnected || !imgEl.isConnected)
            return;
          requestAnimationFrame(() => {
            if (signal?.aborted || !cardEl.isConnected || !imgEl.isConnected)
              return;
            imgEl.style.display = "none";
            cardEl.removeAttribute("data-adaptive-text");
            cardEl.classList.add("cover-ready");
            onLayoutUpdate?.();
          });
        });
      },
      { signal },
    );
  }
}
