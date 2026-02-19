import { updateTextPreviewDOM } from "../../src/shared/text-preview-dom";

// ---------------------------------------------------------------------------
// Helpers — build minimal card DOM fixtures
// ---------------------------------------------------------------------------

/** Minimal card element with a .card-body but no previews wrapper. */
function makeEmptyCard(): HTMLElement {
  const card = document.createElement("div");
  const body = document.createElement("div");
  body.className = "card-body";
  const bottomProps = document.createElement("div");
  bottomProps.className = "card-properties-bottom";
  body.appendChild(bottomProps);
  card.appendChild(body);
  return card;
}

/**
 * Card with an existing text preview already rendered.
 * Optionally also includes a thumbnail so we can test the thumbnail-sibling
 * branches.
 */
function makeCardWithText(text: string, withThumbnail = false): HTMLElement {
  const card = makeEmptyCard();
  const body = card.querySelector(".card-body") as HTMLElement;

  const previewsWrapper = document.createElement("div");
  previewsWrapper.className = "card-previews";

  const textWrapper = document.createElement("div");
  textWrapper.className = "card-text-preview-wrapper";
  const textEl = document.createElement("div");
  textEl.className = "card-text-preview";
  textEl.textContent = text;
  textWrapper.appendChild(textEl);
  previewsWrapper.appendChild(textWrapper);

  if (withThumbnail) {
    const thumb = document.createElement("div");
    thumb.className = "card-thumbnail";
    previewsWrapper.appendChild(thumb);
  }

  const bottomProps = body.querySelector(".card-properties-bottom");
  body.insertBefore(previewsWrapper, bottomProps);

  return card;
}

/** Card whose .card-previews wrapper contains only a thumbnail (no text yet). */
function makeCardWithThumbnailOnly(): HTMLElement {
  const card = makeEmptyCard();
  const body = card.querySelector(".card-body") as HTMLElement;

  const previewsWrapper = document.createElement("div");
  previewsWrapper.className = "card-previews";
  const thumb = document.createElement("div");
  thumb.className = "card-thumbnail";
  previewsWrapper.appendChild(thumb);

  const bottomProps = body.querySelector(".card-properties-bottom");
  body.insertBefore(previewsWrapper, bottomProps);

  return card;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("updateTextPreviewDOM", () => {
  // Case 1 ----------------------------------------------------------------
  it("updates textContent of existing .card-text-preview in place", () => {
    const card = makeCardWithText("old text");

    updateTextPreviewDOM(card, "new text");

    const textEl = card.querySelector(".card-text-preview");
    expect(textEl).not.toBeNull();
    expect(textEl!.textContent).toBe("new text");
    // Wrapper structure should be unchanged — no duplicate elements
    expect(card.querySelectorAll(".card-text-preview").length).toBe(1);
    expect(card.querySelectorAll(".card-previews").length).toBe(1);
  });

  // Case 2 ----------------------------------------------------------------
  it("prepends text wrapper before thumbnail when previews wrapper exists but has no text", () => {
    const card = makeCardWithThumbnailOnly();

    updateTextPreviewDOM(card, "hello");

    const previewsEl = card.querySelector(".card-previews")!;
    const textEl = card.querySelector(".card-text-preview");
    const thumb = card.querySelector(".card-thumbnail");

    expect(textEl).not.toBeNull();
    expect(textEl!.textContent).toBe("hello");
    // Text wrapper must come before the thumbnail inside .card-previews
    expect(
      previewsEl.firstElementChild!.classList.contains(
        "card-text-preview-wrapper",
      ),
    ).toBe(true);
    expect(
      previewsEl.lastElementChild!.classList.contains("card-thumbnail"),
    ).toBe(true);
    // Thumbnail must still be present
    expect(thumb).not.toBeNull();
  });

  // Case 3 ----------------------------------------------------------------
  it("creates full previews wrapper and inserts it before .card-properties-bottom", () => {
    const card = makeEmptyCard();

    updateTextPreviewDOM(card, "brand new");

    const previewsEl = card.querySelector(".card-previews");
    const textWrapper = card.querySelector(".card-text-preview-wrapper");
    const textEl = card.querySelector(".card-text-preview");
    const body = card.querySelector(".card-body")!;
    const bottomProps = card.querySelector(".card-properties-bottom")!;

    expect(previewsEl).not.toBeNull();
    expect(textWrapper).not.toBeNull();
    expect(textEl).not.toBeNull();
    expect(textEl!.textContent).toBe("brand new");
    // Previews wrapper must appear before .card-properties-bottom in the DOM
    const children = Array.from(body.children);
    expect(children.indexOf(previewsEl as Element)).toBeLessThan(
      children.indexOf(bottomProps),
    );
  });

  it("appends previews wrapper to .card-body when no .card-properties-bottom exists", () => {
    // Card without a .card-properties-bottom
    const card = document.createElement("div");
    const body = document.createElement("div");
    body.className = "card-body";
    card.appendChild(body);

    updateTextPreviewDOM(card, "appended");

    const previewsEl = card.querySelector(".card-previews");
    expect(previewsEl).not.toBeNull();
    expect(card.querySelector(".card-text-preview")!.textContent).toBe(
      "appended",
    );
    // Wrapper should be the last child of body
    expect(body.lastElementChild).toBe(previewsEl);
  });

  // Case 4 ----------------------------------------------------------------
  it("removes only the text wrapper when thumbnail is still present (text → empty)", () => {
    const card = makeCardWithText("some text", /* withThumbnail */ true);

    updateTextPreviewDOM(card, "");

    // Text elements must be gone
    expect(card.querySelector(".card-text-preview")).toBeNull();
    expect(card.querySelector(".card-text-preview-wrapper")).toBeNull();
    // Previews wrapper and thumbnail must survive
    expect(card.querySelector(".card-previews")).not.toBeNull();
    expect(card.querySelector(".card-thumbnail")).not.toBeNull();
  });

  // Case 5 ----------------------------------------------------------------
  it("removes entire previews wrapper when no thumbnail is present (text → empty)", () => {
    const card = makeCardWithText("going away");

    updateTextPreviewDOM(card, "");

    expect(card.querySelector(".card-previews")).toBeNull();
    expect(card.querySelector(".card-text-preview-wrapper")).toBeNull();
    expect(card.querySelector(".card-text-preview")).toBeNull();
  });

  // Case 6 ----------------------------------------------------------------
  it("is a no-op when text is empty and no previews wrapper exists", () => {
    const card = makeEmptyCard();
    const bodyBefore = card.innerHTML;

    updateTextPreviewDOM(card, "");

    // DOM should be completely unchanged
    expect(card.innerHTML).toBe(bodyBefore);
    expect(card.querySelector(".card-previews")).toBeNull();
  });
});
