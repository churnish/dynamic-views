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
  el: HTMLElement,
  caption: string,
  url: string
): (e: DragEvent) => void {
  // Store on element for freshness — Preact re-renders may update
  // link props without re-binding (see __dragBound guard)
  el.dataset.dvLinkCaption = caption;
  el.dataset.dvLinkUrl = url;
  return (e) => {
    e.stopPropagation();
    const c = el.dataset.dvLinkCaption ?? caption;
    const u = el.dataset.dvLinkUrl ?? url;
    e.dataTransfer?.clearData();
    e.dataTransfer?.setData(DRAG_MARKER, '');
    const dragText = c === u ? u : `[${c}](${u})`;
    e.dataTransfer?.setData('text/plain', dragText);
  };
}

/** Factory for URL button drag — defers pointer-events to avoid drag abort. */
export function createUrlButtonDragHandlers(
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
    // Cancel fallback if touch ends without drag (touchcancel fires
    // when iOS steals the gesture, e.g., swipe-to-go-back or notification)
    const restoreOnCancel = () => {
      iconEl.removeEventListener('touchend', restoreOnCancel);
      iconEl.removeEventListener('touchcancel', restoreOnCancel);
      doc.removeEventListener('drop', cleanup);
      if (savedAriaLabel !== null) {
        iconEl.setAttribute('aria-label', savedAriaLabel);
        savedAriaLabel = null;
      }
    };
    iconEl.addEventListener('touchend', restoreOnCancel, { once: true });
    iconEl.addEventListener('touchcancel', restoreOnCancel, { once: true });
  };

  // Body class for CSS gating — added on mousedown (before dragstart fires)
  iconEl.addEventListener('mousedown', () => {
    const body = iconEl.ownerDocument.body;
    body.addClass('dynamic-views-dragging');
    iconEl.ownerDocument.addEventListener(
      'mouseup',
      () => body.removeClass('dynamic-views-dragging'),
      { once: true }
    );
  });

  return {
    onDragStart: (e) => {
      e.stopPropagation();
      const card = iconEl.closest('.card');
      // Remove non-poster hover classes synchronously
      card?.classList.remove('hover-intent-active', 'cover-hover-active');
      // Defer poster-hover-active removal and icon pointer-events —
      // synchronous removal sets pointer-events: none on .card-content,
      // aborting the drag. Deferred runs after drag subsystem takes over.
      setTimeout(() => {
        card?.classList.remove('poster-hover-active');
        iconEl.setCssStyles({ pointerEvents: 'none' });
      }, 0);
      if (e.dataTransfer) {
        // 'link' alone rejects drops into CodeMirror (uses dropEffect 'copy').
        // 'copyLink' allows both copy and link operations.
        e.dataTransfer.effectAllowed = 'copyLink';
        // Native <a> sets text/uri-list + text/html — Obsidian prefers
        // uri-list and wraps as [url](url). Clear all, set plain text only.
        e.dataTransfer.clearData();
        e.dataTransfer.setData(DRAG_MARKER, '');
        // Read from dataset for freshness — Preact re-renders may update
        // the URL without re-binding event listeners (see __dragBound guard)
        e.dataTransfer.setData(
          'text/plain',
          iconEl.dataset.dvUrlValue ?? urlValue
        );
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
