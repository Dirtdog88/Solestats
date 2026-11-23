// Scores a round from runs.scored.jsonl (made by import): per brand per subject, overall, and the retailer table.
// Writes scores.csv, routing.json and scores.sql in the round folder.
//   node scripts/2026-11-21-score.js --round 2026-12
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { parseCsv, toCsv, sql } from '../src/2026-11-21-csv.js';
import { modelsIn, modelMatchers, modelView, steeringView, versionCurrency, substitutionView, attributeMatchers, attributeView } from '../src/2026-11-22-extract.js';
import { brandMatchers, findMentions } from '../src/2026-11-21-detect.js';
import { GROUP_LABEL, needGrid, needGapFixes, h2hGrid, sideOf, placesView, sourcesView, sourceFixes, engineSplit, engineFixes, engineHow, enginePatterns, topSourceDomains } from '../src/2026-11-22-insights.js';
import { eligible, MIN_SOURCED_ANSWERS, placesFor, shareOfVoice, scoreRecommended, scoreSourced, scoreRouting, scoreAccurate, scoreShoppable, overall, routingTable } from '../src/2026-11-21-score.js';
import { weightsFromRows, demandView } from '../src/2026-11-22-demand.js';
import { CATEGORIES, categoryOfRound } from '../src/2026-11-23-categories.js';

const round = process.argv[process.argv.indexOf('--round') + 1];
if (!round || round.startsWith('--')) { console.error('usage: --round <id>'); process.exit(1); }
const read = name => { try { return parseCsv(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8')); } catch { return []; } };
// The round's category (its id: "gels-2026-12") picks its brands, prompts and product lists; retailers are shared.
const CATKEY = categoryOfRound(round), CAT = CATEGORIES[CATKEY], SHOES = CATKEY === 'shoes';
const brands = read(CAT.brands), retailers = read('2026-11-21-retailers.csv'), models = read(CAT.models).filter(m => m.verified_on);
const prompts = read(CAT.prompts).map(p => ({ ...p, set_name: p.set }));
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
const catBrands = brands.filter(b => b.category === CATKEY);
const shoeBrands = catBrands.map(b => b.slug); // this category's brands (the name is from when there were only shoes)
const views = { needs: { '': needGrid(runs, prompts, shoeBrands) }, h2h: { '': h2hGrid(runs, prompts, catBrands) } };
views.sourcing = { '': topSourceDomains(runs) };
// Tier 2 extraction: models named, from every spec-sheet row (names need no verification; facts do).
const matchers = modelMatchers(read(CAT.models), read(CAT.aliases), brands);
views.models = modelView(runs, prompts, matchers, shoeBrands);
const bm = brandMatchers(catBrands);
const findBrands = t => findMentions(t, bm).map(m => m.brand_slug);
// The attribute phrase list is written for shoes; other categories get theirs later.
if (CAT.attributes) views.attributes = attributeView(runs, prompts, findBrands, matchers, attributeMatchers(read(CAT.attributes)), shoeBrands);
views.steering = steeringView(runs, prompts, findBrands, matchers, shoeBrands);
// Version currency needs the current version from verified spec-sheet rows; until then each brand is pending.
views.substitution = substitutionView(runs, prompts, catBrands, read(CAT.models), eligible, GROUP_LABEL);
if (SHOES) views.versions = Object.fromEntries(shoeBrands.map(s => [s, versionCurrency(views.models[s], read(CAT.models))]));
views.places = placesView(runs, catBrands, retailers, placesFor);
// Each brand's side of its head-to-head pairs, for the /h2h grid rows and the brand page.
for (const slug of views.h2h[''].brands) views.h2h[slug] = { sides: views.h2h[''].pairs.filter(p => p.a === slug || p.b === slug).map(p => sideOf(p, slug)) };
views.sources = sourcesView(runs, prompts, catBrands, MIN_SOURCED_ANSWERS);
const fixes = []; // [{ brand, subject, text }] in order of importance per brand
// Engine split: Recommended, Sourced and Sale goes home on each engine's answers alone (Accurate and Shoppable come
// from the hand checks, not the answers). An engine more than 10 points below the others is a fix.
const SUBJECT_LABEL = { recommended: 'Recommended', sourced: 'Sourced', routing: 'Sale goes home' };
views.engines = {};
const engineFixList = [];
for (const b of catBrands) {
  views.engines[b.slug] = engineSplit(runs, { recommended: rs => scoreRecommended(b, prompts, rs, models), sourced: rs => scoreSourced(b, rs), routing: rs => scoreRouting(b, rs, retailers) });
  const ef = engineFixes(b.slug, views.engines[b.slug], s => SUBJECT_LABEL[s] || s);
  for (const f of ef) views.engines[b.slug][f.subject].low = f.engine; // the brand page marks it
  engineFixList.push(...ef);
}
// A gap one engine shows for most brands is one note in the summary, not a fix on every page; the marks stay.
const ep = enginePatterns(engineFixList, views.engines);
views.engine_patterns = { '': { patterns: ep.patterns } };
for (const p of ep.patterns) for (const v of Object.values(views.engines)) if (v[p.subject] && v[p.subject].low === p.engine) v[p.subject].pattern = true;
// Each engine fix gets its "How" (engineHow): where the gap is, who wins instead, what that engine reads.
const brandNames = Object.fromEntries(brands.map(b => [b.slug, b.name]));
fixes.push(...ep.fixes.map(({ engine, ...f }) => {
  const how = engineHow({ ...f, engine }, { brand: { slug: f.brand, name: brandNames[f.brand] }, names: brandNames, runs, prompts, retailers, placesFor, modelsIn: a => modelsIn(a, matchers) });
  return how ? { ...f, text: `${f.text} How: ${how}` } : f;
}));
for (const [slug, v] of Object.entries(views.sources)) fixes.push(...sourceFixes(slug, v));
// Need-group gaps (gels, 2026-11-23): shoes get theirs from Where the demand is (Fix these first) instead.
if (!SHOES) for (const b of catBrands) fixes.push(...needGapFixes(b.slug, views.needs[''], views.substitution?.[b.slug], brandNames));
// Where the demand is (src/2026-11-22-demand.js): only once data/2026-11-22-demand.csv exists (npm run demand-signals on a
// PC, then npm run demand). Credible groups per brand come from the spec sheet as in When not you, who: verified rows,
// else the draft rows, else every group.
const demandRows = SHOES ? read('2026-11-22-demand.csv') : []; // demand weights are for shoes so far
const weights = demandRows.length ? weightsFromRows(demandRows) : null;
if (weights) {
  const specAll = read('2026-11-21-spec-sheet.csv');
  const eligibleGroups = {};
  for (const b of catBrands) {
    const verified = specAll.filter(m => m.brand_slug === b.slug && m.verified_on);
    const rowsFor = verified.length ? verified : specAll.filter(m => m.brand_slug === b.slug);
    eligibleGroups[b.slug] = new Set(prompts.filter(p => p.set_name === 'shoe' && eligible(b, p, rowsFor)).map(p => p.group));
  }
  const dv = demandView(views.needs[''], weights, eligibleGroups);
  if (dv) views.demand = dv;
}
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
  if (!SHOES) return { rows: [], round: null }; // the hand checks are shoe checks
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
