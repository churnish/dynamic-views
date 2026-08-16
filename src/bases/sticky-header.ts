/**
 * Detects sticky group header stuck state via sentinel + IntersectionObserver.
 *
 * CSS @container scroll-state(stuck) can only style descendants, not the container
 * itself. This module inserts zero-height sentinels at each group section's top and
 * observes them — when a sentinel exits the scroll pane, its heading is stuck.
 */

import { getOwnerWindow } from '../utils/owner-window';

const STUCK_CLASS = 'stuck';

/** Maps sentinel elements back to their heading — avoids expando properties */
const sentinelToHeading = new WeakMap<Element, HTMLElement>();

export function setupStickyHeaderObserver(scrollContainer: HTMLElement): {
  observe: (heading: HTMLElement) => void;
  disconnect: () => void;
} {
  // WebKit: content-visibility IO is disabled on iOS (reflow loop from geometry
  // collapse). Sticky header IO is safe — .stuck only changes z-index and border,
  // no geometry changes that would re-trigger the observer.

  const sentinels = new Map<HTMLElement, HTMLElement>();

  // Use owner window's IO constructor for popout window support
  const win = getOwnerWindow(scrollContainer);
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

      const sentinel = section.createDiv({
        cls: 'dynamic-views-sticky-sentinel',
      });
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
