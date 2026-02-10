/**
 * Shared keyboard navigation utilities for card/masonry views
 * Used by both Datacore and Bases implementations
 *
 * Focus terminology:
 * - "DOM focus": The browser's native focus (document.activeElement)
 * - "Visible focus": When _keyboardNavActive=true, showing focus ring via CSS
 *
 * A card can have DOM focus without visible focus (e.g., after mouse click).
 * Visible focus requires explicit activation via keyboard interaction.
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

/** Check if image viewer should block keyboard navigation for a container. */
export function isImageViewerBlockingNav(
  container: HTMLElement | null,
): boolean {
  const viewer = document.querySelector(".dynamic-views-image-embed.is-zoomed");
  if (!viewer) return false;
  // Fullscreen viewer → block all nav
  if (!viewer.classList.contains("dynamic-views-viewer-fixed")) return true;
  // Constrained viewer → block only if original embed is in the same view
  const originalEmbed = (viewer as unknown as { __originalEmbed?: HTMLElement })
    .__originalEmbed;
  if (!originalEmbed || !container) return false;
  return container.contains(originalEmbed);
}

/**
 * Container element with focus management properties
 *
 * @property _keyboardNavActive - When true, shows focus ring on focused card.
 *   Set true on keyboard activation, false on mouse click, Escape, or focusout.
 * @property _intentionalFocus - Guards against focus event handlers rejecting
 *   programmatic focus changes. Set true before focus(), cleared on next frame.
 * @property _focusCleanup - Cleanup function for focusout listener, used to
 *   prevent duplicate handler registration on re-initialization.
 */
interface FocusManagedContainer extends HTMLElement {
  _keyboardNavActive?: boolean;
  _intentionalFocus?: boolean;
  _focusCleanup?: () => void;
}

/**
 * Initialize focus management on a container element.
 * Sets up focusout handler and initializes state.
 * Call this when container is created/re-created.
 * @returns Cleanup function to remove handlers
 */
export function initializeContainerFocus(container: HTMLElement): () => void {
  const el = container as FocusManagedContainer;

  // Skip if already initialized (avoid duplicate handlers)
  if (el._focusCleanup) {
    return el._focusCleanup;
  }

  // Initialize focus state
  el._keyboardNavActive = false;
  el._intentionalFocus = false;

  // Reset keyboard nav mode when focus leaves all cards
  const handleFocusout = (e: FocusEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    // Only reset if focus is leaving to something that's not a card
    // Use optional chaining for defensive access to classList
    if (!relatedTarget?.classList?.contains("card")) {
      el._keyboardNavActive = false;
    }
  };

  container.addEventListener("focusout", handleFocusout);

  // Store and return cleanup function
  el._focusCleanup = () => {
    container.removeEventListener("focusout", handleFocusout);
    delete el._focusCleanup;
  };

  return el._focusCleanup;
}

/**
 * Setup keyboard navigation for hover-to-start pattern.
 * Handles the initial activation of visible focus from arrow keys.
 *
 * Priority order:
 * 1. If any card is visibly focused, defer to that card's keydown handler
 * 2. If hovering over a card, visibly focus that card
 * 3. If a card has DOM focus (but not visible), activate visible focus
 * 4. Otherwise, do nothing (let arrow keys scroll the page, etc.)
 *
 * Uses capture phase to intercept before individual card handlers.
 * @returns Cleanup function to remove event listener
 */
export function setupHoverKeyboardNavigation(
  getHoveredCard: () => HTMLElement | null,
  getContainerRef: () => HTMLElement | null,
  setFocusableIndex: (index: number) => void,
): () => void {
  const handleKeydown = (e: KeyboardEvent) => {
    if (isImageViewerBlockingNav(getContainerRef())) return;
    if (!isArrowKey(e.key)) return;

    const hoveredCard = getHoveredCard();
    const activeEl = document.activeElement as HTMLElement | null;
    const isCardFocused = activeEl?.classList.contains("card");

    // Check the DOM-focused card's container for visible focus state
    const focusedCardContainer = activeEl?.closest(
      ".dynamic-views-masonry, .dynamic-views-grid",
    ) as (HTMLElement & { _keyboardNavActive?: boolean }) | null;
    const isVisiblyFocused =
      focusedCardContainer?._keyboardNavActive && isCardFocused;

    // Case 1: Any card is visibly focused → let card's keydown handler navigate
    // Return early so the card's handler (in card-renderer/shared-renderer)
    // can call handleArrowNavigation() to move focus to an adjacent card
    if (isVisiblyFocused) return;

    // Case 2: Hovering over a card → visibly focus that card
    // Hover takes priority because user's cursor indicates intent
    if (hoveredCard?.isConnected) {
      e.preventDefault();
      e.stopImmediatePropagation();

      const container = getContainerRef() as
        | (HTMLElement & {
            _keyboardNavActive?: boolean;
            _intentionalFocus?: boolean;
          })
        | null;

      if (container?.isConnected) {
        container._intentionalFocus = true;
        container._keyboardNavActive = true;
      }

      hoveredCard.focus();

      if (container?.isConnected) {
        const allCards = container.querySelectorAll(".card");
        const index = Array.from(allCards).indexOf(hoveredCard);
        if (index >= 0) {
          setFocusableIndex(index);
        }
        // Capture container reference to prevent stale closure
        const containerSnapshot = container;
        requestAnimationFrame(() => {
          if (containerSnapshot?.isConnected) {
            containerSnapshot._intentionalFocus = false;
          }
        });
      }
      return;
    }

    // Case 3: Not hovering but card has DOM focus → activate visible focus
    // This handles Tab focus: card has DOM focus but not visible focus yet.
    // Pressing arrow activates visible focus so subsequent arrows navigate.
    if (isCardFocused && focusedCardContainer?.isConnected) {
      e.preventDefault();
      e.stopImmediatePropagation();
      focusedCardContainer._keyboardNavActive = true;
    }

    // Case 4: Not hovering and no card has DOM focus → do nothing
  };

  document.addEventListener("keydown", handleKeydown, { capture: true });
  return () =>
    document.removeEventListener("keydown", handleKeydown, { capture: true });
}
