// Turns data/2026-11-22-race-results.csv into SQL for D1: the race_results table is replaced in full (derived data).
// Only results checked against the official results load; a shoe brand counts only when its source was read
// (shoe_checked_on), otherwise the brand is left out of the counts and shown as not confirmed.
//   node scripts/2026-11-22-races.js > /tmp/races.sql
import { readFileSync, existsSync } from 'node:fs';
import { parseCsv, sql } from '../src/2026-11-21-csv.js';
import { brandSlugFor } from '../src/2026-11-22-races.js';

const read = name => parseCsv(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const brands = read('2026-11-21-brands.csv');
const file = new URL('../data/2026-11-22-race-results.csv', import.meta.url);
const rows = existsSync(file) ? parseCsv(readFileSync(file, 'utf8')) : [];
const out = ['DELETE FROM race_results;'];
for (const r of rows) {
  if (!r.checked_on) continue;
  const confirmed = r.shoe_checked_on && r.brand;
  out.push(`INSERT INTO race_results (race,year,date,gender,place,athlete,country,time,results_url,brand,brand_slug,model,basis,shoe_source_url,shoe_quote,shoe_checked_on,notes,checked_on) VALUES (${[
    r.race, Number(r.year), r.date, r.gender, Number(r.place), r.athlete, r.country, r.time, r.results_url,
    confirmed ? r.brand : null, confirmed ? brandSlugFor(r.brand, brands) : null, confirmed ? r.model : null,
    confirmed ? r.basis : 'unknown', confirmed ? r.shoe_source_url : null, confirmed ? r.shoe_quote : null, r.shoe_checked_on || null, r.notes, r.checked_on,
  ].map(sql).join(',')});`);
}
process.stdout.write(out.join('\n') + '\n');
