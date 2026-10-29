-- 003: display_title — Claude-generated faithful hook headline.
-- stories.title keeps the original RSS headline as the audit copy; the
-- app shows display_title when set and falls back to title when NULL.
-- Run BEFORE deploying code that writes display_title (the story insert
-- is dynamic and names the column) — same sequencing as 001.
ALTER TABLE stories ADD COLUMN IF NOT EXISTS display_title TEXT;
