/**
 * Positional scanning of Markdown source for regions whose contents must not be
 * treated as ordinary syntax — code (fenced, indented, inline) and comments.
 *
 * Both the card image extractor and the text preview stripper need the same
 * answer to "is this position inside a comment?", and they answered it
 * differently before this module existed: the extractor scanned positions, the
 * stripper ran regexes. They disagreed on adjacent delimiters (`<!-- %% -->`)
 * and on delimiters inside indented code. One implementation, one answer.
 */

/**
 * A half-open span of the source: `start` inclusive, `end` exclusive.
 *
 * Code ranges are the exception — they are built with an inclusive `end` and are
 * only ever tested through `isInsideCode`, which accounts for that.
 */
export interface TextRange {
  start: number;
  end: number;
}

/**
 * Extended range for fenced code blocks with cardlink detection and content.
 */
export interface FencedCodeBlock extends TextRange {
  isCardlink: boolean;
  content: string;
}

/**
 * Line metadata for efficient multi-pass processing.
 */
export interface LineInfo {
  text: string;
  start: number;
  end: number;
}

/**
 * Parse content into line metadata array (split once, reuse everywhere).
 */
export function parseLines(content: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let position = 0;

  for (const text of content.split('\n')) {
    const start = position;
    const end = position + text.length;
    lines.push({ text, start, end });
    position = end + 1; // +1 for newline
  }

  return lines;
}

/**
 * Find all fenced code block ranges in content.
 * Handles both ``` and ~~~ fences with matching lengths.
 */
export function findFencedCodeBlocks(
  content: string,
  lines: LineInfo[]
): FencedCodeBlock[] {
  const blocks: FencedCodeBlock[] = [];
  let currentBlock: {
    start: number;
    fenceChar: string;
    fenceLength: number;
    isCardlink: boolean;
    contentStart: number;
  } | null = null;

  for (const line of lines) {
    // Check for fence (3+ backticks or tildes at line start)
    // Per CommonMark, info string can contain any characters after the fence
    const fenceMatch = line.text.match(/^(\s*)([`~]{3,})(.*)$/);

    if (fenceMatch) {
      const fenceChar = fenceMatch[2][0];
      const fenceLength = fenceMatch[2].length;
      // Extract first word of info string as language (e.g., "python" from "python {.class}")
      const infoString = fenceMatch[3]?.trim() || '';
      const language = infoString.split(/\s+/)[0]?.toLowerCase() || '';

      if (!currentBlock) {
        // Opening fence
        currentBlock = {
          start: line.start,
          fenceChar,
          fenceLength,
          isCardlink: language === 'cardlink' || language === 'embed',
          contentStart: line.end + 1,
        };
      } else if (
        fenceChar === currentBlock.fenceChar &&
        fenceLength === currentBlock.fenceLength &&
        infoString === '' // Per CommonMark, closing fence must have no content
      ) {
        // Matching closing fence
        blocks.push({
          start: currentBlock.start,
          end: line.end,
          isCardlink: currentBlock.isCardlink,
          content: content.slice(currentBlock.contentStart, line.start),
        });
        currentBlock = null;
      }
    }
  }

  return blocks;
}

/**
 * Find all indented code block ranges.
 * Per CommonMark: indented code requires a preceding blank line.
 * Excludes lines inside fenced code blocks.
 */
export function findIndentedCodeBlocks(
  lines: LineInfo[],
  fencedBlocks: FencedCodeBlock[]
): TextRange[] {
  const ranges: TextRange[] = [];
  let blockStart: number | null = null;
  let blockEnd = 0;
  let prevLineBlank = true; // Treat start of content as preceded by blank

  for (const line of lines) {
    // Skip lines inside fenced code blocks
    if (fencedBlocks.some((b) => line.start >= b.start && line.end <= b.end)) {
      // Reset indented block tracking when entering fenced block
      if (blockStart !== null) {
        ranges.push({ start: blockStart, end: blockEnd });
        blockStart = null;
      }
      prevLineBlank = false;
      continue;
    }

    const isEmpty = line.text.trim() === '';
    const isIndented = /^(\t| {4})/.test(line.text);

    if (isIndented) {
      // Only start new indented block if preceded by blank line
      if (blockStart === null && prevLineBlank) {
        blockStart = line.start;
      }
      // Extend existing block (blank lines within block are ok)
      if (blockStart !== null) {
        blockEnd = line.end;
      }
    } else if (!isEmpty) {
      // Non-empty, non-indented line ends the block
      if (blockStart !== null) {
        ranges.push({ start: blockStart, end: blockEnd });
        blockStart = null;
      }
    }
    // Empty lines: don't end block, but allow next indented line to continue it

    prevLineBlank = isEmpty;
  }

  // Handle block at end of content
  if (blockStart !== null) {
    ranges.push({ start: blockStart, end: blockEnd });
  }

  return ranges;
}

// Match inline code: `...` (backticks with content, not spanning newlines)
// Module-level to avoid recreation on each call
const INLINE_CODE_REGEX = /`[^`\n]+`/g;

/**
 * Find all inline code ranges (single backticks).
 * Excludes ranges inside fenced code blocks.
 */
export function findInlineCodeRanges(
  content: string,
  fencedBlocks: FencedCodeBlock[]
): TextRange[] {
  const ranges: TextRange[] = [];
  // Reset regex lastIndex (global flag maintains state across calls)
  INLINE_CODE_REGEX.lastIndex = 0;

  for (const match of content.matchAll(INLINE_CODE_REGEX)) {
    const start = match.index;
    const end = start + match[0].length;
    // Exclude if inside any fenced block (including cardlink)
    const insideFenced = fencedBlocks.some(
      (b) => start >= b.start && start <= b.end
    );
    if (!insideFenced) {
      ranges.push({ start, end });
    }
  }

  return ranges;
}

/**
 * Check if a position falls inside any code range.
 *
 * Boundary semantics:
 * - Fenced/indented: position <= end (inclusive, end is last char of closing fence/line)
 * - Inline: position < end (exclusive, end is position after closing backtick)
 *
 * Cardlink blocks are deliberately not treated as code — their contents are
 * parsed for an image field.
 */
export function isInsideCode(
  position: number,
  fencedBlocks: FencedCodeBlock[],
  indentedBlocks: TextRange[],
  inlineRanges: TextRange[]
): boolean {
  // Check fenced blocks (excluding cardlink blocks which we want to parse)
  for (const block of fencedBlocks) {
    if (!block.isCardlink && position >= block.start && position <= block.end) {
      return true;
    }
  }

  // Check indented blocks (inclusive boundaries)
  for (const range of indentedBlocks) {
    if (position >= range.start && position <= range.end) {
      return true;
    }
  }

  // Check inline code (exclusive end - don't match at closing backtick position)
  for (const range of inlineRanges) {
    if (position >= range.start && position < range.end) {
      return true;
    }
  }

  return false;
}

/**
 * Comment delimiters whose contents Obsidian hides in Reading view.
 *
 * Verified against Obsidian's renderer: embeds inside either form render
 * nothing, an unclosed opener hides everything through the end of the note, and
 * a delimiter inside code is literal text.
 */
const COMMENT_DELIMITERS = [
  { open: '%%', close: '%%' },
  { open: '<!--', close: '-->' },
] as const;

/**
 * Find all comment ranges in content.
 *
 * Scanning is strictly left to right and each comment consumes its whole span,
 * so the earliest opener wins and delimiters of the other kind nested inside it
 * are just comment text. Openers inside code are literal, and skipping one
 * resumes the scan immediately after it rather than consuming the delimiter.
 *
 * Known simplification: CommonMark forbids `--` inside an HTML comment's body,
 * so Obsidian reads `<!-- a <!-- b -->` as the *inner* comment and leaves
 * `<!-- a ` as text. This treats the outer opener as the comment instead, which
 * hides slightly more text. The failure direction is safe — content is hidden,
 * never revealed — and doubly-nested openers do not occur in practice.
 *
 * @param isInCode - Predicate telling whether a position sits inside code
 * @returns Ranges with exclusive `end`, in ascending order, non-overlapping
 */
export function findCommentRanges(
  content: string,
  isInCode: (position: number) => boolean = () => false
): TextRange[] {
  const ranges: TextRange[] = [];
  let cursor = 0;

  while (cursor < content.length) {
    // Earliest opener at or after the cursor wins, so nesting can't be straddled
    let opener: { start: number; open: string; close: string } | null = null;
    for (const { open, close } of COMMENT_DELIMITERS) {
      const start = content.indexOf(open, cursor);
      if (start !== -1 && (!opener || start < opener.start)) {
        opener = { start, open, close };
      }
    }
    if (!opener) break;

    const contentStart = opener.start + opener.open.length;
    if (isInCode(opener.start)) {
      cursor = contentStart;
      continue;
    }

    const closeIndex = content.indexOf(opener.close, contentStart);
    ranges.push({
      start: opener.start,
      // An unclosed comment swallows the remainder of the note
      end:
        closeIndex === -1 ? content.length : closeIndex + opener.close.length,
    });
    cursor = ranges[ranges.length - 1].end;
  }

  return ranges;
}

/**
 * Check if a position falls inside any half-open range.
 */
export function isInsideRange(position: number, ranges: TextRange[]): boolean {
  return ranges.some((r) => position >= r.start && position < r.end);
}

/**
 * Cut every range out of the content.
 * Ranges must be ascending and non-overlapping, as `findCommentRanges` returns.
 */
export function removeRanges(content: string, ranges: TextRange[]): string {
  if (ranges.length === 0) return content;

  let result = '';
  let cursor = 0;
  for (const range of ranges) {
    result += content.slice(cursor, range.start);
    cursor = range.end;
  }
  return result + content.slice(cursor);
}
