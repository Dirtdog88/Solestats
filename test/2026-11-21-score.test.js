import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eligible, scoreRecommended, scoreAccurate, scoreSourced, sourcing, scoreRouting, scoreShoppable, overall, routingTable, WEIGHTS } from '../src/2026-11-21-score.js';

const brooks = { slug: 'brooks', name: 'Brooks', category: 'shoes' };
const hoka = { slug: 'hoka', name: 'Hoka', category: 'shoes' };
const gu = { slug: 'gu', name: 'GU', category: 'fuel' };
const models = [{ brand_slug: 'brooks', needs: 'daily;stability' }, { brand_slug: 'hoka', needs: 'daily;max-cushion' }];
const prompts = [
  { id: 'S1', set_name: 'shoe', category: 'shoes', tags: 'daily' },
  { id: 'S2', set_name: 'shoe', category: 'shoes', tags: 'stability' },
  { id: 'S3', set_name: 'shoe', category: 'shoes', tags: 'max-cushion' },
  { id: 'H1', set_name: 'h2h', category: 'shoes', tags: 'daily;h2h', pair_a: 'Brooks', pair_b: 'Hoka' },
  { id: 'C1', set_name: 'scan', category: 'fuel', tags: '' },
  { id: 'R1', set_name: 'retailer', category: 'retail', tags: 'routing' },
];

test('eligibility follows the spec sheet for shoes and the category for scans', () => {
  assert.equal(eligible(brooks, prompts[0], models), true);
  assert.equal(eligible(brooks, prompts[2], models), false);
  // A shoe brand with no verified models yet is eligible on every shoe prompt (and the detail says so).
  assert.equal(eligible({ slug: 'topo', name: 'Topo', category: 'shoes' }, prompts[2], models), true);
  assert.equal(eligible({ slug: 'topo', name: 'Topo', category: 'shoes' }, prompts[3], models), false);
  assert.equal(eligible(hoka, prompts[2], models), true);
  assert.equal(eligible(gu, prompts[4], models), true);
  assert.equal(eligible(gu, prompts[0], models), false);
  assert.equal(eligible(brooks, prompts[5], models), false);
});

const run = (prompt_id, repeat_no, slugs, extra = {}) => ({ prompt_id, engine: 'e', repeat_no, status: 'ok', mentions: slugs.map((s, i) => ({ brand_slug: s, position: i + 1, top_pick: i === 0 ? 1 : 0 })), ...extra });

test('scoreRecommended: presence on eligible prompts only, position, consistency and head-to-head', () => {
  const runs = [
    run('S1', 1, ['brooks', 'hoka']), run('S1', 2, ['hoka', 'brooks']), run('S1', 3, ['brooks']),
    run('S2', 1, ['brooks']), run('S2', 2, []), run('S2', 3, ['brooks']),
    run('S3', 1, ['hoka']), run('S3', 2, ['hoka']), run('S3', 3, ['hoka']), // Brooks is not eligible here
    run('H1', 1, ['brooks', 'hoka'], { winner: 'brooks' }), run('H1', 2, ['hoka'], { winner: 'hoka' }), run('H1', 3, [], { winner: 'tie' }),
  ];
  const r = scoreRecommended(brooks, prompts, runs, models);
  assert.equal(r.n, 6);
  assert.equal(r.detail.presence, 83.3);                 // 5 of 6
  assert.equal(r.detail.position, 66.7);                 // first pick in 4 of 6
  assert.equal(r.detail.head_to_head, 50);               // 1 win + half a tie of 3
  assert.equal(r.detail.consistency, 83.3);              // S1: 3/3 agree, S2: 2/3 agree
  assert.equal(r.score, Math.round((83.333 * 50 + 50 * 20 + 66.667 * 15 + 83.333 * 15) / 100 * 10) / 10);
  assert.ok(r.margin >= 0);
  assert.equal(r.detail.eligibility, 'verified models');
  assert.equal(scoreRecommended(gu, prompts, runs, models).score, null);
});

test('scoreAccurate counts not_sure as wrong and reports it separately', () => {
  const checks = [
    { fact: 'price', result: 'right', repeat_no: 1 }, { fact: 'price', result: 'wrong', repeat_no: 2 },
    { fact: 'drop', result: 'not_sure', repeat_no: 1 }, { fact: 'drop', result: 'right', repeat_no: 2 },
  ];
  const r = scoreAccurate(checks);
  assert.equal(r.score, 50);
  assert.equal(r.detail.not_sure_rate, 25);
  assert.deepEqual(r.detail.by_fact, { price: 50, drop: 50 });
});

test('scoreSourced and scoreRouting look only at answers that name the brand', () => {
  const runs = [
    run('S1', 1, ['brooks'], { citations: [{ kind: 'brand' }, { kind: 'forum' }], routes: [{ retailer_slug: 'amazon' }, { retailer_slug: 'brand-site' }] }),
    run('S1', 2, ['hoka'], { citations: [{ kind: 'other' }], routes: [{ retailer_slug: 'amazon' }] }),
  ];
  const retailers = [{ slug: 'amazon', kind: 'marketplace' }, { slug: 'fleet-feet', kind: 'run-specialty' }];
  assert.equal(scoreSourced(brooks, runs).detail.answers, 1);
  assert.equal(scoreRouting(brooks, runs, retailers).score, 50);
  assert.equal(scoreRouting(hoka, runs, retailers).score, 0);
});

test('scoreSourced grades only named sources and counts not-provided and no-search answers beside it', () => {
  const runs = [
    run('S1', 1, ['brooks'], { citations: [{ kind: 'review' }, { kind: 'forum' }, { kind: 'brand', source: 'searched' }], searches: 1 }),
    run('S1', 2, ['brooks'], { citations: [{ kind: 'brand', source: 'searched' }, { kind: 'review', source: 'searched' }], searches: 2 }),
    run('S1', 3, ['brooks'], { citations: [], searches: 0 }),
  ];
  // Five answers that each name a review and a forum page, plus the two unsourced ones above.
  const five = [1, 2, 3, 4, 5].map(i => run('S2', i, ['brooks'], { citations: [{ kind: 'review' }, { kind: 'forum' }, { kind: 'brand', source: 'searched' }], searches: 1 }));
  const r = scoreSourced(brooks, [...five, ...runs.slice(1)]);
  assert.equal(r.score, 50);           // one review out of review + forum each time; the searched pages are ignored
  assert.equal(r.n, 10);
  assert.deepEqual([r.detail.answers, r.detail.sourced, r.detail.not_provided, r.detail.no_search], [7, 5, 1, 1]);
  // Fewer than five answers that name a source: no score, and the detail says why.
  const few = scoreSourced(brooks, runs);
  assert.equal(few.score, null);
  assert.equal(few.detail.too_few, true);
  assert.deepEqual([few.detail.sourced, few.detail.min], [1, 5]);
  // An engine that searches but never names a source gives no score, only the counts.
  const none = scoreSourced(brooks, runs.slice(1));
  assert.equal(none.score, null);
  assert.deepEqual([none.detail.not_provided, none.detail.no_search], [1, 1]);
  assert.equal(sourcing({ citations: [], searches: 0 }), 'no_search');
  assert.equal(sourcing({ citations: [{ source: 'searched' }] }), 'not_provided');
  assert.equal(sourcing({ citations: [{ source: 'cited' }] }), 'sourced');
});

test('scoreSourced counts non-US brand sites as brand sites and says how many', () => {
  const runs = [1, 2, 3, 4, 5].map(i => run('S1', i, ['hoka'], { citations: [{ kind: 'brand', brand_slug: 'hoka', intl: i <= 2 }, { kind: 'other' }], searches: 1 }));
  const r = scoreSourced(hoka, runs);
  assert.equal(r.score, 50);
  assert.equal(r.detail.intl_own_site, 2);
});

test('scoreSourced counts only the brand\'s own sites, not another brand\'s', () => {
  const runs = [1, 2, 3, 4, 5].map(i => run('S1', i, ['hoka', 'brooks'], { citations: [{ kind: 'brand', brand_slug: 'hoka' }, { kind: 'brand', brand_slug: 'brooks' }], searches: 1 }));
  const r = scoreSourced(hoka, runs);
  assert.equal(r.score, 50);
  assert.deepEqual([r.detail.kinds.brand, r.detail.kinds.other_brand, r.detail.own_site_share], [5, 5, 50]);
});

test('scoreRouting counts only the brand\'s own site; a competitor\'s site is not a place to buy this brand', () => {
  const retailers = [{ slug: 'amazon', kind: 'marketplace' }];
  const runs = [
    run('S1', 1, ['hoka', 'brooks'], { routes: [{ retailer_slug: 'brand-site', brand_slug: 'brooks' }] }),
    run('S1', 2, ['hoka', 'brooks'], { routes: [{ retailer_slug: 'brand-site', brand_slug: 'hoka' }, { retailer_slug: 'brand-site', brand_slug: 'brooks' }] }),
    run('S1', 3, ['hoka'], { routes: [{ retailer_slug: 'brand-site', brand_slug: null }, { retailer_slug: 'amazon' }] }),
  ];
  const r = scoreRouting(hoka, runs, retailers);
  assert.equal(r.n, 3);            // nothing (only Brooks' site), brand-site, brand-site + amazon
  assert.equal(r.score, 66.7);
  assert.deepEqual(r.detail.by_retailer, { 'brand-site': 2, amazon: 1 });
  assert.equal(scoreRouting(brooks, runs, retailers).score, 100); // its own site in both answers that name it
  // The routing table counts answers: two brands' sites in one answer are one "brand-site".
  const t = routingTable(runs, [{ id: 'S1', category: 'shoes' }]);
  assert.deepEqual(t.shoes.by_retailer, { 'brand-site': 3, amazon: 1 });
});

test('scoreRouting is unchanged by the Sourced rules', () => {
  const runs = [
    run('S1', 1, ['brooks'], { citations: [], routes: [{ retailer_slug: 'amazon' }, { retailer_slug: 'brand-site' }] }),
    run('S1', 2, ['hoka'], { citations: [], routes: [{ retailer_slug: 'amazon' }] }),
  ];
  const retailers = [{ slug: 'amazon', kind: 'marketplace' }, { slug: 'fleet-feet', kind: 'run-specialty' }];
  assert.equal(scoreRouting(brooks, runs, retailers).score, 50);
  assert.equal(scoreRouting(hoka, runs, retailers).score, 0);
});

test('overall renormalises weights over the subjects present and needs at least three', () => {
  const two = overall({ recommended: { score: 80 }, sourced: { score: 40 } });
  assert.equal(two.score, null);
  const three = overall({ recommended: { score: 80, margin: 2 }, sourced: { score: 40 }, routing: { score: 60 } });
  assert.equal(three.score, Math.round((80 * 35 + 40 * 10 + 60 * 10) / 55 * 10) / 10);
  assert.equal(Object.values(WEIGHTS).reduce((a, b) => a + b, 0), 100);
});

test('scoreShoppable and routingTable', () => {
  assert.equal(scoreShoppable([{ item: 'widths', result: 1 }, { item: 'cart', result: 0 }]).score, 50);
  const t = routingTable([run('S1', 1, [], { routes: [{ retailer_slug: 'amazon' }] }), run('C1', 1, [], { routes: [] })], prompts);
  assert.deepEqual(t.shoes, { answers: 1, with_route: 1, by_retailer: { amazon: 1 } });
  assert.deepEqual(t.fuel, { answers: 1, with_route: 0, by_retailer: {} });
});
