// The Accurate questions (2026-11-23): one short question per confirmed spec-sheet fact, asked of each engine, graded
// against the sheet. Resumable: answers already in fact-runs.jsonl are skipped. Grading rewrites fact-checks.jsonl,
// which the score script reads ({brand_slug, model_id, fact, result, repeat_no, engine, expected, found}).
//
//   npm run facts -- --round gels-2026-11 --dry-run            the questions and the call count, no calls
//   npm run facts -- --round gels-2026-11 --repeats 2 --cap-usd 35
//   npm run facts -- --round gels-2026-11 --grade-only         re-grade the stored answers (after a tolerance change)
// In a cloud session: npm run facts (it passes --use-env-proxy).

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { parseCsv } from '../src/2026-11-21-csv.js';
import { CATEGORIES, categoryOfRound } from '../src/2026-11-23-categories.js';
import { factQuestions, gradeFact } from '../src/2026-11-23-facts.js';
import { ENGINES, estimateCost } from './2026-11-21-engines.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? a.concat([[v.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]]) : a), []));
const round = args.round;
if (!round || round === true) { console.error('usage: --round <id> [--repeats 2] [--engines anthropic,openai,gemini] [--cap-usd 35] [--dry-run] [--grade-only]'); process.exit(1); }
const cat = categoryOfRound(round), CAT = CATEGORIES[cat];
if (!CAT.specs) { console.error(`no spec sheet set for ${cat} in src/2026-11-23-categories.js`); process.exit(1); }
const read = name => parseCsv(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const engines = String(args.engines || 'anthropic,openai,gemini').split(',');
const repeats = Number(args.repeats || 2), capUsd = Number(args['cap-usd'] || 35), concurrency = Number(args.concurrency || 3);
const dir = new URL(`../data/rounds/${round}/`, import.meta.url); mkdirSync(dir, { recursive: true });
const runsFile = new URL('fact-runs.jsonl', dir), checksFile = new URL('fact-checks.jsonl', dir);

const questions = factQuestions(read(CAT.specs), read(CAT.brands), cat);
if (!questions.length) { console.error(`no confirmed rows in data/${CAT.specs} yet (verified_on is empty everywhere)`); process.exit(1); }
const jobs = [];
for (const q of questions) for (const engine of engines) for (let r = 1; r <= repeats; r++) jobs.push({ id: `${round}/${q.model_id}/${q.fact}/${engine}/${r}`, ...q, engine, repeat_no: r });
const readJsonl = f => existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const done = new Map(readJsonl(runsFile).filter(r => r.status === 'ok').map(r => [r.id, r]));
const todo = jobs.filter(j => !done.has(j.id));
console.log(`${round}: ${questions.length} questions x ${engines.length} engines x ${repeats} = ${jobs.length} answers; ${done.size} done; ${todo.length} to go`);
if (args['dry-run']) { for (const q of questions.slice(0, 12)) console.log('  ' + q.question + '  -> ' + q.expected); process.exit(0); }

if (!args['grade-only']) {
  let spent = 0, n = 0;
  async function worker() {
    while (todo.length) {
      if (spent >= capUsd) { console.error(`cap of $${capUsd} reached; run again later to resume`); return; }
      const job = todo.shift();
      let row;
      try {
        const r = await ENGINES[job.engine](job.question);
        const cost = estimateCost(job.engine, r.input_tokens, r.output_tokens, r.searches, r.cached_tokens);
        spent += cost;
        row = { ...job, model: r.model, status: 'ok', answer: r.answer, searches: r.searches || 0, cost_usd: Math.round(cost * 1e4) / 1e4, created_at: new Date().toISOString() };
      } catch (e) { row = { ...job, status: 'error', error: String(e.message || e).slice(0, 300), created_at: new Date().toISOString() }; }
      appendFileSync(runsFile, JSON.stringify(row) + '\n');
      if (row.status === 'ok') done.set(row.id, row);
      if (++n % 20 === 0) console.log(`  ${n} answered, ~$${spent.toFixed(2)}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log(`answers done this session: ${n}, ~$${spent.toFixed(2)}`);
}

// Grade every stored answer against the sheet as it stands now.
const want = new Map(questions.map(q => [`${q.model_id}/${q.fact}`, q.expected]));
const checks = [...done.values()].filter(r => want.has(`${r.model_id}/${r.fact}`)).map(r => {
  const expected = want.get(`${r.model_id}/${r.fact}`);
  const g = gradeFact(cat, r.fact, r.answer, expected);
  return { brand_slug: r.brand_slug, model_id: r.model_id, fact: r.fact, result: g.result, repeat_no: r.repeat_no, engine: r.engine, expected, found: g.found };
});
writeFileSync(checksFile, checks.map(c => JSON.stringify(c)).join('\n') + '\n');
const tally = checks.reduce((t, c) => (t[c.result] = (t[c.result] || 0) + 1, t), {});
console.log(`graded ${checks.length}: ${JSON.stringify(tally)} -> ${checksFile.pathname}`);
