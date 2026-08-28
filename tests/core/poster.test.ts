import { vi } from 'vitest';
import {
  applyParagraphClamp,
  clearParagraphClampState,
  measureParagraphClamp,
} from '../../src/core/text-preview-dom';

vi.mock('../../src/utils/owner-window', () => ({
  getOwnerWindow: () => window,
}));

// Paragraph clamping is stubbed here so poster clip decisions can be asserted in
// isolation. Real-clamp integration lives in poster-paragraph-clamp.test.ts.
vi.mock('../../src/core/text-preview-dom', () => ({
  clearParagraphClampState: vi.fn(() => []),
  measureParagraphClamp: vi.fn(() => null),
  applyParagraphClamp: vi.fn(),
}));

import {
  handlePosterTapReveal,
  clipPosterStaticOverflow,
  clipPosterStaticOverflowBatch,
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

/**
 * Stubs getComputedStyle with plain style props plus a getPropertyValue backed by
 * `cssVars`. jsdom does not inherit custom properties, so container-level line-count
 * caps can only be supplied through this stub.
 */
function mockComputedStyle(
  props: Record<string, string>,
  cssVars: Record<string, string> = {}
): void {
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    ...props,
    getPropertyValue: (name: string) => cssVars[name] ?? '',
  } as unknown as CSSStyleDeclaration);
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

      handlePosterTapReveal(e, card, false);

      expect(card.classList.contains('poster-revealed')).toBe(true);
      expect(card.classList.contains('interact')).toBe(true);
    });

    it('calls preventDefault + stopPropagation', () => {
      const card = makeCardWithPoster(false);
      const e = makeMouseEvent(card);

      handlePosterTapReveal(e, card, false);

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
      handlePosterTapReveal(e, card2, false);

      // card1 should be dismissed
      expect(card1.classList.contains('poster-revealed')).toBe(false);
      expect(card1.classList.contains('interact')).toBe(false);
      // card2 should be revealed
      expect(card2.classList.contains('poster-revealed')).toBe(true);
    });

    it('returns true', () => {
      const card = makeCardWithPoster(false);
      const e = makeMouseEvent(card);

      expect(handlePosterTapReveal(e, card, false)).toBe(true);
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

      handlePosterTapReveal(e, card, false);

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

      handlePosterTapReveal(e, card, false);

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

      expect(handlePosterTapReveal(e, card, false)).toBe(true);
    });
  });

  describe('passthrough', () => {
    it('returns false when no .card-poster element', () => {
      const card = makeCardNoPoster();
      const e = makeMouseEvent(card);

      expect(handlePosterTapReveal(e, card, false)).toBe(false);
    });

    it('returns false when clicking interactive element (a)', () => {
      const card = makeCardWithPoster(true);
      card.classList.add('interact');
      const link = document.createElement('a');
      card.appendChild(link);
      const e = makeMouseEvent(link);

      expect(handlePosterTapReveal(e, card, false)).toBe(false);
    });

    it('returns false when clicking interactive element (button)', () => {
      const card = makeCardWithPoster(true);
      card.classList.add('interact');
      const button = document.createElement('button');
      card.appendChild(button);
      const e = makeMouseEvent(button);

      expect(handlePosterTapReveal(e, card, false)).toBe(false);
    });

    it('returns false when clicking .tag element', () => {
      const card = makeCardWithPoster(true);
      card.classList.add('interact');
      const tag = document.createElement('span');
      tag.className = 'tag';
      card.appendChild(tag);
      const e = makeMouseEvent(tag);

      expect(handlePosterTapReveal(e, card, false)).toBe(false);
    });

    it('returns false when clicking .clickable-icon element', () => {
      const card = makeCardWithPoster(true);
      card.classList.add('interact');
      const icon = document.createElement('span');
      icon.className = 'clickable-icon';
      card.appendChild(icon);
      const e = makeMouseEvent(icon);

      expect(handlePosterTapReveal(e, card, false)).toBe(false);
    });

    it('returns false when text is selected', () => {
      const card = makeCardWithPoster(true);
      card.classList.add('interact');
      const e = makeMouseEvent(card);
      vi.spyOn(window, 'getSelection').mockReturnValue({
        toString: () => 'selected text',
      } as Selection);

      expect(handlePosterTapReveal(e, card, false)).toBe(false);
    });

    it('returns false on text-target with open-on-title', () => {
      const card = makeCardWithPoster(true);
      card.classList.add('interact');
      const subtitle = document.createElement('div');
      subtitle.className = 'card-subtitle';
      card.appendChild(subtitle);
      const e = makeMouseEvent(subtitle);
      vi.spyOn(window, 'getSelection').mockReturnValue({
        toString: () => '',
      } as Selection);

      expect(handlePosterTapReveal(e, card, true)).toBe(false);
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

    resetPosterClipping([card]);

    expect(child1.classList.contains('poster-clip-hidden')).toBe(false);
    expect(child2.classList.contains('poster-clip-hidden')).toBe(false);
  });

  it('resets text preview CSS variable', () => {
    const card = document.createElement('div');
    const textPreview = document.createElement('div');
    textPreview.className = 'card-text-preview';
    textPreview.style.setProperty('--dynamic-views-text-preview-lines', '3');
    card.appendChild(textPreview);

    resetPosterClipping([card]);

    expect(
      textPreview.style.getPropertyValue('--dynamic-views-text-preview-lines')
    ).toBe('');
  });

  it('clears then re-clamps paragraphs when has-paragraphs class present', () => {
    const card = document.createElement('div');
    const textPreview = document.createElement('div');
    textPreview.className = 'card-text-preview has-paragraphs';
    card.appendChild(textPreview);

    const paragraphs = [document.createElement('p')];
    vi.mocked(clearParagraphClampState).mockReturnValueOnce(paragraphs);
    const measurement = {
      paragraphs,
      lineHeight: 20,
      budget: 5,
      heights: [20],
    };
    vi.mocked(measureParagraphClamp).mockReturnValueOnce(measurement);

    resetPosterClipping([card]);

    expect(clearParagraphClampState).toHaveBeenCalledWith(textPreview);
    expect(measureParagraphClamp).toHaveBeenCalledWith(textPreview, paragraphs);
    expect(applyParagraphClamp).toHaveBeenCalledWith(measurement);
  });

  it('does not touch paragraphs without has-paragraphs class', () => {
    const card = document.createElement('div');
    const textPreview = document.createElement('div');
    textPreview.className = 'card-text-preview';
    card.appendChild(textPreview);

    resetPosterClipping([card]);

    expect(clearParagraphClampState).not.toHaveBeenCalled();
    expect(applyParagraphClamp).not.toHaveBeenCalled();
  });

  it('clears every card before measuring any of them', () => {
    const makeCard = () => {
      const card = document.createElement('div');
      const textPreview = document.createElement('div');
      textPreview.className = 'card-text-preview has-paragraphs';
      card.appendChild(textPreview);
      return card;
    };

    const order: string[] = [];
    vi.mocked(clearParagraphClampState).mockImplementation(() => {
      order.push('clear');
      return [document.createElement('p')];
    });
    vi.mocked(measureParagraphClamp).mockImplementation(() => {
      order.push('measure');
      return null;
    });

    resetPosterClipping([makeCard(), makeCard()]);

    expect(order).toEqual(['clear', 'clear', 'measure', 'measure']);
  });

  it('resets title CSS variable', () => {
    const card = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'card-title';
    title.style.setProperty('--dynamic-views-title-lines', '1');
    card.appendChild(title);

    resetPosterClipping([card]);

    expect(title.style.getPropertyValue('--dynamic-views-title-lines')).toBe(
      ''
    );
  });

  it('resets subtitle CSS variable', () => {
    const card = document.createElement('div');
    const subtitle = document.createElement('div');
    subtitle.className = 'card-subtitle';
    subtitle.style.setProperty('--dynamic-views-subtitle-lines', '1');
    card.appendChild(subtitle);

    resetPosterClipping([card]);

    expect(
      subtitle.style.getPropertyValue('--dynamic-views-subtitle-lines')
    ).toBe('');
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
    mockComputedStyle({
      lineHeight: '20px',
      transitionDuration: '0.3s',
    });
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

    mockComputedStyle({
      lineHeight: '20px',
      transitionDuration: '0.3s',
    });

    card.appendChild(content);

    clipPosterStaticOverflow(card);

    // 50px available / 20px line height = 2 lines
    expect(
      textPreview.style.getPropertyValue('--dynamic-views-text-preview-lines')
    ).toBe('2');
    // Should NOT be hidden
    expect(textWrapper.classList.contains('poster-clip-hidden')).toBe(false);
  });

  it('clamps partially-visible subtitle via CSS variable instead of hiding it', () => {
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

    mockComputedStyle({
      lineHeight: '20px',
      transitionDuration: '0.3s',
    });

    card.appendChild(content);

    clipPosterStaticOverflow(card);

    // 40px / 20px = 2 lines
    expect(
      subtitle.style.getPropertyValue('--dynamic-views-subtitle-lines')
    ).toBe('2');
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

    mockComputedStyle({
      lineHeight: '20px',
      transitionDuration: '0.3s',
    });

    clipPosterStaticOverflow(card);

    // Stale state should be cleared
    expect(staleHidden.classList.contains('poster-clip-hidden')).toBe(false);
    expect(title.style.getPropertyValue('--dynamic-views-title-lines')).toBe(
      ''
    );
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

    mockComputedStyle({
      lineHeight: '24px',
      transitionDuration: '0.3s',
    });

    card.appendChild(content);

    clipPosterStaticOverflow(card);

    // 100px available / 24px = 4 lines
    expect(title.style.getPropertyValue('--dynamic-views-title-lines')).toBe(
      '4'
    );
  });
});

// ---------------------------------------------------------------------------
// Inherited line-count cap
// ---------------------------------------------------------------------------

describe('clipPosterStaticOverflow — inherited line-count cap', () => {
  /** Title overflows by 20px inside a .dynamic-views container. 100px / 24px = 4 lines fit. */
  function makeTitleOverflowCard(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'dynamic-views';

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
    mockRect(content, { top: 0, bottom: 100, height: 100 });

    const title = document.createElement('div');
    title.className = 'card-title';
    mockRect(title, { top: 0, bottom: 120 });
    content.appendChild(title);

    card.appendChild(content);
    container.appendChild(card);
    document.body.appendChild(container);
    return card;
  }

  function titleLinesOf(card: HTMLElement): string {
    return card
      .querySelector<HTMLElement>('.card-title')!
      .style.getPropertyValue('--dynamic-views-title-lines');
  }

  it('cap below the fitted count wins', () => {
    const card = makeTitleOverflowCard();
    mockComputedStyle(
      { lineHeight: '24px', transitionDuration: '0.3s' },
      { '--dynamic-views-title-lines': '2' }
    );

    clipPosterStaticOverflow(card);

    expect(titleLinesOf(card)).toBe('2');
  });

  it('fitted count wins when the cap is higher', () => {
    const card = makeTitleOverflowCard();
    mockComputedStyle(
      { lineHeight: '24px', transitionDuration: '0.3s' },
      { '--dynamic-views-title-lines': '8' }
    );

    clipPosterStaticOverflow(card);

    expect(titleLinesOf(card)).toBe('4');
  });

  it('fitted count wins when the cap is absent', () => {
    const card = makeTitleOverflowCard();
    mockComputedStyle({ lineHeight: '24px', transitionDuration: '0.3s' });

    clipPosterStaticOverflow(card);

    expect(titleLinesOf(card)).toBe('4');
  });

  it('fitted count wins when the cap is unparseable', () => {
    const card = makeTitleOverflowCard();
    mockComputedStyle(
      { lineHeight: '24px', transitionDuration: '0.3s' },
      { '--dynamic-views-title-lines': 'auto' }
    );

    clipPosterStaticOverflow(card);

    expect(titleLinesOf(card)).toBe('4');
  });

  /** Subtitle overflows by 20px inside a .dynamic-views container. 40px / 20px = 2 lines fit. */
  function makeSubtitleOverflowCard(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'dynamic-views';

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
    const subtitle = document.createElement('div');
    subtitle.className = 'card-subtitle';
    mockRect(subtitle, { top: 160, bottom: 220 });
    header.appendChild(subtitle);
    content.appendChild(header);

    card.appendChild(content);
    container.appendChild(card);
    document.body.appendChild(container);
    return card;
  }

  function subtitleLinesOf(card: HTMLElement): string {
    return card
      .querySelector<HTMLElement>('.card-subtitle')!
      .style.getPropertyValue('--dynamic-views-subtitle-lines');
  }

  // The subtitle is the one capped element whose cap can bind — the title and text
  // preview are already bounded before measurement, so their caps only harden.
  it('subtitle cap below the fitted count wins', () => {
    const card = makeSubtitleOverflowCard();
    mockComputedStyle(
      { lineHeight: '20px', transitionDuration: '0.3s' },
      { '--dynamic-views-subtitle-lines': '1' }
    );

    clipPosterStaticOverflow(card);

    expect(subtitleLinesOf(card)).toBe('1');
  });

  it('subtitle fitted count wins when the cap is higher', () => {
    const card = makeSubtitleOverflowCard();
    mockComputedStyle(
      { lineHeight: '20px', transitionDuration: '0.3s' },
      { '--dynamic-views-subtitle-lines': '5' }
    );

    clipPosterStaticOverflow(card);

    expect(subtitleLinesOf(card)).toBe('2');
  });

  it('subtitle fitted count wins when the cap is absent', () => {
    const card = makeSubtitleOverflowCard();
    mockComputedStyle({ lineHeight: '20px', transitionDuration: '0.3s' });

    clipPosterStaticOverflow(card);

    expect(subtitleLinesOf(card)).toBe('2');
  });

  it('subtitle fitted count wins when the cap is unparseable', () => {
    const card = makeSubtitleOverflowCard();
    mockComputedStyle(
      { lineHeight: '20px', transitionDuration: '0.3s' },
      { '--dynamic-views-subtitle-lines': 'auto' }
    );

    clipPosterStaticOverflow(card);

    expect(subtitleLinesOf(card)).toBe('2');
  });

  it('still reduces the text preview clamp when a cap is present', () => {
    const container = document.createElement('div');
    container.className = 'dynamic-views';

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

    const textWrapper = document.createElement('div');
    textWrapper.className = 'card-text-preview-wrapper';
    // Partially visible: 50px available / 20px line height = 2 lines
    mockRect(textWrapper, { top: 150, bottom: 250 });
    const textPreview = document.createElement('div');
    textPreview.className = 'card-text-preview';
    textWrapper.appendChild(textPreview);
    content.appendChild(textWrapper);

    card.appendChild(content);
    container.appendChild(card);
    document.body.appendChild(container);

    mockComputedStyle(
      { lineHeight: '20px', transitionDuration: '0.3s' },
      { '--dynamic-views-text-preview-lines': '5' }
    );

    clipPosterStaticOverflow(card);

    expect(
      textPreview.style.getPropertyValue('--dynamic-views-text-preview-lines')
    ).toBe('2');
    expect(textWrapper.classList.contains('poster-clip-hidden')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// clipPosterStaticOverflowBatch
// ---------------------------------------------------------------------------

describe('clipPosterStaticOverflowBatch', () => {
  it('clips multiple cards in one pass', () => {
    function makePosterCardWithOverflow(): HTMLElement {
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

      const propsBottom = document.createElement('div');
      propsBottom.className = 'card-properties-bottom';
      const propChild = document.createElement('div');
      propChild.className = 'property-row';
      mockRect(propChild, { top: 250, bottom: 270 });
      propsBottom.appendChild(propChild);
      content.appendChild(propsBottom);
      card.appendChild(content);

      return card;
    }

    mockComputedStyle({
      lineHeight: '20px',
      transitionDuration: '0.3s',
    });

    const card1 = makePosterCardWithOverflow();
    const card2 = makePosterCardWithOverflow();

    clipPosterStaticOverflowBatch([card1, card2]);

    expect(card1.querySelector('.poster-clip-hidden')).toBeTruthy();
    expect(card2.querySelector('.poster-clip-hidden')).toBeTruthy();
  });

  it('handles empty array without throwing', () => {
    expect(() => clipPosterStaticOverflowBatch([])).not.toThrow();
  });

  it('reads the container line caps once for cards sharing a container', () => {
    const container = document.createElement('div');
    container.className = 'dynamic-views';
    document.body.appendChild(container);

    const makeCard = () => {
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
      const title = document.createElement('div');
      title.className = 'card-title';
      mockRect(title, { top: 0, bottom: 240 });
      content.appendChild(title);
      card.appendChild(content);
      container.appendChild(card);
      return card;
    };

    const cards = [makeCard(), makeCard(), makeCard()];
    const computedStyle = vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      lineHeight: '20px',
      getPropertyValue: () => '2',
    } as unknown as CSSStyleDeclaration);

    clipPosterStaticOverflowBatch(cards);

    const containerReads = computedStyle.mock.calls.filter(
      ([el]) => el === container
    );
    expect(containerReads).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// content-hidden guard
// ---------------------------------------------------------------------------

describe('clipPosterStaticOverflow — content-hidden cards', () => {
  it('skips a content-hidden card without reading its geometry', () => {
    const card = document.createElement('div');
    card.classList.add('has-poster', 'content-hidden');

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
    const contentRect = vi.spyOn(content, 'getBoundingClientRect');

    const propsBottom = document.createElement('div');
    propsBottom.className = 'card-properties-bottom';
    const propChild = document.createElement('div');
    // Stale clip state from a previous pass — must survive the skip
    propChild.className = 'property-row poster-clip-hidden';
    propsBottom.appendChild(propChild);
    content.appendChild(propsBottom);
    card.appendChild(content);

    clipPosterStaticOverflow(card);

    expect(contentRect).not.toHaveBeenCalled();
    expect(propChild.classList.contains('poster-clip-hidden')).toBe(true);
  });

  it('skips content-hidden cards inside a batch but clips the rest', () => {
    const makeCard = (hidden: boolean) => {
      const card = document.createElement('div');
      card.classList.add('has-poster');
      if (hidden) card.classList.add('content-hidden');
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
      const propsBottom = document.createElement('div');
      propsBottom.className = 'card-properties-bottom';
      const propChild = document.createElement('div');
      propChild.className = 'property-row';
      mockRect(propChild, { top: 250, bottom: 270 });
      propsBottom.appendChild(propChild);
      content.appendChild(propsBottom);
      card.appendChild(content);
      return card;
    };

    mockComputedStyle({ lineHeight: '20px', transitionDuration: '0.3s' });
    const hiddenCard = makeCard(true);
    const visibleCard = makeCard(false);

    clipPosterStaticOverflowBatch([hiddenCard, visibleCard]);

    expect(hiddenCard.querySelector('.poster-clip-hidden')).toBeNull();
    expect(visibleCard.querySelector('.poster-clip-hidden')).toBeTruthy();
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

    mockComputedStyle({ transitionDuration: '0.3s' });

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

    mockComputedStyle({ transitionDuration: '0.3s' });

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

    mockComputedStyle({ transitionDuration: '0.3s' });

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

    mockComputedStyle({ transitionDuration: '0.3s' });

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

    mockComputedStyle({ transitionDuration: 'invalid' });

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

    mockComputedStyle({ transitionDuration: '0.3s' });

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
