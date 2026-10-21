# Visual novel reader

A separate, buildless story library and visual novel player at **`/vn/`**.
The root **`/` remains the classic reader**. Serve the repository root:

```sh
python3 -m http.server 8000
# http://localhost:8000/vn/
```

Relative paths also work at `/arknights/vn/` on GitHub Pages. Use HTTP rather
than `file://`, because the player fetches its scripts.

The header uses the **Amiya & pages** logo (option 08).
Its standalone SVG and the saved alternatives—01, 02, 03, 04, 10, 11, 12, 14,
and 15—are in [the logo gallery](design/logo-options/README.md).

## Library and playable stories

The library lists Main Story, Side Stories, Vignettes, Operator Records,
Operator Modules, and Integrated Strategies. Category pages show every chapter
or collection, with search and an optional filter for playable VN stories.
Operator Records and Operator Modules first list operators, each with a portrait
and combined completion count. Selecting an operator lists all their records or
modules directly, with individual module artwork and read/unread controls.
Search in these sections matches operator names and record/module titles.
The operator index uses game character IDs; alternate forms with distinct
operator IDs remain separate, while Amiya's class-specific modules share her page.
Existing collection/story links and independent progress remain unchanged.
Integrated Strategies shows one card per topic, ordered from Ceobe's Fungimist
onward. Each topic lists its entry/endings and monthly squad stories under
separate headings, with combined read/translation/VN counts. Search matches
topic, squad, and story titles. The existing entry/endings URL opens the combined
topic page; squad and story URLs still work, and each original collection keeps
its own progress. Breadcrumbs and return links lead back to the topic.
Collection pages list stories in game order. Translation availability and VN
availability are separate: a Spanish script can exist before its scene is
supported by the player. Other stories have links to the classic reader.

Collection cards, Continue reading, collection headings, and story opening
screens use collection artwork. Square frames preserve the image's proportions
and normally show it in full. Phantom, Mizuki, Expeditioner, and Sarkaz IS covers
use individual square crops to reduce excess transparent margins while keeping
their titles and main artwork visible; monthly squads inherit the same framing.
Chapters use episode covers, events use
archive covers, operator records use portraits, modules use their equipment art
(or an operator portrait when that icon is missing), and Integrated Strategies
uses topic artwork shared with its monthly squads. Images load lazily in grids
and retry a raw GitHub mirror if the CDN fails; a neutral placeholder preserves
navigation when a cover is missing or both mirrors fail.

All 998 catalog collections have mapped artwork. All 18 chapters, event archive
cards, and IS topics 1–5 (including their monthly squads) use the pinned English
ArknightsAssets2 snapshot. The chapter artwork uses the newer, wider layered
cards, shown in full inside square frames. Migrating 59 covers from the retired
ArknightsAssets repository updated 91 collections, including inherited squad
covers. English release artwork replaces most Chinese title lettering; this is
not a general resolution upgrade.

Delicious On Terra, A Flurry to the Flame, It's Been A While, and Ceobe's Fungimist
use custom AI-generated covers with English titles and transparent backgrounds.
They use event banners and official category artwork as references; they are not
official covers. The images, prompts, source references and checksums are in
`assets/covers/generated/`. The original event banners from Arknights Terra Wiki
and PRTS remain preserved without modification in `assets/covers/`, with their
provenance in `assets/covers/sources.json`. VN collection covers no longer depend
on the retired ArknightsAssets repository.
Some images still contain Chinese text baked into the artwork, even in the
English snapshot; changing the reader language does not translate it. The
placeholder remains a fallback for loading failures and future unmapped entries.

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
- `#/operator-records/magallan` and `#/operator-modules/magallan`
- `#/integrated-strategies/phantom-crimson-solitaire`

`/vn/` or `/vn/#/` opens the library. Removing the story slug opens the collection;
removing the collection slug opens the category. Links support reloads and native
browser Back/Forward without server rewrites. The player provides breadcrumbs,
previous/next stories, and a story selector. Completion links to the next VN
story when supported, otherwise explicitly to the classic reader.

The home page's **Continue reading** section shows only the most recently active
chapter or collection in each category, ordered by recency. The home card,
category card, and collection/operator/topic page use the same continuation
target: an unfinished reading resumes at its saved position; completing or
marking a story read points to the next unread story in that collection. Already
read successors are skipped, but unsupported stories are not: their existing
page links to the classic reader. Finishing the last story removes these links
without jumping to another chapter or reviving an older bookmark on the home
page. Marking unread clears the position; starting a new reading restores its
resume link. Earlier bookmarks remain available on their collection pages.

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
  Space takes priority over focused buttons, links, and selectors while reading,
  including after closing a dialog; on a loaded story cover it begins reading.
  Enter activates focused controls and choices. Open dialogs and text fields
  keep normal keyboard behavior, and holding Space does not repeatedly advance.
- Typewriter speed, automatic reading, choices, history, restart, reduced motion,
  and mobile layout are supported. Sound and settings are global header controls,
  available from the library and every story. A volume slider beside the sound icon
  adjusts music and effects from 0–100%, including during fades. Volume defaults to
  55% (the previous playback level); mute remains a separate toggle, so adjusting
  the slider while muted stays silent. Sound defaults to muted; sound, volume,
  text speed, Doctor's name, and reduced motion persist across stories and reloads.
  Arrow keys adjust the focused slider; Space still advances the story.
  Covers and the library stay silent. Hiding the tab stops automatic reading and
  suspends sound; returning restores sound when enabled.
- Back and history preserve the current music's playback position when the
  destination uses the same track. A different track starts from the beginning,
  and a silent scene stops the music. Language changes also preserve the track.
- The speed selector beside Auto offers 0.5×, 1×, 1.5×, 2× and 3×. It scales the
  text-length-based pause after each line finishes typing; 1× preserves the original
  timing. Changing it during Auto starts a fresh pause at the selected speed without
  replaying the scene. The speed is global and persists across stories and reloads.
  Text typing, scripted animations and audio retain their existing speeds. Choices,
  dialogs, the ending and hiding the tab still stop Auto; changing speed does not
  turn Auto on. Space still advances when the speed selector has focus.
- The fullscreen button beside Next expands the story while keeping sound, settings,
  history and translation review available. Click it again or press Esc to exit;
  Enter activates the focused button, while Space still advances. Artwork keeps
  its 16:9 scene proportions with letterboxing, and long dialogue can scroll.
  Browsers that cannot enter native fullscreen use a full-window view with browser
  chrome still visible. Fullscreen leaves progress and preferences unchanged and
  exits on navigation or reload; it is not a saved preference.
- Progress is independent **per main-story chapter**, **per side story/vignette
  collection**, and **per operator-record/module/Integrated Strategies
  collection**. Each group remembers its last reading or manual completion and preserves each
  story's line, choices, completion, and timestamp. Merely browsing a chapter or
  opening a story's cover does not change the resume target.
- Restart clears only the current story. Collection completion uses *all* its
  stories as the denominator, including scenes not yet supported in VN.
- Every story in a chapter or collection has **Mark as read / Mark as unread**,
  including stories available only in the classic reader. Changes update the
  completion count and persist across reloads. Marking read clears the saved
  position and choices and opens the ending screen directly on the next visit. Marking
  unread clears them and starts from the beginning. Marking read updates the
  collection's continuation point and recency, including for an unopened story,
  without creating progress in the next story. Other stories keep their saves.
- Read stories open at **You reached the end of this story**, including older
  saves that still contain an intermediate position. The completed story has no
  Continue reading button; **Read again** starts a new reading. Restarting, going back
  into dialogue, or selecting a history line marks the story unread again.
  Reaching the ending restores completion.
- Navigation aborts old script requests, rejects stale results, and stops sound,
  automatic reading, timers, animations, and open dialogs before reusing the stage.

Saves use browser-local `arknights.vn.v2`, separate from classic-reader settings
and translation-review notes. The shape is:

```js
{
  v: 2,
  preferences: { language: 'es', sound: false, volume: 55, nickname: '', speed: 45, autoSpeed: 1, motion: false },
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

Manual read/unread resets store `{ read: true }` or `{ read: false }`, without a
position or choices. An existing bookmark also retains its `updated` timestamp
as reading history. Manual completion sets the group's `resume` to the completed
story and updates the group's timestamp. The displayed continuation is resolved
from that point without writing a save for the next story. Older manual-only
saves with `resume: null` continue after their last marked story in game order.
Clearing a new mark removes its entry.
Manual completion shows the ending screen without generating branch answers;
**Read again** starts a fresh reading.

Canonical `storyTxt` IDs identify stories; `${category}:${collectionId}` identifies
save groups. An existing `arknights.vn.v1` prologue save and its preferences migrate
once; the original key is retained as a backup. Values and script positions are
validated on load. New saves include a command-structure fingerprint; a changed
script restarts with a notice instead of mapping an old position onto different
dialogue. A completed story retains its read status and opens the ending screen
without the old branch history if its script structure changed. Existing saves
without a fingerprint continue to migrate. Writes merge
other tabs' saved groups, and storage events refresh library progress and read
status in an open player. Denied/full storage falls back to memory for the tab
and displays a warning when saving playback or manual read status. There is no
cloud sync or import/export.

## Translation review

Each Spanish dialogue and choice offers an **EN/ES** comparison button and a
**note** button. Comparison changes only that line or set of choices, pauses
automatic reading, and leaves the story language, progress, and scene intact.
The next line returns to the selected story language. Comparison is disabled
when a compatible English source is unavailable; notes can still be taken.

The note editor shows both source texts and accepts a comment, a suggested
translation, or both. Noted lines are marked, and reopening a note lets you edit
or delete it. Notes preserve physical source lines, original text (including
markup and nickname placeholders), and the English source URL. New VN notes use
the pinned English scripts; editing an existing note retains its saved source
snapshots. Review notes do not modify translations.

**Copy notes** at the top exports every saved note in the classic reader's
Markdown format. If clipboard access fails, a dialog provides selected text for
manual copying. **Clear notes** removes all review notes, preserving reading
progress. Both readers share `arknights.translationReviews.v1` on the same
browser and origin, so existing classic-reader notes are immediately available
and edits synchronize between tabs. Storage failures leave unsaved drafts in
the editor and show an error; malformed saved notes are left untouched.

## Files and extension points

| File | Responsibility |
| --- | --- |
| `index.html`, `reader.css` | Library/player shell, stage, responsive controls, dialogs |
| `app.mjs`, `catalog.mjs` | Hash routing, navigation, collection progress, app lifecycle |
| `library.mjs`, `i18n.mjs` | Catalog views and Spanish/English UI strings |
| `covers.mjs`, `tools/cover-assets.json` | Collection artwork, CDN fallback, verified archive paths and source provenance |
| `assets/covers/` | Four generated collection covers, original reference banners, prompts and source/checksum records |
| `loader.mjs` | Independent language/audio loading, error classification, structure validation |
| `compatibility.mjs` | Command/variant/branch checks, language signatures, cover/audio discovery |
| `story-overrides.mjs` | Optional stable slugs and cover overrides; no playback allowlist |
| `data/catalog.json`, `data/audio.json` | Generated metadata and referenced audio mappings |
| `tools/build-catalog.mjs`, `tools/source-metadata.mjs` | Catalog normalization, source discovery, compatibility, stable slugs |
| `tools/sync-english.py` | Pin translated stories’ English counterparts to an upstream commit |
| `script.mjs` | Tag parsing, branches, scene state, timeline, progress validation |
| `reader.mjs` | Reusable player, rendering, transitions, controls, history |
| `fullscreen.mjs` | Native fullscreen, full-window fallback, view lifecycle and accessible toggle |
| `review.mjs`, `review-data.mjs` | Per-line comparison controls, note editor, shared classic-reader storage and Markdown export |
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
background/CG is still recorded in source metadata; the opening screen now uses
the collection's cover. Add verified chapter/event/topic paths to
`tools/cover-assets.json` and rebuild the catalog to expand artwork coverage.
An optional `crop: { x, y, size }` defines a square window in source-image pixels
for covers with excessive margins, applied consistently wherever they appear.
Operator portraits and module icons are derived from the source tables. Archive
textures are pinned to the commit in `covers.mjs`; update that pin and the
manifest's provenance together when refreshing the archive asset snapshot.
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
VN_PLAYWRIGHT_MODULE=/tmp/vn-qa/node_modules/playwright node vn/tests/library.cjs
VN_PLAYWRIGHT_MODULE=/tmp/vn-qa/node_modules/playwright node vn/tests/keyboard.cjs
VN_PLAYWRIGHT_MODULE=/tmp/vn-qa/node_modules/playwright node vn/tests/preferences.cjs
VN_PLAYWRIGHT_MODULE=/tmp/vn-qa/node_modules/playwright node vn/tests/autoplay.cjs
VN_PLAYWRIGHT_MODULE=/tmp/vn-qa/node_modules/playwright node vn/tests/fullscreen.cjs
VN_PLAYWRIGHT_MODULE=/tmp/vn-qa/node_modules/playwright node vn/tests/operators.cjs
VN_PLAYWRIGHT_MODULE=/tmp/vn-qa/node_modules/playwright node vn/tests/topics.cjs
VN_PLAYWRIGHT_MODULE=/tmp/vn-qa/node_modules/playwright node vn/tests/covers.cjs
VN_PLAYWRIGHT_MODULE=/tmp/vn-qa/node_modules/playwright node vn/tests/loading.cjs
VN_PLAYWRIGHT_MODULE=/tmp/vn-qa/node_modules/playwright node vn/tests/scenes.cjs
VN_PLAYWRIGHT_MODULE=/tmp/vn-qa/node_modules/playwright node vn/tests/review.cjs
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
The preferences harness checks global controls from the library, saved sound,
volume and text settings across stories/reloads, live volume without restarting
audio, music continuity on Back/Next/history/language changes, switching tracks,
silent covers, and background audio suspension using a local audio fixture.
It also checks localized slider labels, keyboard/touch adjustment, and desktop/mobile
layouts. Unit tests cover volume during crossfades, delayed sounds and mute/restore.
The Auto speed harness uses a controlled clock to check every playback rate,
live timer replacement, choices/completion, pauses, navigation cleanup, persistence,
localized labels and desktop/mobile/fullscreen layouts.
The fullscreen harness checks native entry/exit, Escape and focus restoration,
unchanged progress, settings/history/review dialogs, Space, localization, mobile
fallback, portrait/landscape layouts, scene proportions and late-request cleanup.
The review harness checks per-dialogue and choice comparison, interoperability
with the classic review UI, source snapshots, note editing/deletion, clipboard
and manual export, mobile layout, missing/misaligned sources, storage failures,
and route cleanup. Unit tests verify shared note IDs, raw source fields, the
Markdown format, and preservation of existing notes and reading progress.
The library harness checks one recent collection per category, continuation in
all three library locations after manual/natural completion, stopping at the
last story without reviving older chapters, manual read/unread
actions for VN and classic-only stories, opening at the ending/beginning after
marking read/unread, older read flags with intermediate positions, rereading that
clears completion, cleared choices, reload, cross-tab resets, mobile and keyboard
controls, and storage errors.
The operator harness checks both operator indexes, aggregated lists and counts,
existing collection/story links, independent saves across records and modules,
search, localization, reload/Back/Forward, and mobile layout.
The keyboard harness checks Space with focused player buttons, links and selectors,
dialog close/focus restoration, native text input inside dialogs, held keys,
Enter for choices, starting from the cover, and normal library controls.
The IS topic harness checks topic counts, squad/story search, ordered sections,
combined progress, independent collection saves, existing links, breadcrumbs,
reload/Back/Forward, localization, and mobile layout. A translated-script fixture
also checks future VN availability, topic resume links, and the player's return
link without enabling untranslated IS stories in the catalog.
The cover harness checks actual artwork in every category, all 17 recovered
images (covering the previous 25 unmapped collections), the migrated IS topics
and their inherited squad artwork, collection and player
covers, resume cards, mobile layout, raw-mirror fallback, local images under a
GitHub Pages subpath, simulated missing metadata, and continued access to stories
when both image mirrors fail. Unit tests require cover metadata for every catalog
collection and verify the preserved local images against their provenance.
