import { extractAverageColor, getColorTheme } from "../utils/image-color";
import {
  isCardBackgroundAmbient,
  isCoverBackgroundAmbient,
} from "../utils/style-settings";
import type { RefObject } from "../datacore/types";

// Cache image metadata (ambient color + aspect ratio) by URL to avoid flash on re-render
const imageMetadataCache = new Map<
  string,
  { color?: string; theme?: "light" | "dark"; aspectRatio?: number }
>();

/**
 * Clear image metadata cache when ambient settings change
 * Called by style-settings observer to prevent stale colors
 */
export function clearImageMetadataCache(): void {
  imageMetadataCache.clear();
}

/**
 * Get cached aspect ratio for an image URL
 * Used by masonry layout to determine if card height is known before image loads
 */
export function getCachedAspectRatio(imgSrc: string): number | undefined {
  return imageMetadataCache.get(imgSrc)?.aspectRatio;
}

/**
 * Apply cached image metadata (ambient color + aspect ratio) to card immediately
 * Called before image loads to prevent flash on re-render
 */
export function applyCachedImageMetadata(
  imgSrc: string,
  imageEmbedContainer: HTMLElement,
  cardEl: HTMLElement,
): boolean {
  const cached = imageMetadataCache.get(imgSrc);
  if (!cached) return false;

  // Only apply ambient color if it was cached (ambient settings were on when extracted)
  if (cached.color && cached.theme) {
    imageEmbedContainer.style.setProperty("--ambient-color", cached.color);
    cardEl.style.setProperty("--ambient-color", cached.color);
    cardEl.setAttribute("data-ambient-theme", cached.theme);
  }
  if (cached.aspectRatio !== undefined) {
    cardEl.style.setProperty(
      "--actual-aspect-ratio",
      cached.aspectRatio.toString(),
    );
  }
  cardEl.classList.add("cover-ready");
  return true;
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
 */
export function handleImageLoad(
  imgEl: HTMLImageElement,
  imageEmbedContainer: HTMLElement,
  cardEl: HTMLElement,
  onLayoutUpdate?: (() => void) | null,
): void {
  // Calculate aspect ratio (always needed for masonry)
  const aspectRatio =
    imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0
      ? imgEl.naturalHeight / imgEl.naturalWidth
      : undefined;

  // Only extract ambient color if needed by current settings
  // - Card bg ambient: needs color for all images (cover + thumbnail)
  // - Cover bg ambient: only needs color for cover images
  let ambientColor: string | undefined;
  let colorTheme: "light" | "dark" | undefined;

  const isCoverImage = cardEl.classList.contains("image-format-cover");
  const needsAmbient =
    isCardBackgroundAmbient() || (isCoverImage && isCoverBackgroundAmbient());

  if (needsAmbient) {
    try {
      ambientColor = extractAverageColor(imgEl);
      colorTheme = getColorTheme(ambientColor);
    } catch {
      // Canvas operations can fail (tainted canvas, etc.) - continue without color
    }
  }

  // Cache for future re-renders
  if (imgEl.src) {
    imageMetadataCache.set(imgEl.src, {
      color: ambientColor,
      theme: colorTheme,
      aspectRatio,
    });
  }

  // Apply ambient color if extracted
  if (ambientColor && colorTheme) {
    imageEmbedContainer.style.setProperty("--ambient-color", ambientColor);
    cardEl.style.setProperty("--ambient-color", ambientColor);
    cardEl.setAttribute("data-ambient-theme", colorTheme);
  }

  // Set actual aspect ratio for masonry contain mode (used when "Fixed cover height" is OFF)
  if (aspectRatio !== undefined) {
    cardEl.style.setProperty("--actual-aspect-ratio", aspectRatio.toString());
  }

  // Mark as processed (idempotency guard)
  cardEl.classList.add("cover-ready");

  // Trigger layout update if callback provided (for masonry reflow)
  if (onLayoutUpdate) {
    onLayoutUpdate();
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
 */
export function setupImageLoadHandler(
  imgEl: HTMLImageElement,
  imageEmbedContainer: HTMLElement,
  cardEl: HTMLElement,
  onLayoutUpdate?: () => void,
): void {
  // Apply cached metadata immediately to prevent flash on re-render
  if (imgEl.src && !cardEl.classList.contains("cover-ready")) {
    applyCachedImageMetadata(imgEl.src, imageEmbedContainer, cardEl);
  }

  // Handle already-loaded images (skip if already processed via cache)
  if (
    imgEl.complete &&
    imgEl.naturalWidth > 0 &&
    imgEl.naturalHeight > 0 &&
    !cardEl.classList.contains("cover-ready")
  ) {
    handleImageLoad(imgEl, imageEmbedContainer, cardEl, onLayoutUpdate);
    return;
  }

  // Add load/error listeners for pending images
  imgEl.addEventListener(
    "load",
    () => handleImageLoad(imgEl, imageEmbedContainer, cardEl, onLayoutUpdate),
    { once: true },
  );
  imgEl.addEventListener(
    "error",
    () => {
      cardEl.classList.add("cover-ready");
      if (onLayoutUpdate) onLayoutUpdate();
    },
    { once: true },
  );
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

  const cardEl = imgEl.closest(".card") as HTMLElement;
  if (!cardEl) return;

  const imageEmbedEl = imgEl.closest(
    ".dynamic-views-image-embed",
  ) as HTMLElement;
  if (!imageEmbedEl) return;

  // Apply cached metadata immediately to prevent flash on re-render
  if (imgEl.src && !cardEl.classList.contains("cover-ready")) {
    applyCachedImageMetadata(imgEl.src, imageEmbedEl, cardEl);
  }

  // Handle already-loaded images
  if (
    imgEl.complete &&
    imgEl.naturalWidth > 0 &&
    !cardEl.classList.contains("cover-ready")
  ) {
    handleImageLoad(imgEl, imageEmbedEl, cardEl, updateLayoutRef.current);
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

  const cardEl = imgEl.closest(".card") as HTMLElement;
  if (!cardEl || cardEl.classList.contains("cover-ready")) return; // Already handled by ref

  const imageEmbedEl = imgEl.closest(
    ".dynamic-views-image-embed",
  ) as HTMLElement;
  if (!imageEmbedEl) return;

  handleImageLoad(imgEl, imageEmbedEl, cardEl, updateLayoutRef.current);
}

/**
 * JSX onError handler for image elements
 * Ensures cover-ready is set even on error so layout doesn't wait indefinitely
 */
export function handleJsxImageError(
  e: Event,
  updateLayoutRef: RefObject<(() => void) | null>,
): void {
  const imgEl = e.currentTarget as HTMLImageElement;
  const cardEl = imgEl.closest(".card") as HTMLElement;
  if (!cardEl || cardEl.classList.contains("cover-ready")) return;

  cardEl.classList.add("cover-ready");
  if (updateLayoutRef.current) updateLayoutRef.current();
}
