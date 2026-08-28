import { vi } from 'vitest';
import type { Mock } from 'vitest';
import {
  canHover,
  canPrimaryHover,
  deferContainerHoverDrop,
  isHoverPointer,
  isTouchPointer,
  setupHoverIntent,
  setupTouchPress,
} from '../../src/core/hover-and-touch';
import {
  SCRUB_DIRECTION_THRESHOLD,
  SWIPE_PRESS_DEFER_MS,
  TOUCH_PRESS_MIN_VISIBLE_MS,
} from '../../src/core/constants';

/**
 * Dispatches a PointerEvent of the given type on the element.
 */
function fire(el: HTMLElement, type: string, init?: PointerEventInit): void {
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerType: 'mouse',
      ...init,
    })
  );
}

/**
 * Dispatches a bubbling touch PointerEvent on a descendant, so `e.target` is
 * what the swipe-surface check reads — not the element the listener sits on.
 */
function touch(
  target: HTMLElement,
  type: string,
  init?: PointerEventInit
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerType: 'touch',
      ...init,
    })
  );
}

describe('setupHoverIntent', () => {
  let el: HTMLElement;
  let onActivate: Mock;
  let onDeactivate: Mock;
  let controller: AbortController;

  beforeEach(() => {
    el = document.createElement('div');
    onActivate = vi.fn();
    onDeactivate = vi.fn();
    controller = new AbortController();
  });

  it('✓ pointermove after pointerenter activates', () => {
    setupHoverIntent(el, onActivate, onDeactivate, controller.signal);

    fire(el, 'pointerenter');
    fire(el, 'pointermove');

    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('✓ pointerenter alone does NOT trigger onActivate', () => {
    setupHoverIntent(el, onActivate, onDeactivate, controller.signal);

    fire(el, 'pointerenter');

    expect(onActivate).not.toHaveBeenCalled();
  });

  it('✓ pointermove without a preceding pointerenter triggers onActivate (first move)', () => {
    // No pointerenter fired — the element starts with hasMoved = false,
    // so the very first pointermove should activate.
    setupHoverIntent(el, onActivate, onDeactivate, controller.signal);

    fire(el, 'pointermove');

    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('✓ multiple pointermove events only trigger onActivate once', () => {
    setupHoverIntent(el, onActivate, onDeactivate, controller.signal);

    fire(el, 'pointerenter');
    fire(el, 'pointermove');
    fire(el, 'pointermove');
    fire(el, 'pointermove');

    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('✓ pointerleave triggers onDeactivate and resets state so next enter+move re-activates', () => {
    setupHoverIntent(el, onActivate, onDeactivate, controller.signal);

    // First hover cycle
    fire(el, 'pointerenter');
    fire(el, 'pointermove');
    expect(onActivate).toHaveBeenCalledTimes(1);

    fire(el, 'pointerleave');
    expect(onDeactivate).toHaveBeenCalledTimes(1);

    // Second hover cycle — state must have been reset by pointerleave
    fire(el, 'pointerenter');
    fire(el, 'pointermove');
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it('✓ aborting the signal removes all listeners and suppresses further callbacks', () => {
    setupHoverIntent(el, onActivate, onDeactivate, controller.signal);

    controller.abort();

    fire(el, 'pointerenter');
    fire(el, 'pointermove');
    fire(el, 'pointerleave');

    expect(onActivate).not.toHaveBeenCalled();
    expect(onDeactivate).not.toHaveBeenCalled();
  });

  it('✓ omitting onDeactivate adds no pointerleave listener', () => {
    setupHoverIntent(el, onActivate, undefined, controller.signal);

    const addEventSpy = vi.spyOn(el, 'addEventListener');

    // Re-setup to inspect what listeners are registered
    const innerController = new AbortController();
    setupHoverIntent(el, onActivate, undefined, innerController.signal);

    const registeredTypes = addEventSpy.mock.calls.map((call) => call[0]);
    expect(registeredTypes).not.toContain('pointerleave');

    // Firing pointerleave must not throw and must not invoke any callback
    expect(() => fire(el, 'pointerleave')).not.toThrow();
  });

  it('ignores touch pointer events', () => {
    setupHoverIntent(el, onActivate, onDeactivate, controller.signal);
    el.dispatchEvent(
      new PointerEvent('pointerenter', { bubbles: true, pointerType: 'touch' })
    );
    el.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, pointerType: 'touch' })
    );
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('ignores pen contact (pressure > 0)', () => {
    setupHoverIntent(el, onActivate, onDeactivate, controller.signal);
    el.dispatchEvent(
      new PointerEvent('pointerenter', { bubbles: true, pointerType: 'pen' })
    );
    el.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        pointerType: 'pen',
        pressure: 0.5,
      })
    );
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('activates for pen hover (pressure 0)', () => {
    setupHoverIntent(el, onActivate, onDeactivate, controller.signal);
    el.dispatchEvent(
      new PointerEvent('pointerenter', { bubbles: true, pointerType: 'pen' })
    );
    el.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        pointerType: 'pen',
        pressure: 0,
      })
    );
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('✓ re-entry after leave activates twice total', () => {
    setupHoverIntent(el, onActivate, onDeactivate, controller.signal);

    // First full cycle
    fire(el, 'pointerenter');
    fire(el, 'pointermove');
    fire(el, 'pointerleave');

    // Second full cycle
    fire(el, 'pointerenter');
    fire(el, 'pointermove');

    expect(onActivate).toHaveBeenCalledTimes(2);
    expect(onDeactivate).toHaveBeenCalledTimes(1);
  });
});

describe('isHoverPointer', () => {
  it('accepts mouse pointer', () => {
    const e = new PointerEvent('pointermove', { pointerType: 'mouse' });
    expect(isHoverPointer(e)).toBe(true);
  });

  it('accepts pen hover (pressure 0)', () => {
    const e = new PointerEvent('pointermove', {
      pointerType: 'pen',
      pressure: 0,
    });
    expect(isHoverPointer(e)).toBe(true);
  });

  it('rejects pen contact (pressure > 0)', () => {
    const e = new PointerEvent('pointermove', {
      pointerType: 'pen',
      pressure: 0.5,
    });
    expect(isHoverPointer(e)).toBe(false);
  });

  it('rejects touch', () => {
    const e = new PointerEvent('pointermove', { pointerType: 'touch' });
    expect(isHoverPointer(e)).toBe(false);
  });
});

describe('canHover', () => {
  it('returns true when (hover: hover) matches', () => {
    window.matchMedia = vi.fn(() => ({ matches: true })) as any;
    expect(canHover()).toBe(true);
  });

  it('returns false when (hover: hover) does not match', () => {
    window.matchMedia = vi.fn(() => ({ matches: false })) as any;
    expect(canHover()).toBe(false);
  });

  it('uses element owner window when provided', () => {
    const el = document.createElement('div');
    const mockWin = { matchMedia: vi.fn(() => ({ matches: true })) };
    vi.spyOn(el, 'ownerDocument', 'get').mockReturnValue({
      defaultView: mockWin,
    } as any);
    expect(canHover(el)).toBe(true);
    expect(mockWin.matchMedia).toHaveBeenCalledWith('(any-hover: hover)');
  });
});

describe('canPrimaryHover', () => {
  it('returns true when primary pointer supports hover', () => {
    window.matchMedia = vi.fn(() => ({ matches: true })) as any;
    expect(canPrimaryHover()).toBe(true);
  });

  it('returns false when primary pointer is touch', () => {
    window.matchMedia = vi.fn(() => ({ matches: false })) as any;
    expect(canPrimaryHover()).toBe(false);
  });

  it('checks (hover: hover) not (any-hover: hover)', () => {
    const el = document.createElement('div');
    const mockWin = { matchMedia: vi.fn(() => ({ matches: true })) };
    vi.spyOn(el, 'ownerDocument', 'get').mockReturnValue({
      defaultView: mockWin,
    } as any);
    canPrimaryHover(el);
    expect(mockWin.matchMedia).toHaveBeenCalledWith('(hover: hover)');
  });
});

describe('isTouchPointer', () => {
  it('should return true for touch', () => {
    expect(
      isTouchPointer(new PointerEvent('pointerdown', { pointerType: 'touch' }))
    ).toBe(true);
  });

  it('should return true for pen contact (pressure > 0)', () => {
    const e = new PointerEvent('pointerdown', { pointerType: 'pen' });
    Object.defineProperty(e, 'pressure', { value: 0.5 });
    expect(isTouchPointer(e)).toBe(true);
  });

  it('should return false for pen hover (pressure 0)', () => {
    expect(
      isTouchPointer(new PointerEvent('pointerdown', { pointerType: 'pen' }))
    ).toBe(false);
  });

  it('should return false for mouse', () => {
    expect(
      isTouchPointer(new PointerEvent('pointerdown', { pointerType: 'mouse' }))
    ).toBe(false);
  });
});

/**
 * Card DOM as shared-renderer builds it: the press is wired on `.card` and the
 * swipe surface is a descendant, so `e.target.closest()` has a real chain to
 * walk. A flat fixture of bare divs matches no swipe-surface selector, which
 * leaves the whole defer path dead while every assertion still passes.
 */
function buildPressCard(
  swipeSurfaceClasses = 'card-cover card-cover-slideshow'
): {
  cardEl: HTMLElement;
  bodyEl: HTMLElement;
  swipeEl: HTMLElement;
} {
  const cardEl = document.createElement('div');
  cardEl.className = 'card';
  const bodyEl = document.createElement('div');
  bodyEl.className = 'card-body';
  cardEl.appendChild(bodyEl);
  const swipeEl = document.createElement('div');
  swipeEl.className = swipeSurfaceClasses;
  cardEl.appendChild(swipeEl);
  return { cardEl, bodyEl, swipeEl };
}

describe('setupTouchPress', () => {
  let el: HTMLElement;
  let bodyEl: HTMLElement;
  let swipeEl: HTMLElement;
  let onActivate: Mock;
  let onDeactivate: Mock;
  let controller: AbortController;

  beforeEach(() => {
    ({ cardEl: el, bodyEl, swipeEl } = buildPressCard());
    onActivate = vi.fn();
    onDeactivate = vi.fn();
    controller = new AbortController();
    vi.useFakeTimers();
  });

  afterEach(() => {
    controller.abort();
    vi.useRealTimers();
  });

  it('should activate on touch pointerdown', () => {
    setupTouchPress(el, onActivate, onDeactivate, controller.signal);
    el.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' })
    );
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('should not activate when shouldActivate rejects the target', () => {
    const title = document.createElement('div');
    title.className = 'card-title';
    const body = document.createElement('div');
    el.append(title, body);
    setupTouchPress(el, onActivate, onDeactivate, controller.signal, (e) =>
      Boolean((e.target as HTMLElement)?.closest?.('.card-title'))
    );
    body.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' })
    );
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('should activate when shouldActivate accepts the target', () => {
    const title = document.createElement('div');
    title.className = 'card-title';
    el.append(title);
    setupTouchPress(el, onActivate, onDeactivate, controller.signal, (e) =>
      Boolean((e.target as HTMLElement)?.closest?.('.card-title'))
    );
    title.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' })
    );
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('should not activate on mouse pointerdown', () => {
    setupTouchPress(el, onActivate, onDeactivate, controller.signal);
    el.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' })
    );
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('should activate on pen contact pointerdown', () => {
    setupTouchPress(el, onActivate, onDeactivate, controller.signal);
    const e = new PointerEvent('pointerdown', {
      bubbles: true,
      pointerType: 'pen',
    });
    Object.defineProperty(e, 'pressure', { value: 0.5 });
    el.dispatchEvent(e);
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('should deactivate on pointerup', () => {
    setupTouchPress(el, onActivate, onDeactivate, controller.signal);
    el.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' })
    );
    vi.advanceTimersByTime(200);
    el.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' })
    );
    expect(onDeactivate).toHaveBeenCalledOnce();
  });

  it('should deactivate on pointercancel', () => {
    setupTouchPress(el, onActivate, onDeactivate, controller.signal);
    el.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' })
    );
    vi.advanceTimersByTime(200);
    el.dispatchEvent(
      new PointerEvent('pointercancel', {
        bubbles: true,
        pointerType: 'touch',
      })
    );
    expect(onDeactivate).toHaveBeenCalledOnce();
  });

  it('should enforce minimum 100ms visible duration', () => {
    setupTouchPress(el, onActivate, onDeactivate, controller.signal);
    el.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' })
    );
    // Immediate pointerup
    el.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' })
    );
    // Not yet deactivated
    expect(onDeactivate).not.toHaveBeenCalled();
    // After 100ms
    vi.advanceTimersByTime(100);
    expect(onDeactivate).toHaveBeenCalledOnce();
  });

  it('a press inside the previous min-visible window keeps its own highlight', () => {
    // deactivate() clears a pending timer, but a press never goes through
    // deactivate. Without activate() clearing it too, the first cycle's timer
    // fires on its original schedule and strips the second press's highlight
    // almost immediately.
    setupTouchPress(el, onActivate, onDeactivate, controller.signal);
    const touch = { bubbles: true, pointerType: 'touch' } as const;

    el.dispatchEvent(new PointerEvent('pointerdown', touch));
    vi.advanceTimersByTime(40);
    el.dispatchEvent(new PointerEvent('pointerup', touch));

    // Second press lands 50ms later, while the first window still has 10ms left
    vi.advanceTimersByTime(50);
    el.dispatchEvent(new PointerEvent('pointerdown', touch));
    expect(onActivate).toHaveBeenCalledTimes(2);

    // The first cycle's timer would have fired here and cleared the highlight
    vi.advanceTimersByTime(20);
    expect(onDeactivate).not.toHaveBeenCalled();

    // The second press still gets its own full window
    el.dispatchEvent(new PointerEvent('pointerup', touch));
    vi.advanceTimersByTime(TOUCH_PRESS_MIN_VISIBLE_MS);
    expect(onDeactivate).toHaveBeenCalledOnce();
  });

  // ── Swipe-surface press defer ──────────────────────────────────────────

  it('defers the press on a swipe surface until the defer window elapses', () => {
    setupTouchPress(el, onActivate, onDeactivate, controller.signal);

    touch(swipeEl, 'pointerdown', { clientX: 40, clientY: 40 });
    expect(onActivate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(SWIPE_PRESS_DEFER_MS);
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('activates immediately off a swipe surface', () => {
    setupTouchPress(el, onActivate, onDeactivate, controller.signal);

    touch(bodyEl, 'pointerdown', { clientX: 40, clientY: 40 });
    expect(onActivate).toHaveBeenCalledOnce();

    // No pending timer to double-fire it later
    vi.advanceTimersByTime(SWIPE_PRESS_DEFER_MS * 2);
    expect(onActivate).toHaveBeenCalledOnce();
  });

  // The Slide-mode cover carries `card-cover-slideshow` and no `multi-image`
  // class. A selector listing only `multi-image` matched nothing here, so a
  // Slide swipe activated at pointerdown and held the highlight all gesture.
  it('defers on a Slide cover, which carries no multi-image class', () => {
    ({ cardEl: el, swipeEl } = buildPressCard(
      'card-cover card-cover-slideshow'
    ));
    expect(swipeEl.classList.contains('multi-image')).toBe(false);
    setupTouchPress(el, onActivate, onDeactivate, controller.signal);

    touch(swipeEl, 'pointerdown', { clientX: 40, clientY: 40 });

    expect(onActivate).not.toHaveBeenCalled();
  });

  it.each([
    'card-cover card-cover-slideshow',
    'card-cover multi-image',
    'card-thumbnail multi-image',
  ])('defers on a "%s" surface', (classes) => {
    ({ cardEl: el, swipeEl } = buildPressCard(classes));
    setupTouchPress(el, onActivate, onDeactivate, controller.signal);

    touch(swipeEl, 'pointerdown', { clientX: 40, clientY: 40 });
    expect(onActivate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(SWIPE_PRESS_DEFER_MS);
    expect(onActivate).toHaveBeenCalledOnce();
  });

  // `card-cover-slideshow` is matched as a whole class token, so a
  // longer-named sibling class must not be mistaken for it.
  it.each(['card-cover', 'card-thumbnail', 'card-cover-slideshow-overlay'])(
    'does not defer on a non-swipe "%s" surface',
    (classes) => {
      ({ cardEl: el, swipeEl } = buildPressCard(classes));
      setupTouchPress(el, onActivate, onDeactivate, controller.signal);

      touch(swipeEl, 'pointerdown', { clientX: 40, clientY: 40 });

      expect(onActivate).toHaveBeenCalledOnce();
    }
  );

  it('cancels the pending press once the finger moves past the threshold horizontally', () => {
    setupTouchPress(el, onActivate, onDeactivate, controller.signal);

    touch(swipeEl, 'pointerdown', { clientX: 40, clientY: 40 });
    touch(swipeEl, 'pointermove', {
      clientX: 40 + SCRUB_DIRECTION_THRESHOLD + 1,
      clientY: 40,
    });

    vi.advanceTimersByTime(SWIPE_PRESS_DEFER_MS * 2);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('cancels the pending press on vertical movement past the threshold', () => {
    setupTouchPress(el, onActivate, onDeactivate, controller.signal);

    touch(swipeEl, 'pointerdown', { clientX: 40, clientY: 40 });
    touch(swipeEl, 'pointermove', {
      clientX: 40,
      clientY: 40 + SCRUB_DIRECTION_THRESHOLD + 1,
    });

    vi.advanceTimersByTime(SWIPE_PRESS_DEFER_MS * 2);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('keeps the pending press for movement at the threshold', () => {
    setupTouchPress(el, onActivate, onDeactivate, controller.signal);

    touch(swipeEl, 'pointerdown', { clientX: 40, clientY: 40 });
    touch(swipeEl, 'pointermove', {
      clientX: 40 + SCRUB_DIRECTION_THRESHOLD,
      clientY: 40 + SCRUB_DIRECTION_THRESHOLD,
    });

    vi.advanceTimersByTime(SWIPE_PRESS_DEFER_MS);
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('a lift inside the defer window leaves the press unfired', () => {
    setupTouchPress(el, onActivate, onDeactivate, controller.signal);

    touch(swipeEl, 'pointerdown', { clientX: 40, clientY: 40 });
    touch(swipeEl, 'pointerup', { clientX: 40, clientY: 40 });

    vi.advanceTimersByTime(SWIPE_PRESS_DEFER_MS * 2);
    expect(onActivate).not.toHaveBeenCalled();
    expect(onDeactivate).not.toHaveBeenCalled();
  });

  it('aborting inside the defer window leaves the press unfired', () => {
    setupTouchPress(el, onActivate, onDeactivate, controller.signal);

    touch(swipeEl, 'pointerdown', { clientX: 40, clientY: 40 });
    controller.abort();

    vi.advanceTimersByTime(SWIPE_PRESS_DEFER_MS * 2);
    expect(onActivate).not.toHaveBeenCalled();
  });

  // Two press-release cycles inside the min-visible window each schedule a
  // deactivate timer. The sequence is call-balanced, so only the teardown leak
  // exposes it: abort clears one handle, and the stranded one fires
  // onDeactivate on a card the caller has already torn down.
  it('strands no deactivate timer when two presses land inside the min-visible window', () => {
    setupTouchPress(el, onActivate, onDeactivate, controller.signal);

    touch(bodyEl, 'pointerdown');
    touch(bodyEl, 'pointerup');
    vi.advanceTimersByTime(TOUCH_PRESS_MIN_VISIBLE_MS / 2);
    touch(bodyEl, 'pointerdown');
    touch(bodyEl, 'pointerup');

    expect(onActivate).toHaveBeenCalledTimes(2);
    expect(onDeactivate).not.toHaveBeenCalled();

    controller.abort();
    vi.advanceTimersByTime(TOUCH_PRESS_MIN_VISIBLE_MS * 2);

    expect(onDeactivate).not.toHaveBeenCalled();
  });
});

describe('deferContainerHoverDrop', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('removes has-hover-card after 150ms when no card is interacting', () => {
    const container = document.createElement('div');
    container.classList.add('bases-cards-group');
    const card = document.createElement('div');
    card.classList.add('card');
    container.appendChild(card);
    container.classList.add('has-hover-card');

    deferContainerHoverDrop(card);

    expect(container.classList.contains('has-hover-card')).toBe(true);
    vi.advanceTimersByTime(150);
    expect(container.classList.contains('has-hover-card')).toBe(false);
  });

  it('does NOT remove has-hover-card when another card has interact', () => {
    const container = document.createElement('div');
    container.classList.add('bases-cards-group');
    const card1 = document.createElement('div');
    card1.classList.add('card');
    const card2 = document.createElement('div');
    card2.classList.add('card', 'interact');
    container.appendChild(card1);
    container.appendChild(card2);
    container.classList.add('has-hover-card');

    deferContainerHoverDrop(card1);
    vi.advanceTimersByTime(150);

    expect(container.classList.contains('has-hover-card')).toBe(true);
  });

  it('is a no-op when card has no matching container ancestor', () => {
    const card = document.createElement('div');
    card.classList.add('card');
    expect(() => deferContainerHoverDrop(card)).not.toThrow();
  });
});
