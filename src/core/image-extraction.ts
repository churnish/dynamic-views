/**
 * Image embed extraction from file content
 * Parses wikilinks, Markdown images, YouTube links, and cardlink blocks
 */

import { App, TFile } from 'obsidian';
import { VALID_IMAGE_EXTENSIONS } from '../constants';
import { getSlideshowMaxImages } from '../utils/style-settings';
import { getYouTubeVideoId, getYouTubeThumbnailUrl } from './youtube-preview';
import { stripWikilinkSyntax, isExternalUrl } from './image';

/**
 * Maximum content size to parse for image extraction (100KB)
 */
const MAX_IMAGE_EXTRACTION_CONTENT_SIZE = 100_000;

// ============================================================================
// Code Block Detection
// ============================================================================

/**
 * Unified code range representation.
 * Used for fenced blocks, indented blocks, and inline code.
 */
interface CodeRange {
  start: number;
  end: number;
}

/**
 * Extended range for fenced code blocks with cardlink detection and content.
 */
interface FencedCodeBlock extends CodeRange {
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
function findIndentedCodeBlocks(
  lines: LineInfo[],
  fencedBlocks: FencedCodeBlock[]
): CodeRange[] {
  const ranges: CodeRange[] = [];
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
function findInlineCodeRanges(
  content: string,
  fencedBlocks: FencedCodeBlock[]
): CodeRange[] {
  const ranges: CodeRange[] = [];
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
 * This function uses <= for all ranges. Inline code ranges are already
 * constructed such that 'end' is exclusive (position of char after closing `),
 * so using < in the original was equivalent. We normalize here by checking
 * if position is at the last character of the range.
 */
function isInsideCode(
  position: number,
  fencedBlocks: FencedCodeBlock[],
  indentedBlocks: CodeRange[],
  inlineRanges: CodeRange[]
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

// ============================================================================
// Image Embed Extraction
// ============================================================================

/**
 * Regex patterns for image extraction
 */
// Wikilink embed: ![[image.png]] or ![[image.png|caption]] or ![[image.png#heading]]
const WIKILINK_EMBED_REGEX = /!\[\[([^\]|#]+)(?:[|#][^\]]*)?]]/g;

// Markdown image: ![...](url) - handles nested parentheses one level deep
const MD_IMAGE_REGEX = /!\[[^\]]*]\(((?:[^)(]|\([^)(]*\))+)\)/g;

// After extracting MD image URL, strip optional title: ![](url "title")
const MD_IMAGE_TITLE_REGEX = /\s+(?:"[^"]*"|'[^']*'|\([^)]*\))\s*$/;

// Auto Card Link image field (inside cardlink code blocks)
const CARDLINK_IMAGE_REGEX = /^image:\s*(.+?)\s*$/im;

/**
 * Represents an embed found in content
 */
interface EmbedMatch {
  type: 'wikilink' | 'markdown' | 'cardlink';
  path: string;
  position: number;
}

/**
 * Extract image embeds from file content
 * Parses wikilinks, Markdown images, YouTube links, and cardlink blocks
 *
 * @param file - TFile to extract embeds from
 * @param app - Obsidian App instance
 * @param options - Extraction options
 * @returns Array of validated image resource URLs in document order
 */
export async function extractImageEmbeds(
  file: TFile,
  app: App,
  options?: {
    includeYoutube?: boolean;
    includeCardLink?: boolean;
  }
): Promise<string[]> {
  const includeYoutube = options?.includeYoutube ?? true;
  const includeCardLink = options?.includeCardLink ?? true;
  const maxImages = getSlideshowMaxImages();

  // Read and truncate content at line boundary to avoid splitting wikilinks
  let content = await app.vault.cachedRead(file);
  if (content.length > MAX_IMAGE_EXTRACTION_CONTENT_SIZE) {
    // Find last newline before limit to avoid cutting mid-syntax
    const lastNewline = content.lastIndexOf(
      '\n',
      MAX_IMAGE_EXTRACTION_CONTENT_SIZE
    );
    content = content.slice(
      0,
      lastNewline !== -1 ? lastNewline : MAX_IMAGE_EXTRACTION_CONTENT_SIZE
    );
  }

  // Strip frontmatter (handle both Unix \n and Windows \r\n newlines)
  if (content.startsWith('---\n') || content.startsWith('---\r\n')) {
    // Match either newline style for frontmatter end
    const frontmatterEndUnix = content.indexOf('\n---\n', 4);
    const frontmatterEndWin = content.indexOf('\r\n---\r\n', 4);
    // Use whichever is found first (or -1 if neither)
    let frontmatterEnd = -1;
    let skipLength = 0;
    if (
      frontmatterEndUnix !== -1 &&
      (frontmatterEndWin === -1 || frontmatterEndUnix < frontmatterEndWin)
    ) {
      frontmatterEnd = frontmatterEndUnix;
      skipLength = 5; // \n---\n
    } else if (frontmatterEndWin !== -1) {
      frontmatterEnd = frontmatterEndWin;
      skipLength = 7; // \r\n---\r\n
    }
    if (frontmatterEnd !== -1) {
      content = content.slice(frontmatterEnd + skipLength);
    }
  }

  // Parse lines once for all code detection passes
  const lines = parseLines(content);

  // Find all fenced code blocks (``` or ~~~)
  const fencedBlocks = findFencedCodeBlocks(content, lines);

  // Find all indented code blocks (requires preceding blank line per CommonMark)
  const indentedBlocks = findIndentedCodeBlocks(lines, fencedBlocks);

  // Find all inline code ranges (excludes fenced blocks)
  const inlineRanges = findInlineCodeRanges(content, fencedBlocks);

  // Collect all embeds with positions
  const embeds: EmbedMatch[] = [];

  // Extract cardlink images first
  if (includeCardLink) {
    for (const block of fencedBlocks) {
      if (block.isCardlink) {
        const match = CARDLINK_IMAGE_REGEX.exec(block.content);
        if (match) {
          let imagePath = match[1].trim();
          // Remove surrounding quotes if present
          if (
            (imagePath.startsWith('"') && imagePath.endsWith('"')) ||
            (imagePath.startsWith("'") && imagePath.endsWith("'"))
          ) {
            imagePath = imagePath.slice(1, -1);
          }
          // Strip wikilink syntax if present
          imagePath = stripWikilinkSyntax(imagePath);
          if (imagePath) {
            embeds.push({
              type: 'cardlink',
              path: imagePath,
              position: block.start,
            });
          }
        }
      }
    }
  }

  // Extract wikilink embeds
  for (const match of content.matchAll(WIKILINK_EMBED_REGEX)) {
    const position = match.index;
    if (!isInsideCode(position, fencedBlocks, indentedBlocks, inlineRanges)) {
      embeds.push({
        type: 'wikilink',
        path: match[1].trim(),
        position,
      });
    }
  }

  // Extract Markdown image embeds
  for (const match of content.matchAll(MD_IMAGE_REGEX)) {
    const position = match.index;
    if (!isInsideCode(position, fencedBlocks, indentedBlocks, inlineRanges)) {
      // Strip optional title from URL
      let url = match[1].trim().replace(MD_IMAGE_TITLE_REGEX, '');
      // Decode URL-encoded characters (e.g., %20 -> space) for local paths
      if (!isExternalUrl(url)) {
        try {
          url = decodeURIComponent(url);
        } catch {
          // Keep original if decode fails
        }
      }
      embeds.push({
        type: 'markdown',
        path: url,
        position,
      });
    }
  }

  // Sort by position (document order)
  embeds.sort((a, b) => a.position - b.position);

  // Deduplicate by path
  const seenPaths = new Set<string>();
  const uniqueEmbeds = embeds.filter((e) => {
    if (seenPaths.has(e.path)) return false;
    seenPaths.add(e.path);
    return true;
  });

  // Process embeds and resolve to URLs
  const resultUrls: string[] = [];

  for (const embed of uniqueEmbeds) {
    if (resultUrls.length >= maxImages) break;

    const path = embed.path;

    if (isExternalUrl(path)) {
      // Check for YouTube - skip if it's a YouTube URL (video page, not image)
      const videoId = getYouTubeVideoId(path);
      if (videoId) {
        if (includeYoutube) {
          const thumbnailUrl = await getYouTubeThumbnailUrl(videoId);
          if (thumbnailUrl) {
            resultUrls.push(thumbnailUrl);
          }
        }
        // Skip raw YouTube URLs - they're not images
        continue;
      }

      resultUrls.push(path);
    } else {
      // Internal path - resolve via metadata cache
      const targetFile = app.metadataCache.getFirstLinkpathDest(
        path,
        file.path
      );
      if (targetFile && VALID_IMAGE_EXTENSIONS.includes(targetFile.extension)) {
        const resourcePath = app.vault.getResourcePath(targetFile);
        resultUrls.push(resourcePath);
      }
    }
  }

  return resultUrls;
}
