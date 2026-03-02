import { vi } from 'vitest';
import type { Mock } from 'vitest';
import { setupClickOutside } from '../../src/utils/dropdown-position';

describe('dropdown-position', () => {
  describe('setupClickOutside', () => {
    let containerElement: HTMLElement;
    let onClickOutside: Mock;
    let cleanup: (() => void) | undefined;

    beforeEach(() => {
      containerElement = document.createElement('div');
      document.body.appendChild(containerElement);
      onClickOutside = vi.fn();
      vi.useFakeTimers();
    });

    afterEach(() => {
      if (cleanup) {
        cleanup();
      }
      document.body.removeChild(containerElement);
      vi.useRealTimers();
    });

    it('should call callback when clicking outside container', () => {
      cleanup = setupClickOutside(containerElement, onClickOutside);

      // Fast-forward timer to attach event listener
      vi.runAllTimers();

      // Click outside
      const outsideElement = document.createElement('div');
      document.body.appendChild(outsideElement);
      outsideElement.click();

      expect(onClickOutside).toHaveBeenCalledTimes(1);

      document.body.removeChild(outsideElement);
    });

    it('should not call callback when clicking inside container', () => {
      cleanup = setupClickOutside(containerElement, onClickOutside);

      // Fast-forward timer to attach event listener
      vi.runAllTimers();

      // Click inside
      containerElement.click();

      expect(onClickOutside).not.toHaveBeenCalled();
    });

    it('should not call callback when clicking on child elements', () => {
      const childElement = document.createElement('button');
      containerElement.appendChild(childElement);

      cleanup = setupClickOutside(containerElement, onClickOutside);

      // Fast-forward timer
      vi.runAllTimers();

      // Click on child
      childElement.click();

      expect(onClickOutside).not.toHaveBeenCalled();
    });

    it('should delay event listener attachment', () => {
      cleanup = setupClickOutside(containerElement, onClickOutside);

      // Click before timer runs
      const outsideElement = document.createElement('div');
      document.body.appendChild(outsideElement);
      outsideElement.click();

      // Callback should not be called yet
      expect(onClickOutside).not.toHaveBeenCalled();

      // Run timer
      vi.runAllTimers();

      // Click again
      outsideElement.click();

      // Now it should be called
      expect(onClickOutside).toHaveBeenCalledTimes(1);

      document.body.removeChild(outsideElement);
    });

    it('should remove event listener on cleanup', () => {
      cleanup = setupClickOutside(containerElement, onClickOutside);

      // Fast-forward timer
      vi.runAllTimers();

      // Call cleanup
      cleanup();

      // Click outside
      const outsideElement = document.createElement('div');
      document.body.appendChild(outsideElement);
      outsideElement.click();

      // Callback should not be called
      expect(onClickOutside).not.toHaveBeenCalled();

      document.body.removeChild(outsideElement);
    });

    it('should handle cleanup called multiple times', () => {
      cleanup = setupClickOutside(containerElement, onClickOutside);

      // Fast-forward timer
      vi.runAllTimers();

      // Call cleanup multiple times
      cleanup();
      cleanup();
      cleanup();

      // Should not throw error
      expect(onClickOutside).not.toHaveBeenCalled();
    });

    it('should handle nested containers', () => {
      const parentContainer = document.createElement('div');
      const childContainer = document.createElement('div');
      parentContainer.appendChild(childContainer);
      document.body.appendChild(parentContainer);

      const parentCallback = vi.fn();
      const childCallback = vi.fn();

      const parentCleanup = setupClickOutside(parentContainer, parentCallback);
      const childCleanup = setupClickOutside(childContainer, childCallback);

      // Fast-forward timers
      vi.runAllTimers();

      // Click on child
      childContainer.click();

      // Parent should not be called (child contains target)
      // Child should not be called (child contains target)
      expect(parentCallback).not.toHaveBeenCalled();
      expect(childCallback).not.toHaveBeenCalled();

      // Click on parent (but outside child)
      parentContainer.click();

      // Child should be called (outside child container)
      // Parent should not be called (inside parent container)
      expect(childCallback).toHaveBeenCalledTimes(1);
      expect(parentCallback).not.toHaveBeenCalled();

      // Cleanup
      parentCleanup();
      childCleanup();
      document.body.removeChild(parentContainer);
    });

    it('should handle document click events', () => {
      cleanup = setupClickOutside(containerElement, onClickOutside);

      // Fast-forward timer
      vi.runAllTimers();

      // Trigger click event on document
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      });

      document.dispatchEvent(clickEvent);

      expect(onClickOutside).toHaveBeenCalledTimes(1);
    });

    it('should work with detached containers', () => {
      const detachedContainer = document.createElement('div');
      const callback = vi.fn();

      const detachedCleanup = setupClickOutside(detachedContainer, callback);

      // Fast-forward timer
      vi.runAllTimers();

      // Click on document
      document.body.click();

      // Should be called (detached container doesn't contain document.body)
      expect(callback).toHaveBeenCalled();

      detachedCleanup();
    });
  });
});
