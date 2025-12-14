import { extractAverageColor, getColorTheme } from "../utils/image-color";
import type { RefObject } from "../datacore/types";

// Cache ambient colors and aspect ratio by image URL to avoid flash on re-render
const ambientColorCache = new Map<
  string,
  { color: string; theme: "light" | "dark"; aspectRatio?: number }
>();

/**
 * Get cached aspect ratio for an image URL
 * Used by masonry layout to determine if card height is known before image loads
 */
export function getCachedAspectRatio(imgSrc: string): number | undefined {
  return ambientColorCache.get(imgSrc)?.aspectRatio;
}

/**
 * Apply cached ambient color and aspect ratio to card immediately
 * Called before image loads to prevent flash on re-render
 */
export function applyCachedAmbientColor(
  imgSrc: string,
  imageEmbedContainer: HTMLElement,
  cardEl: HTMLElement,
): boolean {
  const cached = ambientColorCache.get(imgSrc);
  if (!cached) return false;

  imageEmbedContainer.style.setProperty("--ambient-color", cached.color);
  cardEl.style.setProperty("--ambient-color", cached.color);
  cardEl.setAttribute("data-ambient-theme", cached.theme);
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
  // Extract ambient color for Cover background: Ambient and Card background: Ambient options
  let ambientColor: string;
  let colorTheme: "light" | "dark";
  try {
    ambientColor = extractAverageColor(imgEl);
    colorTheme = getColorTheme(ambientColor);
  } catch {
    // Canvas operations can fail (tainted canvas, etc.) - use fallback
    cardEl.classList.add("cover-ready");
    if (onLayoutUpdate) onLayoutUpdate();
    return;
  }

  // Calculate aspect ratio
  const aspectRatio =
    imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0
      ? imgEl.naturalHeight / imgEl.naturalWidth
      : undefined;

  // Cache for future re-renders
  if (imgEl.src) {
    ambientColorCache.set(imgEl.src, {
      color: ambientColor,
      theme: colorTheme,
      aspectRatio,
    });
  }

  imageEmbedContainer.style.setProperty("--ambient-color", ambientColor); // For Cover background: Ambient
  cardEl.style.setProperty("--ambient-color", ambientColor); // For Card background: Ambient

  // Set ambient theme on card for text color adjustments
  cardEl.setAttribute("data-ambient-theme", colorTheme);

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
  // Apply cached ambient color immediately to prevent flash on re-render
  const hasCached =
    imgEl.src &&
    applyCachedAmbientColor(imgEl.src, imageEmbedContainer, cardEl);

  // Handle already-loaded images (from cache)
  if (imgEl.complete && imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0) {
    handleImageLoad(imgEl, imageEmbedContainer, cardEl, onLayoutUpdate);
  } else if (!hasCached) {
    // Only add listeners if we didn't have cached color
    imgEl.addEventListener(
      "load",
      () => {
        handleImageLoad(imgEl, imageEmbedContainer, cardEl, onLayoutUpdate);
      },
      { once: true },
    );
    // On error, still add cover-ready so cover shows (even if broken)
    imgEl.addEventListener(
      "error",
      () => {
        cardEl.classList.add("cover-ready");
        if (onLayoutUpdate) onLayoutUpdate();
      },
      { once: true },
    );
  } else {
    // Had cached color, still need load handler for aspect ratio and layout
    imgEl.addEventListener(
      "load",
      () => {
        handleImageLoad(imgEl, imageEmbedContainer, cardEl, onLayoutUpdate);
      },
      { once: true },
    );
    // Also need error handler in case image fails to load
    imgEl.addEventListener(
      "error",
      () => {
        cardEl.classList.add("cover-ready");
        if (onLayoutUpdate) onLayoutUpdate();
      },
      { once: true },
    );
  }
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

  // Apply cached color immediately to prevent flash on re-render
  if (imgEl.src && !cardEl.classList.contains("cover-ready")) {
    applyCachedAmbientColor(imgEl.src, imageEmbedEl, cardEl);
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
