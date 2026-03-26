/**
 * Link parser utility for property values
 * Handles all frontmatter link types from obsidian-frontmatter-markdown-links
 */

export interface ParsedLink {
  type: 'internal' | 'external';
  url: string;
  caption: string;
  isEmbed: boolean;
  isWebUrl: boolean; // true for http/https, false for custom URIs like obsidian://
  isMarkdownLink: boolean; // true for [text](url) format, false for bare/angle-bracket URLs
}

/**
 * Check if URL is a web URL (http:// or https://)
 */
function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * Check if URL has any URI scheme (protocol://)
 */
export function hasUriScheme(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
}

/**
 * Decode URL-encoded path and remove angle brackets if present
 */
function normalizePath(path: string): string {
  // Remove angle brackets if present
  if (path.startsWith('<') && path.endsWith('>')) {
    path = path.slice(1, -1);
  }
  // Decode URL-encoded characters
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * Segment of text that is either plain text or a link
 */
export type TextSegment =
  | { type: 'text'; content: string }
  | { type: 'link'; link: ParsedLink; raw: string };

/**
 * Strip trailing punctuation from plain URLs
 * Returns [cleanUrl, trailingPunctuation]
 */
function stripTrailingPunctuation(url: string): [string, string] {
  // Common sentence-ending punctuation that's unlikely to be part of URL
  const match = url.match(/^(.+?)([.,;:!?]+)$/);
  if (match) {
    return [match[1], match[2]];
  }
  return [url, ''];
}

/**
 * Find all links within text and return segments
 * Handles mixed content like "hello [[World]] and https://example.com"
 *
 * Capture groups:
 * 1-2: embedded wikilink (path, alias)
 * 3-4: wikilink (path, alias)
 * 5-7: embedded markdown (caption, angle path, regular path)
 * 8-10: markdown link (caption, angle path, regular path)
 * 11: angle bracket URL
 * 12: plain URL
 */
export function findLinksInText(text: string): TextSegment[] {
  const segments: TextSegment[] = [];

  // Combined pattern to match all link types (non-anchored)
  const linkPattern =
    /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|!\[([^\]]*)\]\((?:<([^>]+)>|([^)]+))\)|\[([^\]]+)\]\((?:<([^>]+)>|([^)]+))\)|<([a-z][a-z0-9+.-]*:\/\/[^>]+)>|([a-z][a-z0-9+.-]*:\/\/[^\s<>[\]()]+)/gi;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(text)) !== null) {
    // Add text before this match
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        content: text.slice(lastIndex, match.index),
      });
    }

    const rawMatch = match[0];
    let parsed: ParsedLink | null = null;
    let actualRaw = rawMatch;

    // Construct ParsedLink directly from capture groups
    if (match[1] !== undefined) {
      // Group 1-2: Embedded wikilink ![[path|alias]]
      parsed = {
        type: 'internal',
        url: match[1],
        caption: match[2] || match[1],
        isEmbed: true,
        isWebUrl: false,
        isMarkdownLink: false,
      };
    } else if (match[3] !== undefined) {
      // Group 3-4: Wikilink [[path|alias]]
      parsed = {
        type: 'internal',
        url: match[3],
        caption: match[4] || match[3],
        isEmbed: false,
        isWebUrl: false,
        isMarkdownLink: false,
      };
    } else if (
      match[5] !== undefined ||
      match[6] !== undefined ||
      match[7] !== undefined
    ) {
      // Group 5-7: Embedded markdown ![caption](<path>) or ![caption](path)
      const caption = match[5] || '';
      const path = normalizePath(match[6] || match[7]);
      const external = hasUriScheme(path);
      parsed = {
        type: external ? 'external' : 'internal',
        url: path,
        caption: caption || path,
        isEmbed: true,
        isWebUrl: isWebUrl(path),
        isMarkdownLink: true,
      };
    } else if (match[8] !== undefined) {
      // Group 8-10: Markdown link [caption](<path>) or [caption](path)
      const caption = match[8];
      const path = normalizePath(match[9] || match[10]);
      const external = hasUriScheme(path);
      parsed = {
        type: external ? 'external' : 'internal',
        url: path,
        caption: caption,
        isEmbed: false,
        isWebUrl: isWebUrl(path),
        isMarkdownLink: true,
      };
    } else if (match[11] !== undefined) {
      // Group 11: Angle bracket URL <scheme://url>
      const url = match[11];
      parsed = {
        type: 'external',
        url: url,
        caption: url,
        isEmbed: false,
        isWebUrl: isWebUrl(url),
        isMarkdownLink: false,
      };
    } else if (match[12] !== undefined) {
      // Group 12: Plain URL - strip trailing punctuation
      const [cleanUrl, trailing] = stripTrailingPunctuation(match[12]);
      parsed = {
        type: 'external',
        url: cleanUrl,
        caption: cleanUrl,
        isEmbed: false,
        isWebUrl: isWebUrl(cleanUrl),
        isMarkdownLink: false,
      };
      actualRaw = cleanUrl;
      // Add trailing punctuation as text after link
      if (trailing) {
        segments.push({ type: 'link', link: parsed, raw: actualRaw });
        segments.push({ type: 'text', content: trailing });
        lastIndex = match.index + rawMatch.length;
        continue;
      }
    }

    if (parsed) {
      segments.push({ type: 'link', link: parsed, raw: actualRaw });
    } else {
      // Fallback: treat as text if parsing fails
      segments.push({ type: 'text', content: rawMatch });
    }

    lastIndex = match.index + rawMatch.length;
  }

  // Add remaining text after last match
  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }

  // If no segments, return the whole text
  if (segments.length === 0) {
    segments.push({ type: 'text', content: text });
  }

  return segments;
}
