// POST /api/mood-search  { query: string }  →  { matches: [{id, why}], beyond: [{title, year}] }
// The MiniMax key lives ONLY here (env var), never in client code.
import { moodSearch } from './_core.mjs';

export const maxDuration = 60;

// --- abuse guards (in-memory: per warm instance, resets on cold start — cheap first line of defense) ---
const RATE_LIMIT = 8;            // requests per IP per minute
const DAILY_CAP = 500;           // total requests per instance per day
const ipHits = new Map();        // ip -> [timestamps]
let dayCount = 0;
let dayStamp = new Date().toDateString();

const cache = new Map();         // normalized query -> {at, result}
const CACHE_TTL = 60 * 60 * 1000;
const CACHE_MAX = 300;

const ALLOWED_ORIGINS = [
  'https://whatscares.com',
  'https://www.whatscares.com',
  'http://localhost',
  'http://127.0.0.1',
];

function originAllowed(req) {
  const origin = req.headers.origin || req.headers.referer || '';
  if (!origin) return true; // same-origin fetches may omit Origin
  return ALLOWED_ORIGINS.some(o => origin.startsWith(o)) || /https:\/\/[\w-]+\.vercel\.app/.test(origin);
}

function rateLimited(ip) {
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter(t => now - t < 60_000);
  if (hits.length >= RATE_LIMIT) return true;
  hits.push(now);
  ipHits.set(ip, hits);
  if (ipHits.size > 5000) ipHits.clear(); // memory guard
  return false;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!originAllowed(req)) return res.status(403).json({ error: 'forbidden' });

  const today = new Date().toDateString();
  if (today !== dayStamp) { dayStamp = today; dayCount = 0; }
  if (++dayCount > DAILY_CAP) return res.status(429).json({ error: 'daily cap reached' });

  const ip = (req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  if (rateLimited(ip)) return res.status(429).json({ error: 'slow down' });

  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
  if (!query) return res.status(400).json({ error: 'query required' });
  if (query.length > 200) return res.status(400).json({ error: 'query too long (max 200 chars)' });

  const key = process.env.MINIMAX_API_KEY;
  if (!key) return res.status(503).json({ error: 'search not configured' });

  const cacheKey = query.toLowerCase();
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL) return res.status(200).json(hit.result);

  try {
    const { matches, beyond } = await moodSearch(query, key);
    const result = { matches, beyond };
    cache.set(cacheKey, { at: Date.now(), result });
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    return res.status(200).json(result);
  } catch (err) {
    console.error('mood-search failed:', err.message);
    return res.status(502).json({ error: 'search unavailable' });
  }
}
