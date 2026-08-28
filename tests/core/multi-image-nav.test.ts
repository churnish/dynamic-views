import { vi, type Mock } from 'vitest';

// Mock slideshow before importing the module under test
vi.mock('../../src/core/slideshow', () => ({
  getCachedBlobUrl: vi.fn((url: string) => url),
  preloadImageBatch: vi.fn(),
}));

// Mock image-loader
vi.mock('../../src/core/image-loader', () => ({
  markImageBroken: vi.fn(),
}));

import {
  computeScrubIndex,
  applyScrubImage,
  setupTouchSwipeNavigation,
  observeScrubReset,
  unobserveScrubReset,
} from '../../src/core/multi-image-nav';
import { getCachedBlobUrl, preloadImageBatch } from '../../src/core/slideshow';

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

/** Create a dual-image thumbnail DOM matching shared-renderer output. */
function createDualImageThumb(): {
  thumbEl: HTMLElement;
  currImg: HTMLImageElement;
  nextImg: HTMLImageElement;
  cardEl: HTMLElement;
} {
  const thumbEl = document.createElement('div');
  const embedContainer = document.createElement('div');
  embedContainer.classList.add('dynamic-views-image-embed');
  thumbEl.appendChild(embedContainer);

  const currImg = document.createElement('img');
  currImg.classList.add('slideshow-img', 'slideshow-img-current');
  patchObsidianMethods(currImg);
  embedContainer.appendChild(currImg);

  const nextImg = document.createElement('img');
  nextImg.classList.add('slideshow-img', 'slideshow-img-next');
  patchObsidianMethods(nextImg);
  embedContainer.appendChild(nextImg);

  const cardEl = document.createElement('div');
  cardEl.classList.add('card');
  cardEl.appendChild(thumbEl);
  document.body.appendChild(cardEl);

  return { thumbEl, currImg, nextImg, cardEl };
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

// ── setupTouchSwipeNavigation ─────────────────────────────────────────────

describe('setupTouchSwipeNavigation', () => {
  let thumbEl: HTMLElement;
  let currImg: HTMLImageElement;
  let nextImg: HTMLImageElement;
  let cardEl: HTMLElement;
  let imageUrls: string[];
  let controller: AbortController;
  let preloadGuard: { done: boolean };
  let brokenHandler: Mock;

  beforeEach(() => {
    vi.useFakeTimers();
    ({ thumbEl, currImg, nextImg, cardEl } = createDualImageThumb());

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
    vi.useRealTimers();
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it('triggers preload on first touch pointerdown', () => {
    setupTouchSwipeNavigation({
      scrubEl: thumbEl,
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
    setupTouchSwipeNavigation({
      scrubEl: thumbEl,
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
    setupTouchSwipeNavigation({
      scrubEl: thumbEl,
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
    // Negative delta (left swipe) — advances to next image (natural scrolling)
    firePointer(thumbEl, 'pointermove', {
      pointerType: 'touch',
      clientX: 38,
    });

    expect(thumbEl.classList.contains('scrub-hover')).toBe(true);
  });

  it('does NOT enter scrub mode when vertical movement dominates', () => {
    setupTouchSwipeNavigation({
      scrubEl: thumbEl,
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
      clientY: 10,
    });
    // deltaX=5, deltaY=15 — vertical dominates → direction locked to vertical
    firePointer(thumbEl, 'pointermove', {
      pointerType: 'touch',
      clientX: 55,
      clientY: 25,
    });

    expect(thumbEl.classList.contains('scrub-hover')).toBe(false);
    // No animation classes on children
    const imgs = thumbEl.querySelectorAll('.slideshow-img');
    for (const img of imgs) {
      expect(img.classList.contains('slideshow-exit-left')).toBe(false);
      expect(img.classList.contains('slideshow-exit-right')).toBe(false);
      expect(img.classList.contains('slideshow-enter-left')).toBe(false);
      expect(img.classList.contains('slideshow-enter-right')).toBe(false);
    }

    // Subsequent horizontal move past threshold — STILL no scrub (locked to vertical)
    firePointer(thumbEl, 'pointermove', {
      pointerType: 'touch',
      clientX: 70,
      clientY: 30,
    });

    expect(thumbEl.classList.contains('scrub-hover')).toBe(false);
  });

  it('does NOT enter scrub mode on pointermove < 10px delta', () => {
    setupTouchSwipeNavigation({
      scrubEl: thumbEl,
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

  it('fires onFrameChange exactly once for a committed swipe', () => {
    const onFrameChange = vi.fn();
    setupTouchSwipeNavigation({
      scrubEl: thumbEl,
      cardEl,
      imageUrls,
      signal: controller.signal,
      preloadSignal: controller.signal,
      preloadGuard,
      brokenHandler,
      onFrameChange,
    });

    firePointer(thumbEl, 'pointerdown', {
      pointerType: 'touch',
      clientX: 50,
    });
    firePointer(thumbEl, 'pointermove', {
      pointerType: 'touch',
      clientX: 38,
    });

    expect(onFrameChange).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire onFrameChange below the movement threshold', () => {
    const onFrameChange = vi.fn();
    setupTouchSwipeNavigation({
      scrubEl: thumbEl,
      cardEl,
      imageUrls,
      signal: controller.signal,
      preloadSignal: controller.signal,
      preloadGuard,
      brokenHandler,
      onFrameChange,
    });

    firePointer(thumbEl, 'pointerdown', {
      pointerType: 'touch',
      clientX: 50,
    });
    firePointer(thumbEl, 'pointermove', {
      pointerType: 'touch',
      clientX: 55,
    });

    expect(onFrameChange).not.toHaveBeenCalled();
  });

  it('applies animation classes on swipe (left swipe → exit-left + enter-left = next)', () => {
    setupTouchSwipeNavigation({
      scrubEl: thumbEl,
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
    // Left swipe (negative delta) → next image (natural scrolling)
    firePointer(thumbEl, 'pointermove', {
      pointerType: 'touch',
      clientX: 38,
    });

    expect(currImg.classList.contains('slideshow-exit-left')).toBe(true);
    expect(nextImg.classList.contains('slideshow-enter-left')).toBe(true);
    expect(nextImg.src).toContain('/img/b.jpg');
  });

  it('applies correct direction for right swipe (exit-right + enter-right = previous)', () => {
    // Advance to index 1 first via left swipe
    setupTouchSwipeNavigation({
      scrubEl: thumbEl,
      cardEl,
      imageUrls,
      signal: controller.signal,
      preloadSignal: controller.signal,
      preloadGuard,
      brokenHandler,
    });

    // Left swipe to advance to index 1
    firePointer(thumbEl, 'pointerdown', {
      pointerType: 'touch',
      clientX: 50,
    });
    firePointer(thumbEl, 'pointermove', {
      pointerType: 'touch',
      clientX: 38,
    });
    firePointer(thumbEl, 'pointerup', { pointerType: 'touch' });

    // Finish animation to swap roles
    vi.runAllTimers();

    // Right swipe to go back — re-query after role swap
    const newCurr = thumbEl.querySelector<HTMLImageElement>(
      '.slideshow-img-current'
    )!;
    const newNext = thumbEl.querySelector<HTMLImageElement>(
      '.slideshow-img-next'
    )!;

    firePointer(thumbEl, 'pointerdown', {
      pointerType: 'touch',
      clientX: 50,
    });
    // Positive delta → previous image
    firePointer(thumbEl, 'pointermove', {
      pointerType: 'touch',
      clientX: 62,
    });

    expect(newCurr.classList.contains('slideshow-exit-right')).toBe(true);
    expect(newNext.classList.contains('slideshow-enter-right')).toBe(true);
  });

  it('cancel-and-restart: finishes previous animation before starting new one', () => {
    setupTouchSwipeNavigation({
      scrubEl: thumbEl,
      cardEl,
      imageUrls,
      signal: controller.signal,
      preloadSignal: controller.signal,
      preloadGuard,
      brokenHandler,
    });

    // First swipe (left — advance)
    firePointer(thumbEl, 'pointerdown', {
      pointerType: 'touch',
      clientX: 50,
    });
    firePointer(thumbEl, 'pointermove', {
      pointerType: 'touch',
      clientX: 38,
    });
    firePointer(thumbEl, 'pointerup', { pointerType: 'touch' });

    // Animation is in progress — exit-left on currImg
    expect(currImg.classList.contains('slideshow-exit-left')).toBe(true);

    // Second swipe (left again) — should cancel first and start new
    firePointer(thumbEl, 'pointerdown', {
      pointerType: 'touch',
      clientX: 50,
    });
    firePointer(thumbEl, 'pointermove', {
      pointerType: 'touch',
      clientX: 38,
    });

    // After cancel-and-restart, roles should have swapped (finishSlideAnimation ran)
    // The new current img should now have the exit class
    const newCurr = thumbEl.querySelector<HTMLImageElement>(
      '.slideshow-img-current'
    )!;
    const newNext = thumbEl.querySelector<HTMLImageElement>(
      '.slideshow-img-next'
    )!;
    expect(newCurr.classList.contains('slideshow-exit-left')).toBe(true);
    expect(newNext.classList.contains('slideshow-enter-left')).toBe(true);
  });

  it('suppresses click after scrub on pointerup', () => {
    setupTouchSwipeNavigation({
      scrubEl: thumbEl,
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
    setupTouchSwipeNavigation({
      scrubEl: thumbEl,
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

  it('click suppressor expires after 300ms (does not eat next deliberate tap)', () => {
    setupTouchSwipeNavigation({
      scrubEl: thumbEl,
      cardEl,
      imageUrls,
      signal: controller.signal,
      preloadSignal: controller.signal,
      preloadGuard,
      brokenHandler,
    });

    // Horizontal swipe to enter scrub mode
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

    // Wait for click suppressor to expire
    vi.advanceTimersByTime(301);

    // Next click should NOT be suppressed
    const clickHandler = vi.fn();
    cardEl.addEventListener('click', clickHandler);
    cardEl.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );
    expect(clickHandler).toHaveBeenCalledTimes(1);
  });

  it('cleans up on pointercancel', () => {
    setupTouchSwipeNavigation({
      scrubEl: thumbEl,
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

  it('ignores mouse pointer events', () => {
    setupTouchSwipeNavigation({
      scrubEl: thumbEl,
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

  it('reset function cancels animation, resets index, and restores images', () => {
    const reset = setupTouchSwipeNavigation({
      scrubEl: thumbEl,
      cardEl,
      imageUrls,
      signal: controller.signal,
      preloadSignal: controller.signal,
      preloadGuard,
      brokenHandler,
    });

    // Swipe to advance
    firePointer(thumbEl, 'pointerdown', {
      pointerType: 'touch',
      clientX: 50,
    });
    firePointer(thumbEl, 'pointermove', {
      pointerType: 'touch',
      clientX: 62,
    });

    // Animation is in progress
    thumbEl.dataset.scrubbedSrc = '/img/b.jpg';

    // Call reset
    reset();

    // After reset: current img shows first URL, scrubbedSrc cleared
    const curr = thumbEl.querySelector<HTMLImageElement>(
      '.slideshow-img-current'
    )!;
    expect(curr.src).toContain('/img/a.jpg');
    expect(thumbEl.dataset.scrubbedSrc).toBeUndefined();
    // Animation classes removed
    expect(curr.classList.contains('slideshow-exit-right')).toBe(false);
    expect(curr.classList.contains('slideshow-exit-left')).toBe(false);
  });

  it('signal abort mid-scrub restores scroll-locked and removes scrub-hover', () => {
    // Create a .bases-view parent element and append thumbEl inside it
    const basesView = document.createElement('div');
    basesView.classList.add('bases-view');
    basesView.appendChild(cardEl); // cardEl already contains thumbEl
    document.body.appendChild(basesView);

    const reset = setupTouchSwipeNavigation({
      scrubEl: thumbEl,
      cardEl,
      imageUrls,
      signal: controller.signal,
      preloadSignal: controller.signal,
      preloadGuard,
      brokenHandler,
    });

    // Enter scrub mode via horizontal swipe
    firePointer(thumbEl, 'pointerdown', {
      pointerType: 'touch',
      clientX: 50,
    });
    firePointer(thumbEl, 'pointermove', {
      pointerType: 'touch',
      clientX: 38,
    });

    expect(thumbEl.classList.contains('scrub-hover')).toBe(true);
    expect(basesView.classList.contains('dynamic-views-scroll-locked')).toBe(
      true
    );

    // Call reset mid-scrub
    reset();

    expect(thumbEl.classList.contains('scrub-hover')).toBe(false);
    expect(basesView.classList.contains('dynamic-views-scroll-locked')).toBe(
      false
    );
  });

  it('wraps from last to first on left swipe at end (looping default)', () => {
    imageUrls = ['/img/a.jpg', '/img/b.jpg'];
    setupTouchSwipeNavigation({
      scrubEl: thumbEl,
      cardEl,
      imageUrls,
      signal: controller.signal,
      preloadSignal: controller.signal,
      preloadGuard,
      brokenHandler,
    });

    // Left swipe → advance to index 1
    firePointer(thumbEl, 'pointerdown', {
      pointerType: 'touch',
      clientX: 50,
    });
    firePointer(thumbEl, 'pointermove', {
      pointerType: 'touch',
      clientX: 38,
    });
    firePointer(thumbEl, 'pointerup', { pointerType: 'touch' });
    vi.runAllTimers();

    // Now at index 1 (last). Left swipe again — should wrap to 0
    firePointer(thumbEl, 'pointerdown', {
      pointerType: 'touch',
      clientX: 50,
    });
    firePointer(thumbEl, 'pointermove', {
      pointerType: 'touch',
      clientX: 38,
    });

    // Animation should fire (wrapping to first image)
    const curr = thumbEl.querySelector<HTMLImageElement>(
      '.slideshow-img-current'
    )!;
    expect(curr.classList.contains('slideshow-exit-left')).toBe(true);
  });

  it('sets dataset.scrubbedSrc after animation completes', () => {
    setupTouchSwipeNavigation({
      scrubEl: thumbEl,
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
      clientX: 38,
    });

    // scrubbedSrc not set during animation
    expect(thumbEl.dataset.scrubbedSrc).toBeUndefined();

    vi.runAllTimers();

    // Set after animation finishes
    expect(thumbEl.dataset.scrubbedSrc).toBe('/img/b.jpg');
  });

  it('swaps roles and clears src on timeout completion', () => {
    setupTouchSwipeNavigation({
      scrubEl: thumbEl,
      cardEl,
      imageUrls,
      signal: controller.signal,
      preloadSignal: controller.signal,
      preloadGuard,
      brokenHandler,
    });

    // Left swipe to advance
    firePointer(thumbEl, 'pointerdown', {
      pointerType: 'touch',
      clientX: 50,
    });
    firePointer(thumbEl, 'pointermove', {
      pointerType: 'touch',
      clientX: 38,
    });

    // Before timeout: currImg is still "current"
    expect(currImg.classList.contains('slideshow-img-current')).toBe(true);
    expect(nextImg.classList.contains('slideshow-img-next')).toBe(true);

    // After timeout: roles swapped
    vi.runAllTimers();

    expect(currImg.classList.contains('slideshow-img-next')).toBe(true);
    expect(nextImg.classList.contains('slideshow-img-current')).toBe(true);
    // Animation classes removed
    expect(currImg.classList.contains('slideshow-exit-left')).toBe(false);
    expect(nextImg.classList.contains('slideshow-enter-left')).toBe(false);
  });
});

// ── observeScrubReset / unobserveScrubReset ───────────────────────

describe('observeScrubReset / unobserveScrubReset', () => {
  let thumbEl: HTMLElement;
  let mockObserve: Mock;
  let mockUnobserve: Mock;
  let ioCallback: IntersectionObserverCallback;

  beforeEach(() => {
    thumbEl = document.createElement('div');
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

  it('calls onReset when re-entering after being hidden', () => {
    const onReset = vi.fn();
    observeScrubReset(thumbEl, onReset);

    // Go out of view
    ioCallback([{ target: thumbEl, isIntersecting: false } as any], {} as any);

    // Come back into view
    ioCallback([{ target: thumbEl, isIntersecting: true } as any], {} as any);

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('does not call onReset on first intersection (was never hidden)', () => {
    const onReset = vi.fn();
    observeScrubReset(thumbEl, onReset);

    ioCallback([{ target: thumbEl, isIntersecting: true } as any], {} as any);

    expect(onReset).not.toHaveBeenCalled();
  });

  it('processes ALL entries in batch (not just first)', () => {
    const thumbEl2 = document.createElement('div');
    const onReset1 = vi.fn();
    const onReset2 = vi.fn();

    observeScrubReset(thumbEl, onReset1);
    observeScrubReset(thumbEl2, onReset2);

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

    expect(onReset1).toHaveBeenCalledTimes(1);
    expect(onReset2).toHaveBeenCalledTimes(1);
  });

  it('unobserveScrubReset removes state so IO callback is a no-op', () => {
    const onReset = vi.fn();
    observeScrubReset(thumbEl, onReset);
    unobserveScrubReset(thumbEl);

    // IO callback for unobserved element should be a no-op since state was deleted
    ioCallback([{ target: thumbEl, isIntersecting: false } as any], {} as any);
    ioCallback([{ target: thumbEl, isIntersecting: true } as any], {} as any);

    expect(onReset).not.toHaveBeenCalled();
  });
});
