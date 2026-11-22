// Turns data/2026-11-21-financials.csv (and data/2026-11-22-fx.csv) into SQL for D1: the financials table is replaced in full (it is derived from
// the CSV, not user data). Only rows with checked_on (checked against their source) are loaded.
//   node scripts/2026-11-21-financials.js > /tmp/financials.sql
//   CLOUDFLARE_API_TOKEN=... npx wrangler@4 d1 execute solestats --remote --file /tmp/financials.sql
import { readFileSync, existsSync } from 'node:fs';
import { parseCsv, sql } from '../src/2026-11-21-csv.js';

const file = new URL('../data/2026-11-21-financials.csv', import.meta.url);
const rows = existsSync(file) ? parseCsv(readFileSync(file, 'utf8')) : [];
const num = v => (v === '' || v == null ? null : Number(v));
const out = ['DELETE FROM financials;'];
for (const r of rows) {
  if (!r.checked_on) continue;
  if (r.source_url && !/^https:\/\//.test(r.source_url)) throw new Error(`${r.brand} ${r.fiscal_year}: source_url must be https`);
  out.push(`INSERT INTO financials (brand_slug,fiscal_year,measure,level,owner,ticker,period_end,value,unit,currency,prior_value,yoy_pct,source_type,source_url,published_on,quote,notes,checked_on) VALUES (${[r.brand, r.fiscal_year, r.measure, r.level, r.owner, r.ticker, r.period_end, num(r.value), r.unit, r.currency, num(r.prior_value), num(r.yoy_pct), r.source_type, r.source_url, r.published_on, r.quote, r.notes, r.checked_on].map(sql).join(',')});`);
}
// Yearly average exchange rates (Federal Reserve G.5A), only for the share of voice view's common scale.
const fxFile = new URL('../data/2026-11-22-fx.csv', import.meta.url);
if (existsSync(fxFile)) {
  out.push('DELETE FROM fx_rates;');
  for (const r of parseCsv(readFileSync(fxFile, 'utf8'))) if (r.checked_on) out.push(`INSERT INTO fx_rates (currency,year,usd_per_unit,source_url,quote,checked_on) VALUES (${[r.currency, r.year, num(r.usd_per_unit), r.source_url, r.quote, r.checked_on].map(sql).join(',')});`);
}
process.stdout.write(out.join('\n') + '\n');
