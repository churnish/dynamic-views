// Mock Image class for image validation tests
(global as any).Image = class {
  src: string = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  // Default to valid thumbnail dimensions (mqdefault is 320x180, placeholder is 120x90)
  naturalWidth: number = 320;
  naturalHeight: number = 180;

  constructor() {
    // __imageInstances is the probe ladder in creation order (youtube-preview.test.ts asserts on [0]/[1]/[2] and .length for rung ordering); __lastImage is just the most recent probe.
    // Guard on the array itself, not on __lastImage — a test that resets only one of the two would otherwise silently discard the ladder, surfacing as a wrong-rung assertion rather than an obvious setup error.
    if (!(global as any).__imageInstances) {
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
// Deliberately partial: cls, text, href, attr, addClass and removeClass only.
// empty() is not here — nothing under test reaches it yet.

// addClass/removeClass mirror Obsidian's Element extensions (variadic, class-list based)
Element.prototype.addClass = function (
  this: Element,
  ...classes: string[]
): void {
  this.classList.add(...classes);
};
Element.prototype.removeClass = function (
  this: Element,
  ...classes: string[]
): void {
  this.classList.remove(...classes);
};

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
  const el = document.createElement(tag);
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
