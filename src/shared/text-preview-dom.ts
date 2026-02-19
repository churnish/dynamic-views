/**
 * Updates the text preview DOM inside a card element.
 *
 * The card DOM structure for previews is:
 *   .card-body
 *     .card-previews            (wrapper, may also hold .card-thumbnail)
 *       .card-text-preview-wrapper
 *         .card-text-preview    (text node lives here)
 *       .card-thumbnail         (optional, sibling of text wrapper)
 *     .card-properties-bottom   (text wrapper is inserted before this)
 *
 * Five cases are handled:
 *  1. Text + existing .card-text-preview  → update textContent in place
 *  2. Text + existing .card-previews (no text el yet, thumbnail present)
 *     → prepend a new text wrapper before the thumbnail
 *  3. Text + no .card-previews at all
 *     → create the full previews wrapper and insert it before
 *       .card-properties-bottom (or append to .card-body)
 *  4. Empty text + .card-previews with thumbnail → remove only the text wrapper
 *  5. Empty text + .card-previews with no thumbnail → remove the whole wrapper
 *
 * Uses plain DOM APIs (no Obsidian-specific createDiv) so it works in both
 * the Obsidian runtime and the jsdom test environment.
 */
export function updateTextPreviewDOM(
  cardEl: HTMLElement,
  newText: string,
): void {
  const previewsEl = cardEl.querySelector<HTMLElement>(".card-previews");
  const previewEl = cardEl.querySelector<HTMLElement>(".card-text-preview");

  if (newText) {
    if (previewEl) {
      // Case 1: update existing text node
      previewEl.textContent = newText;
    } else if (previewsEl) {
      // Case 2: wrapper exists (thumbnail present) — prepend text wrapper
      const textWrapper = document.createElement("div");
      textWrapper.className = "card-text-preview-wrapper";
      const textEl = document.createElement("div");
      textEl.className = "card-text-preview";
      textEl.textContent = newText;
      textWrapper.appendChild(textEl);
      previewsEl.insertBefore(textWrapper, previewsEl.firstChild);
    } else {
      // Case 3: no previews wrapper at all — build from scratch
      const bodyEl = cardEl.querySelector<HTMLElement>(".card-body");
      if (bodyEl) {
        const wrapper = document.createElement("div");
        wrapper.className = "card-previews";
        const textWrapper = document.createElement("div");
        textWrapper.className = "card-text-preview-wrapper";
        const textEl = document.createElement("div");
        textEl.className = "card-text-preview";
        textEl.textContent = newText;
        textWrapper.appendChild(textEl);
        wrapper.appendChild(textWrapper);
        const bottomProps = bodyEl.querySelector(".card-properties-bottom");
        if (bottomProps) {
          bodyEl.insertBefore(wrapper, bottomProps);
        } else {
          bodyEl.appendChild(wrapper);
        }
      }
    }
  } else if (previewsEl) {
    const hasThumbnail = previewsEl.querySelector(".card-thumbnail");
    if (hasThumbnail) {
      // Case 4: thumbnail must stay — remove only the text wrapper
      previewEl?.closest(".card-text-preview-wrapper")?.remove();
    } else {
      // Case 5: nothing else in the wrapper — remove it entirely
      previewsEl.remove();
    }
  }
  // Implicit case 6: empty text + no previewsEl → nothing to do
}
