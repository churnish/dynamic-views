/**
 * Icon optical vertical alignment.
 *
 * Flex centering aligns geometric centers, but text glyphs (especially
 * digits without descenders) sit asymmetrically within their line box.
 * The eye perceives text as centered higher than its geometric center,
 * making flex-centered icons appear too low.
 *
 * This module measures the font's content-area asymmetry via canvas
 * TextMetrics and stores the correction as a dimensionless CSS custom
 * property. The CSS expression `fraction * 1lh / line-height-tight`
 * resolves to the correct pixel offset on all platforms — including
 * Android where text boosting makes `1em` unreliable but `1lh` reflects
 * boosted metrics.
 */

import { getOwnerWindow } from '../utils/owner-window';

/** CSS variable name for the icon optical offset (dimensionless fraction). */
const OFFSET_VAR = '--dynamic-views-icon-optical-offset';

/**
 * Measure the optical offset fraction between a flex-centered icon and
 * adjacent digit text.
 *
 * Computes the distance between the font's content-area center and the
 * glyph ink center for '0', then takes 3/4 of that to account for the
 * canvas-vs-CSS metric discrepancy. The absolute value ensures the
 * correction always shifts UP — some fonts (SF Pro) have the ink center
 * below the content center, others (Roboto) have it above, but the eye
 * always perceives text as centered higher.
 *
 * Returns a negative fraction of font-size (icon should shift UP).
 */
function measureIconOpticalFraction(el: HTMLElement): number {
  const win = getOwnerWindow(el);
  const style = win.getComputedStyle(el);
  const fontSize = parseFloat(style.fontSize);
  if (!fontSize) return 0;

  const canvas = el.ownerDocument.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;

  ctx.font = `${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
  const m = ctx.measureText('0');

  // Guard: fontBoundingBox* requires Chrome 87+, Safari 11.1+ (all Obsidian targets)
  if (m.fontBoundingBoxAscent == null || m.actualBoundingBoxAscent == null) {
    return 0;
  }

  // Content-area center vs glyph ink center distance. Sign varies by font:
  //   SF Pro:  +1.43 (ink center below content center)
  //   Roboto:  -2.0  (ink center above content center)
  // Always shift UP (abs), scaled 3/4 for canvas-vs-CSS metric discrepancy.
  const rawOffset =
    m.fontBoundingBoxAscent -
    m.fontBoundingBoxDescent -
    m.actualBoundingBoxAscent +
    m.actualBoundingBoxDescent;
  const offsetPx = -Math.abs(rawOffset) * (3 / 8);

  return offsetPx / fontSize;
}

/**
 * Measure and apply the icon optical alignment correction to a container.
 *
 * Sets `--dynamic-views-icon-optical-offset` (dimensionless) on the
 * container. Timestamp icon CSS uses:
 *
 *   transform: translateY(calc(var(--dynamic-views-icon-optical-offset, 0)
 *     * 1lh / var(--dynamic-views-line-height-tight)))
 *
 * The `1lh / line-height-tight` expression equals the rendered font-size
 * on all platforms, including Android text-boosted contexts.
 */
export function applyIconOpticalOffset(container: HTMLElement): void {
  const fraction = measureIconOpticalFraction(container);
  if (fraction !== 0) {
    container.style.setProperty(OFFSET_VAR, String(fraction));
  } else {
    container.style.removeProperty(OFFSET_VAR);
  }
}
