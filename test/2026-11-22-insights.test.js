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

test('placesView: shares of the brand\'s places by bucket, with the places behind Other', async () => {
  const { placesView } = await import('../src/2026-11-22-insights.js');
  const { placesFor } = await import('../src/2026-11-21-score.js');
  const retailers = [{ slug: 'fleet-feet', kind: 'run-specialty' }, { slug: 'running-warehouse', kind: 'run-specialty-online' }, { slug: 'amazon', kind: 'marketplace' }, { slug: 'dicks', kind: 'big-box' }, { slug: 'zappos', name: 'Zappos', kind: 'online-retailer' }];
  const rt = (retailer_slug, brand_slug = null) => ({ retailer_slug, brand_slug });
  const runs = [
    { status: 'ok', repeat_no: 1, mentions: [{ brand_slug: 'brooks' }], routes: [rt('brand-site', 'brooks'), rt('fleet-feet'), rt('amazon')] },
    { status: 'ok', repeat_no: 2, mentions: [{ brand_slug: 'brooks' }], routes: [rt('brand-site', 'hoka'), rt('running-warehouse'), rt('dicks'), rt('zappos')] }, // Hoka's site is not a place for Brooks
    { status: 'ok', repeat_no: 1, mentions: [{ brand_slug: 'hoka' }], routes: [rt('amazon')] },
  ];
  const v = placesView(runs, [{ slug: 'brooks' }, { slug: 'on' }], retailers, placesFor);
  assert.equal(v.brooks.n, 6);
  assert.deepEqual(Object.fromEntries(Object.entries(v.brooks.buckets).map(([k, x]) => [k, x.n])), { own: 1, specialty: 2, amazon: 1, big_box: 1, other: 1 });
  assert.equal(v.brooks.buckets.specialty.share, 33.3);
  assert.deepEqual(v.brooks.other_places, [{ slug: 'zappos', name: 'Zappos', n: 1 }]);
  assert.equal(v.on, undefined);                            // no places, no row
});

test('sourcesView: top named domains, gaps from competitors in shared need groups, brand sites and searched pages left out', async () => {
  const { sourcesView, sourceFixes } = await import('../src/2026-11-22-insights.js');
  const ps = [{ id: 'S024', set: 'shoe', group: 'stability' }, { id: 'S056', set: 'shoe', group: 'trail' }];
  const c = (domain, kind = 'review', source = 'cited') => ({ domain, kind, source });
  const r = (prompt_id, brands, citations, engine = 'openai') => ({ status: 'ok', prompt_id, engine, mentions: brands.map(b => ({ brand_slug: b })), citations });
  const runs = [
    r('S024', ['brooks'], [c('brooksrunning.com', 'brand'), c('runrepeat.com')]),
    r('S024', ['hoka', 'asics'], [c('doctorsofrunning.com'), c('hoka.com', 'brand')]),
    r('S024', ['saucony'], [c('doctorsofrunning.com'), c('reddit.com', 'forum', 'searched')]),
    r('S024', ['hoka', 'saucony'], [c('reddit.com', 'forum', 'searched')]),          // searched only: not a source
    r('S056', ['salomon', 'hoka', 'altra'], [c('irunfar.com')]),                     // trail: Brooks never appears there
  ];
  const v = sourcesView(runs, ps, [{ slug: 'brooks' }, { slug: 'on' }], 1);
  assert.deepEqual(v.brooks.top.map(t => t.domain), ['brooksrunning.com', 'runrepeat.com']);
  assert.deepEqual(v.brooks.gaps.map(g => [g.domain, g.answers, g.competitors, g.group]), [['doctorsofrunning.com', 2, 3, 'stability']]);
  assert.equal(v.brooks.by_engine.openai, 1);
  assert.deepEqual(v.on.gaps, []);                                                 // On has no sourced answers
  assert.match(sourceFixes('brooks', v.brooks)[0].text, /^Earn a mention on doctorsofrunning\.com: cited in 2 stability answers naming 3 competitors, never in one naming you\.$/);
  assert.deepEqual(sourceFixes('brooks', { gaps: [{ domain: 'nhs.uk', kind: 'other', answers: 9, competitors: 3, label: 'Stability' }] }), []); // not a site a brand can work with
  assert.deepEqual(sourcesView(runs, ps, [{ slug: 'brooks' }], 5).brooks.gaps, []); // too few sourced answers: no gaps
});

test('voiceVsSize: share of voice over share of revenue among brands with both; wider figures flagged', async () => {
  const { voiceVsSize } = await import('../src/2026-11-22-insights.js');
  const rows = [
    { slug: 'a', sov: 30, revenue: { usd: 1e9, level: 'brand' } },
    { slug: 'b', sov: 10, revenue: { usd: 3e9, level: 'company' } },
    { slug: 'c', sov: 5, revenue: null },                 // no figure: no ratio, and not in the total
    { slug: 'd', sov: null, revenue: { usd: 9e9, level: 'brand' } },
  ];
  assert.deepEqual(voiceVsSize(rows), { brands_with_both: 2 });
  assert.equal(rows[0].revenue_share, 25);
  assert.equal(rows[0].voice_ratio, 1.2);
  assert.equal(rows[1].voice_ratio, 0.13);
  assert.equal(rows[1].voice_ratio_wide, true);
  assert.equal(rows[2].voice_ratio, null);
  assert.equal(rows[3].voice_ratio, null);
});
