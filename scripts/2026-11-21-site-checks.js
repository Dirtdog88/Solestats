// The Shoppable by AI checks a script can do, run from a normal home connection (Alex, 2026-11-21: content checks
// from home, path to cart from the cloud). For each brand: robots.txt for the four AI crawlers, the product pages of
// the spec-sheet models found through the site's sitemaps, read as a crawler reads them (plain HTML, no scripts),
// returns and shipping within two links, need pages and a store locator. It writes evidence and draft verdicts to
// data/rounds/<round>/site-checks.auto.json; a person reviews them before they go into site-checks.jsonl. It also
// keeps the spec text of each product page, for drafting the spec sheet. It never logs in, adds to a cart or buys.
//
//   npm run site-checks -- --round 2026-11                 every brand (about 15 minutes), on a PC
//   npm run site-checks -- --round 2026-11 --brands nike,on
//   In a cloud session: NODE_USE_ENV_PROXY=1 npm run site-checks -- ...
//
// Polite: one request at a time per site, a pause between requests, at most about 45 requests per brand.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseCsv } from '../src/2026-11-21-csv.js';
import { AI_AGENTS, sitemapRank, usVersion, parseRobots, robotsAllows, parseSitemap, productUrlsFor, readPage, productEvidence, TOPIC, needPages, majority } from '../src/2026-11-21-sitecheck.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? a.concat([[v.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]]) : a), []));
const round = args.round;
if (!round || round === true) { console.error('usage: --round <id> [--brands a,b] [--delay-ms 1200]'); process.exit(1); }
const DELAY = Number(args['delay-ms'] || 1200);
const PARALLEL = Number(args.parallel || 3);
const read = name => parseCsv(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const pick = args.brands && args.brands !== true ? new Set(args.brands.split(',')) : null;
const brands = read('2026-11-21-brands.csv').filter(b => b.category === 'shoes' && (!pick || pick.has(b.slug)));
const models = read('2026-11-21-spec-sheet.csv');
const outDir = new URL(`../data/rounds/${round}/`, import.meta.url);
mkdirSync(outDir, { recursive: true });
const outFile = new URL('site-checks.auto.json', outDir);

// A browser's request headers: the page as a person's browser first receives it, before any script runs.
const HEADERS = { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36', 'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'accept-language': 'en-US,en;q=0.9' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, budget, { binary = false } = {}) {
  if (budget.left-- <= 0) return { url, status: 'skipped', body: '' };
  await sleep(DELAY);
  try {
    const r = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    let body;
    if (binary || /\.gz($|\?)/.test(url)) { const buf = Buffer.from(await r.arrayBuffer()); try { body = gunzipSync(buf).toString('utf8'); } catch { body = buf.toString('utf8'); } }
    else body = await r.text();
    return { url: r.url || url, status: r.status, body: body.slice(0, 40_000_000) };
  } catch (e) { return { url, status: 'error: ' + String(e.message || e).slice(0, 80), body: '' }; }
}

async function checkBrand(b) {
  const host = siteHost(b);
  const origin = `https://${host}`;
  const budget = { left: 45 };
  const out = { brand: b.slug, origin, checked_at: new Date().toISOString(), requests: [], items: {}, models: [] };
  const log = (what, r) => out.requests.push({ what, url: r.url, status: r.status });

  // Home page and robots.txt.
  const home = await get(origin + '/', budget); log('home', home);
  const homePage = home.status === 200 ? readPage(home.body, home.url) : null;
  const robotsRes = await get(origin + '/robots.txt', budget); log('robots', robotsRes);
  const robots = robotsRes.status === 200 ? parseRobots(robotsRes.body) : { groups: [], sitemaps: [] };

  // Sitemaps: product sitemaps first, up to 12 files and 150,000 URLs.
  const urls = [];
  const queue = robots.sitemaps.length ? [...robots.sitemaps] : [origin + '/sitemap.xml', origin + '/sitemap_index.xml'];
  let files = 0;
  while (queue.length && files < 12 && urls.length < 150000) {
    queue.sort((x, y) => sitemapRank(y) - sitemapRank(x));
    const next = queue.shift();
    const sm = await get(next, budget); log('sitemap', sm); files++;
    if (sm.status !== 200) continue;
    // Once a US sitemap is in, other countries' files are left out.
    if (sitemapRank(next) >= 2 && /(^|[\/_.-])(us|en[-_]us)([\/_.-]|$)/i.test(next)) for (let i = queue.length - 1; i >= 0; i--) if (sitemapRank(queue[i]) < 0) queue.splice(i, 1);
    const { index, locs } = parseSitemap(sm.body);
    if (index) queue.push(...locs.filter(l => !/(blog|article|stor(y|ies)|news|image|video)/i.test(l))); else urls.push(...locs);
  }
  out.sitemap_urls = urls.length;
  // Sites without a usable sitemap: the home page's own links stand in.
  if (homePage) urls.push(...homePage.links.map(l => l.href).filter(h => { try { return new URL(h).hostname === new URL(home.url).hostname; } catch { return false; } }));

  // Product pages of this brand's spec-sheet models.
  const mine = models.filter(m => m.brand_slug === b.slug);
  for (const m of mine) {
    const cands = productUrlsFor(m, urls, 2);
    const rec = { id: m.id, name: m.name, candidates: cands };
    if (cands.length) {
      // A page found only under another country's path: try its US English copy first.
      const us = usVersion(cands[0]);
      let r = us ? await get(us, budget) : null;
      if (r) { log('product ' + m.id + ' (US copy)', r); if (r.status !== 200) r = null; else rec.us_copy_of = cands[0]; }
      if (!r) { r = await get(cands[0], budget); log('product ' + m.id, r); }
      rec.url = r.url; rec.status = r.status;
      if (r.status === 200) {
        const page = readPage(r.body, r.url);
        rec.evidence = productEvidence(page);
        rec.text = page.text.slice(0, 20000); // for drafting the spec sheet
        rec.links = page.links;
      }
    }
    out.models.push(rec);
  }
  const pages = out.models.filter(x => x.evidence);
  const firstPage = pages[0];
  const productPath = firstPage ? new URL(firstPage.url).pathname : (out.models.find(x => x.candidates.length)?.candidates[0] ? new URL(out.models.find(x => x.candidates.length).candidates[0]).pathname : '/');

  // 1. crawlers_allowed: each AI agent may read a product page.
  const per = Object.fromEntries(AI_AGENTS.map(a => [a, robotsAllows(robots, a, productPath)]));
  out.items.crawlers_allowed = robotsRes.status === 200 || robotsRes.status === 404
    ? { result: AI_AGENTS.every(a => per[a].allowed) ? 1 : 0, note: `${productPath}: ` + AI_AGENTS.map(a => `${a} ${per[a].allowed ? 'allowed' : 'blocked by ' + per[a].rule} (${per[a].group})`).join('; ') }
    : { result: null, note: `robots.txt answered ${robotsRes.status}` };

  // 2-7 from the product pages.
  out.items.product_structured_data = majority(pages, e => e.structured);
  out.items.price_readable = majority(pages, e => e.price);
  out.items.widths_listed = majority(pages, e => e.widths);
  out.items.stock_exposed = majority(pages, e => e.stock);
  out.items.specs_in_text = majority(pages, e => e.specs.weight && e.specs.drop && e.specs.stack);
  const v = majority(pages, e => e.versioned);
  out.items.version_clear = { ...v, note: v.result == null ? v.note : v.note + ' name a version; whether older versions are marked as previous needs a look' };

  // 8, 9, 12: follow links from the product page and the home page, at most two links deep.
  const startLinks = [...(firstPage?.links || []), ...(homePage?.links || [])];
  for (const [item, t] of Object.entries(TOPIC)) out.items[item === 'returns' ? 'returns_findable' : item === 'shipping' ? 'shipping_findable' : 'store_locator'] = await findTopic(t, startLinks, host, budget, log);

  // 10. need pages.
  const needs = needPages(urls, homePage?.links || []);
  const missing = Object.keys({ stability: 1, neutral: 1, trail: 1, racing: 1, wide: 1 }).filter(k => !needs[k]);
  out.items.need_pages = { result: missing.length ? 0 : 1, note: missing.length ? `missing: ${missing.join(', ')}` : 'all five found', found: needs };

  // 11. path_to_cart is checked from the cloud, not here.
  out.items.path_to_cart = { result: null, note: 'checked separately from a cloud browser' };
  for (const m of out.models) delete m.links;
  return out;
}

async function findTopic(t, links, host, budget, log) {
  const same = l => { try { const h = new URL(l.href).hostname; return h === host || h.endsWith('.' + host.replace(/^www\./, '')) || host.endsWith('.' + h.replace(/^www\./, '')); } catch { return false; } };
  const first = [...new Map(links.filter(l => same(l) && (t.link.test(l.text) || t.link.test(l.href))).map(l => [l.href, l])).values()].slice(0, 3);
  for (const l of first) {
    const r = await get(l.href, budget); log('topic', r);
    if (r.status !== 200) continue;
    const page = readPage(r.body, r.url);
    if (t.page(page.text, r.body)) return { result: 1, note: `1 link: ${l.text || ''} ${r.url}`.trim() };
    const second = page.links.filter(x => same(x) && (t.link.test(x.text) || t.link.test(x.href)) && x.href !== l.href).slice(0, 2);
    for (const x of second) {
      const r2 = await get(x.href, budget); log('topic', r2);
      if (r2.status === 200 && t.page(readPage(r2.body, r2.url).text, r2.body)) return { result: 1, note: `2 links: ${r2.url}` };
    }
  }
  // A link exists but the page says nothing without scripts: an assistant that runs scripts may still read it, so a
  // person (or the cloud browser) decides. No link at all is a fail.
  return first.length ? { result: null, note: `needs a look: followed ${first.map(l => l.href).join(', ')}; the policy is not in the plain HTML` } : { result: 0, note: 'no link found on the product page or home page' };
}

function siteHost(b) {
  const own = { brooks: 'www.brooksrunning.com', mizuno: 'usa.mizuno.com', puma: 'us.puma.com', 'la-sportiva': 'www.lasportivausa.com' };
  return own[b.slug] || 'www.' + b.domain;
}

const prior = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : { round, brands: {} };
const todo = [...brands];
const results = prior.brands;
async function lane() {
  while (todo.length) {
    const b = todo.shift();
    const t0 = Date.now();
    try { results[b.slug] = await checkBrand(b); } catch (e) { results[b.slug] = { brand: b.slug, error: String(e.stack || e).slice(0, 500) }; }
    const r = results[b.slug];
    const passed = r.items ? Object.values(r.items).filter(i => i.result === 1).length : 0;
    console.log(`${b.slug}: home ${r.requests?.[0]?.status ?? '-'}, ${r.models?.filter(m => m.evidence).length ?? 0}/${r.models?.length ?? 0} product pages read, ${passed} items pass (${Math.round((Date.now() - t0) / 1000)}s)`);
    writeFileSync(outFile, JSON.stringify({ round, generated_at: new Date().toISOString(), brands: results }, null, 1));
  }
}
await Promise.all(Array.from({ length: Math.min(PARALLEL, brands.length) }, lane));
console.log(`wrote ${outFile.pathname}`);
