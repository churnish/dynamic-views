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
import { setupImageLoadHandler, handleImageLoad } from "../shared/image-loader";
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
} from "../utils/style-settings";
import { getPropertyLabel, normalizePropertyName } from "../utils/property";
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
  setupImagePreload,
  setupSwipeGestures,
} from "../shared/slideshow";
import { handleArrowNavigation, isArrowKey } from "../shared/keyboard-nav";
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
 * Truncate title text to fit within container with ellipsis.
 * Preserves extension visibility when present.
 *
 * Note: Unlike Datacore's setupTitleTruncation which uses ResizeObserver,
 * this runs once at render time. Bases cards have fixed layout after render.
 */
function truncateTitleWithExtension(
  titleEl: HTMLElement,
  textEl: HTMLElement | Text,
): void {
  // Skip truncation if container has no width (hidden tab, etc.)
  // Binary search would incorrectly truncate to 1 char
  if (titleEl.offsetWidth === 0) return;

  const containerStyle = getComputedStyle(titleEl);
  const lineHeight = parseFloat(containerStyle.lineHeight);
  const maxLines = parseInt(
    containerStyle.getPropertyValue("--dynamic-views-title-lines") || "2",
  );
  // Guard against invalid CSS config
  if (maxLines <= 0 || !isFinite(lineHeight)) return;
  // Add 1px tolerance for sub-pixel rounding differences
  const maxHeight = Math.ceil(lineHeight * maxLines) + 1;

  const fullText = (textEl.textContent || "").trim();
  if (!fullText) return;

  // Check if truncation needed
  if (titleEl.scrollHeight <= maxHeight) return;

  // Binary search for max text that fits
  let low = 1; // Minimum 1 character
  let high = fullText.length;
  const ellipsis = "…";

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    textEl.textContent = fullText.slice(0, mid).trimEnd() + ellipsis;

    if (titleEl.scrollHeight <= maxHeight) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  // Set final truncated text
  textEl.textContent = fullText.slice(0, low).trimEnd() + ellipsis;

  // Safety: keep reducing if still overflowing (ensures extension visible)
  // But never go below 1 character
  while (titleEl.scrollHeight > maxHeight && low > 1) {
    low--;
    textEl.textContent = fullText.slice(0, low).trimEnd() + ellipsis;
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
    protected updateLayoutRef: { current: (() => void) | null },
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
      return;
    }
    // Regular external link
    // Only open in new tab for web URLs, not custom URIs like obsidian://
    const el = container.createEl("a", {
      cls: "external-link",
      text: link.caption,
      href: link.url,
    });
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
  ): void {
    // Create card element
    const cardEl = container.createDiv("card");

    // Parse imageFormat to extract format and position
    const imageFormat = settings.imageFormat;
    let format: "none" | "thumbnail" | "cover" = "none";
    let position: "left" | "right" | "top" | "bottom" = "right";

    if (imageFormat.startsWith("thumbnail-")) {
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
            if (keyboardNav.containerRef.current) {
              handleArrowNavigation(
                e,
                cardEl,
                keyboardNav.containerRef.current,
                (_targetCard, targetIndex) => {
                  if (keyboardNav.onFocusChange) {
                    keyboardNav.onFocusChange(targetIndex);
                  }
                },
              );
            }
          } else if (e.key === "Tab") {
            // Prevent Tab from moving focus within card grid
            e.preventDefault();
          } else if (e.key === "Escape") {
            // Unfocus card on Escape
            cardEl.blur();
          }
        },
        { signal },
      );
    }

    // Handle card click to open file
    cardEl.addEventListener("click", (e) => {
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
    });

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
      cardEl.addEventListener("mouseenter", (e) => {
        this.app.workspace.trigger("hover-link", {
          event: e,
          source: "bases",
          hoverParent: { hoverPopover: null },
          targetEl: cardEl,
          linktext: card.path,
        });
      });
    }

    // Context menu handler for file
    const handleContextMenu = (e: MouseEvent) => {
      showFileContextMenu(e, this.app, entry.file, card.path);
    };

    // Attach context menu to card when effectiveOpenFileAction is 'card'
    if (effectiveOpenFileAction === "card") {
      cardEl.addEventListener("contextmenu", handleContextMenu);
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
      let textEl: HTMLElement | null = null;
      if (effectiveOpenFileAction === "title") {
        // Render as clickable, draggable link
        const link = titleEl.createEl("a", {
          cls: "internal-link",
          text: displayTitle,
          attr: {
            "data-href": card.path,
            href: card.path,
            draggable: "true",
            "data-ext": extNoDot,
            tabindex: "-1",
          },
        });
        textEl = link;

        link.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const paneType = Keymap.isModEvent(e);
          void this.app.workspace.openLinkText(
            card.path,
            "",
            paneType || false,
          );
        });

        // Page preview on hover (mouseenter to prevent bubbling)
        link.addEventListener("mouseenter", (e) => {
          this.app.workspace.trigger("hover-link", {
            event: e,
            source: "bases",
            hoverParent: { hoverPopover: null },
            targetEl: link,
            linktext: card.path,
            sourcePath: card.path,
          });
        });

        // Open context menu on right-click
        link.addEventListener("contextmenu", handleContextMenu);

        // Make title draggable when openFileAction is 'title'
        link.addEventListener("dragstart", handleDrag);
      } else {
        // Render as plain text in a span for truncation
        const textSpan = titleEl.createSpan({
          cls: "card-title-text",
          text: displayTitle,
          attr: { "data-ext": extNoDot },
        });
        textEl = textSpan;
      }

      // Truncate title with ellipsis (skip in scroll mode)
      if (
        textEl &&
        !document.body.classList.contains("dynamic-views-title-overflow-scroll")
      ) {
        // For masonry: wait until card is positioned (has width)
        // For grid: double RAF is sufficient
        const card = titleEl.closest(".card");
        const isMasonry = card?.closest(".dynamic-views-masonry");

        const doTruncate = () => {
          truncateTitleWithExtension(titleEl, textEl);
        };

        if (isMasonry) {
          // Poll until masonry layout applies width (masonry-positioned class)
          // Limit to 100 attempts (~1.6s at 60fps) to prevent infinite loop
          const waitForLayout = (attempts = 0) => {
            if (card?.classList.contains("masonry-positioned")) {
              requestAnimationFrame(doTruncate);
            } else if (attempts < 100) {
              requestAnimationFrame(() => waitForLayout(attempts + 1));
            } else {
              // Fallback: truncate anyway after timeout
              requestAnimationFrame(doTruncate);
            }
          };
          requestAnimationFrame(() => waitForLayout(0));
        } else {
          // Grid: double RAF ensures layout is complete
          requestAnimationFrame(() => {
            requestAnimationFrame(doTruncate);
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
      cardEl.addEventListener("dragstart", handleDrag);
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
    const hasImageAvailable = format !== "none" && card.hasImageAvailable;

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
          resizeObserver.observe(cardEl);
          this.propertyObservers.push(resizeObserver);
        });
      }
    }

    // Determine if card-content will have children
    const hasTextPreview = settings.showTextPreview && card.textPreview;
    const hasThumbnail =
      format === "thumbnail" && (hasImage || hasImageAvailable);

    // Only create card-content if it will have children
    if (hasTextPreview || hasThumbnail) {
      const contentContainer = cardEl.createDiv("card-content");

      if (hasTextPreview) {
        const wrapper = contentContainer.createDiv("card-text-preview-wrapper");
        wrapper.createDiv({
          cls: "card-text-preview",
          text: card.textPreview,
        });
      }

      // Thumbnail (all positions now inside card-content)
      if (hasThumbnail) {
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

    // Properties - 4-field rendering with 2-row layout
    this.renderProperties(cardEl, card, entry, settings, signal);

    // Card-level responsive behaviors (single ResizeObserver)
    const breakpoint =
      parseFloat(
        getComputedStyle(document.body).getPropertyValue(
          "--dynamic-views-compact-breakpoint",
        ),
      ) || 390;

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
    cardObserver.observe(cardEl);
    this.propertyObservers.push(cardObserver);
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
          if (this.updateLayoutRef.current) this.updateLayoutRef.current();
        },
      },
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

      imageEl.addEventListener(
        "mousemove",
        (e) => {
          const rect = imageEl.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const index = Math.max(
            0,
            Math.min(
              Math.floor((x / rect.width) * scrubbableUrls.length),
              scrubbableUrls.length - 1,
            ),
          );
          if (imgEl.src !== scrubbableUrls[index]) {
            imgEl.src = scrubbableUrls[index];
            imageEmbedContainer.style.setProperty(
              "--cover-image-url",
              `url("${scrubbableUrls[index]}")`,
            );
          }
        },
        signal ? { signal } : undefined,
      );

      imageEl.addEventListener(
        "mouseleave",
        () => {
          imgEl.src = scrubbableUrls[0];
          imageEmbedContainer.style.setProperty(
            "--cover-image-url",
            `url("${scrubbableUrls[0]}")`,
          );
        },
        signal ? { signal } : undefined,
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

    // Check if any row has content
    // Show row if property is configured, UNLESS labels hidden AND hideMissingProperties enabled
    const showConfiguredProps =
      settings.propertyLabels !== "hide" || !hideMissing;
    const row1HasContent = showConfiguredProps
      ? effectiveProps[0] !== "" || effectiveProps[1] !== ""
      : values[0] !== null || values[1] !== null;
    const row2HasContent = showConfiguredProps
      ? effectiveProps[2] !== "" || effectiveProps[3] !== ""
      : values[2] !== null || values[3] !== null;
    const row3HasContent = showConfiguredProps
      ? effectiveProps[4] !== "" || effectiveProps[5] !== ""
      : values[4] !== null || values[5] !== null;
    const row4HasContent = showConfiguredProps
      ? effectiveProps[6] !== "" || effectiveProps[7] !== ""
      : values[6] !== null || values[7] !== null;
    const row5HasContent = showConfiguredProps
      ? effectiveProps[8] !== "" || effectiveProps[9] !== ""
      : values[8] !== null || values[9] !== null;
    const row6HasContent = showConfiguredProps
      ? effectiveProps[10] !== "" || effectiveProps[11] !== ""
      : values[10] !== null || values[11] !== null;
    const row7HasContent = showConfiguredProps
      ? effectiveProps[12] !== "" || effectiveProps[13] !== ""
      : values[12] !== null || values[13] !== null;

    if (
      !row1HasContent &&
      !row2HasContent &&
      !row3HasContent &&
      !row4HasContent &&
      !row5HasContent &&
      !row6HasContent &&
      !row7HasContent
    )
      return;

    // Determine which rows go to top vs bottom based on position settings
    const row1IsTop =
      row1HasContent && settings.propertyGroup1Position === "top";
    const row2IsTop =
      row2HasContent && settings.propertyGroup2Position === "top";
    const row3IsTop =
      row3HasContent && settings.propertyGroup3Position === "top";
    const row4IsTop =
      row4HasContent && settings.propertyGroup4Position === "top";
    const row5IsTop =
      row5HasContent && settings.propertyGroup5Position === "top";
    const row6IsTop =
      row6HasContent && settings.propertyGroup6Position === "top";
    const row7IsTop =
      row7HasContent && settings.propertyGroup7Position === "top";

    const hasTopRows =
      row1IsTop ||
      row2IsTop ||
      row3IsTop ||
      row4IsTop ||
      row5IsTop ||
      row6IsTop ||
      row7IsTop;
    const hasBottomRows =
      (row1HasContent && !row1IsTop) ||
      (row2HasContent && !row2IsTop) ||
      (row3HasContent && !row3IsTop) ||
      (row4HasContent && !row4IsTop) ||
      (row5HasContent && !row5IsTop) ||
      (row6HasContent && !row6IsTop) ||
      (row7HasContent && !row7IsTop);

    // Create containers as needed
    const topPropertiesEl = hasTopRows
      ? cardEl.createDiv("card-properties card-properties-top")
      : null;
    const bottomPropertiesEl = hasBottomRows
      ? cardEl.createDiv("card-properties card-properties-bottom")
      : null;

    // Helper to get the right container for each row
    const getContainer = (rowNum: number): HTMLElement | null => {
      const positions = [
        row1IsTop,
        row2IsTop,
        row3IsTop,
        row4IsTop,
        row5IsTop,
        row6IsTop,
        row7IsTop,
      ];
      const isTop = positions[rowNum - 1];
      return isTop ? topPropertiesEl : bottomPropertiesEl;
    };

    // For backwards compatibility, metaEl references the container where rows are added
    // Each row will use getContainer() to determine which container to use

    // Row 1
    if (row1HasContent) {
      const row1El = getContainer(1)!.createDiv("property-row property-row-1");
      if (settings.propertyGroup1SideBySide) {
        row1El.addClass("property-row-sidebyside");
      }

      const field1El = row1El.createDiv("property-field property-field-1");
      if (effectiveProps[0])
        this.renderPropertyContent(
          field1El,
          effectiveProps[0],
          values[0],
          card,
          entry,
          settings,
          hideMissing,
          hideEmptyMode,
          signal,
        );

      const field2El = row1El.createDiv("property-field property-field-2");
      if (effectiveProps[1])
        this.renderPropertyContent(
          field2El,
          effectiveProps[1],
          values[1],
          card,
          entry,
          settings,
          hideMissing,
          hideEmptyMode,
          signal,
        );

      // Check actual rendered content
      const has1 =
        field1El.children.length > 0 || field1El.textContent?.trim().length > 0;
      const has2 =
        field2El.children.length > 0 || field2El.textContent?.trim().length > 0;

      // Check if properties are actually set (not empty string from duplicate/empty slots)
      const field1HasProp = effectiveProps[0] !== "";
      const field2HasProp = effectiveProps[1] !== "";

      if (!has1 && !has2) {
        row1El.remove();
      } else if (has1 && !has2) {
        if (field2HasProp) {
          if (
            shouldCollapseField(
              values[1],
              effectiveProps[1],
              hideMissing,
              hideEmptyMode,
              settings.propertyLabels,
            )
          ) {
            field2El.addClass("property-field-collapsed");
          } else {
            const placeholderContent = field2El.createDiv("property-content");
            const markerSpan =
              placeholderContent.createSpan("empty-value-marker");
            markerSpan.textContent = getEmptyValueMarker();
          }
        } else if (settings.propertyLabels === "hide") {
          field2El.addClass("property-field-collapsed");
        }
      } else if (!has1 && has2) {
        if (field1HasProp) {
          if (
            shouldCollapseField(
              values[0],
              effectiveProps[0],
              hideMissing,
              hideEmptyMode,
              settings.propertyLabels,
            )
          ) {
            field1El.addClass("property-field-collapsed");
          } else {
            const placeholderContent = field1El.createDiv("property-content");
            const markerSpan =
              placeholderContent.createSpan("empty-value-marker");
            markerSpan.textContent = getEmptyValueMarker();
          }
        } else if (settings.propertyLabels === "hide") {
          field1El.addClass("property-field-collapsed");
        }
      }
    }

    // Row 2
    if (row2HasContent) {
      const row2El = getContainer(2)!.createDiv("property-row property-row-2");
      if (settings.propertyGroup2SideBySide) {
        row2El.addClass("property-row-sidebyside");
      }

      const field3El = row2El.createDiv("property-field property-field-3");
      if (effectiveProps[2])
        this.renderPropertyContent(
          field3El,
          effectiveProps[2],
          values[2],
          card,
          entry,
          settings,
          hideMissing,
          hideEmptyMode,
          signal,
        );

      const field4El = row2El.createDiv("property-field property-field-4");
      if (effectiveProps[3])
        this.renderPropertyContent(
          field4El,
          effectiveProps[3],
          values[3],
          card,
          entry,
          settings,
          hideMissing,
          hideEmptyMode,
          signal,
        );

      // Check actual rendered content
      const has3 =
        field3El.children.length > 0 || field3El.textContent?.trim().length > 0;
      const has4 =
        field4El.children.length > 0 || field4El.textContent?.trim().length > 0;

      // Check if properties are actually set (not empty string from duplicate/empty slots)
      const field3HasProp = effectiveProps[2] !== "";
      const field4HasProp = effectiveProps[3] !== "";

      if (!has3 && !has4) {
        row2El.remove();
      } else if (has3 && !has4) {
        if (field4HasProp) {
          if (
            shouldCollapseField(
              values[3],
              effectiveProps[3],
              hideMissing,
              hideEmptyMode,
              settings.propertyLabels,
            )
          ) {
            field4El.addClass("property-field-collapsed");
          } else {
            const placeholderContent = field4El.createDiv("property-content");
            const markerSpan =
              placeholderContent.createSpan("empty-value-marker");
            markerSpan.textContent = getEmptyValueMarker();
          }
        } else if (settings.propertyLabels === "hide") {
          field4El.addClass("property-field-collapsed");
        }
      } else if (!has3 && has4) {
        if (field3HasProp) {
          if (
            shouldCollapseField(
              values[2],
              effectiveProps[2],
              hideMissing,
              hideEmptyMode,
              settings.propertyLabels,
            )
          ) {
            field3El.addClass("property-field-collapsed");
          } else {
            const placeholderContent = field3El.createDiv("property-content");
            const markerSpan =
              placeholderContent.createSpan("empty-value-marker");
            markerSpan.textContent = getEmptyValueMarker();
          }
        } else if (settings.propertyLabels === "hide") {
          field3El.addClass("property-field-collapsed");
        }
      }
    }

    // Row 3
    if (row3HasContent) {
      const row3El = getContainer(3)!.createDiv("property-row property-row-3");
      if (settings.propertyGroup3SideBySide) {
        row3El.addClass("property-row-sidebyside");
      }

      const field5El = row3El.createDiv("property-field property-field-5");
      if (effectiveProps[4])
        this.renderPropertyContent(
          field5El,
          effectiveProps[4],
          values[4],
          card,
          entry,
          settings,
          hideMissing,
          hideEmptyMode,
          signal,
        );

      const field6El = row3El.createDiv("property-field property-field-6");
      if (effectiveProps[5])
        this.renderPropertyContent(
          field6El,
          effectiveProps[5],
          values[5],
          card,
          entry,
          settings,
          hideMissing,
          hideEmptyMode,
          signal,
        );

      const has5 =
        field5El.children.length > 0 || field5El.textContent?.trim().length > 0;
      const has6 =
        field6El.children.length > 0 || field6El.textContent?.trim().length > 0;

      const field5HasProp = effectiveProps[4] !== "";
      const field6HasProp = effectiveProps[5] !== "";

      if (!has5 && !has6) {
        row3El.remove();
      } else if (has5 && !has6) {
        if (field6HasProp) {
          if (
            shouldCollapseField(
              values[5],
              effectiveProps[5],
              hideMissing,
              hideEmptyMode,
              settings.propertyLabels,
            )
          ) {
            field6El.addClass("property-field-collapsed");
          } else {
            const placeholderContent = field6El.createDiv("property-content");
            const markerSpan =
              placeholderContent.createSpan("empty-value-marker");
            markerSpan.textContent = getEmptyValueMarker();
          }
        } else if (settings.propertyLabels === "hide") {
          field6El.addClass("property-field-collapsed");
        }
      } else if (!has5 && has6) {
        if (field5HasProp) {
          if (
            shouldCollapseField(
              values[4],
              effectiveProps[4],
              hideMissing,
              hideEmptyMode,
              settings.propertyLabels,
            )
          ) {
            field5El.addClass("property-field-collapsed");
          } else {
            const placeholderContent = field5El.createDiv("property-content");
            const markerSpan =
              placeholderContent.createSpan("empty-value-marker");
            markerSpan.textContent = getEmptyValueMarker();
          }
        } else if (settings.propertyLabels === "hide") {
          field5El.addClass("property-field-collapsed");
        }
      }
    }

    // Row 4
    if (row4HasContent) {
      const row4El = getContainer(4)!.createDiv("property-row property-row-4");
      if (settings.propertyGroup4SideBySide) {
        row4El.addClass("property-row-sidebyside");
      }

      const field7El = row4El.createDiv("property-field property-field-7");
      if (effectiveProps[6])
        this.renderPropertyContent(
          field7El,
          effectiveProps[6],
          values[6],
          card,
          entry,
          settings,
          hideMissing,
          hideEmptyMode,
          signal,
        );

      const field8El = row4El.createDiv("property-field property-field-8");
      if (effectiveProps[7])
        this.renderPropertyContent(
          field8El,
          effectiveProps[7],
          values[7],
          card,
          entry,
          settings,
          hideMissing,
          hideEmptyMode,
          signal,
        );

      const has7 =
        field7El.children.length > 0 || field7El.textContent?.trim().length > 0;
      const has8 =
        field8El.children.length > 0 || field8El.textContent?.trim().length > 0;

      const field7HasProp = effectiveProps[6] !== "";
      const field8HasProp = effectiveProps[7] !== "";

      if (!has7 && !has8) {
        row4El.remove();
      } else if (has7 && !has8) {
        if (field8HasProp) {
          if (
            shouldCollapseField(
              values[7],
              effectiveProps[7],
              hideMissing,
              hideEmptyMode,
              settings.propertyLabels,
            )
          ) {
            field8El.addClass("property-field-collapsed");
          } else {
            const placeholderContent = field8El.createDiv("property-content");
            const markerSpan =
              placeholderContent.createSpan("empty-value-marker");
            markerSpan.textContent = getEmptyValueMarker();
          }
        } else if (settings.propertyLabels === "hide") {
          field8El.addClass("property-field-collapsed");
        }
      } else if (!has7 && has8) {
        if (field7HasProp) {
          if (
            shouldCollapseField(
              values[6],
              effectiveProps[6],
              hideMissing,
              hideEmptyMode,
              settings.propertyLabels,
            )
          ) {
            field7El.addClass("property-field-collapsed");
          } else {
            const placeholderContent = field7El.createDiv("property-content");
            const markerSpan =
              placeholderContent.createSpan("empty-value-marker");
            markerSpan.textContent = getEmptyValueMarker();
          }
        } else if (settings.propertyLabels === "hide") {
          field7El.addClass("property-field-collapsed");
        }
      }
    }

    // Row 5
    if (row5HasContent) {
      const row5El = getContainer(5)!.createDiv("property-row property-row-5");
      if (settings.propertyGroup5SideBySide) {
        row5El.addClass("property-row-sidebyside");
      }

      const field9El = row5El.createDiv("property-field property-field-9");
      if (effectiveProps[8])
        this.renderPropertyContent(
          field9El,
          effectiveProps[8],
          values[8],
          card,
          entry,
          settings,
          hideMissing,
          hideEmptyMode,
          signal,
        );

      const field10El = row5El.createDiv("property-field property-field-10");
      if (effectiveProps[9])
        this.renderPropertyContent(
          field10El,
          effectiveProps[9],
          values[9],
          card,
          entry,
          settings,
          hideMissing,
          hideEmptyMode,
          signal,
        );

      const has9 =
        field9El.children.length > 0 || field9El.textContent?.trim().length > 0;
      const has10 =
        field10El.children.length > 0 ||
        field10El.textContent?.trim().length > 0;

      const field9HasProp = effectiveProps[8] !== "";
      const field10HasProp = effectiveProps[9] !== "";

      if (!has9 && !has10) {
        row5El.remove();
      } else if (has9 && !has10) {
        if (field10HasProp) {
          if (
            shouldCollapseField(
              values[9],
              effectiveProps[9],
              hideMissing,
              hideEmptyMode,
              settings.propertyLabels,
            )
          ) {
            field10El.addClass("property-field-collapsed");
          } else {
            const placeholderContent = field10El.createDiv("property-content");
            const markerSpan =
              placeholderContent.createSpan("empty-value-marker");
            markerSpan.textContent = getEmptyValueMarker();
          }
        } else if (settings.propertyLabels === "hide") {
          field10El.addClass("property-field-collapsed");
        }
      } else if (!has9 && has10) {
        if (field9HasProp) {
          if (
            shouldCollapseField(
              values[8],
              effectiveProps[8],
              hideMissing,
              hideEmptyMode,
              settings.propertyLabels,
            )
          ) {
            field9El.addClass("property-field-collapsed");
          } else {
            const placeholderContent = field9El.createDiv("property-content");
            const markerSpan =
              placeholderContent.createSpan("empty-value-marker");
            markerSpan.textContent = getEmptyValueMarker();
          }
        } else if (settings.propertyLabels === "hide") {
          field9El.addClass("property-field-collapsed");
        }
      }
    }

    // Row 6
    if (row6HasContent) {
      const row6El = getContainer(6)!.createDiv("property-row property-row-6");
      if (settings.propertyGroup6SideBySide) {
        row6El.addClass("property-row-sidebyside");
      }

      const field11El = row6El.createDiv("property-field property-field-11");
      if (effectiveProps[10])
        this.renderPropertyContent(
          field11El,
          effectiveProps[10],
          values[10],
          card,
          entry,
          settings,
          hideMissing,
          hideEmptyMode,
          signal,
        );

      const field12El = row6El.createDiv("property-field property-field-12");
      if (effectiveProps[11])
        this.renderPropertyContent(
          field12El,
          effectiveProps[11],
          values[11],
          card,
          entry,
          settings,
          hideMissing,
          hideEmptyMode,
          signal,
        );

      const has11 =
        field11El.children.length > 0 ||
        field11El.textContent?.trim().length > 0;
      const has12 =
        field12El.children.length > 0 ||
        field12El.textContent?.trim().length > 0;

      const field11HasProp = effectiveProps[10] !== "";
      const field12HasProp = effectiveProps[11] !== "";

      if (!has11 && !has12) {
        row6El.remove();
      } else if (has11 && !has12) {
        if (field12HasProp) {
          if (
            shouldCollapseField(
              values[11],
              effectiveProps[11],
              hideMissing,
              hideEmptyMode,
              settings.propertyLabels,
            )
          ) {
            field12El.addClass("property-field-collapsed");
          } else {
            const placeholderContent = field12El.createDiv("property-content");
            const markerSpan =
              placeholderContent.createSpan("empty-value-marker");
            markerSpan.textContent = getEmptyValueMarker();
          }
        } else if (settings.propertyLabels === "hide") {
          field12El.addClass("property-field-collapsed");
        }
      } else if (!has11 && has12) {
        if (field11HasProp) {
          if (
            shouldCollapseField(
              values[10],
              effectiveProps[10],
              hideMissing,
              hideEmptyMode,
              settings.propertyLabels,
            )
          ) {
            field11El.addClass("property-field-collapsed");
          } else {
            const placeholderContent = field11El.createDiv("property-content");
            const markerSpan =
              placeholderContent.createSpan("empty-value-marker");
            markerSpan.textContent = getEmptyValueMarker();
          }
        } else if (settings.propertyLabels === "hide") {
          field11El.addClass("property-field-collapsed");
        }
      }
    }

    // Row 7
    if (row7HasContent) {
      const row7El = getContainer(7)!.createDiv("property-row property-row-7");
      if (settings.propertyGroup7SideBySide) {
        row7El.addClass("property-row-sidebyside");
      }

      const field13El = row7El.createDiv("property-field property-field-13");
      if (effectiveProps[12])
        this.renderPropertyContent(
          field13El,
          effectiveProps[12],
          values[12],
          card,
          entry,
          settings,
          hideMissing,
          hideEmptyMode,
          signal,
        );

      const field14El = row7El.createDiv("property-field property-field-14");
      if (effectiveProps[13])
        this.renderPropertyContent(
          field14El,
          effectiveProps[13],
          values[13],
          card,
          entry,
          settings,
          hideMissing,
          hideEmptyMode,
          signal,
        );

      const has13 =
        field13El.children.length > 0 ||
        field13El.textContent?.trim().length > 0;
      const has14 =
        field14El.children.length > 0 ||
        field14El.textContent?.trim().length > 0;

      const field13HasProp = effectiveProps[12] !== "";
      const field14HasProp = effectiveProps[13] !== "";

      if (!has13 && !has14) {
        row7El.remove();
      } else if (has13 && !has14) {
        if (field14HasProp) {
          if (
            shouldCollapseField(
              values[13],
              effectiveProps[13],
              hideMissing,
              hideEmptyMode,
              settings.propertyLabels,
            )
          ) {
            field14El.addClass("property-field-collapsed");
          } else {
            const placeholderContent = field14El.createDiv("property-content");
            const markerSpan =
              placeholderContent.createSpan("empty-value-marker");
            markerSpan.textContent = getEmptyValueMarker();
          }
        } else if (settings.propertyLabels === "hide") {
          field14El.addClass("property-field-collapsed");
        }
      } else if (!has13 && has14) {
        if (field13HasProp) {
          if (
            shouldCollapseField(
              values[12],
              effectiveProps[12],
              hideMissing,
              hideEmptyMode,
              settings.propertyLabels,
            )
          ) {
            field13El.addClass("property-field-collapsed");
          } else {
            const placeholderContent = field13El.createDiv("property-content");
            const markerSpan =
              placeholderContent.createSpan("empty-value-marker");
            markerSpan.textContent = getEmptyValueMarker();
          }
        } else if (settings.propertyLabels === "hide") {
          field13El.addClass("property-field-collapsed");
        }
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
      setupScrollGradients(cardEl, updateScrollGradient);
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
    const contentWrapper = container.createDiv("property-content-wrapper");

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
          : "path-segment file-path-segment";
        const segmentEl = span.createSpan({ cls: segmentClass, text: segment });

        // Make filename segment draggable and show page preview on hover
        if (isLastSegment) {
          segmentEl.draggable = true;
          segmentEl.addEventListener(
            "dragstart",
            (e: DragEvent) => {
              e.stopPropagation();
              const file = this.app.vault.getAbstractFileByPath(card.path);
              if (!(file instanceof TFile)) return;
              const dragData = this.app.dragManager.dragFile(e, file);
              this.app.dragManager.onDragStart(e, dragData);
            },
            { signal },
          );
        }

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
