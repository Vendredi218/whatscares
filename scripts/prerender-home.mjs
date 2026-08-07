/**
 * Inject the catalog into index.html as static HTML.
 *
 * The homepage renders every film client-side, so the served document contains
 * an empty <div id="grid"></div> and not one link to any of the 136 film pages.
 * Crawlers that do not run JS — which includes Bingbot most of the time, and
 * every LLM fetcher — see a page with no catalog and no internal links, so the
 * film pages have to be discovered from the sitemap alone and the homepage
 * passes no internal link equity at all.
 *
 * This writes the same cards into the document at build time. renderGrid()
 * overwrites them on first paint, so behaviour is unchanged for real users;
 * the static copy exists purely for whatever does not execute JavaScript.
 *
 * Idempotent: re-running replaces the previously injected block.
 *
 *   node scripts/prerender-home.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = join(root, 'index.html');

const START = '<!-- prerender:grid:start -->';
const END = '<!-- prerender:grid:end -->';

/* Same slug rules as build-movie-pages.mjs, collision handling included —
   these links must resolve to the pages that script actually writes. */
const slugify = t => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/['’]/g, '').replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function loadMovies() {
  const src = readFileSync(join(root, 'movies.js'), 'utf8');
  const start = src.indexOf('[');
  const end = src.lastIndexOf(']');
  if (start < 0 || end < 0) throw new Error('movies.js: could not locate the array');
  return new Function(`return ${src.slice(start, end + 1)}`)();
}

function tmdbBase() {
  const html = readFileSync(INDEX, 'utf8');
  const m = html.match(/const TMDB\s*=\s*['"]([^'"]+)['"]/);
  if (!m) throw new Error('index.html: could not find the TMDB image base');
  return m[1];
}

const movieScore = m => {
  const v = [m.imdb, m.rt != null ? m.rt / 10 : null, m.pc != null ? m.pc / 10 : null,
             m.mc != null ? m.mc / 10 : null, m.db].filter(x => x != null);
  return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : null;
};
const intensityScore = m => ((m.scare + m.gore + m.dread) / 3 * 2).toFixed(1);
const vital = (label, val, dim) =>
  `<span class="vital"><span class="vital-label">${label}</span>` +
  Array.from({ length: 5 }, (_, i) => `<i class="${dim}${i < val ? ' on' : ''}"></i>`).join('') +
  `</span>`;

/* Mirrors cardHTML() minus the action buttons, which depend on per-user state
   that only exists once JS runs. Everything a crawler needs is here: the link,
   the title, the credits, the tags and the scores. */
function card(m, slug, TMDB) {
  const tag = m.tags[0];
  const stream = m.str && m.str.length ? m.str.slice(0, 2).join(' · ') : '';
  const ms = movieScore(m);
  return `<div class="card-wrap">
  <a class="card" href="/movies/${slug}.html">
    <div class="poster">
      <img src="${TMDB}${m.p}" alt="${esc(m.t)}" loading="lazy" width="300" height="450">
      <span class="card-tag">${esc(tag)}</span>
      ${m.obscure ? '<div class="gem-badge">Hidden Gem</div>' : ''}
    </div>
    <div class="card-overlay">
      <div class="card-vitals">${vital('J', m.scare, 'j')}${vital('G', m.gore, 'g')}${vital('D', m.dread, 'd')}${
        stream ? `<span class="card-stream">${esc(stream)}</span>` : ''}</div>
      <div class="title">${esc(m.t)}</div>
      <div class="meta">${m.y}<span class="meta-more"> · ${esc(tag)}</span> · ${esc(m.d)}${
        m.obscure ? '<span class="meta-more"> · Hidden Gem</span>' : ''}</div>
      <div class="card-ratings">
        ${ms != null ? `<span class="cr"><i>Movie</i><b>${ms}</b></span>` : ''}
        <span class="cr int"><i>Intensity</i><b>${intensityScore(m)}</b></span>
      </div>
    </div>
  </a>
</div>`;
}

const movies = loadMovies();
const TMDB = tmdbBase();

const seen = new Set();
const slugs = movies.map(m => {
  let s = slugify(m.t);
  if (seen.has(s)) s = `${s}-${m.y}`;
  if (seen.has(s)) throw new Error(`Slug collision: ${s}`);
  seen.add(s);
  return s;
});

const block = [START, ...movies.map((m, i) => card(m, slugs[i], TMDB)), END].join('\n');

let html = readFileSync(INDEX, 'utf8');

const already = html.indexOf(START);
if (already >= 0) {
  const tail = html.indexOf(END);
  if (tail < 0) throw new Error('index.html: start marker present without its end marker');
  html = html.slice(0, already) + block + html.slice(tail + END.length);
} else {
  const empty = '<div class="grid" id="grid"></div>';
  if (!html.includes(empty)) {
    throw new Error('index.html: could not find the empty grid container to fill');
  }
  html = html.replace(empty, `<div class="grid" id="grid">\n${block}\n</div>`);
}

writeFileSync(INDEX, html);

const links = (html.match(/href="\/movies\/[a-z0-9-]+\.html"/g) || []).length;
console.log(`prerendered ${movies.length} films into index.html`);
console.log(`  film links now in served HTML: ${links}`);
console.log(`  index.html: ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
