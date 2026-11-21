// The runner: every prompt x engine x repeat, written as JSON lines to data/rounds/<round>/runs.jsonl.
// Resumable: runs already in the file are skipped, so a crash or a cap just means running it again.
//
//   node scripts/2026-11-21-run.js --round 2026-12 --engines anthropic,openai,gemini --repeats 3
//   options: --set shoe|h2h|scan|retailer (repeatable, default all)  --limit N  --dry-run  --cap-usd 60  --concurrency 3
//
// Keys: SOLESTATS_ANTHROPIC_KEY (or ANTHROPIC_API_KEY on a PC), OPENAI_API_KEY, GEMINI_API_KEY, PERPLEXITY_API_KEY.
// Set spend caps at each provider too.

import { readFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { parseCsv } from '../src/2026-11-21-csv.js';
import { ENGINES, estimateCost } from './2026-11-21-engines.js';

const args = parseArgs(process.argv.slice(2));
const round = args.round || new Date().toISOString().slice(0, 7);
const engines = (args.engines || 'anthropic,openai,gemini').split(',').map(s => s.trim()).filter(Boolean);
const repeats = Number(args.repeats || 3);
const sets = [].concat(args.set || []).filter(Boolean);
const capUsd = Number(args['cap-usd'] || 150);
const concurrency = Number(args.concurrency || 3);
for (const e of engines) if (!ENGINES[e]) { console.error(`unknown engine ${e}; known: ${Object.keys(ENGINES).join(', ')}`); process.exit(1); }

const prompts = parseCsv(readFileSync(new URL('../data/2026-11-21-prompts.csv', import.meta.url), 'utf8'))
  .filter(p => !sets.length || sets.includes(p.set))
  .slice(0, args.limit ? Number(args.limit) : undefined);

const dir = new URL(`../data/rounds/${round}/`, import.meta.url);
mkdirSync(dir, { recursive: true });
const file = new URL('runs.jsonl', dir);
const done = new Set(existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).id) : []);

const jobs = [];
for (const p of prompts) for (const engine of engines) for (let n = 1; n <= repeats; n++) {
  const id = `${round}/${p.id}/${engine}/${n}`;
  if (done.has(id)) continue;
  // Head-to-head: alternate the order of the two brands between repeats so position in the question doesn't decide.
  const text = p.set === 'h2h' && n % 2 === 0 ? p.text.replace(`${p.pair_a} or ${p.pair_b}`, `${p.pair_b} or ${p.pair_a}`) : p.text;
  jobs.push({ id, round_id: round, prompt_id: p.id, engine, repeat_no: n, prompt_text: text });
}
console.log(`${round}: ${prompts.length} prompts x ${engines.length} engines x ${repeats} repeats = ${prompts.length * engines.length * repeats} runs; ${done.size} already done; ${jobs.length} to go`);
if (args['dry-run']) { for (const j of jobs.slice(0, 10)) console.log(' ', j.id, '->', j.prompt_text); process.exit(0); }

let spent = 0, ok = 0, failed = 0, next = 0;
async function worker() {
  while (next < jobs.length) {
    if (spent >= capUsd) { console.error(`cap of $${capUsd} reached; run again later to resume`); return; }
    const job = jobs[next++];
    const started = Date.now();
    let row;
    try {
      const r = await ENGINES[job.engine](job.prompt_text);
      const cost = estimateCost(job.engine, r.input_tokens, r.output_tokens);
      spent += cost; ok++;
      row = { ...job, model: r.model, status: 'ok', answer: r.answer, citations: r.citations, input_tokens: r.input_tokens ?? null, output_tokens: r.output_tokens ?? null, cost_usd: round4(cost), latency_ms: Date.now() - started, stop_reason: r.stop_reason || null, created_at: new Date().toISOString() };
      appendFileSync(new URL(`raw/${job.id.replace(/\//g, '_')}.json`, mkraw()), JSON.stringify(r.raw));
    } catch (e) {
      failed++;
      row = { ...job, status: 'error', error: String(e.message || e).slice(0, 1000), latency_ms: Date.now() - started, created_at: new Date().toISOString() };
      await sleep(2000);
    }
    appendFileSync(file, JSON.stringify(row) + '\n');
    if ((ok + failed) % 10 === 0) console.log(`  ${ok + failed}/${jobs.length}  ok ${ok}  failed ${failed}  ~$${spent.toFixed(2)}`);
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
console.log(`done: ok ${ok}, failed ${failed}, ~$${spent.toFixed(2)} this session. Errors are rows with status "error"; run again to retry them after deleting those lines.`);

function mkraw() { const d = new URL('raw/', dir); mkdirSync(d, { recursive: true }); return dir; }
function round4(x) { return Math.round(x * 1e4) / 1e4; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    out[k] = k in out ? [].concat(out[k], v) : v;
  }
  return out;
}
