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

function scareAnswer(m) {
  let a = `On our intensity scale, ${m.t} rates ${m.scare}/5 for scares and ${m.dread}/5 for dread. It ${SCARE_TEXT[m.scare]}.`;
  if (m.scare <= 3 && m.dread >= 5) a += ' Expect little in the way of jump scares, but a sense of dread that builds steadily and lingers after the credits.';
  else if (m.dread >= 5) a += ' The dread keeps climbing even between the big moments.';
  return a;
}
const goreAnswer = m => `${m.t} rates ${m.gore}/5 for gore — expect ${GORE_TEXT[m.gore]}.`;
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
:root{--bg:#0d0d0d;--surface:#141414;--surface-2:#1a1a1a;--border:#222;--text:#e5e5e5;--text-2:#999;--text-3:#555;--accent:#c4352a;--gold:#e2b616;--sans:'Inter',-apple-system,system-ui,sans-serif;--serif:'EB Garamond',Georgia,serif;--radius:6px}
body{background:var(--bg);color:var(--text);font-family:var(--sans);font-weight:300;line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
.wrap{max-width:960px;margin:0 auto;padding:0 20px}
header.site{border-bottom:1px solid var(--border);padding:16px 0}
header.site .wrap{display:flex;align-items:center;justify-content:space-between}
.logo{font-family:var(--serif);font-size:22px;font-weight:600;letter-spacing:.5px;display:flex;align-items:center;gap:10px}
.logo em{color:var(--accent);font-style:italic}
.logo svg{height:26px;width:auto;display:block;flex:none}
nav.top a{color:var(--text-2);font-size:14px;margin-left:20px}
nav.top a:hover{color:var(--text)}
.crumbs{font-size:13px;color:var(--text-3);margin:20px 0}
.crumbs a{color:var(--text-2)}.crumbs a:hover{color:var(--text)}
.hero{display:grid;grid-template-columns:250px 1fr;gap:32px;margin-bottom:40px}
.poster img{width:100%;border-radius:var(--radius);border:1px solid var(--border);display:block;background:var(--surface-2)}
h1{font-family:var(--serif);font-size:40px;font-weight:600;line-height:1.15;margin-bottom:6px}
.byline{color:var(--text-2);font-size:15px;margin-bottom:14px}
.tags{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px}
.tag{font-size:12px;letter-spacing:.4px;padding:4px 10px;border:1px solid var(--border);border-radius:999px;color:var(--text-2)}
a.tag:hover{border-color:var(--accent);color:var(--text)}
.chips{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:22px}
.chip{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:8px 12px;display:flex;align-items:baseline;gap:7px}
.chip .src{font-size:11px;letter-spacing:.5px;color:var(--text-3);font-weight:500}
.chip .src.imdb{color:var(--gold)}.chip .src.rt{color:var(--accent)}.chip .src.pop{color:#d98e04}.chip .src.db{color:#2da44e}
.chip b{font-weight:600;font-size:16px}
.chip i{font-style:normal;font-size:11px;color:var(--text-3)}
.intensity{margin-bottom:22px}
.intensity .row{display:flex;align-items:center;gap:12px;font-size:14px;margin-bottom:4px}
.intensity .row span.lbl{width:60px;color:var(--text-2)}
.dots{letter-spacing:3px;color:var(--text-3);font-size:13px}
.dots b{color:var(--accent);font-weight:400}
.stream{font-size:14px;color:var(--text-2);margin-bottom:22px}
.stream b{color:var(--text);font-weight:500}
.trailer{display:inline-flex;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:8px 14px 8px 8px;font-size:14px;color:var(--text-2)}
.trailer:hover{border-color:var(--accent);color:var(--text)}
.trailer img{width:80px;height:45px;object-fit:cover;border-radius:4px;display:block}
section{margin-bottom:44px}
h2{font-family:var(--serif);font-size:26px;font-weight:600;margin-bottom:14px}
.blurb p{font-size:16.5px;line-height:1.75;color:var(--text);max-width:70ch}
.faq dt{font-weight:500;font-size:16px;margin-top:18px;margin-bottom:6px}
.faq dd{color:var(--text-2);font-size:15px;max-width:70ch}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:16px}
.grid a{display:block}
.grid img{width:100%;aspect-ratio:2/3;object-fit:cover;border-radius:var(--radius);border:1px solid var(--border);display:block;background:var(--surface-2)}
.grid .t{font-size:13.5px;margin-top:8px;line-height:1.35}
.grid .y{font-size:12px;color:var(--text-3)}
.grid a:hover .t{color:var(--gold)}
.morelinks{display:flex;flex-wrap:wrap;gap:10px}
.morelinks a{border:1px solid var(--border);border-radius:999px;padding:7px 16px;font-size:13.5px;color:var(--text-2)}
.morelinks a:hover{border-color:var(--accent);color:var(--text)}
footer.site{border-top:1px solid var(--border);padding:28px 0 40px;margin-top:20px;font-size:13px;color:var(--text-3)}
footer.site a{color:var(--text-2);margin-right:16px}
footer.site a:hover{color:var(--text)}
footer.site .row{margin-bottom:10px}
.listrows{list-style:none}
.listrows li{border-bottom:1px solid var(--border)}
.listrows a{display:flex;align-items:center;gap:14px;padding:10px 0}
.listrows img{width:44px;height:66px;object-fit:cover;border-radius:4px;background:var(--surface-2);flex:none}
.listrows .t{font-size:15.5px}
.listrows .meta{font-size:13px;color:var(--text-3)}
.listrows .score{margin-left:auto;font-size:14px;color:var(--gold);white-space:nowrap}
.listrows a:hover .t{color:var(--gold)}
.intro{color:var(--text-2);font-size:15.5px;max-width:70ch;margin-bottom:28px}
@media(max-width:640px){
  .hero{grid-template-columns:1fr;gap:20px}
  .poster{max-width:220px}
  h1{font-size:30px}
  nav.top a{margin-left:14px;font-size:13px}
}
`;

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">`;

const MARK_SVG = `<svg viewBox="18 10 28 50" fill="currentColor" aria-hidden="true"><path d="M20.2 29.5A13 13 0 1 1 39.5 34.6C36 37.2 34.4 41 34.3 46L29.3 46C29.6 41.2 32.4 36.6 34.9 31.9A8.5 8.5 0 1 0 22.3 28.5Z"/><circle cx="32" cy="54" r="5" fill="#c4352a"/></svg>`;

const headerHtml = `<header class="site"><div class="wrap">
<a class="logo" href="/">${MARK_SVG}What<em>Scares</em></a>
<nav class="top"><a href="/movies/">All Films</a><a href="/#collections">Lists</a><a href="/">Mood Search</a></nav>
</div></header>`;

const footerHtml = `<footer class="site"><div class="wrap">
<div class="row">
<a href="/">WhatScares</a><a href="/movies/">All 136 films</a><a href="/articles/douban-vs-imdb-horror-ratings.html">Douban vs IMDb</a>
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
<style>${CSS}</style>
<script type="application/ld+json">${jsonld(movieLd)}</script>
<script type="application/ld+json">${jsonld(crumbsLd)}</script>
<script type="application/ld+json">${jsonld(faqLd)}</script>
</head>
<body>
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
    <div class="chips">
      ${ratingChips(m)}
    </div>
    <div class="intensity">
      <div class="row"><span class="lbl">Scare</span>${dots(m.scare)}</div>
      <div class="row"><span class="lbl">Gore</span>${dots(m.gore)}</div>
      <div class="row"><span class="lbl">Dread</span>${dots(m.dread)}</div>
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
    <dt>How scary is ${esc(m.t)}?</dt><dd>${esc(scareAnswer(m))}</dd>
    <dt>How gory is ${esc(m.t)}?</dt><dd>${esc(goreAnswer(m))}</dd>
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
<style>${CSS}</style>
<script type="application/ld+json">${jsonld(listLd)}</script>
</head>
<body>
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
    ...lists.map(l => entry(`${SITE}/lists/${l}.html`, LEGACY_LASTMOD, 'monthly', '0.8')),
    ...articles.map(a => entry(`${SITE}/articles/${a}.html`, TODAY, 'monthly', '0.7')),
    entry(`${SITE}/movies/`, TODAY, 'weekly', '0.8'),
    ...movies.map(m => entry(`${SITE}/movies/${m.slug}.html`, TODAY, 'monthly', '0.6')),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

// ---------- write ----------
mkdirSync(join(root, 'movies'), { recursive: true });
for (const m of movies) writeFileSync(join(root, 'movies', `${m.slug}.html`), moviePage(m));
writeFileSync(join(root, 'movies', 'index.html'), hubPage());
writeFileSync(join(root, 'sitemap.xml'), sitemap());
console.log(`Wrote ${movies.length} movie pages + movies/index.html + sitemap.xml (${sitemap().match(/<url>/g).length} URLs)`);
