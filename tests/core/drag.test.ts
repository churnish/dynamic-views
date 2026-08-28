import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { App } from 'obsidian';

import {
  createCardDragHandler,
  createExternalLinkDragHandler,
  createTagDragHandler,
  createUrlButtonDragHandlers,
} from '../../src/core/drag';
import { setInteractSource } from '../../src/core/hover-and-touch';

/** Minimal App stand-in — only dragManager is reached by the drag factories. */
function makeApp(): App {
  return {
    dragManager: {
      onDragStart: vi.fn(),
      dragLink: vi.fn(() => ({ type: 'link' })),
      draggable: {},
      ghostEl: null,
    },
  } as unknown as App;
}

/**
 * jsdom implements no DragEvent, so a plain Event carries a stub DataTransfer.
 * `currentTarget` is defined explicitly too — jsdom only populates it during a
 * real dispatch, and these handlers are invoked directly.
 */
function makeDragEventOn(el: HTMLElement | null): DragEvent {
  const event = new Event('dragstart', { bubbles: true });
  if (el) Object.defineProperty(event, 'currentTarget', { value: el });
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      clearData: vi.fn(),
      setData: vi.fn(),
      types: [],
      effectAllowed: '',
    },
  });
  return event as DragEvent;
}

/** A card holding both hover-derived classes, with a draggable descendant of the given class. */
function makeDragEvent(descendantClass: string): {
  card: HTMLElement;
  el: HTMLElement;
  event: DragEvent;
} {
  const card = document.createElement('div');
  card.className = 'card';
  setInteractSource(card, 'hover', true);
  card.classList.add('poster-hover-active');

  const el = document.createElement('a');
  el.className = descendantClass;
  card.appendChild(el);

  return { card, el, event: makeDragEventOn(el) };
}

describe('drag hover cleanup', () => {
  let app: App;

  beforeEach(() => {
    app = makeApp();
  });

  // A drag captures the pointer, so pointerleave never arrives. Every drag that
  // starts on an element inside the card owes the card that missing exit.
  it.each([
    ['card', (a: App) => createCardDragHandler(a, 'note.md'), 'card-title'],
    ['tag', (a: App) => createTagDragHandler(a, 'project'), 'tag'],
    [
      'property link',
      (a: App) => createExternalLinkDragHandler(a, 'Docs', 'https://x.test'),
      'external-link',
    ],
  ])('%s dragstart releases the card hover source', (_name, make, cls) => {
    const { card, event } = makeDragEvent(cls);

    make(app)(event);

    expect(card.classList.contains('interact-hover')).toBe(false);
    expect(card.classList.contains('interact')).toBe(false);
    expect(card.classList.contains('poster-hover-active')).toBe(false);
  });

  it('a drag does not release a press another source is holding', () => {
    const { card, event } = makeDragEvent('tag');
    setInteractSource(card, 'press', true);

    createTagDragHandler(app, 'project')(event);

    expect(card.classList.contains('interact-hover')).toBe(false);
    expect(card.classList.contains('interact-press')).toBe(true);
    expect(card.classList.contains('interact')).toBe(true);
  });

  it('URL button dragstart releases the hover source synchronously and poster-hover-active later', () => {
    vi.useFakeTimers();
    try {
      const { card, el } = makeDragEvent('card-title-url-icon');
      el.setCssStyles = vi.fn();

      createUrlButtonDragHandlers(app, el, 'https://x.test').onDragStart(
        makeDragEventOn(null)
      );

      expect(card.classList.contains('interact-hover')).toBe(false);
      expect(card.classList.contains('interact')).toBe(false);
      // Synchronous removal would set pointer-events: none on .card-content and
      // abort the drag, so this one stays deferred.
      expect(card.classList.contains('poster-hover-active')).toBe(true);

      vi.runAllTimers();
      expect(card.classList.contains('poster-hover-active')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
