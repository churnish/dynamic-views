/**
 * Hover intent detection — requires pointermove after pointerenter to activate.
 * Prevents false activation when elements scroll under a stationary cursor.
 */

import { getOwnerWindow } from '../utils/owner-window';

/** Whether the device's primary pointer supports hover. Popout-safe when element provided. */
export function canHover(el?: Element | null): boolean {
  const win = el ? getOwnerWindow(el) : window;
  return win.matchMedia('(hover: hover)').matches;
}

export function setupHoverIntent(
  el: HTMLElement,
  onActivate: () => void,
  onDeactivate: (() => void) | undefined,
  signal: AbortSignal
): void {
  let hasMoved = false;

  el.addEventListener(
    'pointerenter',
    () => {
      hasMoved = false;
    },
    { signal }
  );

  el.addEventListener(
    'pointermove',
    () => {
      if (!hasMoved) {
        hasMoved = true;
        onActivate();
      }
    },
    { signal, passive: true }
  );

  if (onDeactivate) {
    el.addEventListener(
      'pointerleave',
      () => {
        hasMoved = false;
        onDeactivate();
      },
      { signal }
    );
  }
}
