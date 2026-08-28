/**
 * The wheel gesture guard's hover check.
 *
 * A card scrolling under a stationary cursor fires wheel events the user never
 * aimed, so the guard requires hover intent first. It must read the hover source
 * specifically: `.interact` is the union of hover, press and reveal, so reading
 * it would let a finger press unlock a trackpad gesture on a hybrid tablet.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';

import { setupSwipeGestures } from '../../src/core/slideshow';
import { setInteractSource } from '../../src/core/hover-and-touch';

/** Past WHEEL_SWIPE_THRESHOLD (5) in one event, and horizontal-dominant. */
function wheelRight(el: HTMLElement): void {
  el.dispatchEvent(
    new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaX: 40,
      deltaY: 0,
    })
  );
}

describe('setupSwipeGestures wheel hover guard', () => {
  let cover: HTMLElement;
  let card: HTMLElement;
  let navigate: Mock;
  let controller: AbortController;

  beforeEach(() => {
    // Hover-capable device — the guard is only armed when canHover() is true
    window.matchMedia = vi.fn(() => ({ matches: true })) as never;
    card = document.createElement('div');
    card.className = 'card';
    cover = document.createElement('div');
    cover.className = 'card-cover';
    card.appendChild(cover);
    navigate = vi.fn();
    controller = new AbortController();
  });

  afterEach(() => {
    controller.abort();
    vi.restoreAllMocks();
  });

  it('blocks a wheel gesture on a card with no interaction at all', () => {
    setupSwipeGestures(cover, card, navigate, controller.signal);
    wheelRight(cover);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('allows a wheel gesture once the hover source is held', () => {
    setupSwipeGestures(cover, card, navigate, controller.signal);
    setInteractSource(card, 'hover', true);
    wheelRight(cover);
    expect(navigate).toHaveBeenCalledWith(1, true);
  });

  it('a finger press alone does not unlock the gesture', () => {
    setupSwipeGestures(cover, card, navigate, controller.signal);
    setInteractSource(card, 'press', true);
    // The press has set .interact, which is exactly what must not satisfy this
    expect(card.classList.contains('interact')).toBe(true);

    wheelRight(cover);

    expect(navigate).not.toHaveBeenCalled();
  });

  it('a poster reveal alone does not unlock the gesture', () => {
    setupSwipeGestures(cover, card, navigate, controller.signal);
    setInteractSource(card, 'reveal', true);
    wheelRight(cover);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('skips the guard entirely on a device with no hover', () => {
    window.matchMedia = vi.fn(() => ({ matches: false })) as never;
    setupSwipeGestures(cover, card, navigate, controller.signal);
    wheelRight(cover);
    expect(navigate).toHaveBeenCalledWith(1, true);
  });
});
