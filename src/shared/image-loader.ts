import { extractAverageColor, getColorTheme } from "../utils/image-color";
import type { RefObject } from "../types/datacore";

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
  const ambientColor = extractAverageColor(imgEl);
  imageEmbedContainer.style.setProperty("--ambient-color", ambientColor); // For Cover background: Ambient
  cardEl.style.setProperty("--ambient-color", ambientColor); // For Card background: Ambient

  // Set ambient theme on card for text color adjustments
  const colorTheme = getColorTheme(ambientColor);
  cardEl.setAttribute("data-ambient-theme", colorTheme);

  // Set actual aspect ratio for masonry contain mode (used when "Fixed cover height" is OFF)
  if (imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0) {
    const imgAspect = imgEl.naturalHeight / imgEl.naturalWidth;
    cardEl.style.setProperty("--actual-aspect-ratio", imgAspect.toString());
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
  // Handle already-loaded images (from cache)
  if (imgEl.complete && imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0) {
    handleImageLoad(imgEl, imageEmbedContainer, cardEl, onLayoutUpdate);
  } else {
    imgEl.addEventListener("load", () => {
      handleImageLoad(imgEl, imageEmbedContainer, cardEl, onLayoutUpdate);
    });
    // On error, still add cover-ready so cover shows (even if broken)
    imgEl.addEventListener("error", () => {
      cardEl.classList.add("cover-ready");
      if (onLayoutUpdate) onLayoutUpdate();
    });
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
  if (!imgEl || !imgEl.complete || imgEl.naturalWidth === 0) return;

  const cardEl = imgEl.closest(".card") as HTMLElement;
  if (!cardEl || cardEl.classList.contains("cover-ready")) return; // Already handled

  const imageEmbedEl = imgEl.closest(".image-embed") as HTMLElement;
  if (!imageEmbedEl) return;

  handleImageLoad(imgEl, imageEmbedEl, cardEl, updateLayoutRef.current);
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

  const imageEmbedEl = imgEl.closest(".image-embed") as HTMLElement;
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
  if (!cardEl) return;

  cardEl.classList.add("cover-ready");
  if (updateLayoutRef.current) updateLayoutRef.current();
}
