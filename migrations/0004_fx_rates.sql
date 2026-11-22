-- 2026-11-22: yearly average exchange rates, used only to put brands' reported revenue on one scale for the share of
-- voice view (the Revenue card keeps each company's own currency). Rebuilt in full from data/2026-11-22-fx.csv by
-- scripts/2026-11-21-financials.js. Safe to paste twice: IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS fx_rates (
  currency TEXT NOT NULL,            -- ISO code
  year TEXT NOT NULL,                -- calendar year of the average
  usd_per_unit REAL NOT NULL,
  source_url TEXT,
  quote TEXT,
  checked_on TEXT,
  PRIMARY KEY (currency, year)
);
