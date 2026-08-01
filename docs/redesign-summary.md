# WhatScares Redesign — Summary

## The brief
Turn the site from a "clean dark catalog" into an atmospheric horror experience —
analog-horror texture + editorial field-guide skeleton + interactive elements —
without breaking mood search, similar-films, collection, auth, or SEO.

## Where the original design went
Nowhere. **Nothing was ever committed.** Every change is an uncommitted working-tree
edit on top of the current HEAD; all new files are untracked.
- See the original of any file: `git diff <file>`
- Restore one file: `git checkout -- <file>`
- Full revert: `git restore .` then delete the untracked new files.

## Concept: "A Field Guide to Fear"
Three layers:
1. **Texture (analog horror)** — film grain, vignette, ambient light flicker, flashlight mode.
2. **Skeleton (editorial)** — bone/blood/ember palette, EB Garamond + Inter + Courier Prime,
   plate-numbered sections, archival mono stamps instead of solid chips.
3. **Interaction** — hero poster corridor, word flicker-in, typewriter search ritual,
   darkroom-develop results, hover vitals (scare/gore/dread), The Threshold game,
   easter eggs (Konami → lights out, 3am witching hour).

## What changed, file by file

### New files
| File | What it is |
|---|---|
| `atmo.css` / `atmo.js` | Shared atmosphere engine: grain, vignette, flicker, flashlight, Konami, witching hour |
| `threshold.html` | The Threshold — 60s interactive fear calibration: door (knock twice) → 5 questions → diagnosis (archetype + fingerprint) → 3 real film prescriptions. Procedural Web Audio, opt-in only |
| `AGENTS.md` | Repo working guide for agents |
| `docs/field-guide-design-system.md` | Design tokens + component patterns + backlog |
| `docs/redesign-summary.md` | This file |

### Modified
| File | Changes |
|---|---|
| `index.html` | New palette + Courier Prime; atmo includes; hero rebuilt (corridor strips, `FIELD Nº 136` eyebrow, word flicker-in, typewriter placeholder, Threshold link); nav +The Threshold +lights-out toggle; design-system CSS appended (cascade overrides); card vitals S/G/D on hover; plate section headers; footer colophon; additive JS only (develop-animation wrapper, search flicker, diagnosis chip, 3am copy). **All existing features preserved** |
| `scripts/build-movie-pages.mjs` | Template: new palette, Courier Prime, atmo includes, archival mono styles, plate h2s, serif blurbs, Threshold links in nav/footer, threshold added to sitemap |
| `movies/*.html` (136 + hub) | Regenerated from template (`npm run build:movies`) |
| `sitemap.xml` | Regenerated, 145 URLs |
| `lists/*.html` (5) | Migration: palette sync, Courier Prime, atmo layers, mono accents, nav (+Threshold +lights-out), footer flavor |
| `articles/douban-vs-imdb-horror-ratings.html` | Same treatment via movie-page chrome |
| `llms.txt` | Added The Threshold section |

### Not touched
`movies.js` (catalog data), `api/` (mood search), Supabase auth flow, `.env`,
og-image/icons, `.claude/`, `.superpowers/`.

## Bugs found & fixed during the pass
* Fingerprint bars invisible (`.fp-fill` was an inline span) → `display:block`.
* `.card-vitals` consumed layout space while invisible → broke mobile card overlays → `max-height: 0 → 20px` hover pattern.
* Mobile genre rail mono labels clipped (`PSYCHOLOGI C`) → 9px/1px spacing, 106px basis.

## Verify
```bash
npm run dev          # http://localhost:3460
npm run build:movies # regenerate film pages after template/catalog edits
```
Walk-through: `/` (hero, grid, hover vitals, modal, flashlight toggle in nav) →
`/threshold.html` (full playthrough) → `/movies/hereditary.html` → `/lists/best-a24-horror-films.html`.

## Handoff notes for other agents
1. Read `AGENTS.md` first, then `docs/field-guide-design-system.md`.
2. Never edit generated `movies/*.html` — edit `scripts/build-movie-pages.mjs` and regenerate.
3. `slugify()` must stay identical everywhere (clean apostrophes).
4. localStorage contract: `ws-diagnosis` (Threshold result → homepage chip), `ws-lights` (flashlight).
