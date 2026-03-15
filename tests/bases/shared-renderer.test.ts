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
  showTimestampIcon: vi.fn(),
  getEmptyValueMarker: vi.fn(),
  shouldHideMissingProperties: vi.fn(),
  getListSeparator: vi.fn(),
  isSlideshowEnabled: vi.fn(),
  isSlideshowIndicatorEnabled: vi.fn(),
  isThumbnailScrubbingDisabled: vi.fn(),
  getSlideshowMaxImages: vi.fn(),
  getUrlButtonIcon: vi.fn(),
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
