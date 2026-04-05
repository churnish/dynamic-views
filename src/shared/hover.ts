/**
 * Hover capability detection and intent activation.
 * - canHover(): device-level hover capability check (any-hover — includes pen)
 * - canPrimaryHover(): primary pointer hover check (hover — mouse/trackpad only)
 * - isHoverPointer(): per-event pointer type filter (mouse/pen hover only)
 * - setupHoverIntent(): requires pointermove after pointerenter to activate
 */

import { getOwnerWindow } from '../utils/owner-window';

/** Whether any connected pointer supports hover (includes pen). Popout-safe when element provided. */
export function canHover(el?: Element | null): boolean {
  const win = el ? getOwnerWindow(el) : window;
  return win.matchMedia('(any-hover: hover)').matches;
}

/** Whether the primary pointer supports hover (mouse/trackpad only, excludes pen). For sustained hover interactions like poster reveal where pen hover is too transient. */
export function canPrimaryHover(el?: Element | null): boolean {
  const win = el ? getOwnerWindow(el) : window;
  return win.matchMedia('(hover: hover)').matches;
}

/** Whether a pointer event comes from a hover-capable input (mouse, trackpad, or pen in hover range — not touch or pen contact). */
export function isHoverPointer(e: PointerEvent): boolean {
  if (e.pointerType === 'touch') return false;
  // Pen with pressure > 0 means contact (drawing/tapping), not hover
  if (e.pointerType === 'pen' && e.pressure > 0) return false;
  return true;
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
    (e) => {
      if (!isHoverPointer(e)) return;
      hasMoved = false;
    },
    { signal }
  );

  el.addEventListener(
    'pointermove',
    (e) => {
      if (!isHoverPointer(e)) return;
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
      (e) => {
        if (!isHoverPointer(e)) return;
        hasMoved = false;
        onDeactivate();
      },
      { signal }
    );
  }
}
