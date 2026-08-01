# Field Guide Design System

WhatScares' visual identity: **an analog horror archive** — a 16mm film projected in a dark room,
catalogued like a 19th-century field guide. Editorial restraint (MOMA/New Yorker) on the surface,
instability underneath.

## Tokens

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0c0a08` | warm near-black page bg |
| `--surface` / `--surface-2` | `#161310` / `#1e1a15` | panels, cards |
| `--border` | `#2b251d` | warm hairlines |
| `--text` | `#ece4d2` | bone white |
| `--text-2` / `--text-3` | `#a79c86` / `#6f6655` | aged/dim |
| `--accent` | `#b5372a` | blood — primary accent, fills |
| `--accent-2` | `#e0573f` | bright blood — text/icons on dark, glows |
| `--gold` | `#d99a45` | sodium-lamp ember — gore vitals, match %, stamps |

Fonts: `EB Garamond` (serif display + editorial copy), `Inter` (UI sans), `Courier Prime` (`--mono`,
all labels/metadata — uppercase, letter-spaced). Rule: fear-data (scare/dread) is blood, gore is ember.

## Atmosphere layers (`atmo.css` + `atmo.js`)

Include in any page:
```html
<link rel="stylesheet" href="/atmo.css">
<script src="/atmo.js" defer></script>
<!-- after <body> -->
<div class="atmo" aria-hidden="true">
  <div class="flashlight" id="flashlight"></div>  <!-- optional -->
  <div class="vignette"></div>
  <div class="flicker" id="flicker"></div>
  <div class="grain" id="grain"></div>
</div>
```
- **grain**: JS-painted noise tile, `steps()` jitter, `opacity .07`, z-index 450 (above everything, like a camera artifact).
- **vignette**: permanent dark corners, z-155.
- **flicker**: JS-scheduled opacity pulses every 9–26s (sometimes double-blink), z-400. Public: `window.atmoBurst(n)`.
- **flashlight**: lights-out mode. `body.lights-out` + radial mask at `--lx/--ly` cursor vars, z-150 (below modals — modals float above darkness, correct).
  Toggle via `window.toggleLights()`; persists in `localStorage['ws-lights']`.
- Easter eggs in atmo.js: Konami code → lights out + burst; 3am local time → `body.witching`.

All motion must check `prefers-reduced-motion` (CSS media query + JS guard).

## Component patterns

- **Plate headers**: CSS `counter(plate, upper-roman)` on `.section-head h2::before` (index) and `section h2::before` (film pages). Hidden blocks don't increment.
- **Card vitals**: `.card-vitals` — S/G/D micro-bars revealed on hover with zero layout cost (`max-height: 0 → 20px`). Builder: `vitalHTML(label, val, ember)`.
- **Archival chips**: bordered mono stamps, not solid fills (`.card-tag`, `.gem-badge` rotated -2.5deg).
- **Darkroom develop**: `renderGrid` wrapper re-flows `#grid .card` from `blur(10px) brightness(.35)`.
- **Hero corridor**: two counter-drifting poster strips, `brightness(.2) saturate(.6)`, radial center-darkening mask for text legibility.
- **Typewriter placeholder**: rotates mood suggestions into `placeholder` when input idle/unfocused.

## The Threshold (`threshold.html`)

Door (knock twice) → 5 questions (tag-weighted binary choices) → diagnosis.
- Archetype resolution: first-match-wins over ordered rules in `ARCHETYPES` (grief → folk → found-footage → dolls → religious → cosmic → body+psych → body/gore → psych → supernatural → default).
- Recommendations: tag-weight sum over `M`, director dedup, top 3, `match %` relative to top score.
- Result contract: `localStorage['ws-diagnosis'] = { archetype, file, top, weights, slugs, ts }` — index hero reads this to render the "diagnosed" chip. Keep the shape stable.
- Sound: procedural Web Audio (sine drone + noise-burst knock), opt-in only, no assets.

## Backlog (ideas, not commitments)

- Per-genre specimen illustrations (SVG line art: moth, mycelium, roots) for the rail.
- First-visit entry ritual gating the homepage.
- Refresh `og-image.png` / `apple-touch-icon.png` to match the new identity.
- Bespoke plate treatment for `lists/*.html` (currently light pass only).
