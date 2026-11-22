import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { csv } from '../src/2026-11-21-worker.js';

// A tiny fake D1: every query returns the canned rows for its first table name.
function fakeDb(tables) {
  const stmt = sqlText => ({
    bind() { return this; },
    async all() { return { results: pick(sqlText) }; },
    async first() { return pick(sqlText)[0] || null; },
  });
  const pick = s => { const m = /FROM\s+(\w+)/i.exec(s); return (m && tables[m[1]]) || []; };
  return { prepare: stmt };
}
const env = { DB: fakeDb({ rounds: [{ id: '2026-12' }], brands: [{ slug: 'brooks', name: 'Brooks', category: 'shoes', treatment: 'full' }], scores: [{ brand_slug: 'brooks', subject: 'overall', score: 71.5, margin: 3, n: 100, detail_json: '{}' }], fixes: [], context_metrics: [], mentions: [], routes: [], runs: [{ engine: 'anthropic', model: 'claude-opus-5-5', answers: 2, ok: 2, searched: 1, cited: 0 }], prompts: [] }), ASSETS: { fetch: async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }) }, PREVIEW_NOTICE: 'Private preview.' };

test('GET /api/brands joins the latest round scores and sets security headers', async () => {
  const res = await worker.fetch(new Request('https://solestats.com/api/brands'), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.round, '2026-12');
  assert.equal(body.brands[0].scores.overall.score, 71.5);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
});

test('GET /api/brands/:slug 404s for an unknown brand; writes are refused; static falls through', async () => {
  const env404 = { ...env, DB: fakeDb({ rounds: [{ id: '2026-12' }], brands: [] }) };
  assert.equal((await worker.fetch(new Request('https://solestats.com/api/brands/nope'), env404)).status, 404);
  assert.equal((await worker.fetch(new Request('https://solestats.com/api/brands', { method: 'POST' }), env)).status, 405);
  const page = await worker.fetch(new Request('https://solestats.com/'), env);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
});

test('the brand page API carries reported revenue, and financials.csv downloads', async () => {
  const fin = [{ fiscal_year: 'FY2026', period_end: '2026-03-31', level: 'brand', measure: 'HOKA brand net sales', owner: 'Deckers Brands', value: 2000, unit: 'millions', currency: 'USD', yoy_pct: 10, source_type: '10-K', source_url: 'https://www.sec.gov/x' }];
  const e = { ...env, DB: fakeDb({ rounds: [{ id: '2026-12' }], brands: [{ slug: 'hoka', name: 'Hoka', category: 'shoes', treatment: 'full' }], scores: [], fixes: [], context_metrics: [], mentions: [], financials: fin }) };
  const body = await (await worker.fetch(new Request('https://solestats.com/api/brands/hoka'), e)).json();
  assert.equal(body.financials[0].measure, 'HOKA brand net sales');
  const csv = await (await worker.fetch(new Request('https://solestats.com/download/2026-12/financials.csv'), e)).text();
  assert.match(csv, /HOKA brand net sales/);
});

test('downloads come back as CSV attachments and unknown files 404', async () => {
  const res = await worker.fetch(new Request('https://solestats.com/download/2026-12/scores.csv'), env);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /solestats-2026-12-scores\.csv/);
  assert.match(await res.text(), /^brand_slug,subject,score/);
  assert.equal((await worker.fetch(new Request('https://solestats.com/download/2026-12/raw.zip'), env)).status, 404);
});

test('csv quotes fields with commas, quotes and newlines', () => {
  assert.equal(csv([{ a: 'x,y', b: 'say "hi"', c: 'l1\nl2' }]), 'a,b,c\n"x,y","say ""hi""","l1\nl2"\n');
  assert.equal(csv([]), '');
});

test('GET /api/edition lists the engines in the round and the pending ones from PENDING_ENGINES', async () => {
  const envEd = { ...env, PENDING_ENGINES: 'gemini, openai', DB: fakeDb({ rounds: [{ id: '2026-11', started_at: '2026-11-21T14:00:00Z', repeats: 3 }], runs: [{ engine: 'anthropic', model: 'claude-opus-5-5', runs: 414 }, { engine: 'openai', model: 'gpt-6.2-astra', runs: 414 }] }) };
  const body = await (await worker.fetch(new Request('https://solestats.com/api/edition'), envEd)).json();
  assert.equal(body.round, '2026-11');
  assert.equal(body.repeats, 3);
  assert.deepEqual(body.engines.map(e => e.engine), ['anthropic', 'openai']);
  assert.deepEqual(body.pending, ['gemini']);
  const empty = await (await worker.fetch(new Request('https://solestats.com/api/edition'), { ...env, PENDING_ENGINES: 'gemini', DB: fakeDb({ rounds: [] }) })).json();
  assert.deepEqual(empty, { round: null, engines: [], pending: ['gemini'] });
});


test('GET /api/edition says which subjects Overall covers, and that it is provisional until all five are scored', async () => {
  const scores = [{ subject: 'overall', detail_json: '{"weights":{"recommended":35,"sourced":10,"routing":10}}' }, { subject: 'overall', detail_json: '{"weights":{"recommended":35,"routing":10,"accurate":25}}' }];
  const e = { ...env, DB: fakeDb({ rounds: [{ id: '2026-11' }], runs: [], scores }) };
  const body = await (await worker.fetch(new Request('https://solestats.com/api/edition'), e)).json();
  assert.deepEqual(body.overall.subjects, ['recommended', 'accurate', 'sourced', 'routing']);
  assert.equal(body.overall.provisional, true);
  const all = [{ subject: 'overall', detail_json: '{"weights":{"recommended":35,"accurate":25,"shoppable":20,"sourced":10,"routing":10}}' }];
  const full = await (await worker.fetch(new Request('https://solestats.com/api/edition'), { ...env, DB: fakeDb({ rounds: [{ id: '2026-11' }], runs: [], scores: all }) })).json();
  assert.equal(full.overall.provisional, false);
});

test('GET /api/share-of-voice joins share of voice, the previous round and dollar-scaled revenue', async () => {
  const scores = [{ brand_slug: 'hoka', score: 13.2, margin: 0.4, n: 534, detail_json: '{"top_pick_share":8.5,"answer_share":58,"by_engine":{"openai":12}}' }];
  const e = { ...env, DB: fakeDb({ rounds: [{ id: '2026-12' }], brands: [{ slug: 'hoka', name: 'Hoka', treatment: 'full' }, { slug: 'zzz', name: 'Nobody' }], scores,
    financials: [{ brand_slug: 'hoka', fiscal_year: 'FY2026', period_end: '2026-03-31', level: 'brand', measure: 'HOKA brand net sales', value: 2587, unit: 'millions', currency: 'USD', yoy_pct: 15.9 },
                 { brand_slug: 'hoka', fiscal_year: 'FY2026', period_end: '2026-03-31', level: 'company', measure: 'Deckers net sales', value: 4986, unit: 'millions', currency: 'USD', yoy_pct: 9 }],
    fx_rates: [{ currency: 'USD', year: '2025', usd_per_unit: 1 }] }) };
  const body = await (await worker.fetch(new Request('https://solestats.com/api/share-of-voice'), e)).json();
  assert.equal(body.brands.length, 1);              // a brand with neither share of voice nor revenue is left out
  const h = body.brands[0];
  assert.equal(h.sov, 13.2);
  assert.equal(h.top_pick_share, 8.5);
  assert.equal(h.revenue.level, 'brand');           // the narrowest figure wins
  assert.equal(h.revenue.usd, 2587000000);
  assert.equal(h.sov_change, 13.2 - 13.2);          // the fake returns the same rows for the previous round
});
