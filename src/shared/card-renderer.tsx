/**
 * Shared card renderer - Pure rendering component
 * Works with both Bases and Datacore by accepting normalized card data
 */

import type { App, PaneType } from "obsidian";
import { TFile, TFolder, setIcon, Menu, Keymap } from "obsidian";
import type { ResolvedSettings } from "../types";
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
  getUrlIcon,
  getCoverHoverZoomMode,
} from "../utils/style-settings";
import {
  getPropertyLabel,
  normalizePropertyName,
  stripNotePrefix,
} from "../utils/property";
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
  filterBrokenUrls,
  markImageBroken,
  setupHoverZoomEligibility,
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
  setupVerticalScrollGradient,
} from "./scroll-gradient";
import {
  handleArrowNavigation,
  isArrowKey,
  isImageViewerBlockingNav,
} from "./keyboard-nav";
import {
  CHECKBOX_MARKER_PREFIX,
  THUMBNAIL_STACK_MULTIPLIER,
} from "./constants";
import { setupHoverIntent } from "./hover-intent";

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
 * Render file format indicator as JSX (for Flair mode)
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

/**
 * Renders a list of tags with click handlers for search navigation
 * Used by both 'tags' (YAML only) and 'file.tags' (YAML + body) properties
 */
function renderTagsList(tags: string[], app: App, showHashPrefix: boolean) {
  return (
    <div className="tags-wrapper">
      {tags.map(
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
              const searchPlugin = app.internalPlugins.plugins["global-search"];
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
  );
}

/**
 * Renders a folder path segment with click and context menu handlers
 * Used by both 'file.path' (folder portions) and 'file.folder' properties
 */
function renderFolderSegment(
  folder: string,
  cumulativePath: string,
  isLast: boolean,
  app: App,
) {
  return (
    <span key={cumulativePath} className="path-segment-wrapper">
      <span
        className="path-segment folder-segment"
        onClick={(e: MouseEvent) => {
          e.stopPropagation();
          const folderFile = app.vault.getAbstractFileByPath(cumulativePath);
          if (shouldUseNotebookNavigator(app, "folder")) {
            if (
              folderFile instanceof TFolder &&
              navigateToFolderInNotebookNavigator(app, folderFile)
            ) {
              return;
            }
          }
          const fileExplorer = app.internalPlugins?.plugins?.["file-explorer"];
          if (fileExplorer?.instance?.revealInFolder && folderFile) {
            fileExplorer.instance.revealInFolder(folderFile);
          }
        }}
        onContextMenu={(e: MouseEvent) => {
          e.stopPropagation();
          e.preventDefault();
          const folderFile = app.vault.getAbstractFileByPath(cumulativePath);
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
      {!isLast && <span className="path-separator">/</span>}
    </span>
  );
}

/**
 * Renders a filename segment with click and context menu handlers
 * Used by 'file.path' property for the final segment
 */
function renderFilenameSegment(filename: string, filePath: string, app: App) {
  return (
    <span key={filePath} className="path-segment-wrapper">
      <span
        className="path-segment filename-segment"
        onClick={(e: MouseEvent) => {
          e.stopPropagation();
          const file = app.vault.getAbstractFileByPath(filePath);
          if (shouldUseNotebookNavigator(app, "file")) {
            if (
              file instanceof TFile &&
              revealFileInNotebookNavigator(app, file)
            ) {
              return;
            }
          }
          const fileExplorer = app.internalPlugins?.plugins?.["file-explorer"];
          if (fileExplorer?.instance?.revealInFolder && file) {
            fileExplorer.instance.revealInFolder(file);
          }
        }}
        onContextMenu={(e: MouseEvent) => {
          e.stopPropagation();
          e.preventDefault();
          const file = app.vault.getAbstractFileByPath(filePath);
          if (file instanceof TFile) {
            showFileContextMenu(e, app, file, filePath);
          }
        }}
      >
        {filename}
      </span>
    </span>
  );
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

/** Per-element hover intent state (WeakMap avoids path collisions across containers) */
const cardHoverIntentState = new WeakMap<
  HTMLElement,
  { controller: AbortController; zoomMode: string }
>();

/** Per-element image viewer hover intent (survives Preact re-renders) */
const imageViewerHoverIntentState = new WeakMap<HTMLElement, AbortController>();

/** Per-element keyboard nav hover intent (survives Preact re-renders) */
const keyboardNavHoverIntentState = new WeakMap<HTMLElement, AbortController>();

// Module-level WeakMap to track container cleanup functions (avoids stale closure per render)
const containerCleanupMap = new WeakMap<HTMLElement, () => void>();

// Module-level WeakMap to track previous cssclasses for each container (prevents unnecessary DOM mutations)
const containerCssClassesMap = new WeakMap<HTMLElement, string[]>();

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
  /**
   * PRESERVED FOR FUTURE REWORK - DO NOT REMOVE UNTIL EXPLICIT USER INSTRUCTION
   * Property array structure retained for future Bases-like property configuration.
   */
  properties: Array<{ name: string; value: unknown }>;
  // Datacore-only: indexed property accessors (kept until Datacore refactor)
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
}

export interface CardRendererProps {
  cards: CardData[];
  settings: ResolvedSettings;
  viewMode: "grid" | "masonry";
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
 * PRESERVED FOR FUTURE REWORK - DO NOT REMOVE UNTIL EXPLICIT USER INSTRUCTION
 * This function renders property content and will be extended to match Bases
 * implementation when Datacore property configuration is reworked.
 */
function renderPropertyContent(
  propertyName: string,
  card: CardData,
  resolvedValue: unknown,
  timeIcon: "calendar" | "clock",
  settings: ResolvedSettings,
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

    // Hover zoom eligibility: only first hovered slide gets zoom effect
    const clearHoverZoom = setupHoverZoomEligibility(
      slideshowEl,
      imageEmbed,
      signal,
    );

    // Create navigator with shared logic
    const { navigate, reset } = createSlideshowNavigator(
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
          // Only set aspect ratio if not yet set by a successful image load
          // (first image may have failed and set default ratio)
          if (cardEl && !cardEl.dataset.aspectRatioSet) {
            handleImageLoad(nextImg, cardEl, updateLayoutRef.current);
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
    const firstImg = imageEmbed.querySelector(
      ".slideshow-img-current",
    ) as HTMLImageElement;
    if (firstImg) {
      // Use exact URL for comparison (avoids fragile substring matching)
      const expectedSrc = imageArray[0];
      firstImg.addEventListener(
        "error",
        (e) => {
          // Ignore errors from src being cleared or changed (use event target for race safety)
          const targetSrc = (e.target as HTMLImageElement).src;
          if (!targetSrc || targetSrc !== expectedSrc) {
            return;
          }
          markImageBroken(expectedSrc);
          firstImg.addClass("dynamic-views-hidden");
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
        <div
          className="slideshow-indicator"
          ref={(el: HTMLElement | null) => {
            if (el) setIcon(el, "lucide-circle-chevron-right");
          }}
        />
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
  settings: ResolvedSettings,
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
  const isEmpty = !resolvedValue;
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

  // Handle checkbox properties - render as native Obsidian checkbox
  if (resolvedValue.startsWith(CHECKBOX_MARKER_PREFIX)) {
    try {
      const checkboxData = JSON.parse(resolvedValue) as {
        type: string;
        checked?: boolean;
        indeterminate?: boolean;
      };
      if (checkboxData.type === "checkbox") {
        const handleCheckboxClick = (e: Event): void => {
          e.stopPropagation();
          const input = e.target as HTMLInputElement;
          // Clear indeterminate state on click
          input.indeterminate = false;
          input.dataset.indeterminate = "false";
          const file = app.vault.getAbstractFileByPath(card.path);
          if (!(file instanceof TFile)) return;
          const fmProp = stripNotePrefix(propertyName);
          void app.fileManager.processFrontMatter(
            file,
            (frontmatter: Record<string, unknown>) => {
              frontmatter[fmProp] = input.checked;
            },
          );
        };
        const handleCheckboxRef = (el: HTMLInputElement | null): void => {
          if (el && checkboxData.indeterminate) {
            el.indeterminate = true;
          }
        };
        return (
          <>
            {labelAbove}
            {labelInline}
            <div className="property-content-wrapper" tabIndex={-1}>
              <div className="property-content">
                <input
                  className="metadata-input-checkbox"
                  type="checkbox"
                  checked={checkboxData.checked ?? false}
                  data-indeterminate={
                    checkboxData.indeterminate ? "true" : "false"
                  }
                  onClick={handleCheckboxClick}
                  ref={handleCheckboxRef}
                />
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
    return (
      <>
        {labelAbove}
        {labelInline}
        <div className="property-content-wrapper" tabIndex={-1}>
          <div className="property-content">
            {renderTagsList(card.yamlTags, app, showTagHashPrefix())}
          </div>
        </div>
      </>
    );
  } else if (
    (propertyName === "file.tags" || propertyName === "file tags") &&
    card.tags.length > 0
  ) {
    // tags in YAML + note body
    return (
      <>
        {labelAbove}
        {labelInline}
        <div className="property-content-wrapper" tabIndex={-1}>
          <div className="property-content">
            {renderTagsList(card.tags, app, showTagHashPrefix())}
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
    // File path property: folder segments + filename segment
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

                return isLastSegment
                  ? renderFilenameSegment(segment, cumulativePath, app)
                  : renderFolderSegment(segment, cumulativePath, false, app);
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
    // Folder property: all segments are folders
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
                return renderFolderSegment(
                  folder,
                  cumulativePath,
                  idx === folders.length - 1,
                  app,
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
  return (
    <div
      ref={(el: HTMLElement | null) => {
        // Get previous element before updating ref (for cleanup lookup)
        const prevEl = containerRef?.current;

        // Store in containerRef
        if (containerRef) {
          (containerRef as { current: HTMLElement | null }).current = el;
        }

        // Call cleanup when element is removed (unmount)
        if (!el) {
          // Get cleanup from WeakMap using previous element
          if (prevEl) {
            const cleanup = containerCleanupMap.get(prevEl);
            cleanup?.();
            containerCleanupMap.delete(prevEl);
            containerCssClassesMap.delete(prevEl);
          }
          return;
        }

        // Apply custom CSS classes from settings (mimics cssclasses frontmatter)
        const customClasses = settings.cssclasses
          .split(",")
          .map((cls) => cls.trim())
          .filter(Boolean);

        // Get previous classes for this element
        const previousClasses = containerCssClassesMap.get(el) || [];

        // Only update if classes changed (prevents unnecessary DOM mutations)
        const classesChanged =
          previousClasses.length !== customClasses.length ||
          !previousClasses.every((cls, i) => cls === customClasses[i]);

        if (classesChanged) {
          // Clear previous custom classes
          previousClasses.forEach((cls) => {
            el.classList.remove(cls);
          });

          // Apply new custom classes
          customClasses.forEach((cls) => {
            el.classList.add(cls);
          });

          // Store for next update
          containerCssClassesMap.set(el, customClasses);
        }

        // Skip if already setup (avoid duplicates on re-render)
        if (containerCleanupMap.has(el)) {
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

        // Store cleanup function in WeakMap keyed by element (survives across renders)
        containerCleanupMap.set(el, () => {
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
        });
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
  settings: ResolvedSettings;
  viewMode: "grid" | "masonry";
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
  const finalTitle = displayTitle;

  // Compute extension info once for use in title data-ext and renderFileExt
  const extInfo = getFileExtInfo(card.path, isFullname);
  const extNoDot = extInfo?.ext.slice(1) || "";

  // Handle images
  const isArray = Array.isArray(card.imageUrl);
  const scrubbingDisabled = isThumbnailScrubbingDisabled();
  const imageArray: string[] = filterBrokenUrls(
    isArray
      ? (card.imageUrl as (string | string[])[])
          .flat()
          .filter(
            (url): url is string => typeof url === "string" && url.length > 0,
          )
          .slice(0, scrubbingDisabled ? 1 : 10)
      : card.imageUrl
        ? [card.imageUrl as string]
        : [],
  );
  // Enable scrubbing only on desktop with multiple images and setting enabled
  const enableScrubbing =
    !app.isMobile && isArray && imageArray.length > 1 && !scrubbingDisabled;

  const hasImageSource =
    !!settings.imageProperty?.trim() || settings.fallbackToEmbeds !== "never";

  const format = settings.imageFormat;
  const position = settings.imagePosition;

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
  } else if (format === "poster") {
    cardClasses.push("image-format-poster");
    cardClasses.push(`card-cover-${settings.imageFit}`);
  } else if (format === "backdrop") {
    cardClasses.push("image-format-backdrop");
    cardClasses.push(`card-cover-${settings.imageFit}`);
  }

  // Drag handler for card-level drag (reuses shared utility)
  const handleDrag = createFileDragHandler(app, card.path);

  // Create AbortController for scroll listeners (accessible to child refs)
  // Only registered in map when card mounts (avoids orphaned controllers)
  const scrollController = new AbortController();

  // Cache scroll mode checks (avoid repeated DOM queries in ref callbacks)
  const isTitleScrollMode = document.body.classList.contains(
    "dynamic-views-title-overflow-scroll",
  );
  const isSubtitleScrollMode = document.body.classList.contains(
    "dynamic-views-subtitle-overflow-scroll",
  );

  // Helper function to render title JSX
  const renderTitle = () => {
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
        {settings.openFileAction === "title" ||
        (format === "poster" && app.isMobile && card.imageUrl) ? (
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
            <span className="card-title-text">{finalTitle}</span>
            {extNoDot && (
              <span className="card-title-ext-suffix">.{extNoDot}</span>
            )}
          </span>
        ) : (
          <>
            <span className="card-title-text">{finalTitle}</span>
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

  const renderCoverWrapper = () => (
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
                openFileAction={settings.openFileAction}
              />
            );
          }

          return (
            <div className="card-cover">
              <div
                className="dynamic-views-image-embed"
                onClick={(e: MouseEvent) => {
                  handleImageViewerClick(
                    e,
                    card.path,
                    app,
                    viewerCleanupFns,
                    viewerClones,
                    settings.openFileAction,
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
  );

  // Check if title or subtitle will be rendered
  const hasTitle = !!displayTitle;
  const hasSubtitle = settings.subtitleProperty && card.subtitle;

  return (
    <div
      className={cardClasses.join(" ")}
      data-path={card.path}
      ref={(cardEl: HTMLElement | null) => {
        if (!cardEl) {
          // Cleanup scroll listeners when card unmounts
          cleanupCardScrollListeners(card.path);
          return;
        }

        // Register controller only when card mounts (cleanup existing first)
        cleanupCardScrollListeners(card.path);
        cardScrollAbortControllers.set(card.path, scrollController);

        // Setup scroll gradients for property fields (setupScrollGradients has internal double RAF)
        setupScrollGradients(
          cardEl,
          updateScrollGradient,
          scrollController.signal,
        );

        // Measure side-by-side property field widths (double RAF to ensure DOM is ready)
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            // Guard against race: card may be unmounted before inner RAF executes
            if (!cardEl.isConnected) return;

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

        // Setup side cover dimensions (for left/right cover position)
        if (
          format === "cover" &&
          (position === "left" || position === "right")
        ) {
          requestAnimationFrame(() => {
            // Guard against race: card may be unmounted before RAF executes
            if (!cardEl.isConnected) return;

            // Get aspect ratio from settings
            const aspectRatio =
              typeof settings.imageRatio === "string"
                ? parseFloat(settings.imageRatio)
                : settings.imageRatio || 1.0;
            const wrapperRatio = aspectRatio / (aspectRatio + 1);

            // Set wrapper ratio for potential CSS calc usage
            cardEl.style.setProperty(
              "--dynamic-views-wrapper-ratio",
              wrapperRatio.toString(),
            );

            // Function to calculate and set wrapper dimensions
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

                if (newCardWidth === 0) continue;

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
          });
        }

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
          (position === "left" || position === "right");

        const responsiveObserver = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const cardWidth = entry.contentRect.width;

            // Compact mode
            if (breakpoint > 0) {
              cardEl.classList.toggle("compact-mode", cardWidth < breakpoint);
            }

            // Thumbnail stacking via CSS class only (CSS order handles positioning)
            if (needsThumbnailStacking) {
              const thumbnailEl = cardEl.querySelector(
                ".card-thumbnail, .card-thumbnail-placeholder",
              );
              if (thumbnailEl) {
                const thumbnailWidth = (thumbnailEl as HTMLElement).offsetWidth;
                const isStacked =
                  cardWidth < thumbnailWidth * THUMBNAIL_STACK_MULTIPLIER;
                cardEl.classList.toggle("thumbnail-stack", isStacked);
              }
            }
          }
        });
        responsiveObserver.observe(cardEl);
        cardResponsiveObservers.set(card.path, responsiveObserver);

        // Cover hover zoom intent (element-scoped to survive Preact re-renders)
        if (format === "cover" && window.matchMedia("(hover: hover)").matches) {
          const zoomMode = getCoverHoverZoomMode();
          if (zoomMode !== "off") {
            const targetEl =
              zoomMode === "cover"
                ? (cardEl.querySelector(".card-cover") as HTMLElement)
                : cardEl;
            if (targetEl) {
              const existing = cardHoverIntentState.get(cardEl);
              if (
                !existing ||
                existing.controller.signal.aborted ||
                existing.zoomMode !== zoomMode
              ) {
                existing?.controller.abort();
                const hoverAbort = new AbortController();
                cardHoverIntentState.set(cardEl, {
                  controller: hoverAbort,
                  zoomMode,
                });
                setupHoverIntent(
                  targetEl,
                  () => cardEl.classList.add("cover-hover-active"),
                  () => cardEl.classList.remove("cover-hover-active"),
                  hoverAbort.signal,
                );
              }
            }
          }
        }

        // Image viewer cursor hover intent (element-scoped to survive Preact re-renders)
        if (window.matchMedia("(hover: hover)").matches) {
          const existingIv = imageViewerHoverIntentState.get(cardEl);
          if (!existingIv || existingIv.signal.aborted) {
            existingIv?.abort();
            const hoverAbort = new AbortController();
            imageViewerHoverIntentState.set(cardEl, hoverAbort);
            setupHoverIntent(
              cardEl,
              () => cardEl.classList.add("image-viewer-hover-active"),
              () => cardEl.classList.remove("image-viewer-hover-active"),
              hoverAbort.signal,
            );
          }
        }

        // Keyboard nav hover intent (element-scoped to survive Preact re-renders)
        if (hoveredCardRef) {
          const existingKb = keyboardNavHoverIntentState.get(cardEl);
          if (!existingKb || existingKb.signal.aborted) {
            existingKb?.abort();
            const hoverAbort = new AbortController();
            keyboardNavHoverIntentState.set(cardEl, hoverAbort);
            setupHoverIntent(
              cardEl,
              () => {
                (hoveredCardRef as { current: HTMLElement | null }).current =
                  cardEl;
              },
              () => {
                (hoveredCardRef as { current: HTMLElement | null }).current =
                  null;
              },
              hoverAbort.signal,
            );
          }
        }
      }}
      draggable={settings.openFileAction === "card"}
      onDragStart={settings.openFileAction === "card" ? handleDrag : undefined}
      tabIndex={index === focusableCardIndex ? 0 : -1}
      onClick={(e: MouseEvent) => {
        // Poster tap toggle: mobile only (desktop uses hover intent)
        if (format === "poster" && app.isMobile) {
          const cardEl = e.currentTarget as HTMLElement;
          if (cardEl.querySelector(".card-poster")) {
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
        }

        // Card-level click-to-open: mobile except poster cards with images (poster with image uses tap-to-reveal)
        if (
          settings.openFileAction === "card" &&
          !(app.isMobile && format === "poster" && card.imageUrl)
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
          if (isImageViewerBlockingNav(containerRef.current)) return;
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
        // Trigger Obsidian's hover preview (only on card when openFileAction is 'card')
        if (settings.openFileAction === "card") {
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
      onMouseLeave={(e: MouseEvent) => {
        if (format === "poster") {
          (e.currentTarget as HTMLElement).classList.remove(
            "poster-hover-active",
          );
        }
      }}
      onMouseMove={(e: MouseEvent) => {
        if (format === "poster") {
          const cardEl = e.currentTarget as HTMLElement;
          if (!cardEl.classList.contains("poster-hover-active")) {
            cardEl
              .closest(".dynamic-views")
              ?.querySelector(".card.poster-hover-active")
              ?.classList.remove("poster-hover-active");
            cardEl.classList.add("poster-hover-active");
          }
        }
      }}
      onContextMenu={(e: MouseEvent) => {
        // Show file context menu when openFileAction is 'card'
        if (settings.openFileAction === "card") {
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
        if (settings.openFileAction === "title") {
          e.stopPropagation();
        }
      }}
      style={{
        cursor: settings.openFileAction === "card" ? "pointer" : "default",
      }}
    >
      {/* Cover: before .card-content for top/left position */}
      {format === "cover" &&
        (imageArray.length > 0 || hasImageSource) &&
        (position === "top" || position === "left") &&
        renderCoverWrapper()}

      {/* Poster: absolute-positioned image fills entire card */}
      {format === "poster" && imageArray.length > 0 && (
        <div className="card-poster">
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

      {format === "backdrop" && imageArray.length > 0 && (
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

      {/* Universal content wrapper: header + body */}
      <div className="card-content">
        {/* Title, Subtitle, and URL button */}
        {(hasTitle || hasSubtitle || (card.hasValidUrl && card.urlValue)) && (
          <div className="card-header">
            {(hasTitle || hasSubtitle) && (
              <div className="card-title-block">
                {hasTitle && renderTitle()}
                {renderSubtitle()}
              </div>
            )}
            {card.hasValidUrl && card.urlValue && (
              <span
                className="card-title-url-icon text-icon-button svg-icon"
                aria-label={card.urlValue}
                onClick={(e: MouseEvent) => {
                  e.preventDefault();
                  e.stopPropagation();
                  window.open(card.urlValue!, "_blank", "noopener,noreferrer");
                }}
                ref={(el: HTMLElement | null) => {
                  if (el) setIcon(el, getUrlIcon());
                }}
              />
            )}
          </div>
        )}

        {/* Universal card-body: properties + previews */}
        <div
          className="card-body"
          ref={(el: HTMLElement | null) => {
            if (el && format === "poster") {
              setupVerticalScrollGradient(el, scrollController.signal);
            }
          }}
        >
          {/* Properties and previews in correct DOM order */}
          {(() => {
            const props = card.properties;
            const hideEmptyMode = getHideEmptyMode();
            const hideMissing = shouldHideMissingProperties();
            const { propertyLabels } = settings;

            // Parse override lists for O(1) lookup
            const unpairSet = parsePropertyList(settings.invertPropertyPairing);
            const invertPositionSet = parsePropertyList(
              settings.invertPropertyPosition,
            );

            // Group properties into sets based on pairing settings
            interface PropertySet {
              props: Array<{
                name: string;
                value: unknown;
                fieldIndex: number;
              }>;
              paired: boolean;
            }

            // Build top/bottom property elements
            const topElements: JSX.Element[] = [];
            const bottomElements: JSX.Element[] = [];

            if (props && props.length > 0) {
              // Pre-filter: exclude properties that will be collapsed
              const visibleProps: Array<{
                name: string;
                value: unknown;
                fieldIndex: number;
              }> = [];
              for (let idx = 0; idx < props.length; idx++) {
                const prop = props[idx];
                if (
                  shouldCollapseFieldDatacore(
                    prop.name || undefined,
                    prop.value,
                    propertyLabels,
                    hideEmptyMode,
                    hideMissing,
                  )
                ) {
                  continue;
                }
                visibleProps.push({ ...prop, fieldIndex: idx + 1 });
              }

              // Pre-compute pairs when pairProperties OFF
              const invertPairs = settings.pairProperties
                ? null
                : computeInvertPairs(props, unpairSet);

              const sets: PropertySet[] = [];
              let i = 0;
              while (i < visibleProps.length) {
                const current = visibleProps[i];
                const next =
                  i + 1 < visibleProps.length ? visibleProps[i + 1] : null;

                let shouldPair = false;
                if (settings.pairProperties) {
                  shouldPair =
                    next !== null &&
                    !unpairSet.has(current.name) &&
                    !unpairSet.has(next.name);
                } else if (invertPairs) {
                  shouldPair =
                    next !== null &&
                    invertPairs.get(current.fieldIndex - 1) ===
                      next.fieldIndex - 1;
                }

                if (shouldPair && next) {
                  sets.push({ props: [current, next], paired: true });
                  i += 2;
                } else {
                  sets.push({ props: [current], paired: false });
                  i += 1;
                }
              }

              let topPairNum = 0;
              let bottomPairNum = 0;

              sets.forEach((set, setIdx) => {
                const showConfiguredProps =
                  propertyLabels !== "hide" || !hideMissing;
                const hasContent = set.props.some((p) =>
                  showConfiguredProps
                    ? p.name !== ""
                    : p.value !== null && p.value !== undefined,
                );
                if (!hasContent) return;

                const anyInvertedPosition = set.props.some((p) =>
                  invertPositionSet.has(p.name),
                );
                const isAbove = settings.showPropertiesAbove
                  ? !anyInvertedPosition
                  : anyInvertedPosition;

                if (set.paired) {
                  const pairNum = isAbove
                    ? ++topPairNum
                    : topPairNum + ++bottomPairNum;
                  const pairElement = (
                    <div
                      key={`pair-${setIdx}`}
                      className={`property-pair property-pair-${pairNum}`}
                    >
                      {set.props.map((p, pi) => {
                        const posClass = pi === 0 ? "pair-left" : "pair-right";
                        return (
                          <div
                            key={`field-${p.fieldIndex}`}
                            className={`property property-${p.fieldIndex} ${posClass}`}
                          >
                            {p.name &&
                              renderPropertyContent(
                                p.name,
                                card,
                                (p.value as string | null) ?? null,
                                timeIcon,
                                settings,
                                app,
                              )}
                          </div>
                        );
                      })}
                    </div>
                  );
                  if (isAbove) topElements.push(pairElement);
                  else bottomElements.push(pairElement);
                } else {
                  const p = set.props[0];
                  const fieldElement = (
                    <div
                      key={`field-${p.fieldIndex}`}
                      className={`property property-${p.fieldIndex}`}
                    >
                      {p.name &&
                        renderPropertyContent(
                          p.name,
                          card,
                          (p.value as string | null) ?? null,
                          timeIcon,
                          settings,
                          app,
                        )}
                    </div>
                  );
                  if (isAbove) topElements.push(fieldElement);
                  else bottomElements.push(fieldElement);
                }
              });
            }

            // DOM order: properties-top → previews → properties-bottom
            return (
              <>
                {topElements.length > 0 && (
                  <div className="card-properties card-properties-top">
                    {topElements}
                  </div>
                )}

                {/* Previews container (text preview + thumbnail) */}
                {(card.textPreview ||
                  (format === "thumbnail" &&
                    (imageArray.length > 0 || hasImageSource))) && (
                  <div className="card-previews">
                    {card.textPreview && (
                      <div className="card-text-preview-wrapper">
                        <div className="card-text-preview">
                          {card.textPreview}
                        </div>
                      </div>
                    )}
                    {/* Thumbnail */}
                    {format === "thumbnail" &&
                      (imageArray.length > 0 || hasImageSource) &&
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
                                  const imgEl = (
                                    e.currentTarget as HTMLElement
                                  ).querySelector("img");
                                  if (imgEl) {
                                    imgEl.removeClass("dynamic-views-hidden");
                                    if (imgEl.src !== rawUrl) {
                                      imgEl.src = rawUrl;
                                    }
                                  }
                                }
                              : undefined
                          }
                          onMouseLeave={
                            enableScrubbing
                              ? (e: MouseEvent) => {
                                  const firstUrl = imageArray[0];
                                  if (!firstUrl) return;
                                  const imgEl = (
                                    e.currentTarget as HTMLElement
                                  ).querySelector("img");
                                  if (imgEl && firstUrl) {
                                    imgEl.removeClass("dynamic-views-hidden");
                                    imgEl.src = firstUrl;
                                  }
                                }
                              : undefined
                          }
                        >
                          <div
                            className="dynamic-views-image-embed"
                            onClick={(e: MouseEvent) => {
                              handleImageViewerClick(
                                e,
                                card.path,
                                app,
                                viewerCleanupFns,
                                viewerClones,
                                settings.openFileAction,
                              );
                            }}
                          >
                            <img
                              src={imageArray[0] || ""}
                              alt=""
                              ref={(imgEl: HTMLImageElement | null) => {
                                handleJsxImageRef(imgEl, updateLayoutRef);
                                type ImgWithController = HTMLImageElement & {
                                  _errorController?: AbortController;
                                };
                                if (imgEl) {
                                  const existingController = (
                                    imgEl as ImgWithController
                                  )._errorController;
                                  if (existingController)
                                    existingController.abort();
                                }
                                if (imgEl && imageArray.length > 1) {
                                  const controller = new AbortController();
                                  (
                                    imgEl as ImgWithController
                                  )._errorController = controller;

                                  // Preload scrubbable images on hover intent
                                  if (enableScrubbing) {
                                    const cardEl = imgEl.closest(
                                      ".card",
                                    ) as HTMLElement;
                                    if (cardEl) {
                                      setupImagePreload(
                                        cardEl,
                                        imageArray,
                                        controller.signal,
                                      );
                                    }
                                  }

                                  imgEl.addEventListener(
                                    "error",
                                    () => {
                                      if (controller.signal.aborted) return;
                                      const failedSrc = imgEl.src;
                                      markImageBroken(failedSrc);
                                      // Splice broken URL for immediate scrub update
                                      const failedIdx =
                                        imageArray.indexOf(failedSrc);
                                      if (failedIdx !== -1)
                                        imageArray.splice(failedIdx, 1);
                                      // After splice, failedIdx points to next element
                                      if (failedIdx < imageArray.length) {
                                        if (
                                          controller.signal.aborted ||
                                          !imgEl.isConnected
                                        )
                                          return;
                                        imgEl.removeClass(
                                          "dynamic-views-hidden",
                                        );
                                        imgEl.src = imageArray[failedIdx];
                                        return;
                                      }
                                      const cardEl = imgEl.closest(
                                        ".card",
                                      ) as HTMLElement;
                                      if (
                                        cardEl &&
                                        !cardEl.classList.contains(
                                          "cover-ready",
                                        )
                                      ) {
                                        requestAnimationFrame(() => {
                                          if (
                                            controller.signal.aborted ||
                                            !cardEl.isConnected ||
                                            !imgEl.isConnected
                                          )
                                            return;
                                          requestAnimationFrame(() => {
                                            if (
                                              controller.signal.aborted ||
                                              !cardEl.isConnected ||
                                              !imgEl.isConnected
                                            )
                                              return;
                                            imgEl.addClass(
                                              "dynamic-views-hidden",
                                            );
                                            cardEl.style.setProperty(
                                              "--actual-aspect-ratio",
                                              DEFAULT_ASPECT_RATIO.toString(),
                                            );
                                            cardEl.classList.add("cover-ready");
                                            if (updateLayoutRef.current)
                                              updateLayoutRef.current();
                                          });
                                        });
                                      }
                                    },
                                    { signal: controller.signal },
                                  );
                                } else if (imgEl) {
                                  const existingCtrl = (
                                    imgEl as ImgWithController
                                  )._errorController;
                                  if (existingCtrl) existingCtrl.abort();
                                  delete (imgEl as ImgWithController)
                                    ._errorController;
                                }
                              }}
                              onLoad={(e: Event) =>
                                handleJsxImageLoad(e, updateLayoutRef)
                              }
                              onError={
                                imageArray.length <= 1
                                  ? (e: Event) =>
                                      handleJsxImageError(e, updateLayoutRef)
                                  : undefined
                              }
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="card-thumbnail-placeholder"></div>
                      ))}
                  </div>
                )}

                {bottomElements.length > 0 && (
                  <div className="card-properties card-properties-bottom">
                    {bottomElements}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </div>

      {/* Cover: after .card-content for bottom/right position */}
      {format === "cover" &&
        (imageArray.length > 0 || hasImageSource) &&
        (position === "bottom" || position === "right") &&
        renderCoverWrapper()}
    </div>
  );
}
