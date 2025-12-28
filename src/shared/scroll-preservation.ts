/**
 * Scroll preservation for Bases views
 * Simple scroll save/restore - no visibility manipulation (matches fork behavior)
 */

import type { App, EventRef, WorkspaceLeaf } from "obsidian";

// Shared scroll positions across all views (keyed by leafId)
const scrollPositions = new Map<string, number>();

/** Runtime-only properties on WorkspaceLeaf not exposed in public types */
export interface LeafRuntimeProps {
  id?: string;
  parent?: unknown;
}

/** Safely access runtime-only leaf properties */
export function getLeafProps(
  leaf: WorkspaceLeaf | null | undefined,
): LeafRuntimeProps {
  if (!leaf) return {};
  return leaf as unknown as LeafRuntimeProps;
}

export interface ScrollPreservationConfig {
  leafId: string;
  scrollEl: HTMLElement;
  registerEvent: (event: EventRef) => void;
  register: (cleanup: () => void) => void;
  app: App;
}

export class ScrollPreservation {
  private leafId: string;
  private scrollEl: HTMLElement;
  private app: App;
  private scrollHandler: () => void;

  constructor(config: ScrollPreservationConfig) {
    if (!config.leafId || config.leafId.length === 0) {
      throw new Error("ScrollPreservation: leafId cannot be empty");
    }
    this.leafId = config.leafId;
    this.scrollEl = config.scrollEl;
    this.app = config.app;

    // Setup active-leaf-change handler
    config.registerEvent(
      config.app.workspace.on("active-leaf-change", (leaf) => {
        const leafId = getLeafProps(leaf).id;
        // Guard: skip if leaf has no id (transitional state)
        if (!leafId) return;

        if (leafId === this.leafId) {
          this.handleSwitchTo();
        } else {
          this.handleSwitchAway(leaf);
        }
      }),
    );

    // Setup scroll tracking
    this.scrollHandler = this.createScrollHandler();
    this.scrollEl.addEventListener("scroll", this.scrollHandler, {
      passive: true,
    });
    config.register(() => {
      this.scrollEl.removeEventListener("scroll", this.scrollHandler);
    });
  }

  /** Restore scroll position from saved state */
  private restore(): void {
    if (!this.scrollEl.isConnected) return;
    const saved = scrollPositions.get(this.leafId) ?? 0;
    if (saved > 0) {
      this.scrollEl.scrollTop = saved;
    }
  }

  private handleSwitchTo(): void {
    this.restore();
  }

  private handleSwitchAway(newLeaf: WorkspaceLeaf | null): void {
    if (!this.scrollEl.isConnected) return;

    // Get this view's leaf - abort if not found (view may be destroyed)
    const thisLeaf = this.app.workspace.getLeafById(this.leafId);
    if (!thisLeaf) return;

    // Compare parent containers to detect same-pane tab switches
    const thisParent = getLeafProps(thisLeaf).parent;
    const newParent = getLeafProps(newLeaf).parent;

    // Only save for same-pane switches
    if (thisParent !== newParent) return;

    // Check container state before reading scrollTop (avoids forced reflow)
    if (
      this.scrollEl.scrollHeight === 0 ||
      this.scrollEl.scrollHeight <= this.scrollEl.clientHeight
    ) {
      return;
    }

    const currentScroll = this.scrollEl.scrollTop;
    if (currentScroll > 0) {
      scrollPositions.set(this.leafId, currentScroll);
    }
  }

  private createScrollHandler(): () => void {
    let scheduled = false;
    return () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        if (!this.scrollEl.isConnected) return;

        // Don't save when container collapsed or has no scrollable content
        if (
          this.scrollEl.scrollHeight === 0 ||
          this.scrollEl.scrollHeight <= this.scrollEl.clientHeight
        ) {
          return;
        }

        scrollPositions.set(this.leafId, this.scrollEl.scrollTop);
      });
    };
  }

  /** Restore scroll position after render */
  restoreAfterRender(): void {
    this.restore();
  }

  /** Clear saved scroll position (for intentional scroll-to-top) */
  clearSavedPosition(): void {
    scrollPositions.delete(this.leafId);
  }

  /** Clean up on view unload */
  cleanup(): void {
    scrollPositions.delete(this.leafId);
  }
}
