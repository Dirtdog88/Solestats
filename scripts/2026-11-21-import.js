// Reads a round's runs.jsonl, detects brands, citations and routes, and writes SQL for D1 (runs, mentions,
// citations, routes) plus an enriched runs.scored.jsonl the scorer uses.
//   node scripts/2026-11-21-import.js --round 2026-12 > data/rounds/2026-12/import.sql
import { readFileSync, writeFileSync } from 'node:fs';
import { parseCsv, sql } from '../src/2026-11-21-csv.js';
import { brandMatchers, findMentions, markTopPick, pickWinner, classifyCitation, findRoutes, stripLinks, canonicalUrl } from '../src/2026-11-21-detect.js';

const round = (process.argv.indexOf('--round') > -1 && process.argv[process.argv.indexOf('--round') + 1]) || null;
if (!round) { console.error('usage: --round <id>'); process.exit(1); }
const read = name => parseCsv(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const brands = read('2026-11-21-brands.csv'), retailers = read('2026-11-21-retailers.csv'), prompts = read('2026-11-21-prompts.csv');
const byPrompt = Object.fromEntries(prompts.map(p => [p.id, p]));
const matchers = brandMatchers(brands);
const dir = new URL(`../data/rounds/${round}/`, import.meta.url);
const runs = readFileSync(new URL('runs.jsonl', dir), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

const out = [`INSERT OR REPLACE INTO rounds (id,started_at,engines,repeats,notes) VALUES (${[round, runs[0]?.created_at || new Date().toISOString(), [...new Set(runs.map(r => r.engine))].join(';'), Math.max(...runs.map(r => r.repeat_no))].map(sql).join(',')}, NULL);`];
const scored = [];
for (const r of runs) {
  out.push(`INSERT OR REPLACE INTO runs (id,round_id,prompt_id,engine,model,repeat_no,prompt_text,status,answer,citations_json,searched_json,searches,input_tokens,output_tokens,cost_usd,latency_ms,error,created_at) VALUES (${[r.id, r.round_id, r.prompt_id, r.engine, r.model, r.repeat_no, r.prompt_text, r.status, r.answer, r.citations ? JSON.stringify(r.citations) : null, r.searched ? JSON.stringify(r.searched) : null, r.searches ?? null, r.input_tokens, r.output_tokens, r.cost_usd, r.latency_ms, r.error, r.created_at].map(sql).join(',')});`);
  if (r.status !== 'ok') { scored.push(r); continue; }
  const p = byPrompt[r.prompt_id] || {};
  // Detect on the prose only: inline citation links would otherwise read as the answer naming a retailer or brand.
  const prose = stripLinks(r.answer || '');
  const mentions = markTopPick(prose, findMentions(prose, matchers), matchers);
  // Attributed citations and merely-searched pages are both kept, told apart by source; one row per page.
  const seen = new Set();
  const citations = [];
  for (const [list, source] of [[r.citations || [], 'cited'], [r.searched || [], 'searched']]) {
    for (const c of list) {
      const key = canonicalUrl(c.url);
      if (!c.url || seen.has(key)) continue;
      seen.add(key);
      citations.push({ ...c, source, ...classifyCitation(c.url, brands, retailers, c.title) });
    }
  }
  const routes = findRoutes(prose, r.citations || [], brands, retailers);
  let winner = null;
  if (p.set === 'h2h') {
    const a = brands.find(b => b.name === p.pair_a)?.slug, b = brands.find(x => x.name === p.pair_b)?.slug;
    winner = pickWinner(prose, a, b, matchers);
  }
  for (const m of mentions) out.push(`INSERT OR REPLACE INTO mentions (run_id,brand_slug,position,top_pick) VALUES (${[r.id, m.brand_slug, m.position, m.top_pick].map(sql).join(',')});`);
  for (const c of citations) if (c.url) out.push(`INSERT OR REPLACE INTO citations (run_id,url,domain,kind,source,brand_slug,retailer_slug) VALUES (${[r.id, c.url, c.domain, c.kind, c.source, c.brand_slug, c.retailer_slug].map(sql).join(',')});`);
  for (const rt of routes) out.push(`INSERT OR REPLACE INTO routes (run_id,retailer_slug,brand_slug,url) VALUES (${[r.id, rt.retailer_slug, '', rt.url].map(sql).join(',')});`);
  scored.push({ ...r, mentions, citations, routes, winner });
}
writeFileSync(new URL('runs.scored.jsonl', dir), scored.map(s => JSON.stringify(s)).join('\n') + '\n');
process.stdout.write(out.join('\n') + '\n');
console.error(`${runs.length} runs, ${scored.filter(s => s.status === 'ok').length} ok; scored file written`);
