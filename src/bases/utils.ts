/**
 * Shared utilities for Bases views (Grid and Masonry)
 * Eliminates code duplication between view implementations
 */

import type { EventRef } from 'obsidian';
import {
  BasesEntry,
  TFile,
  TFolder,
  Menu,
  App,
  Platform,
  setIcon,
  parseYaml,
  stringifyYaml,
  Notice,
} from 'obsidian';
import { resolveTimestampProperty } from '../core/data-transform';
import { restoreActiveIndicator } from '../core/multi-image-icon';
import {
  getFirstBasesPropertyValue,
  getAllBasesImagePropertyValues,
} from '../core/property-extraction';
import {
  loadTextPreviewsForEntries,
  loadImagesForEntries,
} from '../core/content-loader';
import { getYouTubeTargetWidth } from '../core/youtube-preview';
import {
  shouldUseNotebookNavigator,
  navigateToTagInNotebookNavigator,
  navigateToFolderInNotebookNavigator,
} from '../core/notebook-navigator';
import type { PluginSettings, ResolvedSettings, ViewDefaults } from '../types';
import { BASES_DEFAULTS, VIEW_DEFAULTS } from '../constants';
import {
  VALID_VIEW_VALUES,
  VIEW_DEFAULTS_TYPES,
} from '../core/view-validation';
import { extractBasesTemplate } from '../core/settings-schema';
import type DynamicViews from '../../main';

/** Bases config interface — matches the config object on BasesView subclasses */
interface BasesConfigInit {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  getOrder(): string[];
}

/**
 * Keys allowed in Dynamic Views .base view entries.
 * Intentional allowlist — strips stale keys from older plugin versions.
 * Forward-compatibility risk accepted: if Obsidian adds new Bases-native view
 * keys, they must be added here or they'll be silently removed on first render.
 */
const ALLOWED_VIEW_KEYS = new Set<string>([
  // Bases-native keys
  'type',
  'name',
  'filters',
  'groupBy',
  'order',
  'sort',
  'columnSize',
  'limit',
  'summaries',
  // Dynamic Views settings (ViewDefaults)
  ...(Object.keys(VIEW_DEFAULTS) as (keyof ViewDefaults)[]),
  // Internal markers
  'isTemplate',
  // Persistence ID ({hash}-{viewName})
  'id',
]);

/**
 * Clean ALL Dynamic Views view entries in a .base file at once.
 * Removes stale keys and resets invalid enum values.
 * Called when any view in the file renders — handles all views, returns viewName → viewId map.
 * Also migrates basesState when a view is renamed (not duplicated).
 */
export async function cleanUpBaseFile(
  app: App,
  file: TFile | null,
  plugin: DynamicViews,
  callerViewName?: string
): Promise<Map<string, { id: string; isNew: boolean }> | null> {
  if (!file || !file.path.endsWith('.base')) return null;

  let changeCount = 0;
  const migrations: Array<{ oldId: string; newId: string }> = [];
  const viewIds = new Map<string, { id: string; isNew: boolean }>();

  await app.vault.process(file, (content) => {
    let parsed: Record<string, unknown>;
    try {
      parsed = parseYaml(content) as Record<string, unknown>;
    } catch {
      return content;
    }

    const views = parsed?.views;
    if (!Array.isArray(views)) return content;

    // Guard: abort if the calling view isn't in the file yet.
    // vault.process() reads from disk — Obsidian may not have flushed a newly
    // created view, so rewriting now would overwrite the in-memory view.
    if (
      callerViewName &&
      !views.some(
        (v) =>
          typeof v === 'object' &&
          v !== null &&
          (v as Record<string, unknown>).name === callerViewName
      )
    ) {
      return content;
    }

    // Pre-scan: count occurrences of each ID for duplicate detection
    const idCounts = new Map<string, number>();
    for (const v of views) {
      if (typeof v !== 'object' || v === null) continue;
      const id = (v as Record<string, unknown>).id;
      if (typeof id === 'string') idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
    }

    for (const view of views) {
      if (typeof view !== 'object' || view === null) continue;
      const viewObj = view as Record<string, unknown>;
      const viewType = viewObj.type;
      if (
        typeof viewType !== 'string' ||
        !viewType.startsWith('dynamic-views-')
      )
        continue;

      const viewName = viewObj.name as string | undefined;

      // Validate id matches current view name
      if (viewName) {
        const idField = viewObj.id as string | undefined;
        let storedName: string | undefined;

        if (idField) {
          const dashIndex = idField.indexOf('-');
          if (dashIndex > 0) storedName = idField.slice(dashIndex + 1);
        }

        const nameMismatch = storedName !== viewName;

        let needsNewId = false;
        let isRename = false;

        if (nameMismatch) {
          needsNewId = true;
          // Rename = had an existing unique ID whose name portion changed
          isRename = idField !== undefined && idCounts.get(idField) === 1;
        }

        const isNew = needsNewId && !isRename;

        if (needsNewId) {
          const hash = Math.random().toString(36).substring(2, 8);
          const newId = `${hash}-${viewName}`;
          viewObj.id = newId;
          changeCount++;

          if (isRename && idField) {
            migrations.push({ oldId: idField, newId });
          }

          // New view (not rename) — override schema defaults with template.
          // Obsidian pre-populates config from getBasesViewOptions() schema
          // defaults before cleanUpBaseFile runs, so keys already exist —
          // must overwrite, not just fill missing.
          if (isNew) {
            const vt = viewType === 'dynamic-views-grid' ? 'grid' : 'masonry';
            const template = plugin.persistenceManager.getSettingsTemplate(vt);
            if (template) {
              for (const [key, value] of Object.entries(template)) {
                // Templates store minimumColumns as number (1|2) but
                // Bases YAML uses dropdown keys ('one'|'two')
                const yamlValue =
                  key === 'minimumColumns' && typeof value === 'number'
                    ? value === 1
                      ? 'one'
                      : 'two'
                    : value;
                if (viewObj[key] !== yamlValue) {
                  viewObj[key] = yamlValue;
                  changeCount++;
                }
              }
            }
          }
        }

        viewIds.set(viewName, { id: viewObj.id as string, isNew });
      }

      for (const key of Object.keys(viewObj)) {
        // Remove unrecognized keys
        if (!ALLOWED_VIEW_KEYS.has(key)) {
          delete viewObj[key];
          changeCount++;
          continue;
        }

        // Delete values whose type doesn't match VIEW_DEFAULTS
        // (skipping minimumColumns — Bases YAML stores strings, VIEW_DEFAULTS stores numbers)
        const expectedType = VIEW_DEFAULTS_TYPES[key];
        if (
          expectedType &&
          key !== 'minimumColumns' &&
          typeof viewObj[key] !== expectedType
        ) {
          delete viewObj[key];
          changeCount++;
          continue;
        }

        // Reset stale enum values to config-level defaults
        const validValues = VALID_VIEW_VALUES[key as keyof ViewDefaults];
        if (
          validValues &&
          key !== 'minimumColumns' &&
          !validValues.includes(String(viewObj[key]))
        ) {
          viewObj[key] = validValues[0];
          changeCount++;
        }
      }

      // Delete stale titleProperty/subtitleProperty — Bases views now use
      // position-based displayFirstAsTitle/displaySecondAsSubtitle toggles
      for (const staleKey of ['titleProperty', 'subtitleProperty']) {
        if (staleKey in viewObj) {
          delete viewObj[staleKey];
          changeCount++;
        }
      }

      // Remove keys that match VIEW_DEFAULTS (sparse YAML).
      // Skip keys where BASES_DEFAULTS overrides VIEW_DEFAULTS — for those,
      // the VIEW_DEFAULTS value is a meaningful non-default choice in Bases context.
      // Also skip keys where a template has a different value — the VIEW_DEFAULTS
      // value is an explicit user choice that differs from the effective default.
      const vt = viewType === 'dynamic-views-grid' ? 'grid' : 'masonry';
      const template = plugin.persistenceManager.getSettingsTemplate(vt);
      for (const key of Object.keys(VIEW_DEFAULTS) as (keyof ViewDefaults)[]) {
        if (key in BASES_DEFAULTS) continue;
        const value = viewObj[key];
        if (value === undefined) continue;

        // (minimumColumns: YAML "one"/"two" never === VIEW_DEFAULTS number, so naturally preserved)
        if (value === VIEW_DEFAULTS[key]) {
          // Preserve if template would change the effective default
          if (template && key in template) continue;
          delete viewObj[key];
          changeCount++;
        }
      }
    }

    if (changeCount === 0) return content;
    return stringifyYaml(parsed);
  });

  // Run migrations after file processing completes (async allowed here)
  for (const { oldId, newId } of migrations) {
    await plugin.persistenceManager.migrateBasesState(oldId, newId);
  }

  return viewIds;
}

/** Estimate pane entry indices from ephemeral scroll state.
 *  Returns [startIdx, endIdx) for slicing the entries array. */
export function estimatePaneRange(
  ephemeral: { top: number; height: number },
  paneHeight: number,
  totalCount: number
): [number, number] {
  const scrollHeight = ephemeral.height || 1;
  // Wide buffer (5× pane) accounts for height estimation error between
  // saved scroll state and restored placeholder-based container height
  const startFraction = Math.max(
    0,
    (ephemeral.top - paneHeight * 2) / scrollHeight
  );
  const endFraction = Math.min(
    1,
    (ephemeral.top + paneHeight * 3) / scrollHeight
  );
  return [
    Math.floor(startFraction * totalCount),
    Math.ceil(endFraction * totalCount),
  ];
}

/** Descendant query, not `:scope >` — sections are grandchildren of `.dynamic-views`,
 *  nested under `.dynamic-views-grid` or `.dynamic-views-masonry`, and that intermediate
 *  class differs per view so no single child selector covers both. */
function getGroupSections(container: HTMLElement): NodeListOf<HTMLElement> {
  return container.querySelectorAll<HTMLElement>(
    '.dynamic-views-group-section'
  );
}

/** Absolute top of a section within the scroll container's coordinate space. */
function getSectionTop(scrollEl: HTMLElement, section: HTMLElement): number {
  return (
    section.getBoundingClientRect().top -
    scrollEl.getBoundingClientRect().top +
    scrollEl.scrollTop
  );
}

/** Index of the group section occupying the top of the pane, or null when the view is
 *  ungrouped. Ungrouped Grid still renders one implicit section, so grouping is detected
 *  by the container's `is-grouped` class, never by the section count. */
export function getTopmostVisibleGroupIndex(
  scrollEl: HTMLElement,
  container: HTMLElement
): number | null {
  if (!container.classList.contains('is-grouped')) return null;

  const sections = getGroupSections(container);
  if (sections.length === 0) return null;

  const scrollTop = scrollEl.scrollTop;
  let topmost = 0;
  for (let i = 0; i < sections.length; i++) {
    // 1px slack absorbs sub-pixel rounding in the rect arithmetic
    if (getSectionTop(scrollEl, sections[i]) <= scrollTop + 1) topmost = i;
  }
  return topmost;
}

/** Scroll so the given group section's top aligns with the pane top. */
export function scrollToGroupIndex(
  scrollEl: HTMLElement,
  container: HTMLElement,
  index: number
): void {
  const section = getGroupSections(container)[index];
  if (!section) return;
  scrollEl.scrollTop = getSectionTop(scrollEl, section);
}

/** Sentinel value for undefined group keys in dataset storage */
export const UNDEFINED_GROUP_KEY_SENTINEL = '__dynamic-views-undefined__';

/**
 * Write group key to element's dataset, using sentinel for undefined
 */
export function setGroupKeyDataset(
  el: HTMLElement,
  groupKey: string | undefined
): void {
  el.dataset.groupKey =
    groupKey === undefined ? UNDEFINED_GROUP_KEY_SENTINEL : groupKey;
}

/**
 * Read group key from element's dataset, converting sentinel to undefined
 */
export function getGroupKeyDataset(el: HTMLElement): string | undefined {
  const value = el.dataset.groupKey;
  return value === UNDEFINED_GROUP_KEY_SENTINEL ? undefined : value;
}

/**
 * Setup swipe prevention on mobile if enabled based on settings
 * Uses Obsidian's native data-ignore-swipe attribute to opt out of sidebar swipe detection
 */
export function setupBasesSwipePrevention(
  containerEl: HTMLElement,
  app: App,
  pluginSettings: PluginSettings
): void {
  const shouldPrevent = app.isMobile && pluginSettings.preventSidebarSwipe;

  if (shouldPrevent) {
    containerEl.dataset.ignoreSwipe = 'true';
  } else {
    delete containerEl.dataset.ignoreSwipe;
  }
}

/**
 * Bring back a swipe-hidden multi-image indicator on the two triggers that end a
 * swipe's context without scrolling the view: a tap elsewhere, and the pane
 * losing focus. Without these the icon stays hidden until the next vertical
 * scroll, another card's swipe claims it, or the card scrolls out and back.
 *
 * Mobile only: a touch swipe is the only thing that hides the icon. The gate is
 * here rather than in `restoreActiveIndicator`, which the desktop scroll and
 * visibility paths share.
 *
 * View lifetime, not render lifetime — `containerEl` is created once per view
 * and only emptied on re-render, so a single listener covers every card without
 * accumulating.
 */
export function setupIndicatorRestoreTriggers(
  containerEl: HTMLElement,
  app: App,
  registerEvent: (event: EventRef) => void,
  register: (cleanup: () => void) => void
): void {
  if (!Platform.isMobile) return;

  // A tap that is not on a swipeable surface ends the swipe's context, so the
  // icon comes back. Capture phase: card handlers stopPropagation, and this must
  // still see the tap. pointerdown, not click, so it fires for a tap that ends up
  // being a scroll or a long press.
  const handleTapElsewhere = (e: Event): void => {
    // Skip a tap on the same kind of surface the swipe happened on — the user
    // may still be working that image.
    if (
      (e.target as HTMLElement | null)?.closest('.card-cover, .card-thumbnail')
    )
      return;
    restoreActiveIndicator();
  };
  containerEl.addEventListener('pointerdown', handleTapElsewhere, {
    capture: true,
    passive: true,
  });
  register(() =>
    containerEl.removeEventListener('pointerdown', handleTapElsewhere, {
      capture: true,
    })
  );

  // Leaving the pane ends the swipe's context too. Gated on the newly active
  // leaf not being ours — the same containment test both view constructors use
  // to find their own leaf — so activating this view does not restore.
  registerEvent(
    app.workspace.on('active-leaf-change', (leaf) => {
      if (leaf?.view?.containerEl?.contains(containerEl)) return;
      restoreActiveIndicator();
    })
  );
}

// Re-export from shared location
export {
  setupStyleSettingsObserver,
  getStyleSettingsHash,
} from '../utils/style-settings';
import {
  preserveTextPreviewHeadings,
  preserveTextPreviewNewlines,
  getOmitFirstLineMode,
} from '../utils/style-settings';

/** Interface for Bases config groupBy property */
export interface BasesGroupBy {
  property?: string;
}

/** Interface for Bases config with sort and groupBy methods */
interface BasesConfigWithSort {
  getSort(): Array<{ property: string; direction: string }> | null;
  getDisplayName(property: string): string;
  groupBy?: BasesGroupBy;
}

/** Type guard to check if config has groupBy with valid structure */
export function hasGroupBy(
  config: unknown
): config is { groupBy?: BasesGroupBy } {
  if (typeof config !== 'object' || config === null || !('groupBy' in config)) {
    return false;
  }
  const groupBy = config.groupBy;
  // groupBy can be undefined (no grouping) or object with optional property string
  return (
    groupBy === undefined ||
    (typeof groupBy === 'object' &&
      groupBy !== null &&
      (!('property' in groupBy) || typeof groupBy.property === 'string'))
  );
}

/**
 * Serialize group key to string for comparison
 * Handles Bases Value objects, date objects, and objects that would stringify to "[object Object]"
 */
export function serializeGroupKey(key: unknown): string | undefined {
  if (key === undefined || key === null) return undefined;
  if (typeof key === 'string') return key;
  if (typeof key === 'number' || typeof key === 'boolean') return String(key);

  if (typeof key === 'object' && key !== null) {
    // Check if array-like (Bases uses proxy arrays that fail Array.isArray)
    const isArrayLike =
      Array.isArray(key) ||
      (typeof (key as ArrayLike<unknown>).length === 'number' &&
        !('data' in key) &&
        !('date' in key));

    // Handle arrays of Bases Value objects (e.g., tags: [{icon, data: "#tag1"}, ...])
    if (isArrayLike) {
      // Avoid copying if already an array
      const arr = Array.isArray(key)
        ? key
        : Array.from(key as ArrayLike<unknown>);
      if (arr.length === 0) return undefined;
      // Extract .data from each element that has it
      const extracted = arr.map((item): unknown => {
        if (item && typeof item === 'object' && 'data' in item) {
          return (item as { data: unknown }).data;
        }
        return item;
      });
      // If all elements are strings/primitives after extraction, join them
      if (extracted.every((v) => typeof v === 'string')) {
        return extracted.join(', ');
      }
      if (
        extracted.every(
          (v) =>
            typeof v === 'string' ||
            typeof v === 'number' ||
            typeof v === 'boolean'
        )
      ) {
        return extracted.map(String).join(', ');
      }
      // Complex array - stringify
      try {
        return JSON.stringify(extracted);
      } catch {
        // Fall through
      }
    }

    // Handle Bases date Value objects (e.g., {date: Date, time: boolean})
    if ('date' in key && key.date instanceof Date) {
      return (key as { date: Date }).date.toISOString();
    }

    // Handle Bases Value objects with .data property (e.g., {icon: "...", data: 462})
    if ('data' in key) {
      const data = key.data;
      if (data === null || data === undefined) return undefined;
      if (typeof data === 'string') return data;
      if (typeof data === 'number' || typeof data === 'boolean')
        return String(data);
      // Recursively process .data (handles arrays of Value objects inside .data)
      if (typeof data === 'object' && data !== null) {
        return serializeGroupKey(data);
      }
    }

    // Handle Bases Value objects with .icon but no .data (empty/missing value)
    if ('icon' in key && !('data' in key)) {
      return undefined;
    }
  }

  // For objects/arrays, use JSON to avoid collision
  try {
    return JSON.stringify(key);
  } catch {
    // JSON.stringify can fail on circular references - fallback to unique string
    return `[object:${Object.prototype.toString.call(key)}]`;
  }
}

/** Interface for group data with entries */
interface GroupData {
  entries: BasesEntry[];
  hasKey(): boolean;
  key?: unknown;
}

/**
 * Process groups with shuffle logic applied
 * Extracts and optionally reorders entries within each group based on shuffle state
 */
export function processGroups<T extends GroupData>(
  groupedData: T[],
  isShuffled: boolean,
  shuffledOrder: string[]
): Array<{ group: T; entries: BasesEntry[] }> {
  return groupedData.map((group) => {
    let groupEntries = [...group.entries];
    if (isShuffled && shuffledOrder.length > 0) {
      groupEntries = groupEntries.sort((a, b) => {
        const indexA = shuffledOrder.indexOf(a.file.path);
        const indexB = shuffledOrder.indexOf(b.file.path);
        // Missing entries (indexOf returns -1) sort to end
        const adjustedA = indexA === -1 ? Infinity : indexA;
        const adjustedB = indexB === -1 ? Infinity : indexB;
        return adjustedA - adjustedB;
      });
    }
    return { group, entries: groupEntries };
  });
}

/**
 * Check if value is a tag array (array of Value objects with # prefixed data)
 * Bases proxy arrays have .data containing the actual array
 */
function isTagArray(key: unknown): boolean {
  if (!key || typeof key !== 'object') return false;

  // Bases proxy has .data property containing the actual array
  if (!('data' in key)) return false;

  const data = key.data;
  if (!data || !Array.isArray(data) || data.length === 0) return false;

  // Check if first item has .data starting with #
  const first: unknown = data[0];
  if (first && typeof first === 'object' && 'data' in first) {
    const itemData = first.data;
    return typeof itemData === 'string' && itemData.startsWith('#');
  }
  return false;
}

/**
 * Render group value with rich HTML matching vanilla Bases structure
 * Handles tags, dates, folders, and primitives
 */
function renderGroupValue(
  valueEl: HTMLElement,
  key: unknown,
  app: App,
  propertyName?: string
): void {
  // Tags: render as clickable tag elements
  if (isTagArray(key)) {
    // Bases proxy has .data containing the actual array
    const dataArr = (key as { data: unknown[] }).data;
    const arr = Array.isArray(dataArr) ? dataArr : Array.from(dataArr);
    const container = valueEl.createDiv('value-list-container');

    // Create tag elements
    arr.forEach((item) => {
      if (item && typeof item === 'object' && 'data' in item) {
        const data = item.data;
        if (typeof data === 'string' && data.startsWith('#')) {
          const element = container.createSpan('value-list-element');
          element.createEl('a', {
            cls: 'tag',
            text: data.slice(1), // Remove # prefix
            href: '#',
          });
        }
      }
    });

    // Event delegation: single listener on container handles all tag clicks
    container.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.hasClass('tag')) return;
      e.preventDefault();

      const tagText = target.textContent ?? '';
      // Use Notebook Navigator if configured for tags
      if (
        shouldUseNotebookNavigator(app, 'tag') &&
        navigateToTagInNotebookNavigator(app, tagText)
      ) {
        return;
      }
      // Fallback to global search
      const searchPlugin = (
        app as unknown as {
          internalPlugins: {
            plugins: {
              'global-search'?: {
                instance?: { openGlobalSearch?: (query: string) => void };
              };
            };
          };
        }
      ).internalPlugins.plugins['global-search'];
      if (searchPlugin?.instance?.openGlobalSearch) {
        searchPlugin.instance.openGlobalSearch('tag:' + tagText);
      }
    });
    return;
  }

  // Dates: format as timestamp
  if (
    key &&
    typeof key === 'object' &&
    'date' in key &&
    key.date instanceof Date
  ) {
    const date = (key as { date: Date }).date;
    valueEl.setText(date.toLocaleDateString());
    return;
  }

  // Folders: render as clickable path segments
  if (propertyName === 'file.folder' || propertyName === 'folder') {
    // Extract folder path from Bases Value object or plain string
    const folderPath =
      key && typeof key === 'object' && 'data' in key
        ? String(key.data)
        : typeof key === 'string'
          ? key
          : null;

    if (folderPath && folderPath.length > 0) {
      const folders = folderPath.split('/').filter((f) => f);
      if (folders.length > 0) {
        const pathWrapper = valueEl.createDiv('path-wrapper');

        folders.forEach((folder, idx) => {
          const cumulativePath = folders.slice(0, idx + 1).join('/');
          const segmentWrapper = pathWrapper.createSpan('path-segment-wrapper');

          const segment = segmentWrapper.createSpan(
            'path-segment folder-segment'
          );
          segment.setText(folder);

          segment.addEventListener('click', (e) => {
            e.stopPropagation();
            const folderFile = app.vault.getAbstractFileByPath(cumulativePath);
            if (shouldUseNotebookNavigator(app, 'folder')) {
              if (
                folderFile instanceof TFolder &&
                navigateToFolderInNotebookNavigator(app, folderFile)
              ) {
                return;
              }
            }
            const fileExplorer = (
              app as unknown as {
                internalPlugins?: {
                  plugins?: {
                    'file-explorer'?: {
                      instance?: { revealInFolder?: (file: unknown) => void };
                    };
                  };
                };
              }
            ).internalPlugins?.plugins?.['file-explorer'];
            if (fileExplorer?.instance?.revealInFolder && folderFile) {
              fileExplorer.instance.revealInFolder(folderFile);
            }
          });

          segment.addEventListener('contextmenu', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const folderFile = app.vault.getAbstractFileByPath(cumulativePath);
            if (folderFile instanceof TFolder) {
              const menu = new Menu();
              app.workspace.trigger(
                'file-menu',
                menu,
                folderFile,
                'file-explorer'
              );
              menu.showAtMouseEvent(e);
            }
          });

          if (idx < folders.length - 1) {
            const separator = segmentWrapper.createSpan('path-separator');
            separator.setText('/');
          }
        });
        return;
      }
    }
  }

  // Fallback: use serialized string
  const keyValue = serializeGroupKey(key) ?? '';
  valueEl.setText(keyValue);
}

/**
 * Render group header with property name and value (or "None" for empty keys)
 * Header is rendered as sibling to card group (matching vanilla Bases structure)
 */
export function renderGroupHeader(
  containerEl: HTMLElement,
  group: { hasKey(): boolean; key?: unknown },
  config: BasesConfigWithSort,
  app: App,
  entryCount: number,
  collapsed: boolean,
  onToggleCollapse: () => void
): HTMLElement | null {
  // Don't render header when not grouping
  if (!config.groupBy?.property) return null;

  const headerEl = containerEl.createDiv('bases-group-heading');
  if (collapsed) headerEl.addClass('collapsed');

  // Clickable region: chevron + property name + group value
  const collapseRegion = headerEl.createDiv('bases-group-collapse-region');
  collapseRegion.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('a') || target.classList.contains('path-separator'))
      return;
    onToggleCollapse();
  });

  // Collapse chevron (left of all heading content)
  const chevronBtn = collapseRegion.createDiv('bases-group-collapse-btn');
  setIcon(chevronBtn, 'chevron-down');

  const propertyEl = collapseRegion.createDiv('bases-group-property');
  const propertyName = config.getDisplayName(config.groupBy.property);
  propertyEl.setText(propertyName);

  const valueEl = collapseRegion.createDiv('bases-group-value');

  // Show "None" for empty/missing keys (covers hasKey()=false and empty arrays)
  if (!serializeGroupKey(group.key)) {
    valueEl.setText('None');
    const countEl = headerEl.createDiv('bases-group-count');
    const formattedCount = entryCount
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const countText =
      entryCount === 1 ? '1 result' : `${formattedCount} results`;
    countEl.setText(countText);
    return headerEl;
  }

  renderGroupValue(valueEl, group.key, app, config.groupBy.property);

  // Render result count
  const countEl = headerEl.createDiv('bases-group-count');
  const formattedCount = entryCount
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const countText = entryCount === 1 ? '1 result' : `${formattedCount} results`;
  countEl.setText(countText);
  return headerEl;
}

/**
 * Get sort method from Bases config.
 * Returns "property-direction" string, or "none" when no sort is configured.
 */
export function getSortMethod(config: BasesConfigWithSort): string {
  const sortConfigs = config.getSort();

  if (sortConfigs && sortConfigs.length > 0) {
    const firstSort = sortConfigs[0];
    const property = config.getDisplayName(firstSort.property);
    const direction = firstSort.direction.toLowerCase();
    return `${property}-${direction}`;
  }
  return 'none';
}

/**
 * Load text previews and images for Bases entries
 *
 * @param devicePixelRatio - Read in the view via `getOwnerWindow(containerEl)`
 *   and passed as a number: bare `window` is prohibited here, and a popout on a
 *   differently-scaled monitor genuinely has a different ratio.
 */
export async function loadContentForEntries(
  entries: BasesEntry[],
  settings: ResolvedSettings,
  app: App,
  textPreviews: Record<string, string>,
  images: Record<string, string | string[]>,
  hasImageAvailable: Record<string, boolean>,
  devicePixelRatio: number
): Promise<void> {
  // Load text previews
  if (settings.textPreviewProperty || settings.fallbackToContent) {
    const textPreviewEntries = entries
      .filter((entry) => !(entry.file.path in textPreviews))
      .map((entry) => {
        const file = app.vault.getAbstractFileByPath(entry.file.path);
        if (!(file instanceof TFile)) return null;

        // Resolve text preview property - check timestamps first
        let textPreviewData: unknown = null;
        if (settings.textPreviewProperty) {
          const textPreviewProps = settings.textPreviewProperty
            .split(',')
            .map((p) => p.trim());
          for (const prop of textPreviewProps) {
            // Try timestamp property first
            const timestamp = resolveTimestampProperty(
              prop,
              entry.file.stat.ctime,
              entry.file.stat.mtime
            );
            if (timestamp) {
              textPreviewData = timestamp;
              break;
            }
            // Try regular property
            const textPreviewValue = getFirstBasesPropertyValue(
              app,
              entry,
              prop
            ) as { data?: unknown } | null;
            const data = textPreviewValue?.data;
            if (Array.isArray(data) && data.length > 0) {
              textPreviewData = data.map(String).join(', ');
              break;
            }
            if (
              data != null &&
              data !== '' &&
              (typeof data === 'string' || typeof data === 'number')
            ) {
              textPreviewData = data;
              break;
            }
          }
        }

        // Get title for first line comparison
        let titleString: string | undefined;
        if (settings.titleProperty) {
          const titleProps = settings.titleProperty
            .split(',')
            .map((p) => p.trim());
          for (const prop of titleProps) {
            const titleValue = getFirstBasesPropertyValue(app, entry, prop) as {
              data?: unknown;
            } | null;
            if (
              titleValue?.data != null &&
              titleValue.data !== '' &&
              (typeof titleValue.data === 'string' ||
                typeof titleValue.data === 'number')
            ) {
              titleString = String(titleValue.data);
              break;
            }
          }
        }

        return {
          path: entry.file.path,
          file,
          textPreviewData,
          fileName: entry.file.basename,
          titleString,
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    await loadTextPreviewsForEntries(
      textPreviewEntries,
      settings.fallbackToContent,
      getOmitFirstLineMode(),
      app,
      textPreviews,
      preserveTextPreviewHeadings(),
      preserveTextPreviewNewlines()
    );
  }

  // Load images for thumbnails
  {
    const imageEntries = entries
      .filter((entry) => !(entry.file.path in images))
      .map((entry) => {
        const file = app.vault.getAbstractFileByPath(entry.file.path);
        if (!(file instanceof TFile)) return null;

        const imagePropertyValues = getAllBasesImagePropertyValues(
          app,
          entry,
          settings.imageProperty
        );
        return {
          path: entry.file.path,
          file,
          imagePropertyValues: imagePropertyValues,
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    await loadImagesForEntries(
      imageEntries,
      settings.showFileImages,
      app,
      images,
      hasImageAvailable,
      {
        includeYoutube: settings.showYoutubeThumbnails,
        includeCardLink: settings.showCardLinkCovers,
        youtubeTargetWidth: getYouTubeTargetWidth(
          settings.imageFormat,
          settings.cardSize,
          devicePixelRatio
        ),
      }
    );
  }
}

/**
 * Throttle window for onDataUpdated calls (ms).
 * Obsidian fires duplicate calls with stale config ~150-200ms after the correct call.
 * Leading-edge throttle accepts first call and ignores subsequent calls within window.
 */
export const DATA_UPDATE_THROTTLE_MS = 250;

/**
 * Check if an onDataUpdated call should be throttled.
 * Returns true if the call should proceed, false if it should be skipped.
 * Updates lastTime in-place when proceeding.
 *
 * Hybrid throttle: Leading-edge for immediate response, optional trailing
 * to catch coalesced updates (Obsidian batches rapid config.set calls).
 */
export function shouldProcessDataUpdate(
  lastTimeRef: { value: number },
  trailingRef?: {
    timeoutId: number | null;
    callback: (() => void) | null;
    isTrailing?: boolean;
  }
): boolean {
  const now = Date.now();

  if (now - lastTimeRef.value < DATA_UPDATE_THROTTLE_MS) {
    // Schedule trailing call if callback provided
    if (trailingRef?.callback) {
      if (trailingRef.timeoutId !== null) {
        window.clearTimeout(trailingRef.timeoutId);
      }
      const remaining =
        DATA_UPDATE_THROTTLE_MS - (now - lastTimeRef.value) + 10;
      trailingRef.timeoutId = window.setTimeout(() => {
        trailingRef.timeoutId = null;
        // Flag trailing call so render path can detect stale-settings reverts.
        // Don't reset after callback — onDataUpdated defers via queueMicrotask,
        // so a synchronous reset would clear the flag before processDataUpdate reads it.
        trailingRef.isTrailing = true;
        trailingRef.callback?.();
      }, remaining);
    }
    return false;
  }

  // Clear any pending trailing call (leading call won)
  if (trailingRef && trailingRef.timeoutId !== null) {
    window.clearTimeout(trailingRef.timeoutId);
    trailingRef.timeoutId = null;
  }

  lastTimeRef.value = now;
  return true;
}

/**
 * One-shot template snapshot — saves current settings as defaults for new views.
 * On first render, resets stale toggles from previous sessions or duplicated files.
 * User toggles OFF→ON to re-save. No auto-update between saves.
 *
 * A 3s cooldown after each transition prevents phantom flicker from Bases'
 * debounced config writes racing with file-watcher-triggered config reloads.
 */
export function handleTemplateToggle(
  config: BasesConfigInit,
  viewType: 'grid' | 'masonry',
  plugin: DynamicViews,
  initializedRef: { value: boolean },
  // Timers must be main-window timers, so the handle is always a number
  cooldownTimerRef: { value: number | null }
): void {
  const isTemplate = config.get('isTemplate') === true;

  // First call: reset stale toggles from previous sessions or duplicated files.
  // Start cooldown to suppress phantom re-fires from the debounced-write/file-reload race.
  if (!initializedRef.value) {
    initializedRef.value = true;
    if (isTemplate) {
      config.set('isTemplate', undefined);
      cooldownTimerRef.value = window.setTimeout(() => {
        cooldownTimerRef.value = null;
      }, 3000);
    }
    return;
  }

  // Only act when the toggle is ON
  if (!isTemplate) return;

  // One-shot: immediately reset (transient action, not persistent state)
  config.set('isTemplate', undefined);

  // During cooldown, skip — phantom re-fires from debounced-write/file-reload race
  if (cooldownTimerRef.value !== null) return;

  cooldownTimerRef.value = window.setTimeout(() => {
    cooldownTimerRef.value = null;
  }, 3000);

  const extracted = extractBasesTemplate(config, VIEW_DEFAULTS, viewType);
  void plugin.persistenceManager.setSettingsTemplate(viewType, extracted);
  const label = viewType === 'grid' ? 'Grid' : 'Masonry';
  const notice = new Notice(
    `Saved as default settings for new ${label} views. Enable again to update.`
  );

  // Obsidian caches the notice-container per window but doesn't clear the cache
  // when the container is detached (after the last notice fades). Re-attach if stale.
  const nc = (notice as { containerEl?: HTMLElement }).containerEl
    ?.parentElement;
  if (nc && !nc.isConnected) {
    activeWindow.document.body.appendChild(nc);
  }
}
