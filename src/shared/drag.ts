/**
 * Drag handler factories
 * Reusable drag event handlers used by both Bases (DOM) and Datacore (JSX) views
 */

import type { App } from 'obsidian';

const HOVER_CLASSES = [
  'hover-intent-active',
  'poster-hover-active',
  'cover-hover-active',
] as const;

/**
 * Marker MIME type set on DataTransfer during plugin-initiated drags.
 * Used by the getData patch to identify which drags need text/uri-list suppression.
 */
const DRAG_MARKER = 'application/x-dynamic-views-drag';

/** Remove hover-triggered classes from the nearest card before drag starts. */
function clearCardHoverState(el: Element | null | undefined): void {
  if (el) el.classList.remove(...HOVER_CLASSES);
}

/** Factory for tag drag handlers — used by both Bases and Datacore tag rendering. */
export function createTagDragHandler(
  app: App,
  tag: string
): (e: DragEvent) => void {
  return (e) => {
    e.stopPropagation();
    e.dataTransfer?.clearData();
    e.dataTransfer?.setData('text/plain', '#' + tag);
    app.dragManager.onDragStart(e, {
      type: 'text',
      title: tag,
      icon: 'hashtag',
    });
    // Clear draggable so editor's dragover accepts the drop via its else-path
    (app.dragManager as Record<string, unknown>).draggable = null;
  };
}

/** Factory for card/title drag — clears hover state, initiates link drag. */
export function createCardDragHandler(
  app: App,
  path: string
): (e: DragEvent) => void {
  return (e) => {
    clearCardHoverState((e.currentTarget as HTMLElement)?.closest('.card'));
    const dragData = app.dragManager.dragLink(e, path, '');
    app.dragManager.onDragStart(e, dragData);
  };
}

/** Factory for external link drag — formats as markdown link when captioned. */
export function createExternalLinkDragHandler(
  caption: string,
  url: string
): (e: DragEvent) => void {
  return (e) => {
    e.stopPropagation();
    e.dataTransfer?.clearData();
    e.dataTransfer?.setData(DRAG_MARKER, '');
    const dragText = caption === url ? url : `[${caption}](${url})`;
    e.dataTransfer?.setData('text/plain', dragText);
  };
}

/** Factory for URL icon drag — defers pointer-events to avoid drag abort. */
export function createUrlIconDragHandlers(
  iconEl: HTMLElement,
  urlValue: string
): {
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  onTouchStart: () => void;
} {
  // iOS: Obsidian creates tooltip from aria-label ~1-2s after native drag ends.
  // Strip aria-label on touchstart, restore after the tooltip creation window.
  let savedAriaLabel: string | null = null;

  const cleanup = () => {
    const doc = iconEl.ownerDocument;
    doc.removeEventListener('drop', cleanup);
    const body = doc.body;
    body.querySelector('.tooltip')?.remove();
    body.removeClass('dynamic-views-dragging');
    iconEl.style.removeProperty('pointer-events');
    if (savedAriaLabel !== null) {
      const label = savedAriaLabel;
      savedAriaLabel = null;
      setTimeout(() => iconEl.setAttribute('aria-label', label), 3000);
    }
  };

  const onTouchStart = () => {
    const doc = iconEl.ownerDocument;
    // Fresh registration — only one listener active at a time
    doc.removeEventListener('drop', cleanup);
    doc.addEventListener('drop', cleanup, { once: true });
    // Strip aria-label to prevent deferred tooltip creation after drag
    savedAriaLabel = iconEl.getAttribute('aria-label');
    if (savedAriaLabel) iconEl.removeAttribute('aria-label');
    // Cancel fallback if touch ends without drag
    iconEl.addEventListener(
      'touchend',
      () => {
        doc.removeEventListener('drop', cleanup);
        if (savedAriaLabel !== null) {
          iconEl.setAttribute('aria-label', savedAriaLabel);
          savedAriaLabel = null;
        }
      },
      { once: true }
    );
  };

  return {
    onDragStart: (e) => {
      e.stopPropagation();
      // Only remove hover-intent-active and cover-hover-active — NOT
      // poster-hover-active, which controls pointer-events: auto on
      // .card-content. Removing it hides the content area (including
      // this icon), aborting the drag.
      const card = iconEl.closest('.card');
      card?.classList.remove('hover-intent-active', 'cover-hover-active');
      // Must defer — synchronous change during dragstart aborts the drag
      setTimeout(() => {
        iconEl.setCssStyles({ pointerEvents: 'none' });
      }, 0);
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'copyLink';
        // Native <a> sets text/uri-list + text/html — Obsidian prefers
        // uri-list and wraps as [url](url). Clear all, set plain text only.
        e.dataTransfer.clearData();
        e.dataTransfer.setData(DRAG_MARKER, '');
        e.dataTransfer.setData('text/plain', urlValue);
      }
    },
    onDragEnd: cleanup,
    onTouchStart,
  };
}

/**
 * Patch DataTransfer.prototype.getData in a specific window to suppress
 * Chromium's platform-level text/uri-list for plugin-initiated drags.
 * Each Electron BrowserWindow has its own V8 context with separate prototypes,
 * so the patch must be applied per-window.
 *
 * @returns Cleanup function that restores the original getData for that window.
 */
function patchWindowDataTransfer(win: Window & typeof globalThis): () => void {
  const proto = win.DataTransfer.prototype;
  // eslint-disable-next-line @typescript-eslint/unbound-method -- prototype patching
  const origGetData = proto.getData;
  proto.getData = function (this: DataTransfer, format: string): string {
    if (format === 'text/uri-list' && this.types.includes(DRAG_MARKER)) {
      return '';
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- .call() on untyped ref
    return origGetData.call(this, format);
  };
  return () => {
    proto.getData = origGetData;
  };
}

/**
 * Install the getData patch on the main window and all future popout windows.
 * Chromium re-adds text/uri-list from <a href> at the C++/platform layer
 * AFTER JS dragstart handlers complete, overriding clearData(). Obsidian's
 * drop handler reads text/uri-list and wraps as [text/plain](text/uri-list).
 * This patch returns '' for text/uri-list when our DRAG_MARKER type is present,
 * causing Obsidian to skip wrapping and let CodeMirror's native handler insert
 * text/plain directly.
 *
 * @returns Cleanup function that restores all patched windows.
 */
export function installDropTextPatch(app: App): () => void {
  const cleanups: (() => void)[] = [];

  // Patch main window
  cleanups.push(patchWindowDataTransfer(window));

  // Patch existing popout windows (survive app reload)
  const floating = (
    app.workspace as unknown as {
      floatingSplit?: { children: { win: Window }[] };
    }
  ).floatingSplit;
  if (floating) {
    for (const child of floating.children) {
      cleanups.push(
        patchWindowDataTransfer(child.win as Window & typeof globalThis)
      );
    }
  }

  // Patch future popout windows
  const ref = app.workspace.on('window-open', (_workspaceWindow, win) => {
    cleanups.push(patchWindowDataTransfer(win as Window & typeof globalThis));
  });

  return () => {
    app.workspace.offref(ref);
    for (const cleanup of cleanups) cleanup();
  };
}
