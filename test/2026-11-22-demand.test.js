import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseCsv, toCsv } from '../src/2026-11-21-csv.js';
import { termMatchers, classify, isShoePost, buildWeights, weightsToRows, weightsFromRows, demandView } from '../src/2026-11-22-demand.js';
import { GROUPS } from '../src/2026-11-22-insights.js';

const read = name => parseCsv(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const matchers = termMatchers(read('2026-11-22-demand-terms.csv'));

test('classify: strong phrases beat weak ones, ties go to the group with the longer phrase, nothing matched is null', () => {
  assert.equal(classify('Best shoes for plantar fasciitis?', matchers), 'stability');
  assert.equal(classify('Ghost 17 vs Clifton 10 for a beginner', matchers), 'starting-out');
  assert.equal(classify('Carbon plate shoe for my first marathon?', matchers), 'racing');
  assert.equal(classify('Altra Torin for wide feet?', matchers), 'fit');           // "wide feet" (strong) outranks nothing in drop
  assert.equal(classify('Zero drop daily trainer', matchers), 'starting-out');  // 3 points each (strong + weak): the longer phrase, "daily trainer", decides
  assert.equal(classify('Zero drop shoe for a forefoot striker', matchers), 'drop');
  assert.equal(classify('Is Running Warehouse legit?', matchers), null);
  assert.equal(classify('Looking for a shoe', matchers), null);                     // "look*" is not a brand phrase any more
  const d = classify('Overpronation and a wide foot: stability shoe with a wide toe box?', matchers, true);
  assert.equal(d.group, 'stability');                                                // 5 points each, 2 strong each: the longest phrase, "stability shoe", decides
  assert.deepEqual(Object.keys(d.points).sort(), ['fit', 'stability']);
});

test('isShoePost: shoe words, brands and distinctive models count; other running posts do not', () => {
  assert.ok(isShoePost('Which trainers for a half?'));
  assert.ok(isShoePost('Novablast 5 or Superblast 2'));
  assert.ok(isShoePost('New Balance sizing question'));
  assert.ok(!isShoePost('How many gels for a marathon?'));
  assert.ok(!isShoePost('Guide to the Boston course'));
});

test('every shoe prompt has one keyword in its own group; the phrase lists cover all 11 groups, strong and weak', () => {
  const prompts = read('2026-11-21-prompts.csv').filter(p => p.set === 'shoe');
  const kw = read('2026-11-22-demand-keywords.csv');
  assert.equal(kw.length, prompts.length);
  const byId = Object.fromEntries(kw.map(k => [k.prompt_id, k]));
  for (const p of prompts) { assert.ok(byId[p.id], p.id); assert.equal(byId[p.id].group, p.group, p.id); assert.ok(byId[p.id].keyword.length > 5, p.id); }
  const terms = read('2026-11-22-demand-terms.csv');
  for (const [id] of GROUPS) for (const kind of ['strong', 'weak']) assert.ok(terms.some(t => t.group === id && t.kind === kind), `${id} ${kind}`);
  // Each prompt's own text lands in its own group often enough to trust the classifier on real posts.
  const hits = prompts.filter(p => classify(p.text, matchers) === p.group).length;
  assert.ok(hits / prompts.length >= 0.7, `${hits} of ${prompts.length} prompts classify into their own group`);
});

const kw = [{ prompt_id: 'S001', group: 'starting-out', keyword: 'running shoes for beginners' }, { prompt_id: 'S005', group: 'starting-out', keyword: 'best running shoes' }, { prompt_id: 'S024', group: 'stability', keyword: 'running shoes for overpronation' }, { prompt_id: 'S056', group: 'trail', keyword: 'trail running shoes' }];

test('buildWeights: trends sum per group, reddit shares averaged across subreddits, mean of signals rescaled to 100 with a range', () => {
  const rows = [
    { signal: 'trends', source: 'google', key: 'running shoes for beginners', value: '20' }, { signal: 'trends', source: 'google', key: 'best running shoes', value: '60' },
    { signal: 'trends', source: 'google', key: 'running shoes for overpronation', value: '10' }, { signal: 'trends', source: 'google', key: 'trail running shoes', value: '10' },
    { signal: 'trends', source: 'google', key: 'not a keyword', value: '999' },                                        // unknown term is ignored
    { signal: 'reddit', source: 'r/RunningShoeGeeks', key: 'starting-out', value: '50' }, { signal: 'reddit', source: 'r/RunningShoeGeeks', key: 'stability', value: '50' },
    { signal: 'reddit', source: 'r/running', key: 'trail', value: '10' },                                               // a small subreddit counts the same as a big one
  ];
  const w = buildWeights(rows, kw);
  assert.deepEqual(w.signals, ['trends', 'reddit']);
  assert.deepEqual(w.n, { trends: 4, reddit: 110 });
  const g = Object.fromEntries(w.groups.map(x => [x.id, x]));
  assert.deepEqual(g['starting-out'].by_signal, { trends: 80, reddit: 25 });   // trends 80 of 100; reddit mean of 50% and 0%
  assert.deepEqual(g.stability.by_signal, { trends: 10, reddit: 25 });
  assert.deepEqual(g.trail.by_signal, { trends: 10, reddit: 50 });
  assert.equal(g.budget.weight, 0);
  assert.equal(Math.round(w.groups.reduce((a, x) => a + x.weight, 0)), 100);
  assert.deepEqual([g['starting-out'].weight, g['starting-out'].low, g['starting-out'].high], [52.5, 25, 80]);
  assert.equal(buildWeights([], kw), null);
  const one = buildWeights(rows.filter(r => r.signal === 'trends'), kw);
  assert.deepEqual([one.signals, one.groups[0].low, one.groups[0].high], [['trends'], null, null]);
  // Round trip through the CSV rows.
  const back = weightsFromRows(parseCsv(toCsv(weightsToRows(w, '2026-11-22'))));
  assert.deepEqual(back.groups.map(x => [x.id, x.weight, x.low, x.high]), w.groups.map(x => [x.id, x.weight, x.low, x.high]));
  assert.deepEqual([back.signals, back.n, back.built_on], [w.signals, w.n, '2026-11-22']);
});

test('demandView: weighted share of voice adds up to 100, leaders and gaps per group, fix first by weight × gap among credible groups', () => {
  const needs = {
    groups: [{ id: 'starting-out', label: 'Starting out', answers: 10 }, { id: 'stability', label: 'Stability', answers: 10 }, { id: 'drop', label: 'Drop and minimal', answers: 4 }],
    brands: {
      brooks: { 'starting-out': { share: 80, top_share: 40, margin: 1, named: 8 }, stability: { share: 20, top_share: 0, margin: 1, named: 2 }, drop: { share: 0, top_share: 0, margin: 0, named: 0 } },
      hoka: { 'starting-out': { share: 40, top_share: 20, margin: 1, named: 4 }, stability: { share: 60, top_share: 30, margin: 1, named: 6 }, drop: { share: 0, top_share: 0, margin: 0, named: 0 } },
      altra: { 'starting-out': { share: 10, top_share: 0, margin: 1, named: 1 }, stability: { share: 0, top_share: 0, margin: 0, named: 0 }, drop: { share: 100, top_share: 100, margin: 0, named: 4 } },
    },
  };
  const weights = { groups: [{ id: 'starting-out', label: 'Starting out', weight: 60, low: 50, high: 70, by_signal: {} }, { id: 'stability', label: 'Stability', weight: 30, low: 20, high: 40, by_signal: {} }, { id: 'trail', label: 'Trail', weight: 10, low: 5, high: 15, by_signal: {} }], signals: ['trends', 'reddit'], n: { trends: 3, reddit: 9 }, built_on: '2026-11-22' };
  const v = demandView(needs, weights, { brooks: new Set(['starting-out', 'stability']), hoka: new Set(['starting-out', 'stability', 'drop']), altra: new Set(['drop']) });
  // Trail has no answers this round: left out, weights rescaled over 60 and 30 (drop has answers but no weight: left out too).
  assert.deepEqual(v.brooks.rows.map(r => [r.id, r.weight]), [['starting-out', 66.7], ['stability', 33.3]]);
  assert.deepEqual(v[''].leaders, { 'starting-out': { slug: 'brooks', share: 80 }, stability: { slug: 'hoka', share: 60 } }); // only weighted groups
  const total = ['brooks', 'hoka', 'altra'].reduce((a, s) => a + v[s].weighted_sov, 0);
  assert.ok(Math.abs(total - 100) < 0.2, String(total));
  assert.equal(v.brooks.weighted_sov, 49.4);   // 66.7 × 8/13 + 33.3 × 2/8
  assert.deepEqual(v.brooks.fix_first, ['stability']);             // the only group with a gap: leader 60, brooks 20
  assert.equal(v.brooks.rows[1].priority, 13.3);                   // 33.3 × 40 / 100
  assert.deepEqual(v.hoka.fix_first, ['starting-out']);            // hoka leads stability itself, so only the other gap is a fix
  assert.deepEqual(v.altra.fix_first, []);                          // altra is credible only on drop, which has no weight this quarter
  assert.equal(v.altra.rows[0].eligible, false);
  assert.ok(v.altra.rows.every(r => r.priority > 0), 'gaps are still reported, just not as fixes');
  assert.equal(demandView(needs, null), null);
  assert.equal(demandView({ groups: [], brands: {} }, weights), null);
});

test('the builder script turns a signals file into the weights CSV', () => {
  const dir = mkdtempSync(join(tmpdir(), 'demand-'));
  const signals = join(dir, 'signals.csv'), out = join(dir, 'demand.csv');
  writeFileSync(signals, toCsv([
    { signal: 'trends', source: 'google', key: 'running shoes for beginners', value: 30, window: '12m', collected_on: '2026-11-22', note: '' },
    { signal: 'trends', source: 'google', key: 'trail running shoes', value: 70, window: '12m', collected_on: '2026-11-22', note: '' },
    { signal: 'reddit', source: 'r/RunningShoeGeeks', key: 'trail', value: 10, window: '', collected_on: '2026-11-22', note: '' },
  ]));
  const log = execFileSync(process.execPath, [new URL('../scripts/2026-11-22-demand.js', import.meta.url).pathname, '--signals', signals, '--out', out], { encoding: 'utf8' });
  assert.match(log, /2 signals/);
  const w = weightsFromRows(parseCsv(readFileSync(out, 'utf8')));
  const trail = w.groups.find(g => g.id === 'trail');
  assert.deepEqual([trail.weight, trail.low, trail.high], [85, 70, 100]);
});

test('AI-chat signal: only advice questions count, not jobs handed to the AI (2026-11-23)', async () => {
  const { isAdviceQuestion } = await import('../src/2026-11-22-demand.js');
  assert.ok(isAdviceQuestion('What running shoes should I get for my first marathon?'));
  assert.ok(isAdviceQuestion("I'm a woman over 50 with flat feet. Which running shoes do you recommend?"));
  assert.ok(!isAdviceQuestion("1. Women's Breathable Running Shoes Lightweight Mesh 2. Men's Trail Sneakers Non Slip"), 'pasted product list');
  assert.ok(!isAdviceQuestion("Women's Running Shoes 2 Pairs Lightweight Mesh Sneakers"), 'pasted product title');
  assert.ok(!isAdviceQuestion('Write an Amazon product description for these running shoes for women.'), 'writing job');
  assert.ok(!isAdviceQuestion('Generate 10 SEO keywords for running shoes'), 'writing job');
  assert.ok(!isAdviceQuestion('x'.repeat(700) + ' running shoes?'), 'pasted document');
});
