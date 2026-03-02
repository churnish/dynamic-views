import { vi } from 'vitest';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock canvas for image color extraction tests
HTMLCanvasElement.prototype.getContext = vi.fn(() => {
  return {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({
      data: new Uint8ClampedArray(50 * 50 * 4).fill(128), // Gray pixels
    })),
  } as any;
}) as any;

// Mock document.createElement for canvas
const originalCreateElement = document.createElement.bind(document);
document.createElement = vi.fn((tagName: string) => {
  if (tagName === 'canvas') {
    const canvas = originalCreateElement('canvas');
    canvas.width = 50;
    canvas.height = 50;
    return canvas;
  }
  return originalCreateElement(tagName);
}) as any;

// Mock Image class for image validation tests
(global as any).Image = class {
  src: string = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  // Default to valid thumbnail dimensions (mqdefault is 320x180, placeholder is 120x90)
  naturalWidth: number = 320;
  naturalHeight: number = 180;

  constructor() {
    // Store reference to this instance for test access
    if (!(global as any).__lastImage) {
      (global as any).__imageInstances = [];
    }
    (global as any).__imageInstances.push(this);
    (global as any).__lastImage = this;
  }
};
