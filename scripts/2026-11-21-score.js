// Scores a round from runs.scored.jsonl (made by import): per brand per subject, overall, and the retailer table.
// Writes scores.csv, routing.json and scores.sql in the round folder.
//   node scripts/2026-11-21-score.js --round 2026-12
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { parseCsv, toCsv, sql } from '../src/2026-11-21-csv.js';
import { shareOfVoice, scoreRecommended, scoreSourced, scoreRouting, scoreAccurate, scoreShoppable, overall, routingTable } from '../src/2026-11-21-score.js';

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
writeFileSync(new URL('scores.csv', dir), toCsv(rows, ['round', 'brand', 'category', 'subject', 'score', 'margin', 'n', 'detail']));
writeFileSync(new URL('scores.sql', dir), sqls.join('\n') + '\n');
writeFileSync(new URL('routing.json', dir), JSON.stringify(routingTable(runs, prompts), null, 2));
console.log(`${rows.length} scores for ${new Set(rows.map(r => r.brand)).size} brands -> scores.csv, scores.sql, routing.json`);

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
