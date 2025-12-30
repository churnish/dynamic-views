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
import { resolveBasesProperty } from "../shared/data-transform";
import {
  setupImageLoadHandler,
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
  isBackdropTintDisabled,
  isBackdropAdaptiveTextEnabled,
} from "../utils/style-settings";
import {
  extractDominantColor,
  calculateLuminanceFromTuple,
  LUMINANCE_LIGHT_THRESHOLD,
} from "../utils/ambient-color";
import { isExternalUrl } from "../utils/image";
import {
  getPropertyLabel,
  normalizePropertyName,
  stripNotePrefix,
} from "../utils/property";
import { findLinksInText, type ParsedLink } from "../utils/link-parser";
import {
  handleImageViewerClick,
  cleanupAllViewers,
} from "../shared/image-viewer";
import {
  getFileExtInfo,
  getFileTypeIcon,
  stripExtFromTitle,
} from "../utils/file-extension";
import type DynamicViewsPlugin from "../../main";
import type { Settings } from "../types";
import {
  createSlideshowNavigator,
  getCachedBlobUrl,
  isFailedExternalUrl,
  markExternalUrlAsFailed,
  setupImagePreload,
  setupSwipeGestures,
} from "../shared/slideshow";
import { handleArrowNavigation, isArrowKey } from "../shared/keyboard-nav";
import { CHECKBOX_MARKER_PREFIX } from "../shared/constants";
import {
  shouldUseNotebookNavigator,
  navigateToTagInNotebookNavigator,
  navigateToFolderInNotebookNavigator,
  revealFileInNotebookNavigator,
} from "../utils/notebook-navigator";
import { measurePropertyFields } from "../shared/property-measure";
import {
  isTagProperty,
  isFileProperty,
  isFormulaProperty,
  shouldCollapseField,
} from "../shared/property-helpers";

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

/**
 * Batch-initialize title truncation for all cards in container.
 * Uses read-then-write pattern to avoid layout thrashing:
 * - Phase 1: Read all title dimensions (1 layout recalc)
 * - Phase 2: Calculate and apply truncations (no layout reads)
 *
 * Only runs when extension mode is ON (CSS can't preserve extension).
 */
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

  // Phase 1: Read all dimensions (forces 1 layout recalc)
  const measurements: Array<{
    textEl: HTMLElement;
    fullText: string;
    width: number;
    font: string;
    maxLines: number;
  }> = [];

  for (const titleEl of titles) {
    const textEl = titleEl.querySelector<HTMLElement>(".card-title-text");
    if (!textEl) continue;

    const fullText = (textEl.textContent || "").trim();
    if (!fullText) continue;

    const style = getComputedStyle(titleEl);
    const width = titleEl.offsetWidth;

    // Skip if not visible
    if (width === 0) continue;

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

// Extend App type to include dragManager
declare module "obsidian" {
  interface App {
    dragManager: {
      dragFile(evt: DragEvent, file: TFile): unknown;
      onDragStart(evt: DragEvent, dragData: unknown): void;
    };
  }
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
    protected plugin: DynamicViewsPlugin,
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
          markExternalUrlAsFailed(img.src);
          img.style.display = "none";
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
    settings: Settings,
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

    // Parse imageFormat to extract format and position
    const imageFormat = settings.imageFormat;
    let format: "none" | "thumbnail" | "cover" | "background" = "none";
    let position: "left" | "right" | "top" | "bottom" = "right";

    if (imageFormat === "background") {
      format = "background";
    } else if (imageFormat.startsWith("thumbnail-")) {
      format = "thumbnail";
      position = imageFormat.split("-")[1] as "left" | "right";
    } else if (imageFormat.startsWith("cover-")) {
      format = "cover";
      position = imageFormat.split("-")[1] as
        | "left"
        | "right"
        | "top"
        | "bottom";
    }

    // Add format class
    if (format === "cover") {
      cardEl.classList.add("image-format-cover");
    } else if (format === "thumbnail") {
      cardEl.classList.add("image-format-thumbnail");
    } else if (format === "background") {
      cardEl.classList.add("image-format-backdrop");
    }

    // Add position class
    if (format === "thumbnail") {
      cardEl.classList.add(`card-thumbnail-${position}`);
      cardEl.classList.add(`card-thumbnail-${settings.imageFit}`);
    } else if (format === "cover") {
      cardEl.classList.add(`card-cover-${position}`);
      cardEl.classList.add(`card-cover-${settings.imageFit}`);
    }

    cardEl.setAttribute("data-path", card.path);

    // Edge case: if openFileAction is "title" but title is hidden, treat as "card"
    const effectiveOpenFileAction =
      settings.openFileAction === "title" && !settings.showTitle
        ? "card"
        : settings.openFileAction;

    // Only make card draggable when openFileAction is 'card'
    if (effectiveOpenFileAction === "card") {
      cardEl.setAttribute("draggable", "true");
    }
    // Only show pointer cursor when entire card is clickable
    cardEl.classList.toggle(
      "clickable-card",
      effectiveOpenFileAction === "card",
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
        // Only handle card-level clicks when openFileAction is 'card'
        // When openFileAction is 'title', the title link handles its own clicks
        if (effectiveOpenFileAction === "card") {
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

    // Handle hover for page preview (only on card when openFileAction is 'card')
    // Use mouseenter (not mouseover) to prevent multiple triggers from child elements
    if (effectiveOpenFileAction === "card") {
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

    // Attach context menu to card when effectiveOpenFileAction is 'card'
    if (effectiveOpenFileAction === "card") {
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
      // Only strip extension when titleProperty is file.fullname
      const normalized = normalizePropertyName(
        this.app,
        settings.titleProperty || "",
      );
      const isFullname = normalized === "file.fullname";
      const displayTitle = isFullname
        ? stripExtFromTitle(card.title, card.path, true)
        : card.title;

      // Add file type icon first (hidden by default, shown via CSS when Icon mode selected)
      const icon = getFileTypeIcon(card.path);
      if (icon) {
        const iconEl = titleEl.createSpan({ cls: "card-title-icon" });
        setIcon(iconEl, icon);
      }

      // Add file format indicator before title text (for Badge mode float:left)
      const extInfo = getFileExtInfo(card.path, isFullname);
      const extNoDot = extInfo?.ext.slice(1) || "";
      if (extInfo) {
        titleEl.createSpan({
          cls: "card-title-ext",
          attr: { "data-ext": extNoDot },
        });
      }

      // Add title text
      if (effectiveOpenFileAction === "title") {
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

    // Check if title or subtitle will be rendered
    const hasTitle = settings.showTitle;
    const hasSubtitle = settings.subtitleProperty && card.subtitle;

    // Title and Subtitle - wrapped in card-header when URL button present
    if (card.hasValidUrl && card.urlValue) {
      const headerEl = cardEl.createDiv("card-header");

      // Only create card-title-group if there's content
      if (hasTitle || hasSubtitle) {
        const groupEl = headerEl.createDiv("card-title-group");

        if (hasTitle) {
          const titleEl = groupEl.createDiv("card-title");
          renderTitleContent(titleEl);
        }

        if (hasSubtitle) {
          const subtitleEl = groupEl.createDiv("card-subtitle");
          renderSubtitleContent(subtitleEl, settings.subtitleProperty);
        }
      }

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
    } else if (hasTitle || hasSubtitle) {
      // No URL button - wrap title and subtitle in card-title-group (only if content exists)
      const groupEl = cardEl.createDiv("card-title-group");

      if (hasTitle) {
        const titleEl = groupEl.createDiv("card-title");
        renderTitleContent(titleEl);
      }

      if (hasSubtitle) {
        const subtitleEl = groupEl.createDiv("card-subtitle");
        renderSubtitleContent(subtitleEl, settings.subtitleProperty);
      }
    }

    // Make card draggable when effectiveOpenFileAction is 'card'
    if (effectiveOpenFileAction === "card") {
      cardEl.addEventListener("dragstart", handleDrag, { signal });
    }

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
    const hasImage = format !== "none" && imageUrls.length > 0;

    // ALL COVERS: wrapped in card-cover-wrapper for flexbox positioning
    if (format === "cover") {
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
            format,
            position,
            settings,
          );
        } else {
          const imageEl = coverWrapper.createDiv("card-cover");
          this.renderImage(
            imageEl,
            imageUrls,
            format,
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
      if (format === "cover" && (position === "left" || position === "right")) {
        // Get aspect ratio from settings
        const aspectRatio =
          typeof settings.imageAspectRatio === "string"
            ? parseFloat(settings.imageAspectRatio)
            : settings.imageAspectRatio || 1.0;
        const wrapperRatio = aspectRatio / (aspectRatio + 1);

        // Set wrapper ratio for potential CSS calc usage
        cardEl.style.setProperty(
          "--dynamic-views-wrapper-ratio",
          wrapperRatio.toString(),
        );

        // Function to calculate and set wrapper dimensions
        const updateWrapperDimensions = () => {
          const cardWidth = cardEl.offsetWidth; // Border box width (includes padding)
          const targetWidth = Math.floor(wrapperRatio * cardWidth);
          // Cover is positioned at padding edge (right: 0), so card padding provides the gap
          const paddingValue = targetWidth;

          // Set CSS custom properties on the card element
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

        // Initial calculation
        requestAnimationFrame(() => {
          updateWrapperDimensions();

          // Create ResizeObserver to update wrapper width when card resizes
          const resizeObserver = new ResizeObserver((entries) => {
            if (signal.aborted) return; // Guard against race with cleanup
            for (const entry of entries) {
              const target = entry.target as HTMLElement;
              const newCardWidth = target.offsetWidth;

              // Skip if card not yet rendered (width = 0)
              if (newCardWidth === 0) {
                continue;
              }

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

          // Observe the card element for size changes
          // Cleanup via this.propertyObservers.forEach(obs => obs.disconnect()) in cleanup()
          resizeObserver.observe(cardEl);
          this.propertyObservers.push(resizeObserver);
        });
      }
    }

    // BACKGROUND: absolute-positioned image fills entire card
    if (format === "background" && hasImage) {
      const bgWrapper = cardEl.createDiv("card-backdrop");
      const img = bgWrapper.createEl("img", {
        attr: { src: imageUrls[0], alt: "" },
      });
      img.addEventListener(
        "load",
        () => {
          // Guard against race with cleanup
          if (signal.aborted) return;
          // Extract luminance for adaptive text when tint is disabled
          if (isBackdropTintDisabled() && isBackdropAdaptiveTextEnabled()) {
            if (!isExternalUrl(img.src)) {
              const rgb = extractDominantColor(img);
              if (rgb) {
                const luminance = calculateLuminanceFromTuple(rgb);
                const theme =
                  luminance > LUMINANCE_LIGHT_THRESHOLD ? "light" : "dark";
                cardEl.setAttribute("data-backdrop-theme", theme);
              }
            } else {
              // Clear theme for uncached external images
              cardEl.removeAttribute("data-backdrop-theme");
            }
          }
          this.updateLayoutRef.current?.();
        },
        { signal },
      );
      // Fallback to next valid image if current fails (consistency with cover/thumbnail)
      if (imageUrls.length > 1) {
        let currentUrlIndex = 0;
        const tryNextBackdropImage = () => {
          // Guard against race with cleanup (signal aborted during execution)
          if (signal.aborted) return;
          // Mark current URL as failed
          if (img.src) {
            markExternalUrlAsFailed(img.src);
          }
          currentUrlIndex++;
          // Try next valid URL
          while (currentUrlIndex < imageUrls.length) {
            if (signal.aborted) return; // Check in loop for long image lists
            if (!isFailedExternalUrl(imageUrls[currentUrlIndex])) {
              img.style.display = "";
              const effectiveUrl = getCachedBlobUrl(imageUrls[currentUrlIndex]);
              img.src = effectiveUrl;
              return;
            }
            currentUrlIndex++;
          }
          // All images failed
          img.style.display = "none";
          cardEl.removeAttribute("data-backdrop-theme");
          this.updateLayoutRef.current?.();
        };
        img.addEventListener("error", tryNextBackdropImage, { signal });
      } else {
        img.addEventListener(
          "error",
          () => {
            if (signal.aborted) return;
            markExternalUrlAsFailed(img.src);
            img.style.display = "none";
            cardEl.removeAttribute("data-backdrop-theme");
            this.updateLayoutRef.current?.();
          },
          { signal },
        );
      }
    }

    // Determine if card-content will have children
    const hasTextPreview = settings.showTextPreview && card.textPreview;
    const isThumbnailFormat = format === "thumbnail";

    // Only create card-content if it will have children
    // Always create for thumbnail format to allow placeholder rendering
    if (hasTextPreview || isThumbnailFormat) {
      const contentContainer = cardEl.createDiv("card-content");

      if (hasTextPreview) {
        const wrapper = contentContainer.createDiv("card-text-preview-wrapper");
        wrapper.createDiv({
          cls: "card-text-preview",
          text: card.textPreview,
        });
      }

      // Thumbnail (all positions now inside card-content)
      if (isThumbnailFormat) {
        if (hasImage) {
          const imageEl = contentContainer.createDiv("card-thumbnail");
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
          contentContainer.createDiv("card-thumbnail-placeholder");
        }
      }
    }

    // Properties - 4-field rendering with 2-set layout
    this.renderProperties(cardEl, card, entry, settings, signal);

    // Card-level responsive behaviors (single ResizeObserver)
    // Use cached breakpoint to avoid getComputedStyle per card
    const breakpoint = getCompactBreakpoint();

    // Check if thumbnail stacking is applicable
    const needsThumbnailStacking =
      format === "thumbnail" &&
      (position === "left" || position === "right") &&
      settings.showTextPreview &&
      card.textPreview;

    const thumbnailEl = needsThumbnailStacking
      ? (cardEl.querySelector(".card-thumbnail") as HTMLElement)
      : null;
    const contentEl = needsThumbnailStacking
      ? (cardEl.querySelector(".card-content") as HTMLElement)
      : null;

    // Initialize isStacked based on actual DOM state
    // Thumbnail starts inside content, so isStacked = false means "inside content" (not stacked as sibling)
    // We need to track whether thumbnail is currently a direct child of card (stacked) or inside content
    let isStacked = thumbnailEl?.parentElement === cardEl;

    const cardObserver = new ResizeObserver((entries) => {
      if (signal.aborted) return; // Guard against race with cleanup
      for (const entry of entries) {
        const cardWidth = entry.contentRect.width;

        // Skip if card hasn't been sized yet (masonry sets width)
        if (cardWidth === 0) continue;

        // Compact mode
        if (breakpoint > 0) {
          cardEl.classList.toggle("compact-mode", cardWidth < breakpoint);
        }

        // Thumbnail stacking
        if (thumbnailEl && contentEl) {
          const thumbnailWidth = thumbnailEl.offsetWidth;
          const shouldStack = cardWidth < thumbnailWidth * 3;

          if (shouldStack && !isStacked) {
            // Left: thumbnail above content, Right: thumbnail below content
            if (cardEl.classList.contains("card-thumbnail-left")) {
              cardEl.insertBefore(thumbnailEl, contentEl);
            } else {
              contentEl.after(thumbnailEl);
            }
            cardEl.classList.add("thumbnail-stack");
            isStacked = true;
          } else if (!shouldStack && isStacked) {
            contentEl.appendChild(thumbnailEl);
            cardEl.classList.remove("thumbnail-stack");
            isStacked = false;
          }
        }
      }
    });
    // Cleanup via this.propertyObservers.forEach(obs => obs.disconnect()) in cleanup()
    cardObserver.observe(cardEl);
    this.propertyObservers.push(cardObserver);

    return cardEl;
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
    settings: Settings,
  ): void {
    // Create AbortController for cleanup
    const controller = new AbortController();
    const { signal } = controller;
    this.slideshowCleanups.push(() => controller.abort());

    // Compute effective open file action
    const effectiveOpenFileAction =
      settings.openFileAction === "title" && !settings.showTitle
        ? "card"
        : settings.openFileAction;

    // Create image embed with two stacked images
    const imageEmbedContainer = slideshowEl.createDiv(
      "dynamic-views-image-embed",
    );
    imageEmbedContainer.style.setProperty(
      "--cover-image-url",
      `url("${imageUrls[0]}")`,
    );

    // Add zoom handler
    const cardEl = slideshowEl.closest(".card") as HTMLElement;
    imageEmbedContainer.addEventListener(
      "click",
      (e) => {
        handleImageViewerClick(
          e,
          cardEl?.getAttribute("data-path") || "",
          this.app,
          this.viewerCleanupFns,
          this.viewerClones,
          effectiveOpenFileAction,
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

    // Handle image load for masonry layout and color extraction
    if (cardEl) {
      setupImageLoadHandler(
        currentImg,
        imageEmbedContainer,
        cardEl,
        this.updateLayoutRef.current || undefined,
      );

      // Setup image preloading
      setupImagePreload(cardEl, imageUrls, signal);
    }

    // Create navigator with shared logic
    const { navigate } = createSlideshowNavigator(
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
          if (cardEl) {
            handleImageLoad(
              nextImg,
              imageEmbedContainer,
              cardEl,
              this.updateLayoutRef.current || undefined,
            );
          }
        },
        onAnimationComplete: () => {
          if (this.updateLayoutRef.current) {
            this.updateLayoutRef.current("slideshow-animation-complete");
          }
        },
      },
    );

    // Auto-advance if first image fails to load (skip animation for instant display)
    const expectedFirstUrl = imageUrls[0];
    currentImg.addEventListener(
      "error",
      () => {
        // Ignore errors from src being cleared (resolves to index.html)
        if (
          !currentImg.src ||
          !currentImg.src.includes(expectedFirstUrl.split("?")[0].slice(-30))
        ) {
          return;
        }
        markExternalUrlAsFailed(currentImg.src);
        currentImg.style.display = "none";
        navigate(1, false, true);
      },
      { once: true, signal },
    );

    // Multi-image indicator
    if (isSlideshowIndicatorEnabled()) {
      const indicator = slideshowEl.createDiv("slideshow-indicator");
      setIcon(indicator, "lucide-images");
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
    settings: Settings,
    cardEl: HTMLElement,
    signal?: AbortSignal,
  ): void {
    // Compute effective open file action
    const effectiveOpenFileAction =
      settings.openFileAction === "title" && !settings.showTitle
        ? "card"
        : settings.openFileAction;

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
          effectiveOpenFileAction,
        );
      },
      signal ? { signal } : undefined,
    );

    const imgEl = imageEmbedContainer.createEl("img", {
      attr: { src: imageUrls[0], alt: "" },
    });
    // Set CSS variable for letterbox blur background
    imageEmbedContainer.style.setProperty(
      "--cover-image-url",
      `url("${imageUrls[0]}")`,
    );

    // Handle image load for masonry layout and color extraction
    // Only pass layout callback for covers (thumbnails have fixed CSS height)
    if (cardEl) {
      setupImageLoadHandler(
        imgEl,
        imageEmbedContainer,
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
        // Mark current URL as failed
        if (imgEl.src) {
          markExternalUrlAsFailed(imgEl.src);
        }
        currentUrlIndex++;
        while (currentUrlIndex < imageUrls.length) {
          if (signal?.aborted) return; // Check in loop for long image lists
          const nextUrl = imageUrls[currentUrlIndex];
          if (!isFailedExternalUrl(nextUrl)) {
            imgEl.style.display = ""; // Unhide
            const effectiveUrl = getCachedBlobUrl(nextUrl);
            imgEl.src = effectiveUrl;
            imageEmbedContainer.style.setProperty(
              "--cover-image-url",
              `url("${effectiveUrl}")`,
            );
            return;
          }
          currentUrlIndex++;
        }
        // All images failed - complete fallback handling
        imgEl.style.display = "none";
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
          // Skip failed external images
          if (isFailedExternalUrl(rawUrl)) return;
          const targetUrl = getCachedBlobUrl(rawUrl);
          if (imgEl.src !== targetUrl) {
            imgEl.src = targetUrl;
            imageEmbedContainer.style.setProperty(
              "--cover-image-url",
              `url("${targetUrl}")`,
            );
          }
        },
        { signal },
      );

      imageEl.addEventListener(
        "mouseleave",
        () => {
          // Invalidate cached rect for next hover (handles resize)
          cachedRect = null;
          // Find first valid URL
          const firstValidUrl = scrubbableUrls.find(
            (url) => !isFailedExternalUrl(url),
          );
          if (!firstValidUrl) return;
          const targetUrl = getCachedBlobUrl(firstValidUrl);
          imgEl.src = targetUrl;
          imageEmbedContainer.style.setProperty(
            "--cover-image-url",
            `url("${targetUrl}")`,
          );
        },
        { signal },
      );
    }
  }

  /**
   * Renders property fields for a card
   */
  private renderProperties(
    cardEl: HTMLElement,
    card: CardData,
    entry: BasesEntry,
    settings: Settings,
    signal: AbortSignal,
  ): void {
    // Get all 14 property names
    const props = [
      settings.propertyDisplay1,
      settings.propertyDisplay2,
      settings.propertyDisplay3,
      settings.propertyDisplay4,
      settings.propertyDisplay5,
      settings.propertyDisplay6,
      settings.propertyDisplay7,
      settings.propertyDisplay8,
      settings.propertyDisplay9,
      settings.propertyDisplay10,
      settings.propertyDisplay11,
      settings.propertyDisplay12,
      settings.propertyDisplay13,
      settings.propertyDisplay14,
    ];

    // Detect duplicates (priority: 1 > 2 > 3 > 4 > 5 > 6 > 7 > 8 > 9 > 10 > 11 > 12 > 13 > 14)
    const seen = new Set<string>();
    const effectiveProps = props.map((prop) => {
      if (!prop || prop === "") return "";
      if (seen.has(prop)) return ""; // Duplicate, skip
      seen.add(prop);
      return prop;
    });

    // Resolve property values
    const values = effectiveProps.map((prop) =>
      prop ? resolveBasesProperty(this.app, prop, entry, card, settings) : null,
    );

    // Pre-compute hide settings (avoid repeated classList checks)
    const hideMissing = shouldHideMissingProperties();
    const hideEmptyMode = getHideEmptyMode();

    // Check if any set has content
    // Show set if property is configured, UNLESS labels hidden AND hideMissingProperties enabled
    const showConfiguredProps =
      settings.propertyLabels !== "hide" || !hideMissing;
    const set1HasContent = showConfiguredProps
      ? effectiveProps[0] !== "" || effectiveProps[1] !== ""
      : values[0] !== null || values[1] !== null;
    const set2HasContent = showConfiguredProps
      ? effectiveProps[2] !== "" || effectiveProps[3] !== ""
      : values[2] !== null || values[3] !== null;
    const set3HasContent = showConfiguredProps
      ? effectiveProps[4] !== "" || effectiveProps[5] !== ""
      : values[4] !== null || values[5] !== null;
    const set4HasContent = showConfiguredProps
      ? effectiveProps[6] !== "" || effectiveProps[7] !== ""
      : values[6] !== null || values[7] !== null;
    const set5HasContent = showConfiguredProps
      ? effectiveProps[8] !== "" || effectiveProps[9] !== ""
      : values[8] !== null || values[9] !== null;
    const set6HasContent = showConfiguredProps
      ? effectiveProps[10] !== "" || effectiveProps[11] !== ""
      : values[10] !== null || values[11] !== null;
    const set7HasContent = showConfiguredProps
      ? effectiveProps[12] !== "" || effectiveProps[13] !== ""
      : values[12] !== null || values[13] !== null;

    if (
      !set1HasContent &&
      !set2HasContent &&
      !set3HasContent &&
      !set4HasContent &&
      !set5HasContent &&
      !set6HasContent &&
      !set7HasContent
    )
      return;

    // Determine which sets go to top vs bottom based on position settings
    const set1IsTop = set1HasContent && settings.propertySet1Position === "top";
    const set2IsTop = set2HasContent && settings.propertySet2Position === "top";
    const set3IsTop = set3HasContent && settings.propertySet3Position === "top";
    const set4IsTop = set4HasContent && settings.propertySet4Position === "top";
    const set5IsTop = set5HasContent && settings.propertySet5Position === "top";
    const set6IsTop = set6HasContent && settings.propertySet6Position === "top";
    const set7IsTop = set7HasContent && settings.propertySet7Position === "top";

    const hasTopSets =
      set1IsTop ||
      set2IsTop ||
      set3IsTop ||
      set4IsTop ||
      set5IsTop ||
      set6IsTop ||
      set7IsTop;
    const hasBottomSets =
      (set1HasContent && !set1IsTop) ||
      (set2HasContent && !set2IsTop) ||
      (set3HasContent && !set3IsTop) ||
      (set4HasContent && !set4IsTop) ||
      (set5HasContent && !set5IsTop) ||
      (set6HasContent && !set6IsTop) ||
      (set7HasContent && !set7IsTop);

    // Create containers as needed
    const topPropertiesEl = hasTopSets
      ? cardEl.createDiv("card-properties card-properties-top")
      : null;
    const bottomPropertiesEl = hasBottomSets
      ? cardEl.createDiv("card-properties card-properties-bottom")
      : null;

    // Helper to check if element has rendered content
    const hasRenderedContent = (el: HTMLElement): boolean =>
      el.children.length > 0 || (el.textContent?.trim().length ?? 0) > 0;

    // Helper to handle empty field (collapse or show marker)
    const handleEmptyField = (
      fieldEl: HTMLElement,
      fieldIdx: number,
      hasProp: boolean,
    ): void => {
      if (hasProp) {
        if (
          shouldCollapseField(
            values[fieldIdx],
            effectiveProps[fieldIdx],
            hideMissing,
            hideEmptyMode,
            settings.propertyLabels,
          )
        ) {
          fieldEl.addClass("property-field-collapsed");
        } else {
          const placeholderContent = fieldEl.createDiv("property-content");
          const markerSpan =
            placeholderContent.createSpan("empty-value-marker");
          markerSpan.textContent = getEmptyValueMarker();
        }
      } else if (settings.propertyLabels === "hide") {
        fieldEl.addClass("property-field-collapsed");
      }
    };

    // Set configuration: each set has two fields with 0-based indices
    const setConfigs = [
      {
        set: 1,
        hasContent: set1HasContent,
        isTop: set1IsTop,
        sideBySide: settings.propertySet1SideBySide,
        fieldIndices: [0, 1] as const,
      },
      {
        set: 2,
        hasContent: set2HasContent,
        isTop: set2IsTop,
        sideBySide: settings.propertySet2SideBySide,
        fieldIndices: [2, 3] as const,
      },
      {
        set: 3,
        hasContent: set3HasContent,
        isTop: set3IsTop,
        sideBySide: settings.propertySet3SideBySide,
        fieldIndices: [4, 5] as const,
      },
      {
        set: 4,
        hasContent: set4HasContent,
        isTop: set4IsTop,
        sideBySide: settings.propertySet4SideBySide,
        fieldIndices: [6, 7] as const,
      },
      {
        set: 5,
        hasContent: set5HasContent,
        isTop: set5IsTop,
        sideBySide: settings.propertySet5SideBySide,
        fieldIndices: [8, 9] as const,
      },
      {
        set: 6,
        hasContent: set6HasContent,
        isTop: set6IsTop,
        sideBySide: settings.propertySet6SideBySide,
        fieldIndices: [10, 11] as const,
      },
      {
        set: 7,
        hasContent: set7HasContent,
        isTop: set7IsTop,
        sideBySide: settings.propertySet7SideBySide,
        fieldIndices: [12, 13] as const,
      },
    ];

    // Render each set
    for (const {
      set,
      hasContent,
      isTop,
      sideBySide,
      fieldIndices,
    } of setConfigs) {
      if (!hasContent) continue;

      const [idx1, idx2] = fieldIndices;
      const fieldNum1 = idx1 + 1;
      const fieldNum2 = idx2 + 1;
      const container = isTop ? topPropertiesEl : bottomPropertiesEl;

      const setEl = container!.createDiv(`property-set property-set-${set}`);
      if (sideBySide) setEl.addClass("property-set-sidebyside");

      // Create and render field 1
      const field1El = setEl.createDiv(
        `property-field property-field-${fieldNum1}`,
      );
      if (effectiveProps[idx1]) {
        this.renderPropertyContent(
          field1El,
          effectiveProps[idx1],
          values[idx1],
          card,
          entry,
          settings,
          hideMissing,
          hideEmptyMode,
          signal,
        );
      }

      // Create and render field 2
      const field2El = setEl.createDiv(
        `property-field property-field-${fieldNum2}`,
      );
      if (effectiveProps[idx2]) {
        this.renderPropertyContent(
          field2El,
          effectiveProps[idx2],
          values[idx2],
          card,
          entry,
          settings,
          hideMissing,
          hideEmptyMode,
          signal,
        );
      }

      // Check actual rendered content
      const has1 = hasRenderedContent(field1El);
      const has2 = hasRenderedContent(field2El);
      const hasProp1 = effectiveProps[idx1] !== "";
      const hasProp2 = effectiveProps[idx2] !== "";

      // Handle set removal or empty field display
      if (!has1 && !has2) {
        setEl.remove();
      } else if (has1 && !has2) {
        handleEmptyField(field2El, idx2, hasProp2);
      } else if (!has1 && has2) {
        handleEmptyField(field1El, idx1, hasProp1);
      }
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
      // Measure side-by-side field widths
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
    settings: Settings,
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
    const isEmpty =
      stringValue === "" || (isTagProperty(propertyName) && !stringValue);
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
      labelEl.textContent = getPropertyLabel(propertyName);
    }

    // Add inline label if enabled (as sibling, before property-content)
    if (settings.propertyLabels === "inline") {
      const labelSpan = container.createSpan("property-label-inline");
      labelSpan.textContent = getPropertyLabel(propertyName) + " ";
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
          const listWrapper = propertyContent.createSpan("list-wrapper");
          const separator = getListSeparator();
          arrayData.items.forEach((item, idx) => {
            const span = listWrapper.createSpan();
            const listItem = span.createSpan({ cls: "list-item" });
            this.renderTextWithLinks(listItem, item, signal);
            if (idx < arrayData.items.length - 1) {
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
                (frontmatter) => {
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- processFrontMatter callback receives any
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
