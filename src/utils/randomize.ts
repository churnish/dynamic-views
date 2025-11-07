/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
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
	console.log('// [Randomize Debug] Starting getActiveBasesView');

	const activeLeaf = app.workspace.activeLeaf;
	if (!activeLeaf) {
		console.log('// [Randomize Debug] No active leaf');
		return null;
	}

	const view = activeLeaf.view;
	const viewType = view.getViewType();
	console.log('// [Randomize Debug] Active view type:', viewType);

	// Check if it's a Bases view (could be 'bases' or 'base-view')
	if (viewType === 'bases' || viewType === 'base-view') {
		// Access the Bases view instance through the view's properties
		const wrapper = view as any;

		console.log('// [Randomize Debug] View object keys:', Object.keys(wrapper));
		console.log('// [Randomize Debug] wrapper.controller exists:', !!wrapper.controller);
		console.log('// [Randomize Debug] wrapper.query exists:', !!wrapper.query);

		// Check controller for query results
		if (wrapper.controller) {
			console.log('// [Randomize Debug] wrapper.controller keys:', Object.keys(wrapper.controller));
			console.log('// [Randomize Debug] wrapper.controller.results exists:', !!wrapper.controller.results);

			if (wrapper.controller.results) {
				console.log('// [Randomize Debug] wrapper.controller.results type:', typeof wrapper.controller.results);
				console.log('// [Randomize Debug] wrapper.controller.results keys:', Object.keys(wrapper.controller.results));
				console.log('// [Randomize Debug] wrapper.controller.results.data exists:', !!wrapper.controller.results?.data);
				console.log('// [Randomize Debug] wrapper.controller.results.data length:', wrapper.controller.results?.data?.length);
			}
		}

		// The controller holds the query results in .results.data
		if (wrapper.controller?.results?.data && Array.isArray(wrapper.controller.results.data)) {
			console.log('// [Randomize Debug] Using controller.results as basesView data');

			// Create a compatible basesView object
			return {
				type: wrapper.controller?.id || 'unknown',
				data: wrapper.controller.results,
				onDataUpdated: wrapper.onDataUpdated?.bind(wrapper),
				isShuffled: wrapper.isShuffled
			};
		}

		// Try basesView property (for dynamic-views plugin)
		if (wrapper.basesView) {
			console.log('// [Randomize Debug] Found basesView property, type:', wrapper.basesView.type);
			return wrapper.basesView;
		}
	}

	console.log('// [Randomize Debug] No Bases view found');
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
	console.log('// [Randomize Debug] openRandomFile called, openInNewPane:', openInNewPane);

	const basesView = getActiveBasesView(app);

	if (!basesView) {
		console.log('// [Randomize Debug] No Bases view found');
		new Notice('No Bases view is currently active');
		return;
	}

	console.log('// [Randomize Debug] basesView.data:', basesView.data);
	const entries = basesView.data?.data;
	console.log('// [Randomize Debug] entries count:', entries?.length);

	if (!entries || entries.length === 0) {
		new Notice('No files in current view');
		return;
	}

	// Pick a random entry
	const randomIndex = Math.floor(Math.random() * entries.length);
	const randomEntry = entries[randomIndex];
	console.log('// [Randomize Debug] Random index:', randomIndex, 'entry:', randomEntry);

	if (!randomEntry.file) {
		console.log('// [Randomize Debug] Entry has no file property');
		new Notice('Selected entry has no file');
		return;
	}

	// Open the file
	const filePath = randomEntry.file.path;
	console.log('// [Randomize Debug] Opening file:', filePath);
	await app.workspace.openLinkText(filePath, '', openInNewPane);
	new Notice(`Opened: ${randomEntry.file.basename || randomEntry.file.name || filePath}`);
}

/**
 * Toggle shuffle state on the active Bases view
 */
export function toggleShuffleActiveView(app: App): void {
	console.log('// [Randomize Debug] toggleShuffleActiveView called');

	const basesView = getActiveBasesView(app);

	if (!basesView) {
		console.log('// [Randomize Debug] No Bases view found for shuffle');
		new Notice('No Bases view is currently active');
		return;
	}

	console.log('// [Randomize Debug] basesView type:', basesView.type);
	console.log('// [Randomize Debug] basesView has onDataUpdated:', typeof basesView.onDataUpdated);

	// Check if this is a dynamic-views Bases view (which supports shuffle state)
	const isDynamicView = basesView.type === 'dynamic-views-card' || basesView.type === 'dynamic-views-masonry';

	if (isDynamicView) {
		console.log('// [Randomize Debug] Dynamic views detected, toggling shuffle');
		// Dynamic views have the isShuffled property
		const dynamicView = basesView as DynamicBasesView;
		const currentState = dynamicView.isShuffled ?? false;
		dynamicView.isShuffled = !currentState;

		// Trigger re-render
		if (dynamicView.onDataUpdated) {
			dynamicView.onDataUpdated();
		}

		const newState = dynamicView.isShuffled;
		console.log('// [Randomize Debug] New shuffle state:', newState);
		new Notice(newState ? 'View shuffled' : 'Shuffle disabled');
	} else {
		console.log('// [Randomize Debug] Non-dynamic view, shuffle not supported');
		// For other Bases views, we can't permanently shuffle, but we can shuffle the data once
		const entries = basesView.data?.data;
		if (entries && entries.length > 0) {
			console.log('// [Randomize Debug] Shuffling entries array in place');
			shuffleArray(entries);

			// Try to trigger re-render if method exists
			if (basesView.onDataUpdated) {
				console.log('// [Randomize Debug] Triggering onDataUpdated');
				basesView.onDataUpdated();
			}

			new Notice(`Shuffled ${entries.length} items (one-time shuffle)`);
		} else {
			new Notice('No items to shuffle');
		}
	}
}
