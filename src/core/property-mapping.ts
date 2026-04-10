/**
 * Property name mapping utilities
 * Builds bidirectional maps between display names and syntax names
 */

import type { BasesViewConfig, BasesPropertyId } from 'obsidian';

/**
 * Hardcoded fallback map: display name → syntax name
 */
export const DEFAULT_DISPLAY_TO_SYNTAX: Record<string, string> = {
  'file name': 'file.name',
  'file backlinks': 'file.backlinks',
  'file base name': 'file.basename',
  'created time': 'file.ctime',
  'file embeds': 'file.embeds',
  'file extension': 'file.ext',
  folder: 'file.folder',
  'file full name': 'file.fullname',
  'file links': 'file.links',
  'modified time': 'file.mtime',
  'file path': 'file.path',
  'file size': 'file.size',
  'file tags': 'file.tags',
};

/**
 * Build reverse lookup map from documented Bases API
 * Uses BasesViewConfig.getDisplayName() (since 1.10.0) and BasesView.allProperties (since 1.10.0)
 * Returns displayName → syntaxName mapping, including custom user-set display names
 */
export function buildDisplayToSyntaxMap(
  config: BasesViewConfig,
  allProperties: BasesPropertyId[]
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const propertyId of allProperties) {
    const displayName = config.getDisplayName(propertyId);
    if (displayName) {
      map[displayName] = propertyId;
    }
  }
  return map;
}

/**
 * Build forward lookup map: syntaxName → displayName
 * Used by getPropertyDisplayName to show user-facing display names on cards
 */
export function buildSyntaxToDisplayMap(
  config: BasesViewConfig,
  allProperties: BasesPropertyId[]
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const propertyId of allProperties) {
    const displayName = config.getDisplayName(propertyId);
    if (displayName) {
      map[propertyId] = displayName;
    }
  }
  return map;
}
