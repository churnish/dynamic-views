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
 * Parse a CSS variable as a number (removing units like 'px')
 */
function getCSSVariableAsNumber(name: string, defaultValue: number): number {
	const value = getCSSVariable(name, '');
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
 * Get minimum card width for Grid view from CSS variable
 */
export function getMinCardWidthGrid(): number {
	return getCSSVariableAsNumber('--dynamic-views-min-card-width-grid', 400);
}

/**
 * Get minimum card width for Masonry view from CSS variable
 */
export function getMinCardWidthMasonry(): number {
	return getCSSVariableAsNumber('--dynamic-views-min-card-width-masonry', 400);
}

/**
 * Get minimum masonry columns from CSS variable
 */
export function getMinMasonryColumns(): number {
	return getCSSVariableAsNumber('--dynamic-views-min-masonry-columns', 2);
}

/**
 * Get minimum grid columns from CSS variable
 */
export function getMinGridColumns(): number {
	return getCSSVariableAsNumber('--dynamic-views-min-grid-columns', 1);
}

/**
 * Check if card background is enabled
 */
export function hasCardBackground(): boolean {
	return hasBodyClass('dynamic-views-card-background');
}

/**
 * Get thumbnail position from body class
 */
export function getThumbnailPosition(): 'left' | 'right' {
	return hasBodyClass('dynamic-views-thumbnail-left') ? 'left' : 'right';
}

/**
 * Check if timestamp icon should be shown
 * Returns true for all icon positions (left, right, inner, outer)
 * Returns false only when explicitly hidden
 */
export function showTimestampIcon(): boolean {
	return !hasBodyClass('dynamic-views-timestamp-icon-hide');
}

/**
 * Get tag style from body class
 */
export function getTagStyle(): 'plain' | 'theme' | 'minimal' {
	if (hasBodyClass('dynamic-views-tag-style-minimal')) return 'minimal';
	if (hasBodyClass('dynamic-views-tag-style-theme')) return 'theme';
	return 'plain';
}

/**
 * Get card spacing from CSS variable
 */
export function getCardSpacing(): number {
	return getCSSVariableAsNumber('--dynamic-views-card-spacing', 8);
}

/**
 * Check if recent timestamps should show time only
 */
export function shouldShowRecentTimeOnly(): boolean {
	return hasBodyClass('dynamic-views-timestamp-recent-time-only');
}

/**
 * Check if older timestamps should show date only
 */
export function shouldShowOlderDateOnly(): boolean {
	return hasBodyClass('dynamic-views-timestamp-older-date-only');
}

/**
 * Type for Style Settings color cache
 */
export interface StyleSettingsColorCache {
	titleColor?: { light?: string; dark?: string };
	snippetColor?: { light?: string; dark?: string };
	tagsColor?: { light?: string; dark?: string };
	timestampColor?: { light?: string; dark?: string };
	metadataColor?: { light?: string; dark?: string };
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
	theme: 'light' | 'dark',
	cache: StyleSettingsColorCache
): void {
	if (cache.titleColor?.[theme]) {
		cardEl.style.setProperty('--dynamic-views-title-color', cache.titleColor[theme]);
	}
	if (cache.snippetColor?.[theme]) {
		cardEl.style.setProperty('--dynamic-views-snippet-color', cache.snippetColor[theme]);
	}
	if (cache.tagsColor?.[theme]) {
		cardEl.style.setProperty('--dynamic-views-tags-color', cache.tagsColor[theme]);
	}
	if (cache.timestampColor?.[theme]) {
		cardEl.style.setProperty('--dynamic-views-timestamp-color', cache.timestampColor[theme]);
	}
	if (cache.metadataColor?.[theme]) {
		cardEl.style.setProperty('--dynamic-views-metadata-color', cache.metadataColor[theme]);
	}
}
