-- SoleStats schema, round 1 (2026-11-21). Safe to paste into the D1 console twice: everything is IF NOT EXISTS.
-- Loaded from CSV by the scripts; the Worker only reads.

CREATE TABLE IF NOT EXISTS brands (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,            -- shoes | apparel | watches | fuel | vests | audio_lights_eyewear | recovery
  treatment TEXT NOT NULL,           -- full (five subjects) | eligible (shoes, scored where eligible) | scan
  domain TEXT,
  aliases TEXT                       -- ; separated other spellings AI uses
);

CREATE TABLE IF NOT EXISTS retailers (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  domains TEXT
);

CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,               -- S001 shoe, H001 head-to-head, C001 scan, R001 retailer
  set_name TEXT NOT NULL,            -- shoe | h2h | scan | retailer
  category TEXT NOT NULL,
  text TEXT NOT NULL,
  tags TEXT,                         -- ; separated needs; drive eligibility for Recommended
  pair_a TEXT,                       -- head-to-head only
  pair_b TEXT
);

CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY,               -- 2026-12 etc.
  started_at TEXT NOT NULL,
  finished_at TEXT,
  engines TEXT NOT NULL,             -- ; separated
  repeats INTEGER NOT NULL DEFAULT 3,
  notes TEXT
);

-- One row per prompt x engine x repeat. The raw answer is kept so anything can be re-scored later.
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,               -- <round>/<prompt>/<engine>/<repeat>
  round_id TEXT NOT NULL REFERENCES rounds(id),
  prompt_id TEXT NOT NULL REFERENCES prompts(id),
  engine TEXT NOT NULL,              -- openai | anthropic | gemini | perplexity | rufus
  model TEXT,                        -- the exact model id the engine reported
  repeat_no INTEGER NOT NULL,
  prompt_text TEXT NOT NULL,         -- as sent (head-to-head order alternates by repeat)
  status TEXT NOT NULL,              -- ok | error
  answer TEXT,
  citations_json TEXT,               -- [{url, title}] as the engine returned them
  raw_json TEXT,                     -- the whole response, for audit
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL,
  latency_ms INTEGER,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_round ON runs(round_id, prompt_id, engine);

-- Brands found in an answer (detected by the scorer, reviewable by hand).
CREATE TABLE IF NOT EXISTS mentions (
  run_id TEXT NOT NULL REFERENCES runs(id),
  brand_slug TEXT NOT NULL REFERENCES brands(slug),
  position INTEGER,                  -- 1 = named first
  top_pick INTEGER NOT NULL DEFAULT 0,
  models TEXT,                       -- ; separated model names the answer attached to the brand
  checked INTEGER NOT NULL DEFAULT 0,-- 1 once a person has looked at it
  PRIMARY KEY (run_id, brand_slug)
);

CREATE TABLE IF NOT EXISTS citations (
  run_id TEXT NOT NULL REFERENCES runs(id),
  url TEXT NOT NULL,
  domain TEXT NOT NULL,
  kind TEXT NOT NULL,                -- brand | review | forum | retailer | news | other
  brand_slug TEXT,
  retailer_slug TEXT,
  PRIMARY KEY (run_id, url)
);

-- Where the answer sends the shopper to buy.
CREATE TABLE IF NOT EXISTS routes (
  run_id TEXT NOT NULL REFERENCES runs(id),
  retailer_slug TEXT NOT NULL REFERENCES retailers(slug),
  brand_slug TEXT,
  url TEXT,
  PRIMARY KEY (run_id, retailer_slug, brand_slug)
);

-- The hand-verified spec sheet (shoes in round 1). Truth source: the brand's US site on verified_on.
CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,               -- brand-slug/model-slug
  brand_slug TEXT NOT NULL REFERENCES brands(slug),
  name TEXT NOT NULL,                -- Ghost, Clifton...
  version TEXT,                      -- current version number as a string
  price_usd REAL,
  weight_oz REAL,                    -- brand's stated figure, men's US 9 unless noted
  drop_mm REAL,
  stack_band TEXT,                   -- low (<25) | mid (25-34) | high (35+) heel stack
  widths TEXT,                       -- ; separated, exact (B;D;2E;4E)
  category TEXT,                     -- neutral-road | stability-road | neutral-trail | stability-trail | racing-road | racing-trail
  needs TEXT,                        -- ; separated prompt tags this model credibly serves (eligibility)
  verified_on TEXT,
  source_url TEXT,
  notes TEXT
);

-- Accurate: one direct question per model, 7 facts, three engines, three repeats.
CREATE TABLE IF NOT EXISTS fact_checks (
  run_id TEXT NOT NULL REFERENCES runs(id),
  model_id TEXT NOT NULL REFERENCES models(id),
  fact TEXT NOT NULL,                -- version | price | weight | drop | stack | widths | category
  ai_value TEXT,
  truth TEXT,
  result TEXT NOT NULL,              -- right | wrong | not_sure
  PRIMARY KEY (run_id, model_id, fact)
);

-- Shoppable by AI: the manual site checklist per brand per round.
CREATE TABLE IF NOT EXISTS site_checks (
  round_id TEXT NOT NULL REFERENCES rounds(id),
  brand_slug TEXT NOT NULL REFERENCES brands(slug),
  item TEXT NOT NULL,                -- checklist item slug
  result INTEGER NOT NULL,           -- 1 pass, 0 fail
  notes TEXT,
  PRIMARY KEY (round_id, brand_slug, item)
);

CREATE TABLE IF NOT EXISTS scores (
  round_id TEXT NOT NULL REFERENCES rounds(id),
  brand_slug TEXT NOT NULL REFERENCES brands(slug),
  subject TEXT NOT NULL,             -- recommended | accurate | sourced | shoppable | routing | overall
  score REAL NOT NULL,               -- 0-100
  margin REAL,                       -- +/- from the repeat spread
  n INTEGER,                         -- how many observations
  detail_json TEXT,
  PRIMARY KEY (round_id, brand_slug, subject)
);

CREATE TABLE IF NOT EXISTS fixes (
  round_id TEXT NOT NULL REFERENCES rounds(id),
  brand_slug TEXT NOT NULL REFERENCES brands(slug),
  subject TEXT NOT NULL,
  rank INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (round_id, brand_slug, subject, rank)
);

-- Context beside the scores, not scored.
CREATE TABLE IF NOT EXISTS context_metrics (
  round_id TEXT NOT NULL REFERENCES rounds(id),
  brand_slug TEXT NOT NULL REFERENCES brands(slug),
  metric TEXT NOT NULL,              -- trends_index | amazon_rank | revenue_note
  value TEXT,
  source TEXT,
  PRIMARY KEY (round_id, brand_slug, metric)
);
