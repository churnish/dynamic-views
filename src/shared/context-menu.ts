/**
 * Shared context menu handler for file cards
 * Used by both Bases and Datacore views
 */

import { App, Menu, Notice, Platform, TFile } from "obsidian";

/**
 * Show context menu for external links (URLs)
 * Matches vanilla Obsidian external link menu
 */
export function showExternalLinkContextMenu(e: MouseEvent, url: string): void {
  e.stopPropagation();
  e.preventDefault();

  const menu = new Menu();

  menu.addItem((item) =>
    item
      .setTitle("Open link in default browser")
      .setIcon("lucide-globe-2")
      .onClick(() => {
        window.open(url, "_blank", "noopener,noreferrer");
      }),
  );

  menu.addSeparator();

  menu.addItem((item) =>
    item
      .setTitle("Copy URL")
      .setIcon("lucide-link")
      .onClick(async () => {
        await navigator.clipboard.writeText(url);
        new Notice("URL copied to clipboard");
      }),
  );

  menu.showAtMouseEvent(e);
}

// SVG icons used in desktop context menu items
const ICONS = {
  filePlus: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-file-plus"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M9 15h6"></path><path d="M12 18v-6"></path></svg>`,
  splitVertical: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-separator-vertical"><line x1="12" x2="12" y1="3" y2="21"></line><polyline points="8 8 4 12 8 16"></polyline><polyline points="16 16 20 12 16 8"></polyline></svg>`,
  edit: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-edit-3"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>`,
  arrowUpRight: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-arrow-up-right"><path d="M7 7h10v10"></path><path d="M7 17 17 7"></path></svg>`,
  trash: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-trash-2"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path><line x1="10" x2="10" y1="11" y2="17"></line><line x1="14" x2="14" y1="11" y2="17"></line></svg>`,
} as const;

// Desktop menu structure (defined at module scope to avoid recreation)
const DESKTOP_MENU_STRUCTURE: Array<{
  items: string[];
  separator?: boolean;
}> = [
  {
    items: ["Open in new tab", "Open to the right", "Open in new window"],
    separator: true,
  },
  {
    items: ["Rename...", "Move file to...", "Bookmark..."],
    separator: true,
  },
  {
    items: ["Copy Obsidian URL", "Copy path", "Copy relative path"],
    separator: true,
  },
  // Note: Fourth group items are dynamic (reveal title varies by platform)
  // and will be constructed at runtime
];

// Mobile menu structure (defined at module scope to avoid recreation)
const MOBILE_MENU_STRUCTURE: Array<{
  items: string[];
  separator?: boolean;
}> = [
  { items: ["Open link", "Open in new tab"], separator: true },
  {
    items: ["Rename...", "Move file to...", "Bookmark..."],
    separator: true,
  },
  { items: ["Copy Obsidian URL"], separator: true },
  { items: ["Share"], separator: true },
];

/**
 * Extract filename from path
 */
function getFilename(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  let filename = lastSlash === -1 ? path : path.substring(lastSlash + 1);

  // Strip .md extension
  if (filename.toLowerCase().endsWith(".md")) {
    filename = filename.slice(0, -3);
  }

  return filename;
}

/**
 * Show a file context menu at the mouse event location
 * Matches vanilla Obsidian file explorer menu structure
 */
export function showFileContextMenu(
  e: MouseEvent,
  app: App,
  file: TFile,
  path: string,
): void {
  e.stopPropagation();
  e.preventDefault();

  const menu = new Menu();
  const isMobile = Platform.isMobile;

  // Build menu based on platform
  if (isMobile) {
    // Mobile: Match vanilla Obsidian mobile menu
    menu.addItem((item) =>
      item
        .setTitle("Open link")
        .setIcon("lucide-file")
        .onClick(() => {
          void app.workspace.openLinkText(path, "", false);
        }),
    );

    menu.addItem((item) =>
      item
        .setTitle("Open in new tab")
        .setIcon("lucide-file-plus")
        .onClick(() => {
          void app.workspace.openLinkText(path, "", "tab");
        }),
    );

    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle("Rename...")
        .setIcon("lucide-edit-3")
        .onClick(async () => {
          try {
            await app.fileManager.promptForFileRename(file);
          } catch {
            new Notice("Failed to rename file");
          }
        }),
    );

    // Native items: Move file to..., Bookmark..., Copy Obsidian URL
    // will be relocated via DOM manipulation

    // Custom Share item (triggers platform share sheet)
    menu.addItem((item) =>
      item
        .setTitle("Share")
        .setIcon("lucide-arrow-up-right")
        .onClick(() => {
          app.openWithDefaultApp(path);
        }),
    );

    menu.addSeparator();

    // Trigger file-menu for plugins/native items
    app.workspace.trigger("file-menu", menu, file, "file-explorer");

    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle("Delete file")
        .setIcon("lucide-trash-2")
        .setWarning(true)
        .onClick(async () => {
          try {
            await app.fileManager.trashFile(file);
          } catch {
            new Notice("Failed to delete file");
          }
        }),
    );
  } else {
    // Desktop: Let Obsidian build menu in correct order, then modify in RAF
    app.workspace.trigger("file-menu", menu, file, "file-explorer");
  }

  menu.showAtMouseEvent(e);

  // Manipulate menu DOM after rendering
  const menuEl = document.body.querySelector(".menu") as HTMLElement;
  if (!menuEl) return;

  // Hide menu during processing to prevent flicker
  menuEl.style.visibility = "hidden";

  // Platform-specific titles to remove (desktop-only items not shown on mobile)
  const titlesToRemove = isMobile
    ? new Set([
        "Merge entire file with...",
        "Open to the right",
        "Open in new window",
        "Copy path",
        "Copy relative path",
        "Open in default app",
        "Reveal in Finder",
        "Show in Explorer",
        "Show in system explorer",
        "Reveal file in navigation",
      ])
    : new Set([
        // Desktop: items to exclude entirely
        "Merge entire file with...",
      ]);

  requestAnimationFrame(() => {
    // Ensure menu still exists (user may have closed it)
    if (!document.body.contains(menuEl)) return;

    try {
      // Add filename label at top for mobile (matching vanilla)
      if (isMobile) {
        const menuScroll = menuEl.querySelector(".menu-scroll");
        if (menuScroll && menuScroll.firstChild) {
          // Create label group
          const labelGroup = document.createElement("div");
          labelGroup.className = "menu-group";

          const labelItem = document.createElement("div");
          labelItem.className = "menu-item is-label";
          labelItem.setAttribute("data-section", "title");

          const titleDiv = document.createElement("div");
          titleDiv.className = "menu-item-title";
          titleDiv.textContent = getFilename(path);

          labelItem.appendChild(titleDiv);
          labelGroup.appendChild(labelItem);

          // Insert at beginning
          menuScroll.insertBefore(labelGroup, menuScroll.firstChild);

          // Add separator after label
          const separator = document.createElement("div");
          separator.className = "menu-separator";
          labelGroup.after(separator);
        }
      }

      // Check menu still exists before building item map
      if (!document.body.contains(menuEl)) return;

      // Build map of all menu items by title (exclude labels)
      const itemsByTitle = new Map<string, HTMLElement>();
      const menuItems = menuEl.querySelectorAll(".menu-item:not(.is-label)");
      menuItems.forEach((item) => {
        const titleEl = item.querySelector(".menu-item-title");
        if (titleEl?.textContent) {
          itemsByTitle.set(titleEl.textContent, item as HTMLElement);
        }
      });

      // Rebuild menu in correct order
      const menuScroll = menuEl.querySelector(".menu-scroll");
      if (!menuScroll) return;

      // Desktop-only items (mobile doesn't need spawn/reveal)
      if (!isMobile) {
        // Helper to create menu item
        // Note: Event listeners on menu items are automatically GC'd when the menu
        // closes and the DOM elements are removed
        const createMenuItem = (
          title: string,
          icon: string,
          onClick: () => void,
          isWarning = false,
        ): HTMLElement => {
          const item = document.createElement("div");
          item.className = isWarning
            ? "menu-item tappable is-warning"
            : "menu-item tappable";
          item.innerHTML = `
            <div class="menu-item-icon">${icon}</div>
            <div class="menu-item-title">${title}</div>
          `;
          item.addEventListener("click", () => {
            onClick();
            document.body.click();
          });
          // Add hover state (Obsidian doesn't auto-handle custom items)
          item.addEventListener("mouseenter", () => {
            // Clear any other selected items first
            item
              .closest(".menu")
              ?.querySelectorAll(".menu-item.selected")
              .forEach((el) => el.classList.remove("selected"));
            item.classList.add("selected");
          });
          item.addEventListener("mouseleave", () => {
            item.classList.remove("selected");
          });
          return item;
        };

        // Create custom items that file-menu doesn't provide
        if (!itemsByTitle.has("Open in new tab")) {
          itemsByTitle.set(
            "Open in new tab",
            createMenuItem("Open in new tab", ICONS.filePlus, () => {
              void app.workspace.openLinkText(path, "", "tab");
            }),
          );
        }

        if (!itemsByTitle.has("Open to the right")) {
          itemsByTitle.set(
            "Open to the right",
            createMenuItem("Open to the right", ICONS.splitVertical, () => {
              void app.workspace.openLinkText(path, "", "split");
            }),
          );
        }

        if (!itemsByTitle.has("Rename...")) {
          itemsByTitle.set(
            "Rename...",
            createMenuItem("Rename...", ICONS.edit, () => {
              app.fileManager.promptForFileRename(file).catch(() => {
                new Notice("Failed to rename file");
              });
            }),
          );
        }

        // Create custom "Open in default app" (native can freeze)
        const openInDefaultApp = createMenuItem(
          "Open in default app",
          ICONS.arrowUpRight,
          () => {
            const fullPath = app.vault.adapter.getFullPath(path);
            if (!fullPath) {
              new Notice("Cannot open file: path not found");
              return;
            }
            const { spawn } =
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              require("child_process") as typeof import("child_process");
            const onSpawnError = () => new Notice("Failed to open file");
            if (process.platform === "darwin") {
              spawn("open", [fullPath], {
                detached: true,
                stdio: "ignore",
              }).on("error", onSpawnError);
            } else if (process.platform === "win32") {
              // Use explorer.exe directly to avoid shell injection risks
              spawn("explorer.exe", [fullPath], {
                detached: true,
                stdio: "ignore",
              }).on("error", onSpawnError);
            } else {
              spawn("xdg-open", [fullPath], {
                detached: true,
                stdio: "ignore",
              }).on("error", onSpawnError);
            }
          },
        );
        itemsByTitle.set("Open in default app", openInDefaultApp);

        if (!itemsByTitle.has("Delete file")) {
          itemsByTitle.set(
            "Delete file",
            createMenuItem(
              "Delete file",
              ICONS.trash,
              () => {
                app.fileManager.trashFile(file).catch(() => {
                  new Notice("Failed to delete file");
                });
              },
              true,
            ),
          );
        }
      }

      // Check menu still exists after creating custom items
      if (!document.body.contains(menuEl)) return;

      // Use pre-defined menu structure, adding dynamic fourth group for desktop
      let menuStructure: Array<{
        items: string[];
        separator?: boolean;
      }>;

      if (isMobile) {
        menuStructure = MOBILE_MENU_STRUCTURE;
      } else {
        // Detect platform-specific reveal title for desktop fourth group
        const revealTitles = [
          "Reveal in Finder",
          "Show in Explorer",
          "Show in system explorer",
          "Reveal in file explorer",
        ];
        let revealTitle = "Reveal in Finder";
        for (const title of revealTitles) {
          if (itemsByTitle.has(title)) {
            revealTitle = title;
            break;
          }
        }

        // Build desktop structure with dynamic fourth group
        menuStructure = [
          ...DESKTOP_MENU_STRUCTURE,
          {
            items: [
              "Open in default app",
              revealTitle,
              "Reveal file in navigation",
            ],
            separator: true,
          },
        ];
      }

      // Collect plugin items (items not in our structure and not in titlesToRemove)
      const knownItems = new Set(menuStructure.flatMap((g) => g.items));
      knownItems.add("Delete file");
      titlesToRemove.forEach((t) => knownItems.add(t));
      const pluginItems: HTMLElement[] = [];
      itemsByTitle.forEach((item, title) => {
        if (!knownItems.has(title)) {
          pluginItems.push(item);
        }
      });

      // Clear menu content (preserve label group for mobile)
      // Note: We store references before clearing innerHTML, then re-append
      // the detached nodes. This is intentional - detached DOM nodes remain
      // valid and can be re-appended to preserve the label without cloning.
      if (isMobile) {
        // Use .closest() instead of :has() for broader browser compatibility
        const labelGroup = menuScroll
          .querySelector(".is-label")
          ?.closest(".menu-group");
        const labelSep = labelGroup?.nextElementSibling;
        menuScroll.innerHTML = "";
        if (labelGroup) {
          menuScroll.appendChild(labelGroup);
          if (labelSep?.classList.contains("menu-separator")) {
            menuScroll.appendChild(labelSep);
          }
        }
      } else {
        menuScroll.innerHTML = "";
      }

      // Rebuild menu in order
      for (const group of menuStructure) {
        const groupEl = document.createElement("div");
        groupEl.className = "menu-group";
        let hasItems = false;

        for (const title of group.items) {
          const item = itemsByTitle.get(title);
          if (item && !titlesToRemove.has(title)) {
            groupEl.appendChild(item);
            hasItems = true;
          }
        }

        if (hasItems) {
          menuScroll.appendChild(groupEl);
          if (group.separator) {
            const sep = document.createElement("div");
            sep.className = "menu-separator";
            menuScroll.appendChild(sep);
          }
        }
      }

      // Add plugin items
      if (pluginItems.length > 0) {
        const pluginGroup = document.createElement("div");
        pluginGroup.className = "menu-group";
        pluginItems.forEach((item) => pluginGroup.appendChild(item));
        menuScroll.appendChild(pluginGroup);
        const sep = document.createElement("div");
        sep.className = "menu-separator";
        menuScroll.appendChild(sep);
      }

      // Add Delete file at end
      const deleteItem = itemsByTitle.get("Delete file");
      if (deleteItem) {
        const deleteGroup = document.createElement("div");
        deleteGroup.className = "menu-group";
        deleteGroup.appendChild(deleteItem);
        menuScroll.appendChild(deleteGroup);
      }

      // Check menu still exists before cleanup operations
      if (!document.body.contains(menuEl)) return;

      // Remove empty menu groups and orphaned separators
      const menuGroups = menuEl.querySelectorAll(".menu-group");
      menuGroups.forEach((group) => {
        if (group.children.length === 0) {
          const prev = group.previousElementSibling;
          const next = group.nextElementSibling;
          // Remove separator before empty group
          if (prev?.classList.contains("menu-separator")) {
            prev.remove();
          }
          // Remove separator after empty group
          if (next?.classList.contains("menu-separator")) {
            next.remove();
          }
          group.remove();
        }
      });

      // Clean up consecutive separators (can occur after item removal)
      let prevWasSeparator = false;
      const separators = menuEl.querySelectorAll(".menu-separator");
      separators.forEach((sep) => {
        if (prevWasSeparator) {
          sep.remove();
        } else {
          prevWasSeparator = true;
        }
        // Reset if next sibling is not a separator
        if (
          sep.nextElementSibling &&
          !sep.nextElementSibling.classList.contains("menu-separator")
        ) {
          prevWasSeparator = false;
        }
      });

      // Remove trailing separator at menu end
      const lastMenuChild = menuScroll.lastElementChild;
      if (lastMenuChild?.classList.contains("menu-separator")) {
        lastMenuChild.remove();
      }

      // Reposition menu at mouse location, adjusted for new size
      const rect = menuEl.getBoundingClientRect();
      let top = e.clientY;
      let left = e.clientX;

      // Adjust if menu would overflow viewport
      if (top + rect.height > window.innerHeight) {
        top = Math.max(0, window.innerHeight - rect.height - 10);
      }
      if (left + rect.width > window.innerWidth) {
        left = Math.max(0, window.innerWidth - rect.width - 10);
      }

      menuEl.style.top = `${top}px`;
      menuEl.style.left = `${left}px`;
    } finally {
      menuEl.style.visibility = "visible";
    }
  });
}
