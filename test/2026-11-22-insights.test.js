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
