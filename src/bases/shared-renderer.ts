/**
 * Shared Card Renderer for Bases Views
 * Consolidates duplicate card rendering logic from Grid and Masonry views
 */

import { App, TFile, TFolder, setIcon, Menu, BasesEntry } from "obsidian";
import { CardData } from "../shared/card-renderer";
import { resolveBasesProperty } from "../shared/data-transform";
import { setupImageLoadHandler } from "../shared/image-loader";
import {
  updateScrollGradient,
  updateElementScrollGradient,
  setupScrollGradients,
} from "../shared/scroll-gradient-manager";
import { getTimestampIcon } from "../shared/render-utils";
import {
  showTagHashPrefix,
  showTimestampIcon,
  getEmptyValueMarker,
  shouldHideMissingProperties,
  shouldHideEmptyProperties,
  getListSeparator,
} from "../utils/style-settings";
import { getPropertyLabel } from "../utils/property";
import { findLinksInText, type ParsedLink } from "../utils/link-parser";
import { handleImageZoomClick } from "../shared/image-zoom-handler";
import type DynamicViewsPlugin from "../../main";
import type { Settings } from "../types";

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
  private zoomCleanupFns: Map<HTMLElement, () => void> = new Map();
  private zoomedOriginalParents: Map<HTMLElement, HTMLElement> = new Map();

  constructor(
    protected app: App,
    protected plugin: DynamicViewsPlugin,
    protected updateLayoutRef: { current: (() => void) | null },
  ) {}

  /**
   * Cleanup observers and zoom state when renderer is destroyed
   */
  public cleanup(): void {
    this.propertyObservers.forEach((obs) => obs.disconnect());
    this.propertyObservers = [];

    // Cleanup all zoom gestures and restore teleported images
    this.zoomCleanupFns.forEach((cleanup, embedEl) => {
      // Remove zoom class
      embedEl.classList.remove("is-zoomed");
      // Return to original parent if teleported
      const originalParent = this.zoomedOriginalParents.get(embedEl);
      if (originalParent && embedEl.parentElement !== originalParent) {
        originalParent.appendChild(embedEl);
      }
      // Call cleanup function (removes event listeners)
      cleanup();
    });
    this.zoomCleanupFns.clear();
    this.zoomedOriginalParents.clear();
  }

  /**
   * Render text with link detection
   * Uses parseLink utility for comprehensive link detection
   */
  private renderTextWithLinks(container: HTMLElement, text: string): void {
    const segments = findLinksInText(text);

    for (const segment of segments) {
      if (segment.type === "text") {
        // Wrap text in span to preserve whitespace in flex containers
        container.createSpan({ text: segment.content });
      } else {
        this.renderLink(container, segment.link);
      }
    }
  }

  private renderLink(container: HTMLElement, link: ParsedLink): void {
    // Internal link (wikilink or markdown internal)
    if (link.type === "internal") {
      if (link.isEmbed) {
        // Embedded internal link - render as embed container
        const embed = container.createSpan({ cls: "internal-embed" });
        embed.dataset.src = link.url;
        embed.setText(link.caption);
        embed.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const newLeaf = e.metaKey || e.ctrlKey;
          void this.app.workspace.openLinkText(link.url, "", newLeaf);
        });
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
      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const newLeaf = e.metaKey || e.ctrlKey;
        void this.app.workspace.openLinkText(link.url, "", newLeaf);
      });
      el.addEventListener("dragstart", (e) => {
        const file = this.app.metadataCache.getFirstLinkpathDest(link.url, "");
        if (!(file instanceof TFile)) return;
        const dragData = this.app.dragManager.dragFile(e, file);
        this.app.dragManager.onDragStart(e, dragData);
      });
      return;
    }

    // External link
    if (link.isEmbed) {
      // Embedded external link (image)
      const img = container.createEl("img", {
        cls: "external-embed",
        attr: { src: link.url, alt: link.caption },
      });
      img.addEventListener("click", (e) => {
        e.stopPropagation();
      });
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
    el.addEventListener("click", (e) => {
      e.stopPropagation();
    });
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer?.clearData();
      // Bare link (caption === url) → plain URL; captioned → markdown link
      const dragText =
        link.caption === link.url ? link.url : `[${link.caption}](${link.url})`;
      e.dataTransfer?.setData("text/plain", dragText);
    });
  }

  /**
   * Renders a complete card with all sub-components
   * @param container - Container to append card to
   * @param card - Card data
   * @param entry - Bases entry
   * @param settings - View settings
   * @param hoverParent - Parent object for hover-link event
   */
  renderCard(
    container: HTMLElement,
    card: CardData,
    entry: BasesEntry,
    settings: Settings,
    hoverParent: unknown,
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
    } else if (format === "cover") {
      cardEl.classList.add(`card-cover-${position}`);
    }

    // Add cover fit mode class
    if (format === "cover") {
      cardEl.classList.add(`card-cover-${settings.coverFitMode}`);
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

    // Handle card click to open file
    cardEl.addEventListener("click", (e) => {
      // Only handle card-level clicks when openFileAction is 'card'
      // When openFileAction is 'title', the title link handles its own clicks
      if (settings.openFileAction === "card") {
        const target = e.target as HTMLElement;
        // Don't open if clicking on links, tags, path segments, or images
        const isLink = target.tagName === "A" || target.closest("a");
        const isTag =
          target.classList.contains("tag") || target.closest(".tag");
        const isPathSegment =
          target.classList.contains("path-segment") ||
          target.closest(".path-segment");
        const isImage = target.tagName === "IMG";

        if (!isLink && !isTag && !isPathSegment && !isImage) {
          const newLeaf = e.metaKey || e.ctrlKey;
          const file = this.app.vault.getAbstractFileByPath(card.path);
          if (file instanceof TFile) {
            void this.app.workspace.getLeaf(newLeaf).openFile(file);
          }
        }
      }
    });

    // Handle hover for page preview
    cardEl.addEventListener("mouseover", (e) => {
      this.app.workspace.trigger("hover-link", {
        event: e,
        source: "dynamic-views",
        hoverParent: hoverParent,
        targetEl: cardEl,
        linktext: card.path,
      });
    });

    // Handle right-click for context menu
    cardEl.addEventListener("contextmenu", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const menu = new Menu();

      // @ts-ignore - Trigger file-menu to add standard items
      this.app.workspace.trigger(
        "file-menu",
        menu,
        entry.file,
        "file-explorer",
      );

      menu.showAtMouseEvent(e);
    });

    // Drag handler function
    const handleDrag = (e: DragEvent) => {
      const file = this.app.vault.getAbstractFileByPath(card.path);
      if (!(file instanceof TFile)) return;

      const dragData = this.app.dragManager.dragFile(e, file);
      this.app.dragManager.onDragStart(e, dragData);
    };

    // Title - render as link when openFileAction is 'title', otherwise plain text
    if (settings.showTitle || card.hasValidUrl) {
      const containerEl = cardEl.createDiv(
        card.hasValidUrl ? "card-title-container" : "card-title",
      );

      if (settings.showTitle) {
        const titleEl = card.hasValidUrl
          ? containerEl.createDiv("card-title")
          : containerEl;

        if (settings.openFileAction === "title") {
          // Render as clickable, draggable link
          const link = titleEl.createEl("a", {
            cls: "internal-link",
            text: card.title,
            attr: {
              "data-href": card.path,
              href: card.path,
              draggable: "true",
            },
          });

          link.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const newLeaf = e.metaKey || e.ctrlKey;
            void this.app.workspace.openLinkText(card.path, "", newLeaf);
          });

          // Make title draggable when openFileAction is 'title'
          link.addEventListener("dragstart", handleDrag);
        } else {
          // Render as plain text
          titleEl.appendText(card.title);
        }

        // Setup scroll gradients for title if scroll mode is enabled
        if (
          document.body.classList.contains(
            "dynamic-views-title-overflow-scroll",
          )
        ) {
          requestAnimationFrame(() => {
            updateElementScrollGradient(titleEl);
          });
          titleEl.addEventListener("scroll", () => {
            updateElementScrollGradient(titleEl);
          });
        }
      }

      if (card.hasValidUrl && card.urlValue) {
        const iconEl = containerEl.createDiv(
          "card-title-url-icon text-icon-button svg-icon",
        );
        iconEl.setAttribute("title", "Open URL");
        setIcon(iconEl, "square-arrow-out-up-right");

        iconEl.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          window.open(card.urlValue!, "_blank", "noopener,noreferrer");
        });
      }
    }

    // Subtitle
    if (settings.subtitleProperty && card.subtitle) {
      const subtitleEl = cardEl.createDiv("card-subtitle");
      this.renderPropertyContent(
        subtitleEl,
        settings.subtitleProperty,
        card.subtitle,
        card,
        entry,
        { ...settings, propertyLabels: "hide" },
      );

      // Setup scroll gradients if scroll mode is enabled
      if (
        document.body.classList.contains(
          "dynamic-views-subtitle-overflow-scroll",
        )
      ) {
        requestAnimationFrame(() => {
          updateElementScrollGradient(subtitleEl);
        });
        subtitleEl.addEventListener("scroll", () => {
          updateElementScrollGradient(subtitleEl);
        });
      }

      // Setup scroll gradients for inner wrapper (works in wrap mode too)
      const subtitleWrapper = subtitleEl.querySelector(
        ".property-content-wrapper",
      ) as HTMLElement;
      if (subtitleWrapper) {
        requestAnimationFrame(() => {
          updateElementScrollGradient(subtitleWrapper);
        });
        subtitleWrapper.addEventListener("scroll", () => {
          updateElementScrollGradient(subtitleWrapper);
        });
      }
    }

    // Make card draggable when openFileAction is 'card'
    if (settings.openFileAction === "card") {
      cardEl.addEventListener("dragstart", handleDrag);
    }

    // Prepare image URLs if applicable
    const rawUrls = card.imageUrl
      ? Array.isArray(card.imageUrl)
        ? card.imageUrl
        : [card.imageUrl]
      : [];

    // Debug: Check for duplicates in raw URLs
    if (rawUrls.length > 1) {
      console.log(
        "// [Debug] Raw URLs from card.imageUrl:",
        rawUrls.length,
        "items",
      );
      rawUrls.forEach((url, i) => {
        console.log(`//   [${i}]:`, url);
      });
    }

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
        const shouldShowCarousel =
          (position === "top" || position === "bottom") &&
          imageUrls.length >= 2;

        if (shouldShowCarousel) {
          const carouselEl = coverWrapper.createDiv(
            "card-cover card-cover-carousel",
          );
          this.renderCarousel(
            carouselEl,
            imageUrls,
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
        const elementSpacing = 8; // Use CSS default value

        // Set wrapper ratio for potential CSS calc usage
        cardEl.style.setProperty(
          "--dynamic-views-wrapper-ratio",
          wrapperRatio.toString(),
        );

        // Function to calculate and set wrapper dimensions
        const updateWrapperDimensions = () => {
          const cardWidth = cardEl.offsetWidth; // Border box width (includes padding)
          const targetWidth = Math.floor(wrapperRatio * cardWidth);
          const paddingValue = targetWidth + elementSpacing;

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
          const {
            cardWidth: _cardWidth,
            targetWidth,
            paddingValue,
          } = updateWrapperDimensions();

          // Debug: Check if variable is actually set
          const cardComputed = getComputedStyle(cardEl);
          console.log(
            "[CSS Variable Check]",
            "cardEl classes:",
            cardEl.className,
            "--side-cover-width on card style:",
            cardEl.style.getPropertyValue("--dynamic-views-side-cover-width"),
            "card computed --side-cover-width:",
            cardComputed.getPropertyValue("--dynamic-views-side-cover-width"),
          );

          // Debug logging
          const computedStyle = cardComputed;
          console.log(
            "[Side Cover Debug - shared-renderer]",
            "position:",
            position,
            "aspectRatio:",
            aspectRatio,
            "wrapperRatio:",
            wrapperRatio,
            "cardOffsetWidth:",
            cardEl.offsetWidth,
            "cardClientWidth:",
            cardEl.clientWidth,
            "padding:",
            computedStyle.padding,
            "targetWidth:",
            targetWidth,
            "paddingValue:",
            paddingValue,
          );

          // Check rendered dimensions after DOM updates
          setTimeout(() => {
            const wrapper = cardEl.querySelector(
              ".card-cover-wrapper",
            ) as HTMLElement;
            const cover = cardEl.querySelector(".card-cover") as HTMLElement;
            const img = cardEl.querySelector(".card-cover img") as HTMLElement;
            if (wrapper && cover && img) {
              const wrapperComputed = getComputedStyle(wrapper);
              console.log(
                "[Wrapper CSS Debug]",
                "wrapper classes:",
                wrapper.className,
                "wrapper.style.width:",
                wrapper.style.width,
                "wrapper parent is card:",
                wrapper.parentElement === cardEl,
                "wrapper CSS width value:",
                wrapperComputed.getPropertyValue("width"),
                "wrapper resolves variable:",
                wrapperComputed.getPropertyValue(
                  "--dynamic-views-side-cover-width",
                ),
              );

              console.log(
                "[Side Cover Rendered]",
                "position:",
                position,
                "wrapperWidth:",
                wrapper.offsetWidth,
                "wrapperComputedWidth:",
                wrapperComputed.width,
                "coverWidth:",
                cover.offsetWidth,
                "coverComputedWidth:",
                getComputedStyle(cover).width,
                "imgWidth:",
                img.offsetWidth,
                "imgComputedWidth:",
                getComputedStyle(img).width,
              );
            }
          }, 200);

          // Create ResizeObserver to update wrapper width when card resizes
          const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
              const target = entry.target as HTMLElement;
              const newCardWidth = target.offsetWidth;

              // Skip if card not yet rendered (width = 0)
              if (newCardWidth === 0) {
                console.log("[Side Cover Resize] Skipped - cardWidth is 0");
                continue;
              }

              const newTargetWidth = Math.floor(wrapperRatio * newCardWidth);
              const newPaddingValue = newTargetWidth + elementSpacing;

              cardEl.style.setProperty(
                "--dynamic-views-side-cover-width",
                `${newTargetWidth}px`,
              );
              cardEl.style.setProperty(
                "--dynamic-views-side-cover-content-padding",
                `${newPaddingValue}px`,
              );

              console.log(
                "[Side Cover Resize]",
                "newCardWidth:",
                newCardWidth,
                "newTargetWidth:",
                newTargetWidth,
                "newPaddingValue:",
                newPaddingValue,
              );
            }
          });

          // Observe the card element for size changes
          resizeObserver.observe(cardEl);
        });
      }
    }

    // Thumbnail-top: direct child of card
    if (
      format === "thumbnail" &&
      position === "top" &&
      (hasImage || hasImageAvailable)
    ) {
      if (hasImage) {
        const imageEl = cardEl.createDiv("card-thumbnail");
        this.renderImage(
          imageEl,
          imageUrls,
          format,
          position,
          settings,
          cardEl,
        );
      } else {
        cardEl.createDiv("card-thumbnail-placeholder");
      }
    }

    // Determine if card-content will have children
    const hasTextPreview = settings.showTextPreview && card.snippet;
    const hasThumbnailInContent =
      format === "thumbnail" &&
      (position === "left" || position === "right") &&
      (hasImage || hasImageAvailable);

    // Only create card-content if it will have children
    if (hasTextPreview || hasThumbnailInContent) {
      const contentContainer = cardEl.createDiv("card-content");

      if (hasTextPreview) {
        contentContainer.createDiv({
          cls: "card-text-preview",
          text: card.snippet,
        });
      }

      if (hasThumbnailInContent && format === "thumbnail") {
        if (hasImage) {
          const imageEl = contentContainer.createDiv("card-thumbnail");
          this.renderImage(
            imageEl,
            imageUrls,
            format,
            position,
            settings,
            cardEl,
          );
        } else {
          contentContainer.createDiv("card-thumbnail-placeholder");
        }
      }
    }

    // Thumbnail-bottom: direct child of card
    if (
      format === "thumbnail" &&
      position === "bottom" &&
      (hasImage || hasImageAvailable)
    ) {
      if (hasImage) {
        const imageEl = cardEl.createDiv("card-thumbnail");
        this.renderImage(
          imageEl,
          imageUrls,
          format,
          position,
          settings,
          cardEl,
        );
      } else {
        cardEl.createDiv("card-thumbnail-placeholder");
      }
    }

    // Properties - 4-field rendering with 2-row layout
    this.renderProperties(cardEl, card, entry, settings);
  }

  /**
   * Renders carousel for covers with multiple images
   */
  private renderCarousel(
    carouselEl: HTMLElement,
    imageUrls: string[],
    format: "thumbnail" | "cover",
    position: "left" | "right" | "top" | "bottom",
    settings: Settings,
  ): void {
    let currentSlide = 0;

    console.log("// CAROUSEL INIT:", {
      totalSlides: imageUrls.length,
      urls: imageUrls,
    });

    // Create slides container
    const slidesContainer = carouselEl.createDiv("carousel-slides");

    // Create all slides
    const slideElements = imageUrls.map((url, index) => {
      const slideEl = slidesContainer.createDiv("carousel-slide");
      if (index === 0) {
        slideEl.addClass("is-active");
      }
      // Don't add position classes to non-active slides - let transition logic handle it

      const imageEmbedContainer = slideEl.createDiv("image-embed");

      // Multi-image indicator (positioned on image itself)
      if (index === 0) {
        const indicator = imageEmbedContainer.createDiv("carousel-indicator");
        setIcon(indicator, "lucide-images");
      }

      const imgEl = imageEmbedContainer.createEl("img", {
        attr: { src: url, alt: "" },
      });
      imageEmbedContainer.style.setProperty(
        "--cover-image-url",
        `url("${url}")`,
      );

      // Handle image load for masonry layout and color extraction
      const cardEl = carouselEl.closest(".card") as HTMLElement;
      if (cardEl && index === 0) {
        // Only setup for first image
        setupImageLoadHandler(
          imgEl,
          imageEmbedContainer,
          cardEl,
          this.updateLayoutRef.current || undefined,
        );
      }

      return slideEl;
    });

    // Update slide with direction
    const updateSlide = (newIndex: number, direction: "next" | "prev") => {
      const oldSlide = slideElements[currentSlide];
      const newSlide = slideElements[newIndex];

      console.log("// CAROUSEL TRANSITION:", {
        from: currentSlide,
        to: newIndex,
        direction,
        oldClasses: oldSlide.className,
        newClasses: newSlide.className,
      });

      // Position new slide off-screen in the direction it will enter from
      newSlide.removeClass("is-active", "slide-left", "slide-right");
      newSlide.addClass(direction === "next" ? "slide-right" : "slide-left");

      console.log("// After positioning new slide:", newSlide.className);

      // Force reflow to ensure position is set before transition
      void newSlide.offsetHeight;

      // Move old slide out and new slide in
      oldSlide.removeClass("is-active", "slide-left", "slide-right");
      oldSlide.addClass(direction === "next" ? "slide-left" : "slide-right");

      // Add is-active class (keep positioning class, CSS will handle the transition)
      newSlide.addClass("is-active");

      // Clean up position class after transition completes
      setTimeout(() => {
        newSlide.removeClass("slide-left", "slide-right");
      }, 310);

      console.log("// After transition:", {
        oldClasses: oldSlide.className,
        newClasses: newSlide.className,
      });

      currentSlide = newIndex;
    };

    // Navigation arrows
    const leftArrow = carouselEl.createDiv("carousel-nav-left");
    setIcon(leftArrow, "lucide-chevron-left");

    const rightArrow = carouselEl.createDiv("carousel-nav-right");
    setIcon(rightArrow, "lucide-chevron-right");

    leftArrow.addEventListener("click", (e) => {
      e.stopPropagation();
      const newIndex =
        currentSlide === 0 ? imageUrls.length - 1 : currentSlide - 1;
      // Direction based on visual progression: wrapping forward (last->first) should look like going forward
      const direction = currentSlide === 0 ? "next" : "prev";
      updateSlide(newIndex, direction);
    });

    rightArrow.addEventListener("click", (e) => {
      e.stopPropagation();
      const newIndex =
        currentSlide === imageUrls.length - 1 ? 0 : currentSlide + 1;
      // Direction based on visual progression: wrapping back (last->first) should look like going backward
      const direction = currentSlide === imageUrls.length - 1 ? "prev" : "next";
      updateSlide(newIndex, direction);
    });
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
  ): void {
    const imageEmbedContainer = imageEl.createDiv("image-embed");

    // Add zoom handler
    imageEmbedContainer.addEventListener("click", (e) => {
      handleImageZoomClick(
        e,
        cardEl.getAttribute("data-path") || "",
        this.app,
        this.zoomCleanupFns,
        this.zoomedOriginalParents,
      );
    });

    const imgEl = imageEmbedContainer.createEl("img", {
      attr: { src: imageUrls[0], alt: "" },
    });
    // Set CSS variable for letterbox blur background
    imageEmbedContainer.style.setProperty(
      "--cover-image-url",
      `url("${imageUrls[0]}")`,
    );

    // Handle image load for masonry layout and color extraction
    if (cardEl) {
      setupImageLoadHandler(
        imgEl,
        imageEmbedContainer,
        cardEl,
        this.updateLayoutRef.current || undefined,
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

    // Check if any row has content
    // When labels are enabled, show row if property is configured (even if value is empty)
    // When labels are hidden, only show row if value exists
    const row1HasContent =
      settings.propertyLabels !== "hide"
        ? effectiveProps[0] !== "" || effectiveProps[1] !== ""
        : values[0] !== null || values[1] !== null;
    const row2HasContent =
      settings.propertyLabels !== "hide"
        ? effectiveProps[2] !== "" || effectiveProps[3] !== ""
        : values[2] !== null || values[3] !== null;
    const row3HasContent =
      settings.propertyLabels !== "hide"
        ? effectiveProps[4] !== "" || effectiveProps[5] !== ""
        : values[4] !== null || values[5] !== null;
    const row4HasContent =
      settings.propertyLabels !== "hide"
        ? effectiveProps[6] !== "" || effectiveProps[7] !== ""
        : values[6] !== null || values[7] !== null;
    const row5HasContent =
      settings.propertyLabels !== "hide"
        ? effectiveProps[8] !== "" || effectiveProps[9] !== ""
        : values[8] !== null || values[9] !== null;
    const row6HasContent =
      settings.propertyLabels !== "hide"
        ? effectiveProps[10] !== "" || effectiveProps[11] !== ""
        : values[10] !== null || values[11] !== null;
    const row7HasContent =
      settings.propertyLabels !== "hide"
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
      ? cardEl.createDiv(
          "card-properties card-properties-top properties-4field",
        )
      : null;
    const bottomPropertiesEl = hasBottomRows
      ? cardEl.createDiv(
          "card-properties card-properties-bottom properties-4field",
        )
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
      if (settings.propertyLayout12SideBySide) {
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
        );

      // Check actual rendered content
      const has1 =
        field1El.children.length > 0 || field1El.textContent?.trim().length > 0;
      const has2 =
        field2El.children.length > 0 || field2El.textContent?.trim().length > 0;

      // Check if properties are actually set (not empty string from duplicate/empty slots)
      const prop1Set = effectiveProps[0] !== "";
      const prop2Set = effectiveProps[1] !== "";

      if (!has1 && !has2) {
        row1El.remove();
      } else if (has1 && !has2) {
        // Field 1 has content, field 2 empty
        // Add placeholder ONLY if prop2 is set AND not hidden by toggles
        if (prop2Set) {
          const shouldHide =
            (values[1] === null && shouldHideMissingProperties()) ||
            (values[1] === "" && shouldHideEmptyProperties());
          if (!shouldHide) {
            const placeholderContent = field2El.createDiv("property-content");
            const markerSpan =
              placeholderContent.createSpan("empty-value-marker");
            markerSpan.textContent = getEmptyValueMarker();
          }
        }
      } else if (!has1 && has2) {
        // Field 2 has content, field 1 empty
        // Add placeholder ONLY if prop1 is set AND not hidden by toggles
        if (prop1Set) {
          const shouldHide =
            (values[0] === null && shouldHideMissingProperties()) ||
            (values[0] === "" && shouldHideEmptyProperties());
          if (!shouldHide) {
            const placeholderContent = field1El.createDiv("property-content");
            const markerSpan =
              placeholderContent.createSpan("empty-value-marker");
            markerSpan.textContent = getEmptyValueMarker();
          }
        }
      }
      // Keep both fields in DOM for proper positioning (field 2 stays right-aligned)
    }

    // Row 2
    if (row2HasContent) {
      const row2El = getContainer(2)!.createDiv("property-row property-row-2");
      if (settings.propertyLayout34SideBySide) {
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
        );

      // Check actual rendered content
      const has3 =
        field3El.children.length > 0 || field3El.textContent?.trim().length > 0;
      const has4 =
        field4El.children.length > 0 || field4El.textContent?.trim().length > 0;

      // Check if properties are actually set (not empty string from duplicate/empty slots)
      const prop3Set = effectiveProps[2] !== "";
      const prop4Set = effectiveProps[3] !== "";

      if (!has3 && !has4) {
        row2El.remove();
      } else if (has3 && !has4) {
        // Field 3 has content, field 4 empty
        // Add placeholder ONLY if prop4 is set AND not hidden by toggles
        if (prop4Set) {
          const shouldHide =
            (values[3] === null && shouldHideMissingProperties()) ||
            (values[3] === "" && shouldHideEmptyProperties());
          if (!shouldHide) {
            const placeholderContent = field4El.createDiv("property-content");
            const markerSpan =
              placeholderContent.createSpan("empty-value-marker");
            markerSpan.textContent = getEmptyValueMarker();
          }
        }
      } else if (!has3 && has4) {
        // Field 4 has content, field 3 empty
        // Add placeholder ONLY if prop3 is set AND not hidden by toggles
        if (prop3Set) {
          const shouldHide =
            (values[2] === null && shouldHideMissingProperties()) ||
            (values[2] === "" && shouldHideEmptyProperties());
          if (!shouldHide) {
            const placeholderContent = field3El.createDiv("property-content");
            const markerSpan =
              placeholderContent.createSpan("empty-value-marker");
            markerSpan.textContent = getEmptyValueMarker();
          }
        }
      }
      // Keep both fields in DOM for proper positioning (field 4 stays right-aligned)
    }

    // Row 3
    if (row3HasContent) {
      const row3El = getContainer(3)!.createDiv("property-row property-row-3");
      if (settings.propertyLayout56SideBySide) {
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
        );

      const has5 =
        field5El.children.length > 0 || field5El.textContent?.trim().length > 0;
      const has6 =
        field6El.children.length > 0 || field6El.textContent?.trim().length > 0;

      const prop5Set = effectiveProps[4] !== "";
      const prop6Set = effectiveProps[5] !== "";

      if (!has5 && !has6) {
        row3El.remove();
      } else if (has5 && !has6) {
        if (prop6Set) {
          const shouldHide =
            (values[5] === null && shouldHideMissingProperties()) ||
            (values[5] === "" && shouldHideEmptyProperties());
          if (!shouldHide) {
            const placeholderContent = field6El.createDiv("property-content");
            const markerSpan =
              placeholderContent.createSpan("empty-value-marker");
            markerSpan.textContent = getEmptyValueMarker();
          }
        }
      } else if (!has5 && has6) {
        if (prop5Set) {
          const shouldHide =
            (values[4] === null && shouldHideMissingProperties()) ||
            (values[4] === "" && shouldHideEmptyProperties());
          if (!shouldHide) {
            const placeholderContent = field5El.createDiv("property-content");
            const markerSpan =
              placeholderContent.createSpan("empty-value-marker");
            markerSpan.textContent = getEmptyValueMarker();
          }
        }
      }
    }

    // Row 4
    if (row4HasContent) {
      const row4El = getContainer(4)!.createDiv("property-row property-row-4");
      if (settings.propertyLayout78SideBySide) {
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
        );

      const has7 =
        field7El.children.length > 0 || field7El.textContent?.trim().length > 0;
      const has8 =
        field8El.children.length > 0 || field8El.textContent?.trim().length > 0;

      const prop7Set = effectiveProps[6] !== "";
      const prop8Set = effectiveProps[7] !== "";

      if (!has7 && !has8) {
        row4El.remove();
      } else if (has7 && !has8) {
        if (prop8Set) {
          const shouldHide =
            (values[7] === null && shouldHideMissingProperties()) ||
            (values[7] === "" && shouldHideEmptyProperties());
          if (!shouldHide) {
            const placeholderContent = field8El.createDiv("property-content");
            const markerSpan =
              placeholderContent.createSpan("empty-value-marker");
            markerSpan.textContent = getEmptyValueMarker();
          }
        }
      } else if (!has7 && has8) {
        if (prop7Set) {
          const shouldHide =
            (values[6] === null && shouldHideMissingProperties()) ||
            (values[6] === "" && shouldHideEmptyProperties());
          if (!shouldHide) {
            const placeholderContent = field7El.createDiv("property-content");
            const markerSpan =
              placeholderContent.createSpan("empty-value-marker");
            markerSpan.textContent = getEmptyValueMarker();
          }
        }
      }
    }

    // Row 5
    if (row5HasContent) {
      const row5El = getContainer(5)!.createDiv("property-row property-row-5");
      if (settings.propertyLayout910SideBySide) {
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
        );

      const has9 =
        field9El.children.length > 0 || field9El.textContent?.trim().length > 0;
      const has10 =
        field10El.children.length > 0 ||
        field10El.textContent?.trim().length > 0;

      const prop9Set = effectiveProps[8] !== "";
      const prop10Set = effectiveProps[9] !== "";

      if (!has9 && !has10) {
        row5El.remove();
      } else if (has9 && !has10) {
        if (prop10Set) {
          const shouldHide =
            (values[9] === null && shouldHideMissingProperties()) ||
            (values[9] === "" && shouldHideEmptyProperties());
          if (!shouldHide) {
            const placeholderContent = field10El.createDiv("property-content");
            const markerSpan =
              placeholderContent.createSpan("empty-value-marker");
            markerSpan.textContent = getEmptyValueMarker();
          }
        }
      } else if (!has9 && has10) {
        if (prop9Set) {
          const shouldHide =
            (values[8] === null && shouldHideMissingProperties()) ||
            (values[8] === "" && shouldHideEmptyProperties());
          if (!shouldHide) {
            const placeholderContent = field9El.createDiv("property-content");
            const markerSpan =
              placeholderContent.createSpan("empty-value-marker");
            markerSpan.textContent = getEmptyValueMarker();
          }
        }
      }
    }

    // Row 6
    if (row6HasContent) {
      const row6El = getContainer(6)!.createDiv("property-row property-row-6");
      if (settings.propertyLayout1112SideBySide) {
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
        );

      const has11 =
        field11El.children.length > 0 ||
        field11El.textContent?.trim().length > 0;
      const has12 =
        field12El.children.length > 0 ||
        field12El.textContent?.trim().length > 0;

      const prop11Set = effectiveProps[10] !== "";
      const prop12Set = effectiveProps[11] !== "";

      if (!has11 && !has12) {
        row6El.remove();
      } else if (has11 && !has12) {
        if (prop12Set) {
          const shouldHide =
            (values[11] === null && shouldHideMissingProperties()) ||
            (values[11] === "" && shouldHideEmptyProperties());
          if (!shouldHide) {
            const placeholderContent = field12El.createDiv("property-content");
            const markerSpan =
              placeholderContent.createSpan("empty-value-marker");
            markerSpan.textContent = getEmptyValueMarker();
          }
        }
      } else if (!has11 && has12) {
        if (prop11Set) {
          const shouldHide =
            (values[10] === null && shouldHideMissingProperties()) ||
            (values[10] === "" && shouldHideEmptyProperties());
          if (!shouldHide) {
            const placeholderContent = field11El.createDiv("property-content");
            const markerSpan =
              placeholderContent.createSpan("empty-value-marker");
            markerSpan.textContent = getEmptyValueMarker();
          }
        }
      }
    }

    // Row 7
    if (row7HasContent) {
      const row7El = getContainer(7)!.createDiv("property-row property-row-7");
      if (settings.propertyLayout1314SideBySide) {
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
        );

      const has13 =
        field13El.children.length > 0 ||
        field13El.textContent?.trim().length > 0;
      const has14 =
        field14El.children.length > 0 ||
        field14El.textContent?.trim().length > 0;

      const prop13Set = effectiveProps[12] !== "";
      const prop14Set = effectiveProps[13] !== "";

      if (!has13 && !has14) {
        row7El.remove();
      } else if (has13 && !has14) {
        if (prop14Set) {
          const shouldHide =
            (values[13] === null && shouldHideMissingProperties()) ||
            (values[13] === "" && shouldHideEmptyProperties());
          if (!shouldHide) {
            const placeholderContent = field14El.createDiv("property-content");
            const markerSpan =
              placeholderContent.createSpan("empty-value-marker");
            markerSpan.textContent = getEmptyValueMarker();
          }
        }
      } else if (!has13 && has14) {
        if (prop13Set) {
          const shouldHide =
            (values[12] === null && shouldHideMissingProperties()) ||
            (values[12] === "" && shouldHideEmptyProperties());
          if (!shouldHide) {
            const placeholderContent = field13El.createDiv("property-content");
            const markerSpan =
              placeholderContent.createSpan("empty-value-marker");
            markerSpan.textContent = getEmptyValueMarker();
          }
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
      this.measurePropertyFields(cardEl);
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
  ): void {
    if (propertyName === "") {
      return;
    }

    // Coerce unknown to string for rendering (handles Bases Value objects)
    const stringValue =
      typeof resolvedValue === "string" ? resolvedValue : null;

    // If no value and labels are hidden, render nothing
    if (!stringValue && settings.propertyLabels === "hide") {
      return;
    }

    // Hide missing properties if toggle enabled (stringValue is null for missing properties)
    if (stringValue === null && shouldHideMissingProperties()) {
      return;
    }

    // Hide empty properties if toggle enabled (stringValue is '' for empty properties)
    if (stringValue === "" && shouldHideEmptyProperties()) {
      return;
    }

    // Early return for empty special properties when labels are hidden
    if (settings.propertyLabels === "hide") {
      if (
        (propertyName === "tags" || propertyName === "note.tags") &&
        card.yamlTags.length === 0
      ) {
        return;
      }
      if (
        (propertyName === "file.tags" || propertyName === "file tags") &&
        card.tags.length === 0
      ) {
        return;
      }
      if (
        (propertyName === "file.path" ||
          propertyName === "path" ||
          propertyName === "file path") &&
        card.folderPath.length === 0
      ) {
        return;
      }
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
    const metaContent = contentWrapper.createDiv("property-content");

    // If no value, show placeholder
    if (!stringValue) {
      const markerSpan = metaContent.createSpan("empty-value-marker");
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
          const listWrapper = metaContent.createSpan("list-wrapper");
          const separator = getListSeparator();
          arrayData.items.forEach((item, idx) => {
            const span = listWrapper.createSpan();
            const listItem = span.createSpan({ cls: "list-item" });
            this.renderTextWithLinks(listItem, item);
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
      const timestampWrapper = metaContent.createSpan();
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
      const tagsWrapper = metaContent.createDiv("tags-wrapper");
      card.yamlTags.forEach((tag) => {
        const tagEl = tagsWrapper.createEl("a", {
          cls: "tag",
          text: showHashPrefix ? "#" + tag : tag,
          href: "#",
        });
        tagEl.addEventListener("click", (e) => {
          e.preventDefault();
          const searchPlugin =
            this.plugin.app.internalPlugins.plugins["global-search"];
          if (searchPlugin?.instance?.openGlobalSearch) {
            searchPlugin.instance.openGlobalSearch("tag:" + tag);
          }
        });
      });
    } else if (
      (propertyName === "file.tags" || propertyName === "file tags") &&
      card.tags.length > 0
    ) {
      // tags in YAML + note body
      const showHashPrefix = showTagHashPrefix();
      const tagsWrapper = metaContent.createDiv("tags-wrapper");
      card.tags.forEach((tag) => {
        const tagEl = tagsWrapper.createEl("a", {
          cls: "tag",
          text: showHashPrefix ? "#" + tag : tag,
          href: "#",
        });
        tagEl.addEventListener("click", (e) => {
          e.preventDefault();
          const searchPlugin =
            this.plugin.app.internalPlugins.plugins["global-search"];
          if (searchPlugin?.instance?.openGlobalSearch) {
            searchPlugin.instance.openGlobalSearch("tag:" + tag);
          }
        });
      });
    } else if (
      (propertyName === "file.path" ||
        propertyName === "path" ||
        propertyName === "file path") &&
      card.path.length > 0
    ) {
      const pathWrapper = metaContent.createDiv("path-wrapper");
      // Split full path including filename
      const segments = card.path.split("/").filter((f) => f);
      segments.forEach((segment, idx) => {
        const span = pathWrapper.createSpan();
        const isLastSegment = idx === segments.length - 1;
        const segmentClass = isLastSegment
          ? "path-segment filename-segment"
          : "path-segment file-path-segment";
        const segmentEl = span.createSpan({ cls: segmentClass, text: segment });

        // Make clickable
        const cumulativePath = segments.slice(0, idx + 1).join("/");
        segmentEl.addEventListener("click", (e) => {
          e.stopPropagation();
          if (isLastSegment) {
            // Last segment is filename - open the file
            const file = this.app.vault.getAbstractFileByPath(card.path);
            if (file instanceof TFile) {
              void this.app.workspace.getLeaf(false).openFile(file);
            }
          } else {
            // Folder segment - reveal in file explorer
            const fileExplorer =
              this.app.internalPlugins?.plugins?.["file-explorer"];
            if (fileExplorer?.instance?.revealInFolder) {
              const folderFile =
                this.app.vault.getAbstractFileByPath(cumulativePath);
              if (folderFile) {
                fileExplorer.instance.revealInFolder(folderFile);
              }
            }
          }
        });

        // Add context menu for folder segments
        if (!isLastSegment) {
          segmentEl.addEventListener("contextmenu", (e) => {
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
          });
        }

        if (idx < segments.length - 1) {
          span.createSpan({ cls: "path-separator", text: "/" });
        }
      });
    } else if (
      (propertyName === "file.folder" || propertyName === "folder") &&
      card.folderPath.length > 0
    ) {
      const folderWrapper = metaContent.createDiv("path-wrapper");
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
        segmentEl.addEventListener("click", (e) => {
          e.stopPropagation();
          const fileExplorer =
            this.app.internalPlugins?.plugins?.["file-explorer"];
          if (fileExplorer?.instance?.revealInFolder) {
            const folderFile =
              this.app.vault.getAbstractFileByPath(cumulativePath);
            if (folderFile) {
              fileExplorer.instance.revealInFolder(folderFile);
            }
          }
        });

        // Add context menu for folder segments
        segmentEl.addEventListener("contextmenu", (e) => {
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
        });

        if (idx < folders.length - 1) {
          span.createSpan({ cls: "path-separator", text: "/" });
        }
      });
    } else {
      // Generic property - wrap in div for proper scrolling (consistent with tags/paths)
      const textWrapper = metaContent.createDiv("text-wrapper");
      this.renderTextWithLinks(textWrapper, stringValue);
    }

    // Remove metaContent wrapper if it ended up empty (e.g., tags with no values)
    if (
      !metaContent.textContent ||
      metaContent.textContent.trim().length === 0
    ) {
      metaContent.remove();
    }
  }

  /**
   * Measures property fields for side-by-side layout
   */
  private measurePropertyFields(container: HTMLElement): void {
    const rows = container.querySelectorAll(".property-row-sidebyside");
    rows.forEach((row) => {
      const rowEl = row as HTMLElement;

      const field1 = rowEl.querySelector(
        ".property-field-1, .property-field-3",
      ) as HTMLElement;
      const field2 = rowEl.querySelector(
        ".property-field-2, .property-field-4",
      ) as HTMLElement;

      if (field1 && field2) {
        // Initial measurement
        requestAnimationFrame(() => {
          this.measureSideBySideRow(rowEl, field1, field2);
        });

        // Re-measure on card resize
        const card = rowEl.closest(".card") as HTMLElement;
        const observer = new ResizeObserver(() => {
          this.measureSideBySideRow(rowEl, field1, field2);
        });
        observer.observe(card);
        this.propertyObservers.push(observer);
      }
    });
  }

  /**
   * Measures and applies widths for side-by-side row
   */
  private measureSideBySideRow(
    row: HTMLElement,
    field1: HTMLElement,
    field2: HTMLElement,
  ): void {
    try {
      const card = row.closest(".card") as HTMLElement;
      const cardProperties = row.closest(".card-properties") as HTMLElement;

      // Remove measured state and enter measuring state to remove constraints
      row.removeClass("property-measured");
      row.addClass("property-measuring");

      // Force reflow
      void row.offsetWidth;

      // Measure property-content-wrapper (expands to content width in measuring mode)
      const wrapper1 = field1.querySelector(
        ".property-content-wrapper",
      ) as HTMLElement;
      const wrapper2 = field2.querySelector(
        ".property-content-wrapper",
      ) as HTMLElement;

      // Measure inline labels if present
      const label1 = field1.querySelector(
        ".property-label-inline",
      ) as HTMLElement;
      const label2 = field2.querySelector(
        ".property-label-inline",
      ) as HTMLElement;

      // Total width = wrapper width + label width + gap (if inline label exists)
      // During measuring mode, wrapper has overflow-x: visible and expands to content width
      let width1 = wrapper1 ? wrapper1.scrollWidth : 0;
      let width2 = wrapper2 ? wrapper2.scrollWidth : 0;

      // Add inline label width + gap between label and wrapper
      // Read gap from CSS variable (var(--size-4-1), typically 4px)
      const inlineLabelGap = parseFloat(getComputedStyle(field1).gap) || 4;
      if (label1) {
        width1 += label1.scrollWidth + inlineLabelGap;
      }
      if (label2) {
        width2 += label2.scrollWidth + inlineLabelGap;
      }

      // Calculate available width from card dimensions
      // Can't use row.clientWidth because it lags behind when CSS variables update

      // Get side cover padding from CSS variable (freshly updated by side cover observer)
      const sideCoverPadding =
        parseFloat(
          getComputedStyle(card).getPropertyValue(
            "--dynamic-views-side-cover-content-padding",
          ),
        ) || 0;

      // Calculate available width: cardProperties width = card content width minus side cover
      // For cards with side covers: cardProperties has max-width constraint
      // For cards without: cardProperties spans full card content area
      let containerWidth: number;
      if (sideCoverPadding > 0) {
        // Card has side cover: cardProperties max-width = 100% - sideCoverPadding
        // cardProperties content width = card content width - sideCoverPadding
        const cardContentWidth = card.clientWidth; // Content width (excludes border)
        containerWidth = cardContentWidth - sideCoverPadding;
      } else {
        // No side cover: use cardProperties full width
        containerWidth = cardProperties.clientWidth;
      }

      // Guard against negative or zero width (edge case: very narrow cards or misconfiguration)
      if (containerWidth <= 0) {
        return;
      }

      // Read field gap from CSS variable (var(--dynamic-views-element-spacing, 8px))
      const fieldGap = parseFloat(getComputedStyle(row).gap) || 8;
      const availableWidth = containerWidth - fieldGap;

      const percent1 = (width1 / availableWidth) * 100;
      const percent2 = (width2 / availableWidth) * 100;

      // Calculate optimal widths using smart strategy
      let field1Width: string;
      let field2Width: string;

      if (percent1 <= 50) {
        // Field1 fits: field1 exact, field2 fills remainder
        field1Width = `${width1}px`;
        field2Width = `${availableWidth - width1}px`;
      } else if (percent2 <= 50) {
        // Field2 fits: field2 exact, field1 fills remainder
        field1Width = `${availableWidth - width2}px`;
        field2Width = `${width2}px`;
      } else {
        // Both > 50%: split 50-50
        const half = availableWidth / 2;
        field1Width = `${half}px`;
        field2Width = `${half}px`;
      }

      // Apply calculated values
      row.style.setProperty("--field1-width", field1Width);
      row.style.setProperty("--field2-width", field2Width);
      row.addClass("property-measured");

      // Reset scroll position to 0 for both wrappers (reuse variables from measurement)
      if (wrapper1) wrapper1.scrollLeft = 0;
      if (wrapper2) wrapper2.scrollLeft = 0;

      // Update scroll gradients after layout settles
      // Use double RAF to ensure CSS variables are fully applied before checking scrollability
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          updateScrollGradient(field1);
          updateScrollGradient(field2);
        });
      });
    } finally {
      // Always exit measuring state, even if error occurs
      row.removeClass("property-measuring");
    }
  }
}
