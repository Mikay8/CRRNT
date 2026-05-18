-- Phase 9 Security — Run in Supabase SQL editor after the main migration.
-- Safe to re-run: all statements use IF NOT EXISTS / DROP IF EXISTS.
--
-- HOW RLS WORKS IN THIS APP
-- --------------------------
-- The FastAPI backend always connects with SUPABASE_SERVICE_KEY (service role).
-- Service role bypasses RLS entirely — all backend queries work regardless of policies.
-- RLS policies protect direct Supabase client access (e.g., the JS SDK from a
-- compromised client or a leaked anon key). Every table has RLS enabled so the
-- "deny by default" posture holds even if a new table is added without policies.

-- ─────────────────────────────────────────────────────────────────
-- 1. Tables db.py uses that are not in the base migrations.sql yet
-- ─────────────────────────────────────────────────────────────────

-- Phase 4 personalizations cache
CREATE TABLE IF NOT EXISTS story_personalizations (
  user_id  UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  story_id UUID REFERENCES stories(id)    ON DELETE CASCADE,
  personalized_text TEXT NOT NULL,
  audio_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, story_id)
);

-- Per-user cached full-story audio
CREATE TABLE IF NOT EXISTS user_story_audio (
  user_id  UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  story_id UUID REFERENCES stories(id)    ON DELETE CASCADE,
  mp3_data TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, story_id)
);

-- ─────────────────────────────────────────────────────────────────
-- 2. Enable RLS on every table (idempotent)
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE users                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences       ENABLE ROW LEVEL SECURITY;
ALTER TABLE stories                ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_audio            ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_stories          ENABLE ROW LEVEL SECURITY;
ALTER TABLE breaking_news          ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_tokens            ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_personalizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_story_audio       ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────
-- 3. Policies — drop first so the file is safely re-runnable
-- ─────────────────────────────────────────────────────────────────

-- users: own row only
DROP POLICY IF EXISTS "users_self_select" ON users;
DROP POLICY IF EXISTS "users_self_update" ON users;
CREATE POLICY "users_self_select" ON users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "users_self_update" ON users FOR UPDATE USING (auth.uid() = id);

-- user_preferences: own row only
DROP POLICY IF EXISTS "prefs_self"        ON user_preferences;
DROP POLICY IF EXISTS "prefs_self_insert" ON user_preferences;
CREATE POLICY "prefs_self"        ON user_preferences USING (auth.uid() = user_id);
CREATE POLICY "prefs_self_insert" ON user_preferences FOR INSERT WITH CHECK (auth.uid() = user_id);

-- stories: free readable by any authenticated user; paid by paid users only
DROP POLICY IF EXISTS "stories_free" ON stories;
DROP POLICY IF EXISTS "stories_paid" ON stories;
CREATE POLICY "stories_free" ON stories FOR SELECT USING (
  tier = 'free' AND auth.role() = 'authenticated'
);
CREATE POLICY "stories_paid" ON stories FOR SELECT USING (
  tier = 'paid'
  AND auth.uid() IN (SELECT id FROM users WHERE tier = 'paid')
);

-- story_audio: same gating as stories
DROP POLICY IF EXISTS "audio_free" ON story_audio;
DROP POLICY IF EXISTS "audio_paid" ON story_audio;
CREATE POLICY "audio_free" ON story_audio FOR SELECT USING (
  story_id IN (SELECT id FROM stories WHERE tier = 'free')
  AND auth.role() = 'authenticated'
);
CREATE POLICY "audio_paid" ON story_audio FOR SELECT USING (
  story_id IN (SELECT id FROM stories WHERE tier = 'paid')
  AND auth.uid() IN (SELECT id FROM users WHERE tier = 'paid')
);

-- saved_stories: own rows only
DROP POLICY IF EXISTS "saved_self"        ON saved_stories;
DROP POLICY IF EXISTS "saved_self_insert" ON saved_stories;
DROP POLICY IF EXISTS "saved_self_delete" ON saved_stories;
CREATE POLICY "saved_self"        ON saved_stories USING (auth.uid() = user_id);
CREATE POLICY "saved_self_insert" ON saved_stories FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "saved_self_delete" ON saved_stories FOR DELETE USING (auth.uid() = user_id);

-- breaking_news: all authenticated users can read
DROP POLICY IF EXISTS "breaking_read" ON breaking_news;
CREATE POLICY "breaking_read" ON breaking_news FOR SELECT USING (auth.role() = 'authenticated');

-- ingestion_logs: service role only — no user-facing policy (deny by default for all roles)

-- push_tokens: service role only — no user-facing policy
--   Tokens are written by the backend /api/push-token endpoint using the service key.
--   No authenticated or anonymous user should be able to read or write this table directly.

-- story_personalizations: own rows only
DROP POLICY IF EXISTS "personalizations_self_select" ON story_personalizations;
DROP POLICY IF EXISTS "personalizations_self_insert" ON story_personalizations;
CREATE POLICY "personalizations_self_select" ON story_personalizations FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "personalizations_self_insert" ON story_personalizations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- user_story_audio: own rows only
DROP POLICY IF EXISTS "user_audio_self_select" ON user_story_audio;
DROP POLICY IF EXISTS "user_audio_self_insert" ON user_story_audio;
CREATE POLICY "user_audio_self_select" ON user_story_audio FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "user_audio_self_insert" ON user_story_audio FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────
-- 4. Revoke anon access from all tables (defence-in-depth)
--    The anon role should never touch any table in this app.
-- ─────────────────────────────────────────────────────────────────

REVOKE ALL ON users                  FROM anon;
REVOKE ALL ON user_preferences       FROM anon;
REVOKE ALL ON stories                FROM anon;
REVOKE ALL ON story_audio            FROM anon;
REVOKE ALL ON saved_stories          FROM anon;
REVOKE ALL ON breaking_news          FROM anon;
REVOKE ALL ON ingestion_logs         FROM anon;
REVOKE ALL ON push_tokens            FROM anon;
REVOKE ALL ON story_personalizations FROM anon;
REVOKE ALL ON user_story_audio       FROM anon;

-- ─────────────────────────────────────────────────────────────────
-- 5. Verify — run this query to confirm RLS is on everywhere
-- ─────────────────────────────────────────────────────────────────
-- SELECT tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
-- ORDER BY tablename;
--
-- Expected: rowsecurity = true for all 10 tables above.
