import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFullScreenController } from '../../src/bases/full-screen';

// FullScreenController.mount reads CSS variables + getBoundingClientRect —
// stub just enough DOM to avoid throws in jsdom.
function makeDOM(opts: { hasNavbar?: boolean; hasViewContent?: boolean } = {}) {
  const { hasNavbar = true, hasViewContent = true } = opts;

  const viewContent = document.createElement('div');
  viewContent.classList.add('view-content');

  const leafContent = document.createElement('div');
  leafContent.setAttribute('data-type', 'bases');
  leafContent.appendChild(viewContent);

  const containerEl = document.createElement('div');

  // When hasViewContent is false, scrollEl is standalone (no .view-content ancestor)
  let scrollEl: HTMLElement;
  if (hasViewContent) {
    scrollEl = document.createElement('div');
    viewContent.appendChild(scrollEl);
    scrollEl.appendChild(containerEl);
    document.body.appendChild(leafContent);
  } else {
    scrollEl = document.createElement('div');
    scrollEl.appendChild(containerEl);
    document.body.appendChild(scrollEl);
  }

  if (hasNavbar) {
    const navbar = document.createElement('div');
    navbar.classList.add('mobile-navbar');
    document.body.appendChild(navbar);
  }

  return { scrollEl, containerEl };
}

function makePlugin(fullScreen: boolean) {
  return {
    persistenceManager: {
      getPluginSettings: () => ({ fullScreen }),
    },
  };
}

describe('createFullScreenController', () => {
  beforeEach(() => {
    // Clear DOM between tests
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it('should return null when .mobile-navbar is missing', () => {
    const { scrollEl, containerEl } = makeDOM({ hasNavbar: false });
    const register = vi.fn();
    const result = createFullScreenController(
      scrollEl,
      containerEl,
      makePlugin(true),
      register
    );
    expect(result).toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  it('should return null when .view-content is missing', () => {
    const { scrollEl, containerEl } = makeDOM({ hasViewContent: false });
    const register = vi.fn();
    const result = createFullScreenController(
      scrollEl,
      containerEl,
      makePlugin(true),
      register
    );
    expect(result).toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  it('should return controller and register cleanup when DOM is complete', () => {
    const { scrollEl, containerEl } = makeDOM();
    const register = vi.fn();
    const result = createFullScreenController(
      scrollEl,
      containerEl,
      makePlugin(false),
      register
    );
    expect(result).not.toBeNull();
    expect(register).toHaveBeenCalledOnce();
    expect(typeof register.mock.calls[0][0]).toBe('function');
  });

  it('should not mount when fullScreen setting is false', () => {
    const { scrollEl, containerEl } = makeDOM();
    const register = vi.fn();
    const result = createFullScreenController(
      scrollEl,
      containerEl,
      makePlugin(false),
      register
    );
    // Controller returned but not mounted — no scroll listener attached,
    // no full-screen-enabled class on container
    expect(result).not.toBeNull();
    expect(
      containerEl.classList.contains('dynamic-views-full-screen-enabled')
    ).toBe(false);
  });

  it('should mount when fullScreen setting is true', () => {
    const { scrollEl, containerEl } = makeDOM();
    const register = vi.fn();

    // mount() requires auto-full-screen body class (Obsidian mobile setting)
    document.body.classList.add('auto-full-screen');

    // mount() reads getComputedStyle + getBoundingClientRect — stub to avoid NaN
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: () => '0',
      marginTop: '0',
    } as unknown as CSSStyleDeclaration);

    const result = createFullScreenController(
      scrollEl,
      containerEl,
      makePlugin(true),
      register
    );
    expect(result).not.toBeNull();
    expect(
      containerEl.classList.contains('dynamic-views-full-screen-enabled')
    ).toBe(true);

    vi.restoreAllMocks();
  });

  it('should register unmount as cleanup callback', () => {
    const { scrollEl, containerEl } = makeDOM();
    const register = vi.fn();

    document.body.classList.add('auto-full-screen');

    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: () => '0',
      marginTop: '0',
    } as unknown as CSSStyleDeclaration);

    createFullScreenController(
      scrollEl,
      containerEl,
      makePlugin(true),
      register
    );

    // Call the registered cleanup — should unmount (remove class + listeners)
    const cleanup = register.mock.calls[0][0] as () => void;
    cleanup();
    expect(
      containerEl.classList.contains('dynamic-views-full-screen-enabled')
    ).toBe(false);

    vi.restoreAllMocks();
  });
});
