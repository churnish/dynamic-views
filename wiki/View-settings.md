Each Grid and Masonry view has its own settings, configured in the view's config menu. Changes apply only to that view.

## Card size

| Setting   | Description                  | Default |
| --------- | ---------------------------- | ------- |
| Card size | Minimum card width in pixels | 300     |

## Title

| Setting                             | Description                                  | Default |
| ----------------------------------- | -------------------------------------------- | ------- |
| Display first property as title     | Use the first visible property as card title | On      |
| Title lines                         | Maximum lines before truncating              | 2       |
| Display second property as subtitle | Use the second property as subtitle          | Off     |

## Text preview

| Setting                                   | Description                                                                                        | Default |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- | ------- |
| Text preview property                     | Visible property to display as preview text                                                        | None    |
| Show note content if property unavailable | Fall back to displaying note content when a note does not have the property, or its value is empty | On      |
| Text preview lines                        | Maximum lines before truncating                                                                    | 5       |

## Image

| Setting           | Description                                                              | Default   |
| ----------------- | ------------------------------------------------------------------------ | --------- |
| Image property    | Property containing path to image or image URL                           | None      |
| Show image embeds | When to use images embedded in-note as fallback                          | Always    |
| Format            | How to display images                                                    | Thumbnail |
| Display mode      | Poster tint style: Fade (bottom gradient) or Overlay (full-image filter) | Fade      |
| Size              | Thumbnail width in pixels                                                | 80        |
| Position          | Image placement                                                          | Right     |
| Fit               | Crop to fill, or contain within bounds                                   | Crop      |
| Ratio             | Aspect ratio of the image area (card-to-image ratio for side covers)     | 1.0       |

## Properties

| Setting                     | Description                                                                            | Default                                   |
| --------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------- |
| Property labels             | How to display property names                                                          | Hide&nbsp;(Grid)<br>Inline&nbsp;(Masonry) |
| URL property                | Visible property to display as a URL button (↗)                                        | None                                      |
| Pair properties             | Display properties side-by-side                                                        | Off                                       |
| Right property position     | Placement of the second property in a pair                                             | Right                                     |
| Invert pairing for property | Properties not to pair (if pairing enabled), or that should pair (if pairing disabled) | None                                      |

## Other

| Setting                  | Description                                                                                                                                                                                                            | Default                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Minimum columns          | Smallest number of visible columns                                                                                                                                                                                     | One&nbsp;(Grid)<br>Two&nbsp;(Masonry) |
| CSS classes              | Apply custom CSS class names for this view                                                                                                                                                                             | None                                  |
| Save as default settings | Save a one-time snapshot of this view's settings as defaults for new views. Later changes to the original view will not update the saved defaults. The toggle resets on next view load, so enable it again to re-save. | Off                                   |
