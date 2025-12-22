/**
 * Scroll preservation for Bases views
 * Handles scroll position tracking, reset detection, and restoration across tab switches
 */

import type { App, EventRef } from "obsidian";

// Shared scroll positions across all views (keyed by leafId)
const scrollPositions = new Map<string, number>();

// Time-based reset detection threshold
const RESET_DETECTION_WINDOW_MS = 200;

// Threshold constants for scroll reset detection
const RESET_THRESHOLD_RATIO = 0.1; // 10% of saved position triggers reset detection
const MIN_RESET_POSITION = 100; // Minimum saved position for reset detection

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
  private lastSwitchToTime = 0;
  private scrollHandler: (() => void) | null = null;

  constructor(config: ScrollPreservationConfig) {
    this.leafId = config.leafId;
    this.scrollEl = config.scrollEl;
    this.app = config.app;

    // Setup active-leaf-change handler
    config.registerEvent(
      config.app.workspace.on("active-leaf-change", (leaf) => {
        // Cast required: WorkspaceLeaf.id exists at runtime but isn't in public types
        const leafId = (leaf as unknown as { id: string })?.id;
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
      if (this.scrollHandler) {
        this.scrollEl.removeEventListener("scroll", this.scrollHandler);
      }
    });
  }

  private handleSwitchTo(): void {
    this.lastSwitchToTime = Date.now();
    const saved = scrollPositions.get(this.leafId);
    if (saved !== undefined && saved > 0) {
      this.scrollEl.scrollTop = saved;
    }
    this.scrollEl.style.visibility = "";
    this.scrollEl.style.overflow = "";
  }

  private handleSwitchAway(newLeaf: unknown): void {
    // Find this view's leaf to compare parents using reference equality
    // (parent.id doesn't exist in Obsidian types - use object identity instead)
    const thisLeaf = this.app.workspace.getLeafById(this.leafId);
    const thisParent = (thisLeaf as unknown as { parent?: unknown })?.parent;
    const newParent = (newLeaf as { parent?: unknown })?.parent;

    // Only hide if switching tabs within same pane, not when focus moves to split pane
    if (thisParent !== newParent) return;

    // Hide during tab switch to prevent visual artifacts. If view is destroyed before
    // handleSwitchTo can restore visibility, DOM removal handles cleanup automatically.
    this.scrollEl.style.visibility = "hidden";
    this.scrollEl.style.overflow = "hidden";
  }

  private createScrollHandler(): () => void {
    let scheduled = false;
    return () => {
      // Throttle to once per animation frame (60fps max) - saves battery on mobile
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;

        const currentSaved = scrollPositions.get(this.leafId) ?? 0;
        const newScroll = this.scrollEl.scrollTop;

        // Detect sudden reset within window after tab switch
        const isRecentSwitch =
          Date.now() - this.lastSwitchToTime < RESET_DETECTION_WINDOW_MS;
        if (
          isRecentSwitch &&
          newScroll < currentSaved * RESET_THRESHOLD_RATIO &&
          currentSaved > MIN_RESET_POSITION
        ) {
          this.scrollEl.scrollTop = currentSaved;
          return;
        }

        // Always track current scroll position (symmetric - saves both up and down)
        scrollPositions.set(this.leafId, newScroll);
      });
    };
  }

  /** Restore scroll position after render (re-reads from map for freshness) */
  restoreAfterRender(): void {
    const saved = scrollPositions.get(this.leafId) ?? 0;
    if (saved > 0) {
      this.scrollEl.scrollTop = saved;
    }
  }

  /** Clean up on view unload */
  cleanup(): void {
    scrollPositions.delete(this.leafId);
  }
}
