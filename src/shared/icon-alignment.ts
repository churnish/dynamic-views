/**
 * Icon optical vertical alignment via live DOM measurement.
 *
 * Flex centering aligns geometric centers, but text glyphs (especially
 * digits without descenders) sit asymmetrically within their line box.
 * The eye perceives text as centered higher than its geometric center,
 * making flex-centered icons appear too low.
 *
 * This module measures the vertical delta between an icon's center and
 * its adjacent text's center from the first real rendered timestamp row,
 * then stores the correction as a px-valued CSS custom property.
 *
 * Uses live DOM measurement instead of offscreen synthetic elements
 * because offscreen elements (visibility: hidden; position: absolute)
 * are exempt from Chromium's text autosizer, causing undersized
 * corrections on Android.
 */

import { getOwnerWindow } from '../utils/owner-window';

/** CSS variable name for the icon optical offset (px value). */
const OFFSET_VAR = '--dynamic-views-icon-optical-offset';

/**
 * Measure and apply the icon optical alignment correction to a container.
 *
 * Finds the first `.has-timestamp-icon` wrapper inside `container`,
 * measures the vertical center delta between the `.timestamp-icon` and
 * the adjacent text node (Bases) or span element (Datacore), and stores
 * the result as a px value on the container.
 *
 * No-ops when no timestamp icon is rendered yet. Skips corrections
 * larger than 5px as a layout thrash guard.
 */
export function applyIconOpticalOffset(container: HTMLElement): void {
  const wrapper = container.querySelector<HTMLElement>('.has-timestamp-icon');
  if (!wrapper) return;

  const icon = wrapper.querySelector<HTMLElement>('.timestamp-icon');
  if (!icon) return;

  const textNode = wrapper.lastChild;
  if (!textNode) return;

  const iconRect = icon.getBoundingClientRect();
  const iconCenterY = iconRect.top + iconRect.height / 2;

  let textCenterY: number;

  if (textNode.nodeType === 3) {
    // Bases: bare text node — measure via Range
    const win = getOwnerWindow(wrapper);
    const range = win.document.createRange
      ? win.document.createRange()
      : wrapper.ownerDocument.createRange();
    range.selectNodeContents(textNode);
    const textRect = range.getBoundingClientRect();
    textCenterY = textRect.top + textRect.height / 2;
  } else if (textNode instanceof HTMLElement) {
    // Datacore: span element containing text
    const textRect = textNode.getBoundingClientRect();
    textCenterY = textRect.top + textRect.height / 2;
  } else {
    return;
  }

  let delta = textCenterY - iconCenterY;

  // Scale by text boost ratio² on Android.
  // CSS 1em resolves to pre-boost SpecifiedFontSize, while
  // getComputedStyle().fontSize returns the boosted value.
  // Squaring the ratio matches the desktop perceptual correction exactly.
  const doc = wrapper.ownerDocument;
  const boostProbe = doc.createElement('span');
  boostProbe.classList.add('dynamic-views-boost-probe');
  wrapper.appendChild(boostProbe);
  const preBoost = boostProbe.getBoundingClientRect().width;
  boostProbe.remove();

  if (preBoost > 0) {
    const boostWin = getOwnerWindow(wrapper);
    const postBoost = parseFloat(boostWin.getComputedStyle(wrapper).fontSize);
    const boostRatio = postBoost / preBoost;
    if (boostRatio > 1.02) {
      delta *= boostRatio * boostRatio;
    }
  }

  // Layout thrash guard: skip unreasonable corrections
  if (Math.abs(delta) > 5) return;

  if (delta !== 0) {
    container.style.setProperty(OFFSET_VAR, `${delta}px`);
  } else {
    container.style.removeProperty(OFFSET_VAR);
  }
}
