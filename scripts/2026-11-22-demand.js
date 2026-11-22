// Builds the demand weights (data/2026-11-22-demand.csv) from the collected signals (data/2026-11-22-demand-signals.csv,
// written by scripts/2026-11-22-demand-signals.js) and the prompt-to-keyword map. The score script reads the weights
// when the file is there and adds the "Where the demand is" view; without it the site shows nothing about demand.
//   npm run demand                      (then: npm run score -- --round <id>, and load scores.sql)
//   node scripts/2026-11-22-demand.js --signals <csv> --out <csv>   (the test uses this)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseCsv, toCsv } from '../src/2026-11-21-csv.js';
import { buildWeights, weightsToRows, SIGNAL_LABEL } from '../src/2026-11-22-demand.js';

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt; };
const signalsFile = arg('--signals', new URL('../data/2026-11-22-demand-signals.csv', import.meta.url));
const outFile = arg('--out', new URL('../data/2026-11-22-demand.csv', import.meta.url));
if (!existsSync(signalsFile)) { console.error(`No signals yet: run npm run demand-signals -- --all on a PC first (writes ${String(signalsFile)}).`); process.exit(1); }
// Newest rows first, so a term or group collected twice keeps its latest value.
const rows = parseCsv(readFileSync(signalsFile, 'utf8')).sort((a, b) => String(b.collected_on || '').localeCompare(String(a.collected_on || '')));
const keywords = parseCsv(readFileSync(new URL('../data/2026-11-22-demand-keywords.csv', import.meta.url), 'utf8'));
const w = buildWeights(rows, keywords);
if (!w) { console.error('The signals file has no usable rows.'); process.exit(1); }
const builtOn = new Date().toISOString().slice(0, 10);
writeFileSync(outFile, toCsv(weightsToRows(w, builtOn)));
console.log(`${w.signals.length} signals (${w.signals.map(s => `${SIGNAL_LABEL[s]} n=${w.n[s]}`).join(', ')}) -> ${String(outFile).replace(/^file:\/\//, '')}`);
for (const g of w.groups) console.log(`${g.label.padEnd(20)} ${String(g.weight).padStart(5)}%` + (g.low != null ? `  (range ${g.low}–${g.high})` : '') + `  ${Object.entries(g.by_signal).map(([s, v]) => `${s} ${v}`).join('  ')}`);
