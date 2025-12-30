import { App, TFile } from "obsidian";
import { getSlideshowMaxImages } from "./style-settings";

/**
 * Maximum content size to parse for image extraction (100KB)
 */
const MAX_IMAGE_EXTRACTION_CONTENT_SIZE = 100_000;

/**
 * Valid image file extensions supported by the plugin
 */
export const VALID_IMAGE_EXTENSIONS: string[] = [
  "avif",
  "bmp",
  "gif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
];

/**
 * Check if a URL is an external HTTP/HTTPS URL
 * @param url - The URL to check
 * @returns true if URL starts with http:// or https://
 */
export function isExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

// Generate regex from VALID_IMAGE_EXTENSIONS to ensure they stay in sync
// Combines jpeg/jpg as jpe?g for efficiency (order-independent)
const IMAGE_EXTENSION_REGEX = new RegExp(
  `\\.(${VALID_IMAGE_EXTENSIONS.filter((e) => e !== "jpeg" && e !== "jpg")
    .concat(["jpe?g"])
    .join("|")})$`,
  "i",
);

/**
 * Check if a path has a valid image file extension
 * @param path - The file path or URL to check
 * @returns true if path ends with a valid image extension
 */
function hasValidImageExtension(path: string): boolean {
  return IMAGE_EXTENSION_REGEX.test(path);
}

/**
 * Strip wikilink syntax from image path
 * Handles: [[path]], ![[path]], [[path|caption]], [[path#heading]], [[path#^block]]
 * @param path - Path that may contain wikilink syntax
 * @returns Clean path without wikilink markers, fragments, or captions; empty string if null/undefined
 */
export function stripWikilinkSyntax(path: string | null | undefined): string {
  if (!path) return "";
  // Trim before matching - wikilinks may have surrounding whitespace
  const trimmed = path.trim();
  // Capture path before any | (caption) or # (fragment/heading/block)
  const wikilinkMatch = trimmed.match(/^!?\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/);
  return wikilinkMatch ? wikilinkMatch[1].trim() : trimmed;
}

/**
 * Process and validate image paths from property values
 * Handles wikilink stripping, URL validation, and path separation
 * @param imagePaths - Raw image paths from properties (may contain wikilinks)
 * @returns Object with validated internal paths and external URLs
 */
export function processImagePaths(imagePaths: string[]): {
  internalPaths: string[];
  externalUrls: string[];
} {
  const internalPaths: string[] = [];
  const externalUrls: string[] = [];

  for (const imgPath of imagePaths) {
    // Strip wikilink syntax
    const cleanPath = stripWikilinkSyntax(imgPath);

    // Skip empty or whitespace-only paths
    if (cleanPath.trim().length === 0) continue;

    if (isExternalUrl(cleanPath)) {
      // Skip YouTube video URLs (not images) - thumbnails extracted from embeds only
      if (getYouTubeVideoId(cleanPath)) {
        continue;
      }
      // External URL - pass through without validation
      // Browser handles load/error at render time for faster initial display
      externalUrls.push(cleanPath);
    } else {
      // Internal path - validate extension upfront for explicit paths
      // Extension-less wikilinks like ![[photo]] handled at resolution time
      if (hasValidImageExtension(cleanPath)) {
        internalPaths.push(cleanPath);
      }
    }
  }

  return { internalPaths, externalUrls };
}

/**
 * Convert internal image paths to resource URLs
 * @param internalPaths - Array of internal file paths
 * @param sourcePath - Path of the source file (for link resolution)
 * @param app - Obsidian App instance
 * @returns Array of resource URLs
 */
export function resolveInternalImagePaths(
  internalPaths: string[],
  sourcePath: string,
  app: App,
): string[] {
  const resourcePaths: string[] = [];

  for (const propPath of internalPaths) {
    const imageFile = app.metadataCache.getFirstLinkpathDest(
      propPath,
      sourcePath,
    );
    if (imageFile && VALID_IMAGE_EXTENSIONS.includes(imageFile.extension)) {
      const resourcePath = app.vault.getResourcePath(imageFile);
      resourcePaths.push(resourcePath);
    }
  }

  return resourcePaths;
}

// ============================================================================
// YouTube Thumbnail Extraction
// ============================================================================

/**
 * YouTube thumbnail quality levels in order of preference
 */
const YOUTUBE_THUMBNAIL_QUALITIES = [
  "maxresdefault", // 1280x720
  "hqdefault", // 480x360
  "mqdefault", // 320x180
];

/**
 * Extract YouTube video ID from a URL
 * Supports: youtube.com/watch?v=, youtu.be/, youtube.com/embed/, youtube.com/shorts/
 */
export function getYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^(www\.|m\.)/, "");

    if (host === "youtu.be") {
      const id = parsed.pathname.slice(1); // /VIDEO_ID
      return id || null; // Return null for empty ID (e.g., youtu.be/)
    }
    if (host === "youtube.com") {
      // /watch?v=ID, /embed/ID, /shorts/ID, /v/ID
      if (parsed.searchParams.has("v")) return parsed.searchParams.get("v");
      const segments = parsed.pathname.split("/");
      // Check segment exists (length check handles edge case of ID "0")
      if (
        ["embed", "shorts", "v"].includes(segments[1]) &&
        segments.length > 2
      ) {
        return segments[2] || null; // Return null if empty segment
      }
    }
  } catch {
    /* invalid URL */
  }
  return null;
}

/**
 * Minimum width for valid YouTube thumbnail.
 * mqdefault (lowest quality we try) is 320px wide.
 * Placeholders are typically 120px wide.
 */
const MIN_THUMBNAIL_WIDTH = 320;

/**
 * Validate YouTube thumbnail URL and check it's not a placeholder
 */
function validateYouTubeThumbnail(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    let resolved = false;
    const cleanup = (result: boolean) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);
      img.onload = null;
      img.onerror = null;
      img.src = "";
      resolve(result);
    };
    img.onload = () => cleanup(img.naturalWidth >= MIN_THUMBNAIL_WIDTH);
    img.onerror = () => cleanup(false);
    const timeoutId = setTimeout(() => cleanup(false), 5000);
    img.src = url;
  });
}

/**
 * Get YouTube thumbnail URL with fallback through quality levels
 * Returns null if video has no thumbnail (only placeholder available)
 */
export async function getYouTubeThumbnailUrl(
  videoId: string,
): Promise<string | null> {
  for (const quality of YOUTUBE_THUMBNAIL_QUALITIES) {
    const url = `https://img.youtube.com/vi/${videoId}/${quality}.jpg`;
    if (await validateYouTubeThumbnail(url)) {
      return url;
    }
  }
  return null;
}

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

  for (const text of content.split("\n")) {
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
  lines: LineInfo[],
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
      const infoString = fenceMatch[3]?.trim() || "";
      const language = infoString.split(/\s+/)[0]?.toLowerCase() || "";

      if (!currentBlock) {
        // Opening fence
        currentBlock = {
          start: line.start,
          fenceChar,
          fenceLength,
          isCardlink: language === "cardlink" || language === "embed",
          contentStart: line.end + 1,
        };
      } else if (
        fenceChar === currentBlock.fenceChar &&
        fenceLength === currentBlock.fenceLength &&
        infoString === "" // Per CommonMark, closing fence must have no content
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
  fencedBlocks: FencedCodeBlock[],
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

    const isEmpty = line.text.trim() === "";
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
  fencedBlocks: FencedCodeBlock[],
): CodeRange[] {
  const ranges: CodeRange[] = [];
  // Reset regex lastIndex (global flag maintains state across calls)
  INLINE_CODE_REGEX.lastIndex = 0;

  for (const match of content.matchAll(INLINE_CODE_REGEX)) {
    const start = match.index;
    const end = start + match[0].length;
    // Exclude if inside any fenced block (including cardlink)
    const insideFenced = fencedBlocks.some(
      (b) => start >= b.start && start <= b.end,
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
  inlineRanges: CodeRange[],
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
  type: "wikilink" | "markdown" | "cardlink";
  path: string;
  position: number;
}

/**
 * Extract image embeds from file content
 * Parses wikilinks, markdown images, YouTube links, and cardlink blocks
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
  },
): Promise<string[]> {
  const includeYoutube = options?.includeYoutube ?? true;
  const includeCardLink = options?.includeCardLink ?? true;
  const maxImages = getSlideshowMaxImages();

  // Read and truncate content at line boundary to avoid splitting wikilinks
  let content = await app.vault.cachedRead(file);
  if (content.length > MAX_IMAGE_EXTRACTION_CONTENT_SIZE) {
    // Find last newline before limit to avoid cutting mid-syntax
    const lastNewline = content.lastIndexOf(
      "\n",
      MAX_IMAGE_EXTRACTION_CONTENT_SIZE,
    );
    content = content.slice(
      0,
      lastNewline !== -1 ? lastNewline : MAX_IMAGE_EXTRACTION_CONTENT_SIZE,
    );
  }

  // Strip frontmatter (handle both Unix \n and Windows \r\n newlines)
  if (content.startsWith("---\n") || content.startsWith("---\r\n")) {
    // Match either newline style for frontmatter end
    const frontmatterEndUnix = content.indexOf("\n---\n", 4);
    const frontmatterEndWin = content.indexOf("\r\n---\r\n", 4);
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
              type: "cardlink",
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
        type: "wikilink",
        path: match[1].trim(),
        position,
      });
    }
  }

  // Extract markdown image embeds
  for (const match of content.matchAll(MD_IMAGE_REGEX)) {
    const position = match.index;
    if (!isInsideCode(position, fencedBlocks, indentedBlocks, inlineRanges)) {
      // Strip optional title from URL
      const url = match[1].trim().replace(MD_IMAGE_TITLE_REGEX, "");
      embeds.push({
        type: "markdown",
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

      // Regular external URL - pass through without validation
      resultUrls.push(path);
    } else {
      // Internal path - resolve via metadata cache
      const targetFile = app.metadataCache.getFirstLinkpathDest(
        path,
        file.path,
      );
      if (targetFile && VALID_IMAGE_EXTENSIONS.includes(targetFile.extension)) {
        const resourcePath = app.vault.getResourcePath(targetFile);
        resultUrls.push(resourcePath);
      }
    }
  }

  return resultUrls;
}
