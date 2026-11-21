-- 2026-11-21: which prompts make up the monthly pulse (about 30, run between the quarterly full rounds).
-- ALTER TABLE ... ADD COLUMN has no IF NOT EXISTS in SQLite: pasting this twice fails with "duplicate column name"
-- and changes nothing, which is fine. Code copes with the column missing until this is applied.
ALTER TABLE prompts ADD COLUMN pulse INTEGER NOT NULL DEFAULT 0;
