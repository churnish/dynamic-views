/** Popout-safe window reference from a DOM element. */
export function getOwnerWindow(
  el: Element | null | undefined
): Window & typeof globalThis {
  return el?.ownerDocument?.defaultView ?? window;
}
