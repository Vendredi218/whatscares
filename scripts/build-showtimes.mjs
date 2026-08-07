/**
 * Build /showtimes.html — horror playing on real screens near San Francisco.
 *
 * Leads with independent and repertory theatres, because that is where horror
 * actually plays: the multiplex chains programme it thinly and drop it fast,
 * while repertory houses run the older films this site's catalog is built from.
 * Titles are matched against movies.js, so anything in the catalog links through
 * to its own film page — the listing needs those links to be useful, which is
 * why they are worth having.
 *
 * IMAX 70mm follows as a second section. It is not horror, but it is the format
 * question people search hardest right now, and the seat-map finding underneath
 * it is genuinely ours.
 *
 *   node scripts/build-showtimes.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'showtimes.html');

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const read = p => existsSync(join(root, p)) ? JSON.parse(readFileSync(join(root, p), 'utf8')) : {};

const indie = Object.values(read('data/indie-screenings.json'));
const imax = Object.values(read('data/imax-screenings.json'));

const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dayOf = d => DAY[(new Date(d + 'T12:00:00').getDay() + 6) % 7];

/* ---------- group ---------- */
const byTitle = new Map();
for (const s of indie) {
  if (!byTitle.has(s.title)) byTitle.set(s.title, []);
  byTitle.get(s.title).push(s);
}
for (const arr of byTitle.values()) arr.sort((a, b) => (a.date + a.hhmm).localeCompare(b.date + b.hhmm));
const titles = [...byTitle.entries()].sort((a, b) => b[1].length - a[1].length);

const byVenue = new Map();
for (const s of imax) {
  if (!byVenue.has(s.theatre)) byVenue.set(s.theatre, []);
  byVenue.get(s.theatre).push(s);
}
const venues = [...byVenue.entries()].sort((a, b) => (a[1][0].miles ?? 999) - (b[1][0].miles ?? 999));

const indieScreens = new Set(indie.map(s => s.theatre)).size;
const linked = titles.filter(([, ss]) => ss[0].whatscares_slug).length;

/* ---------- structured data: what answer engines read for "playing near me" ---------- */
const events = [];
for (const [title, ss] of titles) {
  for (const s of ss.slice(0, 12)) {
    events.push({
      '@type': 'ScreeningEvent',
      name: `${title} at ${s.theatre}`,
      startDate: `${s.date}T${s.hhmm}:00-07:00`,
      eventStatus: 'https://schema.org/EventScheduled',
      workPresented: { '@type': 'Movie', name: title, genre: 'Horror' },
      location: {
        '@type': 'MovieTheater',
        name: s.theatre,
        address: { '@type': 'PostalAddress', addressRegion: 'CA', addressCountry: 'US' },
      },
      ...(s.ticket_url ? { offers: { '@type': 'Offer', url: s.ticket_url } } : {}),
    });
  }
}
const ld = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebPage',
      name: 'Horror on the Big Screen — Bay Area Showtimes',
      url: 'https://whatscares.com/showtimes.html',
      description: 'Horror playing at independent and repertory theatres near San Francisco, '
        + 'plus every IMAX 70mm showing, with real seat availability.',
      isPartOf: { '@type': 'WebSite', name: 'WhatScares', url: 'https://whatscares.com/' },
    },
    ...events,
  ],
};

const titleCard = ([title, ss]) => {
  const slug = ss[0].whatscares_slug;
  const theatres = [...new Set(ss.map(s => s.theatre))];
  const days = [...new Set(ss.map(s => s.date))].sort();
  const name = slug
    ? `<a class="film-link" href="/movies/${slug}.html">${esc(title)}</a>`
    : esc(title);
  const tags = (ss[0].tags || []).filter(Boolean);
  return `      <article class="show">
        <h3>${name}</h3>
        <p class="show-meta">${ss.length} screening${ss.length === 1 ? '' : 's'} ·
           ${theatres.map(esc).join(' · ')}</p>
        <p class="show-when">${days[0]} → ${days[days.length - 1]}${
    tags.length ? ` · <span class="tags">${tags.map(esc).join(', ')}</span>` : ''}</p>
        <ul class="times">
${ss.slice(0, 10).map(s => `          <li><span class="d">${dayOf(s.date)} ${s.date.slice(5)}</span>
            <span class="t">${esc(s.time)}</span>${
    s.sold_out ? '<span class="out">sold out</span>'
      : `<a href="${esc(s.ticket_url)}" rel="nofollow noopener" target="_blank">tickets</a>`}</li>`).join('\n')}
        </ul>${ss.length > 10 ? `<p class="more">+ ${ss.length - 10} more</p>` : ''}
      </article>`;
};

const venueRow = ([venue, ss]) => {
  const sold = ss.filter(s => s.sold_out).length;
  const days = [...new Set(ss.map(s => s.date))].sort();
  return `      <tr>
        <th scope="row">${esc(venue.replace(/ & IMAX$/, ''))}</th>
        <td>${ss[0].miles != null ? ss[0].miles + ' mi' : '—'}</td>
        <td>${ss.length}</td>
        <td>${ss.length - sold}</td>
        <td>${days[0].slice(5)} – ${days[days.length - 1].slice(5)}</td>
      </tr>`;
};

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Horror on the Big Screen — Bay Area Showtimes | WhatScares</title>
<meta name="description" content="Horror playing at independent and repertory theatres near San Francisco — ${indie.length} screenings across ${indieScreens} screens — plus every IMAX 70mm showing, with real seat availability read from the cinema's own seat map.">
<link rel="canonical" href="https://whatscares.com/showtimes.html">
<meta property="og:type" content="website">
<meta property="og:title" content="Horror on the Big Screen — Bay Area Showtimes">
<meta property="og:description" content="Where horror is actually playing near San Francisco: independent and repertory theatres first, then every IMAX 70mm screen.">
<meta property="og:url" content="https://whatscares.com/showtimes.html">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<style>
  :root{--bg:#e9e3d5;--surface:#f4f0e6;--surface-2:#dcd3c0;--border:#cdc2ab;
        --text:#191512;--text-2:#584f44;--text-3:#6b6153;--accent:#a82e22;--gold:#7d5c0d}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);
       font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,sans-serif}
  a{color:var(--accent)}
  .wrap{max-width:960px;margin:0 auto;padding:28px 20px 72px}
  .home{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--text-3);
        text-decoration:none}
  .home:hover{color:var(--accent)}
  .eyebrow{margin:26px 0 6px;font-size:12px;letter-spacing:.22em;text-transform:uppercase;
           color:var(--accent)}
  h1{margin:0 0 10px;font-family:Georgia,"Times New Roman",serif;font-weight:400;
     font-size:clamp(30px,5.5vw,48px);line-height:1.08;letter-spacing:-.01em;text-wrap:balance}
  h1 em{font-style:italic;color:var(--accent)}
  .lede{margin:0 0 4px;color:var(--text-2);max-width:62ch}
  h2{margin:44px 0 6px;font-family:Georgia,serif;font-weight:400;font-size:26px}
  .sec-note{margin:0 0 18px;color:var(--text-3);font-size:14px;max-width:64ch}
  .shows{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}
  .show{background:var(--surface);border:1px solid var(--border);border-radius:3px;padding:15px 16px}
  .show h3{margin:0 0 3px;font-family:Georgia,serif;font-weight:400;font-size:20px;line-height:1.2}
  .film-link{text-decoration:none;border-bottom:1px solid rgba(168,46,34,.35)}
  .film-link:hover{border-bottom-color:var(--accent)}
  .show-meta{margin:0;font-size:13px;color:var(--text-2)}
  .show-when{margin:2px 0 10px;font-size:12px;color:var(--text-3)}
  .tags{color:var(--gold)}
  .times{list-style:none;margin:0;padding:0;display:grid;gap:3px}
  .times li{display:flex;gap:9px;align-items:baseline;font-size:13px;
            border-top:1px solid var(--surface-2);padding-top:3px}
  .times .d{color:var(--text-3);min-width:64px}
  .times .t{font-variant-numeric:tabular-nums;min-width:62px}
  .times a{font-size:12px;text-decoration:none;border-bottom:1px solid rgba(168,46,34,.3)}
  .times .out{font-size:12px;color:var(--text-3)}
  .more{margin:8px 0 0;font-size:12px;color:var(--text-3)}
  table{width:100%;border-collapse:collapse;background:var(--surface);
        border:1px solid var(--border);font-size:14px}
  caption{text-align:left;font-size:13px;color:var(--text-3);padding-bottom:7px}
  th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--surface-2)}
  thead th{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--text-3);
           font-weight:400}
  tbody th{font-weight:600}
  tbody tr:last-child th,tbody tr:last-child td{border-bottom:0}
  .callout{background:var(--surface);border-left:3px solid var(--accent);
           padding:14px 16px;margin:18px 0;font-size:14px;color:var(--text-2)}
  .callout b{color:var(--text)}
  footer{margin-top:46px;padding-top:16px;border-top:1px solid var(--border);
         font-size:12.5px;color:var(--text-3);line-height:1.75}
</style>
</head>
<body>
<div class="wrap">
  <a class="home" href="/">← WhatScares</a>

  <p class="eyebrow">Bay Area · updated ${new Date().toISOString().slice(0, 10)}</p>
  <h1>Horror on the <em>big screen</em></h1>
  <p class="lede">Where horror is actually playing near San Francisco. Independent and
     repertory houses first, because that is where it plays — the chains programme
     horror thinly and drop it fast.</p>

  <h2>Independent &amp; repertory</h2>
  <p class="sec-note">${indie.length} horror screenings across ${indieScreens} screens.
     ${linked} title${linked === 1 ? '' : 's'} matched our catalog and link
     through to full ratings and streaming.</p>
  <div class="shows">
${titles.map(titleCard).join('\n')}
  </div>

  <h2>IMAX 70mm</h2>
  <p class="sec-note">Not horror — but it is the format question people ask hardest
     right now, and the answer is not what the ticket sites tell you.</p>
  <div class="callout"><b>“On sale” does not mean a seat is left.</b> IMAX flags a
     showing sold out only when literally every seat is gone, wheelchair spaces
     included. We read AMC Metreon's actual seat maps across 37 showings spanning a
     month: not one had two adjacent seats behind the front rows. The house reads as
     available and is effectively full.</div>
  <p class="sec-note" style="margin-bottom:14px"><a href="/seats.html"><strong>Open the seat
     finder →</strong></a> Paint the part of the room you'd sit in and it checks the real
     seat maps for a block that fits.</p>
  <table>
    <caption>The Odyssey · IMAX 70mm · within 150 miles</caption>
    <thead><tr><th>Theatre</th><th>Distance</th><th>Showings</th><th>On sale</th><th>Dates</th></tr></thead>
    <tbody>
${venues.map(venueRow).join('\n')}
    </tbody>
  </table>

  <footer>
    Independent listings from Alamo Drafthouse's public schedule; IMAX listings from
    IMAX's own showtime index. Horror is identified by matching titles against the
    WhatScares catalog plus a short list of current releases — anything unmatched is
    left out rather than guessed at, so this under-reports rather than misleads.<br>
    Showtimes are time-sensitive and accurate as of the date above. Ticket links go to
    the cinema.
  </footer>
</div>
</body>
</html>
`;

writeFileSync(OUT, html);
console.log(`showtimes.html written`);
console.log(`  indie horror : ${indie.length} screenings, ${titles.length} titles, ${indieScreens} screens`);
console.log(`  catalog links: ${linked}`);
console.log(`  imax 70mm    : ${imax.length} screenings, ${venues.length} venues`);
console.log(`  ScreeningEvent records: ${events.length}`);
console.log(`  ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
