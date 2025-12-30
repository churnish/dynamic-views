import ColorThief from "colorthief";

// Lazy-initialized ColorThief instance
let colorThief: ColorThief | null = null;

function getColorThief(): ColorThief {
  if (!colorThief) {
    colorThief = new ColorThief();
  }
  return colorThief;
}

export type RGBTuple = [number, number, number];

// Pre-compiled regex for RGB parsing
const RGB_REGEX = /rgba?\((\d+),\s*(\d+),\s*(\d+)/;

// Luminance threshold for light/dark theme detection
// Values above this are considered "light" backgrounds
export const LUMINANCE_LIGHT_THRESHOLD = 0.333;

/**
 * Convert RGB tuple to CSS rgb() string
 * @param rgb - RGB tuple [r, g, b] with values 0-255
 * @returns CSS string in format "rgb(r, g, b)"
 */
export function rgbTupleToString(rgb: RGBTuple): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

/**
 * Extract the dominant color from an image element using color-thief
 * Uses Modified Median Cut Quantization for vibrant color extraction
 *
 * Error handling: Returns null on any failure (CORS, invalid image, etc.)
 * Use console warnings in development to debug extraction failures.
 *
 * @param img - HTMLImageElement to analyze (must be loaded and same-origin/CORS-enabled)
 * @returns RGB tuple [r, g, b] or null on failure
 */
export function extractDominantColor(img: HTMLImageElement): RGBTuple | null {
  try {
    return getColorThief().getColor(img);
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

/**
 * Helper to safely parse integer with NaN handling
 */
function safeParseInt(value: string): number {
  const parsed = parseInt(value);
  return isNaN(parsed) ? 0 : Math.min(255, Math.max(0, parsed));
}

/**
 * Calculate relative luminance of an RGB color from string
 * Uses WCAG 2.0 formula: https://www.w3.org/TR/WCAG20/#relativeluminancedef
 *
 * Error handling: Returns 0.5 (mid-gray) for invalid input strings.
 *
 * @param rgbString - RGB color string in exact format "rgb(r, g, b)" or "rgba(r, g, b, a)"
 *                    where r, g, b are integers 0-255
 * @returns Luminance value between 0 (darkest) and 1 (lightest)
 */
export function calculateLuminance(rgbString: string): number {
  const match = rgbString.match(RGB_REGEX);
  if (!match) return 0.5;

  // Parse with NaN handling
  const rRaw = safeParseInt(match[1]);
  const gRaw = safeParseInt(match[2]);
  const bRaw = safeParseInt(match[3]);

  return calculateLuminanceFromTuple([rRaw, gRaw, bRaw]);
}
