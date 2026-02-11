/**
 * Custom content-visibility management using IntersectionObserver.
 *
 * Replaces browser-native `content-visibility: auto` (which uses viewport with
 * ~50% margin) with scrollport-rooted observation at PANE_MULTIPLIER distance,
 * matching the infinite scroll loading zone to eliminate skeleton flashes.
 *
 * Disabled on mobile: iOS WebKit enters an infinite reflow loop when IO-toggled
 * content-visibility: hidden changes card geometry, re-triggering the observer.
 * Mobile falls back to CSS content-visibility: auto (browser-managed).
 */

import { Platform } from "obsidian";
import { PANE_MULTIPLIER } from "./constants";

export const CONTENT_HIDDEN_CLASS = "content-hidden";

export function setupContentVisibility(scrollContainer: HTMLElement): {
  observe: (card: HTMLElement) => void;
  disconnect: () => void;
} {
  if (Platform.isMobile) return { observe: () => {}, disconnect: () => {} };

  const margin = `${PANE_MULTIPLIER * 100}% 0px`;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        entry.target.classList.toggle(
          CONTENT_HIDDEN_CLASS,
          !entry.isIntersecting,
        );
      }
    },
    { root: scrollContainer, rootMargin: margin, threshold: 0 },
  );

  return {
    observe: (card: HTMLElement) => observer.observe(card),
    disconnect: () => observer.disconnect(),
  };
}
