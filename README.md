# Dynamic Views

Elegant grid and masonry card views for [Bases](https://help.obsidian.md/bases).

## Features

- Show text previews from first few lines of notes
- Show file images
- Display images as covers, thumbnails, posters, or backdrops
- Full screen image viewer
- Wrap long titles to new line
- Scroll long properties horizontally
- Immersive full screen view on mobile

### Extras

- Position card images on top, bottom, left, or right of text
- Slide or hover to preview other images
- Position property names inline, above, or hide them
- Display properties stacked or side-by-side
- Interactive checkbox properties
- Fold sections when grouping by property
- Select card text
- Configure default view settings
- Full keyboard navigation
- Apply CSS snippets to individual views
- **Open URL** card button
- **Shuffle view** button
- **Open random file** button

And numerous other quality‑of‑life improvements over the default Bases card layout.

### Integrations

- Extensive [Style Settings](https://obsidian.md/plugins?id=obsidian-style-settings) customization options
- Show YouTube thumbnails
- Show [Auto Card Link](https://obsidian.md/plugins?id=auto-card-link) or [Link Embed](https://obsidian.md/plugins?id=obsidian-link-embed) images
- Reveal files, folders and tags in [Notebook Navigator](https://obsidian.md/plugins?id=notebook-navigator)

## Perfect for

- Media libraries
- Mood boards
- Image galleries
- Everyday notes
- [Web Clipper](https://obsidian.md/clipper)

## Installation

> [!IMPORTANT]  
> The plugin is in active development — things can break, or change drastically between releases.

Until **Dynamic Views** is [approved](https://github.com/obsidianmd/obsidian-releases/pull/8400), to install it:

1. Download and enable the [BRAT](https://churnish.github.io/http-protocol-redirector?r=obsidian://show-plugin?id=obsidian42-brat) plugin.
2. [Install via BRAT](https://churnish.github.io/http-protocol-redirector?r=obsidian://brat?plugin=churnish/dynamic-views).
3. Select **Add plugin**.

<details>
<summary>Install manually</summary>

1. Download `dynamic-views.zip` in the `Assets` of the [latest release](https://github.com/churnish/dynamic-views/releases).
2. Open the vault folder in the system file manager.
3. Navigate to your Obsidian config folder (`.obsidian` by default, hidden on most OSes).
4. Unzip `dynamic-views.zip` and place it in the `plugins` folder.
5. Reload plugins or app.
6. Enable **Dynamic Views** in **Obsidian settings → Community plugins → Installed plugins**.

**Tip:** To be notified about new **Dynamic Views** releases, press **Watch** at the top of the repository page then select **Custom → Releases → Apply**.

</details>

## Usage

<details>
<summary>View settings</summary>

Each Grid and Masonry view has its own settings, configured in the view's config menu. Changes apply only to that view.

### Card size

| Setting | Description | Default |
| --- | --- | --- |
| Card size | Minimum card width in pixels | 300 |

### Title

| Setting | Description | Default |
| --- | --- | --- |
| Display first property as title | Use the first property from property menu as card title | On |
| Lines | Maximum title lines before truncating | 2 |
| Display second property as subtitle | Use the second property from property menu as subtitle | Off |

### Text preview

| Setting | Description | Default |
| --- | --- | --- |
| Text preview property | Visible property to display as preview text | None |
| Show note content if property unavailable | Fall back to displaying note content when a note does not have the property, or its value is empty | On |
| Lines | Maximum lines before truncating | 5 |

### Image

| Setting | Description | Default |
| --- | --- | --- |
| Image property | Property containing path to image or image URL | None |
| Show file images | When to use images embedded in-note as fallback | Always |
| Format | How to display images | Thumbnail |
| Display mode | Poster tint style: Fade (bottom gradient) or Overlay (full-image filter) | Fade |
| Interact to show details | Hide content until hover (desktop) or press (mobile). When off, content is always visible and overflow is clipped. | Off |
| Size | Thumbnail width in pixels | 80 |
| Position | Image placement | Right |
| Fit | Crop to fill, or contain within bounds | Crop |
| Ratio | Aspect ratio of the image area (card-to-image ratio for side covers) | 1.0 |

### Properties

| Setting | Description | Default |
| --- | --- | --- |
| Property names | How to display property names | Inline |
| URL property | Visible property to display as an 'Open URL' button (↗) | None |
| Pair properties | Display properties side-by-side | Off |
| Right property position | Placement of the second property in a pair | Right |
| Invert pairing for property | Properties not to pair (if pairing enabled), or that should pair (if pairing disabled) | None |

### Other

| Setting | Description | Default |
| --- | --- | --- |
| Minimum columns | Smallest number of visible columns | One (Grid) Two (Masonry) |
| CSS classes | Apply custom CSS class names for this view | None |
| Save as default settings | Save a one-time snapshot of this view's settings as defaults for new views. Later changes to the original view will not update the saved defaults. The toggle resets on next view load, so enable it again to re-save. | Off |

</details>

<br>

<details>
<summary>Image viewer controls</summary>

Press on a card's cover or thumbnail to open the image viewer — a fullscreen overlay with pan and zoom.

The image viewer can be disabled in Style Settings, along with individual features like zoom or press-to-dismiss.

### Desktop

| Action | Control |
| --- | --- |
| Zoom in | Scroll down / Spread |
| Zoom out | Scroll up / Pinch |
| Maximize | Space |
| Exit maximize | Space |
| Reset pan & zoom | R / ↓ / Right-click |
| Copy image | Ctrl/Cmd+C |
| Drag & drop | Hold Alt+drag |
| Drag & drop (panzoom disabled) | Drag |
| Open file | Enter |
| Close | Click / Esc |

### Mobile

| Action | Control |
| --- | --- |
| Zoom in | Spread |
| Zoom out | Pinch |
| Drag & drop | Long press + drag |
| Close | Tap |

### Style Settings

These options are available in [Style Settings](https://obsidian.md/plugins?id=obsidian-style-settings) → Dynamic Views → Image viewer.

| Setting | Description | Default |
| --- | --- | --- |
| Disable image viewer | Turns off the image viewer entirely. Images will behave as normal embeds. | Off |
| Disable pan & zoom | Disables pinch-to-zoom and pan gestures. Spacebar maximize still works. | Off |
| Do not dismiss on press | Prevents the viewer from closing when you press the image. | Off |
| Open in fullscreen | Opens images in fullscreen on desktop. When off, the viewer stays within the current pane. | On |
| Zoom sensitivity | How quickly images zoom on desktop (0.01–1). | 0.08 |

</details>

<br>

<details>
<summary>Keyboard navigation</summary>

Navigate between cards using the keyboard in Grid and Masonry views.

Start by hovering a card and pressing an arrow key, or pressing Tab to focus the first card.

| Action | Control |
| --- | --- |
| Move between cards | ↑ ↓ ← → |
| Open note | Enter / Space |
| Open in new tab | Ctrl/⌘+Enter |
| Exit keyboard navigation | Esc |

</details>

## Support

Found a bug or have a feature request? [Open an issue](https://github.com/churnish/dynamic-views/issues).

Have a question? [Start a discussion](https://github.com/churnish/dynamic-views/discussions).

## Credits

The theme in the screenshots is [Cupertino](https://github.com/aaaaalexis/obsidian-cupertino).
