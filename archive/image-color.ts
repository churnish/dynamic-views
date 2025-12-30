/**
 * Extract the average color from an image element
 * @param img - HTMLImageElement to analyze
 * @returns RGB color string in format "rgb(r, g, b)"
 */
export function extractAverageColor(img: HTMLImageElement): string {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    return "rgb(128, 128, 128)"; // Fallback gray
  }

  // Use small canvas for performance - 50x50 is enough for average color
  const targetSize = 50;
  canvas.width = targetSize;
  canvas.height = targetSize;

  // Draw image scaled down
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
    r += data[i]; // Red
    g += data[i + 1]; // Green
    b += data[i + 2]; // Blue
    // Skip alpha (data[i + 3])
  }

  // Calculate average
  r = Math.floor(r / pixelCount);
  g = Math.floor(g / pixelCount);
  b = Math.floor(b / pixelCount);

  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Calculate relative luminance of an RGB color
 * Uses WCAG formula: https://www.w3.org/TR/WCAG20/#relativeluminancedef
 * @param rgbString - RGB color string in format "rgb(r, g, b)"
 * @returns Luminance value between 0 (darkest) and 1 (lightest)
 */
export function calculateLuminance(rgbString: string): number {
  const match = rgbString.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!match) return 0.5;

  const r = parseInt(match[1]) / 255;
  const g = parseInt(match[2]) / 255;
  const b = parseInt(match[3]) / 255;

  const gammaCorrect = (val: number) =>
    val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);

  const rLinear = gammaCorrect(r);
  const gLinear = gammaCorrect(g);
  const bLinear = gammaCorrect(b);

  return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
}

/**
 * Determine if a color is light or dark based on its luminance
 * @param rgbString - RGB color string in format "rgb(r, g, b)"
 * @returns 'light' if luminance > 0.3, otherwise 'dark'
 */
export function getColorTheme(rgbString: string): "light" | "dark" {
  return calculateLuminance(rgbString) > 0.3 ? "light" : "dark";
}
