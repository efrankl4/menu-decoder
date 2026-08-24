# Menu Decoder — data schema

One source of truth. Both the glossary and the quick-reference table render from these records.

## File layout

```
data/
  SCHEMA.md          this file
  tags.json          the tag vocabulary (emoji, labels, groupings)
  cuisines.json      cuisine list + metadata
  restaurants.json   restaurants a term list has been cross-checked against
  terms/
    ethiopian.json
    peruvian.json
    palestinian.json
    thai.json
    ...
```

## Term record

```jsonc
{
  "id": "th-pad-thai",              // stable, unique, kebab-case, cuisine-prefixed
  "term": "Pad Thai",               // the headword as it appears on menus
  "native": "ผัดไทย",                // native script, "" if n/a
  "romanizations": ["phat thai", "pad tai"],  // spelling variants you might see
  "language": "Thai",
  "cuisines": ["thai"],             // may be multiple
  "type": ["dish"],                 // see Types below
  "short": "Stir-fried rice noodles with tamarind sauce, egg, and peanuts.",
  "long": "Full description: what it is, how it's prepared, regional variation, what it arrives with.",
  "components": ["th-tamarind", "th-fish-sauce"],  // ids of related terms
  "contains": [ /* see Contains below */ ],
  "spicy": { "frequency": "sometimes", "heat": 1, "adjustable": true, "note": "..." },
  "confidence": "high",             // high | medium | low
  "ask": "Is there peanut in the sauce or only on top?",  // optional; what to ask staff
  "sources": ["..."],               // optional provenance notes
  "restaurants": ["takumi"]         // optional; ids from restaurants.json — set only when
                                     // the term was verified against that restaurant's actual
                                     // menu (see "From real ... menus (X)" in `long`). Terms
                                     // that are general cuisine vocabulary, not tied to a
                                     // specific menu, omit this field entirely.
}
```

### Types

`dish` · `ingredient` · `technique` · `sauce` · `spice-blend` · `bread` · `beverage` ·
`dessert` · `course` (menu-section headings like *mezze*, *piqueos*) · `utensil-or-service`

### Contains

Each entry is one flagged ingredient occurrence. This is the heart of the tool.

```jsonc
{
  "tag": "tree_nut",          // from tags.json
  "specific": "walnut",       // the actual ingredient, when known
  "certainty": "always",      // always | usually | sometimes | rarely
  "prominence": "significant",// primary | significant | minor | garnish | trace
  "note": "Ground into the sauce base; not removable."
}
```

**Certainty** — how reliably this kitchen-to-kitchen:

| value | meaning |
|---|---|
| `always` | definitional to the dish; a version without it isn't the dish |
| `usually` | standard, but documented variants omit it |
| `sometimes` | genuinely varies by kitchen/region — **this is the "ask" case** |
| `rarely` | uncommon, but occurs often enough to be worth knowing |

**Prominence** — how much of the dish it is. Both profiles make case-by-case calls,
so this is what actually drives the decision:

| value | meaning |
|---|---|
| `primary` | the dish is largely this (~30%+) |
| `significant` | a real component, tasted throughout (~10–30%) |
| `minor` | present but small (under ~10%) |
| `garnish` | on top / on the side, removable by hand |
| `trace` | seasoning or cooking-medium quantity |

Cross-contamination and shared-facility handling are **deliberately not modeled** —
neither profile is sensitive at that level.

### Spicy

Two independent fields, so "reliably spicy" and "how hot" don't get conflated.

- `frequency`: `never` | `rarely` | `sometimes` | `usually` | `always`
- `heat`: 0–4 on a fixed, reference-anchored scale:
  - **0** no chili
  - **1** warm spice only — black pepper, paprika, warm baking spices
  - **2** mild chili presence, jalapeño-ish
  - **3** clearly hot — gochugaru-forward, bird's-eye, rocoto
  - **4** very hot
- `adjustable`: `true` if heat is routinely made-to-order or served on the side.

## Tags

Atomic and independent. A term carries every tag that applies; a *profile* selects
which tags to watch. Notable relationships handled in the UI, not the data:

- `melon` is tracked separately from `raw_fruit`. A raw melon dish carries both;
  the UI renders only the most specific chip when a profile watches both.
- `fruit` and `raw_fruit` are separate tags. Cooked/dried fruit gets `fruit` only.
- `raw_fish` is separate from `fish`. Ceviche carries both.

## Profiles

Deliberately **not** stored in this repo. Profiles are personal dietary data, so the
shipped defaults are two empty diners (`Diner 1`, `Diner 2`) with no tags. Real profiles
live only in the browser's localStorage — per-device, offline, and never published.

```jsonc
{ "id": "d1", "name": "Diner 1", "tags": ["tree_nut", "raw_vegetable"] }
```

`tags` is **ordered most-severe-first**, set by dragging in the 👥 panel. That order is
the sole input to the column's sort ranking:

- position 0 (top) scores highest and sinks furthest down the sorted table
- a tag the diner doesn't watch scores 0 and stays at the top

so sorting a diner's column always surfaces the safest dishes first. Within one severity
tier, rows are then sub-sorted by certainty (`rarely` → `sometimes` → `usually` →
`always`), putting the most certain problems last.

Any diner can watch any tag in `tags.json`.
