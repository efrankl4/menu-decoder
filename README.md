# Menu Decoder

An offline-first phone reference for reading menus in non-English cuisines — a searchable
glossary plus a quick-reference table that shows, per diner, what a dish contains and
**how much of the dish it is**.

**Live: https://efrankl4.github.io/menu-decoder/**

Install it to your phone's home screen (see *Offline* below) — that's what makes the
offline cache durable.

## Run it locally

```bash
python3 -m http.server 8137
```

Then open http://localhost:8137. A plain `file://` open will not work — the app fetches
JSON, and browsers block that from the filesystem.

## Check the data

```bash
node validate.js
```

Validates the tag vocabulary, certainty/prominence values, spice fields, cross-references
between terms, and duplicate ids. Run it after every data edit.

## Layout

```
index.html            app shell
sw.js                 service worker — lives at the root so its scope covers everything
app/
  app.js              search, filtering, profiles, rendering
  styles.css          mobile-first, light/dark, print stylesheet
  manifest.webmanifest
data/
  SCHEMA.md           the data contract; read this before adding terms
  tags.json           tag vocabulary (emoji, labels, groupings)
  cuisines.json       cuisine list; `status: planned` means no file yet
  restaurants.json    restaurants a term list has been checked against
  terms/*.json        one file per cuisine — 18 built, 655 terms total
validate.js
```

`sw.js` must stay at the project root, not under `app/`. A service worker's default
scope is the directory it's registered from — put it under `app/` and it can only ever
control requests to `/app/*`, silently missing `index.html` and every `data/*.json`
fetch. That was a real bug here until it was caught by inspecting
`navigator.serviceWorker.getRegistrations()` in the browser.

## How the table reads

Each diner is a column. **A blank cell (✓) means nothing on that person's list is in the
dish** — that's the thing to scan for. Otherwise you get a chip per flagged ingredient:

- **Certainty** is the mark on the chip: `!` always/usually · `?` sometimes, worth asking ·
  `·` rarely.
- **Prominence** is the chip's weight: solid = a large part of the dish, outlined dashed =
  a garnish or trace amount.
- Tapping any row opens the full description, the per-ingredient detail (what it is, how
  much, whether it's removable), the heat rating, and a suggested question for the server.

Heat is two fields: how *reliably* spicy the dish is, and a 0–4 rating on a fixed scale
(0 no chili · 1 warm spice only · 2 jalapeño-ish · 3 clearly hot · 4 very hot). A `±`
means the kitchen can usually adjust it.

## Diners

The app ships with two **empty** diners (`Diner 1`, `Diner 2`). Dietary restrictions are
personal data, so none are baked into this source — you set them up once on your own
device via the 👥 button and they persist in that browser's localStorage, offline and
per-device. Any tag in `tags.json` can be watched, and you can add more diners.

### Severity order drives the sorting

Inside each diner you also get a **drag-to-rank severity list** of the tags that diner
watches. That order is what the column sort uses:

- **Top = most severe.** Sorting that column sinks those rows to the bottom, so the
  safest dishes rise to the top.
- Within one severity tier, rows sub-sort by certainty — `rarely`, then `sometimes`,
  then `usually`, then `always` — so the most certain problems land last.

Reordering the list re-sorts the table immediately. Dragging uses pointer events rather
than HTML5 drag-and-drop, so it works on touch as well as with a mouse.

## Restaurants

Filters aren't only by cuisine — the filters panel also has a **My restaurants** section,
grouped by city, so the table can be narrowed to only the terms verified against a specific
restaurant's actual menu (24 restaurants across Bethesda, Rockville, Silver Spring, and DC as of writing).
Leave every restaurant unchecked to browse the full general glossary for anywhere else.
Any term checked against a real menu shows a 🍽 restaurant tag in the table and glossary,
and its detail sheet lists which restaurant(s) with a tappable chip that jumps straight
into that filter. Terms with no restaurant tag are general cuisine vocabulary, not tied to
one specific menu — the detail sheet says so explicitly.

## Offline

Open the site once online, then add it to your home screen. The service worker caches the
whole app and dataset on first visit, so search and filtering work with no signal.
Data updates land on the next visit after you're back online.

The **Print / save as PDF** button in the filters panel prints whatever is currently
filtered — so you can produce a one-cuisine paper sheet to carry.

## Deploying

Hosted on GitHub Pages from `main` at the repo root. Any `git push` to `main`
redeploys automatically — there's no build step, the files are served as-is.
`.nojekyll` is present so GitHub serves everything verbatim instead of running the
files through Jekyll.

After a data or code change, bump `CACHE` in `sw.js`. The service worker only
swaps in a new cache when that name changes, so without a bump installed phones
keep serving the old copy.

`deploy.sh` and `_headers` are leftovers from a Netlify mirror and aren't used by
GitHub Pages.

## Adding a cuisine

1. Add an entry to `data/cuisines.json` and change `status` from `planned`.
2. Create `data/terms/<cuisine>.json` following `data/SCHEMA.md`.
3. Add the file path to the `ASSETS` list in `sw.js` (root, not `app/`) and bump `CACHE`.
4. Run `node validate.js`.

A term can list several cuisines — Lebanese and Palestinian share most of their Levantine
vocabulary this way, and a handful of dishes (fatteh, moussaka, ful, arak, chifa/nikkei
fusion items) are cross-tagged across two cuisines rather than duplicated.

## Bethesda / DC-area menu research

Terms and coverage gaps were seeded from real menus at 24 Bethesda, Rockville, Silver
Spring, and DC restaurants (see `data/restaurants.json`), several found via DC Restaurant
Week participant lists. Dishes pulled from an actual menu are noted as such in their
`long` description and carry a `restaurants` tag.

Cuisines Turkish, Indian, Salvadoran, Afghan, Mexican, Vietnamese, and Spanish were added
on top of the original eleven after a proposal-and-pick round: candidates were sourced by
cross-referencing Restaurant Week participants against cuisine gaps, then the user chose
which to build out (Bombay Bistro for Indian, El Golfo for Salvadoran, Bistro Aracosia for
Afghan, Gringos & Mariachis for Mexican, Hello Vietnam for Vietnamese, Taberna del
Alabardero for Spanish, and Agora Bethesda to flesh out Turkish/Greek/Lebanese).

## What this is not

A safety guarantee. Recipes vary by kitchen, and the `sometimes` marks exist precisely
because the answer genuinely differs restaurant to restaurant. Use it to know what to ask
and what to look at — not to skip asking when it matters.
