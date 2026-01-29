import {
  Plugin,
  Notice,
  Editor,
  MarkdownView,
  QueryController,
  TFile,
} from "obsidian";
import { PersistenceManager } from "./src/persistence";
import { View } from "./src/datacore/view";
import { setDatacorePreact } from "./src/jsx-runtime";
import { getAvailablePath } from "./src/utils/file";
import "./src/jsx-runtime"; // Ensure h and Fragment are globally available
import { DynamicViewsGridView, cardViewOptions } from "./src/bases/grid-view";
import {
  DynamicViewsMasonryView,
  masonryViewOptions,
} from "./src/bases/masonry-view";
import { DynamicViewsSettingTab } from "./src/settings-tab";
import type { DatacoreAPI } from "./src/datacore/types";
import {
  openRandomFile,
  toggleShuffleActiveView,
  getPaneType,
} from "./src/utils/randomize";
import {
  cleanupExternalBlobCache,
  initExternalBlobCache,
} from "./src/shared/slideshow";
import { clearInFlightLoads } from "./src/shared/content-loader";
import { invalidateCacheForFile } from "./src/shared/image-loader";

export default class DynamicViews extends Plugin {
  persistenceManager: PersistenceManager;

  // Helper function for datacorejsx blocks
  createView(dc: DatacoreAPI, userQuery?: string) {
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
      });
    };
  }

  async onload() {
    // Initialize blob cache (reset cleanup flag from previous session)
    initExternalBlobCache();

    this.persistenceManager = new PersistenceManager(this);
    await this.persistenceManager.load();

    // Set initial body classes for settings
    const settings = this.persistenceManager.getGlobalSettings();
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

    // Notify Style Settings to parse our CSS
    this.app.workspace.trigger("parse-style-settings");

    this.addCommand({
      id: "create-dynamic-view",
      name: "Create note with Datacore query",
      callback: async () => {
        await this.createExplorerFile();
      },
    });

    this.addCommand({
      id: "insert-dynamic-view-at-cursor",
      name: "Insert Datacore query",
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
      "dices",
      "Open random file from bases view",
      async (evt: MouseEvent) => {
        // Close any zoomed images
        document
          .querySelectorAll(".dynamic-views-image-embed.is-zoomed")
          .forEach((el) => {
            el.classList.remove("is-zoomed");
          });
        const defaultInNewTab =
          this.persistenceManager.getGlobalSettings().openRandomInNewTab;
        await openRandomFile(this.app, getPaneType(evt, defaultInNewTab));
      },
    );

    this.addRibbonIcon("shuffle", "Shuffle bases view", () => {
      // Close any zoomed images
      document
        .querySelectorAll(".dynamic-views-image-embed.is-zoomed")
        .forEach((el) => {
          el.classList.remove("is-zoomed");
        });
      toggleShuffleActiveView(this.app);
    });

    // Add commands for Random and Shuffle
    this.addCommand({
      id: "random-file-from-bases",
      name: "Open random file from bases view",
      callback: async () => {
        // Close any zoomed images
        document
          .querySelectorAll(".dynamic-views-image-embed.is-zoomed")
          .forEach((el) => {
            el.classList.remove("is-zoomed");
          });
        const openInNewPane =
          this.persistenceManager.getGlobalSettings().openRandomInNewTab;
        await openRandomFile(this.app, openInNewPane);
      },
    });

    this.addCommand({
      id: "shuffle-bases-view",
      name: "Shuffle bases view",
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
    return `\`\`\`datacorejsx
const USER_QUERY = \`
// –––– DQL QUERY START ––––

// ––––– DQL QUERY END –––––
\`;

const dv = app.plugins.plugins['dynamic-views'];
return dv.createView(dc, USER_QUERY);
\`\`\`\n`;
  }

  async createExplorerFile() {
    try {
      const activeFile = this.app.workspace.getActiveFile();
      const folderPath =
        activeFile?.parent?.path ??
        this.app.fileManager.getNewFileParent("").path;
      const filePath = getAvailablePath(this.app, folderPath, "Dynamic view");
      const template = this.getQueryTemplate();

      await this.app.vault.create(filePath, template);

      const file = this.app.vault.getFileByPath(filePath);
      if (file) {
        const leaf = this.app.workspace.getLeaf("tab");
        await leaf.openFile(file);
        const view = leaf.view;
        if (view instanceof MarkdownView) {
          const viewState = view.getState();
          viewState.mode = "preview";
          await view.setState(viewState, { history: false });
        }
      }
    } catch (error) {
      new Notice(`Failed to create file. Check console for details.`);
      console.error("File creation failed:", error);
    }
  }

  onunload() {
    // Remove open-on class added during load
    const settings = this.persistenceManager.getGlobalSettings();
    document.body.classList.remove(
      `dynamic-views-open-on-${settings.openFileAction}`,
    );

    // Clean up external blob URL cache to prevent memory leaks
    cleanupExternalBlobCache();
    clearInFlightLoads();
  }
}
