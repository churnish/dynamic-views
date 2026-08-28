import { vi } from 'vitest';
import {
  addScrollIndicatorRestore,
  claimIndicator,
  releaseIndicator,
  restoreActiveIndicator,
} from '../../src/core/multi-image-icon';
import { SCROLL_THROTTLE_MS } from '../../src/core/constants';

const HIDDEN_CLASS = 'dynamic-views-icon-hidden';

/** Indicator as the swipe path leaves it: the caller adds the class, claimIndicator only takes the slot. */
function hiddenIndicator(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'thumbnail-indicator';
  el.classList.add(HIDDEN_CLASS);
  return el;
}

function isHidden(el: HTMLElement): boolean {
  return el.classList.contains(HIDDEN_CLASS);
}

describe('indicator exclusivity slot', () => {
  // The module-level slot survives between tests, so every test that claims
  // must hand the slot back or the next one starts with a stale holder.
  afterEach(() => restoreActiveIndicator());

  it('restores the previous indicator when a second one claims the slot', () => {
    const first = hiddenIndicator();
    const second = hiddenIndicator();

    claimIndicator(first);
    claimIndicator(second);

    expect(isHidden(first)).toBe(false);
    expect(isHidden(second)).toBe(true);
  });

  it('leaves the holder hidden when it re-claims its own slot', () => {
    const indicator = hiddenIndicator();

    claimIndicator(indicator);
    claimIndicator(indicator);

    expect(isHidden(indicator)).toBe(true);
  });

  it('restores only the newest of a chain of claims', () => {
    const first = hiddenIndicator();
    const second = hiddenIndicator();
    const third = hiddenIndicator();

    claimIndicator(first);
    claimIndicator(second);
    claimIndicator(third);
    restoreActiveIndicator();

    expect([first, second, third].map(isHidden)).toEqual([false, false, false]);
  });
});

describe('releaseIndicator', () => {
  afterEach(() => restoreActiveIndicator());

  it('unhides the indicator and gives up the slot', () => {
    const indicator = hiddenIndicator();
    claimIndicator(indicator);

    releaseIndicator(indicator);

    expect(isHidden(indicator)).toBe(false);
    // Slot is free: a later restore has nothing to do, and re-hiding the same
    // element is not undone by it.
    indicator.classList.add(HIDDEN_CLASS);
    restoreActiveIndicator();
    expect(isHidden(indicator)).toBe(true);
  });

  it('is null-safe', () => {
    expect(() => releaseIndicator(null)).not.toThrow();
  });

  it('is idempotent', () => {
    const indicator = hiddenIndicator();
    claimIndicator(indicator);

    releaseIndicator(indicator);
    releaseIndicator(indicator);

    expect(isHidden(indicator)).toBe(false);
  });

  // A restore arriving late for a card that no longer holds the slot must not
  // strand the indicator another card has since hidden.
  it('leaves the current holder claimed when a stale indicator is released', () => {
    const stale = hiddenIndicator();
    const current = hiddenIndicator();
    claimIndicator(stale);
    claimIndicator(current);
    stale.classList.add(HIDDEN_CLASS);

    releaseIndicator(stale);

    expect(isHidden(stale)).toBe(false);
    expect(isHidden(current)).toBe(true);

    restoreActiveIndicator();
    expect(isHidden(current)).toBe(false);
  });
});

describe('restoreActiveIndicator', () => {
  afterEach(() => restoreActiveIndicator());

  it('unhides whichever indicator holds the slot', () => {
    const indicator = hiddenIndicator();
    claimIndicator(indicator);

    restoreActiveIndicator();

    expect(isHidden(indicator)).toBe(false);
  });

  it('is safe to call when nothing is hidden', () => {
    expect(() => restoreActiveIndicator()).not.toThrow();
  });

  it('is idempotent — a second call does not re-restore a re-hidden indicator', () => {
    const indicator = hiddenIndicator();
    claimIndicator(indicator);

    restoreActiveIndicator();
    indicator.classList.add(HIDDEN_CLASS);
    restoreActiveIndicator();

    expect(isHidden(indicator)).toBe(true);
  });
});

describe('addScrollIndicatorRestore', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    container.className = 'bases-view';
  });

  afterEach(() => vi.useRealTimers());

  /** Clears the throttle window so the next scroll is not swallowed. */
  function scroll(): void {
    vi.advanceTimersByTime(SCROLL_THROTTLE_MS + 1);
    container.dispatchEvent(new Event('scroll'));
  }

  it('invokes the registered callback on scroll', () => {
    const callback = vi.fn();
    const controller = new AbortController();
    addScrollIndicatorRestore(container, callback, controller.signal);

    scroll();

    expect(callback).toHaveBeenCalledTimes(1);
    controller.abort();
  });

  it('throttles scrolls inside the throttle window', () => {
    const callback = vi.fn();
    const controller = new AbortController();
    addScrollIndicatorRestore(container, callback, controller.signal);

    scroll();
    container.dispatchEvent(new Event('scroll'));
    container.dispatchEvent(new Event('scroll'));

    expect(callback).toHaveBeenCalledTimes(1);

    scroll();
    expect(callback).toHaveBeenCalledTimes(2);
    controller.abort();
  });

  it('shares one listener across every card on the container', () => {
    const first = vi.fn();
    const second = vi.fn();
    const controller = new AbortController();
    const addSpy = vi.spyOn(container, 'addEventListener');

    addScrollIndicatorRestore(container, first, controller.signal);
    addScrollIndicatorRestore(container, second, controller.signal);

    expect(
      addSpy.mock.calls.filter((call) => call[0] === 'scroll')
    ).toHaveLength(1);

    scroll();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    controller.abort();
  });

  it('keeps firing for the remaining cards while one card unmounts', () => {
    const staying = vi.fn();
    const leaving = vi.fn();
    const stayController = new AbortController();
    const leaveController = new AbortController();
    addScrollIndicatorRestore(container, staying, stayController.signal);
    addScrollIndicatorRestore(container, leaving, leaveController.signal);

    leaveController.abort();
    scroll();

    expect(leaving).not.toHaveBeenCalled();
    expect(staying).toHaveBeenCalledTimes(1);
    stayController.abort();
  });

  // The listener serves every card on a container Obsidian owns, so it cannot
  // ride any one card's signal. It shipped with no signal at all, which left it
  // attached — and the module reachable — across a plugin disable/enable cycle.
  //
  // Callback invocation alone cannot catch that: the teardown also drops the
  // callback set, and a stranded listener finds nothing to call. The listener's
  // own signal is the only observable that separates the two.
  it('invokes nothing once every registered signal has aborted', () => {
    const first = vi.fn();
    const second = vi.fn();
    const firstController = new AbortController();
    const secondController = new AbortController();
    const addSpy = vi.spyOn(container, 'addEventListener');

    addScrollIndicatorRestore(container, first, firstController.signal);
    addScrollIndicatorRestore(container, second, secondController.signal);

    const listenerOptions = addSpy.mock.calls.find(
      (call) => call[0] === 'scroll'
    )?.[2] as AddEventListenerOptions | undefined;
    expect(listenerOptions?.signal).toBeInstanceOf(AbortSignal);

    // One card leaving must not detach the listener the others still need
    firstController.abort();
    expect(listenerOptions?.signal?.aborted).toBe(false);

    secondController.abort();
    expect(listenerOptions?.signal?.aborted).toBe(true);

    scroll();
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it('re-attaches for a fresh registration on the same container after teardown', () => {
    const before = vi.fn();
    const firstController = new AbortController();
    addScrollIndicatorRestore(container, before, firstController.signal);
    firstController.abort();

    const after = vi.fn();
    const secondController = new AbortController();
    addScrollIndicatorRestore(container, after, secondController.signal);

    scroll();

    expect(after).toHaveBeenCalledTimes(1);
    expect(before).not.toHaveBeenCalled();
    secondController.abort();
  });
});
