import { getOwnerWindow } from '../utils/owner-window';

const NARROW_CLASS = 'dynamic-views-narrow';
const HIDDEN_CLASS = 'dynamic-views-hidden';
const DEFAULT_FILE_LINE_WIDTH = 700;

/** Toggle narrow/hidden classes on a .dynamic-views container based on
 *  its width relative to --file-line-width. Returns cleanup function. */
export function observeToolbarCompact(container: HTMLElement): () => void {
  const win = getOwnerWindow(container);

  function sync(): void {
    const width = container.offsetWidth;
    if (width <= 50) {
      container.classList.add(HIDDEN_CLASS);
      container.classList.remove(NARROW_CLASS);
      return;
    }
    container.classList.remove(HIDDEN_CLASS);
    const cs = win.getComputedStyle(container);
    const threshold =
      parseFloat(cs.getPropertyValue('--file-line-width')) ||
      DEFAULT_FILE_LINE_WIDTH;
    container.classList.toggle(NARROW_CLASS, width < threshold);
  }

  sync();
  const ro = new win.ResizeObserver(sync);
  ro.observe(container);
  return () => ro.disconnect();
}
