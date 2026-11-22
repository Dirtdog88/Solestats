import { MIN_SOURCED_ANSWERS, WEIGHTS } from './2026-11-21-score.js';
const OVERALL_ORDER = Object.keys(WEIGHTS);
import { brandCounts } from './2026-11-22-races.js';
// SoleStats Worker: a public, read-only JSON API over D1 plus CSV downloads; everything else is a static file.
// Nothing here writes: data is loaded with the scripts (wrangler d1 execute). No sign-in, no cookies.

const HEADERS = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'read only' }, 405);
    let res;
    try {
      if (url.pathname.startsWith('/api/')) res = await api(url, env);
      else if (url.pathname.startsWith('/download/')) res = await download(url, env);
      else res = await env.ASSETS.fetch(request);
    } catch (e) {
      console.error(e);
      res = json({ error: 'something went wrong' }, 500);
    }
    res = new Response(res.body, res);
    for (const [k, v] of Object.entries(HEADERS)) res.headers.set(k, v);
    return res;
  },
};

async function api(url, env) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const round = url.searchParams.get('round') || await latestRound(env);
  if (parts[1] === 'health') return json({ ok: true, round, notice: env.PREVIEW_NOTICE || '' });
  if (parts[1] === 'edition') {
    // Which engines (and model ids) are in this edition, and which are still pending (PENDING_ENGINES in wrangler.toml).
    const pending = (env.PENDING_ENGINES || '').split(/[;,]/).map(s => s.trim()).filter(Boolean);
    if (!round) return json({ round: null, engines: [], pending });
    const row = await env.DB.prepare('SELECT started_at, finished_at, repeats FROM rounds WHERE id = ?').bind(round).first();
    const engines = (await env.DB.prepare(`SELECT engine, model, COUNT(*) AS runs,
      SUM(CASE WHEN searches > 0 THEN 1 ELSE 0 END) AS searched,
      SUM(CASE WHEN citations_json IS NOT NULL AND citations_json != '[]' THEN 1 ELSE 0 END) AS cited,
      SUM(CASE WHEN searches > 0 AND NOT (citations_json IS NOT NULL AND citations_json != '[]') THEN 1 ELSE 0 END) AS not_provided
      FROM runs WHERE round_id = ? AND status = 'ok' GROUP BY engine, model ORDER BY engine, model`).bind(round).all()).results;
    // Which subjects Overall covers this edition (Accurate and Shoppable arrive with the quarterly checks): from the
    // weights stored with the overall scores, so the site can label Overall provisional without hand edits.
    const ov = await env.DB.prepare(`SELECT detail_json FROM scores WHERE round_id = ? AND subject = 'overall'`).bind(round).all().catch(() => ({ results: [] }));
    const covered = [...new Set(ov.results.flatMap(r => Object.keys(safeJson(r.detail_json)?.weights || {})))];
    const overall = { subjects: OVERALL_ORDER.filter(s => covered.includes(s)), all: OVERALL_ORDER, provisional: OVERALL_ORDER.some(s => !covered.includes(s)) };
    return json({ round, started_at: row?.started_at || null, finished_at: row?.finished_at || null, repeats: row?.repeats || null, engines, pending: pending.filter(p => !engines.some(e => e.engine === p)), overall });
  }
  if (parts[1] === 'rounds') return json({ rounds: (await env.DB.prepare('SELECT id, started_at, finished_at, engines, repeats FROM rounds ORDER BY id DESC').all()).results });
  if (parts[1] === 'brands' && !parts[2]) {
    const brands = (await env.DB.prepare('SELECT slug, name, category, treatment, domain FROM brands ORDER BY category, name').all()).results;
    const scores = round ? (await env.DB.prepare('SELECT brand_slug, subject, score, margin, n FROM scores WHERE round_id = ?').bind(round).all()).results : [];
    const by = {};
    for (const s of scores) (by[s.brand_slug] ||= {})[s.subject] = { score: s.score, margin: s.margin, n: s.n };
    return json({ round, brands: brands.map(b => ({ ...b, scores: by[b.slug] || {} })) });
  }
  if (parts[1] === 'brands' && parts[2]) {
    const slug = decodeURIComponent(parts[2]);
    const brand = await env.DB.prepare('SELECT slug, name, category, treatment, domain FROM brands WHERE slug = ?').bind(slug).first();
    if (!brand) return json({ error: 'no such brand' }, 404);
    if (!round) return json({ round: null, brand, scores: {}, fixes: [], context: [] });
    const [scores, fixes, context, examples, sourcing, financials, races] = await Promise.all([
      env.DB.prepare('SELECT subject, score, margin, n, detail_json FROM scores WHERE round_id = ? AND brand_slug = ?').bind(round, slug).all(),
      env.DB.prepare('SELECT subject, rank, text FROM fixes WHERE round_id = ? AND brand_slug = ? ORDER BY subject, rank').bind(round, slug).all(),
      env.DB.prepare('SELECT metric, value, source FROM context_metrics WHERE round_id = ? AND brand_slug = ?').bind(round, slug).all(),
      // Evidence for a visitor: two answers per engine that named the brand, from the shoe questions (head-to-head
      // questions name the brand themselves), top picks first, then first repeat, by prompt. Not "newest first": the
      // engines ran at different times, so that showed only the last engine to finish.
      env.DB.prepare(`SELECT id, engine, model, prompt_text, answer, position, top_pick, sourcing FROM (SELECT r.id, r.engine, r.model, r.prompt_text, r.answer, m.position, m.top_pick, CASE WHEN r.citations_json IS NOT NULL AND r.citations_json != '[]' THEN 'sourced' WHEN r.searches > 0 THEN 'not_provided' ELSE 'no_search' END AS sourcing, ROW_NUMBER() OVER (PARTITION BY r.engine ORDER BY m.top_pick DESC, r.repeat_no, r.prompt_id) AS rn FROM mentions m JOIN runs r ON r.id = m.run_id JOIN prompts p ON p.id = r.prompt_id WHERE r.round_id = ? AND m.brand_slug = ? AND r.status = 'ok' AND p.set_name = 'shoe') WHERE rn <= 2 ORDER BY rn, engine`).bind(round, slug).all(),
      // How the answers naming the brand stand on sources, so the page can explain a Sourced held back for too few.
      env.DB.prepare(`SELECT CASE WHEN r.citations_json IS NOT NULL AND r.citations_json != '[]' THEN 'sourced' WHEN r.searches > 0 THEN 'not_provided' ELSE 'no_search' END AS sourcing, COUNT(DISTINCT r.id) AS n FROM mentions m JOIN runs r ON r.id = m.run_id WHERE r.round_id = ? AND m.brand_slug = ? AND r.status = 'ok' GROUP BY sourcing`).bind(round, slug).all(),
      // Publicly reported revenue (context, never scored): newest fiscal year first. Fails soft until migration 0003 is applied.
      env.DB.prepare('SELECT fiscal_year, period_end, level, measure, owner, ticker, value, unit, currency, prior_value, yoy_pct, source_type, source_url, published_on, notes FROM financials WHERE brand_slug = ? ORDER BY period_end DESC, level').bind(slug).all().catch(() => ({ results: [] })),
      // Top-10 finishes at the majors in this brand's shoes (context, never scored). Fails soft until migration 0005.
      env.DB.prepare('SELECT race, year, date, gender, place, athlete, country, time, model, basis, shoe_source_url FROM race_results WHERE brand_slug = ? ORDER BY date DESC, place').bind(slug).all().catch(() => ({ results: [] })),
    ]);
    return json({
      round, brand,
      scores: Object.fromEntries(scores.results.map(s => [s.subject, { score: s.score, margin: s.margin, n: s.n, detail: safeJson(s.detail_json) }])),
      fixes: fixes.results, context: context.results, examples: examples.results, financials: financials.results, races: races.results,
      sourcing: { ...Object.fromEntries(sourcing.results.map(x => [x.sourcing, x.n])), min: MIN_SOURCED_ANSWERS },
    });
  }
  if (parts[1] === 'share-of-voice') return json(await shareOfVoiceView(env, round));
  if (parts[1] === 'retailers') {
    if (!round) return json({ round: null, rows: [] });
    const rows = (await env.DB.prepare(`SELECT p.category, rt.retailer_slug, re.name, re.kind, COUNT(DISTINCT rt.run_id) AS n
      FROM routes rt JOIN runs r ON r.id = rt.run_id JOIN prompts p ON p.id = r.prompt_id JOIN retailers re ON re.slug = rt.retailer_slug
      WHERE r.round_id = ? GROUP BY p.category, rt.retailer_slug ORDER BY p.category, n DESC`).bind(round).all()).results;
    const answers = (await env.DB.prepare('SELECT p.category, COUNT(*) AS n FROM runs r JOIN prompts p ON p.id = r.prompt_id WHERE r.round_id = ? AND r.status = ? GROUP BY p.category').bind(round, 'ok').all()).results;
    return json({ round, rows, answers });
  }
  if (parts[1] === 'prompts') return json({ prompts: (await env.DB.prepare('SELECT id, set_name, category, text, tags FROM prompts ORDER BY id').all()).results });
  return json({ error: 'not found' }, 404);
}

// /download/<round>/<answers|mentions|routes|scores|prompts>.csv straight from D1, so the open data is always the live data.
async function download(url, env) {
  const [, round, file] = url.pathname.split('/').filter(Boolean);
  const q = {
    'answers.csv': 'SELECT id AS run_id, prompt_id, engine, model, repeat_no, prompt_text, status, answer, citations_json, searched_json, searches, created_at FROM runs WHERE round_id = ? ORDER BY id',
    'mentions.csv': 'SELECT m.run_id, r.prompt_id, r.engine, r.repeat_no, m.brand_slug, m.position, m.top_pick FROM mentions m JOIN runs r ON r.id = m.run_id WHERE r.round_id = ? ORDER BY m.run_id',
    'routes.csv': 'SELECT rt.run_id, r.prompt_id, r.engine, r.repeat_no, rt.retailer_slug, rt.brand_slug, rt.url FROM routes rt JOIN runs r ON r.id = rt.run_id WHERE r.round_id = ? ORDER BY rt.run_id',
    'scores.csv': 'SELECT brand_slug, subject, score, margin, n, detail_json FROM scores WHERE round_id = ? ORDER BY brand_slug, subject',
    'citations.csv': 'SELECT c.run_id, r.prompt_id, r.engine, c.url, c.domain, c.kind, c.source, c.brand_slug, c.retailer_slug FROM citations c JOIN runs r ON r.id = c.run_id WHERE r.round_id = ? ORDER BY c.run_id',
    'prompts.csv': 'SELECT id, set_name, category, text, tags, pulse, pair_a, pair_b FROM prompts WHERE ? IS NOT NULL ORDER BY id',
    // Not tied to a round: the latest reported figures, the same in every round's download.
    'race-results.csv': 'SELECT race, year, date, gender, place, athlete, country, time, results_url, brand, brand_slug, model, basis, shoe_source_url, shoe_quote, shoe_checked_on, notes, checked_on FROM race_results WHERE ? IS NOT NULL ORDER BY date, gender, place',
    'financials.csv': 'SELECT brand_slug, owner, ticker, fiscal_year, period_end, level, measure, value, unit, currency, prior_value, yoy_pct, source_type, source_url, published_on, quote, notes, checked_on FROM financials WHERE ? IS NOT NULL ORDER BY brand_slug, period_end DESC',
  }[file];
  if (!round || !q) return json({ error: 'not found' }, 404);
  const { results } = await env.DB.prepare(q).bind(round).all();
  return new Response(csv(results), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="solestats-${round}-${file}"`, 'cache-control': 'public, max-age=3600' } });
}

// Share of voice beside revenue: this round's share of voice, the previous round's (for the change), and each brand's
// narrowest reported revenue figure with its growth, converted to US dollars at the yearly average rate only to put
// brands on one scale. The financials and fx tables fail soft until their migrations are applied.
const LEVELS = ['brand', 'category', 'footwear', 'segment', 'company'];
async function shareOfVoiceView(env, round) {
  if (!round) return { round: null, previous_round: null, brands: [] };
  const soft = p => p.then(r => r.results).catch(() => []);
  const prev = await env.DB.prepare(`SELECT id FROM rounds WHERE started_at < (SELECT started_at FROM rounds WHERE id = ?) AND id IN (SELECT round_id FROM scores WHERE subject = 'share_of_voice') ORDER BY started_at DESC LIMIT 1`).bind(round).first().catch(() => null);
  const [brands, sov, sovPrev, fin, fx, races] = await Promise.all([
    soft(env.DB.prepare('SELECT slug, name, treatment FROM brands ORDER BY name').all()),
    soft(env.DB.prepare(`SELECT brand_slug, score, margin, n, detail_json FROM scores WHERE round_id = ? AND subject = 'share_of_voice'`).bind(round).all()),
    prev ? soft(env.DB.prepare(`SELECT brand_slug, score FROM scores WHERE round_id = ? AND subject = 'share_of_voice'`).bind(prev.id).all()) : [],
    soft(env.DB.prepare('SELECT brand_slug, fiscal_year, period_end, level, measure, owner, value, unit, currency, yoy_pct, source_type, source_url FROM financials').all()),
    soft(env.DB.prepare('SELECT currency, year, usd_per_unit FROM fx_rates').all()),
    soft(env.DB.prepare('SELECT race, year, gender, place, brand, brand_slug, basis FROM race_results').all()),
  ]);
  const rc = brandCounts(races);
  const rate = (cur, periodEnd) => {
    const rows = fx.filter(r => r.currency === cur).sort((a, b) => b.year.localeCompare(a.year));
    const y = String(periodEnd || '').slice(0, 4);
    return (rows.find(r => r.year === y) || rows[0] || {}).usd_per_unit ?? null;
  };
  const out = [];
  for (const b of brands) {
    const s = sov.find(x => x.brand_slug === b.slug);
    const d = s ? safeJson(s.detail_json) || {} : {};
    const p = sovPrev.find(x => x.brand_slug === b.slug);
    const mine = fin.filter(x => x.brand_slug === b.slug);
    const latestFy = mine.map(x => x.period_end || '').sort().pop();
    const r = mine.filter(x => (x.period_end || '') === latestFy).sort((x, y) => LEVELS.indexOf(x.level) - LEVELS.indexOf(y.level))[0];
    let revenue = null;
    if (r) {
      const fxr = r.value != null ? rate(r.currency, r.period_end) : null;
      const amount = r.value != null ? r.value * (r.unit === 'billions' ? 1e9 : 1e6) : null;
      revenue = { measure: r.measure, level: r.level, owner: r.owner, fiscal_year: r.fiscal_year, period_end: r.period_end, value: r.value, unit: r.unit, currency: r.currency, yoy_pct: r.yoy_pct, source_type: r.source_type, source_url: r.source_url, usd: amount != null && fxr != null ? Math.round(amount * fxr) : null };
    }
    const rb = rc.brands.find(x => x.slug === b.slug);
    if (!s && !revenue && !rb) continue;
    out.push({ top10: rb ? rb.top10 : 0, podiums: rb ? rb.podiums : 0, wins: rb ? rb.wins : 0, top10_share: rc.known ? (rb ? rb.top10_share : 0) : null, slug: b.slug, name: b.name, sov: s ? s.score : null, sov_margin: s ? s.margin : null, mentions: s ? s.n : 0, top_pick_share: d.top_pick_share ?? null, answer_share: d.answer_share ?? null, by_engine: d.by_engine || {}, sov_previous: p ? p.score : null, sov_change: s && p ? Math.round((s.score - p.score) * 10) / 10 : null, revenue });
  }
  out.sort((a, b) => (b.sov ?? -1) - (a.sov ?? -1));
  return { round, previous_round: prev ? prev.id : null, brands: out, races: { places: rc.places, known: rc.known, races: rc.races, other_brands: rc.brands.filter(x => !x.slug) } };
}

async function latestRound(env) {
  const r = await env.DB.prepare('SELECT id FROM rounds ORDER BY started_at DESC, id DESC LIMIT 1').first();
  return r ? r.id : null;
}

export function csv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const q = v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [cols.join(','), ...rows.map(r => cols.map(c => q(r[c])).join(','))].join('\n') + '\n';
}
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' } }); }
function safeJson(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }
