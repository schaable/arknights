# Visual novel reader

A separate, buildless story library and visual novel player at **`/vn/`**.
The root **`/` remains the classic reader**. Serve the repository root:

```sh
python3 -m http.server 8000
# http://localhost:8000/vn/
```

Relative paths also work at `/arknights/vn/` on GitHub Pages. Use HTTP rather
than `file://`, because the player fetches its scripts.

## Library and playable stories

The library lists Main Story, Side Stories, Vignettes, Operator Records,
Operator Modules, and Integrated Strategies. Category pages show every chapter
or collection, with search and an optional filter for playable VN stories.
Collection pages list stories in game order. Translation availability and VN
availability are separate: a Spanish script can exist before its scene is
supported by the player. Other stories have links to the classic reader.

Four scenes are playable in Spanish and English:

| Collection | Story | URL after `/vn/` |
| --- | --- | --- |
| Chapter 00 · Evil Time Part 1 | Prologue, Part 1 | `#/main/chapter-0/prologue-1` |
| Chapter 00 · Evil Time Part 1 | Prologue, Part 2 | `#/main/chapter-0/prologue-2` |
| Chapter 01 · Evil Time Part 2 | 1-1 · Isolated Island · Before operation | `#/main/chapter-1/1-1-before` |
| Children of Ursus | Habits | `#/vignettes/children-of-ursus/habits` |

`/vn/` or `/vn/#/` opens the library. Removing the story slug opens the collection;
removing the collection slug opens the category. Links support reloads and native
browser Back/Forward without server rewrites. The player provides breadcrumbs,
previous/next stories, and a story selector. Completion links to the next VN
story when supported, otherwise explicitly to the classic reader.

The complete catalog is a checked-in snapshot (998 collections, 2,670 stories,
113 local Spanish translations at generation time). Only the four scenes above
are enabled for VN playback. No remote story-index downloads are required to
browse it.

## Playback and progress

- Spanish is the default. Language switches retain the line and selected branch.
  Spanish scripts are read directly from `../gamedata/es_ES/`; translations are
  neither copied nor regenerated. Story and collection names retain their
  upstream titles. Settings can change the Doctor's name.
- Stage artwork, character focus, backgrounds/CGs, crossfades, image transforms,
  blockers, grayscale, camera shake, and waits use the script's events. Next can
  skip a transition. Space/Right advance, Left goes back, and H opens history.
- Typewriter speed, automatic reading, choices, history, restart, reduced motion,
  and mobile layout are supported. Optional music/SFX start muted. Hiding the
  tab stops automatic reading and sound.
- Progress is independent **per main-story chapter**, **per side story/vignette
  collection**, and **per operator-record/module/Integrated Strategies
  collection**. Each group remembers its last opened reading and preserves each
  story's line, choices, completion, and timestamp. Merely browsing a chapter or
  opening a story's cover does not change the resume target.
- Restart clears only the current story. Collection completion uses *all* its
  stories as the denominator, including scenes not yet supported in VN.
- Navigation aborts old script requests, rejects stale results, and stops sound,
  automatic reading, timers, animations, and open dialogs before reusing the stage.

Saves use browser-local `arknights.vn.v2`, separate from classic-reader settings
and translation-review notes. The shape is:

```js
{
  v: 2,
  preferences: { language: 'es', nickname: '', speed: 45, motion: false },
  groups: {
    'main:main_0': {
      resume: 'obt/guide/beg/2_guide_to_home',
      updated: 1234567890,
      stories: {
        'obt/guide/beg/2_guide_to_home': {
          line: 42, answers: {}, read: false, updated: 1234567890
        }
      }
    }
  }
}
```

Canonical `storyTxt` IDs identify stories; `${category}:${collectionId}` identifies
save groups. An existing `arknights.vn.v1` prologue save and its preferences migrate
once; the original key is retained as a backup. Values and script positions are
validated on load. Writes merge other tabs' saved groups, and storage events
refresh library progress. Denied/full storage falls back to memory for the tab
and displays a save warning during reading. There is no cloud sync or import/export.

## Files and extension points

| File | Responsibility |
| --- | --- |
| `index.html`, `reader.css` | Library/player shell, stage, responsive controls, dialogs |
| `app.mjs`, `catalog.mjs` | Hash routing, navigation, collection progress, app lifecycle |
| `library.mjs`, `i18n.mjs` | Catalog views and Spanish/English UI strings |
| `chapters.mjs` | Explicit playable-scene allowlist, pinned English sources, cover art |
| `data/catalog.json`, `data/audio.json` | Generated metadata and referenced audio mappings |
| `tools/build-catalog.mjs` | Catalog normalization, availability detection, stable slugs |
| `script.mjs` | Tag parsing, branches, scene state, timeline, progress validation |
| `reader.mjs` | Reusable player, rendering, transitions, controls, history |
| `assets.mjs` | Existing CDN conventions, image fallback, music/SFX |
| `storage.mjs` | Versioned grouped saves and legacy migration |
| `chapters/` | Four pinned English AVG scripts |
| `tests/` | Parser/storage/catalog tests and Chromium integration checks |

The classic `js/story.js` couples parsing and DOM playback. This separate player
uses its line/tag, sprite, and predicate conventions in a small pure adapter with
an explicit directive allowlist. Unsupported directives fail visibly; this is
not yet a general AVG renderer. Nested predicates and advanced game effects need
additional work before enabling arbitrary scenes. Sprite positioning uses common
CSS anchors, not a global metrics database. Artwork/audio remain remote and
require network access; offline caching is not implemented.

To migrate another scene, inventory its directives/assets, pin its matching
English source, add it to `chapters.mjs`, extend unsupported playback behavior,
regenerate the catalog/audio map, and verify branches and visuals. The loader
compares English/Spanish command structure so an upstream edit cannot silently
break language switching or saved line numbers. Do not derive classic story
indices from stage codes: the catalog preserves the classic reader's ordering.

## Updating the catalog

The generator takes a directory of source JSON files; keep the large inputs
outside the site. From the same English game-data revision, download these files
from [ArknightsGamedata](https://github.com/ArknightsAssets/ArknightsGamedata/tree/master/en/gamedata):

- `excel/story_review_table.json`, `excel/story_review_meta_table.json`
- `excel/story_table.json`, `excel/character_table.json`
- `excel/uniequip_table.json`, `excel/roguelike_topic_table.json`
- `story/story_variables.json`

Put their basenames together in a temporary directory, then run:

```sh
node vn/tools/build-catalog.mjs /tmp/vn-catalog-source
```

This writes only `vn/data/catalog.json` and `vn/data/audio.json`. Existing route
slugs are retained when titles change. Translation flags come from local Spanish
files; VN flags come from the explicit allowlist. The generator never translates
or automatically enables stories.

The snapshot, English scripts, and 25 referenced audio mappings were retrieved
on 2026-10-16 from that source, also used by `js/util.js`. English sources live at
`en/gamedata/story/<storyTxt>.txt` in the upstream repository. Artwork/audio use
the existing public asset CDNs with fallbacks. The root README's game-content
ownership and unofficial fan-project notices apply here too.

## Validation

No dependencies are needed for the parser, catalog, and save tests:

```sh
node --test vn/tests/*.test.mjs
```

Optional browser harnesses start/close their own local server, serve a GitHub
Pages subpath, and save desktop/mobile screenshots under `/tmp/arknights-vn`.
Install Playwright outside the repository to keep the site buildless:

```sh
npm install --prefix /tmp/vn-qa playwright
/tmp/vn-qa/node_modules/.bin/playwright install chromium
VN_PLAYWRIGHT_MODULE=/tmp/vn-qa/node_modules/playwright node vn/tests/browser.cjs
VN_PLAYWRIGHT_MODULE=/tmp/vn-qa/node_modules/playwright node vn/tests/navigation.cjs
```

`VN_BROWSER_PATH` optionally selects an existing Chromium binary;
`VN_SCREENSHOTS` optionally changes the screenshot directory. Internet access is
needed for artwork/audio checks. The first harness checks the original prologue,
all selected-path dialogue/choices, language switching, history, retry, mobile,
timed transitions, decoded audio, and autoplay. The navigation harness checks all
six catalog categories, independent saves/migration, reload/Back/Forward,
stale-load cancellation, teardown, all three new stories' complete selected-path
text, remote images, and mobile layout. Unit tests cover all original branching
answers, source alignment for all four scenes, every catalog route, malformed
saves, storage failure, group isolation, and unknown directives.
