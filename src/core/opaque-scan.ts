/**
 * Positional scanning of Markdown source for regions whose contents must not be
 * treated as ordinary syntax — code (fenced, indented, inline) and comments.
 * Those regions are "opaque": syntax written inside one is literal text.
 *
 * Both the card image extractor and the text preview stripper need the same
 * answer to "is this position inside a comment?", and they answered it
 * differently before this module existed: the extractor scanned positions, the
 * stripper ran regexes. They disagreed on adjacent delimiters (`<!-- %% -->`)
 * and on delimiters inside indented code. One implementation, one answer.
 */

/** A half-open span of the source: `start` inclusive, `end` exclusive. */
interface TextRange {
  start: number;
  end: number;
}

/**
 * Extended range for fenced code blocks with cardlink detection and content.
 */
interface FencedCodeBlock extends TextRange {
  isCardlink: boolean;
  content: string;
}

/**
 * Line metadata for efficient multi-pass processing.
 */
interface LineInfo {
  text: string;
  start: number;
  end: number;
}

/** A cardlink fence whose body an Auto Card Link `image:` field can be read from. */
export interface CardlinkBlock {
  start: number;
  content: string;
}

/**
 * One note's opaque regions, resolved on demand.
 *
 * Every member is lazy and memoized: the extractor runs this on every note in a
 * query, and most notes need only a subset of the passes.
 */
export interface OpaqueScan {
  /** Whether the position sits inside code or a comment. */
  isOpaque(position: number): boolean;
  /** The content with every comment range cut out. */
  cutComments(): string;
  /** Cardlink fences that are not themselves commented out. */
  cardlinkBlocks: CardlinkBlock[];
}

/**
 * Parse content into line metadata array (split once, reuse everywhere).
 */
function parseLines(content: string): LineInfo[] {
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
function findFencedCodeBlocks(
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
          end: line.end + 1,
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
function findIndentedCodeBlocks(
  lines: LineInfo[],
  fencedBlocks: FencedCodeBlock[]
): TextRange[] {
  const ranges: TextRange[] = [];
  let blockStart: number | null = null;
  let blockEnd = 0;
  let prevLineBlank = true; // Treat start of content as preceded by blank

  for (const line of lines) {
    // Skip lines inside fenced code blocks
    if (fencedBlocks.some((b) => line.start >= b.start && line.end < b.end)) {
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
        blockEnd = line.end + 1;
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

/**
 * Match inline code: `` `...` ``, capturing the span's literal text.
 *
 * Deliberately line-bounded, which is stricter than Obsidian. A real code span
 * does cross a soft line break — `` `a\nb` `` renders as one `<code>` element —
 * but it cannot cross a *block* boundary, and modelling where blocks begin is a
 * far larger job than this buys. Line-bounded fails safe: the worst case is a
 * multi-line span whose backticks stay visible, whereas allowing line breaks
 * lets one unpaired backtick swallow the headings, lists, and tables after it.
 *
 * Module-level to avoid recreation on each call, and shared so the extractor and
 * the preview stripper classify inline code identically.
 */
export const INLINE_CODE_REGEX = /`([^`\n]+)`/g;

/**
 * Find all inline code ranges (single backticks).
 * Excludes ranges inside fenced code blocks.
 */
function findInlineCodeRanges(
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
      (b) => start >= b.start && start < b.end
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
 * Cardlink blocks are deliberately not treated as code — see the two predicates
 * built in `scanOpaque`.
 */
function isInsideCode(
  position: number,
  fencedBlocks: FencedCodeBlock[],
  indentedBlocks: TextRange[],
  inlineRanges: TextRange[]
): boolean {
  // Check fenced blocks (excluding cardlink blocks which we want to parse)
  for (const block of fencedBlocks) {
    if (!block.isCardlink && position >= block.start && position < block.end) {
      return true;
    }
  }

  for (const range of indentedBlocks) {
    if (position >= range.start && position < range.end) {
      return true;
    }
  }

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
 * nothing, an unclosed *block* opener hides everything through the end of the
 * note, and a delimiter inside code is literal text.
 *
 * `closeChar` is the one character no closer can lack, so a line without it
 * cannot possibly close the comment on that line. That is what separates the two
 * forms — see `isBlockForm`.
 */
const COMMENT_DELIMITERS = [
  { open: '%%', close: '%%', closeChar: '%' },
  { open: '<!--', close: '-->', closeChar: '>' },
] as const;

/**
 * Cheap test for whether content could contain a comment at all.
 *
 * Lets the comment scan be skipped outright on the majority of notes, where no
 * opener is present. Derived from `COMMENT_DELIMITERS` so a third syntax cannot
 * be added to one and not the other.
 */
function hasCommentDelimiter(content: string): boolean {
  return COMMENT_DELIMITERS.some(({ open }) => content.includes(open));
}

/**
 * Whether an opener starts a *block* comment rather than an inline one.
 *
 * Obsidian tokenizes the two forms separately, and they disagree about an
 * unclosed opener: an inline one is not a comment at all and renders literally,
 * while a block one hides everything after it. An opener is block form when it
 * begins its own line and nothing on the rest of that line could close it.
 */
function isBlockForm(
  content: string,
  start: number,
  open: string,
  closeChar: string,
  lineEnd: number
): boolean {
  const lineStart = content.lastIndexOf('\n', start - 1) + 1;
  if (content.slice(lineStart, start).trim() !== '') return false;
  return !content.slice(start + open.length, lineEnd).includes(closeChar);
}

/**
 * Find all comment ranges in content.
 *
 * Scanning is strictly left to right and each comment consumes its whole span,
 * so the earliest opener wins and delimiters of the other kind nested inside it
 * are just comment text. Openers inside code are literal, and skipping one
 * resumes the scan immediately after it rather than consuming the delimiter.
 *
 * Closers are deliberately not code-aware. Verified against Obsidian's renderer:
 * ``Alpha %% hidden `%%` still hidden %% Beta`` renders as
 * ``Alpha ` still hidden %% Beta`` — the first comment closes at the backticked
 * `%%`, leaving the trailing `%%` as an unclosed inline opener that stays literal.
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
function findCommentRanges(
  content: string,
  isInCode: (position: number) => boolean
): TextRange[] {
  const ranges: TextRange[] = [];
  let cursor = 0;

  while (cursor < content.length) {
    // Earliest opener at or after the cursor wins, so nesting can't be straddled
    let opener: {
      start: number;
      open: string;
      close: string;
      closeChar: string;
    } | null = null;
    for (const delimiter of COMMENT_DELIMITERS) {
      const start = content.indexOf(delimiter.open, cursor);
      if (start !== -1 && (!opener || start < opener.start)) {
        opener = { start, ...delimiter };
      }
    }
    if (!opener) break;

    const contentStart = opener.start + opener.open.length;
    if (isInCode(opener.start)) {
      cursor = contentStart;
      continue;
    }

    // CommonMark's degenerate empty comments `<!-->` and `<!--->`, whose closing
    // `>` overlaps the opener's own characters and so is unreachable by the close
    // search below. Without this they read as unclosed and hide the rest of the
    // note, while the four-dash `<!---->` works — an inconsistency, not a rule.
    // Checked before the form split because they always close on their own line.
    const degenerate =
      opener.open === '<!--' && /^-?>/.exec(content.slice(contentStart));
    if (degenerate) {
      const end = contentStart + degenerate[0].length;
      ranges.push({ start: opener.start, end });
      cursor = end;
      continue;
    }

    const newlineIndex = content.indexOf('\n', opener.start);
    const lineEnd = newlineIndex === -1 ? content.length : newlineIndex;
    const closeIndex = content.indexOf(opener.close, contentStart);

    if (
      !isBlockForm(
        content,
        opener.start,
        opener.open,
        opener.closeChar,
        lineEnd
      )
    ) {
      // Inline form: an opener with no closer on its own line is not a comment,
      // so resume after it rather than consuming the rest of the note
      if (closeIndex === -1 || closeIndex >= lineEnd) {
        cursor = contentStart;
        continue;
      }
      const end = closeIndex + opener.close.length;
      ranges.push({ start: opener.start, end });
      cursor = end;
      continue;
    }

    // Block form: the closer may be anywhere, and an unclosed one swallows the
    // remainder of the note
    const end =
      closeIndex === -1 ? content.length : closeIndex + opener.close.length;
    ranges.push({ start: opener.start, end });
    cursor = end;
  }

  return ranges;
}

/** Check if a position falls inside any half-open range. */
function isInsideRange(position: number, ranges: TextRange[]): boolean {
  return ranges.some((r) => position >= r.start && position < r.end);
}

/**
 * Cut every range out of the content.
 * Ranges must be ascending and non-overlapping, as `findCommentRanges` returns.
 */
function removeRanges(content: string, ranges: TextRange[]): string {
  if (ranges.length === 0) return content;

  let result = '';
  let cursor = 0;
  for (const range of ranges) {
    result += content.slice(cursor, range.start);
    cursor = range.end;
  }
  return result + content.slice(cursor);
}

/**
 * Scan one note's content for opaque regions.
 *
 * Every pass is deferred until something asks for it and then memoized, because
 * this runs per card: a note with no comment delimiter never pays for the
 * comment scan, and a caller that only wants cardlink blocks never pays for
 * inline code detection.
 */
export function scanOpaque(content: string): OpaqueScan {
  let lines: LineInfo[] | null = null;
  let fenced: FencedCodeBlock[] | null = null;
  let indented: TextRange[] | null = null;
  let inline: TextRange[] | null = null;
  let comments: TextRange[] | null = null;
  let cardlinks: CardlinkBlock[] | null = null;

  const getLines = () => (lines ??= parseLines(content));
  const getFenced = () =>
    (fenced ??= findFencedCodeBlocks(content, getLines()));
  const getIndented = () =>
    (indented ??= findIndentedCodeBlocks(getLines(), getFenced()));
  const getInline = () =>
    (inline ??= findInlineCodeRanges(content, getFenced()));

  // Two code predicates that deliberately disagree about cardlink fences.
  //
  // Lenient treats a cardlink fence as transparent. That does NOT protect its
  // `image:` field — that field is parsed out of the block's own content by
  // regex and never consults a position predicate. Leniency's only observable
  // effect is that an `![[...]]` written in a cardlink block's body is extracted
  // as an embed, which is long-standing behavior and left as is.
  //
  // Strict counts a cardlink fence as code, and the comment scan needs that: a
  // `%%` inside a cardlink title or description is literal text, and reading it
  // as an opener would start a comment that never closes and hide every image
  // after it.
  const isInsideCodeLenient = (position: number) =>
    isInsideCode(position, getFenced(), getIndented(), getInline());

  const isInsideCodeStrict = (position: number) =>
    isInsideCodeLenient(position) ||
    getFenced().some(
      (b) => b.isCardlink && position >= b.start && position < b.end
    );

  const getComments = () =>
    (comments ??= hasCommentDelimiter(content)
      ? findCommentRanges(content, isInsideCodeStrict)
      : []);

  return {
    isOpaque: (position) =>
      isInsideCodeLenient(position) || isInsideRange(position, getComments()),

    cutComments: () => removeRanges(content, getComments()),

    get cardlinkBlocks() {
      return (cardlinks ??= getFenced()
        .filter((b) => b.isCardlink && !isInsideRange(b.start, getComments()))
        .map((b) => ({ start: b.start, content: b.content })));
    },
  };
}
