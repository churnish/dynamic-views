/**
 * Hover and touch interaction detection and activation.
 * - canHover(): device-level hover capability check (any-hover — includes pen)
 * - canPrimaryHover(): primary pointer hover check (hover — mouse/trackpad only)
 * - isHoverPointer(): per-event pointer type filter (mouse/pen hover only)
 * - isTouchPointer(): per-event touch/pen-contact filter (inverse of isHoverPointer)
 * - setupHoverIntent(): requires pointermove after pointerenter to activate
 * - setupTouchPress(): activates on pointerdown, deactivates on pointerup with min duration
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

/** Whether a pointer event comes from a touch input (finger or pen contact — not hover). */
export function isTouchPointer(e: PointerEvent): boolean {
  if (e.pointerType === 'touch') return true;
  if (e.pointerType === 'pen' && e.pressure > 0) return true;
  return false;
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

/** Touch press feedback: activates on pointerdown (touch/pen contact), deactivates on pointerup/cancel with minimum 100ms visible duration. */
/** Remove .has-hover-card from a card's container after the card's scale/translate out-transition completes (140ms). Checks that no other card in the container is still interacting before removing. */
export function deferContainerHoverDrop(cardEl: HTMLElement): void {
  const container = cardEl.closest<HTMLElement>(
    '.masonry-container, .bases-cards-group'
  );
  if (!container) return;
  setTimeout(() => {
    if (!container.querySelector('.card.interact')) {
      container.classList.remove('has-hover-card');
    }
  }, 150);
}

export function setupTouchPress(
  el: HTMLElement,
  onActivate: () => void,
  onDeactivate: () => void,
  signal: AbortSignal
): void {
  let activatedAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  el.addEventListener(
    'pointerdown',
    (e) => {
      if (!isTouchPointer(e)) return;
      activatedAt = Date.now();
      onActivate();
    },
    { signal, passive: true }
  );

  const deactivate = () => {
    if (!activatedAt) return;
    const remaining = Math.max(0, 100 - (Date.now() - activatedAt));
    if (remaining > 0) {
      timer = setTimeout(() => {
        onDeactivate();
        activatedAt = 0;
      }, remaining);
    } else {
      onDeactivate();
      activatedAt = 0;
    }
  };

  el.addEventListener('pointerup', deactivate, { signal, passive: true });
  el.addEventListener('pointercancel', deactivate, { signal, passive: true });
  signal.addEventListener('abort', () => {
    if (timer) clearTimeout(timer);
  });
}
