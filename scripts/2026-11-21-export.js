// The open dataset: writes the CSVs people can download into public/data/<round>/ (prompts, answers with
// citations, mentions, routes, scores). Raw API responses stay out (they are large and unreviewed).
//   node scripts/2026-11-21-export.js --round 2026-12
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { toCsv } from '../src/2026-11-21-csv.js';

const round = process.argv[process.argv.indexOf('--round') + 1];
if (!round || round.startsWith('--')) { console.error('usage: --round <id>'); process.exit(1); }
const dir = new URL(`../data/rounds/${round}/`, import.meta.url);
const out = new URL(`../public/data/${round}/`, import.meta.url);
mkdirSync(out, { recursive: true });
const runs = readFileSync(new URL('runs.scored.jsonl', dir), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
writeFileSync(new URL('answers.csv', out), toCsv(runs.map(r => ({ run_id: r.id, prompt_id: r.prompt_id, engine: r.engine, model: r.model, repeat: r.repeat_no, prompt: r.prompt_text, status: r.status, answer: r.answer, citations: (r.citations || []).filter(c => c.source !== 'searched').map(c => c.url).join(' '), searched: (r.citations || []).filter(c => c.source === 'searched').map(c => c.url).join(' '), searches: r.searches ?? '', created_at: r.created_at }))));
writeFileSync(new URL('mentions.csv', out), toCsv(runs.flatMap(r => (r.mentions || []).map(m => ({ run_id: r.id, prompt_id: r.prompt_id, engine: r.engine, repeat: r.repeat_no, brand: m.brand_slug, position: m.position, top_pick: m.top_pick }))), ['run_id', 'prompt_id', 'engine', 'repeat', 'brand', 'position', 'top_pick']));
writeFileSync(new URL('routes.csv', out), toCsv(runs.flatMap(r => (r.routes || []).map(x => ({ run_id: r.id, prompt_id: r.prompt_id, engine: r.engine, repeat: r.repeat_no, retailer: x.retailer_slug, url: x.url || '' }))), ['run_id', 'prompt_id', 'engine', 'repeat', 'retailer', 'url']));
for (const f of ['scores.csv']) { try { copyFileSync(new URL(f, dir), new URL(f, out)); } catch { /* not scored yet */ } }
copyFileSync(new URL('../data/2026-11-21-prompts.csv', import.meta.url), new URL('prompts.csv', out));
console.log(`exported to public/data/${round}/`);
