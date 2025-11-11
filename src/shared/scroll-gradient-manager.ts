import { SCROLL_TOLERANCE } from './constants';

/**
 * Updates scroll gradient classes based on scroll position
 * Adds visual indicators when content extends beyond visible area
 *
 * @param element - The scrollable element
 */
export function updateScrollGradient(element: HTMLElement): void {
    // Check if content is wider than field (not element.scrollWidth which doesn't reflect content width with flexbox)
    const content = element.querySelector('.property-content') as HTMLElement;
    const isScrollable = content ? content.scrollWidth > element.clientWidth : element.scrollWidth > element.clientWidth;

    if (!isScrollable) {
        // Not scrollable - remove all gradient classes and mark as not scrollable
        element.removeClass('scroll-gradient-left');
        element.removeClass('scroll-gradient-right');
        element.removeClass('scroll-gradient-both');
        element.removeClass('is-scrollable');
        return;
    }

    // Mark as scrollable for conditional alignment
    element.addClass('is-scrollable');

    const scrollLeft = element.scrollLeft;
    const scrollWidth = element.scrollWidth;
    const clientWidth = element.clientWidth;
    const atStart = scrollLeft <= SCROLL_TOLERANCE;
    const atEnd = scrollLeft + clientWidth >= scrollWidth - SCROLL_TOLERANCE;

    // Remove all gradient classes first
    element.removeClass('scroll-gradient-left');
    element.removeClass('scroll-gradient-right');
    element.removeClass('scroll-gradient-both');

    // Apply appropriate gradient based on position
    if (atStart && !atEnd) {
        // At start, content extends right
        element.addClass('scroll-gradient-right');
    } else if (atEnd && !atStart) {
        // At end, content extends left
        element.addClass('scroll-gradient-left');
    } else if (!atStart && !atEnd) {
        // In middle, content extends both directions
        element.addClass('scroll-gradient-both');
    }
    // If atStart && atEnd, content fits fully - no gradient
}

/**
 * Sets up scroll gradients for all property fields in a container
 * Attaches scroll listeners and resize observers
 *
 * @param container - The container element with property fields
 * @param propertyObservers - Array to track ResizeObservers for cleanup
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

        // Initial gradient update after layout settles
        requestAnimationFrame(() => {
            updateGradientFn(element);
        });

        // Update on scroll
        element.addEventListener('scroll', () => {
            updateGradientFn(element);
        });

        // Update on resize (for when layout dimensions change)
        const observer = new ResizeObserver(() => {
            updateGradientFn(element);
        });
        observer.observe(element);
        propertyObservers.push(observer);
    });
}
