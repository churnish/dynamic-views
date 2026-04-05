import { vi } from 'vitest';
import type { Mock } from 'vitest';
import {
  canHover,
  canPrimaryHover,
  isHoverPointer,
  setupHoverIntent,
} from '../../src/shared/hover';

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
