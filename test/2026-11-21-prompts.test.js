import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv } from '../src/2026-11-21-csv.js';

const prompts = parseCsv(readFileSync(new URL('../data/2026-11-21-prompts.csv', import.meta.url), 'utf8'));
const brands = parseCsv(readFileSync(new URL('../data/2026-11-21-brands.csv', import.meta.url), 'utf8'));

test('the prompt set is the planned 260: 102 shoe, 28 head-to-head, 120 scan, 10 retailer', () => {
  const by = {};
  for (const p of prompts) by[p.set] = (by[p.set] || 0) + 1;
  assert.deepEqual(by, { shoe: 102, h2h: 28, scan: 120, retailer: 10 });
  assert.equal(new Set(prompts.map(p => p.id)).size, 260);
});

test('every scan category has 20 prompts', () => {
  const by = {};
  for (const p of prompts.filter(p => p.set === 'scan')) by[p.category] = (by[p.category] || 0) + 1;
  assert.deepEqual(by, { apparel: 20, watches: 20, fuel: 20, vests: 20, audio_lights_eyewear: 20, recovery: 20 });
});

test('outside the head-to-head set, no prompt names a brand', () => {
  // "On" is an ordinary word: for that brand only the capitalised brand forms count.
  const names = brands.filter(b => b.slug !== 'on').flatMap(b => [b.name, ...(b.aliases ? b.aliases.split(';') : [])]).map(s => s.trim()).filter(s => s.length > 2);
  const offenders = [];
  for (const p of prompts.filter(p => p.set !== 'h2h')) {
    if (/\bOn (Running|Cloud)/.test(p.text)) offenders.push(`${p.id}: On`);
    for (const n of names) {
      const re = new RegExp('\\b' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      if (re.test(p.text)) offenders.push(`${p.id}: ${n}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('every shoe prompt carries at least one need tag, and head-to-head rows name both brands', () => {
  for (const p of prompts.filter(p => p.set === 'shoe')) assert.ok(p.tags, `${p.id} has no tags`);
  for (const p of prompts.filter(p => p.set === 'h2h')) {
    assert.ok(p.pair_a && p.pair_b && p.pair_a !== p.pair_b, p.id);
    assert.ok(p.text.includes(`${p.pair_a} or ${p.pair_b}`), p.id);
  }
});

test('brand slugs are unique and every brand has a category the prompts use', () => {
  assert.equal(new Set(brands.map(b => b.slug)).size, brands.length);
  const cats = new Set(prompts.map(p => p.category));
  for (const b of brands) assert.ok(cats.has(b.category), `${b.slug}: ${b.category}`);
});
