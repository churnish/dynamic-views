/** Confines drag text selection to the card it started in. */

const SELECTING_CLASS = 'is-selecting-text';
const ORIGIN_CLASS = 'is-selection-origin';

export interface SelectionScoping {
  cleanup: () => void;
  reattach: () => void;
}

/**
 * Marks the card a text selection started in, so CSS can block selection on
 * every other card (counterparts in styles/_text-selection.scss). Without this,
 * a drag that leaves the origin card keeps extending across neighbours and
 * produces a selection spanning unrelated notes.
 *
 * The marker classes are applied only once the selection actually extends, not
 * on pointerdown — `.card:not(.is-selection-origin) *` invalidates styles for
 * every card and descendant, which is too expensive to pay on every click.
 */
export function setupSelectionScoping(
  getContainerRef: () => HTMLElement | null
): SelectionScoping {
  // Armed target from pointerdown, kept separate from the element currently
  // carrying the class: pointerdown collapses the selection and fires a
  // `selectionchange` right after, which must not wipe the fresh arm.
  let armedCard: HTMLElement | null = null;
  let markedCard: HTMLElement | null = null;
  let markedContainer: HTMLElement | null = null;

  const clearMarks = (): void => {
    if (!markedCard) return;
    markedCard.classList.remove(ORIGIN_CLASS);
    markedContainer?.classList.remove(SELECTING_CLASS);
    markedCard = null;
    markedContainer = null;
  };

  const handlePointerDown = (e: PointerEvent): void => {
    const container = getContainerRef();
    const card = (e.target as HTMLElement | null)?.closest<HTMLElement>(
      '.card'
    );
    // Arm only for cards in OUR container — when several views are open they
    // all listen on the same document.
    armedCard = card && container?.contains(card) ? card : null;
  };

  const handlePointerUp = (): void => {
    armedCard = null;
  };

  const handleSelectionChange = (): void => {
    const container = getContainerRef();
    if (!container) return;

    const selection = container.ownerDocument.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      clearMarks();
      return;
    }

    if (markedCard || !armedCard) return;

    markedCard = armedCard;
    markedContainer = container;
    markedCard.classList.add(ORIGIN_CLASS);
    container.classList.add(SELECTING_CLASS);
  };

  // Deferred attach — the container ref is null at init. Polls until mounted,
  // then binds to the owning document so popout windows get their own
  // listeners (see docs/patterns/popout-window-safety.md).
  let listenerDoc: Document | null = null;
  let timeoutId: number | null = null;

  const detach = (): void => {
    if (!listenerDoc) return;
    listenerDoc.removeEventListener('pointerdown', handlePointerDown);
    listenerDoc.removeEventListener('pointerup', handlePointerUp);
    listenerDoc.removeEventListener('pointercancel', handlePointerUp);
    listenerDoc.removeEventListener('selectionchange', handleSelectionChange);
    listenerDoc = null;
  };

  const attach = (): void => {
    const doc = getContainerRef()?.ownerDocument ?? document;
    if (listenerDoc === doc) return;
    detach();
    doc.addEventListener('pointerdown', handlePointerDown);
    doc.addEventListener('pointerup', handlePointerUp);
    doc.addEventListener('pointercancel', handlePointerUp);
    doc.addEventListener('selectionchange', handleSelectionChange);
    listenerDoc = doc;
  };

  const waitForContainer = (): void => {
    if (getContainerRef()) {
      attach();
    } else {
      timeoutId = window.setTimeout(waitForContainer, 0);
    }
  };
  waitForContainer();

  return {
    cleanup: () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      detach();
      clearMarks();
    },
    reattach: attach,
  };
}
