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
  if (hasBodyClass("dynamic-views-hide-empty-show")) return "show";
  if (hasBodyClass("dynamic-views-hide-empty-all")) return "all";
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
 * Check if Card background: Ambient is enabled (subtle or dramatic)
 * Checks the closest .dynamic-views container for per-view ambient classes,
 * falling back to body classes for Datacore views
 */
export function isCardBackgroundAmbient(cardEl?: Element): boolean {
  const container = cardEl?.closest(".dynamic-views");
  if (container) {
    return (
      container.classList.contains("dynamic-views-ambient-bg-subtle") ||
      container.classList.contains("dynamic-views-adaptive-text")
    );
  }
  return (
    hasBodyClass("dynamic-views-ambient-bg-subtle") ||
    hasBodyClass("dynamic-views-adaptive-text")
  );
}

/**
 * Get ambient opacity for card backgrounds
 * Returns 0.17 for subtle, 0.9 for dramatic
 * Checks the closest .dynamic-views container for per-view ambient classes,
 * falling back to body classes for Datacore views
 */
export function getCardAmbientOpacity(cardEl?: Element): number {
  const container = cardEl?.closest(".dynamic-views");
  if (container) {
    return container.classList.contains("dynamic-views-adaptive-text")
      ? 0.9
      : 0.17;
  }
  if (hasBodyClass("dynamic-views-adaptive-text")) {
    return 0.9;
  }
  return 0.17;
}

/**
 * Check if Cover background: Ambient is enabled
 */
export function isCoverBackgroundAmbient(): boolean {
  return hasBodyClass("dynamic-views-cover-bg-ambient");
}

/**
 * Check if backdrop overlay tint is disabled
 * When disabled, luminance detection determines adaptive text colors
 */
function isBackdropTintDisabled(): boolean {
  return hasBodyClass("dynamic-views-backdrop-theme-disable");
}

/**
 * Check if backdrop adaptive text is enabled (default: ON)
 * Returns true when the "disable" toggle is NOT set
 */
function isBackdropAdaptiveTextEnabled(): boolean {
  return !hasBodyClass("dynamic-views-backdrop-no-adaptive-text");
}

/**
 * Check if backdrop overlay is effectively transparent (opacity = 0)
 * Only called when tint is NOT disabled (caller checks isBackdropTintDisabled first)
 */
function isBackdropOverlayTransparent(): boolean {
  // Determine which opacity variable to check based on tint mode
  const isDarkTint = hasBodyClass("dynamic-views-backdrop-theme-dark");
  const isLightTint = hasBodyClass("dynamic-views-backdrop-theme-light");

  if (isDarkTint) {
    return (
      getCSSVariableAsNumber("--dynamic-views-backdrop-overlay-dark", 70) === 0
    );
  }
  if (isLightTint) {
    return (
      getCSSVariableAsNumber("--dynamic-views-backdrop-overlay-light", 70) === 0
    );
  }

  // Default to "match" behavior (CSS default) - check opacity based on current theme
  const isDarkTheme = hasBodyClass("theme-dark");
  const varName = isDarkTheme
    ? "--dynamic-views-backdrop-overlay-dark"
    : "--dynamic-views-backdrop-overlay-light";
  return getCSSVariableAsNumber(varName, 70) === 0;
}

/**
 * Check if backdrop images should use luminance-based adaptive text
 * True when adaptive text is enabled AND (tint disabled OR overlay transparent)
 */
export function shouldUseBackdropLuminance(): boolean {
  return (
    isBackdropAdaptiveTextEnabled() &&
    (isBackdropTintDisabled() || isBackdropOverlayTransparent())
  );
}

/**
 * Check if poster overlay tint is disabled
 */
function isPosterTintDisabled(): boolean {
  return hasBodyClass("dynamic-views-poster-theme-disable");
}

/**
 * Check if poster adaptive text is enabled (default: ON)
 */
function isPosterAdaptiveTextEnabled(): boolean {
  return !hasBodyClass("dynamic-views-poster-no-adaptive-text");
}

/**
 * Check if poster overlay is effectively transparent (opacity = 0)
 */
function isPosterOverlayTransparent(): boolean {
  const isDarkTint = hasBodyClass("dynamic-views-poster-theme-dark");
  const isLightTint = hasBodyClass("dynamic-views-poster-theme-light");

  if (isDarkTint) {
    return (
      getCSSVariableAsNumber("--dynamic-views-poster-overlay-dark", 70) === 0
    );
  }
  if (isLightTint) {
    return (
      getCSSVariableAsNumber("--dynamic-views-poster-overlay-light", 70) === 0
    );
  }

  const isDarkTheme = hasBodyClass("theme-dark");
  const varName = isDarkTheme
    ? "--dynamic-views-poster-overlay-dark"
    : "--dynamic-views-poster-overlay-light";
  return getCSSVariableAsNumber(varName, 70) === 0;
}

/**
 * Check if poster images should use luminance-based adaptive text
 * True when adaptive text is enabled AND (tint disabled OR overlay transparent)
 */
export function shouldUsePosterLuminance(): boolean {
  return (
    isPosterAdaptiveTextEnabled() &&
    (isPosterTintDisabled() || isPosterOverlayTransparent())
  );
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
  onAmbientSettingChange?: () => void,
): () => void {
  // Ambient-related classes that trigger onAmbientSettingChange
  const ambientClasses = [
    "dynamic-views-ambient-bg-off",
    "dynamic-views-ambient-bg-subtle",
    "dynamic-views-adaptive-text",
    "dynamic-views-cover-bg-ambient",
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

        const oldJoined = oldFiltered.join();
        const newJoined = newFiltered.join();
        const dynamicViewsChanged = oldJoined !== newJoined;

        if (dynamicViewsChanged) {
          console.log("[style-settings] DIFFERENCE DETECTED");

          // Find which classes are in new but not old
          const addedClasses = newFiltered.filter(
            (c) => !oldFiltered.includes(c),
          );
          // Find which classes are in old but not new
          const removedClasses = oldFiltered.filter(
            (c) => !newFiltered.includes(c),
          );

          console.log(
            "[style-settings] Added classes (after filtering):",
            addedClasses,
          );
          console.log(
            "[style-settings] Removed classes (after filtering):",
            removedClasses,
          );

          // Check if ambient settings specifically changed (including subtle↔dramatic)
          const oldAmbientSet = ambientClasses
            .filter((c) => oldClasses.includes(c))
            .sort()
            .join();
          const newAmbientSet = ambientClasses
            .filter((c) => newClasses.includes(c))
            .sort()
            .join();
          const ambientChanged = oldAmbientSet !== newAmbientSet;

          if (ambientChanged && onAmbientSettingChange) {
            console.log(
              "[style-settings] Ambient setting changed, calling onAmbientSettingChange",
            );
            // Ambient-only change: call dedicated handler, skip full re-render
            onAmbientSettingChange();
          } else {
            console.log(
              "[style-settings] Non-ambient change, calling onStyleChange -> onDataUpdated",
            );
            // Non-ambient change: full style refresh
            onStyleChange();
          }
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
