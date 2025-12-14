/**
 * Shared card renderer - Pure rendering component
 * Works with both Bases and Datacore by accepting normalized card data
 */

import type { App } from "obsidian";
import { TFile, TFolder, setIcon, Menu } from "obsidian";
import type { Settings } from "../types";
import type { RefObject } from "../datacore/types";
import {
  showTagHashPrefix,
  showTimestampIcon,
  getEmptyValueMarker,
  shouldHideMissingProperties,
  shouldHideEmptyProperties,
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
} from "./image-loader";
import { handleImageViewerClick } from "./image-viewer-handler";
import {
  createSlideshowNavigator,
  setupImagePreload,
  setupSwipeGestures,
} from "./slideshow-utils";
import { showFileContextMenu } from "./context-menu";
import {
  updateScrollGradient,
  setupScrollGradients,
  setupElementScrollGradient,
} from "./scroll-gradient-manager";
import { handleArrowNavigation, isArrowKey } from "./keyboard-nav";
import { measurePropertyFields } from "./property-measure";

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
 * Set up title truncation with extension preservation.
 * Truncates title text while keeping extension visible at end.
 */
function setupTitleTruncation(titleEl: HTMLElement, signal: AbortSignal): void {
  const textEl = titleEl.querySelector<HTMLElement>(".card-title-text-content");
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
            const newLeaf = e.metaKey || e.ctrlKey;
            void app.workspace.openLinkText(link.url, "", newLeaf);
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
        draggable={true}
        onClick={(e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          const newLeaf = e.metaKey || e.ctrlKey;
          void app.workspace.openLinkText(link.url, "", newLeaf);
        }}
        onDragStart={(e: DragEvent) => {
          e.stopPropagation();
          const file = app.metadataCache.getFirstLinkpathDest(link.url, "");
          if (!(file instanceof TFile)) return;
          const dragData = app.dragManager.dragFile(e, file);
          app.dragManager.onDragStart(e, dragData);
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
  hasImageAvailable: boolean;
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
  onCardClick?: (path: string, newLeaf: boolean) => void;
  onFocusChange?: (index: number) => void;
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
  resolvedValue: string,
  settings: Settings,
  card: CardData,
  app: App,
  timeIcon: "calendar" | "clock",
): unknown {
  if (propertyName === "") {
    return null;
  }

  // Hide missing properties if toggle enabled (resolvedValue is null for missing properties)
  if (resolvedValue === null && shouldHideMissingProperties()) {
    return null;
  }

  // Hide empty properties if toggle enabled (resolvedValue is '' for empty properties)
  if (resolvedValue === "" && shouldHideEmptyProperties()) {
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
        <div className="property-content-wrapper">
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
            <div className="property-content-wrapper">
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
    propertyName === "timestamp" ||
    propertyName === "modified time" ||
    propertyName === "created time"
  ) {
    return (
      <>
        {labelAbove}
        {labelInline}
        <div className="property-content-wrapper">
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
        <div className="property-content-wrapper">
          <div className="property-content">
            <div className="tags-wrapper">
              {card.yamlTags.map(
                (tag): JSX.Element => (
                  <a
                    key={tag}
                    href="#"
                    className="tag"
                    onClick={(e: MouseEvent) => {
                      e.preventDefault();
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
        <div className="property-content-wrapper">
          <div className="property-content">
            <div className="tags-wrapper">
              {card.tags.map(
                (tag): JSX.Element => (
                  <a
                    key={tag}
                    href="#"
                    className="tag"
                    onClick={(e: MouseEvent) => {
                      e.preventDefault();
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
    // Drag handler for filename segment
    const handleFilenameDrag = (e: DragEvent) => {
      const file = app.vault.getAbstractFileByPath(card.path);
      if (!(file instanceof TFile)) return;
      const dragData = app.dragManager.dragFile(e, file);
      app.dragManager.onDragStart(e, dragData);
    };

    return (
      <>
        {labelAbove}
        {labelInline}
        <div className="property-content-wrapper">
          <div className="property-content">
            <div className="path-wrapper">
              {resolvedValue
                .split("/")
                .filter((f) => f)
                .map((segment, idx, array): JSX.Element => {
                  const allParts = resolvedValue.split("/").filter((f) => f);
                  const cumulativePath = allParts.slice(0, idx + 1).join("/");
                  const isLastSegment = idx === array.length - 1;
                  const segmentClass = isLastSegment
                    ? "path-segment filename-segment"
                    : "path-segment file-path-segment";
                  return (
                    <span
                      key={idx}
                      style={{ display: "inline-flex", alignItems: "center" }}
                    >
                      <span
                        className={segmentClass}
                        draggable={isLastSegment}
                        onDragStart={
                          isLastSegment ? handleFilenameDrag : undefined
                        }
                        onClick={(e: MouseEvent) => {
                          e.stopPropagation();
                          const fileExplorer =
                            app.internalPlugins?.plugins?.["file-explorer"];
                          if (fileExplorer?.instance?.revealInFolder) {
                            const folder =
                              app.vault.getAbstractFileByPath(cumulativePath);
                            if (folder) {
                              fileExplorer.instance.revealInFolder(folder);
                            }
                          }
                        }}
                        onContextMenu={(e: MouseEvent) => {
                          e.stopPropagation();
                          e.preventDefault();
                          if (isLastSegment) {
                            // Filename segment - show file context menu
                            const file = app.vault.getAbstractFileByPath(
                              card.path,
                            );
                            if (file instanceof TFile) {
                              showFileContextMenu(e, app, file, card.path);
                            }
                          } else {
                            // Folder segment - show folder context menu
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
                              menu.showAtMouseEvent(e as unknown as MouseEvent);
                            }
                          }
                        }}
                      >
                        {segment}
                      </span>
                      {idx < array.length - 1 && (
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
      <div className="property-content-wrapper">
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
  return (
    <div
      ref={(el: HTMLElement | null) => {
        // Store in containerRef
        if (containerRef) {
          (containerRef as { current: HTMLElement | null }).current = el;
        }
        if (!el) return;

        // Setup single document-level keydown listener for hover-to-start
        // Check if already setup (avoid duplicates on re-render)
        type ContainerWithCleanup = HTMLElement & {
          _hoverKeydownCleanup?: () => void;
        };
        const container = el as ContainerWithCleanup;
        if (container._hoverKeydownCleanup) {
          return; // Already setup
        }

        // Track intentional focus and last key to distinguish Tab from Escape
        type ContainerWithFlags = HTMLElement & {
          _intentionalFocus?: boolean;
          _lastKey?: string | null;
        };
        (el as ContainerWithFlags)._intentionalFocus = false;
        (el as ContainerWithFlags)._lastKey = null;

        const handleKeydown = (e: KeyboardEvent) => {
          // Track last key for Tab detection in focusin
          (el as ContainerWithFlags)._lastKey = e.key;
          requestAnimationFrame(() => {
            (el as ContainerWithFlags)._lastKey = null;
          });

          // Only handle arrow keys if hovering a card
          const hoveredCard = hoveredCardRef.current;
          if (!hoveredCard) return;
          if (!isArrowKey(e.key)) return;

          const activeEl = document.activeElement;
          const isCardFocused = activeEl?.classList.contains("card");
          if (isCardFocused) return;

          // Focus the hovered card (mark as intentional)
          e.preventDefault();
          (el as ContainerWithFlags)._intentionalFocus = true;
          hoveredCard.focus();
          requestAnimationFrame(() => {
            (el as ContainerWithFlags)._intentionalFocus = false;
          });

          // Find index of hovered card and update focusableCardIndex
          const allCards = el.querySelectorAll(".card");
          const index = Array.from(allCards).indexOf(hoveredCard);
          if (index >= 0) {
            onFocusChange?.(index);
          }
        };

        // Block unwanted focus on cards (e.g., from Obsidian's Escape handler)
        // Allow: intentional focus (arrow keys), Tab from outside
        const handleFocusin = (e: FocusEvent) => {
          if ((el as ContainerWithFlags)._intentionalFocus) return;

          const target = e.target as HTMLElement;
          if (!target.classList.contains("card")) return;

          const relatedTarget = e.relatedTarget as HTMLElement | null;

          // Focus from outside container - only allow if Tab was pressed
          if (!relatedTarget || !el.contains(relatedTarget)) {
            if ((el as ContainerWithFlags)._lastKey === "Tab") return;
            // Block non-Tab focus from outside (e.g., Escape)
            target.blur();
            return;
          }

          // Block focus moving between cards without arrow keys
          if (relatedTarget.classList.contains("card")) {
            (el as ContainerWithFlags)._intentionalFocus = true;
            relatedTarget.focus();
            requestAnimationFrame(() => {
              (el as ContainerWithFlags)._intentionalFocus = false;
            });
          }
        };

        document.addEventListener("keydown", handleKeydown, { capture: true });
        el.addEventListener("focusin", handleFocusin);

        container._hoverKeydownCleanup = () => {
          document.removeEventListener("keydown", handleKeydown, {
            capture: true,
          });
          el.removeEventListener("focusin", handleFocusin);
        };
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
  onCardClick?: (path: string, newLeaf: boolean) => void;
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
  let format: "none" | "thumbnail" | "cover" = "none";
  let position: "left" | "right" | "top" | "bottom" = "right";

  if (imageFormat === "none") {
    format = "none";
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
    cardClasses.push(`card-cover-${settings.coverFitMode}`);
  } else if (format === "thumbnail") {
    cardClasses.push("image-format-thumbnail");
    cardClasses.push(`card-thumbnail-${position}`);
  }

  // Drag handler function
  const handleDrag = (e: DragEvent) => {
    const file = app.vault.getAbstractFileByPath(card.path);
    if (!(file instanceof TFile)) return;

    const dragData = app.dragManager.dragFile(e, file);
    app.dragManager.onDragStart(e, dragData);
  };

  // Create AbortController for scroll listener cleanup (before return so child refs can access it)
  cleanupCardScrollListeners(card.path);
  const scrollController = new AbortController();
  cardScrollAbortControllers.set(card.path, scrollController);

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
            "dynamic-views-image-zoom-disabled",
          );

          if (
            !isLink &&
            !isTag &&
            !isPathSegment &&
            !(isImage && isZoomEnabled)
          ) {
            const newLeaf = e.metaKey || e.ctrlKey;
            if (onCardClick) {
              onCardClick(card.path, newLeaf);
            } else {
              void app.workspace.openLinkText(card.path, "", newLeaf);
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
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (effectiveOpenFileAction === "card") {
            const newLeaf = e.metaKey || e.ctrlKey;
            if (onCardClick) {
              onCardClick(card.path, newLeaf);
            } else {
              void app.workspace.openLinkText(card.path, "", newLeaf);
            }
          }
        } else if (isArrowKey(e.key)) {
          e.preventDefault();
          const container = containerRef.current as HTMLElement & {
            _intentionalFocus?: boolean;
          };
          if (container) {
            // Mark focus as intentional before navigation
            container._intentionalFocus = true;
            handleArrowNavigation(
              e,
              e.currentTarget as HTMLElement,
              container,
              (_, targetIndex) => onFocusChange?.(targetIndex),
            );
            requestAnimationFrame(() => {
              container._intentionalFocus = false;
            });
          }
        } else if (e.key === "Escape") {
          (e.currentTarget as HTMLElement).blur();
        } else if (e.key === "Tab") {
          e.preventDefault();
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
            source: "dynamic-views",
            hoverParent: e.currentTarget,
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
      style={{
        cursor: effectiveOpenFileAction === "card" ? "pointer" : "default",
      }}
    >
      {/* Title */}
      {(settings.showTitle || card.hasValidUrl) && (
        <div
          className={card.hasValidUrl ? "card-title-container" : "card-title"}
          ref={(el: HTMLElement | null) => {
            if (!el || card.hasValidUrl) return;
            const isScrollMode = document.body.classList.contains(
              "dynamic-views-title-overflow-scroll",
            );
            if (isScrollMode) {
              setupElementScrollGradient(el, scrollController.signal);
            } else {
              setupTitleTruncation(el, scrollController.signal);
            }
          }}
        >
          {settings.showTitle && (
            <div
              className={card.hasValidUrl ? "card-title" : undefined}
              ref={(el: HTMLElement | null) => {
                if (!el || !card.hasValidUrl) return;
                const isScrollMode = document.body.classList.contains(
                  "dynamic-views-title-overflow-scroll",
                );
                if (isScrollMode) {
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
                    const newLeaf = e.metaKey || e.ctrlKey;
                    void app.workspace.openLinkText(card.path, "", newLeaf);
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
                      source: "dynamic-views",
                      hoverParent: { hoverPopover: null },
                      targetEl: e.currentTarget,
                      linktext: card.path,
                    });
                  }}
                >
                  <span className="card-title-text-content">
                    {displayTitle}
                  </span>
                  {extNoDot && (
                    <span className="card-title-ext-suffix">.{extNoDot}</span>
                  )}
                </span>
              ) : (
                <>
                  <span className="card-title-text-content">
                    {displayTitle}
                  </span>
                  {extNoDot && (
                    <span className="card-title-ext-suffix">.{extNoDot}</span>
                  )}
                </>
              )}
            </div>
          )}
          {card.hasValidUrl && card.urlValue && (
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
          )}
        </div>
      )}

      {/* Subtitle */}
      {settings.subtitleProperty && card.subtitle && (
        <div
          className="card-subtitle"
          ref={(el: HTMLElement | null) => {
            if (!el) return;
            const isScrollMode = document.body.classList.contains(
              "dynamic-views-subtitle-overflow-scroll",
            );
            if (isScrollMode) {
              setupElementScrollGradient(el, scrollController.signal);
            }
            // Setup scroll gradients for inner wrapper (works in wrap mode too)
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

            // Store observer for cleanup and start observing
            cardResizeObservers.set(card.path, resizeObserver);
            resizeObserver.observe(cardEl);
          }, 100);
          return null;
        })()}

      {/* Thumbnail-top: between title and text preview */}
      {format === "thumbnail" &&
        position === "top" &&
        (imageArray.length > 0 || card.hasImageAvailable) &&
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
                    const imgEl = (
                      e.currentTarget as HTMLElement
                    ).querySelector("img");
                    const newSrc = imageArray[newIndex];
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
                    const imgEl = (
                      e.currentTarget as HTMLElement
                    ).querySelector("img");
                    const firstSrc = imageArray[0];
                    if (imgEl && firstSrc) {
                      imgEl.src = firstSrc;
                    }
                  }
                : undefined
            }
          >
            <div
              className="dynamic-views-image-embed"
              style={{ "--cover-image-url": `url("${imageArray[0] || ""}")` }}
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
                onLoad={(e: Event) => handleJsxImageLoad(e, updateLayoutRef)}
                onError={(e: Event) => handleJsxImageError(e, updateLayoutRef)}
              />
            </div>
          </div>
        ) : (
          <div className="card-thumbnail-placeholder"></div>
        ))}

      {/* Content container - only render if it will have children */}
      {((settings.showTextPreview && card.textPreview) ||
        (format === "thumbnail" &&
          (position === "left" || position === "right") &&
          (imageArray.length > 0 || card.hasImageAvailable))) && (
        <div className="card-content">
          {settings.showTextPreview && card.textPreview && (
            <div className="card-text-preview">{card.textPreview}</div>
          )}
          {format === "thumbnail" &&
            (position === "left" || position === "right") &&
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
                        const imgEl = (
                          e.currentTarget as HTMLElement
                        ).querySelector("img");
                        const newSrc = imageArray[newIndex];
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
                        const imgEl = (
                          e.currentTarget as HTMLElement
                        ).querySelector("img");
                        const firstSrc = imageArray[0];
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
            ) : (
              // Always render placeholder when no image - CSS controls visibility
              <div className="card-thumbnail-placeholder"></div>
            ))}
        </div>
      )}

      {/* Thumbnail-bottom: after text preview */}
      {format === "thumbnail" &&
        position === "bottom" &&
        (imageArray.length > 0 || card.hasImageAvailable) &&
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
                    const imgEl = (
                      e.currentTarget as HTMLElement
                    ).querySelector("img");
                    const newSrc = imageArray[newIndex];
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
                    const imgEl = (
                      e.currentTarget as HTMLElement
                    ).querySelector("img");
                    const firstSrc = imageArray[0];
                    if (imgEl && firstSrc) {
                      imgEl.src = firstSrc;
                    }
                  }
                : undefined
            }
          >
            <div
              className="dynamic-views-image-embed"
              style={{ "--cover-image-url": `url("${imageArray[0] || ""}")` }}
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
                onLoad={(e: Event) => handleJsxImageLoad(e, updateLayoutRef)}
                onError={(e: Event) => handleJsxImageError(e, updateLayoutRef)}
              />
            </div>
          </div>
        ) : (
          <div className="card-thumbnail-placeholder"></div>
        ))}

      {/* Properties - 14-field rendering with 7-row layout, split by position */}
      {(() => {
        // Check if any row has content
        // When labels are enabled, show row if property is configured (even if value is empty)
        // When labels are hidden, only show row if value exists
        const row1HasContent =
          settings.propertyLabels !== "hide"
            ? card.propertyName1 !== undefined ||
              card.propertyName2 !== undefined
            : card.property1 !== null || card.property2 !== null;
        const row2HasContent =
          settings.propertyLabels !== "hide"
            ? card.propertyName3 !== undefined ||
              card.propertyName4 !== undefined
            : card.property3 !== null || card.property4 !== null;
        const row3HasContent =
          settings.propertyLabels !== "hide"
            ? card.propertyName5 !== undefined ||
              card.propertyName6 !== undefined
            : card.property5 !== null || card.property6 !== null;
        const row4HasContent =
          settings.propertyLabels !== "hide"
            ? card.propertyName7 !== undefined ||
              card.propertyName8 !== undefined
            : card.property7 !== null || card.property8 !== null;
        const row5HasContent =
          settings.propertyLabels !== "hide"
            ? card.propertyName9 !== undefined ||
              card.propertyName10 !== undefined
            : card.property9 !== null || card.property10 !== null;
        const row6HasContent =
          settings.propertyLabels !== "hide"
            ? card.propertyName11 !== undefined ||
              card.propertyName12 !== undefined
            : card.property11 !== null || card.property12 !== null;
        const row7HasContent =
          settings.propertyLabels !== "hide"
            ? card.propertyName13 !== undefined ||
              card.propertyName14 !== undefined
            : card.property13 !== null || card.property14 !== null;

        if (
          !row1HasContent &&
          !row2HasContent &&
          !row3HasContent &&
          !row4HasContent &&
          !row5HasContent &&
          !row6HasContent &&
          !row7HasContent
        )
          return null;

        // Build row elements

        const row1 = row1HasContent && (
          <div
            className={`property-row property-row-1${settings.propertyGroup1SideBySide ? " property-row-sidebyside" : ""}${
              (card.property1 === null && card.property2 !== null) ||
              (card.property1 !== null && card.property2 === null)
                ? " property-row-single"
                : ""
            }`}
          >
            <div className="property-field property-field-1">
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
            <div className="property-field property-field-2">
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

        const row2 = row2HasContent && (
          <div
            className={`property-row property-row-2${settings.propertyGroup2SideBySide ? " property-row-sidebyside" : ""}${
              (card.property3 === null && card.property4 !== null) ||
              (card.property3 !== null && card.property4 === null)
                ? " property-row-single"
                : ""
            }`}
          >
            <div className="property-field property-field-3">
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
            <div className="property-field property-field-4">
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

        const row3 = row3HasContent && (
          <div
            className={`property-row property-row-3${settings.propertyGroup3SideBySide ? " property-row-sidebyside" : ""}${
              (card.property5 === null && card.property6 !== null) ||
              (card.property5 !== null && card.property6 === null)
                ? " property-row-single"
                : ""
            }`}
          >
            <div className="property-field property-field-5">
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
            <div className="property-field property-field-6">
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

        const row4 = row4HasContent && (
          <div
            className={`property-row property-row-4${settings.propertyGroup4SideBySide ? " property-row-sidebyside" : ""}${
              (card.property7 === null && card.property8 !== null) ||
              (card.property7 !== null && card.property8 === null)
                ? " property-row-single"
                : ""
            }`}
          >
            <div className="property-field property-field-7">
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
            <div className="property-field property-field-8">
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

        const row5 = row5HasContent && (
          <div
            className={`property-row property-row-5${settings.propertyGroup5SideBySide ? " property-row-sidebyside" : ""}${
              (card.property9 === null && card.property10 !== null) ||
              (card.property9 !== null && card.property10 === null)
                ? " property-row-single"
                : ""
            }`}
          >
            <div className="property-field property-field-9">
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
            <div className="property-field property-field-10">
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

        const row6 = row6HasContent && (
          <div
            className={`property-row property-row-6${settings.propertyGroup6SideBySide ? " property-row-sidebyside" : ""}${
              (card.property11 === null && card.property12 !== null) ||
              (card.property11 !== null && card.property12 === null)
                ? " property-row-single"
                : ""
            }`}
          >
            <div className="property-field property-field-11">
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
            <div className="property-field property-field-12">
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

        const row7 = row7HasContent && (
          <div
            className={`property-row property-row-7${settings.propertyGroup7SideBySide ? " property-row-sidebyside" : ""}${
              (card.property13 === null && card.property14 !== null) ||
              (card.property13 !== null && card.property14 === null)
                ? " property-row-single"
                : ""
            }`}
          >
            <div className="property-field property-field-13">
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
            <div className="property-field property-field-14">
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

        // Split rows by position setting
        const topRows: JSX.Element[] = [];
        const bottomRows: JSX.Element[] = [];

        if (row1) {
          if (settings.propertyGroup1Position === "top") topRows.push(row1);
          else bottomRows.push(row1);
        }
        if (row2) {
          if (settings.propertyGroup2Position === "top") topRows.push(row2);
          else bottomRows.push(row2);
        }
        if (row3) {
          if (settings.propertyGroup3Position === "top") topRows.push(row3);
          else bottomRows.push(row3);
        }
        if (row4) {
          if (settings.propertyGroup4Position === "top") topRows.push(row4);
          else bottomRows.push(row4);
        }
        if (row5) {
          if (settings.propertyGroup5Position === "top") topRows.push(row5);
          else bottomRows.push(row5);
        }
        if (row6) {
          if (settings.propertyGroup6Position === "top") topRows.push(row6);
          else bottomRows.push(row6);
        }
        if (row7) {
          if (settings.propertyGroup7Position === "top") topRows.push(row7);
          else bottomRows.push(row7);
        }

        return (
          <>
            {topRows.length > 0 && (
              <div className="card-properties card-properties-top properties-4field">
                {topRows}
              </div>
            )}
            {bottomRows.length > 0 && (
              <div className="card-properties card-properties-bottom properties-4field">
                {bottomRows}
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}
