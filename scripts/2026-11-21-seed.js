// Turns the CSVs into SQL for D1: brands, retailers, prompts, and the spec sheet when it has rows. Every category's
// brands and prompts (src/2026-11-23-categories.js); a category whose prompt file is not written yet is skipped.
//   node scripts/2026-11-21-seed.js > data/seed.sql
//   npx wrangler@4 d1 execute solestats --remote --file data/seed.sql
import { readFileSync } from 'node:fs';
import { parseCsv, sql } from '../src/2026-11-21-csv.js';
import { CATEGORIES } from '../src/2026-11-23-categories.js';

const read = name => parseCsv(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const out = [];
const readIf = name => { try { return read(name); } catch { return []; } };
const cats = Object.values(CATEGORIES);
for (const b of cats.flatMap(c => readIf(c.brands)))
  out.push(`INSERT OR REPLACE INTO brands (slug,name,category,treatment,domain,aliases) VALUES (${[b.slug, b.name, b.category, b.treatment, b.domain, b.aliases].map(sql).join(',')});`);
for (const r of read('2026-11-21-retailers.csv'))
  out.push(`INSERT OR REPLACE INTO retailers (slug,name,kind,domains) VALUES (${[r.slug, r.name, r.kind, r.domains].map(sql).join(',')});`);
for (const p of cats.flatMap(c => readIf(c.prompts)))
  out.push(`INSERT OR REPLACE INTO prompts (id,set_name,category,prompt_group,text,tags,pulse,pair_a,pair_b) VALUES (${[p.id, p.set, p.category, p.group || null, p.text, p.tags, Number(p.pulse || 0), p.pair_a, p.pair_b].map(sql).join(',')});`);
try {
  for (const m of read('2026-11-21-spec-sheet.csv')) {
    if (!m.verified_on) continue; // only verified rows go to the database
    out.push(`INSERT OR REPLACE INTO models (id,brand_slug,name,version,price_usd,weight_oz,drop_mm,stack_band,widths,category,needs,verified_on,source_url,notes) VALUES (${[m.id, m.brand_slug, m.name, m.version, num(m.price_usd), num(m.weight_oz), num(m.drop_mm), m.stack_band, m.widths, m.category, m.needs, m.verified_on, m.source_url, m.notes].map(sql).join(',')});`);
  }
} catch { /* no spec sheet yet */ }
process.stdout.write(out.join('\n') + '\n');
function num(v) { return v === '' || v == null ? null : Number(v); }
