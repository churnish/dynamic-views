import {
  Plugin,
  Notice,
  Editor,
  MarkdownView,
  QueryController,
  TFile,
  PaneType,
} from "obsidian";
import { PersistenceManager } from "./src/persistence";
import { View } from "./src/datacore/view";
import { setDatacorePreact } from "./src/jsx-runtime";
import { getAvailablePath, getAvailableBasePath } from "./src/utils/file";
import "./src/jsx-runtime"; // Ensure h and Fragment are globally available
import {
  DynamicViewsGridView,
  GRID_VIEW_TYPE,
  cardViewOptions,
} from "./src/bases/grid-view";
import {
  DynamicViewsMasonryView,
  MASONRY_VIEW_TYPE,
  masonryViewOptions,
} from "./src/bases/masonry-view";
import { DynamicViewsSettingTab } from "./src/settings-tab";
import type { DatacoreAPI } from "./src/datacore/types";
import {
  openRandomFile,
  toggleShuffleActiveView,
  getPaneType,
} from "./src/utils/randomize";
import { clearInFlightLoads } from "./src/shared/content-loader";
import { invalidateCacheForFile } from "./src/shared/image-loader";
import { initTips, cleanupTips } from "./src/utils/tips";

// Plugin/feature names (proper nouns, not subject to sentence case)
const DATACORE = "Datacore";
const GRID_VIEW = "Grid view";
const MASONRY_VIEW = "Masonry view";

export default class DynamicViews extends Plugin {
  persistenceManager: PersistenceManager;

  // Helper function for datacorejsx blocks
  createView(dc: DatacoreAPI, userQuery?: string, queryId?: string) {
    // Initialize jsxRuntime with Datacore's Preact BEFORE returning component
    // This allows all compiled JSX in our components to use Datacore's h function
    setDatacorePreact(dc.preact);

    // Return arrow function component for Datacore to render (preserves 'this' context)
    return (): JSX.Element => {
      // View and all child components now use our h() proxy which delegates to dc.preact.h
      return View({
        plugin: this,
        app: this.app,
        dc,
        USER_QUERY: userQuery || "@page",
        QUERY_ID: queryId,
      });
    };
  }

  /** Generate a 6-char alphanumeric query ID */
  private generateQueryId(): string {
    return Math.random().toString(36).substring(2, 8);
  }

  async onload() {
    this.persistenceManager = new PersistenceManager(this);
    await this.persistenceManager.load();
    initTips(this.persistenceManager);

    // Set initial body classes for settings
    const settings = this.persistenceManager.getPluginSettings();
    document.body.classList.add(
      `dynamic-views-open-on-${settings.openFileAction}`,
    );

    // Register settings tab
    this.addSettingTab(new DynamicViewsSettingTab(this.app, this));

    // Register Bases views
    // Note: Named "Grid" to differentiate from built-in Bases "Cards" view
    this.registerBasesView("dynamic-views-grid", {
      name: "Grid",
      icon: "lucide-grid-2x-2",
      factory: (controller: QueryController, scrollEl: HTMLElement) =>
        new DynamicViewsGridView(controller, scrollEl),
      options: cardViewOptions,
    });

    this.registerBasesView("dynamic-views-masonry", {
      name: "Masonry",
      icon: "panels-right-bottom",
      factory: (controller: QueryController, scrollEl: HTMLElement) =>
        new DynamicViewsMasonryView(controller, scrollEl),
      options: masonryViewOptions,
    });

    // Notify Style Settings to parse our CSS (overrides default class below if installed)
    this.app.workspace.trigger("parse-style-settings");

    // Default file format indicator when Style Settings is not installed
    const fileTypeClasses = [
      "dynamic-views-file-type-ext",
      "dynamic-views-file-type-flair",
      "dynamic-views-file-type-icon",
      "dynamic-views-file-type-none",
    ];
    if (!fileTypeClasses.some((c) => document.body.classList.contains(c))) {
      document.body.classList.add("dynamic-views-file-type-ext");
    }

    this.addCommand({
      id: "create-dynamic-view",
      name: `Create note with ${DATACORE} query`,
      icon: "lucide-file-plus-corner",
      callback: async () => {
        await this.createExplorerFile();
      },
    });

    this.addCommand({
      id: "insert-dynamic-view-at-cursor",
      name: `Insert ${DATACORE} query`,
      icon: "lucide-list-plus",
      editorCheckCallback: (
        checking: boolean,
        editor: Editor,
        view: MarkdownView,
      ) => {
        const cursor = editor.getCursor();
        const lineContent = editor.getLine(cursor.line);
        const isEmptyLine = lineContent.trim().length === 0;

        if (isEmptyLine) {
          if (!checking) {
            const template = this.getQueryTemplate();
            editor.replaceRange(template, cursor);
          }
          return true;
        }

        return false;
      },
    });

    // Add ribbon icons
    this.addRibbonIcon(
      "lucide-grid-2x-2",
      `Create new base with ${GRID_VIEW}`,
      async (evt: MouseEvent) => {
        await this.createBaseFile(
          "dynamic-views-grid",
          "Grid",
          getPaneType(evt, false),
        );
      },
    );

    this.addRibbonIcon(
      "panels-right-bottom",
      `Create new base with ${MASONRY_VIEW}`,
      async (evt: MouseEvent) => {
        await this.createBaseFile(
          "dynamic-views-masonry",
          "Masonry",
          getPaneType(evt, false),
        );
      },
    );

    this.addRibbonIcon("shuffle", "Shuffle base", () => {
      // Close any zoomed images
      document
        .querySelectorAll(".dynamic-views-image-embed.is-zoomed")
        .forEach((el) => {
          el.classList.remove("is-zoomed");
        });
      toggleShuffleActiveView(this.app);
    });

    this.addRibbonIcon(
      "dices",
      "Open random file from base",
      async (evt: MouseEvent) => {
        // Close any zoomed images
        document
          .querySelectorAll(".dynamic-views-image-embed.is-zoomed")
          .forEach((el) => {
            el.classList.remove("is-zoomed");
          });
        const defaultInNewTab =
          this.persistenceManager.getPluginSettings().openRandomInNewTab;
        await openRandomFile(this.app, getPaneType(evt, defaultInNewTab));
      },
    );

    // Add commands for Random and Shuffle
    this.addCommand({
      id: "random-file-from-bases",
      name: "Open random file from base",
      icon: "dices",
      callback: async () => {
        // Close any zoomed images
        document
          .querySelectorAll(".dynamic-views-image-embed.is-zoomed")
          .forEach((el) => {
            el.classList.remove("is-zoomed");
          });
        const openInNewPane =
          this.persistenceManager.getPluginSettings().openRandomInNewTab;
        await openRandomFile(this.app, openInNewPane);
      },
    });

    this.addCommand({
      id: "shuffle-bases-view",
      name: "Shuffle base",
      icon: "shuffle",
      callback: () => {
        // Close any zoomed images
        document
          .querySelectorAll(".dynamic-views-image-embed.is-zoomed")
          .forEach((el) => {
            el.classList.remove("is-zoomed");
          });
        toggleShuffleActiveView(this.app);
      },
    });

    this.addCommand({
      id: "fold-all-groups",
      name: "Fold all groups",
      icon: "lucide-minimize-2",
      checkCallback: (checking) => {
        const view = this.getActiveDVGroupedView();
        if (!view) return false;
        if (!checking) view.foldAllGroups();
        return true;
      },
    });

    this.addCommand({
      id: "unfold-all-groups",
      name: "Unfold all groups",
      icon: "lucide-maximize-2",
      checkCallback: (checking) => {
        const view = this.getActiveDVGroupedView();
        if (!view) return false;
        if (!checking) view.unfoldAllGroups();
        return true;
      },
    });

    this.addCommand({
      id: "create-base-grid-view",
      name: `Create new base with ${GRID_VIEW}`,
      icon: "lucide-grid-2x-2",
      callback: async () => {
        await this.createBaseFile("dynamic-views-grid", "Grid", false);
      },
    });

    this.addCommand({
      id: "create-base-masonry-view",
      name: `Create new base with ${MASONRY_VIEW}`,
      icon: "panels-right-bottom",
      callback: async () => {
        await this.createBaseFile("dynamic-views-masonry", "Masonry", false);
      },
    });

    // Invalidate image metadata cache when vault files are modified (#17)
    // Only invalidate for image files to avoid unnecessary cache clears
    const IMAGE_EXTENSIONS = new Set([
      "png",
      "jpg",
      "jpeg",
      "gif",
      "webp",
      "svg",
      "bmp",
      "ico",
    ]);
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile) {
          const ext = file.extension.toLowerCase();
          if (IMAGE_EXTENSIONS.has(ext)) {
            invalidateCacheForFile(file.path);
          }
        }
      }),
    );

    // Handle editor-drop events for plugin cards
    this.registerEvent(
      this.app.workspace.on("editor-drop", (evt, editor, view) => {
        const data = evt.dataTransfer?.getData("text/plain");

        // Check if it's an obsidian:// URI from our plugin
        if (data && data.startsWith("obsidian://open?vault=")) {
          // Extract file path from URI
          const url = new URL(data);
          const filePath = url.searchParams.get("file");

          if (filePath) {
            // Decode path and get TFile object
            const decodedPath = decodeURIComponent(filePath);
            const file = this.app.vault.getAbstractFileByPath(
              decodedPath + ".md",
            );

            if (file instanceof TFile) {
              // Generate link respecting user's link format settings
              const sourcePath = view.file?.path || "";
              const link = this.app.fileManager.generateMarkdownLink(
                file,
                sourcePath,
              );

              // Insert link at cursor position
              editor.replaceSelection(link);

              // Prevent default behavior
              evt.preventDefault();
            }
          }
        }
      }),
    );
  }

  getQueryTemplate(): string {
    const queryId = this.generateQueryId();
    return `
\`\`\`datacorejsx
const QUERY = \`
// –––– DQL QUERY START ––––

// ––––– DQL QUERY END –––––
\`;
return app.plugins.plugins['dynamic-views'].createView(dc, QUERY, '${queryId}');
\`\`\`\n`;
  }

  async createExplorerFile() {
    try {
      const activeFile = this.app.workspace.getActiveFile();
      const folderPath = this.app.fileManager.getNewFileParent(
        activeFile?.path ?? "",
      ).path;
      const filePath = getAvailablePath(this.app, folderPath, "Untitled");
      const template = this.getQueryTemplate();

      await this.app.vault.create(filePath, template);

      const file = this.app.vault.getFileByPath(filePath);
      if (file) {
        const leaf = this.app.workspace.getLeaf("tab");
        await leaf.openFile(file, { eState: { rename: "all" } });
      }
    } catch (error) {
      new Notice(`Failed to create file. Check console for details.`);
      console.error("File creation failed:", error);
    }
  }

  async createBaseFile(
    viewType: string,
    viewName: string,
    paneType: PaneType | boolean,
  ) {
    try {
      const activeFile = this.app.workspace.getActiveFile();
      const folderPath = this.app.fileManager.getNewFileParent(
        activeFile?.path ?? "",
      ).path;
      const filePath = getAvailableBasePath(this.app, folderPath, "Untitled");
      const minCol = viewType === "dynamic-views-masonry" ? "two" : "one";
      const content = `views:\n  - type: ${viewType}\n    name: ${viewName}\n    minimumColumns: ${minCol}\n`;

      await this.app.vault.create(filePath, content);

      const file = this.app.vault.getFileByPath(filePath);
      if (file) {
        const leaf = this.app.workspace.getLeaf(paneType);
        await leaf.openFile(file, { eState: { rename: "all" } });
      }
    } catch (error) {
      new Notice(`Failed to create base file. Check console for details.`);
      console.error("Base file creation failed:", error);
    }
  }

  private getActiveDVGroupedView():
    | DynamicViewsGridView
    | DynamicViewsMasonryView
    | null {
    const leaf = this.app.workspace.getMostRecentLeaf();
    if (!leaf) return null;
    const view = leaf.view as unknown as {
      controller?: {
        view?: DynamicViewsGridView | DynamicViewsMasonryView;
      };
    };
    const dvView = view?.controller?.view;
    if (!dvView) return null;
    if (
      (dvView.type === GRID_VIEW_TYPE || dvView.type === MASONRY_VIEW_TYPE) &&
      dvView.isGrouped
    ) {
      return dvView;
    }
    return null;
  }

  onunload() {
    // Remove open-on class added during load
    const settings = this.persistenceManager.getPluginSettings();
    document.body.classList.remove(
      `dynamic-views-open-on-${settings.openFileAction}`,
    );

    clearInFlightLoads();
    cleanupTips();
  }
}
