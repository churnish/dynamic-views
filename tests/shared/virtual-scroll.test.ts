import {
  measureScalableHeight,
  estimateUnmountedHeight,
} from '../../src/shared/virtual-scroll';

function createCard(classes: string[], wrapperHeight?: number): HTMLElement {
  const card = document.createElement('div');
  for (const cls of classes) {
    card.classList.add(cls);
  }
  if (wrapperHeight !== undefined) {
    const wrapper = document.createElement('div');
    wrapper.classList.add('card-cover-wrapper');
    Object.defineProperty(wrapper, 'offsetHeight', {
      configurable: true,
      value: wrapperHeight,
    });
    card.appendChild(wrapper);
  }
  return card;
}

describe('measureScalableHeight', () => {
  afterEach(() => {
    document.body.className = '';
  });

  it('returns wrapper height for top cover', () => {
    const card = createCard(['card-cover-top'], 200);
    expect(measureScalableHeight(card)).toBe(200);
  });

  it('returns wrapper height for bottom cover', () => {
    const card = createCard(['card-cover-bottom'], 150);
    expect(measureScalableHeight(card)).toBe(150);
  });

  it('returns 0 for side cover (left)', () => {
    const card = createCard(['card-cover-left'], 200);
    expect(measureScalableHeight(card)).toBe(0);
  });

  it('returns 0 for side cover (right)', () => {
    const card = createCard(['card-cover-right'], 200);
    expect(measureScalableHeight(card)).toBe(0);
  });

  it('returns 0 for card with no cover class', () => {
    const card = createCard([], 200);
    expect(measureScalableHeight(card)).toBe(0);
  });

  it('returns 0 for top cover with fixed-cover-height mode', () => {
    document.body.classList.add('dynamic-views-fixed-cover-height');
    const card = createCard(['card-cover-top'], 200);
    expect(measureScalableHeight(card)).toBe(0);
  });

  it('returns 0 for top cover with no wrapper child', () => {
    const card = createCard(['card-cover-top']);
    expect(measureScalableHeight(card)).toBe(0);
  });

  it('returns full height for poster cards with images', () => {
    const card = document.createElement('div');
    card.classList.add('image-format-poster');
    const poster = document.createElement('div');
    poster.classList.add('card-poster');
    card.appendChild(poster);
    Object.defineProperty(card, 'offsetHeight', {
      configurable: true,
      value: 300,
    });
    expect(measureScalableHeight(card)).toBe(300);
  });

  it('returns 0 for poster cards without images', () => {
    const card = document.createElement('div');
    card.classList.add('image-format-poster');
    expect(measureScalableHeight(card)).toBe(0);
  });

  it('ignores non-direct-child wrapper', () => {
    const card = document.createElement('div');
    card.classList.add('card-cover-top');
    const nested = document.createElement('div');
    const wrapper = document.createElement('div');
    wrapper.classList.add('card-cover-wrapper');
    Object.defineProperty(wrapper, 'offsetHeight', {
      configurable: true,
      value: 200,
    });
    nested.appendChild(wrapper);
    card.appendChild(nested);
    expect(measureScalableHeight(card)).toBe(0);
  });
});

describe('estimateUnmountedHeight', () => {
  it('scales cover height and adds fixed height', () => {
    const item = {
      scalableHeight: 200,
      fixedHeight: 100,
      measuredAtWidth: 300,
      height: 300,
    };
    // 200 * (150 / 300) + 100 * sqrt(300 / 150) = 100 + 141.42 ≈ 241.42
    expect(estimateUnmountedHeight(item, 150)).toBeCloseTo(241.42, 1);
  });

  it('returns fixedHeight when scalableHeight is 0', () => {
    const item = {
      scalableHeight: 0,
      fixedHeight: 120,
      measuredAtWidth: 300,
      height: 120,
    };
    // 0 + 120 * sqrt(300 / 450) = 120 * 0.8165 ≈ 97.98
    expect(estimateUnmountedHeight(item, 450)).toBeCloseTo(97.98, 1);
  });

  it('falls back to item.height when measuredAtWidth is 0', () => {
    const item = {
      scalableHeight: 0,
      fixedHeight: 0,
      measuredAtWidth: 0,
      height: 250,
    };
    expect(estimateUnmountedHeight(item, 300)).toBe(250);
  });

  it('scales proportionally when width doubles', () => {
    const item = {
      scalableHeight: 100,
      fixedHeight: 50,
      measuredAtWidth: 200,
      height: 150,
    };
    // 100 * (400 / 200) + 50 * sqrt(200 / 400) = 200 + 35.36 ≈ 235.36
    expect(estimateUnmountedHeight(item, 400)).toBeCloseTo(235.36, 1);
  });

  it('scales proportionally when width halves', () => {
    const item = {
      scalableHeight: 100,
      fixedHeight: 50,
      measuredAtWidth: 200,
      height: 150,
    };
    // 100 * (100 / 200) + 50 * sqrt(200 / 100) = 50 + 70.71 ≈ 120.71
    expect(estimateUnmountedHeight(item, 100)).toBeCloseTo(120.71, 1);
  });

  it('returns exact measuredHeight at original width', () => {
    const item = {
      scalableHeight: 180,
      fixedHeight: 70,
      measuredAtWidth: 300,
      height: 250,
    };
    // 180 * (300 / 300) + 70 * sqrt(1) = 180 + 70 = 250 = measuredHeight
    expect(estimateUnmountedHeight(item, 300)).toBe(250);
  });

  it('fixedHeight scales with sqrt when card narrows (column increase)', () => {
    const item = {
      scalableHeight: 0,
      fixedHeight: 150,
      measuredAtWidth: 500,
      height: 150,
    };
    // 0 + 150 * sqrt(500 / 200) = 150 * 1.5811 ≈ 237.17
    expect(estimateUnmountedHeight(item, 200)).toBeCloseTo(237.17, 1);
  });

  it('fixedHeight scales with sqrt when card widens (column decrease)', () => {
    const item = {
      scalableHeight: 0,
      fixedHeight: 150,
      measuredAtWidth: 200,
      height: 150,
    };
    // 0 + 150 * sqrt(200 / 500) = 150 * 0.6325 ≈ 94.87
    expect(estimateUnmountedHeight(item, 500)).toBeCloseTo(94.87, 1);
  });

  it('pure text card (scalableHeight=0) scales entirely with sqrt', () => {
    const item = {
      scalableHeight: 0,
      fixedHeight: 200,
      measuredAtWidth: 300,
      height: 200,
    };
    // 0 + 200 * sqrt(300 / 150) = 200 * 1.4142 ≈ 282.84
    expect(estimateUnmountedHeight(item, 150)).toBeCloseTo(282.84, 1);
  });

  it('pure image card (fixedHeight=0) is unaffected by sqrt scaling', () => {
    const item = {
      scalableHeight: 300,
      fixedHeight: 0,
      measuredAtWidth: 300,
      height: 300,
    };
    // 300 * (150 / 300) + 0 = 150
    expect(estimateUnmountedHeight(item, 150)).toBe(150);
  });

  it('falls back to item.height when cardWidth is 0', () => {
    const item = {
      scalableHeight: 200,
      fixedHeight: 100,
      measuredAtWidth: 300,
      height: 250,
    };
    expect(estimateUnmountedHeight(item, 0)).toBe(250);
  });
});
