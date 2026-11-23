// Pure helpers for the Shoppable by AI checklist (data/2026-11-21-shoppable-checklist.csv): robots.txt rules, product
// pages from sitemaps, what a page says without running scripts, and the per-item verdicts. No network here; the
// script scripts/2026-11-21-site-checks.js does the fetching. Verdicts are drafts: a person reviews the evidence
// before they go into site-checks.jsonl.

export const AI_AGENTS = ['GPTBot', 'ClaudeBot', 'Google-Extended', 'PerplexityBot'];

/** robots.txt -> [{agents: [lowercase tokens], rules: [{allow, path}]}], plus the Sitemap lines. */
export function parseRobots(text) {
  const groups = [], sitemaps = [];
  let cur = null, lastWasAgent = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === 'sitemap') { if (val) sitemaps.push(val); continue; }
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === 'allow' || key === 'disallow') cur.rules.push({ allow: key === 'allow', path: val });
  }
  return { groups, sitemaps };
}

const ruleRegex = path => new RegExp('^' + path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));

/** May this agent fetch this path? The agent's own group if there is one, else '*'; the longest matching rule wins
 *  and Allow wins a tie (as Google and the RFC 9309 draft read it). No robots.txt or no matching rule: allowed. */
export function robotsAllows(robots, agent, path) {
  const a = agent.toLowerCase();
  const own = robots.groups.filter(g => g.agents.includes(a));
  const groups = own.length ? own : robots.groups.filter(g => g.agents.includes('*'));
  let best = null;
  for (const r of groups.flatMap(g => g.rules)) {
    if (r.path === '') continue; // "Disallow:" with nothing means allow all
    if (!ruleRegex(r.path).test(path)) continue;
    const len = r.path.replace(/[*$]/g, '').length;
    if (!best || len > best.len || (len === best.len && r.allow && !best.allow)) best = { len, allow: r.allow, rule: r.path };
  }
  return { allowed: best ? best.allow : true, rule: best ? best.rule : null, group: own.length ? a : '*' };
}

/** <loc> values from a sitemap or sitemap index, and whether it was an index. */
export function parseSitemap(xml) {
  const locs = [...String(xml || '').matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi)].map(m => m[1].replace(/&amp;/g, '&'));
  return { index: /<sitemapindex[\s>]/i.test(xml), locs };
}

const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const NOT_ADULT_ROAD = /(kid|kids|youth|junior|grade-school|preschool|toddler|little-kid|big-kid|infant|baby)/;
const NOT_PRODUCT = /\/(blog|blogs|stories|story|news|article|articles|compare|reviews?|guides?|journal|magazine|help|faq)\//;
// A path segment that names a country or language other than US English (/au/, /ca/, /us/es/, /en-gb/).
const OTHER_LOCALE = /^(?!(?:us|en|en[-_]us|us[-_]en)$)(?:[a-z]{2}(?:[-_][a-z]{2})?)$/;
const US = /^(us|en[-_]us|us[-_]en)$/;

/** The US English copy of a page found only under another locale: /id/t/x -> /t/x, /us/es/pd/x -> /us/en/pd/x.
 *  Returns null when the URL has no foreign locale segment. */
export function usVersion(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const segs = u.pathname.split('/').filter(Boolean);
  if (segs[0] === 'us' && segs[1] && OTHER_LOCALE.test(segs[1])) segs[1] = 'en';
  else if (segs[0] && OTHER_LOCALE.test(segs[0]) && segs.length > 1) segs.shift();
  else return null;
  u.pathname = '/' + segs.join('/');
  return u.href;
}

/** How promising a sitemap file is: product sitemaps and US ones first, other countries' last. */
export function sitemapRank(url) {
  let s = 0;
  if (/product|pdp|shoe/i.test(url)) s += 2;
  if (/(^|[\/_.-])(us|en[-_]us)([\/_.-]|$)/i.test(url)) s += 2;
  if (/(^|[\/_.-])(au|ca|gb|uk|de|fr|be|nl|es|it|jp|cn|kr|mx|br|in|sg|nz|ie|ch|at|se|dk|no|fi|pl|pt|tr|za|ar|cl|co|hk|tw|th|my|ph|vn|il|ae|sa)([\/_.-]|$)/i.test(url) || /(^|[\/_.-])[a-z]{2}[-_](?!us(?:[\/_.-]|$))[a-z]{2}([\/_.-]|$)/i.test(url)) s -= 3;
  return s;
}

/** The best product URLs for a model among a site's URLs: the path must hold the model's name as a run of words; men's,
 *  current-looking and plain versions rank higher; kids', apparel and editorial pages are left out. Up to `n`. */
export function productUrlsFor(model, urls, n = 3) {
  const want = slug(model.name);
  const scored = [];
  for (const u of urls) {
    let path;
    try { path = new URL(u).pathname.toLowerCase(); } catch { continue; }
    const p = '-' + slug(path) + '-';
    if (!p.includes('-' + want + '-')) continue;
    if (NOT_PRODUCT.test(path) || NOT_ADULT_ROAD.test(p)) continue;
    if (/(sock|shirt|short|tight|jacket|hat|cap|hoodie|bra|legging|pant|tee|top|vest|bag|insole|lace)/.test(p) && !/shoe/.test(p)) continue;
    let s = 0;
    const segs = path.split('/').filter(Boolean);
    if (segs.some(x => OTHER_LOCALE.test(x))) s -= 6;   // another country's or language's page
    if (segs.some(x => US.test(x))) s += 1;
    if (/(featured|collection|landing|category|-shop-|^-shop-)/.test(p)) s -= 3; // a landing page, not the product
    if (/(^|-)(men|mens|m)(-|$)/.test(p)) s += 3;
    if (/(women|womens|wmns|-w-)/.test(p)) s -= 2;
    if (/(gtx|gore-tex|waterproof|wide|-2e-|-4e-|-d-|limited|edition|collab|sale|outlet|pack)/.test(p) && !/(gtx|gore-tex|wide)/.test(slug(model.name))) s -= 2;
    const ver = p.slice(p.indexOf('-' + want + '-') + want.length + 2).match(/^(v?\d{1,2})(-|$)/);
    if (ver) s += 2 + Number(ver[1].replace('v', '')) / 100; // a version number right after the name, newest first
    if (/\.html?$|\/p\/|\/product|\/pd\/|\/t\//.test(path)) s += 1;
    s -= path.length / 1000; // shorter paths win ties
    scored.push({ url: u, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  const seen = new Set(), out = [];
  for (const x of scored) { const k = x.url.replace(/[?#].*$/, ''); if (!seen.has(k)) { seen.add(k); out.push(x.url); } if (out.length >= n) break; }
  return out;
}

const decode = s => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));

/** The page as a crawler that runs no scripts sees it: JSON-LD Product data, title, visible text and links. */
export function readPage(html, baseUrl) {
  const h = String(html || '');
  const products = [];
  for (const m of h.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const walk = x => {
      if (!x || typeof x !== 'object') return;
      if (Array.isArray(x)) return x.forEach(walk);
      const t = [].concat(x['@type'] || []).map(String);
      if (t.some(v => /^(Product|ProductGroup)$/i.test(v))) products.push(x);
      if (x['@graph']) walk(x['@graph']);
      if (x.hasVariant) walk(x.hasVariant);
    };
    walk(data);
  }
  const offers = products.flatMap(p => [].concat(p.offers || []).flatMap(o => o && o['@type'] === 'AggregateOffer' ? [o, ...[].concat(o.offers || [])] : [o])).filter(Boolean);
  const title = decode((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim();
  const h1 = decode(((h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const text = decode(h.replace(/<(script|style|noscript|template|svg)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const links = [];
  for (const m of h.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let href;
    try { href = new URL(decode(m[1]), baseUrl).href; } catch { continue; }
    links.push({ href, text: decode(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 80) });
  }
  return {
    title, h1, text, links,
    ld: { products: products.length, names: [...new Set(products.map(p => p.name).filter(Boolean))].slice(0, 3), prices: [...new Set(offers.map(o => o.price ?? o.lowPrice).filter(v => v != null).map(String))].slice(0, 5), currencies: [...new Set(offers.map(o => o.priceCurrency).filter(Boolean))], availability: [...new Set(offers.map(o => String(o.availability || '').replace(/^https?:\/\/schema\.org\//, '')).filter(Boolean))].slice(0, 5), offers: offers.length },
  };
}

const around = (text, re, max = 4, pad = 90) => {
  const out = [];
  for (const m of text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))) {
    out.push(text.slice(Math.max(0, m.index - pad), m.index + m[0].length + pad));
    if (out.length >= max) break;
  }
  return out;
};

const RE = {
  price: /\$\s?\d{2,3}(?:\.\d{2})?/,
  widths: /\b(2E|4E|2A|D\s?[-–]\s?Wide|B\s?[-–]\s?Medium|Extra[- ]Wide|X-Wide|Wide|Narrow)\b/i,
  stock: /\b(in stock|out of stock|sold out|low stock|only \d+ left|currently unavailable|back in stock|notify me)\b/i,
  weight: /\b(weight|weighs)\b[^.]{0,40}?\d+(?:\.\d+)?\s?(oz|ounces?|g|grams)\b|\d+(?:\.\d+)?\s?(oz|ounces?)\b/i,
  drop: /\b(drop|offset|heel[- ]to[- ]toe)\b[^.]{0,40}?\d+(?:\.\d+)?\s?mm\b|\d+(?:\.\d+)?\s?mm\s?(drop|offset)\b/i,
  stack: /\bstack(?: height)?\b[^.]{0,60}?\d+(?:\.\d+)?\s?mm\b|\d+(?:\.\d+)?\s?mm\b[^.]{0,30}?\bstack\b/i,
};

/** What one product page shows without scripts, for the checklist and for drafting the spec sheet. */
export function productEvidence(page) {
  const t = page.text;
  return {
    title: page.title.slice(0, 120), h1: page.h1.slice(0, 120), ld: page.ld,
    structured: page.ld.products > 0 && page.ld.offers > 0,
    price: page.ld.prices.length > 0 || RE.price.test(t),
    widths: RE.widths.test(t),
    stock: page.ld.availability.length > 0 || RE.stock.test(t),
    specs: { weight: RE.weight.test(t), drop: RE.drop.test(t), stack: RE.stack.test(t) },
    versioned: /\b(v?\d{1,2})\b/.test(page.h1 || page.title),
    snippets: { price: around(t, RE.price, 2, 40), widths: around(t, RE.widths, 3, 50), weight: around(t, RE.weight), drop: around(t, RE.drop), stack: around(t, RE.stack) },
  };
}

/** Links on a page that may lead to a topic: returns, shipping, a store locator, or a need page. */
export const TOPIC = {
  returns: { link: /return|exchange|refund/i, page: t => /return/i.test(t) && /\b\d{2,3}[- ]day|\b\d{2,3} days\b/i.test(t) },
  shipping: { link: /shipping|delivery/i, page: t => /shipping/i.test(t) && /(free|\$\s?\d)/i.test(t) && /(business days|\d+\s?[-–]\s?\d+ days|\bdays\b)/i.test(t) },
  store_locator: { link: /store[- ]?(locator|finder)|find a (store|retailer|dealer)|store-locator|storelocator|dealer[- ]?locator|where to buy|stores?$/i, page: (t, html) => /(zip|postal|postcode|city or|location)/i.test(t + ' ' + html.slice(0, 200000)) },
};

export const NEEDS = {
  stability: /stability|support|overpronat/i,
  neutral: /neutral|cushion/i,
  trail: /trail/i,
  racing: /racing|race-day|race|carbon|super-?shoe|competition/i,
  wide: /wide/i,
};

/** Need pages: category URLs among the sitemap and the home page's links. A URL counts when its path is short
 *  (a category, not a product) and names the need alongside running or shoes. */
export function needPages(urls, links) {
  const found = {};
  const cand = [...urls, ...links.map(l => l.href)];
  for (const [need, re] of Object.entries(NEEDS)) {
    const hit = cand.find(u => {
      let p;
      try { p = new URL(u).pathname.toLowerCase(); } catch { return false; }
      return re.test(p) && /(run|shoe|footwear)/.test(p) && p.split('/').filter(Boolean).length <= 5 && !/\.html?$|\/p\/|\/product\/|\d{5,}/.test(p);
    });
    if (hit) found[need] = hit;
  }
  return found;
}

/** A brand-level verdict from its product pages: pass when at least half the pages read pass. */
export function majority(pages, pick) {
  const read = pages.filter(p => p.evidence);
  if (!read.length) return { result: null, note: 'no product page could be read' };
  const yes = read.filter(p => pick(p.evidence)).length;
  return { result: yes * 2 >= read.length ? 1 : 0, note: `${yes} of ${read.length} product pages` };
}

// ---- Energy gels (2026-11-23) ------------------------------------------------------------------------------------
// The gel checklist (data/2026-11-23-gel-shoppable-checklist.csv) swaps shoe widths, specs and versions for nutrition,
// ingredients, flavours and fueling guidance. The same page reader feeds it.

/** Product URLs for a gel among a site's URLs: the path holds the product's name, an alias, or the name without the
 *  brand, as a run of words. Product pages rank above collections; editorial pages are left out. */
export function gelProductUrlsFor(model, brandName, urls, n = 2) {
  const names = [model.name, ...(model.aliases ? model.aliases.split(';') : [])].map(s => s.trim()).filter(Boolean);
  const bare = slug(model.name).replace(new RegExp('^' + slug(brandName) + '-'), '');
  const wants = [...new Set([...names.map(slug), bare].filter(w => w && w.length >= 2))];
  const scored = [];
  for (const u of urls) {
    let path;
    try { path = new URL(u).pathname.toLowerCase(); } catch { continue; }
    if (NOT_PRODUCT.test(path) || NOT_ADULT_ROAD.test(path)) continue;
    const p = '-' + slug(path) + '-';
    // Each word may be plural in the URL ("ultra-energy-gels").
    const hit = wants.find(w => new RegExp('-' + w.split('-').map(x => x.replace(/s$/, '') + 's?').join('-') + '-').test(p));
    if (!hit) continue;
    let s = hit.length / 10; // a longer, more specific match first
    const segs = path.split('/').filter(Boolean);
    if (segs.some(x => OTHER_LOCALE.test(x))) s -= 6;
    if (/\/products?\/|\/p\/|\.html?$/.test(path)) s += 2;
    if (/\/(collections?|category|categories|shop)\/?[^/]*\/?$/.test(path) && !/\/products?\//.test(path)) s -= 2;
    if (/(sample|trial|bundle|variety|mixed|starter|kit)/.test(p)) s -= 1;
    s -= path.length / 1000;
    scored.push({ url: u, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  const seen = new Set(), out = [];
  for (const x of scored) { const k = x.url.replace(/[?#].*$/, ''); if (!seen.has(k)) { seen.add(k); out.push(x.url); } if (out.length >= n) break; }
  return out;
}

const GEL_RE = {
  carbs: /\b(?:total\s+)?carb(?:ohydrate)?s?\b[^.\d]{0,25}?(\d+(?:\.\d+)?)\s?g\b|(\d+(?:\.\d+)?)\s?g(?:rams?)?\s+(?:of\s+)?carb/i,
  sodium: /\bsodium\b[^.\d]{0,25}?(\d+(?:\.\d+)?)\s?mg\b|(\d+(?:\.\d+)?)\s?mg\s+(?:of\s+)?sodium/i,
  caffeine: /\bcaffeine\b[^.\d]{0,25}?(\d+(?:\.\d+)?)\s?mg\b|(\d+(?:\.\d+)?)\s?mg\s+(?:of\s+)?caffeine/i,
  calories: /\b(\d{2,3})\s?(?:k?cal|calories)\b|\bcalories\b[^.\d]{0,15}?(\d{2,3})\b/i,
  noCaffeine: /\b(caffeine[- ]free|no caffeine|non[- ]caffeinated|0\s?mg\s+caffeine)\b/i,
  ingredients: /\bingredients?\b\s*:?\s*[^.]{0,200}?\b(maltodextrin|fructose|glucose|dextrose|sugar|syrup|honey|water|chia|rice|cane|sodium citrate|maple)\b/i,
  diet: /\b(vegan|gluten[- ]free|plant[- ]based|dairy[- ]free|non[- ]gmo)\b/i,
  flavours: /\bflavou?rs?\b/i,
  price: /\$\s?\d{1,3}(?:\.\d{2})?/,
  stock: /\b(in stock|out of stock|sold out|low stock|only \d+ left|currently unavailable|back in stock|notify me)\b/i,
};
const num = m => (m ? Number(m[1] ?? m[2]) : null);

/** What one gel product page shows without scripts, for the checklist. */
export function gelEvidence(page) {
  const t = page.text;
  const nutrition = { carbs: GEL_RE.carbs.test(t), sodium: GEL_RE.sodium.test(t), caffeine: GEL_RE.caffeine.test(t) || GEL_RE.noCaffeine.test(t), calories: GEL_RE.calories.test(t) };
  return {
    title: page.title.slice(0, 120), h1: page.h1.slice(0, 120), ld: page.ld,
    structured: page.ld.products > 0 && page.ld.offers > 0,
    price: page.ld.prices.length > 0 || GEL_RE.price.test(t),
    stock: page.ld.availability.length > 0 || GEL_RE.stock.test(t),
    nutrition,
    nutrition_in_text: nutrition.carbs && (nutrition.sodium || nutrition.calories),
    ingredients_in_text: GEL_RE.ingredients.test(t) || (/\bingredients?\b/i.test(t) && GEL_RE.diet.test(t)),
    flavours_listed: GEL_RE.flavours.test(t) || page.ld.names.length > 1,
    snippets: { carbs: around(t, GEL_RE.carbs, 2, 60), sodium: around(t, GEL_RE.sodium, 2, 60), caffeine: around(t, GEL_RE.caffeine, 2, 60), ingredients: around(t, /\bingredients?\b/i, 1, 160), price: around(t, GEL_RE.price, 2, 40) },
  };
}

/** Draft spec values from a gel page's text, for a person to confirm (the spec sheet only loads confirmed rows). */
export function gelFacts(page) {
  const t = page.text;
  const usd = page.ld.currencies.includes('USD') || !page.ld.currencies.length;
  const ldPrice = usd && page.ld.prices.length ? Number(page.ld.prices[0]) : null;
  const caffeine = GEL_RE.noCaffeine.test(t) && !GEL_RE.caffeine.test(t) ? 0 : num(t.match(GEL_RE.caffeine));
  return { carbs_g: num(t.match(GEL_RE.carbs)), sodium_mg: num(t.match(GEL_RE.sodium)), caffeine_mg: caffeine, calories: num(t.match(GEL_RE.calories)), price_usd: ldPrice ?? num(t.match(/\$\s?(\d{1,3}(?:\.\d{2})?)/)), vegan: /\bvegan\b/i.test(t) ? 'yes' : null };
}

/** Fueling guidance: a page that says how much to take, per hour or every so many minutes, with carbs. */
export const GEL_TOPIC = {
  fueling_guidance: { link: /fuel(?:l?ing)?[- ](?:guide|plan|strategy|calculator|planner)|how[- ]to[- ](?:use|fuel)|nutrition[- ](?:guide|plan)|carb(?:ohydrate)?[- ]calculator|race[- ]day|planner|learn|science|education|resources|guide/i, page: t => /carb/i.test(t) && /(per hour|an hour|\/\s?hr\b|\/\s?hour|every \d+\s?(?:-\s?\d+\s?)?min)/i.test(t) },
};

export const GEL_NEEDS = {
  marathon: /marathon|endurance|race|running/i,
  caffeine: /caffein|caf-?\d|\bcaf\b/i,
  stomach: /stomach|gut|sensitive|digest/i,
  vegan: /vegan|plant|natural|real-food|organic/i,
};

/** Need pages for gels: short, category-like paths that name the need. */
export function gelNeedPages(urls, links) {
  const found = {};
  const cand = [...urls, ...links.map(l => l.href)];
  for (const [need, re] of Object.entries(GEL_NEEDS)) {
    const hit = cand.find(u => {
      let p;
      try { p = new URL(u).pathname.toLowerCase(); } catch { return false; }
      return re.test(p) && p.split('/').filter(Boolean).length <= 4 && !/\/products?\/|\/p\/|\.html?$|\d{5,}/.test(p) && !NOT_PRODUCT.test(p);
    });
    if (hit) found[need] = hit;
  }
  return found;
}
