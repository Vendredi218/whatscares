// Local dev server: static files + /api/mood-search, mirroring the Vercel setup.
// Usage: node dev-server.mjs   (PORT env respected; reads .env for MINIMAX_API_KEY)
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { dirname, extname, join, normalize } from 'path';
import { fileURLToPath } from 'url';

// Serve the checkout this file lives in, not the shell's cwd — otherwise a git
// worktree preview silently serves the main checkout instead.
const ROOT = dirname(fileURLToPath(import.meta.url));

// minimal .env loader
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const { moodSearch } = await import('./api/_core.mjs');

const PORT = process.env.PORT || 3460;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.xml': 'application/xml', '.txt': 'text/plain',
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/mood-search') {
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    let body = '';
    req.on('data', c => { body += c; if (body.length > 10_000) req.destroy(); });
    req.on('end', async () => {
      try {
        const { query } = JSON.parse(body || '{}');
        if (typeof query !== 'string' || !query.trim() || query.length > 200) {
          res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'bad query' }));
          return;
        }
        const key = process.env.MINIMAX_API_KEY;
        if (!key) {
          res.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'no key' }));
          return;
        }
        const t0 = Date.now();
        const { matches, beyond } = await moodSearch(query.trim(), key);
        console.log(`[mood-search] "${query.trim()}" → ${matches.length} matches in ${Date.now() - t0}ms`);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ matches, beyond }));
      } catch (err) {
        console.error('[mood-search] error:', err.message);
        res.writeHead(502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'search unavailable' }));
      }
    });
    return;
  }

  // static files
  let path = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
  if (path === '/' || path === '\\') path = '/index.html';
  else if (path.endsWith('/')) path += 'index.html'; // directory URLs, like Vercel
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' }).end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, () => console.log(`dev server → http://localhost:${PORT}`));
