export type RGBTuple = [number, number, number];

// Luminance threshold for light/dark theme detection
// Values above this are considered "light" backgrounds
export const LUMINANCE_LIGHT_THRESHOLD = 0.333;

/**
 * Extract the average color from an image element using canvas sampling
 * Uses a 50×50 scaled canvas for performance (~400× less work than full image)
 *
 * Error handling: Returns null on any failure (CORS, invalid image, etc.)
 *
 * @param img - HTMLImageElement to analyze (must be loaded and same-origin/CORS-enabled)
 * @returns RGB tuple [r, g, b] or null on failure
 */
export function extractDominantColor(img: HTMLImageElement): RGBTuple | null {
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // 50×50 is enough for average color extraction
    const targetSize = 50;
    canvas.width = targetSize;
    canvas.height = targetSize;

    // Draw image scaled down to target size
    ctx.drawImage(img, 0, 0, targetSize, targetSize);

    // Get pixel data
    const imageData = ctx.getImageData(0, 0, targetSize, targetSize);
    const data = imageData.data;

    let r = 0,
      g = 0,
      b = 0;
    const pixelCount = targetSize * targetSize;

    // Sum all RGB values
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }

    // Calculate average
    return [
      Math.floor(r / pixelCount),
      Math.floor(g / pixelCount),
      Math.floor(b / pixelCount),
    ];
  } catch (e) {
    // Log for debugging CORS/image issues
    console.warn("[ambient-color] Failed to extract color:", e);
    return null;
  }
}

/**
 * Format RGB tuple as rgba string with specified opacity
 * @param rgb - RGB tuple [r, g, b] with values 0-255
 * @param alpha - Opacity value between 0 (transparent) and 1 (opaque)
 * @returns CSS rgba string
 */
export function formatAmbientColor(rgb: RGBTuple, alpha: number): string {
  const [r, g, b] = rgb;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// WCAG 2.0 sRGB to linear RGB conversion (gamma correction)
// - Values <= 0.03928 use linear scaling (val / 12.92)
// - Higher values use power curve with constants from sRGB spec
function gammaCorrect(val: number): number {
  return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
}

/**
 * Calculate relative luminance directly from RGB tuple
 * Uses WCAG 2.0 formula: https://www.w3.org/TR/WCAG20/#relativeluminancedef
 *
 * @param rgb - RGB tuple [r, g, b] with values 0-255
 * @returns Luminance value between 0 (darkest) and 1 (lightest)
 */
export function calculateLuminanceFromTuple(rgb: RGBTuple): number {
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;

  const rLinear = gammaCorrect(r);
  const gLinear = gammaCorrect(g);
  const bLinear = gammaCorrect(b);

  // WCAG luminance weights for human perception
  return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
}
