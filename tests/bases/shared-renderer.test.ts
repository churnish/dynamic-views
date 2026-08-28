import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { CardData } from '../../src/core/card-data';

// Mock all transitive dependencies of shared-renderer.ts
vi.mock('../../src/core/text-preview-dom', () => ({
  setTextPreviewContent: vi.fn(),
  updateTextPreviewDOM: vi.fn(),
  applyPerParagraphClamp: vi.fn(),
}));
vi.mock('../../src/core/image-loader', () => ({
  setupImageLoadHandler: vi.fn(),
  setupBackdropImageLoader: vi.fn(),
  handleImageLoad: vi.fn(),
  handleAllImagesFailed: vi.fn(),
  DEFAULT_ASPECT_RATIO: 1,
  filterBrokenUrls: vi.fn(),
  markImageBroken: vi.fn(),
}));
vi.mock('../../src/core/context-menu', () => ({
  showFileContextMenu: vi.fn(),
}));
vi.mock('../../src/core/scroll-gradient', () => ({
  updateScrollGradient: vi.fn(),
  setupScrollGradients: vi.fn(),
  setupElementScrollGradient: vi.fn(),
  setupVerticalScrollGradient: vi.fn(),
}));
vi.mock('../../src/core/render-utils', () => ({
  getTimestampIcon: vi.fn(),
  isTimestampProperty: vi.fn(),
  splitDateSegments: vi.fn(() => []),
}));
vi.mock('../../src/utils/style-settings', () => ({
  showTagHashPrefix: vi.fn(),
  clearStyleSettingsCache: vi.fn(),
  getHideEmptyMode: vi.fn(),
  getEmptyValueMarker: vi.fn(),
  shouldHideMissingProperties: vi.fn(),
  getListSeparator: vi.fn(),
  isSlideshowEnabled: vi.fn(),
  isSlideshowIconEnabled: vi.fn(),
  isThumbnailScrubbingDisabled: vi.fn(),
  isCoverScrubMode: vi.fn(),
  getCompactBreakpoint: vi.fn(),
  hasBodyClass: vi.fn(),
}));
vi.mock('../../src/core/property-display', () => ({
  getPropertyDisplayName: vi.fn(),
  parsePropertyList: vi.fn(),
  stripNotePrefix: vi.fn(),
}));
vi.mock('../../src/utils/link-parser', () => ({
  findLinksInText: vi.fn(),
}));
vi.mock('../../src/core/image-viewer', () => ({
  handleImageViewerTrigger: vi.fn(),
  cleanupAllViewers: vi.fn(),
}));
vi.mock('../../src/utils/file-extension', () => ({
  getFileExtInfo: vi.fn(),
  getFileTypeIcon: vi.fn(),
}));
vi.mock('../../src/core/slideshow', () => ({
  createPreloadBrokenHandler: vi.fn(),
  createSlideshowNavigator: vi.fn(),
  getCachedBlobUrl: vi.fn(),
  setupHoverZoomEligibility: vi.fn(),
  setupImagePreload: vi.fn(),
  setupSwipeGestures: vi.fn(),
}));
vi.mock('../../src/core/hover-and-touch', () => ({
  canHover: vi.fn(),
  canPrimaryHover: vi.fn(),
  deferContainerHoverDrop: vi.fn(),
  isHoverPointer: vi.fn(),
  setupHoverIntent: vi.fn(),
  setupTouchPress: vi.fn(),
}));
vi.mock('../../src/core/keyboard-nav', () => ({
  handleArrowNavigation: vi.fn(),
  isArrowKey: vi.fn(),
  isImageViewerBlockingNav: vi.fn(),
}));
// src/core/constants is deliberately NOT mocked — a hardcoded copy of
// VISIBLE_BODY_SELECTOR would let the structural-class tests pass against a
// selector the production module no longer uses.
vi.mock('../../src/core/notebook-navigator', () => ({
  shouldUseNotebookNavigator: vi.fn(),
  navigateToTagInNotebookNavigator: vi.fn(),
  navigateToFolderInNotebookNavigator: vi.fn(),
  revealFileInNotebookNavigator: vi.fn(),
}));
vi.mock('../../src/core/property-measure', () => ({
  measurePropertyFields: vi.fn(),
}));
vi.mock('../../src/core/content-visibility', () => ({
  CONTENT_HIDDEN_CLASS: 'content-hidden',
}));
vi.mock('../../src/core/property-helpers', () => ({
  isTagProperty: vi.fn(),
  isFileProperty: vi.fn(),
  isFormulaProperty: vi.fn(),
  shouldCollapseField: vi.fn(),
  computeInvertPairs: vi.fn(),
}));
vi.mock('../../src/utils/owner-window', () => ({
  // Defaults to the jsdom window so click-path tests need no per-suite stub. The
  // card-click selection guard calls this, and a bare `vi.fn()` returns undefined,
  // failing with an opaque "Cannot read properties of undefined" instead.
  getOwnerWindow: vi.fn(() => globalThis.window),
}));
vi.mock('../../src/core/poster', () => ({
  clipPosterStaticOverflow: vi.fn(),
  clipPosterStaticOverflowBatch: vi.fn(),
  handlePosterTapReveal: vi.fn(),
  resetPosterClipping: vi.fn(),
  resetPosterScroll: vi.fn(),
}));

import {
  SharedCardRenderer,
  applyCssOnlySettings,
  applyViewContainerStyles,
  clearViewContainerStyles,
  getPropertiesRenderedElsewhere,
  syncStructuralClasses,
} from '../../src/bases/shared-renderer';
import { getOwnerWindow } from '../../src/utils/owner-window';
import {
  clearStyleSettingsCache,
  getEmptyValueMarker,
} from '../../src/utils/style-settings';
import { filterBrokenUrls } from '../../src/core/image-loader';
import { clipPosterStaticOverflowBatch } from '../../src/core/poster';
import { VIEW_DEFAULTS } from '../../src/constants';
import type { ResolvedSettings } from '../../src/types';
import { Platform } from 'obsidian';
import type { BasesEntry, BasesViewConfig } from 'obsidian';

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
      hasUrlIcon?: boolean;
      hasTitleBlock?: boolean;
      hasPropertiesTop?: boolean;
      hasPropertiesBottom?: boolean;
      hasPreviews?: boolean;
    } = {}
  ): HTMLElement {
    const card = document.createElement('div');
    card.classList.add('card');

    // A URL button and a title block only ever live inside a header
    if (options.hasHeader || options.hasUrlIcon || options.hasTitleBlock) {
      const header = document.createElement('div');
      header.classList.add('card-header');
      if (options.hasTitleBlock) {
        const titleBlock = document.createElement('div');
        titleBlock.classList.add('card-title-block');
        header.appendChild(titleBlock);
      }
      if (options.hasUrlIcon) {
        const icon = document.createElement('a');
        icon.classList.add('card-title-url-icon');
        header.appendChild(icon);
      }
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

  /** Every card built above has a body — the production caller always looks it up. */
  const bodyOf = (card: HTMLElement): HTMLElement =>
    card.querySelector<HTMLElement>('.card-body')!;

  describe('has-header', () => {
    it('added when card-header exists', () => {
      const card = buildCardDOM({ hasHeader: true });
      syncStructuralClasses(card, bodyOf(card));
      expect(card.classList.contains('has-header')).toBe(true);
    });

    it('not added when card-header absent', () => {
      const card = buildCardDOM({ hasHeader: false });
      syncStructuralClasses(card, bodyOf(card));
      expect(card.classList.contains('has-header')).toBe(false);
    });
  });

  describe('has-card-content', () => {
    it('added when properties-top exists', () => {
      const card = buildCardDOM({ hasPropertiesTop: true });
      syncStructuralClasses(card, bodyOf(card));
      expect(card.classList.contains('has-card-content')).toBe(true);
    });

    it('added when properties-bottom exists', () => {
      const card = buildCardDOM({ hasPropertiesBottom: true });
      syncStructuralClasses(card, bodyOf(card));
      expect(card.classList.contains('has-card-content')).toBe(true);
    });

    it('added when previews exist', () => {
      const card = buildCardDOM({ hasPreviews: true });
      syncStructuralClasses(card, bodyOf(card));
      expect(card.classList.contains('has-card-content')).toBe(true);
    });

    it('not added when body is empty', () => {
      const card = buildCardDOM();
      syncStructuralClasses(card, bodyOf(card));
      expect(card.classList.contains('has-card-content')).toBe(false);
    });

    it('not added when only thumbnail-placeholder-only previews exist', () => {
      const card = buildCardDOM();
      const body = bodyOf(card);
      const previews = document.createElement('div');
      previews.classList.add('card-previews', 'thumbnail-placeholder-only');
      body.appendChild(previews);

      syncStructuralClasses(card, body);
      expect(card.classList.contains('has-card-content')).toBe(false);
    });
  });

  describe('has-body-content', () => {
    it('added on card-body when it has visible children', () => {
      const card = buildCardDOM({ hasPropertiesBottom: true });
      const body = bodyOf(card);
      syncStructuralClasses(card, body);
      expect(body.classList.contains('has-body-content')).toBe(true);
    });

    it('not added on card-body when empty', () => {
      const card = buildCardDOM();
      const body = bodyOf(card);
      syncStructuralClasses(card, body);
      expect(body.classList.contains('has-body-content')).toBe(false);
    });
  });

  describe('has-body-content poster format', () => {
    // Header is always in card-content, never in card-body — format is irrelevant

    it('poster card with empty body does not get has-body-content (header is in card-content)', () => {
      const card = buildCardDOM({ hasHeader: false });
      const body = bodyOf(card);

      syncStructuralClasses(card, body);
      expect(body.classList.contains('has-body-content')).toBe(false);
    });

    it('poster card with no visible content does not get has-body-content', () => {
      const card = buildCardDOM();
      const body = bodyOf(card);

      syncStructuralClasses(card, body);
      expect(body.classList.contains('has-body-content')).toBe(false);
    });

    it('poster card with properties gets has-body-content', () => {
      const card = buildCardDOM({ hasPropertiesTop: true });
      const body = bodyOf(card);

      syncStructuralClasses(card, body);
      expect(body.classList.contains('has-body-content')).toBe(true);
    });
  });

  describe('has-properties-bottom', () => {
    it('added when properties-bottom exists', () => {
      const card = buildCardDOM({ hasPropertiesBottom: true });
      syncStructuralClasses(card, bodyOf(card));
      expect(card.classList.contains('has-properties-bottom')).toBe(true);
    });

    it('not added when only properties-top exists', () => {
      const card = buildCardDOM({ hasPropertiesTop: true });
      syncStructuralClasses(card, bodyOf(card));
      expect(card.classList.contains('has-properties-bottom')).toBe(false);
    });
  });

  describe('has-url-icon', () => {
    it('added when the header holds a URL button', () => {
      const card = buildCardDOM({ hasUrlIcon: true });
      syncStructuralClasses(card, bodyOf(card));
      expect(card.classList.contains('has-url-icon')).toBe(true);
    });

    it('not added for a header without a URL button', () => {
      const card = buildCardDOM({ hasHeader: true });
      syncStructuralClasses(card, bodyOf(card));
      expect(card.classList.contains('has-url-icon')).toBe(false);
    });
  });

  describe('has-title-block', () => {
    it('added when the header holds a title block', () => {
      const card = buildCardDOM({ hasTitleBlock: true });
      syncStructuralClasses(card, bodyOf(card));
      expect(card.classList.contains('has-title-block')).toBe(true);
    });

    it('not added for a header holding only a URL button', () => {
      const card = buildCardDOM({ hasUrlIcon: true });
      syncStructuralClasses(card, bodyOf(card));
      expect(card.classList.contains('has-title-block')).toBe(false);
    });

    it('comes off when the title block goes', () => {
      const card = buildCardDOM({ hasTitleBlock: true, hasUrlIcon: true });
      const body = bodyOf(card);
      syncStructuralClasses(card, body);
      expect(card.classList.contains('has-title-block')).toBe(true);

      card.querySelector('.card-title-block')!.remove();
      syncStructuralClasses(card, body);

      expect(card.classList.contains('has-title-block')).toBe(false);
      expect(card.classList.contains('has-url-icon')).toBe(true);
    });
  });

  describe('idempotency', () => {
    it('a second run changes nothing', () => {
      const card = buildCardDOM({
        hasUrlIcon: true,
        hasPropertiesBottom: true,
      });
      const body = bodyOf(card);

      syncStructuralClasses(card, body);
      const afterFirstRun = card.className;
      syncStructuralClasses(card, body);

      expect(card.className).toBe(afterFirstRun);
      expect(body.classList.contains('has-body-content')).toBe(true);
    });

    it('classes come off when the content goes', () => {
      const card = buildCardDOM({
        hasUrlIcon: true,
        hasPropertiesBottom: true,
      });
      const body = bodyOf(card);
      syncStructuralClasses(card, body);

      body.querySelector('.card-properties-bottom')!.remove();
      card.querySelector('.card-title-url-icon')!.remove();
      card.querySelector('.card-header')!.remove();
      syncStructuralClasses(card, body);

      expect(body.classList.contains('has-body-content')).toBe(false);
      expect(card.classList.contains('has-card-content')).toBe(false);
      expect(card.classList.contains('has-properties-bottom')).toBe(false);
      expect(card.classList.contains('has-header')).toBe(false);
      expect(card.classList.contains('has-url-icon')).toBe(false);
    });
  });

  describe('names-above', () => {
    function applyNamesAbove(el: HTMLElement, propertyNames: string): void {
      if (propertyNames === 'above') el.classList.add('names-above');
    }

    it('added to card-properties when propertyNames is above', () => {
      const card = buildCardDOM({ hasPropertiesTop: true });
      const propsTop = card.querySelector<HTMLElement>('.card-properties-top')!;
      applyNamesAbove(propsTop, 'above');
      expect(propsTop.classList.contains('names-above')).toBe(true);
    });

    it('not added when propertyNames is inline', () => {
      const card = buildCardDOM({ hasPropertiesTop: true });
      const propsTop = card.querySelector<HTMLElement>('.card-properties-top')!;
      applyNamesAbove(propsTop, 'inline');
      expect(propsTop.classList.contains('names-above')).toBe(false);
    });

    it('not added when propertyNames is hide', () => {
      const card = buildCardDOM({ hasPropertiesTop: true });
      const propsTop = card.querySelector<HTMLElement>('.card-properties-top')!;
      applyNamesAbove(propsTop, 'hide');
      expect(propsTop.classList.contains('names-above')).toBe(false);
    });
  });
});

describe('updateCardContent — URL button', () => {
  const settings = () => ({ ...VIEW_DEFAULTS }) as ResolvedSettings;

  /** Never dereferenced: title, subtitle and property paths all bail before touching it. */
  const entry = {} as unknown as BasesEntry;

  const cardData = (urlValue?: string) =>
    ({
      properties: [],
      hasValidUrl: !!urlValue,
      urlValue,
    }) as unknown as CardData;

  /** Three injected fields and an empty constructor body — none is reached from this path. */
  const makeRenderer = () =>
    new SharedCardRenderer({} as never, {} as never, { current: null });

  /** Card shaped like the render path leaves it: .card-content wraps header + body. */
  function buildCard(
    options: { header?: boolean; urlValue?: string; title?: boolean } = {}
  ): HTMLElement {
    const cardEl = document.createElement('div');
    cardEl.className = 'card';
    const contentEl = document.createElement('div');
    contentEl.className = 'card-content';
    cardEl.appendChild(contentEl);

    if (options.header || options.urlValue || options.title) {
      const headerEl = document.createElement('div');
      headerEl.className = 'card-header';
      contentEl.appendChild(headerEl);

      if (options.title) {
        const titleBlock = document.createElement('div');
        titleBlock.className = 'card-title-block';
        headerEl.appendChild(titleBlock);
      }
      if (options.urlValue) {
        const iconEl = document.createElement('a');
        iconEl.className = 'card-title-url-icon';
        iconEl.setAttribute('href', options.urlValue);
        iconEl.dataset.dynamicViewsUrlValue = options.urlValue;
        headerEl.appendChild(iconEl);
      }
    }

    const bodyEl = document.createElement('div');
    bodyEl.className = 'card-body';
    contentEl.appendChild(bodyEl);
    return cardEl;
  }

  it('creates the button when the header exists and the URL is valid', () => {
    const cardEl = buildCard({ header: true });

    makeRenderer().updateCardContent(
      cardEl,
      cardData('https://example.com'),
      entry,
      settings()
    );

    const iconEl = cardEl.querySelector<HTMLAnchorElement>(
      '.card-title-url-icon'
    );
    expect(iconEl).not.toBeNull();
    expect(iconEl!.getAttribute('href')).toBe('https://example.com');
    expect(iconEl!.getAttribute('aria-label')).toBe('https://example.com');
    expect(iconEl!.target).toBe('_blank');
    expect(cardEl.classList.contains('has-url-icon')).toBe(true);
  });

  it('removes the button and the emptied header when the URL goes', () => {
    const cardEl = buildCard({ urlValue: 'https://example.com' });

    makeRenderer().updateCardContent(cardEl, cardData(), entry, settings());

    expect(cardEl.querySelector('.card-title-url-icon')).toBeNull();
    expect(cardEl.querySelector('.card-header')).toBeNull();
    expect(cardEl.classList.contains('has-url-icon')).toBe(false);
    expect(cardEl.classList.contains('has-header')).toBe(false);
  });

  it('keeps a header that still holds a title block when the URL goes', () => {
    const cardEl = buildCard({
      urlValue: 'https://example.com',
      title: true,
    });

    makeRenderer().updateCardContent(cardEl, cardData(), entry, settings());

    expect(cardEl.querySelector('.card-title-url-icon')).toBeNull();
    expect(cardEl.querySelector('.card-header')).not.toBeNull();
    expect(cardEl.classList.contains('has-header')).toBe(true);
  });

  it('creates the header when the card has none (displayFirstAsTitle OFF)', () => {
    const cardEl = buildCard();

    makeRenderer().updateCardContent(
      cardEl,
      cardData('https://example.com'),
      entry,
      settings()
    );

    const headerEl = cardEl.querySelector<HTMLElement>('.card-header');
    expect(headerEl).not.toBeNull();
    expect(headerEl!.parentElement!.className).toBe('card-content');
    // Header must be the first child of .card-content, ahead of .card-body
    expect(headerEl!.previousElementSibling).toBeNull();
    expect(headerEl!.querySelector('.card-title-url-icon')).not.toBeNull();
    expect(cardEl.classList.contains('has-header')).toBe(true);
    expect(cardEl.classList.contains('has-url-icon')).toBe(true);
  });

  it('refreshes an existing button in place when the URL value changes', () => {
    const cardEl = buildCard({ urlValue: 'https://old.example' });
    const before = cardEl.querySelector<HTMLAnchorElement>(
      '.card-title-url-icon'
    );

    makeRenderer().updateCardContent(
      cardEl,
      cardData('https://new.example'),
      entry,
      settings()
    );

    const after = cardEl.querySelector<HTMLAnchorElement>(
      '.card-title-url-icon'
    );
    expect(after).toBe(before);
    expect(after!.getAttribute('href')).toBe('https://new.example');
    expect(after!.getAttribute('aria-label')).toBe('https://new.example');
    expect(after!.dataset.dynamicViewsUrlValue).toBe('https://new.example');
  });
});

describe('getPropertiesRenderedElsewhere', () => {
  const settings = (
    over: Partial<ResolvedSettings> = {}
  ): Pick<ResolvedSettings, 'textPreviewProperty' | 'urlProperty'> =>
    ({ ...VIEW_DEFAULTS, ...over }) as ResolvedSettings;

  it('excludes the text preview property', () => {
    const excluded = getPropertiesRenderedElsewhere(
      settings({ textPreviewProperty: 'note.description' })
    );
    expect(excluded.has('note.description')).toBe(true);
  });

  it('excludes the URL property', () => {
    const excluded = getPropertiesRenderedElsewhere(
      settings({ urlProperty: 'note.url' })
    );
    expect(excluded.has('note.url')).toBe(true);
  });

  // #437: an image is not a rendering of the property's text. Excluding it made
  // the value invisible whenever no image resolved — a broken reference showed no
  // image, no placeholder and no row.
  it('does NOT exclude the image property', () => {
    // imageProperty is deliberately absent from the parameter type, so the key is
    // set at runtime and cast back — a caller cannot reintroduce the exclusion
    // without also widening the signature.
    const withImageProperty = {
      ...settings(),
      imageProperty: 'note.image',
    } as Pick<ResolvedSettings, 'textPreviewProperty' | 'urlProperty'>;

    const excluded = getPropertiesRenderedElsewhere(withImageProperty);
    expect(excluded.has('note.image')).toBe(false);
    expect(excluded.size).toBe(0);
  });

  it('adds nothing for unset properties', () => {
    expect(
      getPropertiesRenderedElsewhere({
        textPreviewProperty: '',
        urlProperty: '',
      }).size
    ).toBe(0);
  });

  it('keeps both when the text preview and URL properties differ', () => {
    const excluded = getPropertiesRenderedElsewhere(
      settings({
        textPreviewProperty: 'note.description',
        urlProperty: 'note.url',
      })
    );
    expect([...excluded].sort()).toEqual(['note.description', 'note.url']);
  });
});

describe('Empty title marker', () => {
  /**
   * Mirrors the title resolution logic from renderCard/updateTitleText.
   * Tests the pure logic without requiring the full render pipeline.
   */
  function resolveTitleDisplay(
    titleProperty: string,
    rawTitle: string,
    basename: string,
    emptyMarker: string
  ): { displayTitle: string; isTitleEmpty: boolean } {
    const titleHasExtension =
      titleProperty === 'file.name' || titleProperty === 'file.fullname';
    const resolvedTitle = titleHasExtension ? basename : rawTitle;
    const isTitleEmpty = !resolvedTitle && !!titleProperty;
    const displayTitle = isTitleEmpty ? emptyMarker : resolvedTitle;
    return { displayTitle, isTitleEmpty };
  }

  it('shows empty marker when titleProperty is set but title is empty', () => {
    const result = resolveTitleDisplay('my-prop', '', 'note.md', '—');
    expect(result.isTitleEmpty).toBe(true);
    expect(result.displayTitle).toBe('—');
  });

  it('shows real title when titleProperty is set and title exists', () => {
    const result = resolveTitleDisplay(
      'my-prop',
      'Hello World',
      'note.md',
      '—'
    );
    expect(result.isTitleEmpty).toBe(false);
    expect(result.displayTitle).toBe('Hello World');
  });

  it('does not show marker when titleProperty is empty string', () => {
    const result = resolveTitleDisplay('', '', 'note.md', '—');
    expect(result.isTitleEmpty).toBe(false);
    expect(result.displayTitle).toBe('');
  });

  it('never shows marker for file.name (basename always exists)', () => {
    const result = resolveTitleDisplay('file.name', '', 'note', '—');
    expect(result.isTitleEmpty).toBe(false);
    expect(result.displayTitle).toBe('note');
  });

  it('never shows marker for file.fullname (basename always exists)', () => {
    const result = resolveTitleDisplay('file.fullname', '', 'note', '—');
    expect(result.isTitleEmpty).toBe(false);
    expect(result.displayTitle).toBe('note');
  });

  it('uses custom empty marker value', () => {
    const result = resolveTitleDisplay('my-prop', '', 'note.md', 'N/A');
    expect(result.isTitleEmpty).toBe(true);
    expect(result.displayTitle).toBe('N/A');
  });

  describe('DOM class toggle', () => {
    it('adds empty-value-marker class when title is empty', () => {
      const el = document.createElement('span');
      el.className = 'card-title-text';
      const { isTitleEmpty } = resolveTitleDisplay(
        'my-prop',
        '',
        'note.md',
        '—'
      );
      el.classList.toggle('empty-value-marker', isTitleEmpty);
      expect(el.classList.contains('empty-value-marker')).toBe(true);
    });

    it('removes empty-value-marker class when title is non-empty', () => {
      const el = document.createElement('span');
      el.className = 'card-title-text empty-value-marker';
      const { isTitleEmpty } = resolveTitleDisplay(
        'my-prop',
        'Title',
        'note.md',
        '—'
      );
      el.classList.toggle('empty-value-marker', isTitleEmpty);
      expect(el.classList.contains('empty-value-marker')).toBe(false);
    });
  });
});

describe('Property newline stripping', () => {
  /**
   * Mirrors the newline-stripping logic from renderPropertyContent.
   * Tests the pure conditional without requiring the full render pipeline.
   */
  function resolvePropertyValue(
    stringValue: string,
    isSubtitle: boolean
  ): string {
    return isSubtitle ? stringValue : stringValue.replace(/\n/g, ' ');
  }

  it('preserves newlines for subtitle properties', () => {
    expect(resolvePropertyValue('Line one\nLine two', true)).toBe(
      'Line one\nLine two'
    );
  });

  it('strips newlines for regular properties', () => {
    expect(resolvePropertyValue('Line one\nLine two', false)).toBe(
      'Line one Line two'
    );
  });

  it('handles multiple newlines in regular properties', () => {
    expect(resolvePropertyValue('A\nB\nC', false)).toBe('A B C');
  });

  it('handles text with no newlines (both paths)', () => {
    expect(resolvePropertyValue('No breaks', true)).toBe('No breaks');
    expect(resolvePropertyValue('No breaks', false)).toBe('No breaks');
  });
});

describe('applyCssOnlySettings — poster display mode re-clip', () => {
  function mockConfig(overrides: Record<string, unknown>) {
    return {
      get: (key: string) => overrides[key],
    } as unknown as BasesViewConfig;
  }

  function makeContainer(...classes: string[]): HTMLElement {
    const container = document.createElement('div');
    container.classList.add(...classes);
    const card = document.createElement('div');
    card.className = 'card image-format-poster has-poster';
    container.appendChild(card);
    document.body.appendChild(container);
    return container;
  }

  beforeEach(() => {
    vi.mocked(getOwnerWindow).mockReturnValue(
      window as unknown as Window & typeof globalThis
    );
  });

  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it('defers re-clip via rAF on fade→overlay switch while static', () => {
    const rAF = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb) => {
        cb(0);
        return 0;
      });
    const container = makeContainer('poster-mode-fade', 'poster-static');

    applyCssOnlySettings(
      mockConfig({
        posterDisplayMode: 'overlay',
        posterInteractToReveal: false,
      }),
      container
    );

    expect(rAF).toHaveBeenCalledTimes(1);
    expect(container.classList.contains('poster-mode-overlay')).toBe(true);
    rAF.mockRestore();
  });

  it('defers re-clip via rAF on overlay→fade switch while static', () => {
    const rAF = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb) => {
        cb(0);
        return 0;
      });
    const container = makeContainer('poster-mode-overlay', 'poster-static');

    applyCssOnlySettings(
      mockConfig({ posterDisplayMode: 'fade', posterInteractToReveal: false }),
      container
    );

    expect(rAF).toHaveBeenCalledTimes(1);
    expect(container.classList.contains('poster-mode-fade')).toBe(true);
    rAF.mockRestore();
  });

  it('does NOT re-clip on first call (prevMode is null)', () => {
    const rAF = vi.spyOn(window, 'requestAnimationFrame');
    const container = makeContainer('poster-static');

    applyCssOnlySettings(
      mockConfig({
        posterDisplayMode: 'overlay',
        posterInteractToReveal: false,
      }),
      container
    );

    expect(rAF).not.toHaveBeenCalled();
    rAF.mockRestore();
  });

  it('does NOT re-clip when mode unchanged', () => {
    const rAF = vi.spyOn(window, 'requestAnimationFrame');
    const container = makeContainer('poster-mode-fade', 'poster-static');

    applyCssOnlySettings(
      mockConfig({ posterDisplayMode: 'fade', posterInteractToReveal: false }),
      container
    );

    expect(rAF).not.toHaveBeenCalled();
    rAF.mockRestore();
  });

  it('does NOT re-clip when not in static mode', () => {
    const rAF = vi.spyOn(window, 'requestAnimationFrame');
    const container = makeContainer('poster-mode-fade');

    applyCssOnlySettings(
      mockConfig({
        posterDisplayMode: 'overlay',
        posterInteractToReveal: true,
      }),
      container
    );

    expect(rAF).not.toHaveBeenCalled();
    rAF.mockRestore();
  });
});

describe('applyCssOnlySettings — class swap gating', () => {
  function mockConfig(overrides: Record<string, unknown>) {
    return {
      get: (key: string) => overrides[key],
    } as unknown as BasesViewConfig;
  }

  beforeEach(() => {
    vi.mocked(getOwnerWindow).mockReturnValue(
      window as unknown as Window & typeof globalThis
    );
  });

  it('swaps the poster mode and image fit classes once across identical calls', () => {
    const container = document.createElement('div');
    const config = mockConfig({
      posterDisplayMode: 'overlay',
      imageFit: 'contain',
      posterInteractToReveal: true,
    });

    applyCssOnlySettings(config, container);
    const remove = vi.spyOn(container.classList, 'remove');
    applyCssOnlySettings(config, container);

    expect(remove).not.toHaveBeenCalled();
    expect(container.classList.contains('poster-mode-overlay')).toBe(true);
    expect(container.classList.contains('image-fit-contain')).toBe(true);
    remove.mockRestore();
  });

  it('still swaps when the value changes', () => {
    const container = document.createElement('div');

    applyCssOnlySettings(
      mockConfig({
        posterDisplayMode: 'fade',
        imageFit: 'crop',
        posterInteractToReveal: true,
      }),
      container
    );
    applyCssOnlySettings(
      mockConfig({
        posterDisplayMode: 'overlay',
        imageFit: 'contain',
        posterInteractToReveal: true,
      }),
      container
    );

    expect(container.classList.contains('poster-mode-overlay')).toBe(true);
    expect(container.classList.contains('poster-mode-fade')).toBe(false);
    expect(container.classList.contains('image-fit-contain')).toBe(true);
    expect(container.classList.contains('image-fit-crop')).toBe(false);
  });
});

describe('applyCssOnlySettings — text preview re-clip gating', () => {
  function mockConfig(textPreviewLines: number, isStatic = true) {
    const values: Record<string, unknown> = {
      textPreviewLines,
      posterDisplayMode: 'fade',
      imageFit: 'crop',
      posterInteractToReveal: !isStatic,
    };
    return { get: (key: string) => values[key] } as unknown as BasesViewConfig;
  }

  function makeStaticContainer(): HTMLElement {
    const container = document.createElement('div');
    container.classList.add('poster-static');
    const card = document.createElement('div');
    card.className = 'card image-format-poster has-poster';
    container.appendChild(card);
    return container;
  }

  beforeEach(() => {
    vi.mocked(getOwnerWindow).mockReturnValue(
      window as unknown as Window & typeof globalThis
    );
    vi.mocked(clipPosterStaticOverflowBatch).mockClear();
  });

  it('re-clips once when the line count is unchanged', () => {
    const container = makeStaticContainer();

    applyCssOnlySettings(mockConfig(5), container);
    applyCssOnlySettings(mockConfig(5), container);
    applyCssOnlySettings(mockConfig(5), container);

    expect(clipPosterStaticOverflowBatch).toHaveBeenCalledTimes(1);
  });

  it('re-clips again when the line count changes', () => {
    const container = makeStaticContainer();

    applyCssOnlySettings(mockConfig(5), container);
    applyCssOnlySettings(mockConfig(6), container);

    expect(clipPosterStaticOverflowBatch).toHaveBeenCalledTimes(2);
  });

  // The value is recorded outside the poster-static branch, so entering static
  // mode runs only the mode-transition batch, not a second line-count batch.
  it('records the line count while not static', () => {
    const container = makeStaticContainer();
    container.classList.remove('poster-static');

    applyCssOnlySettings(mockConfig(5, false), container);
    expect(clipPosterStaticOverflowBatch).not.toHaveBeenCalled();

    applyCssOnlySettings(mockConfig(5, true), container);

    expect(clipPosterStaticOverflowBatch).toHaveBeenCalledTimes(1);
  });
});

describe('applyViewContainerStyles — card gap variable', () => {
  const settings = (overrides: Partial<ResolvedSettings> = {}) =>
    ({ ...VIEW_DEFAULTS, ...overrides }) as ResolvedSettings;

  beforeEach(() => {
    vi.mocked(clearStyleSettingsCache).mockClear();
  });

  afterEach(() => {
    Platform.isPhone = false;
  });

  it('writes the desktop variable when not on a phone', () => {
    const container = document.createElement('div');

    applyViewContainerStyles(container, settings({ cardGapDesktop: 20 }));

    expect(
      container.style.getPropertyValue('--dynamic-views-card-spacing-desktop')
    ).toBe('20px');
    expect(
      container.style.getPropertyValue('--dynamic-views-card-spacing-phone')
    ).toBe('');
    expect(clearStyleSettingsCache).toHaveBeenCalledTimes(1);
  });

  it('writes the phone variable on a phone', () => {
    Platform.isPhone = true;
    const container = document.createElement('div');

    applyViewContainerStyles(container, settings());

    expect(
      container.style.getPropertyValue('--dynamic-views-card-spacing-phone')
    ).toBe('6px');
    expect(
      container.style.getPropertyValue('--dynamic-views-card-spacing-desktop')
    ).toBe('');
    expect(clearStyleSettingsCache).toHaveBeenCalledTimes(1);
  });

  it('writes once and clears the cache once when the gap is unchanged', () => {
    const container = document.createElement('div');
    const setProperty = vi.spyOn(container.style, 'setProperty');

    applyViewContainerStyles(container, settings({ cardGapDesktop: 20 }));
    applyViewContainerStyles(container, settings({ cardGapDesktop: 20 }));

    const gapWrites = setProperty.mock.calls.filter(
      ([name]) => name === '--dynamic-views-card-spacing-desktop'
    );
    expect(gapWrites).toHaveLength(1);
    expect(clearStyleSettingsCache).toHaveBeenCalledTimes(1);
    setProperty.mockRestore();
  });
});

describe('applyViewContainerStyles — subtitle scroll derivation', () => {
  const SCROLL_BODY_CLASS = 'dynamic-views-subtitle-overflow-scroll';

  const settings = (subtitleLines: number) =>
    ({ ...VIEW_DEFAULTS, subtitleLines }) as ResolvedSettings;

  afterEach(() => {
    document.body.classList.remove(SCROLL_BODY_CLASS);
  });

  /** Returns whether the scroll class landed, for the four-cell truth table below. */
  const applyWith = (
    subtitleLines: number,
    bodyClass: boolean
  ): HTMLElement => {
    document.body.classList.toggle(SCROLL_BODY_CLASS, bodyClass);
    const container = document.createElement('div');
    applyViewContainerStyles(container, settings(subtitleLines));
    return container;
  };

  it('scrolls a single-line subtitle while the body class is set', () => {
    expect(applyWith(1, true).classList.contains('subtitle-scroll')).toBe(true);
  });

  it('does not scroll a single-line subtitle without the body class', () => {
    expect(applyWith(1, false).classList.contains('subtitle-scroll')).toBe(
      false
    );
  });

  // A wrapped subtitle has nothing to scroll, so the wrap rules must stay live.
  it('does not scroll a multi-line subtitle even with the body class', () => {
    expect(applyWith(2, true).classList.contains('subtitle-scroll')).toBe(
      false
    );
  });

  it('does not scroll a multi-line subtitle without the body class', () => {
    expect(applyWith(2, false).classList.contains('subtitle-scroll')).toBe(
      false
    );
  });

  it('writes the subtitle line count regardless of the scroll mode', () => {
    expect(
      applyWith(1, true).style.getPropertyValue(
        '--dynamic-views-subtitle-lines'
      )
    ).toBe('1');
    expect(
      applyWith(3, false).style.getPropertyValue(
        '--dynamic-views-subtitle-lines'
      )
    ).toBe('3');
  });
});

describe('applyViewContainerStyles — view padding override', () => {
  const settings = (overrides: Partial<ResolvedSettings> = {}) =>
    ({ ...VIEW_DEFAULTS, ...overrides }) as ResolvedSettings;

  const mountInScrollEl = () => {
    const scrollEl = document.createElement('div');
    scrollEl.className = 'bases-view';
    const container = document.createElement('div');
    scrollEl.appendChild(container);
    return { scrollEl, container };
  };

  // Must stay a PLAIN length: Masonry feeds it to overflow-clip-margin, which
  // rejects calc()/max() and computes 0, clipping the sticky header background
  // at the container edge. jsdom reports no value for the chrome inset token, so
  // these exercise the DEFAULT_CHROME_INSET fallback path — the runtime checks
  // cover resolution against the real token.
  it('writes the gap onto the scroll element as a plain length', () => {
    const { scrollEl, container } = mountInScrollEl();

    applyViewContainerStyles(container, settings({ cardGapDesktop: 20 }));

    expect(scrollEl.style.getPropertyValue('--bases-view-padding')).toBe(
      '20px'
    );
  });

  // Gaps below the floor are the reason it exists — the slider reaches 0, which
  // would otherwise put the cards flush against the pane edge.
  it.each([0, 6, 8])('floors a %ipx gap at the chrome inset', (gap) => {
    const { scrollEl, container } = mountInScrollEl();

    applyViewContainerStyles(container, settings({ cardGapDesktop: gap }));

    expect(scrollEl.style.getPropertyValue('--bases-view-padding')).toBe(
      '12px'
    );
  });

  it('never writes a calc() or max() expression', () => {
    const { scrollEl, container } = mountInScrollEl();

    for (const gap of [0, 8, 12, 64]) {
      applyViewContainerStyles(container, settings({ cardGapDesktop: gap }));
      const written = scrollEl.style.getPropertyValue('--bases-view-padding');
      expect(written).toMatch(/^\d+(\.\d+)?px$/);
    }
  });

  // The element outlives the view, so a stale marker would make the next view
  // skip the write entirely and inherit whatever padding was left behind.
  it('clears the gap guard on teardown so a reused scroll element re-writes', () => {
    const { scrollEl, container } = mountInScrollEl();
    applyViewContainerStyles(container, settings({ cardGapDesktop: 20 }));
    expect(scrollEl.dataset.dynamicViewsGap).toBe('20px');

    clearViewContainerStyles(container);
    expect(scrollEl.dataset.dynamicViewsGap).toBeUndefined();

    applyViewContainerStyles(container, settings({ cardGapDesktop: 20 }));
    expect(scrollEl.style.getPropertyValue('--bases-view-padding')).toBe(
      '20px'
    );
  });

  it('skips the write inside an embed', () => {
    const embed = document.createElement('div');
    embed.className = 'bases-embed';
    const { scrollEl, container } = mountInScrollEl();
    embed.appendChild(scrollEl);

    applyViewContainerStyles(container, settings({ cardGapDesktop: 20 }));

    expect(scrollEl.style.getPropertyValue('--bases-view-padding')).toBe('');
  });

  // .bases-view outlives the view — a leftover override becomes the next view
  // type's padding, so teardown must release it.
  it('releases the override on teardown', () => {
    const { scrollEl, container } = mountInScrollEl();
    applyViewContainerStyles(container, settings({ cardGapDesktop: 20 }));

    clearViewContainerStyles(container);

    expect(scrollEl.style.getPropertyValue('--bases-view-padding')).toBe('');
  });

  it('is a no-op when the container has no scroll element', () => {
    const container = document.createElement('div');

    expect(() => clearViewContainerStyles(container)).not.toThrow();
  });
});

describe('renderCard — titleless open-on-title fallback', () => {
  /** Only `file.basename` is read, and only when the title property carries an extension. */
  const entry = {
    file: { basename: 'Note' },
  } as unknown as BasesEntry;

  /** Every handler that would touch these is bound but never fired. */
  const app = {
    isMobile: false,
    workspace: { trigger: vi.fn() },
    vault: { getAbstractFileByPath: vi.fn() },
    keymap: { pushScope: vi.fn(), popScope: vi.fn() },
  };

  const makeRenderer = () =>
    new SharedCardRenderer(app as never, {} as never, { current: null });

  const cardData = (title?: string) =>
    ({ path: 'Note.md', title, properties: [] }) as unknown as CardData;

  const settings = (over: Partial<ResolvedSettings> = {}): ResolvedSettings =>
    ({ ...VIEW_DEFAULTS, openOnTitle: false, ...over }) as ResolvedSettings;

  let container: HTMLElement;

  beforeEach(() => {
    // renderCard reads ResizeObserver off the card's own window — jsdom has none.
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
    vi.mocked(getOwnerWindow).mockReturnValue(
      window as unknown as Window & typeof globalThis
    );
    vi.mocked(filterBrokenUrls).mockReturnValue([]);
    vi.mocked(getEmptyValueMarker).mockReturnValue('—');

    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('opens on the card when open-on-title has no title to bind to', () => {
    const { el } = makeRenderer().renderCard(
      container,
      cardData(),
      entry,
      settings({ openOnTitle: true, titleProperty: '' })
    );

    expect(el.querySelector('.card-title')).toBeNull();
    expect(el.classList.contains('clickable-card')).toBe(true);
    expect(el.getAttribute('draggable')).toBe('true');
  });

  it('leaves a titled card bound to its title', () => {
    const { el } = makeRenderer().renderCard(
      container,
      cardData('Some title'),
      entry,
      settings({ openOnTitle: true, titleProperty: 'note.title' })
    );

    expect(el.querySelector('a.card-title-text')).not.toBeNull();
    expect(el.classList.contains('clickable-card')).toBe(false);
    expect(el.getAttribute('draggable')).toBeNull();
  });

  // The empty-value marker is itself the link, so the card must not take over.
  it('leaves a card whose title property resolves to the empty marker bound to its title', () => {
    const { el } = makeRenderer().renderCard(
      container,
      cardData(),
      entry,
      settings({ openOnTitle: true, titleProperty: 'note.title' })
    );

    const link = el.querySelector('a.card-title-text');
    expect(link).not.toBeNull();
    expect(link!.classList.contains('empty-value-marker')).toBe(true);
    expect(el.classList.contains('clickable-card')).toBe(false);
  });

  it('leaves open-on-card untouched when there is no title', () => {
    const { el } = makeRenderer().renderCard(
      container,
      cardData(),
      entry,
      settings({ openOnTitle: false, titleProperty: '' })
    );

    expect(el.classList.contains('clickable-card')).toBe(true);
  });
});
