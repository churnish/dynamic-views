import { vi } from 'vitest';
import { applyPerParagraphClamp } from '../../src/core/text-preview-dom';

vi.mock('../../src/utils/owner-window', () => ({
  getOwnerWindow: () => window,
}));

vi.mock('../../src/core/text-preview-dom', () => ({
  applyPerParagraphClamp: vi.fn(),
}));

import {
  handlePosterTapReveal,
  clipPosterStaticOverflow,
  resetPosterClipping,
  resetPosterScroll,
} from '../../src/core/poster';

// ---------------------------------------------------------------------------
// Globals — Obsidian API shim
// ---------------------------------------------------------------------------

beforeAll(() => {
  HTMLElement.prototype.setCssProps = function (props: Record<string, string>) {
    for (const [key, value] of Object.entries(props)) {
      this.style.setProperty(key, value);
    }
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCardWithPoster(revealed = false): HTMLElement {
  const container = document.createElement('div');
  container.className = 'dynamic-views';
  const card = document.createElement('div');
  card.className = 'card';
  if (revealed) card.classList.add('poster-revealed');
  const poster = document.createElement('div');
  poster.className = 'card-poster';
  card.appendChild(poster);
  container.appendChild(card);
  document.body.appendChild(container);
  return card;
}

function makeCardNoPoster(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'dynamic-views';
  const card = document.createElement('div');
  card.className = 'card';
  container.appendChild(card);
  document.body.appendChild(container);
  return card;
}

function makeMouseEvent(target: HTMLElement): MouseEvent {
  const e = new MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'target', { value: target });
  vi.spyOn(e, 'preventDefault');
  vi.spyOn(e, 'stopPropagation');
  return e;
}

function mockRect(el: HTMLElement, rect: Partial<DOMRect>): void {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => {},
    ...rect,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  // Clean up DOM between tests
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// handlePosterTapReveal
// ---------------------------------------------------------------------------

describe('handlePosterTapReveal', () => {
  describe('reveal', () => {
    it('adds poster-revealed + interact', () => {
      const card = makeCardWithPoster(false);
      const e = makeMouseEvent(card);

      handlePosterTapReveal(e, card, 'default');

      expect(card.classList.contains('poster-revealed')).toBe(true);
      expect(card.classList.contains('interact')).toBe(true);
    });

    it('calls preventDefault + stopPropagation', () => {
      const card = makeCardWithPoster(false);
      const e = makeMouseEvent(card);

      handlePosterTapReveal(e, card, 'default');

      expect(e.preventDefault).toHaveBeenCalled();
      expect(e.stopPropagation).toHaveBeenCalled();
    });

    it('dismisses previously revealed card in same view', () => {
      const card1 = makeCardWithPoster(true);
      card1.classList.add('interact');
      const container = card1.parentElement!;

      // Second card in the same container
      const card2 = document.createElement('div');
      card2.className = 'card';
      const poster2 = document.createElement('div');
      poster2.className = 'card-poster';
      card2.appendChild(poster2);
      container.appendChild(card2);

      const e = makeMouseEvent(card2);
      handlePosterTapReveal(e, card2, 'default');

      // card1 should be dismissed
      expect(card1.classList.contains('poster-revealed')).toBe(false);
      expect(card1.classList.contains('interact')).toBe(false);
      // card2 should be revealed
      expect(card2.classList.contains('poster-revealed')).toBe(true);
    });

    it('returns true', () => {
      const card = makeCardWithPoster(false);
      const e = makeMouseEvent(card);

      expect(handlePosterTapReveal(e, card, 'default')).toBe(true);
    });
  });

  describe('dismiss', () => {
    it('removes poster-revealed + interact when clicking non-interactive area', () => {
      const card = makeCardWithPoster(true);
      card.classList.add('interact');
      const e = makeMouseEvent(card);
      vi.spyOn(window, 'getSelection').mockReturnValue({
        toString: () => '',
      } as Selection);

      handlePosterTapReveal(e, card, 'default');

      expect(card.classList.contains('poster-revealed')).toBe(false);
      expect(card.classList.contains('interact')).toBe(false);
    });

    it('calls stopPropagation but not preventDefault', () => {
      const card = makeCardWithPoster(true);
      card.classList.add('interact');
      const e = makeMouseEvent(card);
      vi.spyOn(window, 'getSelection').mockReturnValue({
        toString: () => '',
      } as Selection);

      handlePosterTapReveal(e, card, 'default');

      expect(e.stopPropagation).toHaveBeenCalled();
      expect(e.preventDefault).not.toHaveBeenCalled();
    });

    it('returns true', () => {
      const card = makeCardWithPoster(true);
      card.classList.add('interact');
      const e = makeMouseEvent(card);
      vi.spyOn(window, 'getSelection').mockReturnValue({
        toString: () => '',
      } as Selection);

      expect(handlePosterTapReveal(e, card, 'default')).toBe(true);
    });
  });

  describe('passthrough', () => {
    it('returns false when no .card-poster element', () => {
      const card = makeCardNoPoster();
      const e = makeMouseEvent(card);

      expect(handlePosterTapReveal(e, card, 'default')).toBe(false);
    });

    it('returns false when clicking interactive element (a)', () => {
      const card = makeCardWithPoster(true);
      card.classList.add('interact');
      const link = document.createElement('a');
      card.appendChild(link);
      const e = makeMouseEvent(link);

      expect(handlePosterTapReveal(e, card, 'default')).toBe(false);
    });

    it('returns false when clicking interactive element (button)', () => {
      const card = makeCardWithPoster(true);
      card.classList.add('interact');
      const button = document.createElement('button');
      card.appendChild(button);
      const e = makeMouseEvent(button);

      expect(handlePosterTapReveal(e, card, 'default')).toBe(false);
    });

    it('returns false when clicking .tag element', () => {
      const card = makeCardWithPoster(true);
      card.classList.add('interact');
      const tag = document.createElement('span');
      tag.className = 'tag';
      card.appendChild(tag);
      const e = makeMouseEvent(tag);

      expect(handlePosterTapReveal(e, card, 'default')).toBe(false);
    });

    it('returns false when clicking .clickable-icon element', () => {
      const card = makeCardWithPoster(true);
      card.classList.add('interact');
      const icon = document.createElement('span');
      icon.className = 'clickable-icon';
      card.appendChild(icon);
      const e = makeMouseEvent(icon);

      expect(handlePosterTapReveal(e, card, 'default')).toBe(false);
    });

    it('returns false when text is selected', () => {
      const card = makeCardWithPoster(true);
      card.classList.add('interact');
      const e = makeMouseEvent(card);
      vi.spyOn(window, 'getSelection').mockReturnValue({
        toString: () => 'selected text',
      } as Selection);

      expect(handlePosterTapReveal(e, card, 'default')).toBe(false);
    });

    it('returns false on text-target with openFileAction title', () => {
      const card = makeCardWithPoster(true);
      card.classList.add('interact');
      const subtitle = document.createElement('div');
      subtitle.className = 'card-subtitle';
      card.appendChild(subtitle);
      const e = makeMouseEvent(subtitle);
      vi.spyOn(window, 'getSelection').mockReturnValue({
        toString: () => '',
      } as Selection);

      expect(handlePosterTapReveal(e, card, 'title')).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// resetPosterClipping
// ---------------------------------------------------------------------------

describe('resetPosterClipping', () => {
  it('removes poster-clip-hidden from all matching elements', () => {
    const card = document.createElement('div');
    const child1 = document.createElement('div');
    child1.classList.add('poster-clip-hidden');
    const child2 = document.createElement('div');
    child2.classList.add('poster-clip-hidden');
    card.appendChild(child1);
    card.appendChild(child2);

    resetPosterClipping(card);

    expect(child1.classList.contains('poster-clip-hidden')).toBe(false);
    expect(child2.classList.contains('poster-clip-hidden')).toBe(false);
  });

  it('resets text preview CSS variable', () => {
    const card = document.createElement('div');
    const textPreview = document.createElement('div');
    textPreview.className = 'card-text-preview';
    textPreview.style.setProperty('--dynamic-views-text-preview-lines', '3');
    card.appendChild(textPreview);

    resetPosterClipping(card);

    expect(
      textPreview.style.getPropertyValue('--dynamic-views-text-preview-lines')
    ).toBe('');
  });

  it('calls applyPerParagraphClamp when has-paragraphs class present', () => {
    const card = document.createElement('div');
    const textPreview = document.createElement('div');
    textPreview.className = 'card-text-preview has-paragraphs';
    card.appendChild(textPreview);

    resetPosterClipping(card);

    expect(applyPerParagraphClamp).toHaveBeenCalledWith(textPreview);
  });

  it('does not call applyPerParagraphClamp without has-paragraphs class', () => {
    const card = document.createElement('div');
    const textPreview = document.createElement('div');
    textPreview.className = 'card-text-preview';
    card.appendChild(textPreview);

    resetPosterClipping(card);

    expect(applyPerParagraphClamp).not.toHaveBeenCalled();
  });

  it('resets title CSS variable', () => {
    const card = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'card-title';
    title.style.setProperty('--dynamic-views-title-lines', '1');
    card.appendChild(title);

    resetPosterClipping(card);

    expect(title.style.getPropertyValue('--dynamic-views-title-lines')).toBe(
      ''
    );
  });

  it('resets subtitle CSS variable + removes poster-clip-clamped class', () => {
    const card = document.createElement('div');
    const subtitle = document.createElement('div');
    subtitle.className = 'card-subtitle poster-clip-clamped';
    subtitle.style.setProperty('--dynamic-views-subtitle-lines', '1');
    card.appendChild(subtitle);

    resetPosterClipping(card);

    expect(
      subtitle.style.getPropertyValue('--dynamic-views-subtitle-lines')
    ).toBe('');
    expect(subtitle.classList.contains('poster-clip-clamped')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// clipPosterStaticOverflow
// ---------------------------------------------------------------------------

describe('clipPosterStaticOverflow', () => {
  it('early return: no card-content', () => {
    const card = document.createElement('div');
    card.classList.add('has-poster');

    // Should not throw
    clipPosterStaticOverflow(card);
  });

  it('early return: no has-poster class', () => {
    const card = document.createElement('div');
    const content = document.createElement('div');
    content.className = 'card-content';
    card.appendChild(content);

    clipPosterStaticOverflow(card);

    // No elements should be hidden
    expect(card.querySelector('.poster-clip-hidden')).toBeNull();
  });

  it('early return: no overflow (scrollHeight <= clientHeight)', () => {
    const card = document.createElement('div');
    card.classList.add('has-poster');
    const content = document.createElement('div');
    content.className = 'card-content';
    Object.defineProperty(content, 'scrollHeight', {
      value: 100,
      configurable: true,
    });
    Object.defineProperty(content, 'clientHeight', {
      value: 100,
      configurable: true,
    });
    card.appendChild(content);

    clipPosterStaticOverflow(card);

    expect(card.querySelector('.poster-clip-hidden')).toBeNull();
  });

  it('hides fully-overflowing elements via poster-clip-hidden', () => {
    const card = document.createElement('div');
    card.classList.add('has-poster');
    const content = document.createElement('div');
    content.className = 'card-content';
    Object.defineProperty(content, 'scrollHeight', {
      value: 500,
      configurable: true,
    });
    Object.defineProperty(content, 'clientHeight', {
      value: 200,
      configurable: true,
    });
    // clipBottom = 0 (content top) + 200 (clientHeight) = 200
    mockRect(content, { top: 0, bottom: 200, height: 200 });

    const header = document.createElement('div');
    header.className = 'card-header';
    const subtitle = document.createElement('div');
    subtitle.className = 'card-subtitle';
    // Fully below clipBottom
    mockRect(subtitle, { top: 220, bottom: 240 });
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      lineHeight: '20px',
      transitionDuration: '0.3s',
    } as unknown as CSSStyleDeclaration);
    header.appendChild(subtitle);
    content.appendChild(header);

    const propsBottom = document.createElement('div');
    propsBottom.className = 'card-properties-bottom';
    const propChild = document.createElement('div');
    propChild.className = 'property-row';
    // Fully below clipBottom
    mockRect(propChild, { top: 250, bottom: 270 });
    propsBottom.appendChild(propChild);
    content.appendChild(propsBottom);

    card.appendChild(content);

    clipPosterStaticOverflow(card);

    expect(subtitle.classList.contains('poster-clip-hidden')).toBe(true);
    expect(propChild.classList.contains('poster-clip-hidden')).toBe(true);
  });

  it('clamps partially-visible text preview via CSS variable', () => {
    const card = document.createElement('div');
    card.classList.add('has-poster');
    const content = document.createElement('div');
    content.className = 'card-content';
    Object.defineProperty(content, 'scrollHeight', {
      value: 500,
      configurable: true,
    });
    Object.defineProperty(content, 'clientHeight', {
      value: 200,
      configurable: true,
    });
    // clipBottom = 0 + 200 = 200
    mockRect(content, { top: 0, bottom: 200, height: 200 });

    const textWrapper = document.createElement('div');
    textWrapper.className = 'card-text-preview-wrapper';
    // Partially visible: top 150, bottom 250 (50px available)
    mockRect(textWrapper, { top: 150, bottom: 250 });

    const textPreview = document.createElement('div');
    textPreview.className = 'card-text-preview';
    textWrapper.appendChild(textPreview);
    content.appendChild(textWrapper);

    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      lineHeight: '20px',
      transitionDuration: '0.3s',
    } as unknown as CSSStyleDeclaration);

    card.appendChild(content);

    clipPosterStaticOverflow(card);

    // 50px available / 20px line height = 2 lines
    expect(
      textPreview.style.getPropertyValue('--dynamic-views-text-preview-lines')
    ).toBe('2');
    // Should NOT be hidden
    expect(textWrapper.classList.contains('poster-clip-hidden')).toBe(false);
  });

  it('clamps partially-visible subtitle with poster-clip-clamped class', () => {
    const card = document.createElement('div');
    card.classList.add('has-poster');
    const content = document.createElement('div');
    content.className = 'card-content';
    Object.defineProperty(content, 'scrollHeight', {
      value: 500,
      configurable: true,
    });
    Object.defineProperty(content, 'clientHeight', {
      value: 200,
      configurable: true,
    });
    // clipBottom = 0 + 200 = 200
    mockRect(content, { top: 0, bottom: 200, height: 200 });

    const header = document.createElement('div');
    header.className = 'card-header';
    const subtitle = document.createElement('div');
    subtitle.className = 'card-subtitle';
    // Partially visible: top 160, bottom 220 (40px available)
    mockRect(subtitle, { top: 160, bottom: 220 });
    header.appendChild(subtitle);
    content.appendChild(header);

    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      lineHeight: '20px',
      transitionDuration: '0.3s',
    } as unknown as CSSStyleDeclaration);

    card.appendChild(content);

    clipPosterStaticOverflow(card);

    // 40px / 20px = 2 lines
    expect(
      subtitle.style.getPropertyValue('--dynamic-views-subtitle-lines')
    ).toBe('2');
    expect(subtitle.classList.contains('poster-clip-clamped')).toBe(true);
    expect(subtitle.classList.contains('poster-clip-hidden')).toBe(false);
  });

  it('clears previous clip state before re-clipping', () => {
    const card = document.createElement('div');
    card.classList.add('has-poster');
    const content = document.createElement('div');
    content.className = 'card-content';
    Object.defineProperty(content, 'scrollHeight', {
      value: 500,
      configurable: true,
    });
    Object.defineProperty(content, 'clientHeight', {
      value: 200,
      configurable: true,
    });
    mockRect(content, { top: 0, bottom: 200, height: 200 });

    const header = document.createElement('div');
    header.className = 'card-header';
    const title = document.createElement('div');
    title.className = 'card-title';
    title.style.setProperty('--dynamic-views-title-lines', '1');
    mockRect(title, { top: 0, bottom: 40 });
    header.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.className = 'card-subtitle';
    subtitle.classList.add('poster-clip-clamped');
    subtitle.style.setProperty('--dynamic-views-subtitle-lines', '1');
    mockRect(subtitle, { top: 40, bottom: 60 });
    header.appendChild(subtitle);
    content.appendChild(header);

    const textWrapper = document.createElement('div');
    textWrapper.className = 'card-text-preview-wrapper';
    mockRect(textWrapper, { top: 60, bottom: 120 });
    const textPreview = document.createElement('div');
    textPreview.className = 'card-text-preview';
    textPreview.style.setProperty('--dynamic-views-text-preview-lines', '2');
    textWrapper.appendChild(textPreview);
    content.appendChild(textWrapper);

    // Stale hidden element from a previous clamp
    const staleHidden = document.createElement('div');
    staleHidden.classList.add('poster-clip-hidden');
    content.appendChild(staleHidden);

    card.appendChild(content);

    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      lineHeight: '20px',
      transitionDuration: '0.3s',
    } as unknown as CSSStyleDeclaration);

    clipPosterStaticOverflow(card);

    // Stale state should be cleared
    expect(staleHidden.classList.contains('poster-clip-hidden')).toBe(false);
    expect(title.style.getPropertyValue('--dynamic-views-title-lines')).toBe(
      ''
    );
    expect(subtitle.classList.contains('poster-clip-clamped')).toBe(false);
    expect(
      subtitle.style.getPropertyValue('--dynamic-views-subtitle-lines')
    ).toBe('');
    expect(
      textPreview.style.getPropertyValue('--dynamic-views-text-preview-lines')
    ).toBe('');
  });

  it('clamps overflowing title via CSS variable', () => {
    const card = document.createElement('div');
    card.classList.add('has-poster');
    const content = document.createElement('div');
    content.className = 'card-content';
    Object.defineProperty(content, 'scrollHeight', {
      value: 500,
      configurable: true,
    });
    Object.defineProperty(content, 'clientHeight', {
      value: 100,
      configurable: true,
    });
    // clipBottom = 0 + 100 = 100
    mockRect(content, { top: 0, bottom: 100, height: 100 });

    const title = document.createElement('div');
    title.className = 'card-title';
    // Title overflows: top 0, bottom 120
    mockRect(title, { top: 0, bottom: 120 });
    content.appendChild(title);

    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      lineHeight: '24px',
      transitionDuration: '0.3s',
    } as unknown as CSSStyleDeclaration);

    card.appendChild(content);

    clipPosterStaticOverflow(card);

    // 100px available / 24px = 4 lines
    expect(title.style.getPropertyValue('--dynamic-views-title-lines')).toBe(
      '4'
    );
  });
});

// ---------------------------------------------------------------------------
// resetPosterScroll
// ---------------------------------------------------------------------------

describe('resetPosterScroll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resets scrollTop on transitionend from contentEl', () => {
    const card = document.createElement('div');
    const content = document.createElement('div');
    content.className = 'card-content';
    card.appendChild(content);

    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      transitionDuration: '0.3s',
    } as unknown as CSSStyleDeclaration);

    Object.defineProperty(content, 'scrollTop', {
      value: 150,
      writable: true,
      configurable: true,
    });

    resetPosterScroll(card);

    // Fire transitionend on contentEl itself
    const event = new Event('transitionend', { bubbles: true });
    Object.defineProperty(event, 'target', { value: content });
    content.dispatchEvent(event);

    expect(content.scrollTop).toBe(0);
  });

  it('resets scrollLeft on property wrappers', () => {
    const card = document.createElement('div');
    const content = document.createElement('div');
    content.className = 'card-content';
    const wrapper1 = document.createElement('div');
    wrapper1.className = 'property-content-wrapper';
    const wrapper2 = document.createElement('div');
    wrapper2.className = 'property-content-wrapper';
    card.appendChild(content);
    card.appendChild(wrapper1);
    card.appendChild(wrapper2);

    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      transitionDuration: '0.3s',
    } as unknown as CSSStyleDeclaration);

    Object.defineProperty(wrapper1, 'scrollLeft', {
      value: 50,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(wrapper2, 'scrollLeft', {
      value: 80,
      writable: true,
      configurable: true,
    });

    resetPosterScroll(card);

    // Fire transitionend
    const event = new Event('transitionend', { bubbles: true });
    Object.defineProperty(event, 'target', { value: content });
    content.dispatchEvent(event);

    expect(wrapper1.scrollLeft).toBe(0);
    expect(wrapper2.scrollLeft).toBe(0);
  });

  it('ignores transitionend from child elements', () => {
    const card = document.createElement('div');
    const content = document.createElement('div');
    content.className = 'card-content';
    const child = document.createElement('div');
    content.appendChild(child);
    card.appendChild(content);

    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      transitionDuration: '0.3s',
    } as unknown as CSSStyleDeclaration);

    Object.defineProperty(content, 'scrollTop', {
      value: 100,
      writable: true,
      configurable: true,
    });

    resetPosterScroll(card);

    // Fire transitionend from child (bubbles up)
    const childEvent = new Event('transitionend', { bubbles: true });
    Object.defineProperty(childEvent, 'target', { value: child });
    content.dispatchEvent(childEvent);

    // scrollTop should NOT be reset — wrong target
    expect(content.scrollTop).toBe(100);
  });

  it('falls back to timeout when transitionend does not fire', () => {
    const card = document.createElement('div');
    const content = document.createElement('div');
    content.className = 'card-content';
    card.appendChild(content);

    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      transitionDuration: '0.3s',
    } as unknown as CSSStyleDeclaration);

    Object.defineProperty(content, 'scrollTop', {
      value: 100,
      writable: true,
      configurable: true,
    });

    resetPosterScroll(card);

    // No transitionend fired — advance to fallback timeout (300ms + 50ms = 350ms)
    vi.advanceTimersByTime(350);

    expect(content.scrollTop).toBe(0);
  });

  it('uses 350ms fallback when transitionDuration parse fails', () => {
    const card = document.createElement('div');
    const content = document.createElement('div');
    content.className = 'card-content';
    card.appendChild(content);

    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      transitionDuration: 'invalid',
    } as unknown as CSSStyleDeclaration);

    Object.defineProperty(content, 'scrollTop', {
      value: 100,
      writable: true,
      configurable: true,
    });

    resetPosterScroll(card);

    vi.advanceTimersByTime(349);
    expect(content.scrollTop).toBe(100);

    vi.advanceTimersByTime(1);
    expect(content.scrollTop).toBe(0);
  });

  it('only fires reset once (settled guard prevents double-fire)', () => {
    const card = document.createElement('div');
    const content = document.createElement('div');
    content.className = 'card-content';
    card.appendChild(content);

    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      transitionDuration: '0.3s',
    } as unknown as CSSStyleDeclaration);

    let scrollTopValue = 100;
    Object.defineProperty(content, 'scrollTop', {
      get: () => scrollTopValue,
      set: (v: number) => {
        scrollTopValue = v;
      },
      configurable: true,
    });

    resetPosterScroll(card);

    // Fire transitionend — first reset
    const event = new Event('transitionend', { bubbles: true });
    Object.defineProperty(event, 'target', { value: content });
    content.dispatchEvent(event);
    expect(scrollTopValue).toBe(0);

    // Set scrollTop back to non-zero to detect a second reset
    scrollTopValue = 999;

    // Advance past fallback timeout
    vi.advanceTimersByTime(500);

    // Should NOT have been reset again — settled guard prevents it
    expect(scrollTopValue).toBe(999);
  });

  it('is a no-op when card has no .card-content', () => {
    const card = document.createElement('div');

    // Should not throw
    resetPosterScroll(card);
  });
});
