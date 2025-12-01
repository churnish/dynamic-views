/**
 * Utility functions to read Style Settings values from CSS variables and body classes
 */

/**
 * Read a CSS variable value from the document body
 */
function getCSSVariable(name: string, defaultValue: string): string {
  const value = getComputedStyle(document.body).getPropertyValue(name).trim();
  return value || defaultValue;
}

/**
 * Read a CSS text variable, stripping surrounding quotes
 * Style Settings wraps text values in quotes
 */
function getCSSTextVariable(name: string, defaultValue: string): string {
  let value = getComputedStyle(document.body).getPropertyValue(name).trim();
  // Strip surrounding quotes if present (Style Settings adds them)
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value || defaultValue;
}

/**
 * Parse a CSS variable as a number (removing units like 'px')
 */
function getCSSVariableAsNumber(name: string, defaultValue: number): number {
  const value = getCSSVariable(name, "");
  if (!value) return defaultValue;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Check if body has a specific class
 */
function hasBodyClass(className: string): boolean {
  return document.body.classList.contains(className);
}

/**
 * Get minimum masonry columns from CSS variable
 */
export function getMinMasonryColumns(): number {
  return getCSSVariableAsNumber("--dynamic-views-min-masonry-columns", 2);
}

/**
 * Get minimum grid columns from CSS variable
 */
export function getMinGridColumns(): number {
  return getCSSVariableAsNumber("--dynamic-views-min-grid-columns", 1);
}

/**
 * Check if card background is enabled
 */
export function hasCardBackground(): boolean {
  return hasBodyClass("dynamic-views-card-background");
}

/**
 * Check if timestamp icon should be shown
 * Returns true for all icon positions (left, right, inner, outer)
 * Returns false only when explicitly hidden
 */
export function showTimestampIcon(): boolean {
  return !hasBodyClass("dynamic-views-timestamp-icon-hide");
}

/**
 * Get tag style from body class
 */
export function getTagStyle(): "plain" | "theme" | "minimal" {
  if (hasBodyClass("dynamic-views-tag-style-minimal")) return "minimal";
  if (hasBodyClass("dynamic-views-tag-style-theme")) return "theme";
  return "plain";
}

/**
 * Check if tag hash (#) prefix should be shown
 */
export function showTagHashPrefix(): boolean {
  return hasBodyClass("dynamic-views-show-tag-hash");
}

/**
 * Get card spacing from CSS variable
 */
export function getCardSpacing(): number {
  return getCSSVariableAsNumber("--dynamic-views-card-spacing", 8);
}

/**
 * Check if recent timestamps should show time only (default behavior)
 * Returns false when user enables "Show full recent timestamps"
 */
export function shouldShowRecentTimeOnly(): boolean {
  return !hasBodyClass("dynamic-views-timestamp-recent-full");
}

/**
 * Check if older timestamps should show date only (default behavior)
 * Returns false when user enables "Show full older timestamps"
 */
export function shouldShowOlderDateOnly(): boolean {
  return !hasBodyClass("dynamic-views-timestamp-older-full");
}

/**
 * Get datetime format from Style Settings
 * Returns Moment.js format string for full datetime display
 */
export function getDatetimeFormat(): string {
  return getCSSTextVariable(
    "--dynamic-views-datetime-format",
    "YYYY-MM-DD HH:mm",
  );
}

/**
 * Get date format from Style Settings
 * Returns Moment.js format string for date-only display (older timestamps)
 */
export function getDateFormat(): string {
  return getCSSTextVariable("--dynamic-views-date-format", "YYYY-MM-DD");
}

/**
 * Get time format from Style Settings
 * Returns Moment.js format string for time-only display (recent timestamps)
 */
export function getTimeFormat(): string {
  return getCSSTextVariable("--dynamic-views-time-format", "HH:mm");
}

/**
 * Get list separator from CSS variable
 * Returns the separator for list-type properties
 */
export function getListSeparator(): string {
  return getCSSTextVariable("--dynamic-views-list-separator", ", ");
}

/**
 * Get empty value marker from CSS variable
 * Returns the symbol for empty property values
 */
export function getEmptyValueMarker(): string {
  return getCSSTextVariable("--dynamic-views-empty-value-marker", "—");
}

/**
 * Check if missing properties should be hidden
 * Returns true if properties that don't exist on a file should not be displayed
 */
export function shouldHideMissingProperties(): boolean {
  return hasBodyClass("dynamic-views-hide-missing-properties");
}

/**
 * Check if empty properties should be hidden
 * Returns true if properties with empty values should not be displayed
 */
export function shouldHideEmptyProperties(): boolean {
  return hasBodyClass("dynamic-views-hide-empty-properties");
}

/**
 * Get zoom sensitivity from Style Settings
 */
export function getZoomSensitivity(): number {
  return getCSSVariableAsNumber("--dynamic-views-zoom-sensitivity", 0.15);
}

/**
 * Check if slideshow is enabled (default behavior)
 * Returns false when user enables "Disable slideshow"
 */
export function isSlideshowEnabled(): boolean {
  return !hasBodyClass("dynamic-views-slideshow-disabled");
}

/**
 * Check if slideshow indicator should be shown (default behavior)
 * Returns false when user enables "Hide slideshow indicator"
 */
export function isSlideshowIndicatorEnabled(): boolean {
  return !hasBodyClass("dynamic-views-hide-slideshow-indicator");
}

/**
 * Type for Style Settings color cache
 */
export interface StyleSettingsColorCache {
  titleColor?: { light?: string; dark?: string };
  snippetColor?: { light?: string; dark?: string };
  tagsColor?: { light?: string; dark?: string };
  timestampColor?: { light?: string; dark?: string };
  propertyColor?: { light?: string; dark?: string };
}

/**
 * Apply custom colors from Style Settings to a card element
 * Used for ambient card backgrounds to apply themed text colors
 * @param cardEl - Card element to apply colors to
 * @param theme - 'light' or 'dark' theme based on ambient color
 * @param cache - Style Settings color cache with custom colors
 */
export function applyCustomColors(
  cardEl: HTMLElement,
  theme: "light" | "dark",
  cache: StyleSettingsColorCache,
): void {
  if (cache.titleColor?.[theme]) {
    cardEl.style.setProperty(
      "--dynamic-views-title-color",
      cache.titleColor[theme],
    );
  }
  if (cache.snippetColor?.[theme]) {
    cardEl.style.setProperty(
      "--dynamic-views-snippet-color",
      cache.snippetColor[theme],
    );
  }
  if (cache.tagsColor?.[theme]) {
    cardEl.style.setProperty(
      "--dynamic-views-tags-color",
      cache.tagsColor[theme],
    );
  }
  if (cache.timestampColor?.[theme]) {
    cardEl.style.setProperty(
      "--dynamic-views-timestamp-color",
      cache.timestampColor[theme],
    );
  }
  if (cache.propertyColor?.[theme]) {
    cardEl.style.setProperty(
      "--dynamic-views-property-color",
      cache.propertyColor[theme],
    );
  }
}
