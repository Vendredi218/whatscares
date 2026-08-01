// Pings IndexNow (Bing / Yandex / Naver ecosystem) with every URL in sitemap.xml.
// Run after each deploy: npm run seo:ping
// Docs: https://www.indexnow.org/documentation
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = 'whatscares.com';
const KEY = '8bc8a508da8d97adc6e56be460b34727';

const sitemap = readFileSync(join(root, 'sitemap.xml'), 'utf8');
const urlList = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]);
if (!urlList.length) throw new Error('No URLs found in sitemap.xml');

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({
    host: HOST,
    key: KEY,
    keyLocation: `https://${HOST}/${KEY}.txt`,
    urlList,
  }),
});

// 200 = submitted, 202 = accepted (key will be verified later). Anything else is a problem.
console.log(`IndexNow: submitted ${urlList.length} URLs → HTTP ${res.status} ${res.statusText}`);
if (res.status !== 200 && res.status !== 202) {
  console.error(await res.text());
  process.exit(1);
}
