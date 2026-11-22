import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv } from '../src/2026-11-21-csv.js';

const prompts = parseCsv(readFileSync(new URL('../data/2026-11-21-prompts.csv', import.meta.url), 'utf8'));
const brands = parseCsv(readFileSync(new URL('../data/2026-11-21-brands.csv', import.meta.url), 'utf8'));

test('the prompt set is the planned 138: 102 shoe, 28 head-to-head, 8 retailer (scan categories are parked)', () => {
  const by = {};
  for (const p of prompts) by[p.set] = (by[p.set] || 0) + 1;
  assert.deepEqual(by, { shoe: 102, h2h: 28, retailer: 8 });
  assert.equal(new Set(prompts.map(p => p.id)).size, 138);
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

test('the monthly pulse is about 30 prompts, none head-to-head, spread across the need groups', () => {
  const pulse = prompts.filter(p => p.pulse === '1');
  assert.ok(pulse.length >= 28 && pulse.length <= 32, String(pulse.length));
  assert.equal(pulse.filter(p => p.set === 'h2h').length, 0);
  assert.equal(pulse.filter(p => p.set === 'retailer').length, 2);
  const tags = new Set(pulse.flatMap(p => (p.tags || '').split(';')));
  for (const t of ['beginner', 'budget', 'max-cushion', 'stability', 'wide', 'racing', 'trail', 'zero-drop', 'treadmill', 'women']) assert.ok(tags.has(t), t);
});

test('the Shoppable checklist has twelve items with a question and a way to check each', () => {
  const items = parseCsv(readFileSync(new URL('../data/2026-11-21-shoppable-checklist.csv', import.meta.url), 'utf8'));
  assert.equal(items.length, 12);
  assert.equal(new Set(items.map(i => i.item)).size, 12);
  for (const i of items) assert.ok(i.question.length > 20 && i.how_to_check.length > 20, i.item);
});

test('every shoe prompt carries at least one need tag, and head-to-head rows name both brands', () => {
  for (const p of prompts.filter(p => p.set === 'shoe')) assert.ok(p.tags, `${p.id} has no tags`);
  for (const p of prompts.filter(p => p.set === 'h2h')) {
    assert.ok(p.pair_a && p.pair_b && p.pair_a !== p.pair_b, p.id);
    assert.ok(p.text.includes(`${p.pair_a} or ${p.pair_b}`), p.id);
  }
});

test('brand slugs are unique and, with the scan categories parked, every brand is a shoe brand', () => {
  assert.equal(new Set(brands.map(b => b.slug)).size, brands.length);
  for (const b of brands) assert.equal(b.category, 'shoes', b.slug);
  assert.equal(brands.length, 18);
});

test('every shoe prompt has one of the 11 need groups; other prompts have none', () => {
  const GROUPS = ['starting-out', 'budget', 'cushion', 'stability', 'fit', 'racing', 'trail', 'drop', 'conditions', 'people', 'brand'];
  for (const p of prompts) {
    if (p.set === 'shoe') assert.ok(GROUPS.includes(p.group), `${p.id}: ${p.group}`);
    else assert.equal(p.group || '', '', p.id);
  }
  assert.equal(new Set(prompts.filter(p => p.set === 'shoe').map(p => p.group)).size, 11);
});
