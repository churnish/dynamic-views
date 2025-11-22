/**
 * Position a dropdown menu beneath its button using fixed positioning
 */
export function positionDropdown(
    buttonElement: HTMLElement,
    menuElement: HTMLElement
): void {
    const buttonRect = buttonElement.getBoundingClientRect();

    // Default position: below button, left-aligned
    let top = buttonRect.bottom + 4; // 4px gap
    let left = buttonRect.left;

    // Get menu dimensions (it must be rendered to measure)
    const menuRect = menuElement.getBoundingClientRect();

    // Viewport boundaries
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const EDGE_PADDING = 8; // Stay 8px from viewport edges

    // Adjust horizontal position if menu would overflow right edge
    if (left + menuRect.width > viewportWidth - EDGE_PADDING) {
        left = Math.max(EDGE_PADDING, viewportWidth - menuRect.width - EDGE_PADDING);
    }

    // Adjust vertical position if menu would overflow bottom edge
    if (top + menuRect.height > viewportHeight - EDGE_PADDING) {
        // Try positioning above button instead
        const topPosition = buttonRect.top - menuRect.height - 4;
        if (topPosition >= EDGE_PADDING) {
            top = topPosition;
        } else {
            // If it doesn't fit above either, position at top of viewport
            top = EDGE_PADDING;
        }
    }

    // Apply position
    menuElement.style.top = `${top}px`;
    menuElement.style.left = `${left}px`;
}

/**
 * Close dropdown when clicking outside
 */
export function setupClickOutside(
    containerElement: HTMLElement,
    onClickOutside: () => void
): () => void {
    const handleClick = (event: MouseEvent) => {
        if (!containerElement.contains(event.target as Node)) {
            onClickOutside();
        }
    };

    // Use setTimeout to avoid closing immediately when opening
    setTimeout(() => {
        document.addEventListener('click', handleClick);
    }, 0);

    // Return cleanup function
    return () => {
        document.removeEventListener('click', handleClick);
    };
}