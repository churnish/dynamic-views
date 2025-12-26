import {
  extractDominantColor,
  formatAmbientColor,
  calculateLuminanceFromTuple,
  LUMINANCE_LIGHT_THRESHOLD,
  type RGBTuple,
} from "../utils/ambient-color";
import {
  isCardBackgroundAmbient,
  isCoverBackgroundAmbient,
  getCardAmbientOpacity,
} from "../utils/style-settings";
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

// Default aspect ratio for failed images to prevent layout issues (#25)
const DEFAULT_ASPECT_RATIO = 0.75; // 4:3 landscape

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
  // Card background uses setting-defined opacity, cover background uses 0.17
  const cardOpacity = getCardAmbientOpacity();
  const coverOpacity = 0.17;

  const cardColor = formatAmbientColor(rgb, cardOpacity);
  const coverColor = formatAmbientColor(rgb, coverOpacity);

  // Cover container gets subtle opacity for letterbox
  imageEmbedContainer.style.setProperty("--ambient-color", coverColor);
  // Card gets opacity based on card ambient setting
  cardEl.style.setProperty(
    "--ambient-color",
    isCoverImage && !isCardBackgroundAmbient() ? coverColor : cardColor,
  );
  cardEl.setAttribute("data-ambient-theme", theme);
  if (luminance !== undefined) {
    cardEl.style.setProperty("--ambient-luminance", luminance.toFixed(3));
  }
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
): void {
  const cached = imageMetadataCache.get(imgSrc);
  if (!cached) return;

  // Only apply ambient color if it was cached (ambient settings were on when extracted)
  if (cached.rgb && cached.theme) {
    const isCover =
      isCoverImage ?? cardEl.classList.contains("image-format-cover");
    applyAmbientStyles(
      cached.rgb,
      cached.theme,
      cached.luminance,
      imageEmbedContainer,
      cardEl,
      isCover,
    );
  }
  if (cached.aspectRatio !== undefined) {
    cardEl.style.setProperty(
      "--actual-aspect-ratio",
      cached.aspectRatio.toString(),
    );
  }
  cardEl.classList.add("cover-ready");
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
 * @param isCoverImage - Pre-computed cover check to avoid DOM query (#26)
 */
export function handleImageLoad(
  imgEl: HTMLImageElement,
  imageEmbedContainer: HTMLElement,
  cardEl: HTMLElement,
  onLayoutUpdate?: (() => void) | null,
  isCoverImage?: boolean,
): void {
  // Calculate aspect ratio with validation (always needed for masonry)
  // Require minimum 1px dimensions to catch broken/corrupt images
  const aspectRatio =
    imgEl.naturalWidth >= 1 && imgEl.naturalHeight >= 1
      ? imgEl.naturalHeight / imgEl.naturalWidth
      : undefined;

  // Only extract ambient color if needed by current settings
  // - Card bg ambient: needs color for all images (cover + thumbnail)
  // - Cover bg ambient: only needs color for cover images
  let rgb: RGBTuple | undefined;
  let colorTheme: "light" | "dark" | undefined;
  let luminance: number | undefined;

  const isCover =
    isCoverImage ?? cardEl.classList.contains("image-format-cover");
  const needsAmbient =
    isCardBackgroundAmbient() || (isCover && isCoverBackgroundAmbient());

  if (needsAmbient) {
    const extracted = extractDominantColor(imgEl);
    if (extracted) {
      rgb = extracted;
      // Calculate luminance directly from tuple (no string conversion)
      luminance = calculateLuminanceFromTuple(rgb);
      colorTheme = luminance > LUMINANCE_LIGHT_THRESHOLD ? "light" : "dark";
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

  // Apply ambient color if extracted (uses shared function #6)
  if (rgb && colorTheme) {
    applyAmbientStyles(
      rgb,
      colorTheme,
      luminance,
      imageEmbedContainer,
      cardEl,
      isCover,
    );
  }

  // Set actual aspect ratio for masonry contain mode (used when "Fixed cover height" is OFF)
  // Use default ratio for invalid/missing dimensions to prevent layout issues
  cardEl.style.setProperty(
    "--actual-aspect-ratio",
    (aspectRatio ?? DEFAULT_ASPECT_RATIO).toString(),
  );

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
 * @returns Cleanup function to remove event listeners (#11)
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
  if (
    imgEl.complete &&
    imgEl.naturalWidth > 0 &&
    imgEl.naturalHeight > 0 &&
    !cardEl.classList.contains("cover-ready")
  ) {
    handleImageLoad(
      imgEl,
      imageEmbedContainer,
      cardEl,
      onLayoutUpdate,
      isCoverImage,
    );
    return () => {}; // No cleanup needed
  }

  // Event handlers for cleanup (#11)
  // Guard against double-processing if cache was applied (#3)
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
    cardEl.classList.add("cover-ready");
    // Set default aspect ratio on error (#25)
    cardEl.style.setProperty(
      "--actual-aspect-ratio",
      DEFAULT_ASPECT_RATIO.toString(),
    );
    if (onLayoutUpdate) {
      onLayoutUpdate();
    }
  };

  // Add load/error listeners for pending images
  imgEl.addEventListener("load", loadHandler, { once: true });
  imgEl.addEventListener("error", errorHandler, { once: true });

  // Return cleanup function (#11)
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

  // Fix null assertions (#3)
  const cardEl = imgEl.closest(".card");
  if (!cardEl || !(cardEl instanceof HTMLElement)) return;

  const imageEmbedEl = imgEl.closest(".dynamic-views-image-embed");
  if (!imageEmbedEl || !(imageEmbedEl instanceof HTMLElement)) return;

  const isCoverImage = cardEl.classList.contains("image-format-cover");

  // Apply cached metadata immediately to prevent flash on re-render
  if (imgEl.src && !cardEl.classList.contains("cover-ready")) {
    applyCachedImageMetadata(imgEl.src, imageEmbedEl, cardEl, isCoverImage);
  }

  // Handle already-loaded images
  if (
    imgEl.complete &&
    imgEl.naturalWidth > 0 &&
    imgEl.naturalHeight > 0 &&
    !cardEl.classList.contains("cover-ready")
  ) {
    handleImageLoad(
      imgEl,
      imageEmbedEl,
      cardEl,
      updateLayoutRef.current,
      isCoverImage,
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

  // Fix null assertions (#3)
  const cardEl = imgEl.closest(".card");
  if (
    !cardEl ||
    !(cardEl instanceof HTMLElement) ||
    cardEl.classList.contains("cover-ready")
  )
    return;

  const imageEmbedEl = imgEl.closest(".dynamic-views-image-embed");
  if (!imageEmbedEl || !(imageEmbedEl instanceof HTMLElement)) return;

  const isCoverImage = cardEl.classList.contains("image-format-cover");
  handleImageLoad(
    imgEl,
    imageEmbedEl,
    cardEl,
    updateLayoutRef.current,
    isCoverImage,
  );
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

  // Fix null assertions (#3)
  const cardEl = imgEl.closest(".card");
  if (
    !cardEl ||
    !(cardEl instanceof HTMLElement) ||
    cardEl.classList.contains("cover-ready")
  )
    return;

  cardEl.classList.add("cover-ready");
  // Set default aspect ratio on error (#25)
  cardEl.style.setProperty(
    "--actual-aspect-ratio",
    DEFAULT_ASPECT_RATIO.toString(),
  );
  if (updateLayoutRef.current) updateLayoutRef.current();
}
