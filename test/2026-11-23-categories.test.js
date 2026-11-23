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
