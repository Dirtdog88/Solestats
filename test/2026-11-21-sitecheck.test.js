import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usVersion, sitemapRank, parseRobots, robotsAllows, parseSitemap, productUrlsFor, readPage, productEvidence, needPages, majority, TOPIC } from '../src/2026-11-21-sitecheck.js';

test('robots: an agent\'s own group wins over *, the longest rule wins, Allow wins a tie, empty Disallow allows', () => {
  const r = parseRobots(`User-agent: *\nDisallow: /checkout\nDisallow: /p/\nAllow: /p/shoes/\n\nUser-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: PerplexityBot\nDisallow:\n\nSitemap: https://x.com/sitemap.xml`);
  assert.deepEqual(r.sitemaps, ['https://x.com/sitemap.xml']);
  assert.equal(robotsAllows(r, 'GPTBot', '/p/shoes/ghost').allowed, false);
  assert.equal(robotsAllows(r, 'ClaudeBot', '/p/shoes/ghost').group, 'claudebot');
  assert.equal(robotsAllows(r, 'Google-Extended', '/p/shoes/ghost').allowed, true);   // * group: Allow /p/shoes/ is longer
  assert.equal(robotsAllows(r, 'Google-Extended', '/p/socks/x').allowed, false);
  assert.equal(robotsAllows(r, 'PerplexityBot', '/checkout').allowed, true);           // own group, empty Disallow
  assert.equal(robotsAllows(parseRobots(''), 'GPTBot', '/').allowed, true);
  assert.equal(robotsAllows(parseRobots('User-agent: *\nDisallow: /*?q=$'), 'GPTBot', '/s?q=').allowed, false);
});

test('sitemaps: index or urlset, CDATA and &amp; handled', () => {
  assert.deepEqual(parseSitemap('<sitemapindex><sitemap><loc>https://x.com/a.xml</loc></sitemap></sitemapindex>'), { index: true, locs: ['https://x.com/a.xml'] });
  assert.deepEqual(parseSitemap('<urlset><url><loc><![CDATA[https://x.com/p?a=1&amp;b=2]]></loc></url></urlset>').locs, ['https://x.com/p?a=1&b=2']);
});

test('productUrlsFor picks the men\'s current model page and skips kids, apparel and blog pages', () => {
  const urls = [
    'https://www.brooksrunning.com/en_us/blog/ghost-17-review/',
    'https://www.brooksrunning.com/en_us/kids/ghost-17-big-kids/123.html',
    'https://www.brooksrunning.com/en_us/ghost-16-mens-road-running-shoe/110393.html',
    'https://www.brooksrunning.com/en_us/ghost-17-mens-road-running-shoe/110418.html',
    'https://www.brooksrunning.com/en_us/ghost-17-womens-road-running-shoe/120418.html',
    'https://www.brooksrunning.com/en_us/ghost-max-3-mens/110500.html',
    'https://www.brooksrunning.com/en_us/ghost-running-socks/280.html',
  ];
  assert.deepEqual(productUrlsFor({ name: 'Ghost' }, urls, 2), [urls[3], urls[2]]);
  // US English pages beat other countries' and languages', and product pages beat landing pages.
  const nike = ['https://www.nike.com/au/t/pegasus-42-mens-road-running-shoes-XK9', 'https://www.nike.com/t/pegasus-42-mens-road-running-shoes-XK9', 'https://us.puma.com/us/es/pd/pegasus-42-men/1'];
  assert.equal(productUrlsFor({ name: 'Pegasus' }, nike, 1)[0], nike[1]);
  assert.equal(productUrlsFor({ name: 'Ride' }, ['https://x.com/en/mens-featured-ride-19/', 'https://x.com/en/ride-19/60M.html'], 1)[0], 'https://x.com/en/ride-19/60M.html');
  assert.equal(usVersion('https://www.nike.com/id/t/structure-26-mens-uYY'), 'https://www.nike.com/t/structure-26-mens-uYY');
  assert.equal(usVersion('https://us.puma.com/us/es/pd/velocity-nitro-4-men/311140'), 'https://us.puma.com/us/en/pd/velocity-nitro-4-men/311140');
  assert.equal(usVersion('https://us.puma.com/us/en/pd/x/1'), null);
  assert.equal(usVersion('https://www.nike.com/t/x'), null);
  assert.ok(sitemapRank('https://www.nike.com/sitemap-v2-pdp-en-bg.xml') < 0 && sitemapRank('https://www.nike.com/sitemap-v2-pdp-en-us.xml') > 0);
  assert.ok(sitemapRank('https://www.nike.com/sitemap-pdp-en-us.xml') > sitemapRank('https://www.nike.com/sitemap-pdp-en-au.xml'));
  assert.deepEqual(productUrlsFor({ name: 'Adrenaline GTS' }, ['https://x.com/en_us/adrenaline-gts-24-mens/1.html', 'https://x.com/en_us/adrenaline-mens/2.html']), ['https://x.com/en_us/adrenaline-gts-24-mens/1.html']);
});

test('readPage and productEvidence read JSON-LD and visible text, ignoring scripts', () => {
  const html = `<html><head><title>Ghost 17 | Brooks</title>
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Product","name":"Ghost 17","offers":{"@type":"Offer","price":"140.00","priceCurrency":"USD","availability":"https://schema.org/InStock"}}]}</script>
    <script>var weight = "9.4 oz";</script></head>
    <body><h1>Ghost 17</h1><p>Widths: Narrow, Medium, Wide (2E), Extra Wide (4E)</p><p>Weight: 9.5 oz &amp; drop 12 mm. Stack height 35 mm heel.</p>
    <a href="/returns">Free returns</a></body></html>`;
  const page = readPage(html, 'https://www.brooksrunning.com/en_us/ghost-17/1.html');
  assert.equal(page.links[0].href, 'https://www.brooksrunning.com/returns');
  const e = productEvidence(page);
  assert.deepEqual([e.structured, e.price, e.widths, e.stock, e.versioned], [true, true, true, true, true]);
  assert.deepEqual(e.specs, { weight: true, drop: true, stack: true });
  assert.deepEqual(e.ld.prices, ['140.00']);
  assert.ok(!page.text.includes('var weight'));
  const bare = productEvidence(readPage('<title>Shoe</title><div id="app"></div><script>render()</script>', 'https://x.com/'));
  assert.deepEqual([bare.structured, bare.price, bare.widths, bare.stock], [false, false, false, false]);
});

test('needPages finds short category URLs and ignores product pages; majority needs half', () => {
  const urls = ['https://x.com/en-us/c/mens/running-shoes/stability', 'https://x.com/en-us/trail-running-shoes', 'https://x.com/en-us/ghost-17-wide-mens-running-shoe/110418.html', 'https://x.com/en-us/c/racing-shoes', 'https://x.com/en-us/neutral-running-shoes'];
  const found = needPages(urls, [{ href: 'https://x.com/en-us/wide-running-shoes', text: 'Wide' }]);
  assert.deepEqual(Object.keys(found).sort(), ['neutral', 'racing', 'stability', 'trail', 'wide']);
  assert.equal(found.wide, 'https://x.com/en-us/wide-running-shoes');
  assert.deepEqual(majority([{ evidence: { a: 1 } }, { evidence: { a: 0 } }, {}], e => e.a), { result: 1, note: '1 of 2 product pages' });
  assert.equal(majority([], e => e).result, null);
  assert.ok(TOPIC.returns.page('Returns accepted within 90 days of purchase'));
  assert.ok(!TOPIC.returns.page('Returns are easy'));
});
