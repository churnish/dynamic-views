/**
 * Hover intent detection — requires mousemove after mouseenter to activate.
 * Prevents false activation when elements scroll under a stationary cursor.
 */

export function setupHoverIntent(
  el: HTMLElement,
  onActivate: () => void,
  onDeactivate: (() => void) | undefined,
  signal: AbortSignal,
): void {
  let hasMoved = false;

  el.addEventListener(
    "mouseenter",
    () => {
      hasMoved = false;
    },
    { signal },
  );

  el.addEventListener(
    "mousemove",
    () => {
      if (!hasMoved) {
        hasMoved = true;
        onActivate();
      }
    },
    { signal, passive: true },
  );

  if (onDeactivate) {
    el.addEventListener(
      "mouseleave",
      () => {
        hasMoved = false;
        onDeactivate();
      },
      { signal },
    );
  }
}
