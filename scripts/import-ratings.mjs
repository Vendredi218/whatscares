// Imports off-platform collected ratings from ratings-import.csv into Supabase.
// Needs the service-role key (never ship this to the browser):
//   SUPABASE_SERVICE_KEY=... node scripts/import-ratings.mjs [--dry]
//
// CSV: one row per vote. Repeat a movie_idx once per person who rated it.
// Blank score cells are skipped, so a rater who only scored "jumps" is fine.
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_ = 'https://tkomadaiuhqgsnlixgtw.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_KEY;
const DRY = process.argv.includes('--dry');

if (!KEY && !DRY) {
  console.error('Set SUPABASE_SERVICE_KEY (Dashboard → Project Settings → API → service_role).');
  console.error('Or run with --dry to validate the CSV without writing anything.');
  process.exit(1);
}

const src = readFileSync(join(root, 'movies.js'), 'utf8');
const M = new Function(`return [${src.match(/const M = \[([\s\S]*?)\n\];/)[1]}]`)();

const lines = readFileSync(join(root, 'ratings-import.csv'), 'utf8').trim().split('\n').slice(1);
const rows = [], problems = [];

lines.forEach((line, n) => {
  // title may be quoted and contain commas
  const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map(c => c.replace(/,$/, '').replace(/^"|"$/g, '').trim());
  const [idxRaw, title, jumps, gore, dread] = cells;
  if (!jumps && !gore && !dread) return;               // not yet filled in

  const idx = Number(idxRaw);
  if (!Number.isInteger(idx) || !M[idx]) { problems.push(`line ${n + 2}: bad movie_idx "${idxRaw}"`); return; }
  if (title && M[idx].t !== title) problems.push(`line ${n + 2}: title "${title}" != catalog "${M[idx].t}"`);

  const score = (v, name) => {
    if (v === '' || v == null) return null;
    const x = Number(v);
    if (!Number.isInteger(x) || x < 1 || x > 5) { problems.push(`line ${n + 2}: ${name}="${v}" must be 1-5`); return null; }
    return x;
  };
  const row = { movie_idx: idx, source: 'offline', user_id: null,
                jumps: score(jumps, 'jumps'), gore: score(gore, 'gore'), dread: score(dread, 'dread') };
  if (row.jumps || row.gore || row.dread) rows.push(row);
});

if (problems.length) {
  console.error(`${problems.length} problem(s):`);
  problems.slice(0, 20).forEach(p => console.error('  ' + p));
  process.exit(1);
}

const films = new Set(rows.map(r => r.movie_idx));
console.log(`${rows.length} votes across ${films.size} films`);
if (DRY) { console.log('--dry: nothing written.'); process.exit(0); }

const res = await fetch(`${URL_}/rest/v1/user_ratings`, {
  method: 'POST',
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`,
             'Content-Type': 'application/json', Prefer: 'return=minimal' },
  body: JSON.stringify(rows),
});
if (!res.ok) { console.error(`insert failed ${res.status}: ${await res.text()}`); process.exit(1); }
console.log(`Inserted ${rows.length} rows. Check: select * from movie_rating_stats order by votes desc limit 5;`);
