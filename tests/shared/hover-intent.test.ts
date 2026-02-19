import { setupHoverIntent } from "../../src/shared/hover-intent";

/**
 * Dispatches a MouseEvent of the given type on the element.
 */
function fire(el: HTMLElement, type: string): void {
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
}

describe("setupHoverIntent", () => {
  let el: HTMLElement;
  let onActivate: jest.Mock;
  let onDeactivate: jest.Mock;
  let controller: AbortController;

  beforeEach(() => {
    el = document.createElement("div");
    onActivate = jest.fn();
    onDeactivate = jest.fn();
    controller = new AbortController();
  });

  it("✓ mousemove after mouseenter activates", () => {
    setupHoverIntent(el, onActivate, onDeactivate, controller.signal);

    fire(el, "mouseenter");
    fire(el, "mousemove");

    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("✓ mouseenter alone does NOT trigger onActivate", () => {
    setupHoverIntent(el, onActivate, onDeactivate, controller.signal);

    fire(el, "mouseenter");

    expect(onActivate).not.toHaveBeenCalled();
  });

  it("✓ mousemove without a preceding mouseenter triggers onActivate (first move)", () => {
    // No mouseenter fired — the element starts with hasMoved = false,
    // so the very first mousemove should activate.
    setupHoverIntent(el, onActivate, onDeactivate, controller.signal);

    fire(el, "mousemove");

    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("✓ multiple mousemove events only trigger onActivate once", () => {
    setupHoverIntent(el, onActivate, onDeactivate, controller.signal);

    fire(el, "mouseenter");
    fire(el, "mousemove");
    fire(el, "mousemove");
    fire(el, "mousemove");

    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("✓ mouseleave triggers onDeactivate and resets state so next enter+move re-activates", () => {
    setupHoverIntent(el, onActivate, onDeactivate, controller.signal);

    // First hover cycle
    fire(el, "mouseenter");
    fire(el, "mousemove");
    expect(onActivate).toHaveBeenCalledTimes(1);

    fire(el, "mouseleave");
    expect(onDeactivate).toHaveBeenCalledTimes(1);

    // Second hover cycle — state must have been reset by mouseleave
    fire(el, "mouseenter");
    fire(el, "mousemove");
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it("✓ aborting the signal removes all listeners and suppresses further callbacks", () => {
    setupHoverIntent(el, onActivate, onDeactivate, controller.signal);

    controller.abort();

    fire(el, "mouseenter");
    fire(el, "mousemove");
    fire(el, "mouseleave");

    expect(onActivate).not.toHaveBeenCalled();
    expect(onDeactivate).not.toHaveBeenCalled();
  });

  it("✓ omitting onDeactivate adds no mouseleave listener", () => {
    setupHoverIntent(el, onActivate, undefined, controller.signal);

    const addEventSpy = jest.spyOn(el, "addEventListener");

    // Re-setup to inspect what listeners are registered
    const innerController = new AbortController();
    setupHoverIntent(el, onActivate, undefined, innerController.signal);

    const registeredTypes = addEventSpy.mock.calls.map((call) => call[0]);
    expect(registeredTypes).not.toContain("mouseleave");

    // Firing mouseleave must not throw and must not invoke any callback
    expect(() => fire(el, "mouseleave")).not.toThrow();
  });

  it("✓ re-entry after leave activates twice total", () => {
    setupHoverIntent(el, onActivate, onDeactivate, controller.signal);

    // First full cycle
    fire(el, "mouseenter");
    fire(el, "mousemove");
    fire(el, "mouseleave");

    // Second full cycle
    fire(el, "mouseenter");
    fire(el, "mousemove");

    expect(onActivate).toHaveBeenCalledTimes(2);
    expect(onDeactivate).toHaveBeenCalledTimes(1);
  });
});
