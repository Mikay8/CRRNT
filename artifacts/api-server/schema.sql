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
  category TEXT,
  published_at TIMESTAMPTZ,
  source_url TEXT,
  media_url TEXT,

  summary TEXT,
  life_impact TEXT,
  wallet_impact TEXT,
  stock_note TEXT,
  one_liner TEXT,

  tts_url TEXT,

  sentiment_label TEXT,
  sentiment_score FLOAT,
  people_say TEXT,

  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

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
  ('ingest_config', '{"mode":"both","categories":{"celebrity":{"enabled":true,"count":10},"tech":{"enabled":true,"count":10},"government":{"enabled":true,"count":10},"sports":{"enabled":true,"count":10},"business":{"enabled":true,"count":10},"science":{"enabled":true,"count":10}},"trending_count":25}'::jsonb),
  ('feed_limits',   '{"daily":15}'::jsonb),
  ('story_expiry',  '{"days":7,"extension_days":30}'::jsonb),
  ('admin_emails',   '{"emails":[]}'::jsonb),
  ('schedule_times', '{"ingest_hour":6,"ingest_minute":0,"cleanup_hour":3,"cleanup_minute":0}'::jsonb)
ON CONFLICT (key) DO NOTHING;
