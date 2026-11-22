// Checks the shoe claims in data/2026-11-22-race-results.csv against their sources, from a home connection (most
// running-press sites refuse cloud visitors). Each source page is fetched once, as plain HTML; a claim passes when the
// page names both the athlete (surname) and the brand. Passing claims get shoe_checked_on set in the CSV; the rest are
// listed for a person to look at (pages that need scripts, such as posts on x.com, always land there).
//   npm run check-shoe-sources                  then commit data/2026-11-22-race-results.csv and the report
// It only reads public pages, one at a time with a pause between them.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseCsv, toCsv } from '../src/2026-11-21-csv.js';
import { claimFound } from '../src/2026-11-22-races.js';

const file = new URL('../data/2026-11-22-race-results.csv', import.meta.url);
const text = readFileSync(file, 'utf8');
const cols = text.split(/\r?\n/, 1)[0].split(',');
const rows = parseCsv(text);
const HEADERS = { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36', 'accept': 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.9' };
const today = new Date().toISOString().slice(0, 10);
const pages = new Map();
const todo = [...new Set(rows.filter(r => r.brand && r.shoe_source_url && !r.shoe_checked_on).map(r => r.shoe_source_url))];
console.log(`${todo.length} source pages to read`);
for (const url of todo) {
  await new Promise(r => setTimeout(r, 1500));
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    const html = await res.text();
    pages.set(url, { status: res.status, html });
    console.log(res.status, url);
  } catch (e) { pages.set(url, { status: 'error', html: '' }); console.log('error', url, String(e.message || e).slice(0, 60)); }
}
const report = [];
for (const r of rows) {
  if (!r.brand || !r.shoe_source_url || r.shoe_checked_on) continue;
  const p = pages.get(r.shoe_source_url) || { status: 'not read', html: '' };
  const ok = p.status === 200 && claimFound(p.html, r.athlete, r.brand);
  if (ok) r.shoe_checked_on = today;
  report.push({ race: `${r.race} ${r.year} ${r.gender} ${r.place}`, athlete: r.athlete, brand: r.brand, url: r.shoe_source_url, status: p.status, result: ok ? 'checked' : 'needs a look' });
}
writeFileSync(file, toCsv(rows, cols));
writeFileSync(new URL('../data/2026-11-22-shoe-source-checks.json', import.meta.url), JSON.stringify({ checked_at: new Date().toISOString(), report }, null, 1));
const n = report.filter(x => x.result === 'checked').length;
console.log(`\n${n} of ${report.length} shoe claims confirmed on their source page. The rest are in data/2026-11-22-shoe-source-checks.json.`);
