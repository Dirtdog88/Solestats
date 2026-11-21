import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { parseCsv } from '../src/2026-11-21-csv.js';

const file = new URL('../data/2026-11-21-financials.csv', import.meta.url);
const rows = existsSync(file) ? parseCsv(readFileSync(file, 'utf8')) : [];
const brands = new Set(parseCsv(readFileSync(new URL('../data/2026-11-21-brands.csv', import.meta.url), 'utf8')).map(b => b.slug));

test('every financials row names a watched brand, a primary source and a quote; numbers add up', () => {
  for (const r of rows) {
    const id = `${r.brand} ${r.fiscal_year} ${r.measure}`;
    assert.ok(brands.has(r.brand), `${id}: unknown brand`);
    assert.match(r.level, /^(brand|category|footwear|segment|company)$/, id);
    assert.match(r.source_url, /^https:\/\//, id);
    assert.ok(r.source_type, `${id}: source type`); // published_on may be blank where the source prints no date
    if (r.value === '') { assert.ok(r.notes, `${id}: not disclosed needs a note`); continue; }
    assert.ok(r.quote, `${id}: quote the source`);
    assert.match(r.currency, /^[A-Z]{3}$/, id);
    assert.match(r.unit, /^(millions|billions)$/, id);
    if (r.prior_value !== '' && r.yoy_pct !== '') {
      const calc = (Number(r.value) / Number(r.prior_value) - 1) * 100;
      assert.ok(Math.abs(calc - Number(r.yoy_pct)) < 0.6, `${id}: yoy ${r.yoy_pct} vs ${calc.toFixed(1)}`);
    }
  }
});

test('the loader replaces the table and loads only checked rows', () => {
  const db = new DatabaseSync(':memory:');
  for (const f of ['0001_init.sql', '0002_pulse.sql', '0003_financials.sql']) db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
  db.exec(execFileSync(process.execPath, [new URL('../scripts/2026-11-21-seed.js', import.meta.url).pathname], { encoding: 'utf8' }));
  const sql = execFileSync(process.execPath, [new URL('../scripts/2026-11-21-financials.js', import.meta.url).pathname], { encoding: 'utf8' });
  assert.match(sql, /^DELETE FROM financials;/);
  db.exec(sql); db.exec(sql); // twice: no duplicate-key error
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM financials').get().n, rows.filter(r => r.checked_on).length);
});
