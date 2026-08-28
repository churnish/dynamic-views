/**
 * Drag handler factories
 * Reusable drag event handlers used by Bases (DOM) views
 */

import { Platform } from 'obsidian';
import type { App } from 'obsidian';

import { setInteractSource } from './hover-and-touch';
import type { OwnerWindow } from '../utils/owner-window';

/**
 * Marker MIME type set on DataTransfer during plugin-initiated drags.
 * Used by the getData patch to identify which drags need text/uri-list suppression.
 */
const DRAG_MARKER = 'application/x-dynamic-views-drag';

/**
 * Release the card's hover source. A drag captures the pointer, so the
 * pointerleave that would normally clear it never arrives and the image zoom
 * would stay on for the rest of the card's life.
 *
 * Split out from clearCardHoverState because the URL button cannot drop
 * poster-hover-active synchronously — see the deferred removal in
 * createUrlButtonDragHandlers.
 */
function clearCardHoverSource(el: Element | null | undefined): void {
  if (el) setInteractSource(el, 'hover', false);
}

/** Remove every hover-triggered class from the nearest card before drag starts. */
function clearCardHoverState(el: Element | null | undefined): void {
  if (!el) return;
  clearCardHoverSource(el);
  el.classList.remove('poster-hover-active');
}

/**
 * Hand back the DragManager state a drag registered only to buy Obsidian's
 * contextmenu synthesis, keeping just the part that synthesis needs.
 *
 * A live `draggable` makes the editor's dragover take its own path and reject
 * the drop. `ghostEl` paints Obsidian's own preview over whatever the platform
 * would have drawn. `dragStart` — the field onDragEnd actually reads — is
 * separate and survives both, and `moved` tracking sits outside the ghost
 * branch too, so the synthesis still fires.
 *
 * @param keepGhost - true for a drag that wants Obsidian's preview because the
 *   platform draws none of its own, as with a bare tag.
 */
function releaseDragManagerState(
  app: App,
  { keepGhost = false }: { keepGhost?: boolean } = {}
): void {
  const dragManagerState = app.dragManager as Record<string, unknown>;
  dragManagerState.draggable = null;
  if (keepGhost) return;
  (dragManagerState.ghostEl as HTMLElement | null)?.detach();
  dragManagerState.ghostEl = null;
}

/** Factory for tag drag handlers — used by Bases tag rendering. */
export function createTagDragHandler(
  app: App,
  tag: string
): (e: DragEvent) => void {
  return (e) => {
    e.stopPropagation();
    // A tag sits inside the card, so its drag captures the pointer away from the
    // card just as a card drag does — same missing pointerleave, same cleanup.
    clearCardHoverState((e.currentTarget as HTMLElement)?.closest('.card'));
    e.dataTransfer?.clearData();
    e.dataTransfer?.setData('text/plain', '#' + tag);
    app.dragManager.onDragStart(e, {
      type: 'text',
      title: tag,
      icon: 'hashtag',
    });
    // Clear draggable so editor's dragover accepts the drop via its else-path.
    // The ghost stays: a bare tag has no native drag image of its own, so
    // Obsidian's hashtag preview is the only one there is.
    releaseDragManagerState(app, { keepGhost: true });
  };
}

/**
 * Factory for card/title drag — clears hover state, initiates link drag.
 *
 * Deliberately does NOT release DragManager state: unlike the tag and link
 * drags, this one wants Obsidian's own link drop handling, which reads the
 * `draggable` the other factories clear.
 */
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

/** Factory for external link drag — formats as Markdown link when captioned. */
export function createExternalLinkDragHandler(
  app: App,
  caption: string,
  url: string
): (e: DragEvent) => void {
  return (e) => {
    e.stopPropagation();
    // Property-row links live inside the card too — see createTagDragHandler.
    clearCardHoverState((e.currentTarget as HTMLElement)?.closest('.card'));
    e.dataTransfer?.clearData();
    e.dataTransfer?.setData(DRAG_MARKER, '');
    const dragText = caption === url ? url : `[${caption}](${url})`;
    e.dataTransfer?.setData('text/plain', dragText);
    // Same reason as the URL button: WebKit fires no contextmenu for a touch
    // long press, and Obsidian only synthesises one for a drag it registered.
    // Without this a long press on a property link opens nothing (#430).
    if (Platform.isIosApp) {
      app.dragManager.onDragStart(e, {
        type: 'text',
        title: url,
        icon: 'lucide-link',
      });
      releaseDragManagerState(app);
    }
  };
}

/** Factory for URL button drag — defers pointer-events to avoid drag abort. */
export function createUrlButtonDragHandlers(
  app: App,
  iconEl: HTMLElement,
  urlValue: string
): {
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  onTouchStart: () => void;
} {
  let cleanedUp = false;
  let pointerEventsSet = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    const doc = iconEl.ownerDocument;
    doc.removeEventListener('drop', cleanup);
    const body = doc.body;
    // Scope removal to matching tooltip text to avoid removing unrelated tooltips
    const currentUrl = iconEl.dataset.dynamicViewsUrlValue ?? urlValue;
    for (const tip of body.querySelectorAll('.tooltip')) {
      if (tip.textContent === currentUrl) {
        tip.remove();
        break;
      }
    }
    body.removeClass('dynamic-views-dragging');
    // If the deferred setTimeout in onDragStart hasn't run yet (dragend fired
    // before setTimeout(0)), schedule removal after it runs. Otherwise remove
    // immediately.
    if (pointerEventsSet) {
      iconEl.style.removeProperty('pointer-events');
    } else {
      window.setTimeout(() => iconEl.style.removeProperty('pointer-events'), 0);
    }
    // WebKit: Obsidian creates tooltip from aria-label ~1-2s after native drag
    // ends. MutationObserver catches and removes it. Scoped to URL text to
    // avoid removing unrelated tooltips.
    const win: OwnerWindow = doc.defaultView ?? window;
    const mo = new win.MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const n of m.addedNodes) {
          if (
            (n as Element).classList?.contains('tooltip') &&
            (n as Element).textContent === currentUrl
          ) {
            (n as Element).remove();
          }
        }
      }
    });
    mo.observe(body, { childList: true });
    window.setTimeout(() => mo.disconnect(), 3000);
  };

  const onTouchStart = () => {
    cleanedUp = false;
    const doc = iconEl.ownerDocument;
    // Fresh registration — only one listener active at a time
    doc.removeEventListener('drop', cleanup);
    doc.addEventListener('drop', cleanup, { once: true });
    // Cancel fallback if touch ends without drag.
    // Cannot use touchcancel here — WebKit fires touchcancel when native drag
    // STARTS (dual meaning: drag started vs gesture stolen), which would
    // remove the drop listener we need for drag cleanup.
    iconEl.addEventListener(
      'touchend',
      () => {
        doc.removeEventListener('drop', cleanup);
      },
      { once: true }
    );
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
      cleanedUp = false;
      pointerEventsSet = false;
      e.stopPropagation();
      const body = iconEl.ownerDocument.body;
      // Ensure body class is set even if mousedown didn't fire on the icon
      // (Preact event delegation can prevent mousedown from reaching the
      // element while dragstart still fires on the native <a>)
      body.addClass('dynamic-views-dragging');
      const card = iconEl.closest('.card');
      // Release the hover source synchronously
      clearCardHoverSource(card);
      // Defer poster-hover-active removal and icon pointer-events —
      // synchronous removal sets pointer-events: none on .card-content,
      // aborting the drag. Deferred runs after drag system takes over.
      window.setTimeout(() => {
        card?.classList.remove('poster-hover-active');
        iconEl.setCssStyles({ pointerEvents: 'none' });
        pointerEventsSet = true;
      }, 0);
      if (e.dataTransfer) {
        // 'link' alone rejects drops into CodeMirror (uses dropEffect 'copy').
        // 'copyLink' allows both copy and link operations.
        e.dataTransfer.effectAllowed = 'copyLink';
        // Native <a> sets text/uri-list + text/html — Obsidian prefers
        // uri-list and wraps as [url](url). Clear all, set plain text only.
        e.dataTransfer.clearData();
        e.dataTransfer.setData(DRAG_MARKER, '');
        // Read from dataset for freshness — surgical updates refresh the URL
        // without re-binding event listeners
        e.dataTransfer.setData(
          'text/plain',
          iconEl.dataset.dynamicViewsUrlValue ?? urlValue
        );
      }
      // WebKit dispatches no contextmenu for a touch long press; Obsidian synthesises
      // one from DragManager when a registered drag ends without moving. Registering
      // here buys that synthesis (#430). WebKit-only: on desktop this would replace
      // the native two-line link ghost that the DataTransfer above exists to produce.
      if (Platform.isIosApp) {
        app.dragManager.onDragStart(e, {
          type: 'text',
          title: iconEl.dataset.dynamicViewsUrlValue ?? urlValue,
          icon: 'lucide-link',
        });
        // Registered only to buy the synthesis, so hand back everything else it
        // took — here the ghost has to go, or Obsidian's preview paints over
        // WebKit's native link one.
        releaseDragManagerState(app);
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
function patchWindowDataTransfer(win: OwnerWindow): () => void {
  const proto = win.DataTransfer.prototype;
  // eslint-disable-next-line @typescript-eslint/unbound-method -- prototype patching
  const origGetData = proto.getData;
  proto.getData = function (this: DataTransfer, format: string): string {
    if (format === 'text/uri-list' && this.types.includes(DRAG_MARKER)) {
      return '';
    }
    return origGetData.call(this, format) as string;
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
      cleanups.push(patchWindowDataTransfer(child.win as OwnerWindow));
    }
  }

  // Patch future popout windows
  const ref = app.workspace.on('window-open', (_workspaceWindow, win) => {
    cleanups.push(patchWindowDataTransfer(win as OwnerWindow));
  });

  return () => {
    app.workspace.offref(ref);
    for (const cleanup of cleanups) cleanup();
  };
}
