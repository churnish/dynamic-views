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
 * Get minimum card width from CSS variable
 */
export function getMinCardWidth(): number {
	return getCSSVariableAsNumber('--dynamic-views-min-card-width', 400);
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
 */
export function showTimestampIcon(): boolean {
	return hasBodyClass('dynamic-views-show-timestamp-icon');
}

/**
 * Get tag style from body class
 */
export function getTagStyle(): 'plain' | 'theme' | 'minimal' {
	if (hasBodyClass('dynamic-views-tag-style-minimal')) return 'minimal';
	if (hasBodyClass('dynamic-views-tag-style-theme')) return 'theme';
	return 'plain';
}
