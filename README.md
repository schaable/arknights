# Unofficial Arknights Story Reader — Spanish Fan Translations

A static, client-side reader for unofficial, AI-assisted Spanish fan translations
of Arknights story scripts, served at
<https://schaable.github.io/arknights>.

## Unofficial fan project

This is an **unofficial, non-commercial fan translation**. Arknights and its
original story content are the property of Hypergryph/Yostar and their respective
rights holders. This project is not affiliated with, sponsored by, or endorsed by
them.

The Spanish translations are fan-made with AI assistance. The maintainer reviews
and edits them after finishing each chapter. They are not official localizations.
Please support Arknights through its official releases and channels.

The repository's MIT license covers the reader software; it does not grant rights
to Arknights story content, translations of that content, or third-party artwork,
music, and other game assets. All rights to the underlying game content remain
with their respective owners.

## About this fork

This is a trimmed fork of [akgcc.github.io](https://github.com/akgcc/akgcc.github.io):
the other tools that lived in the upstream repo (CC clears, randomizer, recruit
calculator, pull history, roguelike/shop lists, tier list, polls) have been removed so
the site is just the story reader. This fork focuses on hosting **unofficial
Spanish (`es_ES`) fan translations** of the Main Story.

## How it works

No build step and no backend — open `index.html` and the browser does the rest.

- Story index tables and all media (portraits, backgrounds, audio, video) are fetched
  from **remote** sources at runtime (see `ASSET_SOURCE` / `DATA_BASE` in `js/util.js`).
- The only assets served from this repo are the page itself, its CSS/JS, Font Awesome,
  and `gamedata/` — the translated script files.
- Spanish is **local-first**: for `es_ES`, `js/story.js` tries
  `gamedata/es_ES/story/<key>.txt` and falls back to the remote English script on a
  miss, so untranslated stories still render (in English).
- While reading a Spanish translation, click a dialogue box or its **translation
  icon** to replace that box's Spanish text with the English original. Click again
  to switch back. For dialogue choices, use the icon; answers remain selectable
  in either language and the selected branch is preserved when switching.
  The original loads once per scene, on demand. Comparison is unavailable if the
  English script's structure no longer matches the translation.
- The small **comment icon** beside each translation icon lets you save, edit,
  or delete a review note and an optional replacement. Notes stay in this browser.
  The **clipboard icon** beside the story selectors copies all saved notes with
  their stage, scene, speaker, file lines, and English/Spanish text for pasting
  into a review conversation. If clipboard access is unavailable, select and copy
  the report from the dialog. If English cannot load, the note still saves with
  its Spanish text and the report identifies the missing original. After sending
  your review, use the **eraser icon** beside the clipboard to clear all saved
  notes and remove their marks from the reader.
- All local paths are **relative**, so the site works unchanged whether it's served at
  the root (`http://localhost:8000/`) or under a subpath
  (`https://schaable.github.io/arknights/`).

## Layout

| Path | What it is |
| --- | --- |
| `index.html` | the story reader page |
| `css/`, `js/`, `webfonts/`, `images/` | front-end assets |
| `gamedata/es_ES/story/**` | unofficial Spanish fan-translated story scripts |
| `tools/` | the translation pipeline (see below) |

## Translation

`tools/` holds a tag-preserving translation pipeline (`translate.mjs` + `lib/`), a
glossary (`glossary.es.json`) and a translation-memory cache (`tm.es.json`).

```bash
node tools/translate.mjs                           # dry-run: segment counts + glossary coverage
node tools/translate.mjs --scope=main_NN --export batch.json   # untranslated segments
node tools/translate.mjs --apply --scope=main_NN   # splice translations into gamedata/
```

`--apply` only calls a translation API for segments missing from `tm.es.json`, and it
splices byte-preservingly — every `[Command(...)]` tag, id and `values=` is left
untouched. It fails loudly rather than writing a half-translated file.

Translated so far: Main Story Prologue and Chapters 1–4.
Chapter 4 is fully translated; 4-5 through 4-10 are awaiting review.

## Running locally

Serve the repo root over `http://` (needed for `fetch`; also needs internet access for
the remote game data):

```bash
# from the repo root:
python3 -m http.server 8000
```

Then open <http://localhost:8000/>.

### This website is made possible by the following projects:

-   https://github.com/Aceship/AN-EN-Tags
-   https://github.com/Kengxxiao/ArknightsGameData
-   https://github.com/FortAwesome/Font-Awesome
-   https://arkwaifu.cc/
-   https://github.com/astral4/arkdata
-   https://github.com/hysts/anime-face-detector

### Support the upstream reader's developer

These links support the upstream reader's software developer, not the creators or
publishers of Arknights or this fork's Spanish translations.

[Sponsor them on Github](https://github.com/sponsors/NeverDecaf)
or
[Buy them some pulls](https://ko-fi.com/NeverDecaf)
