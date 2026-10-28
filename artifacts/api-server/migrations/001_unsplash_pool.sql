-- CRRNT migration 001 — Unsplash image pool (run once on the live DB, e.g.
-- psql "$DATABASE_URL" -f migrations/001_unsplash_pool.sql).
-- Idempotent: safe to run twice. Mirrors the additions in schema.sql.
-- Replaces RSS publisher photos: new stories get a pool image_url plus
-- photographer credit; stories with no pool image fall back to the app's
-- bundled category art (media_url NULL).

CREATE TABLE IF NOT EXISTS image_pool (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  unsplash_photo_id TEXT UNIQUE NOT NULL,
  image_url TEXT NOT NULL,
  photographer_name TEXT NOT NULL,
  photographer_url TEXT NOT NULL,
  photo_url TEXT NOT NULL,
  download_location TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_image_pool_category ON image_pool(category);

ALTER TABLE stories ADD COLUMN IF NOT EXISTS image_credit_name TEXT;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS image_credit_url TEXT;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS image_source TEXT;
