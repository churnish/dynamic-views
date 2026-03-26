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

import { Platform } from 'obsidian';
import { getOwnerWindow } from '../utils/owner-window';

/** CSS variable name for the icon optical offset (px value). */
const OFFSET_VAR = '--dynamic-views-icon-optical-offset';

/** Corrections beyond this are likely measurement errors, not real offsets. */
const MAX_CORRECTION_PX = 5;

/** Filters rounding noise from high-DPI desktop fonts (2% tolerance). */
const BOOST_DETECTION_THRESHOLD = 1.02;

/**
 * Measure and apply the icon optical alignment correction to a container.
 *
 * Finds the first `.has-timestamp-icon` wrapper, measures the vertical
 * center delta between the `.timestamp-icon` and the adjacent text, and
 * stores the result as a px value on the container.
 *
 * Returns true if measurement succeeded, false if no timestamp icon found.
 * Skips corrections larger than 5px as a layout thrash guard.
 */
export function applyIconOpticalOffset(container: HTMLElement): boolean {
  const wrapper = container.querySelector<HTMLElement>('.has-timestamp-icon');
  if (!wrapper) return false;

  const icon = wrapper.querySelector<HTMLElement>('.timestamp-icon');
  if (!icon) return false;

  const textNode = wrapper.lastChild;
  if (!textNode) return false;

  const iconRect = icon.getBoundingClientRect();
  const iconCenterY = iconRect.top + iconRect.height / 2;

  // Get text bounding rect — Bases uses a bare text node, Datacore uses a span
  let textRect: DOMRect;
  if (textNode.nodeType === 3) {
    const range = wrapper.ownerDocument.createRange();
    range.selectNodeContents(textNode);
    textRect = range.getBoundingClientRect();
    range.detach();
  } else if (textNode.nodeType === 1) {
    textRect = (textNode as HTMLElement).getBoundingClientRect();
  } else {
    return false;
  }

  let delta = textRect.top + textRect.height / 2 - iconCenterY;

  // Android text autosizer: boosted text shifts the perceptual ink center
  // higher than the layout-box center. Scale by boostRatio² to match the
  // desktop perceptual correction. CSS 1em = pre-boost SpecifiedFontSize,
  // getComputedStyle().fontSize = boosted value.
  if (Platform.isAndroidApp) {
    const boostProbe = wrapper.ownerDocument.createElement('span');
    boostProbe.classList.add('dynamic-views-boost-probe');
    wrapper.appendChild(boostProbe);
    const preBoost = boostProbe.getBoundingClientRect().width;
    boostProbe.remove();

    if (preBoost > 0) {
      const postBoost = parseFloat(
        getOwnerWindow(wrapper).getComputedStyle(wrapper).fontSize
      );
      const boostRatio = postBoost / preBoost;
      if (boostRatio > BOOST_DETECTION_THRESHOLD) {
        delta *= boostRatio * boostRatio;
      }
    }
  }

  if (Math.abs(delta) > MAX_CORRECTION_PX) return false;

  container.style.setProperty(OFFSET_VAR, `${delta}px`);
  return true;
}
