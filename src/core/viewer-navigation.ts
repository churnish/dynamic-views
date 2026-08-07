/**
 * Pure index stepper for image viewer arrow navigation.
 *
 * Mirrors the stepping rules of `createSlideshowNavigator` in slideshow.ts:
 * navigation always wraps at the ends, and known-broken entries are skipped
 * with an exhaustion guard.
 */

/**
 * Next index, wrapping at the ends and skipping broken entries.
 * @returns the next index, or -1 when no move is possible
 */
export function getNextImageIndex(
  current: number,
  direction: 1 | -1,
  urls: string[],
  isBroken: (url: string) => boolean
): number {
  if (urls.length <= 1) return -1;

  const wrap = (index: number): number => {
    if (index < 0) return urls.length - 1;
    if (index >= urls.length) return 0;
    return index;
  };

  let newIndex = wrap(current + direction);

  let skipped = 0;
  while (isBroken(urls[newIndex]) && skipped < urls.length) {
    newIndex = wrap(newIndex + direction);
    skipped++;
  }

  // Exhausted every alternative, or wrapped all the way back to the start point
  if (skipped >= urls.length || newIndex === current) return -1;
  return newIndex;
}
