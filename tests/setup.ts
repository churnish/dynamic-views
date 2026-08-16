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

// Polyfill Obsidian's DOM helpers, which jsdom has no equivalent of. Without
// them any production path that builds DOM through createEl/createDiv/createSpan
// throws, which is why renderer code was previously untestable.
//
// src/core/text-preview-dom.ts documents the opposite choice — plain
// document.createElement, precisely so it runs under jsdom unaided. The two are
// not accidentally inconsistent: this polyfill exists so the rest of the
// renderer can keep using the helpers the eslint plugin prefers, without each
// module having to opt out.
//
// Declared on Node.prototype because that is where obsidian.d.ts declares them
// (DocumentFragment gets them too, and HTMLElement inherits).
//
// Deliberately partial: cls, text, href and attr only. addClass/removeClass/
// empty() are not here — nothing under test reaches them yet.
function applyElementInfo(
  el: HTMLElement,
  info?: DomElementInfo | string
): void {
  if (!info) return;
  // A bare string is a class list, and cls may be space-separated. classList.add()
  // throws InvalidCharacterError on a string with spaces — assign className.
  if (typeof info === 'string') {
    el.className = info;
    return;
  }
  if (info.cls) {
    el.className = Array.isArray(info.cls) ? info.cls.join(' ') : info.cls;
  }
  if (info.text !== undefined && typeof info.text === 'string') {
    el.textContent = info.text;
  }
  if (info.href !== undefined) el.setAttribute('href', info.href);
  for (const [name, value] of Object.entries(info.attr ?? {})) {
    if (value === null) continue;
    el.setAttribute(name, String(value));
  }
}

function createChild<K extends keyof HTMLElementTagNameMap>(
  parent: Node,
  tag: K,
  info?: DomElementInfo | string,
  callback?: (el: HTMLElementTagNameMap[K]) => void
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag) as HTMLElementTagNameMap[K];
  applyElementInfo(el, info);
  parent.appendChild(el);
  callback?.(el);
  return el;
}

Node.prototype.createEl = function <K extends keyof HTMLElementTagNameMap>(
  this: Node,
  tag: K,
  info?: DomElementInfo | string,
  callback?: (el: HTMLElementTagNameMap[K]) => void
): HTMLElementTagNameMap[K] {
  return createChild(this, tag, info, callback);
};

Node.prototype.createDiv = function (
  this: Node,
  info?: DomElementInfo | string,
  callback?: (el: HTMLDivElement) => void
): HTMLDivElement {
  return createChild(this, 'div', info, callback);
};

Node.prototype.createSpan = function (
  this: Node,
  info?: DomElementInfo | string,
  callback?: (el: HTMLSpanElement) => void
): HTMLSpanElement {
  return createChild(this, 'span', info, callback);
};

// Polyfill PointerEvent for jsdom (extends MouseEvent with pointer-specific fields)
if (typeof globalThis.PointerEvent === 'undefined') {
  (globalThis as any).PointerEvent = class PointerEvent extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly pressure: number;
    constructor(type: string, init?: PointerEventInit) {
      super(type, init);
      this.pointerId = init?.pointerId ?? 0;
      this.pointerType = init?.pointerType ?? '';
      this.pressure = init?.pressure ?? 0;
    }
  };
}
