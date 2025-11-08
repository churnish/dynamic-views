import { CardView } from './card-view';
import type { Settings } from '../types';
import type { DatacoreAPI, DatacoreFile } from '../types/datacore';
import type { App } from 'obsidian';

interface MasonryViewProps {
    results: DatacoreFile[];
    displayedCount: number;
    settings: Settings;
    sortMethod: string;
    isShuffled: boolean;
    snippets: Record<string, string>;
    images: Record<string, string | string[]>;
    hasImageAvailable: Record<string, boolean>;
    focusableCardIndex: number;
    containerRef: { current: HTMLElement | null };
    updateLayoutRef: { current: (() => void) | null };
    app: App;
    dc: DatacoreAPI;
    onCardClick?: (path: string, newLeaf: boolean) => void;
    onFocusChange?: (index: number) => void;
}

/**
 * MasonryView is a wrapper around CardView with viewMode set to 'masonry'.
 * The masonry layout is achieved through CSS and the CardView component handles
 * both card and masonry rendering with appropriate className switching.
 */
export function MasonryView(props: MasonryViewProps): JSX.Element {
    return <CardView {...props} viewMode="masonry" />;
}
