import { CardView } from "./card-view";
import type { ResolvedSettings } from "../types";
import type { CardData } from "../shared/card-renderer";
import type { App } from "obsidian";

interface MasonryViewProps {
  cards: CardData[];
  settings: ResolvedSettings;
  sortMethod: string;
  isShuffled: boolean;
  focusableCardIndex: number;
  hoveredCardRef: { current: HTMLElement | null };
  containerRef: { current: HTMLElement | null };
  updateLayoutRef: { current: (() => void) | null };
  app: App;
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
