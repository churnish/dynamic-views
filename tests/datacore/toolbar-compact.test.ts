import { vi } from 'vitest';

// Mock getOwnerWindow to return the jsdom window
vi.mock('../../src/utils/owner-window', () => ({
  getOwnerWindow: vi.fn(() => globalThis),
}));

import { observeToolbarCompact } from '../../src/datacore/toolbar-compact';

const NARROW_CLASS = 'dynamic-views-narrow';
const HIDDEN_CLASS = 'dynamic-views-hidden';

describe('observeToolbarCompact', () => {
  let container: HTMLElement;
  let resizeCallback: (() => void) | null;
  let mockDisconnect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    resizeCallback = null;
    mockDisconnect = vi.fn();

    // Mock ResizeObserver to capture the callback
    globalThis.ResizeObserver = vi.fn(function (cb: ResizeObserverCallback) {
      resizeCallback = () => cb([], {} as ResizeObserver);
      return {
        observe: vi.fn(),
        disconnect: mockDisconnect,
        unobserve: vi.fn(),
      };
    }) as unknown as typeof ResizeObserver;

    // Mock getComputedStyle to return controllable --file-line-width
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: (prop: string) => {
        if (prop === '--file-line-width') return '700';
        return '';
      },
    } as CSSStyleDeclaration);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setWidth(width: number): void {
    Object.defineProperty(container, 'offsetWidth', {
      value: width,
      configurable: true,
    });
  }

  function triggerResize(): void {
    resizeCallback?.();
  }

  it('width > threshold: no narrow or hidden class', () => {
    setWidth(800);
    observeToolbarCompact(container);

    expect(container.classList.contains(NARROW_CLASS)).toBe(false);
    expect(container.classList.contains(HIDDEN_CLASS)).toBe(false);
  });

  it('width < threshold: adds narrow class', () => {
    setWidth(600);
    observeToolbarCompact(container);

    expect(container.classList.contains(NARROW_CLASS)).toBe(true);
    expect(container.classList.contains(HIDDEN_CLASS)).toBe(false);
  });

  it('width = threshold: no narrow class (strict <)', () => {
    setWidth(700);
    observeToolbarCompact(container);

    expect(container.classList.contains(NARROW_CLASS)).toBe(false);
    expect(container.classList.contains(HIDDEN_CLASS)).toBe(false);
  });

  it('width <= 50: adds hidden class, removes narrow class', () => {
    // Pre-add narrow to verify it gets removed
    container.classList.add(NARROW_CLASS);
    setWidth(50);
    observeToolbarCompact(container);

    expect(container.classList.contains(HIDDEN_CLASS)).toBe(true);
    expect(container.classList.contains(NARROW_CLASS)).toBe(false);
  });

  it('width returns above threshold after being narrow: both classes removed', () => {
    setWidth(600);
    observeToolbarCompact(container);

    expect(container.classList.contains(NARROW_CLASS)).toBe(true);

    // Resize to above threshold
    setWidth(800);
    triggerResize();

    expect(container.classList.contains(NARROW_CLASS)).toBe(false);
    expect(container.classList.contains(HIDDEN_CLASS)).toBe(false);
  });

  it('missing --file-line-width: falls back to 700', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: () => '',
    } as unknown as CSSStyleDeclaration);

    // 699 < 700 (fallback) → narrow
    setWidth(699);
    observeToolbarCompact(container);

    expect(container.classList.contains(NARROW_CLASS)).toBe(true);

    // 700 = 700 (fallback) → not narrow
    setWidth(700);
    triggerResize();

    expect(container.classList.contains(NARROW_CLASS)).toBe(false);
  });

  it('custom --file-line-width: threshold respects custom value', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: (prop: string) => {
        if (prop === '--file-line-width') return '500';
        return '';
      },
    } as unknown as CSSStyleDeclaration);

    // 499 < 500 → narrow
    setWidth(499);
    observeToolbarCompact(container);

    expect(container.classList.contains(NARROW_CLASS)).toBe(true);

    // 500 = 500 → not narrow
    setWidth(500);
    triggerResize();

    expect(container.classList.contains(NARROW_CLASS)).toBe(false);
  });

  it('cleanup disconnects observer', () => {
    setWidth(800);
    const cleanup = observeToolbarCompact(container);

    cleanup();

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });
});
