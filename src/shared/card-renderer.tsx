/**
 * Shared card renderer - Pure rendering component
 * Works with both Bases and Datacore by accepting normalized card data
 */

import type { App } from "obsidian";
import { TFile, TFolder, Menu, setIcon } from "obsidian";
import type { Settings } from "../types";
import type { RefObject } from "../types/datacore";
import {
  showTagHashPrefix,
  showTimestampIcon,
  getEmptyValueMarker,
  shouldHideMissingProperties,
  shouldHideEmptyProperties,
  getListSeparator,
  isSlideshowEnabled,
  isSlideshowIndicatorEnabled,
} from "../utils/style-settings";
import { getPropertyLabel, normalizePropertyName } from "../utils/property";
import { findLinksInText, type ParsedLink } from "../utils/link-parser";
import {
  getFileTypeIcon,
  getFileExtInfo,
  stripExtFromTitle,
} from "../utils/file-extension";
import {
  handleJsxImageRef,
  handleJsxImageLoad,
  handleJsxImageError,
} from "./image-loader";
import { handleImageZoomClick } from "./image-zoom-handler";

/**
 * Render file type icon as JSX
 */
function renderFileTypeIcon(path: string) {
  const icon = getFileTypeIcon(path);
  if (!icon) return null;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
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
 * Truncate title text to fit within container with ellipsis
 * Preserves extension visibility when present
 */
function truncateTitleWithExtension(titleEl: HTMLElement): void {
  // Find text element (extension element is optional)
  const textEl =
    titleEl.querySelector<HTMLElement>(".card-title-text-content") ||
    titleEl.querySelector<HTMLElement>("a.internal-link");

  if (!textEl) return;

  const containerStyle = getComputedStyle(titleEl);
  const lineHeight = parseFloat(containerStyle.lineHeight);
  const maxLines = parseInt(
    containerStyle.getPropertyValue("--dynamic-views-title-lines") || "2",
  );
  const maxHeight = lineHeight * maxLines;

  const fullText = textEl.textContent || "";
  if (!fullText) return;

  // Check if truncation needed
  if (titleEl.scrollHeight <= maxHeight) return;

  // Binary search for max text that fits
  let low = 0;
  let high = fullText.length;
  const ellipsis = "…";

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    textEl.textContent = fullText.slice(0, mid) + ellipsis;

    if (titleEl.scrollHeight <= maxHeight) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  // Set final truncated text
  textEl.textContent = fullText.slice(0, low) + ellipsis;

  // Safety: keep reducing if still overflowing (ensures extension visible)
  while (titleEl.scrollHeight > maxHeight && low > 0) {
    low--;
    textEl.textContent = fullText.slice(0, low) + ellipsis;
  }
}

/**
 * Render file extension as JSX
 * When openFileAction is 'title', extension is clickable/draggable
 */
function renderFileExt(
  path: string,
  settings: Settings,
  app: App,
  handleDrag: (e: DragEvent) => void,
  isFullname: boolean,
) {
  // Force show extension when titleProperty is file.fullname (bypass hidden list)
  const extInfo = getFileExtInfo(path, isFullname);
  if (!extInfo) return null;

  if (settings.openFileAction === "title") {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return (
      <span
        className="card-title-ext clickable"
        draggable={true}
        onDragStart={handleDrag}
        onClick={(e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          const newLeaf = e.metaKey || e.ctrlKey;
          void app.workspace.openLinkText(path, "", newLeaf);
        }}
      >
        {extInfo.ext}
      </span>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return <span className="card-title-ext">{extInfo.ext}</span>;
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
const zoomCleanupFns = new Map<HTMLElement, () => void>();
const zoomedOriginalParents = new Map<HTMLElement, HTMLElement>();

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
  snippet?: string;
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
 * Uses ref callback to create imperative slideshow after mount
 */
function CoverSlideshow({
  imageArray,
  updateLayoutRef,
}: {
  imageArray: string[];
  updateLayoutRef: RefObject<(() => void) | null>;
}): JSX.Element {
  const onSlideshowRef = (slideshowEl: HTMLElement | null) => {
    if (!slideshowEl) return;

    let currentSlide = 0;
    const slides = Array.from(slideshowEl.querySelectorAll(".slideshow-slide"));

    const updateSlide = (newIndex: number, direction: "next" | "prev") => {
      const oldSlide = slides[currentSlide];
      const newSlide = slides[newIndex];

      if (!oldSlide || !newSlide) return;

      // Position new slide off-screen in the direction it will enter from
      newSlide.classList.remove("is-active", "slide-left", "slide-right");
      newSlide.classList.add(
        direction === "next" ? "slide-right" : "slide-left",
      );

      // Force reflow to ensure position is set before transition
      void (newSlide as HTMLElement).offsetHeight;

      // Move old slide out and new slide in
      oldSlide.classList.remove("is-active", "slide-left", "slide-right");
      oldSlide.classList.add(
        direction === "next" ? "slide-left" : "slide-right",
      );

      // Add is-active class (keep positioning class, CSS will handle the transition)
      newSlide.classList.add("is-active");

      // Clean up position class after transition completes
      setTimeout(() => {
        newSlide.classList.remove("slide-left", "slide-right");
      }, 310);

      currentSlide = newIndex;
    };

    const leftArrow = slideshowEl.querySelector(".slideshow-nav-left");
    const rightArrow = slideshowEl.querySelector(".slideshow-nav-right");

    leftArrow?.addEventListener("click", (e) => {
      e.stopPropagation();
      const newIndex =
        currentSlide === 0 ? imageArray.length - 1 : currentSlide - 1;
      // Direction based on visual progression: wrapping forward (last->first) should look like going forward
      const direction = currentSlide === 0 ? "next" : "prev";
      updateSlide(newIndex, direction);
    });

    rightArrow?.addEventListener("click", (e) => {
      e.stopPropagation();
      const newIndex =
        currentSlide === imageArray.length - 1 ? 0 : currentSlide + 1;
      // Direction based on visual progression: wrapping back (last->first) should look like going backward
      const direction =
        currentSlide === imageArray.length - 1 ? "prev" : "next";
      updateSlide(newIndex, direction);
    });
  };

  return (
    <div className="card-cover card-cover-slideshow" ref={onSlideshowRef}>
      <div className="slideshow-slides">
        {imageArray.map(
          (url, index): JSX.Element => (
            <div
              key={index}
              className={`slideshow-slide ${index === 0 ? "is-active" : ""}`}
            >
              <div
                className="image-embed"
                style={{ "--cover-image-url": `url("${url}")` }}
              >
                {index === 0 && isSlideshowIndicatorEnabled() && (
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
                <img
                  src={url}
                  alt=""
                  ref={(imgEl: HTMLImageElement | null) => {
                    if (index === 0) handleJsxImageRef(imgEl, updateLayoutRef);
                  }}
                  onLoad={(e: Event) => {
                    if (index === 0) handleJsxImageLoad(e, updateLayoutRef);
                  }}
                  onError={(e: Event) => {
                    if (index === 0) handleJsxImageError(e, updateLayoutRef);
                  }}
                />
              </div>
            </div>
          ),
        )}
      </div>
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSX.Element resolves to any due to Datacore's JSX runtime
): any {
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
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- JSX.Element resolves to any due to Datacore's JSX runtime
  const labelAbove =
    settings.propertyLabels === "above" ? (
      <div className="property-label">{getPropertyLabel(propertyName)}</div>
    ) : null;

  // Render inline label if enabled (as sibling, before property-content)
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- JSX.Element resolves to any due to Datacore's JSX runtime
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
                        onContextMenu={
                          !isLastSegment
                            ? (e: MouseEvent) => {
                                e.stopPropagation();
                                e.preventDefault();
                                const folderFile =
                                  app.vault.getAbstractFileByPath(
                                    cumulativePath,
                                  );
                                if (folderFile instanceof TFolder) {
                                  const menu = new Menu();
                                  app.workspace.trigger(
                                    "file-menu",
                                    menu,
                                    folderFile,
                                    "file-explorer",
                                  );
                                  menu.showAtMouseEvent(
                                    e as unknown as MouseEvent,
                                  );
                                }
                              }
                            : undefined
                        }
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
  containerRef,
  updateLayoutRef,
  app,
  onCardClick,
  onFocusChange,
}: CardRendererProps): unknown {
  return (
    <div
      ref={containerRef}
      className={
        viewMode === "masonry" ? "dynamic-views-masonry" : "dynamic-views-grid"
      }
      style={
        settings.queryHeight > 0
          ? { maxHeight: `${settings.queryHeight}px`, overflowY: "auto" }
          : {}
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
  containerRef,
  updateLayoutRef,
  app,
  onCardClick,
  onFocusChange,
}: CardProps): unknown {
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

  // Handle images
  const isArray = Array.isArray(card.imageUrl);
  const imageArray: string[] = isArray
    ? (card.imageUrl as (string | string[])[])
        .flat()
        .filter(
          (url): url is string => typeof url === "string" && url.length > 0,
        )
    : card.imageUrl
      ? [card.imageUrl as string]
      : [];

  // Track hovered image index (for multi-image thumbnails)
  // TODO: Implement image cycling on hover
  // const hoveredImageIndex = 0;

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

  return (
    <div
      className={cardClasses.join(" ")}
      data-path={card.path}
      draggable={settings.openFileAction === "card"}
      onDragStart={settings.openFileAction === "card" ? handleDrag : undefined}
      tabIndex={index === focusableCardIndex ? 0 : -1}
      onClick={(e: MouseEvent) => {
        // Only handle card-level clicks when openFileAction is 'card'
        // When openFileAction is 'title', the title link handles its own clicks
        if (settings.openFileAction === "card") {
          const target = e.target as HTMLElement;
          // Don't open if clicking on links, tags, or images
          const isLink = target.tagName === "A" || target.closest("a");
          const isTag =
            target.classList.contains("tag") || target.closest(".tag");
          const isImage = target.tagName === "IMG";

          if (!isLink && !isTag && !isImage) {
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
          if (settings.openFileAction === "card") {
            const newLeaf = e.metaKey || e.ctrlKey;
            if (onCardClick) {
              onCardClick(card.path, newLeaf);
            } else {
              void app.workspace.openLinkText(card.path, "", newLeaf);
            }
          }
        } else if (
          ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)
        ) {
          e.preventDefault();
          handleArrowKey(e, index, viewMode, containerRef, onFocusChange);
        } else if (e.key === "Tab") {
          e.preventDefault();
        }
      }}
      onMouseEnter={(e: MouseEvent) => {
        // Trigger Obsidian's hover preview
        app.workspace.trigger("hover-link", {
          event: e,
          source: "dynamic-views",
          hoverParent: e.currentTarget,
          targetEl: e.currentTarget,
          linktext: card.path,
          sourcePath: card.path,
        });
        // Reset hover index to 0
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
      style={{
        cursor: settings.openFileAction === "card" ? "pointer" : "default",
      }}
    >
      {/* Title */}
      {(settings.showTitle || card.hasValidUrl) && (
        <div
          className={card.hasValidUrl ? "card-title-container" : "card-title"}
          ref={(el: HTMLElement | null) => {
            if (
              el &&
              !card.hasValidUrl &&
              !document.body.classList.contains(
                "dynamic-views-title-overflow-scroll",
              )
            ) {
              // Double RAF ensures children are rendered and layout complete
              requestAnimationFrame(() => {
                requestAnimationFrame(() => truncateTitleWithExtension(el));
              });
            }
          }}
        >
          {settings.showTitle && (
            <div
              className={card.hasValidUrl ? "card-title" : undefined}
              ref={(el: HTMLElement | null) => {
                if (
                  el &&
                  card.hasValidUrl &&
                  !document.body.classList.contains(
                    "dynamic-views-title-overflow-scroll",
                  )
                ) {
                  requestAnimationFrame(() => {
                    requestAnimationFrame(() => truncateTitleWithExtension(el));
                  });
                }
              }}
            >
              {renderFileTypeIcon(card.path)}
              {settings.openFileAction === "title" ? (
                <a
                  href={card.path}
                  className="internal-link"
                  data-href={card.path}
                  draggable={true}
                  onDragStart={handleDrag}
                  onClick={(e: MouseEvent) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const newLeaf = e.metaKey || e.ctrlKey;
                    void app.workspace.openLinkText(card.path, "", newLeaf);
                  }}
                >
                  {displayTitle}
                </a>
              ) : (
                <span className="card-title-text-content">{displayTitle}</span>
              )}
              {renderFileExt(card.path, settings, app, handleDrag, isFullname)}
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
        <div className="card-subtitle">
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
              const shouldShowSlideshow =
                isSlideshowEnabled() &&
                (position === "top" || position === "bottom") &&
                imageArray.length >= 2;

              if (shouldShowSlideshow) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- JSX.Element resolves to any due to Datacore's JSX runtime
                return (
                  <CoverSlideshow
                    imageArray={imageArray}
                    updateLayoutRef={updateLayoutRef}
                  />
                );
              }

              // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- JSX.Element resolves to any due to Datacore's JSX runtime
              return (
                <div className="card-cover">
                  <div
                    className="image-embed"
                    style={{
                      "--cover-image-url": `url("${imageArray[0] || ""}")`,
                    }}
                    onClick={(e: MouseEvent) => {
                      handleImageZoomClick(
                        e,
                        card.path,
                        app,
                        zoomCleanupFns,
                        zoomedOriginalParents,
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
          }, 100);
          return null;
        })()}

      {/* Thumbnail-top: between title and text preview */}
      {format === "thumbnail" &&
        position === "top" &&
        (imageArray.length > 0 || card.hasImageAvailable) &&
        (imageArray.length > 0 ? (
          <div
            className={`card-thumbnail ${isArray && imageArray.length > 1 ? "multi-image" : ""}`}
            onMouseMove={
              !app.isMobile && isArray && imageArray.length > 1
                ? (e: MouseEvent) => {
                    const rect = (
                      e.currentTarget as HTMLElement
                    ).getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const section = Math.floor(
                      (x / rect.width) * imageArray.length,
                    );
                    const newIndex = Math.min(section, imageArray.length - 1);
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
              !app.isMobile && isArray && imageArray.length > 1
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
              className="image-embed"
              style={{ "--cover-image-url": `url("${imageArray[0] || ""}")` }}
              onClick={(e: MouseEvent) => {
                handleImageZoomClick(
                  e,
                  card.path,
                  app,
                  zoomCleanupFns,
                  zoomedOriginalParents,
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
      {((settings.showTextPreview && card.snippet) ||
        (format === "thumbnail" &&
          (position === "left" || position === "right") &&
          (imageArray.length > 0 || card.hasImageAvailable))) && (
        <div className="card-content">
          {settings.showTextPreview && card.snippet && (
            <div className="card-text-preview">{card.snippet}</div>
          )}
          {format === "thumbnail" &&
            (position === "left" || position === "right") &&
            (imageArray.length > 0 ? (
              <div
                className={`card-thumbnail ${isArray && imageArray.length > 1 ? "multi-image" : ""}`}
                onMouseMove={
                  !app.isMobile && isArray && imageArray.length > 1
                    ? (e: MouseEvent) => {
                        const rect = (
                          e.currentTarget as HTMLElement
                        ).getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        const section = Math.floor(
                          (x / rect.width) * imageArray.length,
                        );
                        const newIndex = Math.min(
                          section,
                          imageArray.length - 1,
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
                  !app.isMobile &&
                  isArray &&
                  imageArray.length > 1 &&
                  format === "thumbnail"
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
                  className="image-embed"
                  style={{
                    "--cover-image-url": `url("${imageArray[0] || ""}")`,
                  }}
                  onClick={(e: MouseEvent) => {
                    handleImageZoomClick(
                      e,
                      card.path,
                      app,
                      zoomCleanupFns,
                      zoomedOriginalParents,
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
            className={`card-thumbnail ${isArray && imageArray.length > 1 ? "multi-image" : ""}`}
            onMouseMove={
              !app.isMobile && isArray && imageArray.length > 1
                ? (e: MouseEvent) => {
                    const rect = (
                      e.currentTarget as HTMLElement
                    ).getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const section = Math.floor(
                      (x / rect.width) * imageArray.length,
                    );
                    const newIndex = Math.min(section, imageArray.length - 1);
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
              !app.isMobile && isArray && imageArray.length > 1
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
              className="image-embed"
              style={{ "--cover-image-url": `url("${imageArray[0] || ""}")` }}
              onClick={(e: MouseEvent) => {
                handleImageZoomClick(
                  e,
                  card.path,
                  app,
                  zoomCleanupFns,
                  zoomedOriginalParents,
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
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- JSX.Element resolves to any due to Datacore's JSX runtime
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

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- JSX.Element resolves to any due to Datacore's JSX runtime
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

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- JSX.Element resolves to any due to Datacore's JSX runtime
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

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- JSX.Element resolves to any due to Datacore's JSX runtime
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

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- JSX.Element resolves to any due to Datacore's JSX runtime
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

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- JSX.Element resolves to any due to Datacore's JSX runtime
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

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- JSX.Element resolves to any due to Datacore's JSX runtime
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

        // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- JSX.Element resolves to any due to Datacore's JSX runtime
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

// Helper function for arrow key navigation
function handleArrowKey(
  e: KeyboardEvent,
  currentIndex: number,
  viewMode: "card" | "masonry",
  containerRef: RefObject<HTMLElement | null>,
  onFocusChange?: (index: number) => void,
): void {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- querySelectorAll returns Element[], need HTMLElement[] for navigation
  const cards = Array.from(
    containerRef.current?.querySelectorAll(".card") || [],
  ) as HTMLElement[];
  const currentCard = e.currentTarget as HTMLElement;
  const actualIndex = cards.indexOf(currentCard);

  if (actualIndex === -1) return;

  const currentRect = currentCard.getBoundingClientRect();
  const currentX = currentRect.left + currentRect.width / 2;
  const currentY = currentRect.top + currentRect.height / 2;

  let targetCard: HTMLElement | null = null;
  let minDistance = Infinity;

  if (viewMode === "masonry") {
    // 2D navigation based on actual positions
    cards.forEach((card, idx) => {
      if (idx === actualIndex) return;

      const rect = card.getBoundingClientRect();
      const cardX = rect.left + rect.width / 2;
      const cardY = rect.top + rect.height / 2;

      let isValid = false;
      let distance = 0;

      if (e.key === "ArrowDown" && cardY > currentY) {
        if (rect.left !== currentRect.left) return;
        const verticalDist = cardY - currentY;
        const horizontalDist = Math.abs(cardX - currentX);
        distance = verticalDist + horizontalDist * 0.5;
        isValid = true;
      } else if (e.key === "ArrowUp" && cardY < currentY) {
        if (rect.left !== currentRect.left) return;
        const verticalDist = currentY - cardY;
        const horizontalDist = Math.abs(cardX - currentX);
        distance = verticalDist + horizontalDist * 0.5;
        isValid = true;
      } else if (e.key === "ArrowRight" && cardX > currentX) {
        const horizontalDist = cardX - currentX;
        const verticalDist = Math.abs(cardY - currentY);
        distance = horizontalDist + verticalDist * 0.5;
        isValid = true;
      } else if (e.key === "ArrowLeft" && cardX < currentX) {
        const horizontalDist = currentX - cardX;
        const verticalDist = Math.abs(cardY - currentY);
        distance = horizontalDist + verticalDist * 0.5;
        isValid = true;
      }

      if (isValid && distance < minDistance) {
        minDistance = distance;
        targetCard = card;
      }
    });
  } else {
    // Sequential navigation for card view
    let targetIndex = actualIndex;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      targetIndex = actualIndex + 1;
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      targetIndex = actualIndex - 1;
    }
    if (targetIndex >= 0 && targetIndex < cards.length) {
      targetCard = cards[targetIndex];
    }
  }

  if (targetCard) {
    const targetIndex = cards.indexOf(targetCard);
    if (onFocusChange) {
      onFocusChange(targetIndex);
    }
    targetCard.focus();
    targetCard.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

/**
 * Cleanup function to restore all zoomed images and remove event listeners
 * Should be called when a view using CardRenderer is unmounted
 */
export function cleanupZoomState(): void {
  // Cleanup all zoom gestures and restore teleported images
  zoomCleanupFns.forEach((cleanup, embedEl) => {
    // Remove zoom class
    embedEl.classList.remove("is-zoomed");
    // Return to original parent if teleported
    const originalParent = zoomedOriginalParents.get(embedEl);
    if (originalParent && embedEl.parentElement !== originalParent) {
      originalParent.appendChild(embedEl);
    }
    // Call cleanup function (removes event listeners)
    cleanup();
  });
  // Note: WeakMaps will automatically clean up when elements are garbage collected
  // but we can't manually clear them since they don't have a clear() method
}
