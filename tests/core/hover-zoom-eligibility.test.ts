import { beforeEach, describe, expect, it } from 'vitest';
import { setupHoverZoomEligibility } from '../../src/core/slideshow';

/**
 * Eligibility is the second half of the cover hover-zoom rule: the CSS needs
 * `.card.interact-hover` on the card AND `img.hover-zoom-eligible` on the image.
 * These handlers own the second half, so a pointer that cannot hover must never
 * move it — on WebKit a finger tap synthesises a mouseleave/mouseenter pair, and
 * under a resting trackpad pointer that replayed the zoom on every tap.
 */
describe('setupHoverZoomEligibility', () => {
  let card: HTMLElement;
  let hoverTarget: HTMLElement;
  let imageEmbed: HTMLElement;
  let currImg: HTMLElement;
  let controller: AbortController;

  const enter = (pointerType: string, pressure = 0) =>
    hoverTarget.dispatchEvent(
      new PointerEvent('pointerenter', { pointerType, pressure, bubbles: false })
    );
  const leave = (pointerType: string, pressure = 0) =>
    hoverTarget.dispatchEvent(
      new PointerEvent('pointerleave', { pointerType, pressure, bubbles: false })
    );
  const eligible = () => currImg.classList.contains('hover-zoom-eligible');

  beforeEach(() => {
    controller = new AbortController();
    card = document.createElement('div');
    card.className = 'card';
    hoverTarget = document.createElement('div');
    hoverTarget.className = 'card-cover card-cover-slideshow';
    imageEmbed = document.createElement('div');
    imageEmbed.className = 'dynamic-views-image-embed';
    currImg = document.createElement('img');
    currImg.className = 'slideshow-img slideshow-img-current';
    imageEmbed.appendChild(currImg);
    hoverTarget.appendChild(imageEmbed);
    card.appendChild(hoverTarget);
    document.body.appendChild(card);
    setupHoverZoomEligibility(hoverTarget, imageEmbed, controller.signal);
  });

  it('grants eligibility to a hovering mouse', () => {
    enter('mouse');
    expect(eligible()).toBe(true);
  });

  it('grants eligibility to a hovering pen', () => {
    enter('pen', 0);
    expect(eligible()).toBe(true);
  });

  it('ignores a touch enter', () => {
    enter('touch');
    expect(eligible()).toBe(false);
  });

  it('ignores a pen in contact', () => {
    enter('pen', 0.5);
    expect(eligible()).toBe(false);
  });

  it('a touch leave does not revoke eligibility a mouse is holding', () => {
    // The regression: WebKit fabricates this pair from a tap, and revoking then
    // re-granting replays the zoom while the real pointer never moved.
    enter('mouse');
    expect(eligible()).toBe(true);
    leave('touch');
    expect(eligible()).toBe(true);
    enter('touch');
    expect(eligible()).toBe(true);
  });

  it('a genuine mouse leave revokes eligibility', () => {
    enter('mouse');
    leave('mouse');
    expect(eligible()).toBe(false);
  });

  it('keeps eligibility when the viewer is open', () => {
    enter('mouse');
    card.classList.add('viewer-active');
    leave('mouse');
    expect(eligible()).toBe(true);
  });
});
