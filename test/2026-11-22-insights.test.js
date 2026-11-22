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

test('engineSplit scores each engine alone; engineFixes flags an engine more than 10 points below all the others', async () => {
  const { engineSplit, engineFixes } = await import('../src/2026-11-22-insights.js');
  const runs = [{ engine: 'openai', v: 80 }, { engine: 'anthropic', v: 75 }, { engine: 'gemini', v: 60 }];
  const split = engineSplit(runs, { recommended: rs => ({ score: rs[0].v, n: 30 }), sourced: rs => ({ score: rs[0].engine === 'anthropic' ? null : rs[0].v - 20, n: 25 }) });
  assert.deepEqual(Object.keys(split.sourced.by_engine), ['gemini', 'openai']);   // no score on Claude: left out
  const fixes = engineFixes('brooks', split, s => s[0].toUpperCase() + s.slice(1));
  assert.deepEqual(fixes.map(f => f.subject), ['recommended', 'sourced']);
  assert.equal(fixes[0].text, 'Close the gap on Gemini: Recommended there is 60, against 75 on Claude and 80 on ChatGPT.');
  // 10 points or less below one of the others: no fix.
  assert.deepEqual(engineFixes('b', { recommended: { by_engine: { openai: { score: 70, n: 30 }, anthropic: { score: 55, n: 30 }, gemini: { score: 60, n: 30 } } } }), []);
  // Too few observations on an engine: it takes no part.
  assert.deepEqual(engineFixes('b', { routing: { by_engine: { openai: { score: 100, n: 3 }, gemini: { score: 0, n: 2 } } } }), []);
});

test('editionSummary builds every sentence from the data: leaders, voice vs size, engine gap, sourcing', async () => {
  const { editionSummary, topSourceDomains } = await import('../src/2026-11-22-insights.js');
  const engines = [{ engine: 'anthropic', runs: 100, cited: 0 }, { engine: 'openai', runs: 100, cited: 100 }];
  const brands = [
    { slug: 'a', name: 'Alpha', overall: 64, overall_provisional: true, sov: 12.0, voice_ratio: 3.3 },
    { slug: 'b', name: 'Beta', overall: 61, sov: 15.7, voice_ratio: 0.4 },
    { slug: 'c', name: 'Gamma', overall: 40, sov: 2, voice_ratio: 0.1, voice_ratio_wide: true },
  ];
  const engineViews = { b: { recommended: { by_engine: { anthropic: { score: 69, n: 300 }, openai: { score: 27, n: 300 } } } }, a: { routing: { by_engine: { openai: { score: 90, n: 5 }, anthropic: { score: 10, n: 5 } } } } };
  const s = editionSummary({ engines, brands, engineViews, sources: { top: [{ domain: 'runrepeat.com', answers: 40 }] } });
  assert.equal(s.length, 4);
  assert.equal(s[0], 'Across 200 answers from Claude and ChatGPT, Alpha has the highest provisional Overall (64, level with Beta at 61), and Beta the largest share of voice (15.7% of brand mentions).');
  assert.equal(s[1], 'Among the 2 brands with a brand or running-level revenue figure, Alpha gets the most share of voice for its size (3.3×) and Beta the least (0.40×); context, not cause.');
  assert.match(editionSummary({ brands: [{ name: 'A', voice_ratio: 4 }, { name: 'B', voice_ratio: 2 }] })[0], /B the least \(2\.0×\); all of them get more voice than their size alone would suggest; context, not cause\.$/);
  assert.equal(s[2], "The engines disagree most on Beta's Recommended score: 69 on Claude's answers against 27 on ChatGPT's.");  // Alpha's routing gap has too few observations
  assert.equal(s[3], '50% of answers named their sources: ChatGPT in 100%, Claude in none; outside brand sites, the most named was runrepeat.com (40 answers).');
  assert.deepEqual(editionSummary({}), []);
  const t = topSourceDomains([{ status: 'ok', citations: [{ domain: 'x.com', kind: 'review', source: 'cited' }, { domain: 'x.com', kind: 'review', source: 'cited' }, { domain: 'b.com', kind: 'brand', source: 'cited' }, { domain: 'y.com', kind: 'forum', source: 'searched' }] }]);
  assert.deepEqual(t, { sourced_answers: 1, top: [{ domain: 'x.com', kind: 'review', answers: 1 }] });
});

test('enginePatterns: a gap one engine shows for most brands leaves the fixes and becomes a pattern', async () => {
  const { enginePatterns, editionSummary } = await import('../src/2026-11-22-insights.js');
  const v = (g, o) => ({ sourced: { by_engine: { gemini: { score: g, n: 30 }, openai: { score: o, n: 30 } } }, recommended: { by_engine: { gemini: { score: 50, n: 30 }, openai: { score: 50, n: 30 } } } });
  const views = { a: v(20, 50), b: v(20, 45), c: v(40, 45) };
  const fixes = [{ brand: 'a', subject: 'sourced', engine: 'gemini' }, { brand: 'b', subject: 'sourced', engine: 'gemini' }, { brand: 'c', subject: 'recommended', engine: 'openai' }];
  const r = enginePatterns(fixes, views);
  assert.deepEqual(r.patterns, [{ engine: 'gemini', subject: 'sourced', brands_low: 2, brands_compared: 3 }]);
  assert.deepEqual(r.fixes.map(f => f.brand), ['c']);   // 1 of 3 on recommended is not a pattern
  assert.deepEqual(enginePatterns(fixes.slice(0, 1), views).patterns, []); // 1 of 3: stays a fix
  assert.equal(editionSummary({ patterns: r.patterns })[0], 'Gemini scores more than 10 points below the other engines on Sourced for 2 of the 3 brands compared, which says more about the engine than about any brand.');
});

test('modelsIn: names, aliases and versions; common words need their brand or a version; longest name first', async () => {
  const { modelMatchers, modelsIn, modelView } = await import('../src/2026-11-22-extract.js');
  const models = [{ id: 'brooks/ghost', brand_slug: 'brooks', name: 'Ghost' }, { id: 'saucony/ride', brand_slug: 'saucony', name: 'Ride' },
    { id: 'nike/pegasus', brand_slug: 'nike', name: 'Pegasus' }, { id: 'nike/pegasus-trail', brand_slug: 'nike', name: 'Pegasus Trail' },
    { id: 'asics/gel-nimbus', brand_slug: 'asics', name: 'Gel-Nimbus' }, { id: 'new-balance/fresh-foam-x-1080', brand_slug: 'new-balance', name: 'Fresh Foam X 1080' },
    { id: 'adidas/adizero-boston', brand_slug: 'adidas', name: 'Adizero Boston' }];
  const aliases = [{ id: 'saucony/ride', needs_context: '1' }, { id: 'asics/gel-nimbus', aliases: 'Nimbus' }, { id: 'new-balance/fresh-foam-x-1080', aliases: '1080' }, { id: 'adidas/adizero-boston', aliases: 'Boston', needs_context: '1' }];
  const brands = [{ slug: 'saucony', name: 'Saucony' }, { slug: 'adidas', name: 'adidas', aliases: 'Adidas' }];
  const M = modelMatchers(models, aliases, brands);
  const names = t => modelsIn(t, M).map(m => m.name + (m.versions.length ? ' ' + m.versions.join('/') : '')).sort();
  assert.deepEqual(names('Try the **Brooks Ghost 17** or [Ghost 16](https://x).'), ['Ghost 17/16']);
  assert.deepEqual(names('The Saucony Ride gives a smooth ride; the Ride 18 too.'), ['Ride 18']);
  assert.deepEqual(names('a smooth ride on a long run'), []);
  assert.deepEqual(names('Pegasus Trail 5 and Pegasus 41'), ['Pegasus 41', 'Pegasus Trail 5']);
  assert.deepEqual(names('Gel Nimbus 27 or a Nimbus; New Balance 1080v14'), ['Fresh Foam X 1080 14', 'Gel-Nimbus 27']);
  assert.deepEqual(names('the Boston Marathon; Adidas Boston 13'), ['Adizero Boston 13']);
  const runs = [
    { status: 'ok', prompt_id: 'S1', mentions: [{ brand_slug: 'brooks' }, { brand_slug: 'nike' }], answer: 'Ghost 17 or Pegasus 41' },
    { status: 'ok', prompt_id: 'S1', mentions: [{ brand_slug: 'brooks' }], answer: 'Brooks Ghost 16, or any Brooks' },
    { status: 'ok', prompt_id: 'S1', mentions: [{ brand_slug: 'brooks' }], answer: 'Brooks makes good shoes' },
  ];
  const v = modelView(runs, [{ id: 'S1', set: 'shoe' }], M, ['brooks']);
  assert.equal(v.brooks.answers, 3);
  assert.deepEqual(v.brooks.models[0], { id: 'brooks/ghost', name: 'Ghost', answers: 2, share: 66.7, versions: [{ version: 17, answers: 1 }, { version: 16, answers: 1 }], beside: { id: 'nike/pegasus', name: 'Pegasus', brand_slug: 'nike', answers: 1 } });
});

test('segments carry a shoe title to the bullets under it; steeringView and versionCurrency', async () => {
  const { modelMatchers, segments, steeringView, versionCurrency } = await import('../src/2026-11-22-extract.js');
  const M = modelMatchers([{ id: 'brooks/ghost', brand_slug: 'brooks', name: 'Ghost' }, { id: 'hoka/clifton', brand_slug: 'hoka', name: 'Clifton' }], [], []);
  const fb = t => (/\bBrooks\b/.test(t) ? ['brooks'] : []).concat(/\bHoka\b/.test(t) ? ['hoka'] : []);
  const segs = segments('**Brooks Ghost 17**\n- Soft. Last year\'s model is often on sale.\n**Hoka Clifton 10:**\n- Very cushioned.\nAny of these work.', fb, M);
  assert.deepEqual(segs.map(s => s.brands), [['brooks'], ['brooks'], ['brooks'], ['hoka'], ['hoka'], []]);
  const runs = [
    { status: 'ok', prompt_id: 'S1', engine: 'openai', mentions: [{ brand_slug: 'brooks' }, { brand_slug: 'hoka' }], answer: '**Brooks Ghost 17**\n- Last year\'s model is often on sale.\n**Hoka Clifton 10**\n- Plush.' },
    { status: 'ok', prompt_id: 'S1', engine: 'anthropic', mentions: [{ brand_slug: 'brooks' }], answer: 'The Brooks Ghost is a safe daily trainer.' },
    { status: 'ok', prompt_id: 'S1', engine: 'anthropic', mentions: [{ brand_slug: 'hoka' }], answer: 'Hoka Clifton. Check the outlet for discounts.' },
  ];
  const v = steeringView(runs, [{ id: 'S1', set: 'shoe' }], fb, M, ['brooks', 'hoka']);
  assert.deepEqual(v.brooks, { answers: 2, older: 50, deal: 50, any: 50, by_engine: { anthropic: 0, openai: 100 } });
  assert.deepEqual([v.hoka.older, v.hoka.deal], [0, 50]);   // 'Check the outlet' follows a sentence naming Hoka on the same line
  assert.deepEqual(v[''], { pairs: 4, any: 50 });          // brooks 1 of 2, hoka 1 of 2
  const slice = { models: [{ id: 'brooks/ghost', name: 'Ghost', versions: [{ version: 17, answers: 6 }, { version: 16, answers: 2 }] }] };
  assert.deepEqual(versionCurrency(slice, [{ id: 'brooks/ghost', version: '17', verified_on: '' }]), { pending: true });
  assert.deepEqual(versionCurrency(slice, [{ id: 'brooks/ghost', version: '17', verified_on: '2026-12-01' }]), { pending: false, named: 8, current_share: 75, models: [{ id: 'brooks/ghost', name: 'Ghost', current: 17, named: 8, current_share: 75 }] });
});

test('substitutionView: who got the first pick where the brand had a credible shoe and was not named', async () => {
  const { substitutionView } = await import('../src/2026-11-22-extract.js');
  const { eligible } = await import('../src/2026-11-21-score.js');
  const prompts = [{ id: 'S1', set: 'shoe', category: 'shoes', tags: 'stability', group: 'stability' }, { id: 'S2', set: 'shoe', category: 'shoes', tags: 'trail', group: 'trail' }];
  const spec = [{ brand_slug: 'brooks', needs: 'stability', verified_on: '' }];
  const r = (prompt_id, ms) => ({ status: 'ok', prompt_id, mentions: ms.map(([s, t]) => ({ brand_slug: s, top_pick: t })) });
  const runs = [r('S1', [['hoka', 1], ['asics', 0]]), r('S1', [['hoka', 1]]), r('S1', [['brooks', 1]]), r('S1', []), r('S2', [['salomon', 1]])];
  const v = substitutionView(runs, prompts, [{ slug: 'brooks', name: 'Brooks', category: 'shoes' }], spec, eligible, { stability: 'Stability' });
  assert.deepEqual(v.brooks, { basis: 'draft', eligible: 4, missed: 3, substitutes: [{ slug: 'hoka', answers: 2, share: 66.7 }], no_pick: 1,
    groups: [{ id: 'stability', label: 'Stability', missed: 3, top: { slug: 'hoka', share: 66.7 } }] });   // trail is not credible for Brooks's draft rows
});

test('attributeView: attribute words in the pieces about each brand, cautions not after a negation, pooled share', async () => {
  const { modelMatchers, attributeMatchers, attributeView, usesAttribute } = await import('../src/2026-11-22-extract.js');
  const A = attributeMatchers([{ attribute: 'cushioning', kind: 'trait', label: 'Cushioning', phrases: 'cushion*;plush' }, { attribute: 'caution_ride', kind: 'caution', label: 'Ride concern', phrases: 'too firm;harsh' }, { attribute: 'price', kind: 'trait', phrases: '$;budget' }]);
  assert.equal(usesAttribute(A[1], 'not too soft or too firm'), false);
  assert.equal(usesAttribute(A[1], 'the ride is too firm'), true);
  assert.equal(usesAttribute(A[2], 'about $130'), true);
  assert.equal(usesAttribute(A[0], 'well-cushioned'), true);
  const fb = t => (/\bBrooks\b/.test(t) ? ['brooks'] : []).concat(/\bHoka\b/.test(t) ? ['hoka'] : []);
  const M = modelMatchers([], [], []);
  const runs = [
    { status: 'ok', prompt_id: 'S1', mentions: [{ brand_slug: 'brooks' }, { brand_slug: 'hoka' }], answer: 'Brooks is plush. Hoka feels too firm.' },
    { status: 'ok', prompt_id: 'S1', mentions: [{ brand_slug: 'brooks' }], answer: 'Brooks is not harsh at all.' },
  ];
  const v = attributeView(runs, [{ id: 'S1', set: 'shoe' }], fb, M, A, ['brooks', 'hoka']);
  assert.deepEqual(v.brooks.attributes.map(a => [a.attribute, a.share]), [['cushioning', 50], ['caution_ride', 0], ['price', 0]]);
  assert.deepEqual(v.hoka.attributes.map(a => [a.attribute, a.share]), [['cushioning', 0], ['caution_ride', 100], ['price', 0]]);
  assert.deepEqual(v[''], { cushioning: 33.3, caution_ride: 33.3, price: 0 });
});
