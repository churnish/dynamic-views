/**
 * Shared card renderer - Pure rendering component
 * Works with both Bases and Datacore by accepting normalized card data
 */

import type { App, PaneType } from "obsidian";
import { TFile, TFolder, setIcon, Menu, Keymap } from "obsidian";
import type { Settings } from "../types";
import type { RefObject } from "../datacore/types";
import {
  showTagHashPrefix,
  getHideEmptyMode,
  showTimestampIcon,
  getEmptyValueMarker,
  shouldHideMissingProperties,
  getListSeparator,
  isSlideshowEnabled,
  isSlideshowIndicatorEnabled,
  isThumbnailScrubbingDisabled,
  getSlideshowMaxImages,
} from "../utils/style-settings";
import { getPropertyLabel, normalizePropertyName } from "../utils/property";
import { findLinksInText, type ParsedLink } from "../utils/link-parser";
import {
  getFileExtInfo,
  getFileTypeIcon,
  stripExtFromTitle,
} from "../utils/file-extension";
import {
  handleJsxImageRef,
  handleJsxImageLoad,
  handleJsxImageError,
  handleImageLoad,
  DEFAULT_ASPECT_RATIO,
} from "./image-loader";
import { handleImageViewerClick, cleanupAllViewers } from "./image-viewer";
import {
  createSlideshowNavigator,
  getCachedBlobUrl,
  isFailedExternalUrl,
  markExternalUrlAsFailed,
  setupImagePreload,
  setupSwipeGestures,
} from "./slideshow";
import {
  showFileContextMenu,
  showExternalLinkContextMenu,
} from "./context-menu";
import {
  updateScrollGradient,
  setupScrollGradients,
  setupElementScrollGradient,
} from "./scroll-gradient";
import { handleArrowNavigation, isArrowKey } from "./keyboard-nav";

import {
  isTagProperty,
  isFileProperty,
  isFormulaProperty,
  shouldCollapseField,
} from "./property-helpers";
import {
  shouldUseNotebookNavigator,
  navigateToTagInNotebookNavigator,
  navigateToFolderInNotebookNavigator,
  revealFileInNotebookNavigator,
} from "../utils/notebook-navigator";
import { measurePropertyFields } from "./property-measure";

/**
 * Extended container element with focus management properties
 * Used by CardRenderer for keyboard navigation and text selection
 */
interface CardContainerElement extends HTMLElement {
  _intentionalFocus?: boolean;
  _lastKey?: string | null;
  _mouseDown?: boolean;
  _keyboardNavActive?: boolean;
}

/**
 * Render file type icon as JSX
 */
function renderFileTypeIcon(path: string) {
  const icon = getFileTypeIcon(path);
  if (!icon) return null;

  return (
    <span
      className="card-title-icon"
      ref={(el: HTMLElement | null) => {
        if (el) setIcon(el, icon);
      }}
    />
  );
}

/**
 * Render file format indicator as JSX (for Badge mode)
 * Text content not rendered - CSS uses data-ext via ::before
 */
function renderFileExt(extInfo: { ext: string } | null) {
  if (!extInfo) return null;
  const extNoDot = extInfo.ext.slice(1);
  return <span className="card-title-ext" data-ext={extNoDot} />;
}

/**
 * Create a drag handler for file elements (used by card-level drag)
 */
function createFileDragHandler(app: App, path: string) {
  return (e: DragEvent) => {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const dragData = app.dragManager.dragFile(e, file);
    app.dragManager.onDragStart(e, dragData);
  };
}

/**
 * Set up title truncation with extension preservation.
 * Truncates title text while keeping extension visible at end.
 */
function setupTitleTruncation(titleEl: HTMLElement, signal: AbortSignal): void {
  const textEl = titleEl.querySelector<HTMLElement>(".card-title-text");
  const extEl = titleEl.querySelector<HTMLElement>(".card-title-ext-suffix");

  if (!textEl) return;

  const fullText = (textEl.textContent || "").trim();
  if (fullText.length === 0) return; // Skip empty titles

  const ellipsis = "…";

  // Get max height from CSS (returns 0 if invalid)
  const getMaxHeight = () => {
    const style = getComputedStyle(titleEl);
    const lineHeight = parseFloat(style.lineHeight);
    const maxLines = parseInt(
      style.getPropertyValue("--dynamic-views-title-lines") || "2",
    );
    if (maxLines <= 0 || !isFinite(lineHeight)) return 0;
    return Math.ceil(lineHeight * maxLines) + 1;
  };

  const truncate = () => {
    // Skip if no width (hidden tab)
    if (titleEl.offsetWidth === 0) return;

    const maxHeight = getMaxHeight();
    if (maxHeight <= 0) return; // Invalid CSS config

    const currentText = textEl.textContent || "";

    // Reset to full text only if currently truncated
    if (currentText !== fullText) {
      textEl.textContent = fullText;
    }

    // Check if truncation needed
    if (titleEl.scrollHeight <= maxHeight) return;

    // Binary search for max text that fits with ellipsis + extension
    let low = 1;
    let high = fullText.length;

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

    // Safety: reduce further if still overflowing
    while (titleEl.scrollHeight > maxHeight && low > 1) {
      low--;
      textEl.textContent = fullText.slice(0, low).trimEnd() + ellipsis;
    }
  };

  // Only truncate in Extension mode (when extension suffix is visible)
  const isExtensionMode = () =>
    extEl && getComputedStyle(extEl).display !== "none";

  const check = () => {
    if (isExtensionMode()) {
      truncate();
    }
    // Non-extension modes use CSS line-clamp (no JS needed)
  };

  const observer = new ResizeObserver(check);
  observer.observe(titleEl);
  check(); // Initial check

  signal.addEventListener("abort", () => observer.disconnect());
}

/**
 * Render a single link as JSX
 */
function renderLink(link: ParsedLink, app: App): JSX.Element {
  // Internal link (wikilink or markdown internal)
  if (link.type === "internal") {
    if (link.isEmbed) {
      // Embedded internal link - render as embed container
      return (
        <span
          className="internal-embed"
          data-src={link.url}
          onClick={(e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const paneType = Keymap.isModEvent(e);
            void app.workspace.openLinkText(link.url, "", paneType || false);
          }}
        >
          {link.caption}
        </span>
      );
    }
    // Regular internal link
    return (
      <a
        href={link.url}
        className="internal-link"
        data-href={link.url}
        tabIndex={-1}
        draggable={true}
        onClick={(e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          const paneType = Keymap.isModEvent(e);
          void app.workspace.openLinkText(link.url, "", paneType || false);
        }}
        onDragStart={(e: DragEvent) => {
          e.stopPropagation();
          const file = app.metadataCache.getFirstLinkpathDest(link.url, "");
          if (!(file instanceof TFile)) return;
          const dragData = app.dragManager.dragFile(e, file);
          app.dragManager.onDragStart(e, dragData);
        }}
        onContextMenu={(e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          const file = app.metadataCache.getFirstLinkpathDest(link.url, "");
          if (file instanceof TFile) {
            showFileContextMenu(e, app, file, link.url);
          }
        }}
      >
        {link.caption}
      </a>
    );
  }

  // External link
  if (link.isEmbed) {
    // Embedded external link (image)
    return (
      <img
        src={link.url}
        alt={link.caption}
        className="external-embed"
        onClick={(e: MouseEvent) => {
          e.stopPropagation();
        }}
      />
    );
  }
  // Regular external link
  // Only open in new tab for web URLs, not custom URIs like obsidian://
  return (
    <a
      href={link.url}
      className="external-link"
      tabIndex={-1}
      target={link.isWebUrl ? "_blank" : undefined}
      rel={link.isWebUrl ? "noopener noreferrer" : undefined}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
      }}
      onDragStart={(e: DragEvent) => {
        e.stopPropagation();
        e.dataTransfer?.clearData();
        // Bare link (caption === url) → plain URL; captioned → markdown link
        const dragText =
          link.caption === link.url
            ? link.url
            : `[${link.caption}](${link.url})`;
        e.dataTransfer?.setData("text/plain", dragText);
      }}
      onContextMenu={(e: MouseEvent) => {
        showExternalLinkContextMenu(e, link.url);
      }}
    >
      {link.caption}
    </a>
  );
}

/**
 * Parse text and render links as clickable elements
 * Uses findLinksInText utility for comprehensive link detection in mixed content
 */
// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- JSX.Element resolves to any due to Datacore's JSX runtime
function renderTextWithLinks(text: string, app: App): JSX.Element | string {
  const segments = findLinksInText(text);

  // Use array of elements/strings - text segments don't need span wrapper
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- JSX.Element resolves to any due to Datacore's JSX runtime
  const elements: (JSX.Element | string)[] = [];
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment.type === "text") {
      // Render text directly without span wrapper to preserve whitespace
      elements.push(segment.content);
    } else {
      elements.push(<span key={i}>{renderLink(segment.link, app)}</span>);
    }
  }

  return <>{elements}</>;
}

// Module-level Maps to store zoom cleanup functions and original parents
const viewerCleanupFns = new Map<HTMLElement, () => void>();
const viewerClones = new Map<HTMLElement, HTMLElement>();

// Module-level Map to store ResizeObservers for cleanup
const cardResizeObservers = new Map<string, ResizeObserver>();

// Module-level Map to store responsive ResizeObservers (compact mode, thumbnail stacking)
const cardResponsiveObservers = new Map<string, ResizeObserver>();

// Module-level Map to store property measurement ResizeObservers
const cardPropertyObservers = new Map<string, ResizeObserver[]>();

// Module-level Map to store AbortControllers for scroll listener cleanup
const cardScrollAbortControllers = new Map<string, AbortController>();

/**
 * Cleanup ResizeObserver for a card when it's removed
 */
export function cleanupCardObserver(cardPath: string): void {
  const observer = cardResizeObservers.get(cardPath);
  if (observer) {
    observer.disconnect();
    cardResizeObservers.delete(cardPath);
  }
  const responsiveObserver = cardResponsiveObservers.get(cardPath);
  if (responsiveObserver) {
    responsiveObserver.disconnect();
    cardResponsiveObservers.delete(cardPath);
  }
  const propertyObservers = cardPropertyObservers.get(cardPath);
  if (propertyObservers) {
    propertyObservers.forEach((obs) => obs.disconnect());
    cardPropertyObservers.delete(cardPath);
  }
}

/**
 * Cleanup all card ResizeObservers (call when view is destroyed)
 */
export function cleanupAllCardObservers(): void {
  cardResizeObservers.forEach((observer) => observer.disconnect());
  cardResizeObservers.clear();
  cardResponsiveObservers.forEach((observer) => observer.disconnect());
  cardResponsiveObservers.clear();
  cardPropertyObservers.forEach((observers) =>
    observers.forEach((obs) => obs.disconnect()),
  );
  cardPropertyObservers.clear();
}

/**
 * Cleanup scroll listeners for a card when it's removed
 */
export function cleanupCardScrollListeners(cardPath: string): void {
  const controller = cardScrollAbortControllers.get(cardPath);
  if (controller) {
    controller.abort();
    cardScrollAbortControllers.delete(cardPath);
  }
}

/**
 * Cleanup all card scroll listeners (call when view is destroyed)
 */
export function cleanupAllCardScrollListeners(): void {
  cardScrollAbortControllers.forEach((controller) => controller.abort());
  cardScrollAbortControllers.clear();
}

/**
 * Cleanup all image viewer clones and listeners (call when view is destroyed)
 */
export function cleanupAllImageViewers(): void {
  cleanupAllViewers(viewerCleanupFns, viewerClones);
}

// Extend App type to include isMobile property and dragManager
declare module "obsidian" {
  interface App {
    isMobile: boolean;
    internalPlugins: {
      plugins: Record<
        string,
        {
          enabled: boolean;
          instance?: {
            openGlobalSearch?: (query: string) => void;
            revealInFolder?: (file: unknown) => void;
          };
        }
      >;
      getPluginById(id: string): { instance?: unknown } | null;
    };
    dragManager: {
      dragFile(evt: DragEvent, file: TFile): unknown;
      onDragStart(evt: DragEvent, dragData: unknown): void;
    };
  }
}

/** Normalized card data structure (framework-agnostic) */
export interface CardData {
  path: string;
  name: string;
  title: string;
  tags: string[]; // tags in YAML + note body (file.tags property)
  yamlTags: string[]; // YAML tags only (tags property)
  ctime: number; // milliseconds
  mtime: number; // milliseconds
  folderPath: string;
  textPreview?: string;
  subtitle?: string;
  imageUrl?: string | string[];
  urlValue?: string | null;
  hasValidUrl?: boolean;
  // Property names (for rendering special properties)
  propertyName1?: string;
  propertyName2?: string;
  propertyName3?: string;
  propertyName4?: string;
  propertyName5?: string;
  propertyName6?: string;
  propertyName7?: string;
  propertyName8?: string;
  propertyName9?: string;
  propertyName10?: string;
  propertyName11?: string;
  propertyName12?: string;
  propertyName13?: string;
  propertyName14?: string;
  // Resolved property values (null if missing/empty, unknown for Bases Value objects)
  property1?: unknown;
  property2?: unknown;
  property3?: unknown;
  property4?: unknown;
  property5?: unknown;
  property6?: unknown;
  property7?: unknown;
  property8?: unknown;
  property9?: unknown;
  property10?: unknown;
  property11?: unknown;
  property12?: unknown;
  property13?: unknown;
  property14?: unknown;
}

export interface CardRendererProps {
  cards: CardData[];
  settings: Settings;
  viewMode: "card" | "masonry";
  sortMethod: string;
  isShuffled: boolean;
  focusableCardIndex: number;
  hoveredCardRef: RefObject<HTMLElement | null>;
  containerRef: RefObject<HTMLElement | null>;
  updateLayoutRef: RefObject<(() => void) | null>;
  app: App;
  onCardClick?: (path: string, paneType: PaneType | boolean) => void;
  onFocusChange?: (index: number) => void;
}

/**
 * Wrapper for shouldCollapseField that handles Datacore-specific concerns:
 * - undefined propertyName (no property configured)
 * - unknown resolvedValue type (convert to string | null)
 */
function shouldCollapseFieldDatacore(
  propertyName: string | undefined,
  resolvedValue: unknown,
  propertyLabels: "hide" | "inline" | "above",
  hideEmptyMode: "show" | "labels-hidden" | "all",
  hideMissing: boolean,
): boolean {
  // No property configured - collapse if labels hidden (for layout)
  if (!propertyName) {
    return propertyLabels === "hide";
  }
  // Convert unknown to string | null for shared function
  const stringValue = typeof resolvedValue === "string" ? resolvedValue : null;
  return shouldCollapseField(
    stringValue,
    propertyName,
    hideMissing,
    hideEmptyMode,
    propertyLabels,
  );
}

/**
 * Helper function to render property content based on display type
 */
function renderPropertyContent(
  propertyName: string,
  card: CardData,
  resolvedValue: unknown,
  timeIcon: "calendar" | "clock",
  settings: Settings,
  app: App,
): unknown {
  // Coerce unknown to string for rendering
  const stringValue = typeof resolvedValue === "string" ? resolvedValue : "";
  return renderProperty(
    propertyName,
    null,
    stringValue,
    settings,
    card,
    app,
    timeIcon,
  );
}

/**
 * Cover slideshow component for multiple images
 * Uses two-image swap with keyframe animations (0.4.0 carousel approach)
 */
function CoverSlideshow({
  imageArray,
  updateLayoutRef,
  cardPath,
  app,
  openFileAction,
}: {
  imageArray: string[];
  updateLayoutRef: RefObject<(() => void) | null>;
  cardPath: string;
  app: App;
  openFileAction: "card" | "title";
}): JSX.Element {
  const onSlideshowRef = (slideshowEl: HTMLElement | null) => {
    if (!slideshowEl) return;

    // Cleanup any existing slideshow listeners (for re-renders)
    const existingController = (
      slideshowEl as HTMLElement & { _slideshowController?: AbortController }
    )._slideshowController;
    if (existingController) {
      existingController.abort();
    }

    // Create AbortController for cleanup
    const controller = new AbortController();
    const { signal } = controller;
    (
      slideshowEl as HTMLElement & { _slideshowController?: AbortController }
    )._slideshowController = controller;

    const imageEmbed = slideshowEl.querySelector(
      ".dynamic-views-image-embed",
    ) as HTMLElement;
    if (!imageEmbed) return;

    const cardEl = slideshowEl.closest(".card") as HTMLElement;

    // Setup image preloading
    if (cardEl) {
      setupImagePreload(cardEl, imageArray, signal);
    }

    // Create navigator with shared logic
    const { navigate } = createSlideshowNavigator(
      imageArray,
      () => {
        const currImg = imageEmbed.querySelector(
          ".slideshow-img-current",
        ) as HTMLImageElement;
        const nextImg = imageEmbed.querySelector(
          ".slideshow-img-next",
        ) as HTMLImageElement;
        if (!currImg || !nextImg) return null;
        return { imageEmbed, currImg, nextImg };
      },
      signal,
      {
        onSlideChange: (_newIndex, nextImg) => {
          if (cardEl) {
            handleImageLoad(
              nextImg,
              imageEmbed,
              cardEl,
              updateLayoutRef.current,
            );
          }
        },
        onAnimationComplete: () => {
          if (updateLayoutRef.current) updateLayoutRef.current();
        },
      },
    );

    // Auto-advance if first image fails to load (skip animation for instant display)
    const firstImg = imageEmbed.querySelector(
      ".slideshow-img-current",
    ) as HTMLImageElement;
    if (firstImg) {
      const expectedFirstUrl = imageArray[0];
      firstImg.addEventListener(
        "error",
        () => {
          // Ignore errors from src being cleared (resolves to index.html)
          if (
            !firstImg.src ||
            !firstImg.src.includes(expectedFirstUrl.split("?")[0].slice(-30))
          ) {
            return;
          }
          markExternalUrlAsFailed(firstImg.src);
          firstImg.style.display = "none";
          navigate(1, false, true);
        },
        { once: true, signal },
      );
    }

    // Setup arrow navigation
    const leftArrow = slideshowEl.querySelector(".slideshow-nav-left");
    const rightArrow = slideshowEl.querySelector(".slideshow-nav-right");

    leftArrow?.addEventListener(
      "click",
      (e) => {
        e.stopPropagation();
        navigate(-1);
      },
      { signal },
    );

    rightArrow?.addEventListener(
      "click",
      (e) => {
        e.stopPropagation();
        navigate(1);
      },
      { signal },
    );

    // Setup swipe gestures
    setupSwipeGestures(slideshowEl, navigate, signal);
  };

  return (
    <div className="card-cover card-cover-slideshow" ref={onSlideshowRef}>
      <div
        className="dynamic-views-image-embed"
        style={{ "--cover-image-url": `url("${imageArray[0]}")` }}
        onClick={(e: MouseEvent) => {
          handleImageViewerClick(
            e,
            cardPath,
            app,
            viewerCleanupFns,
            viewerClones,
            openFileAction,
          );
        }}
      >
        <img
          className="slideshow-img slideshow-img-current"
          src={imageArray[0]}
          alt=""
          ref={(imgEl: HTMLImageElement | null) =>
            handleJsxImageRef(imgEl, updateLayoutRef)
          }
          onLoad={(e: Event) => handleJsxImageLoad(e, updateLayoutRef)}
        />
        <img className="slideshow-img slideshow-img-next" src="" alt="" />
      </div>
      {isSlideshowIndicatorEnabled() && (
        <div className="slideshow-indicator">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="5" y="7" width="13" height="10" rx="1"></rect>
            <polyline points="4 2,8 2,8 7"></polyline>
            <polyline points="8 2,16 2,16 7"></polyline>
            <polyline points="16 2,20 2,20 7"></polyline>
          </svg>
        </div>
      )}
      <div className="slideshow-nav-left">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </div>
      <div className="slideshow-nav-right">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </div>
    </div>
  );
}

function renderProperty(
  propertyName: string,
  propertyValue: unknown,
  resolvedValue: string | null,
  settings: Settings,
  card: CardData,
  app: App,
  timeIcon: "calendar" | "clock",
): unknown {
  if (propertyName === "") {
    return null;
  }

  // Hide missing properties if toggle enabled (resolvedValue is null for missing properties)
  // File/formula/tag properties can never be "missing"
  const isTag = isTagProperty(propertyName);
  const isFile = isFileProperty(propertyName);
  const isFormula = isFormulaProperty(propertyName);

  if (
    resolvedValue === null &&
    shouldHideMissingProperties() &&
    !isFile &&
    !isFormula &&
    !isTag
  ) {
    return null;
  }

  // Check if this is an empty property that should be hidden based on dropdown mode
  const isEmpty = resolvedValue === "" || (isTag && !resolvedValue);
  const hideEmptyMode = getHideEmptyMode();
  if (isEmpty) {
    if (hideEmptyMode === "all") return null;
    if (hideEmptyMode === "labels-hidden" && settings.propertyLabels === "hide")
      return null;
  }

  // Render label above if enabled

  const labelAbove =
    settings.propertyLabels === "above" ? (
      <div className="property-label">{getPropertyLabel(propertyName)}</div>
    ) : null;

  // Render inline label if enabled (as sibling, before property-content)

  const labelInline =
    settings.propertyLabels === "inline" ? (
      <span className="property-label-inline">
        {getPropertyLabel(propertyName)}{" "}
      </span>
    ) : null;

  // If no value, show placeholder
  if (!resolvedValue) {
    return (
      <>
        {labelAbove}
        {labelInline}
        <div className="property-content-wrapper" tabIndex={-1}>
          <div className="property-content">
            <span className="empty-value-marker">{getEmptyValueMarker()}</span>
          </div>
        </div>
      </>
    );
  }

  // Handle array properties - render as individual spans with separators
  if (resolvedValue.startsWith('{"type":"array","items":[')) {
    try {
      const arrayData = JSON.parse(resolvedValue) as {
        type: string;
        items: string[];
      };
      if (arrayData.type === "array" && Array.isArray(arrayData.items)) {
        const separator = getListSeparator();
        return (
          <>
            {labelAbove}
            {labelInline}
            <div className="property-content-wrapper" tabIndex={-1}>
              <div className="property-content">
                <span className="list-wrapper">
                  {arrayData.items.map(
                    (item, idx): JSX.Element => (
                      <span key={idx}>
                        <span className="list-item">
                          {renderTextWithLinks(item, app)}
                        </span>
                        {idx < arrayData.items.length - 1 && (
                          <span className="list-separator">{separator}</span>
                        )}
                      </span>
                    ),
                  )}
                </span>
              </div>
            </div>
          </>
        );
      }
    } catch {
      // Fall through to regular text rendering if JSON parse fails
    }
  }

  // Handle special properties by property name
  // For timestamps: file.mtime, file.ctime, or legacy formats
  if (
    propertyName === "file.mtime" ||
    propertyName === "file.ctime" ||
    propertyName === "modified time" ||
    propertyName === "created time"
  ) {
    return (
      <>
        {labelAbove}
        {labelInline}
        <div className="property-content-wrapper" tabIndex={-1}>
          <div className="property-content">
            <span>
              {showTimestampIcon() && settings.propertyLabels === "hide" && (
                <svg
                  className="timestamp-icon"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {timeIcon === "calendar" ? (
                    <>
                      <path d="M8 2v4" />
                      <path d="M16 2v4" />
                      <rect width="18" height="18" x="3" y="4" rx="2" />
                      <path d="M3 10h18" />
                    </>
                  ) : (
                    <>
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </>
                  )}
                </svg>
              )}
              <span>{resolvedValue}</span>
            </span>
          </div>
        </div>
      </>
    );
  } else if (
    (propertyName === "tags" || propertyName === "note.tags") &&
    card.yamlTags.length > 0
  ) {
    // YAML tags only
    const showHashPrefix = showTagHashPrefix();

    return (
      <>
        {labelAbove}
        {labelInline}
        <div className="property-content-wrapper" tabIndex={-1}>
          <div className="property-content">
            <div className="tags-wrapper">
              {card.yamlTags.map(
                (tag): JSX.Element => (
                  <a
                    key={tag}
                    href="#"
                    className="tag"
                    tabIndex={-1}
                    onClick={(e: MouseEvent) => {
                      e.preventDefault();
                      if (
                        shouldUseNotebookNavigator(app, "tag") &&
                        navigateToTagInNotebookNavigator(app, tag)
                      ) {
                        return;
                      }
                      const searchPlugin =
                        app.internalPlugins.plugins["global-search"];
                      if (searchPlugin?.instance?.openGlobalSearch) {
                        searchPlugin.instance.openGlobalSearch("tag:" + tag);
                      }
                    }}
                  >
                    {showHashPrefix ? "#" + tag : tag}
                  </a>
                ),
              )}
            </div>
          </div>
        </div>
      </>
    );
  } else if (
    (propertyName === "file.tags" || propertyName === "file tags") &&
    card.tags.length > 0
  ) {
    // tags in YAML + note body
    const showHashPrefix = showTagHashPrefix();

    return (
      <>
        {labelAbove}
        {labelInline}
        <div className="property-content-wrapper" tabIndex={-1}>
          <div className="property-content">
            <div className="tags-wrapper">
              {card.tags.map(
                (tag): JSX.Element => (
                  <a
                    key={tag}
                    href="#"
                    className="tag"
                    tabIndex={-1}
                    onClick={(e: MouseEvent) => {
                      e.preventDefault();
                      if (
                        shouldUseNotebookNavigator(app, "tag") &&
                        navigateToTagInNotebookNavigator(app, tag)
                      ) {
                        return;
                      }
                      const searchPlugin =
                        app.internalPlugins.plugins["global-search"];
                      if (searchPlugin?.instance?.openGlobalSearch) {
                        searchPlugin.instance.openGlobalSearch("tag:" + tag);
                      }
                    }}
                  >
                    {showHashPrefix ? "#" + tag : tag}
                  </a>
                ),
              )}
            </div>
          </div>
        </div>
      </>
    );
  } else if (
    (propertyName === "file.path" ||
      propertyName === "path" ||
      propertyName === "file path") &&
    resolvedValue
  ) {
    // File path property: render as pure Preact JSX
    const segments = resolvedValue.split("/").filter((f: string) => f);

    return (
      <>
        {labelAbove}
        {labelInline}
        <div className="property-content-wrapper" tabIndex={-1}>
          <div className="property-content">
            <div className="path-wrapper">
              {segments.map((segment: string, idx: number) => {
                const isLastSegment = idx === segments.length - 1;
                const cumulativePath = segments.slice(0, idx + 1).join("/");

                return (
                  <span key={cumulativePath} className="path-segment-wrapper">
                    <span
                      className={
                        isLastSegment
                          ? "path-segment filename-segment"
                          : "path-segment folder-segment"
                      }
                      onClick={(e: MouseEvent) => {
                        e.stopPropagation();
                        // Cache file lookup (used by both NotebookNavigator and file-explorer)
                        const target =
                          app.vault.getAbstractFileByPath(cumulativePath);
                        if (isLastSegment) {
                          if (shouldUseNotebookNavigator(app, "file")) {
                            if (
                              target instanceof TFile &&
                              revealFileInNotebookNavigator(app, target)
                            ) {
                              return;
                            }
                          }
                        } else {
                          if (shouldUseNotebookNavigator(app, "folder")) {
                            if (
                              target instanceof TFolder &&
                              navigateToFolderInNotebookNavigator(app, target)
                            ) {
                              return;
                            }
                          }
                        }
                        const fileExplorer =
                          app.internalPlugins?.plugins?.["file-explorer"];
                        if (fileExplorer?.instance?.revealInFolder && target) {
                          fileExplorer.instance.revealInFolder(target);
                        }
                      }}
                      onContextMenu={(e: MouseEvent) => {
                        e.stopPropagation();
                        e.preventDefault();
                        if (isLastSegment) {
                          const file = app.vault.getAbstractFileByPath(
                            card.path,
                          );
                          if (file instanceof TFile) {
                            showFileContextMenu(e, app, file, card.path);
                          }
                        } else {
                          const folderFile =
                            app.vault.getAbstractFileByPath(cumulativePath);
                          if (folderFile instanceof TFolder) {
                            const menu = new Menu();
                            app.workspace.trigger(
                              "file-menu",
                              menu,
                              folderFile,
                              "file-explorer",
                            );
                            menu.showAtMouseEvent(e);
                          }
                        }
                      }}
                    >
                      {segment}
                    </span>
                    {idx < segments.length - 1 && (
                      <span className="path-separator">/</span>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </>
    );
  } else if (
    (propertyName === "file.folder" || propertyName === "folder") &&
    card.folderPath &&
    card.folderPath.length > 0
  ) {
    // Folder property: render as pure Preact JSX (consistent with file.path)
    const folders = card.folderPath.split("/").filter((f: string) => f);

    return (
      <>
        {labelAbove}
        {labelInline}
        <div className="property-content-wrapper" tabIndex={-1}>
          <div className="property-content">
            <div className="path-wrapper">
              {folders.map((folder: string, idx: number) => {
                const cumulativePath = folders.slice(0, idx + 1).join("/");

                return (
                  <span key={cumulativePath} className="path-segment-wrapper">
                    <span
                      className="path-segment folder-segment"
                      onClick={(e: MouseEvent) => {
                        e.stopPropagation();
                        // Cache folder lookup
                        const folderFile =
                          app.vault.getAbstractFileByPath(cumulativePath);
                        if (shouldUseNotebookNavigator(app, "folder")) {
                          if (
                            folderFile instanceof TFolder &&
                            navigateToFolderInNotebookNavigator(app, folderFile)
                          ) {
                            return;
                          }
                        }
                        const fileExplorer =
                          app.internalPlugins?.plugins?.["file-explorer"];
                        if (fileExplorer?.instance?.revealInFolder) {
                          if (folderFile) {
                            fileExplorer.instance.revealInFolder(folderFile);
                          }
                        }
                      }}
                      onContextMenu={(e: MouseEvent) => {
                        e.stopPropagation();
                        e.preventDefault();
                        const folderFile =
                          app.vault.getAbstractFileByPath(cumulativePath);
                        if (folderFile instanceof TFolder) {
                          const menu = new Menu();
                          app.workspace.trigger(
                            "file-menu",
                            menu,
                            folderFile,
                            "file-explorer",
                          );
                          menu.showAtMouseEvent(e);
                        }
                      }}
                    >
                      {folder}
                    </span>
                    {idx < folders.length - 1 && (
                      <span className="path-separator">/</span>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </>
    );
  }

  // Generic property: render value with link detection
  return (
    <>
      {labelAbove}
      {labelInline}
      <div className="property-content-wrapper" tabIndex={-1}>
        <div className="property-content">
          <span>{renderTextWithLinks(resolvedValue, app)}</span>
        </div>
      </div>
    </>
  );
}

export function CardRenderer({
  cards,
  settings,
  viewMode,
  sortMethod,
  isShuffled,
  focusableCardIndex,
  hoveredCardRef,
  containerRef,
  updateLayoutRef,
  app,
  onCardClick,
  onFocusChange,
}: CardRendererProps): unknown {
  // Closure variable for cleanup - persists across ref callback calls
  let containerCleanup: (() => void) | null = null;

  return (
    <div
      ref={(el: HTMLElement | null) => {
        // Store in containerRef
        if (containerRef) {
          (containerRef as { current: HTMLElement | null }).current = el;
        }

        // Call cleanup when element is removed (unmount)
        if (!el) {
          containerCleanup?.();
          containerCleanup = null;
          return;
        }

        // Skip if already setup (avoid duplicates on re-render)
        if (containerCleanup) {
          return;
        }

        // Initialize focus management properties (always reset to ensure clean state)
        const container = el as CardContainerElement;
        container._intentionalFocus = false;
        container._lastKey = null;
        container._mouseDown = false;
        container._keyboardNavActive = false;

        // Track last key for Tab detection in focusin
        // Note: Arrow key navigation is handled by setupHoverKeyboardNavigation in view layer
        const handleKeydown = (e: KeyboardEvent) => {
          container._lastKey = e.key;

          // Escape exits keyboard nav mode and blurs focused card
          if (e.key === "Escape") {
            container._keyboardNavActive = false;
            const focused = el.querySelector(".card:focus") as HTMLElement;
            if (focused) {
              focused.blur();
            }
          }

          requestAnimationFrame(() => {
            if (el.isConnected) {
              container._lastKey = null;
            }
          });
        };

        // Track mouse button state to allow focus during text selection
        const handleMouseDown = () => {
          container._mouseDown = true;
        };
        const handleMouseUp = () => {
          container._mouseDown = false;
        };

        // Block unwanted focus on cards (e.g., from Obsidian's Escape handler)
        // Allow: intentional focus (arrow keys), Tab from outside, mouse clicks
        const handleFocusin = (e: FocusEvent) => {
          if (container._intentionalFocus) return;

          const target = e.target as HTMLElement;
          if (!target.classList.contains("card")) return;

          // Allow focus during mouse click (needed for text selection)
          // Also exit keyboard nav mode since user is using mouse
          if (container._mouseDown) {
            container._keyboardNavActive = false;
            return;
          }

          const relatedTarget = e.relatedTarget as HTMLElement | null;

          // Focus from outside container - allow Tab or arrow keys (hover-to-start)
          if (!relatedTarget || !el.contains(relatedTarget)) {
            const key = container._lastKey;
            if (key === "Tab" || (key && isArrowKey(key))) {
              container._keyboardNavActive = true;
              return;
            }
            // Block other focus from outside (e.g., Escape)
            target.blur();
            return;
          }

          // Focus moving between cards - only block if caused by non-arrow key
          // (allows mouse clicks even if _mouseDown timing is off)
          if (relatedTarget.classList.contains("card")) {
            const key = container._lastKey;

            // Only block if a key was pressed that's not an arrow key
            if (key && !isArrowKey(key)) {
              container._intentionalFocus = true;
              relatedTarget.focus();
              requestAnimationFrame(() => {
                if (el.isConnected) {
                  container._intentionalFocus = false;
                }
              });
            }
          }
        };

        // Detect when focus leaves all cards - exit keyboard nav mode
        const handleFocusout = (e: FocusEvent) => {
          const relatedTarget = e.relatedTarget as HTMLElement | null;
          // If focus is leaving to something outside the container, or to non-card inside
          if (!relatedTarget || !relatedTarget.classList.contains("card")) {
            container._keyboardNavActive = false;
          }
        };

        // Tab into cards: when markdown-preview-view receives Tab focus and contains our cards,
        // immediately focus first card (browser won't descend into tabIndex=-1 containers)
        const handleDocumentFocusin = (e: FocusEvent) => {
          const target = e.target as HTMLElement;
          // Only when markdown-preview-view receives focus directly (not bubbled)
          if (
            target.classList.contains("markdown-preview-view") &&
            target.contains(el) &&
            container._lastKey === "Tab"
          ) {
            const firstCard = el.querySelector(".card");
            if (firstCard instanceof HTMLElement) {
              container._intentionalFocus = true;
              container._keyboardNavActive = true;
              firstCard.focus();
              requestAnimationFrame(() => {
                if (el.isConnected) {
                  container._intentionalFocus = false;
                }
              });
            }
          }
        };

        // Register event listeners
        document.addEventListener("keydown", handleKeydown, { capture: true });
        document.addEventListener("focusin", handleDocumentFocusin);
        el.addEventListener("focusin", handleFocusin);
        el.addEventListener("focusout", handleFocusout);
        el.addEventListener("mousedown", handleMouseDown, { capture: true });
        document.addEventListener("mouseup", handleMouseUp, { capture: true });

        // Store cleanup function in closure (not on element)
        containerCleanup = () => {
          document.removeEventListener("keydown", handleKeydown, {
            capture: true,
          });
          document.removeEventListener("focusin", handleDocumentFocusin);
          el.removeEventListener("focusin", handleFocusin);
          el.removeEventListener("focusout", handleFocusout);
          el.removeEventListener("mousedown", handleMouseDown, {
            capture: true,
          });
          document.removeEventListener("mouseup", handleMouseUp, {
            capture: true,
          });
        };
      }}
      tabIndex={0}
      onFocus={(e: FocusEvent) => {
        // When container receives Tab focus (not click), delegate to first card
        const container = e.currentTarget as CardContainerElement | null;
        if (
          e.target === e.currentTarget &&
          container &&
          container._lastKey === "Tab"
        ) {
          const firstCard = container.querySelector(".card");
          if (firstCard instanceof HTMLElement) {
            container._intentionalFocus = true;
            container._keyboardNavActive = true;
            firstCard.focus();
            requestAnimationFrame(() => {
              if (container.isConnected) {
                container._intentionalFocus = false;
              }
            });
          }
        }
      }}
      className={
        viewMode === "masonry" ? "dynamic-views-masonry" : "dynamic-views-grid"
      }
    >
      {cards.map(
        (card, index): JSX.Element => (
          <Card
            key={card.path}
            card={card}
            index={index}
            settings={settings}
            viewMode={viewMode}
            sortMethod={sortMethod}
            isShuffled={isShuffled}
            focusableCardIndex={focusableCardIndex}
            hoveredCardRef={hoveredCardRef}
            containerRef={containerRef}
            updateLayoutRef={updateLayoutRef}
            app={app}
            onCardClick={onCardClick}
            onFocusChange={onFocusChange}
          />
        ),
      )}
    </div>
  );
}

interface CardProps {
  key?: string; // React/Preact key for element reconciliation
  card: CardData;
  index: number;
  settings: Settings;
  viewMode: "card" | "masonry";
  sortMethod: string;
  isShuffled: boolean;
  focusableCardIndex: number;
  hoveredCardRef: RefObject<HTMLElement | null>;
  containerRef: RefObject<HTMLElement | null>;
  updateLayoutRef: RefObject<(() => void) | null>;
  app: App;
  onCardClick?: (path: string, paneType: PaneType | boolean) => void;
  onFocusChange?: (index: number) => void;
}

function Card({
  card,
  index,
  settings,
  viewMode,
  sortMethod,
  isShuffled,
  focusableCardIndex,
  hoveredCardRef,
  containerRef,
  updateLayoutRef,
  app,
  onCardClick,
  onFocusChange,
}: CardProps): unknown {
  // Edge case: if openFileAction is "title" but title is hidden, treat as "card"
  const effectiveOpenFileAction =
    settings.openFileAction === "title" && !settings.showTitle
      ? "card"
      : settings.openFileAction;

  // Determine which timestamp to show
  const useCreatedTime = sortMethod.startsWith("ctime") && !isShuffled;
  // Determine time icon (calendar for ctime, clock for mtime)
  const timeIcon = useCreatedTime ? "calendar" : "clock";

  // Compute title display (only strip extension for file.fullname)
  const normalizedTitleProperty = normalizePropertyName(
    app,
    settings.titleProperty || "",
  );
  const isFullname = normalizedTitleProperty === "file.fullname";
  const displayTitle = isFullname
    ? stripExtFromTitle(card.title, card.path, true)
    : card.title;

  // Compute extension info once for use in title data-ext and renderFileExt
  const extInfo = getFileExtInfo(card.path, isFullname);
  const extNoDot = extInfo?.ext.slice(1) || "";

  // Handle images
  const isArray = Array.isArray(card.imageUrl);
  const scrubbingDisabled = isThumbnailScrubbingDisabled();
  const imageArray: string[] = isArray
    ? (card.imageUrl as (string | string[])[])
        .flat()
        .filter(
          (url): url is string => typeof url === "string" && url.length > 0,
        )
        .slice(0, scrubbingDisabled ? 1 : 10)
    : card.imageUrl
      ? [card.imageUrl as string]
      : [];
  // Enable scrubbing only on desktop with multiple images and setting enabled
  const enableScrubbing =
    !app.isMobile && isArray && imageArray.length > 1 && !scrubbingDisabled;

  // Parse imageFormat to extract format and position
  const imageFormat = settings.imageFormat;
  let format: "none" | "thumbnail" | "cover" | "background" = "none";
  let position: "left" | "right" | "top" | "bottom" = "right";

  if (imageFormat === "none") {
    format = "none";
  } else if (imageFormat === "background") {
    format = "background";
  } else if (imageFormat.startsWith("thumbnail-")) {
    format = "thumbnail";
    position = imageFormat.split("-")[1] as "left" | "right" | "top" | "bottom";
  } else if (imageFormat.startsWith("cover-")) {
    format = "cover";
    position = imageFormat.split("-")[1] as "left" | "right" | "top" | "bottom";
  }

  // Build card classes
  const cardClasses = ["card"];
  if (format === "cover") {
    cardClasses.push("image-format-cover");
    cardClasses.push(`card-cover-${position}`);
    cardClasses.push(`card-cover-${settings.imageFit}`);
  } else if (format === "thumbnail") {
    cardClasses.push("image-format-thumbnail");
    cardClasses.push(`card-thumbnail-${position}`);
    cardClasses.push(`card-thumbnail-${settings.imageFit}`);
  } else if (format === "background") {
    cardClasses.push("image-format-backdrop");
  }

  // Drag handler for card-level drag (reuses shared utility)
  const handleDrag = createFileDragHandler(app, card.path);

  // Create AbortController for scroll listener cleanup (before return so child refs can access it)
  cleanupCardScrollListeners(card.path);
  const scrollController = new AbortController();
  cardScrollAbortControllers.set(card.path, scrollController);

  // Cache scroll mode checks (avoid repeated DOM queries in ref callbacks)
  const isTitleScrollMode = document.body.classList.contains(
    "dynamic-views-title-overflow-scroll",
  );
  const isSubtitleScrollMode = document.body.classList.contains(
    "dynamic-views-subtitle-overflow-scroll",
  );

  // Helper function to render title JSX
  const renderTitle = () => {
    if (!settings.showTitle) return null;

    return (
      <div
        className="card-title"
        tabIndex={-1}
        ref={(el: HTMLElement | null) => {
          if (!el) return;
          if (isTitleScrollMode) {
            setupElementScrollGradient(el, scrollController.signal);
          } else {
            setupTitleTruncation(el, scrollController.signal);
          }
        }}
      >
        {renderFileTypeIcon(card.path)}
        {renderFileExt(extInfo)}
        {effectiveOpenFileAction === "title" ? (
          <span
            className="card-title-link"
            data-href={card.path}
            tabIndex={-1}
            draggable={true}
            onDragStart={handleDrag}
            onClick={(e: MouseEvent) => {
              e.stopPropagation();
              const paneType = Keymap.isModEvent(e);
              void app.workspace.openLinkText(card.path, "", paneType || false);
            }}
            onContextMenu={(e: MouseEvent) => {
              e.stopPropagation();
              e.preventDefault();
              const file = app.vault.getAbstractFileByPath(card.path);
              if (file instanceof TFile) {
                showFileContextMenu(e, app, file, card.path);
              }
            }}
            onMouseOver={(e: MouseEvent) => {
              app.workspace.trigger("hover-link", {
                event: e,
                source: "file-explorer",
                hoverParent: { hoverPopover: null },
                targetEl: e.currentTarget,
                linktext: card.path,
                sourcePath: card.path,
              });
            }}
          >
            <span className="card-title-text">{displayTitle}</span>
            {extNoDot && (
              <span className="card-title-ext-suffix">.{extNoDot}</span>
            )}
          </span>
        ) : (
          <>
            <span className="card-title-text">{displayTitle}</span>
            {extNoDot && (
              <span className="card-title-ext-suffix">.{extNoDot}</span>
            )}
          </>
        )}
      </div>
    );
  };

  // Helper function to render subtitle JSX
  const renderSubtitle = () => {
    if (!settings.subtitleProperty || !card.subtitle) return null;

    return (
      <div
        className="card-subtitle"
        tabIndex={-1}
        ref={(el: HTMLElement | null) => {
          if (!el) return;
          if (isSubtitleScrollMode) {
            setupElementScrollGradient(el, scrollController.signal);
          }
          const subtitleWrapper = el.querySelector(
            ".property-content-wrapper",
          ) as HTMLElement;
          if (subtitleWrapper) {
            setupElementScrollGradient(
              subtitleWrapper,
              scrollController.signal,
            );
          }
        }}
      >
        {renderProperty(
          settings.subtitleProperty,
          null,
          card.subtitle,
          { ...settings, propertyLabels: "hide" },
          card,
          app,
          timeIcon,
        )}
      </div>
    );
  };

  // Check if title or subtitle will be rendered
  const hasTitle = settings.showTitle;
  const hasSubtitle = settings.subtitleProperty && card.subtitle;

  return (
    <div
      className={cardClasses.join(" ")}
      data-path={card.path}
      ref={(cardEl: HTMLElement | null) => {
        if (!cardEl) return;

        // Setup scroll gradients for property fields (setupScrollGradients has internal double RAF)
        setupScrollGradients(
          cardEl,
          updateScrollGradient,
          scrollController.signal,
        );

        // Measure side-by-side property field widths (double RAF to ensure DOM is ready)
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const existingPropertyObservers = cardPropertyObservers.get(
              card.path,
            );
            if (existingPropertyObservers) {
              existingPropertyObservers.forEach((obs) => obs.disconnect());
            }
            const propertyObservers = measurePropertyFields(cardEl);
            if (propertyObservers.length > 0) {
              cardPropertyObservers.set(card.path, propertyObservers);
            }
          });
        });

        // Setup responsive behaviors (compact mode, thumbnail stacking)
        const existingResponsiveObserver = cardResponsiveObservers.get(
          card.path,
        );
        if (existingResponsiveObserver) {
          existingResponsiveObserver.disconnect();
        }

        const breakpoint =
          parseFloat(
            getComputedStyle(document.body).getPropertyValue(
              "--dynamic-views-compact-breakpoint",
            ),
          ) || 390;

        const needsThumbnailStacking =
          format === "thumbnail" &&
          (position === "left" || position === "right") &&
          settings.showTextPreview &&
          card.textPreview;

        const responsiveObserver = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const cardWidth = entry.contentRect.width;

            // Compact mode
            if (breakpoint > 0) {
              cardEl.classList.toggle("compact-mode", cardWidth < breakpoint);
            }

            // Thumbnail stacking via CSS class only (CSS order handles positioning)
            if (needsThumbnailStacking) {
              const thumbnailEl = cardEl.querySelector(".card-thumbnail");
              if (thumbnailEl) {
                const thumbnailWidth = (thumbnailEl as HTMLElement).offsetWidth;
                const isStacked = cardWidth < thumbnailWidth * 3;
                cardEl.classList.toggle("thumbnail-stack", isStacked);
              }
            }
          }
        });
        responsiveObserver.observe(cardEl);
        cardResponsiveObservers.set(card.path, responsiveObserver);
      }}
      draggable={effectiveOpenFileAction === "card"}
      onDragStart={effectiveOpenFileAction === "card" ? handleDrag : undefined}
      tabIndex={index === focusableCardIndex ? 0 : -1}
      onClick={(e: MouseEvent) => {
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
            if (onCardClick) {
              onCardClick(card.path, paneType || false);
            } else {
              void app.workspace.openLinkText(card.path, "", paneType || false);
            }
          }
        }
      }}
      onFocus={() => {
        if (onFocusChange) {
          onFocusChange(index);
        }
      }}
      onKeyDown={(e: KeyboardEvent) => {
        // Enter/Space opens file (always use openLinkText, bypass onCardClick)
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          const paneType = Keymap.isModEvent(e);
          void app.workspace.openLinkText(card.path, "", paneType || false);
        } else if (isArrowKey(e.key)) {
          e.preventDefault();
          const container = containerRef.current as CardContainerElement | null;
          if (container) {
            // Mark focus as intentional before navigation
            container._intentionalFocus = true;
            handleArrowNavigation(
              e,
              e.currentTarget as HTMLElement,
              container,
              (_, targetIndex) => {
                container._keyboardNavActive = true;
                onFocusChange?.(targetIndex);
              },
            );
            requestAnimationFrame(() => {
              if (container.isConnected) {
                container._intentionalFocus = false;
              }
            });
          }
        }
      }}
      onMouseEnter={(e: MouseEvent) => {
        // Track hovered card for hover-to-start keyboard navigation
        (hoveredCardRef as { current: HTMLElement | null }).current =
          e.currentTarget as HTMLElement;

        // Trigger Obsidian's hover preview (only on card when openFileAction is 'card')
        if (effectiveOpenFileAction === "card") {
          app.workspace.trigger("hover-link", {
            event: e,
            source: "file-explorer",
            hoverParent: { hoverPopover: null },
            targetEl: e.currentTarget,
            linktext: card.path,
            sourcePath: card.path,
          });
        }
        // Reset thumbnail to first image on hover
        const imageSelector =
          format === "cover" ? ".card-cover img" : ".card-thumbnail img";
        const imgEl = (e.currentTarget as HTMLElement).querySelector(
          imageSelector,
        );
        const firstImage = imageArray[0];
        if (imgEl && firstImage) {
          (imgEl as HTMLImageElement).src = firstImage;
        }
      }}
      onMouseLeave={() => {
        // Clear hovered card reference
        (hoveredCardRef as { current: HTMLElement | null }).current = null;
      }}
      onContextMenu={(e: MouseEvent) => {
        // Show file context menu when effectiveOpenFileAction is 'card'
        if (effectiveOpenFileAction === "card") {
          const file = app.vault.getAbstractFileByPath(card.path);
          if (file instanceof TFile) {
            showFileContextMenu(e, app, file, card.path);
          }
        }
      }}
      onMouseDownCapture={(e: MouseEvent) => {
        // Stop propagation in capture phase to prevent CodeMirror's capture-phase
        // handler on cm-scroller from intercepting text selection
        // when openFileAction is 'title' (card content should be selectable)
        if (effectiveOpenFileAction === "title") {
          e.stopPropagation();
        }
      }}
      style={{
        cursor: effectiveOpenFileAction === "card" ? "pointer" : "default",
      }}
    >
      {/* Title and Subtitle - wrapped in card-header when URL button present */}
      {card.hasValidUrl && card.urlValue ? (
        <div className="card-header">
          {(hasTitle || hasSubtitle) && (
            <div className="card-title-group">
              {renderTitle()}
              {renderSubtitle()}
            </div>
          )}
          <span
            className="card-title-url-icon text-icon-button"
            aria-label={card.urlValue}
            onClick={(e: MouseEvent) => {
              e.preventDefault();
              e.stopPropagation();
              window.open(card.urlValue!, "_blank", "noopener,noreferrer");
            }}
          >
            <svg
              className="svg-icon"
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"></path>
              <path d="m21 3-9 9"></path>
              <path d="M15 3h6v6"></path>
            </svg>
          </span>
        </div>
      ) : (
        (hasTitle || hasSubtitle) && (
          <div className="card-title-group">
            {renderTitle()}
            {renderSubtitle()}
          </div>
        )
      )}

      {/* Covers: wrapped in card-cover-wrapper for flexbox positioning */}
      {format === "cover" && (
        <div
          className={
            imageArray.length > 0
              ? "card-cover-wrapper"
              : "card-cover-wrapper card-cover-wrapper-placeholder"
          }
        >
          {imageArray.length > 0 ? (
            (() => {
              const maxSlideshow = getSlideshowMaxImages();
              const slideshowUrls = imageArray.slice(0, maxSlideshow);
              const shouldShowSlideshow =
                isSlideshowEnabled() &&
                (position === "top" || position === "bottom") &&
                slideshowUrls.length >= 2;

              if (shouldShowSlideshow) {
                return (
                  <CoverSlideshow
                    imageArray={slideshowUrls}
                    updateLayoutRef={updateLayoutRef}
                    cardPath={card.path}
                    app={app}
                    openFileAction={effectiveOpenFileAction}
                  />
                );
              }

              return (
                <div className="card-cover">
                  <div
                    className="dynamic-views-image-embed"
                    style={{
                      "--cover-image-url": `url("${imageArray[0] || ""}")`,
                    }}
                    onClick={(e: MouseEvent) => {
                      handleImageViewerClick(
                        e,
                        card.path,
                        app,
                        viewerCleanupFns,
                        viewerClones,
                        effectiveOpenFileAction,
                      );
                    }}
                  >
                    <img
                      src={imageArray[0] || ""}
                      alt=""
                      ref={(imgEl: HTMLImageElement | null) =>
                        handleJsxImageRef(imgEl, updateLayoutRef)
                      }
                      onLoad={(e: Event) =>
                        handleJsxImageLoad(e, updateLayoutRef)
                      }
                      onError={(e: Event) =>
                        handleJsxImageError(e, updateLayoutRef)
                      }
                    />
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="card-cover-placeholder"></div>
          )}
        </div>
      )}

      {/* Background: absolute-positioned image fills entire card */}
      {format === "background" && imageArray.length > 0 && (
        <div className="card-backdrop">
          <img
            src={imageArray[0] || ""}
            alt=""
            ref={(imgEl: HTMLImageElement | null) =>
              handleJsxImageRef(imgEl, updateLayoutRef)
            }
            onLoad={(e: Event) => handleJsxImageLoad(e, updateLayoutRef)}
            onError={(e: Event) => handleJsxImageError(e, updateLayoutRef)}
          />
        </div>
      )}

      {/* Set CSS custom properties for side cover dimensions */}
      {format === "cover" &&
        (position === "left" || position === "right") &&
        (() => {
          setTimeout(() => {
            const cardEl = document.querySelector(
              `[data-path="${card.path}"]`,
            ) as HTMLElement;
            if (!cardEl) return;

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
            updateWrapperDimensions();

            // Cleanup existing observer for this card if any
            cleanupCardObserver(card.path);

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

            // Store observer for cleanup and start observing
            cardResizeObservers.set(card.path, resizeObserver);
            resizeObserver.observe(cardEl);
          }, 100);
          return null;
        })()}

      {/* Content container - only render if it will have children */}
      {/* Always create for thumbnail format to allow placeholder rendering */}
      {((settings.showTextPreview && card.textPreview) ||
        format === "thumbnail") && (
        <div className="card-content">
          {settings.showTextPreview && card.textPreview && (
            <div className="card-text-preview-wrapper">
              <div className="card-text-preview">{card.textPreview}</div>
            </div>
          )}
          {/* Thumbnail (all positions now inside card-content) */}
          {format === "thumbnail" &&
            (imageArray.length > 0 ? (
              <div
                className={`card-thumbnail ${enableScrubbing ? "multi-image" : ""}`}
                onMouseMove={
                  enableScrubbing
                    ? (e: MouseEvent) => {
                        const rect = (
                          e.currentTarget as HTMLElement
                        ).getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        const section = Math.floor(
                          (x / rect.width) * imageArray.length,
                        );
                        const newIndex = Math.max(
                          0,
                          Math.min(section, imageArray.length - 1),
                        );
                        const rawUrl = imageArray[newIndex];
                        if (isFailedExternalUrl(rawUrl)) return;
                        const imgEl = (
                          e.currentTarget as HTMLElement
                        ).querySelector("img");
                        const newSrc = getCachedBlobUrl(rawUrl);
                        if (imgEl && newSrc) {
                          const currentSrc = imgEl.src;
                          if (currentSrc !== newSrc) {
                            imgEl.src = newSrc;
                          }
                        }
                      }
                    : undefined
                }
                onMouseLeave={
                  enableScrubbing
                    ? (e: MouseEvent) => {
                        const firstValidUrl = imageArray.find(
                          (url) => !isFailedExternalUrl(url),
                        );
                        if (!firstValidUrl) return;
                        const imgEl = (
                          e.currentTarget as HTMLElement
                        ).querySelector("img");
                        const firstSrc = getCachedBlobUrl(firstValidUrl);
                        if (imgEl && firstSrc) {
                          imgEl.src = firstSrc;
                        }
                      }
                    : undefined
                }
              >
                <div
                  className="dynamic-views-image-embed"
                  style={{
                    "--cover-image-url": `url("${imageArray[0] || ""}")`,
                  }}
                  onClick={(e: MouseEvent) => {
                    handleImageViewerClick(
                      e,
                      card.path,
                      app,
                      viewerCleanupFns,
                      viewerClones,
                      effectiveOpenFileAction,
                    );
                  }}
                >
                  <img
                    src={imageArray[0] || ""}
                    alt=""
                    ref={(imgEl: HTMLImageElement | null) => {
                      handleJsxImageRef(imgEl, updateLayoutRef);
                      // Multi-image fallback: use AbortController for proper cleanup
                      type ImgWithController = HTMLImageElement & {
                        _errorController?: AbortController;
                      };
                      // Always abort existing controller on re-render or unmount
                      if (imgEl) {
                        const existingController = (imgEl as ImgWithController)
                          ._errorController;
                        if (existingController) existingController.abort();
                      }
                      // Setup new controller only for multi-image arrays
                      if (imgEl && imageArray.length > 1) {
                        const controller = new AbortController();
                        (imgEl as ImgWithController)._errorController =
                          controller;

                        imgEl.addEventListener(
                          "error",
                          () => {
                            if (imgEl.src) markExternalUrlAsFailed(imgEl.src);
                            // Find current position by URL match (handles scrubbing)
                            const failedSrc = imgEl.src;
                            let startIndex = imageArray.findIndex(
                              (url) =>
                                getCachedBlobUrl(url) === failedSrc ||
                                url === failedSrc,
                            );
                            if (startIndex === -1) startIndex = 0;
                            // Try subsequent URLs
                            for (
                              let i = startIndex + 1;
                              i < imageArray.length;
                              i++
                            ) {
                              if (!isFailedExternalUrl(imageArray[i])) {
                                imgEl.style.display = "";
                                const effectiveUrl = getCachedBlobUrl(
                                  imageArray[i],
                                );
                                imgEl.src = effectiveUrl;
                                const embedEl = imgEl.closest(
                                  ".dynamic-views-image-embed",
                                ) as HTMLElement;
                                if (embedEl) {
                                  embedEl.style.setProperty(
                                    "--cover-image-url",
                                    `url("${effectiveUrl}")`,
                                  );
                                }
                                return;
                              }
                            }
                            // All images failed - complete cleanup
                            imgEl.style.display = "none";
                            const cardEl = imgEl.closest(
                              ".card",
                            ) as HTMLElement;
                            if (
                              cardEl &&
                              !cardEl.classList.contains("cover-ready")
                            ) {
                              cardEl.classList.add("cover-ready");
                              cardEl.style.setProperty(
                                "--actual-aspect-ratio",
                                DEFAULT_ASPECT_RATIO.toString(),
                              );
                              cardEl.removeAttribute("data-backdrop-theme");
                              if (updateLayoutRef.current)
                                updateLayoutRef.current();
                            }
                          },
                          { signal: controller.signal },
                        );
                      } else if (imgEl) {
                        // Abort any existing controller before clearing reference
                        const existingCtrl = (imgEl as ImgWithController)
                          ._errorController;
                        if (existingCtrl) existingCtrl.abort();
                        delete (imgEl as ImgWithController)._errorController;
                      }
                    }}
                    onLoad={(e: Event) =>
                      handleJsxImageLoad(e, updateLayoutRef)
                    }
                    onError={
                      imageArray.length <= 1
                        ? (e: Event) => handleJsxImageError(e, updateLayoutRef)
                        : undefined
                    }
                  />
                </div>
              </div>
            ) : (
              // Always render placeholder when no image - CSS controls visibility
              <div className="card-thumbnail-placeholder"></div>
            ))}
        </div>
      )}

      {/* Properties - 14-field rendering with 7-set layout, split by position */}
      {(() => {
        // Read settings once for all fields
        const hideEmptyMode = getHideEmptyMode();
        const hideMissing = shouldHideMissingProperties();
        const { propertyLabels } = settings;

        // Pre-compute collapse states for all fields
        const collapse = [
          shouldCollapseFieldDatacore(
            card.propertyName1,
            card.property1,
            propertyLabels,
            hideEmptyMode,
            hideMissing,
          ),
          shouldCollapseFieldDatacore(
            card.propertyName2,
            card.property2,
            propertyLabels,
            hideEmptyMode,
            hideMissing,
          ),
          shouldCollapseFieldDatacore(
            card.propertyName3,
            card.property3,
            propertyLabels,
            hideEmptyMode,
            hideMissing,
          ),
          shouldCollapseFieldDatacore(
            card.propertyName4,
            card.property4,
            propertyLabels,
            hideEmptyMode,
            hideMissing,
          ),
          shouldCollapseFieldDatacore(
            card.propertyName5,
            card.property5,
            propertyLabels,
            hideEmptyMode,
            hideMissing,
          ),
          shouldCollapseFieldDatacore(
            card.propertyName6,
            card.property6,
            propertyLabels,
            hideEmptyMode,
            hideMissing,
          ),
          shouldCollapseFieldDatacore(
            card.propertyName7,
            card.property7,
            propertyLabels,
            hideEmptyMode,
            hideMissing,
          ),
          shouldCollapseFieldDatacore(
            card.propertyName8,
            card.property8,
            propertyLabels,
            hideEmptyMode,
            hideMissing,
          ),
          shouldCollapseFieldDatacore(
            card.propertyName9,
            card.property9,
            propertyLabels,
            hideEmptyMode,
            hideMissing,
          ),
          shouldCollapseFieldDatacore(
            card.propertyName10,
            card.property10,
            propertyLabels,
            hideEmptyMode,
            hideMissing,
          ),
          shouldCollapseFieldDatacore(
            card.propertyName11,
            card.property11,
            propertyLabels,
            hideEmptyMode,
            hideMissing,
          ),
          shouldCollapseFieldDatacore(
            card.propertyName12,
            card.property12,
            propertyLabels,
            hideEmptyMode,
            hideMissing,
          ),
          shouldCollapseFieldDatacore(
            card.propertyName13,
            card.property13,
            propertyLabels,
            hideEmptyMode,
            hideMissing,
          ),
          shouldCollapseFieldDatacore(
            card.propertyName14,
            card.property14,
            propertyLabels,
            hideEmptyMode,
            hideMissing,
          ),
        ];

        // Check if any property set has content
        // When labels are enabled, show set if property is configured (even if value is empty)
        // When labels are hidden, only show set if value exists
        const set1HasContent =
          propertyLabels !== "hide"
            ? card.propertyName1 !== undefined ||
              card.propertyName2 !== undefined
            : card.property1 !== null || card.property2 !== null;
        const set2HasContent =
          propertyLabels !== "hide"
            ? card.propertyName3 !== undefined ||
              card.propertyName4 !== undefined
            : card.property3 !== null || card.property4 !== null;
        const set3HasContent =
          propertyLabels !== "hide"
            ? card.propertyName5 !== undefined ||
              card.propertyName6 !== undefined
            : card.property5 !== null || card.property6 !== null;
        const set4HasContent =
          propertyLabels !== "hide"
            ? card.propertyName7 !== undefined ||
              card.propertyName8 !== undefined
            : card.property7 !== null || card.property8 !== null;
        const set5HasContent =
          propertyLabels !== "hide"
            ? card.propertyName9 !== undefined ||
              card.propertyName10 !== undefined
            : card.property9 !== null || card.property10 !== null;
        const set6HasContent =
          propertyLabels !== "hide"
            ? card.propertyName11 !== undefined ||
              card.propertyName12 !== undefined
            : card.property11 !== null || card.property12 !== null;
        const set7HasContent =
          propertyLabels !== "hide"
            ? card.propertyName13 !== undefined ||
              card.propertyName14 !== undefined
            : card.property13 !== null || card.property14 !== null;

        if (
          !set1HasContent &&
          !set2HasContent &&
          !set3HasContent &&
          !set4HasContent &&
          !set5HasContent &&
          !set6HasContent &&
          !set7HasContent
        )
          return null;

        // Build property set elements

        const set1 = set1HasContent && (
          <div
            className={`property-set property-set-1${settings.propertySet1SideBySide ? " property-set-sidebyside" : ""}`}
          >
            <div
              className={`property-field property-field-1${collapse[0] ? " property-field-collapsed" : ""}`}
            >
              {card.propertyName1 &&
                renderPropertyContent(
                  card.propertyName1,
                  card,
                  card.property1 ?? null,
                  timeIcon,
                  settings,
                  app,
                )}
            </div>
            <div
              className={`property-field property-field-2${collapse[1] ? " property-field-collapsed" : ""}`}
            >
              {card.propertyName2 &&
                renderPropertyContent(
                  card.propertyName2,
                  card,
                  card.property2 ?? null,
                  timeIcon,
                  settings,
                  app,
                )}
            </div>
          </div>
        );

        const set2 = set2HasContent && (
          <div
            className={`property-set property-set-2${settings.propertySet2SideBySide ? " property-set-sidebyside" : ""}`}
          >
            <div
              className={`property-field property-field-3${collapse[2] ? " property-field-collapsed" : ""}`}
            >
              {card.propertyName3 &&
                renderPropertyContent(
                  card.propertyName3,
                  card,
                  card.property3 ?? null,
                  timeIcon,
                  settings,
                  app,
                )}
            </div>
            <div
              className={`property-field property-field-4${collapse[3] ? " property-field-collapsed" : ""}`}
            >
              {card.propertyName4 &&
                renderPropertyContent(
                  card.propertyName4,
                  card,
                  card.property4 ?? null,
                  timeIcon,
                  settings,
                  app,
                )}
            </div>
          </div>
        );

        const set3 = set3HasContent && (
          <div
            className={`property-set property-set-3${settings.propertySet3SideBySide ? " property-set-sidebyside" : ""}`}
          >
            <div
              className={`property-field property-field-5${collapse[4] ? " property-field-collapsed" : ""}`}
            >
              {card.propertyName5 &&
                renderPropertyContent(
                  card.propertyName5,
                  card,
                  card.property5 ?? null,
                  timeIcon,
                  settings,
                  app,
                )}
            </div>
            <div
              className={`property-field property-field-6${collapse[5] ? " property-field-collapsed" : ""}`}
            >
              {card.propertyName6 &&
                renderPropertyContent(
                  card.propertyName6,
                  card,
                  card.property6 ?? null,
                  timeIcon,
                  settings,
                  app,
                )}
            </div>
          </div>
        );

        const set4 = set4HasContent && (
          <div
            className={`property-set property-set-4${settings.propertySet4SideBySide ? " property-set-sidebyside" : ""}`}
          >
            <div
              className={`property-field property-field-7${collapse[6] ? " property-field-collapsed" : ""}`}
            >
              {card.propertyName7 &&
                renderPropertyContent(
                  card.propertyName7,
                  card,
                  card.property7 ?? null,
                  timeIcon,
                  settings,
                  app,
                )}
            </div>
            <div
              className={`property-field property-field-8${collapse[7] ? " property-field-collapsed" : ""}`}
            >
              {card.propertyName8 &&
                renderPropertyContent(
                  card.propertyName8,
                  card,
                  card.property8 ?? null,
                  timeIcon,
                  settings,
                  app,
                )}
            </div>
          </div>
        );

        const set5 = set5HasContent && (
          <div
            className={`property-set property-set-5${settings.propertySet5SideBySide ? " property-set-sidebyside" : ""}`}
          >
            <div
              className={`property-field property-field-9${collapse[8] ? " property-field-collapsed" : ""}`}
            >
              {card.propertyName9 &&
                renderPropertyContent(
                  card.propertyName9,
                  card,
                  card.property9 ?? null,
                  timeIcon,
                  settings,
                  app,
                )}
            </div>
            <div
              className={`property-field property-field-10${collapse[9] ? " property-field-collapsed" : ""}`}
            >
              {card.propertyName10 &&
                renderPropertyContent(
                  card.propertyName10,
                  card,
                  card.property10 ?? null,
                  timeIcon,
                  settings,
                  app,
                )}
            </div>
          </div>
        );

        const set6 = set6HasContent && (
          <div
            className={`property-set property-set-6${settings.propertySet6SideBySide ? " property-set-sidebyside" : ""}`}
          >
            <div
              className={`property-field property-field-11${collapse[10] ? " property-field-collapsed" : ""}`}
            >
              {card.propertyName11 &&
                renderPropertyContent(
                  card.propertyName11,
                  card,
                  card.property11 ?? null,
                  timeIcon,
                  settings,
                  app,
                )}
            </div>
            <div
              className={`property-field property-field-12${collapse[11] ? " property-field-collapsed" : ""}`}
            >
              {card.propertyName12 &&
                renderPropertyContent(
                  card.propertyName12,
                  card,
                  card.property12 ?? null,
                  timeIcon,
                  settings,
                  app,
                )}
            </div>
          </div>
        );

        const set7 = set7HasContent && (
          <div
            className={`property-set property-set-7${settings.propertySet7SideBySide ? " property-set-sidebyside" : ""}`}
          >
            <div
              className={`property-field property-field-13${collapse[12] ? " property-field-collapsed" : ""}`}
            >
              {card.propertyName13 &&
                renderPropertyContent(
                  card.propertyName13,
                  card,
                  card.property13 ?? null,
                  timeIcon,
                  settings,
                  app,
                )}
            </div>
            <div
              className={`property-field property-field-14${collapse[13] ? " property-field-collapsed" : ""}`}
            >
              {card.propertyName14 &&
                renderPropertyContent(
                  card.propertyName14,
                  card,
                  card.property14 ?? null,
                  timeIcon,
                  settings,
                  app,
                )}
            </div>
          </div>
        );

        // Split sets by position setting
        const topSets: JSX.Element[] = [];
        const bottomSets: JSX.Element[] = [];

        if (set1) {
          if (settings.propertySet1Position === "top") topSets.push(set1);
          else bottomSets.push(set1);
        }
        if (set2) {
          if (settings.propertySet2Position === "top") topSets.push(set2);
          else bottomSets.push(set2);
        }
        if (set3) {
          if (settings.propertySet3Position === "top") topSets.push(set3);
          else bottomSets.push(set3);
        }
        if (set4) {
          if (settings.propertySet4Position === "top") topSets.push(set4);
          else bottomSets.push(set4);
        }
        if (set5) {
          if (settings.propertySet5Position === "top") topSets.push(set5);
          else bottomSets.push(set5);
        }
        if (set6) {
          if (settings.propertySet6Position === "top") topSets.push(set6);
          else bottomSets.push(set6);
        }
        if (set7) {
          if (settings.propertySet7Position === "top") topSets.push(set7);
          else bottomSets.push(set7);
        }

        return (
          <>
            {topSets.length > 0 && (
              <div className="card-properties card-properties-top">
                {topSets}
              </div>
            )}
            {bottomSets.length > 0 && (
              <div className="card-properties card-properties-bottom">
                {bottomSets}
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}
