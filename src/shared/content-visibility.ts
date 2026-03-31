/**
 * Custom content-visibility management using IntersectionObserver.
 *
 * Replaces browser-native `content-visibility: auto` (which uses viewport with
 * ~50% margin) with scrollport-rooted observation at PANE_MULTIPLIER distance,
 * matching the infinite scroll loading zone to eliminate skeleton flashes.
 *
 * Disabled on mobile: WebKit enters an infinite reflow loop when IO-toggled
 * content-visibility: hidden changes card geometry, re-triggering the observer.
 * Mobile relies on virtual scroll mount/unmount only (see ios-webkit-quirks.md).
 */

import { Platform } from 'obsidian';
import { getOwnerWindow } from '../utils/owner-window';
import { PANE_MULTIPLIER } from './constants';

export const CONTENT_HIDDEN_CLASS = 'content-hidden';

export function setupContentVisibility(scrollContainer: HTMLElement): {
  observe: (card: HTMLElement) => void;
  unobserve: (card: HTMLElement) => void;
  disconnect: () => void;
} {
  if (Platform.isIosApp)
    return { observe: () => {}, unobserve: () => {}, disconnect: () => {} };

  const margin = `${PANE_MULTIPLIER * 100}% 0px`;

  const win = getOwnerWindow(scrollContainer);
  const observer = new win.IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        entry.target.classList.toggle(
          CONTENT_HIDDEN_CLASS,
          !entry.isIntersecting
        );
      }
    },
    { root: scrollContainer, rootMargin: margin, threshold: 0 }
  );

  return {
    observe: (card: HTMLElement) => observer.observe(card),
    unobserve: (card: HTMLElement) => observer.unobserve(card),
    disconnect: () => observer.disconnect(),
  };
}
