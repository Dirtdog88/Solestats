-- 2026-11-22: the runner-need group of each shoe prompt (for the brand-by-need view), the head-to-head winner of
-- each answer (for the head-to-head grid), both written by the seed and import scripts, and the views table that
-- holds the brand-team views the score script works out (need grid, head-to-head grid, sources, engine split ...).
-- ALTER TABLE ... ADD COLUMN has no IF NOT EXISTS in SQLite: pasting this twice fails with "duplicate column name"
-- at the first ALTER and changes nothing, which is fine. Code copes with the columns missing until this is applied.
CREATE TABLE IF NOT EXISTS views (
  round_id TEXT NOT NULL REFERENCES rounds(id),
  view TEXT NOT NULL,                -- needs | h2h | places | sources | engines | summary
  key TEXT NOT NULL DEFAULT '',      -- '' for the whole round, else a brand slug
  detail_json TEXT NOT NULL,
  PRIMARY KEY (round_id, view, key)
);
ALTER TABLE prompts ADD COLUMN prompt_group TEXT;
ALTER TABLE runs ADD COLUMN winner TEXT;
