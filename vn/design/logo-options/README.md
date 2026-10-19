# VN logo options

Ten retained SVG logos: eight outlines and two solid Amiya silhouettes.
**Option 08, Amiya & pages, is the active VN reader logo.** Its SVG paths are
embedded in [the reader header](../../index.html); this gallery keeps the standalone
[source SVG](08-rabbit-rook.svg). These are hand-authored vector paths.

Saved for future use: **01, 02, 03, 04, 10, 11, 12, 14, and 15**.
Their SVG files are retained here and marked `saved` in `options.json`; option 08
is marked `active`. The gallery opens with 08 selected and labels the saved cards.
The original option numbers are kept for reference.

Options 01–03 adapt the tower silhouette from the Rhodes Island emblem, using
the [official Arknights website asset](https://web.hycdn.cn/arknights/official/_next/static/media/rhodes_island.18d9416c.png)
and a [larger reference on the Terra Wiki](https://arknights.wiki.gg/images/c/c8/Rhodes_Island.png).

Options 04, 08, 10, 11, 12, 14, and 15 use original simplified shapes informed
by Amiya's [official game portrait](https://web.hycdn.cn/arknights/official/_next/static/media/amiya.a410de75.png)
and [official anime character art](https://arknights-anime.jp/character).
The pointed ears, narrow roots, swept fringe, and long side locks are the reference
cues; these are not traced character illustrations.
Option 14 uses the outer contour from 11/12 as a simple outline. Option 15 combines
a blank-page book with widely spaced pointed ears.

Open `/vn/design/logo-options/` through the same HTTP server used for the reader.
The gallery lets you preview each mark beside the header text, switch between
dark and light backgrounds, view monochrome marks, and download the SVGs.

Static comparison sheets: [dark / cyan](preview-dark.png) and
[light / monochrome](preview-light.png).

Revised options [01–03](preview-01-03.png): the Rhodes Island tower silhouette,
with gaps separating the triangle from the tower in option 02 and blank pages on 03.

[Pointed-ear variants](preview-14-15.png): option 14's Amiya head outline and
option 15's widely spaced ears above the book.

| Option | Mark | Status | Direction |
| --- | --- | --- | --- |
| 01 | [Rhodes rook](01-classic-rook.svg) | Saved | Rhodes Island tower outline |
| 02 | [Rhodes tower](02-rhodes-tower.svg) | Saved | Rhodes tower inside an interrupted triangle |
| 03 | [Archive rook](03-archive-rook.svg) | Saved | Rhodes tower rising from an open book |
| 04 | [Amiya portrait](04-amiya-silhouette.svg) | Saved | Pointed ears, swept fringe, and side locks |
| 08 | [Amiya & pages](08-rabbit-rook.svg) | **Active** | Amiya portrait above an open book |
| 10 | [Amiya bookmark](10-ear-bookmark.svg) | Saved | Amiya portrait and bookmark tail |
| 11 | [Amiya solid](11-amiya-solid.svg) | Saved | Filled front-facing silhouette |
| 12 | [Amiya fringe](12-amiya-fringe.svg) | Saved | Filled ears and hair with a transparent face |
| 14 | [Amiya contour](14-pointed-ears.svg) | Saved | Head contour from 11/12 rendered as an outline |
| 15 | [Pointed ears & pages](15-pointed-ears-and-pages.svg) | Saved | Blank-page book with widely spaced pointed ears |

Every SVG has a transparent background, a 64 × 64 viewBox, and `currentColor`
coloring. Outline strokes use 2.4 units with rounded joins and proportional
scaling for framed motifs. Options 11 and 12 use solid fills with no strokes;
the face opening in 12 is transparent and works on either background.
The gallery displays a large mark,
small-size samples, and a 30 × 36 px header preview. If a mark is selected for the
reader, preserve its fill and stroke attributes when replacing the existing inline SVG.
