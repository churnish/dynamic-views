/**
 * Shared Card Renderer for Bases Views
 * Consolidates duplicate card rendering logic from Grid and Masonry views
 */

import {
  App,
  TFile,
  TFolder,
  setIcon,
  BasesEntry,
  Scope,
  Menu,
  Keymap,
} from "obsidian";
import { CardData } from "../shared/card-renderer";
import {
  setupImageLoadHandler,
  setupBackdropImageLoader,
  handleImageLoad,
  DEFAULT_ASPECT_RATIO,
} from "../shared/image-loader";
import {
  showFileContextMenu,
  showExternalLinkContextMenu,
} from "../shared/context-menu";
import {
  updateScrollGradient,
  setupScrollGradients,
  setupElementScrollGradient,
  setupVerticalScrollGradient,
} from "../shared/scroll-gradient";
import { getTimestampIcon } from "../shared/render-utils";
import {
  showTagHashPrefix,
  getHideEmptyMode,
  type HideEmptyMode,
  showTimestampIcon,
  getEmptyValueMarker,
  shouldHideMissingProperties,
  getListSeparator,
  isSlideshowEnabled,
  isSlideshowIndicatorEnabled,
  isThumbnailScrubbingDisabled,
  getSlideshowMaxImages,
  getUrlIcon,
  getCompactBreakpoint,
} from "../utils/style-settings";
import { getPropertyLabel, stripNotePrefix } from "../utils/property";
import { findLinksInText, type ParsedLink } from "../utils/link-parser";
import {
  handleImageViewerClick,
  cleanupAllViewers,
} from "../shared/image-viewer";
import { getFileExtInfo, getFileTypeIcon } from "../utils/file-extension";
import type DynamicViews from "../../main";
import type { BasesResolvedSettings } from "../types";
import {
  createSlideshowNavigator,
  setupHoverZoomEligibility,
  setupImagePreload,
  setupSwipeGestures,
} from "../shared/slideshow";
import {
  handleArrowNavigation,
  isArrowKey,
  isImageViewerBlockingNav,
} from "../shared/keyboard-nav";
import {
  CHECKBOX_MARKER_PREFIX,
  THUMBNAIL_STACK_MULTIPLIER,
} from "../shared/constants";
import {
  shouldUseNotebookNavigator,
  navigateToTagInNotebookNavigator,
  navigateToFolderInNotebookNavigator,
  revealFileInNotebookNavigator,
} from "../utils/notebook-navigator";
import { measurePropertyFields } from "../shared/property-measure";
import { CONTENT_HIDDEN_CLASS } from "../shared/content-visibility";
import {
  isTagProperty,
  isFileProperty,
  isFormulaProperty,
  shouldCollapseField,
} from "../shared/property-helpers";

/** Parse comma-separated property names into a Set for O(1) lookup */
function parsePropertyList(csv: string): Set<string> {
  if (!csv) return new Set();
  return new Set(
    csv
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s),
  );
}

/**
 * When pairProperties is OFF, compute which property indices should pair.
 * Single inverted props can trigger pairing (default: pair up).
 */
function computeInvertPairs(
  props: Array<{ name: string }>,
  unpairSet: Set<string>,
): Map<number, number> {
  const pairs = new Map<number, number>(); // leftIdx → rightIdx
  const claimed = new Set<number>();

  for (let i = 0; i < props.length; i++) {
    if (claimed.has(i)) continue;
    if (!unpairSet.has(props[i].name)) continue;

    let partnerIdx: number;
    if (i === 0) {
      // First prop → pair down
      partnerIdx = 1;
    } else if (i + 1 < props.length && unpairSet.has(props[i + 1].name)) {
      // Next prop also inverted → pair down with it
      partnerIdx = i + 1;
    } else {
      // Default → pair up
      partnerIdx = i - 1;
    }

    // Validate partner exists and not claimed
    if (
      partnerIdx >= 0 &&
      partnerIdx < props.length &&
      !claimed.has(partnerIdx)
    ) {
      // Normalize: lower index as key
      const leftIdx = Math.min(i, partnerIdx);
      const rightIdx = Math.max(i, partnerIdx);
      pairs.set(leftIdx, rightIdx);
      claimed.add(leftIdx);
      claimed.add(rightIdx);
    }
  }
  return pairs;
}

/**
 * Shared canvas for text measurement (avoids layout reads)
 */
let measureCanvas: HTMLCanvasElement | null = null;
let measureCtx: CanvasRenderingContext2D | null = null;

function getMeasureContext(): CanvasRenderingContext2D {
  if (!measureCanvas) {
    measureCanvas = document.createElement("canvas");
    measureCtx = measureCanvas.getContext("2d");
  }
  return measureCtx!;
}

/**
 * Truncate title text using canvas measureText (no layout reads).
 * Called with pre-read measurements to avoid layout thrashing.
 */
function truncateTitleWithCanvas(
  textEl: HTMLElement | Text,
  fullText: string,
  containerWidth: number,
  font: string,
  maxLines: number,
): void {
  if (!fullText || containerWidth <= 0 || maxLines <= 0) return;

  const ctx = getMeasureContext();
  ctx.font = font;

  const ellipsis = "…";
  const ellipsisWidth = ctx.measureText(ellipsis).width;
  // Total width available across all lines, minus ellipsis
  const availableWidth = containerWidth * maxLines - ellipsisWidth;

  // Measure full text width
  const fullWidth = ctx.measureText(fullText).width;
  if (fullWidth <= availableWidth) {
    // No truncation needed
    return;
  }

  // Binary search for truncation point using canvas (no layout reads)
  let low = 1;
  let high = fullText.length;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const testText = fullText.slice(0, mid);
    const testWidth = ctx.measureText(testText).width;

    if (testWidth <= availableWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  // Apply truncated text
  textEl.textContent = fullText.slice(0, low).trimEnd() + ellipsis;
}

const PAIRED_PROPERTY_CLASSES = [
  "dynamic-views-paired-property-left",
  "dynamic-views-paired-property-right",
  "dynamic-views-paired-property-column",
] as const;

/**
 * Apply per-view CSS classes and variables from settings to the view container
 * Replaces body-level Style Settings classes with view-scoped equivalents
 */
export function applyViewContainerStyles(
  container: HTMLElement,
  settings: BasesResolvedSettings,
): void {
  // Paired property layout
  container.classList.remove(...PAIRED_PROPERTY_CLASSES);
  switch (settings.rightPropertyPosition) {
    case "left":
      container.classList.add("dynamic-views-paired-property-left");
      break;
    case "right":
      container.classList.add("dynamic-views-paired-property-right");
      break;
    case "column":
      container.classList.add("dynamic-views-paired-property-column");
      break;
  }

  // CSS variables
  container.style.setProperty(
    "--dynamic-views-thumbnail-size",
    `${settings.thumbnailSize}px`,
  );
  container.style.setProperty(
    "--dynamic-views-text-preview-lines",
    String(settings.textPreviewLines),
  );
  container.style.setProperty(
    "--dynamic-views-title-lines",
    String(settings.titleLines),
  );
}

/**
 * Batch-initialize title truncation for all cards in container.
 * Uses read-then-write pattern to avoid layout thrashing:
 * - Phase 1: Read all title dimensions (1 layout recalc)
 * - Phase 2: Calculate and apply truncations (no layout reads)
 *
 * Only runs when extension mode is ON (CSS can't preserve extension).
 */
/**
 * Core title truncation for a set of title elements.
 * Uses read-then-write pattern to avoid layout thrashing.
 */
function truncateTitleElements(titles: Iterable<HTMLElement>): void {
  // Phase 1: Read all dimensions (forces 1 layout recalc)
  const measurements: Array<{
    textEl: HTMLElement;
    fullText: string;
    width: number;
    font: string;
    maxLines: number;
  }> = [];

  for (const titleEl of titles) {
    // Skip titles in content-hidden cards (dimension reads trigger Chromium warnings)
    if (titleEl.closest(".card")?.classList.contains(CONTENT_HIDDEN_CLASS))
      continue;

    const textEl = titleEl.querySelector<HTMLElement>(".card-title-text");
    if (!textEl) continue;

    const fullText = (textEl.textContent || "").trim();
    if (!fullText) continue;

    const style = getComputedStyle(titleEl);
    const width = titleEl.offsetWidth;

    // Skip if not visible
    if (width <= 0) continue;

    measurements.push({
      textEl,
      fullText,
      width,
      font: style.font,
      maxLines:
        parseInt(style.getPropertyValue("--dynamic-views-title-lines")) || 2,
    });
  }

  // Phase 2: Calculate and apply truncations (no layout reads)
  for (const m of measurements) {
    truncateTitleWithCanvas(m.textEl, m.fullText, m.width, m.font, m.maxLines);
  }
}

export function initializeTitleTruncation(container: HTMLElement): void {
  // Only run when extension mode is enabled
  if (!document.body.classList.contains("dynamic-views-file-type-ext")) {
    return;
  }

  // Skip if scroll mode is enabled (no truncation)
  if (document.body.classList.contains("dynamic-views-title-overflow-scroll")) {
    return;
  }

  const titles = container.querySelectorAll<HTMLElement>(".card-title");
  if (titles.length === 0) return;

  truncateTitleElements(titles);
}

/**
 * Card-scoped variant — truncates titles for specific cards only.
 * Use in appendBatch to avoid re-scanning old hidden cards in the container.
 */
export function initializeTitleTruncationForCards(cards: HTMLElement[]): void {
  if (cards.length === 0) return;

  // Only run when extension mode is enabled
  if (!document.body.classList.contains("dynamic-views-file-type-ext")) {
    return;
  }

  // Skip if scroll mode is enabled (no truncation)
  if (document.body.classList.contains("dynamic-views-title-overflow-scroll")) {
    return;
  }

  const titles: HTMLElement[] = [];
  for (const card of cards) {
    const title = card.querySelector<HTMLElement>(".card-title");
    if (title) titles.push(title);
  }

  if (titles.length === 0) return;
  truncateTitleElements(titles);
}

// Extend App type to include dragManager
declare module "obsidian" {
  interface App {
    dragManager: {
      dragFile(evt: DragEvent, file: TFile): unknown;
      onDragStart(evt: DragEvent, dragData: unknown): void;
    };
  }
}

/**
 * Batch-sync responsive classes (compact-mode, thumbnail-stack) for cards.
 * Uses read-then-write pattern to avoid layout thrashing:
 * - Phase 1: Read all card/thumbnail dimensions (1 layout recalc)
 * - Phase 2: Apply all class changes (no layout reads)
 *
 * @param cards - Array of card elements to sync
 * @returns true if any classes were changed (layout may need recalc)
 */
export function syncResponsiveClasses(cards: HTMLElement[]): boolean {
  const compactBreakpoint = getCompactBreakpoint();
  if (compactBreakpoint === 0 || cards.length === 0) return false;

  // Phase 1: Read all dimensions and current classes (forces 1 layout recalc)
  const measurements: Array<{
    card: HTMLElement;
    cardWidth: number;
    thumb: HTMLElement | null;
    thumbWidth: number;
    wasCompact: boolean;
    wasStacked: boolean;
  }> = [];

  for (const card of cards) {
    // Skip content-hidden cards (dimension reads trigger Chromium warnings)
    if (card.classList.contains(CONTENT_HIDDEN_CLASS)) continue;
    const cardWidth = card.offsetWidth;
    if (cardWidth <= 0) continue;

    const thumb = card.querySelector<HTMLElement>(
      ".card-thumbnail, .card-thumbnail-placeholder",
    );
    const thumbWidth = thumb?.offsetWidth ?? 0;
    const wasCompact = card.classList.contains("compact-mode");
    const wasStacked = card.classList.contains("thumbnail-stack");

    measurements.push({
      card,
      cardWidth,
      thumb,
      thumbWidth,
      wasCompact,
      wasStacked,
    });
  }

  // Phase 2: Apply all class changes (no layout reads)
  let anyChanged = false;
  for (const {
    card,
    cardWidth,
    thumb,
    thumbWidth,
    wasCompact,
    wasStacked,
  } of measurements) {
    const shouldBeCompact = cardWidth < compactBreakpoint;
    const shouldBeStacked =
      thumb !== null &&
      thumbWidth > 0 &&
      cardWidth < thumbWidth * THUMBNAIL_STACK_MULTIPLIER;

    if (shouldBeCompact !== wasCompact) {
      card.classList.toggle("compact-mode", shouldBeCompact);
      anyChanged = true;
    }
    if (thumb && shouldBeStacked !== wasStacked) {
      card.classList.toggle("thumbnail-stack", shouldBeStacked);
      anyChanged = true;
    }
  }

  return anyChanged;
}

export class SharedCardRenderer {
  private propertyObservers: ResizeObserver[] = [];
  private viewerCleanupFns: Map<HTMLElement, () => void> = new Map();
  private viewerClones: Map<HTMLElement, HTMLElement> = new Map();
  private slideshowCleanups: (() => void)[] = [];
  private cardScopes: Scope[] = [];
  private cardAbortControllers: AbortController[] = [];
  private activeScope: Scope | null = null;

  constructor(
    protected app: App,
    protected plugin: DynamicViews,
    protected updateLayoutRef: { current: ((source?: string) => void) | null },
  ) {}

  /**
   * Cleanup observers, scopes, event listeners, and zoom state when renderer is destroyed
   */
  public cleanup(forceViewerCleanup = false): void {
    this.propertyObservers.forEach((obs) => obs.disconnect());
    this.propertyObservers = [];

    // Cleanup slideshow event listeners
    this.slideshowCleanups.forEach((cleanup) => cleanup());
    this.slideshowCleanups = [];

    // Pop any active scope to prevent scope leak on unmount
    if (this.activeScope) {
      this.app.keymap.popScope(this.activeScope);
      this.activeScope = null;
    }

    // Clear scope references
    this.cardScopes = [];

    // Abort all card event listeners
    this.cardAbortControllers.forEach((controller) => controller.abort());
    this.cardAbortControllers = [];

    // Cleanup viewers only on view destruction (viewer persists across re-renders)
    if (forceViewerCleanup) {
      cleanupAllViewers(this.viewerCleanupFns, this.viewerClones);
    }
  }

  /**
   * Render text with link detection
   * Uses parseLink utility for comprehensive link detection
   */
  private renderTextWithLinks(
    container: HTMLElement,
    text: string,
    signal?: AbortSignal,
  ): void {
    const segments = findLinksInText(text);

    for (const segment of segments) {
      if (segment.type === "text") {
        // Wrap text in span to preserve whitespace in flex containers
        container.createSpan({ text: segment.content });
      } else {
        this.renderLink(container, segment.link, signal);
      }
    }
  }

  private renderLink(
    container: HTMLElement,
    link: ParsedLink,
    signal?: AbortSignal,
  ): void {
    // Internal link (wikilink or markdown internal)
    if (link.type === "internal") {
      if (link.isEmbed) {
        // Embedded internal link - render as embed container
        const embed = container.createSpan({ cls: "internal-embed" });
        embed.dataset.src = link.url;
        embed.setText(link.caption);
        embed.addEventListener(
          "click",
          (e) => {
            e.preventDefault();
            e.stopPropagation();
            const newLeaf = e.metaKey || e.ctrlKey;
            void this.app.workspace.openLinkText(link.url, "", newLeaf);
          },
          { signal },
        );
        return;
      }
      // Regular internal link
      const el = container.createEl("a", {
        cls: "internal-link",
        text: link.caption,
        href: link.url,
      });
      el.dataset.href = link.url;
      el.tabIndex = -1;
      el.draggable = true;
      el.addEventListener(
        "click",
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          const newLeaf = e.metaKey || e.ctrlKey;
          void this.app.workspace.openLinkText(link.url, "", newLeaf);
        },
        { signal },
      );
      el.addEventListener(
        "dragstart",
        (e) => {
          e.stopPropagation();
          const file = this.app.metadataCache.getFirstLinkpathDest(
            link.url,
            "",
          );
          if (!(file instanceof TFile)) return;
          const dragData = this.app.dragManager.dragFile(e, file);
          this.app.dragManager.onDragStart(e, dragData);
        },
        { signal },
      );
      el.addEventListener(
        "contextmenu",
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          const file = this.app.metadataCache.getFirstLinkpathDest(
            link.url,
            "",
          );
          if (!(file instanceof TFile)) return;
          showFileContextMenu(e, this.app, file, link.url);
        },
        { signal },
      );
      return;
    }

    // External link
    if (link.isEmbed) {
      // Embedded external link (image)
      const img = container.createEl("img", {
        cls: "external-embed",
        attr: { src: link.url, alt: link.caption },
      });
      img.addEventListener(
        "click",
        (e) => {
          e.stopPropagation();
        },
        { signal },
      );
      img.addEventListener(
        "error",
        () => {
          if (signal?.aborted) return; // Guard against race with cleanup
          img.addClass("dynamic-views-hidden");
        },
        { signal, once: true },
      );
      return;
    }
    // Regular external link
    // Only open in new tab for web URLs, not custom URIs like obsidian://
    const el = container.createEl("a", {
      cls: "external-link",
      text: link.caption,
      href: link.url,
    });
    el.tabIndex = -1;
    if (link.isWebUrl) {
      el.target = "_blank";
      el.rel = "noopener noreferrer";
    }
    el.addEventListener(
      "click",
      (e) => {
        e.stopPropagation();
      },
      { signal },
    );
    el.addEventListener(
      "dragstart",
      (e) => {
        e.stopPropagation();
        e.dataTransfer?.clearData();
        // Bare link (caption === url) → plain URL; captioned → markdown link
        const dragText =
          link.caption === link.url
            ? link.url
            : `[${link.caption}](${link.url})`;
        e.dataTransfer?.setData("text/plain", dragText);
      },
      { signal },
    );
    el.addEventListener(
      "contextmenu",
      (e) => {
        showExternalLinkContextMenu(e, link.url);
      },
      { signal },
    );
  }

  /**
   * Renders a complete card with all sub-components
   * @param container - Container to append card to
   * @param card - Card data
   * @param entry - Bases entry
   * @param settings - View settings
   * @param keyboardNav - Optional keyboard navigation config
   */
  renderCard(
    container: HTMLElement,
    card: CardData,
    entry: BasesEntry,
    settings: BasesResolvedSettings,
    keyboardNav?: {
      index: number;
      focusableCardIndex: number;
      containerRef: { current: HTMLElement | null };
      onFocusChange?: (index: number) => void;
      onHoverStart?: (el: HTMLElement) => void;
      onHoverEnd?: () => void;
    },
  ): HTMLElement {
    // Create card element
    const cardEl = container.createDiv("card");

    const format = settings.imageFormat;
    const position = settings.imagePosition;

    // Poster: force title-as-link and card context menu (click toggles reveal, not file open)
    const isPoster = format === "poster";

    // Check if any image source is configured (property or embeds)
    const hasImageSource =
      !!settings.imageProperty?.trim() || settings.fallbackToEmbeds !== "never";

    // Add format/position classes only when an image source is configured
    if (hasImageSource) {
      if (format === "cover") {
        cardEl.classList.add("image-format-cover");
      } else if (format === "thumbnail") {
        cardEl.classList.add("image-format-thumbnail");
      } else if (format === "poster") {
        cardEl.classList.add("image-format-poster");
      } else if (format === "backdrop") {
        cardEl.classList.add("image-format-backdrop");
      }

      if (format === "thumbnail") {
        cardEl.classList.add(`card-thumbnail-${position}`);
        cardEl.classList.add(`card-thumbnail-${settings.imageFit}`);
      } else if (format === "cover") {
        cardEl.classList.add(`card-cover-${position}`);
        cardEl.classList.add(`card-cover-${settings.imageFit}`);
      } else if (format === "poster") {
        cardEl.classList.add(`card-cover-${settings.imageFit}`);
      } else if (format === "backdrop") {
        cardEl.classList.add(`card-cover-${settings.imageFit}`);
      }
    }

    cardEl.setAttribute("data-path", card.path);

    // Only make card draggable when openFileAction is 'card'
    if (settings.openFileAction === "card") {
      cardEl.setAttribute("draggable", "true");
    }
    // Only show pointer cursor when entire card is clickable
    cardEl.classList.toggle(
      "clickable-card",
      settings.openFileAction === "card",
    );

    // Create AbortController for event listener cleanup
    const abortController = new AbortController();
    this.cardAbortControllers.push(abortController);
    const { signal } = abortController;

    // Keyboard navigation setup (roving tabindex pattern)
    if (keyboardNav) {
      cardEl.tabIndex =
        keyboardNav.index === keyboardNav.focusableCardIndex ? 0 : -1;

      // Create scope for Cmd/Ctrl+Enter and Cmd/Ctrl+Space handling
      // Pass app.scope as parent so unhandled keys bubble up to Obsidian
      const cardScope = new Scope(this.app.scope);
      cardScope.register(["Mod"], "Enter", () => {
        void this.app.workspace.openLinkText(card.path, "", "tab");
        return false;
      });
      cardScope.register(["Mod"], " ", () => {
        void this.app.workspace.openLinkText(card.path, "", "tab");
        return false;
      });
      this.cardScopes.push(cardScope);

      // Update focus state and push scope when card receives focus
      cardEl.addEventListener(
        "focus",
        () => {
          if (keyboardNav.onFocusChange) {
            keyboardNav.onFocusChange(keyboardNav.index);
          }
          // Pop previous scope if exists and different (handles rapid focus switching)
          if (this.activeScope && this.activeScope !== cardScope) {
            this.app.keymap.popScope(this.activeScope);
          }
          this.activeScope = cardScope;
          this.app.keymap.pushScope(cardScope);
        },
        { signal },
      );

      // Pop scope when card loses focus
      cardEl.addEventListener(
        "blur",
        () => {
          // Only pop if this card's scope is the active one
          if (this.activeScope === cardScope) {
            this.app.keymap.popScope(cardScope);
            this.activeScope = null;
          }
        },
        { signal },
      );

      // Handle keyboard events (Enter/Space, arrows, Tab, Escape)
      cardEl.addEventListener(
        "keydown",
        (e) => {
          if (e.key === "Enter" || e.key === " ") {
            // Open file (Mod+key handled by scope above)
            if (!e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              void this.app.workspace.openLinkText(card.path, "", false);
            }
          } else if (isArrowKey(e.key)) {
            if (isImageViewerBlockingNav(keyboardNav.containerRef.current))
              return;
            // Arrow key navigation
            e.preventDefault();
            const container = keyboardNav.containerRef.current as
              | (HTMLElement & {
                  _keyboardNavActive?: boolean;
                  _intentionalFocus?: boolean;
                })
              | null;
            if (container?.isConnected) {
              container._intentionalFocus = true;
              handleArrowNavigation(
                e,
                cardEl,
                container,
                (_targetCard, targetIndex) => {
                  container._keyboardNavActive = true;
                  if (keyboardNav.onFocusChange) {
                    keyboardNav.onFocusChange(targetIndex);
                  }
                },
              );
              // Clear immediately after navigation completes (synchronous)
              container._intentionalFocus = false;
            }
          } else if (e.key === "Escape") {
            // Exit keyboard nav mode and unfocus card
            const container = keyboardNav.containerRef.current as
              | (HTMLElement & { _keyboardNavActive?: boolean })
              | null;
            if (container?.isConnected) {
              container._keyboardNavActive = false;
            }
            cardEl.blur();
          }
        },
        { signal },
      );
    }

    // Exit keyboard nav mode on mouse click (focus via mouse, not keyboard)
    // Use capture phase so this fires before child element stopPropagation
    if (keyboardNav?.containerRef) {
      cardEl.addEventListener(
        "mousedown",
        () => {
          const container = keyboardNav.containerRef.current as
            | (HTMLElement & { _keyboardNavActive?: boolean })
            | null;
          if (container) {
            container._keyboardNavActive = false;
          }
        },
        { signal, capture: true },
      );
    }

    // Handle card click to open file
    cardEl.addEventListener(
      "click",
      (e) => {
        // Poster tap toggle: mobile only (desktop uses hover intent)
        if (
          format === "poster" &&
          this.app.isMobile &&
          cardEl.querySelector(".card-poster")
        ) {
          const target = e.target as HTMLElement;
          const isInteractive = target.closest(
            "a, button, input, select, textarea, .tag, .path-segment, .clickable-icon, .multi-select-pill, .checkbox-container",
          );

          if (!cardEl.classList.contains("poster-revealed")) {
            e.preventDefault();
            e.stopPropagation();
            // Dismiss any other revealed card in the same view
            cardEl
              .closest(".dynamic-views")
              ?.querySelector(".card.poster-revealed")
              ?.classList.remove("poster-revealed");
            cardEl.classList.add("poster-revealed");
            return;
          } else if (!isInteractive) {
            e.stopPropagation();
            cardEl.classList.remove("poster-revealed");
            return;
          }
        }

        // Card-level click-to-open: mobile except poster cards with images (poster with image uses tap-to-reveal)
        if (
          settings.openFileAction === "card" &&
          !(this.app.isMobile && isPoster && card.imageUrl)
        ) {
          const target = e.target as HTMLElement;
          // Don't open if clicking on links, tags, path segments, or images (when zoom enabled)
          const isLink = target.tagName === "A" || target.closest("a");
          const isTag =
            target.classList.contains("tag") || target.closest(".tag");
          const isPathSegment =
            target.classList.contains("path-segment") ||
            target.closest(".path-segment");
          const isImage = target.tagName === "IMG";
          const isZoomEnabled = !document.body.classList.contains(
            "dynamic-views-image-viewer-disabled",
          );

          if (
            !isLink &&
            !isTag &&
            !isPathSegment &&
            !(isImage && isZoomEnabled)
          ) {
            const paneType = Keymap.isModEvent(e);
            const file = this.app.vault.getAbstractFileByPath(card.path);
            if (file instanceof TFile) {
              void this.app.workspace.getLeaf(paneType || false).openFile(file);
            }
          }
        }
      },
      { signal },
    );

    // Track hovered card for hover-to-start keyboard navigation
    if (keyboardNav?.onHoverStart && keyboardNav?.onHoverEnd) {
      cardEl.addEventListener(
        "mouseenter",
        () => {
          keyboardNav.onHoverStart?.(cardEl);
        },
        { signal },
      );
      cardEl.addEventListener(
        "mouseleave",
        () => {
          keyboardNav.onHoverEnd?.();
        },
        { signal },
      );
    }

    // Poster hover intent: require mousemove before activating (ignores scroll-triggered hovers)
    // Gates content reveal (via CSS) and scroll access on desktop.
    if (isPoster && window.matchMedia("(hover: hover)").matches) {
      let hasMoved = false;

      cardEl.addEventListener(
        "mouseenter",
        () => {
          hasMoved = false;
        },
        { signal },
      );

      cardEl.addEventListener(
        "mousemove",
        () => {
          if (!hasMoved) {
            hasMoved = true;
            cardEl
              .closest(".dynamic-views")
              ?.querySelector(".card.poster-hover-active")
              ?.classList.remove("poster-hover-active");
            cardEl.classList.add("poster-hover-active");
          }
        },
        { signal },
      );

      cardEl.addEventListener(
        "mouseleave",
        () => {
          hasMoved = false;
          cardEl.classList.remove("poster-hover-active");
        },
        { signal },
      );
    }

    // Handle hover for page preview (only on card when openFileAction is 'card')
    // Use mouseenter (not mouseover) to prevent multiple triggers from child elements
    if (settings.openFileAction === "card") {
      cardEl.addEventListener(
        "mouseenter",
        (e) => {
          this.app.workspace.trigger("hover-link", {
            event: e,
            source: "bases",
            hoverParent: { hoverPopover: null },
            targetEl: cardEl,
            linktext: card.path,
          });
        },
        { signal },
      );
    }

    // Context menu handler for file
    const handleContextMenu = (e: MouseEvent) => {
      showFileContextMenu(e, this.app, entry.file, card.path);
    };

    // Attach context menu to card when openFileAction is 'card'
    if (settings.openFileAction === "card") {
      cardEl.addEventListener("contextmenu", handleContextMenu, { signal });
    }

    // Drag handler function
    const handleDrag = (e: DragEvent) => {
      const file = this.app.vault.getAbstractFileByPath(card.path);
      if (!(file instanceof TFile)) return;

      const dragData = this.app.dragManager.dragFile(e, file);
      this.app.dragManager.onDragStart(e, dragData);
    };

    // Helper to render title content into a container
    const renderTitleContent = (titleEl: HTMLElement) => {
      // Add file type icon first (hidden by default, shown via CSS when Icon mode selected)
      const icon = getFileTypeIcon(card.path);
      if (icon) {
        const iconEl = titleEl.createSpan({ cls: "card-title-icon" });
        setIcon(iconEl, icon);
      }

      // Add file format indicator before title text (for Flair mode float:left)
      const extInfo = getFileExtInfo(card.path, isFullname);
      const extNoDot = extInfo?.ext.slice(1) || "";
      if (extInfo) {
        titleEl.createSpan({
          cls: "card-title-ext",
          attr: { "data-ext": extNoDot },
        });
      }

      // Add title text
      if (
        settings.openFileAction === "title" ||
        (isPoster && this.app.isMobile && card.imageUrl)
      ) {
        // Render as clickable, draggable link
        const link = titleEl.createEl("a", {
          cls: "internal-link card-title-text",
          text: displayTitle,
          attr: {
            "data-href": card.path,
            href: card.path,
            draggable: "true",
            "data-ext": extNoDot,
            tabindex: "-1",
          },
        });

        link.addEventListener(
          "click",
          (e) => {
            e.preventDefault();
            e.stopPropagation();
            const paneType = Keymap.isModEvent(e);
            void this.app.workspace.openLinkText(
              card.path,
              "",
              paneType || false,
            );
          },
          { signal },
        );

        // Page preview on hover (mouseenter to prevent bubbling)
        link.addEventListener(
          "mouseenter",
          (e) => {
            this.app.workspace.trigger("hover-link", {
              event: e,
              source: "bases",
              hoverParent: { hoverPopover: null },
              targetEl: link,
              linktext: card.path,
              sourcePath: card.path,
            });
          },
          { signal },
        );

        // Open context menu on right-click
        link.addEventListener("contextmenu", handleContextMenu, { signal });

        // Make title draggable when openFileAction is 'title'
        link.addEventListener("dragstart", handleDrag, { signal });

        // Add extension suffix inside link for Extension mode
        if (
          extInfo &&
          document.body.classList.contains("dynamic-views-file-type-ext")
        ) {
          link.createSpan({
            cls: "card-title-ext-suffix",
            text: `.${extNoDot}`,
          });
        }
      } else {
        // Render as plain text in a span for truncation
        titleEl.createSpan({
          cls: "card-title-text",
          text: displayTitle,
          attr: { "data-ext": extNoDot },
        });

        // Add extension suffix for Extension mode
        if (
          extInfo &&
          document.body.classList.contains("dynamic-views-file-type-ext")
        ) {
          titleEl.createSpan({
            cls: "card-title-ext-suffix",
            text: `.${extNoDot}`,
          });
        }
      }

      // Setup scroll gradients for title if scroll mode is enabled
      if (
        document.body.classList.contains("dynamic-views-title-overflow-scroll")
      ) {
        setupElementScrollGradient(titleEl, signal);
      }
    };

    // Helper to render subtitle content into a container
    const renderSubtitleContent = (
      subtitleEl: HTMLElement,
      subtitleProperty: string,
    ) => {
      this.renderPropertyContent(
        subtitleEl,
        subtitleProperty,
        card.subtitle,
        card,
        entry,
        { ...settings, propertyLabels: "hide" },
        shouldHideMissingProperties(),
        getHideEmptyMode(),
        signal,
      );

      // Setup scroll gradients if scroll mode is enabled
      if (
        document.body.classList.contains(
          "dynamic-views-subtitle-overflow-scroll",
        )
      ) {
        setupElementScrollGradient(subtitleEl, signal);
      }

      // Setup scroll gradients for inner wrapper (works in wrap mode too)
      const subtitleWrapper = subtitleEl.querySelector(
        ".property-content-wrapper",
      ) as HTMLElement;
      if (subtitleWrapper) {
        setupElementScrollGradient(subtitleWrapper, signal);
      }
    };

    // Prepare image URLs if applicable
    const rawUrls = card.imageUrl
      ? Array.isArray(card.imageUrl)
        ? card.imageUrl
        : [card.imageUrl]
      : [];

    // Filter and deduplicate URLs
    const imageUrls = Array.from(
      new Set(
        rawUrls.filter(
          (url) => url && typeof url === "string" && url.trim().length > 0,
        ),
      ),
    );
    const hasImage = imageUrls.length > 0;

    // Check if title or subtitle will be rendered
    // In Extension mode, use basename when title property includes an extension
    // (the extension suffix is appended separately by renderTitleContent)
    const isExtMode = document.body.classList.contains(
      "dynamic-views-file-type-ext",
    );
    const titleProp = settings.titleProperty || "";
    const titleHasExtension =
      titleProp === "file.name" || titleProp === "file.fullname";
    const isFullname = titleProp === "file.fullname";
    const displayTitle =
      isExtMode && titleHasExtension ? entry.file.basename : card.title;
    const hasTitle = !!displayTitle;
    const hasSubtitle = settings.subtitleProperty && card.subtitle;

    // Covers: create wrapper BEFORE .card-content for top/left position
    if (
      format === "cover" &&
      (hasImage || hasImageSource) &&
      (position === "top" || position === "left")
    ) {
      this.renderCoverWrapper(
        cardEl,
        imageUrls,
        hasImage,
        position,
        settings,
        card,
        signal,
      );
    }

    // Universal content wrapper: header + body
    const cardContent = cardEl.createDiv("card-content");

    // Title, Subtitle, and URL button — always wrapped in card-header
    if (hasTitle || hasSubtitle || (card.hasValidUrl && card.urlValue)) {
      const headerEl = cardContent.createDiv("card-header");

      if (hasTitle || hasSubtitle) {
        const groupEl = headerEl.createDiv("card-title-block");

        if (hasTitle) {
          const titleEl = groupEl.createDiv("card-title");
          renderTitleContent(titleEl);
        }

        if (hasSubtitle) {
          const subtitleEl = groupEl.createDiv("card-subtitle");
          renderSubtitleContent(subtitleEl, settings.subtitleProperty);
        }
      }

      if (card.hasValidUrl && card.urlValue) {
        const iconEl = headerEl.createDiv(
          "card-title-url-icon text-icon-button svg-icon",
        );
        iconEl.setAttribute("aria-label", card.urlValue);
        setIcon(iconEl, getUrlIcon());

        iconEl.addEventListener(
          "click",
          (e) => {
            e.preventDefault();
            e.stopPropagation();
            window.open(card.urlValue!, "_blank", "noopener,noreferrer");
          },
          { signal },
        );
      }
    }

    // Make card draggable when settings.openFileAction is 'card'
    if (settings.openFileAction === "card") {
      cardEl.addEventListener("dragstart", handleDrag, { signal });
    }

    // POSTER: absolute-positioned image fills entire card, content hidden until hover
    if (format === "poster" && hasImage) {
      const bgWrapper = cardEl.createDiv("card-poster");
      const img = bgWrapper.createEl("img", {
        attr: { src: imageUrls[0], alt: "" },
      });
      setupBackdropImageLoader(
        img,
        cardEl,
        imageUrls,
        this.updateLayoutRef.current,
        signal,
      );
    }

    // BACKDROP: absolute-positioned image fills entire card
    if (format === "backdrop" && hasImage) {
      const bgWrapper = cardEl.createDiv("card-backdrop");
      const img = bgWrapper.createEl("img", {
        attr: { src: imageUrls[0], alt: "" },
      });
      setupBackdropImageLoader(
        img,
        cardEl,
        imageUrls,
        this.updateLayoutRef.current,
        signal,
      );
    }

    // Universal card-body: contains properties and previews
    const bodyEl = cardContent.createDiv("card-body");

    // Poster: vertical scroll gradient on card-body
    if (format === "poster") {
      setupVerticalScrollGradient(bodyEl, signal);
    }

    // Properties - 4-field rendering with 2-set layout (creates top/bottom containers)
    this.renderProperties(bodyEl, card, entry, settings, signal);

    // Determine if card-previews will have children
    const hasTextPreview = card.textPreview;
    const isThumbnailFormat = format === "thumbnail";
    // Only show thumbnail placeholder when an image source is configured
    const showThumbnail = isThumbnailFormat && (hasImage || hasImageSource);

    // Only create card-previews if it will have children
    let previewsEl: HTMLElement | null = null;
    if (hasTextPreview || showThumbnail) {
      // Insert before .card-properties-bottom if it exists (DOM order: top → previews → bottom)
      const bottomProps = bodyEl.querySelector(".card-properties-bottom");
      previewsEl = document.createElement("div");
      previewsEl.className = "card-previews";
      if (bottomProps) {
        bodyEl.insertBefore(previewsEl, bottomProps);
      } else {
        bodyEl.appendChild(previewsEl);
      }

      if (hasTextPreview) {
        const wrapper = previewsEl.createDiv("card-text-preview-wrapper");
        wrapper.createDiv({
          cls: "card-text-preview",
          text: card.textPreview,
        });
      }

      // Thumbnail (all positions now inside card-previews)
      if (showThumbnail) {
        if (hasImage) {
          const imageEl = previewsEl.createDiv("card-thumbnail");
          this.renderImage(
            imageEl,
            imageUrls,
            "thumbnail",
            position,
            settings,
            cardEl,
            signal,
          );
        } else {
          previewsEl.createDiv("card-thumbnail-placeholder");
        }
      }
    }

    // Covers: create wrapper AFTER .card-content for bottom/right position
    if (
      format === "cover" &&
      (hasImage || hasImageSource) &&
      (position === "bottom" || position === "right")
    ) {
      this.renderCoverWrapper(
        cardEl,
        imageUrls,
        hasImage,
        position,
        settings,
        card,
        signal,
      );
    }

    // Card-level responsive behaviors (single ResizeObserver)
    // Use cached breakpoint to avoid getComputedStyle per card
    const breakpoint = getCompactBreakpoint();

    // Check if thumbnail stacking is applicable (class toggle for all, DOM move only with text preview)
    const needsThumbnailStacking =
      format === "thumbnail" && (position === "left" || position === "right");

    const thumbnailEl = needsThumbnailStacking
      ? (bodyEl.querySelector(
          ".card-thumbnail, .card-thumbnail-placeholder",
        ) as HTMLElement)
      : null;

    // DOM movement only when text preview exists (otherwise card-previews would be left empty)
    const canMoveThumbnail = needsThumbnailStacking && card.textPreview;

    // Thumbnail starts inside previews; stacking moves it to a sibling of previews in card-body
    let isStacked = canMoveThumbnail && thumbnailEl?.parentElement === bodyEl;

    const cardObserver = new ResizeObserver((entries) => {
      // Guard against race with cleanup or element removal
      if (signal.aborted || !cardEl.isConnected) return;
      // Skip content-hidden cards (dimension reads trigger Chromium warnings)
      if (cardEl.classList.contains(CONTENT_HIDDEN_CLASS)) return;
      for (const entry of entries) {
        const cardWidth = entry.contentRect.width;

        // Skip if card hasn't been sized yet (masonry sets width)
        if (cardWidth <= 0) continue;

        // Compact mode
        if (breakpoint > 0) {
          cardEl.classList.toggle("compact-mode", cardWidth < breakpoint);
        }

        // Thumbnail stacking: class toggle + optional DOM move
        if (thumbnailEl && thumbnailEl.isConnected) {
          const thumbnailWidth = thumbnailEl.offsetWidth;
          const shouldStack =
            thumbnailWidth > 0 &&
            cardWidth < thumbnailWidth * THUMBNAIL_STACK_MULTIPLIER;

          if (canMoveThumbnail && previewsEl) {
            // Cards with text preview: move thumbnail between card-previews and card-body
            if (shouldStack && !isStacked) {
              if (cardEl.classList.contains("card-thumbnail-left")) {
                bodyEl.insertBefore(thumbnailEl, previewsEl);
              } else {
                previewsEl.after(thumbnailEl);
              }
              isStacked = true;
            } else if (!shouldStack && isStacked) {
              previewsEl.appendChild(thumbnailEl);
              isStacked = false;
            }
          }

          cardEl.classList.toggle("thumbnail-stack", shouldStack);
        }
      }
    });
    // Cleanup via this.propertyObservers.forEach(obs => obs.disconnect()) in cleanup()
    cardObserver.observe(cardEl);
    this.propertyObservers.push(cardObserver);

    return cardEl;
  }

  /**
   * Creates a cover wrapper element on the card with image/slideshow/placeholder.
   * Also sets up side cover dimension observers for left/right positions.
   */
  /** Creates cover wrapper. Only called when format === "cover". */
  private renderCoverWrapper(
    cardEl: HTMLElement,
    imageUrls: string[],
    hasImage: boolean,
    position: "left" | "right" | "top" | "bottom",
    settings: BasesResolvedSettings,
    card: CardData,
    signal: AbortSignal,
  ): void {
    const coverWrapper = cardEl.createDiv(
      hasImage
        ? "card-cover-wrapper"
        : "card-cover-wrapper card-cover-wrapper-placeholder",
    );

    if (hasImage) {
      const maxSlideshow = getSlideshowMaxImages();
      const slideshowUrls = imageUrls.slice(0, maxSlideshow);
      const shouldShowSlideshow =
        isSlideshowEnabled() &&
        (position === "top" || position === "bottom") &&
        slideshowUrls.length >= 2;

      if (shouldShowSlideshow) {
        const slideshowEl = coverWrapper.createDiv(
          "card-cover card-cover-slideshow",
        );
        this.renderSlideshow(
          slideshowEl,
          slideshowUrls,
          "cover",
          position,
          settings,
          card.path,
        );
      } else {
        const imageEl = coverWrapper.createDiv("card-cover");
        this.renderImage(
          imageEl,
          imageUrls,
          "cover",
          position,
          settings,
          cardEl,
          signal,
        );
      }
    } else {
      coverWrapper.createDiv("card-cover-placeholder");
    }

    // Set CSS custom properties for side cover dimensions
    if (position === "left" || position === "right") {
      const aspectRatio =
        typeof settings.imageRatio === "string"
          ? parseFloat(settings.imageRatio)
          : settings.imageRatio || 1.0;
      const wrapperRatio = aspectRatio / (aspectRatio + 1);

      cardEl.style.setProperty(
        "--dynamic-views-wrapper-ratio",
        wrapperRatio.toString(),
      );

      const updateWrapperDimensions = () => {
        const cardWidth = cardEl.offsetWidth;
        const targetWidth = Math.floor(wrapperRatio * cardWidth);
        const paddingValue = targetWidth;

        cardEl.style.setProperty(
          "--dynamic-views-side-cover-width",
          `${targetWidth}px`,
        );
        cardEl.style.setProperty(
          "--dynamic-views-side-cover-content-padding",
          `${paddingValue}px`,
        );

        return { cardWidth, targetWidth, paddingValue };
      };

      requestAnimationFrame(() => {
        updateWrapperDimensions();

        const resizeObserver = new ResizeObserver((entries) => {
          if (signal.aborted || !cardEl.isConnected) return;
          // Skip content-hidden cards (dimension reads trigger Chromium warnings)
          if (cardEl.classList.contains(CONTENT_HIDDEN_CLASS)) return;
          for (const entry of entries) {
            const target = entry.target as HTMLElement;
            const newCardWidth = target.offsetWidth;
            if (newCardWidth <= 0) continue;

            const newTargetWidth = Math.floor(wrapperRatio * newCardWidth);
            const newPaddingValue = newTargetWidth;

            cardEl.style.setProperty(
              "--dynamic-views-side-cover-width",
              `${newTargetWidth}px`,
            );
            cardEl.style.setProperty(
              "--dynamic-views-side-cover-content-padding",
              `${newPaddingValue}px`,
            );
          }
        });

        resizeObserver.observe(cardEl);
        this.propertyObservers.push(resizeObserver);
      });
    }
  }

  /**
   * Renders slideshow for covers with multiple images
   * Uses two-image swap with keyframe animations (0.4.0 carousel approach)
   */
  private renderSlideshow(
    slideshowEl: HTMLElement,
    imageUrls: string[],
    format: "thumbnail" | "cover",
    position: "left" | "right" | "top" | "bottom",
    settings: BasesResolvedSettings,
    cardPath: string,
  ): void {
    // Create AbortController for cleanup
    const controller = new AbortController();
    const { signal } = controller;
    this.slideshowCleanups.push(() => controller.abort());

    // Create image embed with two stacked images
    const imageEmbedContainer = slideshowEl.createDiv(
      "dynamic-views-image-embed",
    );

    // Add zoom handler
    const cardEl = slideshowEl.closest(".card") as HTMLElement;
    imageEmbedContainer.addEventListener(
      "click",
      (e) => {
        handleImageViewerClick(
          e,
          cardPath,
          this.app,
          this.viewerCleanupFns,
          this.viewerClones,
          settings.openFileAction,
        );
      },
      { signal },
    );

    // Create two persistent img elements (current and next)
    const currentImg = imageEmbedContainer.createEl("img", {
      cls: "slideshow-img slideshow-img-current",
      attr: { src: imageUrls[0], alt: "" },
    });

    // Next image starts with empty src
    imageEmbedContainer.createEl("img", {
      cls: "slideshow-img slideshow-img-next",
      attr: { src: "", alt: "" },
    });

    // Handle image load for masonry layout
    if (cardEl) {
      setupImageLoadHandler(
        currentImg,
        cardEl,
        this.updateLayoutRef.current || undefined,
      );

      // Setup image preloading
      setupImagePreload(cardEl, imageUrls, signal);
    }

    // Hover zoom eligibility: only first hovered slide gets zoom effect
    const clearHoverZoom = setupHoverZoomEligibility(
      slideshowEl,
      imageEmbedContainer,
      signal,
    );

    // Create navigator with shared logic
    const { navigate, reset } = createSlideshowNavigator(
      imageUrls,
      () => {
        const currImg = imageEmbedContainer.querySelector(
          ".slideshow-img-current",
        ) as HTMLImageElement;
        const nextImg = imageEmbedContainer.querySelector(
          ".slideshow-img-next",
        ) as HTMLImageElement;
        if (!currImg || !nextImg) return null;
        return { imageEmbed: imageEmbedContainer, currImg, nextImg };
      },
      signal,
      {
        onSlideChange: (_newIndex, nextImg) => {
          // Only set aspect ratio if not yet set by a successful image load
          // (first image may have failed and set default ratio)
          if (cardEl && !cardEl.dataset.aspectRatioSet) {
            handleImageLoad(
              nextImg,
              cardEl,
              this.updateLayoutRef.current || undefined,
            );
          }
        },
        onAnimationComplete: () => {
          clearHoverZoom();
          // No layout update needed - card dimensions are locked to first slide
        },
      },
    );

    // Reset to slide 1 when view becomes visible (reading/editing views are separate DOMs)
    const visibilityObserver = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          reset();
        }
      },
      { threshold: 0 },
    );
    visibilityObserver.observe(slideshowEl);
    signal.addEventListener("abort", () => visibilityObserver.disconnect(), {
      once: true,
    });

    // Auto-advance if first image fails to load (skip animation for instant display)
    const expectedFirstUrl = imageUrls[0];
    currentImg.addEventListener(
      "error",
      (e) => {
        if (signal.aborted || !cardEl.isConnected) return;
        // Only handle errors for the URL we set (ignore cleared src or changed URL)
        const targetSrc = (e.target as HTMLImageElement).src;
        if (targetSrc !== expectedFirstUrl) return;
        currentImg.addClass("dynamic-views-hidden");
        navigate(1, false, true);
      },
      { once: true, signal },
    );

    // Multi-image indicator
    if (isSlideshowIndicatorEnabled()) {
      const indicator = slideshowEl.createDiv("slideshow-indicator");
      setIcon(indicator, "lucide-circle-small");
    }

    // Navigation arrows
    const leftArrow = slideshowEl.createDiv("slideshow-nav-left");
    setIcon(leftArrow, "lucide-chevron-left");

    const rightArrow = slideshowEl.createDiv("slideshow-nav-right");
    setIcon(rightArrow, "lucide-chevron-right");

    leftArrow.addEventListener(
      "click",
      (e) => {
        e.stopPropagation();
        navigate(-1);
      },
      { signal },
    );

    rightArrow.addEventListener(
      "click",
      (e) => {
        e.stopPropagation();
        navigate(1);
      },
      { signal },
    );

    // Setup swipe gestures
    setupSwipeGestures(slideshowEl, navigate, signal);
  }

  /**
   * Renders image (cover or thumbnail) with all necessary handlers
   */
  private renderImage(
    imageEl: HTMLElement,
    imageUrls: string[],
    format: "thumbnail" | "cover",
    position: "left" | "right" | "top" | "bottom",
    settings: BasesResolvedSettings,
    cardEl: HTMLElement,
    signal?: AbortSignal,
  ): void {
    const imageEmbedContainer = imageEl.createDiv("dynamic-views-image-embed");

    // Add zoom handler with cleanup via AbortController
    imageEmbedContainer.addEventListener(
      "click",
      (e) => {
        handleImageViewerClick(
          e,
          cardEl.getAttribute("data-path") || "",
          this.app,
          this.viewerCleanupFns,
          this.viewerClones,
          settings.openFileAction,
        );
      },
      signal ? { signal } : undefined,
    );

    const imgEl = imageEmbedContainer.createEl("img", {
      attr: { src: imageUrls[0], alt: "" },
    });

    // Handle image load for masonry layout
    // Only pass layout callback for covers (thumbnails have fixed CSS height)
    if (cardEl) {
      setupImageLoadHandler(
        imgEl,
        cardEl,
        format === "cover"
          ? this.updateLayoutRef.current || undefined
          : undefined,
      );
    }

    // Fallback to next valid image if current fails (for multi-image cards)
    if (imageUrls.length > 1) {
      let currentUrlIndex = 0;
      const tryNextImage = () => {
        // Guard against race with cleanup (signal aborted during execution)
        if (signal?.aborted) return;
        currentUrlIndex++;
        // Try next URL (pre-validated, should not fail)
        if (currentUrlIndex < imageUrls.length) {
          if (signal?.aborted || !imgEl.isConnected) return; // Guard before DOM mutation
          imgEl.removeClass("dynamic-views-hidden"); // Unhide
          imgEl.src = imageUrls[currentUrlIndex];
          return;
        }
        // All images failed - use double rAF for cover-ready (consistent with backdrop)
        if (signal?.aborted) return;
        requestAnimationFrame(() => {
          if (signal?.aborted || !cardEl.isConnected) return;
          requestAnimationFrame(() => {
            if (signal?.aborted || !cardEl.isConnected) return;
            imgEl.addClass("dynamic-views-hidden");
            if (!cardEl.classList.contains("cover-ready")) {
              cardEl.classList.add("cover-ready");
              cardEl.style.setProperty(
                "--actual-aspect-ratio",
                DEFAULT_ASPECT_RATIO.toString(),
              );
              // Trigger layout update for cover format
              if (format === "cover" && this.updateLayoutRef.current) {
                this.updateLayoutRef.current();
              }
            }
          });
        });
      };
      imgEl.addEventListener(
        "error",
        tryNextImage,
        signal ? { signal } : undefined,
      );
    }

    // Thumbnail scrubbing (desktop only, max 10 images)
    if (
      format === "thumbnail" &&
      imageUrls.length > 1 &&
      !this.app.isMobile &&
      !isThumbnailScrubbingDisabled()
    ) {
      const scrubbableUrls = imageUrls.slice(0, 10);
      imageEl.classList.add("multi-image");

      // Preload on hover
      if (signal) {
        setupImagePreload(cardEl, scrubbableUrls, signal);
      }

      // Cache bounding rect on mouseenter to avoid layout thrashing on every mousemove
      // Closure and DOMRect freed when event listeners are removed via { signal }
      let cachedRect: DOMRect | null = null;
      imageEl.addEventListener(
        "mouseenter",
        () => {
          cachedRect = imageEl.getBoundingClientRect();
        },
        { signal },
      );

      imageEl.addEventListener(
        "mousemove",
        (e) => {
          if (signal?.aborted) return; // Guard against race with cleanup
          // Use cached rect, or cache on first mousemove if mouseenter didn't fire
          const rect = (cachedRect ??= imageEl.getBoundingClientRect());
          const x = e.clientX - rect.left;
          const index = Math.max(
            0,
            Math.min(
              Math.floor((x / rect.width) * scrubbableUrls.length),
              scrubbableUrls.length - 1,
            ),
          );
          const rawUrl = scrubbableUrls[index];
          imgEl.removeClass("dynamic-views-hidden");
          if (imgEl.src !== rawUrl) {
            imgEl.src = rawUrl;
          }
        },
        { signal },
      );

      imageEl.addEventListener(
        "mouseleave",
        () => {
          // Invalidate cached rect for next hover (handles resize)
          cachedRect = null;
          const firstUrl = scrubbableUrls[0];
          if (!firstUrl) return;
          // First image is pre-validated, always show it
          imgEl.removeClass("dynamic-views-hidden");
          imgEl.src = firstUrl;
        },
        { signal },
      );
    }
  }

  /**
   * Renders property fields for a card using dynamic property array
   */
  private renderProperties(
    cardEl: HTMLElement,
    card: CardData,
    entry: BasesEntry,
    settings: BasesResolvedSettings,
    signal: AbortSignal,
  ): void {
    const props = card.properties;
    if (!props || props.length === 0) return;

    // Parse override lists for O(1) lookup
    const unpairSet = parsePropertyList(settings.invertPropertyPairing);
    const invertPositionSet = parsePropertyList(
      settings.invertPropertyPosition,
    );

    // Pre-compute hide settings (needed before pairing to exclude collapsed)
    const hideMissing = shouldHideMissingProperties();
    const hideEmptyMode = getHideEmptyMode();

    // Pre-filter: exclude properties that will be collapsed, preserving original indices
    const visibleProps: Array<{
      name: string;
      value: unknown;
      fieldIndex: number;
    }> = [];
    for (let idx = 0; idx < props.length; idx++) {
      const prop = props[idx];
      // Empty-name properties are padding slots — exclude them
      if (!prop.name) continue;
      const stringValue = typeof prop.value === "string" ? prop.value : null;
      if (
        shouldCollapseField(
          stringValue,
          prop.name,
          hideMissing,
          hideEmptyMode,
          settings.propertyLabels,
        )
      ) {
        continue;
      }
      visibleProps.push({ ...prop, fieldIndex: idx + 1 }); // 1-based
    }

    // Group visible properties into sets using pairing algorithm
    const sets: Array<{
      items: Array<{ name: string; value: unknown; fieldIndex: number }>;
      paired: boolean;
    }> = [];

    // Pre-compute pairs when pairProperties OFF
    const invertPairs = settings.pairProperties
      ? null
      : computeInvertPairs(props, unpairSet);

    let i = 0;
    while (i < visibleProps.length) {
      const current = visibleProps[i];
      const next = i + 1 < visibleProps.length ? visibleProps[i + 1] : null;

      let shouldPair = false;
      if (settings.pairProperties) {
        // ON: pair unless either inverted
        shouldPair =
          next !== null &&
          !unpairSet.has(current.name) &&
          !unpairSet.has(next.name);
      } else if (invertPairs) {
        // OFF: check pre-computed pairs (uses original indices)
        shouldPair =
          next !== null &&
          invertPairs.get(current.fieldIndex - 1) === next.fieldIndex - 1;
      }

      if (shouldPair && next) {
        sets.push({
          items: [current, next],
          paired: true,
        });
        i += 2;
      } else {
        sets.push({
          items: [current],
          paired: false,
        });
        i += 1;
      }
    }

    // Position each set: top or bottom
    const topSets: typeof sets = [];
    const bottomSets: typeof sets = [];

    for (const set of sets) {
      const anyInverted = set.items.some((item) =>
        invertPositionSet.has(item.name),
      );
      const isTop = settings.showPropertiesAbove ? !anyInverted : anyInverted;
      (isTop ? topSets : bottomSets).push(set);
    }

    if (topSets.length === 0 && bottomSets.length === 0) return;

    // Create containers as needed
    const topPropertiesEl =
      topSets.length > 0
        ? cardEl.createDiv("card-properties card-properties-top")
        : null;
    const bottomPropertiesEl =
      bottomSets.length > 0
        ? cardEl.createDiv("card-properties card-properties-bottom")
        : null;

    // Helper to check if element has rendered content
    const hasRenderedContent = (el: HTMLElement): boolean =>
      el.children.length > 0 || (el.textContent?.trim().length ?? 0) > 0;

    // Helper to handle empty field (collapse or show marker)
    const handleEmptyField = (
      fieldEl: HTMLElement,
      propName: string,
      propValue: unknown,
    ): void => {
      if (propName) {
        const stringValue = typeof propValue === "string" ? propValue : null;
        if (
          shouldCollapseField(
            stringValue,
            propName,
            hideMissing,
            hideEmptyMode,
            settings.propertyLabels,
          )
        ) {
          fieldEl.addClass("property-collapsed");
        } else {
          const placeholderContent = fieldEl.createDiv("property-content");
          const markerSpan =
            placeholderContent.createSpan("empty-value-marker");
          markerSpan.textContent = getEmptyValueMarker();
        }
      } else if (settings.propertyLabels === "hide") {
        fieldEl.addClass("property-collapsed");
      }
    };

    // Render sets into their containers
    // Returns pair count for offset tracking across top/bottom
    const renderSetsInto = (
      container: HTMLElement,
      setsToRender: typeof sets,
      pairIndexOffset: number,
    ): number => {
      let pairNum = pairIndexOffset;

      for (const set of setsToRender) {
        if (set.paired) {
          // Paired: create wrapper
          pairNum++;
          const pairEl = container.createDiv(
            `property-pair property-pair-${pairNum}`,
          );

          const fieldEls: HTMLElement[] = [];
          const hasContent: boolean[] = [];

          for (let i = 0; i < set.items.length; i++) {
            const item = set.items[i];
            const posClass = i === 0 ? "pair-left" : "pair-right";
            const fieldEl = pairEl.createDiv(
              `property property-${item.fieldIndex} ${posClass}`,
            );
            fieldEls.push(fieldEl);

            if (item.name) {
              this.renderPropertyContent(
                fieldEl,
                item.name,
                item.value,
                card,
                entry,
                settings,
                hideMissing,
                hideEmptyMode,
                signal,
              );
            }
            hasContent.push(hasRenderedContent(fieldEl));
          }

          // Handle empty fields in pair
          if (!hasContent[0] && !hasContent[1]) {
            pairEl.remove();
          } else if (hasContent[0] && !hasContent[1]) {
            handleEmptyField(
              fieldEls[1],
              set.items[1].name,
              set.items[1].value,
            );
          } else if (!hasContent[0] && hasContent[1]) {
            handleEmptyField(
              fieldEls[0],
              set.items[0].name,
              set.items[0].value,
            );
          }
        } else {
          // Unpaired: direct child, no wrapper
          const item = set.items[0];
          const fieldEl = container.createDiv(
            `property property-${item.fieldIndex}`,
          );

          if (item.name) {
            this.renderPropertyContent(
              fieldEl,
              item.name,
              item.value,
              card,
              entry,
              settings,
              hideMissing,
              hideEmptyMode,
              signal,
            );
          }

          // Handle empty unpaired field
          if (!hasRenderedContent(fieldEl)) {
            fieldEl.remove();
          }
        }
      }

      return pairNum;
    };

    if (topPropertiesEl && topSets.length > 0) {
      const topPairCount = renderSetsInto(topPropertiesEl, topSets, 0);
      if (bottomPropertiesEl && bottomSets.length > 0) {
        renderSetsInto(bottomPropertiesEl, bottomSets, topPairCount);
      }
    } else if (bottomPropertiesEl && bottomSets.length > 0) {
      renderSetsInto(bottomPropertiesEl, bottomSets, 0);
    }

    // Remove empty property containers
    if (topPropertiesEl && topPropertiesEl.children.length === 0) {
      topPropertiesEl.remove();
    }
    if (bottomPropertiesEl && bottomPropertiesEl.children.length === 0) {
      bottomPropertiesEl.remove();
    }

    // If any properties remain, setup measurements and gradients
    if (
      (topPropertiesEl && topPropertiesEl.children.length > 0) ||
      (bottomPropertiesEl && bottomPropertiesEl.children.length > 0)
    ) {
      // Measure paired field widths
      this.measurePropertyFieldsForCard(cardEl);
      // Setup scroll gradients for tags and paths
      setupScrollGradients(cardEl, updateScrollGradient, signal);
    }
  }

  /**
   * Renders individual property content
   */
  private renderPropertyContent(
    container: HTMLElement,
    propertyName: string,
    resolvedValue: unknown,
    card: CardData,
    entry: BasesEntry,
    settings: BasesResolvedSettings,
    hideMissing: boolean,
    hideEmptyMode: HideEmptyMode,
    signal: AbortSignal,
  ): void {
    if (propertyName === "") {
      return;
    }

    // Coerce unknown to string for rendering (handles Bases Value objects)
    const stringValue =
      typeof resolvedValue === "string" ? resolvedValue : null;

    // Hide missing properties if toggle enabled (stringValue is null for missing properties)
    // File/formula/tag properties can never be "missing" - they always exist or are computed
    if (
      stringValue === null &&
      hideMissing &&
      !isFileProperty(propertyName) &&
      !isFormulaProperty(propertyName) &&
      !isTagProperty(propertyName)
    ) {
      return;
    }

    // Check if this is an empty property that should be hidden based on dropdown mode
    // Empty = no displayable value (null, undefined, or empty string)
    const isEmpty = !stringValue;
    if (isEmpty) {
      if (hideEmptyMode === "all") return;
      if (
        hideEmptyMode === "labels-hidden" &&
        settings.propertyLabels === "hide"
      )
        return;
    }

    // Render label if property labels are enabled
    if (settings.propertyLabels === "above") {
      const labelEl = container.createDiv("property-label");
      labelEl.textContent = getPropertyLabel(
        propertyName,
        settings._displayNameMap,
      );
    }

    // Add inline label if enabled (as sibling, before property-content)
    if (settings.propertyLabels === "inline") {
      const labelSpan = container.createSpan("property-label-inline");
      labelSpan.textContent =
        getPropertyLabel(propertyName, settings._displayNameMap) + " ";
    }

    // Wrapper for scrolling content (gradients applied here)
    // tabIndex -1 prevents scrollable div from being in Tab order
    const contentWrapper = container.createDiv("property-content-wrapper");
    contentWrapper.tabIndex = -1;

    // Content container (actual property value)
    const propertyContent = contentWrapper.createDiv("property-content");

    // If no value, show placeholder
    if (!stringValue) {
      const markerSpan = propertyContent.createSpan("empty-value-marker");
      markerSpan.textContent = getEmptyValueMarker();
      return;
    }

    // Handle array properties - render as individual spans with separators
    if (stringValue.startsWith('{"type":"array","items":[')) {
      try {
        const arrayData = JSON.parse(stringValue) as {
          type: string;
          items: string[];
        };
        if (arrayData.type === "array" && Array.isArray(arrayData.items)) {
          // Filter out empty strings to avoid rendering separators between invisible items
          const nonEmptyItems = arrayData.items.filter(
            (item) => item.trim().length > 0,
          );
          if (nonEmptyItems.length === 0) return;
          const listWrapper = propertyContent.createSpan("list-wrapper");
          const separator = getListSeparator();
          nonEmptyItems.forEach((item, idx) => {
            const span = listWrapper.createSpan();
            const listItem = span.createSpan({ cls: "list-item" });
            this.renderTextWithLinks(listItem, item, signal);
            if (idx < nonEmptyItems.length - 1) {
              span.createSpan({ cls: "list-separator", text: separator });
            }
          });
          return;
        }
      } catch {
        // Fall through to regular text rendering if JSON parse fails
      }
    }

    // Handle checkbox properties - render as native Obsidian checkbox
    if (stringValue.startsWith(CHECKBOX_MARKER_PREFIX)) {
      try {
        const checkboxData = JSON.parse(stringValue) as {
          type: string;
          checked?: boolean;
          indeterminate?: boolean;
        };
        if (checkboxData.type === "checkbox") {
          const checkboxEl = propertyContent.createEl("input", {
            cls: "metadata-input-checkbox",
            type: "checkbox",
          });
          if (checkboxData.indeterminate) {
            checkboxEl.indeterminate = true;
            checkboxEl.dataset.indeterminate = "true";
          } else {
            checkboxEl.checked = checkboxData.checked ?? false;
            checkboxEl.dataset.indeterminate = "false";
          }
          // Make interactive - toggle frontmatter on click
          checkboxEl.addEventListener(
            "click",
            (e) => {
              e.stopPropagation();
              const file = this.app.vault.getAbstractFileByPath(card.path);
              if (!(file instanceof TFile)) return;
              const fmProp = stripNotePrefix(propertyName);
              // Clear indeterminate state on click
              checkboxEl.indeterminate = false;
              checkboxEl.dataset.indeterminate = "false";
              void this.app.fileManager.processFrontMatter(
                file,
                (frontmatter: Record<string, unknown>) => {
                  frontmatter[fmProp] = checkboxEl.checked;
                },
              );
            },
            { signal },
          );
          return;
        }
      } catch {
        // Fall through to regular text rendering if JSON parse fails
      }
    }

    // Handle timestamp properties - only show icons for known timestamp properties
    const isKnownTimestampProperty =
      propertyName === "file.mtime" ||
      propertyName === "file.ctime" ||
      propertyName === "modified time" ||
      propertyName === "created time";

    if (isKnownTimestampProperty) {
      // stringValue is already formatted by data-transform
      const timestampWrapper = propertyContent.createSpan();
      if (showTimestampIcon() && settings.propertyLabels === "hide") {
        const iconName = getTimestampIcon(propertyName, settings);
        const iconEl = timestampWrapper.createSpan("timestamp-icon");
        setIcon(iconEl, iconName);
      }
      timestampWrapper.appendText(stringValue);
    } else if (
      (propertyName === "tags" || propertyName === "note.tags") &&
      card.yamlTags.length > 0
    ) {
      // YAML tags only
      const showHashPrefix = showTagHashPrefix();
      const tagsWrapper = propertyContent.createDiv("tags-wrapper");
      card.yamlTags.forEach((tag) => {
        const tagEl = tagsWrapper.createEl("a", {
          cls: "tag",
          text: showHashPrefix ? "#" + tag : tag,
          href: "#",
        });
        tagEl.tabIndex = -1;
        tagEl.addEventListener(
          "click",
          (e) => {
            e.preventDefault();
            if (
              shouldUseNotebookNavigator(this.app, "tag") &&
              navigateToTagInNotebookNavigator(this.app, tag)
            ) {
              return;
            }
            const searchPlugin =
              this.plugin.app.internalPlugins.plugins["global-search"];
            if (searchPlugin?.instance?.openGlobalSearch) {
              searchPlugin.instance.openGlobalSearch("tag:" + tag);
            }
          },
          { signal },
        );
      });
    } else if (
      (propertyName === "file.tags" || propertyName === "file tags") &&
      card.tags.length > 0
    ) {
      // tags in YAML + note body
      const showHashPrefix = showTagHashPrefix();
      const tagsWrapper = propertyContent.createDiv("tags-wrapper");
      card.tags.forEach((tag) => {
        const tagEl = tagsWrapper.createEl("a", {
          cls: "tag",
          text: showHashPrefix ? "#" + tag : tag,
          href: "#",
        });
        tagEl.tabIndex = -1;
        tagEl.addEventListener(
          "click",
          (e) => {
            e.preventDefault();
            if (
              shouldUseNotebookNavigator(this.app, "tag") &&
              navigateToTagInNotebookNavigator(this.app, tag)
            ) {
              return;
            }
            const searchPlugin =
              this.plugin.app.internalPlugins.plugins["global-search"];
            if (searchPlugin?.instance?.openGlobalSearch) {
              searchPlugin.instance.openGlobalSearch("tag:" + tag);
            }
          },
          { signal },
        );
      });
    } else if (
      (propertyName === "file.path" ||
        propertyName === "path" ||
        propertyName === "file path") &&
      card.path.length > 0
    ) {
      const pathWrapper = propertyContent.createDiv("path-wrapper");
      // Split full path including filename
      const segments = card.path.split("/").filter((f) => f);
      segments.forEach((segment, idx) => {
        const span = pathWrapper.createSpan();
        const isLastSegment = idx === segments.length - 1;
        const segmentClass = isLastSegment
          ? "path-segment filename-segment"
          : "path-segment folder-segment";
        const segmentEl = span.createSpan({ cls: segmentClass, text: segment });

        // Make clickable
        const cumulativePath = segments.slice(0, idx + 1).join("/");
        segmentEl.addEventListener(
          "click",
          (e) => {
            e.stopPropagation();
            if (isLastSegment) {
              // Filename segment - reveal file
              if (shouldUseNotebookNavigator(this.app, "file")) {
                const file = this.app.vault.getAbstractFileByPath(card.path);
                if (
                  file instanceof TFile &&
                  revealFileInNotebookNavigator(this.app, file)
                ) {
                  return;
                }
              }
            } else {
              // Folder segment - navigate to folder
              if (shouldUseNotebookNavigator(this.app, "folder")) {
                const folder =
                  this.app.vault.getAbstractFileByPath(cumulativePath);
                if (
                  folder instanceof TFolder &&
                  navigateToFolderInNotebookNavigator(this.app, folder)
                ) {
                  return;
                }
              }
            }
            // Fallback to file explorer
            const pathToReveal = isLastSegment ? card.path : cumulativePath;
            const fileExplorer =
              this.app.internalPlugins?.plugins?.["file-explorer"];
            if (fileExplorer?.instance?.revealInFolder) {
              const target = this.app.vault.getAbstractFileByPath(pathToReveal);
              if (target) {
                fileExplorer.instance.revealInFolder(target);
              }
            }
          },
          { signal },
        );

        // Add context menu for all segments
        segmentEl.addEventListener(
          "contextmenu",
          (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (isLastSegment) {
              // Filename segment - show file context menu
              const file = this.app.vault.getAbstractFileByPath(card.path);
              if (file instanceof TFile) {
                showFileContextMenu(e, this.app, file, card.path);
              }
            } else {
              // Folder segment - show folder context menu
              const folderFile =
                this.app.vault.getAbstractFileByPath(cumulativePath);
              if (folderFile instanceof TFolder) {
                const menu = new Menu();
                this.app.workspace.trigger(
                  "file-menu",
                  menu,
                  folderFile,
                  "file-explorer",
                );
                menu.showAtMouseEvent(e);
              }
            }
          },
          { signal },
        );

        if (idx < segments.length - 1) {
          span.createSpan({ cls: "path-separator", text: "/" });
        }
      });
    } else if (
      (propertyName === "file.folder" || propertyName === "folder") &&
      card.folderPath.length > 0
    ) {
      const folderWrapper = propertyContent.createDiv("path-wrapper");
      // Split folder path into segments
      const folders = card.folderPath.split("/").filter((f) => f);
      folders.forEach((folder, idx) => {
        const span = folderWrapper.createSpan();
        const segmentEl = span.createSpan({
          cls: "path-segment folder-segment",
          text: folder,
        });

        // Make clickable - reveal folder in file explorer
        const cumulativePath = folders.slice(0, idx + 1).join("/");
        segmentEl.addEventListener(
          "click",
          (e) => {
            e.stopPropagation();
            if (shouldUseNotebookNavigator(this.app, "folder")) {
              const folderObj =
                this.app.vault.getAbstractFileByPath(cumulativePath);
              if (
                folderObj instanceof TFolder &&
                navigateToFolderInNotebookNavigator(this.app, folderObj)
              ) {
                return;
              }
            }
            // Fallback to file explorer
            const fileExplorer =
              this.app.internalPlugins?.plugins?.["file-explorer"];
            if (fileExplorer?.instance?.revealInFolder) {
              const folderFile =
                this.app.vault.getAbstractFileByPath(cumulativePath);
              if (folderFile) {
                fileExplorer.instance.revealInFolder(folderFile);
              }
            }
          },
          { signal },
        );

        // Add context menu for folder segments
        segmentEl.addEventListener(
          "contextmenu",
          (e) => {
            e.stopPropagation();
            e.preventDefault();
            const folderFile =
              this.app.vault.getAbstractFileByPath(cumulativePath);
            if (folderFile instanceof TFolder) {
              const menu = new Menu();
              this.app.workspace.trigger(
                "file-menu",
                menu,
                folderFile,
                "file-explorer",
              );
              menu.showAtMouseEvent(e);
            }
          },
          { signal },
        );

        if (idx < folders.length - 1) {
          span.createSpan({ cls: "path-separator", text: "/" });
        }
      });
    } else {
      // Generic property - wrap in div for proper scrolling (consistent with tags/paths)
      const textWrapper = propertyContent.createDiv("text-wrapper");
      this.renderTextWithLinks(textWrapper, stringValue, signal);
    }

    // Remove propertyContent wrapper if it ended up empty (e.g., tags with no values)
    if (
      !propertyContent.textContent ||
      propertyContent.textContent.trim().length === 0
    ) {
      propertyContent.remove();
    }
  }

  /**
   * Measures property fields for side-by-side layout (delegates to shared utility)
   */
  private measurePropertyFieldsForCard(container: HTMLElement): void {
    const observers = measurePropertyFields(container);
    this.propertyObservers.push(...observers);
  }
}
