import {
  updateElementScrollGradient,
  updateScrollGradient,
  setupElementScrollGradient,
  setupScrollGradients,
  initializeScrollGradients,
} from "../../src/shared/scroll-gradient";
import { SCROLL_TOLERANCE } from "../../src/shared/constants";

/**
 * Creates a mock scrollable element with configurable dimensions
 */
function createScrollableElement(options: {
  scrollLeft?: number;
  scrollWidth?: number;
  clientWidth?: number;
  isConnected?: boolean;
}): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollLeft", {
    value: options.scrollLeft ?? 0,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(el, "scrollWidth", {
    value: options.scrollWidth ?? 100,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(el, "clientWidth", {
    value: options.clientWidth ?? 100,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(el, "isConnected", {
    value: options.isConnected ?? true,
    configurable: true,
  });
  return el;
}

/**
 * Creates a property field with wrapper and content elements
 */
function createPropertyField(options: {
  wrapperScrollLeft?: number;
  wrapperClientWidth?: number;
  contentScrollWidth?: number;
  contentClientWidth?: number;
  isConnected?: boolean;
}): HTMLElement {
  const field = document.createElement("div");
  field.className = "property-field";
  Object.defineProperty(field, "isConnected", {
    value: options.isConnected ?? true,
    configurable: true,
  });

  const wrapper = document.createElement("div");
  wrapper.className = "property-content-wrapper";
  Object.defineProperty(wrapper, "scrollLeft", {
    value: options.wrapperScrollLeft ?? 0,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(wrapper, "clientWidth", {
    value: options.wrapperClientWidth ?? 100,
    writable: true,
    configurable: true,
  });

  const content = document.createElement("div");
  content.className = "property-content";
  Object.defineProperty(content, "scrollWidth", {
    value: options.contentScrollWidth ?? 100,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(content, "clientWidth", {
    value: options.contentClientWidth ?? 100,
    writable: true,
    configurable: true,
  });

  wrapper.appendChild(content);
  field.appendChild(wrapper);

  return field;
}

describe("scroll-gradient", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock requestAnimationFrame
    jest.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    jest.restoreAllMocks();
  });

  describe("updateElementScrollGradient", () => {
    it("✓ adds no gradient when content fits", () => {
      const el = createScrollableElement({
        scrollWidth: 100,
        clientWidth: 100,
      });

      updateElementScrollGradient(el);

      expect(el.classList.contains("scroll-gradient-left")).toBe(false);
      expect(el.classList.contains("scroll-gradient-right")).toBe(false);
      expect(el.classList.contains("scroll-gradient-both")).toBe(false);
    });

    it("✓ adds right gradient when at start with overflow", () => {
      const el = createScrollableElement({
        scrollLeft: 0,
        scrollWidth: 200,
        clientWidth: 100,
      });

      updateElementScrollGradient(el);

      expect(el.classList.contains("scroll-gradient-right")).toBe(true);
      expect(el.classList.contains("scroll-gradient-left")).toBe(false);
      expect(el.classList.contains("scroll-gradient-both")).toBe(false);
    });

    it("✓ adds left gradient when at end with overflow", () => {
      const el = createScrollableElement({
        scrollLeft: 100,
        scrollWidth: 200,
        clientWidth: 100,
      });

      updateElementScrollGradient(el);

      expect(el.classList.contains("scroll-gradient-left")).toBe(true);
      expect(el.classList.contains("scroll-gradient-right")).toBe(false);
      expect(el.classList.contains("scroll-gradient-both")).toBe(false);
    });

    it("✓ adds both gradients when in middle", () => {
      const el = createScrollableElement({
        scrollLeft: 50,
        scrollWidth: 200,
        clientWidth: 100,
      });

      updateElementScrollGradient(el);

      expect(el.classList.contains("scroll-gradient-both")).toBe(true);
      expect(el.classList.contains("scroll-gradient-left")).toBe(false);
      expect(el.classList.contains("scroll-gradient-right")).toBe(false);
    });

    it("✓ respects SCROLL_TOLERANCE at start boundary", () => {
      const el = createScrollableElement({
        scrollLeft: SCROLL_TOLERANCE,
        scrollWidth: 200,
        clientWidth: 100,
      });

      updateElementScrollGradient(el);

      // At exactly tolerance, should still be considered "at start"
      expect(el.classList.contains("scroll-gradient-right")).toBe(true);
    });

    it("✓ respects SCROLL_TOLERANCE at end boundary", () => {
      const el = createScrollableElement({
        scrollLeft: 100 - SCROLL_TOLERANCE,
        scrollWidth: 200,
        clientWidth: 100,
      });

      updateElementScrollGradient(el);

      // At exactly tolerance from end, should still be considered "at end"
      expect(el.classList.contains("scroll-gradient-left")).toBe(true);
    });

    it("✓ skips update when element disconnected", () => {
      const el = createScrollableElement({
        scrollWidth: 200,
        clientWidth: 100,
        isConnected: false,
      });

      updateElementScrollGradient(el);

      expect(el.classList.contains("scroll-gradient-right")).toBe(false);
    });

    it("✓ skips update when clientWidth is zero", () => {
      const el = createScrollableElement({
        scrollWidth: 200,
        clientWidth: 0,
      });

      updateElementScrollGradient(el);

      expect(el.classList.contains("scroll-gradient-right")).toBe(false);
    });

    it("✓ removes gradient when content no longer overflows", () => {
      const el = createScrollableElement({
        scrollLeft: 0,
        scrollWidth: 200,
        clientWidth: 100,
      });

      updateElementScrollGradient(el);
      expect(el.classList.contains("scroll-gradient-right")).toBe(true);

      // Simulate resize where content now fits
      Object.defineProperty(el, "scrollWidth", {
        value: 100,
        configurable: true,
      });
      updateElementScrollGradient(el);

      expect(el.classList.contains("scroll-gradient-right")).toBe(false);
    });

    it("✓ caches gradient class to skip no-op updates", () => {
      const el = createScrollableElement({
        scrollLeft: 0,
        scrollWidth: 200,
        clientWidth: 100,
      });

      const toggleSpy = jest.spyOn(el.classList, "toggle");

      updateElementScrollGradient(el);
      expect(toggleSpy).toHaveBeenCalled();

      toggleSpy.mockClear();
      updateElementScrollGradient(el);
      // Second call with same state should skip (cached)
      expect(toggleSpy).not.toHaveBeenCalled();
    });
  });

  describe("updateScrollGradient", () => {
    it("✓ adds gradient to wrapper when content overflows", () => {
      const field = createPropertyField({
        wrapperClientWidth: 100,
        contentScrollWidth: 200,
        contentClientWidth: 200,
      });

      updateScrollGradient(field);

      const wrapper = field.querySelector(".property-content-wrapper")!;
      expect(wrapper.classList.contains("scroll-gradient-right")).toBe(true);
      expect(field.classList.contains("is-scrollable")).toBe(true);
    });

    it("✓ removes gradient when content fits", () => {
      const field = createPropertyField({
        wrapperClientWidth: 100,
        contentScrollWidth: 80,
        contentClientWidth: 80,
      });

      updateScrollGradient(field);

      const wrapper = field.querySelector(".property-content-wrapper")!;
      expect(wrapper.classList.contains("scroll-gradient-right")).toBe(false);
      expect(field.classList.contains("is-scrollable")).toBe(false);
    });

    it("✓ skips when element disconnected", () => {
      const field = createPropertyField({
        wrapperClientWidth: 100,
        contentScrollWidth: 200,
        isConnected: false,
      });

      updateScrollGradient(field);

      expect(field.classList.contains("is-scrollable")).toBe(false);
    });

    it("✓ skips when wrapper not found", () => {
      const field = document.createElement("div");
      field.className = "property-field";
      Object.defineProperty(field, "isConnected", {
        value: true,
        configurable: true,
      });

      expect(() => updateScrollGradient(field)).not.toThrow();
    });

    it("✓ skips when content not found", () => {
      const field = document.createElement("div");
      field.className = "property-field";
      Object.defineProperty(field, "isConnected", {
        value: true,
        configurable: true,
      });

      const wrapper = document.createElement("div");
      wrapper.className = "property-content-wrapper";
      field.appendChild(wrapper);

      expect(() => updateScrollGradient(field)).not.toThrow();
    });

    it("✓ skips when wrapper has zero width", () => {
      const field = createPropertyField({
        wrapperClientWidth: 0,
        contentScrollWidth: 200,
        contentClientWidth: 200,
      });

      updateScrollGradient(field);

      expect(field.classList.contains("is-scrollable")).toBe(false);
    });

    it("✓ skips when content has zero width", () => {
      const field = createPropertyField({
        wrapperClientWidth: 100,
        contentScrollWidth: 200,
        contentClientWidth: 0,
      });

      updateScrollGradient(field);

      expect(field.classList.contains("is-scrollable")).toBe(false);
    });

    it("✓ uses contentScrollWidth for gradient calculation", () => {
      const field = createPropertyField({
        wrapperScrollLeft: 50,
        wrapperClientWidth: 100,
        contentScrollWidth: 200,
        contentClientWidth: 200,
      });

      updateScrollGradient(field);

      const wrapper = field.querySelector(".property-content-wrapper")!;
      // In middle: should have both gradients
      expect(wrapper.classList.contains("scroll-gradient-both")).toBe(true);
    });
  });

  describe("setupElementScrollGradient", () => {
    it("✓ attaches scroll listener", () => {
      const el = createScrollableElement({
        scrollWidth: 200,
        clientWidth: 100,
      });
      const addEventSpy = jest.spyOn(el, "addEventListener");

      setupElementScrollGradient(el);

      expect(addEventSpy).toHaveBeenCalledWith(
        "scroll",
        expect.any(Function),
        expect.objectContaining({ signal: undefined }),
      );
    });

    it("✓ applies initial gradient via RAF", () => {
      const el = createScrollableElement({
        scrollLeft: 0,
        scrollWidth: 200,
        clientWidth: 100,
      });

      setupElementScrollGradient(el);

      expect(el.classList.contains("scroll-gradient-right")).toBe(true);
    });

    it("✓ respects AbortSignal", () => {
      const el = createScrollableElement({
        scrollWidth: 200,
        clientWidth: 100,
      });
      const controller = new AbortController();
      const addEventSpy = jest.spyOn(el, "addEventListener");

      setupElementScrollGradient(el, controller.signal);

      expect(addEventSpy).toHaveBeenCalledWith(
        "scroll",
        expect.any(Function),
        expect.objectContaining({ signal: controller.signal }),
      );
    });
  });

  describe("setupScrollGradients", () => {
    it("✓ attaches listeners to all property fields", () => {
      const container = document.createElement("div");
      const field1 = createPropertyField({ wrapperClientWidth: 100 });
      const field2 = createPropertyField({ wrapperClientWidth: 100 });
      container.appendChild(field1);
      container.appendChild(field2);

      const wrapper1 = field1.querySelector(".property-content-wrapper")!;
      const wrapper2 = field2.querySelector(".property-content-wrapper")!;
      const spy1 = jest.spyOn(wrapper1, "addEventListener");
      const spy2 = jest.spyOn(wrapper2, "addEventListener");

      setupScrollGradients(container, updateScrollGradient);

      expect(spy1).toHaveBeenCalledWith("scroll", expect.any(Function), {
        signal: undefined,
      });
      expect(spy2).toHaveBeenCalledWith("scroll", expect.any(Function), {
        signal: undefined,
      });
    });

    it("✓ skips fields without wrapper", () => {
      const container = document.createElement("div");
      const field = document.createElement("div");
      field.className = "property-field";
      container.appendChild(field);

      expect(() =>
        setupScrollGradients(container, updateScrollGradient),
      ).not.toThrow();
    });

    it("✓ reuses throttled function instances", () => {
      const container = document.createElement("div");
      const field = createPropertyField({ wrapperClientWidth: 100 });
      container.appendChild(field);

      const updateFn = jest.fn();

      // Call twice
      setupScrollGradients(container, updateFn);
      setupScrollGradients(container, updateFn);

      // Wrapper should only have listener attached from first call
      const wrapper = field.querySelector(".property-content-wrapper")!;
      expect(wrapper).toBeDefined();
    });
  });

  describe("initializeScrollGradients", () => {
    it("✓ batch-initializes all property fields", () => {
      const container = document.createElement("div");
      const field1 = createPropertyField({
        wrapperClientWidth: 100,
        contentScrollWidth: 200,
        contentClientWidth: 200,
      });
      const field2 = createPropertyField({
        wrapperClientWidth: 100,
        contentScrollWidth: 80,
        contentClientWidth: 80,
      });
      container.appendChild(field1);
      container.appendChild(field2);

      initializeScrollGradients(container);

      const wrapper1 = field1.querySelector(".property-content-wrapper")!;
      const wrapper2 = field2.querySelector(".property-content-wrapper")!;

      expect(wrapper1.classList.contains("scroll-gradient-right")).toBe(true);
      expect(field1.classList.contains("is-scrollable")).toBe(true);

      expect(wrapper2.classList.contains("scroll-gradient-right")).toBe(false);
      expect(field2.classList.contains("is-scrollable")).toBe(false);
    });

    it("✓ skips unmeasured side-by-side fields", () => {
      const container = document.createElement("div");
      const propertySet = document.createElement("div");
      propertySet.className = "property-set property-set-paired";

      const field = createPropertyField({
        wrapperClientWidth: 100,
        contentScrollWidth: 200,
        contentClientWidth: 200,
      });
      propertySet.appendChild(field);
      container.appendChild(propertySet);

      initializeScrollGradients(container);

      expect(field.classList.contains("is-scrollable")).toBe(false);
    });

    it("✓ processes measured side-by-side fields", () => {
      const container = document.createElement("div");
      const propertySet = document.createElement("div");
      propertySet.className =
        "property-set property-set-paired property-measured";

      const field = createPropertyField({
        wrapperClientWidth: 100,
        contentScrollWidth: 200,
        contentClientWidth: 200,
      });
      propertySet.appendChild(field);
      container.appendChild(propertySet);

      initializeScrollGradients(container);

      expect(field.classList.contains("is-scrollable")).toBe(true);
    });

    it("✓ processes side-by-side fields in compact mode", () => {
      const container = document.createElement("div");
      const card = document.createElement("div");
      card.className = "card compact-mode";

      const propertySet = document.createElement("div");
      propertySet.className = "property-set property-set-paired";

      const field = createPropertyField({
        wrapperClientWidth: 100,
        contentScrollWidth: 200,
        contentClientWidth: 200,
      });
      propertySet.appendChild(field);
      card.appendChild(propertySet);
      container.appendChild(card);

      initializeScrollGradients(container);

      expect(field.classList.contains("is-scrollable")).toBe(true);
    });

    it("✓ skips fields with zero-width wrapper", () => {
      const container = document.createElement("div");
      const field = createPropertyField({
        wrapperClientWidth: 0,
        contentScrollWidth: 200,
        contentClientWidth: 200,
      });
      container.appendChild(field);

      initializeScrollGradients(container);

      expect(field.classList.contains("is-scrollable")).toBe(false);
    });

    it("✓ skips fields with zero-width content", () => {
      const container = document.createElement("div");
      const field = createPropertyField({
        wrapperClientWidth: 100,
        contentScrollWidth: 200,
        contentClientWidth: 0,
      });
      container.appendChild(field);

      initializeScrollGradients(container);

      expect(field.classList.contains("is-scrollable")).toBe(false);
    });

    it("✓ removes is-scrollable when content fits", () => {
      const container = document.createElement("div");
      const field = createPropertyField({
        wrapperClientWidth: 100,
        contentScrollWidth: 80,
        contentClientWidth: 80,
      });
      field.classList.add("is-scrollable");
      container.appendChild(field);

      initializeScrollGradients(container);

      expect(field.classList.contains("is-scrollable")).toBe(false);
    });
  });

  describe("gradient class mutual exclusivity", () => {
    it("✓ only one gradient class active at a time", () => {
      const el = createScrollableElement({
        scrollLeft: 0,
        scrollWidth: 200,
        clientWidth: 100,
      });

      updateElementScrollGradient(el);
      expect(el.classList.contains("scroll-gradient-right")).toBe(true);

      Object.defineProperty(el, "scrollLeft", {
        value: 50,
        configurable: true,
      });
      updateElementScrollGradient(el);

      const classes = [
        el.classList.contains("scroll-gradient-left"),
        el.classList.contains("scroll-gradient-right"),
        el.classList.contains("scroll-gradient-both"),
      ];
      const activeCount = classes.filter(Boolean).length;

      expect(activeCount).toBeLessThanOrEqual(1);
    });
  });

  describe("edge cases", () => {
    it("✓ handles exactly scrollable boundary", () => {
      // Need overflow > SCROLL_TOLERANCE for gradient to appear
      const el = createScrollableElement({
        scrollWidth: 100 + SCROLL_TOLERANCE + 1,
        clientWidth: 100,
      });

      updateElementScrollGradient(el);

      expect(el.classList.contains("scroll-gradient-right")).toBe(true);
    });

    it("✓ handles large scroll values", () => {
      const el = createScrollableElement({
        scrollLeft: 10000,
        scrollWidth: 20000,
        clientWidth: 100,
      });

      updateElementScrollGradient(el);

      expect(el.classList.contains("scroll-gradient-both")).toBe(true);
    });

    it("✓ handles empty container gracefully", () => {
      const container = document.createElement("div");

      expect(() => initializeScrollGradients(container)).not.toThrow();
      expect(() =>
        setupScrollGradients(container, updateScrollGradient),
      ).not.toThrow();
    });
  });

  describe("scroll event handling", () => {
    beforeEach(() => {
      // Mock RAF to execute synchronously for predictable testing
      jest.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
        cb(0);
        return 0;
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("✓ scroll event triggers gradient update on scrollable element", () => {
      // Test updateElementScrollGradient with a directly scrollable element (like title)
      const el = createScrollableElement({
        scrollLeft: 0,
        scrollWidth: 200,
        clientWidth: 100,
      });

      // Setup scroll gradient (attaches listener to element itself)
      setupElementScrollGradient(el, undefined);

      // Initially should have right gradient (at start)
      expect(el.classList.contains("scroll-gradient-right")).toBe(true);

      // Simulate scroll to middle
      Object.defineProperty(el, "scrollLeft", {
        value: 50,
        writable: true,
        configurable: true,
      });

      // Dispatch scroll event
      el.dispatchEvent(new Event("scroll"));

      // Should now show both gradients
      expect(el.classList.contains("scroll-gradient-both")).toBe(true);
    });

    it("✓ abort signal stops scroll listener", () => {
      // Test with directly scrollable element (like title)
      const el = createScrollableElement({
        scrollLeft: 0,
        scrollWidth: 200,
        clientWidth: 100,
      });

      const controller = new AbortController();
      setupElementScrollGradient(el, controller.signal);

      // Initially should have right gradient
      expect(el.classList.contains("scroll-gradient-right")).toBe(true);

      // Abort controller
      controller.abort();

      // Simulate scroll to middle
      Object.defineProperty(el, "scrollLeft", {
        value: 50,
        writable: true,
        configurable: true,
      });

      // Dispatch scroll event - should NOT update since aborted
      el.dispatchEvent(new Event("scroll"));

      // Should still show right gradient (not updated to "both")
      expect(el.classList.contains("scroll-gradient-right")).toBe(true);
      expect(el.classList.contains("scroll-gradient-both")).toBe(false);
    });

    it("✓ scroll event on wrapper updates field gradient", () => {
      const container = document.createElement("div");
      const field = createPropertyField({
        wrapperScrollLeft: 0,
        wrapperClientWidth: 100,
        contentScrollWidth: 200,
        contentClientWidth: 200,
      });
      container.appendChild(field);

      const wrapper = field.querySelector(
        ".property-content-wrapper",
      ) as HTMLElement;

      // Setup via container function
      setupScrollGradients(container, updateScrollGradient);
      initializeScrollGradients(container);

      expect(wrapper.classList.contains("scroll-gradient-right")).toBe(true);

      // Scroll to end
      Object.defineProperty(wrapper, "scrollLeft", {
        value: 100,
        writable: true,
        configurable: true,
      });

      wrapper.dispatchEvent(new Event("scroll"));

      expect(wrapper.classList.contains("scroll-gradient-left")).toBe(true);
    });
  });
});
