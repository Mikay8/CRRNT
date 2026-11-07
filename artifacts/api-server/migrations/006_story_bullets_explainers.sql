-- CRRNT migration 006 — story format v2: bullet body + tappable explainers
-- (run once on the live DB, e.g. psql "$DATABASE_URL" -f
-- migrations/006_story_bullets_explainers.sql).
-- Idempotent: safe to run twice. Mirrors the additions in schema.sql.
--
-- body_bullets: the story body as an array of (normally 3) plain-language
-- bullet sentences from Claude Pass 1. The prose `summary` column stays
-- populated (it is the bullets joined) so audio, digest, and share text
-- keep working unchanged; the app renders bullets when present and falls
-- back to the summary paragraph for older stories.
-- explainers: up to 3 {term, blurb} evergreen-background notes per story;
-- the app makes each term tappable in the story and opens the blurb in a
-- popup. Both columns are additive and nullable — run BEFORE deploying
-- code that writes them (the story insert is dynamic and names the
-- columns), same sequencing as 003/004.
ALTER TABLE stories ADD COLUMN IF NOT EXISTS body_bullets JSONB;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS explainers JSONB;
