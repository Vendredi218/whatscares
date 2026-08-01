// Generates static SEO pages: movies/{slug}.html for every film in movies.js,
// plus movies/index.html (hub) and a regenerated sitemap.xml.
// Run: npm run build:movies   (after editing movies.js or movie-blurbs.mjs)
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { BLURBS } from './movie-blurbs.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://whatscares.com';
const IMG = 'https://image.tmdb.org/t/p';
const TODAY = new Date().toISOString().slice(0, 10);
const LEGACY_LASTMOD = '2026-07-18'; // homepage + list pages, unchanged by this build

// ---------- data ----------
const source = readFileSync(join(root, 'movies.js'), 'utf8');
const match = source.match(/const M = \[([\s\S]*?)\n\];/);
if (!match) throw new Error('Could not find `const M = [...]` in movies.js');
const movies = new Function(`return [${match[1]}]`)();

const slugify = t => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/['’]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const bySlug = new Map();
for (const m of movies) {
  let s = slugify(m.t);
  if (bySlug.has(s)) s = `${s}-${m.y}`;
  if (bySlug.has(s)) throw new Error(`Slug collision: ${s}`);
  m.slug = s;
  bySlug.set(s, m);
}

const missing = movies.filter(m => !BLURBS[m.t]);
if (missing.length) throw new Error(`Missing blurbs for: ${missing.map(m => m.t).join(', ')}`);

// ---------- helpers ----------
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const jsonld = obj => JSON.stringify(obj).replace(/</g, '\\u003c');
const votes = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1000 ? Math.round(n / 1000) + 'k' : String(n);

const TAG_LABEL = {
  'a24': 'A24', 'j-horror': 'J-Horror', 'k-horror': 'K-Horror', 'hk-horror': 'HK / Taiwan',
  'body-horror': 'Body Horror', 'found-footage': 'Found Footage', 'slow-burn': 'Slow-Burn',
};
const label = tag => TAG_LABEL[tag] || tag.replace(/(^|-)(\w)/g, (_, sep, c) => (sep ? ' ' : '') + c.toUpperCase());

const TAG_LIST_PAGE = {
  'folk': ['best-folk-horror-movies.html', 'Best Folk Horror Movies'],
  'cosmic': ['best-cosmic-horror-movies.html', 'Best Cosmic Horror Movies'],
  'slow-burn': ['best-slow-burn-horror-movies.html', 'Best Slow-Burn Horror Movies'],
  'religious': ['best-religious-horror-movies.html', 'Best Religious Horror Movies'],
  'a24': ['best-a24-horror-films.html', 'Best A24 Horror Films'],
};

const SCARE_TEXT = {
  1: 'is mild by horror standards — more unsettling than outright scary',
  2: 'is on the gentler side — it favors mood and atmosphere over hard scares',
  3: 'is moderately scary, with a handful of strong sequences',
  4: 'is genuinely scary, with sustained tension and hard-hitting scares',
  5: 'is among the scariest films on WhatScares',
};
const GORE_TEXT = {
  1: 'almost no gore', 2: 'only light gore', 3: 'a moderate amount of blood and violence',
  4: 'heavy gore', 5: 'extreme gore — not for the squeamish',
};

const ten = v => (v * 2).toFixed(1);
const live = (dim, v) => `<span data-faq="${dim}">${ten(v)}</span>`;

function scareTail(m) {
  if (m.scare <= 3 && m.dread >= 5) return ' Expect little in the way of jump scares, but a sense of dread that builds steadily and lingers after the credits.';
  if (m.dread >= 5) return ' The dread keeps climbing even between the big moments.';
  return '';
}
// plain text -> JSON-LD (read before any script runs); html -> the page, where
// the figures get replaced by reader averages once they load
const scareAnswer = m => `On our intensity scale, ${m.t} rates ${ten(m.scare)}/10 for jump scares and ${ten(m.dread)}/10 for dread. It ${SCARE_TEXT[m.scare]}.${scareTail(m)}`;
const scareAnswerHTML = m => `On our intensity scale, ${esc(m.t)} rates ${live('jumps', m.scare)}/10 for jump scares and ${live('dread', m.dread)}/10 for dread. It ${SCARE_TEXT[m.scare]}.${scareTail(m)}`;
const goreAnswer = m => `${m.t} rates ${ten(m.gore)}/10 for gore — expect ${GORE_TEXT[m.gore]}.`;
const goreAnswerHTML = m => `${esc(m.t)} rates ${live('gore', m.gore)}/10 for gore — expect ${GORE_TEXT[m.gore]}.`;
const streamAnswer = m => m.str && m.str.length
  ? `As of our last update, ${m.t} is streaming on ${m.str.join(' and ')} in the US. Availability changes, so check your service before settling in.`
  : `${m.t} is not on major US subscription streamers right now — look for it on digital rental or purchase (Apple TV, Prime Video, or your usual store).`;

function similar(m) {
  return movies
    .filter(o => o !== m)
    .map(o => {
      const shared = o.tags.filter(t => m.tags.includes(t)).length;
      return { o, score: shared * 2 + (Math.abs(o.dread - m.dread) <= 1 ? 1 : 0) };
    })
    .filter(x => x.score >= 2)
    .sort((a, b) => b.score - a.score || (b.o.imdb || 0) - (a.o.imdb || 0))
    .slice(0, 6)
    .map(x => x.o);
}

function metaDesc(m) {
  const parts = [`${m.t} (${m.y}), directed by ${m.d}.`];
  const r = [];
  if (m.imdb) r.push(`IMDb ${m.imdb}`);
  if (m.rt) r.push(`RT ${m.rt}%`);
  if (m.db) r.push(`Douban ${m.db}`);
  if (r.length) parts.push(r.join(' · ') + '.');
  parts.push(`Scare ${m.scare}/5, gore ${m.gore}/5, dread ${m.dread}/5.`);
  if (m.str && m.str.length) parts.push(`Stream on ${m.str.slice(0, 2).join(', ')}.`);
  parts.push('How scary is it? Ratings + where to watch.');
  let out = '';
  for (const p of parts) {
    if ((out + ' ' + p).trim().length > 158) break;
    out = (out + ' ' + p).trim();
  }
  return out;
}

const dots = n => '<span class="dots"><b>' + '●'.repeat(n) + '</b>' + '○'.repeat(5 - n) + '</span>';

// Same blend as the homepage: every source normalised to 10 and averaged.
function movieScore(m) {
  const v = [m.imdb, m.rt != null ? m.rt / 10 : null, m.pc != null ? m.pc / 10 : null,
             m.mc != null ? m.mc / 10 : null, m.db].filter(x => x != null);
  return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : null;
}

function ratingChips(m) {
  const chips = [];
  if (m.imdb != null) chips.push(`<div class="chip"><span class="src imdb">IMDb</span><b>${m.imdb}</b>${m.iv ? `<i>${votes(m.iv)} votes</i>` : ''}</div>`);
  if (m.rt != null) chips.push(`<div class="chip"><span class="src rt">RT</span><b>${m.rt}%</b><i>critics</i></div>`);
  if (m.pc != null) chips.push(`<div class="chip"><span class="src pop">RT</span><b>${m.pc}%</b><i>audience</i></div>`);
  if (m.mc != null) chips.push(`<div class="chip"><span class="src mc">MC</span><b>${m.mc}</b><i>metascore</i></div>`);
  if (m.db != null) chips.push(`<div class="chip"><span class="src db">豆瓣</span><b>${m.db}</b>${m.dv ? `<i>${votes(m.dv)} votes</i>` : ''}</div>`);
  return chips.join('\n      ');
}

// ---------- shared page chrome ----------
const CSS = `
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{--bg: #e9e3d5;--surface: #f4f0e6;--surface-2: #dcd3c0;--border: #cdc2ab;--text: #191512;--text-2: #584f44;--text-3: #6b6153;--accent: #a82e22;--accent-2: #c4432f;--gold: #7d5c0d;--sans:'Inter',-apple-system,system-ui,sans-serif;--serif:'EB Garamond',Georgia,serif;--mono:'Courier Prime','Courier New',monospace;--dim-jumps:#775709;--dim-gore:#8e1f1a;--dim-dread:#3f4a4a;--chrome:rgba(238,233,222,0.90);--panel:rgba(244,240,230,0.92);--field:rgba(255,253,247,0.78);--hover:rgba(205,194,171,0.45);--radius:3px}
body{background:var(--bg);color:var(--text);font-family:var(--sans);font-weight:400;line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
.wrap{max-width:960px;margin:0 auto;padding:0 20px}
header.site{border-bottom:1px solid var(--border);padding:16px 0}
header.site .wrap{display:flex;align-items:center;justify-content:space-between}
.logo{font-family:var(--serif);font-size:22px;font-weight:600;letter-spacing:.5px;display:flex;align-items:center;gap:10px}
.logo em{color:var(--accent);font-style:italic}
.logo svg{height:26px;width:auto;display:block;flex:none}
nav.top a{color:var(--text-2);font-size: 15.5px;margin-left:20px;font-weight:700}
nav.top .lights{margin-left:20px;background:none;border:1px solid var(--border);color:var(--text-2);font:inherit;font-size: 13.5px;letter-spacing:.5px;padding:5px 11px;border-radius:999px;cursor:pointer}
nav.top .lights:hover{color:var(--text);border-color:var(--text-3)}
nav.top a:hover{color:var(--text)}
.crumbs{font-size: 14.5px;color:var(--text-3);margin:20px 0;font-weight:700}
.crumbs a{color:var(--text-2)}.crumbs a:hover{color:var(--text)}
.hero{display:grid;grid-template-columns:250px 1fr;gap:32px;margin-bottom:40px}
.poster img{width:100%;height:auto;aspect-ratio:2/3;object-fit:cover;border-radius:var(--radius);border:1px solid var(--border);display:block;background:var(--surface-2)}
h1{font-family:var(--serif);font-size:40px;font-weight:600;line-height:1.15;margin-bottom:6px}
.byline{color:var(--text-2);font-size: 16.5px;margin-bottom:14px;font-weight:700}
.tags{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px}
.tag{font-size: 13.5px;letter-spacing:.4px;padding:4px 10px;border:1px solid var(--border);border-radius:999px;color:var(--text-2);font-weight:700}
a.tag:hover{border-color:var(--accent);color:var(--text)}
.movie-score{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.movie-score .ms-label{font-family:var(--mono);font-size:12.5px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:var(--text-3)}
.movie-score .ms-num{font-family:var(--serif);font-size:34px;font-weight:600;line-height:1;color:var(--text);font-variant-numeric:tabular-nums}
.movie-score .ms-max{font-size:15px;color:var(--text-3)}
.movie-score .ms-src{font-size:13px;color:var(--text-3);margin-left:2px}
.chips{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:22px}
.chip{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:8px 12px;display:flex;align-items:baseline;gap:7px}
.chip .src{font-size: 13px;letter-spacing:.5px;color:var(--text-3);font-weight:700}
.chip .src.imdb{color:var(--gold)}.chip .src.rt{color:var(--accent)}.chip .src.pop{color:#d98e04}.chip .src.db{color:#2da44e}
.chip b{font-weight:600;font-size: 17px}
.chip i{font-style:normal;font-size: 13px;color:var(--text-3)}
.intensity{margin-bottom:22px}
.intensity .row{display:flex;align-items:center;gap:14px;margin-bottom:7px}
.intensity .lbl{font-family:var(--mono);font-size:12.5px;letter-spacing:1.4px;text-transform:uppercase;color:var(--text-3);font-weight:700;width:64px;flex:none}
.intensity .pips{display:flex;gap:7px}
.intensity .pip{width:18px;height:18px;border-radius:50%;border:1.5px solid var(--border);background:none;padding:0;cursor:pointer;transition:transform .12s,background .12s,border-color .12s}
[data-dim="jumps"] .pip.on{background:var(--dim-jumps);border-color:var(--dim-jumps)}
[data-dim="gore"]  .pip.on{background:var(--dim-gore);border-color:var(--dim-gore)}
[data-dim="dread"] .pip.on{background:var(--dim-dread);border-color:var(--dim-dread)}
[data-dim="jumps"] .lbl{color:var(--dim-jumps)}
[data-dim="gore"]  .lbl{color:var(--dim-gore)}
[data-dim="dread"] .lbl{color:var(--dim-dread)}
.intensity .row:hover .pip{border-color:var(--text-3)}
.intensity .pip:hover,.intensity .pip:focus-visible{transform:scale(1.22);border-color:var(--accent);outline:none}
.intensity .pip.mine{box-shadow:0 0 0 2px var(--bg),0 0 0 3.5px var(--gold)}
.intensity .agg{font-size:15.5px;color:var(--text-2);font-variant-numeric:tabular-nums}
.intensity .agg b{color:var(--text);font-weight:600;display:inline-block}
.intensity .agg b.bump{animation:pop .45s cubic-bezier(.2,1.6,.4,1)}
@keyframes pop{0%{transform:scale(1);color:var(--text)}40%{transform:scale(1.5);color:var(--accent)}100%{transform:scale(1);color:var(--text)}}
.rate-note{font-size:13.5px;color:var(--text-3);margin-top:10px}
.rate-note a{color:var(--gold);border-bottom:1px solid rgba(125,92,13,.35)}
@media (prefers-reduced-motion: reduce){.intensity .agg b.bump{animation:none}.intensity .pip{transition:none}}

/* Same watchlist / watched state as the home page, on the page you land on. */
.watch-actions{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:22px}
.wact{display:inline-flex;align-items:center;gap:7px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:8px 14px;font-family:inherit;font-size:15px;color:var(--text-2);cursor:pointer;transition:border-color .18s,color .18s,background .18s}
.wact:hover{border-color:var(--text-3);color:var(--text)}
.wact .ico{font-size:15px;line-height:1}
.wact.on-want{border-color:var(--accent);color:var(--accent);background:rgba(181,55,42,.08)}
.wact.on-seen{border-color:var(--gold);color:var(--gold);background:rgba(217,154,69,.1)}
.wact-note{font-size:13.5px;color:var(--text-3);align-self:center}

.intensity .row{display:flex;align-items:center;gap:12px;font-size: 15.5px;margin-bottom:4px}
.intensity .row span.lbl{width:60px;color:var(--text-2)}
.dots{letter-spacing:3px;color:var(--text-3);font-size: 14.5px}
.dots b{color:var(--accent);font-weight:400}
.stream{font-size: 15.5px;color:var(--text-2);margin-bottom:22px}
.stream b{color:var(--text);font-weight:500}
.trailer{display:inline-flex;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:8px 14px 8px 8px;font-size: 15.5px;color:var(--text-2)}
.trailer:hover{border-color:var(--accent);color:var(--text)}
.trailer img{width:80px;height:45px;object-fit:cover;border-radius:4px;display:block}
section{margin-bottom:44px}
h2{font-family:var(--serif);font-size:26px;font-weight:600;margin-bottom:14px}
.blurb p{font-size: 17.5px;line-height:1.75;color:var(--text);max-width:70ch}
.faq dt{font-weight:500;font-size: 17px;margin-top:18px;margin-bottom:6px}
.faq dd{color:var(--text-2);font-size: 16.5px;max-width:70ch}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:16px}
.grid a{display:block}
.grid img{width:100%;height:auto;aspect-ratio:2/3;object-fit:cover;border-radius:var(--radius);border:1px solid var(--border);display:block;background:var(--surface-2)}
.grid .t{font-size: 15px;margin-top:8px;line-height:1.35}
.grid .y{font-size: 13.5px;color:var(--text-3)}
.grid a:hover .t{color:var(--gold)}
.morelinks{display:flex;flex-wrap:wrap;gap:10px}
.morelinks a{border:1px solid var(--border);border-radius:999px;padding:7px 16px;font-size: 15px;color:var(--text-2)}
.morelinks a:hover{border-color:var(--accent);color:var(--text)}
footer.site{border-top:1px solid var(--border);padding:28px 0 40px;margin-top:20px;font-size: 14.5px;color:var(--text-3)}
footer.site a{color:var(--text-2);margin-right:16px}
footer.site a:hover{color:var(--text)}
footer.site .row{margin-bottom:10px}
.listrows{list-style:none}
.listrows li{border-bottom:1px solid var(--border)}
.listrows a{display:flex;align-items:center;gap:14px;padding:10px 0}
.listrows img{width:44px;height:66px;object-fit:cover;border-radius:4px;background:var(--surface-2);flex:none}
.listrows .t{font-size: 17px}
.listrows .meta{font-size: 14.5px;color:var(--text-3)}
.listrows .score{margin-left:auto;font-size: 15.5px;color:var(--gold);white-space:nowrap}
.listrows a:hover .t{color:var(--gold)}
.intro{color:var(--text-2);font-size: 17px;max-width:70ch;margin-bottom:28px}
@media(max-width:640px){
  .hero{grid-template-columns:1fr;gap:20px}
  .poster{max-width:220px}
  h1{font-size:30px}
  nav.top a{margin-left:14px;font-size: 14.5px}
}

/* field guide design system — appended overrides win the cascade */
::selection{background:rgba(181,55,42,.4);color:var(--text)}
::-webkit-scrollbar{width:10px}
::-webkit-scrollbar-track{background:var(--bg)}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:5px}
nav.top a{font-family:var(--mono);font-size: 12.5px;letter-spacing:1.4px;text-transform:uppercase;color:var(--text-3)}
nav.top a:hover{color:var(--text)}
nav.top a.threshold{color:var(--accent-2);border-bottom:1px dotted rgba(224,87,63,.55);padding-bottom:2px}
.crumbs{font-family:var(--mono);font-size: 12.5px;letter-spacing:1.1px;text-transform:uppercase}
h1{font-weight:500;letter-spacing:-.5px}
.byline{font-family:var(--mono);font-size: 13px;letter-spacing:1.1px;text-transform:uppercase;color:var(--text-3)}
.tag{font-family:var(--mono);font-size: 12.5px;letter-spacing:1.1px;text-transform:uppercase;border-radius:2px;padding:5px 11px}
.chip{border-radius:3px;background:var(--field)}
.chip .src{font-family:var(--mono);font-size: 12px;letter-spacing:1px;text-transform:uppercase}
.chip b{font-family:var(--mono);font-weight:700}
.chip i{font-family:var(--mono);font-size: 12px}
.intensity .row span.lbl{font-family:var(--mono);font-size: 12.5px;letter-spacing:1.4px;text-transform:uppercase;color:var(--text-3);width:64px}
.dots{font-size: 12px;letter-spacing:5px;color:#3a3226}
.dots b{color:var(--accent-2);text-shadow:0 0 8px rgba(224,87,63,.4)}
main{counter-reset:plate}
section h2{counter-increment:plate;font-weight:500;border-top:1px solid var(--border);padding-top:26px}
section h2::before{content:'PLATE ' counter(plate,upper-roman);display:block;font-family:var(--mono);font-size: 12.5px;letter-spacing:3.5px;color:var(--accent-2);margin-bottom:9px}
.blurb p{font-family:var(--serif);font-size:19.5px;line-height:1.7}
.trailer{border-radius:3px}
.trailer span{font-family:var(--mono);font-size: 12.5px;letter-spacing:1.4px;text-transform:uppercase}
.grid .t{font-size: 14.5px}
.grid .y{font-family:var(--mono);font-size: 12.5px}
.morelinks a{border-radius:2px;font-family:var(--mono);font-size: 12.5px;letter-spacing:1.1px;text-transform:uppercase}
footer.site{font-family:var(--mono);font-size: 12.5px;letter-spacing:1.1px;text-transform:uppercase}
footer.site .colophon{color:var(--text-3);letter-spacing:1.4px}
.listrows .meta{font-family:var(--mono);font-size: 12.5px}
.listrows .score{font-family:var(--mono)}
.poster img,.grid img{filter:saturate(.85) contrast(1.05)}
`;

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Inter:wght@300;400;500;600&family=Courier+Prime:wght@400;700&display=swap" rel="stylesheet">`;

const ATMO_HEAD = `<link rel="stylesheet" href="/atmo.css">
<script src="/atmo.js" defer></script>`;
const ATMO_BODY = `<div class="atmo" aria-hidden="true"><div class="flashlight" id="flashlight"></div><div class="vignette"></div><div class="flicker" id="flicker"></div><div class="grain" id="grain"></div></div>`;

const MARK_SVG = `<svg viewBox="18 10 28 50" fill="currentColor" aria-hidden="true"><path d="M20.2 29.5A13 13 0 1 1 39.5 34.6C36 37.2 34.4 41 34.3 46L29.3 46C29.6 41.2 32.4 36.6 34.9 31.9A8.5 8.5 0 1 0 22.3 28.5Z"/><circle cx="32" cy="54" r="5" fill="#c4352a"/></svg>`;

const headerHtml = `<header class="site"><div class="wrap">
<a class="logo" href="/">${MARK_SVG}What<em>Scares</em></a>
<nav class="top"><a href="/movies/">All Films</a><a href="/#collections">Lists</a><a href="/">Mood Search</a><a href="/find-your-fear.html" class="threshold">Find Your Fear</a><button class="lights" id="lightsBtn" type="button">&#9680; lights out</button></nav>
</div></header>`;

const footerHtml = `<footer class="site"><div class="wrap">
<div class="row colophon">WhatScares — a field guide to fear · printed in the dark</div>
<div class="row">
<a href="/">WhatScares</a><a href="/movies/">All 136 films</a><a href="/find-your-fear.html">Find Your Fear</a><a href="/articles/douban-vs-imdb-horror-ratings.html">Douban vs IMDb</a>
</div>
<div class="row">
<a href="/lists/best-a24-horror-films.html">A24 Horror</a><a href="/lists/best-folk-horror-movies.html">Folk Horror</a><a href="/lists/best-cosmic-horror-movies.html">Cosmic Horror</a><a href="/lists/best-slow-burn-horror-movies.html">Slow-Burn Horror</a><a href="/lists/best-religious-horror-movies.html">Religious Horror</a>
</div>
<div>Ratings shown are courtesy of their respective platforms. Intensity ratings (scare / gore / dread) are WhatScares editorial.</div>
</div></footer>`;

// ---------- movie page ----------
function moviePage(m) {
  const url = `${SITE}/movies/${m.slug}.html`;
  const poster = `${IMG}/w500${m.p}`;
  const posterSm = `${IMG}/w342${m.p}`;
  const blurb = BLURBS[m.t];
  const desc = metaDesc(m);
  const sims = similar(m);
  const listLinks = m.tags.filter(t => TAG_LIST_PAGE[t]).map(t => TAG_LIST_PAGE[t]);

  const movieLd = {
    '@context': 'https://schema.org', '@type': 'Movie',
    name: m.t, url, image: poster, datePublished: String(m.y),
    director: { '@type': 'Person', name: m.d },
    genre: m.tags.map(label), description: blurb,
  };
  if (m.imdb != null && m.iv) movieLd.aggregateRating = {
    '@type': 'AggregateRating', ratingValue: m.imdb, bestRating: 10, ratingCount: m.iv,
  };
  const crumbsLd = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'WhatScares', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'All Films', item: `${SITE}/movies/` },
      { '@type': 'ListItem', position: 3, name: m.t, item: url },
    ],
  };
  const faqLd = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: [
      { '@type': 'Question', name: `How scary is ${m.t}?`, acceptedAnswer: { '@type': 'Answer', text: scareAnswer(m) } },
      { '@type': 'Question', name: `How gory is ${m.t}?`, acceptedAnswer: { '@type': 'Answer', text: goreAnswer(m) } },
      { '@type': 'Question', name: `Where can I stream ${m.t}?`, acceptedAnswer: { '@type': 'Answer', text: streamAnswer(m) } },
    ],
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(m.t)} (${m.y}) — How Scary Is It? Ratings &amp; Where to Stream | WhatScares</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta property="og:type" content="video.movie">
<meta property="og:title" content="${esc(m.t)} (${m.y}) — Ratings &amp; Where to Stream">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${poster}">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="WhatScares">
<meta name="twitter:card" content="summary">
${FONTS}
${ATMO_HEAD}
<style>${CSS}</style>
<script type="application/ld+json">${jsonld(movieLd)}</script>
<script type="application/ld+json">${jsonld(crumbsLd)}</script>
<script type="application/ld+json">${jsonld(faqLd)}</script>
</head>
<body>
${ATMO_BODY}
${headerHtml}
<main class="wrap">
<nav class="crumbs"><a href="/">Home</a> / <a href="/movies/">All Films</a> / ${esc(m.t)}</nav>

<div class="hero">
  <div class="poster"><img src="${posterSm}" alt="${esc(m.t)} (${m.y}) poster" width="342" height="513" fetchpriority="high"></div>
  <div>
    <h1>${esc(m.t)}</h1>
    <p class="byline">${m.y} · Directed by ${esc(m.d)}</p>
    <div class="tags">${m.tags.map(t => TAG_LIST_PAGE[t]
      ? `<a class="tag" href="/lists/${TAG_LIST_PAGE[t][0]}">${esc(label(t))}</a>`
      : `<span class="tag">${esc(label(t))}</span>`).join('')}</div>
    ${movieScore(m) != null ? `<div class="movie-score">
      <span class="ms-label">Movie score</span>
      <span class="ms-num">${movieScore(m)}</span>
      <span class="ms-max">/ 10</span>
      <span class="ms-src">averaged across ${[m.imdb, m.rt, m.pc, m.mc, m.db].filter(x => x != null).length} sources</span>
    </div>` : ''}
    <div class="chips">
      ${ratingChips(m)}
    </div>
    <div class="intensity" data-idx="${m.idx}">
      ${[['jumps', m.scare], ['gore', m.gore], ['dread', m.dread]].map(([k, base]) => `<div class="row" data-dim="${k}" data-base="${base}">
        <span class="lbl">${k}</span>
        <span class="pips">${[1,2,3,4,5].map(n => `<button class="pip${n <= base ? ' on' : ''}" type="button" data-v="${n}" aria-label="Rate ${k} ${n} of 5"></button>`).join('')}</span>
        <span class="agg"><b>${base}.0</b></span>
      </div>`).join('')}
      <p class="rate-note" id="rateNote">Tap a dot to add your rating.</p>
    </div>
    <div class="watch-actions" data-idx="${m.idx}">
      <button class="wact" type="button" data-act="want" aria-pressed="false">
        <span class="ico">+</span><span class="lbl">Watchlist</span>
      </button>
      <button class="wact" type="button" data-act="seen" aria-pressed="false">
        <span class="ico">✓</span><span class="lbl">Watched?</span>
      </button>
      <span class="wact-note" id="wactNote"></span>
    </div>
    <p class="stream">${m.str && m.str.length
      ? `Streaming on <b>${m.str.map(esc).join(' · ')}</b> <span style="color:var(--text-3)">(US, subject to change)</span>`
      : `Not on major US streamers — check digital rental.`}</p>
    ${m.yt ? `<a class="trailer" href="https://www.youtube.com/watch?v=${m.yt}" target="_blank" rel="noopener"><img src="https://i.ytimg.com/vi/${m.yt}/mqdefault.jpg" alt="" loading="lazy" width="80" height="45"><span>▶&nbsp; Watch the trailer</span></a>` : ''}
  </div>
</div>

<section class="blurb">
  <h2>The vibe</h2>
  <p>${esc(blurb)}</p>
</section>

<section class="faq">
  <h2>Before you press play</h2>
  <dl>
    <dt>How scary is ${esc(m.t)}?</dt><dd>${scareAnswerHTML(m)}</dd>
    <dt>How gory is ${esc(m.t)}?</dt><dd>${goreAnswerHTML(m)}</dd>
    <dt>Where can I stream ${esc(m.t)}?</dt><dd>${esc(streamAnswer(m))}</dd>
  </dl>
</section>

${sims.length ? `<section>
  <h2>If ${esc(m.t)} got under your skin</h2>
  <div class="grid">
    ${sims.map(s => `<a href="/movies/${s.slug}.html"><img src="${IMG}/w185${s.p}" alt="${esc(s.t)} poster" loading="lazy" width="185" height="278"><div class="t">${esc(s.t)}</div><div class="y">${s.y}${s.imdb ? ` · ★ ${s.imdb}` : ''}</div></a>`).join('\n    ')}
  </div>
</section>` : ''}

<section>
  <h2>Keep exploring</h2>
  <div class="morelinks">
    ${listLinks.map(([file, name]) => `<a href="/lists/${file}">${esc(name)}</a>`).join('\n    ')}
    <a href="/movies/">Browse all 136 films</a>
    <a href="/">Search horror by mood</a>
  </div>
</section>
</main>
${footerHtml}
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<script>
(function () {
  var sb = window.supabase.createClient(
    'https://tkomadaiuhqgsnlixgtw.supabase.co',
    'sb_publishable_nmap6xPXEztMqK-wEmr3Bw_qpTO1KBJ');
  // Watchlist / watched share localStorage with the home page - same key, same
  // shape. The home page is where a signed-in visitor's collection syncs up to
  // Supabase, so writing locally here is enough; the next visit pushes it.
  var USER_KEY = 'whatscares_user';
  function loadColl() {
    try {
      var u = JSON.parse(localStorage.getItem(USER_KEY)) || {};
      u.want = u.want || []; u.seen = u.seen || [];
      u.ratings = u.ratings || {}; u.dimensionRatings = u.dimensionRatings || {};
      return u;
    } catch (err) { return { want: [], seen: [], ratings: {}, dimensionRatings: {} }; }
  }
  function saveColl(u) { try { localStorage.setItem(USER_KEY, JSON.stringify(u)); } catch (err) {} }

  var bar = document.querySelector('.watch-actions');
  var barIdx = bar ? +bar.dataset.idx : -1;
  var wnote = document.getElementById('wactNote');
  var WACT = {
    want: { on: 'On Watchlist', off: 'Watchlist', icoOn: '✓', icoOff: '+' },
    seen: { on: 'Watched', off: 'Watched?', icoOn: '✓', icoOff: '✓' }
  };

  function renderBar() {
    if (!bar) return;
    var u = loadColl();
    Array.prototype.forEach.call(bar.querySelectorAll('.wact'), function (b) {
      var k = b.dataset.act, on = u[k].indexOf(barIdx) !== -1;
      b.classList.toggle('on-' + k, on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.querySelector('.lbl').textContent = on ? WACT[k].on : WACT[k].off;
      b.querySelector('.ico').textContent = on ? WACT[k].icoOn : WACT[k].icoOff;
    });
  }

  // Returns whether anything changed, so a rating can file a film under
  // watched without also un-filing one that was already there.
  function applyColl(k, add) {
    if (!bar) return false;
    var u = loadColl(), list = u[k], other = u[k === 'want' ? 'seen' : 'want'];
    var i = list.indexOf(barIdx);
    if (add && i === -1) {
      list.push(barIdx);
      var j = other.indexOf(barIdx);
      if (j !== -1) other.splice(j, 1);
    } else if (!add && i !== -1) {
      list.splice(i, 1);
    } else { return false; }
    saveColl(u); renderBar(); return true;
  }

  if (bar) {
    Array.prototype.forEach.call(bar.querySelectorAll('.wact'), function (b) {
      b.addEventListener('click', function () {
        var k = b.dataset.act, add = loadColl()[k].indexOf(barIdx) === -1;
        applyColl(k, add);
        wnote.textContent = add
          ? (k === 'want' ? 'Saved to your watchlist.' : 'Filed under watched.')
          : 'Removed.';
      });
    });
    renderBar();
  }

  var box = document.querySelector('.intensity');
  if (!box) return;
  var idx = +box.dataset.idx, DIMS = ['jumps', 'gore', 'dread'];
  var note = document.getElementById('rateNote');
  var mine = {}, user = null, stats = null;

  function row(d) { return box.querySelector('[data-dim="' + d + '"]'); }
  function baseOf(d) { return +row(d).dataset.base; }

  // The dots show the score. Once real people have rated, the score IS their
  // mean; before that it is our own read. Your own pick gets a gold ring so it
  // stays distinguishable from the average.
  function render(d) {
    var avg = stats && stats[d + '_avg'] ? Number(stats[d + '_avg']) : baseOf(d);
    var pips = row(d).querySelectorAll('.pip');
    for (var i = 0; i < pips.length; i++) {
      var n = +pips[i].dataset.v;
      pips[i].classList.toggle('on', n <= Math.round(avg));
      pips[i].classList.toggle('mine', mine[d] === n);
    }
    var el = row(d).querySelector('.agg');
    var old = el.querySelector('b') ? el.querySelector('b').textContent : null;
    var shown = (avg * 2).toFixed(1);   // pips are 1-5, the figure reads /10
    var votes = stats && stats.votes;
    // the FAQ prose quotes the same figures; keep them from drifting
    document.querySelectorAll('[data-faq="' + d + '"]').forEach(function (n) { n.textContent = shown; });
    el.innerHTML = '<b>' + shown + '</b>' + (votes ? ' \u00b7 ' + votes + ' vote' + (votes === 1 ? '' : 's') : '');
    if (old && old !== shown) {
      var b = el.querySelector('b');
      b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
    }
  }
  function renderAll() { DIMS.forEach(render); }

  function loadStats() {
    return sb.from('movie_rating_stats').select('*').eq('movie_idx', idx)
      .maybeSingle().then(function (r) { stats = r.data; renderAll(); });
  }

  function save(dim, v) {
    var prev = Object.assign({}, mine);
    mine[dim] = v; render(dim);
    var payload = Object.assign({ user_id: user.id, movie_idx: idx }, mine);
    sb.from('user_ratings').upsert(payload, { onConflict: 'user_id,movie_idx' }).then(function (r) {
      if (r.error) {
        mine = prev; render(dim);
        note.textContent = 'Could not save that - try again.';
        return;
      }
      note.textContent = 'Saved. One rating per person; change it any time.';
      loadStats();
    });
  }

  function ensureUser() {
    if (user) return Promise.resolve(user);
    return sb.auth.signInAnonymously().then(function (r) {
      if (r.error) { note.textContent = 'Could not start a session - try again.'; return null; }
      user = r.data.user; return user;
    });
  }

  box.querySelectorAll('.pip').forEach(function (p) {
    p.addEventListener('click', function () {
      var dim = p.closest('.row').dataset.dim, v = +p.dataset.v;
      var prev = mine[dim] || 0;
      mine[dim] = v; render(dim);
      // Scoring a film is a statement that you have seen it.
      if (applyColl('seen', true) && wnote) wnote.textContent = 'Filed under watched.';
      ensureUser().then(function (u) {
        if (u) save(dim, v);
        else { if (prev) mine[dim] = prev; else delete mine[dim]; render(dim); }
      });
    });
  });

  loadStats();
  sb.auth.getSession().then(function (res) {
    user = res.data.session && res.data.session.user;
    if (!user) return;
    sb.from('user_ratings').select('jumps,gore,dread')
      .eq('user_id', user.id).eq('movie_idx', idx).maybeSingle().then(function (r) {
        if (!r.data) return;
        DIMS.forEach(function (d) { if (r.data[d]) mine[d] = r.data[d]; });
        renderAll();
        note.textContent = 'Your rating is ringed. Change it any time.';
      });
  });
})();
</script>
</body>
</html>
`;
}

// ---------- hub page ----------
function hubPage() {
  const sorted = [...movies].sort((a, b) => a.t.localeCompare(b.t));
  const listLd = {
    '@context': 'https://schema.org', '@type': 'ItemList',
    name: 'All Horror Films on WhatScares',
    numberOfItems: sorted.length,
    itemListElement: sorted.map((m, i) => ({
      '@type': 'ListItem', position: i + 1, name: `${m.t} (${m.y})`, url: `${SITE}/movies/${m.slug}.html`,
    })),
  };
  const desc = `Every horror film on WhatScares — ${movies.length} hand-picked movies with IMDb, Rotten Tomatoes and Douban ratings, scare/gore/dread intensity, and US streaming availability.`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>All ${movies.length} Horror Films — Ratings, Intensity &amp; Where to Stream | WhatScares</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE}/movies/">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta property="og:type" content="website">
<meta property="og:title" content="All ${movies.length} Horror Films on WhatScares">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${SITE}/og-image.png">
<meta property="og:url" content="${SITE}/movies/">
<meta property="og:site_name" content="WhatScares">
<meta name="twitter:card" content="summary">
${FONTS}
${ATMO_HEAD}
<style>${CSS}</style>
<script type="application/ld+json">${jsonld(listLd)}</script>
</head>
<body>
${ATMO_BODY}
${headerHtml}
<main class="wrap">
<nav class="crumbs"><a href="/">Home</a> / All Films</nav>
<h1>Every film in the guide</h1>
<p class="intro">${movies.length} horror films, hand-picked and intensity-rated. Each page shows IMDb, Rotten Tomatoes and Douban scores side by side, how scary / gory / dread-heavy it really is, and where to stream it in the US. Prefer to search by feeling? <a href="/" style="color:var(--gold)">Try mood search</a>.</p>
<ul class="listrows">
${sorted.map(m => `<li><a href="/movies/${m.slug}.html"><img src="${IMG}/w92${m.p}" alt="" loading="lazy" width="44" height="66"><span><span class="t">${esc(m.t)}</span> <span class="meta">${m.y} · ${esc(m.d)}</span></span>${m.imdb ? `<span class="score">★ ${m.imdb}</span>` : ''}</a></li>`).join('\n')}
</ul>
</main>
${footerHtml}
</body>
</html>
`;
}

// ---------- sitemap ----------
function sitemap() {
  const entry = (loc, lastmod, freq, pri) =>
    `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${freq}</changefreq>\n    <priority>${pri}</priority>\n  </url>`;
  const lists = [
    'best-a24-horror-films', 'best-folk-horror-movies', 'best-cosmic-horror-movies',
    'best-slow-burn-horror-movies', 'best-religious-horror-movies',
  ];
  const articles = ['douban-vs-imdb-horror-ratings'];
  const urls = [
    entry(`${SITE}/`, LEGACY_LASTMOD, 'weekly', '1.0'),
    entry(`${SITE}/find-your-fear.html`, TODAY, 'monthly', '0.7'),
    ...lists.map(l => entry(`${SITE}/lists/${l}.html`, LEGACY_LASTMOD, 'monthly', '0.8')),
    ...articles.map(a => entry(`${SITE}/articles/${a}.html`, TODAY, 'monthly', '0.7')),
    entry(`${SITE}/movies/`, TODAY, 'weekly', '0.8'),
    ...movies.map(m => entry(`${SITE}/movies/${m.slug}.html`, TODAY, 'monthly', '0.6')),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

// ---------- write ----------
mkdirSync(join(root, 'movies'), { recursive: true });
movies.forEach((m, i) => { m.idx = i; });
for (const m of movies) writeFileSync(join(root, 'movies', `${m.slug}.html`), moviePage(m));
writeFileSync(join(root, 'movies', 'index.html'), hubPage());
writeFileSync(join(root, 'sitemap.xml'), sitemap());
console.log(`Wrote ${movies.length} movie pages + movies/index.html + sitemap.xml (${sitemap().match(/<url>/g).length} URLs)`);
