-- CRRNT migration 005 — internal product analytics (run once on the live DB,
-- e.g. psql "$DATABASE_URL" -f migrations/005_internal_analytics.sql).
-- Idempotent: safe to run twice. Mirrors the additions in schema.sql.
--
-- Replaces the short-lived PostHog integration (PR #58, removed in PR #60):
-- product events are now stored in CRRNT's own database and read through
-- the admin portal's Analytics page. Nothing leaves the backend.
--
-- Privacy design (see privacy policy): analytics_events rows are keyed only
-- by the same random on-device UUID the usage metrics already used — never
-- joined to a name, email, account, or IP; IPs are never written here.
-- devices.is_internal marks the owner's own test devices so the dashboard
-- can exclude them from headline counts (they were previously
-- indistinguishable from real readers and inflated them).
-- Retention: events are deleted after 90 days, together with the device
-- purge in services/db.py::record_device.

CREATE TABLE IF NOT EXISTS analytics_events (
  id BIGSERIAL PRIMARY KEY,
  device_id TEXT NOT NULL,
  event TEXT NOT NULL,
  story_id TEXT,
  category TEXT,
  platform TEXT NOT NULL,
  app_version TEXT NOT NULL DEFAULT 'unknown',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_created
  ON analytics_events(created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_event
  ON analytics_events(event, created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_story
  ON analytics_events(story_id) WHERE story_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analytics_events_device
  ON analytics_events(device_id);

ALTER TABLE devices ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT FALSE;
