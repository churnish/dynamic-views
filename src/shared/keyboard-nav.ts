/**
 * Shared keyboard navigation utilities for card/masonry views
 * Used by both Datacore and Bases implementations
 */

const CARD_SELECTOR = ".card";

/** Tolerance in pixels for same-column detection (handles floating point variance) */
const COLUMN_TOLERANCE = 5;

/** Weight applied to cross-axis distance in navigation calculations */
const CROSS_AXIS_WEIGHT = 0.5;

interface CardRect {
  card: HTMLElement;
  left: number;
  centerX: number;
  centerY: number;
}

/**
 * Calculate weighted distance between current position and target
 * Primary axis distance + weighted cross-axis distance
 */
function calculateDistance(primaryDist: number, crossAxisDist: number): number {
  return primaryDist + crossAxisDist * CROSS_AXIS_WEIGHT;
}

/**
 * Check if two cards are in the same column (within tolerance)
 */
function isSameColumn(leftA: number, leftB: number): boolean {
  return Math.abs(leftA - leftB) <= COLUMN_TOLERANCE;
}

/**
 * Handle arrow key navigation between cards using 2D spatial positioning
 *
 * @param e - KeyboardEvent from keydown handler
 * @param currentCard - Currently focused card element
 * @param container - Parent container holding all cards
 * @param onNavigate - Optional callback when navigation occurs
 */
export function handleArrowNavigation(
  e: KeyboardEvent,
  currentCard: HTMLElement,
  container: HTMLElement,
  onNavigate?: (targetCard: HTMLElement, index: number) => void,
): void {
  const cards = Array.from(
    container.querySelectorAll<HTMLElement>(CARD_SELECTOR),
  );
  const currentIndex = cards.indexOf(currentCard);

  if (currentIndex === -1 || cards.length <= 1) return;

  // Batch all getBoundingClientRect calls to avoid layout thrashing
  const cardRects: CardRect[] = cards.map((card) => {
    const rect = card.getBoundingClientRect();
    return {
      card,
      left: rect.left,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
    };
  });

  const current = cardRects[currentIndex];
  let targetCard: HTMLElement | null = null;
  let minDistance = Infinity;

  // Find best target based on direction
  for (let i = 0; i < cardRects.length; i++) {
    if (i === currentIndex) continue;

    const candidate = cardRects[i];
    let isValid = false;
    let distance = 0;

    switch (e.key) {
      case "ArrowDown":
        if (
          candidate.centerY > current.centerY &&
          isSameColumn(candidate.left, current.left)
        ) {
          distance = calculateDistance(
            candidate.centerY - current.centerY,
            Math.abs(candidate.centerX - current.centerX),
          );
          isValid = true;
        }
        break;

      case "ArrowUp":
        if (
          candidate.centerY < current.centerY &&
          isSameColumn(candidate.left, current.left)
        ) {
          distance = calculateDistance(
            current.centerY - candidate.centerY,
            Math.abs(candidate.centerX - current.centerX),
          );
          isValid = true;
        }
        break;

      case "ArrowRight":
        if (candidate.centerX > current.centerX) {
          distance = calculateDistance(
            candidate.centerX - current.centerX,
            Math.abs(candidate.centerY - current.centerY),
          );
          isValid = true;
        }
        break;

      case "ArrowLeft":
        if (candidate.centerX < current.centerX) {
          distance = calculateDistance(
            current.centerX - candidate.centerX,
            Math.abs(candidate.centerY - current.centerY),
          );
          isValid = true;
        }
        break;
    }

    if (isValid && distance < minDistance) {
      minDistance = distance;
      targetCard = candidate.card;
    }
  }

  if (targetCard) {
    const targetIndex = cards.indexOf(targetCard);
    if (onNavigate) {
      onNavigate(targetCard, targetIndex);
    }
    targetCard.focus();
    targetCard.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

/**
 * Check if a key is an arrow key
 */
export function isArrowKey(key: string): boolean {
  return ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key);
}
