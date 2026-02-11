/**
 * Utility functions to read Style Settings values from CSS variables and body classes
 */

/**
 * Cache for CSS text variables to avoid repeated getComputedStyle calls.
 * Reading getComputedStyle forces layout recalculation - calling it per card
 * during render causes severe layout thrashing (1000+ forced layouts).
 * Cache is cleared at start of each render cycle.
 */
const cssTextCache = new Map<string, string>();

/**
 * Clear the CSS variable cache.
 * Call at start of render cycle to pick up any style changes.
 */
export function clearStyleSettingsCache(): void {
  cssTextCache.clear();
}

/**
 * Read a CSS variable value from the document body.
 * Uses cache to avoid repeated getComputedStyle calls during render.
 */
function getCSSVariable(name: string, defaultValue: string): string {
  // Check cache first
  const cacheKey = `var:${name}|${defaultValue}`;
  const cached = cssTextCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const value = getComputedStyle(document.body).getPropertyValue(name).trim();
  const result = value || defaultValue;
  cssTextCache.set(cacheKey, result);
  return result;
}

/**
 * Read a CSS text variable, stripping surrounding quotes
 * Style Settings wraps text values in quotes.
 * Uses cache to avoid repeated getComputedStyle calls during render.
 */
function getCSSTextVariable(name: string, defaultValue: string): string {
  // Check cache first
  const cacheKey = `${name}|${defaultValue}`;
  const cached = cssTextCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  let value = getComputedStyle(document.body).getPropertyValue(name).trim();
  // Strip surrounding quotes if present (Style Settings adds them)
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  const result = value || defaultValue;
  cssTextCache.set(cacheKey, result);
  return result;
}

/**
 * Parse a CSS variable as a number (removing units like 'px')
 */
function getCSSVariableAsNumber(name: string, defaultValue: number): number {
  const value = getCSSVariable(name, "");
  if (value === "") return defaultValue;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Check if body has a specific class
 */
export function hasBodyClass(className: string): boolean {
  return document.body.classList.contains(className);
}

/**
 * Get minimum masonry columns from CSS variable
 * @deprecated Used by Datacore only — Bases reads from per-view settings
 */
export function getMinMasonryColumns(): number {
  return getCSSVariableAsNumber("--dynamic-views-min-masonry-columns", 2);
}

/**
 * Get minimum grid columns from CSS variable
 * @deprecated Used by Datacore only — Bases reads from per-view settings
 */
export function getMinGridColumns(): number {
  return getCSSVariableAsNumber("--dynamic-views-min-grid-columns", 1);
}

/**
 * Get compact mode breakpoint from CSS variable
 * Cards narrower than this value enter compact mode
 */
export function getCompactBreakpoint(): number {
  return getCSSVariableAsNumber("--dynamic-views-compact-breakpoint", 390);
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
 * Empty properties display mode from dropdown setting
 */
export type HideEmptyMode = "show" | "labels-hidden" | "all";

/**
 * Get empty properties display mode from Style Settings dropdown
 */
export function getHideEmptyMode(): HideEmptyMode {
  if (hasBodyClass("dynamic-views-empty-properties-show")) return "show";
  if (hasBodyClass("dynamic-views-empty-properties-hide")) return "all";
  return "labels-hidden"; // default
}

/**
 * Get card spacing from CSS variable
 * For Bases files, returns user-configured value (desktop/mobile); for embeds, returns Obsidian default
 */
export function getCardSpacing(containerEl?: HTMLElement): number {
  // Check if we're in a Bases file (not embed)
  if (
    containerEl &&
    !containerEl.closest('.workspace-leaf-content[data-type="bases"]')
  ) {
    // Embed: use Obsidian's spacing scale
    return getCSSVariableAsNumber("--size-4-2", 8);
  }
  const isMobile = document.body.classList.contains("is-mobile");
  const varName = isMobile
    ? "--dynamic-views-card-spacing-mobile"
    : "--dynamic-views-card-spacing-desktop";
  const defaultVal = isMobile ? 6 : 8;
  return getCSSVariableAsNumber(varName, defaultVal);
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
  return !hasBodyClass("dynamic-views-timestamp-past-full");
}

/**
 * Get datetime format from Style Settings
 * Returns Moment.js format string for full datetime display
 */
export function getDatetimeFormat(): string {
  return getCSSTextVariable(
    "--dynamic-views-datetime-format",
    "YYYY-MM-DD, HH:mm",
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
 * Get zoom sensitivity from Style Settings (desktop)
 */
export function getZoomSensitivityDesktop(): number {
  return getCSSVariableAsNumber(
    "--dynamic-views-zoom-sensitivity-desktop",
    0.08,
  );
}

/**
 * Get zoom sensitivity for mobile (hardcoded - no user setting)
 */
export function getZoomSensitivityMobile(): number {
  return 0.6;
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
 * Check if thumbnail scrubbing is disabled
 * Returns true when user enables "Disable thumbnail scrubbing"
 */
export function isThumbnailScrubbingDisabled(): boolean {
  return hasBodyClass("dynamic-views-disable-thumbnail-scrubbing");
}

/**
 * Get maximum number of images for slideshow
 * Returns slider value (default 10, min 2, max 24)
 */
export function getSlideshowMaxImages(): number {
  return getCSSVariableAsNumber("--dynamic-views-slideshow-max-images", 10);
}

/**
 * Get URL button icon from Style Settings
 * Accepts both "lucide-donut" and "donut" formats
 */
export function getUrlIcon(): string {
  let icon = getCSSTextVariable("--dynamic-views-url-icon", "arrow-up-right");
  // Strip "lucide-" prefix if present (case-insensitive)
  if (icon.toLowerCase().startsWith("lucide-")) {
    icon = icon.slice(7);
  }
  return icon;
}

/**
 * Get a hash of Style Settings that affect card rendering
 * Used to detect when cards need re-rendering due to Style Settings changes
 */
export function getStyleSettingsHash(): string {
  return [
    // Timestamp formatting
    shouldShowRecentTimeOnly(),
    shouldShowOlderDateOnly(),
    getDatetimeFormat(),
    getDateFormat(),
    getTimeFormat(),
    // Property display
    getListSeparator(),
    getEmptyValueMarker(),
    shouldHideMissingProperties(),
    getHideEmptyMode(),
    showTagHashPrefix(),
    // Slideshow
    isSlideshowEnabled(),
    isThumbnailScrubbingDisabled(),
    getSlideshowMaxImages(),
    // Layout
    getCompactBreakpoint(),
    getZoomSensitivityDesktop(),
    // Other
    getUrlIcon(),
    // Body classes for overflow and layout modes
    hasBodyClass("dynamic-views-title-overflow-scroll"),
    hasBodyClass("dynamic-views-subtitle-overflow-scroll"),
    hasBodyClass("dynamic-views-hidden-file-extensions"),
  ].join("|");
}

/**
 * Setup MutationObserver for Dynamic Views Style Settings changes
 * Watches class changes (class-toggle settings) and Style Settings stylesheet changes (slider settings)
 * @returns Cleanup function to disconnect observer
 */
export function setupStyleSettingsObserver(
  onStyleChange: () => void,
): () => void {
  // Mutually exclusive class-select groups that must always have one active member.
  // When Style Settings is disabled it strips all managed classes — re-add the default.
  const FILE_TYPE_CLASSES = [
    "dynamic-views-file-type-ext",
    "dynamic-views-file-type-flair",
    "dynamic-views-file-type-icon",
    "dynamic-views-file-type-none",
  ];

  // Dynamic classes that should NOT trigger re-renders (added/removed by plugin at runtime)
  const ignoredDynamicClasses = [
    "dynamic-views-backdrop-theme-match", // Style Settings default
    "dynamic-views-poster-theme-match", // Style Settings default
  ];

  // Observer for body class changes (Style Settings class-toggle settings)
  const bodyObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (
        mutation.type === "attributes" &&
        mutation.attributeName === "class"
      ) {
        // Re-apply default when Style Settings strips all file-type classes
        if (
          !FILE_TYPE_CLASSES.some((c) => document.body.classList.contains(c))
        ) {
          document.body.classList.add("dynamic-views-file-type-ext");
        }

        // Check if any dynamic-views class changed (excluding runtime-only classes)
        const oldClasses = mutation.oldValue?.split(" ") || [];
        const newClasses = document.body.className.split(" ");

        const oldFiltered = oldClasses
          .filter(
            (c) =>
              c.startsWith("dynamic-views-") &&
              !ignoredDynamicClasses.includes(c),
          )
          .sort();
        const newFiltered = newClasses
          .filter(
            (c) =>
              c.startsWith("dynamic-views-") &&
              !ignoredDynamicClasses.includes(c),
          )
          .sort();

        if (oldFiltered.join() !== newFiltered.join()) {
          onStyleChange();
          break;
        }
      }
    }
  });

  bodyObserver.observe(document.body, {
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ["class"],
  });

  // Observer for Style Settings stylesheet changes (slider/variable settings)
  // Style Settings updates a <style> element in <head> with id "css-settings-manager"
  const styleEl = document.getElementById("css-settings-manager");
  let styleObserver: MutationObserver | null = null;

  if (styleEl) {
    styleObserver = new MutationObserver(() => {
      if (styleEl.textContent?.includes("--dynamic-views-")) {
        onStyleChange();
      }
    });

    styleObserver.observe(styleEl, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  return () => {
    bodyObserver.disconnect();
    styleObserver?.disconnect();
  };
}
