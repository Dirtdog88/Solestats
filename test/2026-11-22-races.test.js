import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { parseCsv } from '../src/2026-11-21-csv.js';
import { brandSlugFor, brandCounts } from '../src/2026-11-22-races.js';

const brands = parseCsv(readFileSync(new URL('../data/2026-11-21-brands.csv', import.meta.url), 'utf8'));
const file = new URL('../data/2026-11-22-race-results.csv', import.meta.url);
const rows = existsSync(file) ? parseCsv(readFileSync(file, 'utf8')) : [];

test('brandSlugFor matches watched brands by name or alias and leaves others out', () => {
  assert.equal(brandSlugFor('ASICS', brands), 'asics');
  assert.equal(brandSlugFor('HOKA', brands), 'hoka');
  assert.equal(brandSlugFor('New Balance', brands), 'new-balance');
  assert.equal(brandSlugFor('adidas', brands), 'adidas');
  assert.equal(brandSlugFor('On Running', brands), 'on');
  assert.equal(brandSlugFor('Li-Ning', brands), null);
  assert.equal(brandSlugFor('', brands), null);
});

test('brandCounts counts top 10, podiums, wins and shares over confirmed shoes only', () => {
  const r = (place, brand, brand_slug, basis = 'worn') => ({ race: 'X', year: 2025, gender: 'men', place, brand, brand_slug, basis });
  const c = brandCounts([r(1, 'Nike', 'nike'), r(2, 'adidas', 'adidas'), r(3, 'Nike', 'nike', 'sponsor'), r(4, 'Li-Ning', null), r(5, null, null, 'unknown')]);
  assert.equal(c.places, 5);
  assert.equal(c.known, 4);
  const nike = c.brands.find(b => b.slug === 'nike');
  assert.deepEqual([nike.top10, nike.podiums, nike.wins, nike.worn, nike.top10_share], [2, 2, 1, 1, 50]);
  assert.ok(c.brands.some(b => b.key === 'other:Li-Ning' && b.top10_share === 25));
});

test('every race result row has a place 1-10, a gender, an official results source; shoe rows name their source', () => {
  for (const r of rows) {
    const id = `${r.race} ${r.year} ${r.gender} ${r.place}`;
    assert.ok(Number(r.place) >= 1 && Number(r.place) <= 10, id);
    assert.match(r.gender, /^(men|women)$/, id);
    assert.match(r.results_url, /^https:\/\//, id);
    assert.match(r.basis, /^(worn|sponsor|unknown)$/, id);
    if (r.basis !== 'unknown') { assert.ok(r.brand, `${id}: brand`); assert.match(r.shoe_source_url, /^https:\/\//, `${id}: shoe source`); }
  }
  const keys = rows.map(r => `${r.race} ${r.year} ${r.gender} ${r.place}`);
  assert.equal(new Set(keys).size, keys.length, 'no duplicate places');
});

test('the races loader replaces the table and counts only checked shoes', () => {
  const db = new DatabaseSync(':memory:');
  for (const f of ['0001_init.sql', '0002_pulse.sql', '0005_race_results.sql']) db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
  const sql = execFileSync(process.execPath, [new URL('../scripts/2026-11-22-races.js', import.meta.url).pathname], { encoding: 'utf8' });
  db.exec(sql); db.exec(sql);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM race_results').get().n, rows.filter(r => r.checked_on).length);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM race_results WHERE brand IS NOT NULL').get().n, rows.filter(r => r.checked_on && r.shoe_checked_on && r.brand).length);
});
