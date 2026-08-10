import {
  parseLines,
  findFencedCodeBlocks,
  findIndentedCodeBlocks,
  findInlineCodeRanges,
  findCommentRanges,
  isInsideCode,
  isInsideRange,
  removeRanges,
} from '../../src/core/markdown-ranges';

/** Cut every comment out of `content`, using full code detection. */
function stripComments(content: string): string {
  const lines = parseLines(content);
  const fenced = findFencedCodeBlocks(content, lines);
  const indented = findIndentedCodeBlocks(lines, fenced);
  const inline = findInlineCodeRanges(content, fenced);
  return removeRanges(
    content,
    findCommentRanges(content, (p) => isInsideCode(p, fenced, indented, inline))
  );
}

describe('markdown-ranges', () => {
  describe('findCommentRanges', () => {
    it('should find a closed Obsidian comment', () => {
      expect(findCommentRanges('ab %%hide%% cd')).toEqual([
        { start: 3, end: 11 },
      ]);
    });

    it('should find a closed HTML comment', () => {
      expect(findCommentRanges('ab <!--hide--> cd')).toEqual([
        { start: 3, end: 14 },
      ]);
    });

    it('should run an unclosed comment to the end of content', () => {
      expect(findCommentRanges('ab %% tail')).toEqual([{ start: 3, end: 10 }]);
      expect(findCommentRanges('ab <!-- tail')).toEqual([
        { start: 3, end: 12 },
      ]);
    });

    it('should return ascending non-overlapping ranges', () => {
      const ranges = findCommentRanges('a %%x%% b <!--y--> c');
      expect(ranges).toEqual([
        { start: 2, end: 7 },
        { start: 10, end: 18 },
      ]);
    });

    it('should treat the earliest opener as the comment', () => {
      // The `%%` sits inside the HTML comment, so it is comment text — the
      // trailing content must survive. Matches Obsidian's renderer.
      expect(stripComments('A <!-- %% --> tail')).toBe('A  tail');
    });

    it('should let an Obsidian comment span an HTML opener', () => {
      expect(stripComments('B %% <!-- %% tail')).toBe('B  tail');
    });

    it('should ignore an opener inside inline code', () => {
      expect(stripComments('Code `%%` here. Tail.')).toBe(
        'Code `%%` here. Tail.'
      );
    });

    it('should ignore an opener inside a fenced block', () => {
      const input = 'a\n```\n%%\n```\nb';
      expect(stripComments(input)).toBe(input);
    });

    it('should ignore an opener inside indented code', () => {
      const input = 'text\n\n    %% indented\n\ntail';
      expect(stripComments(input)).toBe(input);
    });

    it('should resume scanning after a skipped in-code opener', () => {
      // The backticked `%%` must not pair with the real comment that follows
      expect(stripComments('`%%` a %%hidden%% b')).toBe('`%%` a  b');
    });

    it('should return no ranges for content without comments', () => {
      expect(findCommentRanges('plain text')).toEqual([]);
    });

    it('should treat every position as code when told to', () => {
      expect(findCommentRanges('%%x%%', () => true)).toEqual([]);
    });
  });

  describe('isInsideRange', () => {
    const ranges = [{ start: 5, end: 10 }];

    it('should use a half-open interval', () => {
      expect(isInsideRange(4, ranges)).toBe(false);
      expect(isInsideRange(5, ranges)).toBe(true);
      expect(isInsideRange(9, ranges)).toBe(true);
      expect(isInsideRange(10, ranges)).toBe(false);
    });

    it('should return false for no ranges', () => {
      expect(isInsideRange(5, [])).toBe(false);
    });
  });

  describe('removeRanges', () => {
    it('should return content unchanged for no ranges', () => {
      expect(removeRanges('abcdef', [])).toBe('abcdef');
    });

    it('should cut a single range', () => {
      expect(removeRanges('abcdef', [{ start: 2, end: 4 }])).toBe('abef');
    });

    it('should cut multiple ranges', () => {
      expect(
        removeRanges('abcdefgh', [
          { start: 1, end: 3 },
          { start: 5, end: 7 },
        ])
      ).toBe('adeh');
    });

    it('should cut a range running to the end', () => {
      expect(removeRanges('abcdef', [{ start: 3, end: 6 }])).toBe('abc');
    });
  });
});
