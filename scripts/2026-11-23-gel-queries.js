// What people actually search and ask about energy gels (Alex, 2026-11-23: the gel prompt set is built from real
// searches, not written from scratch). Four free sources, collected on a PC (they all refuse cloud addresses):
//   --suggest  Google and Amazon autocomplete for the seed phrases in data/2026-11-23-gel-seeds.csv, each seed alone,
//              with a-z after it and with question words before it. A phrase that turns up for many seeds and letters is
//              a common search. -> data/2026-11-23-gel-queries.csv
//   --trends   Google Trends (US, 12 months) for the most frequent phrases, chained through anchor terms onto one scale
//              (anchor = 100), so each prompt can carry a weight. Needs --suggest first. -> the same CSV
//   --reddit   A year of posts about gels and fueling on r/running, r/AdvancedRunning, r/ultrarunning and
//              r/Marathon_Training: the questions runners ask each other. -> data/2026-11-23-gel-reddit.csv
//   --corpus   Gel questions people typed into AI chatbots (WildChat-1M, LMSYS-Chat-1M on Hugging Face). Needs HF_TOKEN;
//              skipped without one. -> data/2026-11-23-gel-ai-prompts.csv
//   --all      all four. --dry prints what it would ask, without asking.
// Polite: one request at a time with a pause. No dependencies. Then commit and push the three CSVs; Claude builds the
// prompt set from them for Alex to approve.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseCsv, toCsv } from '../src/2026-11-21-csv.js';

const args = new Set(process.argv.slice(2));
const want = k => args.has('--all') || args.has(k);
const dry = args.has('--dry');
if (!['--suggest', '--trends', '--reddit', '--corpus'].some(want)) { console.error('usage: --suggest | --trends | --reddit | --corpus | --all  [--dry]'); process.exit(1); }
const today = new Date().toISOString().slice(0, 10);
const dataUrl = name => new URL(`../data/${name}`, import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const QFILE = dataUrl('2026-11-23-gel-queries.csv');
const QCOLS = ['source', 'query', 'seed', 'hits', 'value', 'collected_on'];
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// ---- Autocomplete ------------------------------------------------------------------------------------------------
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const QUESTIONS = ['how', 'what', 'which', 'when', 'why', 'best', 'can', 'do', 'is', 'are'];
const SOURCES = {
  google: async q => {
    const r = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&hl=en&gl=us&q=${encodeURIComponent(q)}`, { headers: { 'user-agent': UA } });
    if (!r.ok) throw new Error(`google ${r.status}`);
    const j = JSON.parse(new TextDecoder('utf-8').decode(await r.arrayBuffer()));
    return (j[1] || []).map(String);
  },
  amazon: async q => {
    const r = await fetch(`https://completion.amazon.com/api/2017/suggestions?mid=ATVPDKIKX0DER&alias=aps&prefix=${encodeURIComponent(q)}`, { headers: { 'user-agent': UA } });
    if (!r.ok) throw new Error(`amazon ${r.status}`);
    const j = await r.json();
    return (j.suggestions || []).map(s => String(s.value || ''));
  },
};
async function collectSuggest() {
  const seeds = parseCsv(readFileSync(dataUrl('2026-11-23-gel-seeds.csv'), 'utf8')).map(s => norm(s.seed)).filter(Boolean);
  const asks = seeds.flatMap(seed => [seed, ...LETTERS.map(l => `${seed} ${l}`), ...QUESTIONS.map(w => `${w} ${seed}`)].map(q => ({ seed, q })));
  console.log(`Autocomplete: ${seeds.length} seeds, ${asks.length} phrases, ${asks.length * Object.keys(SOURCES).length} requests (about ${Math.round(asks.length * 2 * 0.45 / 60)} minutes).`);
  if (dry) return;
  const hits = {}; // source|query -> { seeds: Set, n }
  let done = 0, failed = 0;
  for (const { seed, q } of asks) {
    for (const [name, get] of Object.entries(SOURCES)) {
      try {
        for (const s of await get(q)) {
          const k = `${name}|${norm(s)}`;
          const h = (hits[k] ||= { seeds: new Set(), n: 0 });
          h.seeds.add(seed); h.n++;
        }
      } catch (e) { failed++; if (failed % 20 === 1) console.log(`  ${e.message} (${failed} failed so far)`); await sleep(5000); }
      await sleep(400);
    }
    if (++done % 50 === 0) console.log(`  ${done} of ${asks.length} phrases`);
  }
  const rows = Object.entries(hits).map(([k, h]) => { const [source, query] = k.split('|'); return { source, query, seed: [...h.seeds].join('; '), hits: h.n, value: '', collected_on: today }; })
    .sort((a, b) => b.hits - a.hits);
  const keep = existsSync(QFILE) ? parseCsv(readFileSync(QFILE, 'utf8')).filter(r => r.source === 'trends') : [];
  writeFileSync(QFILE, toCsv([...rows, ...keep], QCOLS));
  console.log(`Autocomplete done: ${rows.length} distinct phrases (${failed} requests failed) in data/2026-11-23-gel-queries.csv.`);
}

// ---- Google Trends (same method as the shoe demand collector) ----------------------------------------------------
const ANCHORS = ['maurten gel', 'gu gel', 'energy gels']; // small to big
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
  throw new Error('Google Trends keeps answering 429. Wait a while and run --trends again: finished phrases are kept.');
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
  if (!existsSync(QFILE)) { console.log('Trends skipped: run --suggest first.'); return; }
  const all = parseCsv(readFileSync(QFILE, 'utf8'));
  const done = new Set(all.filter(r => r.source === 'trends' && r.collected_on === today).map(r => r.query));
  // The 80 phrases found most often across seeds and letters, Google and Amazon together.
  const score = {};
  for (const r of all.filter(r => r.source !== 'trends')) score[r.query] = (score[r.query] || 0) + Number(r.hits || 0);
  const terms = Object.entries(score).sort((a, b) => b[1] - a[1]).map(([q]) => q).filter(q => q.length <= 100 && !done.has(q)).slice(0, 80);
  console.log(`Trends: ${terms.length} phrases in batches of four (about ${Math.round(terms.length / 4 * 8 / 60)} minutes).`);
  if (dry || !terms.length) return;
  await fetch(TRENDS + '/trends/explore?geo=US&q=energy%20gel', { headers: { 'user-agent': UA } }).then(r => { const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0]; }).catch(() => {});
  const ladder = await trendsBatch(ANCHORS);
  const base = ladder[ANCHORS[0]] || 0;
  if (base < 1) throw new Error(`the small anchor "${ANCHORS[0]}" reads ${base}; pick a bigger small anchor`);
  const scaleOf = Object.fromEntries(ANCHORS.map(a => [a, 100 * ladder[a] / base]));
  console.log(`Trends ladder (${ANCHORS[0]} = 100): ${ANCHORS.map(a => `${a} ${scaleOf[a].toFixed(0)}`).join(', ')}`);
  for (let i = 0; i < terms.length; i += 4) {
    const batch = terms.slice(i, i + 4);
    let idx = 0, res, anchor;
    for (;;) {
      anchor = ANCHORS[idx];
      res = await trendsBatch([anchor, ...batch.filter(t => t !== anchor)]);
      if (res[anchor] >= 5 || idx === ANCHORS.length - 1) break;
      idx++;
    }
    const factor = res[anchor] > 0 ? scaleOf[anchor] / res[anchor] : 0;
    const rows = batch.map(t => ({ source: 'trends', query: t, seed: `anchor ${anchor}`, hits: '', value: Math.round((res[t] || 0) * factor * 10) / 10, collected_on: today }));
    for (const r of rows) console.log(`  ${r.query}: ${r.value}`);
    const now = parseCsv(readFileSync(QFILE, 'utf8'));
    writeFileSync(QFILE, toCsv([...now, ...rows], QCOLS)); // written as we go, so a 429 later loses nothing
  }
  console.log('Trends done.');
}

// ---- Reddit ------------------------------------------------------------------------------------------------------
const SUBS = ['running', 'AdvancedRunning', 'ultrarunning', 'Marathon_Training'];
const RQ = 'gel OR gels OR fueling OR fuel OR maurten OR "gu"';
async function collectReddit() {
  console.log(`Reddit: ${SUBS.length} subreddits, up to 1,000 posts each from the past year.`);
  if (dry) return;
  const out = [];
  for (const sub of SUBS) {
    let after = '', n = 0;
    for (let page = 0; page < 10; page++) {
      const url = `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(RQ)}&restrict_sr=1&sort=new&t=year&limit=100&raw_json=1${after ? `&after=${after}` : ''}`;
      const r = await fetch(url, { headers: { 'user-agent': UA } });
      if (r.status === 429) { console.log('  Reddit 429: waiting 60s'); await sleep(60000); page--; continue; }
      if (!r.ok) { console.log(`  r/${sub}: ${r.status}; skipped`); break; }
      const j = await r.json();
      const kids = (j.data && j.data.children || []).map(c => c.data);
      for (const p of kids) out.push({ subreddit: `r/${sub}`, created: new Date(p.created_utc * 1000).toISOString().slice(0, 10), title: p.title || '', score: p.score ?? '', comments: p.num_comments ?? '', text: String(p.selftext || '').replace(/\s+/g, ' ').slice(0, 300) });
      n += kids.length;
      after = j.data && j.data.after;
      if (!after) break;
      await sleep(2500);
    }
    console.log(`  r/${sub}: ${n} posts`);
  }
  writeFileSync(dataUrl('2026-11-23-gel-reddit.csv'), toCsv(out, ['subreddit', 'created', 'title', 'score', 'comments', 'text']));
  console.log(`Reddit done: ${out.length} posts in data/2026-11-23-gel-reddit.csv.`);
}

// ---- Real AI conversations (Hugging Face datasets server) --------------------------------------------------------
const DATASETS = [{ id: 'allenai/WildChat-1M', config: 'default', split: 'train' }, { id: 'lmsys/lmsys-chat-1m', config: 'default', split: 'train' }];
const CQ = ['energy gel', 'energy gels', 'running gel', 'marathon fuel', 'marathon fueling', 'carbs per hour', 'maurten', 'gu gel'];
async function collectCorpus() {
  const token = process.env.HF_TOKEN;
  if (!token) { console.log('Corpus skipped: no HF_TOKEN (see the setup guide for the free token).'); return; }
  console.log(`Corpus: ${DATASETS.length} datasets × ${CQ.length} searches.`);
  if (dry) return;
  const out = [], seen = new Set();
  for (const ds of DATASETS) {
    for (const q of CQ) {
      for (let offset = 0; offset < 500; offset += 100) {
        const url = `https://datasets-server.huggingface.co/search?dataset=${encodeURIComponent(ds.id)}&config=${ds.config}&split=${ds.split}&query=${encodeURIComponent(q)}&offset=${offset}&length=100`;
        const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, 'user-agent': UA } });
        if (res.status === 429) { console.log('  Hugging Face 429: waiting 30s'); await sleep(30000); offset -= 100; continue; }
        if (!res.ok) { console.log(`  ${ds.id}: ${res.status} (gated: accept its terms on Hugging Face, or no search index); skipped`); offset = 1e9; break; }
        const j = await res.json();
        const rows = j.rows || [];
        for (const { row } of rows) {
          const first = ((row.conversation || []).find(m => m.role === 'user') || {}).content || '';
          const key = first.slice(0, 200);
          if (seen.has(key) || !/\bgels?\b|fuel|carb/i.test(first) || !/\brun|marathon|race|ultra|cycl|ride\b/i.test(first)) continue;
          seen.add(key);
          out.push({ dataset: ds.id, search: q, prompt: first.replace(/\s+/g, ' ').slice(0, 400) });
        }
        if (rows.length < 100) break;
        await sleep(1000);
      }
    }
  }
  writeFileSync(dataUrl('2026-11-23-gel-ai-prompts.csv'), toCsv(out, ['dataset', 'search', 'prompt']));
  console.log(`Corpus done: ${out.length} gel questions people asked AI, in data/2026-11-23-gel-ai-prompts.csv.`);
}

try {
  if (want('--suggest')) await collectSuggest();
  if (want('--trends')) await collectTrends();
  if (want('--reddit')) await collectReddit();
  if (want('--corpus')) await collectCorpus();
  if (!dry) console.log('Done. Commit and push the data/2026-11-23-gel-*.csv files.');
} catch (e) { console.error(e.message); process.exit(1); }
