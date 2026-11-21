-- 2026-11-21: publicly reported revenue for each brand or its owner (Alex asked for it), shown as context on the brand
-- page and never scored. One row per brand, fiscal year and measure; rebuilt in full from
-- data/2026-11-21-financials.csv by scripts/2026-11-21-financials.js (derived data, so the loader replaces it).
-- Safe to paste twice: IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS financials (
  brand_slug TEXT NOT NULL REFERENCES brands(slug),
  fiscal_year TEXT NOT NULL,         -- as the company names it: FY2026, 2025
  measure TEXT NOT NULL,             -- as reported: "HOKA brand net sales", "Footwear revenues"
  level TEXT NOT NULL,               -- brand | category | footwear | segment | company
  owner TEXT,                        -- the reporting company
  ticker TEXT,
  period_end TEXT,                   -- YYYY-MM-DD
  value REAL,                        -- in `unit` of `currency`; null when not disclosed
  unit TEXT,                         -- millions | billions
  currency TEXT,                     -- ISO code, as reported (no conversion)
  prior_value REAL,
  yoy_pct REAL,                      -- reported-currency change from prior_value
  source_type TEXT,                  -- 10-K | 20-F | annual report | results press release | company press release
  source_url TEXT,
  published_on TEXT,
  quote TEXT,                        -- the sentence or table row that states the figure
  notes TEXT,
  checked_on TEXT,                   -- when the figure was checked against the source
  PRIMARY KEY (brand_slug, fiscal_year, measure)
);
