/**
 * Query processing and code block synchronization utilities
 */

// ============= Query Processing =============

export function hasPageSelector(query: string): boolean {
  return /@page\b/i.test(query.trim());
}

export function ensurePageSelector(query: string): string {
  const trimmed = query.trim();
  if (!trimmed || hasPageSelector(trimmed)) {
    return trimmed;
  }
  return `@page and (${trimmed})`;
}

// ============= Code Block Sync =============

export interface QueryMatch {
  query: string;
  fullMatch: string;
  startIndex: number;
  endIndex: number;
}

/**
 * Find query between DQL QUERY START/END markers
 */
export function findQueryInBlock(content: string): QueryMatch | null {
  const pattern = /\/\/\s*–+\s*DQL QUERY START\s*–+\s*\n([\s\S]*?)\n\s*\/\/\s*–+\s*DQL QUERY END\s*–+/;
  const match = content.match(pattern);

  if (!match) {
    return null;
  }

  return {
    query: match[1].trim(),
    fullMatch: match[0],
    startIndex: match.index!,
    endIndex: match.index! + match[0].length
  };
}

/**
 * Update query between DQL markers
 */
export function updateQueryInBlock(content: string, newQuery: string): string {
  const queryMatch = findQueryInBlock(content);

  if (!queryMatch) {
    console.warn('Could not find DQL QUERY markers');
    return content;
  }

  const { startIndex, endIndex } = queryMatch;

  const replacement = `// ––––– DQL QUERY START –––––
${newQuery}
// ––––– DQL QUERY END –––––`;

  return content.substring(0, startIndex) + replacement + content.substring(endIndex);
}
