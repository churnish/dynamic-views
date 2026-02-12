import { syncResponsiveClasses } from "../../src/bases/shared-renderer";

// Mock getCompactBreakpoint to return a fixed value (avoids CSS variable reads)
jest.mock("../../src/utils/style-settings", () => ({
  getCompactBreakpoint: () => 390,
}));

function createCard(opts: {
  width: number;
  thumbnailWidth?: number;
  placeholder?: boolean;
}): HTMLElement {
  const card = document.createElement("div");
  Object.defineProperty(card, "offsetWidth", {
    configurable: true,
    value: opts.width,
  });

  if (opts.thumbnailWidth !== undefined) {
    const thumb = document.createElement("div");
    thumb.classList.add(
      opts.placeholder ? "card-thumbnail-placeholder" : "card-thumbnail",
    );
    Object.defineProperty(thumb, "offsetWidth", {
      configurable: true,
      value: opts.thumbnailWidth,
    });
    card.appendChild(thumb);
  }

  return card;
}

describe("syncResponsiveClasses", () => {
  describe("compact-mode", () => {
    it("adds compact-mode below breakpoint", () => {
      const card = createCard({ width: 300 });
      syncResponsiveClasses([card]);
      expect(card.classList.contains("compact-mode")).toBe(true);
    });

    it("does not add compact-mode above breakpoint", () => {
      const card = createCard({ width: 400 });
      syncResponsiveClasses([card]);
      expect(card.classList.contains("compact-mode")).toBe(false);
    });
  });

  describe("thumbnail-stack", () => {
    // THUMBNAIL_STACK_MULTIPLIER = 3, so threshold = thumbnailWidth * 3

    it("adds thumbnail-stack when card narrower than 3× thumbnail", () => {
      const card = createCard({ width: 200, thumbnailWidth: 80 }); // 200 < 80*3=240
      syncResponsiveClasses([card]);
      expect(card.classList.contains("thumbnail-stack")).toBe(true);
    });

    it("does not add thumbnail-stack when card wider than 3× thumbnail", () => {
      const card = createCard({ width: 300, thumbnailWidth: 80 }); // 300 > 240
      syncResponsiveClasses([card]);
      expect(card.classList.contains("thumbnail-stack")).toBe(false);
    });

    it("applies thumbnail-stack regardless of text preview presence", () => {
      // Card with thumbnail only (no text preview child)
      const cardNoText = createCard({ width: 200, thumbnailWidth: 80 });
      syncResponsiveClasses([cardNoText]);
      expect(cardNoText.classList.contains("thumbnail-stack")).toBe(true);

      // Card with thumbnail and text preview
      const cardWithText = createCard({ width: 200, thumbnailWidth: 80 });
      const textPreview = document.createElement("div");
      textPreview.classList.add("card-text-preview-wrapper");
      cardWithText.appendChild(textPreview);
      syncResponsiveClasses([cardWithText]);
      expect(cardWithText.classList.contains("thumbnail-stack")).toBe(true);
    });

    it("applies thumbnail-stack to placeholder thumbnails", () => {
      const card = createCard({
        width: 200,
        thumbnailWidth: 80,
        placeholder: true,
      });
      syncResponsiveClasses([card]);
      expect(card.classList.contains("thumbnail-stack")).toBe(true);
    });

    it("does not add thumbnail-stack when no thumbnail element", () => {
      const card = createCard({ width: 200 }); // No thumbnail
      syncResponsiveClasses([card]);
      expect(card.classList.contains("thumbnail-stack")).toBe(false);
    });

    it("does not add thumbnail-stack when thumbnail has zero width", () => {
      const card = createCard({ width: 200, thumbnailWidth: 0 });
      syncResponsiveClasses([card]);
      expect(card.classList.contains("thumbnail-stack")).toBe(false);
    });

    it("removes thumbnail-stack when card widens", () => {
      const card = createCard({ width: 200, thumbnailWidth: 80 });
      syncResponsiveClasses([card]);
      expect(card.classList.contains("thumbnail-stack")).toBe(true);

      // Widen card
      Object.defineProperty(card, "offsetWidth", {
        configurable: true,
        value: 300,
      });
      syncResponsiveClasses([card]);
      expect(card.classList.contains("thumbnail-stack")).toBe(false);
    });
  });

  describe("return value", () => {
    it("returns true when classes changed", () => {
      const card = createCard({ width: 300 });
      expect(syncResponsiveClasses([card])).toBe(true);
    });

    it("returns false when no changes needed", () => {
      const card = createCard({ width: 300 });
      syncResponsiveClasses([card]); // First call applies compact-mode
      expect(syncResponsiveClasses([card])).toBe(false); // Second call: no change
    });

    it("returns false for empty array", () => {
      expect(syncResponsiveClasses([])).toBe(false);
    });
  });
});
