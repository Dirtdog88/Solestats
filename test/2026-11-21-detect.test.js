import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv } from '../src/2026-11-21-csv.js';
import { brandMatchers, findMentions, markTopPick, pickWinner, classifyCitation, findRoutes, stripLinks, canonicalUrl } from '../src/2026-11-21-detect.js';

const brands = parseCsv(readFileSync(new URL('../data/2026-11-21-brands.csv', import.meta.url), 'utf8'));
const retailers = parseCsv(readFileSync(new URL('../data/2026-11-21-retailers.csv', import.meta.url), 'utf8'));
const matchers = brandMatchers(brands);

test('On is found bare in a list of brands, never as the word "on"', () => {
  const on = t => findMentions(t, matchers).some(m => m.brand_slug === 'on');
  assert.ok(on('Great selection of road and trail brands (Hoka, Brooks, On, Altra, Salomon).'));
  assert.ok(on('Nike, Hoka, Brooks, Saucony, On, ASICS and others release new colors.'));
  assert.ok(on('Trail runners (Hoka, Altra, Brooks, Salomon, On).'));
  assert.ok(on('- **On (Cloud line):** A good pick if looks matter.'));
  assert.ok(on('The big names are Brooks and On.'));
  assert.ok(!on('Based on, say, your gait, try a stability shoe.'));
  assert.ok(!on('On the other hand, the Brooks Ghost is softer.'));
  assert.ok(!on('Put them on, then walk around the store.'));
  assert.ok(!on('On long runs, cushioning matters more.'));
});

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

test('aliases count: HOKA, NB, Hoka One One, inov-8', () => {
  const slugs = findMentions('HOKA and NB both work; some still say Hoka One One; inov-8 for fell running.', matchers).map(x => x.brand_slug);
  assert.deepEqual(slugs, ['hoka', 'new-balance', 'inov8']);
});

test('pickWinner reads an explicit verdict, falls back to a tie or the count', () => {
  assert.equal(pickWinner("Both are great. I'd go with Brooks for most runners.", 'brooks', 'hoka', matchers), 'brooks');
  assert.equal(pickWinner('It depends on your feet; both are solid daily trainers.', 'brooks', 'hoka', matchers), 'tie');
  assert.equal(pickWinner('Hoka Clifton, Hoka Bondi, Hoka Mach: Hoka has the range. Brooks has the Ghost.', 'brooks', 'hoka', matchers), 'hoka');
  assert.equal(pickWinner('Brooks makes the Ghost. Hoka makes the Clifton.', 'brooks', 'hoka', matchers), 'unclear');
});

test('classifyCitation reads a Google grounding redirect by the domain in its title', () => {
  const g = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQabc';
  assert.equal(classifyCitation(g, brands, retailers, 'runrepeat.com').kind, 'review');
  assert.equal(classifyCitation(g, brands, retailers, 'www.brooksrunning.com').kind, 'brand');
  assert.equal(classifyCitation(g, brands, retailers, 'runrepeat.com').domain, 'runrepeat.com');
  // A title that is not a domain leaves the redirect as it is.
  assert.equal(classifyCitation(g, brands, retailers, 'Best running shoes 2026').kind, 'other');
  // Titles never override an ordinary link.
  assert.equal(classifyCitation('https://www.reddit.com/r/running', brands, retailers, 'brooksrunning.com').kind, 'forum');
});

test('classifyCitation counts other and non-US brand sites as the brand, and marks the non-US ones', () => {
  const k = url => { const c = classifyCitation(url, brands, retailers); return [c.kind, c.brand_slug || '', !!c.intl].join(' '); };
  assert.equal(k('https://www.on-running.com/en-us/products/cloudmonster'), 'brand on false');
  assert.equal(k('https://www.lasportivausa.com/bushido'), 'brand la-sportiva false');
  assert.equal(k('https://usa.mizuno.com/wave-rider'), 'brand mizuno false');
  assert.equal(k('https://www.mizuno.com.au/wave-rider'), 'brand mizuno true');
  assert.equal(k('https://www.adidas.co.uk/adizero'), 'brand adidas true');
  assert.equal(k('https://au.hoka.com/clifton'), 'brand hoka true');
  assert.equal(k('https://eu.altrarunning.com/lone-peak'), 'brand altra true');
  assert.equal(k('https://us.puma.com/velocity'), 'brand puma false');
  assert.equal(k('https://stores.hoka.com/seattle'), 'brand hoka false');
  assert.equal(k('https://www.hoka.com/en/us/clifton'), 'brand hoka false');
  assert.equal(k('https://www.joesnewbalanceoutlet.com/fresh-foam'), 'brand new-balance false');
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

test('markTopPick follows an explicit verdict over first mention, and falls back to first mention', () => {
  const spliced = 'Popular models like the Saucony Ride, Brooks Ghost and HOKA Clifton make excellent shoes for beginners.\n\nIf you only buy one pair: the Brooks Ghost 17. Get fitted at a local running store.';
  const m = markTopPick(spliced, findMentions(spliced, matchers), matchers);
  assert.deepEqual(m.filter(x => x.top_pick).map(x => x.brand_slug), ['brooks']);
  assert.equal(m[0].brand_slug, 'saucony'); // order of mention is unchanged
  const plain = 'The Hoka Clifton is soft; the Brooks Ghost is firmer.';
  assert.deepEqual(markTopPick(plain, findMentions(plain, matchers), matchers).filter(x => x.top_pick).map(x => x.brand_slug), ['hoka']);
  const verdict = "Both work. I'd go with Asics here, the Novablast is lighter than the Nike Pegasus.";
  assert.deepEqual(markTopPick(verdict, findMentions(verdict, matchers), matchers).filter(x => x.top_pick).map(x => x.brand_slug), ['asics']);
  assert.deepEqual(markTopPick('nothing here', [], matchers), []);
});

test('findRoutes records whose site a brand-site route is, and leaves general brand-site language unassigned', () => {
  const routes = findRoutes("Buy direct from the brand's site.", [{ url: 'https://www.brooksrunning.com/ghost' }, { url: 'https://www.hoka.com/clifton' }], brands, retailers);
  assert.deepEqual(routes.map(r => `${r.retailer_slug}:${r.brand_slug || ''}`).sort(), ['brand-site:', 'brand-site:brooks', 'brand-site:hoka']);
});

test('findRoutes ignores pages a search merely returned', () => {
  const routes = findRoutes('Buy a neutral trainer and get fitted.', [], brands, retailers);
  assert.deepEqual(routes, []);
});

test('stripLinks drops inline citation parentheticals and keeps other link text', () => {
  const openai = "I'd try the ASICS GEL-EXCITE 11 first. ([asics.com](https://www.asics.com/x?utm_source=openai)) Get fitted at REI. ([rei.com](https://www.rei.com/a), [fleetfeet.com](https://www.fleetfeet.com/b))";
  const prose = stripLinks(openai);
  assert.equal(prose, "I'd try the ASICS GEL-EXCITE 11 first. Get fitted at REI.");
  assert.equal(stripLinks('See [the Ghost 17](https://brooksrunning.com/ghost) here.'), 'See the Ghost 17 here.');
  assert.equal(stripLinks('Source: [rei.com](https://www.rei.com/a) and https://www.fleetfeet.com/b today.'), 'Source:  and  today.');
  assert.deepEqual(findRoutes(stripLinks('Any trainer works. [brooksrunning.com](https://www.brooksrunning.com/)'), [], brands, retailers), []);
  // Routes from prose: REI is named in the text, Fleet Feet only inside a citation link.
  assert.deepEqual(findRoutes(prose, [], brands, retailers).map(r => r.retailer_slug), ['rei']);
});

test('canonicalUrl removes tracking parameters, fragments and trailing slashes', () => {
  assert.equal(canonicalUrl('https://www.rei.com/learn/a.html?related-style-id=1&utm_source=openai#top'), 'https://www.rei.com/learn/a.html?related-style-id=1');
  assert.equal(canonicalUrl('https://www.brooksrunning.com/en_us/shoes/?utm_source=openai'), 'https://www.brooksrunning.com/en_us/shoes');
  assert.equal(canonicalUrl('not a url'), 'not a url');
});

test('pickWinner reads the verdicts the engines actually write (2026-11-22)', () => {
  const w = (t, a, b) => pickWinner(t, a, b, matchers);
  assert.equal(w("For most people, I'd pick **Brooks**, specifically the **Brooks Ghost**. **On** is the better choice in a few cases.", 'on', 'brooks'), 'brooks');
  assert.equal(w('I’d buy the Saucony Ride 19 if you want one pair. I’d choose the Hoka Clifton 11 instead if your miles are easy.', 'hoka', 'saucony'), 'saucony');
  assert.equal(w("Neither brand is better overall. For a typical everyday running shoe, I'd lean Brooks. If you want something faster, go with adidas.", 'brooks', 'adidas'), 'brooks');
  assert.equal(w("My pick: If you want one shoe for all your runs, I'd lean toward the Saucony Ride 18.", 'brooks', 'saucony'), 'saucony');
  assert.equal(w('Winner: Brooks Ghost for pure running comfort; Nike Pegasus if you also want a gym shoe.', 'brooks', 'nike'), 'brooks');
  assert.equal(w("For most people, I'd go with the Nike Pegasus. The On Cloudsurfer and On Cloudmonster are good, the On Cloudeclipse too.", 'on', 'nike'), 'nike');
  assert.equal(w("I'd go with On, specifically the Cloudmonster.", 'on', 'nike'), 'on');
  assert.equal(w('Both are great; it depends on your feet. Try both on at a store.', 'brooks', 'hoka'), 'tie');
});
