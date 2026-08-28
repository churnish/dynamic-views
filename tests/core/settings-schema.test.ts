import { vi } from 'vitest';
import { Platform } from 'obsidian';
import {
  readBasesSettings,
  extractBasesTemplate,
  getBasesViewOptions,
} from '../../src/core/settings-schema';

// Mock constants (same pattern as cleanup.test.ts)
vi.mock('../../src/constants', () => ({
  VIEW_DEFAULTS: {
    cardSize: 300,
    titleProperty: 'file.name',
    titleLines: 2,
    subtitleProperty: 'file.folder',
    subtitleLines: 2,
    displayFirstAsTitle: false,
    displaySecondAsSubtitle: false,
    textPreviewProperty: '',
    fallbackToContent: true,
    textPreviewLines: 5,
    imageProperty: '',
    showFileImages: 'always',
    imageFormat: 'thumbnail',
    posterDisplayMode: 'fade',
    tint: 'adapt',
    posterInteractToReveal: false,
    thumbnailSize: 80,
    imagePosition: 'right',
    imageFit: 'crop',
    imageRatio: 1.0,
    propertyNames: 'hide',
    pairProperties: false,
    rightPropertyPosition: 'right',
    invertPropertyPairing: '',
    showPropertiesAbove: false,
    invertPropertyPosition: '',
    urlProperty: 'url',
    minimumColumns: 1,
    cssclasses: '',
  },
  BASES_DEFAULTS: {
    displayFirstAsTitle: true,
    displaySecondAsSubtitle: false,
    propertyNames: 'inline',
  },
}));

/** Minimal mock implementing the BasesConfig interface */
function createMockConfig(values: Record<string, unknown>, order: string[]) {
  return {
    get: (key: string) => values[key],
    getOrder: () => order,
  };
}

/** Walks the schema groups to find a leaf item by key. */
function findItem(options: any[], key: string): any {
  for (const option of options) {
    if (option.key === key) return option;
    if (option.items) {
      const found = findItem(option.items, key);
      if (found) return found;
    }
  }
  return undefined;
}

const MOCK_VIEW_DEFAULTS: any = {
  cardSize: 300,
  titleProperty: 'file.name',
  titleLines: 2,
  subtitleProperty: 'file.folder',
  subtitleLines: 2,
  displayFirstAsTitle: false,
  displaySecondAsSubtitle: false,
  textPreviewProperty: '',
  fallbackToContent: true,
  textPreviewLines: 5,
  imageProperty: '',
  showFileImages: 'always',
  imageFormat: 'thumbnail',
  posterDisplayMode: 'fade',
  tint: 'adapt',
  posterInteractToReveal: false,
  thumbnailSize: 80,
  imagePosition: 'right',
  imageFit: 'crop',
  imageRatio: 1.0,
  propertyNames: 'hide',
  pairProperties: false,
  rightPropertyPosition: 'right',
  invertPropertyPairing: '',
  showPropertiesAbove: false,
  invertPropertyPosition: '',
  urlProperty: 'url',
  minimumColumns: 1,
  cssclasses: '',
};

const MOCK_PLUGIN_SETTINGS: any = {
  randomizeAction: 'shuffle',
  openOnTitle: false,
  smartTimestamp: true,
  createdTimeProperty: 'created time',
  modifiedTimeProperty: 'modified time',
  preventSidebarSwipe: true,
  revealInNotebookNavigator: 'disable',
  showYoutubeThumbnails: true,
  showCardLinkCovers: true,
};

describe('readBasesSettings — position-based title/subtitle', () => {
  it('should derive titleProperty from order[0] when displayFirstAsTitle is true', () => {
    const config = createMockConfig({ displayFirstAsTitle: true }, [
      'note.director',
      'note.year',
    ]);
    const result = readBasesSettings(config, MOCK_PLUGIN_SETTINGS);
    expect(result.titleProperty).toBe('note.director');
    expect(result.subtitleProperty).toBe('');
    expect(result._skipLeadingProperties).toBe(1);
  });

  it('should derive both title and subtitle when both toggles are true', () => {
    const config = createMockConfig(
      { displayFirstAsTitle: true, displaySecondAsSubtitle: true },
      ['note.director', 'note.year', 'note.genre']
    );
    const result = readBasesSettings(config, MOCK_PLUGIN_SETTINGS);
    expect(result.titleProperty).toBe('note.director');
    expect(result.subtitleProperty).toBe('note.year');
    expect(result._skipLeadingProperties).toBe(2);
  });

  it('should not derive subtitle when order has only one item', () => {
    const config = createMockConfig(
      { displayFirstAsTitle: true, displaySecondAsSubtitle: true },
      ['note.director']
    );
    const result = readBasesSettings(config, MOCK_PLUGIN_SETTINGS);
    expect(result.titleProperty).toBe('note.director');
    expect(result.subtitleProperty).toBe('');
    expect(result._skipLeadingProperties).toBe(1);
  });

  it('should not derive title or subtitle when displayFirstAsTitle is false', () => {
    const config = createMockConfig({ displayFirstAsTitle: false }, [
      'note.director',
      'note.year',
    ]);
    const result = readBasesSettings(config, MOCK_PLUGIN_SETTINGS);
    expect(result.titleProperty).toBe('');
    expect(result.subtitleProperty).toBe('');
    expect(result._skipLeadingProperties).toBe(0);
  });

  it('should not derive title when order is empty', () => {
    const config = createMockConfig({ displayFirstAsTitle: true }, []);
    const result = readBasesSettings(config, MOCK_PLUGIN_SETTINGS);
    expect(result.titleProperty).toBe('');
    expect(result._skipLeadingProperties).toBe(0);
  });

  it('should use BASES_DEFAULTS (displayFirstAsTitle: true) when config has no override', () => {
    const config = createMockConfig(
      {}, // no displayFirstAsTitle override — falls back to BASES_DEFAULTS.displayFirstAsTitle (true)
      ['note.title', 'note.author']
    );
    const result = readBasesSettings(config, MOCK_PLUGIN_SETTINGS);
    expect(result.titleProperty).toBe('note.title');
    expect(result._skipLeadingProperties).toBe(1);
  });
  it('should skip special properties in position-based title/subtitle derivation', () => {
    const config = createMockConfig(
      {
        displayFirstAsTitle: true,
        displaySecondAsSubtitle: true,
        textPreviewProperty: 'note.summary',
      },
      ['note.summary', 'note.title', 'note.author']
    );
    const result = readBasesSettings(config, MOCK_PLUGIN_SETTINGS);
    expect(result.titleProperty).toBe('note.title');
    expect(result.subtitleProperty).toBe('note.author');
    expect(result._skipLeadingProperties).toBe(3);
  });
});

describe('readBasesSettings — hidden property visibility', () => {
  it('should clear urlProperty and textPreviewProperty when not in getOrder()', () => {
    const config = createMockConfig(
      { urlProperty: 'note.url', textPreviewProperty: 'note.summary' },
      ['note.title', 'note.author']
    );
    const result = readBasesSettings(config, MOCK_PLUGIN_SETTINGS);
    expect(result.urlProperty).toBe('');
    expect(result.textPreviewProperty).toBe('');
  });

  it('should keep urlProperty and textPreviewProperty when in getOrder()', () => {
    const config = createMockConfig(
      { urlProperty: 'note.url', textPreviewProperty: 'note.summary' },
      ['note.title', 'note.url', 'note.summary']
    );
    const result = readBasesSettings(config, MOCK_PLUGIN_SETTINGS);
    expect(result.urlProperty).toBe('note.url');
    expect(result.textPreviewProperty).toBe('note.summary');
  });
});

describe('readBasesSettings — posterDisplayMode', () => {
  it('should read posterDisplayMode from config', () => {
    const config = createMockConfig({ posterDisplayMode: 'overlay' }, []);
    const result = readBasesSettings(config, MOCK_PLUGIN_SETTINGS);
    expect(result.posterDisplayMode).toBe('overlay');
  });

  it('should fall back to default for invalid posterDisplayMode', () => {
    const config = createMockConfig({ posterDisplayMode: 'invalid' }, []);
    const result = readBasesSettings(config, MOCK_PLUGIN_SETTINGS);
    expect(result.posterDisplayMode).toBe('fade');
  });

  it('should fall back to default for stale posterDisplayMode "gradient"', () => {
    const config = createMockConfig({ posterDisplayMode: 'gradient' }, []);
    const result = readBasesSettings(config, MOCK_PLUGIN_SETTINGS);
    expect(result.posterDisplayMode).toBe('fade');
  });
});

describe('readBasesSettings — posterInteractToReveal', () => {
  it('should read posterInteractToReveal from config', () => {
    const config = createMockConfig({ posterInteractToReveal: true }, []);
    const result = readBasesSettings(config, MOCK_PLUGIN_SETTINGS);
    expect(result.posterInteractToReveal).toBe(true);
  });

  it('should default posterInteractToReveal to false', () => {
    const config = createMockConfig({}, []);
    const result = readBasesSettings(config, MOCK_PLUGIN_SETTINGS);
    expect(result.posterInteractToReveal).toBe(false);
  });
});

describe('readBasesSettings — subtitleLines', () => {
  it('should read subtitleLines from config', () => {
    const config = createMockConfig({ subtitleLines: 1 }, []);
    const result = readBasesSettings(config, MOCK_PLUGIN_SETTINGS);
    expect(result.subtitleLines).toBe(1);
  });

  it('should default subtitleLines to 2', () => {
    const config = createMockConfig({}, []);
    const result = readBasesSettings(config, MOCK_PLUGIN_SETTINGS);
    expect(result.subtitleLines).toBe(2);
  });

  it('should ignore non-numeric subtitleLines', () => {
    const config = createMockConfig({ subtitleLines: '3' }, []);
    const result = readBasesSettings(config, MOCK_PLUGIN_SETTINGS);
    expect(result.subtitleLines).toBe(2);
  });

  it('should use templateOverrides for subtitleLines', () => {
    const config = createMockConfig({}, []);
    const result = readBasesSettings(
      config,
      MOCK_PLUGIN_SETTINGS,
      'grid',
      undefined,
      { subtitleLines: 4 }
    );
    expect(result.subtitleLines).toBe(4);
  });
});

describe('readBasesSettings — numeric range clamping', () => {
  it('clamps a subtitleLines above the slider maximum', () => {
    const config = createMockConfig({ subtitleLines: 40 }, []);
    expect(readBasesSettings(config, MOCK_PLUGIN_SETTINGS).subtitleLines).toBe(
      5
    );
  });

  it('clamps a subtitleLines below the slider minimum', () => {
    const config = createMockConfig({ subtitleLines: 0 }, []);
    expect(readBasesSettings(config, MOCK_PLUGIN_SETTINGS).subtitleLines).toBe(
      1
    );
  });

  it('leaves an in-range subtitleLines untouched', () => {
    const config = createMockConfig({ subtitleLines: 3 }, []);
    expect(readBasesSettings(config, MOCK_PLUGIN_SETTINGS).subtitleLines).toBe(
      3
    );
  });

  it('rounds fractional line counts', () => {
    const config = createMockConfig({ subtitleLines: 2.5 }, []);
    expect(readBasesSettings(config, MOCK_PLUGIN_SETTINGS).subtitleLines).toBe(
      3
    );
  });

  it('clamps cardSize and thumbnailSize to their slider bounds', () => {
    const config = createMockConfig({ cardSize: 5000, thumbnailSize: 2 }, []);
    const result = readBasesSettings(config, MOCK_PLUGIN_SETTINGS);
    expect(result.cardSize).toBe(800);
    expect(result.thumbnailSize).toBe(64);
  });

  it('clamps imageRatio without rounding it', () => {
    expect(
      readBasesSettings(
        createMockConfig({ imageRatio: 1.35 }, []),
        MOCK_PLUGIN_SETTINGS
      ).imageRatio
    ).toBe(1.35);
    expect(
      readBasesSettings(
        createMockConfig({ imageRatio: 9 }, []),
        MOCK_PLUGIN_SETTINGS
      ).imageRatio
    ).toBe(2.5);
  });

  it('clamps card gap to the slider bounds', () => {
    const config = createMockConfig({ cardGapDesktop: 500 }, []);
    const result = readBasesSettings(config, MOCK_PLUGIN_SETTINGS);
    expect(result.cardGapDesktop).toBe(64);
  });

  // The lower bound used to be covered via the retired phone key; keep it
  // asserted now that cardGapDesktop is the only gap setting.
  it('clamps card gap up to the slider minimum', () => {
    const config = createMockConfig({ cardGapDesktop: -10 }, []);
    const result = readBasesSettings(config, MOCK_PLUGIN_SETTINGS);
    expect(result.cardGapDesktop).toBe(0);
  });
});

describe('getBasesViewOptions — boolean predicate parity', () => {
  it('hides Subtitle lines when displaySecondAsSubtitle is a non-boolean', () => {
    const config = createMockConfig(
      {
        id: 'x-grid',
        displayFirstAsTitle: true,
        displaySecondAsSubtitle: 'true',
      },
      []
    ) as any;
    const item = findItem(getBasesViewOptions('grid', config), 'subtitleLines');
    expect(item.shouldHide()).toBe(true);
  });

  it('shows Subtitle lines when both toggles are real booleans', () => {
    const config = createMockConfig(
      {
        id: 'x-grid',
        displayFirstAsTitle: true,
        displaySecondAsSubtitle: true,
      },
      []
    ) as any;
    const item = findItem(getBasesViewOptions('grid', config), 'subtitleLines');
    expect(item.shouldHide()).toBe(false);
  });

  it('hides Lines when displayFirstAsTitle is a non-boolean', () => {
    const config = createMockConfig(
      { id: 'x-grid', displayFirstAsTitle: 'false' },
      []
    ) as any;
    const item = findItem(getBasesViewOptions('grid', config), 'titleLines');
    // BASES_DEFAULTS.displayFirstAsTitle is true, so the fallback keeps the row visible
    expect(item.shouldHide()).toBe(false);
  });
});

describe('getBasesViewOptions — subtitleLines gate', () => {
  // displaySecondAsSubtitle can stay stored as true while displayFirstAsTitle is
  // off — its own row is hidden then — so both toggles have to be checked.
  const cases: Array<[boolean, boolean, boolean]> = [
    [false, false, true],
    [false, true, true],
    [true, false, true],
    [true, true, false],
  ];

  for (const [displayFirstAsTitle, displaySecondAsSubtitle, hidden] of cases) {
    const verb = hidden ? 'hides' : 'shows';
    it(`${verb} Subtitle lines for title=${displayFirstAsTitle}, subtitle=${displaySecondAsSubtitle}`, () => {
      const config = createMockConfig(
        { id: 'x-grid', displayFirstAsTitle, displaySecondAsSubtitle },
        []
      ) as any;
      const item = findItem(
        getBasesViewOptions('grid', config),
        'subtitleLines'
      );
      expect(item.shouldHide()).toBe(hidden);
    });
  }
});

describe('getBasesViewOptions — card gap platform branch', () => {
  afterEach(() => {
    Platform.isPhone = false;
  });

  it('shows the desktop gap slider off phone', () => {
    const item = findItem(getBasesViewOptions('grid'), 'cardGapDesktop');
    expect(item).toBeDefined();
    expect(item.shouldHide()).toBe(false);
  });

  it('hides the desktop gap slider on phone', () => {
    Platform.isPhone = true;
    const item = findItem(getBasesViewOptions('grid'), 'cardGapDesktop');
    expect(item).toBeDefined();
    expect(item.shouldHide()).toBe(true);
  });

  it('never emits the retired phone gap key', () => {
    expect(
      findItem(getBasesViewOptions('grid'), 'cardGapPhone')
    ).toBeUndefined();
  });
});

describe('readBasesSettings — templateOverrides', () => {
  it('should use templateOverrides when config has no value', () => {
    const config = createMockConfig({}, []);
    const result = readBasesSettings(
      config,
      MOCK_PLUGIN_SETTINGS,
      'grid',
      undefined,
      { cardSize: 500 }
    );
    expect(result.cardSize).toBe(500);
  });

  it('should prefer config values over templateOverrides', () => {
    const config = createMockConfig({ cardSize: 600 }, []);
    const result = readBasesSettings(
      config,
      MOCK_PLUGIN_SETTINGS,
      'grid',
      undefined,
      { cardSize: 500 }
    );
    expect(result.cardSize).toBe(600);
  });

  it('should apply templateOverrides to enum fallbacks', () => {
    const config = createMockConfig({}, []);
    const result = readBasesSettings(
      config,
      MOCK_PLUGIN_SETTINGS,
      'grid',
      undefined,
      { propertyNames: 'above' }
    );
    expect(result.propertyNames).toBe('above');
  });
});

describe('extractBasesTemplate', () => {
  // VIEW_DEFAULTS from mock: cardSize=300, displayFirstAsTitle=false, propertyNames="hide"
  // BASES_DEFAULTS from mock: displayFirstAsTitle=true, propertyNames="inline"
  // mergedDefaults: cardSize=300, displayFirstAsTitle=true, propertyNames="inline"

  it('should return only non-default values (sparse)', () => {
    const config = createMockConfig({ cardSize: 400 }, []);
    const result = extractBasesTemplate(config, MOCK_VIEW_DEFAULTS, 'grid');
    expect(result).toEqual({ cardSize: 400 });
  });

  it('should detect BASES_DEFAULTS differences from VIEW_DEFAULTS', () => {
    // displayFirstAsTitle: false in config — differs from mergedDefaults (true from BASES_DEFAULTS)
    const config = createMockConfig({ displayFirstAsTitle: false }, []);
    const result = extractBasesTemplate(config, MOCK_VIEW_DEFAULTS, 'grid');
    expect(result.displayFirstAsTitle).toBe(false);
  });

  it('should return empty object when all values match defaults', () => {
    const config = createMockConfig({}, []);
    const result = extractBasesTemplate(config, MOCK_VIEW_DEFAULTS, 'grid');
    expect(result).toEqual({});
  });

  it('should include non-default posterDisplayMode', () => {
    const config = createMockConfig({ posterDisplayMode: 'overlay' }, []);
    const result = extractBasesTemplate(config, MOCK_VIEW_DEFAULTS, 'grid');
    expect(result.posterDisplayMode).toBe('overlay');
  });

  it('should include non-default subtitleLines', () => {
    const config = createMockConfig({ subtitleLines: 1 }, []);
    const result = extractBasesTemplate(config, MOCK_VIEW_DEFAULTS, 'grid');
    expect(result.subtitleLines).toBe(1);
  });

  it('should omit default subtitleLines', () => {
    const config = createMockConfig({ subtitleLines: 2 }, []);
    const result = extractBasesTemplate(config, MOCK_VIEW_DEFAULTS, 'grid');
    expect(result.subtitleLines).toBeUndefined();
  });

  it('should omit default posterDisplayMode', () => {
    const config = createMockConfig({ posterDisplayMode: 'fade' }, []);
    const result = extractBasesTemplate(config, MOCK_VIEW_DEFAULTS, 'grid');
    expect(result.posterDisplayMode).toBeUndefined();
  });

  it('should include non-default posterInteractToReveal', () => {
    const config = createMockConfig({ posterInteractToReveal: true }, []);
    const result = extractBasesTemplate(config, MOCK_VIEW_DEFAULTS, 'grid');
    expect(result.posterInteractToReveal).toBe(true);
  });

  it('should omit default posterInteractToReveal', () => {
    const config = createMockConfig({ posterInteractToReveal: false }, []);
    const result = extractBasesTemplate(config, MOCK_VIEW_DEFAULTS, 'grid');
    expect(result.posterInteractToReveal).toBeUndefined();
  });

  it('should coerce minimumColumns string to number', () => {
    const config = createMockConfig({ minimumColumns: 'two' }, []);
    const result = extractBasesTemplate(config, MOCK_VIEW_DEFAULTS, 'grid');
    expect(result.minimumColumns).toBe(2);
  });

  it('should use masonry default (2) for minimumColumns', () => {
    const config = createMockConfig({ minimumColumns: 'two' }, []);
    const result = extractBasesTemplate(config, MOCK_VIEW_DEFAULTS, 'masonry');
    expect(result.minimumColumns).toBeUndefined();
  });
});

describe('readBasesSettings — getValidEnum branches', () => {
  it('should return valid enum value from config', () => {
    const config = createMockConfig({ imageFormat: 'cover' }, []);
    const result = readBasesSettings(config, MOCK_PLUGIN_SETTINGS);
    expect(result.imageFormat).toBe('cover');
  });

  it('should return default for invalid enum value without previousSettings', () => {
    const config = createMockConfig({ imageFormat: 'invalid' }, []);
    const result = readBasesSettings(config, MOCK_PLUGIN_SETTINGS);
    expect(result.imageFormat).toBe('thumbnail');
  });

  it('should return previousValue for invalid enum value with previousSettings', () => {
    const config = createMockConfig({ imageFormat: 'invalid' }, []);
    const result = readBasesSettings(config, MOCK_PLUGIN_SETTINGS, 'grid', {
      imageFormat: 'poster',
    });
    expect(result.imageFormat).toBe('poster');
  });

  it('should return valid enum value even when previousSettings provided', () => {
    const config = createMockConfig({ imageFormat: 'backdrop' }, []);
    const result = readBasesSettings(config, MOCK_PLUGIN_SETTINGS, 'grid', {
      imageFormat: 'poster',
    });
    expect(result.imageFormat).toBe('backdrop');
  });

  it('should return previousValue for propertyNames with invalid config', () => {
    const config = createMockConfig({ propertyNames: 'bogus' }, []);
    const result = readBasesSettings(config, MOCK_PLUGIN_SETTINGS, 'grid', {
      propertyNames: 'above',
    });
    expect(result.propertyNames).toBe('above');
  });

  it('should return default for enum field without previousValue path', () => {
    // showFileImages does NOT pass previousValue — always falls back to default
    const config = createMockConfig({ showFileImages: 'nonsense' }, []);
    const result = readBasesSettings(config, MOCK_PLUGIN_SETTINGS);
    expect(result.showFileImages).toBe('always');
  });
});
