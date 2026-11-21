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
    const [scores, fixes, context, examples] = await Promise.all([
      env.DB.prepare('SELECT subject, score, margin, n, detail_json FROM scores WHERE round_id = ? AND brand_slug = ?').bind(round, slug).all(),
      env.DB.prepare('SELECT subject, rank, text FROM fixes WHERE round_id = ? AND brand_slug = ? ORDER BY subject, rank').bind(round, slug).all(),
      env.DB.prepare('SELECT metric, value, source FROM context_metrics WHERE round_id = ? AND brand_slug = ?').bind(round, slug).all(),
      // A few answers that named the brand, newest first, so a visitor can see the evidence.
      env.DB.prepare('SELECT r.id, r.engine, r.model, r.prompt_text, r.answer, m.position, m.top_pick FROM mentions m JOIN runs r ON r.id = m.run_id WHERE r.round_id = ? AND m.brand_slug = ? ORDER BY m.top_pick DESC, r.created_at DESC LIMIT 6').bind(round, slug).all(),
    ]);
    return json({
      round, brand,
      scores: Object.fromEntries(scores.results.map(s => [s.subject, { score: s.score, margin: s.margin, n: s.n, detail: safeJson(s.detail_json) }])),
      fixes: fixes.results, context: context.results, examples: examples.results,
    });
  }
  if (parts[1] === 'retailers') {
    if (!round) return json({ round: null, rows: [] });
    const rows = (await env.DB.prepare(`SELECT p.category, rt.retailer_slug, re.name, re.kind, COUNT(*) AS n
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
    'answers.csv': 'SELECT id AS run_id, prompt_id, engine, model, repeat_no, prompt_text, status, answer, citations_json, created_at FROM runs WHERE round_id = ? ORDER BY id',
    'mentions.csv': 'SELECT m.run_id, r.prompt_id, r.engine, r.repeat_no, m.brand_slug, m.position, m.top_pick FROM mentions m JOIN runs r ON r.id = m.run_id WHERE r.round_id = ? ORDER BY m.run_id',
    'routes.csv': 'SELECT rt.run_id, r.prompt_id, r.engine, r.repeat_no, rt.retailer_slug, rt.url FROM routes rt JOIN runs r ON r.id = rt.run_id WHERE r.round_id = ? ORDER BY rt.run_id',
    'scores.csv': 'SELECT brand_slug, subject, score, margin, n, detail_json FROM scores WHERE round_id = ? ORDER BY brand_slug, subject',
    'citations.csv': 'SELECT c.run_id, r.prompt_id, r.engine, c.url, c.domain, c.kind, c.brand_slug, c.retailer_slug FROM citations c JOIN runs r ON r.id = c.run_id WHERE r.round_id = ? ORDER BY c.run_id',
    'prompts.csv': 'SELECT id, set_name, category, text, tags, pair_a, pair_b FROM prompts WHERE ? IS NOT NULL ORDER BY id',
  }[file];
  if (!round || !q) return json({ error: 'not found' }, 404);
  const { results } = await env.DB.prepare(q).bind(round).all();
  return new Response(csv(results), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="solestats-${round}-${file}"`, 'cache-control': 'public, max-age=3600' } });
}

async function latestRound(env) {
  const r = await env.DB.prepare('SELECT id FROM rounds ORDER BY id DESC LIMIT 1').first();
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
