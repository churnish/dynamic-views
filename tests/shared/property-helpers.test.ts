import { vi } from 'vitest';

// Mock dependencies imported by property-helpers
vi.mock('../../src/shared/content-visibility', () => ({
  CONTENT_HIDDEN_CLASS: 'content-hidden',
}));
vi.mock('../../src/utils/owner-window', () => ({
  getOwnerWindow: vi.fn(() => globalThis),
}));

import {
  isTagProperty,
  isFileProperty,
  isFormulaProperty,
  shouldCollapseField,
  hasWrappedPairs,
} from '../../src/shared/property-helpers';

describe('property-helpers', () => {
  describe('isTagProperty', () => {
    it('returns true for tag properties', () => {
      expect(isTagProperty('tags')).toBe(true);
      expect(isTagProperty('note.tags')).toBe(true);
      expect(isTagProperty('file.tags')).toBe(true);
      expect(isTagProperty('file tags')).toBe(true);
    });

    it('returns false for non-tag properties', () => {
      expect(isTagProperty('title')).toBe(false);
      expect(isTagProperty('file.name')).toBe(false);
      expect(isTagProperty(undefined)).toBe(false);
    });
  });

  describe('isFileProperty', () => {
    it('returns true for file properties', () => {
      expect(isFileProperty('file.name')).toBe(true);
      expect(isFileProperty('file.path')).toBe(true);
      expect(isFileProperty('file tags')).toBe(true);
      expect(isFileProperty('FILE.NAME')).toBe(true);
    });

    it('returns false for non-file properties', () => {
      expect(isFileProperty('tags')).toBe(false);
      expect(isFileProperty('title')).toBe(false);
      expect(isFileProperty(undefined)).toBe(false);
    });
  });

  describe('isFormulaProperty', () => {
    it('returns true for formula properties', () => {
      expect(isFormulaProperty('formula.test')).toBe(true);
      expect(isFormulaProperty('formula.complex.name')).toBe(true);
    });

    it('returns false for non-formula properties', () => {
      expect(isFormulaProperty('tags')).toBe(false);
      expect(isFormulaProperty('file.name')).toBe(false);
      expect(isFormulaProperty(undefined)).toBe(false);
    });
  });

  describe('shouldCollapseField', () => {
    // Empty string tests
    it("collapses empty string with hideEmptyMode='all'", () => {
      expect(shouldCollapseField('', 'title', false, 'all', 'inline')).toBe(
        true
      );
    });

    it("does not collapse empty string with hideEmptyMode='show'", () => {
      expect(shouldCollapseField('', 'title', false, 'show', 'inline')).toBe(
        false
      );
    });

    it("collapses empty string with hideEmptyMode='labels-hidden' when labels hidden", () => {
      expect(
        shouldCollapseField('', 'title', false, 'labels-hidden', 'hide')
      ).toBe(true);
    });

    it("does not collapse empty string with hideEmptyMode='labels-hidden' when labels visible", () => {
      expect(
        shouldCollapseField('', 'title', false, 'labels-hidden', 'inline')
      ).toBe(false);
    });

    // Null note property (missing) tests
    it('collapses null note property with hideMissing=true', () => {
      expect(shouldCollapseField(null, 'title', true, 'show', 'inline')).toBe(
        true
      );
    });

    it("collapses null note property with hideMissing=false but hideEmptyMode='all'", () => {
      expect(shouldCollapseField(null, 'title', false, 'all', 'inline')).toBe(
        true
      );
    });

    it("does not collapse null note property with hideMissing=false and hideEmptyMode='show'", () => {
      expect(shouldCollapseField(null, 'title', false, 'show', 'inline')).toBe(
        false
      );
    });

    // Null file property tests (file props can't be "missing", only empty)
    it("collapses null file property with hideEmptyMode='all'", () => {
      expect(
        shouldCollapseField(null, 'file.name', true, 'all', 'inline')
      ).toBe(true);
    });

    it("does not collapse null file property with hideEmptyMode='show'", () => {
      expect(
        shouldCollapseField(null, 'file.name', true, 'show', 'inline')
      ).toBe(false);
    });

    // Null formula property tests
    it("collapses null formula property with hideEmptyMode='all'", () => {
      expect(
        shouldCollapseField(null, 'formula.test', true, 'all', 'inline')
      ).toBe(true);
    });

    it("does not collapse null formula property with hideEmptyMode='show'", () => {
      expect(
        shouldCollapseField(null, 'formula.test', true, 'show', 'inline')
      ).toBe(false);
    });

    // Null tag property tests
    it("collapses null tag property with hideEmptyMode='all'", () => {
      expect(shouldCollapseField(null, 'tags', true, 'all', 'inline')).toBe(
        true
      );
    });

    it("does not collapse null tag property with hideEmptyMode='show'", () => {
      expect(shouldCollapseField(null, 'tags', true, 'show', 'inline')).toBe(
        false
      );
    });

    // Non-empty value tests
    it('does not collapse non-empty values', () => {
      expect(shouldCollapseField('value', 'title', true, 'all', 'inline')).toBe(
        false
      );
      expect(
        shouldCollapseField('value', 'file.name', true, 'all', 'inline')
      ).toBe(false);
      expect(shouldCollapseField('#tag', 'tags', true, 'all', 'inline')).toBe(
        false
      );
    });
  });

  describe('hasWrappedPairs', () => {
    /** Build a `.property-pair` element with optional left/right children. */
    function createPair(opts: {
      leftTop: number;
      rightTop: number;
      omitLeft?: boolean;
      omitRight?: boolean;
    }): HTMLElement {
      const pair = document.createElement('div');
      pair.classList.add('property-pair');

      if (!opts.omitLeft) {
        const left = document.createElement('div');
        left.classList.add('pair-left');
        left.getBoundingClientRect = () => ({ top: opts.leftTop }) as DOMRect;
        pair.appendChild(left);
      }

      if (!opts.omitRight) {
        const right = document.createElement('div');
        right.classList.add('pair-right');
        right.getBoundingClientRect = () => ({ top: opts.rightTop }) as DOMRect;
        pair.appendChild(right);
      }

      return pair;
    }

    it('returns false when no .property-pair elements exist', () => {
      const card = document.createElement('div');
      expect(hasWrappedPairs(card)).toBe(false);
    });

    it('returns false when all pairs are on the same line', () => {
      const card = document.createElement('div');
      card.appendChild(createPair({ leftTop: 100, rightTop: 100 }));
      card.appendChild(createPair({ leftTop: 120, rightTop: 120 }));
      expect(hasWrappedPairs(card)).toBe(false);
    });

    it('returns true when one pair has wrapped (right below left)', () => {
      const card = document.createElement('div');
      card.appendChild(createPair({ leftTop: 100, rightTop: 100 }));
      card.appendChild(createPair({ leftTop: 120, rightTop: 140 }));
      expect(hasWrappedPairs(card)).toBe(true);
    });

    it('returns false when difference is exactly 1px (tolerance boundary)', () => {
      const card = document.createElement('div');
      // right.top === left.top + 1 — not strictly greater, so no wrap
      card.appendChild(createPair({ leftTop: 100, rightTop: 101 }));
      expect(hasWrappedPairs(card)).toBe(false);
    });

    it('returns true when difference is 1.5px (just over tolerance boundary)', () => {
      const card = document.createElement('div');
      // right.top > left.top + 1 — wrapping detected
      card.appendChild(createPair({ leftTop: 100, rightTop: 101.5 }));
      expect(hasWrappedPairs(card)).toBe(true);
    });

    it('skips pairs missing .pair-left and counts remaining pairs correctly', () => {
      const card = document.createElement('div');
      card.appendChild(
        createPair({ leftTop: 100, rightTop: 140, omitLeft: true })
      );
      expect(hasWrappedPairs(card)).toBe(false);
    });

    it('skips pairs missing .pair-right and counts remaining pairs correctly', () => {
      const card = document.createElement('div');
      card.appendChild(
        createPair({ leftTop: 100, rightTop: 140, omitRight: true })
      );
      expect(hasWrappedPairs(card)).toBe(false);
    });
  });

  describe('batched compact-stacked detection', () => {
    /** Build a compact card with property-pair children for wrapping detection. */
    function createCompactCard(opts?: {
      wrapped?: boolean;
      gridParent?: HTMLElement;
      topOffset?: number;
    }): HTMLElement {
      const card = document.createElement('div');
      card.classList.add('compact-mode');
      // jsdom isConnected requires appending to document
      document.body.appendChild(card);

      // Property pair — controls hasWrappedPairs result
      const pair = document.createElement('div');
      pair.classList.add('property-pair');
      const left = document.createElement('div');
      left.classList.add('pair-left');
      left.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
      const right = document.createElement('div');
      right.classList.add('pair-right');
      // Wrapped: right top > left top + 1
      right.getBoundingClientRect = () =>
        ({ top: opts?.wrapped ? 120 : 100 }) as DOMRect;
      pair.appendChild(left);
      pair.appendChild(right);
      card.appendChild(pair);

      // Grid ancestor support
      if (opts?.gridParent) {
        opts.gridParent.appendChild(card);
      }

      // Mock getBoundingClientRect for row sync
      const top = opts?.topOffset ?? 50;
      card.getBoundingClientRect = () => ({ top }) as DOMRect;

      return card;
    }

    let rafCallbacks: Array<FrameRequestCallback>;
    let rafIdCounter: number;

    beforeEach(() => {
      rafCallbacks = [];
      rafIdCounter = 0;
      vi.stubGlobal(
        'requestAnimationFrame',
        vi.fn((cb: FrameRequestCallback) => {
          rafCallbacks.push(cb);
          return ++rafIdCounter;
        })
      );
      vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
      document.body.innerHTML = '';
      vi.restoreAllMocks();
      vi.resetModules();
    });

    function flushRaf(): void {
      const cbs = [...rafCallbacks];
      rafCallbacks.length = 0;
      for (const cb of cbs) cb(performance.now());
    }

    async function freshModule() {
      vi.resetModules();
      return (await import('../../src/shared/property-helpers')) as typeof import('../../src/shared/property-helpers');
    }

    it('cache hit skips duplicate RAF scheduling', async () => {
      const mod = await freshModule();
      const card = createCompactCard();

      mod.queueCompactStackedCheck(card, 300);
      expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

      // Same width — cache hit, no new RAF
      mod.queueCompactStackedCheck(card, 300);
      expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    });

    it('cache miss queues card for processing', async () => {
      const mod = await freshModule();
      const card = createCompactCard({ wrapped: true });

      mod.queueCompactStackedCheck(card, 300);
      mod.queueCompactStackedCheck(card, 400); // Different width — re-queued
      flushRaf();

      expect(card.classList.contains('compact-stacked')).toBe(true);
    });

    it('cancelCompactStackedCheck removes class and cache', async () => {
      const mod = await freshModule();
      const card = createCompactCard({ wrapped: true });
      card.classList.add('compact-stacked');

      mod.queueCompactStackedCheck(card, 300);
      mod.cancelCompactStackedCheck(card);

      expect(card.classList.contains('compact-stacked')).toBe(false);

      // Flushing RAF should not re-apply — card was removed from pending
      flushRaf();
      expect(card.classList.contains('compact-stacked')).toBe(false);
    });

    it('invalidateCompactStackedCache clears cache and pending', async () => {
      const mod = await freshModule();
      const card = createCompactCard({ wrapped: true });

      mod.queueCompactStackedCheck(card, 300);
      mod.invalidateCompactStackedCache(card);

      // Flush should not process this card
      flushRaf();
      expect(card.classList.contains('compact-stacked')).toBe(false);

      // Re-queue with same width should schedule (cache was cleared)
      mod.queueCompactStackedCheck(card, 300);
      expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    });

    it('batch applies compact-stacked to wrapped cards', async () => {
      const mod = await freshModule();
      const wrappedCard = createCompactCard({ wrapped: true });
      const normalCard = createCompactCard({ wrapped: false });

      mod.queueCompactStackedCheck(wrappedCard, 300);
      mod.queueCompactStackedCheck(normalCard, 300);
      flushRaf();

      expect(wrappedCard.classList.contains('compact-stacked')).toBe(true);
      expect(normalCard.classList.contains('compact-stacked')).toBe(false);
    });

    it('disconnected cards are skipped', async () => {
      const mod = await freshModule();
      const card = createCompactCard({ wrapped: true });

      mod.queueCompactStackedCheck(card, 300);
      // Disconnect before flush
      card.remove();
      flushRaf();

      expect(card.classList.contains('compact-stacked')).toBe(false);
    });

    it('non-compact cards are skipped', async () => {
      const mod = await freshModule();
      const card = createCompactCard({ wrapped: true });

      mod.queueCompactStackedCheck(card, 300);
      // Remove compact-mode before flush
      card.classList.remove('compact-mode');
      flushRaf();

      expect(card.classList.contains('compact-stacked')).toBe(false);
    });

    it('content-hidden cards are skipped', async () => {
      const mod = await freshModule();
      const card = createCompactCard({ wrapped: true });

      mod.queueCompactStackedCheck(card, 300);
      // Add content-hidden between queue and flush
      card.classList.add('content-hidden');
      flushRaf();

      expect(card.classList.contains('compact-stacked')).toBe(false);
    });

    it('cards from different documents are batched independently', async () => {
      const mod = await freshModule();

      // Simulate a popout window with a second document
      const doc2 = document.implementation.createHTMLDocument('popout');

      // Grid containers in each document
      const grid1 = document.createElement('div');
      grid1.classList.add('dynamic-views-grid');
      document.body.appendChild(grid1);

      const grid2 = doc2.createElement('div');
      grid2.classList.add('dynamic-views-grid');
      doc2.body.appendChild(grid2);

      // Main window: wrapped card at top=50
      const mainCard = createCompactCard({
        wrapped: true,
        gridParent: grid1,
        topOffset: 50,
      });

      // Popout: non-wrapped card at same top=50
      const popoutCard = doc2.createElement('div');
      popoutCard.classList.add('compact-mode');
      const pair = doc2.createElement('div');
      pair.classList.add('property-pair');
      const left = doc2.createElement('div');
      left.classList.add('pair-left');
      left.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
      const right = doc2.createElement('div');
      right.classList.add('pair-right');
      right.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
      pair.appendChild(left);
      pair.appendChild(right);
      popoutCard.appendChild(pair);
      grid2.appendChild(popoutCard);
      popoutCard.getBoundingClientRect = () => ({ top: 50 }) as DOMRect;

      mod.queueCompactStackedCheck(mainCard, 300);
      mod.queueCompactStackedCheck(popoutCard, 300);

      // Two separate RAFs scheduled (one per document)
      expect(requestAnimationFrame).toHaveBeenCalledTimes(2);

      flushRaf();

      // Main card: wrapped → compact-stacked
      expect(mainCard.classList.contains('compact-stacked')).toBe(true);
      // Popout card: NOT wrapped, NOT row-synced from main window
      expect(popoutCard.classList.contains('compact-stacked')).toBe(false);
    });

    // --- Row sync tests ---

    it('row sync propagates stacking to all cards in the same grid row', async () => {
      const mod = await freshModule();
      const gridContainer = document.createElement('div');
      gridContainer.classList.add('dynamic-views-grid');
      document.body.appendChild(gridContainer);

      const card1 = createCompactCard({
        wrapped: false,
        gridParent: gridContainer,
        topOffset: 50,
      });
      const card2 = createCompactCard({
        wrapped: true,
        gridParent: gridContainer,
        topOffset: 50,
      });
      const card3 = createCompactCard({
        wrapped: false,
        gridParent: gridContainer,
        topOffset: 50,
      });

      mod.queueCompactStackedCheck(card1, 300);
      mod.queueCompactStackedCheck(card2, 300);
      mod.queueCompactStackedCheck(card3, 300);
      flushRaf();

      // card2 is wrapped — all 3 in same row should get compact-stacked
      expect(card1.classList.contains('compact-stacked')).toBe(true);
      expect(card2.classList.contains('compact-stacked')).toBe(true);
      expect(card3.classList.contains('compact-stacked')).toBe(true);
    });

    it('row sync does not cross rows', async () => {
      const mod = await freshModule();
      const gridContainer = document.createElement('div');
      gridContainer.classList.add('dynamic-views-grid');
      document.body.appendChild(gridContainer);

      // Row 1 (top=50): one wrapped
      const row1Card1 = createCompactCard({
        wrapped: true,
        gridParent: gridContainer,
        topOffset: 50,
      });
      const row1Card2 = createCompactCard({
        wrapped: false,
        gridParent: gridContainer,
        topOffset: 50,
      });

      // Row 2 (top=200): no wrapping
      const row2Card1 = createCompactCard({
        wrapped: false,
        gridParent: gridContainer,
        topOffset: 200,
      });
      const row2Card2 = createCompactCard({
        wrapped: false,
        gridParent: gridContainer,
        topOffset: 200,
      });

      mod.queueCompactStackedCheck(row1Card1, 300);
      mod.queueCompactStackedCheck(row1Card2, 300);
      mod.queueCompactStackedCheck(row2Card1, 300);
      mod.queueCompactStackedCheck(row2Card2, 300);
      flushRaf();

      // Row 1 should all be stacked
      expect(row1Card1.classList.contains('compact-stacked')).toBe(true);
      expect(row1Card2.classList.contains('compact-stacked')).toBe(true);

      // Row 2 should not be stacked
      expect(row2Card1.classList.contains('compact-stacked')).toBe(false);
      expect(row2Card2.classList.contains('compact-stacked')).toBe(false);
    });

    it('row sync skips non-grid cards', async () => {
      const mod = await freshModule();
      const gridContainer = document.createElement('div');
      gridContainer.classList.add('dynamic-views-grid');
      document.body.appendChild(gridContainer);

      // Grid card with wrapping
      const gridCard = createCompactCard({
        wrapped: true,
        gridParent: gridContainer,
        topOffset: 50,
      });

      // Non-grid card (masonry) at same top — should NOT be synced
      const masonryCard = createCompactCard({
        wrapped: false,
        topOffset: 50,
      });

      mod.queueCompactStackedCheck(gridCard, 300);
      mod.queueCompactStackedCheck(masonryCard, 300);
      flushRaf();

      expect(gridCard.classList.contains('compact-stacked')).toBe(true);
      // Masonry card is not wrapped and not in grid — should not be synced
      expect(masonryCard.classList.contains('compact-stacked')).toBe(false);
    });
  });
});
