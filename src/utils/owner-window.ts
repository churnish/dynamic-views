/** A `Window` carrying the full set of global constructors and timer APIs. */
export type OwnerWindow = Window & typeof globalThis;

/** Popout-safe window reference from a DOM element. */
export function getOwnerWindow(el: Element | null | undefined): OwnerWindow {
  return el?.ownerDocument?.defaultView ?? window;
}
