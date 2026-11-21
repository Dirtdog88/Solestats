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
const env = { DB: fakeDb({ rounds: [{ id: '2026-12' }], brands: [{ slug: 'brooks', name: 'Brooks', category: 'shoes', treatment: 'full' }], scores: [{ brand_slug: 'brooks', subject: 'overall', score: 71.5, margin: 3, n: 100, detail_json: '{}' }], fixes: [], context_metrics: [], mentions: [], routes: [], runs: [], prompts: [] }), ASSETS: { fetch: async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }) }, PREVIEW_NOTICE: 'Private preview.' };

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
