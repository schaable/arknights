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

**All 113 translated scenes** are enabled in Spanish and English:

| Collection | Playable / translated scenes |
| --- | --- |
| Chapter 00 | 14 / 14 |
| Chapter 01 | 12 / 12 |
| Chapter 02 | 20 / 20 |
| Chapter 03 | 16 / 16 |
| Chapter 04 | 20 / 20 |
| Chapter 05 | 17 / 17 |
| Children of Ursus | 7 / 7 |
| Operational Intelligence | 7 / 7 |

The previously blocked 21 scenes now support their character cut-ins, background
tweens, item overlays, and sound-channel stops. Untranslated stories remain in
the classic reader. Translations and the root reader are unchanged.

Example URLs after `/vn/`:

- `#/main/chapter-0/prologue-1` and `#/main/chapter-0/prologue-2`
- `#/main/chapter-1/1-1-before`
- `#/vignettes/children-of-ursus/habits`

`/vn/` or `/vn/#/` opens the library. Removing the story slug opens the collection;
removing the collection slug opens the category. Links support reloads and native
browser Back/Forward without server rewrites. The player provides breadcrumbs,
previous/next stories, and a story selector. Completion links to the next VN
story when supported, otherwise explicitly to the classic reader.

The complete catalog is a checked-in snapshot (998 collections, 2,670 stories,
113 local Spanish translations at generation time). No remote story-index
downloads are required to browse it. The generator discovers translated scripts
and enables scenes that pass command, branch, language, and audio checks.

## Playback and progress

- Spanish is the default. Language switches retain the line and selected branch.
  Spanish scripts are read directly from `../gamedata/es_ES/`; translations are
  neither copied nor regenerated. Story and collection names retain their
  upstream titles. Settings can change the Doctor's name.
- Stage artwork, character focus, backgrounds/CGs, crossfades, image transforms,
  cut-ins, item overlays, blockers, grayscale, camera shake, and waits use the script's events. Next can
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
          line: 42, answers: {}, read: false, updated: 1234567890,
          structure: '<SHA-256 of the command structure>'
        }
      }
    }
  }
}
```

Canonical `storyTxt` IDs identify stories; `${category}:${collectionId}` identifies
save groups. An existing `arknights.vn.v1` prologue save and its preferences migrate
once; the original key is retained as a backup. Values and script positions are
validated on load. New saves include a command-structure fingerprint; a changed
script restarts with a notice instead of mapping an old position onto different
dialogue. Existing saves without a fingerprint continue to migrate. Writes merge
other tabs' saved groups, and storage events
refresh library progress. Denied/full storage falls back to memory for the tab
and displays a save warning during reading. There is no cloud sync or import/export.

## Files and extension points

| File | Responsibility |
| --- | --- |
| `index.html`, `reader.css` | Library/player shell, stage, responsive controls, dialogs |
| `app.mjs`, `catalog.mjs` | Hash routing, navigation, collection progress, app lifecycle |
| `library.mjs`, `i18n.mjs` | Catalog views and Spanish/English UI strings |
| `loader.mjs` | Independent language/audio loading, error classification, structure validation |
| `compatibility.mjs` | Command/variant/branch checks, language signatures, cover/audio discovery |
| `story-overrides.mjs` | Optional stable slugs and cover overrides; no playback allowlist |
| `data/catalog.json`, `data/audio.json` | Generated metadata and referenced audio mappings |
| `tools/build-catalog.mjs`, `tools/source-metadata.mjs` | Catalog normalization, source discovery, compatibility, stable slugs |
| `tools/sync-english.py` | Pin translated stories’ English counterparts to an upstream commit |
| `script.mjs` | Tag parsing, branches, scene state, timeline, progress validation |
| `reader.mjs` | Reusable player, rendering, transitions, controls, history |
| `assets.mjs` | Existing CDN conventions, image fallback, music/SFX |
| `storage.mjs` | Versioned grouped saves and legacy migration |
| `sources/en/`, `sources/provenance.json` | 113 pinned English AVG scripts and their commit/checksums |
| `tests/` | Parser/storage/catalog tests and Chromium integration checks |
| `COMMANDS.md`, `tools/audit-commands.mjs` | Reproducible command inventory across local game data and pinned sources |

The classic `js/story.js` couples parsing and DOM playback. This separate player
uses its line/tag, sprite, and predicate conventions in a small pure adapter with
an explicit directive allowlist. Unsupported directives fail visibly; this is
not yet a general AVG renderer. Nested predicates and advanced game effects need
additional work before enabling arbitrary scenes. Sprite positioning uses common
CSS anchors, not a global metrics database. Artwork/audio remain remote and
require network access; offline caching is not implemented.

To migrate another translated scene, sync its English counterpart and rebuild
metadata. No per-story loading configuration is needed. The first nonblank
background/CG becomes the cover; optional overrides can select another image.
Unknown commands, conditional/nested decisions, nonuniform scaling, unsupported
camera effects/page destinations, or unknown audio references prevent automatic
activation. Passing these checks establishes compatibility with the current
renderer; new content still needs visual QA. Do not derive classic story indices
from stage codes: the catalog preserves the classic reader's ordering.

### Scene command coverage

- `CharacterCutin` keeps independent `widgetID` slots, uses the requested sprite,
  horizontal offset and width, and opens/closes with a center reveal or alpha
  fade. A command without `name` removes its slot. Cut-ins sit above the CG and
  normal characters; their snapshots survive Back, history, reload and language
  switches. Unvalidated styles remain gated. Portrait crops use the same common
  canvas anchors as normal sprites, rather than exact game UI metrics.
- `BackgroundTween` animates the background independently of `ImageTween`.
  Both honor explicit start/end positions, uniform scale, duration and blocking;
  nonblocking animation continues while dialogue is shown. Seeking or skipping
  uses the deterministic final transform.
- `ShowItem` uses the AVG items asset directory and a single centered overlay;
  another item replaces it and `HideItem` fades it away. Cut-ins and items wait
  for their artwork before beginning timed playback, with a 15-second bound,
  image fallback and a visible failure notice. Next and navigation cancel the
  wait. Reduced motion omits scripted animation/delay, including brief inserts.
- `PlaySound` supports looping named channels. `StopSound` cancels pending
  starts and fades only the specified channel; music and other channels keep
  playing. Named-channel replacement disposes the previous sound. Unnamed
  one-shots can overlap. Only active loops are restored when seeking or enabling
  sound; one-shots are never replayed by restoring a save. Muting and leaving a
  story dispose all sounds, fades and delayed starts. Audio restores from the
  start of a loop, not an exact playback timestamp.

The [command audit](COMMANDS.md) covers all 212 local gamedata scripts and 113
pinned English counterparts. It found **12 additional command families**, all
outside the translated corpus: character actions/slots, multiline/popup dialogue,
subtitles/stickers, foreground/background effects, image rotation, and volume
changes. Implementing these requires validating their own scenes and, for
particles, an asset/rendering adapter. They remain explicitly unsupported under
the translated-only validation scope; none were silently accepted as no-ops.
This local inventory is not an audit of the entire upstream English catalog.

The implementation follows the checked-in scripts and existing asset conventions.
The public [Mooncell rendering reference](https://github.com/MooncellWiki/arknights-story-player/blob/588a9baad8aed9250c9e8fe8d54a10616aa7630c/src/engine/rendering/PixiStoryRenderer.ts)
and [audio reference](https://github.com/MooncellWiki/arknights-story-player/blob/588a9baad8aed9250c9e8fe8d54a10616aa7630c/src/engine/audio.ts)
were also consulted for widget/channel lifecycle; this is not a claim of exact
in-game rendering parity. Rebuild the inventory with:

```sh
node vn/tools/audit-commands.mjs > vn/COMMANDS.md
```

## Loading behavior

Each translated catalog entry has generated `source` metadata: its format,
language URLs, file checksums, canonical command fingerprint, cover, audio keys,
and compatibility findings. URLs follow the canonical `storyTxt` path. Only AVG
scripts are supported; synthesized operator-module text and untranslated content
remain in the classic reader for this rollout.

Spanish, English, and audio requests settle independently, with 15-second request
timeouts and route cancellation. One failed language falls back to the other
with a visible notice; the unavailable option is disabled. Audio failure leaves
text readable. Retry during reading restores the current line and choices.
Missing files, network failures, unsupported scripts/formats, malformed scripts,
and language mismatches have distinct messages and a classic-reader link.
Permanent format/compatibility failures do not invite pointless network retries.

The loader verifies command fingerprints before applying saves or enabling
language switching. Text-only translation edits remain compatible. If sources
have different command structures, the incompatible version is disabled; it is
never used to interpret another version's line/choice IDs. Menu language remains
the user's preference even when a story falls back to the other language.

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

The generator writes only `vn/data/catalog.json` and `vn/data/audio.json`.
Existing route slugs are retained when titles change. Translation flags come
from local Spanish files; VN flags come from source compatibility checks. The
generator never modifies or translates story text. Compatibility failures are
recorded in each story's `source.issues` for maintenance.

Before generating metadata for newly translated stories, pin their originals:

```sh
python3 vn/tools/sync-english.py
# Or use --revision <commit> for an explicit upstream edition.
node vn/tools/build-catalog.mjs /tmp/vn-catalog-source
```

The sync tool resolves the upstream ref once, downloads every local translation's
English counterpart from that commit, and only writes the snapshot after all
downloads succeed. `sources/provenance.json` records the resolved commit and file
checksums. The original four English files were moved without changing their
contents.

The source repository is `ArknightsAssets/ArknightsGamedata`, also used by
`js/util.js`. The catalog tables were retrieved on 2026-10-16; the pinned English
revision is recorded in `sources/provenance.json`. There are 91 audio entries,
including direct `Sound_Beta_2/...` paths. Artwork/audio use the existing public
asset CDNs with fallbacks. The root README's game-content ownership and unofficial
fan-project notices apply here too.

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
VN_PLAYWRIGHT_MODULE=/tmp/vn-qa/node_modules/playwright node vn/tests/loading.cjs
VN_PLAYWRIGHT_MODULE=/tmp/vn-qa/node_modules/playwright node vn/tests/scenes.cjs
```

`VN_BROWSER_PATH` optionally selects an existing Chromium binary;
`VN_SCREENSHOTS` optionally changes the screenshot directory. Internet access is
needed for artwork/audio checks. The first harness checks the original prologue,
all selected-path dialogue/choices, language switching, history, retry, mobile,
timed transitions, decoded audio, and autoplay. The navigation harness checks all
six catalog categories, independent saves/migration, reload/Back/Forward,
stale-load cancellation, teardown, all three new stories' complete selected-path
text, remote images, and mobile layout. The loading harness checks a complete
selected path through all
113 enabled stories (10,631 dialogue lines), completion saves, language switching,
303 unique images (including transient and alternate-branch artwork), and samples
from every migrated collection. It also simulates
missing/failed languages, mismatched scripts, audio failures, unsupported scripts,
and retry during reading. Set `VN_FAILURES_ONLY=1` to run just those failure cases.
Unit tests cover original branching answers, bilingual source alignment across
all enabled scenes, every catalog route, malformed saves, group isolation,
request cancellation/timeouts, fingerprints, pinned-source checksums, and unknown
commands/variants. The scene harness checks timed cut-ins, the brief Ursus item
insert with a slow image request, independent background/foreground tweens,
both translated sound-stop sequences, overlay restoration and route teardown.
Unit tests also verify channel isolation, delayed-start cancellation and mute/
restore cleanup without fetching audio.
