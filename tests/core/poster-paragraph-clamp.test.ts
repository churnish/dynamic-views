import { vi } from 'vitest';

vi.mock('../../src/utils/owner-window', () => ({
  getOwnerWindow: () => window,
}));

// Deliberately NOT mocking text-preview-dom — this suite exists to prove the
// real per-paragraph clamp produces identical clip decisions through the poster
// pipeline. Reachable only with keep-newlines ON and multi-paragraph bodies.
import {
  clipPosterStaticOverflow,
  clipPosterStaticOverflowBatch,
} from '../../src/core/poster';

const TEXT_PREVIEW_LINES_VAR = '--dynamic-views-text-preview-lines';
const TITLE_LINES_VAR = '--dynamic-views-title-lines';
const SUBTITLE_LINES_VAR = '--dynamic-views-subtitle-lines';
const CLIP_HIDDEN_CLASS = 'poster-clip-hidden';
const PARA_CLAMPED_CLASS = 'dynamic-views-para-clamped';
const PARA_HIDDEN_CLASS = 'dynamic-views-para-hidden';
const TRUNCATION_INDICATOR_CLASS = 'dynamic-views-truncation-indicator';

const LINE_HEIGHT = 20;

beforeAll(() => {
  HTMLElement.prototype.setCssProps = function (props: Record<string, string>) {
    for (const [key, value] of Object.entries(props)) {
      this.style.setProperty(key, value);
    }
  };
});

afterEach(() => {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function mockRect(el: HTMLElement, top: number, bottom: number): void {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    top,
    bottom,
    left: 0,
    right: 0,
    width: 0,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => {},
  });
}

interface PosterFixture {
  card: HTMLElement;
  titleEl: HTMLElement;
  subtitleEl: HTMLElement;
  textPreviewEl: HTMLElement;
  paragraphs: HTMLElement[];
  propRow: HTMLElement;
  /** Number of `offsetHeight` reads per paragraph, in paragraph order. */
  heightReads: number[];
}

/**
 * Builds a poster card whose content overflows by exactly one property row and
 * whose text preview is partially visible — the branch that clamps the preview
 * to a fitted line count and then re-clamps its paragraphs to that budget.
 *
 * Geometry: content clips at y=100. Title 0-20, subtitle 20-40,
 * text preview wrapper 40-140, property row 140-160.
 */
function makePosterCard(
  container: HTMLElement,
  paragraphHeights: number[]
): PosterFixture {
  const doc = container.ownerDocument;
  const card = doc.createElement('div');
  card.className = 'card image-format-poster has-poster';

  const content = doc.createElement('div');
  content.className = 'card-content';
  Object.defineProperty(content, 'scrollHeight', {
    value: 200,
    configurable: true,
  });
  Object.defineProperty(content, 'clientHeight', {
    value: 100,
    configurable: true,
  });
  mockRect(content, 0, 100);

  const header = doc.createElement('div');
  header.className = 'card-header';
  const titleEl = doc.createElement('div');
  titleEl.className = 'card-title';
  mockRect(titleEl, 0, 20);
  const subtitleEl = doc.createElement('div');
  subtitleEl.className = 'card-subtitle';
  mockRect(subtitleEl, 20, 40);
  header.appendChild(titleEl);
  header.appendChild(subtitleEl);
  content.appendChild(header);

  const wrapper = doc.createElement('div');
  wrapper.className = 'card-text-preview-wrapper';
  mockRect(wrapper, 40, 140);
  const textPreviewEl = doc.createElement('div');
  textPreviewEl.className = 'card-text-preview has-paragraphs';
  const heightReads = paragraphHeights.map(() => 0);
  const paragraphs = paragraphHeights.map((height, i) => {
    const p = doc.createElement('p');
    p.textContent = `paragraph ${i}`;
    Object.defineProperty(p, 'offsetHeight', {
      get: () => {
        heightReads[i]++;
        return height;
      },
      configurable: true,
    });
    textPreviewEl.appendChild(p);
    return p;
  });
  wrapper.appendChild(textPreviewEl);
  content.appendChild(wrapper);

  const propsBottom = doc.createElement('div');
  propsBottom.className = 'card-properties-bottom';
  const propRow = doc.createElement('div');
  propRow.className = 'property-row';
  mockRect(propRow, 140, 160);
  propsBottom.appendChild(propRow);
  content.appendChild(propsBottom);

  card.appendChild(content);
  container.appendChild(card);

  return {
    card,
    titleEl,
    subtitleEl,
    textPreviewEl,
    paragraphs,
    propRow,
    heightReads,
  };
}

function makeContainer(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'dynamic-views poster-static';
  document.body.appendChild(container);
  return container;
}

/**
 * Stubs `getComputedStyle` so inline custom properties win over the container's
 * value — jsdom does not cascade custom properties, and the fitted-count
 * re-clamp depends on the preview's inline line count overriding the container.
 */
function mockStyles(container: HTMLElement, textPreviewLinesCap: string): void {
  const containerVars: Record<string, string> = {
    [TITLE_LINES_VAR]: '2',
    [SUBTITLE_LINES_VAR]: '2',
    [TEXT_PREVIEW_LINES_VAR]: textPreviewLinesCap,
  };
  vi.spyOn(window, 'getComputedStyle').mockImplementation(
    (el: Element) =>
      ({
        lineHeight: `${LINE_HEIGHT}px`,
        transitionDuration: '0.3s',
        getPropertyValue: (name: string) => {
          const inline = (el as HTMLElement).style?.getPropertyValue(name);
          if (inline) return inline;
          if (el === container) return containerVars[name] ?? '';
          // Inherited value for everything below the container
          return containerVars[name] ?? '';
        },
      }) as unknown as CSSStyleDeclaration
  );
}

/** Asserts the exact clip + paragraph state the pre-split pipeline produces. */
function expectFittedClipState(fixture: PosterFixture): void {
  const [p1, p2, p3] = fixture.paragraphs;

  // Preview clamped to the 3 lines that fit above the clip boundary
  expect(
    fixture.textPreviewEl.style.getPropertyValue(TEXT_PREVIEW_LINES_VAR)
  ).toBe('3');

  // First paragraph (2 lines) survives, gets a forced ellipsis because
  // siblings below it are hidden
  expect(p1.classList.contains(PARA_CLAMPED_CLASS)).toBe(true);
  expect(p1.style.getPropertyValue('-webkit-line-clamp')).toBe('2');
  expect(p1.querySelector(`.${TRUNCATION_INDICATOR_CLASS}`)).toBeTruthy();
  expect(p1.classList.contains(PARA_HIDDEN_CLASS)).toBe(false);

  // Remaining paragraphs do not fit the 3-line budget once the inter-paragraph
  // margin is charged
  expect(p2.classList.contains(PARA_HIDDEN_CLASS)).toBe(true);
  expect(p3.classList.contains(PARA_HIDDEN_CLASS)).toBe(true);
  expect(p2.querySelector(`.${TRUNCATION_INDICATOR_CLASS}`)).toBeNull();

  // Property row sits entirely below the clip boundary
  expect(fixture.propRow.classList.contains(CLIP_HIDDEN_CLASS)).toBe(true);

  // Subtitle fits — untouched
  expect(fixture.subtitleEl.classList.contains(CLIP_HIDDEN_CLASS)).toBe(false);
  expect(fixture.subtitleEl.style.getPropertyValue(SUBTITLE_LINES_VAR)).toBe(
    ''
  );

  // Title fits — never clamped
  expect(fixture.titleEl.style.getPropertyValue(TITLE_LINES_VAR)).toBe('');
}

describe('poster clipping with multi-paragraph text previews', () => {
  it('clamps paragraphs to the fitted line count on a single card', () => {
    const container = makeContainer();
    const fixture = makePosterCard(container, [40, 20, 40]);
    mockStyles(container, '5');

    clipPosterStaticOverflow(fixture.card);

    expectFittedClipState(fixture);
  });

  it('produces the same decisions for every card in a batch', () => {
    const container = makeContainer();
    const first = makePosterCard(container, [40, 20, 40]);
    const second = makePosterCard(container, [40, 20, 40]);
    mockStyles(container, '5');

    clipPosterStaticOverflowBatch([first.card, second.card]);

    expectFittedClipState(first);
    expectFittedClipState(second);
  });

  it('is idempotent across repeated passes', () => {
    const container = makeContainer();
    const fixture = makePosterCard(container, [40, 20, 40]);
    mockStyles(container, '5');

    clipPosterStaticOverflowBatch([fixture.card]);
    clipPosterStaticOverflowBatch([fixture.card]);

    expectFittedClipState(fixture);
    expect(
      fixture.paragraphs[0].querySelectorAll(`.${TRUNCATION_INDICATOR_CLASS}`)
    ).toHaveLength(1);
  });

  it('measures each paragraph once — the fitted re-clamp reuses phase 2 heights', () => {
    const container = makeContainer();
    const first = makePosterCard(container, [40, 20, 40]);
    const second = makePosterCard(container, [40, 20, 40]);
    mockStyles(container, '5');

    clipPosterStaticOverflowBatch([first.card, second.card]);

    expect(first.heightReads).toEqual([1, 1, 1]);
    expect(second.heightReads).toEqual([1, 1, 1]);
  });

  it('respects a container cap lower than the fitted line count', () => {
    const container = makeContainer();
    const fixture = makePosterCard(container, [40, 20, 40]);
    mockStyles(container, '2');

    clipPosterStaticOverflow(fixture.card);

    expect(
      fixture.textPreviewEl.style.getPropertyValue(TEXT_PREVIEW_LINES_VAR)
    ).toBe('2');
    expect(
      fixture.paragraphs[0].style.getPropertyValue('-webkit-line-clamp')
    ).toBe('2');
    expect(fixture.paragraphs[1].classList.contains(PARA_HIDDEN_CLASS)).toBe(
      true
    );
  });
});
