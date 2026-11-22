-- 2026-11-22: the runner-need group of each shoe prompt (for the brand-by-need view) and the head-to-head winner of
-- each answer (for the head-to-head grid), both written by the seed and import scripts.
-- ALTER TABLE ... ADD COLUMN has no IF NOT EXISTS in SQLite: pasting this twice fails with "duplicate column name"
-- and changes nothing, which is fine. Code copes with the columns missing until this is applied.
ALTER TABLE prompts ADD COLUMN prompt_group TEXT;
ALTER TABLE runs ADD COLUMN winner TEXT;
