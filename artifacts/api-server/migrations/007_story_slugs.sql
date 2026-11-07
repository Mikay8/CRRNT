-- CRRNT migration 007 — human-readable story slugs
-- (run once on the live DB, e.g. in the Supabase SQL editor or
-- psql "$DATABASE_URL" -f migrations/007_story_slugs.sql).
-- Idempotent: safe to run twice. Mirrors the additions in schema.sql.
--
-- slug: a short readable id derived from the display title
-- (services/slug.py), used in public/share URLs. The story endpoint
-- resolves UUIDs AND slugs, so every existing link keeps working.
-- The partial unique index lets any number of stories have no slug
-- yet (NULL) while guaranteeing live slugs never collide.
-- Run BEFORE deploying code that writes slugs (the story insert is
-- dynamic and names the column), same sequencing as 003/004/006.
-- Existing stories get their slugs from scripts/backfill_slugs.py,
-- run once after this migration.
ALTER TABLE stories ADD COLUMN IF NOT EXISTS slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS stories_slug_key
  ON stories (slug) WHERE slug IS NOT NULL;
