import { vi, type Mock } from 'vitest';

// Mock slideshow before importing the module under test
vi.mock('../../src/shared/slideshow', () => ({
  getCachedBlobUrl: vi.fn((url: string) => url),
  preloadImageBatch: vi.fn(),
}));

import {
  computeScrubIndex,
  applyScrubImage,
  setupTouchScrubbing,
  observeThumbnailReset,
  unobserveThumbnailReset,
} from '../../src/shared/thumbnail-scrub';
import {
  getCachedBlobUrl,
  preloadImageBatch,
} from '../../src/shared/slideshow';

// Obsidian's addClass/removeClass extensions on HTMLElement (not present in jsdom)
function patchObsidianMethods(el: HTMLElement): void {
  (el as any).addClass = function (cls: string) {
    this.classList.add(cls);
  };
  (el as any).removeClass = function (cls: string) {
    this.classList.remove(cls);
  };
}

function firePointer(
  el: HTMLElement,
  type: string,
  init?: PointerEventInit
): void {
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      ...init,
    })
  );
}

// ── computeScrubIndex ─────────────────────────────────────────────────────

describe('computeScrubIndex', () => {
  it('returns 0 for x=0', () => {
    expect(computeScrubIndex(0, 200, 5)).toBe(0);
  });

  it('returns count-1 for x=width', () => {
    expect(computeScrubIndex(200, 200, 5)).toBe(4);
  });

  it('returns correct index for midpoint', () => {
    // 100 / 200 * 5 = 2.5 → floor = 2
    expect(computeScrubIndex(100, 200, 5)).toBe(2);
  });

  it('clamps negative x to 0', () => {
    expect(computeScrubIndex(-50, 200, 5)).toBe(0);
  });

  it('handles count=1', () => {
    expect(computeScrubIndex(50, 200, 1)).toBe(0);
    expect(computeScrubIndex(200, 200, 1)).toBe(0);
  });
});

// ── applyScrubImage ───────────────────────────────────────────────────────

describe('applyScrubImage', () => {
  let imgEl: HTMLImageElement;

  beforeEach(() => {
    imgEl = document.createElement('img');
    patchObsidianMethods(imgEl);
    vi.mocked(getCachedBlobUrl).mockImplementation((url) => url);
  });

  it('adds scrub-loading for uncached external URL', () => {
    const url = 'https://example.com/img.jpg';
    applyScrubImage(imgEl, url);
    expect(imgEl.classList.contains('scrub-loading')).toBe(true);
    expect(imgEl.src).toContain(url);
  });

  it('removes scrub-loading on img load for external URL', () => {
    const url = 'https://example.com/img.jpg';
    applyScrubImage(imgEl, url);
    expect(imgEl.classList.contains('scrub-loading')).toBe(true);
    imgEl.dispatchEvent(new Event('load'));
    expect(imgEl.classList.contains('scrub-loading')).toBe(false);
  });

  it('removes scrub-loading and dynamic-views-hidden for cached URL', () => {
    const url = 'https://example.com/img.jpg';
    const blobUrl = 'blob:http://localhost/abc';
    vi.mocked(getCachedBlobUrl).mockReturnValue(blobUrl);
    imgEl.classList.add('scrub-loading');
    imgEl.classList.add('dynamic-views-hidden');

    applyScrubImage(imgEl, url);

    expect(imgEl.classList.contains('scrub-loading')).toBe(false);
    expect(imgEl.classList.contains('dynamic-views-hidden')).toBe(false);
    expect(imgEl.src).toContain(blobUrl);
  });

  it('skips src assignment when already set to resolved URL', () => {
    const url = '/local/img.jpg';
    imgEl.src = url;
    const srcBefore = imgEl.src;

    applyScrubImage(imgEl, url);

    // src should not have been re-assigned (no side effect)
    expect(imgEl.src).toBe(srcBefore);
  });
});

// ── setupTouchScrubbing ───────────────────────────────────────────────────

describe('setupTouchScrubbing', () => {
  let thumbEl: HTMLElement;
  let imgEl: HTMLImageElement;
  let cardEl: HTMLElement;
  let imageUrls: string[];
  let controller: AbortController;
  let preloadGuard: { done: boolean };
  let brokenHandler: Mock;

  beforeEach(() => {
    thumbEl = document.createElement('div');
    imgEl = document.createElement('img');
    patchObsidianMethods(imgEl);
    thumbEl.appendChild(imgEl);
    cardEl = document.createElement('div');
    cardEl.classList.add('card');
    cardEl.appendChild(thumbEl);
    document.body.appendChild(cardEl);

    imageUrls = ['/img/a.jpg', '/img/b.jpg', '/img/c.jpg'];
    controller = new AbortController();
    preloadGuard = { done: false };
    brokenHandler = vi.fn();
    vi.mocked(getCachedBlobUrl).mockImplementation((url) => url);
    vi.mocked(preloadImageBatch).mockReset();

    // Mock getBoundingClientRect for thumb
    thumbEl.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 300,
      bottom: 50,
      width: 300,
      height: 50,
      toJSON: () => {},
    }));
  });

  afterEach(() => {
    controller.abort();
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it('triggers preload on first touch pointerdown', () => {
    setupTouchScrubbing({
      thumbEl,
      imgEl,
      cardEl,
      imageUrls,
      signal: controller.signal,
      preloadSignal: controller.signal,
      preloadGuard,
      brokenHandler,
    });

    firePointer(thumbEl, 'pointerdown', {
      pointerType: 'touch',
      clientX: 50,
    });

    expect(preloadGuard.done).toBe(true);
    expect(preloadImageBatch).toHaveBeenCalledWith(
      imageUrls,
      controller.signal,
      brokenHandler
    );
  });

  it('does not trigger preload on second touch', () => {
    preloadGuard.done = true;
    setupTouchScrubbing({
      thumbEl,
      imgEl,
      cardEl,
      imageUrls,
      signal: controller.signal,
      preloadSignal: controller.signal,
      preloadGuard,
      brokenHandler,
    });

    firePointer(thumbEl, 'pointerdown', {
      pointerType: 'touch',
      clientX: 50,
    });

    expect(preloadImageBatch).not.toHaveBeenCalled();
  });

  it('enters scrub mode on pointermove > 10px delta', () => {
    setupTouchScrubbing({
      thumbEl,
      imgEl,
      cardEl,
      imageUrls,
      signal: controller.signal,
      preloadSignal: controller.signal,
      preloadGuard,
      brokenHandler,
    });

    firePointer(thumbEl, 'pointerdown', {
      pointerType: 'touch',
      clientX: 50,
    });
    firePointer(thumbEl, 'pointermove', {
      pointerType: 'touch',
      clientX: 62,
    });

    expect(thumbEl.classList.contains('scrub-hover')).toBe(true);
  });

  it('does NOT enter scrub mode on pointermove < 10px delta', () => {
    setupTouchScrubbing({
      thumbEl,
      imgEl,
      cardEl,
      imageUrls,
      signal: controller.signal,
      preloadSignal: controller.signal,
      preloadGuard,
      brokenHandler,
    });

    firePointer(thumbEl, 'pointerdown', {
      pointerType: 'touch',
      clientX: 50,
    });
    firePointer(thumbEl, 'pointermove', {
      pointerType: 'touch',
      clientX: 55,
    });

    expect(thumbEl.classList.contains('scrub-hover')).toBe(false);
  });

  it('suppresses click after scrub on pointerup', () => {
    setupTouchScrubbing({
      thumbEl,
      imgEl,
      cardEl,
      imageUrls,
      signal: controller.signal,
      preloadSignal: controller.signal,
      preloadGuard,
      brokenHandler,
    });

    firePointer(thumbEl, 'pointerdown', {
      pointerType: 'touch',
      clientX: 50,
    });
    firePointer(thumbEl, 'pointermove', {
      pointerType: 'touch',
      clientX: 62,
    });
    firePointer(thumbEl, 'pointerup', {
      pointerType: 'touch',
      clientX: 62,
    });

    const clickHandler = vi.fn();
    cardEl.addEventListener('click', clickHandler);
    cardEl.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );
    expect(clickHandler).not.toHaveBeenCalled();
  });

  it('does NOT suppress click when no scrub occurred', () => {
    setupTouchScrubbing({
      thumbEl,
      imgEl,
      cardEl,
      imageUrls,
      signal: controller.signal,
      preloadSignal: controller.signal,
      preloadGuard,
      brokenHandler,
    });

    firePointer(thumbEl, 'pointerdown', {
      pointerType: 'touch',
      clientX: 50,
    });
    // No move above threshold
    firePointer(thumbEl, 'pointerup', {
      pointerType: 'touch',
      clientX: 50,
    });

    const clickHandler = vi.fn();
    cardEl.addEventListener('click', clickHandler);
    cardEl.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );
    expect(clickHandler).toHaveBeenCalledTimes(1);
  });

  it('cleans up on pointercancel', () => {
    setupTouchScrubbing({
      thumbEl,
      imgEl,
      cardEl,
      imageUrls,
      signal: controller.signal,
      preloadSignal: controller.signal,
      preloadGuard,
      brokenHandler,
    });

    firePointer(thumbEl, 'pointerdown', {
      pointerType: 'touch',
      clientX: 50,
    });
    firePointer(thumbEl, 'pointermove', {
      pointerType: 'touch',
      clientX: 62,
    });
    expect(thumbEl.classList.contains('scrub-hover')).toBe(true);

    firePointer(thumbEl, 'pointercancel', { pointerType: 'touch' });
    expect(thumbEl.classList.contains('scrub-hover')).toBe(false);
  });

  it('re-resolves cardEl from DOM when reResolveCard is true', () => {
    setupTouchScrubbing({
      thumbEl,
      imgEl,
      cardEl,
      imageUrls,
      signal: controller.signal,
      preloadSignal: controller.signal,
      preloadGuard,
      brokenHandler,
      reResolveCard: true,
    });

    firePointer(thumbEl, 'pointerdown', {
      pointerType: 'touch',
      clientX: 50,
    });
    firePointer(thumbEl, 'pointermove', {
      pointerType: 'touch',
      clientX: 62,
    });
    // pointerup target is imgEl — closest('.card') should resolve to cardEl
    firePointer(imgEl, 'pointerup', {
      pointerType: 'touch',
      clientX: 62,
    });

    // Click should be suppressed on the resolved cardEl
    const clickHandler = vi.fn();
    cardEl.addEventListener('click', clickHandler);
    cardEl.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );
    expect(clickHandler).not.toHaveBeenCalled();
  });

  it('ignores mouse pointer events', () => {
    setupTouchScrubbing({
      thumbEl,
      imgEl,
      cardEl,
      imageUrls,
      signal: controller.signal,
      preloadSignal: controller.signal,
      preloadGuard,
      brokenHandler,
    });

    firePointer(thumbEl, 'pointerdown', {
      pointerType: 'mouse',
      clientX: 50,
    });
    firePointer(thumbEl, 'pointermove', {
      pointerType: 'mouse',
      clientX: 62,
    });

    expect(thumbEl.classList.contains('scrub-hover')).toBe(false);
    expect(preloadImageBatch).not.toHaveBeenCalled();
  });
});

// ── observeThumbnailReset / unobserveThumbnailReset ───────────────────────

describe('observeThumbnailReset / unobserveThumbnailReset', () => {
  let thumbEl: HTMLElement;
  let imgEl: HTMLImageElement;
  let imageUrls: string[];
  let mockObserve: Mock;
  let mockUnobserve: Mock;
  let ioCallback: IntersectionObserverCallback;

  beforeEach(() => {
    thumbEl = document.createElement('div');
    imgEl = document.createElement('img');
    patchObsidianMethods(imgEl);
    imageUrls = ['/img/first.jpg', '/img/second.jpg'];
    vi.mocked(getCachedBlobUrl).mockImplementation((url) => url);

    mockObserve = vi.fn();
    mockUnobserve = vi.fn();

    // Capture the IO callback so we can fire it manually
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: IntersectionObserverCallback) {
          ioCallback = cb;
        }
        observe = mockObserve;
        unobserve = mockUnobserve;
        disconnect = vi.fn();
      }
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('processes ALL entries in batch (not just first)', () => {
    const thumbEl2 = document.createElement('div');
    const imgEl2 = document.createElement('img');
    patchObsidianMethods(imgEl2);
    const urls2 = ['/img/x.jpg', '/img/y.jpg'];

    observeThumbnailReset(thumbEl, imgEl, imageUrls);
    observeThumbnailReset(thumbEl2, imgEl2, urls2);

    // Simulate both going out of view
    ioCallback(
      [
        { target: thumbEl, isIntersecting: false } as any,
        { target: thumbEl2, isIntersecting: false } as any,
      ],
      {} as any
    );

    // Simulate both coming back
    ioCallback(
      [
        { target: thumbEl, isIntersecting: true } as any,
        { target: thumbEl2, isIntersecting: true } as any,
      ],
      {} as any
    );

    expect(imgEl.src).toContain('/img/first.jpg');
    expect(imgEl2.src).toContain('/img/x.jpg');
  });

  it('resets image on re-entry after being hidden', () => {
    observeThumbnailReset(thumbEl, imgEl, imageUrls);

    // Go out of view
    ioCallback([{ target: thumbEl, isIntersecting: false } as any], {} as any);

    // Come back into view
    ioCallback([{ target: thumbEl, isIntersecting: true } as any], {} as any);

    expect(imgEl.src).toContain('/img/first.jpg');
    expect(imgEl.classList.contains('scrub-loading')).toBe(false);
  });

  it('does not reset on first intersection (was never hidden)', () => {
    observeThumbnailReset(thumbEl, imgEl, imageUrls);

    ioCallback([{ target: thumbEl, isIntersecting: true } as any], {} as any);

    // src should still be empty — no reset triggered
    expect(imgEl.src).toBe('');
  });

  it('clears dataset.scrubbedSrc on reset', () => {
    thumbEl.dataset.scrubbedSrc = '/img/second.jpg';
    observeThumbnailReset(thumbEl, imgEl, imageUrls);

    ioCallback([{ target: thumbEl, isIntersecting: false } as any], {} as any);
    ioCallback([{ target: thumbEl, isIntersecting: true } as any], {} as any);

    expect(thumbEl.dataset.scrubbedSrc).toBeUndefined();
  });

  it('unobserveThumbnailReset removes state so IO callback is a no-op', () => {
    observeThumbnailReset(thumbEl, imgEl, imageUrls);
    unobserveThumbnailReset(thumbEl);

    // IO callback for unobserved element should be a no-op since state was deleted
    ioCallback([{ target: thumbEl, isIntersecting: false } as any], {} as any);
    ioCallback([{ target: thumbEl, isIntersecting: true } as any], {} as any);

    // imgEl.src should remain empty since state was deleted
    expect(imgEl.src).toBe('');
  });
});
