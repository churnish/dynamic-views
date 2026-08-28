/**
 * Hover-state handover across a viewer round trip.
 *
 * The viewer is not a fourth source of `.interact` — `viewer-active` makes the
 * hover-intent deactivation in shared-renderer.ts early-return, so the real
 * pointerleave is swallowed and never fires again. Closing the viewer is
 * therefore standing in for that missing exit, and it must move the hover source
 * and nothing else.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { App } from 'obsidian';
import { Platform } from 'obsidian';

import {
  handleImageViewerTrigger,
  cleanupAllViewers,
} from '../../src/core/image-viewer';
import { setInteractSource } from '../../src/core/hover-and-touch';

function makeApp(): App {
  return {
    scope: {},
    keymap: { pushScope: vi.fn(), popScope: vi.fn() },
    workspace: { openLinkText: vi.fn() },
  } as unknown as App;
}

const CARD_RECT = { left: 0, top: 0, right: 200, bottom: 200 } as DOMRect;

function stubRect(el: HTMLElement, rect: Partial<DOMRect>): void {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect);
}

/** `.card > .card-cover > img` — the cover is the embed the trigger fires on. */
function buildCard(): { card: HTMLElement; embed: HTMLElement } {
  const card = document.createElement('div');
  card.className = 'card';
  const embed = document.createElement('div');
  embed.className = 'card-cover';
  const img = document.createElement('img');
  img.setAttribute('src', 'app://local/pic.png');
  embed.appendChild(img);
  card.appendChild(embed);
  document.body.appendChild(card);
  stubRect(card, CARD_RECT);
  return { card, embed };
}

/** A click on the embed, with `currentTarget` pinned as the real listener would leave it. */
function triggerClick(embed: HTMLElement, x: number, y: number): MouseEvent {
  const e = new MouseEvent('click', { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(e, 'currentTarget', { value: embed });
  return e;
}

describe('closeImageViewer hover handover', () => {
  let app: App;
  let cleanupFns: Map<HTMLElement, () => void>;
  let clones: Map<HTMLElement, HTMLElement>;

  beforeEach(() => {
    app = makeApp();
    cleanupFns = new Map();
    clones = new Map();
    window.matchMedia = vi.fn(() => ({ matches: true })) as never;
  });

  afterEach(() => {
    cleanupAllViewers(cleanupFns, clones);
    document.body.replaceChildren();
    document.body.className = '';
    vi.restoreAllMocks();
  });

  it('opening marks the card viewer-active so the overlay pointerleave is ignored', () => {
    const { card, embed } = buildCard();
    handleImageViewerTrigger(
      triggerClick(embed, 10, 10),
      'n.md',
      app,
      cleanupFns,
      clones,
      false
    );
    expect(card.classList.contains('viewer-active')).toBe(true);
    expect(clones.size).toBe(1);
  });

  it('closing with the cursor over the card restores the hover source only', () => {
    const { card, embed } = buildCard();
    handleImageViewerTrigger(
      triggerClick(embed, 10, 10),
      'n.md',
      app,
      cleanupFns,
      clones,
      false
    );
    handleImageViewerTrigger(
      triggerClick(embed, 10, 10),
      'n.md',
      app,
      cleanupFns,
      clones,
      false
    );

    expect(card.classList.contains('interact-hover')).toBe(true);
    expect(card.classList.contains('interact')).toBe(true);
    expect(card.classList.contains('interact-press')).toBe(false);
    expect(card.classList.contains('interact-reveal')).toBe(false);
    expect(card.classList.contains('viewer-active')).toBe(false);
  });

  it('closing with the cursor outside the card releases the hover source', () => {
    const { card, embed } = buildCard();
    setInteractSource(card, 'hover', true);
    handleImageViewerTrigger(
      triggerClick(embed, 10, 10),
      'n.md',
      app,
      cleanupFns,
      clones,
      false
    );
    // Cursor has moved off the card while the overlay was up
    stubRect(card, { left: 500, top: 500, right: 700, bottom: 700 });
    handleImageViewerTrigger(
      triggerClick(embed, 10, 10),
      'n.md',
      app,
      cleanupFns,
      clones,
      false
    );

    expect(card.classList.contains('interact-hover')).toBe(false);
    expect(card.classList.contains('interact')).toBe(false);
  });

  it('a press held through the round trip survives the cursor-outside release', () => {
    const { card, embed } = buildCard();
    setInteractSource(card, 'hover', true);
    setInteractSource(card, 'press', true);
    handleImageViewerTrigger(
      triggerClick(embed, 10, 10),
      'n.md',
      app,
      cleanupFns,
      clones,
      false
    );
    stubRect(card, { left: 500, top: 500, right: 700, bottom: 700 });
    handleImageViewerTrigger(
      triggerClick(embed, 10, 10),
      'n.md',
      app,
      cleanupFns,
      clones,
      false
    );

    expect(card.classList.contains('interact-hover')).toBe(false);
    expect(card.classList.contains('interact-press')).toBe(true);
    expect(card.classList.contains('interact')).toBe(true);
  });

  // The restore is gated on hover capability, not on Platform: a tablet with a
  // trackpad is Platform.isMobile and fully hover-capable, and gating on the
  // platform left exactly those devices holding the state the viewer suppressed
  // with no path back out of it.
  it('restores on a hover-capable device that reports as mobile', () => {
    const wasMobile = Platform.isMobile;
    Platform.isMobile = true;
    try {
      const { card, embed } = buildCard();
      setInteractSource(card, 'hover', true);
      handleImageViewerTrigger(
        triggerClick(embed, 10, 10),
        'n.md',
        app,
        cleanupFns,
        clones,
        false
      );
      stubRect(card, { left: 500, top: 500, right: 700, bottom: 700 });
      handleImageViewerTrigger(
        triggerClick(embed, 10, 10),
        'n.md',
        app,
        cleanupFns,
        clones,
        false
      );

      expect(card.classList.contains('interact-hover')).toBe(false);
      expect(card.classList.contains('interact')).toBe(false);
    } finally {
      Platform.isMobile = wasMobile;
    }
  });

  it('leaves hover state alone on a touch-only device', () => {
    window.matchMedia = vi.fn(() => ({ matches: false })) as never;
    const { card, embed } = buildCard();
    setInteractSource(card, 'hover', true);
    handleImageViewerTrigger(
      triggerClick(embed, 10, 10),
      'n.md',
      app,
      cleanupFns,
      clones,
      false
    );
    stubRect(card, { left: 500, top: 500, right: 700, bottom: 700 });
    handleImageViewerTrigger(
      triggerClick(embed, 10, 10),
      'n.md',
      app,
      cleanupFns,
      clones,
      false
    );

    expect(card.classList.contains('interact-hover')).toBe(true);
  });
});
