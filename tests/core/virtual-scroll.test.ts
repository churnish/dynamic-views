import {
  measureScalableHeight,
  estimateUnmountedHeight,
  getScrollAnchor,
  getAnchorTop,
  buildMountEstimateProfile,
  estimateCardHeight,
  hasCardImage,
  isMountEstimateProfile,
} from '../../src/core/virtual-scroll';
import type { VirtualItem } from '../../src/core/virtual-scroll';
import type { MountEstimateProfile } from '../../src/types';
import {
  UNMEASURED_CARD_HEIGHT,
  FIXED_COVER_HEIGHT_GRID,
  FIXED_COVER_HEIGHT_MASONRY,
  FIXED_COVER_HEIGHT_BOTH,
  FIXED_COVER_HEIGHT_NONE,
} from '../../src/core/constants';

function createCard(
  classes: string[],
  wrapperHeight?: number,
  containerClass?: string
): HTMLElement {
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
  if (containerClass) {
    const container = document.createElement('div');
    container.classList.add(containerClass);
    container.appendChild(card);
    document.body.appendChild(container);
  }
  return card;
}

describe('measureScalableHeight', () => {
  afterEach(() => {
    document.body.className = '';
    // Clean up containers appended during tests
    for (const child of [...document.body.children]) {
      if (child instanceof HTMLElement && child.tagName === 'DIV') {
        child.remove();
      }
    }
  });

  it('returns wrapper height for masonry top cover without fixed height', () => {
    const card = createCard(['card-cover-top'], 200, 'dynamic-views-masonry');
    expect(measureScalableHeight(card)).toBe(200);
  });

  it('returns wrapper height for masonry bottom cover without fixed height', () => {
    const card = createCard(
      ['card-cover-bottom'],
      150,
      'dynamic-views-masonry'
    );
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

  it('returns 0 for masonry card with fixed-cover-height-masonry', () => {
    document.body.classList.add(FIXED_COVER_HEIGHT_MASONRY);
    const card = createCard(['card-cover-top'], 200, 'dynamic-views-masonry');
    expect(measureScalableHeight(card)).toBe(0);
  });

  it('returns 0 for masonry card with fixed-cover-height-both', () => {
    document.body.classList.add(FIXED_COVER_HEIGHT_BOTH);
    const card = createCard(['card-cover-top'], 200, 'dynamic-views-masonry');
    expect(measureScalableHeight(card)).toBe(0);
  });

  it('returns 0 for grid card with fixed-cover-height-grid', () => {
    document.body.classList.add(FIXED_COVER_HEIGHT_GRID);
    const card = createCard(['card-cover-top'], 200, 'dynamic-views-grid');
    expect(measureScalableHeight(card)).toBe(0);
  });

  it('returns 0 for grid card with fixed-cover-height-both', () => {
    document.body.classList.add(FIXED_COVER_HEIGHT_BOTH);
    const card = createCard(['card-cover-top'], 200, 'dynamic-views-grid');
    expect(measureScalableHeight(card)).toBe(0);
  });

  it('returns 0 for grid card with no body class (Style Settings absent fallback)', () => {
    const card = createCard(['card-cover-top'], 200, 'dynamic-views-grid');
    expect(measureScalableHeight(card)).toBe(0);
  });

  it('returns wrapper height for grid card with fixed-cover-height-none', () => {
    document.body.classList.add(FIXED_COVER_HEIGHT_NONE);
    const card = createCard(['card-cover-top'], 200, 'dynamic-views-grid');
    expect(measureScalableHeight(card)).toBe(200);
  });

  it('returns wrapper height for grid card with fixed-cover-height-masonry', () => {
    document.body.classList.add(FIXED_COVER_HEIGHT_MASONRY);
    const card = createCard(['card-cover-top'], 200, 'dynamic-views-grid');
    expect(measureScalableHeight(card)).toBe(200);
  });

  it('returns wrapper height for masonry card with fixed-cover-height-grid', () => {
    document.body.classList.add(FIXED_COVER_HEIGHT_GRID);
    const card = createCard(['card-cover-top'], 200, 'dynamic-views-masonry');
    expect(measureScalableHeight(card)).toBe(200);
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

  it('returns full height for poster cards regardless of fixed-poster-height class', () => {
    // Poster aspect-ratio scales with width in both fixed and dynamic modes,
    // so the full height is always scalable (unlike covers which use padding-top)
    document.body.classList.add('dynamic-views-fixed-poster-height-grid');
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

  it('returns UNMEASURED_CARD_HEIGHT when measuredAtWidth=0 and height=0', () => {
    const item = {
      scalableHeight: 0,
      fixedHeight: 0,
      measuredAtWidth: 0,
      height: 0,
    };
    expect(estimateUnmountedHeight(item, 300)).toBe(UNMEASURED_CARD_HEIGHT);
  });
});

function stub(
  overrides: Partial<{
    el: HTMLElement | null;
    x: number;
    y: number;
    height: number;
    groupKey: string | undefined;
    path: string;
    index: number;
    measuredHeight: number;
    measuredAtWidth: number;
    scalableHeight: number;
    fixedHeight: number;
    imageUrl: string | string[] | undefined;
  }>
): VirtualItem {
  return {
    el: 'el' in overrides ? overrides.el : document.createElement('div'),
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    height: overrides.height ?? 100,
    groupKey: overrides.groupKey ?? undefined,
    cardData: {
      path: overrides.path ?? 'note.md',
      imageUrl: overrides.imageUrl,
    },
    index: overrides.index ?? 0,
    measuredHeight: overrides.measuredHeight ?? 0,
    measuredAtWidth: overrides.measuredAtWidth ?? 0,
    scalableHeight: overrides.scalableHeight ?? 0,
    fixedHeight: overrides.fixedHeight ?? 0,
  } as unknown as VirtualItem;
}

describe('getScrollAnchor', () => {
  const noOffsets = new Map<string | undefined, number>();

  it('returns topmost visible mounted card', () => {
    const items = [
      stub({ y: 0, height: 100, path: 'a.md', index: 0 }),
      stub({ y: 100, height: 100, path: 'b.md', index: 1 }),
      stub({ y: 200, height: 100, path: 'c.md', index: 2 }),
    ];
    // scrollTop=150 means card a is above pane, b straddles, c fully visible
    const anchor = getScrollAnchor(items, noOffsets, 150, 300);
    expect(anchor).toEqual({ path: 'b.md', offset: 50, index: 1 });
  });

  it('skips unmounted items (el: null)', () => {
    const items = [
      stub({ y: 0, height: 100, path: 'a.md', index: 0, el: null }),
      stub({ y: 100, height: 100, path: 'b.md', index: 1 }),
    ];
    const anchor = getScrollAnchor(items, noOffsets, 0, 300);
    expect(anchor).toEqual({ path: 'b.md', offset: -100, index: 1 });
  });

  it('breaks ties by leftmost item.x', () => {
    const items = [
      stub({ y: 0, x: 300, height: 100, path: 'right.md', index: 0 }),
      stub({ y: 0, x: 0, height: 100, path: 'left.md', index: 1 }),
    ];
    const anchor = getScrollAnchor(items, noOffsets, 0, 300);
    expect(anchor).toEqual({ path: 'left.md', offset: 0, index: 1 });
  });

  it('returns null when no mounted items', () => {
    const items = [
      stub({ y: 0, height: 100, path: 'a.md', index: 0, el: null }),
    ];
    const anchor = getScrollAnchor(items, noOffsets, 0, 300);
    expect(anchor).toBeNull();
  });

  it('handles grouped view (non-zero group offsets)', () => {
    const offsets = new Map<string | undefined, number>([['groupA', 500]]);
    const items = [
      stub({
        y: 50,
        height: 100,
        path: 'g.md',
        index: 0,
        groupKey: 'groupA',
      }),
    ];
    // absoluteY = 500 + 50 = 550, scrollTop=540, paneHeight=200
    const anchor = getScrollAnchor(items, offsets, 540, 200);
    expect(anchor).toEqual({ path: 'g.md', offset: -10, index: 0 });
  });

  it('returns null when all mounted cards are outside scroll range', () => {
    const items = [
      stub({ y: 0, height: 100, path: 'a.md', index: 0 }),
      stub({ y: 100, height: 100, path: 'b.md', index: 1 }),
    ];
    // scrollTop=500, paneHeight=100 — both cards end before scrollTop
    const anchor = getScrollAnchor(items, noOffsets, 500, 100);
    expect(anchor).toBeNull();
  });
});

describe('getAnchorTop', () => {
  const noOffsets = new Map<string | undefined, number>();

  it('finds card by path and returns absolute Y', () => {
    const items = [
      stub({ y: 150, path: 'target.md', index: 0 }),
      stub({ y: 300, path: 'other.md', index: 1 }),
    ];
    expect(getAnchorTop('target.md', items, noOffsets)).toBe(150);
  });

  it('returns null for missing path', () => {
    const items = [stub({ y: 100, path: 'a.md', index: 0 })];
    expect(getAnchorTop('missing.md', items, noOffsets)).toBeNull();
  });

  it('handles grouped view offsets', () => {
    const offsets = new Map<string | undefined, number>([['g1', 400]]);
    const items = [stub({ y: 60, path: 'card.md', index: 0, groupKey: 'g1' })];
    expect(getAnchorTop('card.md', items, offsets)).toBe(460);
  });
});

describe('hasCardImage', () => {
  it('is true for a single URL', () => {
    expect(hasCardImage({ imageUrl: 'app://local/a.png' })).toBe(true);
  });

  it('is true for a non-empty array', () => {
    expect(hasCardImage({ imageUrl: ['app://local/a.png'] })).toBe(true);
  });

  it('is false for an empty array', () => {
    expect(hasCardImage({ imageUrl: [] })).toBe(false);
  });

  it('is false for undefined', () => {
    expect(hasCardImage({ imageUrl: undefined })).toBe(false);
  });

  it('is false for an empty string', () => {
    expect(hasCardImage({ imageUrl: '' })).toBe(false);
  });
});

/** Measured item shaped for the profile builder */
function measured(
  scalable: number,
  fixed: number,
  width: number,
  imageUrl?: string
): VirtualItem {
  return stub({
    measuredHeight: scalable + fixed,
    measuredAtWidth: width,
    scalableHeight: scalable,
    fixedHeight: fixed,
    imageUrl,
  });
}

const IMG = 'app://local/a.png';

describe('buildMountEstimateProfile', () => {
  it('takes the median of each group', () => {
    const items = [
      measured(100, 50, 300, IMG),
      measured(300, 70, 300, IMG),
      measured(200, 60, 300, IMG),
      measured(0, 90, 300),
      measured(0, 110, 300),
      measured(0, 100, 300),
    ];
    expect(buildMountEstimateProfile(items, 300, 250)).toEqual({
      withImage: { scalable: 200, fixed: 60 },
      withoutImage: { scalable: 0, fixed: 100 },
      measuredAtWidth: 300,
      coverWidth: 250,
    });
  });

  it('averages the middle pair for an even sample count', () => {
    const items = [
      measured(100, 40, 300, IMG),
      measured(200, 60, 300, IMG),
      measured(0, 80, 300),
      measured(0, 100, 300),
    ];
    expect(buildMountEstimateProfile(items, 300, 250)).toEqual({
      withImage: { scalable: 150, fixed: 50 },
      withoutImage: { scalable: 0, fixed: 90 },
      measuredAtWidth: 300,
      coverWidth: 250,
    });
  });

  it('copies the imaged fixed height when no imageless card was measured', () => {
    const items = [
      measured(100, 50, 300, IMG),
      measured(200, 60, 300, IMG),
      measured(300, 70, 300, IMG),
    ];
    expect(buildMountEstimateProfile(items, 300, 250)).toMatchObject({
      withImage: { scalable: 200, fixed: 60 },
      withoutImage: { scalable: 0, fixed: 60 },
    });
  });

  it('copies the imageless fixed height when no imaged card was measured', () => {
    const items = [
      measured(0, 80, 300),
      measured(0, 100, 300),
      measured(0, 120, 300),
    ];
    expect(buildMountEstimateProfile(items, 300, 0)).toMatchObject({
      withImage: { scalable: 0, fixed: 100 },
      withoutImage: { scalable: 0, fixed: 100 },
    });
  });

  it('accepts a group with a single sample', () => {
    const items = [
      measured(240, 60, 300, IMG),
      measured(0, 80, 300),
      measured(0, 100, 300),
    ];
    expect(buildMountEstimateProfile(items, 300, 250)).toMatchObject({
      withImage: { scalable: 240, fixed: 60 },
      withoutImage: { scalable: 0, fixed: 90 },
    });
  });

  it('returns null below three surviving samples', () => {
    const items = [measured(200, 60, 300, IMG), measured(0, 100, 300)];
    expect(buildMountEstimateProfile(items, 300, 250)).toBeNull();
  });

  it('returns null when referenceWidth is 0', () => {
    const items = [
      measured(100, 50, 300, IMG),
      measured(200, 60, 300, IMG),
      measured(300, 70, 300, IMG),
    ];
    expect(buildMountEstimateProfile(items, 0, 250)).toBeNull();
  });

  it('skips never-measured items', () => {
    const items = [
      measured(100, 50, 300, IMG),
      measured(200, 60, 300, IMG),
      measured(300, 70, 300, IMG),
      stub({ imageUrl: IMG }),
      stub({}),
    ];
    expect(buildMountEstimateProfile(items, 300, 250)).toMatchObject({
      withImage: { scalable: 200, fixed: 60 },
    });
  });

  it('ignores samples measured at a different card width', () => {
    const items = [
      measured(100, 50, 300, IMG),
      measured(200, 60, 300, IMG),
      measured(300, 70, 300, IMG),
      measured(900, 900, 180, IMG),
      measured(900, 900, 180, IMG),
      measured(900, 900, 180, IMG),
    ];
    expect(buildMountEstimateProfile(items, 300, 250)).toMatchObject({
      withImage: { scalable: 200, fixed: 60 },
    });
  });

  it('keeps samples within the 1px width tolerance', () => {
    const items = [
      measured(100, 50, 299, IMG),
      measured(200, 60, 300, IMG),
      measured(300, 70, 301, IMG),
    ];
    expect(buildMountEstimateProfile(items, 300, 250)).toMatchObject({
      withImage: { scalable: 200, fixed: 60 },
    });
  });

  it('returns null when every sample was measured at another width', () => {
    const items = [
      measured(100, 50, 180, IMG),
      measured(200, 60, 180, IMG),
      measured(300, 70, 180, IMG),
    ];
    expect(buildMountEstimateProfile(items, 300, 250)).toBeNull();
  });

  it('rounds every persisted number to an integer', () => {
    const items = [
      measured(100.4, 50.5, 300.6, IMG),
      measured(0, 80.5, 300.6),
      measured(0, 81.5, 300.6),
    ];
    const profile = buildMountEstimateProfile(items, 300.6, 250.4)!;
    for (const value of [
      profile.withImage.scalable,
      profile.withImage.fixed,
      profile.withoutImage.scalable,
      profile.withoutImage.fixed,
      profile.measuredAtWidth,
      profile.coverWidth,
    ]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});

describe('estimateCardHeight', () => {
  const profile: MountEstimateProfile = {
    withImage: { scalable: 200, fixed: 60 },
    withoutImage: { scalable: 0, fixed: 100 },
    measuredAtWidth: 300,
    coverWidth: 280,
  };

  it('matches estimateUnmountedHeight for the imaged group', () => {
    expect(estimateCardHeight(profile, true, 150, 0)).toBeCloseTo(
      estimateUnmountedHeight(
        {
          scalableHeight: 200,
          fixedHeight: 60,
          measuredAtWidth: 300,
          height: 260,
        },
        150
      ),
      5
    );
  });

  it('matches estimateUnmountedHeight for the imageless group', () => {
    expect(estimateCardHeight(profile, false, 450, 0)).toBeCloseTo(
      estimateUnmountedHeight(
        {
          scalableHeight: 0,
          fixedHeight: 100,
          measuredAtWidth: 300,
          height: 100,
        },
        450
      ),
      5
    );
  });

  it('reproduces the measured height at the original width', () => {
    expect(estimateCardHeight(profile, true, 300, 0)).toBe(260);
  });

  it('replaces the median cover with the cached ratio in contain mode', () => {
    // 0.5 * 280 * (150 / 300) + 60 * sqrt(2) = 70 + 84.85
    expect(estimateCardHeight(profile, true, 150, 0.5)).toBeCloseTo(154.85, 1);
  });

  it('ignores the cover ratio when coverWidth is unknown', () => {
    const noCover: MountEstimateProfile = { ...profile, coverWidth: 0 };
    expect(estimateCardHeight(noCover, true, 150, 0.5)).toBeCloseTo(
      estimateCardHeight(noCover, true, 150, 0),
      5
    );
  });

  it('picks the group before the unmeasured guard', () => {
    const unusable: MountEstimateProfile = { ...profile, measuredAtWidth: 0 };
    expect(estimateCardHeight(unusable, true, 200, 0)).toBe(60);
    expect(estimateCardHeight(unusable, false, 200, 0)).toBe(100);
  });

  it('falls back to UNMEASURED_CARD_HEIGHT when the picked group has no fixed height', () => {
    const empty: MountEstimateProfile = {
      withImage: { scalable: 0, fixed: 0 },
      withoutImage: { scalable: 0, fixed: 100 },
      measuredAtWidth: 0,
      coverWidth: 0,
    };
    expect(estimateCardHeight(empty, true, 200, 0)).toBe(
      UNMEASURED_CARD_HEIGHT
    );
  });

  it('falls back when cardWidth is 0', () => {
    expect(estimateCardHeight(profile, false, 0, 0)).toBe(100);
  });

  it('clamps to at least 1px', () => {
    const zeroed: MountEstimateProfile = {
      withImage: { scalable: 0, fixed: 0 },
      withoutImage: { scalable: 0, fixed: 0 },
      measuredAtWidth: 300,
      coverWidth: 0,
    };
    expect(estimateCardHeight(zeroed, true, 150, 0)).toBe(1);
  });
});

describe('isMountEstimateProfile', () => {
  const valid: MountEstimateProfile = {
    withImage: { scalable: 200, fixed: 60 },
    withoutImage: { scalable: 0, fixed: 100 },
    measuredAtWidth: 300,
    coverWidth: 280,
  };

  it('accepts a well-formed profile', () => {
    expect(isMountEstimateProfile(valid)).toBe(true);
  });

  it('rejects undefined and non-objects', () => {
    expect(isMountEstimateProfile(undefined)).toBe(false);
    expect(isMountEstimateProfile(null)).toBe(false);
    expect(isMountEstimateProfile(42)).toBe(false);
  });

  it('rejects a missing group', () => {
    expect(
      isMountEstimateProfile({
        withImage: valid.withImage,
        measuredAtWidth: 300,
        coverWidth: 280,
      })
    ).toBe(false);
  });

  it('rejects a non-numeric group member', () => {
    expect(
      isMountEstimateProfile({
        ...valid,
        withImage: { scalable: '200', fixed: 60 },
      })
    ).toBe(false);
  });

  it('rejects non-numeric widths', () => {
    expect(isMountEstimateProfile({ ...valid, measuredAtWidth: '300' })).toBe(
      false
    );
    expect(isMountEstimateProfile({ ...valid, coverWidth: null })).toBe(false);
  });
});

describe('estimateUnmountedHeight — corrupted baselines', () => {
  it('floors the estimate at 1 when fixedHeight is negative', () => {
    // Poisoned-baseline shape: measuredHeight 0 → fixedHeight = 0 - scalableHeight
    const item = {
      scalableHeight: 40,
      fixedHeight: -40,
      measuredAtWidth: 300,
      height: 0,
    };
    // At equal width the terms cancel to exactly 0 — must clamp to 1, not 0
    expect(estimateUnmountedHeight(item, 300)).toBe(1);
  });

  it('never returns 0 or negative for any corrupted split', () => {
    const item = {
      scalableHeight: 0,
      fixedHeight: -25,
      measuredAtWidth: 200,
      height: 0,
    };
    expect(estimateUnmountedHeight(item, 400)).toBeGreaterThanOrEqual(1);
  });
});
