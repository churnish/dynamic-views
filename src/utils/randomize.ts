/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
import { App, Notice, View, BasesEntry, PaneType, Keymap } from "obsidian";
import type { DynamicViewsGridView } from "../bases/grid-view";
import type { DynamicViewsMasonryView } from "../bases/masonry-view";

type DynamicBasesView = DynamicViewsGridView | DynamicViewsMasonryView;

/**
 * Calculate pane type based on modifier keys and setting.
 * - split/window modifiers take precedence
 * - cmd/ctrl alone inverts the setting
 * - no modifier uses the setting as-is
 */
export function getPaneType(
  event: MouseEvent | KeyboardEvent | null,
  defaultInNewTab: boolean,
): PaneType | boolean {
  const modEvent = Keymap.isModEvent(event);
  return modEvent === "split" || modEvent === "window"
    ? modEvent
    : modEvent
      ? !defaultInNewTab
      : defaultInNewTab;
}

// Internal Obsidian base-view structure
interface BasesViewWrapper extends View {
  basesView?: {
    type: string;
    data?: {
      data: BasesEntry[];
    };
    onDataUpdated?: () => void;
    isShuffled?: boolean;
    shuffledOrder?: string[];
  };
}

/**
 * Fisher-Yates shuffle algorithm
 * Shuffles array in place and returns it
 */
export function shuffleArray<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Get any active Bases view (works with all Bases views, not just dynamic-views)
 */
export function getActiveBasesView(
  app: App,
): BasesViewWrapper["basesView"] | null {
  const activeLeaf = app.workspace.getMostRecentLeaf();
  if (!activeLeaf) return null;

  const view = activeLeaf.view;
  const viewType = view.getViewType();

  // Check if it's a Bases view
  if (viewType === "bases" || viewType === "base-view") {
    const wrapper = view as any;

    // Check controller.view.data.data (standard Bases views)
    if (
      wrapper.controller?.view?.data?.data &&
      Array.isArray(wrapper.controller.view.data.data)
    ) {
      const viewInstanceType = wrapper.controller.view.type || "unknown";

      // For dynamic-views custom views, return the actual view instance
      // This ensures property modifications (isShuffled, shuffledOrder) persist
      if (
        viewInstanceType === "dynamic-views-grid" ||
        viewInstanceType === "dynamic-views-masonry"
      ) {
        return wrapper.controller.view;
      }

      // For standard Bases views, construct a wrapper object
      return {
        type: viewInstanceType,
        data: wrapper.controller.view.data,
        onDataUpdated: wrapper.controller.view.onDataUpdated?.bind(
          wrapper.controller.view,
        ),
        isShuffled: wrapper.controller.view.isShuffled,
        shuffledOrder: wrapper.controller.view.shuffledOrder,
      };
    }

    // Try basesView property (for dynamic-views plugin custom views)
    if (wrapper.basesView) {
      return wrapper.basesView;
    }
  }

  return null;
}

/**
 * Get the active Bases view if it's a dynamic-views view (Grid or Masonry)
 */
export function getActiveDynamicViewsBase(app: App): DynamicBasesView | null {
  const basesView = getActiveBasesView(app);

  if (
    basesView?.type === "dynamic-views-grid" ||
    basesView?.type === "dynamic-views-masonry"
  ) {
    return basesView as DynamicBasesView;
  }

  return null;
}

/**
 * Open a random file from the currently visible entries in the active Bases view
 */
export async function openRandomFile(
  app: App,
  paneType: PaneType | boolean,
): Promise<void> {
  const basesView = getActiveBasesView(app);

  if (!basesView) {
    new Notice("No active base view");
    return;
  }

  const entries = basesView.data?.data;

  if (!entries || entries.length === 0) {
    return;
  }

  // Pick a random entry
  const randomIndex = Math.floor(Math.random() * entries.length);
  const randomEntry = entries[randomIndex];

  if (!randomEntry.file) {
    return;
  }

  // Open the file
  const filePath = randomEntry.file.path;
  await app.workspace.openLinkText(filePath, "", paneType);
}

/**
 * Toggle shuffle state on the active Bases view
 */
export function toggleShuffleActiveView(app: App): void {
  const basesView = getActiveBasesView(app);

  if (!basesView) {
    new Notice("No active base view");
    return;
  }

  // Check if this is a dynamic-views Bases view (which supports persistent shuffle state)
  const isDynamicView =
    basesView.type === "dynamic-views-grid" ||
    basesView.type === "dynamic-views-masonry";

  if (isDynamicView) {
    // Dynamic views have the isShuffled property for persistent shuffle
    const dynamicView = basesView as DynamicBasesView;
    const currentState = dynamicView.isShuffled ?? false;

    dynamicView.isShuffled = !currentState;

    // If enabling shuffle, create shuffled order
    if (dynamicView.isShuffled) {
      const entries = basesView.data?.data;
      if (entries && entries.length > 0) {
        const paths = entries.map((e) => e.file.path);
        dynamicView.shuffledOrder = shuffleArray([...paths]);
      }
    } else {
      // Clear shuffled order when disabling
      dynamicView.shuffledOrder = [];
    }

    // Trigger re-render
    if (dynamicView.onDataUpdated) {
      dynamicView.onDataUpdated();
    }
  } else {
    // For other Bases views, shuffle the data array once
    const entries = basesView.data?.data;
    if (entries && entries.length > 0) {
      shuffleArray(entries);

      // Trigger re-render if method exists
      if (basesView.onDataUpdated) {
        basesView.onDataUpdated();
      }
    }
  }
}
