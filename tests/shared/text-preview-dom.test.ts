import {
  updateTextPreviewDOM,
  setPreviewContent,
  applyPerParagraphClamp,
} from '../../src/shared/text-preview-dom';

// ---------------------------------------------------------------------------
// Helpers — build minimal card DOM fixtures
// ---------------------------------------------------------------------------

/** Minimal card element with a .card-body but no previews wrapper. */
function makeEmptyCard(): HTMLElement {
  const card = document.createElement('div');
  const body = document.createElement('div');
  body.className = 'card-body';
  const bottomProps = document.createElement('div');
  bottomProps.className = 'card-properties-bottom';
  body.appendChild(bottomProps);
  card.appendChild(body);
  return card;
}

/**
 * Card with an existing text preview already rendered.
 * Optionally also includes a thumbnail so we can test the thumbnail-sibling
 * branches.
 */
function makeCardWithText(text: string, withThumbnail = false): HTMLElement {
  const card = makeEmptyCard();
  const body = card.querySelector('.card-body') as HTMLElement;

  const previewsWrapper = document.createElement('div');
  previewsWrapper.className = 'card-previews';

  const textWrapper = document.createElement('div');
  textWrapper.className = 'card-text-preview-wrapper';
  const textEl = document.createElement('div');
  textEl.className = 'card-text-preview';
  textEl.textContent = text;
  textWrapper.appendChild(textEl);
  previewsWrapper.appendChild(textWrapper);

  if (withThumbnail) {
    const thumb = document.createElement('div');
    thumb.className = 'card-thumbnail';
    previewsWrapper.appendChild(thumb);
  }

  const bottomProps = body.querySelector('.card-properties-bottom');
  body.insertBefore(previewsWrapper, bottomProps);

  return card;
}

/** Card whose .card-previews wrapper contains only a thumbnail (no text yet). */
function makeCardWithThumbnailOnly(): HTMLElement {
  const card = makeEmptyCard();
  const body = card.querySelector('.card-body') as HTMLElement;

  const previewsWrapper = document.createElement('div');
  previewsWrapper.className = 'card-previews';
  const thumb = document.createElement('div');
  thumb.className = 'card-thumbnail';
  previewsWrapper.appendChild(thumb);

  const bottomProps = body.querySelector('.card-properties-bottom');
  body.insertBefore(previewsWrapper, bottomProps);

  return card;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('updateTextPreviewDOM', () => {
  // Case 1 ----------------------------------------------------------------
  it('updates textContent of existing .card-text-preview in place', () => {
    const card = makeCardWithText('old text');

    updateTextPreviewDOM(card, 'new text');

    const textEl = card.querySelector('.card-text-preview');
    expect(textEl).not.toBeNull();
    expect(textEl!.textContent).toBe('new text');
    // Wrapper structure should be unchanged — no duplicate elements
    expect(card.querySelectorAll('.card-text-preview').length).toBe(1);
    expect(card.querySelectorAll('.card-previews').length).toBe(1);
  });

  // Case 2 ----------------------------------------------------------------
  it('prepends text wrapper before thumbnail when previews wrapper exists but has no text', () => {
    const card = makeCardWithThumbnailOnly();

    updateTextPreviewDOM(card, 'hello');

    const previewsEl = card.querySelector('.card-previews')!;
    const textEl = card.querySelector('.card-text-preview');
    const thumb = card.querySelector('.card-thumbnail');

    expect(textEl).not.toBeNull();
    expect(textEl!.textContent).toBe('hello');
    // Text wrapper must come before the thumbnail inside .card-previews
    expect(
      previewsEl.firstElementChild!.classList.contains(
        'card-text-preview-wrapper'
      )
    ).toBe(true);
    expect(
      previewsEl.lastElementChild!.classList.contains('card-thumbnail')
    ).toBe(true);
    // Thumbnail must still be present
    expect(thumb).not.toBeNull();
  });

  // Case 3 ----------------------------------------------------------------
  it('creates full previews wrapper and inserts it before .card-properties-bottom', () => {
    const card = makeEmptyCard();

    updateTextPreviewDOM(card, 'brand new');

    const previewsEl = card.querySelector('.card-previews');
    const textWrapper = card.querySelector('.card-text-preview-wrapper');
    const textEl = card.querySelector('.card-text-preview');
    const body = card.querySelector('.card-body')!;
    const bottomProps = card.querySelector('.card-properties-bottom')!;

    expect(previewsEl).not.toBeNull();
    expect(textWrapper).not.toBeNull();
    expect(textEl).not.toBeNull();
    expect(textEl!.textContent).toBe('brand new');
    // Previews wrapper must appear before .card-properties-bottom in the DOM
    const children = Array.from(body.children);
    expect(children.indexOf(previewsEl as Element)).toBeLessThan(
      children.indexOf(bottomProps)
    );
  });

  it('appends previews wrapper to .card-body when no .card-properties-bottom exists', () => {
    // Card without a .card-properties-bottom
    const card = document.createElement('div');
    const body = document.createElement('div');
    body.className = 'card-body';
    card.appendChild(body);

    updateTextPreviewDOM(card, 'appended');

    const previewsEl = card.querySelector('.card-previews');
    expect(previewsEl).not.toBeNull();
    expect(card.querySelector('.card-text-preview')!.textContent).toBe(
      'appended'
    );
    // Wrapper should be the last child of body
    expect(body.lastElementChild).toBe(previewsEl);
  });

  // Case 4 ----------------------------------------------------------------
  it('removes only the text wrapper when thumbnail is still present (text → empty)', () => {
    const card = makeCardWithText('some text', /* withThumbnail */ true);

    updateTextPreviewDOM(card, '');

    // Text elements must be gone
    expect(card.querySelector('.card-text-preview')).toBeNull();
    expect(card.querySelector('.card-text-preview-wrapper')).toBeNull();
    // Previews wrapper and thumbnail must survive
    expect(card.querySelector('.card-previews')).not.toBeNull();
    expect(card.querySelector('.card-thumbnail')).not.toBeNull();
  });

  // Case 5 ----------------------------------------------------------------
  it('removes entire previews wrapper when no thumbnail is present (text → empty)', () => {
    const card = makeCardWithText('going away');

    updateTextPreviewDOM(card, '');

    expect(card.querySelector('.card-previews')).toBeNull();
    expect(card.querySelector('.card-text-preview-wrapper')).toBeNull();
    expect(card.querySelector('.card-text-preview')).toBeNull();
  });

  // Case 6 ----------------------------------------------------------------
  it('is a no-op when text is empty and no previews wrapper exists', () => {
    const card = makeEmptyCard();
    const bodyBefore = card.innerHTML;

    updateTextPreviewDOM(card, '');

    // DOM should be completely unchanged
    expect(card.innerHTML).toBe(bodyBefore);
    expect(card.querySelector('.card-previews')).toBeNull();
  });

  // preserveNewlines mode ---------------------------------------------------
  describe('preserveNewlines mode', () => {
    afterEach(() => {
      document.body.classList.remove(
        'dynamic-views-text-preview-keep-newlines'
      );
    });

    it('creates <p> elements when body class is set and text has paragraph breaks', () => {
      document.body.classList.add('dynamic-views-text-preview-keep-newlines');
      const card = makeEmptyCard();

      updateTextPreviewDOM(card, 'Para one\n\nPara two\n\nPara three');

      const textEl = card.querySelector('.card-text-preview')!;
      const paragraphs = textEl.querySelectorAll('p');
      expect(paragraphs.length).toBe(3);
      expect(paragraphs[0].textContent).toBe('Para one');
      expect(paragraphs[1].textContent).toBe('Para two');
      expect(paragraphs[2].textContent).toBe('Para three');
    });

    it('creates <p> elements when text has only single newlines', () => {
      document.body.classList.add('dynamic-views-text-preview-keep-newlines');
      const card = makeEmptyCard();

      updateTextPreviewDOM(card, 'Line one\nLine two');

      const textEl = card.querySelector('.card-text-preview')!;
      const paragraphs = textEl.querySelectorAll('p');
      // Single newlines — no split on \n\n, so one <p> with full text
      expect(paragraphs.length).toBe(1);
      expect(paragraphs[0].textContent).toBe('Line one\nLine two');
    });

    it('uses plain textContent when text has no newlines', () => {
      document.body.classList.add('dynamic-views-text-preview-keep-newlines');
      const card = makeEmptyCard();

      updateTextPreviewDOM(card, 'No newlines here');

      const textEl = card.querySelector('.card-text-preview')!;
      expect(textEl.querySelectorAll('p').length).toBe(0);
      expect(textEl.textContent).toBe('No newlines here');
    });

    it('uses plain textContent when body class is absent', () => {
      const card = makeEmptyCard();

      updateTextPreviewDOM(card, 'Para one\n\nPara two');

      const textEl = card.querySelector('.card-text-preview')!;
      expect(textEl.querySelectorAll('p').length).toBe(0);
      expect(textEl.textContent).toBe('Para one\n\nPara two');
    });

    it('replaces <p> elements with plain textContent when class is removed', () => {
      document.body.classList.add('dynamic-views-text-preview-keep-newlines');
      const card = makeEmptyCard();

      // First call — creates <p> elements
      updateTextPreviewDOM(card, 'Para one\n\nPara two');
      expect(
        card.querySelector('.card-text-preview')!.querySelectorAll('p').length
      ).toBe(2);

      // Remove class, update again
      document.body.classList.remove(
        'dynamic-views-text-preview-keep-newlines'
      );
      updateTextPreviewDOM(card, 'Plain text now');

      const textEl = card.querySelector('.card-text-preview')!;
      expect(textEl.querySelectorAll('p').length).toBe(0);
      expect(textEl.textContent).toBe('Plain text now');
    });
  });
});

// ---------------------------------------------------------------------------
// applyPerParagraphClamp
// ---------------------------------------------------------------------------

/**
 * Build a .card-text-preview element with <p> children.
 * Uses mock offsetHeight and getComputedStyle since jsdom has no layout engine.
 */
function makePreviewWithParagraphs(
  paragraphHeights: number[],
  lineHeight: number,
  budget: number
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'card-text-preview';

  for (const h of paragraphHeights) {
    const p = document.createElement('p');
    p.textContent = 'x'.repeat(10);
    // jsdom has no layout — mock offsetHeight via defineProperty
    Object.defineProperty(p, 'offsetHeight', { value: h, configurable: true });
    el.appendChild(p);
  }

  // Mock getComputedStyle for the preview element
  const originalGetComputedStyle = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation((target) => {
    if (target === el) {
      return {
        lineHeight: `${lineHeight}px`,
        getPropertyValue: (prop: string) => {
          if (prop === '--dynamic-views-text-preview-lines')
            return String(budget);
          return '';
        },
      } as unknown as CSSStyleDeclaration;
    }
    return originalGetComputedStyle(target);
  });

  return el;
}

describe('applyPerParagraphClamp', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing when there are no <p> children', () => {
    const el = document.createElement('div');
    el.className = 'card-text-preview';
    el.textContent = 'plain text';

    applyPerParagraphClamp(el);

    // No changes — textContent intact, no style mutations
    expect(el.textContent).toBe('plain text');
  });

  it('does not clamp when all paragraphs fit within budget', () => {
    // 3 paragraphs, each 1 line (20px / 20px = 1 line)
    // Budget: 5 lines → used: 1 + 1(margin) + 1 + 1(margin) + 1 = 5 → fits exactly
    const el = makePreviewWithParagraphs([20, 20, 20], 20, 5);
    const paragraphs = el.querySelectorAll('p');

    applyPerParagraphClamp(el);

    // No paragraph should be hidden or clamped
    for (const p of paragraphs) {
      expect(p.classList.contains('dynamic-views-para-clamped')).toBe(false);
      expect(p.classList.contains('dynamic-views-para-hidden')).toBe(false);
    }
  });

  it('clamps a single long paragraph that exceeds budget', () => {
    // 1 paragraph, 8 lines (160px / 20px), budget: 3
    const el = makePreviewWithParagraphs([160], 20, 3);
    const p = el.querySelector('p')!;

    applyPerParagraphClamp(el);

    expect(p.classList.contains('dynamic-views-para-clamped')).toBe(true);
    expect(p.style.getPropertyValue('-webkit-line-clamp')).toBe('3');
  });

  it('clamps the overflowing paragraph and hides subsequent ones', () => {
    // 3 paragraphs: 2 lines, 4 lines, 2 lines (at 20px line height)
    // Budget: 5
    // p0: 2 lines → used: 2
    // margin: +1 → used: 3
    // p1: 4 lines, remaining: 2 → overflow → clamp to 2, hide p2
    const el = makePreviewWithParagraphs([40, 80, 40], 20, 5);
    const paragraphs = el.querySelectorAll('p');

    applyPerParagraphClamp(el);

    // p0: no clamping
    expect(paragraphs[0].classList.contains('dynamic-views-para-clamped')).toBe(
      false
    );
    // p1: clamped to 2 lines
    expect(paragraphs[1].classList.contains('dynamic-views-para-clamped')).toBe(
      true
    );
    expect(paragraphs[1].style.getPropertyValue('-webkit-line-clamp')).toBe(
      '2'
    );
    // p2: hidden
    expect(paragraphs[2].classList.contains('dynamic-views-para-hidden')).toBe(
      true
    );
  });

  it('force-ellipsis when margin consumes budget with no remaining lines', () => {
    // 4 single-line paragraphs, budget: 3
    // p0: 1 line → used: 1
    // margin: +1 → used: 2
    // p1: 1 line → used: 3
    // p2: margin → used: 4, remaining: -1 → hide p2, p3
    // Post-step: p1 is last visible with hidden siblings → force-ellipsis
    const el = makePreviewWithParagraphs([20, 20, 20, 20], 20, 3);
    const paragraphs = el.querySelectorAll('p');

    applyPerParagraphClamp(el);

    expect(paragraphs[0].classList.contains('dynamic-views-para-clamped')).toBe(
      false
    );
    // p1: force-ellipsis (fits but has hidden siblings)
    expect(paragraphs[1].classList.contains('dynamic-views-para-clamped')).toBe(
      true
    );
    expect(paragraphs[1].style.getPropertyValue('-webkit-line-clamp')).toBe(
      '1'
    );
    expect(
      paragraphs[1].querySelector('.dynamic-views-truncation-indicator')
    ).not.toBeNull();
    expect(paragraphs[2].classList.contains('dynamic-views-para-hidden')).toBe(
      true
    );
    expect(paragraphs[3].classList.contains('dynamic-views-para-hidden')).toBe(
      true
    );
  });

  it('hides paragraph when margin consumes budget instead of removing margin', () => {
    // 4 single-line paragraphs, budget: 4
    // p0: 1 line → used: 1
    // margin: +1 → used: 2
    // p1: 1 line → used: 3
    // p2: margin → used: 4, remaining: 0 → hide p2, p3
    // Post-step: p1 is last visible with hidden siblings → force-ellipsis
    const el = makePreviewWithParagraphs([20, 20, 20, 20], 20, 4);
    const paragraphs = el.querySelectorAll('p');

    applyPerParagraphClamp(el);

    expect(paragraphs[0].classList.contains('dynamic-views-para-clamped')).toBe(
      false
    );
    // p1: force-ellipsis (fits but has hidden siblings)
    expect(paragraphs[1].classList.contains('dynamic-views-para-clamped')).toBe(
      true
    );
    expect(paragraphs[1].style.getPropertyValue('-webkit-line-clamp')).toBe(
      '1'
    );
    expect(
      paragraphs[1].querySelector('.dynamic-views-truncation-indicator')
    ).not.toBeNull();
    // p2, p3: hidden (margin would have collapsed spacing)
    expect(paragraphs[2].classList.contains('dynamic-views-para-hidden')).toBe(
      true
    );
    expect(paragraphs[3].classList.contains('dynamic-views-para-hidden')).toBe(
      true
    );
  });

  it('is idempotent — running twice produces same result', () => {
    const el = makePreviewWithParagraphs([40, 80, 40], 20, 5);

    applyPerParagraphClamp(el);

    // Capture state after first run
    const paragraphs = el.querySelectorAll('p');
    const firstRunStyles = Array.from(paragraphs).map((p) => ({
      clamped: p.classList.contains('dynamic-views-para-clamped'),
      hidden: p.classList.contains('dynamic-views-para-hidden'),
      clamp: p.style.getPropertyValue('-webkit-line-clamp'),
    }));

    // Second run with same fixed mocks — proves clearParagraphStyles + re-apply is stable
    applyPerParagraphClamp(el);

    const secondRunStyles = Array.from(paragraphs).map((p) => ({
      clamped: p.classList.contains('dynamic-views-para-clamped'),
      hidden: p.classList.contains('dynamic-views-para-hidden'),
      clamp: p.style.getPropertyValue('-webkit-line-clamp'),
    }));

    expect(secondRunStyles).toEqual(firstRunStyles);
  });

  it('clears stale state from a previous run', () => {
    // First run: budget 2 → clamp p0 to 2
    const el = makePreviewWithParagraphs([60, 40], 20, 2);
    const paragraphs = el.querySelectorAll('p');

    applyPerParagraphClamp(el);

    expect(paragraphs[0].classList.contains('dynamic-views-para-clamped')).toBe(
      true
    );
    expect(paragraphs[0].style.getPropertyValue('-webkit-line-clamp')).toBe(
      '2'
    );
    expect(paragraphs[1].classList.contains('dynamic-views-para-hidden')).toBe(
      true
    );

    // Simulate budget change: re-mock with budget 10
    vi.restoreAllMocks();
    const originalGetComputedStyle = window.getComputedStyle;
    vi.spyOn(window, 'getComputedStyle').mockImplementation((target) => {
      if (target === el) {
        return {
          lineHeight: '20px',
          getPropertyValue: (prop: string) => {
            if (prop === '--dynamic-views-text-preview-lines') return '10';
            return '';
          },
        } as unknown as CSSStyleDeclaration;
      }
      return originalGetComputedStyle(target);
    });

    applyPerParagraphClamp(el);

    // Stale styles should be cleared — all paragraphs fit now
    expect(paragraphs[0].classList.contains('dynamic-views-para-clamped')).toBe(
      false
    );
    expect(paragraphs[0].style.getPropertyValue('-webkit-line-clamp')).toBe('');
    expect(paragraphs[1].classList.contains('dynamic-views-para-hidden')).toBe(
      false
    );
  });
});

// ---------------------------------------------------------------------------
// setPreviewContent
// ---------------------------------------------------------------------------

describe('setPreviewContent', () => {
  function makePreviewEl(keepNewlines = false): HTMLElement {
    if (keepNewlines) {
      document.body.classList.add('dynamic-views-text-preview-keep-newlines');
    } else {
      document.body.classList.remove(
        'dynamic-views-text-preview-keep-newlines'
      );
    }
    const el = document.createElement('div');
    el.className = 'card-text-preview';
    return el;
  }

  afterEach(() => {
    document.body.classList.remove('dynamic-views-text-preview-keep-newlines');
  });

  it('sets plain text when keep-newlines is off', () => {
    const el = makePreviewEl(false);
    setPreviewContent(el, 'Hello world');
    expect(el.textContent).toBe('Hello world');
    expect(el.children.length).toBe(0);
  });

  it('sets plain text when no newlines even with keep-newlines on', () => {
    const el = makePreviewEl(true);
    setPreviewContent(el, 'No breaks here');
    expect(el.textContent).toBe('No breaks here');
    expect(el.children.length).toBe(0);
  });

  it('splits double newlines into <p> elements', () => {
    const el = makePreviewEl(true);
    setPreviewContent(el, 'Para one\n\nPara two\n\nPara three');
    expect(el.children.length).toBe(3);
    expect(el.children[0].textContent).toBe('Para one');
    expect(el.children[1].textContent).toBe('Para two');
    expect(el.children[2].textContent).toBe('Para three');
  });

  it('collapses triple+ newlines into single paragraph break', () => {
    const el = makePreviewEl(true);
    setPreviewContent(el, 'A\n\n\n\nB');
    expect(el.children.length).toBe(2);
  });

  it('treats single newline as part of same paragraph', () => {
    const el = makePreviewEl(true);
    setPreviewContent(el, 'Line one\nLine two');
    expect(el.children.length).toBe(1);
    expect(el.children[0].textContent).toBe('Line one\nLine two');
  });

  it('handles empty string', () => {
    const el = makePreviewEl(true);
    setPreviewContent(el, '');
    expect(el.textContent).toBe('');
    expect(el.children.length).toBe(0);
  });

  it('clears previous paragraphs before setting new ones', () => {
    const el = makePreviewEl(true);
    setPreviewContent(el, 'First\n\nSecond');
    expect(el.children.length).toBe(2);
    setPreviewContent(el, 'A\n\nB\n\nC');
    expect(el.children.length).toBe(3);
    expect(el.children[0].textContent).toBe('A');
  });
});
