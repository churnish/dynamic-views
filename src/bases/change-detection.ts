/** Shared render-pipeline change detection for Grid and Masonry views.
 *  Pure computation — fast-path dispatch stays in the views. */
import type { BasesEntry } from 'obsidian';
import type { ResolvedSettings } from '../types';
import {
  CSS_ONLY_SETTINGS_KEYS,
  ORDER_DERIVED_SETTINGS_KEYS,
} from '../constants';
import { serializeGroupKey } from './utils';

export interface RenderHashes {
  settingsHash: string;
  propertySetHash: string;
  settingsHashExcludingOrder: string;
  renderHash: string;
}

// Use null byte delimiter (cannot appear in file paths) to avoid hash collisions
export function computeRenderHashes(params: {
  settings: ResolvedSettings;
  visibleProperties: string[];
  sortMethod: string;
  groupByProperty: string | undefined;
  // key is optional to match BasesEntryGroup — hasKey() gates every read
  groupedData: Array<{ hasKey(): boolean; key?: unknown }>;
  collapsedGroups: ReadonlySet<string>;
  allEntries: BasesEntry[];
  isShuffled: boolean;
  shuffleOrder: string[];
  styleSettingsHash: string;
  styleSettingsLayoutHash: string;
}): RenderHashes {
  const {
    settings,
    visibleProperties,
    sortMethod,
    groupByProperty,
    groupedData,
    collapsedGroups,
    allEntries,
    isShuffled,
    shuffleOrder,
    styleSettingsHash,
    styleSettingsLayoutHash,
  } = params;

  // Exclude CSS-only settings from hash — they're applied instantly via
  // applyCssOnlySettings() and don't need a full DOM rebuild
  const hashableSettings = Object.fromEntries(
    Object.entries(settings).filter(([k]) => !CSS_ONLY_SETTINGS_KEYS.has(k))
  );
  const settingsHash =
    JSON.stringify(hashableSettings) +
    '\0\0' +
    JSON.stringify(visibleProperties) +
    '\0\0' +
    sortMethod +
    '\0\0' +
    (groupByProperty ?? '');
  const propertySetHash = [...visibleProperties].sort().join('\0');
  // Further exclude order-derived settings for reorder detection
  // (titleProperty, subtitleProperty, _skipLeadingProperties change when
  // displayFirstAsTitle derives them from property order positions)
  const orderIndependentSettings = Object.fromEntries(
    Object.entries(hashableSettings).filter(
      ([k]) => !ORDER_DERIVED_SETTINGS_KEYS.has(k)
    )
  );
  const settingsHashExcludingOrder =
    JSON.stringify(orderIndependentSettings) +
    '\0\0' +
    sortMethod +
    '\0\0' +
    (groupByProperty ?? '');

  // Include mtime, sortMethod, and group order in hash so content/sort/group changes trigger updates
  const collapsedHash = Array.from(collapsedGroups).sort().join('\0');
  const groupOrderHash = groupedData
    .map((g) => (g.hasKey() ? (serializeGroupKey(g.key) ?? '') : ''))
    .join('\0');
  const renderHash =
    allEntries
      .map((e: BasesEntry) => `${e.file.path}:${e.file.stat.mtime}`)
      .join('\0') +
    '\0\0' +
    settingsHash +
    '\0\0' +
    (groupByProperty ?? '') +
    '\0\0' +
    sortMethod +
    '\0\0' +
    groupOrderHash +
    '\0\0' +
    styleSettingsHash +
    '\0\0' +
    styleSettingsLayoutHash +
    '\0\0' +
    collapsedHash +
    '\0\0' +
    String(isShuffled) +
    '\0\0' +
    shuffleOrder.join('\0') +
    '\0\0' +
    JSON.stringify(visibleProperties);

  return {
    settingsHash,
    propertySetHash,
    settingsHashExcludingOrder,
    renderHash,
  };
}

export interface EntryChanges {
  changedPaths: Set<string>;
  pathsUnchanged: boolean;
  orderUnchanged: boolean;
}

/** Read-only diff of current entries vs last-render mtimes. */
export function detectEntryChanges(
  allEntries: BasesEntry[],
  lastMtimes: ReadonlyMap<string, number>
): EntryChanges {
  // Detect files with changed content (mtime changed but paths unchanged)
  const changedPaths = new Set<string>();
  const currentPaths = allEntries.map((e) => e.file.path);
  const lastKeys = Array.from(lastMtimes.keys());
  const pathsUnchanged =
    currentPaths.length === lastKeys.length &&
    currentPaths.every((p) => lastMtimes.has(p));
  // Detect sort-order changes: when a sort-relevant property is edited,
  // Bases re-sorts allEntries AND updates mtime, so changedPaths is
  // non-empty and the renderHash early-exit is bypassed. This check is
  // the only gate that prevents the in-place path from preserving stale
  // DOM positions when the sort order has actually changed.
  const orderUnchanged =
    lastKeys.length === currentPaths.length &&
    currentPaths.every((p, i) => p === lastKeys[i]);

  for (const entry of allEntries) {
    const path = entry.file.path;
    const mtime = entry.file.stat.mtime;
    const lastMtime = lastMtimes.get(path);
    if (lastMtime !== undefined && lastMtime !== mtime) {
      changedPaths.add(path);
    }
  }

  return { changedPaths, pathsUnchanged, orderUnchanged };
}

/** Clear + refill lastMtimes in allEntries order — insertion order feeds the
 *  next render's orderUnchanged check. */
export function commitMtimes(
  allEntries: BasesEntry[],
  lastMtimes: Map<string, number>
): void {
  lastMtimes.clear();
  for (const entry of allEntries) {
    lastMtimes.set(entry.file.path, entry.file.stat.mtime);
  }
}

/** Obsidian may fire onDataUpdated before config.getOrder() settles — re-check
 *  at 100/250/500ms and retrigger when the property order actually changed. */
export function scheduleLateConfigRechecks(
  getProps: () => string[],
  propsSnapshot: string,
  onStale: () => void
): void {
  const recheckDelays = [100, 250, 500];
  for (const delay of recheckDelays) {
    setTimeout(() => {
      const currentProps = getProps();
      const currentPropsStr = JSON.stringify(currentProps);
      if (currentPropsStr !== propsSnapshot) {
        onStale();
      }
    }, delay);
  }
}

/** Diff-apply comma-separated cssclasses to scrollEl. Returns the new class
 *  list for the caller to store. */
export function applyCustomClasses(
  scrollEl: HTMLElement,
  previous: string[],
  cssclasses: string
): string[] {
  const customClasses = cssclasses
    .split(',')
    .map((cls) => cls.trim())
    .filter(Boolean);

  // Only update if classes changed (prevents unnecessary DOM mutations)
  const classesChanged =
    previous.length === 0 ||
    previous.length !== customClasses.length ||
    !previous.every((cls, i) => cls === customClasses[i]);

  if (classesChanged) {
    // Clear previous custom classes
    if (previous.length > 0) {
      previous.forEach((cls: string) => {
        scrollEl.removeClass(cls);
      });
    }

    // Apply new custom classes
    customClasses.forEach((cls) => {
      scrollEl.addClass(cls);
    });

    return customClasses;
  }
  return previous;
}
