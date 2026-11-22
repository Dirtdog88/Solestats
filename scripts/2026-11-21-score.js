// Scores a round from runs.scored.jsonl (made by import): per brand per subject, overall, and the retailer table.
// Writes scores.csv, routing.json and scores.sql in the round folder.
//   node scripts/2026-11-21-score.js --round 2026-12
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { parseCsv, toCsv, sql } from '../src/2026-11-21-csv.js';
import { modelMatchers, modelView } from '../src/2026-11-22-extract.js';
import { needGrid, h2hGrid, sideOf, placesView, sourcesView, sourceFixes, engineSplit, engineFixes, enginePatterns, topSourceDomains } from '../src/2026-11-22-insights.js';
import { MIN_SOURCED_ANSWERS, placesFor, shareOfVoice, scoreRecommended, scoreSourced, scoreRouting, scoreAccurate, scoreShoppable, overall, routingTable } from '../src/2026-11-21-score.js';

const round = process.argv[process.argv.indexOf('--round') + 1];
if (!round || round.startsWith('--')) { console.error('usage: --round <id>'); process.exit(1); }
const read = name => { try { return parseCsv(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8')); } catch { return []; } };
const brands = read('2026-11-21-brands.csv'), retailers = read('2026-11-21-retailers.csv'), models = read('2026-11-21-spec-sheet.csv').filter(m => m.verified_on);
const prompts = read('2026-11-21-prompts.csv').map(p => ({ ...p, set_name: p.set }));
const dir = new URL(`../data/rounds/${round}/`, import.meta.url);
const runs = readFileSync(new URL('runs.scored.jsonl', dir), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
// The hand checks run once a quarter while rounds run monthly (Alex, 2026-11-21): a round without its own checks uses
// the latest earlier round that has them, and the detail says which (checked_round).
const fact = latestChecks('fact-checks.jsonl');   // [{brand_slug, model_id, fact, result, repeat_no}] from the Accurate questions
const site = latestChecks('site-checks.jsonl');   // [{brand_slug, item, result}] from the manual Shoppable checklist
const checks = fact.rows, siteChecks = site.rows;

const rows = [], sqls = [];
for (const b of brands) {
  const subjects = {
    recommended: scoreRecommended(b, prompts, runs, models),
    sourced: scoreSourced(b, runs),
    routing: scoreRouting(b, runs, retailers),
  };
  if (b.treatment !== 'scan') {
    subjects.accurate = withRound(scoreAccurate(checks.filter(c => c.brand_slug === b.slug)), fact.round);
    subjects.shoppable = withRound(scoreShoppable(siteChecks.filter(c => c.brand_slug === b.slug)), site.round);
    subjects.overall = overall(subjects);
  }
  for (const [subject, s] of Object.entries(subjects)) {
    if (s.score == null) continue;
    rows.push({ round, brand: b.slug, category: b.category, subject, score: s.score, margin: s.margin, n: s.n, detail: JSON.stringify(s.detail) });
    sqls.push(`INSERT OR REPLACE INTO scores (round_id,brand_slug,subject,score,margin,n,detail_json) VALUES (${[round, b.slug, subject, s.score, s.margin, s.n, JSON.stringify(s.detail)].map(sql).join(',')});`);
  }
}
// Share of voice: a row per brand under subject share_of_voice (not part of Overall).
const sov = shareOfVoice(runs, prompts);
for (const b of brands) {
  const s = sov[b.slug];
  if (!s) continue;
  rows.push({ round, brand: b.slug, category: b.category, subject: 'share_of_voice', score: s.score, margin: s.margin, n: s.n, detail: JSON.stringify(s.detail) });
  sqls.push(`INSERT OR REPLACE INTO scores (round_id,brand_slug,subject,score,margin,n,detail_json) VALUES (${[round, b.slug, 'share_of_voice', s.score, s.margin, s.n, JSON.stringify(s.detail)].map(sql).join(',')});`);
}
// Views for brand teams (src/2026-11-22-insights.js): one row per view and key, replaced whole each time.
const shoeBrands = brands.filter(b => b.category === 'shoes').map(b => b.slug);
const views = { needs: { '': needGrid(runs, prompts, shoeBrands) }, h2h: { '': h2hGrid(runs, prompts, brands.filter(b => b.category === 'shoes')) } };
views.sourcing = { '': topSourceDomains(runs) };
// Tier 2 extraction: models named, from every spec-sheet row (names need no verification; facts do).
const matchers = modelMatchers(read('2026-11-21-spec-sheet.csv'), read('2026-11-22-model-aliases.csv'), brands);
views.models = modelView(runs, prompts, matchers, shoeBrands);
views.places = placesView(runs, brands.filter(b => b.category === 'shoes'), retailers, placesFor);
// Each brand's side of its head-to-head pairs, for the /h2h grid rows and the brand page.
for (const slug of views.h2h[''].brands) views.h2h[slug] = { sides: views.h2h[''].pairs.filter(p => p.a === slug || p.b === slug).map(p => sideOf(p, slug)) };
views.sources = sourcesView(runs, prompts, brands.filter(b => b.category === 'shoes'), MIN_SOURCED_ANSWERS);
const fixes = []; // [{ brand, subject, text }] in order of importance per brand
// Engine split: Recommended, Sourced and Sale goes home on each engine's answers alone (Accurate and Shoppable come
// from the hand checks, not the answers). An engine more than 10 points below the others is a fix.
const SUBJECT_LABEL = { recommended: 'Recommended', sourced: 'Sourced', routing: 'Sale goes home' };
views.engines = {};
const engineFixList = [];
for (const b of brands.filter(x => x.category === 'shoes')) {
  views.engines[b.slug] = engineSplit(runs, { recommended: rs => scoreRecommended(b, prompts, rs, models), sourced: rs => scoreSourced(b, rs), routing: rs => scoreRouting(b, rs, retailers) });
  const ef = engineFixes(b.slug, views.engines[b.slug], s => SUBJECT_LABEL[s] || s);
  for (const f of ef) views.engines[b.slug][f.subject].low = f.engine; // the brand page marks it
  engineFixList.push(...ef);
}
// A gap one engine shows for most brands is one note in the summary, not a fix on every page; the marks stay.
const ep = enginePatterns(engineFixList, views.engines);
views.engine_patterns = { '': { patterns: ep.patterns } };
for (const p of ep.patterns) for (const v of Object.values(views.engines)) if (v[p.subject] && v[p.subject].low === p.engine) v[p.subject].pattern = true;
fixes.push(...ep.fixes.map(({ engine, ...f }) => f));
for (const [slug, v] of Object.entries(views.sources)) fixes.push(...sourceFixes(slug, v));
sqls.unshift(`DELETE FROM views WHERE round_id = ${sql(round)};`, `DELETE FROM fixes WHERE round_id = ${sql(round)};`);
for (const [view, byKey] of Object.entries(views)) for (const [key, detail] of Object.entries(byKey)) sqls.push(`INSERT OR REPLACE INTO views (round_id,view,key,detail_json) VALUES (${[round, view, key, JSON.stringify(detail)].map(sql).join(',')});`);
const rank = {};
for (const f of fixes) { const k = f.brand + '/' + f.subject; rank[k] = (rank[k] || 0) + 1; sqls.push(`INSERT OR REPLACE INTO fixes (round_id,brand_slug,subject,rank,text) VALUES (${[round, f.brand, f.subject, rank[k], f.text].map(sql).join(',')});`); }
writeFileSync(new URL('views.json', dir), JSON.stringify({ round, views, fixes }, null, 1));
writeFileSync(new URL('scores.csv', dir), toCsv(rows, ['round', 'brand', 'category', 'subject', 'score', 'margin', 'n', 'detail']));
writeFileSync(new URL('scores.sql', dir), sqls.join('\n') + '\n');
writeFileSync(new URL('routing.json', dir), JSON.stringify(routingTable(runs, prompts), null, 2));
console.log(`${rows.length} scores for ${new Set(rows.map(r => r.brand)).size} brands, ${Object.keys(views).length} views, ${fixes.length} fixes -> scores.csv, scores.sql, views.json, routing.json`);

/** The given checks file from this round, else from the latest earlier monthly round (YYYY-MM) that has one. */
function latestChecks(name) {
  const rounds = readdirSync(new URL('../data/rounds/', import.meta.url)).filter(r => /^\d{4}-\d{2}$/.test(r) && r <= round).sort().reverse();
  if (!rounds.includes(round)) rounds.unshift(round);
  for (const r of rounds) {
    const url = new URL(`../data/rounds/${r}/${name}`, import.meta.url);
    if (existsSync(url)) return { rows: readJsonl(url), round: r };
  }
  return { rows: [], round: null };
}

function withRound(s, checkedRound) { if (s.score != null && checkedRound) s.detail = { ...s.detail, checked_round: checkedRound }; return s; }

function readJsonl(url) { try { return readFileSync(url, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } }
