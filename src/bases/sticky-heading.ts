/**
 * Detects sticky group heading stuck state via sentinel + IntersectionObserver.
 *
 * CSS @container scroll-state(stuck) can only style descendants, not the container
 * itself. This module inserts zero-height sentinels at each group section's top and
 * observes them — when a sentinel exits the scroll viewport, its heading is stuck.
 */

import { Platform } from 'obsidian';

const STUCK_CLASS = 'stuck';

/** Maps sentinel elements back to their heading — avoids expando properties */
const sentinelToHeading = new WeakMap<Element, HTMLElement>();

export function setupStickyHeadingObserver(scrollContainer: HTMLElement): {
  observe: (heading: HTMLElement) => void;
  disconnect: () => void;
} {
  // WebKit: IO-based sticky heading detection causes reflow loop (same as content-visibility)
  if (Platform.isIosApp) return { observe: () => {}, disconnect: () => {} };

  const sentinels = new Map<HTMLElement, HTMLElement>();

  // Use owner window's IO constructor for popout window support
  const win = scrollContainer.ownerDocument.defaultView ?? window;
  const observer = new win.IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const heading = sentinelToHeading.get(entry.target);
        if (!heading) continue;
        const stuck =
          !entry.isIntersecting &&
          entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0);
        heading.classList.toggle(STUCK_CLASS, stuck);
      }
    },
    { root: scrollContainer }
  );

  return {
    observe: (heading: HTMLElement) => {
      const section = heading.closest<HTMLElement>(
        '.dynamic-views-group-section'
      );
      if (!section || sentinels.has(heading)) return;

      const sentinel = heading.ownerDocument.createElement('div');
      sentinel.className = 'dynamic-views-sticky-sentinel';
      section.appendChild(sentinel);
      sentinels.set(heading, sentinel);

      sentinelToHeading.set(sentinel, heading);
      observer.observe(sentinel);
    },
    disconnect: () => {
      observer.disconnect();
      for (const [heading, sentinel] of sentinels) {
        sentinel.remove();
        heading.classList.remove(STUCK_CLASS);
      }
      sentinels.clear();
    },
  };
}
