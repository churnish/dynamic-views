import { SCROLL_TOLERANCE } from './constants';

/**
 * Updates scroll gradient classes based on scroll position
 * Adds visual indicators when content extends beyond visible area
 *
 * @param element - The property field element (parent container)
 */
export function updateScrollGradient(element: HTMLElement): void {
    // With wrapper structure: wrapper always scrolls and receives gradients
    const wrapper = element.querySelector('.property-content-wrapper') as HTMLElement;
    const content = element.querySelector('.property-content') as HTMLElement;

    if (!wrapper || !content) {
        return;
    }

    // Wrapper is both the scrolling element and gradient target
    const scrollingElement = wrapper;
    const gradientTarget = wrapper;

    // Check if content exceeds wrapper space
    // More reliable than wrapper.scrollWidth: checks actual content width vs wrapper visible space
    const isScrollable = content.scrollWidth > wrapper.clientWidth;

    if (!isScrollable) {
        // Not scrollable - remove all gradient classes
        gradientTarget.removeClass('scroll-gradient-left');
        gradientTarget.removeClass('scroll-gradient-right');
        gradientTarget.removeClass('scroll-gradient-both');
        element.removeClass('is-scrollable');
        return;
    }

    // Mark field as scrollable for conditional alignment
    element.addClass('is-scrollable');

    // Read scroll position from wrapper
    const scrollLeft = scrollingElement.scrollLeft;
    const scrollWidth = scrollingElement.scrollWidth;
    const clientWidth = scrollingElement.clientWidth;
    const atStart = scrollLeft <= SCROLL_TOLERANCE;
    const atEnd = scrollLeft + clientWidth >= scrollWidth - SCROLL_TOLERANCE;

    // Remove all gradient classes first
    gradientTarget.removeClass('scroll-gradient-left');
    gradientTarget.removeClass('scroll-gradient-right');
    gradientTarget.removeClass('scroll-gradient-both');

    // Apply appropriate gradient based on position
    if (atStart && !atEnd) {
        // At start, content extends right
        gradientTarget.addClass('scroll-gradient-right');
    } else if (atEnd && !atStart) {
        // At end, content extends left
        gradientTarget.addClass('scroll-gradient-left');
    } else if (!atStart && !atEnd) {
        // In middle, content extends both directions
        gradientTarget.addClass('scroll-gradient-both');
    }
    // If atStart && atEnd, content fits fully - no gradient
}

/**
 * Sets up scroll gradients for all property fields in a container
 * Attaches scroll listeners for user interaction
 * Note: ResizeObserver not needed - card-level observer triggers gradient updates via measurement
 *
 * @param container - The container element with property fields
 * @param propertyObservers - Array to track ResizeObservers for cleanup (unused, kept for compatibility)
 * @param updateGradientFn - Function to call for gradient updates (bound to view instance)
 */
export function setupScrollGradients(
    container: HTMLElement,
    propertyObservers: ResizeObserver[],
    updateGradientFn: (element: HTMLElement) => void
): void {
    // Find all property field containers (both side-by-side and full-width)
    const scrollables = container.querySelectorAll('.property-field');

    scrollables.forEach((el) => {
        const element = el as HTMLElement;
        const wrapper = element.querySelector('.property-content-wrapper') as HTMLElement;

        if (!wrapper) return;

        // Initial gradient update after layout settles
        requestAnimationFrame(() => {
            updateGradientFn(element);
        });

        // Attach scroll listener to wrapper for user scroll interaction
        wrapper.addEventListener('scroll', () => {
            updateGradientFn(element);
        });
    });
}
