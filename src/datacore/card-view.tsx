import type { Settings } from "../types";
import { CardRenderer, type CardData } from "../shared/card-renderer";
import type { App } from "obsidian";

interface CardViewProps {
  cards: CardData[];
  settings: Settings;
  viewMode: "card" | "masonry";
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

export function CardView({
  cards,
  settings,
  viewMode,
  sortMethod,
  isShuffled,
  focusableCardIndex,
  hoveredCardRef,
  containerRef,
  updateLayoutRef,
  app,
  onCardClick,
  onFocusChange,
}: CardViewProps): JSX.Element {
  return (
    <CardRenderer
      cards={cards}
      settings={settings}
      viewMode={viewMode}
      sortMethod={sortMethod}
      isShuffled={isShuffled}
      focusableCardIndex={focusableCardIndex}
      hoveredCardRef={hoveredCardRef}
      containerRef={containerRef}
      updateLayoutRef={updateLayoutRef}
      app={app}
      onCardClick={onCardClick}
      onFocusChange={onFocusChange}
    />
  );
}
