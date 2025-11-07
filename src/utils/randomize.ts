/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
import { App, Notice, View, BasesEntry } from 'obsidian';
import type { DynamicViewsCardView } from '../bases/card-view';
import type { DynamicViewsMasonryView } from '../bases/masonry-view';

type DynamicBasesView = DynamicViewsCardView | DynamicViewsMasonryView;

// Internal Obsidian base-view structure
interface BasesViewWrapper extends View {
	basesView?: {
		type: string;
		data?: {
			data: BasesEntry[];
		};
		onDataUpdated?: () => void;
		isShuffled?: boolean;
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
export function getActiveBasesView(app: App): BasesViewWrapper['basesView'] | null {
	const activeLeaf = app.workspace.activeLeaf;
	if (!activeLeaf) return null;

	const view = activeLeaf.view;
	const viewType = view.getViewType();

	// Check if it's a Bases view
	if (viewType === 'bases' || viewType === 'base-view') {
		const wrapper = view as any;

		// Check controller.view.data.data (standard Bases views)
		if (wrapper.controller?.view?.data?.data && Array.isArray(wrapper.controller.view.data.data)) {
			return {
				type: wrapper.controller.view.type || 'unknown',
				data: wrapper.controller.view.data,
				onDataUpdated: wrapper.controller.view.onDataUpdated?.bind(wrapper.controller.view),
				isShuffled: wrapper.controller.view.isShuffled
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

	if (basesView?.type === 'dynamic-views-card' || basesView?.type === 'dynamic-views-masonry') {
		return basesView as DynamicBasesView;
	}

	return null;
}

/**
 * Open a random file from the currently visible entries in the active Bases view
 */
export async function openRandomFile(app: App, openInNewPane: boolean): Promise<void> {
	const basesView = getActiveBasesView(app);

	if (!basesView) {
		new Notice('No Bases view is currently active');
		return;
	}

	const entries = basesView.data?.data;

	if (!entries || entries.length === 0) {
		new Notice('No files in current view');
		return;
	}

	// Pick a random entry
	const randomIndex = Math.floor(Math.random() * entries.length);
	const randomEntry = entries[randomIndex];

	if (!randomEntry.file) {
		new Notice('Selected entry has no file');
		return;
	}

	// Open the file
	const filePath = randomEntry.file.path;
	await app.workspace.openLinkText(filePath, '', openInNewPane);
	new Notice(`Opened: ${randomEntry.file.basename || randomEntry.file.name || filePath}`);
}

/**
 * Toggle shuffle state on the active Bases view
 */
export function toggleShuffleActiveView(app: App): void {
	const basesView = getActiveBasesView(app);

	if (!basesView) {
		new Notice('No Bases view is currently active');
		return;
	}

	// Check if this is a dynamic-views Bases view (which supports persistent shuffle state)
	const isDynamicView = basesView.type === 'dynamic-views-card' || basesView.type === 'dynamic-views-masonry';

	if (isDynamicView) {
		// Dynamic views have the isShuffled property for persistent shuffle
		const dynamicView = basesView as DynamicBasesView;
		const currentState = dynamicView.isShuffled ?? false;
		console.log('// [Shuffle Debug] toggleShuffle - current state:', currentState);
		console.log('// [Shuffle Debug] basesView type:', basesView.type);

		dynamicView.isShuffled = !currentState;

		// If enabling shuffle, create shuffled order
		if (dynamicView.isShuffled) {
			const entries = basesView.data?.data;
			console.log('// [Shuffle Debug] Enabling shuffle, entries.length:', entries?.length);
			if (entries && entries.length > 0) {
				const paths = entries.map(e => e.file.path);
				dynamicView.shuffledOrder = shuffleArray([...paths]);
				console.log('// [Shuffle Debug] Created shuffledOrder.length:', dynamicView.shuffledOrder.length);
				console.log('// [Shuffle Debug] First 3 shuffled paths:', dynamicView.shuffledOrder.slice(0, 3));
			}
		} else {
			// Clear shuffled order when disabling
			console.log('// [Shuffle Debug] Disabling shuffle, clearing shuffledOrder');
			dynamicView.shuffledOrder = [];
		}

		// Trigger re-render
		if (dynamicView.onDataUpdated) {
			console.log('// [Shuffle Debug] Triggering onDataUpdated');
			dynamicView.onDataUpdated();
		}

		const newState = dynamicView.isShuffled;
		new Notice(newState ? 'View shuffled' : 'Shuffle disabled');
	} else {
		// For other Bases views, shuffle the data array once
		const entries = basesView.data?.data;
		if (entries && entries.length > 0) {
			shuffleArray(entries);

			// Trigger re-render if method exists
			if (basesView.onDataUpdated) {
				basesView.onDataUpdated();
			}

			new Notice(`Shuffled ${entries.length} items (one-time shuffle)`);
		} else {
			new Notice('No items to shuffle');
		}
	}
}
