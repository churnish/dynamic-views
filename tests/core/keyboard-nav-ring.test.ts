import { beforeEach, describe, expect, it } from 'vitest';
import { setKeyboardNavActive } from '../../src/core/keyboard-nav';

/**
 * The focus ring cannot rely on `:focus-visible` — WebKit does not carry that
 * state across a script-driven `focus()`, which is all arrow navigation does.
 * The container class is what the ring keys on instead, so it must track the
 * property exactly.
 */
describe('setKeyboardNavActive', () => {
  let container: HTMLElement & { _keyboardNavActive?: boolean };

  beforeEach(() => {
    container = document.createElement('div');
    container.className = 'dynamic-views-grid';
  });

  it('sets both the property and the class the ring keys on', () => {
    setKeyboardNavActive(container, true);
    expect(container._keyboardNavActive).toBe(true);
    expect(container.classList.contains('dynamic-views-keyboard-nav')).toBe(
      true
    );
  });

  it('clears both together', () => {
    setKeyboardNavActive(container, true);
    setKeyboardNavActive(container, false);
    expect(container._keyboardNavActive).toBe(false);
    expect(container.classList.contains('dynamic-views-keyboard-nav')).toBe(
      false
    );
  });

  it('is idempotent', () => {
    setKeyboardNavActive(container, true);
    setKeyboardNavActive(container, true);
    expect(container.classList.contains('dynamic-views-keyboard-nav')).toBe(
      true
    );
    expect(
      container.className
        .split(' ')
        .filter((c) => c === 'dynamic-views-keyboard-nav')
    ).toHaveLength(1);
  });

  it('tolerates a null container', () => {
    expect(() => setKeyboardNavActive(null, true)).not.toThrow();
  });
});
