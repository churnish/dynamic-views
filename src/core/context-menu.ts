/**
 * Shared context menu handler for file cards
 */

import { App, Menu, Notice, Platform, TFile, setIcon } from 'obsidian';
import { getOwnerWindow } from '../utils/owner-window';

// Obsidian icon names for desktop context menu items
const ICON_NAMES = {
  filePlus: 'file-plus',
  splitVertical: 'separator-vertical',
  edit: 'pencil',
  arrowUpRight: 'arrow-up-right',
  trash: 'trash-2',
} as const;

// Native's own order for a file menu — `addSections` in the file explorer.
// '' is the bucket for items that declare no section; sections absent from this
// list render after everything, which is where native puts them.
const MENU_SECTION_ORDER: readonly string[] = [
  'title',
  'open',
  'action-primary',
  'action',
  'info',
  'info.copy',
  'view',
  'system',
  '',
  'danger',
];

/**
 * Extract filename from path
 */
function getFilename(path: string): string {
  const lastSlash = path.lastIndexOf('/');
  let filename = lastSlash === -1 ? path : path.substring(lastSlash + 1);

  // Strip .md extension
  if (filename.toLowerCase().endsWith('.md')) {
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
  url?: string
): void {
  e.stopPropagation();
  e.preventDefault();

  const menu = new Menu();
  const isMobile = Platform.isMobile;

  // Build menu based on platform
  if (isMobile) {
    // Mobile: Match vanilla Obsidian mobile menu, except that "Open link" is
    // offered on every platform rather than phone only as native does. Cards
    // here are frequently image-only, or an image covers most of the card, and
    // with the image viewer enabled a press on the image opens the viewer
    // instead of the note. This entry is then the only dependable way to open
    // the note, so it must be present everywhere — not a platform nicety.
    menu.addItem((item) =>
      item
        .setTitle('Open link')
        .setIcon('lucide-file')
        .setSection('open')
        .onClick(() => {
          void app.workspace.openLinkText(path, '', false);
        })
    );

    menu.addItem((item) =>
      item
        .setTitle('Open in new tab')
        .setIcon('lucide-file-plus')
        .setSection('open')
        .onClick(() => {
          void app.workspace.openLinkText(path, '', 'tab');
        })
    );

    // Tablet only, matching native: where phone offers "Open link", tablet
    // offers the pane action. The desktop fallback that builds this sits behind
    // `if (!isMobile)`, and file-menu supplies no pane actions on mobile, so
    // without this the item simply never exists and the group renders alone.
    if (!Platform.isPhone)
      menu.addItem((item) =>
        item
          .setTitle('Open to the right')
          .setIcon(`lucide-${ICON_NAMES.splitVertical}`)
          .setSection('open')
          .onClick(() => {
            void app.workspace.openLinkText(path, '', 'split');
          })
      );

    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle('Rename...')
        .setIcon('lucide-edit-3')
        .setSection('action')
        .onClick(async () => {
          try {
            await app.fileManager.promptForFileRename(file);
          } catch {
            new Notice('Failed to rename file');
          }
        })
    );

    // Native items: Move file to..., Bookmark..., Copy Obsidian URL
    // will be relocated via DOM manipulation

    // Custom Share item (triggers platform share sheet)
    menu.addItem((item) =>
      item
        .setTitle('Share')
        .setIcon('lucide-arrow-up-right')
        .setSection('action')
        .onClick(() => {
          app.openWithDefaultApp(path);
        })
    );

    menu.addSeparator();

    // Trigger file-menu for plugins/native items
    app.workspace.trigger('file-menu', menu, file, 'file-explorer');

    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle('Delete file')
        .setIcon('lucide-trash-2')
        .setWarning(true)
        .setSection('danger')
        .onClick(async () => {
          try {
            await app.fileManager.trashFile(file);
          } catch {
            new Notice('Failed to delete file');
          }
        })
    );
  } else {
    // Desktop: Let Obsidian build menu in correct order, then modify in RAF
    app.workspace.trigger('file-menu', menu, file, 'file-explorer');
  }

  // A URL target gets native's own link actions merged into this menu rather than
  // a menu of its own — matches Bases, and inherits any url-menu contributions
  // (the iPhone-only "Open link" item among them) without restating them here.
  if (url) {
    // Tag whatever native appends so the rebuild can float the link actions to
    // the front of their section, which is where native shows them when the
    // click target was a link. Diffing menu.items is the only way to tell them
    // apart afterwards — they carry no marker of their own.
    const menuItems = (menu as unknown as { items?: { dom?: HTMLElement }[] })
      .items;
    const before = menuItems?.length ?? 0;
    app.workspace.handleExternalLinkContextMenu(menu, url);
    for (const added of menuItems?.slice(before) ?? [])
      if (added.dom) added.dom.dataset.dvLinkAction = '1';
  }

  menu.showAtMouseEvent(e);

  // Manipulate menu DOM after rendering — use the event target's document,
  // not the module-scope document (which is the main window's in popouts).
  const menuDoc = (e.target as HTMLElement)?.ownerDocument ?? document;
  const menuWin = menuDoc.defaultView ?? window;
  const menuEl = menuDoc.body.querySelector('.menu') as HTMLElement;
  if (!menuEl) return;

  // Hide menu during processing to prevent flicker
  menuEl.addClass('dynamic-views-menu-positioning');

  // Platform-specific titles to remove (desktop-only items not shown on mobile)
  const titlesToRemove = isMobile
    ? new Set([
        'Merge entire file with...',
        // Tablet keeps "Open to the right" — native shows it in the first group.
        ...(Platform.isPhone ? ['Open to the right'] : []),
        'Open in new window',
        'Copy relative path',
        'Open in default app',
        'Reveal in Finder',
        'Show in Explorer',
        'Show in system explorer',
        'Reveal file in navigation',
      ])
    : new Set([
        // Desktop: items to exclude entirely
        'Merge entire file with...',
      ]);

  getOwnerWindow(e.target as HTMLElement).requestAnimationFrame(() => {
    // Ensure menu still exists (user may have closed it)
    if (!menuDoc.body.contains(menuEl)) return;

    try {
      // Filename label, phone only. Native gates this on isPhone, not isMobile —
      // `Workspace.prototype.handleLinkContextMenu` reads
      // `rd.isPhone && e.addItem(... .setSection("title").setIsLabel(true))`.
      // A tablet gets no label, so isMobile showed one where native shows none.
      if (Platform.isPhone) {
        const menuScroll = menuEl.querySelector('.menu-scroll');
        if (menuScroll && menuScroll.firstChild) {
          // Create label group at the top of the menu
          const labelGroup = menuScroll.createDiv({
            cls: 'menu-group',
            prepend: true,
          });

          const labelItem = labelGroup.createDiv({
            cls: 'menu-item is-label',
            attr: { 'data-section': 'title' },
          });

          labelItem.createDiv({
            cls: 'menu-item-title',
            text: getFilename(path),
          });
        }
      }

      // Check menu still exists before building item map
      if (!menuDoc.body.contains(menuEl)) return;

      // Build map of all menu items by title (exclude labels)
      const itemsByTitle = new Map<string, HTMLElement>();
      const menuItems = menuEl.querySelectorAll('.menu-item:not(.is-label)');
      menuItems.forEach((item) => {
        const titleEl = item.querySelector('.menu-item-title');
        if (titleEl?.textContent) {
          itemsByTitle.set(titleEl.textContent, item as HTMLElement);
        }
      });

      // Rebuild menu in correct order
      const menuScroll = menuEl.querySelector('.menu-scroll');
      if (!menuScroll) return;

      // Desktop-only items (mobile doesn't need spawn/reveal)
      if (!isMobile) {
        // Helper to create menu item
        // Note: Event listeners on menu items are automatically GC'd when the menu
        // closes and the DOM elements are removed
        const createMenuItem = (
          title: string,
          icon: string,
          section: string,
          onClick: () => void,
          isWarning = false
        ): HTMLElement => {
          // Detached creation — the item is returned unparented and appended
          // later during the rebuild pass, so createDiv() cannot be used.
          const item = menuDoc.createElement('div');
          item.className = isWarning
            ? 'menu-item tappable is-warning'
            : 'menu-item tappable';
          // Items built here bypass Menu.addItem(), so the section native would
          // have stamped on them has to be set by hand for the rebuild to bucket
          // them alongside their native counterparts.
          item.dataset.section = section;
          // Marks a stand-in for a core action. Core populates a menu before any
          // plugin does, so within a section native's own entries come first —
          // but these are built after the file-menu trigger and would otherwise
          // append behind plugin items. The rebuild hoists them back.
          item.dataset.dvCoreStandIn = '1';
          const iconDiv = item.createDiv({ cls: 'menu-item-icon' });
          setIcon(iconDiv, icon);
          item.createDiv({ cls: 'menu-item-title', text: title });
          item.addEventListener('click', () => {
            onClick();
            menuDoc.body.click();
          });
          // Add hover state (Obsidian doesn't auto-handle custom items)
          item.addEventListener('mouseenter', () => {
            // Clear any other selected items first
            item
              .closest('.menu')
              ?.querySelectorAll('.menu-item.selected')
              .forEach((el) => el.classList.remove('selected'));
            item.classList.add('selected');
          });
          item.addEventListener('mouseleave', () => {
            item.classList.remove('selected');
          });
          return item;
        };

        // Create custom items that file-menu doesn't provide
        // Present on desktop too, unlike native. An image-only or image-dominant
        // card hands its presses to the image viewer, so this is the only
        // dependable way to open the note from such a card. Created before
        // "Open in new tab" so it leads the opening actions.
        if (!itemsByTitle.has('Open link')) {
          itemsByTitle.set(
            'Open link',
            createMenuItem('Open link', 'file', 'open', () => {
              void app.workspace.openLinkText(path, '', false);
            })
          );
        }

        if (!itemsByTitle.has('Open in new tab')) {
          itemsByTitle.set(
            'Open in new tab',
            createMenuItem(
              'Open in new tab',
              ICON_NAMES.filePlus,
              'open',
              () => {
                void app.workspace.openLinkText(path, '', 'tab');
              }
            )
          );
        }

        if (!itemsByTitle.has('Open to the right')) {
          itemsByTitle.set(
            'Open to the right',
            createMenuItem(
              'Open to the right',
              ICON_NAMES.splitVertical,
              'open',
              () => {
                void app.workspace.openLinkText(path, '', 'split');
              }
            )
          );
        }

        if (!itemsByTitle.has('Rename...')) {
          itemsByTitle.set(
            'Rename...',
            createMenuItem('Rename...', ICON_NAMES.edit, 'action', () => {
              app.fileManager.promptForFileRename(file).catch(() => {
                new Notice('Failed to rename file');
              });
            })
          );
        }

        // Create custom "Open in default app" (native can freeze). Native puts
        // its own in `system`, so the replacement claims that section too.
        const openInDefaultApp = createMenuItem(
          'Open in default app',
          ICON_NAMES.arrowUpRight,
          'system',
          () => {
            app.openWithDefaultApp(path);
          }
        );
        itemsByTitle.set('Open in default app', openInDefaultApp);

        if (!itemsByTitle.has('Delete file')) {
          itemsByTitle.set(
            'Delete file',
            createMenuItem(
              'Delete file',
              ICON_NAMES.trash,
              'danger',
              () => {
                app.fileManager.trashFile(file).catch(() => {
                  new Notice('Failed to delete file');
                });
              },
              true
            )
          );
        }
      }

      // Check menu still exists after creating custom items
      if (!menuDoc.body.contains(menuEl)) return;

      // Bucket every surviving item by the section native stamped on it. Reading
      // data-section instead of matching titles is what lets a third-party item
      // land where native would have put it, with no per-plugin knowledge here.
      // A submenu head that Menu.sort() synthesises for a dotted section — core
      // folds every `info.copy` item into a "Copy path" submenu — is built with
      // setTitle/setIcon only, so it carries no section and would fall in with
      // the sectionless leftovers. Its real slot lives only inside native's sort
      // loop and cannot be read back, but every such head belongs to a dotted
      // section under `info`, so route it there — measured in native's own file
      // explorer menu, where the sectionless "Copy path" head renders in the
      // SAME group as the `info` items, and alone only when there are none.
      const sectionBuckets = new Map<string, HTMLElement[]>();
      itemsByTitle.forEach((item, title) => {
        if (titlesToRemove.has(title)) return;
        const section =
          item.dataset.section ??
          (item.classList.contains('has-submenu') ? 'info' : '');
        const bucket = sectionBuckets.get(section);
        if (bucket) bucket.push(item);
        else sectionBuckets.set(section, [item]);
      });

      // Order inside each section: the link actions native adds for a link
      // target, then our stand-ins for core actions, then plugin items. Native
      // gets this for free — link handling and core both run before plugins —
      // but both of ours are built after the file-menu trigger and would
      // otherwise trail. Stable within each rank, so native's own relative
      // order survives.
      const sectionRank = (item: HTMLElement): number =>
        item.dataset.dvLinkAction ? 0 : item.dataset.dvCoreStandIn ? 1 : 2;
      sectionBuckets.forEach((items, section) => {
        const ranks = items.map(sectionRank);
        if (ranks.every((r) => r === ranks[0])) return;
        sectionBuckets.set(
          section,
          items
            .map((item, i) => ({ item, rank: ranks[i], i }))
            .sort((a, b) => a.rank - b.rank || a.i - b.i)
            .map((x) => x.item)
        );
      });

      // Declared sections first, then any section native does not declare, in
      // first-appearance order — native renders those after everything else.
      const orderedSections = [
        ...MENU_SECTION_ORDER.filter((section) => sectionBuckets.has(section)),
        ...[...sectionBuckets.keys()].filter(
          (section) => !MENU_SECTION_ORDER.includes(section)
        ),
      ];

      // Clear menu content (preserve the phone-only label group)
      // Note: We store references before clearing innerHTML, then re-append
      // the detached nodes. This is intentional - detached DOM nodes remain
      // valid and can be re-appended to preserve the label without cloning.
      // Use .closest() instead of :has() for broader browser compatibility
      const labelGroup = Platform.isPhone
        ? menuScroll.querySelector('.is-label')?.closest('.menu-group')
        : null;
      menuScroll.innerHTML = '';

      // Every separator in the menu comes from this one flag: it is set once a
      // group has been appended, so a separator is only ever emitted between two
      // non-empty groups. Empty buckets never exist (a bucket is created by its
      // first item), so there is no leading, trailing or orphaned separator to
      // clean up afterwards.
      let needsSeparator = false;

      if (labelGroup) {
        menuScroll.appendChild(labelGroup);
        needsSeparator = true;
      }

      // Native starts a new group only when the TOP-LEVEL section changes —
      // `Menu.prototype.sort` compares `section.split('.')[0]` — so `info` and
      // `info.copy` share one group instead of being split by a separator.
      let currentGroupEl: HTMLDivElement | null = null;
      let currentTopLevelSection: string | null = null;

      for (const section of orderedSections) {
        const items = sectionBuckets.get(section);
        if (!items) continue;
        const topLevelSection = section.split('.')[0];
        if (!currentGroupEl || topLevelSection !== currentTopLevelSection) {
          if (needsSeparator) menuScroll.createDiv({ cls: 'menu-separator' });
          currentGroupEl = menuScroll.createDiv({ cls: 'menu-group' });
          currentTopLevelSection = topLevelSection;
          needsSeparator = true;
        }
        for (const item of items) currentGroupEl.appendChild(item);
      }

      // Check menu still exists before measuring it
      if (!menuDoc.body.contains(menuEl)) return;

      // Reposition menu at mouse location, adjusted for new size
      const rect = menuEl.getBoundingClientRect();
      let top = e.clientY;
      let left = e.clientX;

      // Adjust if menu would overflow viewport
      if (top + rect.height > menuWin.innerHeight) {
        top = Math.max(0, menuWin.innerHeight - rect.height - 10);
      }
      if (left + rect.width > menuWin.innerWidth) {
        left = Math.max(0, menuWin.innerWidth - rect.width - 10);
      }

      menuEl.style.top = `${top}px`;
      menuEl.style.left = `${left}px`;
    } finally {
      menuEl.removeClass('dynamic-views-menu-positioning');
    }
  });
}
