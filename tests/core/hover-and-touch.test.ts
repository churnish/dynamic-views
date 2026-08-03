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

describe('setupTouchPress', () => {
  let el: HTMLElement;
  let onActivate: Mock;
  let onDeactivate: Mock;
  let controller: AbortController;

  beforeEach(() => {
    el = document.createElement('div');
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
