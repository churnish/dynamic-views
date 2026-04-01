import { vi, describe, it, expect } from 'vitest';
import type { CardData } from '../../src/shared/card-renderer';

// Mock all transitive dependencies of shared-renderer.ts
vi.mock('../../src/shared/card-renderer', () => ({}));
vi.mock('../../src/shared/text-preview-dom', () => ({
  setPreviewContent: vi.fn(),
  updateTextPreviewDOM: vi.fn(),
  applyPerParagraphClamp: vi.fn(),
}));
vi.mock('../../src/shared/image-loader', () => ({
  setupImageLoadHandler: vi.fn(),
  setupBackdropImageLoader: vi.fn(),
  handleImageLoad: vi.fn(),
  handleAllImagesFailed: vi.fn(),
  DEFAULT_ASPECT_RATIO: 1,
  filterBrokenUrls: vi.fn(),
  markImageBroken: vi.fn(),
}));
vi.mock('../../src/shared/context-menu', () => ({
  showFileContextMenu: vi.fn(),
  showExternalLinkContextMenu: vi.fn(),
}));
vi.mock('../../src/shared/scroll-gradient', () => ({
  updateScrollGradient: vi.fn(),
  setupScrollGradients: vi.fn(),
  setupElementScrollGradient: vi.fn(),
  setupVerticalScrollGradient: vi.fn(),
}));
vi.mock('../../src/shared/render-utils', () => ({
  getTimestampIcon: vi.fn(),
  isTimestampProperty: vi.fn(),
}));
vi.mock('../../src/utils/style-settings', () => ({
  showTagHashPrefix: vi.fn(),
  getHideEmptyMode: vi.fn(),
  getEmptyValueMarker: vi.fn(),
  shouldHideMissingProperties: vi.fn(),
  getListSeparator: vi.fn(),
  isSlideshowEnabled: vi.fn(),
  isSlideshowIndicatorEnabled: vi.fn(),
  isThumbnailScrubbingDisabled: vi.fn(),
  getSlideshowMaxImages: vi.fn(),
  getCompactBreakpoint: vi.fn(),
  hasBodyClass: vi.fn(),
}));
vi.mock('../../src/utils/property', () => ({
  getPropertyLabel: vi.fn(),
  parsePropertyList: vi.fn(),
  stripNotePrefix: vi.fn(),
}));
vi.mock('../../src/utils/link-parser', () => ({
  findLinksInText: vi.fn(),
}));
vi.mock('../../src/shared/image-viewer', () => ({
  handleImageViewerTrigger: vi.fn(),
  cleanupAllViewers: vi.fn(),
}));
vi.mock('../../src/utils/file-extension', () => ({
  getFileExtInfo: vi.fn(),
  getFileTypeIcon: vi.fn(),
}));
vi.mock('../../src/shared/slideshow', () => ({
  createPreloadBrokenHandler: vi.fn(),
  createSlideshowNavigator: vi.fn(),
  getCachedBlobUrl: vi.fn(),
  setupHoverZoomEligibility: vi.fn(),
  setupImagePreload: vi.fn(),
  setupSwipeGestures: vi.fn(),
}));
vi.mock('../../src/shared/hover-intent', () => ({
  setupHoverIntent: vi.fn(),
}));
vi.mock('../../src/shared/keyboard-nav', () => ({
  handleArrowNavigation: vi.fn(),
  isArrowKey: vi.fn(),
  isImageViewerBlockingNav: vi.fn(),
}));
vi.mock('../../src/shared/constants', () => ({
  CHECKBOX_MARKER_PREFIX: 'checkbox:',
  THUMBNAIL_STACK_MULTIPLIER: 1,
  VISIBLE_BODY_SELECTOR:
    '.card-properties-top, .card-properties-bottom, .card-previews:not(.thumbnail-placeholder-only)',
}));
vi.mock('../../src/utils/notebook-navigator', () => ({
  shouldUseNotebookNavigator: vi.fn(),
  navigateToTagInNotebookNavigator: vi.fn(),
  navigateToFolderInNotebookNavigator: vi.fn(),
  revealFileInNotebookNavigator: vi.fn(),
}));
vi.mock('../../src/shared/property-measure', () => ({
  measurePropertyFields: vi.fn(),
}));
vi.mock('../../src/shared/content-visibility', () => ({
  CONTENT_HIDDEN_CLASS: 'content-hidden',
}));
vi.mock('../../src/shared/property-helpers', () => ({
  isTagProperty: vi.fn(),
  isFileProperty: vi.fn(),
  isFormulaProperty: vi.fn(),
  shouldCollapseField: vi.fn(),
  computeInvertPairs: vi.fn(),
}));
vi.mock('../../src/utils/owner-window', () => ({
  getOwnerWindow: vi.fn(),
}));

import { SharedCardRenderer } from '../../src/bases/shared-renderer';
import { VISIBLE_BODY_SELECTOR } from '../../src/shared/constants';

describe('SharedCardRenderer.hasImageChanged', () => {
  /** Minimal CardData factory — only imageUrl matters */
  const card = (imageUrl?: string | string[]) =>
    ({ imageUrl }) as unknown as CardData;

  it('returns false when both undefined', () => {
    expect(SharedCardRenderer.hasImageChanged(undefined, card())).toBe(false);
  });

  it('returns false when both have same single URL', () => {
    expect(
      SharedCardRenderer.hasImageChanged(card('a.png'), card('a.png'))
    ).toBe(false);
  });

  it('returns false when both have same array', () => {
    expect(
      SharedCardRenderer.hasImageChanged(
        card(['a.png', 'b.png']),
        card(['a.png', 'b.png'])
      )
    ).toBe(false);
  });

  it('returns true when old is undefined and new has URL', () => {
    expect(SharedCardRenderer.hasImageChanged(undefined, card('a.png'))).toBe(
      true
    );
  });

  it('returns true when old has URL and new is undefined', () => {
    expect(SharedCardRenderer.hasImageChanged(card('a.png'), card())).toBe(
      true
    );
  });

  it('returns true when URLs differ', () => {
    expect(
      SharedCardRenderer.hasImageChanged(card('a.png'), card('b.png'))
    ).toBe(true);
  });

  it('returns true when array lengths differ', () => {
    expect(
      SharedCardRenderer.hasImageChanged(
        card(['a.png']),
        card(['a.png', 'b.png'])
      )
    ).toBe(true);
  });

  it('returns true when array element differs', () => {
    expect(
      SharedCardRenderer.hasImageChanged(
        card(['a.png', 'b.png']),
        card(['a.png', 'c.png'])
      )
    ).toBe(true);
  });

  it('returns false when string normalizes to same single-element array', () => {
    expect(
      SharedCardRenderer.hasImageChanged(card('a.png'), card(['a.png']))
    ).toBe(false);
  });

  it('returns true when oldCard defined but imageUrl undefined and new has URL', () => {
    expect(SharedCardRenderer.hasImageChanged(card(), card('a.png'))).toBe(
      true
    );
  });
});

describe('Structural content classes', () => {
  /** Build a minimal card DOM to test class assignment logic. */
  function buildCardDOM(
    options: {
      hasHeader?: boolean;
      hasPropertiesTop?: boolean;
      hasPropertiesBottom?: boolean;
      hasPreviews?: boolean;
    } = {}
  ): HTMLElement {
    const card = document.createElement('div');
    card.classList.add('card');

    if (options.hasHeader) {
      const header = document.createElement('div');
      header.classList.add('card-header');
      card.appendChild(header);
    }

    const body = document.createElement('div');
    body.classList.add('card-body');

    if (options.hasPropertiesTop) {
      const propsTop = document.createElement('div');
      propsTop.classList.add('card-properties-top');
      body.appendChild(propsTop);
    }

    if (options.hasPreviews) {
      const previews = document.createElement('div');
      previews.classList.add('card-previews');
      body.appendChild(previews);
    }

    if (options.hasPropertiesBottom) {
      const propsBottom = document.createElement('div');
      propsBottom.classList.add('card-properties-bottom');
      body.appendChild(propsBottom);
    }

    card.appendChild(body);
    return card;
  }

  describe('has-header', () => {
    it('added when card-header exists', () => {
      const card = buildCardDOM({ hasHeader: true });
      if (card.querySelector('.card-header')) {
        card.classList.add('has-header');
      }
      expect(card.classList.contains('has-header')).toBe(true);
    });

    it('not added when card-header absent', () => {
      const card = buildCardDOM({ hasHeader: false });
      if (card.querySelector('.card-header')) {
        card.classList.add('has-header');
      }
      expect(card.classList.contains('has-header')).toBe(false);
    });
  });

  describe('has-card-content', () => {
    it('added when properties-top exists', () => {
      const card = buildCardDOM({ hasPropertiesTop: true });
      if (card.querySelector(VISIBLE_BODY_SELECTOR)) {
        card.classList.add('has-card-content');
      }
      expect(card.classList.contains('has-card-content')).toBe(true);
    });

    it('added when properties-bottom exists', () => {
      const card = buildCardDOM({ hasPropertiesBottom: true });
      if (card.querySelector(VISIBLE_BODY_SELECTOR)) {
        card.classList.add('has-card-content');
      }
      expect(card.classList.contains('has-card-content')).toBe(true);
    });

    it('added when previews exist', () => {
      const card = buildCardDOM({ hasPreviews: true });
      if (card.querySelector(VISIBLE_BODY_SELECTOR)) {
        card.classList.add('has-card-content');
      }
      expect(card.classList.contains('has-card-content')).toBe(true);
    });

    it('not added when body is empty', () => {
      const card = buildCardDOM();
      if (card.querySelector(VISIBLE_BODY_SELECTOR)) {
        card.classList.add('has-card-content');
      }
      expect(card.classList.contains('has-card-content')).toBe(false);
    });

    it('not added when only thumbnail-placeholder-only previews exist', () => {
      const card = buildCardDOM();
      const body = card.querySelector('.card-body')!;
      const previews = document.createElement('div');
      previews.classList.add('card-previews', 'thumbnail-placeholder-only');
      body.appendChild(previews);

      if (card.querySelector(VISIBLE_BODY_SELECTOR)) {
        card.classList.add('has-card-content');
      }
      expect(card.classList.contains('has-card-content')).toBe(false);
    });
  });

  describe('has-body-content', () => {
    it('added on card-body when it has visible children', () => {
      const card = buildCardDOM({ hasPropertiesBottom: true });
      const body = card.querySelector('.card-body')!;
      if (body.querySelector(VISIBLE_BODY_SELECTOR)) {
        body.classList.add('has-body-content');
      }
      expect(body.classList.contains('has-body-content')).toBe(true);
    });

    it('not added on card-body when empty', () => {
      const card = buildCardDOM();
      const body = card.querySelector('.card-body')!;
      if (body.querySelector(VISIBLE_BODY_SELECTOR)) {
        body.classList.add('has-body-content');
      }
      expect(body.classList.contains('has-body-content')).toBe(false);
    });
  });

  describe('has-body-content poster format', () => {
    /** Replicates the poster-header extension from card-renderer and shared-renderer */
    function applyHasBodyContent(bodyEl: HTMLElement, format: string): void {
      if (
        bodyEl.querySelector(VISIBLE_BODY_SELECTOR) ||
        (format === 'poster' && bodyEl.querySelector('.card-header'))
      ) {
        bodyEl.classList.add('has-body-content');
      }
    }

    it('poster card with header only gets has-body-content', () => {
      const card = buildCardDOM({ hasHeader: false });
      const body = card.querySelector('.card-body')!;
      const header = document.createElement('div');
      header.classList.add('card-header');
      body.appendChild(header);

      applyHasBodyContent(body, 'poster');
      expect(body.classList.contains('has-body-content')).toBe(true);
    });

    it('non-poster card with header only does not get has-body-content', () => {
      const card = buildCardDOM({ hasHeader: false });
      const body = card.querySelector('.card-body')!;
      const header = document.createElement('div');
      header.classList.add('card-header');
      body.appendChild(header);

      applyHasBodyContent(body, 'cover');
      expect(body.classList.contains('has-body-content')).toBe(false);
    });

    it('poster card with no header and no visible content does not get has-body-content', () => {
      const card = buildCardDOM();
      const body = card.querySelector('.card-body')!;

      applyHasBodyContent(body, 'poster');
      expect(body.classList.contains('has-body-content')).toBe(false);
    });

    it('poster card with properties gets has-body-content regardless of header', () => {
      const card = buildCardDOM({ hasPropertiesTop: true });
      const body = card.querySelector('.card-body')!;

      applyHasBodyContent(body, 'poster');
      expect(body.classList.contains('has-body-content')).toBe(true);
    });
  });
});
