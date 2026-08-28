/**
 * Single owner of the multi-image indicator's hidden state.
 *
 * Both navigation modes hide the corner icon during a touch swipe — scrub, in
 * `multi-image-nav.ts`, and slide, in `slideshow.ts`. Exclusivity only holds if
 * both claim the same module variable, and `multi-image-nav.ts` already imports
 * from `slideshow.ts`, so that variable cannot live in either without making a
 * cycle. It lives here instead, and this module imports from neither.
 */

import { SCROLL_THROTTLE_MS } from './constants';

// ── Indicator exclusivity ────────────────────────────────────────────────

/** Tracks the most recently hidden indicator so a new swipe restores the previous one. */
let activeIndicator: HTMLElement | null = null;

/** Take the hidden slot, restoring whichever indicator held it. */
export function claimIndicator(indicator: HTMLElement): void {
  if (activeIndicator && activeIndicator !== indicator) {
    activeIndicator.classList.remove('dynamic-views-icon-hidden');
  }
  activeIndicator = indicator;
}

/**
 * Restore one specific indicator and give up the hidden slot if it held it.
 *
 * The class comes off unconditionally — the caller knows which indicator it hid
 * — while clearing the slot is guarded, so a late restore cannot strand an
 * indicator another card has since claimed.
 */
export function releaseIndicator(indicator: HTMLElement | null): void {
  if (!indicator) return;
  indicator.classList.remove('dynamic-views-icon-hidden');
  if (activeIndicator === indicator) activeIndicator = null;
}

/**
 * Bring back the indicator the most recent swipe hid, if any.
 *
 * Only one is ever hidden at a time — claimIndicator enforces that — so this
 * needs no argument and is safe to call when nothing is hidden.
 */
export function restoreActiveIndicator(): void {
  if (!activeIndicator) return;
  activeIndicator.classList.remove('dynamic-views-icon-hidden');
  activeIndicator = null;
}

// ── Shared scroll listener for indicator icon restore ───────────────────

const scrollIndicatorCallbacks = new WeakMap<Element, Set<() => void>>();
const scrollThrottleState = new WeakMap<Element, number>();
const scrollListenerControllers = new WeakMap<Element, AbortController>();

/** Register a restore callback on a scroll container. One throttled listener is
 *  shared by every card registering on that container, so cards do not
 *  accumulate listeners on the view they all sit in.
 *
 *  The listener cannot ride any single card's signal — it serves every card on
 *  the container, so the first unmount would strand the rest. It gets its own
 *  controller instead, aborted when the last callback deregisters. Without that,
 *  the listener outlives the plugin: the scroll container belongs to Obsidian,
 *  not to us, so a disable/enable cycle leaves the old module reachable. */
export function addScrollIndicatorRestore(
  scrollContainer: Element,
  callback: () => void,
  signal: AbortSignal
): void {
  let callbacks = scrollIndicatorCallbacks.get(scrollContainer);
  if (!callbacks) {
    callbacks = new Set();
    scrollIndicatorCallbacks.set(scrollContainer, callbacks);
    const controller = new AbortController();
    scrollListenerControllers.set(scrollContainer, controller);
    scrollContainer.addEventListener(
      'scroll',
      () => {
        const now = Date.now();
        const last = scrollThrottleState.get(scrollContainer) ?? 0;
        if (now - last < SCROLL_THROTTLE_MS) return;
        scrollThrottleState.set(scrollContainer, now);
        const cbs = scrollIndicatorCallbacks.get(scrollContainer);
        if (cbs) for (const cb of cbs) cb();
      },
      { passive: true, signal: controller.signal }
    );
  }
  const registered = callbacks;
  registered.add(callback);
  signal.addEventListener(
    'abort',
    () => {
      registered.delete(callback);
      if (registered.size > 0) return;
      scrollListenerControllers.get(scrollContainer)?.abort();
      scrollListenerControllers.delete(scrollContainer);
      scrollIndicatorCallbacks.delete(scrollContainer);
      scrollThrottleState.delete(scrollContainer);
    },
    { once: true }
  );
}
