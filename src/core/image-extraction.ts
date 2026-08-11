/**
 * Image embed extraction from file content
 * Parses wikilinks, Markdown images, YouTube links, and cardlink blocks
 */

import { App, TFile } from 'obsidian';
import { VALID_IMAGE_EXTENSIONS } from '../constants';
import { getSlideshowMaxImages } from '../utils/style-settings';
import { getYouTubeVideoId, getYouTubeThumbnailUrl } from './youtube-preview';
import { stripWikilinkSyntax, isExternalUrl, WIKILINK_TARGET } from './image';
import {
  parseLines,
  findFencedCodeBlocks,
  findIndentedCodeBlocks,
  findInlineCodeRanges,
  isInsideCode,
  findCommentRanges,
  isInsideRange,
} from './markdown-ranges';

/**
 * Maximum content size to parse for image extraction (100KB)
 */
const MAX_IMAGE_EXTRACTION_CONTENT_SIZE = 100_000;

/**
 * Regex patterns for image extraction
 */
// Wikilink embed: ![[image.png]] or ![[image.png|caption]] or ![[image.png#heading]]
const WIKILINK_EMBED_REGEX = new RegExp(
  String.raw`!\[\[${WIKILINK_TARGET}]]`,
  'g'
);

// Markdown image: ![...](url) - alt text and URL each allow one level of nesting
const MD_IMAGE_REGEX = /!\[(?:[^[\]]|\[[^[\]]*])*]\(((?:[^)(]|\([^)(]*\))+)\)/g;

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

  const isInCode = (position: number) =>
    isInsideCode(position, fencedBlocks, indentedBlocks, inlineRanges);

  // Find commented-out ranges — their embeds never render, so they aren't card images.
  // Cardlink blocks are exempt from isInCode so their image field can be parsed, but a
  // delimiter in a cardlink title or description is still literal text: without this,
  // a `%%` in one opens a comment that never closes and hides every image after it.
  const commentRanges = findCommentRanges(
    content,
    (position) =>
      isInCode(position) ||
      fencedBlocks.some((b) => position >= b.start && position <= b.end)
  );

  const isSkipped = (position: number) =>
    isInCode(position) || isInsideRange(position, commentRanges);

  // Collect all embeds with positions
  const embeds: EmbedMatch[] = [];

  // Extract cardlink images first
  if (includeCardLink) {
    for (const block of fencedBlocks) {
      if (block.isCardlink && !isInsideRange(block.start, commentRanges)) {
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
    if (!isSkipped(position)) {
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
    if (!isSkipped(position)) {
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
