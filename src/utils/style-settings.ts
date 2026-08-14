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

/** Per-container cache for getCardSpacing results. Cleared alongside cssTextCache. */
const containerSpacingCache = new Map<HTMLElement, number>();

/** Matches `dynamic-views-` prefixed class names on body */
const DYNAMIC_VIEWS_CLASS_PATTERN = /\bdynamic-views-\S+/g;

/**
 * Set on body once Style Settings has applied its per-setting classes.
 *
 * Style Settings adds `css-settings-manager` to body roughly a second before
 * `initClasses()` runs. CSS that means "Style Settings is installed AND the user
 * unchecked this toggle" cannot gate on `css-settings-manager` alone: during that
 * window the toggle's class is legitimately absent, so the rule fires and the
 * setting reads as switched off. Bold titles visibly dropped to regular weight
 * for the duration. Gate on this class instead.
 */
export const STYLE_SETTINGS_READY_CLASS = 'dynamic-views-ss-ready';

/**
 * Class prefixes Style Settings is guaranteed to have applied once `initClasses()`
 * has run — each belongs to a `class-select` with `allowEmpty: false` and a
 * `default:`, so a value is always emitted. Several are listed from different
 * setting groups so retiring any one setting cannot silently break the signal.
 */
const STYLE_SETTINGS_INITIALIZED_SENTINELS = [
  'dynamic-views-title-case-',
  'dynamic-views-title-size-',
  'dynamic-views-group-value-case-',
  'dynamic-views-tag-style-',
];

/**
 * Add or remove {@link STYLE_SETTINGS_READY_CLASS} on the given document's body to
 * match whether Style Settings has finished applying its classes.
 *
 * Idempotent: `classList.toggle` with an explicit force value mutates nothing when
 * the state already matches, so calling this from a body-class observer settles
 * after one extra no-op pass rather than looping.
 */
export function syncStyleSettingsReadyFlag(doc: Document): void {
  const { className } = doc.body;
  const ready = STYLE_SETTINGS_INITIALIZED_SENTINELS.some((prefix) =>
    className.includes(prefix)
  );
  doc.body.classList.toggle(STYLE_SETTINGS_READY_CLASS, ready);
}

/**
 * Matches Style Settings classes that change text metrics, and therefore card
 * height: font size presets, bold, italic, small caps and case transforms.
 * Longer element stems precede their prefixes so `property-name` is not
 * consumed by `property`.
 */
const TEXT_METRIC_CLASS_PATTERN =
  /\bdynamic-views-(?:group-property|group-value|group-count|property-name|text-preview|subtitle|property|title|tag)-(?:size-\S+|case-\S+|bold|italic|small-caps)\b/g;

/**
 * Clear the CSS variable cache.
 * Call at start of render cycle to pick up any style changes.
 */
export function clearStyleSettingsCache(): void {
  cssTextCache.clear();
  containerSpacingCache.clear();
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
  const value = getCSSVariable(name, '');
  if (value === '') return defaultValue;
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
 * Get compact mode breakpoint from CSS variable
 * Cards narrower than this value enter compact mode
 *
 * Read as text so a bare number and one carrying a unit both work: Style
 * Settings quotes text values, and a CSS snippet setting the variable directly
 * is just as likely to write `390` as `390px`.
 */
export function getCompactBreakpoint(): number {
  const raw = getCSSTextVariable('--dynamic-views-compact-breakpoint', '');
  const parsed = parseFloat(raw);
  return isNaN(parsed) ? 390 : parsed;
}

/**
 * Check if tag hash (#) prefix should be shown
 */
export function showTagHashPrefix(): boolean {
  return hasBodyClass('dynamic-views-show-tag-hash');
}

/**
 * Empty properties display mode from dropdown setting
 */
export type HideEmptyMode = 'show' | 'names-hidden' | 'all';

/**
 * Get empty properties display mode from Style Settings dropdown
 */
export function getHideEmptyMode(): HideEmptyMode {
  if (hasBodyClass('dynamic-views-empty-properties-show')) return 'show';
  if (hasBodyClass('dynamic-views-empty-properties-hide')) return 'all';
  return 'names-hidden'; // default
}

/**
 * Get card spacing from CSS variable.
 * Reads from containerEl first — the per-view gap setting is written there and
 * is authoritative everywhere, including embeds. Falls back to Obsidian's own
 * spacing inside embeds, and to the body-level value otherwise.
 * Any element inside the view container works — CSS variables inherit through the DOM tree.
 */
export function getCardSpacing(containerEl?: HTMLElement): number {
  if (containerEl) {
    const cached = containerSpacingCache.get(containerEl);
    if (cached !== undefined) return cached;
  }
  const isPhone = document.body.classList.contains('is-phone');
  const varName = isPhone
    ? '--dynamic-views-card-spacing-phone'
    : '--dynamic-views-card-spacing-desktop';

  // Container-local value wins everywhere, including embeds — the per-view
  // setting is authoritative and the CSS gap rules already apply in embeds.
  if (containerEl) {
    const value = getComputedStyle(containerEl)
      .getPropertyValue(varName)
      .trim();
    const parsed = parseFloat(value);
    if (value !== '' && !isNaN(parsed)) {
      containerSpacingCache.set(containerEl, parsed);
      return parsed;
    }
  }

  // Embeds otherwise follow Obsidian's own spacing rather than plugin defaults
  if (containerEl?.closest('.internal-embed')) {
    const result = getCSSVariableAsNumber('--size-4-2', 8);
    containerSpacingCache.set(containerEl, result);
    return result;
  }

  const result = getCSSVariableAsNumber(varName, isPhone ? 6 : 8);
  if (containerEl) containerSpacingCache.set(containerEl, result);
  return result;
}

/**
 * Check if recent timestamps should show time only (default behavior)
 * Returns false when user enables "Show full recent timestamps"
 */
export function shouldShowRecentTimeOnly(): boolean {
  return !hasBodyClass('dynamic-views-timestamp-recent-full');
}

/**
 * Check if older timestamps should show date only (default behavior)
 * Returns false when user enables "Show full older timestamps"
 */
export function shouldShowOlderDateOnly(): boolean {
  return !hasBodyClass('dynamic-views-timestamp-past-full');
}

/**
 * Get datetime format from Style Settings
 * Returns Moment.js format string for full datetime display
 */
export function getDatetimeFormat(): string {
  return getCSSTextVariable(
    '--dynamic-views-datetime-format',
    'YYYY-MM-DD, HH:mm'
  );
}

/**
 * Get date format from Style Settings
 * Returns Moment.js format string for date-only display (older timestamps)
 */
export function getDateFormat(): string {
  return getCSSTextVariable('--dynamic-views-date-format', 'YYYY-MM-DD');
}

/**
 * Get time format from Style Settings
 * Returns Moment.js format string for time-only display (recent timestamps)
 */
export function getTimeFormat(): string {
  return getCSSTextVariable('--dynamic-views-time-format', 'HH:mm');
}

/**
 * Get list separator from CSS variable
 * Returns the separator for list-type properties
 */
export function getListSeparator(): string {
  return getCSSTextVariable('--dynamic-views-list-separator', ', ');
}

/**
 * Get empty value marker from CSS variable
 * Returns the symbol for empty property values
 */
export function getEmptyValueMarker(): string {
  return getCSSTextVariable('--dynamic-views-empty-value-marker', '—');
}

/**
 * Check if missing properties should be hidden
 * Returns true if properties that don't exist on a file should not be displayed
 */
export function shouldHideMissingProperties(): boolean {
  return hasBodyClass('dynamic-views-hide-missing-properties');
}

/** Check if fixed-height Style Settings is active for masonry views. */
export function isFixedHeightForMasonry(
  body: Element,
  prefix: 'cover' | 'poster'
): boolean {
  const base = `dynamic-views-fixed-${prefix}-height`;
  const cl = body.classList;
  return (
    cl.contains(base) ||
    cl.contains(`${base}-masonry`) ||
    cl.contains(`${base}-both`)
  );
}

/** Returns false when "Disable navigation" is enabled for covers. */
export function isSlideshowEnabled(): boolean {
  return !hasBodyClass('dynamic-views-cover-disable-navigation');
}

/**
 * Check if slideshow icon should be shown (default behavior)
 * Returns false when user enables "Hide slideshow icon"
 */
export function isSlideshowIconEnabled(): boolean {
  return !hasBodyClass('dynamic-views-hide-cover-icon');
}

/**
 * Check if thumbnail navigation is disabled
 * Returns true when user enables "Disable navigation" for thumbnails
 */
export function isThumbnailScrubbingDisabled(): boolean {
  return hasBodyClass('dynamic-views-thumbnail-disable-navigation');
}

/**
 * Check if heading text should be kept in text previews
 * Returns true when user enables "Preserve headings"
 */
export function preserveTextPreviewHeadings(): boolean {
  return hasBodyClass('dynamic-views-text-preview-preserve-headings');
}

/**
 * Check if newlines should be preserved in text previews
 * Returns true when user enables "Preserve line breaks"
 */
export function preserveTextPreviewNewlines(): boolean {
  return hasBodyClass('dynamic-views-text-preview-preserve-line-breaks');
}

export type OmitFirstLineMode = 'always' | 'ifMatchesTitle' | 'never';

/**
 * Which first-line omission mode is active.
 * Returns 'ifMatchesTitle' as default when neither explicit class is present
 * (Style Settings applies `dynamic-views-omit-first-line-match` which is
 * handled as the elimination fallback, not an explicit check).
 */
export function getOmitFirstLineMode(): OmitFirstLineMode {
  if (hasBodyClass('dynamic-views-omit-first-line-always')) return 'always';
  if (hasBodyClass('dynamic-views-omit-first-line-never')) return 'never';
  return 'ifMatchesTitle'; // default
}

/**
 * Get maximum number of images for slideshow
 * Returns slider value (default 10, min 2, max 24)
 */
export function getSlideshowMaxImages(): number {
  return getCSSVariableAsNumber('--dynamic-views-slideshow-max-images', 10);
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
    // Body classes for overflow and layout modes
    hasBodyClass('dynamic-views-title-overflow-scroll'),
    hasBodyClass('dynamic-views-subtitle-overflow-scroll'),
    hasBodyClass('dynamic-views-poster-uniform-height'),
    // Text preview content options (affect stripped text output)
    preserveTextPreviewHeadings(),
    preserveTextPreviewNewlines(),
    getOmitFirstLineMode(),
  ].join('|');
}

/**
 * Hash of Style Settings that change card geometry but not card content.
 * Kept separate from getStyleSettingsHash so a size change relayouts without
 * discarding cached text previews.
 */
export function getStyleSettingsLayoutHash(): string {
  return (document.body.className.match(TEXT_METRIC_CLASS_PATTERN) ?? [])
    .sort()
    .join(',');
}

/**
 * Setup MutationObserver for Dynamic Views settings changes
 * Watches body class changes (plugin + Style Settings) and Style Settings stylesheet changes
 * @returns Cleanup function to disconnect observer
 */
export function setupStyleSettingsObserver(
  onStyleChange: () => void,
  containerEl: HTMLElement
): () => void {
  // Derive document/window from containerEl so popout windows observe their own body,
  // not the main window's body (which updates ~51ms earlier, causing layout glitches)
  const doc = containerEl.ownerDocument;
  const win = doc.defaultView ?? window;
  const MO = win.MutationObserver ?? MutationObserver;

  // Mutually exclusive class-select groups. When multiple are present (Style Settings
  // race), keep only the last.
  const FILE_TYPE_CLASSES = [
    'dynamic-views-file-type-none',
    'dynamic-views-file-type-flair',
    'dynamic-views-file-type-icon',
  ];

  // Hash of JS-relevant Style Settings — only fire callback when actual values change
  let prevHash = getStyleSettingsHash() + '\0' + getStyleSettingsLayoutHash();

  // Observer for body class changes (Style Settings class-toggle settings)
  const bodyObserver = new MO((mutations) => {
    for (const mutation of mutations) {
      if (
        mutation.type === 'attributes' &&
        mutation.attributeName === 'class'
      ) {
        // Before the diff below: the ready flag must land in the same frame Style
        // Settings applies its classes, or the gated rules flash their off state.
        syncStyleSettingsReadyFlag(doc);

        // Skip when no dynamic-views- class changed (e.g., is-grabbing, theme classes)
        const oldDV =
          (mutation.oldValue ?? '')
            .match(DYNAMIC_VIEWS_CLASS_PATTERN)
            ?.sort()
            .join(' ') ?? '';
        const newDV =
          doc.body.className
            .match(DYNAMIC_VIEWS_CLASS_PATTERN)
            ?.sort()
            .join(' ') ?? '';
        if (oldDV === newDV) break;

        // Enforce mutual exclusivity when Style Settings applies a new value.
        // Deferred: class-select fires two mutations (remove old, add new) —
        // checking synchronously sees the intermediate state.
        queueMicrotask(() => {
          const active = FILE_TYPE_CLASSES.filter((c) =>
            doc.body.classList.contains(c)
          );
          if (active.length > 1) {
            // Keep only the last one (most recently added by Style Settings)
            for (const c of active.slice(0, -1)) {
              doc.body.classList.remove(c);
            }
          }
        });

        // Only fire if JS-relevant settings actually changed
        clearStyleSettingsCache(); // Must clear before re-hashing
        const newHash =
          getStyleSettingsHash() + '\0' + getStyleSettingsLayoutHash();
        if (newHash !== prevHash) {
          prevHash = newHash;
          onStyleChange();
        }
        break;
      }
    }
  });

  // Seed the flag for views opened after Style Settings already settled — the
  // observer only fires on subsequent mutations
  syncStyleSettingsReadyFlag(doc);

  bodyObserver.observe(doc.body, {
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ['class'],
  });

  // Observer for Style Settings stylesheet changes (slider/variable settings)
  // Style Settings updates a <style> element in <head> with id "css-settings-manager"
  const styleEl = doc.getElementById('css-settings-manager');
  let styleObserver: MutationObserver | null = null;

  if (styleEl) {
    styleObserver = new MO(() => {
      if (styleEl.textContent?.includes('--dynamic-views-')) {
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
