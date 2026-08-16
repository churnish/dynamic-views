/**
 * Body classes for the open file action.
 *
 * The setting is read by CSS, not JS, so it travels as a body class. Popout
 * windows have their own document and inherit nothing, which is why every
 * mutation here takes the full document list rather than assuming `document`.
 */

import type { PluginSettings } from '../types';

const OPEN_ON_CLASSES = [
  'dynamic-views-open-on-card',
  'dynamic-views-open-on-title',
] as const;

/** Set on `.view-header` taps to decide whether a card image is interactive */
export const OPEN_ON_TITLE_CLASS = 'dynamic-views-open-on-title';

/** Replace the open file action class across every document */
export function applyOpenFileActionClass(
  docs: Document[],
  action: PluginSettings['openFileAction']
): void {
  for (const doc of docs) {
    doc.body.classList.remove(...OPEN_ON_CLASSES);
    doc.body.classList.add(`dynamic-views-open-on-${action}`);
  }
}

/** Drop both open file action classes across every document */
export function removeOpenFileActionClasses(docs: Document[]): void {
  for (const doc of docs) {
    doc.body.classList.remove(...OPEN_ON_CLASSES);
  }
}
