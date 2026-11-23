// Accurate for gels (2026-11-23): fact questions from confirmed spec rows, the grader's tolerances, and the gel page
// readers the site check uses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { askName, factQuestions, gradeFact } from '../src/2026-11-23-facts.js';
import { readPage, gelEvidence, gelFacts, gelProductUrlsFor, gelNeedPages } from '../src/2026-11-21-sitecheck.js';

test('questions name the brand once and skip blank or unconfirmed facts', () => {
  const brands = [{ slug: 'maurten', name: 'Maurten' }, { slug: 'gu', name: 'GU' }];
  assert.equal(askName({ name: 'Gel 100' }, 'Maurten'), 'Maurten Gel 100');
  assert.equal(askName({ name: 'GU Energy Gel' }, 'GU'), 'GU Energy Gel');
  const rows = [
    { id: 'maurten/gel-100', brand_slug: 'maurten', name: 'Gel 100', carbs_g: '25', caffeine_mg: '0', sodium_mg: '', price_usd: '3.60', vegan: 'yes', verified_on: '2026-11-24' },
    { id: 'gu/energy-gel', brand_slug: 'gu', name: 'GU Energy Gel', carbs_g: '22', caffeine_mg: '', sodium_mg: '60', price_usd: '', vegan: '', verified_on: '' },
  ];
  const q = factQuestions(rows, brands, 'gels');
  assert.deepEqual(q.map(x => x.fact), ['carbs_g', 'caffeine_mg', 'price_usd', 'vegan'], 'blank sodium skipped, unconfirmed GU row skipped');
  assert.equal(q[0].question, 'How many grams of carbohydrate are in one Maurten Gel 100? Start your answer with the number.');
  assert.equal(q[1].expected, 0);
});

test('grading: carbs within 1 g, ranges, caffeine exact and zero, sodium and price within 10%, vegan yes or no', () => {
  const g = (fact, a, e) => gradeFact('gels', fact, a, e).result;
  assert.equal(g('carbs_g', '**25 g.** Maurten Gel 100 has 25 grams of carbohydrate.', 25), 'right');
  assert.equal(g('carbs_g', '24g of carbs per sachet.', 25), 'right');
  assert.equal(g('carbs_g', '21–23 g of carbohydrate, depending on flavour.', 22), 'right');
  assert.equal(g('carbs_g', '40 g', 25), 'wrong');
  assert.equal(g('carbs_g', 'I could not find the exact figure on the label.', 25), 'not_sure');
  assert.equal(g('caffeine_mg', 'None. The Gel 100 is caffeine-free; the CAF 100 has 100 mg.', 0), 'right');
  assert.equal(g('caffeine_mg', '100 mg of caffeine.', 100), 'right');
  assert.equal(g('caffeine_mg', '90 mg', 100), 'wrong');
  assert.equal(g('sodium_mg', 'About 55 mg of sodium.', 60), 'right');
  assert.equal(g('sodium_mg', '200 mg sodium', 60), 'wrong');
  assert.equal(g('price_usd', '$3.50 each, or about $40 for a box of 12.', 3.6), 'right');
  assert.equal(g('price_usd', '$2.50–$3.00 per gel at most stores.', 3.0), 'right');
  assert.equal(g('price_usd', '$45 for a 12-pack.', 3.6), 'wrong');
  assert.equal(g('vegan', 'Yes. It contains no animal products.', 'yes'), 'right');
  assert.equal(g('vegan', 'No, it contains honey.', 'yes'), 'wrong');
  assert.equal(g('vegan', 'It is not vegan because of the honey.', 'no'), 'right');
});

const HTML = `<html><head><title>Roctane Energy Gel | GU</title>
<script type="application/ld+json">{"@type":"Product","name":"Roctane Energy Gel","offers":{"@type":"Offer","price":"2.50","priceCurrency":"USD","availability":"https://schema.org/InStock"}}</script></head>
<body><h1>Roctane Energy Gel</h1><p>Flavors: Vanilla Orange, Cherry Lime</p>
<p>Nutrition: Calories 100. Sodium 125 mg. Total Carbohydrate 21 g. Caffeine 35 mg.</p>
<p>Ingredients: Maltodextrin, water, fructose, sodium citrate. Vegan. Gluten-free.</p>
<a href="/pages/fueling-guide">Fueling guide</a></body></html>`;

test('gel pages: nutrition, ingredients, flavours and draft facts read from plain HTML', () => {
  const page = readPage(HTML, 'https://www.guenergy.com/products/roctane-energy-gel');
  const e = gelEvidence(page);
  assert.ok(e.structured && e.price && e.stock && e.nutrition_in_text && e.ingredients_in_text && e.flavours_listed);
  assert.deepEqual(gelFacts(page), { carbs_g: 21, sodium_mg: 125, caffeine_mg: 35, calories: 100, price_usd: 2.5, vegan: 'yes' });
});

test('gel product URLs and need pages', () => {
  const urls = ['https://www.guenergy.com/blogs/news/roctane-story', 'https://www.guenergy.com/collections/roctane', 'https://www.guenergy.com/products/roctane-energy-gel', 'https://www.maurten.com/products/gel-100-box-us'];
  assert.equal(gelProductUrlsFor({ name: 'Roctane', aliases: 'GU Roctane' }, 'GU', urls)[0], 'https://www.guenergy.com/products/roctane-energy-gel');
  assert.equal(gelProductUrlsFor({ name: 'Gel 100', aliases: 'Maurten Gel 100' }, 'Maurten', urls)[0], 'https://www.maurten.com/products/gel-100-box-us');
  const needs = gelNeedPages(['https://x.com/collections/caffeinated', 'https://x.com/collections/vegan-gels', 'https://x.com/pages/marathon-fueling', 'https://x.com/products/sensitive-stomach-gel'], []);
  assert.deepEqual(Object.keys(needs).sort(), ['caffeine', 'marathon', 'vegan'], 'a product page does not count as a need page');
});
