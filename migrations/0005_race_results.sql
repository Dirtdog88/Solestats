-- 2026-11-22: top-10 finishers of the World Marathon Majors and the World Championships marathon, 2025 onward, with
-- the shoe brand each raced in (Alex asked for it): context beside share of voice, never scored. Rebuilt in full from
-- data/2026-11-22-race-results.csv by scripts/2026-11-22-races.js. Safe to paste twice: IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS race_results (
  race TEXT NOT NULL,                -- Boston Marathon, World Championships Marathon
  year INTEGER NOT NULL,
  date TEXT,                         -- YYYY-MM-DD
  gender TEXT NOT NULL,              -- men | women (open races; wheelchair races are out of scope)
  place INTEGER NOT NULL,            -- 1-10
  athlete TEXT NOT NULL,
  country TEXT,                      -- 3-letter code
  time TEXT,
  results_url TEXT,
  brand TEXT,                        -- as named (Nike, adidas, Li-Ning); null when not known
  brand_slug TEXT,                   -- one of the watched brands, else null ("other brands")
  model TEXT,
  basis TEXT NOT NULL,               -- worn (race-day source) | sponsor (contract brand) | unknown
  shoe_source_url TEXT,
  shoe_quote TEXT,
  shoe_checked_on TEXT,              -- the shoe claim was read at its source; unchecked claims are not counted
  notes TEXT,
  checked_on TEXT,                   -- the result was read in the official results
  PRIMARY KEY (race, year, gender, place)
);
