import {
  measureScalableHeight,
  estimateUnmountedHeight,
} from "../../src/shared/virtual-scroll";

function createCard(classes: string[], wrapperHeight?: number): HTMLElement {
  const card = document.createElement("div");
  for (const cls of classes) {
    card.classList.add(cls);
  }
  if (wrapperHeight !== undefined) {
    const wrapper = document.createElement("div");
    wrapper.classList.add("card-cover-wrapper");
    Object.defineProperty(wrapper, "offsetHeight", {
      configurable: true,
      value: wrapperHeight,
    });
    card.appendChild(wrapper);
  }
  return card;
}

describe("measureScalableHeight", () => {
  afterEach(() => {
    document.body.className = "";
  });

  it("returns wrapper height for top cover", () => {
    const card = createCard(["card-cover-top"], 200);
    expect(measureScalableHeight(card)).toBe(200);
  });

  it("returns wrapper height for bottom cover", () => {
    const card = createCard(["card-cover-bottom"], 150);
    expect(measureScalableHeight(card)).toBe(150);
  });

  it("returns 0 for side cover (left)", () => {
    const card = createCard(["card-cover-left"], 200);
    expect(measureScalableHeight(card)).toBe(0);
  });

  it("returns 0 for side cover (right)", () => {
    const card = createCard(["card-cover-right"], 200);
    expect(measureScalableHeight(card)).toBe(0);
  });

  it("returns 0 for card with no cover class", () => {
    const card = createCard([], 200);
    expect(measureScalableHeight(card)).toBe(0);
  });

  it("returns 0 for top cover with fixed-cover-height mode", () => {
    document.body.classList.add("dynamic-views-masonry-fixed-cover-height");
    const card = createCard(["card-cover-top"], 200);
    expect(measureScalableHeight(card)).toBe(0);
  });

  it("returns 0 for top cover with no wrapper child", () => {
    const card = createCard(["card-cover-top"]);
    expect(measureScalableHeight(card)).toBe(0);
  });

  it("ignores non-direct-child wrapper", () => {
    const card = document.createElement("div");
    card.classList.add("card-cover-top");
    const nested = document.createElement("div");
    const wrapper = document.createElement("div");
    wrapper.classList.add("card-cover-wrapper");
    Object.defineProperty(wrapper, "offsetHeight", {
      configurable: true,
      value: 200,
    });
    nested.appendChild(wrapper);
    card.appendChild(nested);
    expect(measureScalableHeight(card)).toBe(0);
  });
});

describe("estimateUnmountedHeight", () => {
  it("scales cover height and adds fixed height", () => {
    const item = {
      scalableHeight: 200,
      fixedHeight: 100,
      measuredAtWidth: 300,
      height: 300,
    };
    // 200 * (150 / 300) + 100 = 100 + 100 = 200
    expect(estimateUnmountedHeight(item, 150)).toBe(200);
  });

  it("returns fixedHeight when scalableHeight is 0", () => {
    const item = {
      scalableHeight: 0,
      fixedHeight: 120,
      measuredAtWidth: 300,
      height: 120,
    };
    // 0 * ratio + 120 = 120
    expect(estimateUnmountedHeight(item, 450)).toBe(120);
  });

  it("falls back to item.height when measuredAtWidth is 0", () => {
    const item = {
      scalableHeight: 0,
      fixedHeight: 0,
      measuredAtWidth: 0,
      height: 250,
    };
    expect(estimateUnmountedHeight(item, 300)).toBe(250);
  });

  it("scales proportionally when width doubles", () => {
    const item = {
      scalableHeight: 100,
      fixedHeight: 50,
      measuredAtWidth: 200,
      height: 150,
    };
    // 100 * (400 / 200) + 50 = 200 + 50 = 250
    expect(estimateUnmountedHeight(item, 400)).toBe(250);
  });

  it("scales proportionally when width halves", () => {
    const item = {
      scalableHeight: 100,
      fixedHeight: 50,
      measuredAtWidth: 200,
      height: 150,
    };
    // 100 * (100 / 200) + 50 = 50 + 50 = 100
    expect(estimateUnmountedHeight(item, 100)).toBe(100);
  });

  it("returns exact measuredHeight at original width", () => {
    const item = {
      scalableHeight: 180,
      fixedHeight: 70,
      measuredAtWidth: 300,
      height: 250,
    };
    // 180 * (300 / 300) + 70 = 180 + 70 = 250 = measuredHeight
    expect(estimateUnmountedHeight(item, 300)).toBe(250);
  });
});
