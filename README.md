# Arknights Story Reader

A static, client-side reader for Arknights story scripts, served at
<https://schaable.github.io/arknights>.

This is a trimmed fork of [akgcc.github.io](https://github.com/akgcc/akgcc.github.io):
the other tools that lived in the upstream repo (CC clears, randomizer, recruit
calculator, pull history, roguelike/shop lists, tier list, polls) have been removed so
the site is just the story reader. It also adds a **Spanish (`es_ES`) translation**
of the Main Story.

## How it works

No build step and no backend — open `index.html` and the browser does the rest.

- Story index tables and all media (portraits, backgrounds, audio, video) are fetched
  from **remote** sources at runtime (see `ASSET_SOURCE` / `DATA_BASE` in `js/util.js`).
- The only assets served from this repo are the page itself, its CSS/JS, Font Awesome,
  and `gamedata/` — the translated script files.
- Spanish is **local-first**: for `es_ES`, `js/story.js` tries
  `gamedata/es_ES/story/<key>.txt` and falls back to the remote English script on a
  miss, so untranslated stories still render (in English).
- All local paths are **relative**, so the site works unchanged whether it's served at
  the root (`http://localhost:8000/`) or under a subpath
  (`https://schaable.github.io/arknights/`).

## Layout

| Path | What it is |
| --- | --- |
| `index.html` | the story reader page |
| `css/`, `js/`, `webfonts/`, `images/` | front-end assets |
| `gamedata/es_ES/story/**` | translated story scripts |
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

Translated so far: Main Story Prologue and Chapters 1–3.

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

### If you want to support the original developer:

[Sponsor them on Github](https://github.com/sponsors/NeverDecaf)
or
[Buy them some pulls](https://ko-fi.com/NeverDecaf)
