-- App Settings — persistent key/value config store.
-- Run in Supabase SQL editor after migrations.sql.
-- Safe to re-run: uses IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Service role only — no authenticated user should read or write this table.
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Revoke anon access (defence-in-depth)
REVOKE ALL ON app_settings FROM anon;

-- No user-facing SELECT/INSERT/UPDATE policies.
-- All access comes from the FastAPI backend via SUPABASE_SERVICE_KEY.

-- Seed defaults so the server reads real values on first boot.
INSERT INTO app_settings (key, value) VALUES
  ('ingest_config', '{"mode":"both","categories":{"celebrity":{"enabled":true,"count":10},"tech":{"enabled":true,"count":10},"government":{"enabled":true,"count":10},"sports":{"enabled":true,"count":10},"business":{"enabled":true,"count":10},"science":{"enabled":true,"count":10}},"trending_count":25}'::jsonb),
  ('feed_limits',   '{"free":5,"paid":15}'::jsonb),
  ('story_expiry',  '{"days":7,"extension_days":30}'::jsonb),
  ('admin_emails',   '{"emails":[]}'::jsonb),
  ('schedule_times', '{"ingest_hour":8,"ingest_minute":0,"cleanup_hour":3,"cleanup_minute":0}'::jsonb)
ON CONFLICT (key) DO NOTHING;
