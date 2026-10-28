-- CRRNT migration 002 — anonymous usage metrics (run once on the live DB, e.g.
-- psql "$DATABASE_URL" -f migrations/002_anonymous_metrics.sql).
-- Idempotent: safe to run twice. Mirrors the additions in schema.sql.
--
-- Privacy design (see privacy policy): install_counts holds one row per day
-- per platform — no per-device data at all. devices holds one row per
-- anonymous device ID: a random UUID generated on the device, never joined
-- to any account, name, email, or IP. IPs are never written to either
-- table; the in-memory rate limiter is the only place a caller IP is seen,
-- transiently, and it stores nothing in Postgres.
-- Retention: device rows inactive for 90 days are purged on every device
-- heartbeat write (see services/db.py::record_device). Aggregated install
-- counts are kept permanently — they contain no identifiers.

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
