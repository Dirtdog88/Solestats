// Collects the free demand signals behind "Where the demand is" into data/2026-11-22-demand-signals.csv (one row per
// signal, source and key; a later run adds newer rows and the builder keeps the latest). Three signals:
//   --trends   Google Trends, US, last 12 months: the average interest of the search term behind each shoe prompt
//              (data/2026-11-22-demand-keywords.csv), chained through anchor terms onto one scale (anchor = 100).
//   --reddit   Reddit: the newest posts on r/RunningShoeGeeks and the past year's shoe posts on r/running, each sorted
//              into a need group by the phrase lists (data/2026-11-22-demand-terms.csv); counts per group per subreddit.
//              Titles and groups are written to data/2026-11-22-reddit-posts.csv so the sorting can be checked.
//   --corpus   Real AI conversations: WildChat-1M and LMSYS-Chat-1M on Hugging Face, searched for running-shoe prompts
//              through the datasets server and sorted the same way. Needs HF_TOKEN (a free account that has accepted
//              each dataset's terms); skipped without one.
//   --all      all three.
// Runs on a PC: Google Trends and Reddit refuse cloud addresses, and a cloud session needs each host on its allowed list
// (then prefix NODE_USE_ENV_PROXY=1). Resumable: terms already collected today are skipped. No dependencies.
// Then: npm run demand (the weights), npm run score -- --round <id>, load scores.sql.
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { parseCsv, toCsv } from '../src/2026-11-21-csv.js';
import { termMatchers, classify, isShoePost } from '../src/2026-11-22-demand.js';

const args = new Set(process.argv.slice(2));
const want = k => args.has('--all') || args.has(k);
if (!want('--trends') && !want('--reddit') && !want('--corpus')) { console.error('usage: --trends | --reddit | --corpus | --all'); process.exit(1); }
const today = new Date().toISOString().slice(0, 10);
const dataUrl = name => new URL(`../data/${name}`, import.meta.url);
const signalsFile = dataUrl('2026-11-22-demand-signals.csv');
const COLS = ['signal', 'source', 'key', 'value', 'window', 'collected_on', 'note'];
const existing = existsSync(signalsFile) ? parseCsv(readFileSync(signalsFile, 'utf8')) : [];
if (!existsSync(signalsFile)) writeFileSync(signalsFile, COLS.join(',') + '\n');
const addRows = rows => appendFileSync(signalsFile, toCsv(rows, COLS).split('\n').slice(1).join('\n'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const matchers = termMatchers(parseCsv(readFileSync(dataUrl('2026-11-22-demand-terms.csv'), 'utf8')));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// ---- Google Trends ----------------------------------------------------------------------------------------------
// Trends only compares up to five terms at a time, each batch scaled so its biggest term is 100. Every batch carries an
// anchor term, and the batch is rescaled so the anchor reads the same everywhere. A batch where the anchor rounds to
// almost nothing (a much bigger term in it) is run again with a bigger anchor; the anchors' ratios to each other come from
// one ladder batch at the start. Final scale: ANCHOR = 100.
const ANCHORS = ['running shoes for flat feet', 'trail running shoes', 'best running shoes']; // small to big
const TRENDS = 'https://trends.google.com';
let cookie = '';
async function trendsGet(path, params) {
  const url = new URL(path, TRENDS);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json, text/plain, */*', 'accept-language': 'en-US,en;q=0.9', referer: TRENDS + '/trends/explore', ...(cookie ? { cookie } : {}) } });
    const set = res.headers.get('set-cookie');
    if (set && !cookie) cookie = set.split(';')[0];
    if (res.status === 429 || res.status >= 500) { const wait = 30 * (attempt + 1); console.log(`  Trends ${res.status}: waiting ${wait}s`); await sleep(wait * 1000); continue; }
    if (!res.ok) throw new Error(`Trends ${res.status} on ${url.pathname}`);
    return JSON.parse((await res.text()).replace(/^\)\]\}',?\s*/, ''));
  }
  throw new Error('Google Trends keeps answering 429. Wait a while and run again: finished terms are kept.');
}
async function trendsBatch(terms) {
  const req = { comparisonItem: terms.map(keyword => ({ keyword, geo: 'US', time: 'today 12-m' })), category: 0, property: '' };
  const explore = await trendsGet('/trends/api/explore', { hl: 'en-US', tz: '480', req: JSON.stringify(req) });
  const w = (explore.widgets || []).find(x => x.id === 'TIMESERIES');
  if (!w) throw new Error('no TIMESERIES widget in the Trends answer');
  await sleep(1500);
  const data = await trendsGet('/trends/api/widgetdata/multiline', { hl: 'en-US', tz: '480', req: JSON.stringify(w.request), token: w.token });
  const points = (data.default && data.default.timelineData) || [];
  const out = {};
  terms.forEach((t, i) => { out[t] = points.length ? points.reduce((a, p) => a + (Number(p.value && p.value[i]) || 0), 0) / points.length : 0; });
  await sleep(2500);
  return out;
}
async function collectTrends() {
  const keywords = parseCsv(readFileSync(dataUrl('2026-11-22-demand-keywords.csv'), 'utf8')).map(k => k.keyword.trim()).filter(Boolean);
  const done = new Set(existing.filter(r => r.signal === 'trends' && r.collected_on === today).map(r => r.key.toLowerCase()));
  const terms = [...new Set(keywords.map(k => k.toLowerCase()))].filter(t => !done.has(t));
  if (!terms.length) { console.log('Trends: every term was collected today already.'); return; }
  await fetch(TRENDS + '/trends/explore?geo=US&q=running%20shoes', { headers: { 'user-agent': UA } }).then(r => { const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0]; }).catch(() => {});
  // The ladder: how the anchors stand to each other, on the small anchor's scale (= 100).
  const ladder = await trendsBatch(ANCHORS);
  const scaleOf = {}; // anchor -> its value when the small anchor is 100
  const base = ladder[ANCHORS[0]] || 0;
  if (base < 1) throw new Error(`the small anchor "${ANCHORS[0]}" reads ${base} against the others; pick a bigger small anchor`);
  for (const a of ANCHORS) scaleOf[a] = 100 * ladder[a] / base;
  console.log(`Trends ladder (${ANCHORS[0]} = 100): ${ANCHORS.map(a => `${a} ${scaleOf[a].toFixed(0)}`).join(', ')}`);
  const rows = [];
  for (let i = 0; i < terms.length; i += 4) {
    const batch = terms.slice(i, i + 4);
    let anchorIdx = 0, res, anchor;
    for (;;) {
      anchor = ANCHORS[anchorIdx];
      res = await trendsBatch([anchor, ...batch.filter(t => t !== anchor)]);
      if (res[anchor] >= 5 || anchorIdx === ANCHORS.length - 1) break;
      anchorIdx++; // a term in this batch dwarfs the anchor: climb the ladder
    }
    const factor = res[anchor] > 0 ? scaleOf[anchor] / res[anchor] : 0;
    for (const t of batch) {
      const v = Math.round((res[t] || 0) * factor * 10) / 10;
      rows.push({ signal: 'trends', source: 'google', key: t, value: v, window: 'US, 12 months', collected_on: today, note: `anchor ${anchor}` });
      console.log(`  ${t}: ${v}`);
    }
    addRows(rows.splice(0)); // written as we go, so a 429 later loses nothing
  }
  console.log('Trends done.');
}

// ---- Reddit ----------------------------------------------------------------------------------------------------
const SUBS = [
  { name: 'RunningShoeGeeks', kind: 'new', onlyShoes: false },  // every post is about shoes: the newest 1,000
  { name: 'running', kind: 'search', q: 'shoes', onlyShoes: true }, // the past year's posts that mention shoes
];
async function redditPosts(sub) {
  const posts = [];
  let after = null;
  for (let page = 0; page < 10; page++) {
    const base = sub.kind === 'new' ? `https://www.reddit.com/r/${sub.name}/new.json?limit=100&raw_json=1` : `https://www.reddit.com/r/${sub.name}/search.json?q=${encodeURIComponent(sub.q)}&restrict_sr=1&sort=new&t=year&limit=100&raw_json=1`;
    const res = await fetch(base + (after ? `&after=${after}` : ''), { headers: { 'user-agent': 'solestats-demand-signals/1.0 (open index of what AI recommends to runners; solestats.net)', accept: 'application/json' } });
    if (res.status === 429) { console.log('  Reddit 429: waiting 60s'); await sleep(60000); page--; continue; }
    if (!res.ok) throw new Error(`Reddit ${res.status} on r/${sub.name}`);
    const j = await res.json();
    const kids = ((j.data || {}).children || []).map(c => c.data);
    for (const p of kids) posts.push({ subreddit: `r/${sub.name}`, created: new Date(p.created_utc * 1000).toISOString().slice(0, 10), title: p.title || '', text: String(p.selftext || '').slice(0, 400) });
    after = (j.data || {}).after;
    console.log(`  r/${sub.name}: ${posts.length} posts`);
    if (!after || !kids.length) break;
    await sleep(6500); // Reddit's unauthenticated limit is about ten requests a minute
  }
  return posts;
}
async function collectReddit() {
  const out = [];
  for (const sub of SUBS) {
    const posts = await redditPosts(sub);
    const counts = {};
    let shoe = 0, sorted = 0;
    for (const p of posts) {
      const body = `${p.title}\n${p.text}`;
      if (sub.onlyShoes && !isShoePost(body)) { p.group = ''; continue; }
      shoe++;
      p.group = classify(body, matchers) || '';
      if (p.group) { sorted++; counts[p.group] = (counts[p.group] || 0) + 1; }
    }
    const window = posts.length ? `${posts[posts.length - 1].created} to ${posts[0].created}` : '';
    const rows = Object.entries(counts).map(([group, n]) => ({ signal: 'reddit', source: `r/${sub.name}`, key: group, value: n, window, collected_on: today, note: `${sorted} of ${shoe} shoe posts sorted (${posts.length} read)` }));
    addRows(rows);
    out.push(...posts.filter(p => p.group || !sub.onlyShoes).map(p => ({ subreddit: p.subreddit, created: p.created, title: p.title, group: p.group })));
    console.log(`r/${sub.name}: ${posts.length} posts, ${shoe} about shoes, ${sorted} sorted into a group (${window}).`);
  }
  writeFileSync(dataUrl('2026-11-22-reddit-posts.csv'), toCsv(out, ['subreddit', 'created', 'title', 'group']));
  console.log('Reddit done: titles and groups in data/2026-11-22-reddit-posts.csv.');
}

// ---- Real AI conversations (Hugging Face datasets server) --------------------------------------------------------
const DATASETS = [{ id: 'allenai/WildChat-1M', config: 'default', split: 'train' }, { id: 'lmsys/lmsys-chat-1m', config: 'default', split: 'train' }];
const QUERIES = ['running shoes', 'running shoe', 'trail running shoes', 'marathon shoes', 'shoes for running'];
async function collectCorpus() {
  const token = process.env.HF_TOKEN;
  if (!token) { console.log('Corpus skipped: set HF_TOKEN (a free Hugging Face account that has accepted the WildChat-1M and LMSYS-Chat-1M terms, then a read token).'); return; }
  for (const ds of DATASETS) {
    const seen = new Set(), counts = {};
    let shoe = 0;
    for (const q of QUERIES) {
      for (let offset = 0; offset < 1000; offset += 100) {
        const url = `https://datasets-server.huggingface.co/search?dataset=${encodeURIComponent(ds.id)}&config=${ds.config}&split=${ds.split}&query=${encodeURIComponent(q)}&offset=${offset}&length=100`;
        const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, 'user-agent': UA } });
        if (res.status === 429) { console.log('  Hugging Face 429: waiting 30s'); await sleep(30000); offset -= 100; continue; }
        if (!res.ok) { console.log(`  ${ds.id}: ${res.status} (gated, or no search index); skipped`); offset = 1e9; break; }
        const j = await res.json();
        const rows = j.rows || [];
        for (const { row } of rows) {
          const conv = row.conversation || [];
          const first = (conv.find(m => m.role === 'user') || {}).content || '';
          const id = row.conversation_hash || row.conversation_id || first.slice(0, 200);
          if (seen.has(id)) continue;
          seen.add(id);
          if (!isShoePost(first) || !/\brun/i.test(first)) continue;
          shoe++;
          const g = classify(first, matchers);
          if (g) counts[g] = (counts[g] || 0) + 1;
        }
        if (rows.length < 100 || offset + 100 >= (j.num_rows_total || 0)) break;
        await sleep(1000);
      }
    }
    const sorted = Object.values(counts).reduce((a, b) => a + b, 0);
    addRows(Object.entries(counts).map(([group, n]) => ({ signal: 'corpus', source: ds.id, key: group, value: n, window: 'whole dataset', collected_on: today, note: `${sorted} of ${shoe} running-shoe prompts sorted` })));
    console.log(`${ds.id}: ${shoe} running-shoe prompts, ${sorted} sorted into a group.`);
  }
  console.log('Corpus done.');
}

try {
  if (want('--trends')) await collectTrends();
  if (want('--reddit')) await collectReddit();
  if (want('--corpus')) await collectCorpus();
  console.log(`Signals in ${signalsFile.pathname}. Next: npm run demand`);
} catch (e) { console.error(e.message); process.exit(1); }
