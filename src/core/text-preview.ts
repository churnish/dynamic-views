/**
 * Text preview utilities
 * Extracts and sanitizes content for card previews
 */

import { App, TFile } from 'obsidian';
import { scanOpaque, INLINE_CODE_REGEX } from './opaque-scan';

/**
 * Markdown patterns for syntax stripping
 *
 * ORDERING MATTERS - patterns are applied sequentially:
 * 1. Bold+italic (***) before bold (**) before italic (*) - longer patterns first
 * 2. Same for underscores: ___ before __ before _
 * 3. Wikilinks before Markdown links (a wikilink's inner brackets look like a label)
 * 4. Task markers before bare checkboxes (so "- [ ]" strips fully, not to "[ ]")
 * 5. Task markers before bullet markers (so "- [ ]" isn't just stripped to "[ ]")
 * 6. Raw-text HTML elements before the generic tag sweep (their text is not content)
 *
 * Four steps run before this array, in `stripMarkdownSyntax`, in this order:
 * escaped characters are protected, fenced code blocks are removed, comments are
 * cut, and inline code is set aside. Comments are cut before inline code is set
 * aside because the comment scan does its own code detection and needs the real
 * backticks — see the call site.
 *
 * Each entry carries its own replacement rather than inferring one from the match,
 * because capture-group counts differ per pattern and a shared heuristic silently
 * mis-substitutes when a pattern has no groups.
 */
/** Heading lines — extracted so `stripMarkdownSyntax` can skip it by reference */
const headingPattern = /^#{1,6}(?:[ \t].*)?$/gm;

/**
 * Bracket-balanced link label: plain characters, or one nested `[...]` group.
 * Obsidian renders `[[FR] Feature request](url)` as a link, so the label must be
 * allowed to contain brackets instead of terminating at the first `]`.
 */
const LINK_LABEL = String.raw`(?:[^[\]\n]|\[[^[\]\n]*])*`;

interface MarkdownPattern {
  pattern: RegExp;
  /** Replacement string — `''` drops the match, `'$1'` keeps a capture group */
  replacement: string;
}

const markdownPatterns: MarkdownPattern[] = [
  { pattern: /\*\*\*((?:(?!\*\*\*).)+)\*\*\*/g, replacement: '$1' }, // Bold + italic asterisks (before ** and *)
  { pattern: /___((?:(?!___).)+)___/g, replacement: '$1' }, // Bold + italic underscores (before __ and _)
  { pattern: /\*\*((?:(?!\*\*).)+)\*\*/g, replacement: '$1' }, // Bold asterisks (before *)
  { pattern: /__((?:(?!__).)+)__/g, replacement: '$1' }, // Bold underscores (before _)
  { pattern: /\*((?:(?!\*).)+)\*/g, replacement: '$1' }, // Italic asterisks
  { pattern: /_((?:(?!_).)+)_/g, replacement: '$1' }, // Italic underscores
  { pattern: /~~((?:(?!~~).)+)~~/g, replacement: '$1' }, // Strikethrough
  { pattern: /==((?:(?!==).)+)==/g, replacement: '$1' }, // Highlight
  // Wikilinks run before Markdown links: the bracket-balanced link label matches a
  // wikilink's inner brackets, so `[[Some Note]](url)` would otherwise be eaten as a
  // Markdown link and preview as literal `[Some Note]` with the URL dropped
  { pattern: /!\[\[(?:[^\]]|\](?!\]))+\]\]/g, replacement: '' }, // Embedded wikilinks (images, etc.)
  {
    pattern: /\[\[(?:[^\]|]|\](?!\]))+\|((?:[^\]]|\](?!\]))*)\]\]/g,
    replacement: '$1', // Wikilinks with alias → keep alias
  },
  { pattern: /\[\[((?:[^\]]|\](?!\]))+)\]\]/g, replacement: '$1' }, // Wikilinks → keep link text
  {
    pattern: new RegExp(String.raw`!\[${LINK_LABEL}]\([^)]*\)`, 'g'),
    replacement: '', // Markdown images (before links, strip entirely)
  },
  {
    pattern: new RegExp(String.raw`\[(${LINK_LABEL})]\([^)]*\)`, 'g'),
    replacement: '$1', // Links — no checkbox exclusion needed: valid checkboxes require \s after ]
  },
  { pattern: /(^|\s)#[a-zA-Z0-9_\-/]+/g, replacement: '$1' }, // Tags (require whitespace/line-start before #)
  { pattern: /^\s*[-*+]\s*\[[^\]]\]\s*/gm, replacement: '' }, // Task list markers (bullet-style) - before bare checkbox
  { pattern: /^\s*(\d+[.)]\s*)\[[^\]]\]\s*/gm, replacement: '$1' }, // Task list markers (numbered) - preserves number
  { pattern: /\[[^\]]\](?=\s|$)/g, replacement: '' }, // Bare task checkboxes (after task markers, only before whitespace/EOL)
  { pattern: /^\s*[-*+]\s+/gm, replacement: '' }, // Bullet list markers (after task markers)
  { pattern: headingPattern, replacement: '' }, // Heading lines (full removal, [ \t] prevents cross-newline matching)
  {
    pattern: /^\s*(?:[-_*])\s*(?:[-_*])\s*(?:[-_*])[\s\-_*]*$/gm,
    replacement: '', // Horizontal rules
  },
  { pattern: /^\s*\|.*\|.*$/gm, replacement: '' }, // Tables
  { pattern: /\^\[[^\]]*?]/g, replacement: '' }, // Inline footnotes
  { pattern: /\[\^[^\]]+]/g, replacement: '' }, // Footnote markers
  { pattern: /^\s*\[\^[^\]]+]:.*$/gm, replacement: '' }, // Footnote details
  {
    pattern: /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,
    replacement: '', // Raw-text elements — their text is code, not prose
  },
  {
    // Declarations and processing instructions render as nothing. The tag sweep
    // below deliberately requires a letter after `<` so `a < b` survives, which
    // leaves these to be handled here.
    pattern: /<!(?:DOCTYPE|\[CDATA\[)[\s\S]*?>|<\?[\s\S]*?\?>/gi,
    replacement: '',
  },
  {
    // Tags only, at any nesting depth — dropping open and close markers alike keeps
    // the text between them, so `<b>a <i>b</i> c</b>` collapses to `a b c`
    pattern: /<\/?[a-zA-Z][^>]*>/g,
    replacement: '',
  },
];

/**
 * Build a placeholder fence that does not occur in the text being processed.
 *
 * A note may legitimately contain the literal placeholder text, in which case a
 * fixed fence would see the author's own words rewritten with mapped content.
 * Widening until the text is clean makes the substitution collision-proof.
 * `§` is used because no Markdown pattern in this module treats it as syntax.
 */
function uniqueFence(text: string): string {
  let fence = '§§';
  while (text.includes(fence)) fence += '§';
  return fence;
}

/**
 * Replace escaped characters with placeholders to protect from Markdown processing
 * Returns the text with placeholders and a map to restore them later
 */
function protectEscapedChars(text: string): {
  text: string;
  map: Map<string, string>;
} {
  const map = new Map<string, string>();
  const fence = uniqueFence(text);
  let counter = 0;

  const result = text.replace(/\\(.)/g, (_match: string, char: string) => {
    const placeholder = `${fence}ESCAPED${counter}${fence}`;
    map.set(placeholder, char); // Store escaped character (without backslash - the escape is consumed)
    counter++;
    return placeholder;
  });

  return { text: result, map };
}

/**
 * Restore placeholder substitutions (escaped characters, inline code).
 *
 * One pass over the text rather than one pass per entry: placeholders are
 * disjoint literals, so a single scan resolves them all and the cost stops
 * scaling with how many escapes or code spans a note happens to contain.
 * Replacing in one pass also means a restored value cannot itself be re-read as
 * another placeholder.
 */
function restorePlaceholders(text: string, map: Map<string, string>): string {
  if (map.size === 0) return text;
  // Built from the map's own keys, so it matches this call's fence width exactly
  const alternatives = [...map.keys()]
    .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  return text.replace(
    new RegExp(alternatives, 'g'),
    (placeholder) => map.get(placeholder) ?? placeholder
  );
}

/**
 * Replace inline code spans with placeholders holding their literal text.
 *
 * Obsidian renders a code span verbatim — `` `**x**` `` is not bold (verified in
 * Reading view). Setting spans aside keeps a stray delimiter inside code from
 * being read as syntax by the pattern pass.
 *
 * Comment delimiters are not part of that job. The comment cut runs first and
 * classifies code itself, so by the time this runs an opener inside a code span
 * has already been ruled out.
 */
function protectInlineCode(text: string): {
  text: string;
  map: Map<string, string>;
} {
  const map = new Map<string, string>();
  const fence = uniqueFence(text);
  let counter = 0;

  const result = text.replace(
    INLINE_CODE_REGEX,
    (_match: string, code: string) => {
      const placeholder = `${fence}CODE${counter}${fence}`;
      map.set(placeholder, code);
      counter++;
      return placeholder;
    }
  );

  return { text: result, map };
}

/**
 * Remove code blocks (fenced with backticks or tildes) with matching fence counts
 * Must be done before strikethrough processing since ~~~ can be code fences
 * Handles both inline (~~~hi~~~) and multi-line code blocks
 */
function removeCodeBlocks(text: string): string {
  let result = text;
  let changed = true;

  // Keep processing until no more code blocks found
  while (changed) {
    changed = false;

    // Find opening fence (3+ backticks or tildes, optionally indented)
    const openMatch = result.match(/^(\s*)([`~]{3,})/m);
    if (!openMatch) break;

    const fence = openMatch[2];
    const fenceChar = fence[0];
    const fenceLength = fence.length;
    const openIndex = openMatch.index!;

    // Build regex for matching closing fence (same char, exact count).
    // The closer may be indented, matching the opener above and
    // `findFencedCodeBlocks` — a fence inside a list item is indented on both
    // sides, and requiring a flush-left closer left the block open, so its code
    // body leaked into the preview while the extractor correctly hid it.
    // `[ \t]*` rather than `\s*`: the latter crosses newlines and would let a
    // blank line plus a later fence close the block.
    const escapedChar = fenceChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const closePattern = new RegExp(
      `^[ \\t]*${escapedChar}{${fenceLength}}[ \\t]*$`,
      'm'
    );

    // Search for closing fence after opening (skip indent + fence)
    const afterOpen = result.substring(openIndex + openMatch[0].length);
    const closeMatch = afterOpen.match(closePattern);

    if (closeMatch) {
      // Found matching closing fence
      const closeIndex = openIndex + openMatch[0].length + closeMatch.index!;
      const blockEnd = closeIndex + closeMatch[0].length;

      // Remove entire code block (opening fence + content + closing fence)
      result = result.substring(0, openIndex) + result.substring(blockEnd);
      changed = true;
    } else {
      // No closing fence found, remove just the opening fence line to continue processing
      const lineEnd = result.indexOf('\n', openIndex);
      if (lineEnd === -1) {
        // Opening fence is on last line with no closing, remove it
        result = result.substring(0, openIndex);
      } else {
        result = result.substring(0, openIndex) + result.substring(lineEnd + 1);
      }
      changed = true;
    }
  }

  return result;
}

/**
 * Maximum raw content stripped for one preview (20KB).
 *
 * A preview is capped at 1,000 characters, and the worst measured *finite*
 * stripped-to-raw ratio is 0.26 (link-dense reference lists). Rounding that down
 * to 0.20 gives 5,000 raw characters per 1,000 of output; 20KB is that with 4x
 * headroom for a note whose lead-in is not prose.
 *
 * Accepted limitation: a note whose first 20KB is entirely images, tables, or
 * code now previews as empty, where before the cap it reached the prose below.
 */
const MAX_TEXT_PREVIEW_CONTENT_SIZE = 20_000;

/**
 * Index of the fence opener left unclosed at the end of `text`, or -1.
 *
 * Fence matching mirrors `removeCodeBlocks`: an opener may be indented and carry
 * an info string, while a closer must start the line and repeat the same
 * character exactly as many times with nothing after it.
 */
function findUnclosedFenceStart(text: string): number {
  let openIndex = -1;
  let openFence = '';
  let position = 0;

  for (const line of text.split('\n')) {
    const fenceMatch = /^(\s*)([`~]{3,})(.*)$/.exec(line);
    if (fenceMatch) {
      const [, indent, fence, info] = fenceMatch;
      if (openIndex === -1) {
        openIndex = position;
        openFence = fence;
      } else if (indent === '' && fence === openFence && info.trim() === '') {
        openIndex = -1;
      }
    }
    position += line.length + 1; // +1 for newline
  }

  return openIndex;
}

/**
 * Truncate content to the preview cap at a line boundary.
 *
 * Backing off past a fence the cut landed inside is not cosmetic: an unclosed
 * opener makes `removeCodeBlocks` drop only the opener line, so the code body
 * survives as prose and becomes the preview. That was observed putting a
 * credential-shaped string on a card.
 */
function truncateForPreview(content: string): string {
  if (content.length <= MAX_TEXT_PREVIEW_CONTENT_SIZE) return content;

  // Cut at a line boundary so no wikilink, fence, or comment is split mid-syntax
  const lastNewline = content.lastIndexOf('\n', MAX_TEXT_PREVIEW_CONTENT_SIZE);
  const truncated = content.slice(
    0,
    lastNewline !== -1 ? lastNewline : MAX_TEXT_PREVIEW_CONTENT_SIZE
  );

  const unclosedFence = findUnclosedFenceStart(truncated);
  return unclosedFence === -1 ? truncated : truncated.slice(0, unclosedFence);
}

/**
 * Strip Markdown syntax from text while preserving content
 * @param options.preserveHeadings - Strip `#` markers but keep heading text
 */
export function stripMarkdownSyntax(
  text: string,
  options?: { preserveHeadings?: boolean }
): string {
  if (!text || text.trim().length === 0) return '';

  // First pass: remove callout title lines at any nesting depth
  text = text.replace(/^(?:>\s*)+\[![\w-]+\][+-]?.*$/gm, '');
  // Second pass: strip all > prefixes from remaining blockquote lines
  text = text.replace(/^(?:>\s*)+/gm, '');
  // Third pass: strip > after list markers (e.g., "- >text" or "- [-] >text")
  text = text.replace(/^(\s*[-*+](?:\s*\[[^\]]\])?\s*)>\s?/gm, '$1');

  // Protect escaped characters before processing Markdown
  const { text: protectedText, map: escapedCharsMap } =
    protectEscapedChars(text);

  // Remove code blocks before other processing (important for tildes before strikethrough)
  let result = removeCodeBlocks(protectedText);

  // Cut comments before any other pattern runs — nothing inside one renders.
  // The scanner classifies code itself, so it must see the real backticks: only
  // openers are code-aware, and a closer written inside a code span still closes
  // the comment. Masking spans first would hide those closers from it.
  result = scanOpaque(result).cutComments();

  // Set inline code aside so its literal text is never read as Markdown syntax.
  // `scanOpaque` matched code spans against the pre-cut string while this
  // re-matches the post-cut one, so the two sets can differ — a comment ending
  // inside a span leaves that span's opening backtick unpaired and visible. That
  // mirrors how the renderer re-tokenizes what survives, and is intended.
  const { text: codeProtected, map: inlineCodeMap } = protectInlineCode(result);
  result = codeProtected;

  // Strip heading markers but keep content (requires space after #, so #hashtag is safe)
  if (options?.preserveHeadings) {
    result = result.replace(/^#{1,6}[ \t]+/gm, '');
  }

  // Apply each pattern
  markdownPatterns.forEach(({ pattern, replacement }) => {
    // Skip heading removal when preserving headings (markers already stripped above)
    if (options?.preserveHeadings && pattern === headingPattern) return;

    result = result.replace(pattern, replacement);
  });

  // Restore inline code before escapes, so escapes inside code resolve too
  result = restorePlaceholders(result, inlineCodeMap);

  // Restore escaped characters
  result = restorePlaceholders(result, escapedCharsMap);

  return result;
}

/**
 * Sanitize Markdown content for text preview display
 * @param content - Raw Markdown content
 * @param omitFirstLine - When to omit first line: "always", "ifMatchesTitle", or "never"
 * @param filename - Optional filename to compare against first line
 * @param titleValue - Optional title value to compare against first line
 * @param options - Optional text preview options (heading/newline preservation)
 * @returns Sanitized text preview (max 1000 chars)
 */
export function sanitizeForTextPreview(
  content: string,
  omitFirstLine: 'always' | 'ifMatchesTitle' | 'never' = 'ifMatchesTitle',
  filename?: string,
  titleValue?: string,
  options?: { preserveHeadings?: boolean; preserveNewlines?: boolean }
): string {
  // Remove frontmatter (supports both LF and CRLF line endings)
  const cleaned = content.replace(/^---\r?\n[\s\S]*?\r?\n---/, '').trim();
  let stripped = stripMarkdownSyntax(truncateForPreview(cleaned), {
    preserveHeadings: options?.preserveHeadings,
  });

  // Check if first line matches filename or title
  const firstLineEnd = stripped.indexOf('\n');
  const firstLine = (
    firstLineEnd !== -1 ? stripped.substring(0, firstLineEnd) : stripped
  ).trim();

  // Determine whether to omit first line based on setting
  const shouldOmit =
    omitFirstLine === 'always' ||
    (omitFirstLine === 'ifMatchesTitle' &&
      ((filename && firstLine === filename) ||
        (titleValue && firstLine === titleValue)));

  if (shouldOmit) {
    stripped =
      firstLineEnd !== -1 ? stripped.substring(firstLineEnd + 1).trim() : '';
  }

  // Normalize whitespace and remove block IDs
  let normalized: string;
  if (options?.preserveNewlines) {
    normalized = stripped
      .replace(/(^|\s)\^[a-zA-Z0-9-]+/g, '$1') // Remove block IDs
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n') // Normalize 3+ consecutive newlines to paragraph break
      .trim();
  } else {
    normalized = stripped
      .replace(/(^|\s)\^[a-zA-Z0-9-]+/g, '$1') // Remove block IDs (require whitespace/line-start before ^)
      .split(/\s+/)
      .filter((word) => word)
      .join(' ')
      .trim();
  }

  // Truncate to 1000 characters (using spread to handle surrogate pairs correctly)
  const chars = [...normalized];
  if (chars.length > 1000) {
    return chars.slice(0, 1000).join('').trimEnd() + '…';
  }
  return normalized;
}

/**
 * Load text preview for a file
 * Handles property extraction and content fallback
 * @param file - TFile to load preview for
 * @param app - Obsidian App instance
 * @param propertyValue - Value from text preview property (if any)
 * @param settings - Text preview settings (fallback behavior, omit first line)
 * @param fileName - File name for first line comparison
 * @param titleValue - Title property value for first line comparison
 * @returns Preview text (empty string if none available)
 */
export async function loadNotePreview(
  file: TFile,
  app: App,
  propertyValue: unknown,
  settings: {
    fallbackToContent: boolean;
    omitFirstLine: 'always' | 'ifMatchesTitle' | 'never';
    preserveHeadings?: boolean;
    preserveNewlines?: boolean;
  },
  fileName?: string,
  titleValue?: string
): Promise<string> {
  // Check if property value is valid
  const hasValidDesc =
    propertyValue != null &&
    (typeof propertyValue === 'string' || typeof propertyValue === 'number') &&
    String(propertyValue).trim().length > 0;

  if (hasValidDesc) {
    return String(propertyValue).trim();
  }

  // Fallback to content if enabled
  if (settings.fallbackToContent) {
    const content = await app.vault.cachedRead(file);
    return sanitizeForTextPreview(
      content,
      settings.omitFirstLine,
      fileName,
      titleValue,
      {
        preserveHeadings: settings.preserveHeadings,
        preserveNewlines: settings.preserveNewlines,
      }
    );
  }

  return '';
}
