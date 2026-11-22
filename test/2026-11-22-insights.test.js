import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needGrid, GROUPS } from '../src/2026-11-22-insights.js';

const prompts = [
  { id: 'S001', set: 'shoe', group: 'starting-out' }, { id: 'S024', set: 'shoe', group: 'stability' },
  { id: 'H001', set: 'h2h', group: '' },
];
const run = (prompt_id, repeat_no, mentions, status = 'ok') => ({ prompt_id, repeat_no, status, engine: 'openai', mentions });
const m = (brand_slug, top_pick = 0) => ({ brand_slug, top_pick });

test('needGrid: share of answers per group naming the brand, top-pick share, repeat margin, zero when never named', () => {
  const runs = [
    run('S001', 1, [m('brooks', 1), m('hoka'), m('brooks')]),   // brooks counted once per answer
    run('S001', 2, [m('hoka', 1)]),
    run('S024', 1, [m('brooks', 1)]),
    run('S024', 2, [m('brooks')]),
    run('S024', 2, [], 'error'),                                // failed answers are left out
    run('H001', 1, [m('brooks', 1)]),                           // head-to-head prompts have no group
  ];
  const g = needGrid(runs, prompts, ['brooks', 'hoka', 'on']);
  assert.deepEqual(g.groups, [{ id: 'starting-out', label: 'Starting out', answers: 2 }, { id: 'stability', label: 'Stability', answers: 2 }]);
  assert.deepEqual(g.brands.brooks['starting-out'], { share: 50, top_share: 50, margin: 70.7, named: 1 });
  assert.deepEqual(g.brands.brooks.stability, { share: 100, top_share: 50, margin: 0, named: 2 });
  assert.equal(g.brands.hoka['starting-out'].share, 100);
  assert.deepEqual(g.brands.on.stability, { share: 0, top_share: 0, margin: 0, named: 0 });
});

test('every shoe prompt is in one of the listed need groups', async () => {
  const { readFileSync } = await import('node:fs');
  const { parseCsv } = await import('../src/2026-11-21-csv.js');
  const ids = new Set(GROUPS.map(([id]) => id));
  for (const p of parseCsv(readFileSync(new URL('../data/2026-11-21-prompts.csv', import.meta.url), 'utf8')).filter(p => p.set === 'shoe')) assert.ok(ids.has(p.group), p.id);
});

test('h2hGrid: wins, ties as half, unclear left out of the rate, split by engine; sideOf flips to either brand', async () => {
  const { h2hGrid, sideOf } = await import('../src/2026-11-22-insights.js');
  const brands = [{ slug: 'brooks', name: 'Brooks' }, { slug: 'hoka', name: 'Hoka' }, { slug: 'new-balance', name: 'New Balance' }];
  const ps = [{ id: 'H001', set: 'h2h', pair_a: 'Brooks', pair_b: 'Hoka' }, { id: 'H002', set: 'h2h', pair_a: 'Brooks', pair_b: 'Nobody' }];
  const r = (engine, winner, status = 'ok') => ({ prompt_id: 'H001', engine, winner, status });
  const g = h2hGrid([r('openai', 'brooks'), r('openai', 'tie'), r('anthropic', 'hoka'), r('anthropic', 'unclear'), r('gemini', 'brooks', 'error')], ps, brands);
  assert.deepEqual(g.brands, ['brooks', 'hoka']);
  assert.equal(g.pairs.length, 1);                       // a pair naming an unknown brand is skipped
  const p = g.pairs[0];
  assert.deepEqual([p.n, p.a_wins, p.b_wins, p.ties, p.unclear, p.a_rate], [4, 1, 1, 1, 1, 50]);
  assert.equal(p.by_engine.openai.a_rate, 75);
  assert.equal(p.by_engine.anthropic.a_rate, 0);
  const h = sideOf(p, 'hoka');
  assert.deepEqual([h.opponent, h.rate, h.wins, h.losses], ['brooks', 50, 1, 1]);
  assert.equal(h.by_engine.openai.rate, 25);
});
