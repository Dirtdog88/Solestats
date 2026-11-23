// The Shoppable by AI checks for energy gels (Alex, 2026-11-23), run from a home connection: most gel brand sites
// refuse cloud visitors. For each gel brand: robots.txt for the AI crawlers, the product pages of its gels (from
// data/2026-11-23-gel-products.csv) found through the sitemaps and read as a crawler reads them (plain HTML, no
// scripts), fueling guidance, returns and shipping within two links, and need pages. Writes evidence and draft
// verdicts to data/rounds/<round>/site-checks.auto.json, and draft spec values (carbs, sodium, caffeine, price) for
// data/2026-11-23-gel-spec-sheet.csv, filled only where a cell is empty; a person confirms them (verified_on).
// It never logs in, adds to a cart or buys.
//
//   npm run gel-site-checks -- --round gels-2026-11          all 14 brands (about 10 minutes), on a PC
//   npm run gel-site-checks -- --round gels-2026-11 --brands gu,maurten
//
// Polite: one request at a time per site, a pause between requests, at most about 40 requests per brand.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseCsv, toCsv } from '../src/2026-11-21-csv.js';
import { AI_AGENTS, sitemapRank, parseRobots, robotsAllows, parseSitemap, readPage, TOPIC, majority, gelProductUrlsFor, gelEvidence, gelFacts, GEL_TOPIC, gelNeedPages } from '../src/2026-11-21-sitecheck.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? a.concat([[v.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]]) : a), []));
const round = args.round;
if (!round || round === true || !/^gels-/.test(round)) { console.error('usage: --round gels-YYYY-MM [--brands a,b] [--delay-ms 1200]'); process.exit(1); }
const DELAY = Number(args['delay-ms'] || 1200);
const PARALLEL = Number(args.parallel || 3);
const dataUrl = name => new URL(`../data/${name}`, import.meta.url);
const read = name => parseCsv(readFileSync(dataUrl(name), 'utf8'));
const pick = args.brands && args.brands !== true ? new Set(args.brands.split(',')) : null;
const brands = read('2026-11-23-gel-brands.csv').filter(b => !pick || pick.has(b.slug));
const products = read('2026-11-23-gel-products.csv');
const outDir = new URL(`../data/rounds/${round}/`, import.meta.url);
mkdirSync(outDir, { recursive: true });
const outFile = new URL('site-checks.auto.json', outDir);

const HEADERS = { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36', 'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'accept-language': 'en-US,en;q=0.9' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Hosts where the brand's US shop is not www.<domain>.
const HOST = { untapped: 'untapped.cc', ucan: 'ucan.co' };

async function get(url, budget) {
  if (budget.left-- <= 0) return { url, status: 'skipped', body: '' };
  await sleep(DELAY);
  try {
    const r = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    let body;
    if (/\.gz($|\?)/.test(url)) { const buf = Buffer.from(await r.arrayBuffer()); try { body = gunzipSync(buf).toString('utf8'); } catch { body = buf.toString('utf8'); } }
    else body = await r.text();
    return { url: r.url || url, status: r.status, body: body.slice(0, 40_000_000) };
  } catch (e) { return { url, status: 'error: ' + String(e.message || e).slice(0, 80), body: '' }; }
}

async function checkBrand(b) {
  const host = HOST[b.slug] ? 'www.' + HOST[b.slug] : 'www.' + b.domain;
  const origin = `https://${host}`;
  const budget = { left: 40 };
  const out = { brand: b.slug, origin, checked_at: new Date().toISOString(), requests: [], items: {}, models: [] };
  const log = (what, r) => out.requests.push({ what, url: r.url, status: r.status });

  const home = await get(origin + '/', budget); log('home', home);
  const homePage = home.status === 200 ? readPage(home.body, home.url) : null;
  const robotsRes = await get(origin + '/robots.txt', budget); log('robots', robotsRes);
  const robots = robotsRes.status === 200 ? parseRobots(robotsRes.body) : { groups: [], sitemaps: [] };

  // Sitemaps (Shopify and most shop platforms list products here), up to 8 files.
  const urls = [];
  const queue = robots.sitemaps.length ? [...robots.sitemaps] : [origin + '/sitemap.xml'];
  let files = 0;
  while (queue.length && files < 8 && urls.length < 100000) {
    queue.sort((x, y) => sitemapRank(y) - sitemapRank(x));
    const sm = await get(queue.shift(), budget); log('sitemap', sm); files++;
    if (sm.status !== 200) continue;
    const { index, locs } = parseSitemap(sm.body);
    if (index) queue.push(...locs.filter(l => !/(blog|article|stor(y|ies)|news|image|video|pages?_|recipe)/i.test(l))); else urls.push(...locs);
  }
  out.sitemap_urls = urls.length;
  if (homePage) urls.push(...homePage.links.map(l => l.href).filter(h => { try { return new URL(h).hostname === new URL(home.url).hostname; } catch { return false; } }));

  for (const m of products.filter(p => p.brand_slug === b.slug)) {
    const cands = gelProductUrlsFor(m, b.name, urls, 2);
    const rec = { id: m.id, name: m.name, candidates: cands };
    // Nothing matched: keep the URLs that look like gels, so the product list's names can be fixed.
    if (!cands.length) rec.gel_urls = [...new Set(urls.filter(u => /gel|shot|fuel|energy/i.test(u) && !/blog|news|article/i.test(u)))].slice(0, 40);
    if (cands.length) {
      const r = await get(cands[0], budget); log('product ' + m.id, r);
      rec.url = r.url; rec.status = r.status;
      if (r.status === 200) {
        const page = readPage(r.body, r.url);
        rec.evidence = gelEvidence(page);
        rec.facts = gelFacts(page);
        rec.text = page.text.slice(0, 20000); // so the spec values can be checked against the brand's own words
        rec.links = page.links;
      }
    }
    out.models.push(rec);
  }
  const pages = out.models.filter(x => x.evidence);
  const firstPage = pages[0];
  const productPath = firstPage ? new URL(firstPage.url).pathname : '/products/';

  const per = Object.fromEntries(AI_AGENTS.map(a => [a, robotsAllows(robots, a, productPath)]));
  out.items.crawlers_allowed = robotsRes.status === 200 || robotsRes.status === 404
    ? { result: AI_AGENTS.every(a => per[a].allowed) ? 1 : 0, note: `${productPath}: ` + AI_AGENTS.map(a => `${a} ${per[a].allowed ? 'allowed' : 'blocked by ' + per[a].rule} (${per[a].group})`).join('; ') }
    : { result: null, note: `robots.txt answered ${robotsRes.status}` };
  out.items.product_structured_data = majority(pages, e => e.structured);
  out.items.price_readable = majority(pages, e => e.price);
  out.items.nutrition_in_text = majority(pages, e => e.nutrition_in_text);
  out.items.ingredients_in_text = majority(pages, e => e.ingredients_in_text);
  out.items.flavours_listed = majority(pages, e => e.flavours_listed);
  out.items.stock_exposed = majority(pages, e => e.stock);

  const startLinks = [...(firstPage?.links || []), ...(homePage?.links || [])];
  out.items.fueling_guidance = await findTopic(GEL_TOPIC.fueling_guidance, startLinks, host, budget, log);
  out.items.returns_findable = await findTopic(TOPIC.returns, startLinks, host, budget, log);
  out.items.shipping_findable = await findTopic(TOPIC.shipping, startLinks, host, budget, log);

  const needs = gelNeedPages(urls, homePage?.links || []);
  const missing = ['marathon', 'caffeine', 'stomach', 'vegan'].filter(k => !needs[k]);
  out.items.need_pages = { result: missing.length ? 0 : 1, note: missing.length ? `missing: ${missing.join(', ')}` : 'all four found', found: needs };
  out.items.path_to_cart = { result: null, note: 'checked separately by a person with a browser' };
  for (const m of out.models) delete m.links;
  return out;
}

async function findTopic(t, links, host, budget, log) {
  const bare = host.replace(/^www\./, '');
  const same = l => { try { const h = new URL(l.href).hostname.replace(/^www\./, ''); return h === bare || h.endsWith('.' + bare); } catch { return false; } };
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
  return first.length ? { result: null, note: `needs a look: followed ${first.map(l => l.href).join(', ')}` } : { result: 0, note: 'no link found on the product page or home page' };
}

// Draft spec values: fill empty cells only, never a row someone has confirmed (verified_on).
function draftSpecSheet(results) {
  const file = dataUrl('2026-11-23-gel-spec-sheet.csv');
  const rows = parseCsv(readFileSync(file, 'utf8'));
  const cols = Object.keys(rows[0] || { id: 1 });
  let filled = 0;
  for (const row of rows) {
    if (row.verified_on || /^skip/i.test(row.notes || '')) continue; // confirmed, or left out on purpose
    const rec = results[row.brand_slug]?.models?.find(m => m.id === row.id);
    if (!rec || !rec.facts) continue;
    for (const k of ['carbs_g', 'caffeine_mg', 'sodium_mg', 'price_usd', 'vegan']) if ((row[k] === '' || row[k] == null) && rec.facts[k] != null) { row[k] = String(rec.facts[k]); filled++; }
    if (!row.source_url) row.source_url = rec.url;
  }
  writeFileSync(file, toCsv(rows, cols));
  return filled;
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
console.log(`spec sheet: ${draftSpecSheet(results)} draft values filled in data/2026-11-23-gel-spec-sheet.csv (to be confirmed)`);
