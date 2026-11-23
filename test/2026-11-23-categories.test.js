// Categories (energy gels, 2026-11-23): the round id carries the category, in JS and in SQL, and gel brands are scored
// only on gel prompts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { CATEGORIES, categoryOfRound, ROUND_CATEGORY_SQL, isNeed } from '../src/2026-11-23-categories.js';
import { eligible } from '../src/2026-11-21-score.js';
import { parseCsv } from '../src/2026-11-21-csv.js';

test('a round id names its category; plain month ids are shoes', () => {
  assert.equal(categoryOfRound('2026-11'), 'shoes');
  assert.equal(categoryOfRound('gels-2026-12'), 'gels');
  assert.equal(categoryOfRound('gels-2026-12-dry'), 'gels');
  assert.equal(categoryOfRound('socks-2026-12'), 'shoes', 'an unknown prefix falls back to shoes');
  assert.equal(categoryOfRound(''), 'shoes');
});

test('the SQL rule reads round ids the same way', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE rounds (id TEXT)');
  for (const id of ['2026-11', '2026-12', 'gels-2026-12']) db.prepare('INSERT INTO rounds (id) VALUES (?)').run(id);
  const rows = db.prepare(`SELECT id, ${ROUND_CATEGORY_SQL} AS cat FROM rounds ORDER BY id`).all();
  for (const r of rows) assert.equal(r.cat, categoryOfRound(r.id), r.id);
});

test('need questions are "shoe" for shoes and "need" for later categories', () => {
  assert.ok(isNeed({ set_name: 'shoe' }));
  assert.ok(isNeed({ set: 'need' }));
  assert.ok(!isNeed({ set_name: 'h2h' }));
  assert.ok(!isNeed({ set_name: 'retailer' }));
});

test('gel brands are scored on gel questions only, and a head-to-head counts only for its two brands', () => {
  const gu = { slug: 'gu', name: 'GU', category: 'gels' };
  const maurten = { slug: 'maurten', name: 'Maurten', category: 'gels' };
  const sis = { slug: 'sis', name: 'SiS', category: 'gels' };
  const need = { id: 'g1', set_name: 'need', category: 'gels', tags: 'marathon' };
  const shoe = { id: 's1', set_name: 'shoe', category: 'shoes', tags: 'daily' };
  const pair = { id: 'g2', set_name: 'h2h', category: 'gels', tags: 'h2h', pair_a: 'GU', pair_b: 'Maurten' };
  assert.ok(eligible(gu, need, []));
  assert.ok(!eligible(gu, shoe, []));
  assert.ok(eligible(gu, pair, []) && eligible(maurten, pair, []));
  assert.ok(!eligible(sis, pair, []));
});

test('each category names data files that exist (prompts arrive later for new categories)', () => {
  for (const [key, c] of Object.entries(CATEGORIES)) {
    for (const f of [c.brands, c.models, c.aliases, c.attributes].filter(Boolean)) assert.doesNotThrow(() => readFileSync(new URL(`../data/${f}`, import.meta.url)), `${key}: ${f}`);
  }
});

test('the gel brand list is all in category gels, with unique slugs', () => {
  const rows = parseCsv(readFileSync(new URL('../data/2026-11-23-gel-brands.csv', import.meta.url), 'utf8'));
  assert.ok(rows.length >= 10);
  assert.ok(rows.every(r => r.category === 'gels'));
  assert.equal(new Set(rows.map(r => r.slug)).size, rows.length);
  assert.ok(rows.some(r => r.slug === 'gu' && r.treatment === 'full'));
});

test('the gel prompts: need questions name no brand, pairs name two gel brands, every need group is known', async () => {
  const { GEL_GROUPS } = await import('../src/2026-11-22-insights.js');
  const prompts = parseCsv(readFileSync(new URL('../data/2026-11-23-gel-prompts.csv', import.meta.url), 'utf8'));
  const brands = parseCsv(readFileSync(new URL('../data/2026-11-23-gel-brands.csv', import.meta.url), 'utf8'));
  assert.equal(new Set(prompts.map(p => p.id)).size, prompts.length);
  for (const p of prompts) assert.ok(['need', 'h2h', 'retailer'].includes(p.set) && /^\d$/.test(p.pulse), `${p.id}: columns shifted (an unquoted comma?)`);
  const names = brands.flatMap(b => [b.name, ...(b.aliases ? b.aliases.split(';') : [])]).map(s => s.trim()).filter(s => s.length > 2);
  const groups = new Set(GEL_GROUPS.map(([id]) => id));
  for (const p of prompts) {
    if (p.set === 'h2h') { assert.ok([p.pair_a, p.pair_b].every(n => brands.some(b => b.name === n)), p.id); continue; }
    for (const n of names) assert.ok(!new RegExp('\\b' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(p.text), `${p.id} names ${n}`);
    if (p.set === 'need') assert.ok(groups.has(p.group), `${p.id}: ${p.group}`);
  }
});

test('need-gap fixes: groups 30+ points behind the leader, largest first, at most three, with who AI picks instead', async () => {
  const { needGapFixes } = await import('../src/2026-11-22-insights.js');
  const needs = { groups: [{ id: 'natural', label: 'Natural and vegan', answers: 60 }, { id: 'stomach', label: 'Stomach', answers: 60 }, { id: 'taste', label: 'Taste', answers: 36 }, { id: 'tiny', label: 'Tiny', answers: 10 }],
    brands: { gu: { natural: { share: 23 }, stomach: { share: 45 }, taste: { share: 78 }, tiny: { share: 0 } }, huma: { natural: { share: 90 }, stomach: { share: 67 }, taste: { share: 40 }, tiny: { share: 90 } }, sis: { natural: { share: 10 }, stomach: { share: 97 }, taste: { share: 58 }, tiny: { share: 0 } } } };
  const sub = { groups: [{ id: 'natural', top: { slug: 'untapped', share: 41.3 } }] };
  const f = needGapFixes('gu', needs, sub, { gu: 'GU', huma: 'Huma', sis: 'SiS', untapped: 'UnTapped' });
  assert.equal(f.length, 2, 'taste is ahead, tiny has too few answers');
  assert.match(f[0].text, /^Close the gap on natural and vegan questions: GU is named in 23% .* against 90% for Huma\. How: .* UnTapped first \(41% of them\)\.$/);
  assert.match(f[1].text, /stomach questions: GU is named in 45% .* against 97% for SiS\.$/);
  assert.ok(f.every(x => x.subject === 'recommended'));
});

test('each category can carry its own preview line', async () => {
  const worker = (await import('../src/2026-11-21-worker.js')).default;
  const env = { PREVIEW_NOTICE: 'Shoe preview', PREVIEW_NOTICE_GELS: 'Gel preview', DB: { prepare: () => ({ bind() { return this; }, first: async () => null, all: async () => ({ results: [] }) }) } };
  const notice = async q => (await (await worker.fetch(new Request('https://solestats.net/api/health' + q), env)).json()).notice;
  assert.equal(await notice(''), 'Shoe preview');
  assert.equal(await notice('?cat=gels'), 'Gel preview');
});
