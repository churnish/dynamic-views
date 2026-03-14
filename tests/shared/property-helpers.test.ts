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
});
