import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupSelectionScoping } from '../../src/core/text-selection';

/** Stub the document selection — jsdom cannot produce a real extended range. */
function stubSelection(collapsed: boolean): void {
  vi.spyOn(document, 'getSelection').mockReturnValue({
    isCollapsed: collapsed,
    rangeCount: collapsed ? 0 : 1,
  } as unknown as Selection);
}

function buildContainer(cardCount = 2): {
  container: HTMLElement;
  cards: HTMLElement[];
} {
  const container = document.createElement('div');
  container.className = 'dynamic-views dynamic-views-bases-container';
  const cards: HTMLElement[] = [];
  for (let i = 0; i < cardCount; i++) {
    const card = document.createElement('div');
    card.className = 'card';
    const text = document.createElement('span');
    text.className = 'card-text-preview-text';
    card.appendChild(text);
    container.appendChild(card);
    cards.push(card);
  }
  document.body.appendChild(container);
  return { container, cards };
}

function pointerDownOn(el: Element): void {
  el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
}

function fireSelectionChange(): void {
  document.dispatchEvent(new Event('selectionchange'));
}

describe('setupSelectionScoping', () => {
  let scoping: ReturnType<typeof setupSelectionScoping> | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    scoping?.cleanup();
    scoping = null;
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('marks the origin card once the selection extends', () => {
    const { container, cards } = buildContainer();
    scoping = setupSelectionScoping(() => container);

    pointerDownOn(cards[0].firstElementChild!);
    stubSelection(false);
    fireSelectionChange();

    expect(container.classList.contains('is-selecting-text')).toBe(true);
    expect(cards[0].classList.contains('is-selection-origin')).toBe(true);
    expect(cards[1].classList.contains('is-selection-origin')).toBe(false);
  });

  it('does not mark anything on a plain click', () => {
    const { container, cards } = buildContainer();
    scoping = setupSelectionScoping(() => container);

    // pointerdown collapses the selection and fires selectionchange — the
    // expensive class toggle must not run for it.
    pointerDownOn(cards[0]);
    stubSelection(true);
    fireSelectionChange();

    expect(container.classList.contains('is-selecting-text')).toBe(false);
    expect(cards[0].classList.contains('is-selection-origin')).toBe(false);
  });

  it('ignores cards outside the container', () => {
    const { container } = buildContainer();
    const foreign = document.createElement('div');
    foreign.className = 'card';
    document.body.appendChild(foreign);
    scoping = setupSelectionScoping(() => container);

    pointerDownOn(foreign);
    stubSelection(false);
    fireSelectionChange();

    expect(container.classList.contains('is-selecting-text')).toBe(false);
    expect(foreign.classList.contains('is-selection-origin')).toBe(false);
  });

  it('clears marks when the selection collapses', () => {
    const { container, cards } = buildContainer();
    scoping = setupSelectionScoping(() => container);

    pointerDownOn(cards[0]);
    stubSelection(false);
    fireSelectionChange();

    stubSelection(true);
    fireSelectionChange();

    expect(container.classList.contains('is-selecting-text')).toBe(false);
    expect(cards[0].classList.contains('is-selection-origin')).toBe(false);
  });

  it('re-arms on a new card after a previous selection was marked', () => {
    const { container, cards } = buildContainer();
    scoping = setupSelectionScoping(() => container);

    pointerDownOn(cards[0]);
    stubSelection(false);
    fireSelectionChange();

    // New drag on card 1 — pointerdown collapses the old selection first.
    pointerDownOn(cards[1]);
    stubSelection(true);
    fireSelectionChange();
    stubSelection(false);
    fireSelectionChange();

    expect(cards[0].classList.contains('is-selection-origin')).toBe(false);
    expect(cards[1].classList.contains('is-selection-origin')).toBe(true);
  });

  it('cleanup detaches listeners and clears marks', () => {
    const { container, cards } = buildContainer();
    scoping = setupSelectionScoping(() => container);

    pointerDownOn(cards[0]);
    stubSelection(false);
    fireSelectionChange();

    scoping.cleanup();
    scoping = null;

    expect(container.classList.contains('is-selecting-text')).toBe(false);
    expect(cards[0].classList.contains('is-selection-origin')).toBe(false);

    // Listeners gone — a further drag must not re-mark
    pointerDownOn(cards[0]);
    fireSelectionChange();
    expect(container.classList.contains('is-selecting-text')).toBe(false);
  });

  it('pointerup disarms so a later selectionchange does not mark', () => {
    const { container, cards } = buildContainer();
    scoping = setupSelectionScoping(() => container);

    pointerDownOn(cards[0]);
    document.dispatchEvent(new Event('pointerup'));
    stubSelection(false);
    fireSelectionChange();

    expect(container.classList.contains('is-selecting-text')).toBe(false);
  });
});
