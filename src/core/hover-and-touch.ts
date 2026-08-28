/**
 * Hover and touch interaction detection and activation.
 * - canHover(): device-level hover capability check (any-hover — includes pen)
 * - canPrimaryHover(): primary pointer hover check (hover — mouse/trackpad only)
 * - isHoverPointer(): per-event pointer type filter (mouse/pen hover only)
 * - isTouchPointer(): per-event touch/pen-contact filter (inverse of isHoverPointer)
 * - setupHoverIntent(): requires pointermove after pointerenter to activate
 * - setupTouchPress(): activates on pointerdown, deactivates on pointerup with min duration.
 *   Optional shouldActivate() narrows activation to part of the element.
 */

import {
  SCRUB_DIRECTION_THRESHOLD,
  SWIPE_PRESS_DEFER_MS,
  TOUCH_PRESS_MIN_VISIBLE_MS,
} from './constants';
import { getOwnerWindow } from '../utils/owner-window';

/**
 * Surfaces where touch navigates images instead of pressing the card.
 *
 * Slide-mode covers carry `card-cover-slideshow` rather than `multi-image`, so
 * both spellings belong here — listing only the latter let a Slide swipe hold
 * the press highlight for the whole gesture.
 */
const SWIPE_SURFACE_SELECTOR =
  '.card-thumbnail.multi-image, .card-cover.multi-image, .card-cover-slideshow';

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

/**
 * Hover activation that requires a pointermove after pointerenter.
 *
 * A card scrolling under a stationary pointer fires pointerenter without the
 * user having aimed at anything, so entry alone is not intent — the move is.
 * Every event is filtered through isHoverPointer, so a finger never activates
 * this path. onDeactivate fires on pointerleave and re-arms the next entry.
 */
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

/** The element that carries `.has-hover-card` — Masonry's positioning context, or a Grid card group. */
const HOVER_CARD_CONTAINER_SELECTOR = '.masonry-container, .bases-cards-group';

/** Add .has-hover-card to a card's container, so the container can raise its stacking context while one of its cards is enlarged. Paired with deferContainerHoverDrop() for removal. */
export function markContainerHoverCard(cardEl: HTMLElement): void {
  cardEl
    .closest<HTMLElement>(HOVER_CARD_CONTAINER_SELECTOR)
    ?.classList.add('has-hover-card');
}

/** Remove .has-hover-card from a card's container after the card's scale/translate out-transition completes. 150ms = 140ms transition (--dynamic-views-anim-duration-fast) + 10ms buffer. Checks that no other card in the container is still interacting before removing. */
export function deferContainerHoverDrop(cardEl: HTMLElement): void {
  const container = cardEl.closest<HTMLElement>(HOVER_CARD_CONTAINER_SELECTOR);
  if (!container) return;
  window.setTimeout(() => {
    if (!container.querySelector('.card.interact')) {
      container.classList.remove('has-hover-card');
    }
  }, 150);
}

/** Touch press feedback: activates on pointerdown (touch/pen contact), deactivates on pointerup/cancel after TOUCH_PRESS_MIN_VISIBLE_MS. */
export function setupTouchPress(
  el: HTMLElement,
  onActivate: () => void,
  onDeactivate: () => void,
  signal: AbortSignal,
  shouldActivate?: (e: PointerEvent) => boolean
): void {
  let activatedAt = 0;
  let timer: number | null = null;
  // Pending press on a swipe surface, held until the gesture reveals itself
  let deferTimer: number | null = null;
  let startX = 0;
  let startY = 0;

  const cancelPendingPress = () => {
    if (deferTimer === null) return;
    window.clearTimeout(deferTimer);
    deferTimer = null;
  };

  el.addEventListener(
    'pointerdown',
    (e) => {
      if (!isTouchPointer(e)) return;
      // Suppress interact from image viewer dismiss tap (cooldown set by closeImageViewer)
      if (el.dataset.viewerDismissing) return;
      // Caller may restrict which part of the element responds to a press
      if (shouldActivate && !shouldActivate(e)) return;

      const activate = () => {
        activatedAt = Date.now();
        onActivate();
      };

      // On a surface that also swipes, a press and a swipe are identical at
      // pointerdown. Activating now would flash the highlight on every swipe;
      // never activating would deny a genuine long press its feedback. Waiting
      // lets the swipe declare itself by moving, and the pointermove below
      // cancels the pending press when it does.
      if (!(e.target as HTMLElement)?.closest?.(SWIPE_SURFACE_SELECTOR)) {
        activate();
        return;
      }
      startX = e.clientX;
      startY = e.clientY;
      cancelPendingPress();
      deferTimer = window.setTimeout(() => {
        deferTimer = null;
        activate();
      }, SWIPE_PRESS_DEFER_MS);
    },
    { signal, passive: true }
  );

  el.addEventListener(
    'pointermove',
    (e) => {
      if (deferTimer === null || !isTouchPointer(e)) return;
      // Either axis counts: a horizontal drag is a swipe, a vertical one is a
      // scroll, and neither should read as a press.
      if (
        Math.abs(e.clientX - startX) > SCRUB_DIRECTION_THRESHOLD ||
        Math.abs(e.clientY - startY) > SCRUB_DIRECTION_THRESHOLD
      )
        cancelPendingPress();
    },
    { signal, passive: true }
  );

  const deactivate = () => {
    // A lift or cancel before the defer elapsed means the press never happened
    cancelPendingPress();
    if (!activatedAt) return;
    const remaining = Math.max(
      0,
      TOUCH_PRESS_MIN_VISIBLE_MS - (Date.now() - activatedAt)
    );
    if (remaining > 0) {
      timer = window.setTimeout(() => {
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
    if (timer) window.clearTimeout(timer);
    cancelPendingPress();
  });
}
