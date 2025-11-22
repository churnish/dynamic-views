import { extractAverageColor, getColorTheme } from "../utils/image-color";
import { IMAGE_ASPECT_RATIO } from "./constants";

/**
 * Core logic for handling image load
 * Extracts ambient color, calculates aspect ratio, and triggers layout update
 * Can be called from both addEventListener and JSX onLoad handlers
 *
 * @param imgEl - The image element
 * @param imageEmbedContainer - Container for the image embed (for CSS variables)
 * @param cardEl - The card element (for aspect ratio CSS variable)
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

  // Set aspect ratio for flexible cover height (masonry only)
  if (imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0) {
    const imgAspect = imgEl.naturalHeight / imgEl.naturalWidth;
    const cssValue = getComputedStyle(cardEl)
      .getPropertyValue("--dynamic-views-image-aspect-ratio")
      .trim();
    const containerMaxAspect = parseFloat(
      cssValue || String(IMAGE_ASPECT_RATIO),
    );

    // Always update aspect ratio: use image ratio if narrower, else remove to use default
    if (imgAspect < containerMaxAspect) {
      cardEl.style.setProperty("--actual-aspect-ratio", imgAspect.toString());
    } else {
      cardEl.style.removeProperty("--actual-aspect-ratio");
    }
  }

  // Trigger layout update if callback provided (for masonry reflow)
  if (onLayoutUpdate) {
    onLayoutUpdate();
  }
}

/**
 * Sets up image load event handler for card images (for imperative DOM / Bases)
 * Handles ambient color extraction, aspect ratio calculation, and layout updates
 * Handles both cached and uncached images correctly
 *
 * @param imgEl - The image element
 * @param imageEmbedContainer - Container for the image embed (for CSS variables)
 * @param cardEl - The card element (for aspect ratio CSS variable)
 * @param onLayoutUpdate - Optional callback to trigger layout update (for masonry)
 */
export function setupImageLoadHandler(
  imgEl: HTMLImageElement,
  imageEmbedContainer: HTMLElement,
  cardEl: HTMLElement,
  onLayoutUpdate?: () => void,
): void {
  // Check if image is already cached/loaded
  if (imgEl.complete && imgEl.naturalHeight > 0) {
    // Image already loaded, handle immediately
    handleImageLoad(imgEl, imageEmbedContainer, cardEl, onLayoutUpdate);
  } else {
    // Image not yet loaded, attach load listener
    imgEl.addEventListener("load", () => {
      handleImageLoad(imgEl, imageEmbedContainer, cardEl, onLayoutUpdate);
    });
  }
}
