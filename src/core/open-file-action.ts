/**
 * Body classes for the open file action.
 *
 * The setting is read by CSS, not JS, so it travels as a body class. Popout
 * windows have their own document and inherit nothing, which is why every
 * mutation here takes the full document list rather than assuming `document`.
 */

const OPEN_ON_CARD_CLASS = 'dynamic-views-open-on-card';

/** Set on `.view-header` taps to decide whether a card image is interactive */
export const OPEN_ON_TITLE_CLASS = 'dynamic-views-open-on-title';

const OPEN_ON_CLASSES = [OPEN_ON_CARD_CLASS, OPEN_ON_TITLE_CLASS] as const;

/** Replace the open file action class across every document */
export function applyOpenFileActionClass(
  docs: Document[],
  openOnTitle: boolean
): void {
  const cls = openOnTitle ? OPEN_ON_TITLE_CLASS : OPEN_ON_CARD_CLASS;
  for (const doc of docs) {
    doc.body.classList.remove(...OPEN_ON_CLASSES);
    doc.body.classList.add(cls);
  }
}

/** Drop both open file action classes across every document */
export function removeOpenFileActionClasses(docs: Document[]): void {
  for (const doc of docs) {
    doc.body.classList.remove(...OPEN_ON_CLASSES);
  }
}
