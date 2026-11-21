import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv } from '../src/2026-11-21-csv.js';
import { brandMatchers, findMentions, pickWinner, classifyCitation, findRoutes } from '../src/2026-11-21-detect.js';

const brands = parseCsv(readFileSync(new URL('../data/2026-11-21-brands.csv', import.meta.url), 'utf8'));
const retailers = parseCsv(readFileSync(new URL('../data/2026-11-21-retailers.csv', import.meta.url), 'utf8'));
const matchers = brandMatchers(brands);

test('findMentions orders brands by first appearance and marks the first as top pick', () => {
  const m = findMentions('For a daily trainer I would go with the Brooks Ghost 17. The Hoka Clifton 10 and ASICS Novablast are close.', matchers);
  assert.deepEqual(m.map(x => x.brand_slug), ['brooks', 'hoka', 'asics']);
  assert.equal(m[0].top_pick, 1);
  assert.equal(m[1].top_pick, 0);
});

test('"On" is only counted as the brand, not the preposition', () => {
  assert.deepEqual(findMentions('Put them on and go for a run on the trail.', matchers), []);
  assert.deepEqual(findMentions('The On Cloudmonster 2 is very cushioned.', matchers).map(x => x.brand_slug), ['on']);
  assert.deepEqual(findMentions('On Running makes the Cloudsurfer.', matchers).map(x => x.brand_slug), ['on']);
});

test('aliases count: HOKA, NB, Theragun, AfterShokz', () => {
  const slugs = findMentions('HOKA and NB both work; for recovery a Theragun; AfterShokz for audio.', matchers).map(x => x.brand_slug);
  assert.deepEqual(slugs, ['hoka', 'new-balance', 'therabody', 'shokz']);
});

test('pickWinner reads an explicit verdict, falls back to a tie or the count', () => {
  assert.equal(pickWinner("Both are great. I'd go with Brooks for most runners.", 'brooks', 'hoka', matchers), 'brooks');
  assert.equal(pickWinner('It depends on your feet; both are solid daily trainers.', 'brooks', 'hoka', matchers), 'tie');
  assert.equal(pickWinner('Hoka Clifton, Hoka Bondi, Hoka Mach: Hoka has the range. Brooks has the Ghost.', 'brooks', 'hoka', matchers), 'hoka');
  assert.equal(pickWinner('Brooks makes the Ghost. Hoka makes the Clifton.', 'brooks', 'hoka', matchers), 'unclear');
});

test('classifyCitation knows brand sites, retailers, review sites, forums', () => {
  assert.equal(classifyCitation('https://www.brooksrunning.com/en_us/ghost-17', brands, retailers).kind, 'brand');
  assert.equal(classifyCitation('https://www.brooksrunning.com/en_us/ghost-17', brands, retailers).brand_slug, 'brooks');
  assert.equal(classifyCitation('https://www.amazon.com/dp/B0ABC', brands, retailers).retailer_slug, 'amazon');
  assert.equal(classifyCitation('https://runrepeat.com/brooks-ghost-17', brands, retailers).kind, 'review');
  assert.equal(classifyCitation('https://www.reddit.com/r/running/comments/x', brands, retailers).kind, 'forum');
  assert.equal(classifyCitation('https://example.org/x', brands, retailers).kind, 'other');
  assert.equal(classifyCitation('not a url', brands, retailers).kind, 'other');
});

test('findRoutes picks up named retailers, run specialty and brand-site language, and retailer citations', () => {
  const routes = findRoutes("You can find them on Amazon or at Running Warehouse; your local running store will fit you. Or buy direct from the brand's site.", [{ url: 'https://www.rei.com/product/1' }], brands, retailers);
  assert.deepEqual(routes.map(r => r.retailer_slug).sort(), ['amazon', 'brand-site', 'local', 'rei', 'running-warehouse']);
});
