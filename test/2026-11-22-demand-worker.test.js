import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/2026-11-21-worker.js';

// A fake D1 that also honours the view filter on the views table (the demand view sits beside the others).
function fakeDb(tables) {
  const pick = (s, args) => { const m = /FROM\s+(\w+)/i.exec(s); const rows = (m && tables[m[1]]) || []; return m && m[1] === 'views' ? rows.filter(r => r.view === args[1]) : rows; };
  return { prepare: sqlText => { let args = []; return { bind(...a) { args = a; return this; }, async all() { return { results: pick(sqlText, args) }; }, async first() { return pick(sqlText, args)[0] || null; } }; } };
}
const weights = { groups: [{ id: 'stability', label: 'Stability', weight: 60, low: 50, high: 70, by_signal: { trends: 50, reddit: 70 } }, { id: 'trail', label: 'Trail', weight: 40, low: 30, high: 50, by_signal: { trends: 50, reddit: 30 } }], signals: ['trends', 'reddit'], n: { trends: 2, reddit: 40 } };
const views = [
  { view: 'demand', key: '', detail_json: JSON.stringify({ weights, leaders: { stability: { slug: 'hoka', share: 60 } }, built_on: '2026-11-22', signals: weights.signals, n: weights.n }) },
  { view: 'demand', key: 'brooks', detail_json: JSON.stringify({ weighted_sov: 41.2, rows: [{ id: 'stability', label: 'Stability', weight: 60, share: 20, leader: 60, leader_slug: 'hoka', gap: 40, eligible: true, priority: 24 }], fix_first: ['stability'] }) },
  { view: 'needs', key: '', detail_json: JSON.stringify({ groups: [{ id: 'stability', label: 'Stability', answers: 10 }], brands: { brooks: { stability: { share: 20, top_share: 0, margin: 1, named: 2 } } } }) },
];
const base = { rounds: [{ id: '2026-12', started_at: '2026-12-01' }], brands: [{ slug: 'brooks', name: 'Brooks', category: 'shoes', treatment: 'full' }], scores: [{ brand_slug: 'brooks', subject: 'share_of_voice', score: 15.7, margin: 1, n: 100, detail_json: '{}' }], fixes: [], context_metrics: [], mentions: [], runs: [], prompts: [], views };
const env = { DB: fakeDb(base), ASSETS: { fetch: async () => new Response('') } };

test('the brand page API carries the demand rows, fixes and weights; the needs view still comes through beside it', async () => {
  const body = await (await worker.fetch(new Request('https://solestats.net/api/brands/brooks'), env)).json();
  assert.deepEqual(body.demand.fix_first, ['stability']);
  assert.equal(body.demand.weighted_sov, 41.2);
  assert.equal(body.demand.weights.groups.length, 2);
  assert.equal(body.demand.built_on, '2026-11-22');
  assert.equal(body.needs.cells.stability.share, 20);
  const none = await (await worker.fetch(new Request('https://solestats.net/api/brands/brooks'), { ...env, DB: fakeDb({ ...base, views: [] }) })).json();
  assert.equal(none.demand, null);
});

test('share of voice carries the demand-weighted figure, and demand.csv downloads the weights (404 without them)', async () => {
  const sov = await (await worker.fetch(new Request('https://solestats.net/api/share-of-voice'), env)).json();
  assert.deepEqual([sov.brands[0].sov, sov.brands[0].weighted_sov], [15.7, 41.2]);
  const res = await worker.fetch(new Request('https://solestats.net/download/2026-12/demand.csv'), env);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /^group,label,weight,low,high,trends_share,reddit_share,corpus_share,built_on\n/);
  assert.match(text, /stability,Stability,60,50,70,50,70,,2026-11-22/);
  assert.equal((await worker.fetch(new Request('https://solestats.net/download/2026-12/demand.csv'), { ...env, DB: fakeDb({ ...base, views: [] }) })).status, 404);
});
