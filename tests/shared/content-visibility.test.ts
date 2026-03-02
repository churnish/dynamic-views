import { vi } from 'vitest';
import type { Mock } from 'vitest';
import { Platform } from 'obsidian';
import {
  setupContentVisibility,
  CONTENT_HIDDEN_CLASS,
} from '../../src/shared/content-visibility';

// jsdom lacks IntersectionObserver — minimal mock that tracks observed elements
const mockObserve = vi.fn();
const mockDisconnect = vi.fn();

beforeAll(() => {
  global.IntersectionObserver = vi.fn(function () {
    return {
      observe: mockObserve,
      disconnect: mockDisconnect,
      unobserve: vi.fn(),
      root: null,
      rootMargin: '',
      thresholds: [],
      takeRecords: vi.fn().mockReturnValue([]),
    };
  }) as unknown as typeof IntersectionObserver;
});

describe('setupContentVisibility', () => {
  let scrollContainer: HTMLElement;

  beforeEach(() => {
    scrollContainer = document.createElement('div');
    (Platform as { isMobile: boolean }).isMobile = false;
    mockObserve.mockClear();
    mockDisconnect.mockClear();
    (global.IntersectionObserver as Mock).mockClear();
  });

  afterEach(() => {
    (Platform as { isMobile: boolean }).isMobile = false;
  });

  it('returns observe and disconnect functions', () => {
    const result = setupContentVisibility(scrollContainer);
    expect(typeof result.observe).toBe('function');
    expect(typeof result.disconnect).toBe('function');
    result.disconnect();
  });

  it('creates IO with scrollContainer as root and PANE_MULTIPLIER margin', () => {
    setupContentVisibility(scrollContainer);
    expect(global.IntersectionObserver).toHaveBeenCalledWith(
      expect.any(Function),
      { root: scrollContainer, rootMargin: '300% 0px', threshold: 0 }
    );
  });

  it('delegates observe to the IntersectionObserver instance', () => {
    const { observe } = setupContentVisibility(scrollContainer);
    const card = document.createElement('div');
    observe(card);
    expect(mockObserve).toHaveBeenCalledWith(card);
  });

  it('delegates disconnect to the IntersectionObserver instance', () => {
    const { disconnect } = setupContentVisibility(scrollContainer);
    disconnect();
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('returns no-op functions on mobile (no IO created)', () => {
    (Platform as { isMobile: boolean }).isMobile = true;
    const result = setupContentVisibility(scrollContainer);

    const card = document.createElement('div');
    result.observe(card);
    result.disconnect();

    expect(global.IntersectionObserver).not.toHaveBeenCalled();
    expect(card.classList.contains(CONTENT_HIDDEN_CLASS)).toBe(false);
  });

  it('toggles content-hidden class based on intersection', () => {
    setupContentVisibility(scrollContainer);

    // Get the IO callback passed to the constructor
    const ioCallback = (global.IntersectionObserver as Mock).mock
      .calls[0][0] as IntersectionObserverCallback;

    const card = document.createElement('div');

    // Simulate card leaving the root margin
    ioCallback(
      [
        { target: card, isIntersecting: false },
      ] as unknown as IntersectionObserverEntry[],
      {} as IntersectionObserver
    );
    expect(card.classList.contains(CONTENT_HIDDEN_CLASS)).toBe(true);

    // Simulate card entering the root margin
    ioCallback(
      [
        { target: card, isIntersecting: true },
      ] as unknown as IntersectionObserverEntry[],
      {} as IntersectionObserver
    );
    expect(card.classList.contains(CONTENT_HIDDEN_CLASS)).toBe(false);
  });

  it("exports CONTENT_HIDDEN_CLASS as 'content-hidden'", () => {
    expect(CONTENT_HIDDEN_CLASS).toBe('content-hidden');
  });
});
