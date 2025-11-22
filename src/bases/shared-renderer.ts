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
  setupScrollGradients,
} from "../shared/scroll-gradient-manager";
import { getTimestampIcon } from "../shared/render-utils";
import {
  getTagStyle,
  showTimestampIcon,
  getEmptyValueMarker,
  shouldHideMissingProperties,
  shouldHideEmptyProperties,
  getListSeparator,
} from "../utils/style-settings";
import { getPropertyLabel } from "../utils/property";
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
  constructor(
    protected app: App,
    protected plugin: DynamicViewsPlugin,
    protected propertyObservers: ResizeObserver[],
    protected updateLayoutRef: { current: (() => void) | null },
  ) {}

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
        // Don't open if clicking on links, tags, or other interactive elements
        const isLink = target.tagName === "A" || target.closest("a");
        const isTag =
          target.classList.contains("tag") || target.closest(".tag");
        const isImage = target.tagName === "IMG";
        const expandOnClick =
          document.body.classList.contains(
            "dynamic-views-thumbnail-expand-click-hold",
          ) ||
          document.body.classList.contains(
            "dynamic-views-thumbnail-expand-click-toggle",
          );
        const shouldBlockImageClick = isImage && expandOnClick;

        if (!isLink && !isTag && !shouldBlockImageClick) {
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

    // Prepare image URLs
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
          this.renderImage(imageEl, imageUrls, format, position, settings);
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
              const newPaddingValue = newTargetWidth + elementSpacing;

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
        });
      }
    }

    // Title - render as link when openFileAction is 'title', otherwise plain text
    if (settings.showTitle) {
      const titleEl = cardEl.createDiv("card-title");

      if (settings.openFileAction === "title") {
        // Render as clickable, draggable link
        const link = titleEl.createEl("a", {
          cls: "internal-link",
          text: card.title,
          attr: { "data-href": card.path, href: card.path, draggable: "true" },
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
    }

    // Make card draggable when openFileAction is 'card'
    if (settings.openFileAction === "card") {
      cardEl.addEventListener("dragstart", handleDrag);
    }

    // Resolve properties once for both top and bottom rendering
    const resolvedProperties = this.resolveCardProperties(
      card,
      entry,
      settings,
    );

    // Properties-top: groups with position='top' (before thumbnail-top, after title)
    this.renderProperties(
      cardEl,
      card,
      entry,
      resolvedProperties,
      settings,
      "top",
    );

    // Thumbnail-top: direct child of card
    if (
      format === "thumbnail" &&
      position === "top" &&
      (hasImage || hasImageAvailable)
    ) {
      if (hasImage) {
        const imageEl = cardEl.createDiv("card-thumbnail");
        this.renderImage(imageEl, imageUrls, format, position, settings);
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
          this.renderImage(imageEl, imageUrls, format, position, settings);
        } else {
          contentContainer.createDiv("card-thumbnail-placeholder");
        }
      }
    }

    // Properties-bottom: groups with position='bottom'
    this.renderProperties(
      cardEl,
      card,
      entry,
      resolvedProperties,
      settings,
      "bottom",
    );

    // Thumbnail-bottom: direct child of card
    if (
      format === "thumbnail" &&
      position === "bottom" &&
      (hasImage || hasImageAvailable)
    ) {
      if (hasImage) {
        const imageEl = cardEl.createDiv("card-thumbnail");
        this.renderImage(imageEl, imageUrls, format, position, settings);
      } else {
        cardEl.createDiv("card-thumbnail-placeholder");
      }
    }
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

      // Position new slide off-screen in the direction it will enter from
      newSlide.removeClass("is-active", "slide-left", "slide-right");
      newSlide.addClass(direction === "next" ? "slide-right" : "slide-left");

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
  ): void {
    const imageEmbedClasses =
      settings.expandImagesOnClick === "off"
        ? "internal-embed media-embed image-embed is-loaded"
        : "image-embed";
    const imageEmbedContainer = imageEl.createDiv(imageEmbedClasses);

    // Add native embed attributes when zoom is off
    if (settings.expandImagesOnClick === "off") {
      // Extract filename from app:// URL - get last path segment and remove query string
      const urlPath = imageUrls[0].split("/").pop() || "";
      const filename = urlPath.split("?")[0];
      imageEmbedContainer.setAttr("src", filename);
      imageEmbedContainer.setAttr("alt", filename);
      imageEmbedContainer.setAttr("tabindex", "-1");
      imageEmbedContainer.setAttr("contenteditable", "false");
    }

    // Add zoom handler only when zoom is enabled
    if (settings.expandImagesOnClick !== "off") {
      imageEmbedContainer.addEventListener("click", (e) => {
        const isToggleMode = document.body.classList.contains(
          "dynamic-views-thumbnail-expand-click-toggle",
        );
        const isHoldMode = document.body.classList.contains(
          "dynamic-views-thumbnail-expand-click-hold",
        );

        if (isToggleMode || isHoldMode) {
          e.stopPropagation();

          if (isToggleMode) {
            const embedEl = e.currentTarget as HTMLElement;
            const isZoomed = embedEl.classList.contains("is-zoomed");

            if (isZoomed) {
              // Close zoom
              embedEl.classList.remove("is-zoomed");
            } else {
              // Close all other zoomed images first
              document
                .querySelectorAll(".image-embed.is-zoomed")
                .forEach((el) => {
                  el.classList.remove("is-zoomed");
                });
              // Open this one
              embedEl.classList.add("is-zoomed");

              // Add listeners for closing
              const closeZoom = (evt: Event) => {
                const target = evt.target as HTMLElement;
                // Don't close if clicking on the zoomed image itself
                if (!embedEl.contains(target)) {
                  embedEl.classList.remove("is-zoomed");
                  document.removeEventListener("click", closeZoom);
                  document.removeEventListener("keydown", handleEscape);
                }
              };

              const handleEscape = (evt: KeyboardEvent) => {
                if (evt.key === "Escape") {
                  embedEl.classList.remove("is-zoomed");
                  document.removeEventListener("click", closeZoom);
                  document.removeEventListener("keydown", handleEscape);
                }
              };

              // Delay adding listeners to avoid immediate trigger
              setTimeout(() => {
                document.addEventListener("click", closeZoom);
                document.addEventListener("keydown", handleEscape);
              }, 0);
            }
          }
        }
      });
    }

    const imgEl = imageEmbedContainer.createEl("img", {
      attr: { src: imageUrls[0], alt: "" },
    });
    // Set CSS variable for letterbox blur background
    imageEmbedContainer.style.setProperty(
      "--cover-image-url",
      `url("${imageUrls[0]}")`,
    );

    // Handle image load for masonry layout and color extraction
    const cardEl = imageEl.closest(".card") as HTMLElement;
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
   * Resolves properties for a card (shared between top and bottom rendering)
   */
  private resolveCardProperties(
    card: CardData,
    entry: BasesEntry,
    settings: Settings,
  ): {
    effectiveProps: string[];
    values: (string | null)[];
    rowHasContent: boolean[];
  } {
    // Get all 10 property names
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
    ];

    // Detect duplicates (priority: 1 > 2 > 3 > 4 > 5 > 6 > 7 > 8 > 9 > 10)
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
    const rowHasContent = [
      settings.propertyLabels !== "hide"
        ? effectiveProps[0] !== "" || effectiveProps[1] !== ""
        : values[0] !== null || values[1] !== null,
      settings.propertyLabels !== "hide"
        ? effectiveProps[2] !== "" || effectiveProps[3] !== ""
        : values[2] !== null || values[3] !== null,
      settings.propertyLabels !== "hide"
        ? effectiveProps[4] !== "" || effectiveProps[5] !== ""
        : values[4] !== null || values[5] !== null,
      settings.propertyLabels !== "hide"
        ? effectiveProps[6] !== "" || effectiveProps[7] !== ""
        : values[6] !== null || values[7] !== null,
      settings.propertyLabels !== "hide"
        ? effectiveProps[8] !== "" || effectiveProps[9] !== ""
        : values[8] !== null || values[9] !== null,
    ];

    return { effectiveProps, values, rowHasContent };
  }

  /**
   * Renders property fields for a card
   */
  private renderProperties(
    cardEl: HTMLElement,
    card: CardData,
    entry: BasesEntry,
    resolvedProps: {
      effectiveProps: string[];
      values: (string | null)[];
      rowHasContent: boolean[];
    },
    settings: Settings,
    position: "top" | "bottom",
  ): void {
    const { effectiveProps, values, rowHasContent } = resolvedProps;

    // Filter rows by position setting
    const row1Visible =
      rowHasContent[0] && settings.propertyGroup1Position === position;
    const row2Visible =
      rowHasContent[1] && settings.propertyGroup2Position === position;
    const row3Visible =
      rowHasContent[2] && settings.propertyGroup3Position === position;
    const row4Visible =
      rowHasContent[3] && settings.propertyGroup4Position === position;
    const row5Visible =
      rowHasContent[4] && settings.propertyGroup5Position === position;

    if (
      !row1Visible &&
      !row2Visible &&
      !row3Visible &&
      !row4Visible &&
      !row5Visible
    )
      return;

    // Add class to indicate label visibility state
    const labelClass =
      settings.propertyLabels === "hide" ? "property-labels-hidden" : "";
    const metaEl = cardEl.createDiv(
      `card-properties card-properties-${position} ${labelClass}`.trim(),
    );

    // Row 1
    if (row1Visible) {
      const row1El = metaEl.createDiv("property-row property-row-1");
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
    if (row2Visible) {
      const row2El = metaEl.createDiv("property-row property-row-2");
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
    if (row3Visible) {
      const row3El = metaEl.createDiv("property-row property-row-3");
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

      // Check actual rendered content
      const has5 =
        field5El.children.length > 0 || field5El.textContent?.trim().length > 0;
      const has6 =
        field6El.children.length > 0 || field6El.textContent?.trim().length > 0;

      // Check if properties are actually set (not empty string from duplicate/empty slots)
      const prop5Set = effectiveProps[4] !== "";
      const prop6Set = effectiveProps[5] !== "";

      if (!has5 && !has6) {
        row3El.remove();
      } else if (has5 && !has6) {
        // Field 5 has content, field 6 empty
        // Add placeholder ONLY if prop6 is set AND not hidden by toggles
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
        // Field 6 has content, field 5 empty
        // Add placeholder ONLY if prop5 is set AND not hidden by toggles
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
      // Keep both fields in DOM for proper positioning (field 6 stays right-aligned)
    }

    // Row 4
    if (row4Visible) {
      const row4El = metaEl.createDiv("property-row property-row-4");
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

      // Check actual rendered content
      const has7 =
        field7El.children.length > 0 || field7El.textContent?.trim().length > 0;
      const has8 =
        field8El.children.length > 0 || field8El.textContent?.trim().length > 0;

      // Check if properties are actually set (not empty string from duplicate/empty slots)
      const prop7Set = effectiveProps[6] !== "";
      const prop8Set = effectiveProps[7] !== "";

      if (!has7 && !has8) {
        row4El.remove();
      } else if (has7 && !has8) {
        // Field 7 has content, field 8 empty
        // Add placeholder ONLY if prop8 is set AND not hidden by toggles
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
        // Field 8 has content, field 7 empty
        // Add placeholder ONLY if prop7 is set AND not hidden by toggles
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
      // Keep both fields in DOM for proper positioning (field 8 stays right-aligned)
    }

    // Row 5
    if (row5Visible) {
      const row5El = metaEl.createDiv("property-row property-row-5");
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

      // Check actual rendered content
      const has9 =
        field9El.children.length > 0 || field9El.textContent?.trim().length > 0;
      const has10 =
        field10El.children.length > 0 ||
        field10El.textContent?.trim().length > 0;

      // Check if properties are actually set (not empty string from duplicate/empty slots)
      const prop9Set = effectiveProps[8] !== "";
      const prop10Set = effectiveProps[9] !== "";

      if (!has9 && !has10) {
        row5El.remove();
      } else if (has9 && !has10) {
        // Field 9 has content, field 10 empty
        // Add placeholder ONLY if prop10 is set AND not hidden by toggles
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
        // Field 10 has content, field 9 empty
        // Add placeholder ONLY if prop9 is set AND not hidden by toggles
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
      // Keep both fields in DOM for proper positioning (field 10 stays right-aligned)
    }

    // Remove meta container if no rows remain
    if (metaEl.children.length === 0) {
      metaEl.remove();
    } else {
      // Measure side-by-side field widths
      this.measurePropertyFields(cardEl);
      // Setup scroll gradients for tags and paths
      setupScrollGradients(
        cardEl,
        this.propertyObservers,
        updateScrollGradient,
      );
    }
  }

  /**
   * Renders individual property content
   */
  private renderPropertyContent(
    container: HTMLElement,
    propertyName: string,
    resolvedValue: string | null,
    card: CardData,
    entry: BasesEntry,
    settings: Settings,
  ): void {
    if (propertyName === "") {
      return;
    }

    // If no value and labels are hidden, render nothing
    if (!resolvedValue && settings.propertyLabels === "hide") {
      return;
    }

    // Hide missing properties if toggle enabled (resolvedValue is null for missing properties)
    if (resolvedValue === null && shouldHideMissingProperties()) {
      return;
    }

    // Hide empty properties if toggle enabled (resolvedValue is '' for empty properties)
    if (resolvedValue === "" && shouldHideEmptyProperties()) {
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
    if (!resolvedValue) {
      const markerSpan = metaContent.createSpan("empty-value-marker");
      markerSpan.textContent = getEmptyValueMarker();
      return;
    }

    // Handle array properties - render as individual spans with separators
    if (resolvedValue.startsWith('{"type":"array","items":[')) {
      try {
        const arrayData = JSON.parse(resolvedValue) as {
          type: string;
          items: string[];
        };
        if (arrayData.type === "array" && Array.isArray(arrayData.items)) {
          const listWrapper = metaContent.createSpan("list-wrapper");
          const separator = getListSeparator();
          arrayData.items.forEach((item, idx) => {
            const span = listWrapper.createSpan();
            span.createSpan({ cls: "list-item", text: item });
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
      // resolvedValue is already formatted by data-transform
      const timestampWrapper = metaContent.createSpan();
      if (showTimestampIcon() && settings.propertyLabels === "hide") {
        const iconName = getTimestampIcon(propertyName, settings);
        const iconEl = timestampWrapper.createSpan("timestamp-icon");
        setIcon(iconEl, iconName);
      }
      timestampWrapper.appendText(resolvedValue);
    } else if (
      (propertyName === "tags" || propertyName === "note.tags") &&
      card.yamlTags.length > 0
    ) {
      // YAML tags only
      const tagStyle = getTagStyle();
      const showHashPrefix = tagStyle === "minimal";
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
      const tagStyle = getTagStyle();
      const showHashPrefix = tagStyle === "minimal";
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
      textWrapper.appendText(resolvedValue);
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
        ".property-field-1, .property-field-3, .property-field-5, .property-field-7, .property-field-9",
      ) as HTMLElement;
      const field2 = rowEl.querySelector(
        ".property-field-2, .property-field-4, .property-field-6, .property-field-8, .property-field-10",
      ) as HTMLElement;

      if (field1 && field2) {
        // Initial measurement
        requestAnimationFrame(() => {
          this.measureSideBySideRow(rowEl, field1, field2);
        });

        // Re-measure on card resize (debounced to avoid measurement during scroll)
        const card = rowEl.closest(".card") as HTMLElement;
        let resizeTimeout: number | null = null;
        const observer = new ResizeObserver(() => {
          if (resizeTimeout !== null) {
            clearTimeout(resizeTimeout);
          }
          resizeTimeout = window.setTimeout(() => {
            this.measureSideBySideRow(rowEl, field1, field2);
            resizeTimeout = null;
          }, 150);
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
      // const cardPath = card.getAttribute('data-path') || 'unknown';

      // console.log(`[Width Allocation] Starting measurement for card: ${cardPath}`);

      // === PHASE 1: DOM WRITES (class changes) ===
      row.removeClass("property-measured");
      row.addClass("property-measuring");
      // console.log('[Width Allocation] Entered measuring state');

      // Force reflow once after class changes
      void row.offsetWidth;

      // === PHASE 2: DOM READS (batch all layout measurements) ===
      // Get element references
      const content1 = field1.querySelector(".property-content") as HTMLElement;
      const content2 = field2.querySelector(".property-content") as HTMLElement;
      const wrapper1 = field1.querySelector(
        ".property-content-wrapper",
      ) as HTMLElement;
      const wrapper2 = field2.querySelector(
        ".property-content-wrapper",
      ) as HTMLElement;
      const label1 = field1.querySelector(
        ".property-label-inline",
      ) as HTMLElement;
      const label2 = field2.querySelector(
        ".property-label-inline",
      ) as HTMLElement;

      // Batch read all dimensions at once
      const content1Width = content1 ? content1.scrollWidth : 0;
      const content2Width = content2 ? content2.scrollWidth : 0;
      // const wrapper1Width = wrapper1?.clientWidth || 0;
      // const wrapper2Width = wrapper2?.clientWidth || 0;
      const label1Width = label1 ? label1.scrollWidth : 0;
      const label2Width = label2 ? label2.scrollWidth : 0;
      const inlineLabelGap = parseFloat(getComputedStyle(field1).gap) || 4;
      const sideCoverPadding =
        parseFloat(
          getComputedStyle(card).getPropertyValue(
            "--dynamic-views-side-cover-content-padding",
          ),
        ) || 0;
      const cardWidth = card.clientWidth;
      const cardPropertiesWidth = cardProperties.clientWidth;
      const fieldGap = parseFloat(getComputedStyle(row).gap) || 4;

      // console.log('[Width Allocation] Initial wrapper measurements:', {
      //     wrapper1ScrollWidth: content1Width,
      //     wrapper2ScrollWidth: content2Width,
      //     wrapper1ClientWidth: wrapper1Width,
      //     wrapper2ClientWidth: wrapper2Width
      // });

      // === PHASE 3: CALCULATIONS (pure JS, no DOM access) ===
      // Calculate total field widths (content + label + gap)
      let width1 = content1Width;
      let width2 = content2Width;

      if (label1) {
        // console.log(`[Width Allocation] Field 1 has inline label, width: ${label1Width}px, gap: ${inlineLabelGap}px`);
        width1 += label1Width + inlineLabelGap;
      }
      if (label2) {
        // console.log(`[Width Allocation] Field 2 has inline label, width: ${label2Width}px, gap: ${inlineLabelGap}px`);
        width2 += label2Width + inlineLabelGap;
      }

      // console.log('[Width Allocation] Total field widths (content + label):', {
      //     field1Total: width1,
      //     field2Total: width2
      // });

      // console.log('[Width Allocation] Container measurements:', {
      //     cardClientWidth: cardWidth,
      //     cardPropertiesClientWidth: cardPropertiesWidth,
      //     sideCoverPadding: sideCoverPadding
      // });

      // Calculate available width
      let containerWidth: number;
      if (sideCoverPadding > 0) {
        containerWidth = cardWidth - sideCoverPadding;
        // console.log(`[Width Allocation] Card has side cover: containerWidth = ${cardWidth} - ${sideCoverPadding} = ${containerWidth}px`);
      } else {
        containerWidth = cardPropertiesWidth;
        // console.log(`[Width Allocation] No side cover: using cardProperties width = ${containerWidth}px`);
      }

      if (containerWidth <= 0) {
        return;
      }

      const availableWidth = containerWidth - fieldGap;

      // console.log('[Width Allocation] Available space calculation:', {
      //     containerWidth: containerWidth,
      //     fieldGap: fieldGap,
      //     availableWidth: availableWidth
      // });

      const percent1 = (width1 / availableWidth) * 100;
      const percent2 = (width2 / availableWidth) * 100;

      // console.log('[Width Allocation] Field percentages:', {
      //     field1Percent: percent1.toFixed(2) + '%',
      //     field2Percent: percent2.toFixed(2) + '%'
      // });

      // Calculate optimal widths using smart strategy
      let field1Width: string;
      let field2Width: string;
      // let strategy: string;

      if (percent1 <= 50) {
        // Field1 fits: field1 exact, field2 fills remainder
        field1Width = `${width1}px`;
        field2Width = `${availableWidth - width1}px`;
        // strategy = 'Field1 ≤50%: field1 exact, field2 remainder';
      } else if (percent2 <= 50) {
        // Field2 fits: field2 exact, field1 fills remainder
        field1Width = `${availableWidth - width2}px`;
        field2Width = `${width2}px`;
        // strategy = 'Field2 ≤50%: field2 exact, field1 remainder';
      } else {
        // Both > 50%: split 50-50 (floor field1, ceil field2 to handle sub-pixel rounding)
        const half = availableWidth / 2;
        field1Width = `${Math.floor(half)}px`;
        field2Width = `${Math.ceil(half)}px`;
        // strategy = 'Both >50%: split 50-50';
      }

      // console.log('[Width Allocation] Strategy selected:', strategy);
      // console.log('[Width Allocation] Final widths:', {
      //     field1Width: field1Width,
      //     field2Width: field2Width,
      //     sum: parseFloat(field1Width) + parseFloat(field2Width),
      //     expectedSum: availableWidth
      // });

      // === PHASE 4: DOM WRITES (batch all style changes) ===
      row.style.setProperty("--field1-width", field1Width);
      row.style.setProperty("--field2-width", field2Width);
      row.addClass("property-measured");
      if (wrapper1) wrapper1.scrollLeft = 0;
      if (wrapper2) wrapper2.scrollLeft = 0;
      // console.log('[Width Allocation] Applied CSS variables, added property-measured class, reset scroll positions');

      // Update scroll gradients after layout settles
      // Use double RAF to ensure CSS variables are fully applied before checking scrollability
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          // console.log('[Width Allocation] Updating scroll gradients after RAF');
          updateScrollGradient(field1);
          updateScrollGradient(field2);
        });
      });
    } finally {
      // Always exit measuring state, even if error occurs
      row.removeClass("property-measuring");
      // console.log('[Width Allocation] Exited measuring state');
    }
  }
}
