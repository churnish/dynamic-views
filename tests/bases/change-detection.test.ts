import { describe, it, expect } from 'vitest';
import type { BasesEntry } from 'obsidian';
import type { ResolvedSettings } from '../../src/types';
import {
  computeRenderHashes,
  detectEntryChanges,
  commitMtimes,
} from '../../src/bases/change-detection';

function makeEntry(path: string, mtime: number): BasesEntry {
  return { file: { path, stat: { mtime } } } as BasesEntry;
}

function makeSettings(overrides: Record<string, unknown> = {}) {
  return {
    cardSize: 300,
    titleProperty: 'file.name',
    textPreviewLines: 5,
    ...overrides,
  } as unknown as ResolvedSettings;
}

function makeParams(overrides: Record<string, unknown> = {}) {
  return {
    settings: makeSettings(),
    visibleProperties: ['note.a', 'note.b'],
    sortMethod: 'name-asc',
    groupByProperty: undefined,
    groupedData: [{ hasKey: () => true, key: 'Group A' }],
    collapsedGroups: new Set<string>(),
    allEntries: [makeEntry('a.md', 1), makeEntry('b.md', 2)],
    isShuffled: false,
    shuffleOrder: [] as string[],
    styleSettingsHash: 'ss',
    styleSettingsLayoutHash: 'ssl',
    ...overrides,
  };
}

describe('computeRenderHashes', () => {
  it('produces identical hashes for identical inputs', () => {
    expect(computeRenderHashes(makeParams())).toEqual(
      computeRenderHashes(makeParams())
    );
  });

  it('changing a CSS-only settings key changes no hash', () => {
    const before = computeRenderHashes(makeParams());
    const after = computeRenderHashes(
      makeParams({ settings: makeSettings({ textPreviewLines: 9 }) })
    );
    expect(after).toEqual(before);
  });

  it('changing an order-derived key changes settingsHash/renderHash but not settingsHashExcludingOrder', () => {
    const before = computeRenderHashes(makeParams());
    const after = computeRenderHashes(
      makeParams({ settings: makeSettings({ titleProperty: 'note.title' }) })
    );
    expect(after.settingsHash).not.toBe(before.settingsHash);
    expect(after.renderHash).not.toBe(before.renderHash);
    expect(after.settingsHashExcludingOrder).toBe(
      before.settingsHashExcludingOrder
    );
    expect(after.propertySetHash).toBe(before.propertySetHash);
  });

  it('collapse-set changes affect only renderHash', () => {
    const before = computeRenderHashes(makeParams());
    const after = computeRenderHashes(
      makeParams({ collapsedGroups: new Set(['Group A']) })
    );
    expect(after.renderHash).not.toBe(before.renderHash);
    expect(after.settingsHash).toBe(before.settingsHash);
    expect(after.propertySetHash).toBe(before.propertySetHash);
    expect(after.settingsHashExcludingOrder).toBe(
      before.settingsHashExcludingOrder
    );
  });

  it('shuffle-order changes affect only renderHash', () => {
    const before = computeRenderHashes(makeParams());
    const after = computeRenderHashes(
      makeParams({ isShuffled: true, shuffleOrder: ['b.md', 'a.md'] })
    );
    expect(after.renderHash).not.toBe(before.renderHash);
    expect(after.settingsHash).toBe(before.settingsHash);
    expect(after.propertySetHash).toBe(before.propertySetHash);
    expect(after.settingsHashExcludingOrder).toBe(
      before.settingsHashExcludingOrder
    );
  });

  it('property reorder changes settingsHash but not propertySetHash', () => {
    const before = computeRenderHashes(makeParams());
    const after = computeRenderHashes(
      makeParams({ visibleProperties: ['note.b', 'note.a'] })
    );
    expect(after.settingsHash).not.toBe(before.settingsHash);
    expect(after.propertySetHash).toBe(before.propertySetHash);
  });
});

describe('detectEntryChanges', () => {
  it('reports an mtime bump as a changed path with paths and order unchanged', () => {
    const lastMtimes = new Map([
      ['a.md', 1],
      ['b.md', 2],
    ]);
    const result = detectEntryChanges(
      [makeEntry('a.md', 99), makeEntry('b.md', 2)],
      lastMtimes
    );
    expect(result.changedPaths).toEqual(new Set(['a.md']));
    expect(result.pathsUnchanged).toBe(true);
    expect(result.orderUnchanged).toBe(true);
  });

  it('reports pathsUnchanged false when a path is added', () => {
    const lastMtimes = new Map([['a.md', 1]]);
    const result = detectEntryChanges(
      [makeEntry('a.md', 1), makeEntry('b.md', 2)],
      lastMtimes
    );
    expect(result.pathsUnchanged).toBe(false);
  });

  it('reports pathsUnchanged false when a path is removed', () => {
    const lastMtimes = new Map([
      ['a.md', 1],
      ['b.md', 2],
    ]);
    const result = detectEntryChanges([makeEntry('a.md', 1)], lastMtimes);
    expect(result.pathsUnchanged).toBe(false);
  });

  it('reports reorder as pathsUnchanged true, orderUnchanged false', () => {
    const lastMtimes = new Map([
      ['a.md', 1],
      ['b.md', 2],
    ]);
    const result = detectEntryChanges(
      [makeEntry('b.md', 2), makeEntry('a.md', 1)],
      lastMtimes
    );
    expect(result.pathsUnchanged).toBe(true);
    expect(result.orderUnchanged).toBe(false);
    expect(result.changedPaths.size).toBe(0);
  });

  it('reports no changed paths on first render (empty map)', () => {
    const result = detectEntryChanges(
      [makeEntry('a.md', 1), makeEntry('b.md', 2)],
      new Map()
    );
    expect(result.changedPaths.size).toBe(0);
  });
});

describe('commitMtimes', () => {
  it('refills the map in allEntries order', () => {
    const lastMtimes = new Map([
      ['stale.md', 0],
      ['b.md', 1],
    ]);
    commitMtimes(
      [makeEntry('b.md', 2), makeEntry('a.md', 3), makeEntry('c.md', 4)],
      lastMtimes
    );
    expect(Array.from(lastMtimes.keys())).toEqual(['b.md', 'a.md', 'c.md']);
    expect(Array.from(lastMtimes.values())).toEqual([2, 3, 4]);
  });
});
