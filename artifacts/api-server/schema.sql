-- CRRNT — Railway Postgres schema.
-- Run once against the Railway Postgres instance (psql "$DATABASE_URL" -f schema.sql).
-- Replaces Supabase's migrations.sql + migration_app_settings.sql + migration_phase9_security.sql:
--   - no RLS / policies — the FastAPI backend is the only DB client and enforces
--     authorization at the route layer (it always connected with the service-role
--     key before, which bypasses RLS anyway, so nothing behavioral changes)
--   - no RevenueCat / tier columns — the app has one feed tier for everyone
--   - users.password_hash added — auth is now handled locally instead of by
--     Supabase Auth's separate auth.users table

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────
-- TABLES
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  notification_consent BOOLEAN DEFAULT FALSE,
  onboarding_complete BOOLEAN DEFAULT FALSE,
  email_verified BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  job_type TEXT,
  housing_status TEXT,
  city TEXT,
  financial_goals TEXT[],
  life_stage TEXT,
  interests TEXT[],
  income_bracket TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT UNIQUE,
  title TEXT,
  display_title TEXT,
  category TEXT,
  published_at TIMESTAMPTZ,
  source_url TEXT,
  media_url TEXT,
  image_credit_name TEXT,
  image_credit_url TEXT,
  image_source TEXT,

  summary TEXT,
  life_impact TEXT,
  wallet_impact TEXT,
  stock_note TEXT,
  one_liner TEXT,

  tts_url TEXT,

  sentiment_label TEXT,
  sentiment_score FLOAT,
  people_say TEXT,
  featured_posts JSONB,

  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unsplash image pool: per-category generic photos (no RSS publisher photos).
-- Stories carry the pool image_url plus photographer credit columns.
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

CREATE TABLE IF NOT EXISTS story_audio (
  story_id UUID PRIMARY KEY REFERENCES stories(id) ON DELETE CASCADE,
  mp3_data BYTEA NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS saved_stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  story_id UUID REFERENCES stories(id) ON DELETE CASCADE,
  saved_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, story_id)
);

CREATE TABLE IF NOT EXISTS breaking_news (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  headline TEXT NOT NULL,
  link TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '6 hours'
);

CREATE TABLE IF NOT EXISTS ingestion_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at TIMESTAMPTZ DEFAULT NOW(),
  stories_fetched INT DEFAULT 0,
  stories_enriched INT DEFAULT 0,
  tts_generated INT DEFAULT 0,
  errors INT DEFAULT 0,
  status TEXT,
  notes TEXT
);

-- Pre-auth, anonymous device tokens
CREATE TABLE IF NOT EXISTS push_tokens (
  token TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 4 personalizations cache
CREATE TABLE IF NOT EXISTS story_personalizations (
  user_id  UUID REFERENCES users(id)   ON DELETE CASCADE,
  story_id UUID REFERENCES stories(id) ON DELETE CASCADE,
  personalized_text TEXT NOT NULL,
  audio_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, story_id)
);

-- Per-user cached full-story audio
CREATE TABLE IF NOT EXISTS user_story_audio (
  user_id  UUID REFERENCES users(id)   ON DELETE CASCADE,
  story_id UUID REFERENCES stories(id) ON DELETE CASCADE,
  mp3_data BYTEA NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, story_id)
);

-- App settings — persistent key/value config store used by the admin portal.
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Beta feedback from the in-app Settings suggestion box. Submitted items are
-- stored here (not emailed immediately); the morning digest batches every
-- not-yet-emailed item into one email, and the admin portal Feedback page
-- lists them individually for review. emailed_at and reviewed_at are
-- independent: an item can be emailed but still awaiting review.
CREATE TABLE IF NOT EXISTS beta_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message TEXT NOT NULL,
  platform TEXT,
  app_version TEXT,
  emailed_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Password reset tokens (replaces Supabase Auth's built-in reset-password flow).
-- One-time use, short-lived; old rows for a user are cleared on each new request.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token      TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);

-- ─────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_stories_category ON stories(category);
CREATE INDEX IF NOT EXISTS idx_stories_published_at ON stories(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_stories_expires_at ON stories(expires_at);
CREATE INDEX IF NOT EXISTS idx_saved_stories_user_id ON saved_stories(user_id);
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id);

-- ─────────────────────────────────────────
-- SEED DEFAULTS
-- ─────────────────────────────────────────

INSERT INTO app_settings (key, value) VALUES
  ('ingest_config', '{"categories":{"celebrity":{"enabled":true,"count":10},"tech":{"enabled":true,"count":10},"government":{"enabled":true,"count":10},"sports":{"enabled":true,"count":10},"business":{"enabled":true,"count":10},"science":{"enabled":true,"count":10},"world":{"enabled":true,"count":10},"health":{"enabled":true,"count":10}}}'::jsonb),
  ('feed_limits',   '{"daily":15}'::jsonb),
  ('story_expiry',  '{"days":7,"extension_days":30}'::jsonb),
  ('admin_emails',   '{"emails":[]}'::jsonb),
  ('schedule_times', '{"ingest_hour":6,"ingest_minute":0,"cleanup_hour":3,"cleanup_minute":0}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────
-- ADDITIVE CHANGES (safe to re-run against the existing Railway DB)
-- ─────────────────────────────────────────

ALTER TABLE stories ADD COLUMN IF NOT EXISTS featured_posts JSONB;

-- Migration 002 — anonymous usage metrics (also in migrations/002_anonymous_metrics.sql).
-- install_counts is aggregate-only (one row per day per platform, no identifiers).
-- devices is keyed by a random UUID generated on the device, never joined to
-- accounts, names, emails, or IPs. Rows inactive 90 days are purged on write.
CREATE TABLE IF NOT EXISTS install_counts (
  day DATE NOT NULL,
  platform TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, platform)
);

CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  platform TEXT NOT NULL,
  app_version TEXT NOT NULL DEFAULT 'unknown'
);

CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen);
CREATE INDEX IF NOT EXISTS idx_devices_first_seen ON devices(first_seen);
